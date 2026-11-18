/*
 * Order and batch reports for every kind of business (wholesalers have their own, richer set under /wholesale/reports):
 *   GET /reports/sale-orders?from&to       sales orders in the period: what was ordered, shipped and is still open
 *   GET /reports/purchase-orders?from&to   purchase orders in the period: what was ordered, received, paid and is still owed
 *   GET /reports/batches?days=90           stock held by batch with expiry, and serial numbers in stock
 * Each answers { columns, rows, totals } (the shape the wholesale reports use), so the Reports page draws them with one table.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { addDaysISO, businessToday } from '../utils/dates.js';

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const range = async (q, businessId) => {
  const to = isDate(q.to) ? q.to : await businessToday(businessId);
  return { from: isDate(q.from) ? q.from : addDaysISO(to, -30), to };
};
const col = (key, label, type = 'text') => ({ key, label, type });
const sum = (rows, k) => Math.round(rows.reduce((s, r) => s + Number(r[k] || 0), 0) * 1000) / 1000;
const scope = (req, column, values) => { if (req.tenant.scopeBranchId == null) return ''; values.push(req.tenant.scopeBranchId); return ` AND ${column} = $${values.length}`; };

export const saleOrders = async (req, res) => {
  const { from, to } = await range(req.query, req.tenant.businessId);
  const values = [req.tenant.businessId, from, to];
  const { rows } = await pool.query(
    `SELECT o.order_number, o.order_date::text AS date, c.name AS customer, o.status, o.total_paise,
            COALESCE(SUM(i.base_qty), 0) AS ordered, COALESCE(SUM(i.shipped_base), 0) AS shipped, CASE WHEN o.status IN ('CANCELLED','CLOSED','FULFILLED') THEN 0 ELSE COALESCE(SUM(GREATEST(i.base_qty - i.shipped_base - i.cancelled_base, 0)), 0) END AS open
     FROM wholesale_sales_orders o LEFT JOIN customers c ON c.customer_id = o.customer_id LEFT JOIN wholesale_sales_order_items i ON i.order_id = o.order_id
     WHERE o.business_id = $1 AND o.order_date BETWEEN $2 AND $3${scope(req, 'o.branch_id', values)}
     GROUP BY o.order_id, c.name ORDER BY o.order_date DESC, o.order_id DESC`, values);
  const data = rows.map((r) => ({ order: r.order_number, date: r.date, customer: r.customer || '', status: r.status, value: toRupees(r.total_paise), ordered: Number(r.ordered), shipped: Number(r.shipped), open: Number(r.open) }));
  res.json({ success: true, data: {
    range: { from, to },
    columns: [col('order', 'Order'), col('date', 'Date', 'date'), col('customer', 'Customer'), col('status', 'Status'), col('value', 'Value', 'money'), col('ordered', 'Units ordered', 'number'), col('shipped', 'Units delivered', 'number'), col('open', 'Units still to deliver', 'number')],
    rows: data, totals: { order: 'Total', value: sum(data, 'value'), ordered: sum(data, 'ordered'), shipped: sum(data, 'shipped'), open: sum(data, 'open') }
  } });
};

export const purchaseOrders = async (req, res) => {
  const { from, to } = await range(req.query, req.tenant.businessId);
  const values = [req.tenant.businessId, from, to];
  const { rows } = await pool.query(
    `SELECT po.po_number, po.po_date::text AS date, s.name AS supplier, po.status, po.total_paise, po.amount_paid_paise, po.balance_due_paise, po.due_date::text AS due_date
     FROM purchase_orders po LEFT JOIN suppliers s ON s.supplier_id = po.supplier_id
     WHERE po.business_id = $1 AND po.po_date BETWEEN $2 AND $3${scope(req, 'po.branch_id', values)}
     ORDER BY po.po_date DESC, po.po_id DESC`, values);
  const data = rows.map((r) => ({ order: r.po_number, date: r.date, supplier: r.supplier || '', status: r.status, value: toRupees(r.total_paise), paid: toRupees(r.amount_paid_paise), due: toRupees(r.balance_due_paise), due_date: r.due_date }));
  res.json({ success: true, data: {
    range: { from, to },
    columns: [col('order', 'Order'), col('date', 'Date', 'date'), col('supplier', 'Supplier'), col('status', 'Status'), col('value', 'Value', 'money'), col('paid', 'Paid', 'money'), col('due', 'Still to pay', 'money'), col('due_date', 'Pay by', 'date')],
    rows: data, totals: { order: 'Total', value: sum(data, 'value'), paid: sum(data, 'paid'), due: sum(data, 'due') }
  } });
};

export const batches = async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 90, 1), 3650);
  const values = [req.tenant.businessId];
  const b = scope(req, 'b.branch_id', values);
  const { rows } = await pool.query(
    `SELECT p.name, 'Batch' AS kind, b.batch_no AS code, br.name AS outlet, b.expiry_date::text AS expiry, (b.expiry_date - CURRENT_DATE) AS days_left, b.qty_on_hand AS qty, b.qty_on_hand * b.cost_paise AS value_paise
     FROM wholesale_batches b JOIN products p ON p.product_id = b.product_id JOIN branches br ON br.branch_id = b.branch_id
     WHERE b.business_id = $1 AND b.qty_on_hand > 0${b}
     UNION ALL
     SELECT p.name, 'Serial', s.serial_no, br.name, NULL, NULL, 1, p.purchase_price_paise
     FROM wholesale_serials s JOIN products p ON p.product_id = s.product_id JOIN branches br ON br.branch_id = s.branch_id
     WHERE s.business_id = $1 AND s.status = 'IN_STOCK'${b.replace('b.branch_id', 's.branch_id')}
     ORDER BY 5 NULLS LAST, 1, 3`, values);
  const status = (d) => (d == null ? '' : d < 0 ? 'Expired' : d <= days ? 'Expiring soon' : 'Good');
  const data = rows.map((r) => ({ product: r.name, kind: r.kind, code: r.code, outlet: r.outlet, expiry: r.expiry, days_left: r.days_left == null ? null : Number(r.days_left), status: status(r.days_left == null ? null : Number(r.days_left)), qty: Number(r.qty), value: toRupees(r.value_paise) }));
  res.json({ success: true, data: {
    columns: [col('product', 'Product'), col('kind', 'Type'), col('code', 'Batch or serial'), col('outlet', 'Outlet'), col('expiry', 'Expiry', 'date'), col('days_left', 'Days left', 'number'), col('status', 'Status'), col('qty', 'Quantity', 'number'), col('value', 'Value (cost)', 'money')],
    rows: data, totals: { product: 'Total', qty: sum(data, 'qty'), value: sum(data, 'value') }
  } });
};
