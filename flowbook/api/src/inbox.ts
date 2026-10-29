import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import { audit } from './audit.ts';
import { withOrg } from './db.ts';
import type { Db } from './db.ts';
import { LedgerError, post, reverse } from './ledger.ts';
import { createParty } from './masters.ts';
import { customerPaymentJournal, statedCreditNoteJournal, statedSaleJournal } from './rules.ts';
import type { Tender } from './rules.ts';

/* FlowXP events become journals here (flowxp-integration-contract.md). Every event is stored as it arrived before anything
   is posted, so a failure never loses it; posting is idempotent by the event's own document id, so a re-delivery or a
   replay can never post twice. FlowXP is the only producer of accounting events for its sales (section 5). */

export type Connection = { id: bigint; organization_id: bigint; secret: string; previous_secret: string | null; previous_secret_until: Date | null; cutover_date: string | null };
const ACTOR = 'integration:flowxp';
const SKEW_SECONDS = 300;

export const newSecret = (): string => `fxs_${randomBytes(32).toString('hex')}`;

/** `t=<unix>,v1=<hmac_sha256(secret, t + "." + body)>`; checked in constant time, against the old secret too while it is still valid. */
export const verifySignature = (header: string | undefined, raw: string, conn: Connection, nowMs = Date.now()): boolean => {
  const parts = Object.fromEntries((header ?? '').split(',').map((p) => p.trim().split('=') as [string, string]));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(nowMs / 1000 - t) > SKEW_SECONDS || !parts.v1) return false;
  const secrets = [conn.secret, ...(conn.previous_secret && conn.previous_secret_until && conn.previous_secret_until.getTime() > nowMs ? [conn.previous_secret] : [])];
  const got = Buffer.from(parts.v1, 'hex');
  return secrets.some((s) => { const want = createHmac('sha256', s).update(`${t}.${raw}`).digest(); return got.length === want.length && timingSafeEqual(got, want); });
};

/** Read before the organization is known (the signature decides who is talking), as the owner role. */
export const findConnection = async (pool: pg.Pool, businessId: string): Promise<Connection | null> =>
  (await pool.query(
    `SELECT id, organization_id, secret, previous_secret, previous_secret_until, cutover_date::text AS cutover_date
       FROM integration_connections WHERE provider = 'FLOWXP' AND external_business_id = $1 AND active`, [businessId])).rows[0] ?? null;

/* ---- reading the payload: strict, and explicit about which problems a person can fix */
class EventInvalid extends Error {}
class NeedsAttention extends Error {}
type Obj = Record<string, unknown>;

const obj = (v: unknown, name: string): Obj => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new EventInvalid(`${name} is missing`); return v as Obj; };
const text = (v: unknown, name: string): string => { if ((typeof v !== 'string' && typeof v !== 'number') || String(v).trim() === '') throw new EventInvalid(`${name} is missing`); return String(v).trim(); };
const paise = (v: unknown, name: string, o: { signed?: boolean; positive?: boolean } = {}): bigint => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || (!o.signed && v < 0) || (o.positive && v <= 0)) throw new EventInvalid(`${name} must be a whole number of paise${o.positive ? ' above zero' : ''}`);
  return BigInt(v);
};
const day = (v: unknown, name: string): string => { const s = text(v, name); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new EventInvalid(`${name} must be YYYY-MM-DD`); return s; };
const list = (v: unknown, name: string): unknown[] => { if (!Array.isArray(v) || v.length > 500) throw new EventInvalid(`${name} must be a list`); return v; };
const MODES = new Set(['CASH', 'BANK', 'UPI', 'CARD']);
const mode = (v: unknown): Tender => { const m = text(v, 'tender mode').toUpperCase(); if (!MODES.has(m)) throw new NeedsAttention(`tender ${m} has no account in this organization yet`); return m as Tender; };

