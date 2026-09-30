/*
 * Demand forecasting and predictive stock.
 *
 * The method is deliberately plain and explainable: a weighted average of the
 * same weekday over the last 8 weeks (recent weeks count more), scaled by the
 * recent trend, shown with a typical range. It is not machine learning, and the
 * page says how it was made and how accurate it has been on the last two weeks.
 * A forecast is a prediction, never a fact.
 *
 * Everything here that does arithmetic is pure and unit-tested. collect*() run
 * the queries and feed it. Days the business was closed are simply absent from
 * the history; a day with no sales at all is treated as closed.
 *
 * ponytail: computed on read from at most 12 weeks of history. Persist daily
 * forecasts and precompute overnight when a business is large enough for the
 * queries to matter, or when tracking forecast-vs-actual over time is wanted.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { businessToday } from '../utils/dates.js';

export const METHOD = 'Weighted average of the same weekday over the last 8 weeks, adjusted for the recent trend.';
const DAY = 86400000;

const parse = (d) => new Date(`${d}T00:00:00Z`);
export const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (d, n) => iso(new Date(parse(d).getTime() + n * DAY));
const weekday = (d) => parse(d).getUTCDay();

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const sd = (xs) => { if (xs.length < 2) return 0; const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); };

/**
 * Predict one day's value from a history of { date, value } (open days only).
 * @returns null when there are fewer than 3 comparable weekdays to learn from.
 */
export const predictDay = (history, target, { weeks = 8, multiplier = 1 } = {}) => {
  const from = addDays(target, -weeks * 7);
  const same = history.filter((h) => h.date < target && h.date >= from && weekday(h.date) === weekday(target));
  if (same.length < 3) return null;

  // Most recent first gets the biggest weight.
  const sorted = [...same].sort((a, b) => b.date.localeCompare(a.date));
  const weights = sorted.map((_, i) => sorted.length - i);
  const wsum = weights.reduce((s, w) => s + w, 0);
  const base = sorted.reduce((s, h, i) => s + h.value * weights[i], 0) / wsum;

  // Trend: how the last 14 days compare with the 28 before them, once each day is measured against its own
  // weekday's average (so a week with a missing Saturday doesn't look like a decline). Clamped.
  const window = history.filter((h) => h.date < target && h.date >= addDays(target, -42));
  const dayMean = new Map();
  for (let d = 0; d < 7; d++) { const xs = window.filter((h) => weekday(h.date) === d).map((h) => h.value); if (xs.length) dayMean.set(d, mean(xs)); }
  const relative = (h) => (dayMean.get(weekday(h.date)) > 0 ? h.value / dayMean.get(weekday(h.date)) : 1);
  const recent = window.filter((h) => h.date >= addDays(target, -14)).map(relative);
  const older = window.filter((h) => h.date < addDays(target, -14)).map(relative);
  const trend = recent.length >= 7 && older.length >= 14 && mean(older) > 0 ? Math.min(1.15, Math.max(0.9, mean(recent) / mean(older))) : 1;

  const values = sorted.map((h) => h.value);
  const m = mean(values);
  const spread = sd(values);
  const cv = m > 0 ? spread / m : 1;
  const predicted = base * trend * multiplier;
  const band = spread * trend * multiplier;

  return {
    predicted, low: Math.max(0, predicted - band), high: predicted + band,
    samples: same.length, trend: Math.round(trend * 1000) / 1000,
    confidence: same.length >= 6 && cv < 0.35 ? 'high' : same.length >= 4 && cv < 0.6 ? 'medium' : 'low'
  };
};

/** How wrong would this method have been on each of the last `days` days, using only what was known then? */
export const backtest = (history, days = 14) => {
  const dates = history.map((h) => h.date).sort().slice(-days);
  const errors = []; let bias = 0;
  for (const date of dates) {
    const actual = history.find((h) => h.date === date).value;
    const p = predictDay(history.filter((h) => h.date < date), date);
    if (!p || actual <= 0) continue;
    errors.push(Math.abs(p.predicted - actual) / actual);
    bias += (p.predicted - actual) / actual;
  }
  if (errors.length < 3) return null;
  return { days: errors.length, mape_pct: Math.round(mean(errors) * 1000) / 10, bias_pct: Math.round((bias / errors.length) * 1000) / 10 };
};

/** Combine event multipliers falling on the same date. */
export const multiplierFor = (events, date) => events.filter((e) => e.event_date === date).reduce((m, e) => m * Number(e.multiplier), 1);

