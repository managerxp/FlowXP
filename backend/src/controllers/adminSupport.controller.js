/*
 * Super-admin support tools: extend a trial, look after a person's account (find, sign out, reset two-step, verify email),
 * read the activity log, keep private notes on a business, and a launch-readiness checklist. Everything is platform-level
 * (behind requireSuperAdmin) and every change writes an audit row.
 */
import pool from '../config/database.js';
import config from '../config/env.js';
import { recordAudit } from '../modules/events.js';
import { getPlatformSetting } from '../modules/platformSettings.js';

const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const fail = (res, what, error) => { console.error(`[admin] ${what} failed:`, error.message); res.status(500).json({ success: false, message: `Could not ${what}` }); };
const pageOf = (req, max = 100) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(max, Math.max(1, Number(req.query.page_size) || 25));
  return { page, pageSize, offset: (page - 1) * pageSize };
};

/* POST /admin/businesses/:id/extend-trial { days } — counts from today, or from the current trial end when that is later */
export const extendTrial = async (req, res) => {
  try {
    const days = Math.floor(Number(req.body?.days));
    if (!Number.isFinite(days) || days < 1 || days > 90) return bad(res, 'Days must be between 1 and 90');
    const { rows } = await pool.query(
      `UPDATE businesses
          SET trial_ends_at = GREATEST(CURRENT_TIMESTAMP, COALESCE(trial_ends_at, CURRENT_TIMESTAMP)) + ($2 || ' days')::interval,
              subscription_status = 'TRIAL', updated_at = CURRENT_TIMESTAMP
        WHERE business_id = $1 AND status <> 'CLOSED'
        RETURNING business_id, trial_ends_at, subscription_status`,
      [Number(req.params.id), String(days)]
    );
    if (!rows.length) return bad(res, 'Business not found', 404);
    recordAudit(req, { business_id: rows[0].business_id, action: 'admin.trial_extended', resource_type: 'business', resource_id: rows[0].business_id, metadata: { days, trial_ends_at: rows[0].trial_ends_at } });
    res.json({ success: true, data: rows[0] });
  } catch (error) { fail(res, 'extend the trial', error); }
};

/* ---------- people ---------- */
export const listUsers = async (req, res) => {
  try {
    const { page, pageSize, offset } = pageOf(req);
    const search = String(req.query.search || '').trim();
    const params = [];
    let where = 'WHERE u.deleted_at IS NULL';
    if (search) { params.push(`%${search}%`); where += ` AND (u.email ILIKE $1 OR u.name ILIKE $1 OR u.phone ILIKE $1)`; }
    const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM users u ${where}`, params)).rows[0].n;
    params.push(pageSize, offset);
    const { rows } = await pool.query(
      `SELECT u.user_id, u.name, u.email, u.phone, u.email_verified, u.is_super_admin, u.totp_enabled, u.last_login_at, u.created_at,
              (SELECT COUNT(*)::int FROM business_users bu WHERE bu.user_id = u.user_id) AS businesses
         FROM users u ${where} ORDER BY u.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({ success: true, data: { users: rows, page, page_size: pageSize, total } });
  } catch (error) { fail(res, 'load people', error); }
};

export const getUser = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT user_id, name, email, phone, email_verified, is_super_admin, totp_enabled, last_login_at, created_at FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [id]);
    if (!rows.length) return bad(res, 'Not found', 404);
    const [memberships, logins] = await Promise.all([
      pool.query(`SELECT bu.role, bu.status, b.business_id, b.name, b.business_type FROM business_users bu JOIN businesses b ON b.business_id = bu.business_id WHERE bu.user_id = $1 ORDER BY b.name`, [id]),
      pool.query(`SELECT outcome, method, ip, user_agent, new_device, created_at FROM login_events WHERE user_id = $1 OR email = $2 ORDER BY created_at DESC LIMIT 15`, [id, rows[0].email])
    ]);
    res.json({ success: true, data: { user: rows[0], memberships: memberships.rows, logins: logins.rows } });
  } catch (error) { fail(res, 'load the person', error); }
};

