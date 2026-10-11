/*
 * Crash and error reports from the mobile app.
 *
 *   POST /api/app-errors        (no sign-in: a crash can happen before it, so it is rate-limited by address in routes/index.js)
 *   GET  /api/admin/app-errors  (platform admin) the latest, with how many times each message has happened
 *
 * The app sends only technical facts. Nothing here is trusted: every field is cut to size, and none of it is shown to anyone but a
 * platform admin. Reports older than 30 days are deleted as new ones arrive.
 */
import pool from '../config/database.js';

const text = (v, max) => (v == null ? null : String(v).slice(0, max));

export const report = async (req, res) => {
  const b = req.body || {};
  const message = text(b.message, 500)?.trim();
  if (!message) return res.status(400).json({ success: false, message: 'message is required' });
  await pool.query(
    `INSERT INTO app_errors (app, version, platform, os_version, device, screen, fatal, message, stack) VALUES ('mobile',$1,$2,$3,$4,$5,$6,$7,$8)`,
    [text(b.version, 40), text(b.platform, 20), text(b.os_version, 40), text(b.device, 20), text(b.screen, 120), b.fatal === true, message, text(b.stack, 4000)]
  );
  pool.query(`DELETE FROM app_errors WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '30 days'`).catch(() => {});
  res.status(201).json({ success: true, data: { received: true } });
};

export const list = async (req, res) => {
  const limit = Math.min(Math.max(Math.trunc(Number(req.query.limit)) || 50, 1), 200);
  const { rows } = await pool.query(
    `SELECT message, MAX(version) AS version, MAX(platform) AS platform, MAX(screen) AS screen, BOOL_OR(fatal) AS fatal,
            COUNT(*)::int AS times, COUNT(DISTINCT device)::int AS devices, MAX(created_at) AS last_seen, (ARRAY_AGG(stack ORDER BY created_at DESC))[1] AS stack
     FROM app_errors GROUP BY message ORDER BY MAX(created_at) DESC LIMIT $1`, [limit]);
  res.json({ success: true, data: rows });
};