/**
 * Stock planning for one item. Demand arrays are per-day, starting tomorrow.
 * @param stock       current stock
 * @param demand      predicted usage for tomorrow, the day after, ...
 * @param sigma       day-to-day standard deviation of actual usage
 * @param leadDays    days for a supplier delivery to arrive
 * @param coverDays   how many days beyond delivery one purchase should last
 */
export const planStock = ({ stock, minStock = 0, demand, sigma, leadDays, coverDays = 3, step = 1 }) => {
  const lead = Math.max(0, leadDays);
  const sum = (a, b) => demand.slice(a, b).reduce((s, x) => s + x, 0);
  const safety = 1.65 * sigma * Math.sqrt(Math.max(1, lead));   // ~95% service level
  const duringLead = sum(0, Math.max(1, lead));
  const reorderPoint = duringLead + safety;

  let running = stock; let stockoutDay = null;
  for (let i = 0; i < demand.length; i++) {
    running -= demand[i];
    if (running < 0 && stockoutDay == null) stockoutDay = i + 1;
  }
  const avgDemand = mean(demand.slice(0, 7));

  let status = 'OK';
  if (stock <= reorderPoint) status = 'ORDER_NOW';
  else if (stock <= reorderPoint + sum(Math.max(1, lead), Math.max(1, lead) + 2)) status = 'ORDER_SOON';

  const target = sum(0, Math.max(1, lead) + coverDays) + safety;
  const raw = Math.max(0, target - stock);
  const recommended = status === 'OK' ? 0 : Math.ceil(raw / step - 1e-9) * step;

  return {
    status, safety_stock: safety, reorder_point: reorderPoint, demand_during_lead: duringLead,
    days_of_cover: avgDemand > 0 ? Math.round((stock / avgDemand) * 10) / 10 : null,
    stockout_in_days: stockoutDay, recommended_qty: recommended,
    below_static_min: stock <= minStock
  };
};

/** Round-up step for a purchase quantity by unit: pieces in whole numbers, weights in halves. */
export const stepFor = (unit) => (['pc', 'pack', 'box', 'dozen', 'bottle'].includes(String(unit).toLowerCase()) ? 1 : 0.5);

/** Build a per-date series from rows, filling zeros for open days with no rows. */
export const toSeries = (rows, openDates) => {
  const byDate = new Map(rows.map((r) => [String(r.date), Number(r.value)]));
  return openDates.map((date) => ({ date, value: byDate.get(date) || 0 }));
};

/** Hour-of-day shares for a weekday from { date, hour, n } rows. */
export const hourShares = (rows, targetDate, weeks = 8) => {
  const from = addDays(targetDate, -weeks * 7);
  const same = rows.filter((r) => String(r.date) < targetDate && String(r.date) >= from && weekday(String(r.date)) === weekday(targetDate));
  const total = same.reduce((s, r) => s + Number(r.n), 0);
  if (!total) return [];
  const byHour = new Map();
  for (const r of same) byHour.set(Number(r.hour), (byHour.get(Number(r.hour)) || 0) + Number(r.n));
  return [...byHour].map(([hour, n]) => ({ hour, share: n / total })).sort((a, b) => a.hour - b.hour);
};

/* ── data ─────────────────────────────────────────────────────────────────── */

const HISTORY_DAYS = 84;

const tzOf = async (businessId, db) => (await db.query(`SELECT timezone FROM businesses WHERE business_id = $1`, [businessId])).rows[0]?.timezone || 'Asia/Kolkata';

export const loadEvents = async (businessId, from, to, db = pool) =>
  (await db.query(`SELECT event_id, event_date::text AS event_date, label, multiplier FROM demand_events WHERE business_id = $1 AND event_date BETWEEN $2 AND $3 ORDER BY event_date`, [businessId, from, to])).rows
    .map((e) => ({ ...e, multiplier: Number(e.multiplier) }));

