/*
 * Changes made with no internet (a new price, a stock count) wait here and are sent when the connection is back, after the bills.
 * Each carries an Idempotency-Key, so a retry after a lost reply cannot apply a stock change twice. The same rules as the bill queue:
 * oldest first; stop at the first "try later"; a change the server refuses is parked with its reason for a person to decide.
 */
import { ApiError, NetworkError } from './api.ts';
import type { Db } from './db.ts';

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS actions (
    n INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,         -- the Idempotency-Key
    label TEXT NOT NULL,             -- what a person reads: "Price of Latte to 170"
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending',   -- pending | failed | sent
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_actions_state ON actions (state, n);
`;

export const MAX_ACTIONS = 200;
const KEEP_SENT_MS = 3 * 24 * 3600 * 1000;

export type Action = { n: number; id: string; label: string; method: string; path: string; body: Record<string, unknown>; created_at: number; state: 'pending' | 'failed' | 'sent'; error: string | null };
type Row = Omit<Action, 'body'> & { body: string };
const asAction = (r: Row): Action => ({ ...r, body: JSON.parse(r.body) });
export type FlushedActions = { sent: number; failed: number; stopped: null | 'offline' | 'server' | 'auth' };

export const createActions = (db: Db, { now = () => Date.now() }: { now?: () => number } = {}) => {
  let flushing: Promise<FlushedActions> | null = null;
  return {
    /** Keep a change for later. Null when the queue is full. The same id twice is one change. */
    add: async ({ id, label, method, path, body }: { id: string; label: string; method: string; path: string; body: Record<string, unknown> }): Promise<Action | null> => {
      const have = (await db.all<Row>(`SELECT * FROM actions WHERE id = ?`, [id]))[0];
      if (have) return asAction(have);
      if (Number((await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM actions WHERE state <> 'sent'`))[0].n) >= MAX_ACTIONS) return null;
      await db.run(`INSERT INTO actions (id, label, method, path, body, created_at) VALUES (?,?,?,?,?,?)`, [id, label, method, path, JSON.stringify(body), now()]);
      return asAction((await db.all<Row>(`SELECT * FROM actions WHERE id = ?`, [id]))[0]);
    },
    list: async (): Promise<Action[]> => (await db.all<Row>(`SELECT * FROM actions ORDER BY n DESC`)).map(asAction),
    counts: async () => {
      const rows = await db.all<{ state: string; n: number }>(`SELECT state, COUNT(*) AS n FROM actions GROUP BY state`);
      const of = (s: string) => Number(rows.find((r) => r.state === s)?.n ?? 0);
      return { pending: of('pending'), failed: of('failed') };
    },
    retry: (id: string) => db.run(`UPDATE actions SET state = 'pending', error = NULL WHERE id = ? AND state = 'failed'`, [id]),
    discard: (id: string) => db.run(`DELETE FROM actions WHERE id = ? AND state = 'failed'`, [id]),

    flush: (send: (a: Action) => Promise<void>): Promise<FlushedActions> => {
      if (flushing) return flushing;
      flushing = (async () => {
        let sent = 0; let failed = 0; let stopped: FlushedActions['stopped'] = null;
        for (const a of (await db.all<Row>(`SELECT * FROM actions WHERE state = 'pending' ORDER BY n`)).map(asAction)) {
          try { await send(a); await db.run(`UPDATE actions SET state = 'sent', error = NULL WHERE id = ?`, [a.id]); sent++; }
          catch (e) {
            if (e instanceof NetworkError) { stopped = 'offline'; break; }
            if (e instanceof ApiError) {
              if (e.status === 401) { stopped = 'auth'; break; }
              if (e.status >= 500 || e.status === 429 || (e.status === 409 && /already being processed/i.test(e.message))) { stopped = 'server'; break; }
              await db.run(`UPDATE actions SET state = 'failed', error = ? WHERE id = ?`, [e.message, a.id]); failed++; continue;
            }
            stopped = 'server'; break;
          }
        }
        await db.run(`DELETE FROM actions WHERE state = 'sent' AND created_at < ?`, [now() - KEEP_SENT_MS]);
        return { sent, failed, stopped };
      })().finally(() => { flushing = null; });
      return flushing;
    }
  };
};
export type Actions = ReturnType<typeof createActions>;
