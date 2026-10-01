/*
 * The wholesale dashboard: KPIs, charts and alerts, every number computed from the live documents (invoices, orders,
 * stock, receipts, purchase orders) — nothing is stored or estimated. What a person sees follows what they may open:
 * money needs reports / payments, operations need fulfilment / inventory / purchases, and a sales executive sees only
 * their own customers' sales. A pinned (single-warehouse) user sees only that warehouse.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { hasPermission } from '../middleware/auth.js';
import { stockAlertCounts } from '../modules/wholesale/alerts.js';
import { BUCKETS, customerBalances, receivableAgeing, payableAgeing } from '../modules/wholesale/ledger.js';
import { addDays, getSettings, ok, today, wrapAll } from '../modules/wholesale/common.js';
import { mySalesperson } from './wholesaleParties.controller.js';
import { scopeBranches } from './wholesaleInventory.controller.js';

const rupees = (v) => toRupees(Number(v || 0));
const n = (v) => Number(v || 0);

const dashboard = async (req, res) => {
  const businessId = req.tenant.businessId;
  const date = await today(pool, businessId);
  const monthStart = `${date.slice(0, 8)}01`;
  const prevMonthEnd = addDays(monthStart, -1);
  const prevMonthStart = `${prevMonthEnd.slice(0, 8)}01`;
  const trendFrom = addDays(date, -29);
  const branches = await scopeBranches(req);
  const mine = await mySalesperson(req);
  const can = (...p) => p.some((x) => hasPermission(req.tenant, x));
  const canMoney = can('reports', 'payments');
  const canSales = canMoney || can('sales_orders');
  const canOps = can('fulfilment', 'inventory', 'purchases');
  const settings = await getSettings(pool, businessId);

  /* invoices of this person's scope: issued, in these warehouses, and (for an executive) their own customers */
  const invJoin = mine == null ? 'LEFT JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id' : 'JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id AND m.salesperson_id = ' + Number(mine);
  const invBase = `FROM invoices i ${invJoin} WHERE i.business_id = $1 AND i.branch_id = ANY($2::int[]) AND i.status = 'ISSUED'`;
  const q = async (sql, extra = []) => (await pool.query(sql, [businessId, branches, ...extra])).rows;
  const out = { as_of: date, scope: { salesperson: mine != null, warehouses: branches.length }, sections: { sales: canSales, money: canMoney, operations: canOps } };

  if (canSales) {
    const [t] = await q(`SELECT COUNT(*) AS c, COALESCE(SUM(i.total_paise - i.credited_paise), 0) AS total ${invBase} AND i.invoice_date = $3::date`, [date]);
    const [mo] = await q(`SELECT COUNT(*) AS c, COALESCE(SUM(i.total_paise - i.credited_paise), 0) AS total, COALESCE(SUM(i.tax_paise), 0) AS tax ${invBase} AND i.invoice_date >= $3::date AND i.invoice_date <= $4::date`, [monthStart, date]);
    const [pm] = await q(`SELECT COALESCE(SUM(i.total_paise - i.credited_paise), 0) AS total ${invBase} AND i.invoice_date >= $3::date AND i.invoice_date <= $4::date`, [prevMonthStart, prevMonthEnd]);
    const trend = await q(`SELECT i.invoice_date::text AS date, COALESCE(SUM(i.total_paise - i.credited_paise), 0) AS total, COUNT(*) AS invoices ${invBase} AND i.invoice_date >= $3::date AND i.invoice_date <= $4::date GROUP BY i.invoice_date ORDER BY i.invoice_date`, [trendFrom, date]);
    const days = []; for (let d = trendFrom; d <= date; d = addDays(d, 1)) { const r = trend.find((x) => x.date === d); days.push({ date: d, sales: rupees(r?.total), invoices: n(r?.invoices) }); }
    const customers = await q(`SELECT c.customer_id, c.name, COALESCE(SUM(i.total_paise - i.credited_paise), 0) AS total, COUNT(*) AS invoices ${invBase.replace('WHERE', 'JOIN customers c ON c.customer_id = i.customer_id WHERE')} AND i.invoice_date >= $3::date GROUP BY c.customer_id, c.name ORDER BY total DESC LIMIT 5`, [monthStart]);
    const products = await q(
      `SELECT p.product_id, p.name, COALESCE(SUM(ii.line_total_paise - ii.tax_amount_paise), 0) AS revenue, COALESCE(SUM(ii.quantity * ii.unit_factor), 0) AS units
       FROM invoice_items ii JOIN invoices i ON i.invoice_id = ii.invoice_id ${invJoin.replace('i.invoice_id', 'i.invoice_id')} JOIN products p ON p.product_id = ii.product_id
       WHERE i.business_id = $1 AND i.branch_id = ANY($2::int[]) AND i.status = 'ISSUED' AND i.invoice_date >= $3::date GROUP BY p.product_id, p.name ORDER BY revenue DESC LIMIT 5`, [monthStart]);
    const orders = (await q(`SELECT status, COUNT(*) AS c, COALESCE(SUM(total_paise), 0) AS value FROM wholesale_sales_orders WHERE business_id = $1 AND branch_id = ANY($2::int[]) ${mine == null ? '' : `AND (salesperson_id = ${Number(mine)} OR created_by = ${Number(req.auth.userId)})`} AND order_date >= $3::date - 60 GROUP BY status`, [date]));
    out.sales = {
      today: { invoices: n(t.c), total: rupees(t.total) },
      month: { invoices: n(mo.c), total: rupees(mo.total), tax: rupees(mo.tax), previous_month_total: rupees(pm.total), change_pct: n(pm.total) > 0 ? Math.round(((n(mo.total) - n(pm.total)) / n(pm.total)) * 1000) / 10 : null },
      trend: days,
      top_customers: customers.map((r) => ({ customer_id: r.customer_id, name: r.name, total: rupees(r.total), invoices: n(r.invoices) })),
      top_products: products.map((r) => ({ product_id: r.product_id, name: r.name, revenue: rupees(r.revenue), units: n(r.units) })),
      orders_by_status: Object.fromEntries(orders.map((r) => [r.status, { count: n(r.c), value: rupees(r.value) }]))
    };
    if (mine == null) {
      out.sales.by_salesperson = (await q(`SELECT COALESCE(sp.name, 'Unassigned') AS name, COALESCE(SUM(i.total_paise - i.credited_paise), 0) AS total, COUNT(*) AS invoices ${invBase.replace('LEFT JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id', 'LEFT JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id LEFT JOIN wholesale_salespeople sp ON sp.salesperson_id = m.salesperson_id')} AND i.invoice_date >= $3::date GROUP BY sp.name ORDER BY total DESC LIMIT 8`, [monthStart]))
        .map((r) => ({ name: r.name, total: rupees(r.total), invoices: n(r.invoices) }));
    }
    const [pending] = await q(`SELECT COUNT(*) FILTER (WHERE status IN ('DRAFT','PENDING')) AS pending, COALESCE(SUM(total_paise) FILTER (WHERE status IN ('DRAFT','PENDING')), 0) AS pending_value,
                                      COUNT(*) FILTER (WHERE status IN ('CONFIRMED','PARTIALLY_FULFILLED','PACKED')) AS to_fulfil, COUNT(*) FILTER (WHERE approval_needed AND status IN ('DRAFT','PENDING')) AS approvals
                               FROM wholesale_sales_orders WHERE business_id = $1 AND branch_id = ANY($2::int[]) ${mine == null ? '' : `AND (salesperson_id = ${Number(mine)} OR created_by = ${Number(req.auth.userId)})`}`);
    const [back] = await q(`SELECT COUNT(*) AS lines FROM wholesale_sales_order_items i JOIN wholesale_sales_orders o ON o.order_id = i.order_id WHERE o.business_id = $1 AND o.branch_id = ANY($2::int[]) AND o.status IN ('CONFIRMED','PARTIALLY_FULFILLED','PACKED') AND i.base_qty - i.shipped_base - i.cancelled_base - i.reserved_base > 0.0005`);
    out.orders = { pending: n(pending.pending), pending_value: rupees(pending.pending_value), to_fulfil: n(pending.to_fulfil), needing_approval: n(pending.approvals), backorder_lines: n(back.lines) };
  }

  if (canMoney) {
    const ageing = await receivableAgeing(pool, { businessId, on: date, salespersonId: mine ?? null, branchId: req.tenant.pinned ? req.tenant.branchId : null });
    const buckets = Object.fromEntries(BUCKETS.map(([k]) => [k, 0]));
    for (const r of ageing) buckets[r.bucket] += n(r.balance_due_paise);
    const receivable = ageing.reduce((s, r) => s + n(r.balance_due_paise), 0);
    const overdue = ageing.filter((r) => r.days_overdue > settings.overdue_grace_days).reduce((s, r) => s + n(r.balance_due_paise), 0);
    const [coll] = await q(
      `SELECT COALESCE(SUM(a) FILTER (WHERE d = $3::date), 0) AS today, COALESCE(SUM(a) FILTER (WHERE d >= $4::date), 0) AS month FROM (
         SELECT receipt_date AS d, amount_paise AS a FROM wholesale_receipts WHERE business_id = $1 AND kind = 'RECEIPT' AND status = 'POSTED'
         UNION ALL SELECT p.payment_date, p.amount_paise FROM payments p WHERE p.business_id = $1 AND p.invoice_id IS NOT NULL AND p.receipt_id IS NULL AND p.branch_id = ANY($2::int[])
       ) x WHERE d <= $3::date`, [date, monthStart]);
    // credit exceeded: customers (with a limit) who owe more than it
    const limited = (await pool.query(`SELECT customer_id, credit_limit_paise FROM customers WHERE business_id = $1 AND status = 'ACTIVE' AND credit_limit_paise > 0 ${mine == null ? '' : `AND customer_id IN (SELECT customer_id FROM wholesale_customer_profiles WHERE salesperson_id = ${Number(mine)})`} LIMIT 3000`, [businessId])).rows;
    const bal = limited.length ? await customerBalances(pool, { businessId, customerIds: limited.map((r) => r.customer_id), graceDays: settings.overdue_grace_days }) : new Map();
    const over = limited.filter((r) => bal.get(r.customer_id)?.outstanding > n(r.credit_limit_paise));
    const topDebtors = (await q(`SELECT c.customer_id, c.name, SUM(i.balance_due_paise) AS owed, MIN(COALESCE(m.due_date, i.invoice_date)) AS oldest FROM invoices i JOIN customers c ON c.customer_id = i.customer_id ${mine == null ? 'LEFT JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id' : `JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id AND m.salesperson_id = ${Number(mine)}`}
      WHERE i.business_id = $1 AND i.branch_id = ANY($2::int[]) AND i.status = 'ISSUED' AND i.balance_due_paise > 0 GROUP BY c.customer_id, c.name ORDER BY owed DESC LIMIT 5`));
    const [prof] = await q(
      `SELECT COALESCE(SUM(ii.line_total_paise - ii.tax_amount_paise), 0) AS revenue, COALESCE(SUM(ii.quantity * ii.unit_cost_paise), 0) AS cost
       FROM invoice_items ii JOIN invoices i ON i.invoice_id = ii.invoice_id ${invJoin} WHERE i.business_id = $1 AND i.branch_id = ANY($2::int[]) AND i.status = 'ISSUED' AND i.invoice_date >= $3::date AND i.invoice_date <= $4::date`, [monthStart, date]);
    const [ret] = await q(
      `SELECT COALESCE(SUM(ci.line_total_paise - ci.tax_amount_paise), 0) AS revenue, COALESCE(SUM(ci.quantity * ii.unit_cost_paise), 0) AS cost
       FROM credit_note_items ci JOIN credit_notes cn ON cn.cn_id = ci.cn_id JOIN invoice_items ii ON ii.item_id = ci.invoice_item_id JOIN invoices i ON i.invoice_id = cn.invoice_id ${invJoin}
       WHERE cn.business_id = $1 AND cn.branch_id = ANY($2::int[]) AND cn.cn_date >= $3::date AND cn.cn_date <= $4::date`, [monthStart, date]);
    const revenue = n(prof.revenue) - n(ret.revenue); const cost = n(prof.cost) - n(ret.cost);
    out.money = {
      receivable: rupees(receivable), overdue: rupees(overdue), ageing: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, rupees(v)])),
      collected_today: rupees(coll.today), collected_month: rupees(coll.month),
      credit_exceeded: over.length, top_debtors: topDebtors.map((r) => ({ customer_id: r.customer_id, name: r.name, owed: rupees(r.owed), oldest_due: r.oldest })),
      gross_profit_month: rupees(revenue - cost), margin_pct: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : null
    };
    if (mine == null) {
      const pay = await payableAgeing(pool, { businessId, on: date });
      const payBuckets = Object.fromEntries(BUCKETS.map(([k]) => [k, 0]));
      for (const r of pay) payBuckets[r.bucket] += n(r.balance_due_paise);
      out.money.payable = rupees(pay.reduce((s, r) => s + n(r.balance_due_paise), 0));
      out.money.payable_due_soon = rupees(pay.filter((r) => r.days_overdue >= -7).reduce((s, r) => s + n(r.balance_due_paise), 0));
      out.money.payable_ageing = Object.fromEntries(Object.entries(payBuckets).map(([k, v]) => [k, rupees(v)]));
    }
  }

  if (canOps || canSales) {
    const alerts = await stockAlertCounts(pool, { businessId, branchIds: branches, settings });
    const [val] = await q(`SELECT COALESCE(SUM(bs.quantity * p.purchase_price_paise), 0) AS value, COALESCE(SUM(bs.reserved_qty * p.purchase_price_paise), 0) AS reserved FROM branch_stock bs JOIN products p ON p.product_id = bs.product_id WHERE p.business_id = $1 AND bs.branch_id = ANY($2::int[]) AND bs.quantity > 0`);
    const byWarehouse = await q(`SELECT b.branch_id, b.name, COALESCE(SUM(bs.quantity * p.purchase_price_paise), 0) AS value FROM branches b LEFT JOIN branch_stock bs ON bs.branch_id = b.branch_id AND bs.quantity > 0 LEFT JOIN products p ON p.product_id = bs.product_id WHERE b.business_id = $1 AND b.branch_id = ANY($2::int[]) GROUP BY b.branch_id, b.name ORDER BY b.name`);
    const lowList = await q(
      `SELECT p.product_id, p.name, p.unit, p.min_stock, COALESCE(SUM(bs.quantity - bs.reserved_qty), 0) AS available FROM products p LEFT JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = ANY($2::int[])
       WHERE p.business_id = $1 AND p.status = 'ACTIVE' AND p.track_inventory AND p.min_stock > 0 GROUP BY p.product_id HAVING COALESCE(SUM(bs.quantity - bs.reserved_qty), 0) <= p.min_stock ORDER BY COALESCE(SUM(bs.quantity - bs.reserved_qty), 0) / p.min_stock LIMIT 6`);
    const expiringList = await q(
      `SELECT p.name, b.batch_no, b.expiry_date, b.qty_on_hand, (b.expiry_date - CURRENT_DATE) AS days_left FROM wholesale_batches b JOIN products p ON p.product_id = b.product_id
       WHERE b.business_id = $1 AND b.branch_id = ANY($2::int[]) AND b.qty_on_hand > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= CURRENT_DATE + $3::int ORDER BY b.expiry_date LIMIT 6`, [settings.expiry_alert_days.at(-1) ?? 90]);
    out.inventory = {
      stock_value: rupees(val.value), reserved_value: rupees(val.reserved), alerts,
      by_warehouse: byWarehouse.map((r) => ({ branch_id: r.branch_id, name: r.name, value: rupees(r.value) })),
      low_stock: lowList.map((r) => ({ product_id: r.product_id, name: r.name, unit: r.unit, available: n(r.available), reorder_level: n(r.min_stock) })),
      expiring: expiringList.map((r) => ({ name: r.name, batch_no: r.batch_no, expiry_date: r.expiry_date, qty: n(r.qty_on_hand), days_left: n(r.days_left) }))
    };
  }

  if (canOps) {
    const [f] = await q(
      `SELECT (SELECT COUNT(*) FROM wholesale_pick_lists WHERE business_id = $1 AND branch_id = ANY($2::int[]) AND status IN ('PENDING','PICKING')) AS to_pick,
              (SELECT COUNT(*) FROM wholesale_pick_lists WHERE business_id = $1 AND branch_id = ANY($2::int[]) AND status IN ('PICKED','PACKING','PACKED')) AS to_dispatch,
              (SELECT COUNT(*) FROM wholesale_deliveries WHERE business_id = $1 AND branch_id = ANY($2::int[]) AND status IN ('PENDING','ASSIGNED')) AS to_deliver,
              (SELECT COUNT(*) FROM wholesale_deliveries WHERE business_id = $1 AND branch_id = ANY($2::int[]) AND status = 'OUT_FOR_DELIVERY') AS out_now,
              (SELECT COUNT(*) FROM wholesale_deliveries WHERE business_id = $1 AND branch_id = ANY($2::int[]) AND status = 'FAILED') AS failed,
              (SELECT COUNT(*) FROM wholesale_deliveries WHERE business_id = $1 AND branch_id = ANY($2::int[]) AND status = 'DELIVERED' AND delivered_at::date = $3::date) AS delivered_today`, [date]);
    const [po] = await q(
      `SELECT COUNT(*) FILTER (WHERE status = 'DRAFT') AS drafts, COUNT(*) FILTER (WHERE status IN ('ORDERED','CONFIRMED','PARTIAL')) AS open,
              COUNT(*) FILTER (WHERE status IN ('ORDERED','CONFIRMED','PARTIAL') AND expected_date < $3::date) AS late
       FROM purchase_orders WHERE business_id = $1 AND branch_id = ANY($2::int[])`, [date]);
    out.fulfilment = { to_pick: n(f.to_pick), to_dispatch: n(f.to_dispatch), to_deliver: n(f.to_deliver), out_for_delivery: n(f.out_now), failed_deliveries: n(f.failed), delivered_today: n(f.delivered_today) };
    out.purchasing = { drafts_to_approve: n(po.drafts), open_orders: n(po.open), late_orders: n(po.late) };
  }

  // the alerts a person should act on today, most urgent first
  const list = [];
  const push = (level, text, link) => list.push({ level, text, link });
  if (out.money?.overdue > 0) push('warning', `₹${out.money.overdue.toLocaleString('en-IN')} is overdue from customers`, '/app/wholesale/receivables');
  if (out.money?.credit_exceeded > 0) push('critical', `${out.money.credit_exceeded} customer${out.money.credit_exceeded === 1 ? ' is' : 's are'} over their credit limit`, '/app/wholesale/customers?credit=over');
  if (out.inventory?.alerts.out_of_stock > 0) push('critical', `${out.inventory.alerts.out_of_stock} product${out.inventory.alerts.out_of_stock === 1 ? ' is' : 's are'} out of stock`, '/app/wholesale/inventory?state=out');
  if (out.inventory?.alerts.low_stock > 0) push('warning', `${out.inventory.alerts.low_stock} product${out.inventory.alerts.low_stock === 1 ? ' is' : 's are'} running low`, '/app/wholesale/inventory?state=low');
  if (out.inventory?.alerts.expired > 0) push('critical', `${out.inventory.alerts.expired} batch${out.inventory.alerts.expired === 1 ? ' has' : 'es have'} expired`, '/app/wholesale/inventory?tab=expiry');
  if (out.inventory?.alerts.expiring > 0) push('warning', `${out.inventory.alerts.expiring} batch${out.inventory.alerts.expiring === 1 ? '' : 'es'} expiring within ${settings.expiry_alert_days.at(-1) ?? 90} days`, '/app/wholesale/inventory?tab=expiry');
  if (out.orders?.needing_approval > 0) push('warning', `${out.orders.needing_approval} order${out.orders.needing_approval === 1 ? '' : 's'} waiting for approval`, '/app/wholesale/orders?status=PENDING');
  if (out.orders?.backorder_lines > 0) push('informational', `${out.orders.backorder_lines} back-ordered line${out.orders.backorder_lines === 1 ? '' : 's'} waiting for stock`, '/app/wholesale/orders?backorders=1');
  if (out.fulfilment?.failed_deliveries > 0) push('warning', `${out.fulfilment.failed_deliveries} failed deliver${out.fulfilment.failed_deliveries === 1 ? 'y' : 'ies'} to follow up`, '/app/wholesale/deliveries?status=FAILED');
  if (out.purchasing?.drafts_to_approve > 0 && hasPermission(req.tenant, 'purchase_approve')) push('informational', `${out.purchasing.drafts_to_approve} purchase order${out.purchasing.drafts_to_approve === 1 ? '' : 's'} to approve`, '/app/wholesale/purchasing?status=DRAFT');
  if (out.purchasing?.late_orders > 0) push('warning', `${out.purchasing.late_orders} purchase order${out.purchasing.late_orders === 1 ? ' is' : 's are'} late`, '/app/wholesale/purchasing');
  if (out.money?.payable_due_soon > 0) push('informational', `₹${out.money.payable_due_soon.toLocaleString('en-IN')} due to suppliers within a week`, '/app/wholesale/payables');
  out.alerts = list;

  ok(res, out);
};

export default wrapAll({ dashboard });
