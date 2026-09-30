/*
 * Account security: two-step verification (an authenticator app plus recovery codes), changing the password,
 * ending every session, the person's own sign-in history, and, for owners, the team's sign-ins and the switch that
 * requires two-step verification for owners and admins. The rules and the crypto are in modules/security.js.
 *
 * Anything that changes how someone signs in raises their session version (users.token_version), which ends every
 * other session; the response carries a fresh token so the person making the change stays signed in.
 */
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import { signToken } from '../middleware/auth.js';
import { recordAudit } from '../modules/events.js';
import { decryptSecret, encryptSecret, issueRecoveryCodes, newSecret, otpauthUrl, recoveryCodesLeft, useRecoveryCode, verifyTotp } from '../modules/security.js';
import { checkPassword } from '../utils/validate.js';

const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });

const me = async (userId) => (await pool.query(
  `SELECT user_id, name, email, password_hash, token_version, totp_enabled, totp_secret_enc, totp_pending_enc, totp_last_step, totp_enabled_at FROM users WHERE user_id = $1`, [userId])).rows[0];

/** True when this person's role in some business makes two-step verification compulsory. */
const requiredFor = (req) => req.memberships.some((m) => m.require_2fa_admins && ['OWNER', 'ADMIN'].includes(m.role));

const samePassword = async (user, password) => Boolean(password) && bcrypt.compare(String(password), user.password_hash);

/** Bump the session version and return a token for the new one, so this session survives and the others end. */
const rotate = async (userId) => {
  const { rows } = await pool.query(`UPDATE users SET token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1 RETURNING user_id, email, token_version`, [userId]);
  return signToken(rows[0]);
};

/* GET /api/auth/2fa */
export const status = async (req, res) => {
  const u = await me(req.auth.userId);
  res.json({ success: true, data: { enabled: u.totp_enabled, enabled_at: u.totp_enabled_at, recovery_codes_left: u.totp_enabled ? await recoveryCodesLeft(pool, u.user_id) : 0, required: requiredFor(req), setup_pending: Boolean(u.totp_pending_enc) } });
};

/* POST /api/auth/2fa/setup — a secret to add to the authenticator app; nothing is on until a code from it is confirmed */
export const setup = async (req, res) => {
  const u = await me(req.auth.userId);
  if (u.totp_enabled) return bad(res, 'Two-step verification is already on. Turn it off first to set it up again.', 409);
  const secret = newSecret();
  await pool.query(`UPDATE users SET totp_pending_enc = $2 WHERE user_id = $1`, [u.user_id, encryptSecret(secret)]);
  res.json({ success: true, data: { secret, otpauth_url: otpauthUrl({ secret, email: u.email }) } });
};

/* POST /api/auth/2fa/enable { code } */
export const enable = async (req, res) => {
  const u = await me(req.auth.userId);
  if (u.totp_enabled) return bad(res, 'Two-step verification is already on.', 409);
  if (!u.totp_pending_enc) return bad(res, 'Start the setup first.');
  const secret = decryptSecret(u.totp_pending_enc);
  const step = verifyTotp(secret, req.body?.code);
  if (step == null) return bad(res, 'That code is not right. Check the time on your phone and try the next code.', 401);
  await pool.query(
    `UPDATE users SET totp_enabled = TRUE, totp_secret_enc = totp_pending_enc, totp_pending_enc = NULL, totp_last_step = $2, totp_enabled_at = CURRENT_TIMESTAMP WHERE user_id = $1`,
    [u.user_id, step]);
  const codes = await issueRecoveryCodes(pool, u.user_id);
  const token = await rotate(u.user_id);
  recordAudit(req, { action: 'user.two_factor_enabled', resource_type: 'user', resource_id: u.user_id, business_id: req.memberships[0]?.business_id ?? null });
  res.json({ success: true, data: { recovery_codes: codes, token } });
};

/* POST /api/auth/2fa/disable { password, code | recovery_code } */
export const disable = async (req, res) => {
  const u = await me(req.auth.userId);
  if (!u.totp_enabled) return bad(res, 'Two-step verification is not on.', 409);
  if (requiredFor(req)) return bad(res, 'Your business requires two-step verification for owners and admins, so it can’t be turned off.', 409);
  if (!(await samePassword(u, req.body?.password))) return bad(res, 'Your password is not right.', 401);
  const { code, recovery_code: recovery } = req.body || {};
  const ok = recovery ? await useRecoveryCode(pool, u.user_id, recovery) : verifyTotp(decryptSecret(u.totp_secret_enc), code, { lastStep: u.totp_last_step }) != null;
  if (!ok) return bad(res, 'That code is not right.', 401);
  await pool.query(`UPDATE users SET totp_enabled = FALSE, totp_secret_enc = NULL, totp_pending_enc = NULL, totp_last_step = NULL, totp_enabled_at = NULL WHERE user_id = $1`, [u.user_id]);
  await pool.query(`DELETE FROM recovery_codes WHERE user_id = $1`, [u.user_id]);
  const token = await rotate(u.user_id);
  recordAudit(req, { action: 'user.two_factor_disabled', resource_type: 'user', resource_id: u.user_id, business_id: req.memberships[0]?.business_id ?? null });
  res.json({ success: true, data: { token } });
};

