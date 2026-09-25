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

const asPayment = (row) => ({
  payment_id: row.payment_id,
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
  const { from, to, method } = req.query;
  const clauses = [];
  const values = [req.tenant.businessId];
  if (from) { values.push(from); clauses.push(`p.payment_date >= $${values.length}`); }
  if (to) { values.push(to); clauses.push(`p.payment_date <= $${values.length}`); }
  if (method) { values.push(method); clauses.push(`p.payment_method = $${values.length}`); }
  const scope = branchFilter(req.tenant, 'p.branch_id', values);

  const { rows } = await pool.query(
    `SELECT p.*, i.invoice_number, c.name AS customer_name
     FROM payments p
     LEFT JOIN invoices i ON i.invoice_id = p.invoice_id
     LEFT JOIN customers c ON c.customer_id = p.customer_id
     WHERE p.business_id = $1 ${clauses.map((c) => `AND ${c}`).join(' ')}${scope}
     ORDER BY p.payment_date DESC, p.payment_id DESC LIMIT 200`,
    values
  );
  res.json({ success: true, data: rows.map(asPayment) });
};

/* A payment with no invoice_id: an advance, or a balance settled in cash that
   predates FlowXP. Requires a customer, because a payment from nobody in
   particular against nothing in particular is not a record worth keeping. */
export const create = async (req, res) => {
  const body = req.body || {};
  if (!body.customer_id) return res.status(400).json({ success: false, message: 'Choose a customer' });

  let amountPaise;
  try { amountPaise = toPaise(body.amount); } catch { return res.status(400).json({ success: false, message: 'Enter a payment amount' }); }
  if (amountPaise <= 0) return res.status(400).json({ success: false, message: 'Payment amount must be greater than zero' });

  const owns = await pool.query(`SELECT 1 FROM customers WHERE customer_id = $1 AND business_id = $2`, [body.customer_id, req.tenant.businessId]);
  if (!owns.rows.length) return res.status(400).json({ success: false, message: 'Customer not found' });

  const { rows } = await pool.query(
    `INSERT INTO payments (business_id, branch_id, customer_id, payment_method, amount_paise, reference_number, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING payment_id`,
    [req.tenant.businessId, req.tenant.branchId, body.customer_id, body.method || 'CASH', amountPaise, body.reference_number || null, body.notes || null, req.auth.userId]
  );

  recordAudit(req, { action: 'payment.recorded', resource_type: 'payment', resource_id: rows[0].payment_id, metadata: { amount: toRupees(amountPaise) } });
  res.status(201).json({ success: true, data: { payment_id: rows[0].payment_id } });
};
