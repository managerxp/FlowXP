/*
 * Distributor reports. Like the wholesale reports they are functions of (db, ctx) computed from the live documents —
 * sales from the shared sales facts (invoice lines net of credit notes), stock and money from their own tables — so
 * a report can never disagree with a screen. They register themselves with the wholesale report catalogue and are
 * listed and run only for a distributor.
 *
 * Primary sales are what the distributor buys from its principals (goods receipts); secondary sales are what it sells
 * to retailers (invoices). The two are never mixed.
 */
import { r, n, pct, col, sum, run, runNow, registerReports } from '../wholesale/reports.js';
import { supplierBalances } from '../wholesale/ledger.js';
import { FACTS } from './facts.js';
import { TERRITORY_PATH_JOINS, territoryScope } from './common.js';
import { computeCommission } from './commission.js';
import { actualFor, progress } from './targets.js';
import { WholesaleError } from '../wholesale/common.js';

const WHERE = `f.business_id = $1 AND f.branch_id = ANY($2::int[]) AND f.invoice_date >= $3::date AND f.invoice_date <= $4::date`;

/** Sales facts grouped by a dimension: the standard sales / margin columns for it. */
const bySales = async (ctx, { name, joins = '', group, order = 'revenue DESC', where = '', extra = [] }) => {
  const rows = await run(ctx,
    `SELECT ${name} AS name, COUNT(DISTINCT f.invoice_id) AS invoices, COALESCE(SUM(f.units) FILTER (WHERE f.paid), 0) AS paid_units, COALESCE(SUM(f.units) FILTER (WHERE NOT f.paid), 0) AS free_units,
            COALESCE(SUM(f.revenue), 0) AS revenue, COALESCE(SUM(f.cost), 0) AS cost, COALESCE(SUM(f.cost) FILTER (WHERE NOT f.paid), 0) AS free_cost
     FROM ${FACTS} ${joins} WHERE ${WHERE} ${where} GROUP BY ${group} ORDER BY ${order}`, extra);
  return rows.map((x) => ({ name: x.name, invoices: n(x.invoices), paid_units: n(x.paid_units), free_units: n(x.free_units), revenue: r(x.revenue), cost: r(x.cost), margin: r(n(x.revenue) - n(x.cost)), margin_pct: pct(n(x.revenue) - n(x.cost), x.revenue), scheme_cost: r(x.free_cost) }));
};

const salesColumns = (label) => [col('name', label), col('invoices', 'Invoices', 'number'), col('paid_units', 'Units sold', 'number'), col('free_units', 'Free units', 'number'), col('revenue', 'Net sales (ex GST)', 'money'), col('cost', 'Cost', 'money'), col('margin', 'Gross margin', 'money'), col('margin_pct', 'Margin %', 'percent')];
const salesTotals = (rows) => ({ name: 'Total', invoices: sum(rows, 'invoices'), paid_units: sum(rows, 'paid_units'), free_units: sum(rows, 'free_units'), revenue: sum(rows, 'revenue'), cost: sum(rows, 'cost'), margin: sum(rows, 'margin'), margin_pct: pct(sum(rows, 'margin'), sum(rows, 'revenue')), scheme_cost: sum(rows, 'scheme_cost') });
const salesReport = async (ctx, spec, label, { withScheme = false } = {}) => {
  const rows = await bySales(ctx, spec);
  return { columns: [...salesColumns(label), ...(withScheme ? [col('scheme_cost', 'Free goods cost', 'money')] : [])], rows, totals: salesTotals(rows) };
};

/** Which node of the Region → Territory → Area tree a retailer's sales roll up to. */
const levelName = (level) => ({ REGION: `COALESCE(tr.name, 'Unassigned')`, TERRITORY: `COALESCE(tt.name, 'Unassigned')`, AREA: `CASE WHEN ta.level = 'AREA' THEN ta.name ELSE 'Unassigned' END` }[level]);
const levelOf = (ctx) => { const l = String(ctx.query.level || 'AREA').toUpperCase(); if (!['REGION', 'TERRITORY', 'AREA'].includes(l)) throw new WholesaleError(400, 'Level is REGION, TERRITORY or AREA'); return l; };

/** A retailer's territory path as one label, "South › Secunderabad › Ameerpet". */
const PATH = `COALESCE(tr.name || ' › ', '') || COALESCE(tt.name || ' › ', '') || COALESCE(ta.name, 'Unassigned')`;

const principalOf = (ctx) => (ctx.query.principal_id ? [Number(ctx.query.principal_id) || 0] : []);

