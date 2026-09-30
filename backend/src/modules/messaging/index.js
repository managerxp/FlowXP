/*
 * Customer messages: the settings, the outbox and the events that send them.
 *
 * send() is the only way a message leaves: it checks the business has messaging on, that the number is
 * real and that a promotional message isn't going to someone who opted out, records the message, hands
 * it to the provider and stores the outcome. The hooks at the bottom (after a bill, a booking, a waitlist
 * call) never throw: a message problem must never fail a sale or a booking.
 */
import crypto from 'node:crypto';
import pool from '../../config/database.js';
import config from '../../config/env.js';
import { describe, getProgram, isLive, normalisePhone, progressFor } from '../loyalty.js';
import { businessToday } from '../../utils/dates.js';
import { toRupees } from '../../utils/money.js';
import { deliver } from './provider.js';
import { TEMPLATES, render } from './templates.js';

export const DEFAULT_SETTINGS = { channel: 'OFF', bill_auto: true, reservation_updates: true, waitlist_updates: true, loyalty_nudge: true };
const BOOLEANS = ['bill_auto', 'reservation_updates', 'waitlist_updates', 'loyalty_nudge'];
export const CAMPAIGN_LIMIT = 1000;

export const getSettings = async (db, businessId) => {
  const row = (await db.query(`SELECT messaging_settings FROM businesses WHERE business_id = $1`, [businessId])).rows[0];
  return { ...DEFAULT_SETTINGS, ...(row?.messaging_settings || {}) };
};

/** Validate a settings update; returns { settings } or { error }. */
export const cleanSettings = (input, current) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Send the settings to change' };
  const next = { ...current };
  if ('channel' in input) {
    if (!['OFF', 'WHATSAPP', 'SMS'].includes(input.channel)) return { error: 'Channel must be WhatsApp, SMS or off' };
    next.channel = input.channel;
  }
  for (const key of BOOLEANS) if (key in input) next[key] = input[key] === true;
  return { settings: next };
};

const money = (paise) => `₹${toRupees(paise).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const whenText = (date, tz) => new Date(date).toLocaleString('en-IN', { timeZone: tz || 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/**
 * Send (and record) one message. Resolves to the stored row, or { skipped: 'OFF' | 'NO_PHONE' | 'OPTED_OUT' }
 * when nothing was recorded. Provider trouble is stored on the row (FAILED), not thrown.
 */
export const send = async (db, { businessId, branchId = null, customerId = null, phone, kind, values, channel = null, related = null, batch = null, createdBy = null }) => {
  const settings = await getSettings(db, businessId);
  const useChannel = channel || settings.channel;
  if (useChannel === 'OFF') return { skipped: 'OFF' };
  const to = normalisePhone(phone);
  if (!to) return { skipped: 'NO_PHONE' };

  const message = render(kind, values);
  if (message.promo && customerId) {
    const c = (await db.query(`SELECT marketing_opt_out FROM customers WHERE customer_id = $1 AND business_id = $2`, [customerId, businessId])).rows[0];
    if (c?.marketing_opt_out) return { skipped: 'OPTED_OUT' };
  }

  const row = (await db.query(
    `INSERT INTO messages (business_id, branch_id, customer_id, phone, channel, kind, body, params, related_type, related_id, batch, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [businessId, branchId, customerId, to, useChannel, kind, message.text, JSON.stringify(message.template.params), related?.type ?? null, related?.id ?? null, batch, createdBy]
  )).rows[0];
  return attempt(db, row, message.template);
};

/** Hand a stored message to the provider and record what happened. */
const attempt = async (db, row, template) => {
  let outcome;
  try {
    const r = await deliver({ channel: row.channel, to: row.phone, kind: row.kind, text: row.body, template });
    outcome = { status: r.status, providerId: r.providerId ?? null, error: r.status === 'SKIPPED' ? r.note ?? null : null };
  } catch (error) {
    outcome = { status: 'FAILED', providerId: null, error: String(error.message).slice(0, 300) };
  }
  return (await db.query(
    `UPDATE messages SET status = $1::varchar, provider_id = $2, error = $3, sent_at = CASE WHEN $1::varchar = 'SENT' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE message_id = $4 RETURNING *`,
    [outcome.status, outcome.providerId, outcome.error, row.message_id]
  )).rows[0];
};

/** Try a FAILED or SKIPPED message again (after fixing the provider setup or the number). */
export const resend = async (db, businessId, messageId) => {
  const row = (await db.query(`SELECT * FROM messages WHERE message_id = $1 AND business_id = $2`, [messageId, businessId])).rows[0];
  if (!row) return { problem: 'Not found', code: 404 };
  if (!['FAILED', 'SKIPPED'].includes(row.status)) return { problem: 'That message was already sent', code: 409 };
  return { message: await attempt(db, row, { name: TEMPLATES[row.kind]?.name, params: row.params }) };
};

