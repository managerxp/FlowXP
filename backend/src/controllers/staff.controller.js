/*
 * Staff: who works in this business, in what role, at which outlet.
 *
 * Rules that keep this from becoming a privilege-escalation door:
 *   - needs the 'settings' permission (OWNER, ADMIN)
 *   - only an OWNER may create, change or remove an OWNER or ADMIN
 *   - nobody edits their own role, outlet or status
 *   - the last active OWNER can never be demoted or disabled
 *   - owners and admins always cover every outlet; floor roles are always pinned to one
 * Every lookup and write is scoped to req.tenant.businessId.
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import pool from '../config/database.js';
import { ROLE_PERMISSIONS } from '../middleware/auth.js';
import { recordAudit } from '../modules/events.js';
import { sendStaffInvite } from '../modules/mailer.js';
import { checkEmail, checkName, firstError, normaliseEmail } from '../utils/validate.js';
import { PERMISSIONS, cleanOverrides, describePermissions } from '../modules/permissions.js';

const ROLES = Object.keys(ROLE_PERMISSIONS);
const GROUP_ROLES = ['OWNER', 'ADMIN'];                    // always see every outlet
const FLOOR_ROLES = ['CASHIER', 'STAFF', 'WAITER', 'KITCHEN'];   // always pinned to one outlet
const PRIVILEGED = ['OWNER', 'ADMIN'];
const INVITE_TTL_MS = 3 * 24 * 60 * 60 * 1000;

const deny = (res, message, status = 403) => res.status(status).json({ success: false, message });

/* GET /api/staff */
export const list = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.user_id, u.name, u.email, u.phone, bu.role, bu.status, bu.branch_id, b.name AS branch_name, bu.permissions
     FROM business_users bu JOIN users u ON u.user_id = bu.user_id LEFT JOIN branches b ON b.branch_id = bu.branch_id
     WHERE bu.business_id = $1 ORDER BY bu.status, u.name`,
    [req.tenant.businessId]
  );
  res.json({ success: true, data: rows.map(({ permissions, ...r }) => ({ ...r, is_you: r.user_id === req.auth.userId, custom_permissions: Object.keys(permissions || {}).length })) });
};

/* Work out the outlet a membership must have, or an error message. */
const resolveBranch = async (businessId, role, requested) => {
  if (GROUP_ROLES.includes(role)) return { branchId: null };
  const wanted = requested === '' || requested === undefined ? null : requested;
  if (wanted == null) {
    if (!FLOOR_ROLES.includes(role)) return { branchId: null };   // managers may cover the group
    const primary = (await pool.query(`SELECT branch_id FROM branches WHERE business_id = $1 AND status = 'ACTIVE' ORDER BY is_primary DESC, branch_id LIMIT 1`, [businessId])).rows[0];
    return { branchId: primary?.branch_id ?? null };
  }
  const ok = (await pool.query(`SELECT 1 FROM branches WHERE branch_id = $1 AND business_id = $2 AND status = 'ACTIVE'`, [Number(wanted), businessId])).rows.length;
  return ok ? { branchId: Number(wanted) } : { error: 'Choose one of your active outlets' };
};

const activeOwners = async (businessId) =>
  Number((await pool.query(`SELECT COUNT(*) AS n FROM business_users WHERE business_id = $1 AND role = 'OWNER' AND status = 'ACTIVE'`, [businessId])).rows[0].n);

/* POST /api/staff — add a person; a new one gets an email to set their password */
export const invite = async (req, res) => {
  const body = req.body || {};
  const email = normaliseEmail(body.email);
  const role = String(body.role || '').toUpperCase();
  const error = firstError([checkEmail(email), checkName(body.name, 'Name')]);
  if (error) return deny(res, error, 400);
  if (!ROLES.includes(role)) return deny(res, 'Choose a valid role', 400);
  if (PRIVILEGED.includes(role) && req.tenant.role !== 'OWNER') return deny(res, 'Only the owner can add an owner or admin');

  const { branchId, error: branchError } = await resolveBranch(req.tenant.businessId, role, body.branch_id);
  if (branchError) return deny(res, branchError, 400);

  const limit = (await pool.query(`SELECT p.limits FROM businesses b JOIN plans p ON p.plan_code = b.plan_code WHERE b.business_id = $1`, [req.tenant.businessId])).rows[0]?.limits?.users;
  if (limit != null) {
    const n = Number((await pool.query(`SELECT COUNT(*) AS n FROM business_users WHERE business_id = $1 AND status = 'ACTIVE'`, [req.tenant.businessId])).rows[0].n);
    if (n >= Number(limit)) return deny(res, `Your plan includes ${limit} users. Upgrade to add more people.`, 402);
  }

  const client = await pool.connect();
  let user; let created = false;
  try {
    await client.query('BEGIN');
    user = (await client.query(`SELECT user_id, name, email FROM users WHERE email = $1`, [email])).rows[0];
    if (!user) {
      // A random password nobody knows: the person sets their own through the emailed link.
      const hash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);
      user = (await client.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3) RETURNING user_id, name, email`, [String(body.name).trim(), email, hash])).rows[0];
      created = true;
    }
    const existing = (await client.query(`SELECT status FROM business_users WHERE business_id = $1 AND user_id = $2`, [req.tenant.businessId, user.user_id])).rows[0];
    if (existing) { await client.query('ROLLBACK'); return deny(res, 'This person is already on your team', 409); }
    await client.query(`INSERT INTO business_users (business_id, user_id, role, branch_id, status) VALUES ($1,$2,$3,$4,'ACTIVE')`, [req.tenant.businessId, user.user_id, role, branchId]);

    let token = null;
    if (created) {
      token = crypto.randomBytes(32).toString('hex');
      await client.query(`INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1,$2,$3)`, [crypto.createHash('sha256').update(token).digest('hex'), user.user_id, new Date(Date.now() + INVITE_TTL_MS)]);
    }
    await client.query('COMMIT');
    recordAudit(req, { action: 'staff.added', resource_type: 'user', resource_id: user.user_id, metadata: { role, branch_id: branchId } });
    await sendStaffInvite(user.email, user.name, req.tenant.name, token);
    res.status(201).json({ success: true, data: { user_id: user.user_id, invited: created } });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
};

