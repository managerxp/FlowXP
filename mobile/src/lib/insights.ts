/*
 * The owner's insight reports for food businesses, on the phone: profitability (what sales leave after food cost, fees, commission and packaging),
 * the demand forecast and what to buy, revenue leakage (patterns that differ from this business's own normal), and kitchen performance (how long
 * dishes take). The same as the website's four pages; the server does all the working, and every figure here is an estimate or a prediction and says
 * so. Pure: date ranges, wording, the cost-assumption form and the review bodies.
 */
import { t } from './i18n.ts';
import { rupees, toPaise } from './money.ts';

const money = (n: number): string => rupees(toPaise(n));
export const canInsights = (can: (perm: string) => boolean, perm: 'reports' | 'settings'): boolean => can(perm);

const iso = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const daysAgoISO = (n: number, now: Date = new Date()): string => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - n); return iso(d); };
/** The `from`/`to` query for "the last N days, today included". */
export const rangeQuery = (days: number, now?: Date): string => `from=${daysAgoISO(days - 1, now)}&to=${daysAgoISO(0, now)}`;
export const pctText = (n: number | null | undefined): string => (n == null ? '—' : `${n}%`);
export const minText = (n: number | null | undefined): string => (n == null ? '—' : t('{n} min', { n }));
/** "▲ 4.2%" or "▼ 3 pts"; the colour is the screen's job: whether up is good depends on the figure. */
export const deltaText = (v: number | null | undefined, unit = '%'): string => (v == null || v === 0 ? t('no change') : `${v > 0 ? '▲' : '▼'} ${Math.abs(v)}${unit === ' pts' ? ` ${t('pts')}` : unit}`);
export const deltaGood = (v: number | null | undefined, upIsGood = true): boolean | null => (v == null || v === 0 ? null : (v > 0) === upIsGood);

/* ── profitability ───────────────────────────────────────────────────────── */
export const PROFIT_RANGES = [7, 30, 60];
export const CHANNEL_LABEL: Record<string, string> = { COUNTER: 'Counter / dine-in', TAKEAWAY: 'Takeaway', DELIVERY: 'Delivery', ZOMATO: 'Zomato', SWIGGY: 'Swiggy', ONDC: 'ONDC', MAGICPIN: 'Magicpin' };
export const PARTS: { key: 'cogs' | 'payment_fees' | 'commission' | 'packaging' | 'contribution'; label: string }[] = [
  { key: 'cogs', label: 'Food cost' }, { key: 'payment_fees', label: 'Payment fees' }, { key: 'commission', label: 'Platform commission' }, { key: 'packaging', label: 'Packaging' }, { key: 'contribution', label: 'Contribution' }
];
export type Totals = { net_revenue: number; cogs: number; payment_fees: number; commission: number; packaging: number; contribution: number; contribution_margin_pct: number | null; food_cost_pct: number | null; gross_margin_pct: number | null; estimated_net: number; discount: number; refunded: number };
export type Profit = {
  period: { days: number }; totals: Totals; change_pct: { net_revenue_pct: number | null; food_cost_pct_points: number | null; contribution_pct: number | null; estimated_net_pct: number | null };
  period_costs: { expenses_total: number; expenses: { category: string; amount: number }[]; wastage: number };
  channels: { channel: string; invoices: number; net_revenue: number; food_cost_pct: number | null; commission: number; contribution: number; contribution_margin_pct: number }[];
  items: { product_id: number; name: string; quantity: number; revenue: number; food_cost_pct: number | null; contribution_per_unit: number; contribution: number; contribution_margin_pct: number | null }[];
  trend: { day: string; net_revenue: number; contribution: number }[];
};
export const ITEM_SORTS: { id: 'contribution' | 'revenue' | 'quantity' | 'contribution_per_unit' | 'margin'; label: string }[] = [
  { id: 'contribution', label: 'Total contribution' }, { id: 'revenue', label: 'Revenue' }, { id: 'quantity', label: 'Quantity sold' }, { id: 'contribution_per_unit', label: 'Contribution per portion' }, { id: 'margin', label: 'Margin (lowest first)' }
];
export const sortItems = (items: Profit['items'], sort: (typeof ITEM_SORTS)[number]['id']): Profit['items'] =>
  [...items].sort((a, b) => (sort === 'margin' ? (a.contribution_margin_pct ?? 0) - (b.contribution_margin_pct ?? 0) : b[sort] - a[sort]));
