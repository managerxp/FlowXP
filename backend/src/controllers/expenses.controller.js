/*
 * Expenses. The plainest module in the product — no transaction, no linked
 * ledger, because nothing else in the system needs to react to an expense
 * being logged. That is also why it is the one place a business genuinely
 * needs delete rather than archive: an expense entered twice by mistake has
 * no invoice pointing at it and nothing breaks by removing it outright.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { toPaise, toRupees } from '../utils/money.js';
import { branchFilter } from '../utils/scope.js';

const asExpense = (row) => ({
  expense_id: row.expense_id,
  category: row.category,
  amount: toRupees(row.amount_paise),
  payment_method: row.payment_method,
  expense_date: row.expense_date,
  description: row.description,
  attachment_url: row.attachment_url
});

export const list = async (req, res) => {
  const { from, to, category } = req.query;
  const clauses = [];
  const values = [req.tenant.businessId];
  if (from) { values.push(from); clauses.push(`expense_date >= $${values.length}`); }
  if (to) { values.push(to); clauses.push(`expense_date <= $${values.length}`); }
  if (category) { values.push(category); clauses.push(`category = $${values.length}`); }
  const scope = branchFilter(req.tenant, 'branch_id', values);

  const { rows } = await pool.query(
    `SELECT * FROM expenses WHERE business_id = $1 ${clauses.map((c) => `AND ${c}`).join(' ')}${scope}
     ORDER BY expense_date DESC, expense_id DESC LIMIT 300`,
    values
  );
  res.json({ success: true, data: rows.map(asExpense) });
};

export const create = async (req, res) => {
  const body = req.body || {};
  if (!body.category || !String(body.category).trim()) return res.status(400).json({ success: false, message: 'Choose a category' });

  let amountPaise;
  try { amountPaise = toPaise(body.amount); } catch { return res.status(400).json({ success: false, message: 'Enter an amount' }); }
  if (amountPaise <= 0) return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });

  const { rows } = await pool.query(
    `INSERT INTO expenses (business_id, branch_id, category, amount_paise, payment_method, expense_date, description, attachment_url, created_by)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,CURRENT_DATE),$7,$8,$9) RETURNING *`,
    [
      req.tenant.businessId, req.tenant.branchId, String(body.category).trim(), amountPaise,
      body.payment_method || 'CASH', body.expense_date || null, body.description || null,
      body.attachment_url || null, req.auth.userId
    ]
  );

  recordAudit(req, { action: 'expense.created', resource_type: 'expense', resource_id: rows[0].expense_id, metadata: { amount: toRupees(amountPaise) } });
  res.status(201).json({ success: true, data: asExpense(rows[0]) });
};

export const update = async (req, res) => {
  const body = req.body || {};
  const updates = [];
  const values = [];

  if ('category' in body) { values.push(String(body.category).trim()); updates.push(`category = $${values.length}`); }
  if ('amount' in body) {
    let amountPaise;
    try { amountPaise = toPaise(body.amount); } catch { return res.status(400).json({ success: false, message: 'Amount must be a number' }); }
    if (amountPaise <= 0) return res.status(400).json({ success: false, message: 'Amount must be greater than zero' });
    values.push(amountPaise); updates.push(`amount_paise = $${values.length}`);
  }
  for (const field of ['payment_method', 'expense_date', 'description', 'attachment_url']) {
    if (field in body) { values.push(body[field]); updates.push(`${field} = $${values.length}`); }
  }
  if (!updates.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

  values.push(req.tenant.businessId, req.params.id);
  const idx = values.length;
  const scope = branchFilter(req.tenant, 'branch_id', values);
  const { rows } = await pool.query(
    `UPDATE expenses SET ${updates.join(', ')} WHERE business_id = $${idx - 1} AND expense_id = $${idx}${scope} RETURNING *`,
    values
  );
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  recordAudit(req, { action: 'expense.updated', resource_type: 'expense', resource_id: req.params.id });
  res.json({ success: true, data: asExpense(rows[0]) });
};

export const remove = async (req, res) => {
  const values = [req.tenant.businessId, req.params.id];
  const { rowCount } = await pool.query(`DELETE FROM expenses WHERE business_id = $1 AND expense_id = $2${branchFilter(req.tenant, 'branch_id', values)}`, values);
  if (!rowCount) return res.status(404).json({ success: false, message: 'Not found' });
  recordAudit(req, { action: 'expense.deleted', resource_type: 'expense', resource_id: req.params.id });
  res.json({ success: true });
};
