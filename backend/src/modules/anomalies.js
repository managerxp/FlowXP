/*
 * Unusual-number alerts: each morning, yesterday's figures are set against the business's own recent pattern and anything out of line is
 * sent as a notification: a sales drop or spike against a typical day of the same weekday, a fall in margin, discounts well above the
 * usual rate, one big expense day, and items sold for less than they cost. Plain thresholds on plain arithmetic, no AI; every detector
 * says nothing unless the business has enough history for the comparison to mean something (so a new shop is not nagged).
 *
 * This is about the shape of the business as a whole, for every kind of business. Who gave the discounts, cancellations after payment,
 * refund patterns and wastage by person are the Leakage checks (modules/leakage.js), which stay as they are.
 *
 * Detectors are pure (numbers in, notification or null out) so they are unit-tested; scanAnomalies loads the numbers and notifies, once
 * per kind per day (the dedupe key carries the date).
 */
import pool from '../config/database.js';
import { notify } from './notifications.js';
import { profitability } from './profitability.js';
import { addDaysISO, businessToday } from '../utils/dates.js';

/* the thresholds, in one place */
export const LIMITS = {
  salesDrop: 0.4,            // 40% under a typical same weekday
  salesSpike: 0.6,           // 60% over
  minTypicalSales: 1000,     // rupees; below this a "typical day" is too small to compare against
  minWeekdays: 3,            // same weekdays with sales needed to call one typical
  marginDropPoints: 8,       // percentage points under the 28-day margin
  minBillsYesterday: 5, minBillsBaseline: 20,
  discountPct: 5, discountMultiple: 2, minDiscount: 500,
  expenseMultiple: 3, minExpense: 5000,
  belowCostMin: 100          // rupees lost on sub-cost lines
};

