/*
 * Sending FlowXP's sales to FlowBook: discover what is new, then deliver it in order.
 *
 * Discovery reads the tables every billing module already writes (invoices, credit notes, payments) rather than hooking
 * each one, so a sale from the till, a table, a salon, a gym or a job card all reach FlowBook the same way. The outbox
 * row is created once per document (unique on business, type and document), so scanning twice sends nothing twice.
 * Delivery is strictly in outbox order per business, so a cancellation never overtakes the sale it cancels; a row that
 * fails waits and retries with a growing delay, and after 12 tries it is parked as DEAD for a person to retry.
 *
 * ponytail: a polling scan every 30 seconds rather than a write inside each billing transaction. Sales reach FlowBook
 * within about a minute. Move to writing the outbox row in the billing transaction if that delay matters.
 */
import crypto from 'node:crypto';
import pool from '../../config/database.js';
import { decrypt, encrypt } from '../crypto.js';
import { registerScan } from '../jobs.js';
import { businessToday } from '../../utils/dates.js';
import { stateCode } from '../gst/states.js';
import { creditNoteEvent, envelope, paymentEvent, saleEvent, signature, voidEvent } from './events.js';

export const DOMAIN = 'flowxp-flowbook';
const MAX_ATTEMPTS = 12;
const SETTLE = `interval '5 seconds'`;    // a bill still being written is left a moment, so its payments are all there

const customerRow = async (id, db) => {
  if (!id) return null;
  const c = (await db.query(`SELECT customer_id, name, state FROM customers WHERE customer_id = $1`, [id])).rows[0];
  return c ? { ...c, state_code: stateCode(c.state) || undefined } : null;
};

/* FlowBook runs inside this process, so a sale is handed to it directly: no address, no secret, no signature. embed.js gives
   `local` once FlowBook has started; a link row says base_url 'embedded'. (A link made before that, with an address, still posts over HTTP.) */
const EMBEDDED = 'embedded';
let local = null;
export const setLocalDelivery = (fn) => { local = fn; };

/** Switch the feed on or off for a business, making its link row if it has none. Only what is made after it is switched on is sent. */
export const ensureLink = async (businessId, enabled = true, db = pool) => {
  await db.query(
    `INSERT INTO flowbook_links (business_id, base_url, secret_enc, enabled, enabled_from) VALUES ($1, $2, $3, $4::boolean, CASE WHEN $4::boolean THEN CURRENT_TIMESTAMP END)
     ON CONFLICT (business_id) DO UPDATE SET base_url = $2, enabled = $4::boolean,
       enabled_from = CASE WHEN $4::boolean AND (NOT flowbook_links.enabled OR flowbook_links.enabled_from IS NULL) THEN CURRENT_TIMESTAMP ELSE flowbook_links.enabled_from END, updated_at = CURRENT_TIMESTAMP`,
    [businessId, EMBEDDED, encrypt('embedded', DOMAIN), enabled]);
};

/** The first time a business with a till opens its books: the feed starts, unless the owner already made a choice. */
export const openLink = (businessId, db = pool) => db.query(
  `INSERT INTO flowbook_links (business_id, base_url, secret_enc, enabled, enabled_from) VALUES ($1, $2, $3, TRUE, CURRENT_TIMESTAMP) ON CONFLICT (business_id) DO NOTHING`,
  [businessId, EMBEDDED, encrypt('embedded', DOMAIN)]);

/** Add one outbox row. A skipped document is recorded too (with its reason) so it is counted and never looked at again. */
const queue = async (db, businessId, type, sourceId, built) => (await db.query(
  `INSERT INTO flowbook_outbox (business_id, event_id, event_type, source_id, payload, status, last_error, next_attempt_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP) ON CONFLICT (business_id, event_type, source_id) DO NOTHING`,
  [businessId, crypto.randomUUID(), type, sourceId, JSON.stringify(built.payload || {}), built.skip ? 'SKIPPED' : 'PENDING', built.skip || null])).rowCount;

