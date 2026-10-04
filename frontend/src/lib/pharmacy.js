/*
 * Helpers shared by the pharmacy screens: loading/formatting (the same ones every vertical uses — see
 * lib/salon.js) plus the words for a product type and a batch's status.
 */
export { addDays, dateText, longDate, qs, saveCsv, todayIn, toNumber, useDebounced, useLoad } from './salon.js';
import { formatCurrency } from './api.js';

export const money = (n) => formatCurrency(n);
export const qty = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 }));

export const PRODUCT_TYPES = {
  MEDICINE: 'Medicine', DEVICE: 'Device', CONSUMABLE: 'Consumable', SURGICAL: 'Surgical', WELLNESS: 'Wellness',
  PERSONAL_CARE: 'Personal care', BABY_CARE: 'Baby care', ORTHOPEDIC: 'Orthopedic', DIAGNOSTIC: 'Diagnostic', OTHER: 'Other'
};

export const BATCH_STATUS = {
  ACTIVE: { label: 'Active', tone: 'success' }, QUARANTINED: { label: 'Quarantined', tone: 'warning' },
  RECALLED: { label: 'Recalled', tone: 'danger' }, BLOCKED: { label: 'Blocked', tone: 'danger' }
};

export const PAYMENT_METHODS = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK_TRANSFER: 'Bank transfer', CHEQUE: 'Cheque', OTHER: 'Other' };

/** Days left until `expiry` (negative = already expired). */
export const daysLeft = (expiry) => Math.round((new Date(`${expiry}T00:00:00`) - new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00`)) / 86400000);