registerReports({
  /* ── sales ─────────────────────────────────────────────────────────────── */
  primary_sales: {
    group: 'Primary sales', label: 'Primary sales (purchases from principals)', description: 'Goods received from principals: every goods receipt in the period, with the principal and its value.', period: true, filters: ['principal_id'],
    run: async (ctx) => {
      const extra = principalOf(ctx);
      const rows = await run(ctx,
        `SELECT g.grn_date::text AS date, g.grn_number, COALESCE(pr.name, s.name, 'Direct purchase') AS principal, po.po_number, g.supplier_invoice_no, b.name AS warehouse, g.total_cost_paise AS value,
                COALESCE((SELECT SUM(i.accepted_base) FROM wholesale_grn_items i WHERE i.grn_id = g.grn_id), 0) AS units
         FROM wholesale_grns g LEFT JOIN suppliers s ON s.supplier_id = g.supplier_id LEFT JOIN dist_principals pr ON pr.supplier_id = g.supplier_id AND pr.business_id = g.business_id
         LEFT JOIN purchase_orders po ON po.po_id = g.po_id JOIN branches b ON b.branch_id = g.branch_id
         WHERE g.business_id = $1 AND g.branch_id = ANY($2::int[]) AND g.status <> 'CANCELLED' AND g.grn_date >= $3::date AND g.grn_date <= $4::date ${extra.length ? 'AND pr.principal_id = $5' : ''} ORDER BY g.grn_date, g.grn_id`, extra);
      const data = rows.map((x) => ({ date: x.date, grn: x.grn_number, principal: x.principal, po: x.po_number, supplier_invoice: x.supplier_invoice_no, warehouse: x.warehouse, units: n(x.units), value: r(x.value) }));
      return { columns: [col('date', 'Date', 'date'), col('grn', 'GRN'), col('principal', 'Principal'), col('po', 'Order'), col('supplier_invoice', 'Their invoice'), col('warehouse', 'Warehouse'), col('units', 'Units received', 'number'), col('value', 'Value', 'money')], rows: data, totals: { date: 'Total', units: sum(data, 'units'), value: sum(data, 'value') } };
    }
  },
  secondary_sales: {
    group: 'Secondary sales', label: 'Secondary sales (to retailers)', description: 'What was sold to retailers, day by day, by where it was taken: office, field or van — net of returns, with free goods shown apart.', period: true, filters: ['group'],
    run: async (ctx) => {
      const unit = { day: 'day', week: 'week', month: 'month' }[ctx.query.group] || 'day';
      const rows = await run(ctx,
        `SELECT date_trunc('${unit}', f.invoice_date)::date::text AS period, COUNT(DISTINCT f.invoice_id) AS invoices, COALESCE(SUM(f.revenue), 0) AS revenue,
                COALESCE(SUM(f.revenue) FILTER (WHERE f.source = 'OFFICE'), 0) AS office, COALESCE(SUM(f.revenue) FILTER (WHERE f.source = 'FIELD'), 0) AS field, COALESCE(SUM(f.revenue) FILTER (WHERE f.source = 'VAN'), 0) AS van,
                COALESCE(SUM(f.units) FILTER (WHERE f.paid), 0) AS units, COALESCE(SUM(f.units) FILTER (WHERE NOT f.paid), 0) AS free_units, COALESCE(SUM(f.cost), 0) AS cost
         FROM ${FACTS} WHERE ${WHERE} GROUP BY 1 ORDER BY 1`);
      const data = rows.map((x) => ({ period: x.period, invoices: n(x.invoices), units: n(x.units), free_units: n(x.free_units), office: r(x.office), field: r(x.field), van: r(x.van), revenue: r(x.revenue), margin: r(n(x.revenue) - n(x.cost)) }));
      return { columns: [col('period', unit === 'day' ? 'Date' : unit === 'week' ? 'Week of' : 'Month of', 'date'), col('invoices', 'Invoices', 'number'), col('units', 'Units sold', 'number'), col('free_units', 'Free units', 'number'), col('office', 'Office', 'money'), col('field', 'Field', 'money'), col('van', 'Van', 'money'), col('revenue', 'Net sales (ex GST)', 'money'), col('margin', 'Gross margin', 'money')],
        rows: data, totals: { period: 'Total', invoices: sum(data, 'invoices'), units: sum(data, 'units'), free_units: sum(data, 'free_units'), office: sum(data, 'office'), field: sum(data, 'field'), van: sum(data, 'van'), revenue: sum(data, 'revenue'), margin: sum(data, 'margin') } };
    }
  },
  sales_by_territory: {
    group: 'Secondary sales', label: 'Sales by territory', description: 'Net sales and margin by region, territory or area — a region includes everything inside it.', period: true, filters: ['level'],
    run: async (ctx) => {
      const level = levelOf(ctx);
      return salesReport(ctx, { name: levelName(level), joins: `LEFT JOIN dist_territories ta ON ta.territory_id = f.territory_id
        LEFT JOIN dist_territories tt ON tt.territory_id = CASE WHEN ta.level = 'AREA' THEN ta.parent_id WHEN ta.level = 'TERRITORY' THEN ta.territory_id END
        LEFT JOIN dist_territories tr ON tr.territory_id = CASE WHEN ta.level = 'REGION' THEN ta.territory_id WHEN tt.level = 'TERRITORY' THEN tt.parent_id END`, group: '1' }, level === 'REGION' ? 'Region' : level === 'TERRITORY' ? 'Territory' : 'Area');
    }
  },
  sales_by_beat: {
    group: 'Secondary sales', label: 'Sales by beat', description: 'Net sales and margin for each beat (orders taken or delivered on it).', period: true,
    run: async (ctx) => salesReport(ctx, { name: `COALESCE(bt.name, 'No beat')`, joins: `LEFT JOIN dist_beats bt ON bt.beat_id = f.beat_id`, group: '1' }, 'Beat')
  },
  sales_by_brand: {
    group: 'Secondary sales', label: 'Sales by brand', description: 'Net sales and margin for each brand.', period: true,
    run: async (ctx) => salesReport(ctx, { name: `COALESCE(br.name, 'No brand')`, joins: `LEFT JOIN brands br ON br.brand_id = f.brand_id`, group: '1' }, 'Brand', { withScheme: true })
  },
  sales_by_principal: {
    group: 'Secondary sales', label: 'Sales by principal', description: 'Net sales and margin for the products of each principal.', period: true,
    run: async (ctx) => salesReport(ctx, { name: `COALESCE(pr.name, 'No principal')`, joins: `LEFT JOIN dist_principals pr ON pr.principal_id = f.principal_id`, group: '1' }, 'Principal', { withScheme: true })
  },
  margin_by: {
    group: 'Margin', label: 'Profit and margin', description: 'Purchase cost, selling price, discounts and the cost of free goods, giving gross profit and margin — by product, brand, principal, customer, salesperson, territory or category.', period: true, filters: ['by'],
    run: async (ctx) => {
      const by = String(ctx.query.by || 'product').toLowerCase();
      const dims = {
        product: ['pp.name', 'JOIN products pp ON pp.product_id = f.product_id', 'Product'],
        brand: [`COALESCE(br.name, 'No brand')`, 'LEFT JOIN brands br ON br.brand_id = f.brand_id', 'Brand'],
        principal: [`COALESCE(pr.name, 'No principal')`, 'LEFT JOIN dist_principals pr ON pr.principal_id = f.principal_id', 'Principal'],
        customer: ['cu.name', 'JOIN customers cu ON cu.customer_id = f.customer_id', 'Customer'],
        salesperson: [`COALESCE(sp.name, 'Unassigned')`, 'LEFT JOIN wholesale_salespeople sp ON sp.salesperson_id = f.salesperson_id', 'Salesperson'],
        territory: [PATH, `LEFT JOIN dist_territories ta ON ta.territory_id = f.territory_id LEFT JOIN dist_territories tt ON tt.territory_id = CASE WHEN ta.level = 'AREA' THEN ta.parent_id WHEN ta.level = 'TERRITORY' THEN ta.territory_id END LEFT JOIN dist_territories tr ON tr.territory_id = CASE WHEN ta.level = 'REGION' THEN ta.territory_id WHEN tt.level = 'TERRITORY' THEN tt.parent_id END`, 'Territory'],
        category: [`COALESCE(ca.name, 'No category')`, 'LEFT JOIN categories ca ON ca.category_id = f.category_id', 'Category']
      };
      const d = dims[by]; if (!d) throw new WholesaleError(400, `Group by one of: ${Object.keys(dims).join(', ')}`);
      const rows = await bySales(ctx, { name: d[0], joins: d[1], group: '1', order: '(COALESCE(SUM(f.revenue), 0) - COALESCE(SUM(f.cost), 0)) DESC' });
      return { columns: [...salesColumns(d[2]), col('scheme_cost', 'Free goods cost', 'money')], rows, totals: salesTotals(rows) };
    }
  },

  /* ── inventory ─────────────────────────────────────────────────────────── */
  vehicle_stock: {
    group: 'Inventory', label: 'Vehicle stock', description: 'What every van is carrying right now, by product and batch, with its value at cost.', period: false,
    run: async (ctx) => {
      const rows = await runNow(ctx,
        `SELECT v.vehicle_no, v.driver_name, p.name AS product, b.batch_no, b.expiry_date::text AS expiry, p.unit, s.qty_base AS qty, s.qty_base * p.purchase_price_paise AS value
         FROM dist_vehicle_stock s JOIN dist_vehicles v ON v.vehicle_id = s.vehicle_id JOIN products p ON p.product_id = s.product_id LEFT JOIN wholesale_batches b ON b.batch_id = s.batch_id
         WHERE s.business_id = $1 AND v.branch_id = ANY($2::int[]) AND s.qty_base > 0 ORDER BY v.vehicle_no, lower(p.name), b.expiry_date NULLS LAST`);
      const data = rows.map((x) => ({ vehicle: x.vehicle_no, driver: x.driver_name, product: x.product, batch: x.batch_no, expiry: x.expiry, unit: x.unit, qty: n(x.qty), value: r(x.value) }));
      return { columns: [col('vehicle', 'Vehicle'), col('driver', 'Driver'), col('product', 'Product'), col('batch', 'Batch'), col('expiry', 'Expiry', 'date'), col('unit', 'Unit'), col('qty', 'Quantity', 'number'), col('value', 'Value at cost', 'money')], rows: data, totals: { vehicle: 'Total', value: sum(data, 'value') } };
    }
  },
  fast_moving: {
    group: 'Inventory', label: 'Fast-moving products', description: 'The products that sell the most in the period, how fast, and how many days of stock are left at that pace.', period: true,
    run: async (ctx) => {
      const days = Math.max(1, Math.round((Date.parse(`${ctx.to}T00:00:00Z`) - Date.parse(`${ctx.from}T00:00:00Z`)) / 86400000) + 1);
      const rows = await run(ctx,
        `SELECT pp.name, pp.unit, COALESCE(SUM(f.units) FILTER (WHERE f.paid), 0) AS units, COALESCE(SUM(f.revenue), 0) AS revenue,
                COALESCE((SELECT SUM(bs.quantity) FROM branch_stock bs WHERE bs.product_id = pp.product_id AND bs.branch_id = ANY($2::int[])), 0) AS on_hand
         FROM ${FACTS} JOIN products pp ON pp.product_id = f.product_id WHERE ${WHERE} GROUP BY pp.product_id, pp.name, pp.unit HAVING COALESCE(SUM(f.units) FILTER (WHERE f.paid), 0) > 0 ORDER BY units DESC LIMIT 100`);
      const data = rows.map((x) => ({ product: x.name, unit: x.unit, units: n(x.units), per_day: Math.round((n(x.units) / days) * 10) / 10, revenue: r(x.revenue), on_hand: n(x.on_hand), days_of_stock: n(x.units) > 0 ? Math.round((n(x.on_hand) / (n(x.units) / days)) * 10) / 10 : null }));
      return { columns: [col('product', 'Product'), col('unit', 'Unit'), col('units', 'Units sold', 'number'), col('per_day', 'Per day', 'number'), col('revenue', 'Net sales', 'money'), col('on_hand', 'In stock', 'number'), col('days_of_stock', 'Days of stock left', 'number')], rows: data };
    }
  },
  dead_stock: {
    group: 'Inventory', label: 'Dead stock', description: 'Stock that has not sold for the dead-stock period set in settings, with the money tied up in it.', period: false,
    run: async (ctx) => {
      const days = Number(ctx.settings?.dead_stock_days || 180);
      const rows = await runNow(ctx,
        `SELECT p.name, p.unit, SUM(bs.quantity) AS qty, SUM(bs.quantity * p.purchase_price_paise) AS value,
                (SELECT MAX(t.created_at)::date::text FROM inventory_transactions t WHERE t.product_id = p.product_id AND t.transaction_type = 'SALE') AS last_sale
         FROM products p JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = ANY($2::int[])
         WHERE p.business_id = $1 AND p.status = 'ACTIVE' AND p.track_inventory AND bs.quantity > 0
           AND NOT EXISTS (SELECT 1 FROM inventory_transactions t WHERE t.product_id = p.product_id AND t.transaction_type = 'SALE' AND t.created_at > CURRENT_TIMESTAMP - make_interval(days => ${days | 0}))
           AND NOT EXISTS (SELECT 1 FROM wholesale_sales_order_items i JOIN wholesale_sales_orders o ON o.order_id = i.order_id WHERE i.product_id = p.product_id AND o.source = 'VAN' AND o.created_at > CURRENT_TIMESTAMP - make_interval(days => ${days | 0}))
         GROUP BY p.product_id, p.name, p.unit ORDER BY value DESC`);
      const data = rows.map((x) => ({ product: x.name, unit: x.unit, qty: n(x.qty), value: r(x.value), last_sale: x.last_sale }));
      return { columns: [col('product', 'Product'), col('unit', 'Unit'), col('qty', 'In stock', 'number'), col('value', 'Value at cost', 'money'), col('last_sale', 'Last sold', 'date')], rows: data, totals: { product: 'Total', value: sum(data, 'value') } };
    }
  },

  /* ── sales team ────────────────────────────────────────────────────────── */
  target_vs_actual: {
    group: 'Sales team', label: 'Target vs achievement', description: 'Every target running in the period against what has actually been sold, with what is left and the pace needed.', period: true,
    run: async (ctx) => {
      const targets = (await ctx.db.query(`SELECT * FROM dist_targets WHERE business_id = $1 AND period_start <= $3::date AND period_end >= $2::date ORDER BY scope_type, period_start, target_id`, [ctx.businessId, ctx.from, ctx.to])).rows;
      const names = new Map();
      for (const [type, table, id, nm] of [['SALESPERSON', 'wholesale_salespeople', 'salesperson_id', 'name'], ['TERRITORY', 'dist_territories', 'territory_id', 'name'], ['BRAND', 'brands', 'brand_id', 'name'], ['CATEGORY', 'categories', 'category_id', 'name'], ['PRODUCT', 'products', 'product_id', 'name'], ['CUSTOMER', 'customers', 'customer_id', 'name']]) {
        const ids = targets.filter((t) => t.scope_type === type).map((t) => t.scope_id); if (!ids.length) continue;
        for (const row of (await ctx.db.query(`SELECT ${id} AS id, ${nm} AS name FROM ${table} WHERE business_id = $1 AND ${id} = ANY($2::int[])`, [ctx.businessId, ids])).rows) names.set(`${type}:${row.id}`, row.name);
      }
      const data = [];
      for (const t of targets) {
        const a = await actualFor(ctx.db, { businessId: ctx.businessId, scopeType: t.scope_type, scopeId: t.scope_id, metric: t.metric, from: String(t.period_start).slice(0, 10), to: String(t.period_end).slice(0, 10) });
        const p = progress(t, a.actual, ctx.to);
        const money = t.metric === 'VALUE';
        data.push({ scope: t.scope_type.toLowerCase(), name: t.scope_type === 'BUSINESS' ? 'Whole business' : names.get(`${t.scope_type}:${t.scope_id}`) || '—', period: `${String(t.period_start).slice(0, 10)} → ${String(t.period_end).slice(0, 10)}`, measure: t.metric === 'VALUE' ? 'Sales value' : 'Quantity',
          target: money ? r(p.target) : p.target, actual: money ? r(p.actual) : p.actual, achievement: p.achievement_pct, remaining: money ? r(p.remaining) : p.remaining, per_day: money ? r(p.required_per_day) : p.required_per_day, status: p.status.replace('_', ' ').toLowerCase() });
      }
      return { columns: [col('scope', 'Scope'), col('name', 'Name'), col('period', 'Period'), col('measure', 'Measure'), col('target', 'Target', 'number'), col('actual', 'Actual', 'number'), col('achievement', 'Achievement %', 'percent'), col('remaining', 'Remaining', 'number'), col('per_day', 'Needed per day', 'number'), col('status', 'Status')], rows: data };
    }
  },
  salesperson_performance: {
    group: 'Sales team', label: 'Salesperson performance', description: 'Per salesperson: sales and margin, orders, visits and how many produced an order or a collection, collections and the average order.', period: true,
    run: async (ctx) => {
      const sales = new Map((await bySales(ctx, { name: `COALESCE(f.salesperson_id::text, '0')`, group: '1' })).map((x) => [x.name, x]));
      const reps = (await ctx.db.query(`SELECT salesperson_id, name, sales_role FROM wholesale_salespeople WHERE business_id = $1 AND status = 'ACTIVE' ORDER BY lower(name)`, [ctx.businessId])).rows;
      const orders = new Map((await ctx.db.query(`SELECT salesperson_id, COUNT(*) AS n, COALESCE(SUM(total_paise), 0) AS value FROM wholesale_sales_orders WHERE business_id = $1 AND order_date >= $2::date AND order_date <= $3::date AND status NOT IN ('DRAFT','CANCELLED','REJECTED') GROUP BY salesperson_id`, [ctx.businessId, ctx.from, ctx.to])).rows.map((x) => [x.salesperson_id, x]));
      const visits = new Map((await ctx.db.query(`SELECT salesperson_id, COUNT(*) AS n, COUNT(*) FILTER (WHERE outcome IN ('ORDER','COLLECTION')) AS productive FROM dist_visits WHERE business_id = $1 AND visit_date >= $2::date AND visit_date <= $3::date GROUP BY salesperson_id`, [ctx.businessId, ctx.from, ctx.to])).rows.map((x) => [x.salesperson_id, x]));
      const coll = new Map((await ctx.db.query(
        `SELECT s.salesperson_id, COALESCE(SUM(rc.amount_paise), 0) AS v FROM wholesale_receipts rc JOIN wholesale_salespeople s ON s.user_id = rc.created_by AND s.business_id = rc.business_id
         WHERE rc.business_id = $1 AND rc.kind = 'RECEIPT' AND rc.status = 'POSTED' AND rc.receipt_date >= $2::date AND rc.receipt_date <= $3::date GROUP BY s.salesperson_id`, [ctx.businessId, ctx.from, ctx.to])).rows.map((x) => [x.salesperson_id, x]));
      const data = reps.map((rep) => {
        const s = sales.get(String(rep.salesperson_id)); const o = orders.get(rep.salesperson_id); const v = visits.get(rep.salesperson_id); const c = coll.get(rep.salesperson_id);
        return { salesperson: rep.name, role: rep.sales_role.replace(/_/g, ' ').toLowerCase(), orders: n(o?.n), order_value: r(o?.value), avg_order: n(o?.n) ? r(n(o.value) / n(o.n)) : null, net_sales: s?.revenue ?? 0, margin: s?.margin ?? 0, visits: n(v?.n), productive: n(v?.productive), strike_rate: n(v?.n) ? pct(v.productive, v.n) : null, collections: r(c?.v) };
      });
      return { columns: [col('salesperson', 'Salesperson'), col('role', 'Role'), col('orders', 'Orders', 'number'), col('order_value', 'Order value', 'money'), col('avg_order', 'Average order', 'money'), col('net_sales', 'Net sales (ex GST)', 'money'), col('margin', 'Gross margin', 'money'), col('visits', 'Visits', 'number'), col('productive', 'Productive visits', 'number'), col('strike_rate', 'Strike rate %', 'percent'), col('collections', 'Collected', 'money')],
        rows: data, totals: { salesperson: 'Total', orders: sum(data, 'orders'), order_value: sum(data, 'order_value'), net_sales: sum(data, 'net_sales'), margin: sum(data, 'margin'), visits: sum(data, 'visits'), productive: sum(data, 'productive'), collections: sum(data, 'collections') } };
    }
  },
  territory_performance: {
    group: 'Sales team', label: 'Territory performance', description: 'Sales, margin, retailers and how many of them bought, by region, territory or area — with the target where one is set.', period: true, filters: ['level'],
    run: async (ctx) => {
      const level = levelOf(ctx);
      const sales = await bySales(ctx, { name: levelName(level), joins: `LEFT JOIN dist_territories ta ON ta.territory_id = f.territory_id
        LEFT JOIN dist_territories tt ON tt.territory_id = CASE WHEN ta.level = 'AREA' THEN ta.parent_id WHEN ta.level = 'TERRITORY' THEN ta.territory_id END
        LEFT JOIN dist_territories tr ON tr.territory_id = CASE WHEN ta.level = 'REGION' THEN ta.territory_id WHEN tt.level = 'TERRITORY' THEN tt.parent_id END`, group: '1' });
      const nodes = (await ctx.db.query(`SELECT territory_id, name FROM dist_territories WHERE business_id = $1 AND level = $2 ORDER BY lower(name)`, [ctx.businessId, level])).rows;
      const data = [];
      for (const node of nodes) {
        const scope = await territoryScope(ctx.db, ctx.businessId, node.territory_id);
        const customers = (await ctx.db.query(`SELECT COUNT(*) AS n FROM wholesale_customer_profiles WHERE business_id = $1 AND territory_id = ANY($2::int[])`, [ctx.businessId, scope])).rows[0].n;
        const buyers = (await ctx.db.query(`SELECT COUNT(DISTINCT f.customer_id) AS n FROM ${FACTS} WHERE ${WHERE} AND f.territory_id = ANY($5::int[])`, [ctx.businessId, ctx.branchIds, ctx.from, ctx.to, scope])).rows[0].n;
        const target = (await ctx.db.query(`SELECT SUM(target_amount) AS t FROM dist_targets WHERE business_id = $1 AND scope_type = 'TERRITORY' AND scope_id = $2 AND metric = 'VALUE' AND period_start <= $4::date AND period_end >= $3::date`, [ctx.businessId, node.territory_id, ctx.from, ctx.to])).rows[0].t;
        const s = sales.find((x) => x.name === node.name) || { invoices: 0, paid_units: 0, revenue: 0, margin: 0 };
        data.push({ name: node.name, retailers: n(customers), buying: n(buyers), invoices: s.invoices, revenue: s.revenue, margin: s.margin, margin_pct: s.margin_pct ?? null, target: target == null ? null : r(target), achievement: target == null ? null : pct(s.revenue * 100, target) });
      }
      const un = sales.find((x) => x.name === 'Unassigned');
      if (un) data.push({ name: 'Unassigned', retailers: null, buying: null, invoices: un.invoices, revenue: un.revenue, margin: un.margin, margin_pct: un.margin_pct, target: null, achievement: null });
      return { columns: [col('name', level === 'REGION' ? 'Region' : level === 'TERRITORY' ? 'Territory' : 'Area'), col('retailers', 'Retailers', 'number'), col('buying', 'Retailers who bought', 'number'), col('invoices', 'Invoices', 'number'), col('revenue', 'Net sales', 'money'), col('margin', 'Gross margin', 'money'), col('margin_pct', 'Margin %', 'percent'), col('target', 'Target', 'money'), col('achievement', 'Achievement %', 'percent')], rows: data, totals: { name: 'Total', invoices: sum(data, 'invoices'), revenue: sum(data, 'revenue'), margin: sum(data, 'margin') } };
    }
  },
  beat_performance: {
    group: 'Sales team', label: 'Beat performance', description: 'For each beat: the retailers on it, visits made, how many visits ended in an order or a collection, and the order value and cash they brought.', period: true,
    run: async (ctx) => {
      const rows = await run(ctx,
        `SELECT b.name AS beat, sp.name AS salesperson, (SELECT COUNT(*) FROM dist_beat_customers bc WHERE bc.beat_id = b.beat_id) AS retailers,
                COUNT(v.visit_id) AS visits, COUNT(v.visit_id) FILTER (WHERE v.outcome IN ('ORDER','COLLECTION')) AS productive,
                COALESCE(SUM((SELECT SUM(o.total_paise) FROM wholesale_sales_orders o WHERE o.visit_id = v.visit_id AND o.status NOT IN ('CANCELLED','REJECTED','DRAFT'))), 0) AS orders,
                COALESCE(SUM((SELECT SUM(rc.amount_paise) FROM wholesale_receipts rc WHERE rc.visit_id = v.visit_id AND rc.status = 'POSTED' AND rc.kind = 'RECEIPT')), 0) AS collected
         FROM dist_beats b LEFT JOIN wholesale_salespeople sp ON sp.salesperson_id = b.salesperson_id
         LEFT JOIN dist_visits v ON v.beat_id = b.beat_id AND v.visit_date >= $3::date AND v.visit_date <= $4::date
         WHERE b.business_id = $1 AND b.status = 'ACTIVE' AND ($2::int[] IS NOT NULL) GROUP BY b.beat_id, b.name, sp.name ORDER BY b.name`);
      const data = rows.map((x) => ({ beat: x.beat, salesperson: x.salesperson, retailers: n(x.retailers), visits: n(x.visits), productive: n(x.productive), strike_rate: n(x.visits) ? pct(x.productive, x.visits) : null, order_value: r(x.orders), collected: r(x.collected) }));
      return { columns: [col('beat', 'Beat'), col('salesperson', 'Salesperson'), col('retailers', 'Retailers', 'number'), col('visits', 'Visits', 'number'), col('productive', 'Productive visits', 'number'), col('strike_rate', 'Strike rate %', 'percent'), col('order_value', 'Orders taken', 'money'), col('collected', 'Collected', 'money')],
        rows: data, totals: { beat: 'Total', retailers: sum(data, 'retailers'), visits: sum(data, 'visits'), productive: sum(data, 'productive'), order_value: sum(data, 'order_value'), collected: sum(data, 'collected') } };
    }
  },
  commission: {
    group: 'Sales team', label: 'Commission', description: 'Commission earned by each salesperson in the period under the commission rules, line by line.', period: true,
    run: async (ctx) => {
      const out = await computeCommission(ctx.db, { businessId: ctx.businessId, from: ctx.from, to: ctx.to });
      const data = [];
      for (const rep of out) {
        if (!rep.lines.length) data.push({ salesperson: rep.name, rule: '—', base: null, amount: 0, sales: r(rep.sales) });
        for (const l of rep.lines) data.push({ salesperson: rep.name, rule: l.rule, base: l.basis === 'QTY' ? l.base : r(l.base), amount: r(l.amount), sales: r(rep.sales) });
      }
      return { columns: [col('salesperson', 'Salesperson'), col('sales', 'Net sales', 'money'), col('rule', 'Rule'), col('base', 'Paid on', 'number'), col('amount', 'Commission', 'money')], rows: data, totals: { salesperson: 'Total', amount: sum(data, 'amount') } };
    }
  },

  /* ── collections ───────────────────────────────────────────────────────── */
  salesperson_collection: {
    group: 'Collections', label: 'Collection by salesperson', description: 'Cash received from retailers, by the person who collected it, split by payment method.', period: true,
    run: async (ctx) => {
      const rows = await run(ctx,
        `SELECT COALESCE(s.name, cs.name, 'Office') AS name, rc.method, SUM(rc.amount_paise) AS amount, COUNT(*) AS n
         FROM wholesale_receipts rc LEFT JOIN wholesale_salespeople s ON s.user_id = rc.created_by AND s.business_id = rc.business_id
         LEFT JOIN wholesale_customer_profiles w ON w.customer_id = rc.customer_id LEFT JOIN wholesale_salespeople cs ON cs.salesperson_id = w.salesperson_id
         WHERE rc.business_id = $1 AND rc.branch_id = ANY($2::int[]) AND rc.kind = 'RECEIPT' AND rc.status = 'POSTED' AND rc.receipt_date >= $3::date AND rc.receipt_date <= $4::date GROUP BY 1, rc.method ORDER BY 1, rc.method`);
      const by = new Map();
      for (const x of rows) { const e = by.get(x.name) || { name: x.name, receipts: 0, total: 0 }; e.receipts += n(x.n); e.total += n(x.amount); e[x.method.toLowerCase()] = r(x.amount); by.set(x.name, e); }
      const data = [...by.values()].map((e) => ({ ...e, total: r(e.total) })).sort((a, b) => b.total - a.total);
      const cols = ['cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other'];
      return { columns: [col('name', 'Collected by'), col('receipts', 'Receipts', 'number'), ...cols.map((c) => col(c, c.replace('_', ' ').replace(/^./, (m) => m.toUpperCase()), 'money')), col('total', 'Total', 'money')], rows: data, totals: { name: 'Total', receipts: sum(data, 'receipts'), ...Object.fromEntries(cols.map((c) => [c, sum(data, c)])), total: sum(data, 'total') } };
    }
  },
  territory_collection: {
    group: 'Collections', label: 'Collection by territory', description: 'Cash received, by the territory the paying retailer belongs to, against what they still owe.', period: true,
    run: async (ctx) => {
      const rows = await run(ctx,
        `SELECT ${PATH} AS name, COALESCE(SUM(rc.amount_paise), 0) AS amount, COUNT(*) AS n, COUNT(DISTINCT rc.customer_id) AS payers
         FROM wholesale_receipts rc LEFT JOIN wholesale_customer_profiles w ON w.customer_id = rc.customer_id ${TERRITORY_PATH_JOINS('w.territory_id')}
         WHERE rc.business_id = $1 AND rc.branch_id = ANY($2::int[]) AND rc.kind = 'RECEIPT' AND rc.status = 'POSTED' AND rc.receipt_date >= $3::date AND rc.receipt_date <= $4::date GROUP BY 1 ORDER BY 2 DESC`);
      const data = rows.map((x) => ({ territory: x.name, receipts: n(x.n), payers: n(x.payers), amount: r(x.amount) }));
      return { columns: [col('territory', 'Territory'), col('receipts', 'Receipts', 'number'), col('payers', 'Retailers who paid', 'number'), col('amount', 'Collected', 'money')], rows: data, totals: { territory: 'Total', receipts: sum(data, 'receipts'), amount: sum(data, 'amount') } };
    }
  },

  /* ── principals ────────────────────────────────────────────────────────── */
  principal_purchases: {
    group: 'Principals', label: 'Principal purchases', description: 'What was bought from each principal in the period: goods received, returned, and paid.', period: true,
    run: async (ctx) => {
      const rows = await run(ctx,
        `SELECT pr.principal_id, pr.name,
                COALESCE((SELECT SUM(g.total_cost_paise) FROM wholesale_grns g WHERE g.supplier_id = pr.supplier_id AND g.status <> 'CANCELLED' AND g.grn_date >= $3::date AND g.grn_date <= $4::date), 0) AS purchased,
                COALESCE((SELECT SUM(d.total_paise) FROM debit_notes d WHERE d.supplier_id = pr.supplier_id AND d.dn_date >= $3::date AND d.dn_date <= $4::date), 0) AS returned,
                COALESCE((SELECT SUM(p.amount_paise) FROM payments p JOIN purchase_orders o ON o.po_id = p.po_id WHERE o.supplier_id = pr.supplier_id AND p.payment_date >= $3::date AND p.payment_date <= $4::date), 0) AS paid
         FROM dist_principals pr WHERE pr.business_id = $1 AND ($2::int[] IS NOT NULL) ORDER BY lower(pr.name)`);
      const data = rows.map((x) => ({ principal: x.name, purchased: r(x.purchased), returned: r(x.returned), net: r(n(x.purchased) - n(x.returned)), paid: r(x.paid) }));
      return { columns: [col('principal', 'Principal'), col('purchased', 'Goods received', 'money'), col('returned', 'Returned', 'money'), col('net', 'Net purchases', 'money'), col('paid', 'Paid', 'money')], rows: data, totals: { principal: 'Total', purchased: sum(data, 'purchased'), returned: sum(data, 'returned'), net: sum(data, 'net'), paid: sum(data, 'paid') } };
    }
  },
  principal_sales: {
    group: 'Principals', label: 'Principal sales and margin', description: 'What was sold to retailers from each principal’s products, the margin made, and the margin the agreement promises.', period: true,
    run: async (ctx) => {
      const sales = await bySales(ctx, { name: `COALESCE(pr.name, 'No principal')`, joins: `LEFT JOIN dist_principals pr ON pr.principal_id = f.principal_id`, group: '1' });
      const agreed = new Map((await ctx.db.query(`SELECT name, margin_pct FROM dist_principals WHERE business_id = $1`, [ctx.businessId])).rows.map((x) => [x.name, Number(x.margin_pct)]));
      const data = sales.map((x) => ({ principal: x.name, units: x.paid_units, free_units: x.free_units, revenue: x.revenue, margin: x.margin, margin_pct: x.margin_pct, agreed_margin: agreed.get(x.name) ?? null }));
      return { columns: [col('principal', 'Principal'), col('units', 'Units sold', 'number'), col('free_units', 'Free units', 'number'), col('revenue', 'Net sales', 'money'), col('margin', 'Gross margin', 'money'), col('margin_pct', 'Margin %', 'percent'), col('agreed_margin', 'Agreed margin %', 'percent')], rows: data, totals: { principal: 'Total', units: sum(data, 'units'), free_units: sum(data, 'free_units'), revenue: sum(data, 'revenue'), margin: sum(data, 'margin') } };
    }
  },
  brand_performance: {
    group: 'Principals', label: 'Brand performance', description: 'Net sales, margin and units for each brand, with the principal it belongs to.', period: true,
    run: async (ctx) => {
      const sales = await bySales(ctx, { name: `COALESCE(br.name, 'No brand')`, joins: `LEFT JOIN brands br ON br.brand_id = f.brand_id`, group: '1, br.principal_id' });
      const principals = new Map((await ctx.db.query(`SELECT b.name, pr.name AS principal FROM brands b LEFT JOIN dist_principals pr ON pr.principal_id = b.principal_id WHERE b.business_id = $1`, [ctx.businessId])).rows.map((x) => [x.name, x.principal]));
      const data = sales.map((x) => ({ brand: x.name, principal: principals.get(x.name) ?? null, units: x.paid_units, revenue: x.revenue, margin: x.margin, margin_pct: x.margin_pct }));
      return { columns: [col('brand', 'Brand'), col('principal', 'Principal'), col('units', 'Units sold', 'number'), col('revenue', 'Net sales', 'money'), col('margin', 'Gross margin', 'money'), col('margin_pct', 'Margin %', 'percent')], rows: data, totals: { brand: 'Total', units: sum(data, 'units'), revenue: sum(data, 'revenue'), margin: sum(data, 'margin') } };
    }
  },
  scheme_performance: {
    group: 'Principals', label: 'Scheme performance', description: 'Each scheme’s orders, the free goods shipped and discount given, what it cost, and what can be claimed back from the principal that funds it.', period: true,
    run: async (ctx) => {
      const rows = await run(ctx,
        `SELECT s.name, s.kind, s.funded_by, pr.name AS principal,
                COUNT(DISTINCT a.order_id) AS orders, COUNT(DISTINCT o.customer_id) AS customers, COALESCE(SUM(a.discount_paise), 0) AS discount,
                COALESCE((SELECT SUM(i.shipped_base) FROM wholesale_sales_order_items i JOIN wholesale_sales_orders o2 ON o2.order_id = i.order_id WHERE i.scheme_id = s.scheme_id AND i.is_free AND o2.order_date >= $3::date AND o2.order_date <= $4::date), 0) AS free_shipped,
                COALESCE((SELECT SUM(i.shipped_base * p.purchase_price_paise) FROM wholesale_sales_order_items i JOIN wholesale_sales_orders o2 ON o2.order_id = i.order_id JOIN products p ON p.product_id = i.product_id WHERE i.scheme_id = s.scheme_id AND i.is_free AND o2.order_date >= $3::date AND o2.order_date <= $4::date), 0) AS free_cost
         FROM dist_schemes s LEFT JOIN dist_principals pr ON pr.principal_id = s.principal_id
         LEFT JOIN dist_scheme_applications a ON a.scheme_id = s.scheme_id AND EXISTS (SELECT 1 FROM wholesale_sales_orders o3 WHERE o3.order_id = a.order_id AND o3.order_date >= $3::date AND o3.order_date <= $4::date AND o3.status NOT IN ('DRAFT','CANCELLED','REJECTED'))
         LEFT JOIN wholesale_sales_orders o ON o.order_id = a.order_id
         WHERE s.business_id = $1 AND ($2::int[] IS NOT NULL) GROUP BY s.scheme_id, s.name, s.kind, s.funded_by, pr.name ORDER BY s.name`);
      const data = rows.map((x) => ({ scheme: x.name, kind: x.kind.replace(/_/g, ' ').toLowerCase(), funded_by: x.funded_by.toLowerCase(), principal: x.principal, orders: n(x.orders), customers: n(x.customers), free_units: n(x.free_shipped), discount: r(x.discount), cost: r(n(x.free_cost) + n(x.discount)), claimable: x.funded_by === 'PRINCIPAL' ? r(n(x.free_cost) + n(x.discount)) : 0 }));
      return { columns: [col('scheme', 'Scheme'), col('kind', 'Type'), col('funded_by', 'Funded by'), col('principal', 'Principal'), col('orders', 'Orders', 'number'), col('customers', 'Retailers', 'number'), col('free_units', 'Free units shipped', 'number'), col('discount', 'Discount given', 'money'), col('cost', 'Total cost', 'money'), col('claimable', 'Claim from principal', 'money')], rows: data, totals: { scheme: 'Total', orders: sum(data, 'orders'), free_units: sum(data, 'free_units'), discount: sum(data, 'discount'), cost: sum(data, 'cost'), claimable: sum(data, 'claimable') } };
    }
  },
  principal_settlement: {
    group: 'Principals', label: 'Principal settlement', description: 'The account with each principal: goods received, returns, scheme claims you can make, payments, and what is owed — the supplier ledger plus the scheme claims.', period: true,
    run: async (ctx) => {
      const principals = (await ctx.db.query(`SELECT principal_id, name, supplier_id FROM dist_principals WHERE business_id = $1 ORDER BY lower(name)`, [ctx.businessId])).rows;
      const balances = await supplierBalances(ctx.db, { businessId: ctx.businessId, supplierIds: principals.map((p) => p.supplier_id).filter(Boolean) });
      const data = [];
      for (const p of principals) {
        const x = (await ctx.db.query(
          `SELECT COALESCE((SELECT SUM(g.total_cost_paise) FROM wholesale_grns g WHERE g.supplier_id = $2 AND g.status <> 'CANCELLED' AND g.grn_date >= $3::date AND g.grn_date <= $4::date), 0) AS purchased,
                  COALESCE((SELECT SUM(d.total_paise) FROM debit_notes d WHERE d.supplier_id = $2 AND d.dn_date >= $3::date AND d.dn_date <= $4::date), 0) AS returned,
                  COALESCE((SELECT SUM(pay.amount_paise) FROM payments pay JOIN purchase_orders o ON o.po_id = pay.po_id WHERE o.supplier_id = $2 AND pay.payment_date >= $3::date AND pay.payment_date <= $4::date), 0) AS paid,
                  COALESCE((SELECT SUM(i.shipped_base * pp.purchase_price_paise) FROM wholesale_sales_order_items i JOIN wholesale_sales_orders o ON o.order_id = i.order_id JOIN dist_schemes s ON s.scheme_id = i.scheme_id JOIN products pp ON pp.product_id = i.product_id
                            WHERE o.business_id = $1 AND i.is_free AND s.funded_by = 'PRINCIPAL' AND s.principal_id = $5 AND o.order_date >= $3::date AND o.order_date <= $4::date), 0) AS claim_free,
                  COALESCE((SELECT SUM(a.discount_paise) FROM dist_scheme_applications a JOIN dist_schemes s ON s.scheme_id = a.scheme_id JOIN wholesale_sales_orders o ON o.order_id = a.order_id
                            WHERE o.business_id = $1 AND s.funded_by = 'PRINCIPAL' AND s.principal_id = $5 AND o.order_date >= $3::date AND o.order_date <= $4::date AND o.status NOT IN ('DRAFT','CANCELLED','REJECTED')), 0) AS claim_discount`,
          [ctx.businessId, p.supplier_id, ctx.from, ctx.to, p.principal_id])).rows[0];
        const owed = balances.get(p.supplier_id)?.outstanding ?? 0;
        const claim = n(x.claim_free) + n(x.claim_discount);
        data.push({ principal: p.name, purchased: r(x.purchased), returned: r(x.returned), claims: r(claim), paid: r(x.paid), outstanding: r(owed), net_payable: r(owed - claim) });
      }
      return { columns: [col('principal', 'Principal'), col('purchased', 'Goods received', 'money'), col('returned', 'Returns (debit notes)', 'money'), col('claims', 'Scheme claims due to us', 'money'), col('paid', 'Paid', 'money'), col('outstanding', 'Owed to principal (ledger)', 'money'), col('net_payable', 'Net payable after claims', 'money')],
        rows: data, totals: { principal: 'Total', purchased: sum(data, 'purchased'), returned: sum(data, 'returned'), claims: sum(data, 'claims'), paid: sum(data, 'paid'), outstanding: sum(data, 'outstanding'), net_payable: sum(data, 'net_payable') } };
    }
  }
});
