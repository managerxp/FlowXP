/*
 * "Scan the bill, get your stamp". The receipt carries a QR; the customer scans it after paying, types their name and mobile number once, and the stamp or points for
 * THAT bill land on their card (joining them if they are new). No staff step and no asking for numbers at the till.
 *
 * Why it cannot be gamed: the code is the bill's own secret link, so it is one real, paid bill; the bill earns through the same engine call as a till sale
 * (earn keyed by programme + invoice), so a bill can credit only once however many times it is scanned; it stops working after WINDOW_HOURS; and a bill that
 * already has a customer was credited at the till, so it is not offered again. A cancelled bill never qualifies.
 */
import crypto from 'node:crypto';
import config from '../config/env.js';
import * as engine from './loyaltyEngine.js';

export const WINDOW_HOURS = 24;
const BILL = `i.invoice_id, i.business_id, i.branch_id, i.customer_id, i.invoice_number, i.status, i.total_paise, i.balance_due_paise, i.created_at, i.share_token`;
const programmesOf = async (db, businessId) => (await db.query(`SELECT * FROM loyalty_programmes WHERE business_id = $1 AND is_active AND settings->>'bill_qr' = 'true' ORDER BY programme_id`, [businessId])).rows;

/** The programmes this bill could credit right now (open, offered at its outlet, and the bill is big enough to earn). */
const offers = async (db, inv) => {
  const out = [];
  for (const p of await programmesOf(db, inv.business_id)) {
    try { engine.programmeOpen(p, { branchId: inv.branch_id }); } catch { continue; }
    const gives = engine.pointsFor(p, inv.total_paise);
    if (gives > 0) out.push({ programme: p, gives });
  }
  return out;
};

/** Why this bill cannot be claimed, or null when it can. */
const reason = async (db, inv) => {
  if (inv.status === 'CANCELLED') return 'CANCELLED';
  if (inv.status !== 'ISSUED' || Number(inv.balance_due_paise) > 0) return 'UNPAID';
  if (inv.customer_id) return 'AT_TILL';                                                       // already credited when it was billed
  if (Date.now() - new Date(inv.created_at).getTime() > WINDOW_HOURS * 3600000) return 'TOO_OLD';
  const done = (await db.query(`SELECT 1 FROM points_ledger WHERE invoice_id = $1 AND kind = 'EARN' LIMIT 1`, [inv.invoice_id])).rows.length > 0;
  return done ? 'CLAIMED' : null;
};

/** For the receipt: the address to print as a QR, or null when this bill is not offered one. Creates the bill's secret link the first time. */
export const linkFor = async (db, invoiceId, businessId) => {
  const inv = (await db.query(`SELECT ${BILL} FROM invoices i WHERE i.invoice_id = $1 AND i.business_id = $2`, [invoiceId, businessId])).rows[0];
  if (!inv || inv.customer_id || inv.status === 'CANCELLED' || !(await offers(db, inv)).length) return null;
  const token = inv.share_token || (await db.query(`UPDATE invoices SET share_token = COALESCE(share_token, $2) WHERE invoice_id = $1 RETURNING share_token`, [invoiceId, crypto.randomBytes(16).toString('hex')])).rows[0].share_token;
  return `${config.appOrigin.replace(/\/$/, '')}/card/bill/${token}`;
};

const byToken = async (db, token, { lock = false } = {}) => {
  const t = String(token || '');
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(t)) throw new engine.LoyaltyError('This bill link is not valid', 404);
  const inv = (await db.query(`SELECT ${BILL}, b.name AS business_name, b.status AS business_status FROM invoices i JOIN businesses b ON b.business_id = i.business_id WHERE i.share_token = $1 ${lock ? 'FOR UPDATE OF i' : ''}`, [t])).rows[0];
  if (!inv || !['ACTIVE', 'TRIAL'].includes(inv.business_status)) throw new engine.LoyaltyError('This bill link is not valid', 404);
  return inv;
};

/** What the page shows before the customer types anything. `state` is OPEN, or why not (the page words it). */
export const info = async (db, token) => {
  const inv = await byToken(db, token);
  const why = await reason(db, inv);
  const list = why ? [] : await offers(db, inv);
  return {
    state: why || (list.length ? 'OPEN' : 'OFF'), business: inv.business_name, bill: inv.invoice_number,
    cards: list.map(({ programme: p, gives }) => ({ name: p.name, kind: p.kind, gives, card: engine.cardFields(p.card) }))
  };
};

const WHY = { CANCELLED: 'This bill was cancelled', UNPAID: 'This bill is not paid yet', AT_TILL: 'This bill is already on a loyalty card', TOO_OLD: 'This bill is too old to add a stamp', CLAIMED: 'This bill has already been added to a card' };

/** Credits the bill to the customer with this mobile number (new customers and new members are made). Runs inside the caller's transaction. */
export const claim = async (db, token, { name, phone, consent = false }) => {
  const inv = await byToken(db, token, { lock: true });   // the bill row is locked: two scans at once credit once
  const why = await reason(db, inv);
  if (why) throw new engine.LoyaltyError(WHY[why], 409);
  const list = await offers(db, inv);
  if (!list.length) throw new engine.LoyaltyError('This bill does not earn anything', 409);
  const found = (await db.query(`SELECT customer_id FROM customers WHERE business_id = $1 AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $2 ORDER BY customer_id LIMIT 1`, [inv.business_id, phone])).rows[0];
  const customerId = found ? found.customer_id : (await db.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [inv.business_id, name, phone])).rows[0].customer_id;
  const added = []; let cardToken = null; let number = null;
  for (const { programme: p } of list) {
    const { membership: m, created } = await engine.enrol(db, { businessId: inv.business_id, programmeId: p.programme_id, customerId, consentMarketing: consent });
    const r = await engine.earn(db, { businessId: inv.business_id, membershipId: m.membership_id, amountPaise: inv.total_paise, branchId: inv.branch_id, invoiceId: inv.invoice_id });
    added.push({ name: p.name, kind: p.kind, gives: r.points, new_member: created });
    if (created && !cardToken) { cardToken = m.token; number = m.membership_no; }   // the card link goes only to a member made just now; an existing member already has theirs, and a number alone never reveals a card
  }
  return { added, token: cardToken, membership_no: number };
};
