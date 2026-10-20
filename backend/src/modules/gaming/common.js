/*
 * Shared plumbing for the gaming lounge module: its error type, the GAMING_CAFE-only guard, the lounge's own clock, settings, and the catalogue
 * products the time lines on a tab use.
 *
 * Request-body checks (text, money, int ...) are the salon module's, shared as they are; they throw SalonError, which `wrap` treats as a client
 * mistake (400) the same as a GamingError.
 *
 * TIME. The lounge's "today", weekday and time of day are in the business's own timezone (businesses.timezone). Pricing places every second in that
 * zone with Intl (see pricing.js); reports and "today" ask Postgres to convert. The clock is a parameter (`now`) everywhere, which is how the tests
 * run a session across a peak-hour edge or midnight.
 */
import pool from '../../config/database.js';
import { RateError } from './pricing.js';

export { text, int, num, money, oneOf, bool, isoDate, clock, idList, phone, paging, like, audit, diff, ok, page } from '../salon/common.js';

export class GamingError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'GamingError';
    this.status = status;
    Object.assign(this, extra);
  }
}

const CLIENT_ERRORS = new Set(['GamingError', 'SalonError', 'BillingError', 'PointsError', 'CouponError', 'RateError', 'TabError']);

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

/** Gaming endpoints exist only for a gaming lounge: any other business type gets the same answer as a missing route. */
export const gamingOnly = (req, res, next) => {
  if (req.tenant?.businessType !== 'GAMING_CAFE') return res.status(404).json({ success: false, message: 'Not found' });
  next();
};

export { RateError };

export const STATION_KINDS = ['CONSOLE', 'VR', 'POOL', 'SNOOKER', 'TABLE_GAME', 'OTHER'];
export const KIND_LABELS = { CONSOLE: 'Console', VR: 'VR', POOL: 'Pool table', SNOOKER: 'Snooker table', TABLE_GAME: 'Table game', OTHER: 'Other' };

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

export const timezoneOf = async (db, businessId) =>
  (await db.query(`SELECT COALESCE(timezone, 'Asia/Kolkata') AS tz FROM businesses WHERE business_id = $1`, [businessId])).rows[0]?.tz || 'Asia/Kolkata';

/** The lounge's local calendar day at an instant, as YYYY-MM-DD. */
export const localDate = async (db, businessId, at = new Date()) =>
  (await db.query(`SELECT to_char($2::timestamptz AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata'), 'YYYY-MM-DD') AS d`, [businessId, at])).rows[0].d;

/** The business's gaming settings, made on first use with the defaults. */
export const getSettings = async (db, businessId) => {
  await db.query(`INSERT INTO gaming_settings (business_id) VALUES ($1) ON CONFLICT (business_id) DO NOTHING`, [businessId]);
  return (await db.query(`SELECT * FROM gaming_settings WHERE business_id = $1`, [businessId])).rows[0];
};

/**
 * The catalogue product a kind of line is billed as ("Gaming time"), made on first use. It is a SERVICE (so it never appears on the menu, the
 * till or the QR menu, and tracks no stock) and carries the GST rate from the settings; a line's own price is the charge worked out for the session.
 */
export const ensureProduct = async (db, businessId, which = 'time') => {
  const column = which === 'tournament' ? 'tournament_product_id' : 'time_product_id';
  const name = which === 'tournament' ? 'Tournament entry' : 'Gaming time';
  const settings = await getSettings(db, businessId);
  if (settings[column]) {
    const live = (await db.query(`SELECT product_id FROM products WHERE product_id = $1 AND business_id = $2`, [settings[column], businessId])).rows[0];
    if (live) return live.product_id;
  }
  const taken = (await db.query(`SELECT product_id FROM products WHERE business_id = $1 AND kind = 'SERVICE' AND lower(name) = lower($2) ORDER BY product_id LIMIT 1`, [businessId, name])).rows[0];
  const id = taken?.product_id ?? (await db.query(
    `INSERT INTO products (business_id, name, unit, selling_price_paise, purchase_price_paise, tax_rate, track_inventory, kind, description)
     VALUES ($1,$2,'session',0,0,$3,FALSE,'SERVICE',$4) RETURNING product_id`,
    [businessId, name, settings.gst_rate, which === 'tournament' ? 'Entry fee, billed by the gaming module' : 'Time and frames at a gaming station, billed by the gaming module'])).rows[0].product_id;
  await db.query(`UPDATE gaming_settings SET ${column} = $2, updated_at = now() WHERE business_id = $1`, [businessId, id]);
  return id;
};
