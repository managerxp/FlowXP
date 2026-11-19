/*
 * PIN sign-in on a known computer (migration 0141).
 *
 *   POST   /api/auth/pin            { pin }            signed in: set or change my PIN on this computer (gives the computer its device key)
 *   DELETE /api/auth/pin                                signed in: remove my PIN from this computer
 *   GET    /api/auth/pin/people                         anyone: who has a PIN on this computer (first name only), for the sign-in page
 *   POST   /api/auth/pin/login      { user_id, pin }   anyone: sign in with a PIN on this computer
 *   POST   /api/auth/pin/check      { pin }            signed in: the screen lock asks if this is my PIN
 *   GET    /api/auth/pin/devices                        signed in: the computers I have a PIN on
 *   DELETE /api/auth/pin/devices/:id                    signed in: remove my PIN from one of them
 *   GET    /api/business/pin-devices                    owner/admin: PIN computers of everyone in the business
 *   DELETE /api/business/pin-devices/:id                owner/admin: remove one (a sold laptop, someone who left)
 *
 * The device key lives in an httpOnly cookie the page cannot read; the database keeps only its hash. Without the cookie the PIN is useless,
 * and without the PIN the cookie is. Five wrong PINs revoke it; a password change or "sign out everywhere" (token_version) ends it;
 * 90 days unused and it expires.
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import pool from '../config/database.js';
import { cookieOptions, cookieValue } from '../middleware/auth.js';
import { recordAudit } from '../modules/events.js';
import { recordLogin } from '../modules/security.js';
import { finishLogin } from './auth.controller.js';

export const DEVICE_COOKIE = 'flowxp_device';
const DEVICE_DAYS = 365;          // the device key itself; each PIN on it lasts PIN_DAYS from its last use
const PIN_DAYS = 90;
export const MAX_TRIES = 5;
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const hash = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');
const validPin = (p) => /^\d{4}$/.test(String(p ?? ''));
/* a PIN that still opens: not revoked, used within PIN_DAYS, and set since the person last changed their password or signed out everywhere */
const LIVE = `p.revoked_at IS NULL AND p.last_used_at > now() - interval '${PIN_DAYS} days' AND p.token_version = u.token_version`;

export const deviceHash = (req) => { const key = cookieValue(req, DEVICE_COOKIE); return key && /^[A-Za-z0-9_-]{40,}$/.test(key) ? hash(key) : null; };
/** This computer's device key, made the first time a PIN is set on it. */
const ensureDevice = (req, res) => {
  const existing = deviceHash(req);
  if (existing) return existing;
  const key = crypto.randomBytes(32).toString('base64url');
  if (typeof res.cookie === 'function') res.cookie(DEVICE_COOKIE, key, { ...cookieOptions(), maxAge: DEVICE_DAYS * 86400000 });
  return hash(key);
};
const label = (req) => {
  const ua = String(req.headers['user-agent'] || '');
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /Linux/.test(ua) ? 'Linux' : /iPhone|iPad/.test(ua) ? 'iPhone or iPad' : '';
  return `${browser}${os ? ` on ${os}` : ''}`.slice(0, 120);
};

export const setPin = async (req, res) => {
  const pin = String(req.body?.pin ?? '');
  if (!validPin(pin)) return fail(res, 400, 'Enter 4 digits');
  if (/^(\d)\1{3}$/.test(pin) || ['1234', '4321', '0123', '9876'].includes(pin)) return fail(res, 400, 'Choose a PIN that is harder to guess');
  const device = ensureDevice(req, res);
  await pool.query(
    `INSERT INTO pin_logins (device_hash, user_id, pin_hash, token_version, device_label)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (device_hash, user_id) DO UPDATE SET pin_hash = EXCLUDED.pin_hash, token_version = EXCLUDED.token_version, device_label = EXCLUDED.device_label,
       failed_attempts = 0, revoked_at = NULL, last_used_at = CURRENT_TIMESTAMP`,
    [device, req.auth.userId, await bcrypt.hash(pin, 10), req.auth.user.token_version ?? 0, label(req)]);
  recordAudit(req, { user_id: req.auth.userId, action: 'user.pin_set', resource_type: 'user', resource_id: req.auth.userId, metadata: { device: label(req) } });
  res.json({ success: true });
};

export const removePin = async (req, res) => {
  const device = deviceHash(req);
  if (device) await pool.query(`UPDATE pin_logins SET revoked_at = CURRENT_TIMESTAMP WHERE device_hash = $1 AND user_id = $2 AND revoked_at IS NULL`, [device, req.auth.userId]);
  res.json({ success: true });
};

/* who can sign in with a PIN here: first names only, so a stranger at the counter learns no more than the names on the staff badges */
export const people = async (req, res) => {
  const device = deviceHash(req);
  if (!device) return res.json({ success: true, data: [] });
  const { rows } = await pool.query(
    `SELECT u.user_id, u.name, (p.user_id = (SELECT user_id FROM pin_logins x WHERE x.device_hash = $1 ORDER BY x.last_used_at DESC LIMIT 1)) AS last
     FROM pin_logins p JOIN users u ON u.user_id = p.user_id
     WHERE p.device_hash = $1 AND ${LIVE} AND NOT u.is_super_admin AND u.email_verified ORDER BY p.last_used_at DESC`, [device]);
  res.json({ success: true, data: rows.map((r) => ({ user_id: r.user_id, name: String(r.name || '').trim().split(/\s+/)[0] || 'User', last: r.last })) });
};