/** Look for new documents since the link was switched on. Returns how many outbox rows were added. */
export const discover = async (link, db = pool) => {
  const b = link.business_id; const from = link.enabled_from;
  let added = 0;

  const sales = (await db.query(
    `SELECT i.* FROM invoices i WHERE i.business_id = $1 AND i.created_at >= $2 AND i.created_at < CURRENT_TIMESTAMP - ${SETTLE}
        AND NOT EXISTS (SELECT 1 FROM flowbook_outbox o WHERE o.business_id = i.business_id AND o.event_type = 'sale.finalized' AND o.source_id = i.invoice_id)
      ORDER BY i.invoice_id LIMIT 200`, [b, from])).rows;
  for (const inv of sales) {
    if (inv.status === 'CANCELLED') { added += await queue(db, b, 'sale.finalized', inv.invoice_id, { skip: 'Cancelled before it was sent' }); continue; }
    const tenders = (await db.query(`SELECT payment_method, amount_paise, reference_number FROM payments WHERE invoice_id = $1 AND created_at = (SELECT created_at FROM invoices WHERE invoice_id = $1) ORDER BY payment_id`, [inv.invoice_id])).rows;
    added += await queue(db, b, 'sale.finalized', inv.invoice_id, saleEvent(inv, tenders, await customerRow(inv.customer_id, db)));
  }

  // a sale that went out and was cancelled afterwards
  const cancelled = (await db.query(
    `SELECT i.invoice_id, i.business_id FROM invoices i JOIN flowbook_outbox s ON s.business_id = i.business_id AND s.event_type = 'sale.finalized' AND s.source_id = i.invoice_id AND s.status <> 'SKIPPED'
      WHERE i.business_id = $1 AND i.status = 'CANCELLED'
        AND NOT EXISTS (SELECT 1 FROM flowbook_outbox o WHERE o.business_id = i.business_id AND o.event_type = 'sale.voided' AND o.source_id = i.invoice_id) LIMIT 200`, [b])).rows;
  if (cancelled.length) {
    const today = await businessToday(b, db);
    for (const inv of cancelled) added += await queue(db, b, 'sale.voided', inv.invoice_id, voidEvent(inv, today));
  }

  // payments taken after the sale, for sales that went out
  const payments = (await db.query(
    `SELECT p.*, i.customer_id AS inv_customer FROM payments p JOIN invoices i ON i.invoice_id = p.invoice_id
       JOIN flowbook_outbox s ON s.business_id = p.business_id AND s.event_type = 'sale.finalized' AND s.source_id = i.invoice_id AND s.status <> 'SKIPPED'
      WHERE p.business_id = $1 AND p.created_at > i.created_at AND p.created_at < CURRENT_TIMESTAMP - ${SETTLE} AND i.status = 'ISSUED'
        AND NOT EXISTS (SELECT 1 FROM flowbook_outbox o WHERE o.business_id = p.business_id AND o.event_type = 'payment.received' AND o.source_id = p.payment_id)
      ORDER BY p.payment_id LIMIT 200`, [b])).rows;
  for (const p of payments) added += await queue(db, b, 'payment.received', p.payment_id, paymentEvent(p, await customerRow(p.customer_id || p.inv_customer, db)));

  // credit notes for sales that went out
  const notes = (await db.query(
    `SELECT c.*, i.invoice_number, i.customer_id FROM credit_notes c JOIN invoices i ON i.invoice_id = c.invoice_id
       JOIN flowbook_outbox s ON s.business_id = c.business_id AND s.event_type = 'sale.finalized' AND s.source_id = i.invoice_id AND s.status <> 'SKIPPED'
      WHERE c.business_id = $1 AND c.created_at >= $2 AND c.created_at < CURRENT_TIMESTAMP - ${SETTLE}
        AND NOT EXISTS (SELECT 1 FROM flowbook_outbox o WHERE o.business_id = c.business_id AND o.event_type = 'sale.returned' AND o.source_id = c.cn_id)
      ORDER BY c.cn_id LIMIT 200`, [b, from])).rows;
  for (const c of notes) {
    const refunds = (await db.query(`SELECT method, amount_paise FROM refunds WHERE credit_note_id = $1 ORDER BY refund_id`, [c.cn_id])).rows;
    added += await queue(db, b, 'sale.returned', c.cn_id, creditNoteEvent(c, c.invoice_number, refunds, await customerRow(c.customer_id, db)));
  }
  return added;
};

