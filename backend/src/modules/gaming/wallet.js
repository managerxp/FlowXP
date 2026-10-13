/*
 * The prepaid wallet. A player pays money in (a top-up, with a bonus if the lounge runs one) and later pays a bill from the balance.
 *
 * THE BALANCE IS THE LEDGER. Nothing stores a balance: it is the sum of the player's rows in gaming_wallet_ledger, so it cannot drift from what was
 * posted. Every movement takes a lock on the customer first, so two bills (or a bill and a top-up) cannot both read the same balance. A spend that
 * would take it below zero is refused. (business, source_type, source_ref) is unique, so a top-up sent twice, or a bill whose payment is posted
 * twice, moves the balance once.
 *
 * MONEY IN is a payment row with no invoice (an advance), so cash and UPI reports count it on the day it came in. The GST is on the bill the balance
 * later pays, not on the top-up: the balance is not yet a sale.
 *
 * A bill is paid from the wallet by an ordinary payment of method WALLET (billing.js calls `spend` when it takes one for a lounge); a refund by
 * credit note to the wallet puts the money back (`refundToWallet`).
 */
import { GamingError, localDate, money, oneOf, text, withRupees } from './common.js';
import { balanceOf } from './players.js';

export { balanceOf };

const TOPUP_METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'];
const MAX_TOPUP_PAISE = 50000000;    // Rs 5,00,000 in one go

const inr = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Serialise everything that moves one player's balance. */
const lockCustomer = async (db, businessId, customerId) => {
  const c = (await db.query(`SELECT customer_id, name FROM customers WHERE customer_id = $1 AND business_id = $2 FOR UPDATE`, [customerId, businessId])).rows[0];
  if (!c) throw new GamingError(404, 'Not found');
  return c;
};

const post = (db, { businessId, customerId, kind, amountPaise, sourceType = null, sourceRef = null, invoiceId = null, paymentId = null, note = null, userId = null }) =>
  db.query(
    `INSERT INTO gaming_wallet_ledger (business_id, customer_id, kind, amount_paise, source_type, source_ref, invoice_id, payment_id, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING entry_id`,
    [businessId, customerId, kind, amountPaise, sourceType, sourceRef, invoiceId, paymentId, note, userId]);

/** The bonus a top-up of this size earns under the lounge's rules: the highest rule it reaches. */
export const bonusFor = (rules, amountPaise) => {
  let best = 0;
  let reached = -1;
  for (const r of rules || []) {
    const min = Math.round(Number(r.min) * 100); const bonus = Math.round(Number(r.bonus) * 100);
    if (amountPaise >= min && min > reached) { reached = min; best = bonus; }
  }
  return best;
};

/** The rules a person typed ([{ min, bonus }] in rupees), cleaned. */
export const cleanBonusRules = (rules) => {
  if (rules == null) return [];
  if (!Array.isArray(rules) || rules.length > 8) throw new GamingError(400, 'Top-up bonuses: up to 8 rules');
  const seen = new Set();
  return rules.map((r) => {
    const min = Number(r.min); const bonus = Number(r.bonus);
    if (!Number.isFinite(min) || min < 1 || min > 500000) throw new GamingError(400, 'A bonus applies from a top-up of at least ₹1');
    if (!Number.isFinite(bonus) || bonus <= 0 || bonus > 500000) throw new GamingError(400, 'A bonus is an amount above zero');
    if (seen.has(min)) throw new GamingError(400, `There are two bonuses for ₹${min}`);
    seen.add(min);
    return { min, bonus };
  }).sort((a, b) => a.min - b.min);
};

/**
 * Money in. `request_id` (a UUID the screen makes for this action) makes a repeat harmless: the second call returns the first top-up.
 * Returns { balance_paise, topup_paise, bonus_paise, payment_id }.
 */
