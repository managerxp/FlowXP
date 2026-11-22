/*
 * The member wallet: advance money a member leaves with the gym and later spends on their bills.
 *
 * THE BALANCE IS THE LEDGER (gym_wallet_ledger, append-only): a member's balance is the sum of their rows. Every movement first locks the member's row,
 * so two bills cannot spend the same money, and a spend or refund that would take the balance below zero is refused.
 * A deposit is also a payment row with no bill (so the day's cash and UPI totals include it); it is not income until a bill is paid from it.
 * This ledger is separate from what a member owes (their unpaid bills) and from their session packs.
 */
import { GymError, money, oneOf, text, withRupees } from './common.js';
import { onInvoicePaid } from './memberships.js';
import { paymentStatus } from '../billing.js';

const METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'];
const MAX_PAISE = 50000000;   // Rs 5,00,000 in one go
const inr = (p) => `₹${(p / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const lockMember = async (db, businessId, memberId) => {
  const m = (await db.query(`SELECT member_id, customer_id, branch_id, status FROM gym_members WHERE member_id = $1 AND business_id = $2 FOR UPDATE`, [memberId, businessId])).rows[0];
  if (!m) throw new GymError(404, 'Not found');
  return m;
};

export const balanceOf = async (db, businessId, memberId) =>
  Number((await db.query(`SELECT COALESCE(SUM(amount_paise), 0) AS b FROM gym_wallet_ledger WHERE business_id = $1 AND member_id = $2`, [businessId, memberId])).rows[0].b);

const post = (db, businessId, userId, memberId, kind, amountPaise, x = {}) => db.query(
  `INSERT INTO gym_wallet_ledger (business_id, member_id, branch_id, kind, amount_paise, method, reason, invoice_id, payment_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  [businessId, memberId, x.branchId ?? null, kind, amountPaise, x.method ?? null, x.reason ?? null, x.invoiceId ?? null, x.paymentId ?? null, userId]);

/** Money in. Returns { balance_paise }. */
export const deposit = async (db, tenant, userId, memberId, b) => {
  const method = oneOf(b.method ?? 'CASH', 'Method', METHODS, { required: true });
  const amount = money(b.amount, 'Amount', { min: 100, required: true });
  if (amount > MAX_PAISE) throw new GymError(400, 'A single deposit can be at most ₹5,00,000');
  const m = await lockMember(db, tenant.businessId, memberId);
  if (m.status === 'ARCHIVED') throw new GymError(400, 'This member is archived');
  const branchId = tenant.branchId ?? m.branch_id;
  const pay = (await db.query(
    `INSERT INTO payments (business_id, branch_id, customer_id, payment_method, amount_paise, reference_number, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,'Gym wallet deposit',$7) RETURNING payment_id`,
    [tenant.businessId, branchId, m.customer_id, method, amount, text(b.reference_number, 'Reference', { max: 80 }), userId])).rows[0];
  await post(db, tenant.businessId, userId, memberId, 'DEPOSIT', amount, { method, paymentId: pay.payment_id, branchId });
  return withRupees({ balance_paise: await balanceOf(db, tenant.businessId, memberId) });
};

/** Pay a bill (or part of it) from the wallet. `amount` omitted: as much of the bill as the balance covers. */
export const payInvoice = async (db, tenant, userId, memberId, b) => {
  const m = await lockMember(db, tenant.businessId, memberId);
  const inv = (await db.query(`SELECT invoice_id, branch_id, customer_id, total_paise, amount_paid_paise, balance_due_paise, status FROM invoices WHERE invoice_id = $1 AND business_id = $2 FOR UPDATE`, [Number(b.invoice_id) || 0, tenant.businessId])).rows[0];
  if (!inv || inv.customer_id !== m.customer_id) throw new GymError(404, 'That bill is not this member\'s');
  if (inv.status === 'CANCELLED') throw new GymError(400, 'This bill is cancelled');
  const due = Math.max(0, Number(inv.balance_due_paise));
  if (due === 0) throw new GymError(400, 'This bill is already paid');
  const have = await balanceOf(db, tenant.businessId, memberId);
  const amount = b.amount == null || b.amount === '' ? Math.min(due, have) : money(b.amount, 'Amount', { min: 1, required: true });
  if (amount > due) throw new GymError(400, `That is more than the ${inr(due)} still due`);
  if (amount <= 0 || amount > have) throw new GymError(400, `The wallet has ${inr(have)}, which is less than the ${inr(amount)} being paid from it`, { code: 'WALLET_SHORT' });
  const pay = (await db.query(
    `INSERT INTO payments (business_id, branch_id, invoice_id, customer_id, payment_method, amount_paise, notes, created_by) VALUES ($1,$2,$3,$4,'WALLET',$5,'Paid from the gym wallet',$6) RETURNING payment_id`,
    [tenant.businessId, inv.branch_id, inv.invoice_id, inv.customer_id, amount, userId])).rows[0];
  const paid = Number(inv.amount_paid_paise) + amount;
  const left = due - amount;
  await db.query(`UPDATE invoices SET amount_paid_paise = $1, balance_due_paise = $2, payment_status = $3 WHERE invoice_id = $4`,
    [paid, left, left === 0 ? 'PAID' : paymentStatus(Number(inv.total_paise), paid), inv.invoice_id]);
  await post(db, tenant.businessId, userId, memberId, 'SPEND', -amount, { invoiceId: inv.invoice_id, paymentId: pay.payment_id, branchId: inv.branch_id });
  if (left === 0) await onInvoicePaid(db, { businessId: tenant.businessId, invoiceId: inv.invoice_id });
  return withRupees({ balance_paise: have - amount, paid_paise: amount, balance_due_paise: left });
};

