/*
 * Problems in the mobile app, for the admin console.
 *
 *   POST  /api/app-errors                 (no sign-in: a crash can happen before it, so it is rate-limited by address in routes/index.js) a crash the app caught by itself
 *   POST  /api/app-reports                (signed in) what a person typed when they tapped "Report a problem"
 *   GET   /api/admin/app-errors           (platform admin) crashes grouped by message, with how many times and on how many phones, and a status
 *   PATCH /api/admin/app-errors/status    (platform admin) set the status of every report of one crash message
 *   GET   /api/admin/bug-reports          (platform admin) the written reports, newest first, with who sent them
 *   PATCH /api/admin/bug-reports/:id      (platform admin) status and a note on one written report
 *   GET   /api/admin/bug-summary          (platform admin) how many are new, for the badge in the console
 *
 * A crash report is only technical facts: nothing is trusted, every field is cut to size, none of it is shown to anyone but a platform admin. A written report also names the
 * person and business (taken from their signed-in session, never from what the app says) so support can answer. Crash rows are deleted after 30 days, written reports after 180.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';

const text = (v, max) => (v == null ? null : String(v).slice(0, max));
export const STATUSES = ['NEW', 'SEEN', 'FIXED', 'IGNORED'];
export const CATEGORIES = ['BROKE', 'WRONG', 'SLOW', 'IDEA', 'OTHER'];

export const report = async (req, res) => {
  const b = req.body || {};
  const message = text(b.message, 500)?.trim();
  if (!message) return res.status(400).json({ success: false, message: 'message is required' });
  await pool.query(
    `INSERT INTO app_errors (app, version, platform, os_version, device, screen, fatal, message, stack, kind) VALUES ('mobile',$1,$2,$3,$4,$5,$6,$7,$8,'CRASH')`,
    [text(b.version, 40), text(b.platform, 20), text(b.os_version, 40), text(b.device, 20), text(b.screen, 120), b.fatal === true, message, text(b.stack, 4000)]
  );
  pool.query(`DELETE FROM app_errors WHERE kind = 'CRASH' AND created_at < CURRENT_TIMESTAMP - INTERVAL '30 days'`).catch(() => {});
  res.status(201).json({ success: true, data: { received: true } });
};

/* A person's own words. The person and business come from the session, so a report cannot be filed in someone else's name. */
export const create = async (req, res) => {
  const b = req.body || {};
  const description = text(b.description, 2000)?.trim();
  if (!description || description.length < 10) return res.status(400).json({ success: false, message: 'Tell us what went wrong, in at least a few words.' });
  const category = CATEGORIES.includes(String(b.category)) ? String(b.category) : 'OTHER';
  const claimed = Number(req.headers['x-business-id']);
  const businessId = (req.memberships || []).find((m) => m.business_id === claimed)?.business_id ?? ((req.memberships || []).length === 1 ? req.memberships[0].business_id : null);
  const row = (await pool.query(
    `INSERT INTO app_errors (app, version, platform, os_version, device, screen, fatal, message, kind, category, description, user_id, business_id)
     VALUES ('mobile',$1,$2,$3,$4,$5,FALSE,$6,'REPORT',$7,$8,$9,$10) RETURNING error_id`,
    [text(b.version, 40), text(b.platform, 20), text(b.os_version, 40), text(b.device, 20), text(b.screen, 120), description.slice(0, 120), category, description, req.auth.userId, businessId]
  )).rows[0];
  pool.query(`DELETE FROM app_errors WHERE kind = 'REPORT' AND created_at < CURRENT_TIMESTAMP - INTERVAL '180 days'`).catch(() => {});
  res.status(201).json({ success: true, data: { report_id: Number(row.error_id), received: true } });
};

const statusOf = (v) => (STATUSES.includes(String(v).toUpperCase()) ? String(v).toUpperCase() : null);

