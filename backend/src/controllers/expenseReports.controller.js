/*
 * Expense reports over the expenses people have logged: by category (with the period before, to see what moved), by item (what the money
 * was actually spent on, grouped by description), and the plain transaction list. Read-only.
 *
 *   GET /reports/expense/categories?from&to     GET /reports/expense/items?from&to&category     GET /reports/expense/list?from&to&category&q
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { addDaysISO, businessToday } from '../utils/dates.js';

const R = toRupees;
const range = async (query, businessId) => {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : await businessToday(businessId);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : addDaysISO(to, -30);
  return { from, to };
};
const days = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const NONE = '(no description)';

/* the outlet filter as one extra parameter after the given ones */
const scope = (req, n) => (req.tenant.scopeBranchId == null ? { sql: '', args: [] } : { sql: ` AND branch_id = $${n}`, args: [req.tenant.scopeBranchId] });

/* by category: count, total, share, average, the biggest single expense, and the change on the period just before */
export const byCategory = async (req, res) => {
  const businessId = req.tenant.businessId;
  const { from, to } = await range(req.query, businessId);
  const span = days(from, to); const prevTo = addDaysISO(from, -1); const prevFrom = addDaysISO(from, -span);
  const b = scope(req, 4);
  const q = (a, z) => pool.query(
    `SELECT category, COUNT(*)::int AS n, SUM(amount_paise) AS paise, MAX(amount_paise) AS biggest
     FROM expenses WHERE business_id = $1 AND expense_date BETWEEN $2 AND $3${b.sql} GROUP BY category`, [businessId, a, z, ...b.args]);
  const [now, before, methods] = await Promise.all([
    q(from, to), q(prevFrom, prevTo),
    pool.query(`SELECT payment_method AS method, SUM(amount_paise) AS paise FROM expenses WHERE business_id = $1 AND expense_date BETWEEN $2 AND $3${b.sql} GROUP BY payment_method ORDER BY paise DESC`, [businessId, from, to, ...b.args])
  ]);
  const prevBy = new Map(before.rows.map((r) => [r.category, Number(r.paise)]));
  const total = now.rows.reduce((s, r) => s + Number(r.paise), 0);
  const prevTotal = before.rows.reduce((s, r) => s + Number(r.paise), 0);
  const rows = now.rows.map((r) => ({
    category: r.category, count: r.n, total: R(r.paise), share_pct: pct(Number(r.paise), total), average: R(Number(r.paise) / r.n), biggest: R(r.biggest),
    previous: R(prevBy.get(r.category) || 0), change_pct: prevBy.get(r.category) ? Math.round(((Number(r.paise) - prevBy.get(r.category)) / prevBy.get(r.category)) * 100) : null
  })).sort((a, b) => b.total - a.total);
  res.json({
    success: true,
    data: {
      range: { from, to }, previous_range: { from: prevFrom, to: prevTo },
      totals: { total: R(total), previous: R(prevTotal), change_pct: prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null, count: rows.reduce((s, r) => s + r.count, 0), per_day: R(total / span) },
      by_method: methods.rows.map((m) => ({ method: m.method, amount: R(m.paise) })), rows
    }
  });
};

/* by item: what the money was spent on, the same words grouped together (case and spacing ignored), optionally inside one category */
export const byItem = async (req, res) => {
  const businessId = req.tenant.businessId;
  const { from, to } = await range(req.query, businessId);
  const category = String(req.query.category || '').trim();
  const b = scope(req, 4);
  const cat = category ? ` AND category = $${4 + b.args.length}` : '';
  const { rows } = await pool.query(
    `SELECT lower(btrim(COALESCE(NULLIF(btrim(description), ''), '${NONE}'))) AS key, MIN(COALESCE(NULLIF(btrim(description), ''), '${NONE}')) AS name, MIN(category) AS category,
            COUNT(DISTINCT category)::int AS categories, COUNT(*)::int AS n, SUM(amount_paise) AS paise, MAX(expense_date)::text AS last_date
     FROM expenses WHERE business_id = $1 AND expense_date BETWEEN $2 AND $3${b.sql}${cat} GROUP BY 1 ORDER BY paise DESC LIMIT 500`,
    [businessId, from, to, ...b.args, ...(category ? [category] : [])]);
  const total = rows.reduce((s, r) => s + Number(r.paise), 0);
  res.json({
    success: true,
    data: {
      range: { from, to }, category: category || null, totals: { total: R(total), items: rows.length },
      rows: rows.map((r) => ({ name: r.name, category: r.categories > 1 ? null : r.category, count: r.n, total: R(r.paise), share_pct: pct(Number(r.paise), total), last_date: r.last_date }))
    }
  });
};

/* the transactions themselves, newest first */
export const list = async (req, res) => {
  const businessId = req.tenant.businessId;
  const { from, to } = await range(req.query, businessId);
  const category = String(req.query.category || '').trim();
  const text = String(req.query.q || '').trim().slice(0, 60);
  const b = scope(req, 4);
  const args = [businessId, from, to, ...b.args];
  let more = '';
  if (category) { args.push(category); more += ` AND category = $${args.length}`; }
  if (text) { args.push(text); more += ` AND (category ILIKE '%' || $${args.length} || '%' OR COALESCE(description, '') ILIKE '%' || $${args.length} || '%')`; }
  const { rows } = await pool.query(
    `SELECT expense_id, expense_date::text AS date, category, description, payment_method, amount_paise FROM expenses
     WHERE business_id = $1 AND expense_date BETWEEN $2 AND $3${b.sql}${more} ORDER BY expense_date DESC, expense_id DESC LIMIT 2001`, args);
  const shown = rows.slice(0, 2000);
  res.json({
    success: true,
    data: {
      range: { from, to }, truncated: rows.length > 2000, totals: { total: R(shown.reduce((s, r) => s + Number(r.amount_paise), 0)), count: shown.length },
      rows: shown.map((r) => ({ expense_id: r.expense_id, date: r.date, category: r.category, description: r.description || '', method: r.payment_method, amount: R(r.amount_paise) }))
    }
  });
};
