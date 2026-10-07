/*
 * Sales waiting to reach the server. A sale made with no connection is kept here, on the phone, and sent when it can be.
 *
 * Nothing is decided offline: the server numbers the invoice, checks the price and applies offers when the sale arrives, exactly as if it
 * had been billed on the spot. What makes sending safe is the Idempotency-Key each sale carries (its `id`): if an earlier attempt did reach
 * the server before the signal dropped, sending it again returns that same invoice instead of billing twice.
 *
 * Rules (the same as the web till's queue, plus the phone's own):
 *   - oldest first, one at a time;
 *   - it STOPS at the first thing that means "try later": no connection, a server error, a signed-out session;
 *   - a sale the server REFUSES (a coupon that expired, a product archived) is parked as `failed` with the reason, where a person reads it
 *     and decides; it never blocks the sales behind it and is never dropped on its own;
 *   - a sale already sent is kept for a week (so the day's list is complete), then forgotten;
 *   - at most MAX_UNSENT unsent sales: past that the till says so instead of piling up more than can be checked.
 */
import { ApiError, NetworkError } from './api.ts';
import type { Db } from './db.ts';

export const MAX_UNSENT = 500;
const KEEP_SENT_MS = 7 * 24 * 3600 * 1000;

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS outbox (
    n INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,            -- the Idempotency-Key
    local_no TEXT NOT NULL,             -- the provisional number shown at the counter (P-AB3-0007)
    body TEXT NOT NULL,                 -- what POST /invoices takes
    preview TEXT NOT NULL,              -- what the provisional receipt shows
    taken_at INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',   -- pending | failed | sent
    attempts INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    invoice_id INTEGER,
    invoice_number TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_outbox_state ON outbox (state, n);
`;

export type Preview = { lines: { name: string; quantity: number; unitPricePaise: number }[]; subtotalPaise: number; taxPaise: number; totalPaise: number; method: string };
export type Entry = {
  n: number; id: string; local_no: string; body: Record<string, unknown>; preview: Preview; taken_at: number;
  state: 'pending' | 'failed' | 'sent'; attempts: number; error: string | null; invoice_id: number | null; invoice_number: string | null;
};
type Row = Omit<Entry, 'body' | 'preview'> & { body: string; preview: string };
const entry = (r: Row): Entry => ({ ...r, body: JSON.parse(r.body), preview: JSON.parse(r.preview) });

export type Sent = { invoice_id: number; invoice_number: string };
export type Flushed = { sent: number; failed: number; stopped: null | 'offline' | 'server' | 'auth' };

const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const createOutbox = (db: Db, { now = () => Date.now() }: { now?: () => number } = {}) => {
  let flushing: Promise<Flushed> | null = null;

  const meta = async (k: string) => (await db.all<{ v: string }>(`SELECT v FROM meta WHERE k = ?`, [k]))[0]?.v ?? null;
  const setMeta = (k: string, v: string) => db.run(`INSERT OR REPLACE INTO meta (k, v) VALUES (?,?)`, [k, v]);

  /** P-<this phone's 3 letters>-<counter>: provisional, and different on every phone, so two offline phones never show the same number. */
  const deviceCode = async () => {
    let device = await meta('device');
    if (!device) { device = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join(''); await setMeta('device', device); }
    return device;
  };
  const nextLocalNo = async () => {
    const device = await deviceCode();
    const n = Number((await meta('local_seq')) ?? 0) + 1;
    await setMeta('local_seq', String(n));
    return `P-${device}-${String(n).padStart(4, '0')}`;
  };

  const unsent = async () => Number((await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM outbox WHERE state <> 'sent'`))[0].n);

  return {
    /** Keep a sale for later. Resolves to null when the queue is full. The same id twice is still one sale. */
    add: async ({ id, body, preview }: { id: string; body: Record<string, unknown>; preview: Preview }): Promise<Entry | null> => {
      const existing = (await db.all<Row>(`SELECT * FROM outbox WHERE id = ?`, [id]))[0];
      if (existing) return entry(existing);
      if ((await unsent()) >= MAX_UNSENT) return null;
      const localNo = await nextLocalNo();
      await db.run(`INSERT INTO outbox (id, local_no, body, preview, taken_at) VALUES (?,?,?,?,?)`, [id, localNo, JSON.stringify(body), JSON.stringify(preview), now()]);
      return entry((await db.all<Row>(`SELECT * FROM outbox WHERE id = ?`, [id]))[0]);
    },

    /** This phone's 3-letter code (also in its provisional bill numbers). */
    device: deviceCode,
    /** Forget the sales already sent. Only for clearing this phone's data: it never touches a sale still waiting or refused. */
    forgetSent: () => db.run(`DELETE FROM outbox WHERE state = 'sent'`),

    get: async (id: string) => { const r = (await db.all<Row>(`SELECT * FROM outbox WHERE id = ?`, [id]))[0]; return r ? entry(r) : null; },
    list: async (): Promise<Entry[]> => (await db.all<Row>(`SELECT * FROM outbox ORDER BY n DESC`)).map(entry),
    counts: async () => {
      const rows = await db.all<{ state: string; n: number }>(`SELECT state, COUNT(*) AS n FROM outbox GROUP BY state`);
      const of = (s: string) => Number(rows.find((r) => r.state === s)?.n ?? 0);
      return { pending: of('pending'), failed: of('failed'), sent: of('sent') };
    },

    /** Give a refused sale another go (after the cause has been fixed). */
    retry: (id: string) => db.run(`UPDATE outbox SET state = 'pending', error = NULL WHERE id = ? AND state = 'failed'`, [id]),
    /** A person's decision to let a refused sale go. Only a failed sale can be discarded; a pending one is real money and stays. */
    discard: (id: string) => db.run(`DELETE FROM outbox WHERE id = ? AND state = 'failed'`, [id]),

    /** Send everything pending, oldest first. Calls overlap safely: a second call joins the first. */
    flush: (send: (e: Entry) => Promise<Sent>): Promise<Flushed> => {
      if (flushing) return flushing;
      flushing = (async () => {
        let sent = 0; let failed = 0; let stopped: Flushed['stopped'] = null;
        const queue = (await db.all<Row>(`SELECT * FROM outbox WHERE state = 'pending' ORDER BY n`)).map(entry);
        for (const e of queue) {
          await db.run(`UPDATE outbox SET attempts = attempts + 1 WHERE id = ?`, [e.id]);
          try {
            const result = await send(e);
            await db.run(`UPDATE outbox SET state = 'sent', error = NULL, invoice_id = ?, invoice_number = ? WHERE id = ?`, [result.invoice_id, result.invoice_number, e.id]);
            sent++;
          } catch (error) {
            if (error instanceof NetworkError) { stopped = 'offline'; break; }
            if (error instanceof ApiError) {
              if (error.status === 401) { stopped = 'auth'; break; }
              // 5xx, "too many requests", or "this sale is still being processed" (an earlier attempt is mid-way): try later
              if (error.status >= 500 || error.status === 429 || (error.status === 409 && /already being processed/i.test(error.message))) { stopped = 'server'; break; }
              await db.run(`UPDATE outbox SET state = 'failed', error = ? WHERE id = ?`, [error.message, e.id]);
              failed++; continue;
            }
            stopped = 'server'; break;
          }
        }
        await db.run(`DELETE FROM outbox WHERE state = 'sent' AND taken_at < ?`, [now() - KEEP_SENT_MS]);
        return { sent, failed, stopped };
      })().finally(() => { flushing = null; });
      return flushing;
    }
  };
};

export type Outbox = ReturnType<typeof createOutbox>;
