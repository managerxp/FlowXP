/*
 * Gaming reports: what the lounge earned from time and from food and drink, which stations earn, when it is busy, and what is owed to players.
 *
 * EVERY FIGURE TIES TO INVOICES. Money here is read from the lines of billed station tabs (order_items with an invoice, on an invoice that was not
 * cancelled): the time and frame lines are the SERVICE lines (gaming), everything else is food and drink. Both are before GST and before any bill discount,
 * so gaming + food always equals the sum of those invoices' subtotals. A tab not yet billed is not revenue and is not here. Dates are the invoice date.
 *
 * UTILISATION is played minutes (the segments of finished and running sessions, a pause is not played) against the minutes the lounge was open that day, taken
 * as the span between the first session's start and the last session's end on each day the station was used, capped by an `open_hours` per day you pass
 * (default 12). It is a guide to which stations sit idle, not an accounting figure.
 */
import { timezoneOf, withRupees } from './common.js';

const range = (q) => {
  const to = q.to ? String(q.to).slice(0, 10) : null; const from = q.from ? String(q.from).slice(0, 10) : null;
  return { from, to };
};

const scope = (tenant, params, alias) => {
  if (tenant.scopeBranchId == null) return '';
  params.push(tenant.scopeBranchId);
  return ` AND ${alias}.branch_id = $${params.length}`;
};

/** The billed lines of station tabs in a period: one row per line, with its station and kind of line. */
const BILLED = `
  FROM order_items oi
  JOIN orders o ON o.order_id = oi.order_id
  JOIN invoices i ON i.invoice_id = oi.invoice_id AND i.status = 'ISSUED'
  LEFT JOIN products p ON p.product_id = oi.product_id
  JOIN dining_tables t ON t.table_id = o.table_id
  JOIN gaming_stations st ON st.table_id = t.table_id
  WHERE i.business_id = $1 AND oi.status <> 'CANCELLED'`;

const dateWindow = (q, params) => {
  const { from, to } = range(q);
  let sql = '';
  if (from) { params.push(from); sql += ` AND i.invoice_date >= $${params.length}::date`; }
  if (to) { params.push(to); sql += ` AND i.invoice_date <= $${params.length}::date`; }
  return sql;
};

/** Headline figures: revenue split, sessions, hours played, average session. */
export const summary = async (db, tenant, q = {}) => {
  const params = [tenant.businessId];
  const sc = scope(tenant, params, 'st');
  const win = dateWindow(q, params);
  const money = (await db.query(
    `SELECT COALESCE(SUM(ROUND(oi.quantity * oi.unit_price_paise)) FILTER (WHERE p.kind = 'SERVICE'), 0) AS gaming,
            COALESCE(SUM(ROUND(oi.quantity * oi.unit_price_paise)) FILTER (WHERE p.kind IS DISTINCT FROM 'SERVICE'), 0) AS fnb,
            COUNT(DISTINCT i.invoice_id) AS bills
     ${BILLED}${sc}${win}`, params)).rows[0];

  const sp = [tenant.businessId];
  let sw = `s.business_id = $1 AND s.status = 'ENDED'`;
  if (tenant.scopeBranchId != null) { sp.push(tenant.scopeBranchId); sw += ` AND s.branch_id = $${sp.length}`; }
  const tz = await timezoneOf(db, tenant.businessId);
  const { from, to } = range(q);
  if (from) { sp.push(from, tz); sw += ` AND s.started_at >= ($${sp.length - 1}::date::timestamp AT TIME ZONE $${sp.length})`; }
  if (to) { sp.push(to, tz); sw += ` AND s.started_at < (($${sp.length - 1}::date + 1)::timestamp AT TIME ZONE $${sp.length})`; }
  const ses = (await db.query(
    `SELECT COUNT(*) AS n, COALESCE(SUM(seconds), 0) AS seconds, COUNT(DISTINCT customer_id) AS players
     FROM (SELECT s.session_id, s.customer_id, (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (sg.ended_at - sg.started_at))), 0) FROM gaming_session_segments sg WHERE sg.session_id = s.session_id AND sg.ended_at IS NOT NULL) AS seconds
           FROM gaming_sessions s WHERE ${sw}) t`, sp)).rows[0];
  const gaming = Number(money.gaming); const fnb = Number(money.fnb); const n = Number(ses.n);
  return withRupees({
    gaming_paise: gaming, fnb_paise: fnb, total_paise: gaming + fnb, fnb_share_pct: gaming + fnb ? Math.round(fnb * 1000 / (gaming + fnb)) / 10 : 0,
    bills: Number(money.bills), sessions: n, hours_played: Math.round(Number(ses.seconds) / 360) / 10, average_session_minutes: n ? Math.round(Number(ses.seconds) / n / 60) : 0,
    average_bill_paise: Number(money.bills) ? Math.round((gaming + fnb) / Number(money.bills)) : 0, players: Number(ses.players)
  });
};

