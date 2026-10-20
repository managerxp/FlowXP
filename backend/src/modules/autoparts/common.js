/*
 * Shared plumbing for the automotive spare parts module: its error type, the AUTO_PARTS-only guard, part-number normalising, and small helpers.
 *
 * Request-body checks (text, int, money ...) are the salon module's, shared as they are (they throw SalonError, which `wrap` treats as a client mistake).
 *
 * A spare part is a `products` row. Nothing here keeps a second copy of its name, price or stock.
 */
import pool from '../../config/database.js';

export { text, int, num, money, oneOf, bool, isoDate, idList, paging, like, audit, diff, ok, page } from '../salon/common.js';

export class PartsError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'PartsError';
    this.status = status;
    Object.assign(this, extra);
  }
}

const CLIENT_ERRORS = new Set(['PartsError', 'SalonError', 'BillingError', 'IdentityError', 'TabError', 'NoteError']);

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

export const PARTS_TYPES = ['AUTO_PARTS'];
/** Parts endpoints exist only for a parts shop: any other business type gets the same answer as a missing route. */
export const partsOnly = (req, res, next) => {
  if (!PARTS_TYPES.includes(req.tenant?.businessType)) return res.status(404).json({ success: false, message: 'Not found' });
  next();
};

export const CLASSIFICATIONS = ['OEM', 'AFTERMARKET', 'REFURBISHED', 'USED'];
export const VEHICLE_TYPES = ['CAR', 'BIKE', 'SCOOTER', 'TRUCK', 'BUS', 'COMMERCIAL', 'OTHER'];
export const NUMBER_KINDS = ['OEM', 'MFR', 'ALTERNATE', 'SUPPLIER', 'REPLACES'];
export const FITMENT_STATUS = ['VERIFIED', 'UNVERIFIED', 'NOT_FIT'];

/** The number a person types or a scanner reads, reduced to what identifies it: capitals and digits only. "04465-0K 280" and "044650k280" are one number. */
export const partKey = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** SQL for the same reduction, so a stored number can be compared to a typed one. */
export const SQL_PART_KEY = (column) => `upper(regexp_replace(COALESCE(${column}, ''), '[^A-Za-z0-9]', '', 'g'))`;

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

/** A product that belongs to this business, or a 404. */
export const ownedProduct = async (db, businessId, productId, { lock = false } = {}) => {
  const p = (await db.query(`SELECT * FROM products WHERE product_id = $1 AND business_id = $2${lock ? ' FOR UPDATE' : ''}`, [Number(productId), businessId])).rows[0];
  if (!p) throw new PartsError(404, 'Not found');
  return p;
};

/** The outlet this request works at, and a refusal for the "all outlets" view where a write needs one. */
export const scopeBranch = (tenant) => tenant.scopeBranchId ?? null;
