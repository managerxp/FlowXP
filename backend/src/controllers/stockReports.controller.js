/*
 * Stock reports: what is on hand and worth by category, everything running low, each item's movement over a period (opening, bought, sold,
 * returned, adjusted, closing), one item's ledger with a running balance, and sales or purchases by category. Quantities come from
 * inventory_transactions, the ledger every stock number is derived from (a signed quantity per movement); "on hand now" reads the same
 * place products.current_stock / branch_stock caches, so the reports and the stock screens cannot disagree.
 *
 *   GET /reports/stock/summary      GET /reports/stock/low      GET /reports/stock/items?from&to
 *   GET /reports/stock/ledger?product_id&from&to      GET /reports/category-sales?kind=sales|purchases&from&to
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { addDaysISO, businessToday } from '../utils/dates.js';

const R = toRupees;
const num = (v) => Math.round(Number(v) * 1000) / 1000;
const range = async (query, businessId) => {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : await businessToday(businessId);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : addDaysISO(to, -30);
  return { from, to };
};
const TZ = `COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata')`;

/* what an outlet holds, or the business total */
const holdings = (req) => {
  const scoped = req.tenant.scopeBranchId != null;
  return {
    from: scoped ? 'products p JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = $2' : 'products p',
    qty: scoped ? 'bs.quantity' : 'p.current_stock',
    args: scoped ? [req.tenant.businessId, req.tenant.scopeBranchId] : [req.tenant.businessId]
  };
};

/* on hand and worth, by category: at what it cost and at what it sells for */
export const summary = async (req, res) => {
  const h = holdings(req);
  const { rows } = await pool.query(
    `SELECT COALESCE(c.name, 'Uncategorised') AS category, COUNT(*)::int AS items, COALESCE(SUM(${h.qty}), 0) AS qty,
            COALESCE(SUM(${h.qty} * p.purchase_price_paise), 0) AS cost_paise, COALESCE(SUM(${h.qty} * p.selling_price_paise), 0) AS sell_paise,
            COUNT(*) FILTER (WHERE ${h.qty} <= p.min_stock)::int AS low
     FROM ${h.from} LEFT JOIN categories c ON c.category_id = p.category_id
     WHERE p.business_id = $1 AND p.track_inventory AND p.status = 'ACTIVE'
     GROUP BY c.name ORDER BY cost_paise DESC`, h.args);
  const t = (k) => rows.reduce((s, r) => s + Number(r[k]), 0);
  res.json({
    success: true,
    data: {
      totals: { items: t('items'), qty: num(t('qty')), cost_value: R(t('cost_paise')), sell_value: R(t('sell_paise')), low: t('low') },
      rows: rows.map((r) => ({ category: r.category, items: r.items, qty: num(r.qty), cost_value: R(r.cost_paise), sell_value: R(r.sell_paise), margin_value: R(Number(r.sell_paise) - Number(r.cost_paise)), low: r.low }))
    }
  });
};

/* every item at or under its warning level, the most short first, with who supplies it and what a refill would cost */
export const low = async (req, res) => {
  const h = holdings(req);
  const { rows } = await pool.query(
    `SELECT p.product_id, p.name, p.unit, COALESCE(c.name, 'Uncategorised') AS category, s.name AS supplier, ${h.qty} AS qty, p.min_stock, p.purchase_price_paise AS cost
     FROM ${h.from} LEFT JOIN categories c ON c.category_id = p.category_id LEFT JOIN suppliers s ON s.supplier_id = p.supplier_id
     WHERE p.business_id = $1 AND p.track_inventory AND p.status = 'ACTIVE' AND ${h.qty} <= p.min_stock
     ORDER BY (${h.qty} - p.min_stock), p.name LIMIT 2000`, h.args);
  const out = rows.map((r) => {
    const short = Math.max(0, Number(r.min_stock) - Number(r.qty));
    return { product_id: r.product_id, name: r.name, unit: r.unit, category: r.category, supplier: r.supplier, qty: num(r.qty), min_stock: num(r.min_stock), short: num(short), refill_cost: R(short * Number(r.cost)), out_of_stock: Number(r.qty) <= 0 };
  });
  res.json({ success: true, data: { totals: { items: out.length, out_of_stock: out.filter((r) => r.out_of_stock).length, refill_cost: Math.round(out.reduce((s, r) => s + r.refill_cost, 0) * 100) / 100 }, rows: out } });
};