/* one runner for the three account fixes; super admins are never touched from here */
const userAction = (action, sql, extra = null) => async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = Number(req.params.id);
    const u = (await client.query(`SELECT user_id, is_super_admin FROM users WHERE user_id = $1 AND deleted_at IS NULL FOR UPDATE`, [id])).rows[0];
    if (!u) { await client.query('ROLLBACK'); return bad(res, 'Not found', 404); }
    if (u.is_super_admin) { await client.query('ROLLBACK'); return bad(res, 'Platform admins are managed from their own account', 403); }
    await client.query(sql, [id]);
    if (extra) await client.query(extra, [id]);
    await client.query('COMMIT');
    recordAudit(req, { business_id: null, action, resource_type: 'user', resource_id: id });
    res.json({ success: true });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); fail(res, 'update the person', error); } finally { client.release(); }
};
export const signOutUser = userAction('admin.user_signed_out', `UPDATE users SET token_version = token_version + 1 WHERE user_id = $1`);
export const verifyUserEmail = userAction('admin.user_email_verified', `UPDATE users SET email_verified = TRUE WHERE user_id = $1`);
export const resetUserTwoFactor = userAction('admin.user_2fa_reset',
  `UPDATE users SET totp_enabled = FALSE, totp_secret_enc = NULL, totp_pending_enc = NULL, totp_last_step = NULL, totp_enabled_at = NULL, token_version = token_version + 1 WHERE user_id = $1`,
  `DELETE FROM recovery_codes WHERE user_id = $1`);

/* ---------- activity log ---------- */
export const auditLog = async (req, res) => {
  try {
    const { page, pageSize, offset } = pageOf(req, 200);
    const where = []; const params = [];
    const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
    if (req.query.business_id) add('a.business_id = ?', Number(req.query.business_id));
    if (req.query.user_id) add('a.user_id = ?', Number(req.query.user_id));
    if (req.query.action) add('a.action ILIKE ?', `%${String(req.query.action).trim()}%`);
    if (req.query.from) add('a.created_at >= ?', String(req.query.from));
    if (req.query.to) add(`a.created_at < (?::date + 1)`, String(req.query.to));
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (await pool.query(`SELECT COUNT(*)::int AS n FROM audit_log a ${whereSql}`, params)).rows[0].n;
    params.push(pageSize, offset);
    const { rows } = await pool.query(
      `SELECT a.audit_id, a.action, a.resource_type, a.resource_id, a.metadata, a.ip_address, a.created_at,
              a.business_id, b.name AS business_name, a.user_id, u.name AS user_name, u.email AS user_email
         FROM audit_log a LEFT JOIN businesses b ON b.business_id = a.business_id LEFT JOIN users u ON u.user_id = a.user_id
         ${whereSql} ORDER BY a.audit_id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    res.json({ success: true, data: { events: rows, page, page_size: pageSize, total } });
  } catch (error) { fail(res, 'load the activity log', error); }
};

/* ---------- notes ---------- */
export const listNotes = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT n.note_id, n.note, n.created_at, u.name AS author FROM admin_notes n LEFT JOIN users u ON u.user_id = n.author_id WHERE n.business_id = $1 ORDER BY n.created_at DESC`, [Number(req.params.id)]);
    res.json({ success: true, data: rows });
  } catch (error) { fail(res, 'load notes', error); }
};
export const addNote = async (req, res) => {
  try {
    const note = String(req.body?.note || '').trim();
    if (!note) return bad(res, 'Write a note first');
    if (note.length > 1000) return bad(res, 'Keep a note under 1000 characters');
    const ok = await pool.query(`SELECT 1 FROM businesses WHERE business_id = $1`, [Number(req.params.id)]);
    if (!ok.rowCount) return bad(res, 'Business not found', 404);
    const { rows } = await pool.query(`INSERT INTO admin_notes (business_id, author_id, note) VALUES ($1,$2,$3) RETURNING note_id, note, created_at`, [Number(req.params.id), req.auth.userId, note]);
    recordAudit(req, { business_id: Number(req.params.id), action: 'admin.note_added', resource_type: 'business', resource_id: req.params.id });
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) { fail(res, 'save the note', error); }
};
export const deleteNote = async (req, res) => {
  try {
    const r = await pool.query(`DELETE FROM admin_notes WHERE note_id = $1 AND business_id = $2`, [Number(req.params.noteId), Number(req.params.id)]);
    if (!r.rowCount) return bad(res, 'Not found', 404);
    res.json({ success: true });
  } catch (error) { fail(res, 'delete the note', error); }
};