/** Hand unspent money back to the member (a manager's act, with a reason). */
export const refund = async (db, tenant, userId, memberId, b) => {
  const method = oneOf(b.method ?? 'CASH', 'Method', METHODS, { required: true });
  const amount = money(b.amount, 'Amount', { min: 1, required: true });
  const reason = text(b.reason, 'The reason', { max: 200, required: true });
  const m = await lockMember(db, tenant.businessId, memberId);
  const have = await balanceOf(db, tenant.businessId, memberId);
  if (amount > have) throw new GymError(400, `The wallet has ${inr(have)}, which is less than the ${inr(amount)} being refunded`, { code: 'WALLET_SHORT' });
  await post(db, tenant.businessId, userId, memberId, 'REFUND', -amount, { method, reason, branchId: tenant.branchId ?? m.branch_id });
  return withRupees({ balance_paise: have - amount });
};

/** A cancelled bill gives back what was paid from the wallet, once per bill. Called from the cancel flow. */
export const returnForCancelled = async (db, { businessId, invoiceId, userId }) => {
  const spent = (await db.query(`SELECT member_id, MAX(branch_id) AS branch_id, -SUM(amount_paise) AS paid FROM gym_wallet_ledger WHERE business_id = $1 AND invoice_id = $2 AND kind = 'SPEND' GROUP BY member_id`, [businessId, invoiceId])).rows[0];
  if (!spent || Number(spent.paid) <= 0) return 0;
  await lockMember(db, businessId, spent.member_id);
  const r = await db.query(
    `INSERT INTO gym_wallet_ledger (business_id, member_id, branch_id, kind, amount_paise, reason, invoice_id, created_by) VALUES ($1,$2,$3,'RETURN',$4,'Bill cancelled: back to the wallet',$5,$6) ON CONFLICT DO NOTHING`,
    [businessId, spent.member_id, spent.branch_id, Number(spent.paid), invoiceId, userId]);
  return r.rowCount ? Number(spent.paid) : 0;
};

export const ledger = async (db, tenant, memberId, { limit = 50 } = {}) => {
  const rows = (await db.query(
    `SELECT w.entry_id, w.kind, w.amount_paise, w.method, w.reason, w.created_at, w.invoice_id, i.invoice_number, u.name AS by
       FROM gym_wallet_ledger w LEFT JOIN invoices i ON i.invoice_id = w.invoice_id LEFT JOIN users u ON u.user_id = w.created_by
      WHERE w.business_id = $1 AND w.member_id = $2 ORDER BY w.entry_id DESC LIMIT $3`, [tenant.businessId, memberId, Math.min(Number(limit) || 50, 200)])).rows;
  return withRupees({ balance_paise: await balanceOf(db, tenant.businessId, memberId), rows: rows.map((r) => ({ ...r, amount_paise: Number(r.amount_paise) })) });
};

/** What the gym holds for members: the sum of all positive balances (a liability). */
export const liability = async (db, businessId) =>
  Number((await db.query(`SELECT COALESCE(SUM(b), 0) AS t FROM (SELECT SUM(amount_paise) AS b FROM gym_wallet_ledger WHERE business_id = $1 GROUP BY member_id HAVING SUM(amount_paise) > 0) x`, [businessId])).rows[0].t);