/* POST /api/auth/2fa/recovery-codes { password } — a fresh set (the old ones stop working) */
export const newCodes = async (req, res) => {
  const u = await me(req.auth.userId);
  if (!u.totp_enabled) return bad(res, 'Turn on two-step verification first.', 409);
  if (!(await samePassword(u, req.body?.password))) return bad(res, 'Your password is not right.', 401);
  res.json({ success: true, data: { recovery_codes: await issueRecoveryCodes(pool, u.user_id) } });
};

/* POST /api/auth/change-password { current_password, new_password } */
export const changePassword = async (req, res) => {
  const u = await me(req.auth.userId);
  if (!(await samePassword(u, req.body?.current_password))) return bad(res, 'Your current password is not right.', 401);
  const problem = checkPassword(req.body?.new_password);
  if (problem) return bad(res, problem);
  if (req.body.new_password === req.body.current_password) return bad(res, 'Choose a password you have not used just now.');
  await pool.query(`UPDATE users SET password_hash = $2 WHERE user_id = $1`, [u.user_id, await bcrypt.hash(String(req.body.new_password), 12)]);
  const token = await rotate(u.user_id);
  recordAudit(req, { action: 'user.password_changed', resource_type: 'user', resource_id: u.user_id, business_id: req.memberships[0]?.business_id ?? null });
  res.json({ success: true, data: { token } });
};

/* POST /api/auth/sign-out-everywhere */
export const signOutEverywhere = async (req, res) => {
  const token = await rotate(req.auth.userId);
  recordAudit(req, { action: 'user.signed_out_everywhere', resource_type: 'user', resource_id: req.auth.userId, business_id: req.memberships[0]?.business_id ?? null });
  res.json({ success: true, data: { token } });
};

const eventRow = (e) => ({ event_id: Number(e.event_id), outcome: e.outcome, method: e.method, ip: e.ip, device: e.user_agent, new_device: e.new_device, at: e.created_at });

/* GET /api/auth/login-history — this person's own sign-ins and failed attempts */
export const loginHistory = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM login_events WHERE user_id = $1 OR email = $2 ORDER BY event_id DESC LIMIT 50`, [req.auth.userId, req.auth.email.toLowerCase()]);
  res.json({ success: true, data: rows.map(eventRow) });
};

/* GET /api/security/team — the team's sign-ins, and who has no second step */
export const team = async (req, res) => {
  const members = (await pool.query(
    `SELECT u.user_id, u.name, u.email, bu.role, u.totp_enabled FROM business_users bu JOIN users u ON u.user_id = bu.user_id
     WHERE bu.business_id = $1 AND bu.status = 'ACTIVE' ORDER BY bu.role, u.name`, [req.tenant.businessId])).rows;
  const ids = members.map((m) => m.user_id); const emails = members.map((m) => m.email.toLowerCase());
  const events = (await pool.query(
    `SELECT e.*, u.name FROM login_events e LEFT JOIN users u ON u.user_id = e.user_id
     WHERE e.user_id = ANY($1::int[]) OR e.email = ANY($2::text[]) ORDER BY e.event_id DESC LIMIT 200`, [ids, emails])).rows;
  const week = Date.now() - 7 * 86400000;
  const recent = events.filter((e) => new Date(e.created_at).getTime() > week);
  const biz = (await pool.query(`SELECT require_2fa_admins FROM businesses WHERE business_id = $1`, [req.tenant.businessId])).rows[0];
  res.json({
    success: true,
    data: {
      require_2fa_admins: biz.require_2fa_admins,
      members: members.map((m) => ({ user_id: m.user_id, name: m.name, email: m.email, role: m.role, two_factor: m.totp_enabled })),
      summary: {
        failed_7d: recent.filter((e) => ['BAD_PASSWORD', 'TWO_FACTOR_FAILED', 'LOCKED'].includes(e.outcome)).length,
        new_devices_7d: recent.filter((e) => e.new_device).length,
        privileged_without_2fa: members.filter((m) => ['OWNER', 'ADMIN'].includes(m.role) && !m.totp_enabled).length
      },
      events: events.map((e) => ({ ...eventRow(e), name: e.name || null, email: e.email }))
    }
  });
};

/* PUT /api/security/policy { require_2fa_admins } — owner only */
export const setPolicy = async (req, res) => {
  const on = req.body?.require_2fa_admins === true;
  if (on) {
    const u = await me(req.auth.userId);
    if (!u.totp_enabled) return bad(res, 'Set up two-step verification for your own account first, so you are not locked out.', 409);
  }
  await pool.query(`UPDATE businesses SET require_2fa_admins = $1 WHERE business_id = $2`, [on, req.tenant.businessId]);
  recordAudit(req, { action: 'security.policy_updated', resource_type: 'business', resource_id: req.tenant.businessId, metadata: { require_2fa_admins: on } });
  res.json({ success: true, data: { require_2fa_admins: on } });
};
