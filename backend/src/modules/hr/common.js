/*
 * Shared plumbing for the staff and payroll engine: its error type, the response wrapper, rupee conversion and date helpers.
 * Request-body checks (text, money, isoDate...) are the salon module's, shared as they are.
 */
import { addDaysISO } from '../../utils/dates.js';

export { text, int, num, money, oneOf, bool, isoDate, idList, phone, paging, like, audit, diff, ok, page } from '../salon/common.js';

export class HrError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'HrError';
    this.status = status;
    Object.assign(this, extra);
  }
}

const CLIENT_ERRORS = new Set(['HrError', 'SalonError', 'BillingError']);

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

export { addDaysISO };

export const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