/** Revenue and use by station. */
export const byStation = async (db, tenant, q = {}) => {
  const params = [tenant.businessId];
  const sc = scope(tenant, params, 'st');
  const win = dateWindow(q, params);
  const money = (await db.query(
    `SELECT st.station_id, COALESCE(SUM(ROUND(oi.quantity * oi.unit_price_paise)) FILTER (WHERE p.kind = 'SERVICE'), 0) AS gaming,
            COALESCE(SUM(ROUND(oi.quantity * oi.unit_price_paise)) FILTER (WHERE p.kind IS DISTINCT FROM 'SERVICE'), 0) AS fnb
     ${BILLED}${sc}${win} GROUP BY st.station_id`, params)).rows;
  const byId = new Map(money.map((r) => [r.station_id, r]));

  const sp = [tenant.businessId];
  let sw = `s.business_id = $1 AND s.status = 'ENDED'`;
  if (tenant.scopeBranchId != null) { sp.push(tenant.scopeBranchId); sw += ` AND s.branch_id = $${sp.length}`; }
  const tz = await timezoneOf(db, tenant.businessId);
  const { from, to } = range(q);
  if (from) { sp.push(from, tz); sw += ` AND s.started_at >= ($${sp.length - 1}::date::timestamp AT TIME ZONE $${sp.length})`; }
  if (to) { sp.push(to, tz); sw += ` AND s.started_at < (($${sp.length - 1}::date + 1)::timestamp AT TIME ZONE $${sp.length})`; }
  sp.push(tz);
  const openHours = Number(q.open_hours) > 0 ? Number(q.open_hours) : 12;
  const use = (await db.query(
    `SELECT s.station_id, COUNT(*) AS sessions, COALESCE(SUM(sec), 0) AS seconds, COUNT(DISTINCT d) AS days
     FROM (SELECT s.station_id, (s.started_at AT TIME ZONE $${sp.length})::date AS d,
                  (SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (sg.ended_at - sg.started_at))), 0) FROM gaming_session_segments sg WHERE sg.session_id = s.session_id AND sg.ended_at IS NOT NULL) AS sec
           FROM gaming_sessions s WHERE ${sw}) s GROUP BY s.station_id`, sp)).rows;
  const useBy = new Map(use.map((r) => [r.station_id, r]));

  const stParams = [tenant.businessId];
  const stScope = scope(tenant, stParams, 's');
  const stations = (await db.query(`SELECT s.station_id, s.name, s.kind, z.name AS zone_name FROM gaming_stations s LEFT JOIN gaming_zones z ON z.zone_id = s.zone_id WHERE s.business_id = $1 AND s.status <> 'ARCHIVED'${stScope}`, stParams)).rows;
  return withRupees(stations.map((s) => {
    const m = byId.get(s.station_id); const u = useBy.get(s.station_id);
    const gaming = Number(m?.gaming || 0); const fnb = Number(m?.fnb || 0);
    const seconds = Number(u?.seconds || 0); const days = Number(u?.days || 0);
    return {
      station_id: s.station_id, name: s.name, kind: s.kind, zone_name: s.zone_name, sessions: Number(u?.sessions || 0), hours_played: Math.round(seconds / 360) / 10,
      utilisation_pct: days ? Math.min(100, Math.round(seconds / (days * openHours * 3600) * 1000) / 10) : 0, gaming_paise: gaming, fnb_paise: fnb, total_paise: gaming + fnb
    };
  }).sort((a, b) => b.total_paise - a.total_paise));
};

/** Busy hours: sessions started and minutes played by weekday and hour, in the lounge's own time. */
export const heatmap = async (db, tenant, q = {}) => {
  const tz = await timezoneOf(db, tenant.businessId);
  const params = [tenant.businessId, tz];
  let where = `s.business_id = $1 AND s.status = 'ENDED'`;
  if (tenant.scopeBranchId != null) { params.push(tenant.scopeBranchId); where += ` AND s.branch_id = $${params.length}`; }
  const { from, to } = range(q);
  if (from) { params.push(from); where += ` AND s.started_at >= ($${params.length}::date::timestamp AT TIME ZONE $2)`; }
  if (to) { params.push(to); where += ` AND s.started_at < (($${params.length}::date + 1)::timestamp AT TIME ZONE $2)`; }
  const rows = (await db.query(
    `SELECT EXTRACT(DOW FROM s.started_at AT TIME ZONE $2)::int AS dow, EXTRACT(HOUR FROM s.started_at AT TIME ZONE $2)::int AS hour, COUNT(*)::int AS sessions
     FROM gaming_sessions s WHERE ${where} GROUP BY 1, 2 ORDER BY 1, 2`, params)).rows;
  const peak = rows.reduce((best, r) => (!best || r.sessions > best.sessions ? r : best), null);
  return { cells: rows, peak };
};

