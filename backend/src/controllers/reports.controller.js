/*
 * Reports: read-only aggregates over what billing, purchasing and expenses
 * have already recorded. Nothing here writes anything, so nothing here needs
 * a transaction — the honesty this file has to get right is in the SQL, not
 * in locking.
 *
 * Every endpoint takes optional ?from&to (inclusive, YYYY-MM-DD) and defaults
 * to the last 30 days when neither is given, because "show me everything"
 * over a year of invoices is rarely what someone actually wants from a
 * dashboard link.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { addDaysISO, businessToday } from '../utils/dates.js';

/* Outlet scoping for one query: the extra WHERE clause and the parameters it adds ($4 after
   [businessId, from, to]; pass n = 2 for queries that only have [businessId]). */
const outlet = (req, column, n = 4) => {
  const id = req.tenant.scopeBranchId;
  return id == null ? { sql: '', args: [] } : { sql: ` AND ${column} = $${n}`, args: [id] };
};

const dateRange = async (query, businessId) => {
  const to = query.to || await businessToday(businessId);
  return { from: query.from || addDaysISO(to, -30), to };
};

/* ==========================================================================
   GET /api/reports/sales
   ========================================================================== */
export const sales = async (req, res) => {
  const { from, to } = await dateRange(req.query, req.tenant.businessId);
  const businessId = req.tenant.businessId;
  const inv = outlet(req, 'branch_id'); const invI = outlet(req, 'i.branch_id'); const pay = outlet(req, 'branch_id');

  const [totals, byDay, topProducts, byMethod] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS invoice_count,
              COALESCE(SUM(total_paise),0) AS total_paise,
              COALESCE(SUM(tax_paise),0) AS tax_paise,
              COALESCE(SUM(balance_due_paise),0) AS outstanding_paise
       FROM invoices WHERE business_id = $1 AND status = 'ISSUED' AND invoice_date BETWEEN $2 AND $3${inv.sql}`,
      [businessId, from, to, ...inv.args]
    ),
    pool.query(
      `SELECT invoice_date, COUNT(*)::int AS invoice_count, SUM(total_paise) AS total_paise
       FROM invoices WHERE business_id = $1 AND status = 'ISSUED' AND invoice_date BETWEEN $2 AND $3${inv.sql}
       GROUP BY invoice_date ORDER BY invoice_date`,
      [businessId, from, to, ...inv.args]
    ),
    pool.query(
      `SELECT p.product_id, p.name, SUM(ii.quantity) AS quantity, SUM(ii.line_total_paise) AS revenue_paise
       FROM invoice_items ii
       JOIN invoices i ON i.invoice_id = ii.invoice_id
       LEFT JOIN products p ON p.product_id = ii.product_id
       WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2 AND $3 AND ii.product_id IS NOT NULL${invI.sql}
       GROUP BY p.product_id, p.name ORDER BY revenue_paise DESC LIMIT 10`,
      [businessId, from, to, ...invI.args]
    ),
    pool.query(
      `SELECT payment_method, COALESCE(SUM(amount_paise),0) AS amount_paise
       FROM payments WHERE business_id = $1 AND payment_date BETWEEN $2 AND $3${pay.sql}
       GROUP BY payment_method ORDER BY amount_paise DESC`,
      [businessId, from, to, ...pay.args]
    )
  ]);

  res.json({
    success: true,
    data: {
      range: { from, to },
      total_sales: toRupees(totals.rows[0].total_paise),
      total_tax: toRupees(totals.rows[0].tax_paise),
      invoice_count: totals.rows[0].invoice_count,
      outstanding: toRupees(totals.rows[0].outstanding_paise),
      by_day: byDay.rows.map((r) => ({ date: r.invoice_date, invoice_count: r.invoice_count, total: toRupees(r.total_paise) })),
      top_products: topProducts.rows.map((r) => ({ product_id: r.product_id, name: r.name || 'Unnamed item', quantity: Number(r.quantity), revenue: toRupees(r.revenue_paise) })),
      by_payment_method: byMethod.rows.map((r) => ({ method: r.payment_method, amount: toRupees(r.amount_paise) }))
    }
  });
};

/* ==========================================================================
   GET /api/reports/purchases
   ========================================================================== */
export const purchases = async (req, res) => {
  const { from, to } = await dateRange(req.query, req.tenant.businessId);
  const po = outlet(req, 'branch_id'); const poP = outlet(req, 'po.branch_id');
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS po_count, COALESCE(SUM(total_paise),0) AS total_paise, COALESCE(SUM(balance_due_paise),0) AS payable_paise
     FROM purchase_orders WHERE business_id = $1 AND status = 'RECEIVED' AND po_date BETWEEN $2 AND $3${po.sql}`,
    [req.tenant.businessId, from, to, ...po.args]
  );
  const bySupplier = await pool.query(
    `SELECT s.supplier_id, s.name, SUM(po.total_paise) AS total_paise
     FROM purchase_orders po LEFT JOIN suppliers s ON s.supplier_id = po.supplier_id
     WHERE po.business_id = $1 AND po.status = 'RECEIVED' AND po.po_date BETWEEN $2 AND $3${poP.sql}
     GROUP BY s.supplier_id, s.name ORDER BY total_paise DESC LIMIT 10`,
    [req.tenant.businessId, from, to, ...poP.args]
  );
  res.json({
    success: true,
    data: {
      range: { from, to },
      total_purchases: toRupees(rows[0].total_paise),
      po_count: rows[0].po_count,
      total_payable: toRupees(rows[0].payable_paise),
      by_supplier: bySupplier.rows.map((r) => ({ supplier_id: r.supplier_id, name: r.name || 'Unknown supplier', total: toRupees(r.total_paise) }))
    }
  });
};

