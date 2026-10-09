/*
 * Manager approval settings and the approver's PIN (the rules are in modules/approvals.js).
 *
 *   GET  /api/approvals            the business's cap and cancel rule, whether the caller needs approval, and (for settings holders) who can approve
 *   PUT  /api/approvals            the owner sets the cap (percent) and whether cancelling needs approval
 *   GET  /api/auth/approval-pin    does this person have a PIN, and may they approve anywhere
 *   PUT  /api/auth/approval-pin    set or change it (needs the account password)
 *   DELETE /api/auth/approval-pin  remove it (needs the account password)
 */
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { effectivePermissions } from '../modules/permissions.js';
import { approvers, hashPin, needsApproval, pinProblem } from '../modules/approvals.js';

const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });

/* GET /api/approvals */
export const get = async (req, res) => {
  const t = req.tenant;
  const data = { discount_cap_pct: t.discountCapPct, cancel_needs_approval: t.cancelNeedsApproval, you_need_approval: needsApproval(t) };
  if (req.tenant.permissions?.settings || ['OWNER', 'ADMIN'].includes(t.role)) {
    const rows = (await pool.query(
      `SELECT u.user_id, u.name, bu.role, bu.permissions, (u.approval_pin_hash IS NOT NULL) AS has_pin
       FROM business_users bu JOIN users u ON u.user_id = bu.user_id WHERE bu.business_id = $1 AND bu.status = 'ACTIVE' ORDER BY u.name`, [t.businessId])).rows;
    data.approvers = rows.filter((r) => effectivePermissions(r.role, r.permissions || {}).approvals === true).map((r) => ({ user_id: r.user_id, name: r.name, role: r.role, has_pin: r.has_pin }));
  }
  res.json({ success: true, data });
};

/* PUT /api/approvals { discount_cap_pct?, cancel_needs_approval? } */
export const update = async (req, res) => {
  const b = req.body || {};
  const sets = []; const values = [req.tenant.businessId];
  if ('discount_cap_pct' in b) {
    const cap = Number(b.discount_cap_pct);
    if (!Number.isFinite(cap) || cap < 0 || cap > 100) return bad(res, 'The discount limit is a percentage from 0 to 100');
    values.push(Math.round(cap * 100) / 100); sets.push(`discount_cap_pct = $${values.length}`);
  }
  if ('cancel_needs_approval' in b) { values.push(b.cancel_needs_approval === true); sets.push(`cancel_needs_approval = $${values.length}`); }
  if (!sets.length) return bad(res, 'Nothing to change');
  const row = (await pool.query(`UPDATE businesses SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE business_id = $1 RETURNING discount_cap_pct, cancel_needs_approval`, values)).rows[0];
  recordAudit(req, { action: 'approval.settings_changed', resource_type: 'business', resource_id: req.tenant.businessId, metadata: { discount_cap_pct: Number(row.discount_cap_pct), cancel_needs_approval: row.cancel_needs_approval } });
  res.json({ success: true, data: { discount_cap_pct: Number(row.discount_cap_pct), cancel_needs_approval: row.cancel_needs_approval } });
};

const canApproveSomewhere = (req) => req.memberships.some((m) => effectivePermissions(m.role, m.permissions || {}).approvals === true);

/* GET /api/auth/approval-pin */
export const pinStatus = async (req, res) => {
  const u = (await pool.query(`SELECT approval_pin_hash IS NOT NULL AS has_pin, approval_pin_set_at FROM users WHERE user_id = $1`, [req.auth.userId])).rows[0];
  res.json({ success: true, data: { has_pin: u.has_pin, set_at: u.approval_pin_set_at, can_approve: canApproveSomewhere(req) } });
};

const checkPassword = async (req, password) => {
  const u = (await pool.query(`SELECT password_hash FROM users WHERE user_id = $1`, [req.auth.userId])).rows[0];
  return Boolean(password) && bcrypt.compare(String(password), u.password_hash);
};

/* PUT /api/auth/approval-pin { password, pin } */
export const setPin = async (req, res) => {
  if (!canApproveSomewhere(req)) return bad(res, 'Only an owner, admin or manager can approve things at the till.', 403);
  const problem = pinProblem(req.body?.pin);
  if (problem) return bad(res, problem);
  if (!(await checkPassword(req, req.body?.password))) return bad(res, 'Your password is not right.', 403);
  await pool.query(`UPDATE users SET approval_pin_hash = $2, approval_pin_set_at = CURRENT_TIMESTAMP WHERE user_id = $1`, [req.auth.userId, await hashPin(req.body.pin)]);
  recordAudit(req, { action: 'approval.pin_set', resource_type: 'user', resource_id: req.auth.userId, business_id: req.memberships[0]?.business_id });
  res.json({ success: true, data: { has_pin: true } });
};

/* DELETE /api/auth/approval-pin { password } */
export const clearPin = async (req, res) => {
  if (!(await checkPassword(req, req.body?.password))) return bad(res, 'Your password is not right.', 403);
  await pool.query(`UPDATE users SET approval_pin_hash = NULL, approval_pin_set_at = NULL WHERE user_id = $1`, [req.auth.userId]);
  recordAudit(req, { action: 'approval.pin_removed', resource_type: 'user', resource_id: req.auth.userId, business_id: req.memberships[0]?.business_id });
  res.json({ success: true, data: { has_pin: false } });
};
