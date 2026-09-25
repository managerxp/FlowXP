/*
 * Outlets (the `branches` table): list, create, edit, close, and compare.
 *
 * A business is the organisation; each outlet has its own tables, stock,
 * orders and staff. Who may see which outlet is decided in middleware/auth.js;
 * this file only manages the outlets themselves.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { periodCosts, profitability } from '../modules/profitability.js';
import { addDaysISO, businessToday } from '../utils/dates.js';
import { toRupees } from '../utils/money.js';
import { checkGstin, checkName, firstError } from '../utils/validate.js';

const COLUMNS = 'branch_id, name, code, address, phone, city, state, gstin, is_primary, status';

/* GET /api/outlets — a pinned user sees only their own outlet */
export const list = async (req, res) => {
  const values = [req.tenant.businessId];
  let scope = '';
  if (req.tenant.pinned) { values.push(req.tenant.branchId); scope = ' AND branch_id = $2'; }
  const status = req.query.include_closed === 'true' && !req.tenant.pinned ? '' : " AND status = 'ACTIVE'";
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM branches WHERE business_id = $1${status}${scope} ORDER BY is_primary DESC, branch_id`, values
  );
  res.json({ success: true, data: rows });
};

const clean = (body) => ({
  name: body.name != null ? String(body.name).trim() : undefined,
  code: body.code != null ? String(body.code).trim().toUpperCase().slice(0, 12) || null : undefined,
  address: body.address != null ? String(body.address).trim() || null : undefined,
  phone: body.phone != null ? String(body.phone).trim().slice(0, 32) || null : undefined,
  city: body.city != null ? String(body.city).trim().slice(0, 80) || null : undefined,
  state: body.state != null ? String(body.state).trim().slice(0, 60) || null : undefined,
  gstin: body.gstin != null ? String(body.gstin).trim().toUpperCase() || null : undefined
});

const validate = (c) => firstError([
  c.name !== undefined ? checkName(c.name, 'Outlet name') : null,
  c.gstin ? checkGstin(c.gstin) : null
]);

/* How many outlets the plan allows (NULL / missing = unlimited). */
const outletLimit = async (businessId) => {
  const { rows } = await pool.query(`SELECT p.limits FROM businesses b JOIN plans p ON p.plan_code = b.plan_code WHERE b.business_id = $1`, [businessId]);
  const limit = rows[0]?.limits?.outlets;
  return limit == null ? null : Number(limit);
};

const activeCount = async (businessId) =>
  Number((await pool.query(`SELECT COUNT(*) AS n FROM branches WHERE business_id = $1 AND status = 'ACTIVE'`, [businessId])).rows[0].n);

/* POST /api/outlets */
export const create = async (req, res) => {
  const c = clean(req.body || {});
  const error = validate({ ...c, name: c.name ?? '' });
  if (error) return res.status(400).json({ success: false, message: error });

  const limit = await outletLimit(req.tenant.businessId);
  if (limit != null && (await activeCount(req.tenant.businessId)) >= limit) {
    return res.status(402).json({ success: false, code: 'OUTLET_LIMIT', message: `Your plan includes ${limit} outlet${limit === 1 ? '' : 's'}. Upgrade to add more.` });
  }
  try {
    const { rows } = await pool.query(
      `INSERT INTO branches (business_id, name, code, address, phone, city, state, gstin) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${COLUMNS}`,
      [req.tenant.businessId, c.name, c.code ?? null, c.address ?? null, c.phone ?? null, c.city ?? null, c.state ?? null, c.gstin ?? null]
    );
    recordAudit(req, { action: 'outlet.created', resource_type: 'branch', resource_id: rows[0].branch_id, metadata: { name: c.name } });
    res.status(201).json({ success: true, data: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ success: false, message: 'You already have an outlet with that name' });
    throw e;
  }
};

/* PUT /api/outlets/:id — edit details, or close / reopen */
export const update = async (req, res) => {
  const body = req.body || {};
  const c = clean(body);
  const error = validate(c);
  if (error) return res.status(400).json({ success: false, message: error });

  const current = (await pool.query(`SELECT ${COLUMNS} FROM branches WHERE branch_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!current) return res.status(404).json({ success: false, message: 'Not found' });

  if (body.status && body.status !== current.status) {
    if (!['ACTIVE', 'CLOSED'].includes(body.status)) return res.status(400).json({ success: false, message: 'Status must be ACTIVE or CLOSED' });
    if (body.status === 'CLOSED') {
      if (current.is_primary) return res.status(400).json({ success: false, message: 'The main outlet can’t be closed' });
      const open = Number((await pool.query(`SELECT COUNT(*) AS n FROM orders WHERE branch_id = $1 AND status IN ('OPEN','PREPARING','READY','SERVED')`, [current.branch_id])).rows[0].n);
      if (open) return res.status(409).json({ success: false, message: `${open} open order${open === 1 ? '' : 's'} at this outlet — bill or cancel them first` });
      const stock = Number((await pool.query(`SELECT COUNT(*) AS n FROM branch_stock WHERE branch_id = $1 AND quantity <> 0`, [current.branch_id])).rows[0].n);
      if (stock) return res.status(409).json({ success: false, message: 'This outlet still holds stock — transfer it to another outlet first' });
    } else {
      const limit = await outletLimit(req.tenant.businessId);
      if (limit != null && (await activeCount(req.tenant.businessId)) >= limit) {
        return res.status(402).json({ success: false, code: 'OUTLET_LIMIT', message: `Your plan includes ${limit} outlet${limit === 1 ? '' : 's'}. Upgrade to reopen this one.` });
      }
    }
  }

  const sets = []; const values = [];
  for (const [key, value] of Object.entries(c)) if (value !== undefined) { values.push(value); sets.push(`${key} = $${values.length}`); }
  if (body.status && body.status !== current.status) { values.push(body.status); sets.push(`status = $${values.length}`); }
  if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to update' });
  values.push(current.branch_id);
  try {
    const { rows } = await pool.query(`UPDATE branches SET ${sets.join(', ')} WHERE branch_id = $${values.length} RETURNING ${COLUMNS}`, values);
    recordAudit(req, { action: body.status && body.status !== current.status ? `outlet.${body.status === 'CLOSED' ? 'closed' : 'reopened'}` : 'outlet.updated', resource_type: 'branch', resource_id: current.branch_id });
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ success: false, message: 'You already have an outlet with that name' });
    throw e;
  }
};

