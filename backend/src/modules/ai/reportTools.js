/*
 * The report screens as assistant tools: profit and loss, profit by item, discounts, GST by rate and HSN, stock worth, low stock, item
 * movement, sales by category and the day's money in and out. Each runs the same controller the Reports page calls, with the asker's
 * own tenant, so the assistant says exactly what the screen shows and can never reach further. Read-only, aggregates only: nothing
 * with a customer or supplier name is offered (party statements and by-party reports stay on the screen), as for every other tool.
 */
import * as profit from '../../controllers/profitReports.controller.js';
import * as gst from '../../controllers/gstReports.controller.js';
import * as stock from '../../controllers/stockReports.controller.js';
import * as ledger from '../../controllers/ledgerReports.controller.js';

class ReportToolError extends Error {}

/* run a report controller as the asker and hand back its data */
const viaController = async (fn, tenant, query = {}) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await fn({ tenant, query, params: {}, body: {}, headers: {} }, res);
  if (!res.body?.success) throw new ReportToolError(res.body?.message || 'That report could not be made');
  return res.body.data;
};
const top = (rows, n = 10) => rows.slice(0, Math.min(25, Number(n) || n));
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

const dateArgs = {
  from: { type: 'string', description: 'First day, YYYY-MM-DD (business local time). Defaults to 30 days before the end.' },
  to: { type: 'string', description: 'Last day, YYYY-MM-DD. Defaults to today.' }
};
const schema = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });
const range = (args) => ({ ...(args.from ? { from: args.from } : {}), ...(args.to ? { to: args.to } : {}) });
const NOTE = 'From recorded bills and expenses; cost is what was on record when each item was sold. Not accounting-grade profit.';

