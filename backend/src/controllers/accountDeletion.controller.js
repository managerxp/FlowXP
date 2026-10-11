/*
 * Deleting an account (rules: migrations/0081_account_deletion.js).
 *
 *   POST /api/auth/delete-account            a signed-in person deletes their own account (password, and a code if they use two-step)
 *   POST /api/public/account-deletion        someone who cannot sign in asks for it; nothing is deleted until support has checked who is asking
 *   GET  /api/admin/deletion-requests        the queue for FlowXP support
 *   POST /api/admin/deletion-requests/:id/complete | /decline
 */
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { decryptSecret, useRecoveryCode, verifyTotp } from '../modules/security.js';
import { anonymiseUser, openRequest, soleOwnerOf } from '../modules/accountDeletion.js';
import { checkEmail, normaliseEmail } from '../utils/validate.js';
import { clearSessionCookie } from '../middleware/auth.js';

const bad = (res, message, status = 400, extra = {}) => res.status(status).json({ success: false, message, ...extra });

/* POST /api/auth/delete-account { password, code?, recovery_code? } */
export const deleteMe = async (req, res) => {
  const u = (await pool.query(`SELECT user_id, email, password_hash, totp_enabled, totp_secret_enc, totp_last_step, is_super_admin FROM users WHERE user_id = $1`, [req.auth.userId])).rows[0];
  if (u.is_super_admin) return bad(res, 'A FlowXP administrator account is not deleted from here.', 403);
  if (!req.body?.password || !(await bcrypt.compare(String(req.body.password), u.password_hash))) return bad(res, 'Your password is not right.', 401);
  if (u.totp_enabled) {
    const { code, recovery_code: recovery } = req.body;
    const ok = recovery ? await useRecoveryCode(pool, u.user_id, recovery) : verifyTotp(decryptSecret(u.totp_secret_enc), code, { lastStep: u.totp_last_step }) != null;
    if (!ok) return bad(res, 'That code is not right.', 401);
  }

  // the only owner of a business cannot just leave it: the business needs closing or handing over, and that is a conversation with support
  const owned = await soleOwnerOf(pool, u.user_id);
  if (owned.length) {
    const id = await openRequest({ userId: u.user_id, email: u.email, source: 'IN_APP', note: `Only owner of: ${owned.map((b) => `${b.name} (#${b.business_id})`).join(', ')}` });
    recordAudit(req, { action: 'user.deletion_requested', resource_type: 'user', resource_id: u.user_id, business_id: owned[0].business_id, metadata: { request_id: id } });
    return bad(res, `You are the only owner of ${owned.map((b) => b.name).join(', ')}, so it cannot be left without one. Make another person an owner under Staff and try again, or leave this request with us: FlowXP support will contact you at ${u.email} to close the business or hand it over, and then delete your account. Your request is recorded.`, 409, { code: 'OWNS_BUSINESS', data: { businesses: owned.map((b) => b.name), request_id: id } });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await anonymiseUser(client, u.user_id);
    await client.query(`UPDATE deletion_requests SET status = 'DONE', handled_at = CURRENT_TIMESTAMP, handled_note = 'Deleted by the person themselves' WHERE user_id = $1 AND status = 'PENDING'`, [u.user_id]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  recordAudit(req, { action: 'user.deleted_self', resource_type: 'user', resource_id: u.user_id, business_id: req.memberships[0]?.business_id ?? null });
  clearSessionCookie(res);
  res.json({ success: true, message: 'Your account has been deleted.' });
};

/* POST /api/public/account-deletion { email, note } — the same answer whether or not the address has an account, so this cannot be used to find out who does */
export const publicRequest = async (req, res) => {
  const problem = checkEmail(req.body?.email);
  if (problem) return bad(res, problem);
  if (req.body?.website) return res.status(201).json({ success: true });   // a hidden field only a bot fills in
  const email = normaliseEmail(req.body.email);
  const user = (await pool.query(`SELECT user_id FROM users WHERE email = $1 AND deleted_at IS NULL`, [email])).rows[0];
  const dup = (await pool.query(`SELECT 1 FROM deletion_requests WHERE lower(email) = $1 AND status = 'PENDING' AND created_at > now() - interval '7 days'`, [email])).rows.length;
  if (!dup) await openRequest({ userId: user?.user_id ?? null, email, source: 'WEBSITE', note: req.body?.note });
  res.status(201).json({ success: true, message: 'We have your request. FlowXP support will reply to that address to confirm it is you, then delete the account.' });
};

/* GET /api/admin/deletion-requests?status=PENDING */
export const adminList = async (req, res) => {
  const status = ['PENDING', 'DONE', 'DECLINED'].includes(req.query.status) ? req.query.status : 'PENDING';
  const { rows } = await pool.query(
    `SELECT r.request_id, r.email, r.source, r.note, r.status, r.created_at, r.handled_at, r.handled_note, r.user_id,
            (u.user_id IS NOT NULL AND u.deleted_at IS NULL) AS has_account,
            COALESCE((SELECT json_agg(json_build_object('business_id', b.business_id, 'name', b.name, 'role', bu.role, 'sole_owner', bu.role = 'OWNER' AND NOT EXISTS (SELECT 1 FROM business_users o WHERE o.business_id = bu.business_id AND o.role = 'OWNER' AND o.status = 'ACTIVE' AND o.user_id <> bu.user_id)))
                      FROM business_users bu JOIN businesses b ON b.business_id = bu.business_id WHERE bu.user_id = r.user_id AND bu.status = 'ACTIVE'), '[]'::json) AS businesses
     FROM deletion_requests r LEFT JOIN users u ON u.user_id = r.user_id
     WHERE r.status = $1 ORDER BY r.created_at LIMIT 200`, [status]);
  res.json({ success: true, data: rows });
};

/* POST /api/admin/deletion-requests/:id/complete { note } — support has checked who is asking */
export const adminComplete = async (req, res) => {
  const r = (await pool.query(`SELECT request_id, user_id, status FROM deletion_requests WHERE request_id = $1`, [req.params.id])).rows[0];
  if (!r) return bad(res, 'Not found', 404);
  if (r.status !== 'PENDING') return bad(res, 'That request is already handled.', 409);
  if (r.user_id) {
    const owned = await soleOwnerOf(pool, r.user_id);
    if (owned.length) return bad(res, `Still the only owner of ${owned.map((b) => b.name).join(', ')}. Close the business or make someone else an owner first.`, 409);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (r.user_id) await anonymiseUser(client, r.user_id);
    await client.query(`UPDATE deletion_requests SET status = 'DONE', handled_at = CURRENT_TIMESTAMP, handled_by = $2, handled_note = $3 WHERE request_id = $1`, [r.request_id, req.auth.userId, String(req.body?.note || (r.user_id ? 'Account deleted' : 'No account with that address')).slice(0, 500)]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  recordAudit(req, { action: 'admin.deletion_completed', resource_type: 'user', resource_id: r.user_id, business_id: null, metadata: { request_id: r.request_id } });
  res.json({ success: true });
};

/* POST /api/admin/deletion-requests/:id/decline { note } */
export const adminDecline = async (req, res) => {
  const { rowCount } = await pool.query(`UPDATE deletion_requests SET status = 'DECLINED', handled_at = CURRENT_TIMESTAMP, handled_by = $2, handled_note = $3 WHERE request_id = $1 AND status = 'PENDING'`, [req.params.id, req.auth.userId, String(req.body?.note || '').slice(0, 500) || null]);
  if (!rowCount) return bad(res, 'Not found, or already handled.', 404);
  res.json({ success: true });
};