/* PUT /api/staff/:userId — role, outlet, active/disabled */
export const update = async (req, res) => {
  const userId = Number(req.params.userId);
  const body = req.body || {};
  if (userId === req.auth.userId) return deny(res, 'You can’t change your own role or access');

  const target = (await pool.query(`SELECT role, status, branch_id FROM business_users WHERE business_id = $1 AND user_id = $2`, [req.tenant.businessId, userId])).rows[0];
  if (!target) return deny(res, 'Not found', 404);
  if (PRIVILEGED.includes(target.role) && req.tenant.role !== 'OWNER') return deny(res, 'Only the owner can change an owner or admin');

  const role = body.role !== undefined ? String(body.role).toUpperCase() : target.role;
  if (!ROLES.includes(role)) return deny(res, 'Choose a valid role', 400);
  if (PRIVILEGED.includes(role) && req.tenant.role !== 'OWNER') return deny(res, 'Only the owner can make someone an owner or admin');
  const status = body.status !== undefined ? body.status : target.status;
  if (!['ACTIVE', 'DISABLED'].includes(status)) return deny(res, 'Status must be ACTIVE or DISABLED', 400);

  if (target.role === 'OWNER' && (role !== 'OWNER' || status !== 'ACTIVE') && (await activeOwners(req.tenant.businessId)) <= 1) {
    return deny(res, 'A business needs at least one active owner', 409);
  }

  const requested = body.branch_id !== undefined ? body.branch_id : (role === target.role ? target.branch_id : null);
  const { branchId, error } = await resolveBranch(req.tenant.businessId, role, requested);
  if (error) return deny(res, error, 400);

  await pool.query(`UPDATE business_users SET permissions = CASE WHEN role <> $1 THEN '{}'::jsonb ELSE permissions END, role = $1, status = $2, branch_id = $3 WHERE business_id = $4 AND user_id = $5`, [role, status, branchId, req.tenant.businessId, userId]);
  recordAudit(req, { action: 'staff.updated', resource_type: 'user', resource_id: userId, metadata: { role, status, branch_id: branchId } });
  res.json({ success: true });
};

/* ==========================================================================
   GET/PUT /api/staff/:userId/permissions — what this person may do beyond (or
   short of) their role. Owner only: a manager who could edit permissions could
   give themselves anything. Owners always have everything, so theirs are not editable.
   ========================================================================== */
const target = async (req) => {
  const row = (await pool.query(`SELECT role, permissions FROM business_users WHERE business_id = $1 AND user_id = $2`, [req.tenant.businessId, Number(req.params.userId)])).rows[0];
  return row ? { role: row.role, overrides: row.permissions || {} } : null;
};

export const getPermissions = async (req, res) => {
  const t = await target(req);
  if (!t) return deny(res, 'Not found', 404);
  res.json({ success: true, data: { role: t.role, editable: t.role !== 'OWNER', permissions: describePermissions(t.role, t.overrides) } });
};

export const putPermissions = async (req, res) => {
  const userId = Number(req.params.userId);
  if (userId === req.auth.userId) return deny(res, 'You can’t change your own permissions');
  const t = await target(req);
  if (!t) return deny(res, 'Not found', 404);
  if (t.role === 'OWNER') return deny(res, 'Owners always have every permission');

  const { overrides, error } = cleanOverrides(t.role, req.body?.permissions, t.overrides);
  if (error) return deny(res, error, 400);

  await pool.query(`UPDATE business_users SET permissions = $1::jsonb WHERE business_id = $2 AND user_id = $3`, [JSON.stringify(overrides), req.tenant.businessId, userId]);
  const changes = {};
  for (const key of PERMISSIONS) {
    const before = typeof t.overrides[key] === 'boolean' ? (t.overrides[key] ? 'allowed' : 'denied') : 'role default';
    const after = typeof overrides[key] === 'boolean' ? (overrides[key] ? 'allowed' : 'denied') : 'role default';
    if (before !== after) changes[key] = after;
  }
  recordAudit(req, { action: 'staff.permissions_updated', resource_type: 'user', resource_id: userId, metadata: { changes } });
  res.json({ success: true, data: { permissions: describePermissions(t.role, overrides) } });
};