/** Business-level daily orders and revenue; open days are the days with at least one sale. */
export const loadDaily = async (businessId, asOf, db = pool, branchId = null) => {
  const rows = (await db.query(
    `SELECT invoice_date::text AS date, COUNT(*)::int AS orders, COALESCE(SUM(total_paise),0) AS revenue
     FROM invoices WHERE business_id = $1 AND status = 'ISSUED' AND invoice_date >= $2::date - $3::int AND invoice_date < $2::date${branchId != null ? ' AND branch_id = $4' : ''}
     GROUP BY 1 ORDER BY 1`, branchId != null ? [businessId, asOf, HISTORY_DAYS, branchId] : [businessId, asOf, HISTORY_DAYS])).rows;
  return {
    openDates: rows.map((r) => r.date),
    orders: rows.map((r) => ({ date: r.date, value: r.orders })),
    revenue: rows.map((r) => ({ date: r.date, value: Number(r.revenue) }))
  };
};

/** Per-dish quantities sold per open day. */
export const loadItemSeries = async (businessId, asOf, openDates, db = pool, branchId = null) => {
  const rows = (await db.query(
    `SELECT ii.product_id, p.name, COALESCE(c.name, 'Menu') AS category, i.invoice_date::text AS date, SUM(ii.quantity) AS value
     FROM invoice_items ii JOIN invoices i ON i.invoice_id = ii.invoice_id JOIN products p ON p.product_id = ii.product_id
     LEFT JOIN categories c ON c.category_id = p.category_id
     WHERE i.business_id = $1 AND i.status = 'ISSUED' AND p.kind = 'DISH' AND i.invoice_date >= $2::date - $3::int AND i.invoice_date < $2::date${branchId != null ? ' AND i.branch_id = $4' : ''}
     GROUP BY 1,2,3,4`, branchId != null ? [businessId, asOf, HISTORY_DAYS, branchId] : [businessId, asOf, HISTORY_DAYS])).rows;
  const byItem = new Map();
  for (const r of rows) {
    if (!byItem.has(r.product_id)) byItem.set(r.product_id, { product_id: r.product_id, name: r.name, category: r.category, rows: [] });
    byItem.get(r.product_id).rows.push(r);
  }
  return [...byItem.values()].map((it) => ({ ...it, series: toSeries(it.rows, openDates) }));
};

/** Stock actually used per day (sales, cancellations and wastage), for every tracked product. */
export const loadUsageSeries = async (businessId, asOf, openDates, db = pool, branchId = null) => {
  const tz = await tzOf(businessId, db);
  // For one outlet: its own stock and only its own movements.
  const stockExpr = branchId != null ? 'COALESCE(bs.quantity, 0)' : 'p.current_stock';
  const stockJoin = branchId != null ? 'LEFT JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = $5' : '';
  const rows = (await db.query(
    `SELECT p.product_id, p.name, p.unit, p.kind, ${stockExpr} AS current_stock, p.min_stock, p.purchase_price_paise, p.lead_time_days, p.supplier_id, s.name AS supplier_name,
            ((t.created_at AT TIME ZONE $4)::date)::text AS date, SUM(-t.quantity) AS value
     FROM inventory_transactions t JOIN products p ON p.product_id = t.product_id LEFT JOIN suppliers s ON s.supplier_id = p.supplier_id ${stockJoin}
     WHERE t.business_id = $1 ${branchId != null ? 'AND t.branch_id = $5' : ''} AND p.track_inventory AND p.status = 'ACTIVE'
       AND ((t.transaction_type IN ('SALE','RETURN') AND t.reference_type = 'invoice') OR t.transaction_type = 'WASTAGE')
       AND (t.created_at AT TIME ZONE $4)::date >= $2::date - $3::int AND (t.created_at AT TIME ZONE $4)::date < $2::date
     GROUP BY 1,2,3,4,5,6,7,8,9,10,11`, branchId != null ? [businessId, asOf, HISTORY_DAYS, tz, branchId] : [businessId, asOf, HISTORY_DAYS, tz])).rows;
  const byProduct = new Map();
  for (const r of rows) {
    if (!byProduct.has(r.product_id)) byProduct.set(r.product_id, { ...r, rows: [] });
    byProduct.get(r.product_id).rows.push(r);
  }
  return [...byProduct.values()].map((p) => ({ ...p, series: toSeries(p.rows, openDates) }));
};

export const loadHourly = async (businessId, asOf, db = pool, branchId = null) => {
  const tz = await tzOf(businessId, db);
  return (await db.query(
    `SELECT invoice_date::text AS date, EXTRACT(HOUR FROM created_at AT TIME ZONE $4)::int AS hour, COUNT(*)::int AS n
     FROM invoices WHERE business_id = $1 AND status = 'ISSUED' AND invoice_date >= $2::date - $3::int AND invoice_date < $2::date${branchId != null ? ' AND branch_id = $5' : ''} GROUP BY 1,2`,
    branchId != null ? [businessId, asOf, HISTORY_DAYS, tz, branchId] : [businessId, asOf, HISTORY_DAYS, tz])).rows;
};