export const REPORT_TOOLS = [
  {
    name: 'profit_and_loss', label: 'Profit and loss', permission: 'reports',
    description: 'Profit and loss for a period: gross sales, discounts, returns, net sales (before tax), cost of goods, gross profit and margin, expenses by category, net profit. Use for "how much did we make this month", "what are the expenses eating".',
    input_schema: schema({ ...dateArgs }),
    run: async (tenant, args) => ({ ...(await viaController(profit.profitLoss, tenant, range(args))), note: NOTE })
  },
  {
    name: 'profit_by_item', label: 'Profit by item', permission: 'reports',
    description: 'Items ranked by gross profit for a period, with sales, cost, profit and margin. Use for most and least profitable items, items sold at a loss, what to reprice.',
    input_schema: schema({ ...dateArgs, order: { type: 'string', enum: ['best', 'worst'], description: 'best = most profit first (default); worst = least profit / losses first' }, limit: { type: 'integer', description: 'How many items, up to 25. Default 10.' } }),
    run: async (tenant, args) => {
      const d = await viaController(profit.profitByItem, tenant, range(args));
      const rows = args.order === 'worst' ? [...d.rows].reverse() : d.rows;
      return { period: d.range, totals: d.totals, order: args.order === 'worst' ? 'worst' : 'best', items: top(rows, args.limit ?? 10).map((r) => pick(r, ['name', 'quantity', 'sales', 'cost', 'profit', 'margin_pct'])), note: NOTE };
    }
  },
  {
    name: 'discount_summary', label: 'Discounts', permission: 'reports',
    description: 'How much discount was given in a period: bills discounted, total discount, discount off lines and off the whole bill, and as a percent of the goods sold.',
    input_schema: schema({ ...dateArgs }),
    run: async (tenant, args) => { const d = await viaController(profit.discounts, tenant, range(args)); return { period: d.range, ...d.totals }; }
  },
  {
    name: 'gst_summary', label: 'GST by rate', permission: 'gst',
    description: 'GST for a period by rate: tax charged on sales (output) against tax paid on purchases (input), and the net tax to pay. Use for "how much GST do I owe", input credit, which rate carries the most tax.',
    input_schema: schema({ ...dateArgs }),
    run: async (tenant, args) => { const d = await viaController(gst.rates, tenant, range(args)); return { period: d.range, totals: d.totals, by_rate: d.rows }; }
  },
  {
    name: 'sales_by_hsn', label: 'Sales by HSN', permission: 'gst',
    description: 'Sales or purchases summarised by HSN code and tax rate for a period: quantity, taxable value, CGST, SGST, IGST. Also reports how many lines have no HSN code. Use for HSN-wise questions and GSTR-1 preparation.',
    input_schema: schema({ ...dateArgs, kind: { type: 'string', enum: ['sales', 'purchases'], description: 'Default sales' } }),
    run: async (tenant, args) => {
      const d = await viaController(gst.summary, tenant, { ...range(args), by: 'hsn', kind: args.kind === 'purchases' ? 'purchases' : 'sales' });
      return { period: d.range, kind: d.kind, lines_without_hsn: d.missing_code, totals: d.totals, rows: top(d.rows, 25) };
    }
  },
  {
    name: 'stock_value', label: 'Stock value', permission: 'inventory',
    description: 'What stock is on hand and worth right now, by category: items, quantity, value at cost and at selling price, and how many items are low.',
    input_schema: schema(),
    run: async (tenant) => { const d = await viaController(stock.summary, tenant); return { totals: d.totals, by_category: d.rows }; }
  },
  {
    name: 'low_stock_list', label: 'Low stock', permission: 'inventory',
    description: 'Items at or under their warning level right now, most short first: quantity, warning level, how much is needed, supplier and the cost of refilling. Use for "what should I reorder".',
    input_schema: schema({ limit: { type: 'integer', description: 'How many items, up to 25. Default 15.' } }),
    run: async (tenant, args) => { const d = await viaController(stock.low, tenant); return { totals: d.totals, items: top(d.rows, args.limit ?? 15) }; }
  },
  {
    name: 'item_movement', label: 'Item movement', permission: 'inventory',
    description: 'Per item for a period: opening stock, bought, sold, returned, adjusted, closing and the closing value. Use for fastest and slowest movers, stock that did not sell, shrinkage (large negative adjustments).',
    input_schema: schema({ ...dateArgs, sort_by: { type: 'string', enum: ['sold', 'value', 'adjusted'], description: 'Default sold' }, order: { type: 'string', enum: ['most', 'least'], description: 'Default most' }, limit: { type: 'integer', description: 'Up to 25. Default 10.' } }),
    run: async (tenant, args) => {
      const d = await viaController(stock.items, tenant, range(args));
      const key = ['sold', 'value', 'adjusted'].includes(args.sort_by) ? args.sort_by : 'sold';
      // most = largest first; for adjustments that is the biggest loss (shrinkage), so the sign flips
      const rows = [...d.rows].sort((a, b) => (key === 'adjusted' ? 1 : -1) * (args.order === 'least' ? -1 : 1) * (a[key] - b[key]));
      return { period: d.range, totals: d.totals, sorted_by: key, items: top(rows, args.limit ?? 10).map((r) => pick(r, ['name', 'category', 'opening', 'bought', 'sold', 'returned', 'adjusted', 'closing', 'value'])) };
    }
  },
  {
    name: 'category_sales', label: 'Sales by category', permission: 'reports',
    description: 'Sales or purchases by item category for a period (before tax): quantity, taxable value, tax. Use for which category sells most or costs most to restock.',
    input_schema: schema({ ...dateArgs, kind: { type: 'string', enum: ['sales', 'purchases'], description: 'Default sales' } }),
    run: async (tenant, args) => { const d = await viaController(stock.categorySales, tenant, { ...range(args), kind: args.kind === 'purchases' ? 'purchases' : 'sales' }); return { period: d.range, kind: d.kind, totals: d.totals, by_category: d.rows }; }
  },
  {
    name: 'money_in_out', label: 'Money in and out', permission: 'reports',
    description: 'For a period (a day, a week, a month): sales, purchases, expenses, sale and purchase returns, money received and money paid out. Totals only. Use for "how much came in today", "what did we pay out this week".',
    input_schema: schema({ ...dateArgs }),
    run: async (tenant, args) => { const d = await viaController(ledger.transactions, tenant, range(args)); return { period: d.range, ...d.summary }; }
  }
];
