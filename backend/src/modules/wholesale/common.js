/*
 * Shared plumbing for the wholesale module: the error type, the request wrapper, number series, and the settings
 * lookup. Field validators are the same ones the salon module uses (modules/salon/common.js) — one set of rules for
 * "a rupee amount", "a date", "a short text" across the product.
 */
import pool from '../../config/database.js';
import { recordAudit } from '../events.js';
import {
  SalonError, bool, idList, int, isoDate, like, money, num, oneOf, page, paging, phone, text
} from '../salon/common.js';

export { SalonError, bool, idList, int, isoDate, like, money, num, oneOf, page, paging, phone, text };

export class WholesaleError extends Error {
  constructor(status, message, extra = {}) { super(message); this.name = 'WholesaleError'; this.status = status; Object.assign(this, extra); }
}

const CLIENT_ERRORS = new Set(['SalonError', 'WholesaleError', 'BillingError', 'PointsError', 'CouponError', 'TransferError', 'NoteError']);

export const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    if (CLIENT_ERRORS.has(error?.name) && Number.isInteger(error.status)) {
      return res.status(error.status).json({ success: false, message: error.message, ...(error.code ? { code: error.code } : {}), ...(error.data ? { data: error.data } : {}) });
    }
    if (error?.code === '22P02') return res.status(404).json({ success: false, message: 'Not found' });
    if (['22003', '22007', '22008'].includes(error?.code)) return res.status(400).json({ success: false, message: 'One of the values is not valid' });
    throw error;
  }
};
export const wrapAll = (handlers) => Object.fromEntries(Object.entries(handlers).map(([k, fn]) => [k, wrap(fn)]));

export const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });

/** Wholesale endpoints exist only for wholesalers and distributors. Anyone else gets the answer a missing route gives. */
export const WHOLESALE_TYPES = ['WHOLESALE', 'DISTRIBUTOR'];
export const wholesaleOnly = (req, res, next) => {
  if (!WHOLESALE_TYPES.includes(req.tenant?.businessType)) return res.status(404).json({ success: false, message: 'Not found' });
  next();
};

export const audit = (req, action, resourceType, resourceId, before = null, after = null, extra = {}) =>
  recordAudit(req, {
    action, resource_type: resourceType, resource_id: resourceId,
    metadata: { ...(before != null ? { before } : {}), ...(after != null ? { after } : {}), ...extra }
  });

/** The fields that differ, as { field: { from, to } } — a compact audit payload. */
export const diff = (before, after) => {
  const out = {};
  for (const k of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) out[k] = { from: before?.[k] ?? null, to: after?.[k] ?? null };
  }
  return out;
};

/* ── number series ────────────────────────────────────────────────────────────────────────── */

/** The next number in a series, atomically (inside the caller's transaction): SO-00001, GRN-00042 ... */
export const nextNumber = async (client, businessId, kind, prefix = kind) => {
  const { rows } = await client.query(
    `INSERT INTO wholesale_counters (business_id, kind, next_number) VALUES ($1,$2,2)
     ON CONFLICT (business_id, kind) DO UPDATE SET next_number = wholesale_counters.next_number + 1
     RETURNING next_number - 1 AS n`, [businessId, kind]);
  return `${prefix}-${String(rows[0].n).padStart(5, '0')}`;
};

/* ── settings ─────────────────────────────────────────────────────────────────────────────── */

export const DEFAULT_SETTINGS = {
  credit_policy: 'WARN', block_when_overdue: false, overdue_grace_days: 0, default_payment_terms_days: 30, default_price_list_id: null,
  negative_stock: 'BLOCK', reserve_on_confirm: true, fefo: true, expiry_alert_days: [30, 60, 90], order_approval_over_paise: null,
  slow_moving_days: 60, dead_stock_days: 180, order_prefix: 'SO', invoice_footer: null, notifications: {}
};

export const getSettings = async (db, businessId) => {
  const row = (await db.query(`SELECT * FROM wholesale_settings WHERE business_id = $1`, [businessId])).rows[0] || {};
  const merged = { ...DEFAULT_SETTINGS, ...row };
  merged.expiry_alert_days = (Array.isArray(merged.expiry_alert_days) ? merged.expiry_alert_days : DEFAULT_SETTINGS.expiry_alert_days).map(Number).sort((a, b) => a - b);
  return merged;
};

export const today = async (db, businessId) => (await db.query(
  `SELECT ((CURRENT_TIMESTAMP AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata'))::date)::text AS d`, [businessId])).rows[0].d;

export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Round a quantity to the 3 decimals stock is kept in. */
export const q3 = (n) => Math.round(Number(n) * 1000) / 1000;

/** Run fn(client) in one transaction: commit when it returns, roll back when it throws. */
export const withTransaction = async (fn) => {
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
