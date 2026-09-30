/*
 * The salon dashboard and reports.
 *
 * Every report is one query (or a few) returning the same shape — { columns, rows, totals } — so the screen can
 * render any of them with one table component and offer CSV for all. Money leaves here in rupees, is stored as
 * paise, and revenue is always EX-TAX and NET of credit notes (a credited service is not revenue).
 *
 * Nothing is scoped by trusting the client: every query is limited to the business, and to the outlet the
 * caller is viewing (or all outlets, for a group user who chose "all").
 */
import pool from '../config/database.js';
import { hasPermission } from '../middleware/auth.js';
import { businessToday } from '../utils/dates.js';
import { branchFilter } from '../utils/scope.js';
import { toRupees } from '../utils/money.js';
import { canSeeCommission } from '../modules/salon/access.js';
import { hasPlanFeature } from '../modules/planFeatures.js';
import { batchPositions } from '../modules/salon/stock.js';
import { getSettings } from '../modules/salon/settings.js';
import { SalonError, isoDate, ok, wrapAll } from '../modules/salon/common.js';

const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const money = toRupees;

/* net revenue of one invoice line: ex-tax, after discounts, less what credit notes took back */
const NET_LINE = `(ii.line_total_paise - ii.tax_amount_paise - COALESCE((SELECT SUM(c.line_total_paise - c.tax_amount_paise) FROM credit_note_items c WHERE c.invoice_item_id = ii.item_id), 0))`;

const context = async (req) => {
  const today = await businessToday(req.tenant.businessId);
  const to = isoDate(req.query.to, 'To') || today;
  const from = isoDate(req.query.from, 'From') || addDays(to, -29);
  if (to < from) throw new SalonError(400, 'The end date is before the start date');
  if (Date.parse(to) - Date.parse(from) > 800 * 86400000) throw new SalonError(400, 'Choose a range of about two years or less');
  return { tenant: req.tenant, businessId: req.tenant.businessId, today, from, to };
};

/* `AND <col> = $n` for the outlet in scope, pushing its value */
const bf = (c, col, values) => branchFilter(c.tenant, col, values);

/* ── the dashboard ────────────────────────────────────────────────────────────────────────── */

