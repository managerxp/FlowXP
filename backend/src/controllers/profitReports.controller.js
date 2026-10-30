/*
 * Profit reports: gross profit by bill, by item and by party, a profit & loss for the period, and a discount report. Gross profit is
 * what was sold (ex-tax, after discounts and returns) minus the cost of goods snapshotted on each bill line at the time of sale
 * (invoice_items.unit_cost_paise), the same arithmetic as modules/profitability.js with no payment-fee or commission assumptions.
 * A line sold with no cost on record counts as zero cost, so the bill is flagged ("uncosted") and its profit is an upper bound.
 *
 *   GET /reports/profit/bills | /profit/items | /profit/parties | /profit-loss | /discounts      (?from&to)
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { addDaysISO, businessToday } from '../utils/dates.js';
import { DEFAULT_SETTINGS, loadInvoices, profitOfInvoice } from '../modules/profitability.js';

const range = async (query, businessId) => {
  const to = /^\d{4}-\d{2}-\d{2}$/.test(query.to || '') ? query.to : await businessToday(businessId);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(query.from || '') ? query.from : addDaysISO(to, -30);
  return { from, to };
};
const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
const R = toRupees;

/* every issued bill in the period with its profit worked out, plus who it was for and how many of its lines have no cost on record */
const worked = async (req) => {
  const businessId = req.tenant.businessId;
  const { from, to } = await range(req.query, businessId);
  const loaded = await loadInvoices(businessId, from, to, pool, req.tenant.scopeBranchId);
  const ids = loaded.map(({ inv }) => inv.invoice_id);
  const meta = new Map();
  if (ids.length) {
    const { rows } = await pool.query(
      `SELECT i.invoice_id, i.invoice_number, i.customer_id, COALESCE(c.name, 'Walk-in customer') AS party,
              (SELECT COUNT(*) FROM invoice_items ii WHERE ii.invoice_id = i.invoice_id AND ii.unit_cost_paise IS NULL AND ii.product_id IS NOT NULL)::int AS uncosted
       FROM invoices i LEFT JOIN customers c ON c.customer_id = i.customer_id WHERE i.invoice_id = ANY($1::int[])`, [ids]);
    for (const r of rows) meta.set(r.invoice_id, r);
  }
  const bills = loaded.map(({ inv, lines }) => ({ inv, meta: meta.get(inv.invoice_id), r: profitOfInvoice(inv, lines, DEFAULT_SETTINGS) }));
  return { from, to, bills };
};
const totalsOf = (rows) => {
  const sales = rows.reduce((s, x) => s + x.sales, 0); const cost = rows.reduce((s, x) => s + x.cost, 0);
  return { sales: R(sales), cost: R(cost), profit: R(sales - cost), margin_pct: pct(sales - cost, sales) };
};
const shape = (x) => ({ ...x, sales: R(x.sales), cost: R(x.cost), profit: R(x.sales - x.cost), margin_pct: pct(x.sales - x.cost, x.sales) });

export const profitByBill = async (req, res) => {
  const { from, to, bills } = await worked(req);
  const rows = bills.map(({ inv, meta, r }) => ({ invoice_id: inv.invoice_id, number: meta?.invoice_number, date: inv.invoice_date, party: meta?.party, uncosted: meta?.uncosted || 0, sales: r.net_revenue, cost: r.cogs }));
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.invoice_id - a.invoice_id);
  res.json({ success: true, data: { range: { from, to }, totals: { ...totalsOf(rows), bills: rows.length, uncosted_bills: rows.filter((x) => x.uncosted).length }, rows: rows.map(shape) } });
};

export const profitByItem = async (req, res) => {
  const { from, to, bills } = await worked(req);
  const items = new Map();
  for (const { r } of bills) {
    for (const l of r.lines) {
      const key = l.product_id ?? `n:${l.name || 'Other'}`;
      const it = items.get(key) || { product_id: l.product_id, name: l.name || 'Other items', quantity: 0, sales: 0, cost: 0 };
      it.quantity += l.quantity; it.sales += l.revenue; it.cost += l.cogs; items.set(key, it);
    }
  }
  const rows = [...items.values()].sort((a, b) => (b.sales - b.cost) - (a.sales - a.cost));
  res.json({ success: true, data: { range: { from, to }, totals: totalsOf(rows), rows: rows.map((x) => ({ ...shape(x), quantity: Math.round(x.quantity * 1000) / 1000 })) } });
};

export const profitByParty = async (req, res) => {
  const { from, to, bills } = await worked(req);
  const parties = new Map();
  for (const { meta, r } of bills) {
    const key = meta?.customer_id ?? 'walk-in';
    const p = parties.get(key) || { party_id: meta?.customer_id ?? null, name: meta?.party || 'Walk-in customer', bills: 0, sales: 0, cost: 0 };
    p.bills += 1; p.sales += r.net_revenue; p.cost += r.cogs; parties.set(key, p);
  }
  const rows = [...parties.values()].sort((a, b) => (b.sales - b.cost) - (a.sales - a.cost));
  res.json({ success: true, data: { range: { from, to }, totals: totalsOf(rows), rows: rows.map(shape) } });
};