/* ==========================================================================
   GET /api/reports/expenses
   ========================================================================== */
export const expenses = async (req, res) => {
  const { from, to } = await dateRange(req.query, req.tenant.businessId);
  const ex = outlet(req, 'branch_id');
  const [totals, byCategory] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS expense_count, COALESCE(SUM(amount_paise),0) AS total_paise
                FROM expenses WHERE business_id = $1 AND expense_date BETWEEN $2 AND $3${ex.sql}`, [req.tenant.businessId, from, to, ...ex.args]),
    pool.query(`SELECT category, COALESCE(SUM(amount_paise),0) AS amount_paise
                FROM expenses WHERE business_id = $1 AND expense_date BETWEEN $2 AND $3${ex.sql}
                GROUP BY category ORDER BY amount_paise DESC`, [req.tenant.businessId, from, to, ...ex.args])
  ]);
  res.json({
    success: true,
    data: {
      range: { from, to },
      total_expenses: toRupees(totals.rows[0].total_paise),
      expense_count: totals.rows[0].expense_count,
      by_category: byCategory.rows.map((r) => ({ category: r.category, amount: toRupees(r.amount_paise) }))
    }
  });
};

/* ==========================================================================
   GET /api/reports/outstanding — who owes what
   ========================================================================== */
export const outstanding = async (req, res) => {
  const oi = outlet(req, 'i.branch_id', 2);
  const { rows } = await pool.query(
    `SELECT c.customer_id, c.name, c.phone, SUM(i.balance_due_paise) AS balance_paise, MIN(i.invoice_date) AS oldest_invoice_date
     FROM invoices i JOIN customers c ON c.customer_id = i.customer_id
     WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.balance_due_paise > 0${oi.sql}
     GROUP BY c.customer_id, c.name, c.phone ORDER BY balance_paise DESC`,
    [req.tenant.businessId, ...oi.args]
  );
  res.json({
    success: true,
    data: rows.map((r) => ({
      customer_id: r.customer_id, name: r.name, phone: r.phone,
      balance_due: toRupees(r.balance_paise), oldest_invoice_date: r.oldest_invoice_date
    }))
  });
};

/* ==========================================================================
   GET /api/reports/inventory
   ========================================================================== */
export const inventory = async (req, res) => {
  const scoped = req.tenant.scopeBranchId != null;
  const args = scoped ? [req.tenant.businessId, req.tenant.scopeBranchId] : [req.tenant.businessId];
  // At one outlet: what that outlet holds; otherwise the business total.
  const from = scoped ? `products p JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = $2` : 'products p';
  const qty = scoped ? 'bs.quantity' : 'p.current_stock';
  const [valuation, lowStock] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(${qty} * p.purchase_price_paise),0) AS value_paise, COUNT(*)::int AS product_count
       FROM ${from} WHERE p.business_id = $1 AND p.track_inventory AND p.status = 'ACTIVE'`,
      args
    ),
    pool.query(
      `SELECT p.product_id, p.name, ${qty} AS current_stock, p.min_stock FROM ${from}
       WHERE p.business_id = $1 AND p.track_inventory AND p.status = 'ACTIVE' AND ${qty} <= p.min_stock
       ORDER BY (${qty} - p.min_stock) LIMIT 20`,
      args
    )
  ]);
  res.json({
    success: true,
    data: {
      total_value: toRupees(valuation.rows[0].value_paise),
      product_count: valuation.rows[0].product_count,
      low_stock: lowStock.rows.map((r) => ({ product_id: r.product_id, name: r.name, current_stock: Number(r.current_stock), min_stock: Number(r.min_stock) }))
    }
  });
};

