/*
 * Customers: contact details, and the outstanding balance the brief asks for.
 *
 * The balance is never a stored column — it is SUM(invoices.balance_due_paise)
 * computed on read. A stored running balance would need updating from every
 * place an invoice or payment touches it, and one missed spot means a number
 * on screen that quietly stops being true. A query cannot drift.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { toRupees } from '../utils/money.js';
import { checkEmail, checkGstin, checkName, checkPhone, firstError } from '../utils/validate.js';

const asCustomer = (row) => ({
  customer_id: row.customer_id,
  name: row.name,
  phone: row.phone,
  email: row.email,
  address: row.address,
  state: row.state,
  gstin: row.gstin,
  credit_limit: toRupees(row.credit_limit_paise),
  outstanding_balance: toRupees(row.outstanding_paise || 0),
  total_purchases: toRupees(row.total_purchases_paise || 0),
  status: row.status
});

const SELECT = `
  SELECT c.*,
         COALESCE(SUM(i.balance_due_paise) FILTER (WHERE i.status = 'ISSUED'), 0) AS outstanding_paise,
         COALESCE(SUM(i.total_paise) FILTER (WHERE i.status = 'ISSUED'), 0) AS total_purchases_paise
  FROM customers c
  LEFT JOIN invoices i ON i.customer_id = c.customer_id
  WHERE c.business_id = $1
`;
const GROUP = `GROUP BY c.customer_id`;

export const list = async (req, res) => {
  const { search, status = 'ACTIVE' } = req.query;
  const clauses = [];
  const values = [req.tenant.businessId];

  if (status !== 'all') { values.push(status); clauses.push(`c.status = $${values.length}`); }
  if (search) { values.push(`%${search}%`); clauses.push(`(c.name ILIKE $${values.length} OR c.phone ILIKE $${values.length})`); }

  const { rows } = await pool.query(
    `${SELECT} ${clauses.map((c) => `AND ${c}`).join(' ')} ${GROUP} ORDER BY c.name`,
    values
  );
  res.json({ success: true, data: rows.map(asCustomer) });
};

export const get = async (req, res) => {
  const { rows } = await pool.query(`${SELECT} AND c.customer_id = $2 ${GROUP}`, [req.tenant.businessId, req.params.id]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: asCustomer(rows[0]) });
};

/* The customer's own bills — the "purchase history" the brief asks for. */
export const invoiceHistory = async (req, res) => {
  const owns = await pool.query(`SELECT 1 FROM customers WHERE customer_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId]);
  if (!owns.rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  const { rows } = await pool.query(
    `SELECT invoice_id, invoice_number, invoice_date, total_paise, balance_due_paise, payment_status, status
     FROM invoices WHERE customer_id = $1 ORDER BY invoice_date DESC, invoice_id DESC LIMIT 100`,
    [req.params.id]
  );
  res.json({
    success: true,
    data: rows.map((r) => ({
      invoice_id: r.invoice_id,
      invoice_number: r.invoice_number,
      invoice_date: r.invoice_date,
      total: toRupees(r.total_paise),
      balance_due: toRupees(r.balance_due_paise),
      payment_status: r.payment_status,
      status: r.status
    }))
  });
};

export const create = async (req, res) => {
  const body = req.body || {};
  const error = firstError([
    checkName(body.name, 'Customer name'),
    checkPhone(body.phone),
    body.email ? checkEmail(body.email) : null,
    checkGstin(body.gstin)
  ]);
  if (error) return res.status(400).json({ success: false, message: error });

  const { rows } = await pool.query(
    `INSERT INTO customers (business_id, name, phone, email, address, state, gstin, credit_limit_paise)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING customer_id`,
    [
      req.tenant.businessId, String(body.name).trim(),
      body.phone ? String(body.phone).trim() : null,
      body.email ? String(body.email).trim().toLowerCase() : null,
      body.address || null, body.state || null,
      body.gstin ? String(body.gstin).trim().toUpperCase() : null,
      Math.round((Number(body.credit_limit) || 0) * 100)
    ]
  );

  recordAudit(req, { action: 'customer.created', resource_type: 'customer', resource_id: rows[0].customer_id });
  const { rows: full } = await pool.query(`${SELECT} AND c.customer_id = $2 ${GROUP}`, [req.tenant.businessId, rows[0].customer_id]);
  res.status(201).json({ success: true, data: asCustomer(full[0]) });
};

/* Only fields actually present in the request are checked — a PATCH that
   touches just `address` must not fail because `phone` (untouched) looks odd. */
const VALIDATORS = {
  name: (v) => checkName(v, 'Customer name'),
  phone: checkPhone,
  email: (v) => (v ? checkEmail(v) : null),
  gstin: checkGstin
};
const EDITABLE = ['name', 'phone', 'email', 'address', 'state', 'gstin', 'status'];

export const update = async (req, res) => {
  const body = req.body || {};
  const error = firstError(
    Object.keys(VALIDATORS).filter((f) => f in body).map((f) => VALIDATORS[f](body[f]))
  );
  if (error) return res.status(400).json({ success: false, message: error });

  const updates = [];
  const values = [];
  for (const field of EDITABLE) {
    if (!(field in body)) continue;
    values.push(field === 'gstin' && body[field] ? String(body[field]).trim().toUpperCase() : body[field]);
    updates.push(`${field} = $${values.length}`);
  }
  if ('credit_limit' in body) {
    values.push(Math.round((Number(body.credit_limit) || 0) * 100));
    updates.push(`credit_limit_paise = $${values.length}`);
  }
  if (!updates.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

  values.push(req.tenant.businessId, req.params.id);
  const { rowCount } = await pool.query(
    `UPDATE customers SET ${updates.join(', ')} WHERE business_id = $${values.length - 1} AND customer_id = $${values.length}`,
    values
  );
  if (!rowCount) return res.status(404).json({ success: false, message: 'Not found' });

  recordAudit(req, { action: 'customer.updated', resource_type: 'customer', resource_id: req.params.id });
  const { rows: full } = await pool.query(`${SELECT} AND c.customer_id = $2 ${GROUP}`, [req.tenant.businessId, req.params.id]);
  res.json({ success: true, data: asCustomer(full[0]) });
};
