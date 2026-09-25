/*
 * Forecast endpoints. Predictions are labelled as predictions, ranges are
 * shown next to point values, and the method and its recent accuracy travel
 * with every response so the UI never presents a guess as a fact.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { toRupees } from '../utils/money.js';
import { businessToday } from '../utils/dates.js';
import {
  METHOD, addDays, backtest, hourShares, loadDaily, loadEvents, loadHourly, loadItemSeries, loadUsageSeries,
  multiplierFor, predictDay, buildInventoryForecast
} from '../modules/forecast.js';

const round1 = (n) => Math.round(n * 10) / 10;
const round3 = (n) => Math.round(n * 1000) / 1000;

const today = businessToday;

const range = (p) => p && { predicted: round1(p.predicted), low: round1(p.low), high: round1(p.high) };

/* GET /api/forecast?horizon=7&focus=YYYY-MM-DD */
export const demand = async (req, res) => {
  const id = req.tenant.businessId;
  const horizon = Math.min(14, Math.max(1, Number(req.query.horizon) || 7));
  const asOf = await today(id);
  const focus = req.query.focus || addDays(asOf, 1);
  if (focus <= asOf || focus > addDays(asOf, 14)) return res.status(400).json({ success: false, message: 'Pick a day within the next 14 days' });

  const branch = req.tenant.scopeBranchId ?? null;
  const [daily, hourly, events] = await Promise.all([loadDaily(id, asOf, pool, branch), loadHourly(id, asOf, pool, branch), loadEvents(id, addDays(asOf, 1), addDays(asOf, 14))]);
  const items = await loadItemSeries(id, asOf, daily.openDates, pool, branch);

  const days = [];
  for (let i = 1; i <= horizon; i++) {
    const date = addDays(asOf, i);
    const m = multiplierFor(events, date);
    const orders = predictDay(daily.orders, date, { multiplier: m });
    const revenue = predictDay(daily.revenue, date, { multiplier: m });
    days.push({
      date, weekday: new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
      orders: range(orders),
      revenue: revenue && { predicted: toRupees(Math.round(revenue.predicted)), low: toRupees(Math.round(revenue.low)), high: toRupees(Math.round(revenue.high)) },
      confidence: orders?.confidence ?? null, samples: orders?.samples ?? 0,
      events: events.filter((e) => e.event_date === date).map((e) => ({ event_id: e.event_id, label: e.label, multiplier: e.multiplier })),
      insufficient_data: !orders
    });
  }

  const focusMultiplier = multiplierFor(events, focus);
  const focusOrders = predictDay(daily.orders, focus, { multiplier: focusMultiplier });
  const shares = hourShares(hourly, focus);
  const itemForecasts = items.map((it) => ({ it, p: predictDay(it.series, focus, { multiplier: focusMultiplier }) })).filter((x) => x.p)
    .sort((a, b) => b.p.predicted - a.p.predicted);
  const byCategory = new Map();
  for (const { it, p } of itemForecasts) {
    // Dishes vary independently, so their uncertainties add in quadrature, not linearly.
    const c = byCategory.get(it.category) || { category: it.category, predicted: 0, variance: 0 };
    c.predicted += p.predicted; c.variance += ((p.high - p.low) / 2) ** 2;
    byCategory.set(it.category, c);
  }

  res.json({
    success: true,
    data: {
      is_prediction: true, method: METHOD, as_of: asOf, history_days: daily.openDates.length,
      accuracy: { orders: backtest(daily.orders), revenue: backtest(daily.revenue) },
      daily: days,
      focus: {
        date: focus, orders: range(focusOrders),
        hourly: focusOrders ? shares.map((s) => ({ hour: s.hour, orders: round1(s.share * focusOrders.predicted) })) : [],
        items: itemForecasts.slice(0, 15).map(({ it, p }) => ({ product_id: it.product_id, name: it.name, category: it.category, portions: range(p), confidence: p.confidence })),
        categories: [...byCategory.values()].map((c) => ({ category: c.category, portions: range({ predicted: c.predicted, low: Math.max(0, c.predicted - Math.sqrt(c.variance)), high: c.predicted + Math.sqrt(c.variance) }) })).sort((a, b) => b.portions.predicted - a.portions.predicted)
      },
      upcoming_events: events.map((e) => ({ event_id: e.event_id, date: e.event_date, label: e.label, multiplier: e.multiplier }))
    }
  });
};

/* GET /api/forecast/inventory */
export const inventory = async (req, res) => {
  res.json({ success: true, data: await buildInventoryForecast(req.tenant.businessId, pool, req.tenant.scopeBranchId ?? null) });
};

/* ── known events that move demand ───────────────────────────────────────── */

/* POST /api/forecast/events { date, label, uplift_pct } — uplift may be negative */
export const addEvent = async (req, res) => {
  const { date, label } = req.body || {};
  const uplift = Number(req.body?.uplift_pct);
  const asOf = await today(req.tenant.businessId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || date <= asOf || date > addDays(asOf, 90)) return res.status(400).json({ success: false, message: 'Pick a date within the next 90 days' });
  if (!label || !String(label).trim()) return res.status(400).json({ success: false, message: 'Name the event' });
  if (!Number.isFinite(uplift) || uplift < -90 || uplift > 400) return res.status(400).json({ success: false, message: 'Expected change must be between -90% and +400%' });

  const { rows } = await pool.query(
    `INSERT INTO demand_events (business_id, event_date, label, multiplier, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING event_id`,
    [req.tenant.businessId, date, String(label).trim().slice(0, 80), Math.round((1 + uplift / 100) * 100) / 100, req.auth.userId]
  );
  recordAudit(req, { action: 'forecast.event_added', resource_type: 'demand_event', resource_id: rows[0].event_id, metadata: { date, label, uplift_pct: uplift } });
  res.status(201).json({ success: true, data: { event_id: rows[0].event_id } });
};

/* DELETE /api/forecast/events/:id */
export const removeEvent = async (req, res) => {
  const { rowCount } = await pool.query(`DELETE FROM demand_events WHERE event_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId]);
  if (!rowCount) return res.status(404).json({ success: false, message: 'Not found' });
  recordAudit(req, { action: 'forecast.event_removed', resource_type: 'demand_event', resource_id: req.params.id });
  res.json({ success: true });
};