const inr = (rupees) => `₹${Number(rupees).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekdayOf = (date) => WEEKDAY[new Date(`${date}T00:00:00Z`).getUTCDay()];

const alert = (type, severity, date, title, body, link = '/app/reports') =>
  ({ category: 'unusual', type, severity, title, body, link, dedupeKey: `unusual:${type}:${date}`, metadata: { date } });

/** day = { date, sales, bills } in rupees; sameWeekday = sales on the previous same weekdays that had sales (rupees) */
export const salesAlert = (day, sameWeekday) => {
  if (sameWeekday.length < LIMITS.minWeekdays) return null;
  const typical = mean(sameWeekday);
  if (typical < LIMITS.minTypicalSales) return null;
  const change = (day.sales - typical) / typical;
  const name = weekdayOf(day.date);
  if (change <= -LIMITS.salesDrop) {
    return alert('sales_drop', 'warning', day.date, day.sales > 0 ? `Sales were down ${Math.round(-change * 100)}% on ${name}` : `No sales were recorded on ${name}`,
      `${day.sales > 0 ? `${inr(day.sales)} from ${day.bills} ${day.bills === 1 ? 'bill' : 'bills'}` : 'Nothing was billed'}, against about ${inr(typical)} on a typical ${name}.`);
  }
  if (change >= LIMITS.salesSpike && day.bills >= 3) {
    return alert('sales_spike', 'positive', day.date, `Sales were up ${Math.round(change * 100)}% on ${name}`, `${inr(day.sales)} from ${day.bills} bills, against about ${inr(typical)} on a typical ${name}.`);
  }
  return null;
};

/** day / base = { net, cogs, bills } in rupees (net sales before tax, cost of goods) */
export const marginAlert = (day, base, date) => {
  if (day.bills < LIMITS.minBillsYesterday || base.bills < LIMITS.minBillsBaseline || day.net <= 0 || base.net <= 0) return null;
  const now = ((day.net - day.cogs) / day.net) * 100; const usual = ((base.net - base.cogs) / base.net) * 100;
  if (usual - now < LIMITS.marginDropPoints) return null;
  return alert('margin_drop', 'warning', date, `Margin fell to ${Math.round(now)}% yesterday`,
    `Gross margin was ${Math.round(now)}% on ${inr(day.net)} of sales, against ${Math.round(usual)}% over the last four weeks. Check discounts and the prices items were sold at.`, '/app/reports');
};

/** day / base = { discount, gross, bills } in rupees (gross = goods value before any discount) */
export const discountAlert = (day, base, date) => {
  if (day.gross <= 0 || day.bills < LIMITS.minBillsYesterday || day.discount < LIMITS.minDiscount) return null;
  const now = (day.discount / day.gross) * 100; const usual = base.gross > 0 ? (base.discount / base.gross) * 100 : 0;
  if (now < LIMITS.discountPct || now < usual * LIMITS.discountMultiple) return null;
  return alert('discount_spike', 'warning', date, `Discounts were ${now.toFixed(1)}% of sales yesterday`,
    `${inr(day.discount)} was given off ${inr(day.gross)} of goods; the usual is ${usual.toFixed(1)}%.`, '/app/reports');
};

/** yesterday = { total, top: { category, amount } } in rupees; dailyTotals = the previous days' totals (zeros included) */
export const expenseAlert = (yesterday, dailyTotals, date) => {
  if (dailyTotals.length < 14) return null;
  const typical = mean(dailyTotals);
  if (yesterday.total < LIMITS.minExpense || yesterday.total < typical * LIMITS.expenseMultiple) return null;
  return alert('expense_spike', 'warning', date, `${inr(yesterday.total)} of expenses yesterday`,
    `Mostly ${yesterday.top.category} (${inr(yesterday.top.amount)}). A typical day is about ${inr(typical)}.`, '/app/expenses');
};

/** lines = [{ name, loss }] items sold for less than they cost yesterday (rupees lost on each) */
export const belowCostAlert = (lines, date) => {
  const loss = lines.reduce((s, l) => s + l.loss, 0);
  if (!lines.length || loss < LIMITS.belowCostMin) return null;
  const worst = [...lines].sort((a, b) => b.loss - a.loss).slice(0, 3).map((l) => l.name).join(', ');
  return alert('below_cost', 'warning', date, `${lines.length} ${lines.length === 1 ? 'item was' : 'items were'} sold below cost yesterday`,
    `${inr(loss)} lost in total. Worst: ${worst}. Check the selling prices and any discounts.`, '/app/reports');
};

/* ── loading the numbers ──────────────────────────────────────────────── */

const rup = (paise) => Number(paise) / 100;

/** Everything the detectors need for one business: yesterday, the 28 days before it, and the same weekdays. Returns the notifications to send. */
export const findAnomalies = async (businessId, today, db = pool) => {
  const date = addDaysISO(today, -1);                       // the last complete day
  const histFrom = addDaysISO(date, -35); const baseFrom = addDaysISO(date, -28); const baseTo = addDaysISO(date, -1);
  const p = await profitability(businessId, histFrom, date, db, null);
  const byDay = new Map(p.days.map((d) => [d.day.slice(0, 10), d]));
  const y = byDay.get(date);
  const out = [];

  // sales against the same weekday in the previous five weeks
  const sameWeekday = [];
  for (let k = 1; k <= 5; k++) { const d = byDay.get(addDaysISO(date, -7 * k)); if (d && d.net_revenue > 0) sameWeekday.push(rup(d.net_revenue)); }
  out.push(salesAlert({ date, sales: y ? rup(y.net_revenue) : 0, bills: y ? y.invoices : 0 }, sameWeekday));

  // margin and discount rate against the four weeks before yesterday
  const base = { net: 0, cogs: 0, discount: 0, bills: 0 };
  for (const d of p.days) { const k = d.day.slice(0, 10); if (k >= baseFrom && k <= baseTo) { base.net += rup(d.net_revenue); base.cogs += rup(d.cogs); base.discount += rup(d.discount); base.bills += d.invoices; } }
  if (y) {
    out.push(marginAlert({ net: rup(y.net_revenue), cogs: rup(y.cogs), bills: y.invoices }, base, date));
    out.push(discountAlert({ discount: rup(y.discount), gross: rup(y.net_revenue) + rup(y.discount), bills: y.invoices }, { discount: base.discount, gross: base.net + base.discount }, date));
  }

  // expenses: yesterday against the daily total over the 28 days before
  const ex = (await db.query(
    `SELECT expense_date::text AS d, category, SUM(amount_paise) AS paise FROM expenses WHERE business_id = $1 AND expense_date BETWEEN $2 AND $3 GROUP BY expense_date, category`,
    [businessId, baseFrom, date])).rows;
  const perDay = new Map();
  for (const r of ex) perDay.set(r.d, (perDay.get(r.d) || 0) + rup(r.paise));
  const yEx = ex.filter((r) => r.d === date).sort((a, b) => Number(b.paise) - Number(a.paise));
  const dailyTotals = []; for (let k = 1; k <= 28; k++) dailyTotals.push(perDay.get(addDaysISO(date, -k)) || 0);
  if (yEx.length) out.push(expenseAlert({ total: perDay.get(date), top: { category: yEx[0].category, amount: rup(yEx[0].paise) } }, dailyTotals, date));

  // items sold for less than they cost (the cost is the one recorded on the bill line)
  const low = (await db.query(
    `SELECT COALESCE(p.name, ii.description) AS name, SUM(ii.unit_cost_paise * ii.quantity - (ii.line_total_paise - ii.tax_amount_paise)) AS loss_paise
     FROM invoice_items ii JOIN invoices i ON i.invoice_id = ii.invoice_id LEFT JOIN products p ON p.product_id = ii.product_id
     WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date = $2 AND ii.unit_cost_paise > 0 AND ii.unit_cost_paise * ii.quantity > (ii.line_total_paise - ii.tax_amount_paise)
     GROUP BY COALESCE(p.name, ii.description)`, [businessId, date])).rows;
  out.push(belowCostAlert(low.map((r) => ({ name: r.name, loss: rup(r.loss_paise) })), date));

  return out.filter(Boolean);
};

/** Load, detect and notify for one business. Returns how many people were told in all. */
export const scanAnomalies = async (businessId) => {
  let sent = 0;
  for (const a of await findAnomalies(businessId, await businessToday(businessId))) sent += await notify(businessId, a);
  return sent;
};
