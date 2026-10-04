/*
 * Payments: the list view across every method and source, plus a standalone
 * payment against a customer with no invoice — an advance, or clearing an old
 * balance from before FlowXP. A payment against a specific invoice is
 * recorded through invoices.controller.js instead, because that path also has
 * to update the invoice's own balance in the same transaction.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { toPaise, toRupees } from '../utils/money.js';
import { branchFilter } from '../utils/scope.js';
import { paymentReference } from '../modules/billing.js';

const METHODS = ['CHEQUE', 'CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CREDIT', 'OTHER'];
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));

/* The payments table holds both sides: money taken from customers (po_id is null)
   and money paid to suppliers (po_id set). Every read here keeps them apart. */
const asPayment = (row) => ({
  payment_id: row.payment_id,
  direction: row.po_id ? 'out' : 'in',
  po_id: row.po_id ?? null,
  po_number: row.po_number ?? null,
  supplier_id: row.supplier_id ?? null,
  supplier_name: row.supplier_name ?? null,
  created_at: row.created_at,
  invoice_id: row.invoice_id,
  invoice_number: row.invoice_number,
  customer_id: row.customer_id,
  customer_name: row.customer_name,
  method: row.payment_method,
  amount: toRupees(row.amount_paise),
  reference_number: row.reference_number,
  date: row.payment_date,
  notes: row.notes
});

export const list = async (req, res) => {
  const { from, to, method, direction } = req.query;
  if ((from && !isDate(from)) || (to && !isDate(to))) return res.status(400).json({ success: false, message: 'Enter valid dates' });
  const clauses = [];
  const values = [req.tenant.businessId];
  if (direction === 'in') clauses.push('p.po_id IS NULL');
  if (direction === 'out') clauses.push('p.po_id IS NOT NULL');
  if (from) { values.push(from); clauses.push(`p.payment_date >= $${values.length}`); }
  if (to) { values.push(to); clauses.push(`p.payment_date <= $${values.length}`); }
  if (method) { values.push(method); clauses.push(`p.payment_method = $${values.length}`); }
  const scope = branchFilter(req.tenant, 'p.branch_id', values);

  const { rows } = await pool.query(
    `SELECT p.*, i.invoice_number, c.name AS customer_name, po.po_number, s.name AS supplier_name
     FROM payments p
     LEFT JOIN invoices i ON i.invoice_id = p.invoice_id
     LEFT JOIN customers c ON c.customer_id = p.customer_id
     LEFT JOIN purchase_orders po ON po.po_id = p.po_id
     LEFT JOIN suppliers s ON s.supplier_id = p.supplier_id
     WHERE p.business_id = $1 ${clauses.map((c) => `AND ${c}`).join(' ')}${scope}
     ORDER BY p.payment_date DESC, p.payment_id DESC LIMIT 200`,
    values
  );
  res.json({ success: true, data: rows.map(asPayment) });
};

/* GET /api/payments/summary?from=&to= : exact totals for a period, money in and paid out
   kept apart, each by method. The list is capped at 200; this is not. */
export const summary = async (req, res) => {
  const { from, to } = req.query;
  if ((from && !isDate(from)) || (to && !isDate(to))) return res.status(400).json({ success: false, message: 'Enter valid dates' });
  const values = [req.tenant.businessId];
  const clauses = [];
  if (from) { values.push(from); clauses.push(`payment_date >= $${values.length}`); }
  if (to) { values.push(to); clauses.push(`payment_date <= $${values.length}`); }
  const scope = branchFilter(req.tenant, 'branch_id', values);
  const { rows } = await pool.query(
    `SELECT (po_id IS NOT NULL) AS out, payment_method, SUM(amount_paise) AS paise, COUNT(*)::int AS n
     FROM payments WHERE business_id = $1 ${clauses.map((c) => `AND ${c}`).join(' ')}${scope}
     GROUP BY 1, 2 ORDER BY paise DESC`, values);
  const side = (out) => {
    const r = rows.filter((x) => x.out === out);
    return {
      total: toRupees(r.reduce((t, x) => t + Number(x.paise), 0)),
      count: r.reduce((t, x) => t + x.n, 0),
      by_method: r.map((x) => ({ method: x.payment_method, total: toRupees(x.paise), count: x.n }))
    };
  };
  res.json({ success: true, data: { in: side(false), out: side(true) } });
};

/* A payment with no invoice_id: an advance, or a balance settled in cash that
   predates FlowXP. Requires a customer, because a payment from nobody in
   particular against nothing in particular is not a record worth keeping. */
export const create = async (req, res) => {
  const body = req.body || {};
  if (!body.customer_id) return res.status(400).json({ success: false, message: 'Choose a customer' });
  const method = String(body.method || 'CASH').toUpperCase();
  if (!METHODS.includes(method)) return res.status(400).json({ success: false, message: `Unknown payment method: ${body.method}` });

  let amountPaise;
  try { amountPaise = toPaise(body.amount); } catch { return res.status(400).json({ success: false, message: 'Enter a payment amount' }); }
  if (amountPaise <= 0) return res.status(400).json({ success: false, message: 'Payment amount must be greater than zero' });

  let reference;
  try { reference = paymentReference(body.reference_number); } catch (error) { return res.status(error.status || 400).json({ success: false, message: error.message }); }

  const owns = await pool.query(`SELECT 1 FROM customers WHERE customer_id = $1 AND business_id = $2`, [body.customer_id, req.tenant.businessId]);
  if (!owns.rows.length) return res.status(400).json({ success: false, message: 'Customer not found' });

  const { rows } = await pool.query(
    `INSERT INTO payments (business_id, branch_id, customer_id, payment_method, amount_paise, reference_number, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING payment_id`,
    [req.tenant.businessId, req.tenant.branchId, body.customer_id, method, amountPaise, reference, body.notes || null, req.auth.userId]
  );

  recordAudit(req, { action: 'payment.recorded', resource_type: 'payment', resource_id: rows[0].payment_id, metadata: { amount: toRupees(amountPaise) } });
  res.status(201).json({ success: true, data: { payment_id: rows[0].payment_id } });
};
