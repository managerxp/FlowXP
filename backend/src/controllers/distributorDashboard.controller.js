/*
 * The distributor dashboard: the wholesale dashboard (sales, money, stock, fulfilment, alerts) plus what is particular
 * to a distributor — targets and achievement, sales by territory / salesperson / retailer / brand / category, primary
 * against secondary sales, the field force and vans, scheme expiry. Every figure comes from the live documents; what a
 * person sees follows what they may open, and a field rep sees only their own sales.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { hasPermission } from '../middleware/auth.js';
import { addDays, getSettings, ok, today, wrapAll } from '../modules/distributor/common.js';
import { FACTS } from '../modules/distributor/facts.js';
import { periodBounds, progress } from '../modules/distributor/targets.js';
import { buildDashboard } from './wholesaleDashboard.controller.js';
import { scopeBranches } from './wholesaleInventory.controller.js';
import { myRep } from './distributorTeam.controller.js';

const rupees = (v) => toRupees(Number(v || 0));
const n = (v) => Number(v || 0);

const dashboard = async (req, res) => {
  const businessId = req.tenant.businessId;
  const base = await buildDashboard(req);
  const date = base.as_of;
  const [monthStart, monthEnd] = periodBounds('MONTHLY', date);
  const branches = await scopeBranches(req);
  const mine = await myRep(req);
  const can = (...p) => p.some((x) => hasPermission(req.tenant, x));
  const canSales = can('reports', 'payments', 'sales_orders', 'field_sales');
  const settings = await getSettings(pool, businessId);
  const repFilter = mine == null ? '' : ` AND f.salesperson_id = ${Number(mine) | 0}`;
  const q = async (sql, extra = []) => (await pool.query(sql, [businessId, branches, monthStart, date, ...extra])).rows;
  const top = async (name, joins, group, limit = 8) => (await q(
    `SELECT ${name} AS name, COALESCE(SUM(f.revenue), 0) AS revenue, COALESCE(SUM(f.cost), 0) AS cost FROM ${FACTS} ${joins}
     WHERE f.business_id = $1 AND f.branch_id = ANY($2::int[]) AND f.invoice_date >= $3::date AND f.invoice_date <= $4::date${repFilter} GROUP BY ${group} HAVING COALESCE(SUM(f.revenue), 0) <> 0 ORDER BY revenue DESC LIMIT ${limit}`))
    .map((x) => ({ name: x.name, revenue: rupees(x.revenue), margin: rupees(n(x.revenue) - n(x.cost)) }));

  const out = { ...base, distributor: { month: { from: monthStart, to: monthEnd } } };
  const d = out.distributor;

  if (canSales) {
    // targets: the business target for the month, else the sum of the salespeople's
    const targets = (await pool.query(`SELECT scope_type, scope_id, target_amount FROM dist_targets WHERE business_id = $1 AND period_type = 'MONTHLY' AND period_start = $2::date AND metric = 'VALUE' AND scope_type IN ('BUSINESS','SALESPERSON')`, [businessId, monthStart])).rows;
    const reps = targets.filter((t) => t.scope_type === 'SALESPERSON');
    const businessTarget = targets.find((t) => t.scope_type === 'BUSINESS');
    const monthTarget = mine != null ? n(reps.find((t) => t.scope_id === mine)?.target_amount) : (businessTarget ? n(businessTarget.target_amount) : reps.reduce((s, t) => s + n(t.target_amount), 0));
    const [net] = await q(`SELECT COALESCE(SUM(f.revenue), 0) AS revenue, COALESCE(SUM(f.cost), 0) AS cost FROM ${FACTS} WHERE f.business_id = $1 AND f.branch_id = ANY($2::int[]) AND f.invoice_date >= $3::date AND f.invoice_date <= $4::date${repFilter}`);
    const monthProgress = monthTarget > 0 ? progress({ target_amount: monthTarget, period_start: monthStart, period_end: monthEnd }, n(net.revenue), date) : null;
    const [ords] = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE order_date = $3::date) AS today_n, COALESCE(SUM(total_paise) FILTER (WHERE order_date = $3::date), 0) AS today_v,
              COUNT(*) FILTER (WHERE status IN ('PENDING','CONFIRMED','PARTIALLY_FULFILLED','PACKED')) AS pending_n
       FROM wholesale_sales_orders WHERE business_id = $1 AND branch_id = ANY($2::int[]) AND status NOT IN ('DRAFT','CANCELLED','REJECTED') ${mine == null ? '' : `AND salesperson_id = ${Number(mine) | 0}`}`, [businessId, branches, date]).then((r) => r.rows);
    const [rets] = await pool.query(
      `SELECT COALESCE(SUM(cn.total_paise), 0) AS v, COUNT(*) AS n FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id ${mine == null ? '' : `JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id AND m.salesperson_id = ${Number(mine) | 0}`}
       WHERE cn.business_id = $1 AND cn.branch_id = ANY($2::int[]) AND cn.cn_date >= $3::date AND cn.cn_date <= $4::date`, [businessId, branches, monthStart, date]).then((r) => r.rows);
    const [primary] = mine != null ? [{ v: 0 }] : await pool.query(`SELECT COALESCE(SUM(total_cost_paise), 0) AS v FROM wholesale_grns WHERE business_id = $1 AND branch_id = ANY($2::int[]) AND status <> 'CANCELLED' AND grn_date >= $3::date AND grn_date <= $4::date`, [businessId, branches, monthStart, date]).then((r) => r.rows);
    const vans = await pool.query(
      `SELECT (SELECT COUNT(*) FROM dist_vehicles WHERE business_id = $1 AND status = 'ACTIVE' AND branch_id = ANY($2::int[])) AS active,
              COALESCE((SELECT SUM(s.qty_base * p.purchase_price_paise) FROM dist_vehicle_stock s JOIN dist_vehicles v ON v.vehicle_id = s.vehicle_id JOIN products p ON p.product_id = s.product_id WHERE s.business_id = $1 AND v.branch_id = ANY($2::int[])), 0) AS value,
              COALESCE((SELECT SUM(total_paise) FROM wholesale_sales_orders WHERE business_id = $1 AND source = 'VAN' AND order_date = $3::date AND status <> 'CANCELLED' AND branch_id = ANY($2::int[])), 0) AS sold_today`, [businessId, branches, date]).then((r) => r.rows[0]);
    const visits = await pool.query(
      `SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE outcome IN ('ORDER','COLLECTION')) AS productive FROM dist_visits WHERE business_id = $1 AND visit_date = $2::date ${mine == null ? '' : `AND salesperson_id = ${Number(mine) | 0}`}`, [businessId, date]).then((r) => r.rows[0]);

    d.kpis = {
      sales_today: base.sales.today.total, collections_today: base.money?.collected_today ?? null, orders_today: { count: n(ords.today_n), value: rupees(ords.today_v) },
      sales_month: base.sales.month.total, sales_change_pct: base.sales.month.change_pct, net_sales_month: rupees(net.revenue), month_target: monthTarget ? rupees(monthTarget) : null,
      target_achievement_pct: monthProgress?.achievement_pct ?? null, target_remaining: monthProgress ? rupees(monthProgress.remaining) : null, target_per_day: monthProgress ? rupees(monthProgress.required_per_day) : null,
      gross_margin: rupees(n(net.revenue) - n(net.cost)), margin_pct: n(net.revenue) > 0 ? Math.round(((n(net.revenue) - n(net.cost)) / n(net.revenue)) * 1000) / 10 : null,
      receivables: base.money?.receivable ?? null, payable: base.money?.payable ?? null,
      stock_value: base.inventory ? Math.round((base.inventory.stock_value + rupees(vans.value)) * 100) / 100 : null, low_stock: base.inventory?.alerts.low_stock ?? null, expiring_stock: base.inventory ? base.inventory.alerts.expiring + base.inventory.alerts.expired : null,
      pending_orders: n(ords.pending_n), pending_deliveries: base.fulfilment ? base.fulfilment.to_deliver + base.fulfilment.out_for_delivery + base.fulfilment.failed_deliveries : null, sales_returns: rupees(rets.v), sales_returns_count: n(rets.n)
    };
    d.performance = {
      by_territory: await top(`COALESCE(tr.name || ' › ', '') || COALESCE(tt.name || ' › ', '') || COALESCE(ta.name, 'Unassigned')`,
        `LEFT JOIN dist_territories ta ON ta.territory_id = f.territory_id LEFT JOIN dist_territories tt ON tt.territory_id = CASE WHEN ta.level = 'AREA' THEN ta.parent_id WHEN ta.level = 'TERRITORY' THEN ta.territory_id END LEFT JOIN dist_territories tr ON tr.territory_id = CASE WHEN ta.level = 'REGION' THEN ta.territory_id WHEN tt.level = 'TERRITORY' THEN tt.parent_id END`, '1'),
      by_salesperson: await top(`COALESCE(sp.name, 'Unassigned')`, 'LEFT JOIN wholesale_salespeople sp ON sp.salesperson_id = f.salesperson_id', '1'),
      by_retailer: await top('cu.name', 'JOIN customers cu ON cu.customer_id = f.customer_id', '1', 10),
      by_brand: await top(`COALESCE(br.name, 'No brand')`, 'LEFT JOIN brands br ON br.brand_id = f.brand_id', '1'),
      by_product: await top('pp.name', 'JOIN products pp ON pp.product_id = f.product_id', '1', 10),
      by_category: await top(`COALESCE(ca.name, 'No category')`, 'LEFT JOIN categories ca ON ca.category_id = f.category_id', '1'),
      secondary_month: rupees(net.revenue), primary_month: mine != null ? null : rupees(primary.v)
    };
    d.field = { visits_today: n(visits.n), productive_today: n(visits.productive), vans_active: n(vans.active), van_stock_value: rupees(vans.value), van_sales_today: rupees(vans.sold_today) };

    // schemes about to end, and what schemes have cost this month
    const expiring = (await pool.query(
      `SELECT scheme_id, name, ends_on::text AS ends_on, (ends_on - $2::date) AS days_left FROM dist_schemes WHERE business_id = $1 AND is_active AND ends_on >= $2::date AND ends_on <= $2::date + 7 ORDER BY ends_on LIMIT 5`, [businessId, date])).rows;
    const schemeCost = (await pool.query(
      `SELECT COALESCE(SUM(a.cost_paise), 0) AS v, COUNT(DISTINCT a.scheme_id) AS n FROM dist_scheme_applications a JOIN wholesale_sales_orders o ON o.order_id = a.order_id
       WHERE a.business_id = $1 AND o.order_date >= $2::date AND o.order_date <= $3::date AND o.status NOT IN ('DRAFT','CANCELLED','REJECTED')`, [businessId, monthStart, date])).rows[0];
    d.schemes = { expiring: expiring.map((s) => ({ scheme_id: s.scheme_id, name: s.name, ends_on: s.ends_on, days_left: n(s.days_left) })), cost_month: rupees(schemeCost.v), in_use: n(schemeCost.n) };

    // salespeople behind their month's pace (only the people who have a target)
    if (mine == null && reps.length) {
      const names = new Map((await pool.query(`SELECT salesperson_id, name FROM wholesale_salespeople WHERE business_id = $1`, [businessId])).rows.map((x) => [x.salesperson_id, x.name]));
      const sold = new Map((await q(`SELECT f.salesperson_id AS id, COALESCE(SUM(f.revenue), 0) AS revenue FROM ${FACTS} WHERE f.business_id = $1 AND f.branch_id = ANY($2::int[]) AND f.invoice_date >= $3::date AND f.invoice_date <= $4::date GROUP BY 1`)).map((x) => [x.id, n(x.revenue)]));
      d.targets = reps.map((t) => {
        const p = progress({ target_amount: t.target_amount, period_start: monthStart, period_end: monthEnd }, sold.get(t.scope_id) || 0, date);
        return { salesperson_id: t.scope_id, name: names.get(t.scope_id) || '—', target: rupees(t.target_amount), actual: rupees(sold.get(t.scope_id) || 0), achievement_pct: p.achievement_pct, status: p.status, required_per_day: rupees(p.required_per_day) };
      }).sort((a, b) => a.achievement_pct - b.achievement_pct);
    }

    // alerts particular to a distributor, joined to the wholesale ones
    const extra = [];
    for (const s of d.schemes.expiring) extra.push({ level: 'warning', text: `Scheme “${s.name}” ends ${s.days_left === 0 ? 'today' : `in ${s.days_left} day${s.days_left === 1 ? '' : 's'}`}`, link: '/app/distributor/schemes' });
    const behind = (d.targets || []).filter((t) => t.status === 'BEHIND');
    if (behind.length) extra.push({ level: 'warning', text: `${behind.length} salesperson${behind.length === 1 ? ' is' : 's are'} behind this month’s target`, link: '/app/distributor/targets' });
    if (d.kpis.month_target && d.kpis.target_achievement_pct != null && monthProgressBehind(monthProgress)) extra.push({ level: 'warning', text: `Month target is ${d.kpis.target_achievement_pct}% done — ₹${Number(d.kpis.target_per_day).toLocaleString('en-IN')} a day needed to reach it`, link: '/app/distributor/targets' });
    if (out.money?.overdue > 0) extra.push({ level: 'informational', text: 'Collections to chase: see the overdue retailers on the Collections screen', link: '/app/wholesale/money' });
    out.alerts = [...extra, ...out.alerts];
  }
  void settings;
  ok(res, out);
};

const monthProgressBehind = (p) => Boolean(p) && p.status === 'BEHIND';

export default wrapAll({ dashboard });
export { addDays };
