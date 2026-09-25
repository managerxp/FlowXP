/*
 * True profitability: what a sale actually leaves after everything it cost.
 *
 *   net revenue      what was billed, ex-tax, after discounts and refunds
 *   − food cost      cost of goods snapshotted on each invoice line at sale time
 *   − payment fees   % of what was collected, by payment method
 *   − commission     % of food value, by delivery platform
 *   − packaging      flat per takeaway / delivery order
 *   = contribution   what the sale contributes toward rent, salaries, everything fixed
 *
 * Operating expenses and wastage are period costs, not per-sale, so they sit
 * below contribution in the summary as "estimated net". Every figure is an
 * estimate built from the recorded data and the assumptions in cost_settings;
 * none of it is an accounting-grade profit.
 *
 * ponytail: computed on read from invoices/lines. Fine to a few hundred
 * thousand invoices; past that, add a nightly per-day aggregate table.
 */
import pool from '../config/database.js';

export const DEFAULT_SETTINGS = { payment_fee_pct: {}, platform_commission_pct: {}, packaging_per_order_paise: 0 };

/**
 * Pure: split one invoice's economics across its lines.
 * @param invoice { subtotal_paise, tax_paise, discount_paise, refunded_paise, channel, platform, order_type, payments: [{method, amount_paise}] }
 * @param lines   [{ product_id, name, quantity, taxable_paise, cogs_paise }]   taxable = after line discount, ex-tax
 * @param settings cost_settings shape
 */
export const profitOfInvoice = (invoice, lines, settings = DEFAULT_SETTINGS) => {
  const subtotal = Number(invoice.subtotal_paise);
  const tax = Number(invoice.tax_paise);
  // Discounts and refunds are recorded on tax-inclusive totals; bring them back to ex-tax.
  const exTaxShare = subtotal + tax > 0 ? subtotal / (subtotal + tax) : 1;
  const discount = Math.round(Number(invoice.discount_paise) * exTaxShare);
  const refunded = Math.round(Number(invoice.refunded_paise) * exTaxShare);
  const netRevenue = subtotal - discount - refunded;

  const fee = (invoice.payments || []).reduce(
    (sum, p) => sum + (Number(p.amount_paise) * (Number(settings.payment_fee_pct?.[p.method]) || 0)) / 100, 0);
  const commission = invoice.platform
    ? ((subtotal - discount) * (Number(settings.platform_commission_pct?.[invoice.platform]) || 0)) / 100
    : 0;
  const packaging = ['TAKEAWAY', 'DELIVERY'].includes(invoice.order_type) ? Number(settings.packaging_per_order_paise) || 0 : 0;

  const cogs = lines.reduce((s, l) => s + Number(l.cogs_paise), 0);
  const variable = { payment_fees: fee, commission, packaging };

  const base = lines.reduce((s, l) => s + Number(l.taxable_paise), 0) || 1;
  const perLine = lines.map((l) => {
    const share = Number(l.taxable_paise) / base;
    const revenue = Number(l.taxable_paise) - (discount + refunded) * share;
    const variableCost = (fee + commission + packaging) * share;
    return {
      product_id: l.product_id, name: l.name, quantity: Number(l.quantity),
      revenue, cogs: Number(l.cogs_paise), variable_cost: variableCost,
      contribution: revenue - Number(l.cogs_paise) - variableCost
    };
  });

  return {
    net_revenue: netRevenue, discount, refunded, cogs, ...variable,
    contribution: netRevenue - cogs - fee - commission - packaging,
    lines: perLine
  };
};

const round = (n) => Math.round(n);

/** Load settings (defaults if never saved). */
export const loadSettings = async (businessId, db = pool) => {
  const { rows } = await db.query(`SELECT payment_fee_pct, platform_commission_pct, packaging_per_order_paise FROM cost_settings WHERE business_id = $1`, [businessId]);
  return rows[0] ? { ...rows[0], packaging_per_order_paise: Number(rows[0].packaging_per_order_paise) } : { ...DEFAULT_SETTINGS };
};

/** Every non-cancelled invoice in a date range, with lines and payments, ready for profitOfInvoice. */
const loadInvoices = async (businessId, from, to, db = pool, branchId = null) => {
  const scope = branchId != null ? ' AND i.branch_id = $4' : '';
  const invoices = (await db.query(
    `SELECT i.invoice_id, i.invoice_date, i.subtotal_paise, i.tax_paise, i.discount_paise, (i.refunded_paise - i.cn_refunded_paise + i.credited_paise) AS refunded_paise, i.total_paise,
            o.platform, o.order_type
     FROM invoices i
     LEFT JOIN orders o ON o.order_id = i.order_id
     WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date BETWEEN $2 AND $3${scope}`,
    branchId != null ? [businessId, from, to, branchId] : [businessId, from, to]
  )).rows;
  if (!invoices.length) return [];
  const ids = invoices.map((i) => i.invoice_id);

  const items = (await db.query(
    `SELECT ii.invoice_id, ii.product_id, p.name, ii.quantity,
            (ii.line_total_paise - ii.tax_amount_paise) AS taxable_paise,
            COALESCE(ii.unit_cost_paise, 0) * ii.quantity AS cogs_paise
     FROM invoice_items ii LEFT JOIN products p ON p.product_id = ii.product_id
     WHERE ii.invoice_id = ANY($1::int[])`,
    [ids]
  )).rows;
  const payments = (await db.query(
    `SELECT invoice_id, payment_method AS method, amount_paise FROM payments WHERE invoice_id = ANY($1::int[])`, [ids]
  )).rows;

  const linesBy = new Map(); const paysBy = new Map();
  for (const l of items) { if (!linesBy.has(l.invoice_id)) linesBy.set(l.invoice_id, []); linesBy.get(l.invoice_id).push(l); }
  for (const p of payments) { if (!paysBy.has(p.invoice_id)) paysBy.set(p.invoice_id, []); paysBy.get(p.invoice_id).push(p); }
  return invoices.map((inv) => ({ inv: { ...inv, payments: paysBy.get(inv.invoice_id) || [] }, lines: linesBy.get(inv.invoice_id) || [] }));
};

