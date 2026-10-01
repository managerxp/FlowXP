/*
 * Money in from wholesale customers: receipts that settle one or many invoices, advances, partial payments,
 * refunds and reversals (a bounced cheque).
 *
 * A receipt is ONE payment event (₹50,000 by cheque 123456). Each part allocated to an invoice is an ordinary
 * `payments` row on that invoice — tied back with receipt_id — so every existing invoice screen, report and the GST
 * books keep working. Whatever is not allocated stays the customer's advance and shows on their ledger. Reversing a
 * receipt takes the allocations back off the invoices and puts the balances back.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { customerBalances } from '../modules/wholesale/ledger.js';
import { notify } from '../modules/wholesale/notify.js';
import { mySalesperson } from './wholesaleParties.controller.js';
import {
  WholesaleError, audit, getSettings, int, isoDate, like, nextNumber, ok, oneOf, page, paging, text, today, withTransaction, wrapAll
} from '../modules/wholesale/common.js';

const rupees = (v) => toRupees(Number(v || 0));
const METHODS = ['CASH', 'UPI', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'OTHER'];

const shape = (r) => ({
  receipt_id: r.receipt_id, receipt_number: r.receipt_number, receipt_date: r.receipt_date, kind: r.kind, status: r.status, customer_id: r.customer_id, customer: r.customer_name,
  method: r.method, reference: r.reference, cheque_date: r.cheque_date, bank: r.bank, amount: rupees(r.amount_paise), allocated: rupees(r.allocated_paise), advance: rupees(Number(r.amount_paise) - Number(r.allocated_paise)),
  notes: r.notes, reversed_at: r.reversed_at, reverse_reason: r.reverse_reason, created_at: r.created_at
});

const FROM = `FROM wholesale_receipts r JOIN customers c ON c.customer_id = r.customer_id`;

const list = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const values = [req.tenant.businessId]; const where = ['r.business_id = $1'];
  if (req.query.customer_id) { values.push(Number(req.query.customer_id) || 0); where.push(`r.customer_id = $${values.length}`); }
  if (req.query.method) { values.push(String(req.query.method).toUpperCase()); where.push(`r.method = $${values.length}`); }
  if (req.query.status) { values.push(String(req.query.status).toUpperCase()); where.push(`r.status = $${values.length}`); }
  // a field rep or collection executive sees the receipts they took, not the whole cash book
  if (['FIELD_SALES', 'COLLECTION_EXECUTIVE'].includes(req.tenant.role)) { values.push(req.auth.userId); where.push(`r.created_by = $${values.length}`); }
  if (req.query.advance === '1') where.push(`r.kind = 'RECEIPT' AND r.status = 'POSTED' AND r.amount_paise > r.allocated_paise`);
  const from = isoDate(req.query.from, 'From'); const to = isoDate(req.query.to, 'To');
  if (from) { values.push(from); where.push(`r.receipt_date >= $${values.length}`); }
  if (to) { values.push(to); where.push(`r.receipt_date <= $${values.length}`); }
  if (req.query.q) { values.push(like(String(req.query.q).slice(0, 80))); where.push(`(r.receipt_number ILIKE $${values.length} OR c.name ILIKE $${values.length} OR r.reference ILIKE $${values.length})`); }
  const base = `${FROM} WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(`SELECT r.*, c.name AS customer_name ${base} ORDER BY r.receipt_date DESC, r.receipt_id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  page(res, rows.map(shape), total, pg);
};

const detail = async (businessId, id) => {
  const r = Number.isInteger(Number(id)) ? (await pool.query(`SELECT r.*, c.name AS customer_name ${FROM} WHERE r.business_id = $1 AND r.receipt_id = $2`, [businessId, id])).rows[0] : null;
  if (!r) throw new WholesaleError(404, 'Not found');
  const allocations = (await pool.query(
    `SELECT a.alloc_id, a.invoice_id, a.amount_paise, a.payment_id, i.invoice_number, i.invoice_date FROM wholesale_receipt_allocations a JOIN invoices i ON i.invoice_id = a.invoice_id WHERE a.receipt_id = $1 ORDER BY a.alloc_id`, [r.receipt_id])).rows;
  return { ...shape(r), allocations: allocations.map((a) => ({ alloc_id: a.alloc_id, invoice_id: a.invoice_id, invoice_number: a.invoice_number, invoice_date: a.invoice_date, amount: rupees(a.amount_paise) })) };
};

const get = async (req, res) => ok(res, await detail(req.tenant.businessId, req.params.id));

/** Settle invoices from a receipt: one payments row per invoice, balances updated. `plan` = [{ invoice_id, amount_paise }]. */
const allocate = async (client, req, receipt, plan) => {
  let done = 0;
  const ids = [...new Set(plan.map((p) => p.invoice_id))].sort((a, b) => a - b);
  const invoices = new Map((await client.query(
    `SELECT invoice_id, branch_id, customer_id, status, total_paise, amount_paid_paise, balance_due_paise FROM invoices WHERE business_id = $1 AND invoice_id = ANY($2::int[]) ORDER BY invoice_id FOR UPDATE`, [req.tenant.businessId, ids])).rows.map((r) => [r.invoice_id, r]));
  for (const p of plan) {
    const inv = invoices.get(p.invoice_id);
    if (!inv || inv.customer_id !== receipt.customer_id) throw new WholesaleError(400, 'One of those invoices is not this customer’s');
    if (inv.status !== 'ISSUED') throw new WholesaleError(409, 'A cancelled invoice cannot be paid');
    if (p.amount_paise > Number(inv.balance_due_paise)) throw new WholesaleError(409, `Only ₹${rupees(inv.balance_due_paise)} is still due on one of those invoices`);
    const pay = (await client.query(
      `INSERT INTO payments (business_id, branch_id, invoice_id, customer_id, payment_method, amount_paise, reference_number, payment_date, notes, created_by, receipt_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING payment_id`,
      [req.tenant.businessId, inv.branch_id, inv.invoice_id, inv.customer_id, receipt.method, p.amount_paise, receipt.reference || receipt.receipt_number, receipt.receipt_date, `Receipt ${receipt.receipt_number}`, req.auth.userId, receipt.receipt_id])).rows[0];
    const newPaid = Number(inv.amount_paid_paise) + p.amount_paise; const newBalance = Number(inv.balance_due_paise) - p.amount_paise;
    await client.query(`UPDATE invoices SET amount_paid_paise = $2, balance_due_paise = $3, payment_status = $4 WHERE invoice_id = $1`, [inv.invoice_id, newPaid, newBalance, newBalance === 0 ? 'PAID' : 'PARTIAL']);
    inv.amount_paid_paise = newPaid; inv.balance_due_paise = newBalance;
    await client.query(`INSERT INTO wholesale_receipt_allocations (receipt_id, business_id, invoice_id, payment_id, amount_paise) VALUES ($1,$2,$3,$4,$5)`, [receipt.receipt_id, req.tenant.businessId, inv.invoice_id, pay.payment_id, p.amount_paise]);
    done += p.amount_paise;
  }
  await client.query(`UPDATE wholesale_receipts SET allocated_paise = allocated_paise + $2 WHERE receipt_id = $1`, [receipt.receipt_id, done]);
  return done;
};

