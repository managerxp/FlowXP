/*
 * Staff sign-ins for the Super Admin console: the owner adds a person with a role (modules/adminRoles.js), can change the role, turn the sign-in off and on, and sign them out.
 * Staff have no password: at each sign-in a code is emailed to them (admin.controller.js staffCode). That emailed code is their second factor, so the authenticator app is the owner's alone.
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { ROLES, roleOf } from '../modules/adminRoles.js';
import { normaliseEmail } from '../utils/validate.js';
import { sendMail } from '../modules/mailer.js';
import config from '../config/env.js';

const bad = (res, message, code = 400) => res.status(code).json({ success: false, message });
const unusablePassword = () => bcrypt.hash(crypto.randomBytes(24).toString('hex'), 12);   // nobody knows it: the column is required, staff sign in with a code
const shape = (u) => ({
  user_id: u.user_id, name: u.name, email: u.email, phone: u.phone || '', role: roleOf(u) || u.admin_role, disabled: Boolean(u.admin_disabled),
  two_factor: Boolean(u.totp_enabled), last_login_at: u.last_login_at, created_at: u.created_at
});

/* GET /api/admin/staff */
export const list = async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT user_id, name, email, phone, is_super_admin, admin_role, admin_disabled, totp_enabled, last_login_at, created_at
       FROM users WHERE is_super_admin ORDER BY admin_disabled, created_at`);
  res.json({ success: true, data: { staff: rows.map(shape), roles: Object.entries(ROLES).map(([key, r]) => ({ key, label: r.label, about: r.about, can: r.can })) } });
};

/* POST /api/admin/staff { name, email, phone?, role } */
export const create = async (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 100);
  const email = normaliseEmail(req.body?.email || '');
  const role = String(req.body?.role || '');
  if (!name) return bad(res, 'Enter their name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad(res, 'Enter a valid email address.');
  if (!ROLES[role] || role === 'OWNER') return bad(res, 'Choose a role: Onboarding, Accounts or Support.');
  // a phone number lets them sign in with it instead of the email: ten digits, and one person per number
  const phone = String(req.body?.phone || '').replace(/\D/g, '').slice(-10);
  if (req.body?.phone && phone.length !== 10) return bad(res, 'Enter a 10 digit mobile number, or leave it empty.');
  if (phone && (await pool.query(`SELECT 1 FROM users WHERE is_super_admin AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $1`, [phone])).rows.length) return bad(res, 'That number already belongs to another sign-in.', 409);
  if ((await pool.query('SELECT 1 FROM users WHERE email = $1', [email])).rows.length) return bad(res, 'That email already has a FlowXP account. Use a different email for the staff sign-in.', 409);
  const { rows } = await pool.query(
    `INSERT INTO users (name, email, password_hash, email_verified, is_super_admin, admin_role, phone)
     VALUES ($1, $2, $3, TRUE, TRUE, $4, $5) RETURNING user_id, name, email, phone, is_super_admin, admin_role, admin_disabled, totp_enabled, last_login_at, created_at`,
    [name, email, await unusablePassword(), role, phone || null]);
  recordAudit(req, { action: 'admin.staff_added', resource_type: 'user', resource_id: rows[0].user_id, metadata: { email, role } });
  // best effort: the person is told where to sign in; the code itself is only ever emailed at sign-in
  const url = `${config.appOrigin}/superadmin/login`;
  sendMail({ to: email, subject: 'You have been added to the FlowXP admin', text: `Hi ${name},\n\nYou have been added to the FlowXP admin as ${ROLES[role].label}.\n\nSign in at ${url}. The first time, choose "Email me a code" and enter the code we send. After that you can set a 4 digit PIN on that computer and sign in with just your PIN. There is no password to remember.\n\nFlowXP by ManagerXP` })
    .catch((error) => console.error('[admin] staff invite email failed:', error.message));
  res.status(201).json({ success: true, data: { ...shape(rows[0]), sign_in_url: url } });
};

/* PATCH /api/admin/staff/:id { role?, disabled?, sign_out? } */
export const update = async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.auth.userId) return bad(res, 'You cannot change your own access. Ask another owner.', 409);
  const u = (await pool.query('SELECT user_id, is_super_admin, admin_role, admin_disabled FROM users WHERE user_id = $1', [id])).rows[0];
  if (!u || !u.is_super_admin) return bad(res, 'Staff member not found', 404);
  if (u.admin_role === 'OWNER' || !u.admin_role) return bad(res, 'An owner sign-in cannot be changed here.', 409);
  const sets = [];
  const values = [id];
  const add = (sql, v) => { values.push(v); sets.push(sql.replace('?', `$${values.length}`)); };
  if (req.body?.role !== undefined) {
    if (!ROLES[req.body.role] || req.body.role === 'OWNER') return bad(res, 'Choose a role: Onboarding, Accounts or Support.');
    add('admin_role = ?', req.body.role);
  }
  if (req.body?.disabled !== undefined) add('admin_disabled = ?', req.body.disabled === true);
  if (!sets.length && req.body?.sign_out !== true) return bad(res, 'Nothing to change.');
  // any change ends their open sessions, so a new role or a switched-off sign-in takes effect now
  sets.push('token_version = token_version + 1');
  const { rows } = await pool.query(
    `UPDATE users SET ${sets.join(', ')}, email_otp_hash = NULL, email_otp_expires_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1
     RETURNING user_id, name, email, phone, is_super_admin, admin_role, admin_disabled, totp_enabled, last_login_at, created_at`, values);
  recordAudit(req, { action: 'admin.staff_changed', resource_type: 'user', resource_id: id, metadata: { role: req.body?.role, disabled: req.body?.disabled, signed_out: req.body?.sign_out === true } });
  res.json({ success: true, data: shape(rows[0]) });
};