/** Revenue by day, so a chart can show the trend. */
export const byDay = async (db, tenant, q = {}) => {
  const params = [tenant.businessId];
  const sc = scope(tenant, params, 'st');
  const win = dateWindow(q, params);
  return withRupees((await db.query(
    `SELECT to_char(i.invoice_date, 'YYYY-MM-DD') AS date,
            COALESCE(SUM(ROUND(oi.quantity * oi.unit_price_paise)) FILTER (WHERE p.kind = 'SERVICE'), 0) AS gaming_paise,
            COALESCE(SUM(ROUND(oi.quantity * oi.unit_price_paise)) FILTER (WHERE p.kind IS DISTINCT FROM 'SERVICE'), 0) AS fnb_paise
     ${BILLED}${sc}${win} GROUP BY i.invoice_date ORDER BY i.invoice_date`, params)).rows.map((r) => ({ date: r.date, gaming_paise: Number(r.gaming_paise), fnb_paise: Number(r.fnb_paise) })));
};

/** What is played most: sessions and hours per game. */
export const topGames = async (db, tenant, q = {}) => {
  const params = [tenant.businessId];
  let where = `s.business_id = $1 AND s.status = 'ENDED' AND s.game_id IS NOT NULL`;
  if (tenant.scopeBranchId != null) { params.push(tenant.scopeBranchId); where += ` AND s.branch_id = $${params.length}`; }
  const tz = await timezoneOf(db, tenant.businessId);
  const { from, to } = range(q);
  if (from) { params.push(from, tz); where += ` AND s.started_at >= ($${params.length - 1}::date::timestamp AT TIME ZONE $${params.length})`; }
  if (to) { params.push(to, tz); where += ` AND s.started_at < (($${params.length - 1}::date + 1)::timestamp AT TIME ZONE $${params.length})`; }
  return (await db.query(
    `SELECT g.name, COUNT(*)::int AS sessions, ROUND(COALESCE(SUM((SELECT SUM(EXTRACT(EPOCH FROM (sg.ended_at - sg.started_at))) FROM gaming_session_segments sg WHERE sg.session_id = s.session_id AND sg.ended_at IS NOT NULL)), 0) / 3600.0, 1) AS hours
     FROM gaming_sessions s JOIN gaming_games g ON g.game_id = s.game_id WHERE ${where} GROUP BY g.name ORDER BY sessions DESC, g.name LIMIT 10`, params)).rows.map((r) => ({ ...r, hours: Number(r.hours) }));
};

/** The dashboard in one call: today, the last seven days, who is playing now, and what needs attention. */
export const dashboard = async (db, tenant, today) => {
  const week = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
  const [t, w, days] = await Promise.all([summary(db, tenant, { from: today, to: today }), summary(db, tenant, { from: week, to: today }), byDay(db, tenant, { from: week, to: today })]);
  const sp = [tenant.businessId];
  const sc = scope(tenant, sp, 's');
  const now = (await db.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'RUNNING') AS running, COUNT(*) FILTER (WHERE status = 'PAUSED') AS paused FROM gaming_sessions s WHERE s.business_id = $1 AND s.status IN ('RUNNING','PAUSED')${sc}`, sp)).rows[0];
  const owed = (await db.query(
    `SELECT COUNT(DISTINCT o.order_id) AS tabs, COALESCE(SUM(ROUND(oi.quantity * oi.unit_price_paise * (1 + CASE WHEN b.gst_enabled THEN COALESCE(p.tax_rate, 0) / 100.0 ELSE 0 END))), 0) AS paise
     FROM gaming_sessions s JOIN orders o ON o.order_id = s.order_id JOIN businesses b ON b.business_id = o.business_id JOIN order_items oi ON oi.order_id = o.order_id LEFT JOIN products p ON p.product_id = oi.product_id
     WHERE s.business_id = $1 AND s.status = 'ENDED' AND o.status NOT IN ('BILLED','CANCELLED','MERGED') AND oi.invoice_id IS NULL AND oi.status <> 'CANCELLED'${sc}`, sp)).rows[0];
  return withRupees({ today: t, week: w, last_7_days: days, playing_now: Number(now.running), paused_now: Number(now.paused), to_collect_paise: Number(owed.paise), tabs_to_collect: Number(owed.tabs) });
};