/** Net value, the three tax amounts, the discount taken off the bill and the round-off: what FlowXP worked out is the record. */
const amounts = (p: Obj) => {
  const net = paise(p.net_minor, 'net_minor');
  const tax = { cgst: paise(p.cgst_minor ?? 0, 'cgst_minor'), sgst: paise(p.sgst_minor ?? 0, 'sgst_minor'), igst: paise(p.igst_minor ?? 0, 'igst_minor') };
  const discount = paise(p.discount_minor ?? 0, 'discount_minor');
  const roundOff = paise(p.round_off_minor ?? 0, 'round_off_minor', { signed: true });
  return { net, tax, discount, roundOff, gross: net + tax.cgst + tax.sgst + tax.igst - discount };
};

/** The customer FlowXP names becomes (or is found as) a party, matched by FlowXP's id and never by name. */
const partyOf = async (c: Db, orgId: bigint, customer: unknown): Promise<bigint | undefined> => {
  if (customer === undefined || customer === null) return undefined;
  const o = obj(customer, 'customer');
  const ref = `flowxp:${text(o.id, 'customer id')}`;
  const found = (await c.query(`SELECT id FROM parties WHERE external_ref = $1`, [ref])).rows[0];
  if (found) return found.id as bigint;
  return createParty(c, orgId, { kind: 'CUSTOMER', name: text(o.name ?? ref, 'customer name').slice(0, 160), externalRef: ref, stateCode: typeof o.state_code === 'string' && /^\d{2}$/.test(o.state_code) ? o.state_code : undefined }, ACTOR);
};

type Outcome = 'POSTED' | 'IGNORED_CUTOVER' | 'IGNORED_UNSUPPORTED';
type Event = { type: string; payload: Obj };

const remember = (c: Db, orgId: bigint, conn: Connection, type: 'sale' | 'credit_note' | 'payment', id: string, number: string | null, date: string, total: bigint, status: string, entry: bigint | null, payload: Obj) =>
  c.query(
    `INSERT INTO external_documents (organization_id, connection_id, source_type, source_id, number, doc_date, total_minor, status, journal_entry_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (connection_id, source_type, source_id) DO NOTHING`, [orgId, conn.id, type, id, number, date, total, status, entry, payload]);