/* ==========================================================================
   GET /api/reports/customers — who buys the most
   ========================================================================== */
export const customers = async (req, res) => {
  const { from, to } = await dateRange(req.query, req.tenant.businessId);
  const ci = outlet(req, 'i.branch_id');
  const { rows } = await pool.query(
    `SELECT c.customer_id, c.name, COUNT(i.invoice_id)::int AS invoice_count, COALESCE(SUM(i.total_paise),0) AS total_paise
     FROM customers c JOIN invoices i ON i.customer_id = c.customer_id
     WHERE c.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2 AND $3${ci.sql}
     GROUP BY c.customer_id, c.name ORDER BY total_paise DESC LIMIT 20`,
    [req.tenant.businessId, from, to, ...ci.args]
  );
  res.json({ success: true, data: rows.map((r) => ({ customer_id: r.customer_id, name: r.name, invoice_count: r.invoice_count, total: toRupees(r.total_paise) })) });
};

/* ==========================================================================
   GET /api/reports/gst — CGST/SGST/IGST summary + HSN-wise breakdown
   ========================================================================== */
export const gst = async (req, res) => {
  const { from, to } = await dateRange(req.query, req.tenant.businessId);
  const gi = outlet(req, 'branch_id'); const giI = outlet(req, 'i.branch_id');
  const cnC = outlet(req, 'c.branch_id');
  const [totals, byHsn, cnTotals, cnHsn] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(cgst_paise),0) AS cgst_paise, COALESCE(SUM(sgst_paise),0) AS sgst_paise,
              COALESCE(SUM(igst_paise),0) AS igst_paise, COALESCE(SUM(tax_paise),0) AS tax_paise,
              COALESCE(SUM(subtotal_paise),0) AS taxable_paise
       FROM invoices WHERE business_id = $1 AND status = 'ISSUED' AND invoice_date BETWEEN $2 AND $3${gi.sql}`,
      [req.tenant.businessId, from, to, ...gi.args]
    ),
    pool.query(
      `SELECT COALESCE(p.hsn_sac, 'No HSN/SAC') AS hsn_sac, ii.tax_rate,
              SUM(ii.quantity * ii.unit_price_paise - ii.discount_paise) AS taxable_paise,
              SUM(ii.tax_amount_paise) AS tax_paise
       FROM invoice_items ii
       JOIN invoices i ON i.invoice_id = ii.invoice_id
       LEFT JOIN products p ON p.product_id = ii.product_id
       WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2 AND $3${giI.sql}
       GROUP BY p.hsn_sac, ii.tax_rate ORDER BY tax_paise DESC`,
      [req.tenant.businessId, from, to, ...giI.args]
    ),
    // Credit notes issued in the period take tax and taxable value back off the return.
    pool.query(
      `SELECT COALESCE(SUM(c.cgst_paise),0) AS cgst_paise, COALESCE(SUM(c.sgst_paise),0) AS sgst_paise, COALESCE(SUM(c.igst_paise),0) AS igst_paise,
              COALESCE(SUM(c.tax_paise),0) AS tax_paise, COALESCE(SUM(c.subtotal_paise),0) AS taxable_paise, COUNT(*)::int AS n
       FROM credit_notes c WHERE c.business_id = $1 AND c.cn_date BETWEEN $2 AND $3${cnC.sql}`,
      [req.tenant.businessId, from, to, ...cnC.args]
    ),
    pool.query(
      `SELECT COALESCE(p.hsn_sac, 'No HSN/SAC') AS hsn_sac, ci.tax_rate, SUM(ci.line_total_paise - ci.tax_amount_paise) AS taxable_paise, SUM(ci.tax_amount_paise) AS tax_paise
       FROM credit_note_items ci JOIN credit_notes c ON c.cn_id = ci.cn_id LEFT JOIN products p ON p.product_id = ci.product_id
       WHERE c.business_id = $1 AND c.cn_date BETWEEN $2 AND $3${cnC.sql} GROUP BY p.hsn_sac, ci.tax_rate`,
      [req.tenant.businessId, from, to, ...cnC.args]
    )
  ]);
  const cn = cnTotals.rows[0];
  const hsn = new Map();
  for (const r of byHsn.rows) hsn.set(`${r.hsn_sac}|${Number(r.tax_rate)}`, { hsn_sac: r.hsn_sac, tax_rate: Number(r.tax_rate), taxable: Number(r.taxable_paise), tax: Number(r.tax_paise) });
  for (const r of cnHsn.rows) {
    const k = `${r.hsn_sac}|${Number(r.tax_rate)}`;
    const cur = hsn.get(k) || { hsn_sac: r.hsn_sac, tax_rate: Number(r.tax_rate), taxable: 0, tax: 0 };
    cur.taxable -= Number(r.taxable_paise); cur.tax -= Number(r.tax_paise); hsn.set(k, cur);
  }
  res.json({
    success: true,
    data: {
      range: { from, to },
      // net of credit notes issued in the period
      taxable_value: toRupees(Number(totals.rows[0].taxable_paise) - Number(cn.taxable_paise)),
      cgst: toRupees(Number(totals.rows[0].cgst_paise) - Number(cn.cgst_paise)),
      sgst: toRupees(Number(totals.rows[0].sgst_paise) - Number(cn.sgst_paise)),
      igst: toRupees(Number(totals.rows[0].igst_paise) - Number(cn.igst_paise)),
      total_tax: toRupees(Number(totals.rows[0].tax_paise) - Number(cn.tax_paise)),
      credit_notes: { count: cn.n, taxable_value: toRupees(cn.taxable_paise), tax: toRupees(cn.tax_paise) },
      by_hsn: [...hsn.values()].sort((a, b) => b.tax - a.tax).map((r) => ({ hsn_sac: r.hsn_sac, tax_rate: r.tax_rate, taxable_value: toRupees(r.taxable), tax: toRupees(r.tax) }))
    }
  });
};

/* ==========================================================================
   GET /api/reports/gst/register?from=&to=&format=csv

   One row per document per tax rate: invoices, and credit notes as negative
   rows, with the customer's GSTIN where there is one. This is the working
   register a GSTR-1 is prepared from (B2B rows have a customer GSTIN, the rest
   are B2C); its totals equal the GST report for the same dates.
   ========================================================================== */
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+@\t\r]/.test(s)) s = `'${s}`;                       // never let a name run as a spreadsheet formula
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const gstRegister = async (req, res) => {
  const { from, to } = await dateRange(req.query, req.tenant.businessId);
  const id = req.tenant.businessId;
  const inv = outlet(req, 'i.branch_id'); const cnO = outlet(req, 'c.branch_id');

  const invoiceRows = (await pool.query(
    `SELECT i.invoice_number AS number, i.invoice_date AS date, cu.name AS customer, cu.gstin, COALESCE(cu.state, b.state) AS state, ii.tax_rate,
            SUM(ii.line_total_paise - ii.tax_amount_paise) AS taxable_paise, SUM(ii.tax_amount_paise) AS tax_paise, MAX(i.igst_paise) AS inv_igst
     FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.invoice_id JOIN businesses b ON b.business_id = i.business_id LEFT JOIN customers cu ON cu.customer_id = i.customer_id
     WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2 AND $3${inv.sql}
     GROUP BY i.invoice_id, i.invoice_number, i.invoice_date, cu.name, cu.gstin, cu.state, b.state, ii.tax_rate ORDER BY i.invoice_date, i.invoice_number`,
    [id, from, to, ...inv.args]
  )).rows.map((r) => ({ type: 'Invoice', sign: 1, ...r }));

  const noteRows = (await pool.query(
    `SELECT c.cn_number AS number, c.cn_date AS date, cu.name AS customer, cu.gstin, COALESCE(cu.state, b.state) AS state, ci.tax_rate,
            SUM(ci.line_total_paise - ci.tax_amount_paise) AS taxable_paise, SUM(ci.tax_amount_paise) AS tax_paise, MAX(c.igst_paise) AS inv_igst
     FROM credit_notes c JOIN credit_note_items ci ON ci.cn_id = c.cn_id JOIN invoices i ON i.invoice_id = c.invoice_id JOIN businesses b ON b.business_id = c.business_id LEFT JOIN customers cu ON cu.customer_id = i.customer_id
     WHERE c.business_id = $1 AND c.cn_date BETWEEN $2 AND $3${cnO.sql}
     GROUP BY c.cn_id, c.cn_number, c.cn_date, cu.name, cu.gstin, cu.state, b.state, ci.tax_rate ORDER BY c.cn_date, c.cn_number`,
    [id, from, to, ...cnO.args]
  )).rows.map((r) => ({ type: 'Credit note', sign: -1, ...r }));

  const rows = [...invoiceRows, ...noteRows].map((r) => {
    const tax = r.sign * Number(r.tax_paise);
    const igst = Number(r.inv_igst) > 0 ? tax : 0;
    const cgst = igst ? 0 : Math.trunc(tax / 2);
    return {
      type: r.type, number: r.number, date: String(r.date).slice(0, 10), customer: r.customer || 'Walk-in', gstin: r.gstin || '', state: r.state || '',
      supply: r.gstin ? 'B2B' : 'B2C', rate: Number(r.tax_rate), taxable: r.sign * Number(r.taxable_paise), cgst, sgst: igst ? 0 : tax - cgst, igst, total: r.sign * Number(r.taxable_paise) + tax
    };
  });

  const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
  if (req.query.format === 'csv') {
    const head = ['Type', 'Number', 'Date', 'Customer', 'Customer GSTIN', 'State', 'Supply', 'Tax rate %', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Total'];
    const money = (p) => (p / 100).toFixed(2);
    const lines = [head, ...rows.map((r) => [r.type, r.number, r.date, r.customer, r.gstin, r.state, r.supply, r.rate, money(r.taxable), money(r.cgst), money(r.sgst), money(r.igst), money(r.total)]),
      ['TOTAL', '', '', '', '', '', '', '', money(sum('taxable')), money(sum('cgst')), money(sum('sgst')), money(sum('igst')), money(sum('total'))]];
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="gst-register-${from}-to-${to}.csv"`);
    return res.send(lines.map((l) => l.map(csvCell).join(',')).join('\n'));
  }
  res.json({
    success: true,
    data: {
      range: { from, to },
      totals: { taxable_value: toRupees(sum('taxable')), cgst: toRupees(sum('cgst')), sgst: toRupees(sum('sgst')), igst: toRupees(sum('igst')), total: toRupees(sum('total')) },
      rows: rows.map((r) => ({ ...r, taxable: toRupees(r.taxable), cgst: toRupees(r.cgst), sgst: toRupees(r.sgst), igst: toRupees(r.igst), total: toRupees(r.total) }))
    }
  });
};
