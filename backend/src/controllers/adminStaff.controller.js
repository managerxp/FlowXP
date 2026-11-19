/*
 * Staff sign-ins for the Super Admin console: the owner adds a person with a role (modules/adminRoles.js), can change the role, turn the sign-in off and on, and set a
 * new temporary password. A new person gets a temporary password shown once; the console makes every admin turn on two-step verification before it shows anything.
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { ROLES, roleOf } from '../modules/adminRoles.js';
import { normaliseEmail } from '../utils/validate.js';

const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const tempPassword = () => Array.from(crypto.randomBytes(12), (b) => ALPHABET[b % ALPHABET.length]).join('');
const shape = (u) => ({
  user_id: u.user_id, name: u.name, email: u.email, role: roleOf(u) || u.admin_role, disabled: Boolean(u.admin_disabled),
  two_factor: Boolean(u.totp_enabled), last_login_at: u.last_login_at, created_at: u.created_at
});

/* GET /api/admin/staff */
export const list = async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT user_id, name, email, is_super_admin, admin_role, admin_disabled, totp_enabled, last_login_at, created_at
       FROM users WHERE is_super_admin ORDER BY admin_disabled, created_at`);
  res.json({ success: true, data: { staff: rows.map(shape), roles: Object.entries(ROLES).map(([key, r]) => ({ key, label: r.label, about: r.about, can: r.can })) } });
};

/* POST /api/admin/staff { name, email, role } */
export const create = async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 100);
  const email = normaliseEmail(req.body?.email || '');
  const role = String(req.body?.role || '');
  if (!name) return bad(res, 'Enter their name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 'Enter a valid email address.');
  if (!ROLES[role] || role === 'OWNER') return bad(res, 'Choose a role: Onboarding, Accounts or Support.');
  if ((await pool.query('SELECT 1 FROM users WHERE email = $1', [email])).rows.length) return bad(res, 'That email already has a FlowXP account. Use a different email for the staff sign-in.', 409);
  const password = tempPassword();
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, email_verified, is_super_admin, admin_role)
     VALUES ($1, $2, $3, TRUE, TRUE, $4) RETURNING user_id, name, email, is_super_admin, admin_role, admin_disabled, totp_enabled, last_login_at, created_at`,
    [name, email, await bcrypt.hash(password, 12), role]);
  recordAudit(req, { action: 'admin.staff_added', resource_type: 'user', resource_id: rows[0].user_id, metadata: { email, role } });
  res.status(201).json({ success: true, data: { ...shape(rows[0]), temporary_password: password } });
};

/* PATCH /api/admin/staff/:id { role?, disabled?, reset_password? } */
export const update = async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.auth.userId) return bad(res, 'You cannot change your own access. Ask another owner.', 409);
  const u = (await pool.query('SELECT user_id, is_super_admin, admin_role, admin_disabled FROM users WHERE user_id = $1', [id])).rows[0];
  if (!u || !u.is_super_admin) return bad(res, 'Staff member not found', 404);
  if (u.admin_role === 'OWNER' || !u.admin_role) return bad(res, 'An owner sign-in cannot be changed here.', 409);
  const sets = [];
  const values = [id];
  const add = (sql, v) => { values.push(v); sets.push(sql.replace('?', `$${values.length}`)); };
  let password = null;
  if (req.body?.role !== undefined) {
    if (!ROLES[req.body.role] || req.body.role === 'OWNER') return bad(res, 'Choose a role: Onboarding, Accounts or Support.');
    add('admin_role = ?', req.body.role);
  }
  if (req.body?.disabled !== undefined) add('admin_disabled = ?', req.body.disabled === true);
  if (req.body?.reset_password === true) { password = tempPassword(); add('password_hash = ?', await bcrypt.hash(password, 12)); }
  if (!sets.length) return bad(res, 'Nothing to change.');
  // any change ends their open sessions, so a new role or a switched-off sign-in takes effect now
  sets.push('token_version = token_version + 1');
  const { rows } = await pool.query(
    `UPDATE users SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1
     RETURNING user_id, name, email, is_super_admin, admin_role, admin_disabled, totp_enabled, last_login_at, created_at`, values);
  recordAudit(req, { action: 'admin.staff_changed', resource_type: 'user', resource_id: id, metadata: { role: req.body?.role, disabled: req.body?.disabled, password_reset: password !== null } });
  res.json({ success: true, data: { ...shape(rows[0]), ...(password && { temporary_password: password }) } });
};