const handle = async (c: Db, orgId: bigint, conn: Connection, ev: Event): Promise<Outcome> => {
  const p = ev.payload;
  const before = (date: string) => conn.cutover_date !== null && date < conn.cutover_date;   // dates are ISO text, so text order is date order

  if (ev.type === 'sale.finalized') {
    const id = text(p.invoice_id, 'invoice_id'); const number = text(p.invoice_number ?? id, 'invoice_number'); const date = day(p.date, 'date');
    const a = amounts(p);
    const total = paise(p.total_minor, 'total_minor');
    if (a.gross + a.roundOff !== total) throw new EventInvalid(`total_minor ${total} does not equal net plus tax less discount plus round-off ${a.gross + a.roundOff}`);
    const tenders = list(p.tenders ?? [], 'tenders').map((t) => ({ mode: mode(obj(t, 'tender').mode), amount: paise(obj(t, 'tender').amount_minor, 'tender amount_minor', { positive: true }) }));
    const unpaid = total - tenders.reduce((a, t) => a + t.amount, 0n);
    if (unpaid < 0n || unpaid !== paise(p.unpaid_minor, 'unpaid_minor')) throw new EventInvalid('unpaid_minor does not equal the total less the tenders');
    if (before(date)) { await remember(c, orgId, conn, 'sale', id, number, date, total, 'REFERENCE', null, p); return 'IGNORED_CUTOVER'; }
    const partyId = await partyOf(c, orgId, p.customer);
    if (unpaid > 0n && partyId === undefined) throw new NeedsAttention('a sale with an unpaid amount needs a customer');
    const j = statedSaleJournal({ date, invoiceId: number, partyId, net: a.net, tax: a.tax, discount: a.discount, roundOff: a.roundOff, tenders, total });
    const posted = await post(c, orgId, { ...j, sourceSystem: 'flowxp', sourceType: 'flowxp_sale', sourceId: id, actor: ACTOR });
    await remember(c, orgId, conn, 'sale', id, number, date, total, 'POSTED', posted.entryId, p);
    return 'POSTED';
  }

  if (ev.type === 'sale.voided') {
    const id = text(p.invoice_id, 'invoice_id'); const date = day(p.date, 'date');
    const doc = (await c.query(`SELECT id, status, journal_entry_id FROM external_documents WHERE connection_id = $1 AND source_type = 'sale' AND source_id = $2 FOR UPDATE`, [conn.id, id])).rows[0];
    if (!doc) throw new NeedsAttention(`sale ${id} has not arrived yet; replay this event after it does`);
    if (doc.status !== 'POSTED') return doc.status === 'VOID' ? 'POSTED' : 'IGNORED_CUTOVER';      // already void, or never posted (before cut-over)
    const rev = await reverse(c, orgId, doc.journal_entry_id as bigint, { date, reason: text(p.reason ?? 'voided in FlowXP', 'reason').slice(0, 280), actor: ACTOR });
    await c.query(`UPDATE external_documents SET status = 'VOID', reversal_entry_id = $2 WHERE id = $1`, [doc.id, rev.entryId]);
    return 'POSTED';
  }

  if (ev.type === 'sale.returned') {
    const id = text(p.note_id, 'note_id'); const number = text(p.note_number ?? id, 'note_number'); const date = day(p.date, 'date');
    const a = amounts(p);
    const total = paise(p.total_minor, 'total_minor');
    if (a.gross !== total || a.roundOff !== 0n) throw new EventInvalid(`total_minor ${total} does not equal net plus tax less discount ${a.gross}`);
    const refunds = list(p.refund_tenders ?? [], 'refund_tenders').map((t) => ({ mode: mode(obj(t, 'refund tender').mode), amount: paise(obj(t, 'refund tender').amount_minor, 'refund amount_minor', { positive: true }) }));
    const refunded = refunds.reduce((a, t) => a + t.amount, 0n);
    if (refunded > total) throw new EventInvalid('the refund is more than the credit note');
    if (before(date)) { await remember(c, orgId, conn, 'credit_note', id, number, date, total, 'REFERENCE', null, p); return 'IGNORED_CUTOVER'; }
    const partyId = await partyOf(c, orgId, p.customer);
    if (refunded < total && partyId === undefined) throw new NeedsAttention('a credit note that is not fully refunded needs a customer');
    const posted = await post(c, orgId, { ...statedCreditNoteJournal({ date, noteId: number, partyId, net: a.net, tax: a.tax, discount: a.discount, total }), sourceSystem: 'flowxp', sourceType: 'flowxp_credit_note', sourceId: id, actor: ACTOR });
    let i = 0;
    for (const r of refunds) {
      i += 1;
      await post(c, orgId, { ...customerPaymentJournal({ date, paymentId: `${number}-${i}`, partyId, mode: r.mode, amount: r.amount, refund: true }), sourceSystem: 'flowxp', sourceType: 'flowxp_refund', sourceId: `${id}:${i}`, actor: ACTOR });
    }
    await remember(c, orgId, conn, 'credit_note', id, number, date, total, 'POSTED', posted.entryId, p);
    return 'POSTED';
  }

  if (ev.type === 'payment.received') {
    const id = text(p.payment_id, 'payment_id'); const date = day(p.date, 'date'); const amount = paise(p.amount_minor, 'amount_minor', { positive: true });
    if (before(date)) { await remember(c, orgId, conn, 'payment', id, null, date, amount, 'REFERENCE', null, p); return 'IGNORED_CUTOVER'; }
    const partyId = await partyOf(c, orgId, p.customer);
    if (partyId === undefined) throw new NeedsAttention('a payment received needs a customer');
    const posted = await post(c, orgId, { ...customerPaymentJournal({ date, paymentId: id, partyId, mode: mode(p.mode), amount }), sourceSystem: 'flowxp', sourceType: 'flowxp_payment', sourceId: id, actor: ACTOR });
    await remember(c, orgId, conn, 'payment', id, null, date, amount, 'POSTED', posted.entryId, p);
    return 'POSTED';
  }

  return 'IGNORED_UNSUPPORTED';     // purchases, stock, shifts and master data are stored but not posted yet
};

