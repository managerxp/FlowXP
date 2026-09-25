/*
 * The recurring checks that turn what FlowXP already knows into notifications:
 * items about to run out, unusual activity, the evening summary, the trial
 * clock. Each has two halves: a pure mapper from data to notification payloads
 * (unit-tested), and a scan that loads the data for one business and notifies.
 *
 * Scans run from the worker every few hours, claim their slot atomically in
 * scan_state (so two API processes don't both run one), and rely on dedupe
 * keys so the same condition produces one notification per period however
 * many times it is re-checked. A failing scan is logged and skipped; it never
 * touches a request.
 */
import pool from '../config/database.js';
import { buildInventoryForecast } from './forecast.js';
import { currentFindings } from './leakage.js';
import { profitability } from './profitability.js';
import { subscriptionSummary } from './subscription.js';
import { notify } from './notifications.js';
import { registerScan } from './jobs.js';
import { addDaysISO, businessToday } from '../utils/dates.js';
import { toRupees } from '../utils/money.js';

const inr = (paise) => `₹${toRupees(Math.round(paise)).toLocaleString('en-IN')}`;
const isoWeek = (date) => {   // "2026-W39": one leakage nudge per finding per week
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const week1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return `${d.getUTCFullYear()}-W${String(1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) / 7)).padStart(2, '0')}`;
};

/* ── mappers ──────────────────────────────────────────────────────────────── */

const MAX_STOCK_ALERTS = 8;

/** Items that will run short, most urgent first. Payloads are for notify(). */
export const stockAlerts = (forecast, today) => {
  const out = [];
  for (const i of forecast.items) {
    if (i.status === 'OK') continue;
    const urgent = i.status === 'ORDER_NOW';
    out.push({
      category: 'stock', type: urgent ? 'order_now' : 'order_soon', severity: urgent ? 'critical' : 'warning',
      title: urgent ? `${i.name} will run short` : `${i.name} needs ordering soon`,
      body: `${i.current_stock} ${i.unit} in stock, about ${i.tomorrow_need} ${i.unit} needed tomorrow. ${i.recommended_qty > 0 ? `Suggested order: ${i.recommended_qty} ${i.unit}.` : ''}`.trim(),
      link: '/app/forecast?tab=stock',
      dedupeKey: `stock:${i.product_id}:${i.status}:${today}`,
      metadata: { product_id: i.product_id, status: i.status }
    });
  }
  const shown = out.slice(0, MAX_STOCK_ALERTS);
  if (out.length > shown.length) {
    shown.push({
      category: 'stock', type: 'order_many', severity: 'warning', title: `${out.length - shown.length} more items need ordering`,
      body: 'Open the forecast to see everything that is running low.', link: '/app/forecast?tab=stock', dedupeKey: `stock:more:${today}`, metadata: {}
    });
  }
  return shown;
};

/** Open findings worth interrupting someone for, once a week each. */
export const leakageAlerts = (findings, today) =>
  findings
    .filter((f) => f.status === 'OPEN' && (f.severity === 'critical' || (f.severity === 'warning' && f.potential_paise > 0)))
    .map((f) => ({
      category: 'leakage', type: f.type, severity: f.severity === 'critical' ? 'critical' : 'warning', title: f.title,
      body: `${f.summary}${f.potential_paise > 0 ? ` Potential: ${inr(f.potential_paise)}.` : ''}`,
      link: '/app/leakage', dedupeKey: `leakage:${f.fingerprint}:${isoWeek(today)}`, metadata: { fingerprint: f.fingerprint }
    }));

/**
 * Orders still in the kitchen well past the time their dishes should take. rows are lines still being made:
 * { order_id, order_number, table_name, elapsed_minutes, expected_minutes }. One alert per order, ever.
 */
export const lateAlerts = (rows, graceMinutes = 5) => {
  const byOrder = new Map();
  for (const r of rows) {
    const over = Number(r.elapsed_minutes) - Number(r.expected_minutes);
    if (!(over >= graceMinutes)) continue;
    const cur = byOrder.get(r.order_id);
    if (!cur || over > cur.over) byOrder.set(r.order_id, { ...r, over, lines: (cur?.lines || 0) + 1 });
    else cur.lines += 1;
  }
  return [...byOrder.values()].map((o) => ({
    category: 'kitchen', type: 'order_late', severity: 'warning',
    title: `${o.order_number}${o.table_name ? ` (${o.table_name})` : ''} is running late`,
    body: `${o.lines} ${o.lines === 1 ? 'item has' : 'items have'} been in the kitchen for ${o.elapsed_minutes} minutes; the slowest was expected in ${o.expected_minutes}.`,
    link: '/app/kitchen', dedupeKey: `late:${o.order_id}`, metadata: { order_id: o.order_id }
  }));
};