/* ── the bill ─────────────────────────────────────────────────────────── */

/** The link a customer opens to see their bill; created on first use. */
export const shareLink = async (db, invoiceId) => {
  const token = crypto.randomBytes(16).toString('hex');
  const row = (await db.query(`UPDATE invoices SET share_token = COALESCE(share_token, $2) WHERE invoice_id = $1 RETURNING share_token`, [invoiceId, token])).rows[0];
  return `${config.appOrigin}/bill/${row.share_token}`;
};

/** Send an invoice to `phone` (default: its customer's). `scope` is a branch filter for the caller's outlet. */
export const sendBill = async (db, { businessId, invoiceId, phone = null, createdBy = null }) => {
  const inv = (await db.query(
    `SELECT i.invoice_id, i.invoice_number, i.total_paise, i.branch_id, i.customer_id, c.name AS customer_name, c.phone AS customer_phone,
            b.name AS business_name
     FROM invoices i JOIN businesses b ON b.business_id = i.business_id LEFT JOIN customers c ON c.customer_id = i.customer_id
     WHERE i.invoice_id = $1 AND i.business_id = $2 AND i.status = 'ISSUED'`, [invoiceId, businessId])).rows[0];
  if (!inv) return { problem: 'Invoice not found', code: 404 };
  const to = phone || inv.customer_phone;
  if (!normalisePhone(to)) return { problem: 'This bill has no customer mobile number to send to', code: 400 };
  const link = await shareLink(db, inv.invoice_id);
  return send(db, {
    businessId, branchId: inv.branch_id, customerId: inv.customer_id, phone: to, kind: 'BILL', createdBy,
    values: { name: inv.customer_name || 'there', business: inv.business_name, number: inv.invoice_number, total: money(inv.total_paise), link },
    related: { type: 'invoice', id: inv.invoice_id }
  });
};

/* ── campaigns ────────────────────────────────────────────────────────── */

export const SEGMENTS = {
  ALL: 'Every customer with a mobile number',
  LAPSED: 'Customers who have not visited in a while',
  NEAR_REWARD: 'Customers one visit from a free reward'
};

/** Who a campaign would reach: active customers with a valid mobile who haven't opted out. */
export const audience = async (db, businessId, { segment, days = 30 }) => {
  if (!SEGMENTS[segment]) return { error: 'Choose who to send to' };
  const base = `SELECT c.customer_id, c.name, c.phone FROM customers c
    WHERE c.business_id = $1 AND c.status = 'ACTIVE' AND NOT c.marketing_opt_out
      AND LENGTH(regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g')) >= 10`;
  let sql; let params = [businessId];
  if (segment === 'ALL') sql = base;
  else if (segment === 'LAPSED') {
    const n = Math.max(7, Math.min(365, Number(days) || 30));
    const today = await businessToday(businessId, db);
    sql = `${base} AND EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.customer_id AND i.status = 'ISSUED')
           AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.customer_id = c.customer_id AND i.status = 'ISSUED' AND i.invoice_date > ($2::date - $3::int))`;
    params = [businessId, today, n];
  } else {
    const program = await getProgram(db, businessId);
    if (!isLive(program)) return { error: 'Switch the loyalty program on first' };
    sql = `${base} AND (SELECT COUNT(*) FROM loyalty_events e WHERE e.customer_id = c.customer_id AND e.kind = 'VISIT' AND e.voided_at IS NULL
                          AND e.event_id > COALESCE((SELECT MAX(r.event_id) FROM loyalty_events r WHERE r.customer_id = c.customer_id AND r.kind = 'REDEEM' AND r.voided_at IS NULL), 0)) >= $2`;
    params = [businessId, program.visits_required - 2];
  }
  return { customers: (await db.query(`${sql} ORDER BY c.customer_id LIMIT ${CAMPAIGN_LIMIT + 1}`, params)).rows };
};

/**
 * Send an offer to an audience. Returns straight away with the batch id and the recipient count; `done`
 * resolves when every message has been attempted (the controller doesn't wait for it).
 */