/* Item detail: each tracked item's period (opening, bought, sold, returned, adjusted, closing) and what the closing stock is worth at cost */
export const items = async (req, res) => {
  const businessId = req.tenant.businessId;
  const { from, to } = await range(req.query, businessId);
  const scoped = req.tenant.scopeBranchId != null;
  const args = scoped ? [businessId, from, to, req.tenant.scopeBranchId] : [businessId, from, to];
  const { rows } = await pool.query(
    `SELECT p.product_id, p.name, p.unit, COALESCE(c.name, 'Uncategorised') AS category, p.purchase_price_paise AS cost,
            COALESCE(SUM(t.quantity) FILTER (WHERE t.d < $2::date), 0) AS opening,
            COALESCE(SUM(t.quantity) FILTER (WHERE t.d BETWEEN $2::date AND $3::date AND t.transaction_type = 'PURCHASE'), 0) AS bought,
            COALESCE(SUM(t.quantity) FILTER (WHERE t.d BETWEEN $2::date AND $3::date AND t.transaction_type = 'SALE'), 0) AS sold,
            COALESCE(SUM(t.quantity) FILTER (WHERE t.d BETWEEN $2::date AND $3::date AND t.transaction_type = 'RETURN'), 0) AS returned,
            COALESCE(SUM(t.quantity) FILTER (WHERE t.d BETWEEN $2::date AND $3::date AND t.transaction_type IN ('ADJUSTMENT', 'OPENING')), 0) AS adjusted,
            COALESCE(SUM(t.quantity) FILTER (WHERE t.d <= $3::date), 0) AS closing
     FROM products p LEFT JOIN categories c ON c.category_id = p.category_id
     LEFT JOIN (SELECT product_id, transaction_type, quantity, (created_at AT TIME ZONE ${TZ})::date AS d FROM inventory_transactions WHERE business_id = $1${scoped ? ' AND branch_id = $4' : ''}) t ON t.product_id = p.product_id
     WHERE p.business_id = $1 AND p.track_inventory AND p.status = 'ACTIVE'
     GROUP BY p.product_id, p.name, p.unit, c.name, p.purchase_price_paise
     HAVING COALESCE(SUM(t.quantity) FILTER (WHERE t.d <= $3::date), 0) <> 0 OR COUNT(t.d) FILTER (WHERE t.d BETWEEN $2::date AND $3::date) > 0
     ORDER BY p.name`, args);
  const out = rows.map((r) => ({ product_id: r.product_id, name: r.name, unit: r.unit, category: r.category, opening: num(r.opening), bought: num(r.bought), sold: num(-r.sold), returned: num(r.returned), adjusted: num(r.adjusted), closing: num(r.closing), value: R(Number(r.closing) * Number(r.cost)) }));
  const t = (k) => num(out.reduce((s, r) => s + r[k], 0));
  res.json({ success: true, data: { range: { from, to }, totals: { items: out.length, bought: t('bought'), sold: t('sold'), value: Math.round(out.reduce((s, r) => s + r.value, 0) * 100) / 100 }, rows: out } });
};

const LABEL = { SALE: 'Sale', PURCHASE: 'Purchase', ADJUSTMENT: 'Adjustment', RETURN: 'Return', OPENING: 'Opening stock' };

