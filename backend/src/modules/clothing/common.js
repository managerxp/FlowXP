/*
 * Shared plumbing for the clothing module: its error type, the CLOTHING-only guard and the small pure helpers (sizes, codes, barcodes).
 *
 * A size/colour variant is a `products` row. Nothing here keeps a second copy of its name, price or stock.
 */
import pool from '../../config/database.js';

export { text, int, num, money, oneOf, bool, idList, paging, like, audit, diff, ok, page } from '../salon/common.js';

export class ClothingError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'ClothingError';
    this.status = status;
    Object.assign(this, extra);
  }
}

const CLIENT_ERRORS = new Set(['ClothingError', 'SalonError', 'BillingError', 'IdentityError']);

export const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (error) {
    if (CLIENT_ERRORS.has(error?.name) && Number.isInteger(error.status)) {
      return res.status(error.status).json({ success: false, message: error.message, ...(typeof error.code === 'string' && error.code ? { code: error.code } : {}) });
    }
    if (error?.code === '22P02') return res.status(404).json({ success: false, message: 'Not found' });
    if (['22003', '22007', '22008'].includes(error?.code)) return res.status(400).json({ success: false, message: 'One of the values is not valid' });
    if (error?.code === '23505') return res.status(409).json({ success: false, message: 'A product with that code, SKU or barcode already exists' });
    throw error;
  }
};
export const wrapAll = (handlers) => Object.fromEntries(Object.entries(handlers).map(([k, fn]) => [k, wrap(fn)]));

export const CLOTHING_TYPES = ['CLOTHING'];
/** Clothing endpoints exist only for a clothing shop: any other business type gets the same answer as a missing route. */
export const clothingOnly = (req, res, next) => {
  if (!CLOTHING_TYPES.includes(req.tenant?.businessType)) return res.status(404).json({ success: false, message: 'Not found' });
  next();
};

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

export const GENDERS = ['MEN', 'WOMEN', 'BOYS', 'GIRLS', 'KIDS', 'UNISEX'];

/** The size sets every shop starts with. A shop can add its own (clothing_size_sets). */
export const DEFAULT_SIZE_SETS = [
  { name: 'Letter sizes', sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] },
  { name: 'Waist (inches)', sizes: ['28', '30', '32', '34', '36', '38'] },
  { name: 'Kids (years)', sizes: ['2-3Y', '3-4Y', '4-5Y', '5-6Y', '6-7Y', '7-8Y', '8-9Y', '9-10Y', '10-12Y'] },
  { name: 'Shoes (UK)', sizes: ['5', '6', '7', '8', '9', '10', '11'] },
  { name: 'Free size', sizes: ['Free Size'] }
];

/** The categories a new clothing shop gets (a shop can rename, add and remove). */
export const DEFAULT_CATEGORIES = {
  "Men's Wear": ['T-Shirts', 'Shirts', 'Jeans', 'Trousers', 'Shorts', 'Jackets'],
  "Women's Wear": ['Tops', 'Kurtis', 'Jeans', 'Dresses', 'Leggings'],
  "Kids' Wear": ['Boys', 'Girls', 'Infants'],
  'Ethnic Wear': ['Sarees', 'Kurtas', 'Sherwanis', 'Lehengas'],
  'Western Wear': ['Dresses', 'Blazers', 'Co-ords'],
  Innerwear: ['Vests', 'Briefs', 'Bras', 'Socks'],
  Accessories: ['Belts', 'Caps', 'Scarves', 'Bags'],
  Footwear: ['Casual', 'Formal', 'Sports', 'Sandals']
};

/** Colours a shop picks from; the hex only draws the swatch. A shop can type any other name. */
export const COMMON_COLOURS = [
  ['Black', '#111827'], ['White', '#f8fafc'], ['Grey', '#9ca3af'], ['Navy', '#1e3a8a'], ['Blue', '#2563eb'], ['Sky Blue', '#7dd3fc'], ['Red', '#dc2626'], ['Maroon', '#7f1d1d'],
  ['Pink', '#f472b6'], ['Orange', '#f97316'], ['Yellow', '#facc15'], ['Green', '#16a34a'], ['Olive', '#6b7a2a'], ['Beige', '#d6c3a1'], ['Brown', '#7c4a2d'], ['Purple', '#7c3aed']
];

const alnum = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** "Free Size" -> FREESIZE, "2-3Y" -> 2-3Y: what goes in a SKU. */
export const sizeCode = (size) => String(size ?? '').toUpperCase().replace(/[^A-Z0-9-]/g, '');

/** The 3-letter colour code in a SKU ("Navy Blue" -> NAV). `taken` lists the codes this style already uses for other colours; a clash gets a digit. */
export const colourCode = (name, taken = new Set()) => {
  const base = (alnum(name).slice(0, 3) || 'CLR');
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) { const c = `${base.slice(0, 2)}${i}`; if (!taken.has(c)) return c; }
  return `${base}9`;
};

export const hexOf = (name) => (COMMON_COLOURS.find(([n]) => n.toLowerCase() === String(name).trim().toLowerCase()) || [])[1] ?? null;

/** EAN-13 check digit for the first 12 digits. */
export const eanCheck = (digits12) => {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
};

/** An in-store barcode (EAN-13, prefix 2) from the sequence value, so no two variants ever share one. */
export const storeBarcode = (n) => { const body = `2${String(n).padStart(11, '0')}`; return `${body}${eanCheck(body)}`; };

/** Rupees beside every paise figure, numbers for numeric strings. */
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
