/*
 * Shared plumbing for the salon module: one error type, request-body checks, paging and the audit helper.
 *
 * Controllers here follow the same shape as the rest of FlowXP (a function of req, res) but are wrapped by
 * `wrap()`, which turns a thrown SalonError (or BillingError / PointsError / CouponError, which carry an
 * HTTP status) into the JSON the client expects. Anything else is a bug and is rethrown to the server's own
 * error handler, which logs it and answers 500.
 */
import { recordAudit } from '../events.js';
import { toPaise } from '../../utils/money.js';

export class SalonError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'SalonError';
    this.status = status;
  }
}

/* Errors from shared modules that already carry an HTTP status and a message fit for the screen. */
const CLIENT_ERRORS = new Set(['SalonError', 'BillingError', 'PointsError', 'CouponError', 'ModifierError']);

export const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    if (CLIENT_ERRORS.has(error?.name) && Number.isInteger(error.status)) {
      return res.status(error.status).json({ success: false, message: error.message });
    }
    // a malformed id or value in the URL / body is the caller's mistake, not a server fault
    if (error?.code === '22P02') return res.status(404).json({ success: false, message: 'Not found' });
    if (['22003', '22007', '22008'].includes(error?.code)) return res.status(400).json({ success: false, message: 'One of the values is not valid' });
    throw error;
  }
};

/** Wrap every function in a controller module: `export default wrapAll({ list, create })`. */
export const wrapAll = (handlers) => Object.fromEntries(Object.entries(handlers).map(([k, fn]) => [k, wrap(fn)]));

export const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
export const page = (res, rows, total, { limit, offset }) => res.json({ success: true, data: rows, meta: { total, limit, offset } });

/** Salon endpoints exist only for a salon: any other business type gets the same answer as a missing route. */
export const salonOnly = (req, res, next) => {
  if (req.tenant?.businessType !== 'SALON') return res.status(404).json({ success: false, message: 'Not found' });
  next();
};

/* ── request-body checks: each throws SalonError(400) with a message fit to show ─────────────── */

const bad = (message) => new SalonError(400, message);

export const text = (value, field, { max = 120, required = false, min = 0 } = {}) => {
  const v = String(value ?? '').trim();
  if (!v) {
    if (required) throw bad(`${field} is required`);
    return null;
  }
  if (v.length < min) throw bad(`${field} is too short`);
  if (v.length > max) throw bad(`${field} is too long (${max} characters at most)`);
  return v;
};

export const int = (value, field, { min = -Infinity, max = Infinity, required = false } = {}) => {
  if (value == null || value === '') {
    if (required) throw bad(`${field} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${field} must be a whole number${Number.isFinite(min) && Number.isFinite(max) ? ` from ${min} to ${max}` : ''}`);
  return n;
};

export const num = (value, field, { min = -Infinity, max = Infinity, required = false } = {}) => {
  if (value == null || value === '') {
    if (required) throw bad(`${field} is required`);
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${field} must be a number${Number.isFinite(min) && Number.isFinite(max) ? ` from ${min} to ${max}` : ''}`);
  return n;
};

/** Rupees from the client -> integer paise. */
export const money = (value, field, { min = 0, required = false } = {}) => {
  if (value == null || value === '') {
    if (required) throw bad(`${field} is required`);
    return null;
  }
  let paise;
  try { paise = toPaise(value); } catch { throw bad(`${field} must be an amount`); }
  if (paise < min) throw bad(`${field} cannot be less than ${min / 100}`);
  if (paise > 100000000000) throw bad(`${field} is too large`);
  return paise;
};

export const oneOf = (value, field, allowed, { required = false, fallback = null } = {}) => {
  if (value == null || value === '') {
    if (required) throw bad(`${field} is required`);
    return fallback;
  }
  const v = String(value).toUpperCase();
  if (!allowed.includes(v)) throw bad(`${field} must be one of: ${allowed.join(', ')}`);
  return v;
};

export const bool = (value) => value === true || value === 'true' || value === 1 || value === '1';

export const isoDate = (value, field, { required = false } = {}) => {
  if (value == null || value === '') {
    if (required) throw bad(`${field} is required`);
    return null;
  }
  const v = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) throw bad(`${field} must be a date (YYYY-MM-DD)`);
  return v;
};

export const clock = (value, field, { required = false } = {}) => {
  if (value == null || value === '') {
    if (required) throw bad(`${field} is required`);
    return null;
  }
  const v = String(value).slice(0, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) throw bad(`${field} must be a time like 09:30`);
  return v;
};

export const timestamp = (value, field, { required = false } = {}) => {
  if (value == null || value === '') {
    if (required) throw bad(`${field} is required`);
    return null;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw bad(`${field} must be a date and time`);
  return d;
};

export const idList = (value, field, { max = 200 } = {}) => {
  if (value == null || value === '') return [];
  if (!Array.isArray(value)) throw bad(`${field} must be a list`);
  const ids = [...new Set(value.map(Number))];
  if (ids.some((n) => !Number.isInteger(n) || n <= 0)) throw bad(`${field} has an invalid entry`);
  if (ids.length > max) throw bad(`${field} has too many entries`);
  return ids;
};

/** Validate a phone like the rest of FlowXP (7-15 digits), returning the trimmed text or null. */
export const phone = (value, field = 'Phone') => {
  if (value == null || String(value).trim() === '') return null;
  const v = String(value).replace(/[\s-]/g, '');
  if (!/^\+?\d{7,15}$/.test(v)) throw bad(`Enter a valid ${field.toLowerCase()} number`);
  return String(value).trim().slice(0, 32);
};

/* ── paging, searching ─────────────────────────────────────────────────────────────────────── */

export const paging = (query, { max = 100, fallback = 25 } = {}) => {
  const limit = Math.min(max, Math.max(1, Number(query.limit) || fallback));
  const offset = Math.max(0, Number(query.offset) || 0);
  return { limit, offset };
};

/** `%term%` with LIKE wildcards in the term escaped, so "50%" searches for "50%" rather than everything. */
export const like = (term) => `%${String(term).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/* ── audit ─────────────────────────────────────────────────────────────────────────────────── */

/**
 * Record who did what to which record, with the value before and after. Unawaited and never throws (see
 * events.js): an audit failure must not fail the sale it describes.
 */
export const audit = (req, action, resourceType, resourceId, before = null, after = null, extra = {}) =>
  recordAudit(req, {
    action, resource_type: resourceType, resource_id: resourceId,
    metadata: { ...(before != null ? { before } : {}), ...(after != null ? { after } : {}), ...extra }
  });

/** The fields of `after` that differ from `before`, as { field: { from, to } } — a compact audit payload. */
export const diff = (before, after) => {
  const out = {};
  for (const key of Object.keys(after || {})) {
    if (JSON.stringify(before?.[key]) !== JSON.stringify(after[key])) out[key] = { from: before?.[key] ?? null, to: after[key] };
  }
  return out;
};