/* Profit & loss for the period: gross sales, less discounts and returns, less the cost of what was sold, less expenses. */
export const profitLoss = async (req, res) => {
  const businessId = req.tenant.businessId;
  const { from, to, bills } = await worked(req);
  const sum = (f) => bills.reduce((s, b) => s + f(b), 0);
  const gross = sum(({ inv }) => Number(inv.subtotal_paise));
  const discount = sum(({ r }) => r.discount); const returns = sum(({ r }) => r.refunded);
  const net = sum(({ r }) => r.net_revenue); const cogs = sum(({ r }) => r.cogs);
  const scope = req.tenant.scopeBranchId == null ? '' : ' AND branch_id = $4';
  const args = req.tenant.scopeBranchId == null ? [businessId, from, to] : [businessId, from, to, req.tenant.scopeBranchId];
  const expenses = (await pool.query(
    `SELECT category, COALESCE(SUM(amount_paise), 0) AS paise FROM expenses WHERE business_id = $1 AND expense_date BETWEEN $2 AND $3${scope} GROUP BY category ORDER BY paise DESC`, args)).rows;
  const spent = expenses.reduce((s, e) => s + Number(e.paise), 0);
  const income = (await pool.query(
    `SELECT category, COALESCE(SUM(amount_paise), 0) AS paise FROM other_income WHERE business_id = $1 AND income_date BETWEEN $2 AND $3${scope} GROUP BY category ORDER BY paise DESC`, args)).rows;
  const earned = income.reduce((s, e) => s + Number(e.paise), 0);
  res.json({
    success: true,
    data: {
      range: { from, to }, bills: bills.length, uncosted_bills: bills.filter((b) => b.meta?.uncosted).length,
      gross_sales: R(gross), discounts: R(discount), returns: R(returns), net_sales: R(net), cost_of_goods: R(cogs),
      gross_profit: R(net - cogs), gross_margin_pct: pct(net - cogs, net),
      expenses: expenses.map((e) => ({ category: e.category, amount: R(e.paise) })), total_expenses: R(spent),
      other_income: income.map((e) => ({ category: e.category, amount: R(e.paise) })), total_other_income: R(earned),
      net_profit: R(net - cogs - spent + earned), net_margin_pct: pct(net - cogs - spent + earned, net)
    }
  });
};

/* Discounts given: per bill, what came off the lines and what came off the bill, against what the goods were worth. */
export const discounts = async (req, res) => {
  const businessId = req.tenant.businessId;
  const { from, to } = await range(req.query, businessId);
  const scope = req.tenant.scopeBranchId == null ? '' : ' AND i.branch_id = $4';
  const args = req.tenant.scopeBranchId == null ? [businessId, from, to] : [businessId, from, to, req.tenant.scopeBranchId];
  const { rows } = await pool.query(
    `SELECT i.invoice_id, i.invoice_number, i.invoice_date, COALESCE(c.name, 'Walk-in customer') AS party,
            COALESCE(l.gross, 0) AS gross_paise, COALESCE(l.line_disc, 0) AS line_paise, i.discount_paise AS bill_paise
     FROM invoices i LEFT JOIN customers c ON c.customer_id = i.customer_id
     LEFT JOIN (SELECT invoice_id, SUM(ROUND(quantity * unit_price_paise)) AS gross, SUM(discount_paise) AS line_disc FROM invoice_items GROUP BY invoice_id) l ON l.invoice_id = i.invoice_id
     WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2 AND $3${scope} AND (i.discount_paise > 0 OR COALESCE(l.line_disc, 0) > 0)
     ORDER BY i.invoice_date DESC, i.invoice_id DESC LIMIT 2000`, args);
  const out = rows.map((r) => {
    const total = Number(r.line_paise) + Number(r.bill_paise);
    return { invoice_id: r.invoice_id, number: r.invoice_number, date: r.invoice_date, party: r.party, gross: R(r.gross_paise), line_discount: R(r.line_paise), bill_discount: R(r.bill_paise), discount: R(total), pct: pct(total, Number(r.gross_paise)) };
  });
  const t = (k) => out.reduce((s, r) => s + r[k], 0);
  const gross = t('gross');
  res.json({ success: true, data: { range: { from, to }, totals: { bills: out.length, gross: Math.round(gross * 100) / 100, line_discount: Math.round(t('line_discount') * 100) / 100, bill_discount: Math.round(t('bill_discount') * 100) / 100, discount: Math.round(t('discount') * 100) / 100, pct: pct(t('discount'), gross) }, rows: out } });
};