/** The oldest-due-first plan for spending `amount` on a customer's open invoices. */
const oldestFirst = async (client, businessId, customerId, amount) => {
  const rows = (await client.query(
    `SELECT i.invoice_id, i.balance_due_paise FROM invoices i LEFT JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id
     WHERE i.business_id = $1 AND i.customer_id = $2 AND i.status = 'ISSUED' AND i.balance_due_paise > 0 ORDER BY COALESCE(m.due_date, i.invoice_date), i.invoice_id`, [businessId, customerId])).rows;
  const plan = []; let left = amount;
  for (const r of rows) { if (left <= 0) break; const take = Math.min(left, Number(r.balance_due_paise)); plan.push({ invoice_id: r.invoice_id, amount_paise: take }); left -= take; }
  return plan;
};

const cleanPlan = (list, total) => {
  if (!Array.isArray(list)) return [];
  if (list.length > 200) throw new WholesaleError(400, 'That is too many invoices at once');
  const seen = new Set();
  const plan = list.map((a) => {
    const id = int(a.invoice_id, 'Invoice', { min: 1, required: true });
    if (seen.has(id)) throw new WholesaleError(400, 'An invoice is listed twice');
    seen.add(id);
    const paise = Math.round(Number(a.amount) * 100);
    if (!Number.isFinite(paise) || paise <= 0) throw new WholesaleError(400, 'Each allocation needs an amount above zero');
    return { invoice_id: id, amount_paise: paise };
  });
  if (plan.reduce((s, p) => s + p.amount_paise, 0) > total) throw new WholesaleError(400, 'You are allocating more than the receipt');
  return plan;
};

