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
  pincode: row.pincode,
  gstin: row.gstin,
  credit_limit: toRupees(row.credit_limit_paise),
  outstanding_balance: toRupees(row.outstanding_paise || 0),
  total_purchases: toRupees(row.total_purchases_paise || 0),
  bills: Number(row.bill_count || 0),
  first_bill_date: row.first_bill_date,
  last_bill_date: row.last_bill_date,
  status: row.status
});

const SELECT = `
  SELECT c.*,
         COALESCE(SUM(i.balance_due_paise) FILTER (WHERE i.status = 'ISSUED'), 0) AS outstanding_paise,
         COALESCE(SUM(i.total_paise) FILTER (WHERE i.status = 'ISSUED'), 0) AS total_purchases_paise,
         COUNT(i.invoice_id) FILTER (WHERE i.status = 'ISSUED') AS bill_count,
         MIN(i.invoice_date) FILTER (WHERE i.status = 'ISSUED') AS first_bill_date,
         MAX(i.invoice_date) FILTER (WHERE i.status = 'ISSUED') AS last_bill_date
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
    checkGstin(body.gstin),
    body.pincode && !/^[1-9]\d{5}$/.test(String(body.pincode).trim()) ? 'A pincode is 6 digits' : null
  ]);
  if (error) return res.status(400).json({ success: false, message: error });

  const { rows } = await pool.query(
    `INSERT INTO customers (business_id, name, phone, email, address, state, gstin, credit_limit_paise, pincode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING customer_id`,
    [
      req.tenant.businessId, String(body.name).trim(),
      body.phone ? String(body.phone).trim() : null,
      body.email ? String(body.email).trim().toLowerCase() : null,
      body.address || null, body.state || null,
      body.gstin ? String(body.gstin).trim().toUpperCase() : null,
      Math.round((Number(body.credit_limit) || 0) * 100),
      body.pincode ? String(body.pincode).trim() : null
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
  gstin: checkGstin,
  pincode: (v) => (v && !/^[1-9]\d{5}$/.test(String(v).trim()) ? 'A pincode is 6 digits' : null)
};
const EDITABLE = ['name', 'phone', 'email', 'address', 'state', 'gstin', 'status', 'pincode'];

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

/* ── import from a spreadsheet ───────────────────────────────────────────────────────────────
 * POST /api/customers/import { rows, apply? }. Checked row by row first (nothing written); applied only when every row is good, in one
 * transaction. A person already here (same phone, or same name when the row has no phone) is skipped, never changed or doubled.
 * No opening balance: what a customer owes is the sum of their unpaid bills, so it cannot be typed in. */
const COLS = {
  name: ['name', 'customer', 'customer_name', 'party', 'party_name', 'ledger', 'ledger_name', 'account_name'],
  phone: ['phone', 'mobile', 'mobile_no', 'mobile_number', 'phone_no', 'contact_no', 'contact_number'],
  email: ['email', 'email_id', 'e-mail'],
  gstin: ['gstin', 'gst_no', 'gst_number', 'gstin/uin', 'gst_in'],
  address: ['address', 'billing_address', 'address_line_1'],
  state: ['state', 'place_of_supply'],
  pincode: ['pincode', 'pin', 'pin_code', 'zip', 'postal_code'],
  credit_limit: ['credit_limit', 'credit_limit_amount']
};
const MAX_IMPORT_ROWS = 5000;
const key = (k) => String(k).trim().toLowerCase().replace(/[\s-]+/g, '_');
const field = (r, f) => { for (const c of COLS[f]) { const v = r[c]; if (v != null && String(v).trim() !== '') return String(v).trim(); } return ''; };

export const importRows = async (req, res) => {
  const { rows, apply } = req.body || {};
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ success: false, message: 'The file has no rows' });
  if (rows.length > MAX_IMPORT_ROWS) return res.status(400).json({ success: false, message: `Import up to ${MAX_IMPORT_ROWS.toLocaleString('en-IN')} rows at a time` });
  const bid = req.tenant.businessId;
  const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);
  const have = (await pool.query(`SELECT lower(name) AS name, phone FROM customers WHERE business_id = $1`, [bid])).rows;
  const phones = new Set(have.map((c) => digits(c.phone)).filter(Boolean));
  const names = new Set(have.filter((c) => !c.phone).map((c) => c.name));
  const errors = []; const fresh = []; let already = 0;
  rows.forEach((raw, i) => {
    const r = Object.fromEntries(Object.entries(raw || {}).map(([k, v]) => [key(k), v]));
    const c = Object.fromEntries(Object.keys(COLS).map((f) => [f, field(r, f)]));
    const credit = c.credit_limit === '' ? 0 : Number(String(c.credit_limit).replace(/[₹,\s]/g, ''));
    const problem = firstError([
      checkName(c.name, 'Name'), checkPhone(c.phone), c.email ? checkEmail(c.email) : null, checkGstin(c.gstin),
      c.pincode && !/^[1-9]\d{5}$/.test(c.pincode) ? 'A pincode is 6 digits' : null,
      !Number.isFinite(credit) || credit < 0 ? 'Credit limit is not an amount' : null
    ]);
    if (problem) { errors.push({ row: i + 2, message: problem }); return; }
    const pk = digits(c.phone); const nk = c.name.toLowerCase();
    if (pk ? phones.has(pk) : names.has(nk)) { already += 1; return; }
    if (pk) phones.add(pk); else names.add(nk);
    fresh.push({ ...c, credit: Math.round(credit * 100) });
  });
  const out = { rows: rows.length, to_create: fresh.length, already_here: already, total_errors: errors.length, errors: errors.slice(0, 50), applied: false, created: 0 };
  if (apply !== true) return res.json({ success: true, data: out });
  if (errors.length) return res.status(422).json({ success: false, message: `${errors.length} row${errors.length === 1 ? ' has' : 's have'} a problem. Nothing was imported.`, data: { errors: out.errors, total_errors: out.total_errors } });
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    for (const c of fresh) {
      await db.query(
        `INSERT INTO customers (business_id, name, phone, email, address, state, gstin, credit_limit_paise, pincode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [bid, c.name, c.phone || null, c.email ? c.email.toLowerCase() : null, c.address || null, c.state || null, c.gstin ? c.gstin.toUpperCase() : null, c.credit, c.pincode || null]
      );
    }
    await db.query('COMMIT');
  } catch (e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
  recordAudit(req, { action: 'customer.imported', resource_type: 'customer', metadata: { rows: rows.length, created: fresh.length } });
  res.json({ success: true, data: { ...out, applied: true, created: fresh.length } });
};
