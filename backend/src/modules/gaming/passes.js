/*
 * Prepaid hour packs. A player buys a pack ("10 hours for ₹800, good for 90 days, on consoles") and sessions are then played against it.
 *
 * MONEY stays in the invoice engine: selling a pack is an ordinary GST invoice with one line, paid on the spot, plus one gaming_passes row in the same
 * transaction. The pack does not store how many minutes are left: that is what was bought minus the usage rows that have not been voided, so a stop that is
 * taken back (reopened) gives its minutes back by voiding its row.
 *
 * A pack is usable while it is active, not past its expiry day, and its invoice has not been cancelled or credited in full. A session started against
 * a pack may use at most what is left when it STOPS (read under a lock on the pack), so two sessions can never spend the same minutes.
 */
import { createInvoiceInTransaction } from '../billing.js';
import { GamingError, getSettings, localDate, text, withRupees } from './common.js';
import { getBundle } from './rates.js';
import { toRupees } from '../../utils/money.js';

const minutesUsed = async (db, passId) =>
  Number((await db.query(`SELECT COALESCE(SUM(minutes), 0) AS n FROM gaming_pass_usage WHERE pass_id = $1 AND voided_at IS NULL`, [passId])).rows[0].n);

/** One pack as a screen sees it: minutes left and whether it can be used today. */
const view = async (db, businessId, p, today) => {
  const used = await minutesUsed(db, p.pass_id);
  const inv = p.invoice_id ? (await db.query(`SELECT status, total_paise, credited_paise FROM invoices WHERE invoice_id = $1`, [p.invoice_id])).rows[0] : null;
  const voided = inv && (inv.status === 'CANCELLED' || Number(inv.credited_paise) >= Number(inv.total_paise));
  const expired = p.expires_on && String(p.expires_on).slice(0, 10) < today;
  const left = Math.max(0, p.minutes_total - used);
  let state = 'ACTIVE';
  if (p.status === 'CANCELLED' || voided) state = 'CANCELLED';
  else if (expired) state = 'EXPIRED';
  else if (left <= 0) state = 'USED';
  return withRupees({
    pass_id: p.pass_id, customer_id: p.customer_id, name: p.name, minutes_total: p.minutes_total, minutes_used: used, minutes_left: left, kinds: p.kinds,
    expires_on: p.expires_on ? String(p.expires_on).slice(0, 10) : null, state, usable: state === 'ACTIVE', invoice_id: p.invoice_id, created_at: p.created_at
  });
};

export const listPasses = async (db, tenant, customerId) => {
  const today = await localDate(db, tenant.businessId);
  const rows = (await db.query(`SELECT * FROM gaming_passes WHERE business_id = $1 AND customer_id = $2 ORDER BY created_at DESC, pass_id DESC`, [tenant.businessId, customerId])).rows;
  const out = [];
  for (const p of rows) out.push(await view(db, tenant.businessId, p, today));
  return out;
};

export const getPass = async (db, tenant, passId, { lock = false } = {}) => {
  const p = (await db.query(`SELECT * FROM gaming_passes WHERE pass_id = $1 AND business_id = $2${lock ? ' FOR UPDATE' : ''}`, [passId, tenant.businessId])).rows[0];
  if (!p) throw new GamingError(404, 'Not found');
  return p;
};

export const passView = async (db, tenant, passId) => view(db, tenant.businessId, await getPass(db, tenant, passId), await localDate(db, tenant.businessId));