/** The evening summary; compares with the same weekday last week. */
export const summaryAlert = (today, totals, lastWeek) => {
  if (!totals.invoices) return null;
  const change = lastWeek?.net_revenue > 0 ? Math.round(((totals.net_revenue - lastWeek.net_revenue) / lastWeek.net_revenue) * 100) : null;
  return {
    category: 'sales', type: 'daily_summary', severity: change != null && change >= 5 ? 'positive' : 'informational',
    title: `Today: ${inr(totals.net_revenue)} from ${totals.invoices} orders`,
    body: [
      change != null ? `${change >= 0 ? 'Up' : 'Down'} ${Math.abs(change)}% on the same day last week.` : null,
      totals.food_cost_pct != null ? `Food cost ${totals.food_cost_pct}% of revenue.` : null,
      `Contribution ${inr(totals.contribution)} before rent and salaries.`
    ].filter(Boolean).join(' '),
    link: '/app/profitability', dedupeKey: `summary:${today}`, metadata: { date: today }
  };
};

/** Orders sent to a supplier that should have arrived by now. rows: [{ po_id, po_number, supplier_name, expected_date, days_late }] */
export const overdueOrderAlerts = (rows) => rows.map((r) => ({
  category: 'stock', type: 'order_overdue', severity: 'warning',
  title: `Order ${r.po_number} is ${r.days_late} ${r.days_late === 1 ? 'day' : 'days'} late`,
  body: `${r.supplier_name || 'The supplier'} was due to deliver by ${r.expected_date}. Call them, or receive it if it has arrived.`,
  link: '/app/purchases', dedupeKey: `po_overdue:${r.po_id}:${r.days_late}`, metadata: { po_id: r.po_id }
}));

/** Trial clock. `summary` is subscriptionSummary(). */
export const accountAlerts = (summary, today) => {
  if (summary.status === 'EXPIRED') {
    return [{ category: 'account', type: 'trial_expired', severity: 'critical', title: 'Your free trial has ended',
      body: 'Your data is safe and readable. Choose a plan to keep billing.', link: '/app/settings/subscription', dedupeKey: `trial_expired:${isoWeek(today)}`, metadata: {} }];
  }
  if (summary.status === 'TRIAL' && summary.trial_ends_at && summary.trial_days_remaining <= 2) {
    const d = summary.trial_days_remaining;
    return [{ category: 'account', type: 'trial_ending', severity: 'warning', title: `${d} ${d === 1 ? 'day' : 'days'} left in your trial`,
      body: 'Choose a plan before it ends so billing carries on without a break.', link: '/app/settings/subscription', dedupeKey: `trial_ending:${today}`, metadata: {} }];
  }
  return [];
};

/** A delivery-platform order that could not be received. One per platform per hour, however many retries the platform sends. */
export const integrationAlert = (platform, detail, now = new Date()) => ({
  category: 'integrations', type: 'webhook_failed', severity: 'warning', title: `A ${platform[0] + platform.slice(1).toLowerCase()} order could not be received`,
  body: `${detail || 'The order was rejected.'} Check the integration settings, or ask the platform to resend.`, link: '/app/integrations',
  dedupeKey: `webhook:${platform}:${now.toISOString().slice(0, 13)}`, metadata: { platform }
});

/* ── scans (load data, then notify) ───────────────────────────────────────── */

/** Tag an outlet-level alert so it is deduped per outlet, says which outlet, and reaches only that outlet's people. */
const forOutlet = (alert, outlet, several) => ({
  ...alert, branchId: outlet.branch_id,
  ...(several ? { title: `${alert.title} — ${outlet.name}`.slice(0, 160), dedupeKey: alert.dedupeKey && `${alert.dedupeKey}:b${outlet.branch_id}` } : {})
});

const activeOutlets = async (businessId) =>
  (await pool.query(`SELECT branch_id, name FROM branches WHERE business_id = $1 AND status = 'ACTIVE' ORDER BY is_primary DESC, branch_id`, [businessId])).rows;

/* Stock is per outlet, so each outlet is forecast and alerted separately. */
export const scanStock = async (businessId) => {
  const today = await businessToday(businessId);
  const outlets = await activeOutlets(businessId);
  let sent = 0;
  for (const outlet of outlets) {
    for (const alert of stockAlerts(await buildInventoryForecast(businessId, pool, outlet.branch_id), today)) {
      sent += await notify(businessId, forOutlet(alert, outlet, outlets.length > 1));
    }
    const late = (await pool.query(
      `SELECT po.po_id, po.po_number, s.name AS supplier_name, po.expected_date::text AS expected_date, (${'$2'}::date - po.expected_date)::int AS days_late
       FROM purchase_orders po LEFT JOIN suppliers s ON s.supplier_id = po.supplier_id
       WHERE po.business_id = $1 AND po.branch_id = $3 AND po.status = 'ORDERED' AND po.expected_date < $2::date`, [businessId, today, outlet.branch_id])).rows;
    for (const alert of overdueOrderAlerts(late)) sent += await notify(businessId, forOutlet(alert, outlet, outlets.length > 1));
  }
  return sent;
};

