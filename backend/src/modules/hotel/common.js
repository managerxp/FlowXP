/*
 * Shared plumbing for the hotel module: its error type, the HOTEL-only guard, date helpers and the property (outlet) record.
 *
 * Request-body checks (text, money, isoDate...) are the salon module's, shared as they are. They throw SalonError, which `wrap` here treats as a
 * client mistake (400) the same as a HotelError.
 *
 * One outlet (branch) is one property: it has its own business date, the hotel's "today", which only night audit moves on. Rooms, rates,
 * bookings and reports all hang off the outlet.
 */
import { addDaysISO, businessToday } from '../../utils/dates.js';

export { text, int, num, money, oneOf, bool, isoDate, idList, phone, paging, like, audit, diff, ok, page } from '../salon/common.js';

export class HotelError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'HotelError';
    this.status = status;
    Object.assign(this, extra);
  }
}

const CLIENT_ERRORS = new Set(['HotelError', 'SalonError', 'BillingError']);

export const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    if (CLIENT_ERRORS.has(error?.name) && Number.isInteger(error.status)) {
      return res.status(error.status).json({ success: false, message: error.message, ...(error.code && typeof error.code === 'string' ? { code: error.code } : {}), ...(error.data ? { data: error.data } : {}) });
    }
    if (error?.code === '22P02') return res.status(404).json({ success: false, message: 'Not found' });
    if (['22003', '22007', '22008'].includes(error?.code)) return res.status(400).json({ success: false, message: 'One of the values is not valid' });
    if (error?.code === '23505') return res.status(409).json({ success: false, message: 'That already exists' });
    throw error;
  }
};

export const wrapAll = (handlers) => Object.fromEntries(Object.entries(handlers).map(([k, fn]) => [k, wrap(fn)]));

/** Hotel endpoints exist only for a hotel: any other business type gets the same answer as a missing route. */
export const hotelOnly = (req, res, next) => {
  if (req.tenant?.businessType !== 'HOTEL') return res.status(404).json({ success: false, message: 'Not found' });
  next();
};

/** Add rupees beside every paise figure: `balance_paise: 1250` also gets `balance: 12.5`, and numeric strings from the database become numbers. */
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

/* ── dates ─────────────────────────────────────────────────────────────── */

export { addDaysISO };

/** The nights of a stay: arrival, arrival + 1 ... the day before departure. */
export const nightsOf = (arrival, departure) => {
  const out = [];
  for (let d = arrival; d < departure; d = addDaysISO(d, 1)) out.push(d);
  return out;
};

export const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);

/** 0 = Sunday ... 6 = Saturday, for a YYYY-MM-DD date. */
export const weekday = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();

export const MAX_STAY_NIGHTS = 120;
export const MAX_ROOMS_PER_BOOKING = 30;

/* ── the property ───────────────────────────────────────────────────────── */

/** The property record of this outlet, made on first use (the business date starts at the real calendar day). */
export const getProperty = async (db, tenant, { lock = false } = {}) => {
  const read = () => db.query(`SELECT * FROM hotel_properties WHERE branch_id = $1${lock ? ' FOR UPDATE' : ''}`, [tenant.branchId]);
  let { rows } = await read();
  if (!rows.length) {
    const today = await businessToday(tenant.businessId, db);
    await db.query(`INSERT INTO hotel_properties (branch_id, business_id, business_date) VALUES ($1,$2,$3) ON CONFLICT (branch_id) DO NOTHING`, [tenant.branchId, tenant.businessId, today]);
    ({ rows } = await read());
  }
  return rows[0];
};

/** The GST rate on a night's room tariff: the slab it falls in. */
export const roomTaxRate = (property, ratePaise) => (Number(ratePaise) <= Number(property.tax_threshold_paise) ? Number(property.tax_low_pct) : Number(property.tax_high_pct));

/**
 * What has really been paid, by method, once refunds are taken off. A refund comes off the same method first (cash refunded against cash paid), then off whichever
 * method has most left, so a cheque advance refunded by bank transfer still shrinks what goes on the invoice. rows: [{ method, kind, amount_paise }].
 */
export const netByMethod = (rows) => {
  const paid = new Map(); let refunds = 0; const refundBy = new Map();
  for (const r of rows) {
    const n = Number(r.amount_paise);
    if (r.kind === 'REFUND') { refunds += n; refundBy.set(r.method, (refundBy.get(r.method) || 0) + n); } else paid.set(r.method, (paid.get(r.method) || 0) + n);
  }
  for (const [method, amount] of refundBy) { const take = Math.min(amount, paid.get(method) || 0); if (take) { paid.set(method, paid.get(method) - take); refunds -= take; } }
  while (refunds > 0) {
    const [method, left] = [...paid.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    if (!method || left <= 0) break;
    const take = Math.min(refunds, left); paid.set(method, left - take); refunds -= take;
  }
  return [...paid.entries()].filter(([, v]) => v > 0).map(([method, paise]) => ({ method, paise }));
};

export const MEAL_PLANS = ['EP', 'CP', 'MAP', 'AP'];
export const MEAL_PLAN_NAMES = { EP: 'Room only', CP: 'With breakfast', MAP: 'Breakfast and one meal', AP: 'All meals' };
export const BOOKING_SOURCES = ['WALK_IN', 'PHONE', 'EMAIL', 'WEBSITE', 'CORPORATE', 'TRAVEL_AGENT', 'BOOKING_COM', 'MAKEMYTRIP', 'GOIBIBO', 'AGODA', 'EXPEDIA', 'AIRBNB', 'OTHER'];
export const DEPARTMENTS = ['ROOM', 'FNB', 'LAUNDRY', 'SPA', 'BANQUET', 'TRANSPORT', 'MISC'];
export const DEPARTMENT_NAMES = { ROOM: 'Rooms', FNB: 'Food and beverage', LAUNDRY: 'Laundry', SPA: 'Spa', BANQUET: 'Banquet', TRANSPORT: 'Transport', MISC: 'Other' };
export const FOLIO_METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'OTHER', 'CREDIT'];