/* one try of a PIN on this computer: true, false, or null when there is no live PIN to try */
export const tryPin = async (req, device, userId, pin) => {
  const row = (await pool.query(
    `SELECT p.pin_login_id, p.pin_hash, p.failed_attempts FROM pin_logins p JOIN users u ON u.user_id = p.user_id
     WHERE p.device_hash = $1 AND p.user_id = $2 AND ${LIVE}`, [device, userId])).rows[0];
  if (!row) return null;
  if (validPin(pin) && await bcrypt.compare(String(pin), row.pin_hash)) {
    await pool.query(`UPDATE pin_logins SET failed_attempts = 0, last_used_at = CURRENT_TIMESTAMP WHERE pin_login_id = $1`, [row.pin_login_id]);
    return true;
  }
  const tries = row.failed_attempts + 1;
  await pool.query(`UPDATE pin_logins SET failed_attempts = $2::int, revoked_at = CASE WHEN $2::int >= $3::int THEN CURRENT_TIMESTAMP ELSE NULL END WHERE pin_login_id = $1`, [row.pin_login_id, tries, MAX_TRIES]);
  return MAX_TRIES - tries;   // tries left (0 = it is gone)
};
export const wrong = (left) => (left > 0 ? `That PIN is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong PINs. Sign in with your password; you can set a new PIN after.');

export const loginWithPin = async (req, res) => {
  const device = deviceHash(req);
  const userId = Number(req.body?.user_id);
  if (!device || !Number.isInteger(userId)) return fail(res, 401, 'Sign in with your password on this computer first.');
  try {
    const result = await tryPin(req, device, userId, req.body?.pin);
    const user = (await pool.query(`SELECT user_id, name, email, phone, email_verified, is_super_admin, token_version, totp_enabled FROM users WHERE user_id = $1`, [userId])).rows[0];
    if (result === null || !user || user.is_super_admin || !user.email_verified) return fail(res, 401, 'This PIN is no longer set up here. Sign in with your password.');
    if (result !== true) {
      await recordLogin(pool, { userId, email: user.email, req, outcome: 'BAD_PIN' });
      return res.status(401).json({ success: false, message: wrong(result), code: result > 0 ? 'PIN_WRONG' : 'PIN_REVOKED', tries_left: result, data: { tries_left: result } });
    }
    await finishLogin(req, res, user, 'PIN');
  } catch (error) {
    console.error('[auth] pin login failed:', error.message);
    fail(res, 500, 'Could not sign you in');
  }
};

/* the screen lock: is this my PIN? (same counter: five wrong ends the PIN, and the person signs in with the password) */
export const checkPin = async (req, res) => {
  const device = deviceHash(req);
  const result = device ? await tryPin(req, device, req.auth.userId, req.body?.pin) : null;
  if (result === null) return res.json({ success: true, data: { has_pin: false, ok: false } });
  res.json({ success: true, data: { has_pin: true, ok: result === true, tries_left: result === true ? MAX_TRIES : result } });
};

/* has this person got a live PIN on this computer? (the settings card and the offer after sign-in) */
export const myPinHere = async (req, res) => {
  const device = deviceHash(req);
  const row = device ? (await pool.query(`SELECT 1 FROM pin_logins p JOIN users u ON u.user_id = p.user_id WHERE p.device_hash = $1 AND p.user_id = $2 AND ${LIVE}`, [device, req.auth.userId])).rows[0] : null;
  res.json({ success: true, data: { has_pin: Boolean(row) } });
};

const asDevice = (r, device) => ({ id: r.pin_login_id, name: r.name, device: r.device_label || 'Browser', created_at: r.created_at, last_used_at: r.last_used_at, this_computer: r.device_hash === device });

export const myDevices = async (req, res) => {
  const { rows } = await pool.query(`SELECT p.*, u.name FROM pin_logins p JOIN users u ON u.user_id = p.user_id WHERE p.user_id = $1 AND ${LIVE} ORDER BY p.last_used_at DESC`, [req.auth.userId]);
  res.json({ success: true, data: rows.map((r) => asDevice(r, deviceHash(req))) });
};
export const removeMyDevice = async (req, res) => {
  await pool.query(`UPDATE pin_logins SET revoked_at = CURRENT_TIMESTAMP WHERE pin_login_id = $1 AND user_id = $2`, [req.params.id, req.auth.userId]);
  res.json({ success: true });
};

/* owners and admins: the PIN computers of everyone in this business */
export const businessDevices = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT p.*, u.name FROM pin_logins p JOIN users u ON u.user_id = p.user_id JOIN business_users bu ON bu.user_id = p.user_id AND bu.business_id = $1
     WHERE ${LIVE} ORDER BY u.name, p.last_used_at DESC`, [req.tenant.businessId]);
  res.json({ success: true, data: rows.map((r) => asDevice(r, deviceHash(req))) });
};
export const removeBusinessDevice = async (req, res) => {
  const { rowCount } = await pool.query(
    `UPDATE pin_logins p SET revoked_at = CURRENT_TIMESTAMP FROM business_users bu
     WHERE p.pin_login_id = $1 AND bu.user_id = p.user_id AND bu.business_id = $2 AND p.revoked_at IS NULL`, [req.params.id, req.tenant.businessId]);
  if (!rowCount) return fail(res, 404, 'Not found');
  recordAudit(req, { action: 'user.pin_removed_by_admin', resource_type: 'pin_login', resource_id: Number(req.params.id) });
  res.json({ success: true });
};