export const topUp = async (db, tenant, userId, customerId, b, { settings }) => {
  const method = oneOf(b.method ?? 'CASH', 'Method', TOPUP_METHODS, { required: true });
  const amountPaise = money(b.amount, 'Amount', { min: 100, required: true });
  if (amountPaise > MAX_TOPUP_PAISE) throw new GamingError(400, 'A single top-up can be at most ₹5,00,000');
  const reference = text(b.reference_number, 'Reference', { max: 80 });
  const requestId = b.request_id ? String(b.request_id).slice(0, 64) : null;
  await lockCustomer(db, tenant.businessId, customerId);

  if (requestId) {
    const seen = (await db.query(`SELECT entry_id, payment_id FROM gaming_wallet_ledger WHERE business_id = $1 AND source_type = 'TOPUP' AND source_ref = $2`, [tenant.businessId, requestId])).rows[0];
    if (seen) return { repeated: true, payment_id: seen.payment_id, balance_paise: await balanceOf(db, tenant.businessId, customerId) };
  }
  const bonusPaise = b.no_bonus === true ? 0 : bonusFor(settings.topup_bonus, amountPaise);
  const today = await localDate(db, tenant.businessId);
  const payment = (await db.query(
    `INSERT INTO payments (business_id, branch_id, customer_id, payment_method, amount_paise, reference_number, payment_date, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING payment_id`,
    [tenant.businessId, tenant.branchId, customerId, method, amountPaise, reference, today, 'Gaming wallet top-up', userId])).rows[0];
  await post(db, { businessId: tenant.businessId, customerId, kind: 'TOPUP', amountPaise, sourceType: 'TOPUP', sourceRef: requestId ?? `payment:${payment.payment_id}`, paymentId: payment.payment_id, userId });
  if (bonusPaise > 0) await post(db, { businessId: tenant.businessId, customerId, kind: 'BONUS', amountPaise: bonusPaise, sourceType: 'BONUS', sourceRef: `payment:${payment.payment_id}`, paymentId: payment.payment_id, note: 'Top-up bonus', userId });
  return { payment_id: payment.payment_id, topup_paise: amountPaise, bonus_paise: bonusPaise, balance_paise: await balanceOf(db, tenant.businessId, customerId) };
};

/**
 * Pay (part of) a bill from the wallet: called by billing when a payment of method WALLET is taken for a lounge. Refuses when the balance is short.
 * The ledger's unique source makes posting the same payment twice a no-op.
 */