export const scanLeakage = async (businessId) => {
  const today = await businessToday(businessId);
  const { findings } = await currentFindings(businessId, addDaysISO(today, -29), today);
  let sent = 0;
  for (const alert of leakageAlerts(findings, today)) sent += await notify(businessId, alert);
  return sent;
};

export const scanSummary = async (businessId) => {
  const today = await businessToday(businessId);
  const [now, before] = await Promise.all([profitability(businessId, today, today), profitability(businessId, addDaysISO(today, -7), addDaysISO(today, -7))]);
  const alert = summaryAlert(today, now.totals, before.totals);
  return alert ? notify(businessId, alert) : 0;
};

export const scanKitchen = async (businessId) => {
  const { rows } = await pool.query(
    `SELECT o.order_id, o.order_number, o.branch_id, t.name AS table_name,
            FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - oi.sent_at)) / 60)::int AS elapsed_minutes, oi.expected_minutes
     FROM order_items oi JOIN orders o ON o.order_id = oi.order_id LEFT JOIN dining_tables t ON t.table_id = o.table_id
     WHERE o.business_id = $1 AND oi.status = 'PREPARING' AND oi.sent_at > CURRENT_TIMESTAMP - interval '6 hours' AND oi.expected_minutes IS NOT NULL`,
    [businessId]
  );
  const outlets = await activeOutlets(businessId);
  let sent = 0;
  for (const outlet of outlets) {
    for (const alert of lateAlerts(rows.filter((r) => r.branch_id === outlet.branch_id))) sent += await notify(businessId, forOutlet(alert, outlet, outlets.length > 1));
  }
  return sent;
};

export const scanAccount = async (businessId) => {
  const { rows } = await pool.query(`SELECT * FROM businesses WHERE business_id = $1`, [businessId]);
  if (!rows[0]) return 0;
  let sent = 0;
  for (const alert of accountAlerts(subscriptionSummary(rows[0]), await businessToday(businessId))) sent += await notify(businessId, alert);
  return sent;
};

/* ── scheduling ───────────────────────────────────────────────────────────── */

const RESTAURANT = ['RESTAURANT', 'CAFE', 'GAMING_CAFE', 'RACING'];

export const localHour = (timezone, now = new Date()) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: 'numeric', hour12: false }).format(now)) % 24;

/** Claim this business's slot for a scan; true only for the one process that gets it. */
export const claim = async (businessId, scan, everyMinutes) =>
  (await pool.query(
    `INSERT INTO scan_state (business_id, scan, last_run_at) VALUES ($1,$2,CURRENT_TIMESTAMP)
     ON CONFLICT (business_id, scan) DO UPDATE SET last_run_at = CURRENT_TIMESTAMP
       WHERE scan_state.last_run_at <= CURRENT_TIMESTAMP - ($3 || ' minutes')::interval
     RETURNING business_id`, [businessId, scan, String(everyMinutes)])).rowCount > 0;

const SCANS = [
  { name: 'kitchen', every: 5, restaurantOnly: true, run: scanKitchen },
  { name: 'stock', every: 180, restaurantOnly: true, run: scanStock },
  { name: 'leakage', every: 360, restaurantOnly: true, run: scanLeakage },
  { name: 'account', every: 360, restaurantOnly: false, run: scanAccount },
  // After 9:30 pm local, checked often so it goes out soon after close; dedupe keeps it to once a day.
  { name: 'summary', every: 30, restaurantOnly: true, run: scanSummary, when: (b) => localHour(b.timezone) * 60 + new Date().getMinutes() >= 21 * 60 + 30 }
];

export const runScheduledScans = async () => {
  const businesses = (await pool.query(`SELECT business_id, business_type, timezone FROM businesses WHERE status = 'ACTIVE'`)).rows;
  for (const b of businesses) {
    for (const scan of SCANS) {
      if (scan.restaurantOnly && !RESTAURANT.includes(b.business_type)) continue;
      if (scan.when && !scan.when(b)) continue;
      if (!(await claim(b.business_id, scan.name, scan.every))) continue;
      try { await scan.run(b.business_id); }
      catch (error) { console.error(`[scan:${scan.name}] business ${b.business_id} failed:`, error.message); }
    }
  }
};

let lastCleanup = 0;
const cleanup = async () => {
  if (Date.now() - lastCleanup < 6 * 3600 * 1000) return;
  lastCleanup = Date.now();
  await pool.query(`DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < CURRENT_TIMESTAMP - interval '60 days'`);
  await pool.query(`DELETE FROM jobs WHERE status = 'DONE' AND finished_at < CURRENT_TIMESTAMP - interval '14 days'`);
};

registerScan(runScheduledScans);
registerScan(cleanup);