const channelOf = (inv) => (inv.platform ? inv.platform : inv.order_type || 'COUNTER');

const emptyTotals = () => ({ invoices: 0, net_revenue: 0, cogs: 0, payment_fees: 0, commission: 0, packaging: 0, contribution: 0, discount: 0, refunded: 0 });
const addTotals = (t, r) => {
  t.invoices += 1; t.net_revenue += r.net_revenue; t.cogs += r.cogs; t.payment_fees += r.payment_fees;
  t.commission += r.commission; t.packaging += r.packaging; t.contribution += r.contribution; t.discount += r.discount; t.refunded += r.refunded;
};
const finish = (t) => ({
  ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, k === 'invoices' ? v : round(v)])),
  food_cost_pct: t.net_revenue > 0 ? Math.round((t.cogs / t.net_revenue) * 1000) / 10 : null,
  gross_margin_pct: t.net_revenue > 0 ? Math.round(((t.net_revenue - t.cogs) / t.net_revenue) * 1000) / 10 : null,
  contribution_margin_pct: t.net_revenue > 0 ? Math.round((t.contribution / t.net_revenue) * 1000) / 10 : null
});

/** Totals, by channel, by day and by item for a range. */
export const profitability = async (businessId, from, to, db = pool, branchId = null) => {
  const settings = await loadSettings(businessId, db);
  const loaded = await loadInvoices(businessId, from, to, db, branchId);

  const total = emptyTotals(); const channels = new Map(); const days = new Map(); const items = new Map();
  for (const { inv, lines } of loaded) {
    const r = profitOfInvoice(inv, lines, settings);
    addTotals(total, r);
    const ch = channelOf(inv);
    if (!channels.has(ch)) channels.set(ch, emptyTotals());
    addTotals(channels.get(ch), r);
    const day = String(inv.invoice_date);
    if (!days.has(day)) days.set(day, emptyTotals());
    addTotals(days.get(day), r);
    for (const l of r.lines) {
      if (!l.product_id) continue;
      const it = items.get(l.product_id) || { product_id: l.product_id, name: l.name, quantity: 0, revenue: 0, cogs: 0, variable_cost: 0, contribution: 0 };
      it.quantity += l.quantity; it.revenue += l.revenue; it.cogs += l.cogs; it.variable_cost += l.variable_cost; it.contribution += l.contribution;
      items.set(l.product_id, it);
    }
  }

  const itemRows = [...items.values()].map((i) => ({
    product_id: i.product_id, name: i.name, quantity: Math.round(i.quantity * 1000) / 1000,
    revenue: round(i.revenue), food_cost: round(i.cogs), variable_cost: round(i.variable_cost), contribution: round(i.contribution),
    food_cost_pct: i.revenue > 0 ? Math.round((i.cogs / i.revenue) * 1000) / 10 : null,
    contribution_margin_pct: i.revenue > 0 ? Math.round((i.contribution / i.revenue) * 1000) / 10 : null,
    contribution_per_unit: i.quantity > 0 ? round(i.contribution / i.quantity) : 0
  })).sort((a, b) => b.contribution - a.contribution);

  return {
    totals: finish(total),
    channels: [...channels].map(([channel, t]) => ({ channel, ...finish(t) })).sort((a, b) => b.net_revenue - a.net_revenue),
    days: [...days].map(([day, t]) => ({ day, ...finish(t) })).sort((a, b) => a.day.localeCompare(b.day)),
    items: itemRows,
    settings
  };
};

/** Period costs that sit below contribution: operating expenses and wastage (valued at current cost). */
export const periodCosts = async (businessId, from, to, db = pool, branchId = null) => {
  const args = branchId != null ? [businessId, from, to, branchId] : [businessId, from, to];
  const expenses = (await db.query(
    `SELECT category, SUM(amount_paise) AS amount_paise FROM expenses WHERE business_id = $1 AND expense_date BETWEEN $2 AND $3${branchId != null ? ' AND branch_id = $4' : ''} GROUP BY category ORDER BY 2 DESC`,
    args
  )).rows.map((r) => ({ category: r.category, amount: Number(r.amount_paise) }));
  const wastage = Number((await db.query(
    `SELECT COALESCE(SUM(-t.quantity * p.purchase_price_paise), 0) AS cost
     FROM inventory_transactions t JOIN products p ON p.product_id = t.product_id
     WHERE t.business_id = $1 AND t.transaction_type = 'WASTAGE' AND t.created_at >= $2::date AND t.created_at < ($3::date + 1)${branchId != null ? ' AND t.branch_id = $4' : ''}`,
    args
  )).rows[0].cost);
  return { expenses, expenses_total: expenses.reduce((s, e) => s + e.amount, 0), wastage: round(wastage) };
};