export const startCampaign = async (db, { businessId, customers, text, createdBy }) => {
  const business = (await db.query(`SELECT name FROM businesses WHERE business_id = $1`, [businessId])).rows[0];
  const batch = `c${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
  const list = customers.slice(0, CAMPAIGN_LIMIT);
  const done = (async () => {
    for (const c of list) {
      await send(db, { businessId, customerId: c.customer_id, phone: c.phone, kind: 'OFFER', batch, createdBy, values: { name: c.name || 'there', business: business.name, offer: text } })
        .catch((error) => console.error('[messaging] campaign message failed:', error.message));
    }
  })();
  return { batch, recipients: list.length, done };
};

/* ── hooks: never throw ───────────────────────────────────────────────── */

const quiet = (label, work) => Promise.resolve().then(work).catch((error) => console.error(`[messaging] ${label} failed:`, error.message));

/** After a bill: send it to the customer, and nudge them when their next visit earns the reward. */
export const afterBill = (businessId, invoiceId) => quiet('bill message', async () => {
  const settings = await getSettings(pool, businessId);
  if (settings.channel === 'OFF') return;
  const inv = (await pool.query(`SELECT customer_id, invoice_date::text AS d FROM invoices WHERE invoice_id = $1`, [invoiceId])).rows[0];
  if (!inv?.customer_id) return;
  const customer = (await pool.query(`SELECT name, phone FROM customers WHERE customer_id = $1`, [inv.customer_id])).rows[0];
  if (!normalisePhone(customer?.phone)) return;

  if (settings.bill_auto) await sendBill(pool, { businessId, invoiceId });

  if (settings.loyalty_nudge) {
    const program = await getProgram(pool, businessId);
    if (!isLive(program)) return;
    const progress = await progressFor(pool, businessId, inv.customer_id, program, inv.d);
    const card = describe(program, progress);
    if (card.visits_to_go !== 0 || progress.reward_ready || progress.day_event === 'REDEEM') return;
    const recent = (await pool.query(`SELECT 1 FROM messages WHERE customer_id = $1 AND kind = 'LOYALTY_NEXT' AND created_at > CURRENT_TIMESTAMP - INTERVAL '7 days' LIMIT 1`, [inv.customer_id])).rows.length;
    if (recent) return;
    const business = (await pool.query(`SELECT name FROM businesses WHERE business_id = $1`, [businessId])).rows[0];
    await send(pool, { businessId, customerId: inv.customer_id, phone: customer.phone, kind: 'LOYALTY_NEXT', values: { name: customer.name || 'there', business: business.name, reward: card.reward_item } });
  }
});

const guestContext = async (businessId, branchId) => {
  const row = (await pool.query(
    `SELECT b.name AS business, b.timezone, br.name AS outlet FROM businesses b LEFT JOIN branches br ON br.branch_id = $2 WHERE b.business_id = $1`, [businessId, branchId])).rows[0];
  // "MG Road" is more useful to a guest than the company name when there are several outlets
  return { name: row.outlet && row.outlet !== 'Main' ? `${row.business} (${row.outlet})` : row.business, timezone: row.timezone };
};

/** A booking was made ('created') or cancelled: tell the guest. */
export const afterReservation = (r, event) => quiet('reservation message', async () => {
  const settings = await getSettings(pool, r.business_id);
  if (settings.channel === 'OFF' || !settings.reservation_updates || !r.phone) return;
  const g = await guestContext(r.business_id, r.branch_id);
  const base = { businessId: r.business_id, branchId: r.branch_id, customerId: r.customer_id, phone: r.phone, related: { type: 'reservation', id: r.reservation_id } };
  if (event === 'created') await send(pool, { ...base, kind: 'RESERVATION', values: { name: r.guest_name, business: g.name, when: whenText(r.reserved_at, g.timezone), party: r.party_size } });
  else if (event === 'cancelled') await send(pool, { ...base, kind: 'RESERVATION_CANCELLED', values: { name: r.guest_name, business: g.name, when: whenText(r.reserved_at, g.timezone) } });
});

/** Someone joined the waitlist ('added') or their table is ready ('ready'). */
export const afterWaitlist = (w, event) => quiet('waitlist message', async () => {
  const settings = await getSettings(pool, w.business_id);
  if (settings.channel === 'OFF' || !settings.waitlist_updates || !w.phone) return;
  const g = await guestContext(w.business_id, w.branch_id);
  const base = { businessId: w.business_id, branchId: w.branch_id, customerId: w.customer_id, phone: w.phone, related: { type: 'waitlist', id: w.entry_id } };
  if (event === 'added') await send(pool, { ...base, kind: 'WAITLIST_ADDED', values: { name: w.guest_name, business: g.name, minutes: w.quoted_wait_min ?? 10 } });
  else if (event === 'ready') await send(pool, { ...base, kind: 'WAITLIST_READY', values: { name: w.guest_name, business: g.name } });
});
