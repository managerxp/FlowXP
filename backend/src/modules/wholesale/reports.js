/*
 * Wholesale reports. Each report is a function of (db, ctx) → { columns, rows, totals? }, computed from the live
 * documents — nothing is stored — so a report can never disagree with the screens. Money is in rupees. Reports that
 * cover a period take ctx.from / ctx.to (business-local dates); stock reports are "as of now".
 *
 * Columns carry a type (text | money | number | date | percent) so the screen and the CSV export format them alike.
 */
import { toRupees } from '../../utils/money.js';
import { BUCKETS, customerBalances, payableAgeing, receivableAgeing, supplierBalances } from './ledger.js';
import { WholesaleError } from './common.js';

const r = (v) => toRupees(Number(v || 0));
const n = (v) => Number(v || 0);
const pct = (a, b) => (n(b) > 0 ? Math.round((n(a) / n(b)) * 1000) / 10 : null);
const col = (key, label, type = 'text') => ({ key, label, type });
const sum = (rows, key) => rows.reduce((s, x) => s + n(x[key]), 0);

/** The invoice set of a report: issued, in these warehouses, in the period. */
const INV = `FROM invoices i WHERE i.business_id = $1 AND i.branch_id = ANY($2::int[]) AND i.status = 'ISSUED' AND i.invoice_date >= $3::date AND i.invoice_date <= $4::date`;
const run = async (ctx, sql, extra = []) => (await ctx.db.query(sql, [ctx.businessId, ctx.branchIds, ctx.from, ctx.to, ...extra])).rows;
const runNow = async (ctx, sql, extra = []) => (await ctx.db.query(sql, [ctx.businessId, ctx.branchIds, ...extra])).rows;