/** Store the event first (so it is never lost), then post it. A duplicate delivery returns what happened the first time. */
export const receiveEvent = async (pool: pg.Pool, conn: Connection, env: { event_id: string; event_type: string; schema_version: number; sequence?: unknown; occurred_at?: string; payload: Obj }) => {
  const orgId = conn.organization_id;
  const stored = await withOrg(pool, orgId, async (c) => {
    const row = (await c.query(
      `INSERT INTO integration_events (organization_id, connection_id, event_id, event_type, schema_version, sequence, occurred_at, payload) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (connection_id, event_id) DO NOTHING RETURNING id`, [orgId, conn.id, env.event_id, env.event_type, env.schema_version, env.sequence === undefined ? null : String(env.sequence), env.occurred_at ?? null, env.payload])).rows[0];
    if (row) return { id: row.id as bigint, duplicate: false };
    return { id: (await c.query(`SELECT id FROM integration_events WHERE connection_id = $1 AND event_id = $2`, [conn.id, env.event_id])).rows[0].id as bigint, duplicate: true };
  });
  if (stored.duplicate) {
    const prior = await withOrg(pool, orgId, async (c) => (await c.query(`SELECT status FROM integration_events WHERE id = $1`, [stored.id])).rows[0]);
    return { status: prior.status as string, duplicate: true };
  }
  return { status: await processEvent(pool, conn, stored.id), duplicate: false };
};

const ATTENTION = new Set(['period_locked', 'no_period', 'unknown_account', 'inactive_account']);

/** Run the stored event inside a savepoint: if it cannot be posted, nothing it did is kept and the reason is recorded on the event. */
export const processEvent = async (pool: pg.Pool, conn: Connection, eventRowId: bigint): Promise<string> => {
  const orgId = conn.organization_id;
  return withOrg(pool, orgId, async (c) => {
    const ev = (await c.query(`SELECT event_type, schema_version, payload FROM integration_events WHERE id = $1 FOR UPDATE`, [eventRowId])).rows[0];
    await c.query('SAVEPOINT event_post');
    let status: string; let error: string | null = null;
    try {
      if (ev.schema_version !== 1) throw new EventInvalid(`schema_version ${ev.schema_version} is not supported`);
      status = await handle(c, orgId, conn, { type: ev.event_type, payload: ev.payload as Obj });
      await c.query('RELEASE SAVEPOINT event_post');
    } catch (e) {
      await c.query('ROLLBACK TO SAVEPOINT event_post');
      if (e instanceof NeedsAttention) status = 'NEEDS_ATTENTION';
      else if (e instanceof LedgerError && ATTENTION.has(e.code)) status = 'NEEDS_ATTENTION';
      else if (e instanceof EventInvalid || e instanceof LedgerError || e instanceof RangeError) status = 'FAILED_VALIDATION';
      else throw e;
      error = (e as Error).message;
    }
    await c.query(`UPDATE integration_events SET status = $2, error = $3, processed_at = now(), attempts = attempts + 1 WHERE id = $1`, [eventRowId, status, error]);
    if (status === 'POSTED') await audit(c, orgId, { actor: ACTOR, action: 'integration.event_posted', entityType: 'integration_event', entityId: eventRowId, detail: { type: ev.event_type } });
    return status;
  });
};