/** Sell a pack to a player: an invoice and the pack, together. The pack must be paid for on the spot. */
export const sellPass = async (db, tenant, userId, customerId, b) => {
  const bundle = await getBundle(db, tenant.businessId, Number(b.bundle_id), { kind: 'PACK' });
  const customer = (await db.query(`SELECT customer_id, name FROM customers WHERE customer_id = $1 AND business_id = $2`, [customerId, tenant.businessId])).rows[0];
  if (!customer) throw new GamingError(404, 'Not found');
  if (!b.payment && !b.payments) throw new GamingError(400, 'Take the payment for the pack: it is sold paid');
  const settings = await getSettings(db, tenant.businessId);
  const today = await localDate(db, tenant.businessId);
  const expires = bundle.valid_days ? new Date(Date.parse(`${today}T00:00:00Z`) + bundle.valid_days * 86400000).toISOString().slice(0, 10) : null;
  const invoice = await createInvoiceInTransaction(db, tenant, userId, {
    customerId,
    items: [{ description: `${bundle.name} (${bundle.minutes / 60} hours${expires ? `, until ${expires}` : ''})`, quantity: 1, unit_price: toRupees(Number(bundle.price_paise)), tax_rate: bundle.tax_rate == null ? Number(settings.gst_rate) : Number(bundle.tax_rate) }],
    payment: b.payment, payments: b.payments, notes: text(b.notes, 'Notes', { max: 200 }) || `Gaming hour pack: ${bundle.name}`, invoiceDate: today
  });
  if (Number(invoice.balance_due) > 0) throw new GamingError(400, 'The pack must be paid in full when it is sold');
  const row = (await db.query(
    `INSERT INTO gaming_passes (business_id, customer_id, bundle_id, name, minutes_total, kinds, expires_on, invoice_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [tenant.businessId, customerId, bundle.bundle_id, bundle.name, bundle.minutes, bundle.kinds, expires, invoice.invoice_id, userId])).rows[0];
  return { pass: await view(db, tenant.businessId, row, today), invoice };
};

/** A manager withdraws a pack (a mistake, a chargeback). Money goes back through a credit note on its invoice, as for any bill. */
export const cancelPass = async (db, tenant, passId) => {
  const p = await getPass(db, tenant, passId, { lock: true });
  await db.query(`UPDATE gaming_passes SET status = 'CANCELLED' WHERE pass_id = $1`, [passId]);
  return view(db, tenant.businessId, { ...p, status: 'CANCELLED' }, await localDate(db, tenant.businessId));
};

/**
 * Checks a session may start against this pack, and returns what it may use. Throws a sentence when it cannot.
 * `kind` is the station's kind; `customerId` the player starting the session.
 */
export const checkStart = async (db, tenant, passId, { customerId, kind }) => {
  if (!customerId) throw new GamingError(400, 'Choose the player whose pack this is');
  const p = await getPass(db, tenant, passId, { lock: true });
  if (p.customer_id !== customerId) throw new GamingError(400, 'That pack belongs to someone else');
  const v = await view(db, tenant.businessId, p, await localDate(db, tenant.businessId));
  if (!v.usable) throw new GamingError(409, v.state === 'EXPIRED' ? 'That pack has expired' : v.state === 'USED' ? 'That pack has no time left' : 'That pack is not valid', { code: 'PACK_UNUSABLE' });
  if (p.kinds && !p.kinds.includes(kind)) throw new GamingError(400, 'That pack is not for this kind of station');
  const busy = (await db.query(`SELECT s.session_id, st.name FROM gaming_sessions s JOIN gaming_stations st ON st.station_id = s.station_id WHERE s.pack_id = $1 AND s.status IN ('RUNNING','PAUSED')`, [passId])).rows[0];
  if (busy) throw new GamingError(409, `That pack is already being used on ${busy.name}`, { code: 'PACK_BUSY' });
  return { minutes_left: v.minutes_left };
};

/**
 * At stop: the minutes the pack covers for this session. Read under a lock on the pack, never more than it has left now, and recorded as a usage row.
 */
export const takeMinutes = async (db, tenant, passId, sessionId, wanted) => {
  const p = await getPass(db, tenant, passId, { lock: true });
  const v = await view(db, tenant.businessId, p, await localDate(db, tenant.businessId));
  const covered = Math.max(0, Math.min(wanted, v.state === 'CANCELLED' ? 0 : v.minutes_left));
  if (covered > 0) await db.query(`INSERT INTO gaming_pass_usage (pass_id, session_id, minutes) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [passId, sessionId, covered]);
  return covered;
};

/** A stop taken back gives its minutes back. */
export const giveBack = (db, sessionId) => db.query(`UPDATE gaming_pass_usage SET voided_at = now() WHERE session_id = $1 AND voided_at IS NULL`, [sessionId]);