export const channelSub = (c: Profit['channels'][number]): string => [t('{n} orders', { n: c.invoices }), t('food cost {pct}', { pct: pctText(c.food_cost_pct) }), c.commission ? t('commission {value}', { value: money(c.commission) }) : '', t('margin {pct}', { pct: pctText(c.contribution_margin_pct) })].filter(Boolean).join(' · ');
export const itemSub = (i: Profit['items'][number]): string => [t('{n} sold', { n: i.quantity }), t('revenue {value}', { value: money(i.revenue) }), t('food cost {pct}', { pct: pctText(i.food_cost_pct) }), t('{value} per portion', { value: money(i.contribution_per_unit) }), t('margin {pct}', { pct: pctText(i.contribution_margin_pct) })].join(' · ');
export const expensesSub = (p: Profit['period_costs']): string => p.expenses.slice(0, 3).map((e) => `${e.category} ${money(e.amount)}`).join(' · ');
/** The share of revenue each part takes, for the "where each rupee goes" lines. */
export const share = (value: number, revenue: number): number => (revenue > 0 ? Math.max(0, Math.round((value / revenue) * 100)) : 0);

export type Assumptions = { payment_fee_pct: Record<string, number | null>; platform_commission_pct: Record<string, number | null>; packaging_per_order: number };
export type AssumptionsForm = { fees: Record<'CASH' | 'UPI' | 'CARD', string>; commissions: Record<'ZOMATO' | 'SWIGGY' | 'ONDC' | 'MAGICPIN', string>; packaging: string };
export const FEE_KEYS = ['CASH', 'UPI', 'CARD'] as const;
export const FEE_LABEL: Record<string, string> = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card' };
export const COMMISSION_KEYS = ['ZOMATO', 'SWIGGY', 'ONDC', 'MAGICPIN'] as const;
export const assumptionsForm = (s: Assumptions): AssumptionsForm => ({
  fees: { CASH: String(s.payment_fee_pct.CASH ?? ''), UPI: String(s.payment_fee_pct.UPI ?? ''), CARD: String(s.payment_fee_pct.CARD ?? '') },
  commissions: { ZOMATO: String(s.platform_commission_pct.ZOMATO ?? ''), SWIGGY: String(s.platform_commission_pct.SWIGGY ?? ''), ONDC: String(s.platform_commission_pct.ONDC ?? ''), MAGICPIN: String(s.platform_commission_pct.MAGICPIN ?? '') },
  packaging: s.packaging_per_order ? String(s.packaging_per_order) : ''
});
export const assumptionsProblem = (f: AssumptionsForm): string => {
  for (const v of [...Object.values(f.fees), ...Object.values(f.commissions)]) if (v.trim() !== '' && !(Number(v) >= 0 && Number(v) <= 100)) return 'A rate is a percentage from 0 to 100';
  if (f.packaging.trim() !== '' && !(Number(f.packaging) >= 0)) return 'Packaging must be an amount in rupees';
  return '';
};
const num = (o: Record<string, string>): Record<string, number> => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v) || 0]));
export const assumptionsBody = (f: AssumptionsForm): { payment_fee_pct: Record<string, number>; platform_commission_pct: Record<string, number>; packaging_per_order: number } => ({ payment_fee_pct: num(f.fees), platform_commission_pct: num(f.commissions), packaging_per_order: Number(f.packaging) || 0 });

