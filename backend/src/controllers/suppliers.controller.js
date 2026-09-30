/*
 * Suppliers: who you buy from, and what you owe them.
 *
 * The mirror of customers.controller.js — payable balance computed from
 * purchase_orders.balance_due_paise on read, for the same reason a customer's
 * outstanding balance is: a query cannot drift, a maintained column can.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { toRupees } from '../utils/money.js';
import { checkEmail, checkGstin, checkName, checkPhone, firstError } from '../utils/validate.js';
import { branchFilter } from '../utils/scope.js';

const asSupplier = (row) => ({
  supplier_id: row.supplier_id,
  name: row.name,
  phone: row.phone,
  email: row.email,
  address: row.address,
  gstin: row.gstin,
  payable_balance: toRupees(row.payable_paise || 0),
  total_purchases: toRupees(row.total_purchases_paise || 0),
  received_orders: row.received_orders ?? 0,
  open_orders: row.open_orders ?? 0,
  last_po_date: row.last_po_date ?? null,
  status: row.status
});

/* Money and orders per supplier, counted only at the outlet(s) the viewer may see
   (a supplier is shared, what you owe them is per outlet, as on Purchases).
   `values` must start with the business id; the scope parameter is pushed here. */
const selectFor = (tenant, values) => `
  SELECT s.*,
         COALESCE(SUM(po.balance_due_paise) FILTER (WHERE po.status IN ('RECEIVED','PARTIAL')), 0) AS payable_paise,
         COALESCE(SUM(po.total_paise - po.debited_paise) FILTER (WHERE po.status IN ('RECEIVED','PARTIAL')), 0) AS total_purchases_paise,
         COUNT(po.po_id) FILTER (WHERE po.status IN ('RECEIVED','PARTIAL'))::int AS received_orders,
         COUNT(po.po_id) FILTER (WHERE po.status IN ('ORDERED','PARTIAL'))::int AS open_orders,
         MAX(po.po_date) FILTER (WHERE po.status IN ('RECEIVED','PARTIAL')) AS last_po_date
  FROM suppliers s
  LEFT JOIN purchase_orders po ON po.supplier_id = s.supplier_id${branchFilter(tenant, 'po.branch_id', values)}
  WHERE s.business_id = $1
`;
const one = async (req, id) => {
  const values = [req.tenant.businessId];
  const sql = selectFor(req.tenant, values);
  values.push(id);
  return (await pool.query(`${sql} AND s.supplier_id = $${values.length} ${GROUP}`, values)).rows[0];
};
const GROUP = `GROUP BY s.supplier_id`;

export const list = async (req, res) => {
  const { search, status = 'ACTIVE' } = req.query;
  const clauses = [];
  const values = [req.tenant.businessId];
  const sql = selectFor(req.tenant, values);
  if (status !== 'all') { values.push(status); clauses.push(`s.status = $${values.length}`); }
  if (search) { values.push(`%${search}%`); clauses.push(`(s.name ILIKE $${values.length} OR s.phone ILIKE $${values.length})`); }

  const { rows } = await pool.query(`${sql} ${clauses.map((c) => `AND ${c}`).join(' ')} ${GROUP} ORDER BY s.name`, values);
  res.json({ success: true, data: rows.map(asSupplier) });
};

export const get = async (req, res) => {
  const row = await one(req, req.params.id);
  if (!row) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: asSupplier(row) });
};

export const purchaseHistory = async (req, res) => {
  const owns = await pool.query(`SELECT 1 FROM suppliers WHERE supplier_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId]);
  if (!owns.rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  const values = [req.params.id];
  const { rows } = await pool.query(
    `SELECT po_id, po_number, po_date, expected_date, total_paise, balance_due_paise, payment_status, status
     FROM purchase_orders WHERE supplier_id = $1${branchFilter(req.tenant, 'branch_id', values)} ORDER BY po_date DESC, po_id DESC LIMIT 100`,
    values
  );
  res.json({
    success: true,
    data: rows.map((r) => ({
      po_id: r.po_id, po_number: r.po_number, po_date: r.po_date,
      expected_date: r.expected_date ? String(r.expected_date).slice(0, 10) : null,
      total: toRupees(r.total_paise), balance_due: toRupees(r.balance_due_paise),
      payment_status: r.payment_status, status: r.status
    }))
  });
};

export const create = async (req, res) => {
  const body = req.body || {};
  const error = firstError([
    checkName(body.name, 'Supplier name'),
    checkPhone(body.phone),
    body.email ? checkEmail(body.email) : null,
    checkGstin(body.gstin)
  ]);
  if (error) return res.status(400).json({ success: false, message: error });

  const { rows } = await pool.query(
    `INSERT INTO suppliers (business_id, name, phone, email, address, gstin)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING supplier_id`,
    [
      req.tenant.businessId, String(body.name).trim(),
      body.phone ? String(body.phone).trim() : null,
      body.email ? String(body.email).trim().toLowerCase() : null,
      body.address || null,
      body.gstin ? String(body.gstin).trim().toUpperCase() : null
    ]
  );

  recordAudit(req, { action: 'supplier.created', resource_type: 'supplier', resource_id: rows[0].supplier_id });
  res.status(201).json({ success: true, data: asSupplier(await one(req, rows[0].supplier_id)) });
};

const VALIDATORS = {
  name: (v) => checkName(v, 'Supplier name'),
  phone: checkPhone,
  email: (v) => (v ? checkEmail(v) : null),
  gstin: checkGstin
};
const EDITABLE = ['name', 'phone', 'email', 'address', 'gstin', 'status'];

export const update = async (req, res) => {
  const body = req.body || {};
  const error = firstError(Object.keys(VALIDATORS).filter((f) => f in body).map((f) => VALIDATORS[f](body[f])));
  if (error) return res.status(400).json({ success: false, message: error });

  const updates = [];
  const values = [];
  for (const field of EDITABLE) {
    if (!(field in body)) continue;
    values.push(field === 'gstin' && body[field] ? String(body[field]).trim().toUpperCase() : body[field]);
    updates.push(`${field} = $${values.length}`);
  }
  if (!updates.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

  values.push(req.tenant.businessId, req.params.id);
  const { rowCount } = await pool.query(
    `UPDATE suppliers SET ${updates.join(', ')} WHERE business_id = $${values.length - 1} AND supplier_id = $${values.length}`,
    values
  );
  if (!rowCount) return res.status(404).json({ success: false, message: 'Not found' });

  recordAudit(req, { action: 'supplier.updated', resource_type: 'supplier', resource_id: req.params.id });
  res.json({ success: true, data: asSupplier(await one(req, req.params.id)) });
};