/**
 * Send the due rows of one business in order. Stops at the first failure so order is kept. `send` is the HTTP call
 * (replaceable in tests). Returns { sent, failed }.
 */
export const deliver = async (link, { db = pool, send = defaultSend, now = () => Math.floor(Date.now() / 1000) } = {}) => {
  const inside = link.base_url === EMBEDDED;
  const secret = inside ? '' : decrypt(link.secret_enc, DOMAIN);
  let sent = 0; let failed = 0;
  for (;;) {
    const row = (await db.query(
      `SELECT * FROM flowbook_outbox WHERE business_id = $1 AND status = 'PENDING' ORDER BY outbox_id LIMIT 1`, [link.business_id])).rows[0];
    if (!row || new Date(row.next_attempt_at) > new Date()) break;
    const body = envelope({ eventId: row.event_id, type: row.event_type, businessId: row.business_id, sequence: row.outbox_id, occurredAt: new Date(row.created_at).toISOString(), payload: row.payload });
    try {
      if (inside) {
        if (!local) throw new Error('FlowBook is not running');
        await local(String(link.business_id), JSON.parse(body));
      } else {
        await send(`${link.base_url.replace(/\/+$/, '')}/v1/integrations/flowxp/events`, body, signature(secret, body, now()));
      }
      await db.query(`UPDATE flowbook_outbox SET status = 'SENT', sent_at = CURRENT_TIMESTAMP, attempts = attempts + 1, last_error = NULL WHERE outbox_id = $1`, [row.outbox_id]);
      await db.query(`UPDATE flowbook_links SET last_ok_at = CURRENT_TIMESTAMP, last_error = NULL WHERE business_id = $1`, [link.business_id]);
      sent++;
    } catch (error) {
      const attempts = row.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      const wait = Math.min(6 * 3600, 2 ** attempts);   // 2 s doubling to 6 h
      await db.query(
        `UPDATE flowbook_outbox SET attempts = $2, status = $3, last_error = $4, next_attempt_at = CURRENT_TIMESTAMP + ($5 || ' seconds')::interval WHERE outbox_id = $1`,
        [row.outbox_id, attempts, dead ? 'DEAD' : 'PENDING', String(error.message).slice(0, 300), String(wait)]);
      await db.query(`UPDATE flowbook_links SET last_error = $2 WHERE business_id = $1`, [link.business_id, String(error.message).slice(0, 300)]);
      failed++;
      if (!dead) break;      // keep order: wait and retry this row before any later one
    }
  }
  return { sent, failed };
};

/** One POST. Any answer other than 2xx is a failure; a 401 is told apart so the owner knows to check the secret. */
export const defaultSend = async (url, body, sig) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-flowxp-signature': sig }, body, signal: controller.signal });
    if (!res.ok) throw new Error(res.status === 401 ? 'FlowBook did not accept the signature: check the secret and the business id' : `FlowBook answered ${res.status}`);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('FlowBook did not answer in time');
    if (error.message === 'fetch failed') throw new Error(`Could not reach FlowBook at that address${error.cause?.code ? ` (${error.cause.code})` : ''}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
};

export const scanFlowbook = async () => {
  const links = (await pool.query(`SELECT * FROM flowbook_links WHERE enabled AND enabled_from IS NOT NULL`)).rows;
  for (const link of links) {
    try { await discover(link); await deliver(link); } catch (error) { console.error(`[flowbook] business ${link.business_id}: ${error.message}`); }
  }
};
registerScan(scanFlowbook);