const dashboard = async (req, res) => {
  const c = await context({ ...req, query: {} });
  const { businessId, today } = c;
  const monthStart = `${today.slice(0, 8)}01`;
  const weekStart = addDays(today, -6);
  const chartFrom = addDays(today, -13);

  const scoped = (sql, base, col) => { const v = [...base]; return pool.query(sql.replace('/*BRANCH*/', bf(c, col, v)), v); };

  const [salesRows, collections, appts, staffRows, newRet, outstanding, lowStock, byType, daily, loyalty, staffMonth, vipCount] = await Promise.all([
    scoped(`SELECT COALESCE(SUM(total_paise - credited_paise) FILTER (WHERE invoice_date = $2::date), 0) AS today,
                   COALESCE(SUM(total_paise - credited_paise) FILTER (WHERE invoice_date BETWEEN $3::date AND $2::date), 0) AS week,
                   COALESCE(SUM(total_paise - credited_paise) FILTER (WHERE invoice_date BETWEEN $4::date AND $2::date), 0) AS month,
                   COUNT(*) FILTER (WHERE invoice_date = $2::date) AS bills_today
            FROM invoices i WHERE business_id = $1 AND status = 'ISSUED' AND invoice_date >= $4::date /*BRANCH*/`, [businessId, today, weekStart, monthStart], 'i.branch_id'),
    scoped(`SELECT COALESCE(SUM(amount_paise), 0) AS n FROM payments p WHERE business_id = $1 AND payment_date = $2::date AND invoice_id IS NOT NULL /*BRANCH*/`, [businessId, today], 'p.branch_id'),
    scoped(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed, COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled,
                   COUNT(*) FILTER (WHERE status = 'NO_SHOW') AS no_show, COUNT(*) FILTER (WHERE status IN ('BOOKED','CONFIRMED','CHECKED_IN','IN_SERVICE')) AS upcoming
            FROM salon_appointments a WHERE business_id = $1 AND (start_at AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata'))::date = $2::date /*BRANCH*/`, [businessId, today], 'a.branch_id'),
    scoped(`SELECT COUNT(*) FILTER (WHERE s.status = 'ACTIVE') AS active,
                   COUNT(*) FILTER (WHERE s.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM salon_attendance a WHERE a.staff_id = s.staff_id AND a.work_date = $2::date AND a.status IN ('PRESENT','HALF_DAY'))) AS present,
                   COUNT(*) FILTER (WHERE s.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM salon_attendance a WHERE a.staff_id = s.staff_id AND a.work_date = $2::date)) AS marked
            FROM salon_staff s WHERE s.business_id = $1 AND s.is_bookable /*BRANCH*/`, [businessId, today], 's.branch_id'),
    scoped(`SELECT COUNT(DISTINCT i.customer_id) FILTER (WHERE st.first_visit = $2::date) AS new_customers,
                   COUNT(DISTINCT i.customer_id) FILTER (WHERE st.first_visit < $2::date) AS returning_customers
            FROM invoices i JOIN salon_customer_stats st ON st.customer_id = i.customer_id
            WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date = $2::date AND i.customer_id IS NOT NULL /*BRANCH*/`, [businessId, today], 'i.branch_id'),
    scoped(`SELECT COALESCE(SUM(balance_due_paise), 0) AS n, COUNT(*) FILTER (WHERE balance_due_paise > 0) AS bills FROM invoices i WHERE business_id = $1 AND status = 'ISSUED' AND balance_due_paise > 0 /*BRANCH*/`, [businessId], 'i.branch_id'),
    scoped(`SELECT COUNT(*) AS n FROM (SELECT p.product_id FROM products p JOIN branch_stock bs ON bs.product_id = p.product_id
              WHERE p.business_id = $1 AND p.status = 'ACTIVE' AND p.track_inventory AND p.kind IN ('DISH','INGREDIENT','PACKAGING') /*BRANCH*/
              GROUP BY p.product_id, p.min_stock HAVING SUM(bs.quantity) <= p.min_stock AND p.min_stock > 0) t`, [businessId], 'bs.branch_id'),
    scoped(`SELECT sl.line_type, COALESCE(SUM(${NET_LINE}), 0) AS net FROM salon_invoice_lines sl JOIN invoice_items ii ON ii.item_id = sl.item_id JOIN invoices i ON i.invoice_id = sl.invoice_id
            WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2::date AND $3::date /*BRANCH*/ GROUP BY sl.line_type`, [businessId, monthStart, today], 'i.branch_id'),
    scoped(`SELECT i.invoice_date::text AS day, COALESCE(SUM(${NET_LINE}) FILTER (WHERE sl.line_type = 'SERVICE'), 0) AS services,
                   COALESCE(SUM(${NET_LINE}) FILTER (WHERE sl.line_type = 'PRODUCT'), 0) AS products,
                   COALESCE(SUM(${NET_LINE}) FILTER (WHERE sl.line_type IN ('PACKAGE','MEMBERSHIP')), 0) AS plans
            FROM salon_invoice_lines sl JOIN invoice_items ii ON ii.item_id = sl.item_id JOIN invoices i ON i.invoice_id = sl.invoice_id
            WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2::date AND $3::date /*BRANCH*/ GROUP BY i.invoice_date ORDER BY i.invoice_date`, [businessId, chartFrom, today], 'i.branch_id'),
    pool.query(`SELECT COALESCE(SUM(points) FILTER (WHERE kind = 'EARN'), 0)::int AS issued, COALESCE(-SUM(points) FILTER (WHERE kind = 'REDEEM'), 0)::int AS redeemed
                FROM points_ledger WHERE business_id = $1 AND voided_at IS NULL AND created_at >= now() - interval '30 days'`, [businessId]),
    scoped(`SELECT s.staff_id, s.name,
                   COALESCE(SUM(${NET_LINE}) FILTER (WHERE sl.line_type IN ('SERVICE','PRODUCT','PACKAGE','MEMBERSHIP')), 0) AS sales,
                   COALESCE(SUM(ii.quantity) FILTER (WHERE sl.line_type IN ('SERVICE','PACKAGE_USE','MEMBERSHIP_USE')), 0) AS services,
                   (SELECT COALESCE(SUM(c.amount_paise), 0) FROM salon_commissions c WHERE c.staff_id = s.staff_id AND c.status <> 'VOID' AND c.earned_on BETWEEN $2::date AND $3::date) AS commission,
                   (SELECT COUNT(*) FROM salon_attendance a WHERE a.staff_id = s.staff_id AND a.work_date BETWEEN $2::date AND $3::date AND a.status IN ('PRESENT','HALF_DAY')) AS days_present
            FROM salon_staff s LEFT JOIN salon_invoice_lines sl ON sl.staff_id = s.staff_id
            LEFT JOIN invoices i ON i.invoice_id = sl.invoice_id AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2::date AND $3::date
            LEFT JOIN invoice_items ii ON ii.item_id = sl.item_id AND i.invoice_id IS NOT NULL
            WHERE s.business_id = $1 AND s.status = 'ACTIVE' AND s.is_bookable /*BRANCH*/ GROUP BY s.staff_id, s.name ORDER BY sales DESC, s.name LIMIT 12`, [businessId, monthStart, today], 's.branch_id'),
    pool.query(`SELECT COUNT(*) AS n FROM salon_customer_stats st WHERE st.business_id = $1 AND (st.spend_paise >= COALESCE((SELECT (segment_rules->>'vip_spend_paise')::bigint FROM salon_settings WHERE business_id = $1), 2000000)
                  OR st.visits >= COALESCE((SELECT (segment_rules->>'vip_visits')::int FROM salon_settings WHERE business_id = $1), 12))`, [businessId])
  ]);

  const typeNet = Object.fromEntries(byType.rows.map((r) => [r.line_type, Number(r.net)]));
  const seesMoney = hasPermission(req.tenant, 'reports');
  const canCommission = canSeeCommission(req.tenant);
  const s = salesRows.rows[0]; const a = appts.rows[0]; const st = staffRows.rows[0]; const nr = newRet.rows[0];
  const payload = {
    date: today,
    overview: {
      sales_today: money(s.today), collections_today: money(collections.rows[0].n), invoices_today: Number(s.bills_today),
      appointments_today: Number(a.total), appointments_completed: Number(a.completed), appointments_cancelled: Number(a.cancelled), appointments_no_show: Number(a.no_show), appointments_upcoming: Number(a.upcoming),
      active_staff: Number(st.marked) ? Number(st.present) : Number(st.active), staff_total: Number(st.active), attendance_marked: Number(st.marked) > 0,
      new_customers: Number(nr.new_customers), returning_customers: Number(nr.returning_customers),
      outstanding: money(outstanding.rows[0].n), outstanding_bills: Number(outstanding.rows[0].bills), low_stock: Number(lowStock.rows[0].n)
    },
    revenue: {
      daily: money(s.today), weekly: money(s.week), monthly: money(s.month),
      month_by_type: { services: money(typeNet.SERVICE || 0), products: money(typeNet.PRODUCT || 0), packages: money(typeNet.PACKAGE || 0), memberships: money(typeNet.MEMBERSHIP || 0) },
      chart: daily.rows.map((r) => ({ day: r.day, services: money(r.services), products: money(r.products), plans: money(r.plans) }))
    },
    customers: { new_today: Number(nr.new_customers), returning_today: Number(nr.returning_customers), vip: Number(vipCount.rows[0].n), points_issued_30d: loyalty.rows[0].issued, points_redeemed_30d: loyalty.rows[0].redeemed },
    staff: staffMonth.rows.map((r) => ({
      staff_id: r.staff_id, name: r.name, sales: money(r.sales), services: Number(r.services), days_present: Number(r.days_present),
      productivity: Number(r.days_present) ? money(Math.round(Number(r.sales) / Number(r.days_present))) : null,
      ...(canCommission ? { commission: money(r.commission) } : {})
    }))
  };
  // someone who runs the floor but may not see the takings gets the day's activity without the money
  if (!seesMoney) {
    Object.assign(payload.overview, { sales_today: null, collections_today: null, outstanding: null });
    delete payload.revenue; delete payload.staff;
    payload.customers = { new_today: payload.customers.new_today, returning_today: payload.customers.returning_today };
  }
  ok(res, payload);
};

/* ── reports ──────────────────────────────────────────────────────────────────────────────── */

const col = (key, label, type = 'text') => ({ key, label, type });

const REPORTS = {
  /* Sales */
  'sales-daily': {
    group: 'Sales', title: 'Daily sales',
    async run(c) {
      const v = [c.businessId, c.from, c.to];
      const { rows } = await pool.query(
        `SELECT invoice_date::text AS day, COUNT(*) AS bills, COALESCE(SUM(subtotal_paise), 0) AS net, COALESCE(SUM(discount_paise), 0) AS discount, COALESCE(SUM(tax_paise), 0) AS tax,
                COALESCE(SUM(total_paise), 0) AS total, COALESCE(SUM(credited_paise), 0) AS credited
         FROM invoices i WHERE business_id = $1 AND status = 'ISSUED' AND invoice_date BETWEEN $2::date AND $3::date${bf(c, 'i.branch_id', v)} GROUP BY invoice_date ORDER BY invoice_date`, v);
      const out = rows.map((r) => ({ day: r.day, bills: Number(r.bills), net: money(r.net), discount: money(r.discount), tax: money(r.tax), total: money(r.total), credited: money(r.credited), net_sales: money(r.total - r.credited) }));
      return { columns: [col('day', 'Date', 'date'), col('bills', 'Bills', 'number'), col('net', 'Before tax', 'money'), col('discount', 'Discounts', 'money'), col('tax', 'Tax', 'money'), col('total', 'Billed', 'money'), col('credited', 'Credit notes', 'money'), col('net_sales', 'Net sales', 'money')], rows: out, totals: sum(out, ['bills', 'net', 'discount', 'tax', 'total', 'credited', 'net_sales']) };
    }
  },
  'sales-monthly': {
    group: 'Sales', title: 'Monthly sales',
    async run(c) {
      const v = [c.businessId, `${addDays(c.to, -365).slice(0, 8)}01`, c.to];
      const { rows } = await pool.query(
        `SELECT to_char(date_trunc('month', invoice_date), 'YYYY-MM') AS month, COUNT(*) AS bills, COALESCE(SUM(subtotal_paise), 0) AS net, COALESCE(SUM(tax_paise), 0) AS tax, COALESCE(SUM(total_paise - credited_paise), 0) AS net_sales
         FROM invoices i WHERE business_id = $1 AND status = 'ISSUED' AND invoice_date BETWEEN $2::date AND $3::date${bf(c, 'i.branch_id', v)} GROUP BY 1 ORDER BY 1`, v);
      const out = rows.map((r) => ({ month: r.month, bills: Number(r.bills), net: money(r.net), tax: money(r.tax), net_sales: money(r.net_sales) }));
      return { columns: [col('month', 'Month'), col('bills', 'Bills', 'number'), col('net', 'Before tax', 'money'), col('tax', 'Tax', 'money'), col('net_sales', 'Net sales', 'money')], rows: out, totals: sum(out, ['bills', 'net', 'tax', 'net_sales']), note: 'The last 12 months up to the end date.' };
    }
  },
  'sales-by-service': {
    group: 'Sales', title: 'Service sales',
    async run(c) {
      const v = [c.businessId, c.from, c.to];
      const { rows } = await pool.query(
        `SELECT p.name, COALESCE(SUM(ii.quantity) FILTER (WHERE sl.line_type = 'SERVICE'), 0) AS sold,
                COALESCE(SUM(ii.quantity) FILTER (WHERE sl.line_type IN ('PACKAGE_USE','MEMBERSHIP_USE')), 0) AS from_plans,
                COALESCE(SUM(${NET_LINE}) FILTER (WHERE sl.line_type = 'SERVICE'), 0) AS revenue
         FROM salon_invoice_lines sl JOIN invoice_items ii ON ii.item_id = sl.item_id JOIN invoices i ON i.invoice_id = sl.invoice_id JOIN products p ON p.product_id = ii.product_id
         WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2::date AND $3::date AND sl.line_type IN ('SERVICE','PACKAGE_USE','MEMBERSHIP_USE')${bf(c, 'i.branch_id', v)}
         GROUP BY p.name ORDER BY revenue DESC, p.name`, v);
      const out = rows.map((r) => ({ service: r.name, done: Number(r.sold) + Number(r.from_plans), paid: Number(r.sold), from_plans: Number(r.from_plans), revenue: money(r.revenue), average: Number(r.sold) ? money(Math.round(Number(r.revenue) / Number(r.sold))) : 0 }));
      return { columns: [col('service', 'Service'), col('done', 'Times done', 'number'), col('paid', 'Paid', 'number'), col('from_plans', 'From packages / memberships', 'number'), col('revenue', 'Revenue (before tax)', 'money'), col('average', 'Average price', 'money')], rows: out, totals: sum(out, ['done', 'paid', 'from_plans', 'revenue']) };
    }
  },
  'sales-by-product': {
    group: 'Sales', title: 'Product sales',
    async run(c) {
      const v = [c.businessId, c.from, c.to];
      const { rows } = await pool.query(
        `SELECT p.name, SUM(ii.quantity) AS units, COALESCE(SUM(${NET_LINE}), 0) AS revenue, COALESCE(SUM(ii.quantity * COALESCE(ii.unit_cost_paise, 0)), 0) AS cost
         FROM salon_invoice_lines sl JOIN invoice_items ii ON ii.item_id = sl.item_id JOIN invoices i ON i.invoice_id = sl.invoice_id JOIN products p ON p.product_id = ii.product_id
         WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2::date AND $3::date AND sl.line_type = 'PRODUCT'${bf(c, 'i.branch_id', v)} GROUP BY p.name ORDER BY revenue DESC`, v);
      const out = rows.map((r) => ({ product: r.name, units: Number(r.units), revenue: money(r.revenue), cost: money(Math.round(r.cost)), profit: money(Math.round(r.revenue - r.cost)) }));
      return { columns: [col('product', 'Product'), col('units', 'Units', 'number'), col('revenue', 'Revenue (before tax)', 'money'), col('cost', 'Cost', 'money'), col('profit', 'Gross profit', 'money')], rows: out, totals: sum(out, ['units', 'revenue', 'cost', 'profit']) };
    }
  },
  'sales-packages': {
    group: 'Sales', title: 'Package sales',
    async run(c) {
      const v = [c.businessId, c.from, c.to];
      const { rows } = await pool.query(
        `SELECT cp.name, COUNT(*) AS sold, COALESCE(SUM(cp.price_paise), 0) AS value,
                (SELECT COUNT(*) FROM salon_customer_packages x WHERE x.business_id = $1 AND x.name = cp.name AND x.status = 'ACTIVE' AND x.expiry_date >= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata'))::date) AS active,
                COALESCE(SUM((SELECT SUM(qty_used) FROM salon_customer_package_items i WHERE i.cp_id = cp.cp_id)), 0) AS visits_used
         FROM salon_customer_packages cp JOIN invoices i ON i.invoice_id = cp.invoice_id AND i.status = 'ISSUED'
         WHERE cp.business_id = $1 AND cp.purchased_on BETWEEN $2::date AND $3::date AND cp.status <> 'CANCELLED'${bf(c, 'cp.branch_id', v)} GROUP BY cp.name ORDER BY value DESC`, v);
      const out = rows.map((r) => ({ package: r.name, sold: Number(r.sold), value: money(r.value), active: Number(r.active), visits_used: Number(r.visits_used) }));
      return { columns: [col('package', 'Package'), col('sold', 'Sold', 'number'), col('value', 'Sales value', 'money'), col('active', 'Active now', 'number'), col('visits_used', 'Visits used', 'number')], rows: out, totals: sum(out, ['sold', 'value', 'visits_used']) };
    }
  },
  'sales-memberships': {
    group: 'Sales', title: 'Membership sales',
    async run(c) {
      const v = [c.businessId, c.from, c.to];
      const { rows } = await pool.query(
        `SELECT m.plan_name, COUNT(*) FILTER (WHERE m.renewed_from IS NULL) AS new_members, COUNT(*) FILTER (WHERE m.renewed_from IS NOT NULL) AS renewals, COALESCE(SUM(m.price_paise), 0) AS value,
                (SELECT COUNT(*) FROM salon_customer_memberships x WHERE x.business_id = $1 AND x.plan_name = m.plan_name AND x.status = 'ACTIVE' AND x.expiry_date >= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata'))::date) AS active
         FROM salon_customer_memberships m JOIN invoices i ON i.invoice_id = m.invoice_id AND i.status = 'ISSUED'
         WHERE m.business_id = $1 AND m.start_date BETWEEN $2::date AND $3::date AND m.status <> 'CANCELLED'${bf(c, 'm.branch_id', v)} GROUP BY m.plan_name ORDER BY value DESC`, v);
      const out = rows.map((r) => ({ plan: r.plan_name, new_members: Number(r.new_members), renewals: Number(r.renewals), value: money(r.value), active: Number(r.active) }));
      return { columns: [col('plan', 'Plan'), col('new_members', 'New members', 'number'), col('renewals', 'Renewals', 'number'), col('value', 'Sales value', 'money'), col('active', 'Active now', 'number')], rows: out, totals: sum(out, ['new_members', 'renewals', 'value']) };
    }
  },

  /* Customers */
  'customers-new-returning': {
    group: 'Customers', title: 'New and returning customers',
    async run(c) {
      const v = [c.businessId, c.from, c.to];
      const { rows } = await pool.query(
        `SELECT to_char(date_trunc('week', i.invoice_date), 'YYYY-MM-DD') AS week,
                COUNT(DISTINCT i.customer_id) FILTER (WHERE st.first_visit >= $2::date) AS new_customers,
                COUNT(DISTINCT i.customer_id) FILTER (WHERE st.first_visit < $2::date OR i.invoice_date > st.first_visit) AS returning_customers,
                COUNT(*) AS visits
         FROM invoices i JOIN salon_customer_stats st ON st.customer_id = i.customer_id
         WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.customer_id IS NOT NULL AND i.invoice_date BETWEEN $2::date AND $3::date${bf(c, 'i.branch_id', v)} GROUP BY 1 ORDER BY 1`, v);
      const out = rows.map((r) => ({ week: r.week, new_customers: Number(r.new_customers), returning_customers: Number(r.returning_customers), visits: Number(r.visits) }));
      return { columns: [col('week', 'Week starting', 'date'), col('new_customers', 'New', 'number'), col('returning_customers', 'Returning', 'number'), col('visits', 'Visits', 'number')], rows: out, totals: sum(out, ['new_customers', 'returning_customers', 'visits']) };
    }
  },
  'customers-retention': {
    group: 'Customers', title: 'Customer retention',
    async run(c) {
      const days = Math.max(1, Math.round((Date.parse(c.to) - Date.parse(c.from)) / 86400000) + 1);
      const prevFrom = addDays(c.from, -days); const prevTo = addDays(c.from, -1);
      const v = [c.businessId, prevFrom, prevTo, c.from, c.to];
      const r = (await pool.query(
        `WITH prev AS (SELECT DISTINCT customer_id FROM invoices i WHERE business_id = $1 AND status = 'ISSUED' AND customer_id IS NOT NULL AND invoice_date BETWEEN $2::date AND $3::date${bf(c, 'i.branch_id', v)}),
              cur AS (SELECT DISTINCT customer_id FROM invoices i WHERE business_id = $1 AND status = 'ISSUED' AND customer_id IS NOT NULL AND invoice_date BETWEEN $4::date AND $5::date${bf(c, 'i.branch_id', v)})
         SELECT (SELECT COUNT(*) FROM prev) AS prev_n, (SELECT COUNT(*) FROM cur) AS cur_n, (SELECT COUNT(*) FROM prev JOIN cur USING (customer_id)) AS kept`, v)).rows[0];
      const prev = Number(r.prev_n); const kept = Number(r.kept);
      const rows = [
        { metric: `Customers in the previous ${days} days`, value: prev },
        { metric: 'Of those, came back in this period', value: kept },
        { metric: 'Retention rate', value: prev ? Math.round((kept / prev) * 1000) / 10 : 0, unit: '%' },
        { metric: 'Customers in this period', value: Number(r.cur_n) },
        { metric: 'New this period (not seen before)', value: Math.max(0, Number(r.cur_n) - kept) }
      ];
      return { columns: [col('metric', 'Measure'), col('value', 'Value', 'number')], rows, totals: null, note: `This period compared with the ${days} days before it (${prevFrom} to ${prevTo}).` };
    }
  },
  'customers-ltv': {
    group: 'Customers', title: 'Customer lifetime value',
    async run(c) {
      const v = [c.businessId];
      const { rows } = await pool.query(
        `SELECT c.name, c.phone, st.visits, st.spend_paise, st.first_visit, st.last_visit,
                CASE WHEN st.visits > 1 THEN ((st.last_visit - st.first_visit)::numeric / (st.visits - 1)) END AS gap_days
         FROM salon_customer_stats st JOIN customers c ON c.customer_id = st.customer_id WHERE st.business_id = $1 AND st.visits > 0 ORDER BY st.spend_paise DESC LIMIT 200`, v);
      const out = rows.map((r) => ({ customer: r.name, phone: r.phone, visits: Number(r.visits), lifetime_value: money(r.spend_paise), average_bill: money(Math.round(Number(r.spend_paise) / Number(r.visits))), first_visit: r.first_visit, last_visit: r.last_visit, days_between_visits: r.gap_days == null ? null : Math.round(Number(r.gap_days)) }));
      const avg = out.length ? Math.round((out.reduce((s, r) => s + r.lifetime_value, 0) / out.length) * 100) / 100 : 0;
      return { columns: [col('customer', 'Customer'), col('phone', 'Phone'), col('visits', 'Visits', 'number'), col('lifetime_value', 'Lifetime value', 'money'), col('average_bill', 'Average bill', 'money'), col('days_between_visits', 'Days between visits', 'number'), col('last_visit', 'Last visit', 'date')], rows: out, totals: { lifetime_value: avg }, note: `Top 200 customers by lifetime spend. Average lifetime value among them: ₹${avg.toLocaleString('en-IN')}.` };
    }
  },
  'customers-top': {
    group: 'Customers', title: 'Top customers',
    async run(c) {
      const v = [c.businessId, c.from, c.to];
      const { rows } = await pool.query(
        `SELECT cu.name, cu.phone, COUNT(*) AS visits, COALESCE(SUM(i.total_paise - i.credited_paise), 0) AS spend
         FROM invoices i JOIN customers cu ON cu.customer_id = i.customer_id WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2::date AND $3::date${bf(c, 'i.branch_id', v)}
         GROUP BY cu.customer_id, cu.name, cu.phone ORDER BY spend DESC LIMIT 50`, v);
      const out = rows.map((r) => ({ customer: r.name, phone: r.phone, visits: Number(r.visits), spend: money(r.spend) }));
      return { columns: [col('customer', 'Customer'), col('phone', 'Phone'), col('visits', 'Visits', 'number'), col('spend', 'Spent', 'money')], rows: out, totals: sum(out, ['visits', 'spend']) };
    }
  },

  /* Staff */
  'staff-performance': {
    group: 'Staff', title: 'Staff performance',
    async run(c) {
      const v = [c.businessId, c.from, c.to];
      const showCommission = canSeeCommission(c.tenant);
      const { rows } = await pool.query(
        `SELECT s.name, s.staff_role,
                COALESCE(SUM(ii.quantity) FILTER (WHERE sl.line_type IN ('SERVICE','PACKAGE_USE','MEMBERSHIP_USE')), 0) AS services,
                COALESCE(SUM(${NET_LINE}) FILTER (WHERE sl.line_type = 'SERVICE'), 0) AS service_revenue,
                COALESCE(SUM(${NET_LINE}) FILTER (WHERE sl.line_type = 'PRODUCT'), 0) AS product_revenue,
                COALESCE(SUM(${NET_LINE}) FILTER (WHERE sl.line_type IN ('PACKAGE','MEMBERSHIP')), 0) AS plan_revenue,
                COUNT(DISTINCT i.invoice_id) AS bills,
                (SELECT COUNT(*) FROM salon_attendance a WHERE a.staff_id = s.staff_id AND a.work_date BETWEEN $2::date AND $3::date AND a.status IN ('PRESENT','HALF_DAY')) AS days_present,
                (SELECT COALESCE(SUM(cm.amount_paise), 0) FROM salon_commissions cm WHERE cm.staff_id = s.staff_id AND cm.status <> 'VOID' AND cm.earned_on BETWEEN $2::date AND $3::date) AS commission
         FROM salon_staff s LEFT JOIN salon_invoice_lines sl ON sl.staff_id = s.staff_id
         LEFT JOIN invoices i ON i.invoice_id = sl.invoice_id AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2::date AND $3::date
         LEFT JOIN invoice_items ii ON ii.item_id = sl.item_id AND i.invoice_id IS NOT NULL
         WHERE s.business_id = $1${bf(c, 's.branch_id', v)} GROUP BY s.staff_id, s.name, s.staff_role ORDER BY 3 DESC, s.name`, v);
      const out = rows.map((r) => {
        const total = Number(r.service_revenue) + Number(r.product_revenue) + Number(r.plan_revenue);
        return {
          staff: r.name, role: r.staff_role, services: Number(r.services), service_revenue: money(r.service_revenue), product_revenue: money(r.product_revenue), plan_revenue: money(r.plan_revenue), total_revenue: money(total),
          bills: Number(r.bills), days_present: Number(r.days_present), revenue_per_day: Number(r.days_present) ? money(Math.round(total / Number(r.days_present))) : null,
          ...(showCommission ? { commission: money(r.commission) } : {})
        };
      });
      const columns = [col('staff', 'Staff'), col('services', 'Services', 'number'), col('service_revenue', 'Service sales', 'money'), col('product_revenue', 'Product sales', 'money'), col('plan_revenue', 'Plans sold', 'money'), col('total_revenue', 'Total', 'money'), col('bills', 'Bills', 'number'), col('days_present', 'Days present', 'number'), col('revenue_per_day', 'Revenue per day', 'money')];
      if (showCommission) columns.push(col('commission', 'Commission', 'money'));
      return { columns, rows: out, totals: sum(out, ['services', 'service_revenue', 'product_revenue', 'plan_revenue', 'total_revenue', 'bills', ...(showCommission ? ['commission'] : [])]) };
    }
  },

  /* Inventory */
  'stock-valuation': {
    group: 'Inventory', title: 'Stock valuation',
    async run(c) {
      const v = [c.businessId];
      const { rows } = await pool.query(
        `SELECT p.name, p.unit, p.kind, SUM(bs.quantity) AS qty, p.purchase_price_paise AS cost
         FROM products p JOIN branch_stock bs ON bs.product_id = p.product_id
         WHERE p.business_id = $1 AND p.track_inventory AND p.status = 'ACTIVE' AND p.kind IN ('DISH','INGREDIENT','PACKAGING')${bf(c, 'bs.branch_id', v)} GROUP BY p.product_id, p.name, p.unit, p.kind, p.purchase_price_paise HAVING SUM(bs.quantity) <> 0 ORDER BY SUM(bs.quantity) * p.purchase_price_paise DESC`, v);
      const out = rows.map((r) => ({ item: r.name, type: r.kind === 'DISH' ? 'Retail' : 'Consumable', unit: r.unit, quantity: Number(r.qty), cost: money(r.cost), value: money(Math.round(Number(r.qty) * Number(r.cost))) }));
      return { columns: [col('item', 'Item'), col('type', 'Type'), col('unit', 'Unit'), col('quantity', 'In stock', 'number'), col('cost', 'Cost each', 'money'), col('value', 'Value', 'money')], rows: out, totals: sum(out, ['value']) };
    }
  },
  'stock-movement': {
    group: 'Inventory', title: 'Stock movement',
    async run(c) {
      const v = [c.businessId, c.from, c.to];
      const { rows } = await pool.query(
        `SELECT p.name, p.unit, COALESCE(SUM(t.quantity) FILTER (WHERE t.quantity > 0), 0) AS stock_in, COALESCE(-SUM(t.quantity) FILTER (WHERE t.quantity < 0 AND t.transaction_type = 'SALE'), 0) AS used_or_sold,
                COALESCE(-SUM(t.quantity) FILTER (WHERE t.quantity < 0 AND t.transaction_type = 'WASTAGE'), 0) AS wasted,
                COALESCE(-SUM(t.quantity) FILTER (WHERE t.quantity < 0 AND t.transaction_type NOT IN ('SALE','WASTAGE')), 0) AS other_out, COALESCE(SUM(t.quantity), 0) AS net
         FROM inventory_transactions t JOIN products p ON p.product_id = t.product_id
         WHERE t.business_id = $1 AND t.created_at >= $2::date AND t.created_at < $3::date + 1${bf(c, 't.branch_id', v)} GROUP BY p.product_id, p.name, p.unit ORDER BY p.name`, v);
      const out = rows.map((r) => ({ item: r.name, unit: r.unit, stock_in: Number(r.stock_in), used_or_sold: Number(r.used_or_sold), wasted: Number(r.wasted), other_out: Number(r.other_out), net: Number(r.net) }));
      return { columns: [col('item', 'Item'), col('unit', 'Unit'), col('stock_in', 'Stock in', 'number'), col('used_or_sold', 'Used / sold', 'number'), col('wasted', 'Wasted', 'number'), col('other_out', 'Other out', 'number'), col('net', 'Net change', 'number')], rows: out, totals: null };
    }
  },
  'product-consumption': {
    group: 'Inventory', title: 'Consumable use vs recipe',
    async run(c) {
      const v = [c.businessId, c.from, c.to];
      const { rows } = await pool.query(
        `WITH used AS (
           SELECT t.product_id, -SUM(t.quantity) AS actual FROM inventory_transactions t JOIN products p ON p.product_id = t.product_id
           WHERE t.business_id = $1 AND t.transaction_type = 'SALE' AND t.quantity < 0 AND p.kind IN ('INGREDIENT','PACKAGING') AND t.created_at >= $2::date AND t.created_at < $3::date + 1${bf(c, 't.branch_id', v)} GROUP BY t.product_id),
         expected AS (
           SELECT r.ingredient_product_id AS product_id, SUM(ii.quantity * r.quantity * (1 + r.wastage_pct / 100)) AS expected
           FROM salon_invoice_lines sl JOIN invoice_items ii ON ii.item_id = sl.item_id JOIN invoices i ON i.invoice_id = sl.invoice_id
           JOIN recipe_items r ON r.dish_product_id = ii.product_id AND r.branch_id IS NULL
           WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2::date AND $3::date AND sl.line_type IN ('SERVICE','PACKAGE_USE','MEMBERSHIP_USE')${bf(c, 'i.branch_id', v)} GROUP BY r.ingredient_product_id)
         SELECT p.name, p.unit, p.purchase_price_paise, COALESCE(u.actual, 0) AS actual, COALESCE(e.expected, 0) AS expected
         FROM products p LEFT JOIN used u ON u.product_id = p.product_id LEFT JOIN expected e ON e.product_id = p.product_id
         WHERE p.business_id = $1 AND (u.actual IS NOT NULL OR e.expected IS NOT NULL) ORDER BY p.name`, v);
      const out = rows.map((r) => ({ item: r.name, unit: r.unit, used: Math.round(Number(r.actual) * 1000) / 1000, expected: Math.round(Number(r.expected) * 1000) / 1000, difference: Math.round((Number(r.actual) - Number(r.expected)) * 1000) / 1000, cost_used: money(Math.round(Number(r.actual) * Number(r.purchase_price_paise))) }));
      return { columns: [col('item', 'Consumable'), col('unit', 'Unit'), col('used', 'Actually used', 'number'), col('expected', 'Expected from services', 'number'), col('difference', 'Difference', 'number'), col('cost_used', 'Cost used', 'money')], rows: out, totals: sum(out, ['cost_used']), note: 'Expected is what the services billed in this period should use according to their default recipes; a positive difference means more was used (or recorded) than the recipes say.' };
    }
  },
  wastage: {
    group: 'Inventory', title: 'Wastage',
    async run(c) {
      const v = [c.businessId, c.from, c.to];
      const { rows } = await pool.query(
        `SELECT p.name, p.unit, COALESCE(t.reason_code, 'OTHER') AS reason, -SUM(t.quantity) AS qty, -SUM(t.quantity) * p.purchase_price_paise AS value
         FROM inventory_transactions t JOIN products p ON p.product_id = t.product_id
         WHERE t.business_id = $1 AND t.transaction_type = 'WASTAGE' AND t.created_at >= $2::date AND t.created_at < $3::date + 1${bf(c, 't.branch_id', v)}
         GROUP BY p.product_id, p.name, p.unit, t.reason_code, p.purchase_price_paise ORDER BY value DESC`, v);
      const out = rows.map((r) => ({ item: r.name, unit: r.unit, reason: r.reason, quantity: Number(r.qty), value: money(Math.round(Number(r.value))) }));
      return { columns: [col('item', 'Item'), col('unit', 'Unit'), col('reason', 'Reason'), col('quantity', 'Quantity', 'number'), col('value', 'Value', 'money')], rows: out, totals: sum(out, ['value']) };
    }
  },
  'expired-products': {
    group: 'Inventory', title: 'Expired and expiring stock',
    async run(c) {
      const settings = await getSettings(pool, c.businessId);
      const positions = await batchPositions(pool, c.businessId, { branchId: c.tenant.scopeBranchId, today: c.today });
      const rows = positions.filter((b) => b.remaining > 0 && b.expiry_date && b.days_to_expiry <= settings.expiry_alert_days)
        .map((b) => ({ item: b.product, batch: b.batch_no, branch: b.branch, expiry: b.expiry_date, days_left: b.days_to_expiry, status: b.days_to_expiry < 0 ? 'Expired' : 'Expiring soon', remaining: b.remaining, value: money(Math.round(b.remaining * Number(b.unit_cost_paise || 0))) }))
        .sort((a, b) => a.days_left - b.days_left);
      return { columns: [col('item', 'Item'), col('batch', 'Batch'), col('branch', 'Outlet'), col('expiry', 'Expires', 'date'), col('days_left', 'Days left', 'number'), col('status', 'Status'), col('remaining', 'Remaining', 'number'), col('value', 'Value at cost', 'money')], rows, totals: sum(rows, ['value']), note: `Batches expired or expiring within ${settings.expiry_alert_days} days.` };
    }
  },
  'low-stock': {
    group: 'Inventory', title: 'Low stock',
    async run(c) {
      const v = [c.businessId];
      const { rows } = await pool.query(
        `SELECT p.name, p.unit, p.kind, p.min_stock, SUM(bs.quantity) AS qty FROM products p JOIN branch_stock bs ON bs.product_id = p.product_id
         WHERE p.business_id = $1 AND p.status = 'ACTIVE' AND p.track_inventory AND p.kind IN ('DISH','INGREDIENT','PACKAGING')${bf(c, 'bs.branch_id', v)} GROUP BY p.product_id, p.name, p.unit, p.kind, p.min_stock HAVING SUM(bs.quantity) <= p.min_stock AND p.min_stock > 0 ORDER BY SUM(bs.quantity)`, v);
      const out = rows.map((r) => ({ item: r.name, type: r.kind === 'DISH' ? 'Retail' : 'Consumable', unit: r.unit, in_stock: Number(r.qty), minimum: Number(r.min_stock), to_order: Math.max(0, Number(r.min_stock) * 2 - Number(r.qty)) }));
      return { columns: [col('item', 'Item'), col('type', 'Type'), col('unit', 'Unit'), col('in_stock', 'In stock', 'number'), col('minimum', 'Minimum', 'number'), col('to_order', 'Suggested order', 'number')], rows: out, totals: null, note: 'Suggested order brings stock back to twice the minimum.' };
    }
  },

  /* Financial */
  'financial-summary': {
    group: 'Financial', title: 'Revenue, expenses and profit',
    async run(c) {
      const v = [c.businessId, c.from, c.to];
      const lines = (await pool.query(
        `SELECT sl.line_type, COALESCE(SUM(${NET_LINE}), 0) AS revenue,
                COALESCE(SUM((ii.quantity - COALESCE((SELECT SUM(cn.quantity) FROM credit_note_items cn WHERE cn.invoice_item_id = ii.item_id), 0)) * COALESCE(ii.unit_cost_paise, 0)), 0) AS cost
         FROM salon_invoice_lines sl JOIN invoice_items ii ON ii.item_id = sl.item_id JOIN invoices i ON i.invoice_id = sl.invoice_id
         WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2::date AND $3::date AND sl.line_type <> 'GIFT_CARD'${bf(c, 'i.branch_id', v)} GROUP BY sl.line_type`, v)).rows;
      const ev = [c.businessId, c.from, c.to];
      const expenses = (await pool.query(`SELECT category, COALESCE(SUM(amount_paise), 0) AS total FROM expenses e WHERE business_id = $1 AND expense_date BETWEEN $2::date AND $3::date${bf(c, 'e.branch_id', ev)} GROUP BY category ORDER BY total DESC`, ev)).rows;
      const tv = [c.businessId, c.from, c.to];
      const tax = (await pool.query(
        `SELECT COALESCE(SUM(tax_paise), 0) AS tax, COALESCE(SUM(cgst_paise), 0) AS cgst, COALESCE(SUM(sgst_paise), 0) AS sgst, COALESCE(SUM(igst_paise), 0) AS igst FROM invoices i WHERE business_id = $1 AND status = 'ISSUED' AND invoice_date BETWEEN $2::date AND $3::date${bf(c, 'i.branch_id', tv)}`, tv)).rows[0];
      const gv = [c.businessId, c.from, c.to];
      const giftSold = (await pool.query(`SELECT COALESCE(SUM(ii.line_total_paise), 0) AS n FROM salon_invoice_lines sl JOIN invoice_items ii ON ii.item_id = sl.item_id JOIN invoices i ON i.invoice_id = sl.invoice_id WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2::date AND $3::date AND sl.line_type = 'GIFT_CARD'${bf(c, 'i.branch_id', gv)}`, gv)).rows[0];
      const label = { SERVICE: 'Services', PRODUCT: 'Products', PACKAGE: 'Packages sold', MEMBERSHIP: 'Memberships sold', PACKAGE_USE: 'Package visits', MEMBERSHIP_USE: 'Membership visits' };
      const revenue = lines.filter((l) => Number(l.revenue) !== 0).map((l) => ({ section: 'Revenue', item: label[l.line_type] || l.line_type, amount: money(l.revenue) }));
      const totalRevenue = lines.reduce((s, l) => s + Number(l.revenue), 0);
      const cogs = lines.reduce((s, l) => s + Number(l.cost), 0);
      const exp = expenses.map((e) => ({ section: 'Expenses', item: e.category, amount: money(e.total) }));
      const totalExpenses = expenses.reduce((s, e) => s + Number(e.total), 0);
      const rows = [
        ...revenue, { section: 'Revenue', item: 'Total revenue (before tax)', amount: money(totalRevenue), strong: true },
        { section: 'Profit', item: 'Cost of consumables and products sold', amount: money(Math.round(cogs)) },
        { section: 'Profit', item: 'Gross profit', amount: money(Math.round(totalRevenue - cogs)), strong: true },
        ...exp, { section: 'Expenses', item: 'Total expenses', amount: money(totalExpenses), strong: true },
        { section: 'Profit', item: 'Net profit', amount: money(Math.round(totalRevenue - cogs - totalExpenses)), strong: true },
        { section: 'Tax collected', item: 'CGST', amount: money(tax.cgst) }, { section: 'Tax collected', item: 'SGST', amount: money(tax.sgst) }, { section: 'Tax collected', item: 'IGST', amount: money(tax.igst) },
        { section: 'Tax collected', item: 'Total tax', amount: money(tax.tax), strong: true },
        { section: 'Stored value', item: 'Gift cards sold (not revenue until spent)', amount: money(giftSold.n) }
      ];
      return { columns: [col('section', 'Section'), col('item', 'Item'), col('amount', 'Amount', 'money')], rows, totals: null, note: 'Revenue is before tax and after credit notes. Gift cards count as revenue when they are spent on services and products.' };
    }
  },
  'payment-methods': {
    group: 'Financial', title: 'Payment methods',
    async run(c) {
      const v = [c.businessId, c.from, c.to];
      const { rows } = await pool.query(
        `SELECT payment_method AS method, COUNT(*) AS payments, COALESCE(SUM(amount_paise), 0) AS amount FROM payments p
         WHERE business_id = $1 AND payment_date BETWEEN $2::date AND $3::date AND invoice_id IS NOT NULL${bf(c, 'p.branch_id', v)} GROUP BY payment_method ORDER BY amount DESC`, v);
      const out = rows.map((r) => ({ method: r.method.replace('_', ' ').toLowerCase().replace(/^./, (x) => x.toUpperCase()), payments: Number(r.payments), amount: money(r.amount) }));
      return { columns: [col('method', 'Method'), col('payments', 'Payments', 'number'), col('amount', 'Amount', 'money')], rows: out, totals: sum(out, ['payments', 'amount']) };
    }
  },
  outstanding: {
    group: 'Financial', title: 'Outstanding payments',
    async run(c) {
      const v = [c.businessId, c.today];
      const { rows } = await pool.query(
        `SELECT i.invoice_number, i.invoice_date::text AS date, cu.name AS customer, cu.phone, i.total_paise, i.balance_due_paise, ($2::date - i.invoice_date) AS age
         FROM invoices i LEFT JOIN customers cu ON cu.customer_id = i.customer_id WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.balance_due_paise > 0${bf(c, 'i.branch_id', v)} ORDER BY i.invoice_date LIMIT 500`, v);
      const out = rows.map((r) => ({ invoice: r.invoice_number, date: r.date, customer: r.customer || 'Walk-in', phone: r.phone, total: money(r.total_paise), due: money(r.balance_due_paise), age_days: Number(r.age) }));
      return { columns: [col('invoice', 'Invoice'), col('date', 'Date', 'date'), col('customer', 'Customer'), col('phone', 'Phone'), col('total', 'Bill', 'money'), col('due', 'Due', 'money'), col('age_days', 'Days old', 'number')], rows: out, totals: sum(out, ['due']) };
    }
  },

  /* Loyalty */
  loyalty: {
    group: 'Loyalty', title: 'Loyalty points',
    async run(c) {
      const v = [c.businessId, c.from, c.to];
      const p = (await pool.query(
        `SELECT COALESCE(SUM(points) FILTER (WHERE kind = 'EARN'), 0) AS issued, COALESCE(-SUM(points) FILTER (WHERE kind = 'REDEEM'), 0) AS redeemed,
                COALESCE(-SUM(points) FILTER (WHERE kind = 'EXPIRE'), 0) AS expired, COALESCE(SUM(points) FILTER (WHERE kind = 'ADJUST'), 0) AS adjusted,
                COALESCE(-SUM(points) FILTER (WHERE kind = 'REVERSAL'), 0) AS reversed
         FROM points_ledger WHERE business_id = $1 AND voided_at IS NULL AND created_at >= $2::date AND created_at < $3::date + 1`, v)).rows[0];
      const owed = (await pool.query(`SELECT COALESCE(SUM(bal) FILTER (WHERE bal > 0), 0) AS points, COUNT(*) FILTER (WHERE bal > 0) AS holders FROM (SELECT SUM(points) AS bal FROM points_ledger WHERE business_id = $1 AND voided_at IS NULL GROUP BY customer_id) t`, [c.businessId])).rows[0];
      const value = Number((await pool.query(`SELECT point_value_paise FROM points_programs WHERE business_id = $1`, [c.businessId])).rows[0]?.point_value_paise ?? 100);
      const rows = [
        { measure: 'Points issued', value: Number(p.issued) }, { measure: 'Points redeemed', value: Number(p.redeemed) }, { measure: 'Points expired', value: Number(p.expired) },
        { measure: 'Points taken back (cancelled or credited bills)', value: Number(p.reversed) }, { measure: 'Manual adjustments (net)', value: Number(p.adjusted) },
        { measure: 'Customers holding points', value: Number(owed.holders) }, { measure: 'Points outstanding', value: Number(owed.points) },
        { measure: 'Outstanding liability (₹)', value: money(Number(owed.points) * value) }
      ];
      return { columns: [col('measure', 'Measure'), col('value', 'Value', 'number')], rows, totals: null, note: 'Issued, redeemed, expired and adjusted cover the chosen dates; outstanding is as of now.' };
    }
  }
};

const ADVANCED = new Set(['customers-retention', 'customers-ltv', 'product-consumption', 'financial-summary', 'staff-performance']);

const sum = (rows, keys) => Object.fromEntries(keys.map((k) => [k, Math.round(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0) * 100) / 100]));

/* GET /api/salon/reports — the catalogue, grouped */
const catalog = async (req, res) => {
  const out = {};
  for (const [key, r] of Object.entries(REPORTS)) (out[r.group] ||= []).push({ key, title: r.title });
  ok(res, out);
};

/* GET /api/salon/reports/:name?from=&to= */
const run = async (req, res) => {
  const report = REPORTS[req.params.name];
  if (!report) throw new SalonError(404, 'Not found');
  if (ADVANCED.has(req.params.name) && !hasPlanFeature(req.tenant, 'advanced_reports')) {
    return res.status(402).json({ success: false, code: 'FEATURE_NOT_IN_PLAN', message: 'This report is part of Advanced reports, which is not on your plan.', data: { feature: 'advanced_reports' } });
  }
  const c = await context(req);
  const data = await report.run(c);
  ok(res, { key: req.params.name, title: report.title, group: report.group, from: c.from, to: c.to, ...data });
};

export default wrapAll({ dashboard, catalog, run });
