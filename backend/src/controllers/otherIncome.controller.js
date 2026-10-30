/*
 * Other income: money received that is not a sale. Plain list, like expenses; Profit & Loss and the Day Book read it.
 * The same checks as expenses (a real date, a category, an amount above zero).
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { toPaise, toRupees } from '../utils/money.js';
import { branchFilter } from '../utils/scope.js';

const METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'];
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === String(v);

const invalid = (body) => {
  if ('category' in body && (!String(body.category ?? '').trim() || String(body.category).trim().length > 60)) return 'Choose a category (up to 60 letters)';
  if (body.payment_method != null && !METHODS.includes(body.payment_method)) return 'Choose how it was received';
  if (body.income_date != null && body.income_date !== '' && !isDate(body.income_date)) return 'Enter a valid date';
  return null;
};

const asIncome = (r) => ({ income_id: r.income_id, category: r.category, amount: toRupees(r.amount_paise), payment_method: r.payment_method, income_date: r.income_date, description: r.description });

export const list = async (req, res) => {
  const { from, to } = req.query;
  if ((from && !isDate(from)) || (to && !isDate(to))) return res.status(400).json({ success: false, message: 'Enter valid dates' });
  const values = [req.tenant.businessId];
  const clauses = [];
  if (from) { values.push(from); clauses.push(`income_date >= $${values.length}`); }
  if (to) { values.push(to); clauses.push(`income_date <= $${values.length}`); }
  const scope = branchFilter(req.tenant, 'branch_id', values);
  const where = `business_id = $1${clauses.map((c) => ` AND ${c}`).join('')}${scope}`;
  const [rows, total] = await Promise.all([
    pool.query(`SELECT * FROM other_income WHERE ${where} ORDER BY income_date DESC, income_id DESC LIMIT 300`, values),
    pool.query(`SELECT COALESCE(SUM(amount_paise), 0) AS paise FROM other_income WHERE ${where}`, values)
  ]);
  res.json({ success: true, data: { total: toRupees(total.rows[0].paise), rows: rows.rows.map(asIncome) } });
};

export const create = async (req, res) => {
  const body = req.body || {};
  if (!body.category || !String(body.category).trim()) return res.status(400).json({ success: false, message: 'Choose a category' });
  const bad = invalid(body);
  if (bad) return res.status(400).json({ success: false, message: bad });
  let paise;
  try { paise = toPaise(body.amount); } catch { return res.status(400).json({ success: false, message: 'Enter an amount' }); }
  if (paise <= 0) return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
  const { rows } = await pool.query(
    `INSERT INTO other_income (business_id, branch_id, category, amount_paise, payment_method, income_date, description, created_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7,$8) RETURNING *`,
    [req.tenant.businessId, req.tenant.branchId, String(body.category).trim(), paise, body.payment_method || 'CASH', body.income_date || null, body.description || null, req.auth.userId]);
  recordAudit(req, { action: 'other_income.created', resource_type: 'other_income', resource_id: rows[0].income_id, metadata: { amount: toRupees(paise) } });
  res.status(201).json({ success: true, data: asIncome(rows[0]) });
};

export const remove = async (req, res) => {
  const values = [req.tenant.businessId, req.params.id];
  const { rowCount } = await pool.query(`DELETE FROM other_income WHERE business_id = $1 AND income_id = $2${branchFilter(req.tenant, 'branch_id', values)}`, values);
  if (!rowCount) return res.status(404).json({ success: false, message: 'Not found' });
  recordAudit(req, { action: 'other_income.deleted', resource_type: 'other_income', resource_id: req.params.id });
  res.json({ success: true });
};