export const spend = async (db, { businessId, customerId, amountPaise, invoiceId, paymentId, userId }) => {
  if (!customerId) throw new GamingError(400, 'Choose the player whose wallet pays this bill');
  await lockCustomer(db, businessId, customerId);
  const have = await balanceOf(db, businessId, customerId);
  if (have < amountPaise) throw new GamingError(400, `The wallet has ${inr(have)}, which is less than the ${inr(amountPaise)} being paid from it`, { code: 'WALLET_SHORT' });
  await db.query(
    `INSERT INTO gaming_wallet_ledger (business_id, customer_id, kind, amount_paise, source_type, source_ref, invoice_id, payment_id, created_by) VALUES ($1,$2,'SPEND',$3,'PAYMENT',$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
    [businessId, customerId, -amountPaise, String(paymentId), invoiceId, paymentId, userId]);
};

/** A refund by credit note back to the wallet. One credit note puts its money back once. */
export const refundToWallet = async (db, { businessId, customerId, amountPaise, invoiceId, creditNoteId, userId }) => {
  if (!customerId) throw new GamingError(400, 'This bill has no player, so there is no wallet to refund to');
  await lockCustomer(db, businessId, customerId);
  await db.query(
    `INSERT INTO gaming_wallet_ledger (business_id, customer_id, kind, amount_paise, source_type, source_ref, invoice_id, note, created_by) VALUES ($1,$2,'REFUND',$3,'CREDIT_NOTE',$4,$5,'Refund to the wallet',$6) ON CONFLICT DO NOTHING`,
    [businessId, customerId, amountPaise, String(creditNoteId), invoiceId, userId]);
};

/**
 * A cancelled bill gives back what was paid from the wallet. (Cash and UPI already collected are a refund for a person to decide, as everywhere in FlowXP;
 * the wallet is money the lounge holds, so it is returned straight away.) Once per invoice.
 */
export const returnWalletForCancelled = async (db, { businessId, invoiceId, userId }) => {
  const r = (await db.query(`SELECT customer_id, COALESCE(SUM(amount_paise), 0) AS paid FROM payments WHERE business_id = $1 AND invoice_id = $2 AND payment_method = 'WALLET' GROUP BY customer_id`, [businessId, invoiceId])).rows[0];
  if (!r || Number(r.paid) <= 0 || !r.customer_id) return 0;
  await lockCustomer(db, businessId, r.customer_id);
  await db.query(
    `INSERT INTO gaming_wallet_ledger (business_id, customer_id, kind, amount_paise, source_type, source_ref, invoice_id, note, created_by) VALUES ($1,$2,'REFUND',$3,'CANCEL',$4,$5,'Bill cancelled: back to the wallet',$6) ON CONFLICT DO NOTHING`,
    [businessId, r.customer_id, Number(r.paid), String(invoiceId), invoiceId, userId]);
  return Number(r.paid);
};

/** A correction by a manager: positive adds, negative takes away (never below zero). A reason is required and kept. */
export const adjust = async (db, tenant, userId, customerId, b) => {
  const reason = text(b.reason, 'The reason', { max: 200, required: true });
  const amountPaise = money(b.amount, 'Amount', { min: -MAX_TOPUP_PAISE, required: true });
  if (amountPaise === 0) throw new GamingError(400, 'The amount to add or take off cannot be zero');
  await lockCustomer(db, tenant.businessId, customerId);
  const have = await balanceOf(db, tenant.businessId, customerId);
  if (have + amountPaise < 0) throw new GamingError(400, `That would take the wallet below zero (it has ${inr(have)})`);
  await post(db, { businessId: tenant.businessId, customerId, kind: 'ADJUST', amountPaise, note: reason, userId });
  return { balance_paise: await balanceOf(db, tenant.businessId, customerId) };
};

export const ledger = async (db, tenant, customerId, { limit = 25, offset = 0 } = {}) => {
  const where = 'w.business_id = $1 AND w.customer_id = $2';
  const total = Number((await db.query(`SELECT COUNT(*) AS n FROM gaming_wallet_ledger w WHERE ${where}`, [tenant.businessId, customerId])).rows[0].n);
  const rows = (await db.query(
    `SELECT w.entry_id, w.kind, w.amount_paise, w.note, w.created_at, w.invoice_id, i.invoice_number, u.name AS by
     FROM gaming_wallet_ledger w LEFT JOIN invoices i ON i.invoice_id = w.invoice_id LEFT JOIN users u ON u.user_id = w.created_by
     WHERE ${where} ORDER BY w.created_at DESC, w.entry_id DESC LIMIT $3 OFFSET $4`, [tenant.businessId, customerId, limit, offset])).rows;
  return { rows: withRupees(rows.map((r) => ({ ...r, amount_paise: Number(r.amount_paise) }))), total, balance_paise: await balanceOf(db, tenant.businessId, customerId) };
};

/** What the lounge owes its players in unspent prepaid money. */
export const liability = async (db, businessId) => {
  const r = (await db.query(
    `SELECT COALESCE(SUM(b), 0) AS total, COUNT(*) FILTER (WHERE b > 0) AS players FROM (SELECT customer_id, SUM(amount_paise) AS b FROM gaming_wallet_ledger WHERE business_id = $1 GROUP BY customer_id HAVING SUM(amount_paise) > 0) t`, [businessId])).rows[0];
  const month = (await db.query(
    `SELECT COALESCE(SUM(amount_paise) FILTER (WHERE kind = 'TOPUP'), 0) AS topups, COALESCE(SUM(amount_paise) FILTER (WHERE kind = 'BONUS'), 0) AS bonus, COALESCE(-SUM(amount_paise) FILTER (WHERE kind = 'SPEND'), 0) AS spent
     FROM gaming_wallet_ledger WHERE business_id = $1 AND created_at >= date_trunc('month', now())`, [businessId])).rows[0];
  return withRupees({ owed_paise: Number(r.total), players: Number(r.players), month_topups_paise: Number(month.topups), month_bonus_paise: Number(month.bonus), month_spent_paise: Number(month.spent) });
};