export const REPORTS = {
  /* ── sales ─────────────────────────────────────────────────────────────── */
  sales_summary: {
    group: 'Sales', label: 'Sales summary', description: 'Invoiced sales by day, week or month, with tax, returns and what is still unpaid.', period: true, filters: ['group'],
    run: async (ctx) => {
      const unit = { day: 'day', week: 'week', month: 'month' }[ctx.query.group] || 'day';
      const rows = await run(ctx, `SELECT date_trunc('${unit}', i.invoice_date)::date::text AS period, COUNT(*) AS invoices, SUM(i.subtotal_paise) AS taxable, SUM(i.tax_paise) AS tax, SUM(i.discount_paise) AS discount,
                                          SUM(i.total_paise) AS total, SUM(i.credited_paise) AS credited, SUM(i.amount_paid_paise) AS paid, SUM(i.balance_due_paise) AS due ${INV} GROUP BY 1 ORDER BY 1`);
      const data = rows.map((x) => ({ period: x.period, invoices: n(x.invoices), taxable: r(x.taxable), tax: r(x.tax), discount: r(x.discount), total: r(x.total), credited: r(x.credited), net: r(n(x.total) - n(x.credited)), paid: r(x.paid), due: r(x.due) }));
      return { columns: [col('period', unit === 'day' ? 'Date' : unit === 'week' ? 'Week of' : 'Month of', 'date'), col('invoices', 'Invoices', 'number'), col('taxable', 'Taxable value', 'money'), col('tax', 'GST', 'money'), col('discount', 'Discount', 'money'), col('total', 'Invoiced', 'money'), col('credited', 'Returns', 'money'), col('net', 'Net sales', 'money'), col('paid', 'Paid', 'money'), col('due', 'Due', 'money')], rows: data, totals: { period: 'Total', invoices: sum(data, 'invoices'), taxable: sum(data, 'taxable'), tax: sum(data, 'tax'), discount: sum(data, 'discount'), total: sum(data, 'total'), credited: sum(data, 'credited'), net: sum(data, 'net'), paid: sum(data, 'paid'), due: sum(data, 'due') } };
    }
  },
  sales_by_customer: {
    group: 'Sales', label: 'Sales by customer', description: 'Who buys the most, and what each customer still owes.', period: true,
    run: async (ctx) => {
      const rows = await run(ctx, `SELECT c.customer_id, c.name, COALESCE(w.customer_type, 'RETAILER') AS type, COUNT(*) AS invoices, SUM(i.total_paise) AS total, SUM(i.credited_paise) AS credited, SUM(i.balance_due_paise) AS due, MAX(i.invoice_date)::text AS last_invoice
        FROM invoices i JOIN customers c ON c.customer_id = i.customer_id LEFT JOIN wholesale_customer_profiles w ON w.customer_id = c.customer_id
        WHERE i.business_id = $1 AND i.branch_id = ANY($2::int[]) AND i.status = 'ISSUED' AND i.invoice_date >= $3::date AND i.invoice_date <= $4::date GROUP BY c.customer_id, c.name, w.customer_type ORDER BY SUM(i.total_paise - i.credited_paise) DESC`);
      const data = rows.map((x) => ({ customer: x.name, type: x.type, invoices: n(x.invoices), total: r(x.total), credited: r(x.credited), net: r(n(x.total) - n(x.credited)), due: r(x.due), last_invoice: x.last_invoice }));
      return { columns: [col('customer', 'Customer'), col('type', 'Type'), col('invoices', 'Invoices', 'number'), col('total', 'Invoiced', 'money'), col('credited', 'Returns', 'money'), col('net', 'Net sales', 'money'), col('due', 'Due', 'money'), col('last_invoice', 'Last invoice', 'date')], rows: data, totals: { customer: 'Total', invoices: sum(data, 'invoices'), total: sum(data, 'total'), credited: sum(data, 'credited'), net: sum(data, 'net'), due: sum(data, 'due') } };
    }
  },
  sales_by_product: {
    group: 'Sales', label: 'Sales and margin by product', description: 'Units sold, revenue (before GST), cost and gross margin for each product.', period: true, filters: ['category_id'],
    run: async (ctx) => {
      const extra = []; let cat = '';
      if (ctx.query.category_id) { extra.push(Number(ctx.query.category_id) || 0); cat = ` AND p.category_id = $5`; }
      const rows = await run(ctx, `SELECT p.product_id, p.name, p.sku, p.unit, c.name AS category, SUM(ii.quantity * ii.unit_factor) AS units, SUM(ii.line_total_paise - ii.tax_amount_paise) AS revenue, SUM(ii.quantity * ii.unit_cost_paise) AS cost,
          COALESCE(SUM(cr.rev), 0) AS cn_revenue, COALESCE(SUM(cr.cost), 0) AS cn_cost, COALESCE(SUM(cr.units), 0) AS cn_units
        FROM invoice_items ii JOIN invoices i ON i.invoice_id = ii.invoice_id JOIN products p ON p.product_id = ii.product_id LEFT JOIN categories c ON c.category_id = p.category_id
        LEFT JOIN LATERAL (SELECT SUM(ci.line_total_paise - ci.tax_amount_paise) AS rev, SUM(ci.quantity * ii.unit_cost_paise) AS cost, SUM(ci.quantity * ii.unit_factor) AS units FROM credit_note_items ci WHERE ci.invoice_item_id = ii.item_id) cr ON TRUE
        WHERE i.business_id = $1 AND i.branch_id = ANY($2::int[]) AND i.status = 'ISSUED' AND i.invoice_date >= $3::date AND i.invoice_date <= $4::date${cat}
        GROUP BY p.product_id, p.name, p.sku, p.unit, c.name ORDER BY SUM(ii.line_total_paise - ii.tax_amount_paise) DESC`, extra);
      const data = rows.map((x) => {
        const revenue = n(x.revenue) - n(x.cn_revenue); const cost = n(x.cost) - n(x.cn_cost); const units = n(x.units) - n(x.cn_units);
        return { product: x.name, sku: x.sku, category: x.category, unit: x.unit, units, revenue: r(revenue), cost: r(cost), margin: r(revenue - cost), margin_pct: pct(revenue - cost, revenue) };
      });
      const rev = sum(data, 'revenue'); const mar = sum(data, 'margin');
      return { columns: [col('product', 'Product'), col('sku', 'SKU'), col('category', 'Category'), col('unit', 'Base unit'), col('units', 'Units sold', 'number'), col('revenue', 'Revenue (ex GST)', 'money'), col('cost', 'Cost', 'money'), col('margin', 'Gross margin', 'money'), col('margin_pct', 'Margin %', 'percent')], rows: data, totals: { product: 'Total', units: sum(data, 'units'), revenue: rev, cost: sum(data, 'cost'), margin: mar, margin_pct: pct(mar, rev) }, note: 'Net of credit notes issued in the period.' };
    }
  },
  sales_by_category: {
    group: 'Sales', label: 'Sales by category', description: 'Revenue and margin by product category.', period: true,
    run: async (ctx) => {
      const rows = await run(ctx, `SELECT COALESCE(c.name, 'Uncategorised') AS category, SUM(ii.quantity * ii.unit_factor) AS units, SUM(ii.line_total_paise - ii.tax_amount_paise) AS revenue, SUM(ii.quantity * ii.unit_cost_paise) AS cost
        FROM invoice_items ii JOIN invoices i ON i.invoice_id = ii.invoice_id JOIN products p ON p.product_id = ii.product_id LEFT JOIN categories c ON c.category_id = p.category_id
        WHERE i.business_id = $1 AND i.branch_id = ANY($2::int[]) AND i.status = 'ISSUED' AND i.invoice_date >= $3::date AND i.invoice_date <= $4::date GROUP BY c.name ORDER BY revenue DESC`);
      const data = rows.map((x) => ({ category: x.category, units: n(x.units), revenue: r(x.revenue), cost: r(x.cost), margin: r(n(x.revenue) - n(x.cost)), margin_pct: pct(n(x.revenue) - n(x.cost), x.revenue) }));
      return { columns: [col('category', 'Category'), col('units', 'Units sold', 'number'), col('revenue', 'Revenue (ex GST)', 'money'), col('cost', 'Cost', 'money'), col('margin', 'Gross margin', 'money'), col('margin_pct', 'Margin %', 'percent')], rows: data, totals: { category: 'Total', units: sum(data, 'units'), revenue: sum(data, 'revenue'), cost: sum(data, 'cost'), margin: sum(data, 'margin'), margin_pct: pct(sum(data, 'margin'), sum(data, 'revenue')) } };
    }
  },
  sales_by_salesperson: {
    group: 'Sales', label: 'Sales by salesperson', description: 'Sales, collections and commission for each salesperson.', period: true,
    run: async (ctx) => {
      const rows = await run(ctx, `SELECT sp.salesperson_id, COALESCE(sp.name, 'Unassigned') AS name, sp.commission_pct, sp.commission_on, COUNT(*) AS invoices, SUM(i.total_paise - i.credited_paise) AS sales, SUM(i.balance_due_paise) AS due
        FROM invoices i LEFT JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id LEFT JOIN wholesale_salespeople sp ON sp.salesperson_id = m.salesperson_id
        WHERE i.business_id = $1 AND i.branch_id = ANY($2::int[]) AND i.status = 'ISSUED' AND i.invoice_date >= $3::date AND i.invoice_date <= $4::date GROUP BY sp.salesperson_id, sp.name, sp.commission_pct, sp.commission_on ORDER BY sales DESC`);
      const coll = new Map((await run(ctx, `SELECT m.salesperson_id, SUM(p.amount_paise) AS c FROM payments p JOIN wholesale_invoice_meta m ON m.invoice_id = p.invoice_id WHERE p.business_id = $1 AND p.branch_id = ANY($2::int[]) AND p.payment_date >= $3::date AND p.payment_date <= $4::date GROUP BY m.salesperson_id`)).map((x) => [x.salesperson_id, n(x.c)]));
      const data = rows.map((x) => { const collected = coll.get(x.salesperson_id) || 0; const basis = x.commission_on === 'COLLECTIONS' ? collected : n(x.sales); return { salesperson: x.name, invoices: n(x.invoices), sales: r(x.sales), collected: r(collected), due: r(x.due), commission_pct: x.commission_pct == null ? null : n(x.commission_pct), commission: r(Math.round(basis * n(x.commission_pct) / 100)) }; });
      return { columns: [col('salesperson', 'Salesperson'), col('invoices', 'Invoices', 'number'), col('sales', 'Net sales', 'money'), col('collected', 'Collected', 'money'), col('due', 'Still due', 'money'), col('commission_pct', 'Commission %', 'percent'), col('commission', 'Commission', 'money')], rows: data, totals: { salesperson: 'Total', invoices: sum(data, 'invoices'), sales: sum(data, 'sales'), collected: sum(data, 'collected'), due: sum(data, 'due'), commission: sum(data, 'commission') } };
    }
  },
  sales_by_warehouse: {
    group: 'Sales', label: 'Sales by warehouse', description: 'Invoiced sales shipped from each warehouse.', period: true,
    run: async (ctx) => {
      const rows = await run(ctx, `SELECT b.name, COUNT(*) AS invoices, SUM(i.total_paise - i.credited_paise) AS sales FROM invoices i JOIN branches b ON b.branch_id = i.branch_id
        WHERE i.business_id = $1 AND i.branch_id = ANY($2::int[]) AND i.status = 'ISSUED' AND i.invoice_date >= $3::date AND i.invoice_date <= $4::date GROUP BY b.name ORDER BY sales DESC`);
      const data = rows.map((x) => ({ warehouse: x.name, invoices: n(x.invoices), sales: r(x.sales) }));
      return { columns: [col('warehouse', 'Warehouse'), col('invoices', 'Invoices', 'number'), col('sales', 'Net sales', 'money')], rows: data, totals: { warehouse: 'Total', invoices: sum(data, 'invoices'), sales: sum(data, 'sales') } };
    }
  },
  order_book: {
    group: 'Sales', label: 'Open orders', description: 'Every order not yet shipped in full, oldest first, with what is still to ship.', period: false,
    run: async (ctx) => {
      const rows = await runNow(ctx, `SELECT o.order_number, o.order_date::text AS order_date, c.name AS customer, o.status, o.total_paise, o.expected_delivery::text AS expected, (CURRENT_DATE - o.order_date) AS age,
          COALESCE(SUM(i.base_qty - i.shipped_base - i.cancelled_base), 0) AS open_units, COALESCE(SUM(i.base_qty - i.shipped_base - i.cancelled_base - i.reserved_base) FILTER (WHERE i.base_qty - i.shipped_base - i.cancelled_base - i.reserved_base > 0), 0) AS short
        FROM wholesale_sales_orders o JOIN customers c ON c.customer_id = o.customer_id LEFT JOIN wholesale_sales_order_items i ON i.order_id = o.order_id
        WHERE o.business_id = $1 AND o.branch_id = ANY($2::int[]) AND o.status IN ('PENDING','CONFIRMED','PARTIALLY_FULFILLED','PACKED','DISPATCHED') GROUP BY o.order_id, c.name ORDER BY o.order_date, o.order_id`);
      const data = rows.map((x) => ({ order: x.order_number, date: x.order_date, customer: x.customer, status: x.status, total: r(x.total_paise), expected: x.expected, age: n(x.age), open_units: n(x.open_units), short: n(x.short) }));
      return { columns: [col('order', 'Order'), col('date', 'Date', 'date'), col('customer', 'Customer'), col('status', 'Status'), col('total', 'Value', 'money'), col('expected', 'Expected', 'date'), col('age', 'Age (days)', 'number'), col('open_units', 'Units to ship', 'number'), col('short', 'Back-ordered units', 'number')], rows: data, totals: { order: 'Total', total: sum(data, 'total'), open_units: sum(data, 'open_units'), short: sum(data, 'short') } };
    }
  },

  /* ── purchases ─────────────────────────────────────────────────────────── */
  purchase_summary: {
    group: 'Purchases', label: 'Purchase summary', description: 'Goods received from suppliers by day or month, with GST and what is unpaid.', period: true, filters: ['group'],
    run: async (ctx) => {
      const unit = { day: 'day', week: 'week', month: 'month' }[ctx.query.group] || 'day';
      const rows = await run(ctx, `SELECT date_trunc('${unit}', po.po_date)::date::text AS period, COUNT(*) AS orders, SUM(po.subtotal_paise) AS taxable, SUM(po.tax_paise) AS tax, SUM(po.total_paise) AS total, SUM(po.debited_paise) AS returned, SUM(po.amount_paid_paise) AS paid, SUM(po.balance_due_paise) AS due
        FROM purchase_orders po WHERE po.business_id = $1 AND po.branch_id = ANY($2::int[]) AND po.status IN ('PARTIAL','RECEIVED') AND po.po_date >= $3::date AND po.po_date <= $4::date GROUP BY 1 ORDER BY 1`);
      const data = rows.map((x) => ({ period: x.period, orders: n(x.orders), taxable: r(x.taxable), tax: r(x.tax), total: r(x.total), returned: r(x.returned), paid: r(x.paid), due: r(x.due) }));
      return { columns: [col('period', 'Period', 'date'), col('orders', 'Orders', 'number'), col('taxable', 'Taxable value', 'money'), col('tax', 'GST', 'money'), col('total', 'Purchased', 'money'), col('returned', 'Returned', 'money'), col('paid', 'Paid', 'money'), col('due', 'Due', 'money')], rows: data, totals: { period: 'Total', orders: sum(data, 'orders'), taxable: sum(data, 'taxable'), tax: sum(data, 'tax'), total: sum(data, 'total'), returned: sum(data, 'returned'), paid: sum(data, 'paid'), due: sum(data, 'due') } };
    }
  },
  purchase_by_supplier: {
    group: 'Purchases', label: 'Purchases by supplier', description: 'How much was bought from each supplier and what is still owed.', period: true,
    run: async (ctx) => {
      const rows = await run(ctx, `SELECT s.name, COUNT(*) AS orders, SUM(po.total_paise) AS total, SUM(po.debited_paise) AS returned, SUM(po.amount_paid_paise) AS paid, SUM(po.balance_due_paise) AS due
        FROM purchase_orders po JOIN suppliers s ON s.supplier_id = po.supplier_id WHERE po.business_id = $1 AND po.branch_id = ANY($2::int[]) AND po.status IN ('PARTIAL','RECEIVED') AND po.po_date >= $3::date AND po.po_date <= $4::date GROUP BY s.name ORDER BY total DESC`);
      const data = rows.map((x) => ({ supplier: x.name, orders: n(x.orders), total: r(x.total), returned: r(x.returned), paid: r(x.paid), due: r(x.due) }));
      return { columns: [col('supplier', 'Supplier'), col('orders', 'Orders', 'number'), col('total', 'Purchased', 'money'), col('returned', 'Returned', 'money'), col('paid', 'Paid', 'money'), col('due', 'Due', 'money')], rows: data, totals: { supplier: 'Total', orders: sum(data, 'orders'), total: sum(data, 'total'), returned: sum(data, 'returned'), paid: sum(data, 'paid'), due: sum(data, 'due') } };
    }
  },
  purchase_by_product: {
    group: 'Purchases', label: 'Purchases by product', description: 'Units received and the average cost paid, from goods receipts.', period: true,
    run: async (ctx) => {
      const rows = await run(ctx, `SELECT p.name, p.sku, p.unit, SUM(gi.accepted_base) AS units, SUM(gi.damaged_base) AS damaged, SUM(gi.accepted_base * gi.cost_paise_per_base) AS value
        FROM wholesale_grn_items gi JOIN wholesale_grns g ON g.grn_id = gi.grn_id JOIN products p ON p.product_id = gi.product_id
        WHERE g.business_id = $1 AND g.branch_id = ANY($2::int[]) AND g.status = 'POSTED' AND g.grn_date >= $3::date AND g.grn_date <= $4::date GROUP BY p.product_id ORDER BY value DESC`);
      const data = rows.map((x) => ({ product: x.name, sku: x.sku, unit: x.unit, units: n(x.units), damaged: n(x.damaged), value: r(x.value), avg_cost: n(x.units) > 0 ? r(n(x.value) / n(x.units)) : null }));
      return { columns: [col('product', 'Product'), col('sku', 'SKU'), col('unit', 'Base unit'), col('units', 'Units received', 'number'), col('damaged', 'Damaged', 'number'), col('value', 'Cost (ex GST)', 'money'), col('avg_cost', 'Avg cost / unit', 'money')], rows: data, totals: { product: 'Total', units: sum(data, 'units'), damaged: sum(data, 'damaged'), value: sum(data, 'value') } };
    }
  },
  grn_register: {
    group: 'Purchases', label: 'Goods receipt register', description: 'Every goods receipt: supplier, invoice, damage and value.', period: true,
    run: async (ctx) => {
      const rows = await run(ctx, `SELECT g.grn_number, g.grn_date::text AS date, s.name AS supplier, po.po_number, g.supplier_invoice_no, b.name AS warehouse, g.total_cost_paise,
          (SELECT COALESCE(SUM(damaged_base), 0) FROM wholesale_grn_items gi WHERE gi.grn_id = g.grn_id) AS damaged
        FROM wholesale_grns g LEFT JOIN suppliers s ON s.supplier_id = g.supplier_id LEFT JOIN purchase_orders po ON po.po_id = g.po_id JOIN branches b ON b.branch_id = g.branch_id
        WHERE g.business_id = $1 AND g.branch_id = ANY($2::int[]) AND g.grn_date >= $3::date AND g.grn_date <= $4::date ORDER BY g.grn_date DESC, g.grn_id DESC`);
      const data = rows.map((x) => ({ grn: x.grn_number, date: x.date, supplier: x.supplier, order: x.po_number, invoice: x.supplier_invoice_no, warehouse: x.warehouse, damaged: n(x.damaged), value: r(x.total_cost_paise) }));
      return { columns: [col('grn', 'GRN'), col('date', 'Date', 'date'), col('supplier', 'Supplier'), col('order', 'Order'), col('invoice', 'Supplier invoice'), col('warehouse', 'Warehouse'), col('damaged', 'Damaged units', 'number'), col('value', 'Value', 'money')], rows: data, totals: { grn: 'Total', damaged: sum(data, 'damaged'), value: sum(data, 'value') } };
    }
  },

  /* ── inventory ─────────────────────────────────────────────────────────── */
  stock_valuation: {
    group: 'Inventory', label: 'Stock valuation', description: 'What is on the shelves now, at cost and at the wholesale price.', period: false, filters: ['category_id'],
    run: async (ctx) => {
      const extra = []; let cat = '';
      if (ctx.query.category_id) { extra.push(Number(ctx.query.category_id) || 0); cat = ' AND p.category_id = $3'; }
      const rows = await runNow(ctx, `SELECT p.name, p.sku, p.unit, c.name AS category, SUM(bs.quantity) AS on_hand, SUM(bs.reserved_qty) AS reserved, p.purchase_price_paise AS cost, COALESCE(d.wholesale_price_paise, p.selling_price_paise) AS price
        FROM branch_stock bs JOIN products p ON p.product_id = bs.product_id LEFT JOIN wholesale_item_details d ON d.product_id = p.product_id LEFT JOIN categories c ON c.category_id = p.category_id
        WHERE p.business_id = $1 AND bs.branch_id = ANY($2::int[]) AND bs.quantity > 0${cat} GROUP BY p.product_id, c.name, d.wholesale_price_paise ORDER BY SUM(bs.quantity * p.purchase_price_paise) DESC`, extra);
      const data = rows.map((x) => ({ product: x.name, sku: x.sku, category: x.category, unit: x.unit, on_hand: n(x.on_hand), reserved: n(x.reserved), cost: r(x.cost), value: r(n(x.on_hand) * n(x.cost)), price: r(x.price), sale_value: r(n(x.on_hand) * n(x.price)) }));
      return { columns: [col('product', 'Product'), col('sku', 'SKU'), col('category', 'Category'), col('unit', 'Unit'), col('on_hand', 'On hand', 'number'), col('reserved', 'Reserved', 'number'), col('cost', 'Cost / unit', 'money'), col('value', 'Stock value (cost)', 'money'), col('price', 'Price / unit', 'money'), col('sale_value', 'Stock value (price)', 'money')], rows: data, totals: { product: 'Total', on_hand: sum(data, 'on_hand'), reserved: sum(data, 'reserved'), value: sum(data, 'value'), sale_value: sum(data, 'sale_value') } };
    }
  },
  low_stock: {
    group: 'Inventory', label: 'Low stock and reorder', description: 'Products at or below their reorder level, with a suggested quantity to buy.', period: false,
    run: async (ctx) => {
      const rows = await runNow(ctx, `SELECT p.name, p.sku, p.unit, s.name AS supplier, p.min_stock, d.max_stock, COALESCE(SUM(bs.quantity), 0) AS on_hand, COALESCE(SUM(bs.reserved_qty), 0) AS reserved
        FROM products p LEFT JOIN wholesale_item_details d ON d.product_id = p.product_id LEFT JOIN suppliers s ON s.supplier_id = p.supplier_id LEFT JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = ANY($2::int[])
        WHERE p.business_id = $1 AND p.status = 'ACTIVE' AND p.track_inventory AND p.min_stock > 0 GROUP BY p.product_id, s.name, d.max_stock HAVING COALESCE(SUM(bs.quantity - bs.reserved_qty), 0) <= p.min_stock ORDER BY COALESCE(SUM(bs.quantity - bs.reserved_qty), 0) / p.min_stock`);
      const data = rows.map((x) => { const avail = n(x.on_hand) - n(x.reserved); const target = x.max_stock != null ? n(x.max_stock) : n(x.min_stock) * 2; return { product: x.name, sku: x.sku, unit: x.unit, supplier: x.supplier, on_hand: n(x.on_hand), reserved: n(x.reserved), available: avail, reorder_level: n(x.min_stock), suggested: Math.max(0, Math.ceil(target - avail)) }; });
      return { columns: [col('product', 'Product'), col('sku', 'SKU'), col('supplier', 'Usual supplier'), col('unit', 'Unit'), col('on_hand', 'On hand', 'number'), col('reserved', 'Reserved', 'number'), col('available', 'Available', 'number'), col('reorder_level', 'Reorder level', 'number'), col('suggested', 'Suggested order', 'number')], rows: data };
    }
  },
  expiry: {
    group: 'Inventory', label: 'Expiry', description: 'Expired and soon-to-expire batches with their value.', period: false,
    run: async (ctx) => {
      const days = ctx.settings.expiry_alert_days.at(-1) ?? 90;
      const rows = await runNow(ctx, `SELECT p.name, b.batch_no, br.name AS warehouse, b.expiry_date::text AS expiry, b.qty_on_hand, b.cost_paise, (b.expiry_date - CURRENT_DATE) AS days_left
        FROM wholesale_batches b JOIN products p ON p.product_id = b.product_id JOIN branches br ON br.branch_id = b.branch_id
        WHERE b.business_id = $1 AND b.branch_id = ANY($2::int[]) AND b.qty_on_hand > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= CURRENT_DATE + $3::int ORDER BY b.expiry_date`, [days]);
      const data = rows.map((x) => ({ product: x.name, batch: x.batch_no, warehouse: x.warehouse, expiry: x.expiry, days_left: n(x.days_left), status: n(x.days_left) < 0 ? 'Expired' : 'Expiring', qty: n(x.qty_on_hand), value: r(n(x.qty_on_hand) * n(x.cost_paise)) }));
      return { columns: [col('product', 'Product'), col('batch', 'Batch'), col('warehouse', 'Warehouse'), col('expiry', 'Expiry', 'date'), col('days_left', 'Days left', 'number'), col('status', 'Status'), col('qty', 'Quantity', 'number'), col('value', 'Value (cost)', 'money')], rows: data, totals: { product: 'Total', qty: sum(data, 'qty'), value: sum(data, 'value') } };
    }
  },
  slow_moving: {
    group: 'Inventory', label: 'Slow-moving and dead stock', description: 'Stock that has not sold for the number of days set in your wholesale settings.', period: false,
    run: async (ctx) => {
      const rows = await runNow(ctx, `SELECT p.name, p.sku, p.unit, SUM(bs.quantity) AS on_hand, p.purchase_price_paise AS cost,
          (SELECT MAX(t.created_at)::date::text FROM inventory_transactions t WHERE t.product_id = p.product_id AND t.transaction_type = 'SALE') AS last_sale,
          (SELECT CURRENT_DATE - MAX(t.created_at)::date FROM inventory_transactions t WHERE t.product_id = p.product_id AND t.transaction_type = 'SALE') AS days_since
        FROM products p JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = ANY($2::int[]) AND bs.quantity > 0
        WHERE p.business_id = $1 AND p.status = 'ACTIVE' AND p.track_inventory GROUP BY p.product_id
        HAVING NOT EXISTS (SELECT 1 FROM inventory_transactions t WHERE t.product_id = p.product_id AND t.transaction_type = 'SALE' AND t.created_at > CURRENT_TIMESTAMP - make_interval(days => ${Number(ctx.settings.slow_moving_days) | 0}))
        ORDER BY SUM(bs.quantity * p.purchase_price_paise) DESC`);
      const dead = Number(ctx.settings.dead_stock_days);
      const data = rows.map((x) => ({ product: x.name, sku: x.sku, unit: x.unit, on_hand: n(x.on_hand), value: r(n(x.on_hand) * n(x.cost)), last_sale: x.last_sale, days_since: x.days_since == null ? null : n(x.days_since), class: x.days_since == null || n(x.days_since) >= dead ? 'Dead' : 'Slow' }));
      return { columns: [col('product', 'Product'), col('sku', 'SKU'), col('unit', 'Unit'), col('on_hand', 'On hand', 'number'), col('value', 'Value (cost)', 'money'), col('last_sale', 'Last sold', 'date'), col('days_since', 'Days since', 'number'), col('class', 'Class')], rows: data, totals: { product: 'Total', on_hand: sum(data, 'on_hand'), value: sum(data, 'value') }, note: `Slow = no sale in ${ctx.settings.slow_moving_days} days; dead = none in ${dead} days.` };
    }
  },
  stock_movement: {
    group: 'Inventory', label: 'Stock movement', description: 'Units in and out of the warehouses by product over a period.', period: true,
    run: async (ctx) => {
      const rows = await run(ctx, `SELECT p.name, p.sku, p.unit, SUM(t.quantity) FILTER (WHERE t.quantity > 0) AS qty_in, -SUM(t.quantity) FILTER (WHERE t.quantity < 0) AS qty_out, SUM(t.quantity) AS net,
          SUM(t.quantity) FILTER (WHERE t.transaction_type = 'PURCHASE') AS bought, -SUM(t.quantity) FILTER (WHERE t.transaction_type = 'SALE') AS sold, -SUM(t.quantity) FILTER (WHERE t.transaction_type IN ('WASTAGE','ADJUSTMENT') AND t.quantity < 0) AS lost
        FROM inventory_transactions t JOIN products p ON p.product_id = t.product_id WHERE t.business_id = $1 AND t.branch_id = ANY($2::int[]) AND t.created_at >= $3::date AND t.created_at < ($4::date + 1) GROUP BY p.product_id ORDER BY p.name`);
      const data = rows.map((x) => ({ product: x.name, sku: x.sku, unit: x.unit, bought: n(x.bought), sold: n(x.sold), lost: n(x.lost), qty_in: n(x.qty_in), qty_out: n(x.qty_out), net: n(x.net) }));
      return { columns: [col('product', 'Product'), col('sku', 'SKU'), col('unit', 'Unit'), col('bought', 'Bought', 'number'), col('sold', 'Sold', 'number'), col('lost', 'Written off / damaged', 'number'), col('qty_in', 'Total in', 'number'), col('qty_out', 'Total out', 'number'), col('net', 'Net', 'number')], rows: data };
    }
  },
  damaged_stock: {
    group: 'Inventory', label: 'Damaged goods held', description: 'Damaged goods waiting for a supplier claim or a write-off.', period: false,
    run: async (ctx) => {
      const rows = await runNow(ctx, `SELECT p.name, b.name AS warehouse, SUM(l.qty) AS qty, SUM(l.qty) * p.purchase_price_paise AS value FROM wholesale_damaged_log l JOIN products p ON p.product_id = l.product_id JOIN branches b ON b.branch_id = l.branch_id
        WHERE l.business_id = $1 AND l.branch_id = ANY($2::int[]) GROUP BY p.product_id, b.name HAVING SUM(l.qty) > 0 ORDER BY value DESC`);
      const data = rows.map((x) => ({ product: x.name, warehouse: x.warehouse, qty: n(x.qty), value: r(x.value) }));
      return { columns: [col('product', 'Product'), col('warehouse', 'Warehouse'), col('qty', 'Quantity', 'number'), col('value', 'Value (cost)', 'money')], rows: data, totals: { product: 'Total', qty: sum(data, 'qty'), value: sum(data, 'value') } };
    }
  },

  /* ── financial ─────────────────────────────────────────────────────────── */
  receivables_ageing: {
    group: 'Financial', label: 'Receivables ageing', description: 'What customers owe, by how long it is overdue: current, 1–30, 31–60, 61–90 and 90+ days.', period: false, filters: ['salesperson_id'],
    run: async (ctx) => {
      const rows = await receivableAgeing(ctx.db, { businessId: ctx.businessId, salespersonId: ctx.query.salesperson_id ? Number(ctx.query.salesperson_id) : null, on: ctx.to || null, limit: 20000 });
      const byCustomer = new Map();
      for (const x of rows) {
        const row = byCustomer.get(x.customer_id) || { customer: x.customer_name, ...Object.fromEntries(BUCKETS.map(([k]) => [k, 0])), total: 0, invoices: 0, oldest: 0 };
        row[x.bucket] += n(x.balance_due_paise); row.total += n(x.balance_due_paise); row.invoices += 1; row.oldest = Math.max(row.oldest, x.days_overdue);
        byCustomer.set(x.customer_id, row);
      }
      const data = [...byCustomer.values()].sort((a, b) => b.total - a.total).map((x) => ({ ...x, ...Object.fromEntries([...BUCKETS.map(([k]) => [k, r(x[k])]), ['total', r(x.total)]]), oldest: Math.max(0, x.oldest) }));
      return { columns: [col('customer', 'Customer'), ...BUCKETS.map(([k, label]) => col(k, label, 'money')), col('total', 'Total due', 'money'), col('invoices', 'Invoices', 'number'), col('oldest', 'Oldest (days overdue)', 'number')], rows: data, totals: { customer: 'Total', ...Object.fromEntries(BUCKETS.map(([k]) => [k, sum(data, k)])), total: sum(data, 'total'), invoices: sum(data, 'invoices') } };
    }
  },
  payables_ageing: {
    group: 'Financial', label: 'Payables ageing', description: 'What is owed to suppliers, by how long it is overdue.', period: false,
    run: async (ctx) => {
      const rows = await payableAgeing(ctx.db, { businessId: ctx.businessId, on: ctx.to || null, limit: 20000 });
      const bySupplier = new Map();
      for (const x of rows) {
        const row = bySupplier.get(x.supplier_id) || { supplier: x.supplier_name, ...Object.fromEntries(BUCKETS.map(([k]) => [k, 0])), total: 0, bills: 0 };
        row[x.bucket] += n(x.balance_due_paise); row.total += n(x.balance_due_paise); row.bills += 1; bySupplier.set(x.supplier_id, row);
      }
      const data = [...bySupplier.values()].sort((a, b) => b.total - a.total).map((x) => ({ ...x, ...Object.fromEntries([...BUCKETS.map(([k]) => [k, r(x[k])]), ['total', r(x.total)]]) }));
      return { columns: [col('supplier', 'Supplier'), ...BUCKETS.map(([k, label]) => col(k, label, 'money')), col('total', 'Total due', 'money'), col('bills', 'Bills', 'number')], rows: data, totals: { supplier: 'Total', ...Object.fromEntries(BUCKETS.map(([k]) => [k, sum(data, k)])), total: sum(data, 'total'), bills: sum(data, 'bills') } };
    }
  },
  customer_outstanding: {
    group: 'Financial', label: 'Customer balances and credit', description: 'Each customer’s balance, overdue amount, credit limit and how much of it is used.', period: false,
    run: async (ctx) => {
      const customers = (await ctx.db.query(`SELECT c.customer_id, c.name, c.credit_limit_paise, COALESCE(w.customer_type, 'RETAILER') AS type, COALESCE(w.payment_terms_days, $2) AS terms, sp.name AS salesperson
        FROM customers c LEFT JOIN wholesale_customer_profiles w ON w.customer_id = c.customer_id LEFT JOIN wholesale_salespeople sp ON sp.salesperson_id = w.salesperson_id WHERE c.business_id = $1 AND c.status = 'ACTIVE' ORDER BY c.name`, [ctx.businessId, ctx.settings.default_payment_terms_days])).rows;
      const bal = await customerBalances(ctx.db, { businessId: ctx.businessId, customerIds: customers.map((c) => c.customer_id), graceDays: ctx.settings.overdue_grace_days });
      const data = customers.map((c) => { const b = bal.get(c.customer_id); const limit = n(c.credit_limit_paise); return { customer: c.name, type: c.type, salesperson: c.salesperson, terms: n(c.terms), limit: r(limit), outstanding: r(b.outstanding), overdue: r(b.overdue), available: limit > 0 ? r(limit - Math.max(0, b.outstanding)) : null, utilization: limit > 0 ? pct(Math.max(0, b.outstanding), limit) : null, over_limit: limit > 0 && b.outstanding > limit ? 'Yes' : '' }; })
        .filter((x) => x.outstanding !== 0 || x.limit > 0).sort((a, b) => b.outstanding - a.outstanding);
      return { columns: [col('customer', 'Customer'), col('type', 'Type'), col('salesperson', 'Salesperson'), col('terms', 'Terms (days)', 'number'), col('limit', 'Credit limit', 'money'), col('outstanding', 'Outstanding', 'money'), col('overdue', 'Overdue', 'money'), col('available', 'Credit available', 'money'), col('utilization', 'Used', 'percent'), col('over_limit', 'Over limit')], rows: data, totals: { customer: 'Total', outstanding: sum(data, 'outstanding'), overdue: sum(data, 'overdue') } };
    }
  },
  supplier_outstanding: {
    group: 'Financial', label: 'Supplier balances', description: 'What is owed to each supplier.', period: false,
    run: async (ctx) => {
      const suppliers = (await ctx.db.query(`SELECT supplier_id, name FROM suppliers WHERE business_id = $1 AND status = 'ACTIVE' ORDER BY name`, [ctx.businessId])).rows;
      const bal = await supplierBalances(ctx.db, { businessId: ctx.businessId, supplierIds: suppliers.map((s) => s.supplier_id) });
      const data = suppliers.map((s) => { const b = bal.get(s.supplier_id); return { supplier: s.name, opening: r(b.opening), bought: r(b.bought), paid: r(b.paid), debited: r(b.debited), outstanding: r(b.outstanding) }; }).filter((x) => x.outstanding !== 0 || x.bought > 0).sort((a, b) => b.outstanding - a.outstanding);
      return { columns: [col('supplier', 'Supplier'), col('opening', 'Opening', 'money'), col('bought', 'Purchased', 'money'), col('paid', 'Paid', 'money'), col('debited', 'Returned', 'money'), col('outstanding', 'We owe', 'money')], rows: data, totals: { supplier: 'Total', outstanding: sum(data, 'outstanding') } };
    }
  },
  collections: {
    group: 'Financial', label: 'Collections', description: 'Money received from customers by day and by payment method.', period: true,
    run: async (ctx) => {
      const rows = await run(ctx, `SELECT d::text AS day, method, SUM(a) AS amount, COUNT(*) AS n FROM (
          SELECT receipt_date AS d, method, amount_paise AS a FROM wholesale_receipts WHERE business_id = $1 AND kind = 'RECEIPT' AND status = 'POSTED' AND receipt_date >= $3::date AND receipt_date <= $4::date
          UNION ALL SELECT p.payment_date, p.payment_method, p.amount_paise FROM payments p WHERE p.business_id = $1 AND p.branch_id = ANY($2::int[]) AND p.invoice_id IS NOT NULL AND p.receipt_id IS NULL AND p.payment_date >= $3::date AND p.payment_date <= $4::date
        ) x GROUP BY d, method ORDER BY d, method`);
      const data = rows.map((x) => ({ date: x.day, method: x.method, receipts: n(x.n), amount: r(x.amount) }));
      return { columns: [col('date', 'Date', 'date'), col('method', 'Method'), col('receipts', 'Count', 'number'), col('amount', 'Amount', 'money')], rows: data, totals: { date: 'Total', receipts: sum(data, 'receipts'), amount: sum(data, 'amount') } };
    }
  },
  profit_by_customer: {
    group: 'Financial', label: 'Profit by customer', description: 'Gross margin earned from each customer.', period: true,
    run: async (ctx) => {
      const rows = await run(ctx, `SELECT c.name, SUM(ii.line_total_paise - ii.tax_amount_paise) AS revenue, SUM(ii.quantity * ii.unit_cost_paise) AS cost FROM invoice_items ii JOIN invoices i ON i.invoice_id = ii.invoice_id JOIN customers c ON c.customer_id = i.customer_id
        WHERE i.business_id = $1 AND i.branch_id = ANY($2::int[]) AND i.status = 'ISSUED' AND i.invoice_date >= $3::date AND i.invoice_date <= $4::date GROUP BY c.name ORDER BY SUM(ii.line_total_paise - ii.tax_amount_paise) - SUM(ii.quantity * ii.unit_cost_paise) DESC`);
      const data = rows.map((x) => ({ customer: x.name, revenue: r(x.revenue), cost: r(x.cost), margin: r(n(x.revenue) - n(x.cost)), margin_pct: pct(n(x.revenue) - n(x.cost), x.revenue) }));
      return { columns: [col('customer', 'Customer'), col('revenue', 'Revenue (ex GST)', 'money'), col('cost', 'Cost', 'money'), col('margin', 'Gross margin', 'money'), col('margin_pct', 'Margin %', 'percent')], rows: data, totals: { customer: 'Total', revenue: sum(data, 'revenue'), cost: sum(data, 'cost'), margin: sum(data, 'margin'), margin_pct: pct(sum(data, 'margin'), sum(data, 'revenue')) } };
    }
  },
  returns_report: {
    group: 'Financial', label: 'Returns', description: 'Sales and purchase returns by reason, with the credit and debit notes they produced.', period: true,
    run: async (ctx) => {
      const rows = await run(ctx, `SELECT x.kind, x.reason, COUNT(*) AS returns, SUM(x.units) AS units, SUM(x.amount) AS amount FROM (
          SELECT wr.kind, wr.reason, (SELECT COALESCE(SUM(base_qty), 0) FROM wholesale_return_items ri WHERE ri.return_id = wr.return_id) AS units, COALESCE(cn.total_paise, dn.total_paise, 0) AS amount
          FROM wholesale_returns wr LEFT JOIN credit_notes cn ON cn.cn_id = wr.cn_id LEFT JOIN debit_notes dn ON dn.dn_id = wr.dn_id WHERE wr.business_id = $1 AND wr.branch_id = ANY($2::int[]) AND wr.created_at >= $3::date AND wr.created_at < ($4::date + 1)) x
        GROUP BY x.kind, x.reason ORDER BY x.kind, amount DESC`);
      const data = rows.map((x) => ({ kind: x.kind === 'SALE' ? 'Sales return' : 'Purchase return', reason: x.reason.replace(/_/g, ' ').toLowerCase(), returns: n(x.returns), units: n(x.units), amount: r(x.amount) }));
      return { columns: [col('kind', 'Type'), col('reason', 'Reason'), col('returns', 'Returns', 'number'), col('units', 'Units', 'number'), col('amount', 'Credit / debit note value', 'money')], rows: data };
    }
  }
};

export const catalogue = () => Object.entries(REPORTS).map(([key, d]) => ({ key, group: d.group, label: d.label, description: d.description, period: d.period, filters: d.filters || [] }));

export const runReport = async (key, ctx) => {
  const def = REPORTS[key];
  if (!def) throw new WholesaleError(404, 'Not found');
  const out = await def.run(ctx);
  return { key, title: def.label, group: def.group, description: def.description, period: def.period, from: def.period ? ctx.from : null, to: def.period ? ctx.to : null, ...out };
};