/* ── forecast ────────────────────────────────────────────────────────────── */
export const shortDate = (isoDay: string): string => new Date(`${isoDay}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
export const hourLabel = (h: number): string => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
export type Range = { low: number; high: number } | null;
export const rangeText = (r: Range, digits = 0): string => (r ? `${r.low.toFixed(digits)}–${r.high.toFixed(digits)}` : '—');
export type Day = { date: string; weekday: string; insufficient_data?: boolean; confidence: 'high' | 'medium' | 'low'; orders: ({ predicted: number } & NonNullable<Range>) | null; revenue: { predicted: number } | null; events: { event_id: number; label: string }[] };
export type Forecast = {
  daily: Day[]; focus: { date: string; hourly: { hour: number; orders: number }[]; items: { product_id: number; name: string; category: string | null; portions: { predicted: number } & NonNullable<Range>; confidence: 'high' | 'medium' | 'low' }[]; categories: { category: string; portions: { predicted: number } & NonNullable<Range> }[] };
  accuracy?: { orders?: { days: number; mape_pct: number; bias_pct: number } }; upcoming_events: { event_id: number; date: string; label: string; multiplier: number }[]; history_days: number; method: string;
};
export const dayLine = (d: Day): string => (d.orders ? [t('{n} orders', { n: Math.round(d.orders.predicted) }), t('typically {range}', { range: rangeText(d.orders) }), d.revenue ? money(d.revenue.predicted) : '', t(d.confidence), ...d.events.map((e) => e.label)].filter(Boolean).join(' · ') : t('Not enough history'));
export const accuracyText = (a: Forecast['accuracy']): string => {
  const o = a?.orders;
  if (!o) return t('Not enough history yet to check how accurate this has been.');
  return t('On the last {days} days the same method was off by {pct}% on average for orders.', { days: o.days, pct: o.mape_pct }) + (o.bias_pct !== 0 ? ` ${t(o.bias_pct > 0 ? 'It tended to run {pct}% high.' : 'It tended to run {pct}% low.', { pct: Math.abs(o.bias_pct) })}` : '');
};
export const eventLine = (e: Forecast['upcoming_events'][number]): string => `${shortDate(e.date)} · ${e.label} (${e.multiplier >= 1 ? '+' : ''}${Math.round((e.multiplier - 1) * 100)}%)`;
export type EventForm = { date: string; label: string; uplift_pct: string };
export const emptyEvent = (): EventForm => ({ date: '', label: '', uplift_pct: '25' });
export const eventProblem = (f: EventForm): string => (!/^\d{4}-\d{2}-\d{2}$/.test(f.date) || Number.isNaN(Date.parse(`${f.date}T00:00:00Z`)) ? 'Dates are written like 2026-10-31' : !f.label.trim() ? 'Say what is happening' : !Number.isFinite(Number(f.uplift_pct)) || f.uplift_pct.trim() === '' ? 'Enter the expected change as a number' : '');
export const eventBody = (f: EventForm): { date: string; label: string; uplift_pct: number } => ({ date: f.date, label: f.label.trim(), uplift_pct: Number(f.uplift_pct) });

export type StockItem = { product_id: number; name: string; unit: string; current_stock: number; tomorrow_need: number; days_of_cover: number | null; reorder_point: number; static_min_stock: number; status: 'ORDER_NOW' | 'ORDER_SOON' | 'OK'; recommended_qty: number; estimated_cost: number };
export type StockForecast = { summary: { order_now: number; order_soon: number; estimated_cost: number; flagged_only_by_prediction: number }; by_supplier: { supplier_id: number | null; supplier_name: string; total: number; items: { product_id: number; name: string; quantity: number; unit: string }[] }[]; items: StockItem[]; method: string };
export const STOCK_STATUS: Record<StockItem['status'], string> = { ORDER_NOW: 'Order now', ORDER_SOON: 'Order soon', OK: 'OK' };
export const stockSub = (i: StockItem): string => [t('in stock {v}', { v: `${i.current_stock} ${i.unit}` }), t('tomorrow {v}', { v: `${i.tomorrow_need} ${i.unit}` }), i.days_of_cover == null ? '' : t('{n} days of cover', { n: i.days_of_cover }), i.recommended_qty ? t('buy {v}', { v: `${i.recommended_qty} ${i.unit}` }) : ''].filter(Boolean).join(' · ');
export const draftNote = (r: { orders: unknown[]; already_on_order: unknown[] }): string => (r.orders.length ? t('Draft orders created. See Purchases.') : r.already_on_order.length ? t('Everything suggested is already on an open order.') : t('Nothing needs ordering right now.'));

/* ── leakage ─────────────────────────────────────────────────────────────── */
export const LEAK_RANGES = [14, 30, 60];
export const LEAK_CATEGORY: Record<string, string> = { discounts: 'Discounts', cancellations: 'Cancellations', refunds: 'Refunds', wastage: 'Wastage', inventory: 'Stock adjustments' };
export const SEVERITY: Record<string, string> = { critical: 'Needs attention', warning: 'Worth a look', informational: 'For information' };
export type Finding = {
  fingerprint: string; severity: 'critical' | 'warning' | 'informational'; category: string; confidence: string; status: 'OPEN' | 'REVIEWED' | 'DISMISSED'; potential: number; title: string; summary: string; recommendation: string;
  metric?: { label: string; unit?: string }; current_value?: number; expected_value?: number; difference?: number; review?: { note?: string; reviewed_by?: string } | null; evidence?: { columns: string[]; rows: (string | number)[][] };
};
export type Leakage = { summary: { potential: number; open: number; critical: number; by_category: { category: string; potential: number }[] }; findings: Finding[]; note: string; period: { days: number } };
export const showValue = (value: number, unit?: string): string => (unit === '₹' ? money(value) : `${value}${unit || ''}`);
export const findingCounts = (l: Leakage): string => (l.summary.open === 1 ? t('1 open finding') : t('{n} open findings', { n: l.summary.open })) + (l.summary.critical > 0 ? `, ${t('{n} needing attention', { n: l.summary.critical })}` : '');
export const evidenceCell = (cell: string | number, column: string): string =>
  typeof cell === 'number' && /collected|refunded|discount|amount|bill/i.test(column) && !/%/.test(column) ? money(cell) : typeof cell === 'number' && /% off/i.test(column) ? `${cell}%` : String(cell);
export const reviewBody = (f: Finding, status: 'OPEN' | 'REVIEWED' | 'DISMISSED', note?: string): { fingerprint: string; status: string; note: string | undefined } => ({ fingerprint: f.fingerprint, status, note: note?.trim() || undefined });
export const reviewedText = (status: string): string => (status === 'OPEN' ? t('Reopened') : status === 'DISMISSED' ? t('Dismissed for 14 days') : t('Marked reviewed'));

/* ── kitchen performance ─────────────────────────────────────────────────── */
export const KITCHEN_RANGES = [7, 14, 30];
export type Kitchen = {
  period: { days: number }; overall: { lines: number; avg_minutes: number | null; p90_minutes: number | null; on_time_pct: number | null }; previous: { lines: number; avg_minutes: number | null; on_time_pct: number | null };
  stations: { name: string; lines: number; avg_minutes: number | null; p90_minutes: number | null; on_time_pct: number | null }[]; hours: { hour: number; avg_minutes: number; lines: number }[];
  items: { name: string; lines: number; expected_minutes: number | null; avg_minutes: number | null; p90_minutes: number | null; on_time_pct: number | null; change_minutes: number | null; previous_avg_minutes: number | null }[];
};
export const slowerDishes = (k: Kitchen): Kitchen['items'] => k.items.filter((i) => i.change_minutes != null && i.change_minutes >= 2).slice(0, 3);
export const changeText = (v: number | null): string => (v == null || v === 0 ? '—' : `${v > 0 ? '▲' : '▼'} ${Math.abs(v)} ${t('min')}`);
export const stationLine = (s: Kitchen['stations'][number]): string => [t('{n} items', { n: s.lines }), t('slowest 1 in 10: {v}', { v: minText(s.p90_minutes) }), t('on time {pct}', { pct: s.on_time_pct == null ? '—' : `${s.on_time_pct}%` })].join(' · ');
export const dishLine = (i: Kitchen['items'][number]): string => [t('{n} items', { n: i.lines }), t('set time {v}', { v: minText(i.expected_minutes) }), t('slowest 1 in 10: {v}', { v: minText(i.p90_minutes) }), t('on time {pct}', { pct: i.on_time_pct == null ? '—' : `${i.on_time_pct}%` }), i.change_minutes ? changeText(i.change_minutes) : ''].filter(Boolean).join(' · ');
export const slowerText = (i: Kitchen['items'][number]): string => t('{name} now averages {now} minutes, up from {before}.', { name: i.name, now: i.avg_minutes ?? 0, before: i.previous_avg_minutes ?? 0 });

export const INSIGHT_TEXTS: string[] = [
  // shared
  'Back', 'Cancel', 'Save', 'Could not load.', 'Could not save. Check the connection and try again.', 'Last {n} days', '{n} min', 'min', 'pts', 'no change', 'Estimate', '{n} orders', 'Prediction',
  // profitability
  'Profitability', 'What your sales actually leave, after the costs that come with them.', 'Built from recorded sales and your cost assumptions, not an accounting figure.', 'Cost assumptions', 'Calculating…', 'Net revenue', 'Food cost', 'Gross margin', 'Contribution', 'Estimated net',
  'of revenue', 'after food cost', 'after expenses', 'Where each rupee of revenue goes', 'Payment fees', 'Platform commission', 'Packaging', 'Operating expenses', 'Wastage', 'valued at current cost', 'By channel', 'Counter / dine-in', 'Takeaway', 'Delivery', 'Zomato', 'Swiggy', 'ONDC', 'Magicpin', 'food cost {pct}', 'commission {value}', 'margin {pct}', 'By menu item', 'Total contribution', 'Revenue', 'Quantity sold', 'Contribution per portion', 'Margin (lowest first)',
  '{n} sold', 'revenue {value}', '{value} per portion', 'No sales in this period.', 'No items sold in this period.',
  'FlowXP cannot know what your card machine or delivery platform charges. Enter your real rates; anything left at 0 is not deducted.', 'Payment fees (% of amount collected)', 'Cash', 'UPI', 'Card', 'Delivery platform commission (% of food value)', 'Packaging per takeaway / delivery order (₹)', 'Box, bag, cutlery.',
  'Save assumptions', 'A rate is a percentage from 0 to 100', 'Packaging must be an amount in rupees',
  'Net revenue is what was billed before tax, minus discounts and refunds. Cancelled invoices are left out. Food cost is the ingredient cost recorded on each bill when it was made. Fees, commission and packaging use your assumptions: unset means zero. Contribution is what each sale leaves toward rent, salaries and other fixed costs.',
  // forecast
  'Forecast', 'What to expect, and what to have in the kitchen for it.', 'Demand', 'Stock & purchasing', 'Working out the week ahead…', 'Not enough history', 'Not enough history yet to check how accurate this has been.', 'On the last {days} days the same method was off by {pct}% on average for orders.',
  'It tended to run {pct}% high.', 'It tended to run {pct}% low.', 'typically {range}', 'high', 'medium', 'low', 'Forecasting needs at least three weeks of history for the same weekday. You have {n} trading days so far. Check back as history builds.',
  'hour by hour', 'No hourly pattern yet.', 'Expected portions', 'portions', 'No item history yet.', 'By category', 'Things you know that history does not', 'A festival, a match night, a promotion, a planned closure. Tell FlowXP and it adjusts that day\'s forecast.',
  'Date', 'What is happening', 'e.g. Diwali weekend', 'Expected change %', 'Add', 'Remove', 'Dates are written like 2026-10-31', 'Say what is happening', 'Enter the expected change as a number', 'Event added, forecasts updated',
  'Order now', 'Order soon', 'OK', 'Suggested purchases', 'Missed by a fixed minimum', 'will run short before a delivery can arrive', 'within the next couple of days', 'at your latest prices', 'items a simple low-stock alert would not have caught',
  'Create draft orders for all', 'Creating…', 'Draft orders created. See Purchases.', 'Everything suggested is already on an open order.', 'Nothing needs ordering right now.', 'Nothing is ordered until you send it.', 'Every tracked item', 'in stock {v}', 'tomorrow {v}', '{n} days of cover', 'buy {v}',
  'Not enough usage history yet: forecasts start once an item has a week of use.', 'Projecting stock…', 'How this is made',
  // leakage
  'Revenue leakage', 'Activity that differs from your own normal and may be costing you money.', 'Only the owner and admins can see this page.', 'Checking your records…', 'Potential leakage detected', '1 open finding', '{n} open findings', '{n} needing attention',
  'Nothing unusual found in the last {n} days. FlowXP compares against your own normal, so this improves as your history grows.', 'Discounts', 'Cancellations', 'Refunds', 'Stock adjustments', 'Needs attention', 'Worth a look', 'For information', 'Confidence: {v}', 'Reviewed', 'Dismissed',
  'potential', 'Your normal', 'Difference', 'Suggested next step', 'Investigate', 'Hide details', 'Mark reviewed', 'Dismiss', 'Reopen', 'Add a note (optional)', 'Dismiss for 14 days', 'Reopened', 'Dismissed for 14 days', 'Marked reviewed', 'Show {n} reviewed or dismissed', 'Hide reviewed or dismissed',
  // kitchen performance
  'Kitchen performance', 'How long dishes take from being sent to being ready.', 'You need report access to see kitchen performance.', 'Reading the tickets…', 'No finished tickets in this period yet. Times are recorded from when an order is sent to the kitchen until the kitchen marks it ready.',
  'Average preparation', 'in the period before', 'no earlier period to compare', 'Slowest 1 in 10', '90% of items were ready by then', 'Ready on time', 'before', 'within each dish\'s set time', 'Items prepared', 'over {n} days', 'Getting slower', '{name} now averages {now} minutes, up from {before}.',
  'Worth asking: is it staffing at peak, a missing ingredient, a change to how it is made, or does the set time need updating?', 'By station', '{n} items', 'slowest 1 in 10: {v}', 'on time {pct}', 'Average time by hour sent', 'Busy hours usually run slower; a big gap here is a staffing question.',
  'By dish', 'Dishes with at least 3 finished items.', 'set time {v}',
  'What your sales leave after food cost, fees and commission', 'The week ahead, and what to buy for it', 'Unusual discounts, cancellations, refunds and wastage', 'How long dishes take'
];
