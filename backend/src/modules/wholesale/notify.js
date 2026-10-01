/*
 * Wholesale customer notifications — order confirmed, dispatched, invoice, payment received / due / overdue.
 *
 * These go through the shared messaging module (send), so the channel, provider keys and opt-outs are the ones
 * the business already configured under Messaging; nothing here holds a credential. With messaging OFF nothing is
 * sent. A message problem must never fail an order or a payment, so notify() never throws and never waits.
 * Each event can be switched off in the wholesale settings (notifications.<event> = false).
 */
import pool from '../../config/database.js';
import { send, shareLink } from '../messaging/index.js';
import { toRupees } from '../../utils/money.js';
import { getSettings } from './common.js';

export const EVENTS = {
  order_confirmed: 'WS_ORDER_CONFIRMED',
  order_dispatched: 'WS_ORDER_DISPATCHED',
  invoice_issued: 'WS_INVOICE',
  payment_received: 'WS_PAYMENT_RECEIVED',
  payment_due: 'WS_PAYMENT_DUE',
  payment_overdue: 'WS_PAYMENT_OVERDUE'
};

const inr = (paise) => `₹${toRupees(paise).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const day = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

/** Send now (awaitable — used by the scans and the tests). Returns the stored message, or { skipped } / null. */
export const deliver = async (db, { businessId, branchId = null, event, customerId, invoiceId = null, values = {}, createdBy = null }) => {
  const kind = EVENTS[event];
  if (!kind) throw new Error(`Unknown wholesale event ${event}`);
  const settings = await getSettings(db, businessId);
  if (settings.notifications?.[event] === false) return { skipped: 'DISABLED' };
  const c = (await db.query(`SELECT c.name, c.phone, b.name AS business FROM customers c JOIN businesses b ON b.business_id = c.business_id WHERE c.business_id = $1 AND c.customer_id = $2`, [businessId, customerId])).rows[0];
  if (!c?.phone) return { skipped: 'NO_PHONE' };
  const v = { name: c.name, business: c.business, ...values };
  if (kind === 'WS_INVOICE' && invoiceId) v.link = await shareLink(db, invoiceId);
  if (v.total != null && typeof v.total === 'number') v.total = inr(v.total);
  if (v.amount != null && typeof v.amount === 'number') v.amount = inr(v.amount);
  for (const k of ['vehicle']) if (k in v && !v[k]) v[k] = '-';
  return send(db, { businessId, branchId, customerId, phone: c.phone, kind, values: v, createdBy, related: invoiceId ? { type: 'invoice', id: invoiceId } : null });
};

/** Fire and forget from a request handler, after the transaction committed. */
export const notify = (req, event, { customerId, invoiceId = null, values = {} }) => {
  deliver(pool, { businessId: req.tenant.businessId, branchId: req.tenant.branchId, event, customerId, invoiceId, values, createdBy: req.auth?.userId ?? null })
    .catch((error) => console.error(`[wholesale] notification ${event} failed:`, error.message));
};

export { inr, day };