export const list = async (req, res) => {
  const limit = Math.min(Math.max(Math.trunc(Number(req.query.limit)) || 50, 1), 200);
  const want = statusOf(req.query.status);
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT message, MAX(version) AS version, MAX(platform) AS platform, MAX(screen) AS screen, BOOL_OR(fatal) AS fatal,
              COUNT(*)::int AS times, COUNT(DISTINCT device)::int AS devices, MAX(created_at) AS last_seen, MIN(created_at) AS first_seen,
              (ARRAY_AGG(stack ORDER BY created_at DESC))[1] AS stack, (ARRAY_AGG(status ORDER BY created_at DESC))[1] AS status, (ARRAY_AGG(note ORDER BY created_at DESC))[1] AS note
       FROM app_errors WHERE kind = 'CRASH' GROUP BY message) g
     WHERE ($2::text IS NULL OR g.status = $2) ORDER BY g.last_seen DESC LIMIT $1`, [limit, want]);
  res.json({ success: true, data: rows });
};

export const setCrashStatus = async (req, res) => {
  const status = statusOf(req.body?.status);
  const message = text(req.body?.message, 500)?.trim();
  if (!status || !message) return res.status(400).json({ success: false, message: 'Choose a status and the error.' });
  const out = await pool.query(
    `UPDATE app_errors SET status = $2, note = COALESCE($3, note), handled_by = $4, handled_at = CURRENT_TIMESTAMP WHERE kind = 'CRASH' AND message = $1`,
    [message, status, text(req.body?.note, 300), req.auth.userId]);
  if (!out.rowCount) return res.status(404).json({ success: false, message: 'Not found' });
  recordAudit(req, { action: 'admin.crash_status', resource_type: 'app_error', metadata: { status, reports: out.rowCount } });
  res.json({ success: true, data: { updated: out.rowCount, status } });
};

export const reports = async (req, res) => {
  const limit = Math.min(Math.max(Math.trunc(Number(req.query.limit)) || 50, 1), 200);
  const want = statusOf(req.query.status);
  const { rows } = await pool.query(
    `SELECT e.error_id AS report_id, e.created_at, e.category, e.description, e.status, e.note, e.handled_at, e.version, e.platform, e.os_version, e.device, e.screen,
            u.name AS user_name, u.email AS user_email, u.phone AS user_phone, b.name AS business_name, b.business_type, h.name AS handled_by
     FROM app_errors e LEFT JOIN users u ON u.user_id = e.user_id LEFT JOIN businesses b ON b.business_id = e.business_id LEFT JOIN users h ON h.user_id = e.handled_by
     WHERE e.kind = 'REPORT' AND ($2::text IS NULL OR e.status = $2) ORDER BY e.created_at DESC LIMIT $1`, [limit, want]);
  res.json({ success: true, data: rows.map((r) => ({ ...r, report_id: Number(r.report_id) })) });
};

export const setReportStatus = async (req, res) => {
  const status = statusOf(req.body?.status);
  if (!status) return res.status(400).json({ success: false, message: 'Choose a status.' });
  const out = await pool.query(
    `UPDATE app_errors SET status = $2, note = COALESCE($3, note), handled_by = $4, handled_at = CURRENT_TIMESTAMP WHERE kind = 'REPORT' AND error_id = $1 RETURNING error_id, status, note`,
    [Number(req.params.id) || 0, status, text(req.body?.note, 300), req.auth.userId]);
  if (!out.rowCount) return res.status(404).json({ success: false, message: 'Not found' });
  recordAudit(req, { action: 'admin.report_status', resource_type: 'app_error', resource_id: out.rows[0].error_id, metadata: { status } });
  res.json({ success: true, data: { report_id: Number(out.rows[0].error_id), status: out.rows[0].status, note: out.rows[0].note } });
};

export const summary = async (req, res) => {
  const r = (await pool.query(
    `SELECT (SELECT COUNT(*) FROM app_errors WHERE kind = 'REPORT' AND status = 'NEW')::int AS new_reports,
            (SELECT COUNT(*) FROM (SELECT (ARRAY_AGG(status ORDER BY created_at DESC))[1] AS st FROM app_errors WHERE kind = 'CRASH' GROUP BY message) g WHERE g.st = 'NEW')::int AS new_crashes`)).rows[0];
  res.json({ success: true, data: r });
};
