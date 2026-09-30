/*
 * Kitchen timing maths and queries.
 *
 * "Preparation time" is from the moment a line was sent to the kitchen until it
 * was marked ready — the kitchen's own responsibility, not how long the guest
 * waited to be served. "Late" means still not ready after the time the dish is
 * expected to take. Expectations come from the dish (or the business default),
 * copied onto the line when it was ordered.
 */
import pool from '../config/database.js';

/** Nearest-rank percentile of a list of numbers (p in 0..100). */
export const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};

const avg = (xs) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

/** Whole-minute age of a timestamp. */
export const minutesSince = (from, now = Date.now()) => Math.max(0, Math.floor((now - new Date(from).getTime()) / 60000));

/** 'late' past the expected time, 'warning' past 75% of it, otherwise 'ok'. Only meaningful for items still being made. */
export const urgency = (elapsedMinutes, expectedMinutes) => {
  if (!expectedMinutes) return 'ok';
  if (elapsedMinutes > expectedMinutes) return 'late';
  return elapsedMinutes >= expectedMinutes * 0.75 ? 'warning' : 'ok';
};

/**
 * Summarise finished lines: rows of { prep_minutes, expected_minutes }.
 * On time = ready within the expected time; lines with no expectation are left out of that rate.
 */
export const summarise = (rows) => {
  const times = rows.map((r) => Number(r.prep_minutes));
  const judged = rows.filter((r) => r.expected_minutes != null);
  const onTime = judged.filter((r) => Number(r.prep_minutes) <= Number(r.expected_minutes)).length;
  return {
    lines: rows.length,
    avg_minutes: rows.length ? r1(avg(times)) : null,
    p90_minutes: rows.length ? r1(percentile(times, 90)) : null,
    on_time_pct: judged.length ? Math.round((onTime / judged.length) * 1000) / 10 : null
  };
};

const FINISHED = `oi.sent_at IS NOT NULL AND oi.ready_at IS NOT NULL AND oi.status <> 'CANCELLED'`;
const PREP = `EXTRACT(EPOCH FROM (oi.ready_at - oi.sent_at)) / 60`;

/** Timing over a date range (business-local days), with the previous equal period for comparison. */
export const performance = async (businessId, from, to, prevFrom, prevTo, db = pool, branchId = null) => {
  const load = async (a, b) => (await db.query(
    `SELECT oi.order_item_id, oi.order_id, oi.product_id, p.name, oi.station_id, s.name AS station_name, oi.expected_minutes,
            ${PREP} AS prep_minutes,
            EXTRACT(HOUR FROM oi.sent_at AT TIME ZONE COALESCE(bz.timezone, 'Asia/Kolkata'))::int AS hour
     FROM order_items oi
     JOIN orders o ON o.order_id = oi.order_id
     JOIN businesses bz ON bz.business_id = o.business_id
     LEFT JOIN products p ON p.product_id = oi.product_id
     LEFT JOIN kitchen_stations s ON s.station_id = oi.station_id
     WHERE o.business_id = $1 AND ${FINISHED}
       AND (oi.sent_at AT TIME ZONE COALESCE(bz.timezone, 'Asia/Kolkata'))::date BETWEEN $2 AND $3${branchId != null ? ' AND o.branch_id = $4' : ''}`,
    branchId != null ? [businessId, a, b, branchId] : [businessId, a, b])).rows;

  const [cur, prev] = [await load(from, to), await load(prevFrom, prevTo)];

  const group = (rows, keyOf, nameOf) => {
    const map = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      if (!map.has(k)) map.set(k, { key: k, name: nameOf(r), rows: [] });
      map.get(k).rows.push(r);
    }
    return map;
  };

  const prevByItem = group(prev, (r) => r.product_id ?? `x:${r.name}`, (r) => r.name);
  const items = [...group(cur, (r) => r.product_id ?? `x:${r.name}`, (r) => r.name || 'Custom item').values()]
    .filter((g) => g.rows.length >= 3)
    .map((g) => {
      const now = summarise(g.rows); const before = prevByItem.get(g.key) ? summarise(prevByItem.get(g.key).rows) : null;
      return {
        product_id: typeof g.key === 'number' ? g.key : null, name: g.name, ...now,
        expected_minutes: g.rows[0].expected_minutes,
        previous_avg_minutes: before && before.lines >= 3 ? before.avg_minutes : null,
        change_minutes: before && before.lines >= 3 ? r1(now.avg_minutes - before.avg_minutes) : null
      };
    })
    .sort((a, b) => (b.change_minutes ?? -999) - (a.change_minutes ?? -999) || b.avg_minutes - a.avg_minutes);

  const stations = [...group(cur, (r) => r.station_id ?? 0, (r) => r.station_name || 'No station').values()].map((g) => ({ station_id: g.key || null, name: g.name, ...summarise(g.rows) }))
    .sort((a, b) => b.lines - a.lines);

  const hours = [...group(cur, (r) => r.hour, () => '').values()].map((g) => ({ hour: g.key, lines: g.rows.length, avg_minutes: r1(avg(g.rows.map((r) => Number(r.prep_minutes)))) }))
    .sort((a, b) => a.hour - b.hour);

  return { overall: summarise(cur), previous: summarise(prev), stations, items, hours };
};
