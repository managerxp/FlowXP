/*
 * Shared plumbing for the gym module: its error type, the GYM-only guard, the gym's own clock, and small helpers.
 *
 * Request-body checks (text, money, isoDate ...) are the salon module's, shared as they are; they throw SalonError, which `wrap` treats as a
 * client mistake (400) the same as a GymError.
 *
 * TIME. A gym's "today" and "now" are in the business's own timezone (businesses.timezone). Everything that decides access, a freeze, an
 * expiry or a report day reads it through `localParts`, which asks Postgres to convert, so daylight-saving changes are handled by the
 * zone database and not by hand. The clock is a parameter everywhere (`now`), which is how the tests put a scan at 23:59 and 00:01.
 */
import crypto from 'node:crypto';
import pool from '../../config/database.js';

export { text, int, num, money, oneOf, bool, isoDate, clock, idList, phone, paging, like, audit, diff, ok, page } from '../salon/common.js';

export class GymError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'GymError';
    this.status = status;
    Object.assign(this, extra);
  }
}

const CLIENT_ERRORS = new Set(['GymError', 'SalonError', 'BillingError', 'PointsError', 'CouponError']);

export const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    if (CLIENT_ERRORS.has(error?.name) && Number.isInteger(error.status)) {
      return res.status(error.status).json({ success: false, message: error.message, ...(typeof error.code === 'string' && error.code ? { code: error.code } : {}), ...(error.data ? { data: error.data } : {}) });
    }
    if (error?.code === '22P02') return res.status(404).json({ success: false, message: 'Not found' });
    if (['22003', '22007', '22008'].includes(error?.code)) return res.status(400).json({ success: false, message: 'One of the values is not valid' });
    if (error?.code === '23505') return res.status(409).json({ success: false, message: 'That already exists' });
    throw error;
  }
};

export const wrapAll = (handlers) => Object.fromEntries(Object.entries(handlers).map(([k, fn]) => [k, wrap(fn)]));

/** Gym endpoints exist only for a gym: any other business type gets the same answer as a missing route. */
export const gymOnly = (req, res, next) => {
  if (req.tenant?.businessType !== 'GYM') return res.status(404).json({ success: false, message: 'Not found' });
  next();
};

/** Add rupees beside every paise figure, and turn numeric strings from the database into numbers. */
export const withRupees = (v) => {
  if (Array.isArray(v)) return v.map(withRupees);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) {
      if (k.endsWith('_paise') && x != null && x !== '' && !Number.isNaN(Number(x))) { o[k] = Number(x); o[k.slice(0, -6)] = Number(x) / 100; } else o[k] = withRupees(x);
    }
    return o;
  }
  return v;
};

/* ── the gym's own clock ───────────────────────────────────────────────────────────────────── */

/**
 * The gym's local calendar day, weekday (0 = Sunday) and minutes since midnight at an instant. `at` is a Date (default: now).
 * Postgres does the zone arithmetic, so a day with 23 or 25 hours is still one calendar day.
 */
export const localParts = async (db, businessId, at = new Date()) => {
  const r = (await db.query(
    `SELECT to_char(n, 'YYYY-MM-DD') AS d, EXTRACT(DOW FROM n)::int AS dow, (EXTRACT(HOUR FROM n) * 60 + EXTRACT(MINUTE FROM n))::int AS minutes
     FROM (SELECT $2::timestamptz AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata') AS n) t`,
    [businessId, at])).rows[0];
  return { date: r.d, dow: r.dow, minutes: r.minutes };
};

export const addDays = (date, n) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
export const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
export const toMinutes = (clock) => { const [h, m] = String(clock).split(':').map(Number); return h * 60 + m; };

/** Is `minutes` inside a from-to window? A window that runs past midnight (22:00 to 02:00) wraps. */
export const inWindow = (minutes, from, to) => {
  const a = toMinutes(from); const b = toMinutes(to);
  if (a === b) return true;                     // the same time twice reads as all day
  return a < b ? minutes >= a && minutes < b : minutes >= a || minutes < b;
};

/* ── identity and secrets ──────────────────────────────────────────────────────────────────── */

export const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

/** A random URL-safe token with `bytes` of entropy (24 bytes = 192 bits). */
export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

/** Compare two strings in constant time. */
export const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** The last 10 digits of a phone number, which is what two spellings of one Indian number share ("+91 98765 43210" and "9876543210"). */
export const phoneKey = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

export const SQL_PHONE_KEY = (column) => `right(regexp_replace(COALESCE(${column}, ''), '\\D', '', 'g'), 10)`;

/* ── settings ──────────────────────────────────────────────────────────────────────────────── */

/** The business's gym settings, made on first use with the defaults. */
export const getSettings = async (db, businessId) => {
  await db.query(`INSERT INTO gym_settings (business_id) VALUES ($1) ON CONFLICT (business_id) DO NOTHING`, [businessId]);
  return (await db.query(`SELECT * FROM gym_settings WHERE business_id = $1`, [businessId])).rows[0];
};

/** The outlet's gym settings (hours, holidays, entrance QR token), made on first use. */
export const getBranchSettings = async (db, businessId, branchId) => {
  await db.query(
    `INSERT INTO gym_branch_settings (branch_id, business_id, checkin_token) VALUES ($1,$2,$3) ON CONFLICT (branch_id) DO NOTHING`,
    [branchId, businessId, randomToken(16)]);
  return (await db.query(`SELECT * FROM gym_branch_settings WHERE branch_id = $1 AND business_id = $2`, [branchId, businessId])).rows[0];
};

export const MEMBER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED'];
export const PLAN_KINDS = ['MEMBERSHIP', 'PT_PACK', 'CLASS_PACK'];
export const AUDIENCES = ['STANDARD', 'STUDENT', 'FAMILY', 'CORPORATE'];
export const PAYMENT_POLICIES = ['FULL_REQUIRED', 'ANY_PAYMENT', 'PAY_LATER'];

/** The shortest pool query helper, so a caller without a transaction can still write `await q(sql, params)`. */
export const q = (sql, params) => pool.query(sql, params);

/** Run `fn(client)` in one transaction: committed if it returns, rolled back if it throws. */
export const inTx = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};
