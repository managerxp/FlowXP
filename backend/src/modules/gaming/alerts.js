/*
 * Timer alerts, run by the worker every tick (about every 30 seconds): "ending soon" once when a timed session has `alert_minutes` left, and "time
 * over" once when it runs out. Each is sent once per session: the flag on the session is claimed in the same statement that finds it, so two API
 * processes cannot both send it. They go to the people who may see the board (permission gaming_desk) at that outlet.
 *
 * Nothing here stops a station: FlowXP keeps the time, and a person (or the lounge's own tools) decides what happens at the end.
 * The board shows the same two states live, whether or not anyone has been notified.
 */
import pool from '../../config/database.js';
import { notify } from '../notifications.js';
import { registerScan } from '../jobs.js';
import { remainingSeconds } from './pricing.js';

/** The notification a session in this state needs, or null. */
export const alertFor = (remaining, alertMinutes) => {
  if (remaining == null) return null;
  if (remaining <= 0) return 'OVER';
  if (remaining <= alertMinutes * 60) return 'ENDING';
  return null;
};

export const runAlerts = async (db = pool, now = new Date()) => {
  const { rows } = await db.query(
    `SELECT s.session_id, s.business_id, s.branch_id, s.station_id, s.planned_minutes, s.alerted_soon_at, s.alerted_over_at, st.name AS station_name, gs.alert_minutes
     FROM gaming_sessions s JOIN gaming_stations st ON st.station_id = s.station_id JOIN gaming_settings gs ON gs.business_id = s.business_id
     WHERE s.status = 'RUNNING' AND s.planned_minutes IS NOT NULL AND (s.alerted_soon_at IS NULL OR s.alerted_over_at IS NULL)`);
  let sent = 0;
  for (const r of rows) {
    const segs = (await db.query(`SELECT started_at, ended_at FROM gaming_session_segments WHERE session_id = $1`, [r.session_id])).rows;
    const remaining = remainingSeconds(segs, r, now.getTime());
    const which = alertFor(remaining, r.alert_minutes);
    if (!which) continue;
    const column = which === 'OVER' ? 'alerted_over_at' : 'alerted_soon_at';
    // ending soon is not worth saying once time is over; mark both when over
    const claimed = (await db.query(
      `UPDATE gaming_sessions SET ${which === 'OVER' ? 'alerted_over_at = $2, alerted_soon_at = COALESCE(alerted_soon_at, $2)' : 'alerted_soon_at = $2'} WHERE session_id = $1 AND ${column} IS NULL AND status = 'RUNNING' RETURNING session_id`,
      [r.session_id, now])).rowCount;
    if (!claimed) continue;
    const mins = Math.max(1, Math.ceil(remaining / 60));
    sent += await notify(r.business_id, {
      category: 'gaming', type: which === 'OVER' ? 'gaming_time_over' : 'gaming_time_soon', severity: which === 'OVER' ? 'warning' : 'informational',
      title: which === 'OVER' ? `${r.station_name}: time is up` : `${r.station_name}: ${mins} minute${mins === 1 ? '' : 's'} left`,
      body: which === 'OVER' ? 'The booked time has run out. Extend it, or stop and bill.' : 'Let the players know, or extend the session.',
      link: '/app/gaming', route: 'gaming', dedupeKey: `gaming-${which}:${r.session_id}`, branchId: r.branch_id, urgent: which === 'OVER', metadata: { session_id: r.session_id, station_id: r.station_id }
    }, db).catch((error) => { console.error('[gaming] alert failed:', error.message); return 0; });
  }
  return sent;
};

registerScan(() => runAlerts().catch((error) => console.error('[gaming] alerts failed:', error.message)));
