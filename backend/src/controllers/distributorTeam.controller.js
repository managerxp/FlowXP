/*
 * The distributor's sales team: targets and achievement, commission rules and statements, retailer visits, and the
 * field rep's day (today's beat with what each retailer owes and whether they have been visited).
 *
 * Nothing here stores a result. Achievement and commission are read from the sales facts (modules/distributor/facts.js),
 * outstanding from the ledger, so every number is the one the books show.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { WholesaleError, audit, bool, diff, getSettings, int, isoDate, like, money, num, ok, oneOf, page, paging, text, today, wrapAll } from '../modules/distributor/common.js';
import { actualFor, periodBounds, progress } from '../modules/distributor/targets.js';
import { computeCommission } from '../modules/distributor/commission.js';
import { customerBalances } from '../modules/wholesale/ledger.js';
import { creditPosition } from '../modules/wholesale/credit.js';

const rupees = (v) => toRupees(Number(v || 0));
const SCOPES = ['BUSINESS', 'SALESPERSON', 'TERRITORY', 'BRAND', 'CATEGORY', 'PRODUCT', 'CUSTOMER'];
const SCOPE_TABLE = { SALESPERSON: ['wholesale_salespeople', 'salesperson_id', 'name'], TERRITORY: ['dist_territories', 'territory_id', 'name'], BRAND: ['brands', 'brand_id', 'name'], CATEGORY: ['categories', 'category_id', 'name'], PRODUCT: ['products', 'product_id', 'name'], CUSTOMER: ['customers', 'customer_id', 'name'] };

/** The salesperson row behind a field / sales login (null for managers, 0 when a rep has no profile). */
export const myRep = async (req) => {
  if (!['SALES_EXECUTIVE', 'FIELD_SALES', 'COLLECTION_EXECUTIVE'].includes(req.tenant.role)) return null;
  const row = (await pool.query(`SELECT salesperson_id FROM wholesale_salespeople WHERE business_id = $1 AND user_id = $2 AND status = 'ACTIVE'`, [req.tenant.businessId, req.auth.userId])).rows[0];
  return row ? row.salesperson_id : 0;
};

/* ═══ targets ═══════════════════════════════════════════════════════════════════════ */

const targetShape = (t, name, prog, metric) => ({
  target_id: t.target_id, scope_type: t.scope_type, scope_id: t.scope_id, scope_name: name ?? (t.scope_type === 'BUSINESS' ? 'Whole business' : null), period_type: t.period_type,
  period_start: String(t.period_start).slice(0, 10), period_end: String(t.period_end).slice(0, 10), metric: t.metric, notes: t.notes,
  target: metric === 'QTY' ? prog.target : rupees(prog.target), actual: metric === 'QTY' ? prog.actual : rupees(prog.actual), remaining: metric === 'QTY' ? prog.remaining : rupees(prog.remaining),
  required_per_day: metric === 'QTY' ? prog.required_per_day : rupees(prog.required_per_day), achievement_pct: prog.achievement_pct, days_left: prog.days_left, days_total: prog.days_total, status: prog.status
});

const scopeNames = async (businessId, targets) => {
  const names = new Map();
  for (const type of Object.keys(SCOPE_TABLE)) {
    const ids = [...new Set(targets.filter((t) => t.scope_type === type).map((t) => t.scope_id))];
    if (!ids.length) continue;
    const [table, idCol, nameCol] = SCOPE_TABLE[type];
    for (const r of (await pool.query(`SELECT ${idCol} AS id, ${nameCol} AS name FROM ${table} WHERE business_id = $1 AND ${idCol} = ANY($2::int[])`, [businessId, ids])).rows) names.set(`${type}:${r.id}`, r.name);
  }
  return names;
};

/* GET /targets?on=&scope_type=&scope_id=&period_type=&all=1 — targets running on a date (default today), with progress */
const listTargets = async (req, res) => {
  const on = isoDate(req.query.on, 'Date') || await today(pool, req.tenant.businessId);
  const values = [req.tenant.businessId]; const where = ['t.business_id = $1'];
  if (req.query.all !== '1') { values.push(on); where.push(`t.period_start <= $${values.length}::date AND t.period_end >= $${values.length}::date`); }
  if (req.query.scope_type) { values.push(oneOf(req.query.scope_type, 'Scope', SCOPES, { required: true })); where.push(`t.scope_type = $${values.length}`); }
  if (req.query.scope_id) { values.push(Number(req.query.scope_id) || 0); where.push(`t.scope_id = $${values.length}`); }
  if (req.query.period_type) { values.push(String(req.query.period_type).toUpperCase()); where.push(`t.period_type = $${values.length}`); }
  const mine = await myRep(req);
  if (mine != null) { values.push(mine); where.push(`t.scope_type = 'SALESPERSON' AND t.scope_id = $${values.length}`); }
  const rows = (await pool.query(`SELECT t.* FROM dist_targets t WHERE ${where.join(' AND ')} ORDER BY t.period_start DESC, t.scope_type, t.target_id LIMIT 500`, values)).rows;
  const names = await scopeNames(req.tenant.businessId, rows);
  const out = [];
  for (const t of rows) {
    const a = await actualFor(pool, { businessId: req.tenant.businessId, scopeType: t.scope_type, scopeId: t.scope_id, metric: t.metric, from: String(t.period_start).slice(0, 10), to: String(t.period_end).slice(0, 10) });
    out.push(targetShape(t, names.get(`${t.scope_type}:${t.scope_id}`), progress(t, a.actual, on), t.metric));
  }
  ok(res, out);
};