/* GET /api/outlets/compare?from=&to= — the same profitability maths, once per outlet. Rows add up to the business total. */
export const compare = async (req, res) => {
  const to = req.query.to || await businessToday(req.tenant.businessId);
  const from = req.query.from || addDaysISO(to, -29);
  const id = req.tenant.businessId;
  const outlets = (await pool.query(`SELECT branch_id, name, is_primary FROM branches WHERE business_id = $1 AND status = 'ACTIVE' ORDER BY is_primary DESC, branch_id`, [id])).rows;

  const rows = await Promise.all(outlets.map(async (o) => {
    const [p, costs] = await Promise.all([profitability(id, from, to, pool, o.branch_id), periodCosts(id, from, to, pool, o.branch_id)]);
    const t = p.totals;
    return {
      branch_id: o.branch_id, name: o.name, is_primary: o.is_primary,
      orders: t.invoices,
      net_revenue: toRupees(t.net_revenue),
      average_order: t.invoices ? toRupees(Math.round(t.net_revenue / t.invoices)) : null,
      food_cost_pct: t.food_cost_pct,
      contribution: toRupees(t.contribution),
      contribution_margin_pct: t.contribution_margin_pct,
      discount: toRupees(t.discount),
      discount_pct: t.net_revenue + t.discount > 0 ? Math.round((t.discount / (t.net_revenue + t.discount)) * 1000) / 10 : null,
      refunded: toRupees(t.refunded),
      wastage: toRupees(costs.wastage),
      expenses: toRupees(costs.expenses_total),
      estimated_net: toRupees(t.contribution - costs.expenses_total - costs.wastage)
    };
  }));
  const sum = (k) => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100;
  res.json({
    success: true,
    data: {
      period: { from, to },
      outlets: rows,
      totals: { orders: rows.reduce((s, r) => s + r.orders, 0), net_revenue: sum('net_revenue'), contribution: sum('contribution'), discount: sum('discount'), refunded: sum('refunded'), wastage: sum('wastage'), expenses: sum('expenses'), estimated_net: sum('estimated_net') }
    }
  });
};