/*
 * POST /receipts { customer_id, amount, method, reference?, cheque_date?, bank?, receipt_date?, notes?,
 *                  allocations?: [{ invoice_id, amount }], allocate?: 'OLDEST' | 'NONE' }
 *   no allocations and allocate 'OLDEST' (the default): oldest invoices first; the rest stays as an advance
 *   allocate 'NONE': all of it is an advance
 */
const create = async (req, res) => {
  const b = req.body || {};
  const customerId = int(b.customer_id, 'Customer', { min: 1, required: true });
  const method = oneOf(b.method, 'Payment method', METHODS, { required: true });
  const amount = Math.round(Number(b.amount) * 100);
  if (!Number.isFinite(amount) || amount <= 0) throw new WholesaleError(400, 'Enter the amount received');
  if (amount > 100000000000) throw new WholesaleError(400, 'That amount is too large');
  const reference = text(b.reference, 'Reference', { max: 80 });
  const visitId = int(b.visit_id, 'Visit', { min: 1 });
  const fieldRole = ['FIELD_SALES', 'COLLECTION_EXECUTIVE'].includes(req.tenant.role);
  if (fieldRole && (await getSettings(pool, req.tenant.businessId)).field_collections === false) throw new WholesaleError(403, 'Collecting payments in the field is switched off in settings');
  const mine = await mySalesperson(req);
  if (mine != null && !(await pool.query(`SELECT 1 FROM wholesale_customer_profiles WHERE customer_id = $1 AND salesperson_id = $2`, [customerId, mine])).rowCount) throw new WholesaleError(403, 'That customer is not assigned to you');
  if (visitId && !(await pool.query(`SELECT 1 FROM dist_visits WHERE business_id = $1 AND visit_id = $2 AND customer_id = $3`, [req.tenant.businessId, visitId, customerId])).rowCount) throw new WholesaleError(400, 'That visit was not found for this customer');
  if (['CHEQUE', 'BANK_TRANSFER', 'UPI'].includes(method) && !reference) throw new WholesaleError(400, method === 'CHEQUE' ? 'Enter the cheque number' : 'Enter the transaction reference');
  const out = await withTransaction(async (client) => {
    const customer = (await client.query(`SELECT customer_id, name FROM customers WHERE business_id = $1 AND customer_id = $2 FOR UPDATE`, [req.tenant.businessId, customerId])).rows[0];
    if (!customer) throw new WholesaleError(400, 'Choose a customer from your list');
    const date = isoDate(b.receipt_date, 'Receipt date') || await today(client, req.tenant.businessId);
    const number = await nextNumber(client, req.tenant.businessId, 'RC', 'RC');
    const receipt = (await client.query(
      `INSERT INTO wholesale_receipts (business_id, branch_id, customer_id, receipt_number, receipt_date, method, reference, cheque_date, bank, amount_paise, notes, created_by, visit_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.tenant.businessId, req.tenant.branchId, customerId, number, date, method, reference, isoDate(b.cheque_date, 'Cheque date'), text(b.bank, 'Bank', { max: 80 }), amount, text(b.notes, 'Notes', { max: 300 }), req.auth.userId, visitId])).rows[0];
    let plan = cleanPlan(b.allocations, amount);
    if (!plan.length && String(b.allocate || 'OLDEST').toUpperCase() !== 'NONE') plan = await oldestFirst(client, req.tenant.businessId, customerId, amount);
    const done = plan.length ? await allocate(client, req, receipt, plan) : 0;
    return { receipt, allocated: done, customer };
  });
  audit(req, 'wholesale.receipt_posted', 'receipt', out.receipt.receipt_id, null, { number: out.receipt.receipt_number, customer: out.customer.name, amount: rupees(amount), method, allocated: rupees(out.allocated) });
  notify(req, 'payment_received', { customerId, values: { amount, receipt: out.receipt.receipt_number } });
  ok(res, await detail(req.tenant.businessId, out.receipt.receipt_id), 201);
};

/* POST /receipts/:id/allocate { allocations: [{ invoice_id, amount }] } — put an advance against invoices later */
const allocateLater = async (req, res) => {
  await withTransaction(async (client) => {
    const r = (await client.query(`SELECT * FROM wholesale_receipts WHERE business_id = $1 AND receipt_id = $2 FOR UPDATE`, [req.tenant.businessId, req.params.id])).rows[0];
    if (!r) throw new WholesaleError(404, 'Not found');
    if (r.status !== 'POSTED' || r.kind !== 'RECEIPT') throw new WholesaleError(409, 'Only a posted receipt can be allocated');
    await client.query(`SELECT 1 FROM customers WHERE customer_id = $1 FOR UPDATE`, [r.customer_id]);
    const free = Number(r.amount_paise) - Number(r.allocated_paise);
    let plan = cleanPlan(req.body?.allocations, free);
    if (!plan.length) plan = await oldestFirst(client, req.tenant.businessId, r.customer_id, free);
    if (!plan.length) throw new WholesaleError(409, free > 0 ? 'This customer has no open invoices' : 'This receipt is already fully allocated');
    await allocate(client, req, r, plan);
  });
  audit(req, 'wholesale.receipt_allocated', 'receipt', Number(req.params.id));
  ok(res, await detail(req.tenant.businessId, req.params.id));
};

/* POST /receipts/:id/reverse { reason } — a bounced cheque or a mistake: invoice balances come back */
const reverse = async (req, res) => {
  const reason = text(req.body?.reason, 'Reason', { max: 200, required: true, min: 3 });
  await withTransaction(async (client) => {
    const r = (await client.query(`SELECT * FROM wholesale_receipts WHERE business_id = $1 AND receipt_id = $2 FOR UPDATE`, [req.tenant.businessId, req.params.id])).rows[0];
    if (!r) throw new WholesaleError(404, 'Not found');
    if (r.status === 'REVERSED') throw new WholesaleError(409, 'This receipt was already reversed');
    const allocs = (await client.query(`SELECT * FROM wholesale_receipt_allocations WHERE receipt_id = $1 ORDER BY invoice_id FOR UPDATE`, [r.receipt_id])).rows;
    const invoices = new Map((await client.query(`SELECT invoice_id, amount_paid_paise, balance_due_paise FROM invoices WHERE invoice_id = ANY($1::int[]) ORDER BY invoice_id FOR UPDATE`, [allocs.map((a) => a.invoice_id)])).rows.map((i) => [i.invoice_id, i]));
    for (const a of allocs) {
      const inv = invoices.get(a.invoice_id);
      const paid = Math.max(0, Number(inv.amount_paid_paise) - Number(a.amount_paise)); const balance = Number(inv.balance_due_paise) + Number(a.amount_paise);
      await client.query(`UPDATE invoices SET amount_paid_paise = $2, balance_due_paise = $3, payment_status = $4 WHERE invoice_id = $1`, [a.invoice_id, paid, balance, paid <= 0 ? 'UNPAID' : balance > 0 ? 'PARTIAL' : 'PAID']);
      if (a.payment_id) await client.query(`DELETE FROM payments WHERE payment_id = $1`, [a.payment_id]);
      await client.query(`UPDATE wholesale_receipt_allocations SET payment_id = NULL WHERE alloc_id = $1`, [a.alloc_id]);
    }
    await client.query(`UPDATE wholesale_receipts SET status = 'REVERSED', reversed_at = CURRENT_TIMESTAMP, reversed_by = $2, reverse_reason = $3 WHERE receipt_id = $1`, [r.receipt_id, req.auth.userId, reason]);
  });
  audit(req, 'wholesale.receipt_reversed', 'receipt', Number(req.params.id), null, null, { reason });
  ok(res, await detail(req.tenant.businessId, req.params.id));
};

/* POST /refunds { customer_id, amount, method, reference?, notes? } — pay back money the customer has in advance or credit */
const refund = async (req, res) => {
  const b = req.body || {};
  const customerId = int(b.customer_id, 'Customer', { min: 1, required: true });
  const method = oneOf(b.method, 'Payment method', METHODS.filter((m) => m !== 'CHEQUE').concat('CHEQUE'), { required: true });
  const amount = Math.round(Number(b.amount) * 100);
  if (!Number.isFinite(amount) || amount <= 0) throw new WholesaleError(400, 'Enter the amount to pay back');
  const out = await withTransaction(async (client) => {
    const customer = (await client.query(`SELECT customer_id, name FROM customers WHERE business_id = $1 AND customer_id = $2 FOR UPDATE`, [req.tenant.businessId, customerId])).rows[0];
    if (!customer) throw new WholesaleError(400, 'Choose a customer from your list');
    const settings = await getSettings(client, req.tenant.businessId);
    const bal = (await customerBalances(client, { businessId: req.tenant.businessId, customerIds: [customerId], graceDays: settings.overdue_grace_days })).get(customerId);
    const owedToThem = Math.max(0, -bal.outstanding);
    if (amount > owedToThem) throw new WholesaleError(409, owedToThem > 0 ? `You only owe this customer ₹${rupees(owedToThem)}` : 'This customer has no credit or advance to pay back');
    const number = await nextNumber(client, req.tenant.businessId, 'RC', 'RC');
    const row = (await client.query(
      `INSERT INTO wholesale_receipts (business_id, branch_id, customer_id, receipt_number, receipt_date, method, reference, amount_paise, kind, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'REFUND',$9,$10) RETURNING receipt_id`,
      [req.tenant.businessId, req.tenant.branchId, customerId, number, await today(client, req.tenant.businessId), method, text(b.reference, 'Reference', { max: 80 }), amount, text(b.notes, 'Notes', { max: 300 }), req.auth.userId])).rows[0];
    return { id: row.receipt_id, name: customer.name, number };
  });
  audit(req, 'wholesale.refund_paid', 'receipt', out.id, null, { customer: out.name, amount: rupees(amount), method });
  ok(res, await detail(req.tenant.businessId, out.id), 201);
};

/* GET /customers/:id/open-invoices — what a receipt can be put against, oldest first */
const openInvoices = async (req, res) => {
  if (!(await pool.query(`SELECT 1 FROM customers WHERE business_id = $1 AND customer_id = $2`, [req.tenant.businessId, req.params.id])).rowCount) throw new WholesaleError(404, 'Not found');
  const rows = (await pool.query(
    `SELECT i.invoice_id, i.invoice_number, i.invoice_date, i.total_paise, i.balance_due_paise, COALESCE(m.due_date, i.invoice_date) AS due_date, (CURRENT_DATE - COALESCE(m.due_date, i.invoice_date)) AS days_overdue
     FROM invoices i LEFT JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id WHERE i.business_id = $1 AND i.customer_id = $2 AND i.status = 'ISSUED' AND i.balance_due_paise > 0
     ORDER BY COALESCE(m.due_date, i.invoice_date), i.invoice_id`, [req.tenant.businessId, req.params.id])).rows;
  const advance = Number((await pool.query(`SELECT COALESCE(SUM(amount_paise - allocated_paise), 0) AS a FROM wholesale_receipts WHERE business_id = $1 AND customer_id = $2 AND kind = 'RECEIPT' AND status = 'POSTED'`, [req.tenant.businessId, req.params.id])).rows[0].a);
  ok(res, { advance: rupees(advance), invoices: rows.map((r) => ({ invoice_id: r.invoice_id, invoice_number: r.invoice_number, invoice_date: r.invoice_date, due_date: r.due_date, days_overdue: Number(r.days_overdue), total: rupees(r.total_paise), balance: rupees(r.balance_due_paise) })) });
};

export default wrapAll({ list, get, create, allocateLater, reverse, refund, openInvoices });