const targetInput = async (req, b) => {
  const scopeType = oneOf(b.scope_type, 'Scope', SCOPES, { required: true });
  const scopeId = scopeType === 'BUSINESS' ? null : int(b.scope_id, 'Scope', { min: 1, required: true });
  if (scopeId != null) {
    const [table, idCol] = SCOPE_TABLE[scopeType];
    if (!(await pool.query(`SELECT 1 FROM ${table} WHERE business_id = $1 AND ${idCol} = $2`, [req.tenant.businessId, scopeId])).rowCount) throw new WholesaleError(400, `That ${scopeType.toLowerCase()} was not found`);
  }
  const periodType = oneOf(b.period_type, 'Period', ['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'], { required: true });
  const anchor = isoDate(b.period_start || b.date, 'Start date') || await today(pool, req.tenant.businessId);
  const [start, end] = periodBounds(periodType, anchor);
  const metric = oneOf(b.metric, 'Measure', ['VALUE', 'QTY'], { fallback: 'VALUE' });
  const amount = metric === 'QTY' ? num(b.target, 'Target', { min: 0.001, required: true }) : money(b.target, 'Target', { min: 100, required: true });
  return { scope_type: scopeType, scope_id: scopeId, period_type: periodType, period_start: start, period_end: end, metric, target_amount: amount, notes: text(b.notes, 'Notes', { max: 300 }) };
};