const round3 = (n) => Math.round(n * 1000) / 1000;

/** Projected stock for every tracked item with enough usage history, plus purchase suggestions by supplier. */
export const buildInventoryForecast = async (id, db = pool, branchId = null) => {
  const asOf = await businessToday(id, db);
  const [daily, events] = await Promise.all([loadDaily(id, asOf, db, branchId), loadEvents(id, addDays(asOf, 1), addDays(asOf, 14))]);
  const usage = await loadUsageSeries(id, asOf, daily.openDates, db, branchId);

  const rows = [];
  for (const p of usage) {
    const active = p.series.filter((s) => s.value > 0).length;
    if (active < 7) continue;
    const last14 = p.series.slice(-14).map((s) => s.value);
    const demand = [];
    let confidence = 'low';
    for (let i = 1; i <= 14; i++) {
      const date = addDays(asOf, i);
      const m = multiplierFor(events, date);
      const pred = predictDay(p.series, date, { multiplier: m });
      if (i === 1 && pred) confidence = pred.confidence;
      demand.push(Math.max(0, pred ? pred.predicted : (last14.reduce((s, x) => s + x, 0) / last14.length) * m));
    }
    const last28 = p.series.slice(-28).map((s) => s.value);
    const mean28 = last28.reduce((s, x) => s + x, 0) / last28.length;
    const sigma = Math.sqrt(last28.reduce((s, x) => s + (x - mean28) ** 2, 0) / Math.max(1, last28.length - 1));

    const stock = Number(p.current_stock);
    const plan = planStock({ stock, minStock: Number(p.min_stock), demand, sigma, leadDays: Number(p.lead_time_days), step: stepFor(p.unit) });
    const cost = Number(p.purchase_price_paise);
    rows.push({
      product_id: p.product_id, name: p.name, unit: p.unit, kind: p.kind, supplier_id: p.supplier_id, supplier_name: p.supplier_name,
      current_stock: round3(stock), static_min_stock: round3(Number(p.min_stock)), lead_time_days: Number(p.lead_time_days),
      tomorrow_need: round3(demand[0]), next_7_days_need: round3(demand.slice(0, 7).reduce((s, x) => s + x, 0)),
      days_of_cover: plan.days_of_cover, stockout_in_days: plan.stockout_in_days,
      safety_stock: round3(plan.safety_stock), reorder_point: round3(plan.reorder_point),
      status: plan.status, below_static_min: plan.below_static_min,
      recommended_qty: round3(plan.recommended_qty), unit_cost: toRupees(cost), estimated_cost: toRupees(Math.round(plan.recommended_qty * cost)),
      confidence
    });
  }
  const order = { ORDER_NOW: 0, ORDER_SOON: 1, OK: 2 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (a.days_of_cover ?? 99) - (b.days_of_cover ?? 99));

  const buy = rows.filter((r) => r.recommended_qty > 0);
  const suppliers = new Map();
  for (const r of buy) {
    const key = r.supplier_id ?? 0;
    if (!suppliers.has(key)) suppliers.set(key, { supplier_id: r.supplier_id, supplier_name: r.supplier_name || 'No supplier set', items: [], total: 0 });
    const g = suppliers.get(key);
    g.items.push({ product_id: r.product_id, name: r.name, unit: r.unit, quantity: r.recommended_qty, unit_cost: r.unit_cost });
    g.total += r.estimated_cost;
  }


  return {
      is_prediction: true, method: `${METHOD} Reorder point = expected use while a delivery arrives + safety stock (95% service level).`,
      as_of: asOf,
      summary: {
        order_now: rows.filter((r) => r.status === 'ORDER_NOW').length, order_soon: rows.filter((r) => r.status === 'ORDER_SOON').length,
        estimated_cost: Math.round(buy.reduce((s, r) => s + r.estimated_cost, 0) * 100) / 100,
        flagged_only_by_prediction: rows.filter((r) => r.status !== 'OK' && !r.below_static_min).length
      },
      items: rows,
      by_supplier: [...suppliers.values()].map((g) => ({ ...g, total: Math.round(g.total * 100) / 100 }))
  };
};