/* Stock detail: one item's movements with a running balance */
export const ledger = async (req, res) => {
  const businessId = req.tenant.businessId;
  const id = Number(req.query.product_id);
  if (!Number.isInteger(id)) return res.status(400).json({ success: false, message: 'Choose an item' });
  const { from, to } = await range(req.query, businessId);
  const product = (await pool.query('SELECT product_id, name, unit FROM products WHERE business_id = $1 AND product_id = $2', [businessId, id])).rows[0];
  if (!product) return res.status(404).json({ success: false, message: 'Item not found' });
  const scoped = req.tenant.scopeBranchId != null;
  const args = scoped ? [businessId, id, req.tenant.scopeBranchId] : [businessId, id];
  const all = (await pool.query(
    `SELECT t.txn_id, t.transaction_type, t.quantity, t.reference_type, t.reference_id, t.notes, t.created_at, to_char((t.created_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS d
     FROM inventory_transactions t WHERE t.business_id = $1 AND t.product_id = $2${scoped ? ' AND t.branch_id = $3' : ''} ORDER BY t.created_at, t.txn_id`, args)).rows;
  const dayOf = (r) => r.d;
  const opening = all.filter((r) => dayOf(r) < from).reduce((s, r) => s + Number(r.quantity), 0);
  let balance = opening;
  const lines = all.filter((r) => dayOf(r) >= from && dayOf(r) <= to).map((r) => {
    balance += Number(r.quantity);
    return { date: dayOf(r), type: LABEL[r.transaction_type] || r.transaction_type, quantity: num(r.quantity), reference: r.reference_type ? `${r.reference_type} #${r.reference_id}` : '', notes: r.notes || '', balance: num(balance) };
  });
  res.json({ success: true, data: { product, range: { from, to }, opening: num(opening), closing: num(balance), lines: lines.slice(-2000) } });
};

/* Sales (bills less credit notes) or purchases (received orders) by item category, without tax */
export const categorySales = async (req, res) => {
  const businessId = req.tenant.businessId;
  const { from, to } = await range(req.query, businessId);
  const sales = req.query.kind !== 'purchases';
  const scoped = req.tenant.scopeBranchId != null;
  const args = scoped ? [businessId, from, to, req.tenant.scopeBranchId] : [businessId, from, to];
  const sql = sales
    ? `SELECT COALESCE(c.name, 'Uncategorised') AS category, SUM(x.sign * x.quantity) AS qty, SUM(x.sign * (x.line_total_paise - x.tax_amount_paise)) AS taxable, SUM(x.sign * x.tax_amount_paise) AS tax
       FROM (
         SELECT ii.product_id, ii.quantity, ii.line_total_paise, ii.tax_amount_paise, 1 AS sign FROM invoice_items ii JOIN invoices i ON i.invoice_id = ii.invoice_id
           WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2 AND $3${scoped ? ' AND i.branch_id = $4' : ''}
         UNION ALL
         SELECT ci.product_id, ci.quantity, ci.line_total_paise, ci.tax_amount_paise, -1 FROM credit_note_items ci JOIN credit_notes cn ON cn.cn_id = ci.cn_id
           WHERE cn.business_id = $1 AND cn.cn_date BETWEEN $2 AND $3${scoped ? ' AND cn.branch_id = $4' : ''}
       ) x LEFT JOIN products p ON p.product_id = x.product_id LEFT JOIN categories c ON c.category_id = p.category_id GROUP BY c.name ORDER BY taxable DESC`
    : `SELECT COALESCE(c.name, 'Uncategorised') AS category, SUM(pi.quantity) AS qty, SUM(pi.line_total_paise - pi.tax_amount_paise) AS taxable, SUM(pi.tax_amount_paise) AS tax
       FROM purchase_order_items pi JOIN purchase_orders po ON po.po_id = pi.po_id LEFT JOIN products p ON p.product_id = pi.product_id LEFT JOIN categories c ON c.category_id = p.category_id
       WHERE po.business_id = $1 AND po.status = 'RECEIVED' AND po.po_date BETWEEN $2 AND $3${scoped ? ' AND po.branch_id = $4' : ''} GROUP BY c.name ORDER BY taxable DESC`;
  const { rows } = await pool.query(sql, args);
  const out = rows.map((r) => ({ category: r.category, qty: num(r.qty), taxable: R(r.taxable), tax: R(r.tax), total: R(Number(r.taxable) + Number(r.tax)) }));
  const t = (k) => Math.round(out.reduce((s, r) => s + r[k], 0) * 100) / 100;
  res.json({ success: true, data: { kind: sales ? 'sales' : 'purchases', range: { from, to }, totals: { qty: num(out.reduce((s, r) => s + r.qty, 0)), taxable: t('taxable'), tax: t('tax'), total: t('total') }, rows: out } });
};