/* ---------- launch checks: each is { key, label, ok, level: 'must' | 'should', detail } ---------- */
export const launchChecks = async (req, res) => {
  try {
    const isProd = process.env.NODE_ENV === 'production';
    const [pay, mail, msg, admins, pendingDel, migs, bugs] = await Promise.all([
      getPlatformSetting('payment_gateway').catch(() => null),
      getPlatformSetting('email').catch(() => null),
      getPlatformSetting('messaging').catch(() => null),
      pool.query(`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE NOT totp_enabled)::int AS without_2fa FROM users WHERE is_super_admin AND deleted_at IS NULL`),
      pool.query(`SELECT COUNT(*)::int AS n FROM deletion_requests WHERE status = 'PENDING'`),
      pool.query(`SELECT COUNT(*)::int AS n FROM schema_migrations`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE status = 'NEW' AND kind = 'REPORT')::int AS reports, COUNT(*) FILTER (WHERE status = 'NEW' AND kind = 'CRASH')::int AS crashes FROM app_errors`)
    ]);
    const p = pay?.value || {}; const m = mail?.value || {}; const g = msg?.value || {};
    const appId = p.cashfreeAppId || config.cashfree.appId; const secret = p.cashfreeSecretKey || config.cashfree.secretKey;
    const cfEnv = String(p.cashfreeEnv || config.cashfree.env).toUpperCase();
    const smtp = (m.smtpHost || config.mail.host) && (m.smtpUser || config.mail.user);
    const provider = g.provider || config.messaging.provider;
    const adminEmail = String(process.env.SUPER_ADMIN_EMAIL || '').toLowerCase();
    const a = admins.rows[0];
    const checks = [
      { key: 'payments', label: 'Payment gateway keys saved', ok: Boolean(appId && secret), level: 'must', detail: appId && secret ? 'Keys are set' : 'Add the Cashfree keys under Settings' },
      { key: 'payments_live', label: 'Payment gateway is in live mode', ok: cfEnv === 'PRODUCTION', level: 'must', detail: `Mode: ${cfEnv}` },
      { key: 'email', label: 'Email (SMTP) is set up', ok: Boolean(smtp), level: 'must', detail: smtp ? 'Sign-up codes and receipts can be sent' : 'Without it, email codes and password resets are not delivered' },
      { key: 'messaging', label: 'Customer messages (WhatsApp / SMS) provider', ok: provider !== 'log', level: 'should', detail: provider === 'log' ? 'Messages are only recorded, nothing is sent' : `Provider: ${provider}` },
      { key: 'admin_2fa_rule', label: 'Two-step sign-in is required for admins', ok: config.adminRequire2fa, level: 'must', detail: config.adminRequire2fa ? 'On' : 'ADMIN_REQUIRE_2FA is off' },
      { key: 'admin_2fa', label: 'Every platform admin has two-step on', ok: a.n > 0 && a.without_2fa === 0, level: 'must', detail: `${a.n} admin(s), ${a.without_2fa} without two-step` },
      { key: 'jwt', label: 'Login secret is long enough', ok: String(config.jwtSecret || '').length >= 32, level: 'must', detail: 'JWT_SECRET should be 32+ characters' },
      { key: 'enc', label: 'Encryption key is set', ok: String(config.encryptionKey || '').length >= 32, level: 'must', detail: 'ENCRYPTION_KEY protects saved secrets and two-step keys' },
      { key: 'https', label: 'Site address uses https', ok: /^https:\/\//.test(config.appOrigin), level: 'must', detail: config.appOrigin },
      { key: 'admin_email', label: 'Platform admin email is a real address', ok: Boolean(adminEmail) && !/\.(local|test|example|invalid)$/.test(adminEmail), level: 'must', detail: adminEmail || 'SUPER_ADMIN_EMAIL not set' },
      { key: 'production', label: 'Server is running in production mode', ok: isProd, level: 'must', detail: `NODE_ENV=${process.env.NODE_ENV || 'not set'}` },
      { key: 'migrations', label: 'Database is up to date', ok: migs.rows[0].n > 0, level: 'must', detail: `${migs.rows[0].n} migrations applied` },
      { key: 'deletions', label: 'No account-deletion requests waiting', ok: pendingDel.rows[0].n === 0, level: 'should', detail: `${pendingDel.rows[0].n} waiting` },
      { key: 'bugs', label: 'No new bug reports or crashes', ok: bugs.rows[0].reports + bugs.rows[0].crashes === 0, level: 'should', detail: `${bugs.rows[0].reports} reports, ${bugs.rows[0].crashes} crashes` }
    ];
    res.json({ success: true, data: { checks, ready: checks.filter((c) => c.level === 'must').every((c) => c.ok) } });
  } catch (error) { fail(res, 'run the launch checks', error); }
};
