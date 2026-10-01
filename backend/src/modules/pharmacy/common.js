/*
 * Shared plumbing for the pharmacy module.
 *
 * Reuses the genuinely vertical-agnostic pieces of modules/wholesale/common.js (transactions, number series,
 * rounding, audit) rather than copying them — wholesale_counters and withTransaction() carry no wholesale-only
 * semantics, they're just plumbing that happened to be built there first. Field validators are the same ones
 * salon and wholesale already share (modules/salon/common.js).
 */
import { SalonError, bool, idList, int, isoDate, like, money, num, oneOf, page, paging, phone, text } from '../salon/common.js';
import { nextNumber, q3, today, addDays, withTransaction, audit, diff } from '../wholesale/common.js';

export { SalonError, bool, idList, int, isoDate, like, money, num, oneOf, page, paging, phone, text };
export { nextNumber, q3, today, addDays, withTransaction, audit, diff };

export class PharmacyError extends Error {
  constructor(status, message, extra = {}) { super(message); this.name = 'PharmacyError'; this.status = status; Object.assign(this, extra); }
}

const CLIENT_ERRORS = new Set(['SalonError', 'PharmacyError']);

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

/** Pharmacy endpoints exist only for a PHARMACY business. Anyone else gets the answer a missing route gives. */
export const pharmacyOnly = (req, res, next) => {
  if (req.tenant?.businessType !== 'PHARMACY') return res.status(404).json({ success: false, message: 'Not found' });
  next();
};

export const DEFAULT_SETTINGS = {
  fefo: true, negative_stock: 'BLOCK', expiry_alert_days: [30, 60, 90, 180], warranty_alert_days: [30, 60],
  low_stock_alert: true, adjustment_approval_over_qty: null, invoice_prefix: 'INV', grn_prefix: 'GRN', rx_prefix: 'RX'
};

export const getSettings = async (db, businessId) => {
  const row = (await db.query(`SELECT * FROM pharmacy_settings WHERE business_id = $1`, [businessId])).rows[0] || {};
  const merged = { ...DEFAULT_SETTINGS, ...row };
  merged.expiry_alert_days = (Array.isArray(merged.expiry_alert_days) ? merged.expiry_alert_days : DEFAULT_SETTINGS.expiry_alert_days).map(Number).sort((a, b) => a - b);
  merged.warranty_alert_days = (Array.isArray(merged.warranty_alert_days) ? merged.warranty_alert_days : DEFAULT_SETTINGS.warranty_alert_days).map(Number).sort((a, b) => a - b);
  return merged;
};
