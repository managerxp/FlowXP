/*
 * The weekly summary: how last week went, as a notification every Monday morning (the business's own clock). It is worked out from the same
 * reports the Reports page shows (profit and loss, profit by item, GST by rate, low stock, money in and out), so the numbers in the
 * notification are the numbers behind the link. Plain arithmetic, no AI: it always arrives, and costs no Flow AI questions.
 *
 * It goes to everyone who can open Reports, through their own notification settings (in the app by default; email and phone if they chose).
 * One per person per week: the dedupe key is the week's first day, so re-running the scan, or a second server, adds nothing.
 */
import pool from '../config/database.js';
import { notify } from './notifications.js';
import { addDaysISO, businessToday } from '../utils/dates.js';
import * as profit from '../controllers/profitReports.controller.js';
import * as gst from '../controllers/gstReports.controller.js';
import * as stock from '../controllers/stockReports.controller.js';
import * as ledger from '../controllers/ledgerReports.controller.js';

const inr = (rupees) => `₹${Number(rupees).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/** The last full week (Monday to Sunday) before `today`, and the week before that. */
export const weekRanges = (today) => {
  const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;   // 0 = Monday
  const thisMonday = addDaysISO(today, -dow);
  const from = addDaysISO(thisMonday, -7);
  return { from, to: addDaysISO(thisMonday, -1), prevFrom: addDaysISO(from, -7), prevTo: addDaysISO(from, -1) };
};

/** Monday or Tuesday, from 8 am on the business's clock (Tuesday so a Monday the server was down still gets its summary). */
export const inWeeklyWindow = (timezone, now = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(now);
  const day = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value) % 24;
  return (day === 'Mon' || day === 'Tue') && hour >= 8;
};

/* run a report controller for the whole business and hand back its data */
const report = async (fn, businessId, query = {}) => {
  const res = { body: null, status() { return this; }, json(b) { this.body = b; return this; } };
  await fn({ tenant: { businessId, scopeBranchId: null, role: 'OWNER', permissions: {} }, query, params: {}, body: {}, headers: {} }, res);
  if (!res.body?.success) throw new Error(res.body?.message || 'report failed');
  return res.body.data;
};

/**
 * Pure: the notification for a week, or null when there was nothing to report.
 * `w` = { from, to, bills, net_sales, gross_profit, gross_margin_pct, total_expenses, net_profit, best_item, net_tax, low, out_of_stock, money_in, money_out }
 * `before` = the week before: { net_sales }
 */
export const weeklyAlert = (w, before, { gstOn = false } = {}) => {
  if (!w.bills) return null;
  const change = before?.net_sales > 0 ? Math.round(((w.net_sales - before.net_sales) / before.net_sales) * 100) : null;
  const lines = [
    `Net sales ${inr(w.net_sales)} from ${w.bills} ${w.bills === 1 ? 'bill' : 'bills'}${change != null ? `, ${change >= 0 ? 'up' : 'down'} ${Math.abs(change)}% on the week before` : ''}.`,
    `Gross profit ${inr(w.gross_profit)}${w.gross_margin_pct != null ? ` (${w.gross_margin_pct}% margin)` : ''}.`,
    w.total_expenses > 0 ? `Expenses ${inr(w.total_expenses)}, leaving ${inr(w.net_profit)}.` : null,
    w.best_item ? `Best item: ${w.best_item.name}, ${inr(w.best_item.profit)} profit.` : null,
    w.money_in > 0 || w.money_out > 0 ? `Money in ${inr(w.money_in)}, out ${inr(w.money_out)}.` : null,
    w.low > 0 ? `${w.low} ${w.low === 1 ? 'item is' : 'items are'} low on stock${w.out_of_stock ? ` (${w.out_of_stock} out)` : ''}.` : null,
    gstOn && w.net_tax > 0 ? `GST for the week: ${inr(w.net_tax)} to pay after input credit.` : null
  ].filter(Boolean);
  return {
    category: 'weekly', type: 'weekly_summary',
    severity: change != null && change >= 5 ? 'positive' : change != null && change <= -10 ? 'warning' : 'informational',
    title: `Last week: ${inr(w.net_sales)} in sales`, body: lines.join(' '),
    link: '/app/reports', dedupeKey: `weekly:${w.from}`, metadata: { from: w.from, to: w.to }
  };
};

/** Load last week for one business and notify. Returns how many people were told. */
export const scanWeekly = async (businessId) => {
  const today = await businessToday(businessId);
  const { from, to, prevFrom, prevTo } = weekRanges(today);
  const gstOn = Boolean((await pool.query('SELECT gst_enabled FROM businesses WHERE business_id = $1', [businessId])).rows[0]?.gst_enabled);
  const [pl, prev, items, tax, low, money] = await Promise.all([
    report(profit.profitLoss, businessId, { from, to }),
    report(profit.profitLoss, businessId, { from: prevFrom, to: prevTo }),
    report(profit.profitByItem, businessId, { from, to }),
    gstOn ? report(gst.rates, businessId, { from, to }) : null,
    report(stock.low, businessId),
    report(ledger.transactions, businessId, { from, to })
  ]);
  const alert = weeklyAlert({
    from, to, bills: pl.bills, net_sales: pl.net_sales, gross_profit: pl.gross_profit, gross_margin_pct: pl.gross_margin_pct, total_expenses: pl.total_expenses, net_profit: pl.net_profit,
    best_item: items.rows[0] && items.rows[0].profit > 0 ? { name: items.rows[0].name, profit: items.rows[0].profit } : null,
    net_tax: tax ? tax.totals.net_tax : 0, low: low.totals.items, out_of_stock: low.totals.out_of_stock,
    money_in: money.summary.money_in, money_out: money.summary.money_out
  }, { net_sales: prev.net_sales }, { gstOn });
  return alert ? notify(businessId, alert) : 0;
};

