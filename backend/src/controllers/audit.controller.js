/*
 * The activity log: who did what, where and when, in plain sentences.
 *
 * Every row is the business's own (business_id is always in the WHERE). A user
 * pinned to one outlet sees only that outlet's activity; business-level rows
 * (settings, staff) belong to group users. Paged by a cursor on audit_id, which
 * is stable while new rows arrive.
 */
import pool from '../config/database.js';
import { hasPermission } from '../middleware/auth.js';
import { CATEGORIES, TARGETS, categoryOf, describeAction, prefixesFor } from '../modules/auditText.js';
import { businessToday, addDaysISO } from '../utils/dates.js';

const PAGE = 50;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });

/** Readable names for the things the rows in this page are about (one query per kind, business-scoped). */
const namesFor = async (businessId, rows) => {
  const wanted = new Map();
  for (const r of rows) {
    const type = r.resource_type === 'purchase_order' || TARGETS[r.resource_type] ? r.resource_type : null;
    if (!type || r.resource_id == null || !/^\d+$/.test(r.resource_id)) continue;
    if (!wanted.has(type)) wanted.set(type, new Set());
    wanted.get(type).add(Number(r.resource_id));
  }
  const names = new Map();
  for (const [type, ids] of wanted) {
    const t = TARGETS[type];
    // users are global rows: only people who belong to this business may be named
    const extra = type === 'user' ? 'AND user_id IN (SELECT user_id FROM business_users WHERE business_id = $2)' : 'AND business_id = $2';
    const { rows: found } = await pool.query(`SELECT ${t.id} AS id, ${t.name} AS name FROM ${t.table} WHERE ${t.id} = ANY($1::int[]) ${extra}`, [[...ids], businessId]);
    for (const f of found) names.set(`${type}:${f.id}`, f.name);
  }
  return names;
};

const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  // a cell that starts with = + - @ would be run as a formula by a spreadsheet
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/* GET /api/audit?user_id=&category=&q=&outlet=&from=&to=&before=&limit=&format=csv */
export const list = async (req, res) => {
  const { businessId } = req.tenant;
  const q = req.query;
  const csv = q.format === 'csv';
  if (csv && !hasPermission(req.tenant, 'export')) return bad(res, 'You do not have access to export the log', 403);

  const today = await businessToday(businessId);
  const from = q.from || addDaysISO(today, -6);
  const to = q.to || today;
  if (!DATE.test(from) || !DATE.test(to) || from > to) return bad(res, 'Choose a valid date range');
  if (Math.round((Date.parse(to) - Date.parse(from)) / 86400000) > 366) return bad(res, 'Choose a range of at most a year');

  const tz = `COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata')`;
  const values = [businessId, from, to];
  let where = `a.business_id = $1 AND (a.created_at AT TIME ZONE ${tz})::date BETWEEN $2 AND $3`;

  if (req.tenant.scopeBranchId != null) { values.push(req.tenant.scopeBranchId); where += ` AND a.branch_id = $${values.length}`; }
  else if (q.outlet) { values.push(Number(q.outlet)); where += ` AND a.branch_id = $${values.length}`; }
  if (q.user_id) { values.push(Number(q.user_id)); where += ` AND a.user_id = $${values.length}`; }
  if (q.category) {
    const prefixes = prefixesFor(q.category);
    if (!prefixes) return bad(res, 'Unknown category');
    values.push(prefixes.map((p) => `${p}.%`));
    where += ` AND a.action LIKE ANY($${values.length}::text[])`;
  }
  if (q.q) { values.push(`%${String(q.q).slice(0, 60)}%`); where += ` AND (a.action ILIKE $${values.length} OR a.metadata::text ILIKE $${values.length})`; }
  if (q.before && !csv) { values.push(Number(q.before)); where += ` AND a.audit_id < $${values.length}`; }

  const limit = csv ? 5000 : Math.min(100, Math.max(1, Number(q.limit) || PAGE));
  const { rows } = await pool.query(
    `SELECT a.audit_id, a.created_at, a.action, a.resource_type, a.resource_id, a.metadata, a.ip_address, a.user_id, u.name AS user_name, bu.role AS user_role, br.name AS outlet
     FROM audit_log a LEFT JOIN users u ON u.user_id = a.user_id
     LEFT JOIN business_users bu ON bu.user_id = a.user_id AND bu.business_id = a.business_id
     LEFT JOIN branches br ON br.branch_id = a.branch_id
     WHERE ${where} ORDER BY a.audit_id DESC LIMIT ${limit + 1}`,
    values
  );
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  const names = await namesFor(businessId, page);

  const entries = page.map((r) => {
    const target = names.get(`${r.resource_type}:${r.resource_id}`) ?? null;
    return {
      audit_id: r.audit_id, at: r.created_at, user_id: r.user_id, user: r.user_name || 'Someone (removed)', role: r.user_role,
      action: r.action, category: categoryOf(r.action), summary: describeAction(r.action, r.metadata, target),
      target, resource_type: r.resource_type, resource_id: r.resource_id, outlet: r.outlet, ip: r.ip_address
    };
  });

  if (csv) {
    const header = ['When', 'Who', 'Role', 'What', 'Action', 'Outlet', 'IP address'];
    const lines = [header, ...entries.map((e) => [new Date(e.at).toISOString(), e.user, e.role, e.summary, e.action, e.outlet, e.ip])];
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="activity-${from}-to-${to}.csv"`);
    return res.send(lines.map((l) => l.map(csvCell).join(',')).join('\n'));
  }
  res.json({ success: true, data: { entries, next: more ? page[page.length - 1].audit_id : null, range: { from, to }, categories: Object.entries(CATEGORIES).map(([key, c]) => ({ key, label: c.label })) } });
};