/** Insert or replace the target for the same scope, period and measure — setting a target twice changes it, never duplicates it. */
const upsertTarget = async (req, t) => {
  const before = (await pool.query(
    `SELECT * FROM dist_targets WHERE business_id = $1 AND scope_type = $2 AND COALESCE(scope_id, 0) = COALESCE($3::int, 0) AND period_type = $4 AND period_start = $5 AND metric = $6`,
    [req.tenant.businessId, t.scope_type, t.scope_id, t.period_type, t.period_start, t.metric])).rows[0];
  if (before) {
    const row = (await pool.query(`UPDATE dist_targets SET target_amount = $2, notes = $3 WHERE target_id = $1 RETURNING *`, [before.target_id, t.target_amount, t.notes])).rows[0];
    audit(req, 'distributor.target_changed', 'target', row.target_id, null, null, { changes: diff({ target: Number(before.target_amount) }, { target: Number(row.target_amount) }), scope: `${t.scope_type}:${t.scope_id ?? ''}`, period: t.period_start });
    return { row, created: false };
  }
  const row = (await pool.query(
    `INSERT INTO dist_targets (business_id, scope_type, scope_id, period_type, period_start, period_end, metric, target_amount, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [req.tenant.businessId, t.scope_type, t.scope_id, t.period_type, t.period_start, t.period_end, t.metric, t.target_amount, t.notes, req.auth.userId])).rows[0];
  audit(req, 'distributor.target_set', 'target', row.target_id, null, { scope: `${t.scope_type}:${t.scope_id ?? ''}`, period: t.period_start, target: Number(t.target_amount), metric: t.metric });
  return { row, created: true };
};

const setTarget = async (req, res) => {
  const { row, created } = await upsertTarget(req, await targetInput(req, req.body || {}));
  const on = await today(pool, req.tenant.businessId);
  const a = await actualFor(pool, { businessId: req.tenant.businessId, scopeType: row.scope_type, scopeId: row.scope_id, metric: row.metric, from: String(row.period_start).slice(0, 10), to: String(row.period_end).slice(0, 10) });
  ok(res, targetShape(row, (await scopeNames(req.tenant.businessId, [row])).get(`${row.scope_type}:${row.scope_id}`), progress(row, a.actual, on), row.metric), created ? 201 : 200);
};

/* POST /targets/bulk { targets: [{ scope_type, scope_id, period_type, period_start, target, metric? }] } — a whole month's targets in one go */
const bulkTargets = async (req, res) => {
  const list = Array.isArray(req.body?.targets) ? req.body.targets : [];
  if (!list.length) throw new WholesaleError(400, 'Add at least one target');
  if (list.length > 1000) throw new WholesaleError(400, 'Upload up to 1,000 targets at a time');
  const parsed = []; const errors = [];
  for (const [i, b] of list.entries()) {
    try { parsed.push(await targetInput(req, b)); } catch (e) { if (e.status === 400) errors.push({ row: i + 1, message: e.message }); else throw e; }
  }
  if (errors.length) return res.status(400).json({ success: false, message: `${errors.length} row${errors.length === 1 ? '' : 's'} could not be read. Nothing was saved.`, data: { errors: errors.slice(0, 50) } });
  let created = 0; let changed = 0;
  for (const t of parsed) { (await upsertTarget(req, t)).created ? created++ : changed++; }
  ok(res, { created, changed });
};

const deleteTarget = async (req, res) => {
  const hit = await pool.query(`DELETE FROM dist_targets WHERE business_id = $1 AND target_id = $2 RETURNING scope_type, scope_id, period_start, target_amount`, [req.tenant.businessId, req.params.id]);
  if (!hit.rowCount) throw new WholesaleError(404, 'Not found');
  audit(req, 'distributor.target_deleted', 'target', Number(req.params.id), hit.rows[0]);
  ok(res, { deleted: true });
};

/* ═══ commission ════════════════════════════════════════════════════════════════════ */

const ruleShape = (r, scopeName) => ({
  rule_id: r.rule_id, name: r.name, basis: r.basis, scope_type: r.scope_type, scope_id: r.scope_id, scope_name: scopeName ?? null, salesperson_id: r.salesperson_id,
  rate_pct: r.rate_pct == null ? null : Number(r.rate_pct), per_unit: r.per_unit_paise == null ? null : rupees(r.per_unit_paise), min_achievement_pct: r.min_achievement_pct == null ? null : Number(r.min_achievement_pct),
  starts_on: r.starts_on, ends_on: r.ends_on, priority: r.priority, is_active: r.is_active
});

const RULE_SCOPE = { BRAND: SCOPE_TABLE.BRAND, PRODUCT: SCOPE_TABLE.PRODUCT, CATEGORY: SCOPE_TABLE.CATEGORY, TERRITORY: SCOPE_TABLE.TERRITORY, CUSTOMER: SCOPE_TABLE.CUSTOMER };

const ruleFields = async (req, b, partial) => {
  const f = {}; const has = (k) => !partial || k in b;
  if (has('name')) f.name = text(b.name, 'Name', { max: 100, min: 2, required: true });
  if (has('basis')) f.basis = oneOf(b.basis, 'Basis', ['VALUE', 'QTY', 'MARGIN'], { required: true });
  if (has('scope_type')) {
    f.scope_type = oneOf(b.scope_type, 'Applies to', ['ALL', 'BRAND', 'PRODUCT', 'CATEGORY', 'TERRITORY', 'CUSTOMER'], { fallback: 'ALL' });
    f.scope_id = f.scope_type === 'ALL' ? null : int(b.scope_id, 'Scope', { min: 1, required: true });
    if (f.scope_id != null) {
      const [table, idCol] = RULE_SCOPE[f.scope_type];
      if (!(await pool.query(`SELECT 1 FROM ${table} WHERE business_id = $1 AND ${idCol} = $2`, [req.tenant.businessId, f.scope_id])).rowCount) throw new WholesaleError(400, `That ${f.scope_type.toLowerCase()} was not found`);
    }
  }
  if ('salesperson_id' in b) {
    f.salesperson_id = int(b.salesperson_id, 'Salesperson', { min: 1 });
    if (f.salesperson_id != null && !(await pool.query(`SELECT 1 FROM wholesale_salespeople WHERE business_id = $1 AND salesperson_id = $2`, [req.tenant.businessId, f.salesperson_id])).rowCount) throw new WholesaleError(400, 'That salesperson was not found');
  }
  if ('rate_pct' in b) f.rate_pct = num(b.rate_pct, 'Rate', { min: 0, max: 100 });
  if ('per_unit' in b) f.per_unit_paise = b.per_unit === '' || b.per_unit == null ? null : money(b.per_unit, 'Amount per unit', { min: 0 });
  if ('min_achievement_pct' in b) f.min_achievement_pct = num(b.min_achievement_pct, 'Minimum achievement', { min: 0, max: 1000 });
  if ('starts_on' in b) f.starts_on = isoDate(b.starts_on, 'Start date');
  if ('ends_on' in b) f.ends_on = isoDate(b.ends_on, 'End date');
  if (f.starts_on && f.ends_on && f.ends_on < f.starts_on) throw new WholesaleError(400, 'The rule cannot end before it starts');
  if ('priority' in b) f.priority = int(b.priority, 'Priority', { min: -100, max: 100 }) ?? 0;
  if ('is_active' in b) f.is_active = bool(b.is_active);
  return f;
};

const checkRule = (f, existing = null) => {
  const m = { ...existing, ...f };
  if (m.basis === 'QTY') { if (m.per_unit_paise == null) throw new WholesaleError(400, 'Enter the amount paid per unit'); f.rate_pct = null; }
  else { if (m.rate_pct == null) throw new WholesaleError(400, 'Enter the commission percentage'); f.per_unit_paise = null; }
};

const listRules = async (req, res) => {
  const rows = (await pool.query(`SELECT * FROM dist_commission_rules WHERE business_id = $1 ORDER BY is_active DESC, priority DESC, rule_id`, [req.tenant.businessId])).rows;
  const names = await scopeNames(req.tenant.businessId, rows.filter((r) => r.scope_id).map((r) => ({ scope_type: r.scope_type, scope_id: r.scope_id })));
  ok(res, rows.map((r) => ruleShape(r, names.get(`${r.scope_type}:${r.scope_id}`))));
};

const createRule = async (req, res) => {
  const f = await ruleFields(req, req.body || {}, false); checkRule(f);
  const keys = Object.keys(f);
  const row = (await pool.query(`INSERT INTO dist_commission_rules (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`, [req.tenant.businessId, ...keys.map((k) => f[k])])).rows[0];
  audit(req, 'distributor.commission_rule_created', 'commission_rule', row.rule_id, null, f);
  ok(res, ruleShape(row), 201);
};

const updateRule = async (req, res) => {
  const before = (await pool.query(`SELECT * FROM dist_commission_rules WHERE business_id = $1 AND rule_id = $2`, [req.tenant.businessId, req.params.id])).rows[0];
  if (!before) throw new WholesaleError(404, 'Not found');
  const f = await ruleFields(req, req.body || {}, true); checkRule(f, before);
  const keys = Object.keys(f); if (!keys.length) throw new WholesaleError(400, 'Nothing to update');
  const after = (await pool.query(`UPDATE dist_commission_rules SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE business_id = $1 AND rule_id = $2 RETURNING *`, [req.tenant.businessId, before.rule_id, ...keys.map((k) => f[k])])).rows[0];
  audit(req, 'distributor.commission_rule_updated', 'commission_rule', before.rule_id, null, null, { changes: diff(ruleShape(before), ruleShape(after)) });
  ok(res, ruleShape(after));
};

const deleteRule = async (req, res) => {
  const hit = await pool.query(`DELETE FROM dist_commission_rules WHERE business_id = $1 AND rule_id = $2 RETURNING name`, [req.tenant.businessId, req.params.id]);
  if (!hit.rowCount) throw new WholesaleError(404, 'Not found');
  audit(req, 'distributor.commission_rule_deleted', 'commission_rule', Number(req.params.id), hit.rows[0]);
  ok(res, { deleted: true });
};

/* GET /commission?from=&to=&salesperson_id= — each salesperson's commission for the period, line by line */
const commissionStatement = async (req, res) => {
  const to = isoDate(req.query.to, 'To') || await today(pool, req.tenant.businessId);
  const from = isoDate(req.query.from, 'From') || `${to.slice(0, 8)}01`;
  const mine = await myRep(req);
  const rows = await computeCommission(pool, { businessId: req.tenant.businessId, from, to, salespersonId: mine != null ? mine : (Number(req.query.salesperson_id) || null) });
  ok(res, {
    from, to, total: rupees(rows.reduce((s, r) => s + r.commission, 0)),
    salespeople: rows.map((r) => ({ salesperson_id: r.salesperson_id, name: r.name, sales: rupees(r.sales), units: r.units, margin: rupees(r.margin), collections: rupees(r.collections), achievement_pct: r.achievement_pct, commission: rupees(r.commission),
      lines: r.lines.map((l) => ({ rule: l.rule, rule_id: l.rule_id, basis: l.basis, base: l.basis === 'QTY' ? l.base : rupees(l.base), amount: rupees(l.amount) })) }))
  });
};

/* ═══ team ══════════════════════════════════════════════════════════════════════════ */

/* GET /team — the sales team at a glance: role, territory, customers, this month's sales and target */
const team = async (req, res) => {
  const on = await today(pool, req.tenant.businessId);
  const [from, to] = periodBounds('MONTHLY', on);
  const reps = (await pool.query(
    `SELECT s.*, t.name AS territory_name, (SELECT COUNT(*) FROM wholesale_customer_profiles w WHERE w.salesperson_id = s.salesperson_id) AS customers,
            (SELECT COUNT(*) FROM dist_beats b WHERE b.salesperson_id = s.salesperson_id AND b.status = 'ACTIVE') AS beats
     FROM wholesale_salespeople s LEFT JOIN dist_territories t ON t.territory_id = s.territory_id
     WHERE s.business_id = $1 AND s.status = $2 ORDER BY lower(s.name)`, [req.tenant.businessId, String(req.query.status || 'ACTIVE').toUpperCase() === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'])).rows;
  const out = [];
  for (const r of reps) {
    const a = await actualFor(pool, { businessId: req.tenant.businessId, scopeType: 'SALESPERSON', scopeId: r.salesperson_id, from, to });
    const target = (await pool.query(`SELECT * FROM dist_targets WHERE business_id = $1 AND scope_type = 'SALESPERSON' AND scope_id = $2 AND period_type = 'MONTHLY' AND period_start = $3::date AND metric = 'VALUE'`, [req.tenant.businessId, r.salesperson_id, from])).rows[0];
    out.push({
      salesperson_id: r.salesperson_id, name: r.name, phone: r.phone, email: r.email, employee_id: r.employee_id, sales_role: r.sales_role, territory_id: r.territory_id, territory: r.territory_name,
      user_id: r.user_id, manager_id: r.manager_id, status: r.status, commission_pct: Number(r.commission_pct), customers: Number(r.customers), beats: Number(r.beats),
      month_sales: rupees(a.revenue), month_target: target ? rupees(target.target_amount) : null, achievement_pct: target ? progress(target, a.revenue, on).achievement_pct : null
    });
  }
  ok(res, out);
};

/* ═══ visits ════════════════════════════════════════════════════════════════════════ */

const visitShape = (v) => ({
  visit_id: v.visit_id, customer_id: v.customer_id, customer: v.customer_name, salesperson_id: v.salesperson_id, salesperson: v.salesperson_name, beat_id: v.beat_id, beat: v.beat_name,
  visit_date: v.visit_date, visited_at: v.visited_at, outcome: v.outcome, notes: v.notes, next_visit_date: v.next_visit_date,
  ...(v.lat != null ? { lat: Number(v.lat), lng: Number(v.lng) } : {}),
  order_value: rupees(v.order_value), collection: rupees(v.collection)
});

const VISIT_SELECT = `
  SELECT v.*, c.name AS customer_name, s.name AS salesperson_name, b.name AS beat_name,
         COALESCE((SELECT SUM(o.total_paise) FROM wholesale_sales_orders o WHERE o.visit_id = v.visit_id AND o.status NOT IN ('CANCELLED','REJECTED')), 0) AS order_value,
         COALESCE((SELECT SUM(r.amount_paise) FROM wholesale_receipts r WHERE r.visit_id = v.visit_id AND r.status = 'POSTED' AND r.kind = 'RECEIPT'), 0) AS collection
  FROM dist_visits v JOIN customers c ON c.customer_id = v.customer_id LEFT JOIN wholesale_salespeople s ON s.salesperson_id = v.salesperson_id LEFT JOIN dist_beats b ON b.beat_id = v.beat_id`;

/** May this rep work this retailer? Their own customer, or one on a beat of theirs. */
const mayWork = async (businessId, repId, customerId) => (await pool.query(
  `SELECT 1 FROM wholesale_customer_profiles w WHERE w.customer_id = $2 AND w.salesperson_id = $1
   UNION SELECT 1 FROM dist_beat_customers bc JOIN dist_beats b ON b.beat_id = bc.beat_id WHERE bc.business_id = $3 AND bc.customer_id = $2 AND b.salesperson_id = $1 LIMIT 1`, [repId, customerId, businessId])).rowCount > 0;

/* POST /visits { customer_id, outcome, notes?, next_visit_date?, beat_id?, visit_date?, client_ref?, lat?, lng?, salesperson_id? } */
const recordVisit = async (req, res) => {
  const b = req.body || {};
  const customerId = int(b.customer_id, 'Retailer', { min: 1, required: true });
  const clientRef = text(b.client_ref, 'Reference', { max: 64 });
  if (clientRef) {
    const dup = (await pool.query(`${VISIT_SELECT} WHERE v.business_id = $1 AND v.client_ref = $2`, [req.tenant.businessId, clientRef])).rows[0];
    if (dup) return ok(res, visitShape(dup));   // a visit replayed from the offline queue is still one visit
  }
  const customer = (await pool.query(`SELECT c.customer_id, w.salesperson_id FROM customers c LEFT JOIN wholesale_customer_profiles w ON w.customer_id = c.customer_id WHERE c.business_id = $1 AND c.customer_id = $2`, [req.tenant.businessId, customerId])).rows[0];
  if (!customer) throw new WholesaleError(400, 'Choose a retailer from your list');
  const mine = await myRep(req);
  const repId = mine != null ? mine : (int(b.salesperson_id, 'Salesperson', { min: 1 }) ?? customer.salesperson_id ?? null);
  if (mine === 0) throw new WholesaleError(403, 'Your login is not linked to a salesperson yet');
  if (mine != null && !(await mayWork(req.tenant.businessId, mine, customerId))) throw new WholesaleError(403, 'That retailer is not on your beats');
  if (repId && !(await pool.query(`SELECT 1 FROM wholesale_salespeople WHERE business_id = $1 AND salesperson_id = $2`, [req.tenant.businessId, repId])).rowCount) throw new WholesaleError(400, 'That salesperson was not found');
  const beatId = int(b.beat_id, 'Beat', { min: 1 });
  if (beatId && !(await pool.query(`SELECT 1 FROM dist_beats WHERE business_id = $1 AND beat_id = $2`, [req.tenant.businessId, beatId])).rowCount) throw new WholesaleError(400, 'That beat was not found');
  const settings = await getSettings(pool, req.tenant.businessId);
  const lat = settings.visit_location ? num(b.lat, 'Latitude', { min: -90, max: 90 }) : null;
  const lng = settings.visit_location ? num(b.lng, 'Longitude', { min: -180, max: 180 }) : null;
  const date = isoDate(b.visit_date, 'Visit date') || await today(pool, req.tenant.businessId);
  let id;
  try {
    id = (await pool.query(
      `INSERT INTO dist_visits (business_id, customer_id, salesperson_id, beat_id, visit_date, outcome, notes, next_visit_date, lat, lng, client_ref, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING visit_id`,
      [req.tenant.businessId, customerId, repId, beatId, date, oneOf(b.outcome, 'Outcome', ['ORDER', 'COLLECTION', 'NO_ORDER', 'CLOSED', 'NOT_AVAILABLE', 'FOLLOW_UP'], { required: true }),
        text(b.notes, 'Notes', { max: 500 }), isoDate(b.next_visit_date, 'Next visit'), lat, lng, clientRef, req.auth.userId])).rows[0].visit_id;
  } catch (e) {
    if (e.code === '23505') { const dup = (await pool.query(`${VISIT_SELECT} WHERE v.business_id = $1 AND v.client_ref = $2`, [req.tenant.businessId, clientRef])).rows[0]; return ok(res, visitShape(dup)); }
    throw e;
  }
  ok(res, visitShape((await pool.query(`${VISIT_SELECT} WHERE v.visit_id = $1`, [id])).rows[0]), 201);
};

/* PATCH /visits/:id { outcome?, notes?, next_visit_date? } — a visit's outcome is updated as the order and payment come in */
const updateVisit = async (req, res) => {
  const b = req.body || {};
  const v = (await pool.query(`SELECT * FROM dist_visits WHERE business_id = $1 AND visit_id = $2`, [req.tenant.businessId, req.params.id])).rows[0];
  if (!v) throw new WholesaleError(404, 'Not found');
  const mine = await myRep(req);
  if (mine != null && v.salesperson_id !== mine) throw new WholesaleError(404, 'Not found');
  const f = {};
  if ('outcome' in b) f.outcome = oneOf(b.outcome, 'Outcome', ['ORDER', 'COLLECTION', 'NO_ORDER', 'CLOSED', 'NOT_AVAILABLE', 'FOLLOW_UP'], { required: true });
  if ('notes' in b) f.notes = text(b.notes, 'Notes', { max: 500 });
  if ('next_visit_date' in b) f.next_visit_date = isoDate(b.next_visit_date, 'Next visit');
  const keys = Object.keys(f); if (!keys.length) throw new WholesaleError(400, 'Nothing to update');
  await pool.query(`UPDATE dist_visits SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE business_id = $1 AND visit_id = $2`, [req.tenant.businessId, v.visit_id, ...keys.map((k) => f[k])]);
  ok(res, visitShape((await pool.query(`${VISIT_SELECT} WHERE v.visit_id = $1`, [v.visit_id])).rows[0]));
};

/* GET /visits?salesperson_id=&customer_id=&beat_id=&outcome=&from=&to=&limit=&offset= */
const listVisits = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const values = [req.tenant.businessId]; const where = ['v.business_id = $1'];
  const mine = await myRep(req);
  if (mine != null) { values.push(mine); where.push(`v.salesperson_id = $${values.length}`); }
  else if (req.query.salesperson_id) { values.push(Number(req.query.salesperson_id) || 0); where.push(`v.salesperson_id = $${values.length}`); }
  if (req.query.customer_id) { values.push(Number(req.query.customer_id) || 0); where.push(`v.customer_id = $${values.length}`); }
  if (req.query.beat_id) { values.push(Number(req.query.beat_id) || 0); where.push(`v.beat_id = $${values.length}`); }
  if (req.query.outcome) { values.push(String(req.query.outcome).toUpperCase()); where.push(`v.outcome = $${values.length}`); }
  const from = isoDate(req.query.from, 'From'); const to = isoDate(req.query.to, 'To');
  if (from) { values.push(from); where.push(`v.visit_date >= $${values.length}`); }
  if (to) { values.push(to); where.push(`v.visit_date <= $${values.length}`); }
  if (req.query.q) { values.push(like(String(req.query.q).trim().slice(0, 80))); where.push(`c.name ILIKE $${values.length}`); }
  const base = `FROM dist_visits v JOIN customers c ON c.customer_id = v.customer_id WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(`${VISIT_SELECT} WHERE v.visit_id IN (SELECT v.visit_id ${base} ORDER BY v.visit_date DESC, v.visit_id DESC LIMIT $${values.length - 1} OFFSET $${values.length}) ORDER BY v.visit_date DESC, v.visit_id DESC`, values)).rows;
  page(res, rows.map(visitShape), total, pg);
};

/* ═══ the field rep's day ═══════════════════════════════════════════════════════════ */

/* GET /field/today?salesperson_id=&date= — today's beats for a rep, in visiting order, with outstanding and visit status */
const fieldToday = async (req, res) => {
  const businessId = req.tenant.businessId;
  const date = isoDate(req.query.date, 'Date') || await today(pool, businessId);
  const mine = await myRep(req);
  if (mine === 0) throw new WholesaleError(403, 'Your login is not linked to a salesperson yet');
  const repId = mine != null ? mine : (Number(req.query.salesperson_id) || null);
  if (!repId) throw new WholesaleError(400, 'Choose a salesperson');
  const rep = (await pool.query(`SELECT salesperson_id, name FROM wholesale_salespeople WHERE business_id = $1 AND salesperson_id = $2`, [businessId, repId])).rows[0];
  if (!rep) throw new WholesaleError(404, 'Not found');
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const settings = await getSettings(pool, businessId);
  const beats = (await pool.query(`SELECT b.beat_id, b.name, b.weekday FROM dist_beats b WHERE b.business_id = $1 AND b.salesperson_id = $2 AND b.status = 'ACTIVE' AND b.weekday = $3 ORDER BY b.name`, [businessId, repId, weekday])).rows;
  const customers = beats.length ? (await pool.query(
    `SELECT bc.beat_id, bc.seq, c.customer_id, c.name, c.phone, c.address, c.credit_limit_paise, w.contact_person, w.city,
            (SELECT MAX(o.order_date) FROM wholesale_sales_orders o WHERE o.customer_id = c.customer_id AND o.status NOT IN ('CANCELLED','REJECTED','DRAFT')) AS last_order,
            (SELECT v.visit_id FROM dist_visits v WHERE v.customer_id = c.customer_id AND v.visit_date = $3::date ORDER BY v.visit_id DESC LIMIT 1) AS visit_id,
            (SELECT v.outcome FROM dist_visits v WHERE v.customer_id = c.customer_id AND v.visit_date = $3::date ORDER BY v.visit_id DESC LIMIT 1) AS visit_outcome
     FROM dist_beat_customers bc JOIN customers c ON c.customer_id = bc.customer_id LEFT JOIN wholesale_customer_profiles w ON w.customer_id = c.customer_id
     WHERE bc.beat_id = ANY($1::int[]) AND c.business_id = $2 AND c.status = 'ACTIVE' ORDER BY bc.beat_id, bc.seq`, [beats.map((b) => b.beat_id), businessId, date])).rows : [];
  const bal = await customerBalances(pool, { businessId, customerIds: customers.map((c) => c.customer_id), graceDays: settings.overdue_grace_days });
  const sold = (await pool.query(`SELECT COALESCE(SUM(total_paise), 0) AS v, COUNT(*) AS n FROM wholesale_sales_orders WHERE business_id = $1 AND salesperson_id = $2 AND order_date = $3::date AND status NOT IN ('CANCELLED','REJECTED')`, [businessId, repId, date])).rows[0];
  const collected = (await pool.query(`SELECT COALESCE(SUM(amount_paise), 0) AS v FROM wholesale_receipts WHERE business_id = $1 AND created_by = (SELECT user_id FROM wholesale_salespeople WHERE salesperson_id = $2) AND receipt_date = $3::date AND status = 'POSTED' AND kind = 'RECEIPT'`, [businessId, repId, date])).rows[0];
  const [mStart, mEnd] = periodBounds('MONTHLY', date);
  const tgt = (await pool.query(`SELECT * FROM dist_targets WHERE business_id = $1 AND scope_type = 'SALESPERSON' AND scope_id = $2 AND period_type = 'MONTHLY' AND period_start = $3::date AND metric = 'VALUE'`, [businessId, repId, mStart])).rows[0];
  const monthActual = await actualFor(pool, { businessId, scopeType: 'SALESPERSON', scopeId: repId, from: mStart, to: mEnd });
  const monthProgress = tgt ? progress(tgt, monthActual.revenue, date) : null;
  ok(res, {
    salesperson: rep, date, weekday,
    beats: beats.map((b) => ({
      beat_id: b.beat_id, name: b.name,
      customers: customers.filter((c) => c.beat_id === b.beat_id).map((c) => {
        const x = bal.get(c.customer_id) || {};
        return { seq: c.seq, customer_id: c.customer_id, name: c.name, phone: c.phone, address: c.address, contact_person: c.contact_person, city: c.city, last_order: c.last_order,
          outstanding: rupees(x.outstanding), overdue: rupees(x.overdue), credit_limit: rupees(c.credit_limit_paise), visit_id: c.visit_id, visit_outcome: c.visit_outcome, visited: Boolean(c.visit_id) };
      })
    })),
    summary: {
      planned: customers.length, visited: customers.filter((c) => c.visit_id).length, orders: Number(sold.n), order_value: rupees(sold.v), collected: rupees(collected.v),
      month_target: monthProgress && { target: rupees(tgt.target_amount), actual: rupees(monthActual.revenue), achievement_pct: monthProgress.achievement_pct, remaining: rupees(monthProgress.remaining), required_per_day: rupees(monthProgress.required_per_day), days_left: monthProgress.days_left, status: monthProgress.status }
    }
  });
};

/* GET /field/customers/:id — what a rep needs standing in front of a retailer */
const fieldCustomer = async (req, res) => {
  const businessId = req.tenant.businessId;
  const id = Number(req.params.id);
  const c = (await pool.query(
    `SELECT c.customer_id, c.name, c.phone, c.address, c.gstin, w.contact_person, w.city, w.customer_type, w.salesperson_id, w.payment_terms_days, w.territory_id, t.name AS territory
     FROM customers c LEFT JOIN wholesale_customer_profiles w ON w.customer_id = c.customer_id LEFT JOIN dist_territories t ON t.territory_id = w.territory_id WHERE c.business_id = $1 AND c.customer_id = $2`, [businessId, id])).rows[0];
  if (!c) throw new WholesaleError(404, 'Not found');
  const mine = await myRep(req);
  if (mine != null && (mine === 0 || !(await mayWork(businessId, mine, id)))) throw new WholesaleError(404, 'Not found');
  const settings = await getSettings(pool, businessId);
  const position = await creditPosition(pool, { businessId, customerId: id, settings });
  const orders = (await pool.query(`SELECT order_id, order_number, order_date, status, total_paise FROM wholesale_sales_orders WHERE business_id = $1 AND customer_id = $2 AND status <> 'DRAFT' ORDER BY order_date DESC, order_id DESC LIMIT 5`, [businessId, id])).rows;
  const open = (await pool.query(
    `SELECT i.invoice_id, i.invoice_number, i.invoice_date, i.balance_due_paise, m.due_date FROM invoices i LEFT JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id
     WHERE i.business_id = $1 AND i.customer_id = $2 AND i.status = 'ISSUED' AND i.balance_due_paise > 0 ORDER BY COALESCE(m.due_date, i.invoice_date) LIMIT 20`, [businessId, id])).rows;
  const visits = (await pool.query(`${VISIT_SELECT} WHERE v.business_id = $1 AND v.customer_id = $2 ORDER BY v.visit_date DESC, v.visit_id DESC LIMIT 5`, [businessId, id])).rows;
  const dateNow = await today(pool, businessId);
  ok(res, {
    customer: { customer_id: c.customer_id, name: c.name, phone: c.phone, address: c.address, gstin: c.gstin, contact_person: c.contact_person, city: c.city, type: c.customer_type, payment_terms_days: c.payment_terms_days, territory: c.territory },
    credit: { limit: rupees(position?.limit), outstanding: rupees(position?.outstanding), overdue: rupees(position?.overdue), available: position?.available == null ? null : rupees(position.available), utilization_pct: position?.utilization_pct ?? null, policy: position?.policy },
    orders: orders.map((o) => ({ order_id: o.order_id, order_number: o.order_number, order_date: o.order_date, status: o.status, total: rupees(o.total_paise) })),
    open_invoices: open.map((i) => ({ invoice_id: i.invoice_id, invoice_number: i.invoice_number, invoice_date: i.invoice_date, due_date: i.due_date, balance: rupees(i.balance_due_paise), overdue: i.due_date ? String(i.due_date).slice(0, 10) < dateNow : false })),
    visits: visits.map(visitShape)
  });
};

export default wrapAll({ listTargets, setTarget, bulkTargets, deleteTarget, listRules, createRule, updateRule, deleteRule, commissionStatement, team, recordVisit, updateVisit, listVisits, fieldToday, fieldCustomer });
