/*
 * Credit control: how much a customer may still buy on credit.
 *
 *   limit      customers.credit_limit_paise            (0 = no limit set)
 *   owes       ledger outstanding (modules/wholesale/ledger.js)
 *   available  limit − owes − what is already promised on open orders (not yet invoiced)
 *
 * The business chooses the policy (Wholesale settings): OFF (ignore), WARN (allow, but say so) or BLOCK (refuse).
 * A customer can have their own policy. Optionally a customer with overdue invoices is held, whatever their limit.
 * A person with the 'sales_cancel'-level override (the order carries credit_override) can push an order through a block.
 */
import { customerBalances } from './ledger.js';
import { getSettings } from './common.js';

/** Open order value not yet invoiced for a customer (estimate at order prices). */
export const openOrderValue = async (db, businessId, customerId, excludeOrderId = null) => {
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(ROUND(o.total_paise::numeric * GREATEST(0, 1 - t.done / NULLIF(t.total_base, 0)))), 0)::bigint AS open_value
     FROM wholesale_sales_orders o
     JOIN (SELECT order_id, SUM(shipped_base + cancelled_base) AS done, SUM(base_qty) AS total_base FROM wholesale_sales_order_items GROUP BY order_id) t ON t.order_id = o.order_id
     WHERE o.business_id = $1 AND o.customer_id = $2 AND o.status IN ('PENDING','CONFIRMED','PARTIALLY_FULFILLED','PACKED') AND ($3::int IS NULL OR o.order_id <> $3)`,
    [businessId, customerId, excludeOrderId]);
  return Number(rows[0].open_value);
};

export const creditPosition = async (db, { businessId, customerId, excludeOrderId = null, settings = null }) => {
  const s = settings || await getSettings(db, businessId);
  const row = (await db.query(
    `SELECT c.credit_limit_paise, w.credit_policy FROM customers c LEFT JOIN wholesale_customer_profiles w ON w.customer_id = c.customer_id WHERE c.business_id = $1 AND c.customer_id = $2`, [businessId, customerId])).rows[0];
  if (!row) return null;
  const bal = (await customerBalances(db, { businessId, customerIds: [customerId], graceDays: s.overdue_grace_days })).get(customerId);
  const promised = await openOrderValue(db, businessId, customerId, excludeOrderId);
  const limit = Number(row.credit_limit_paise);
  const owes = Math.max(0, bal.outstanding);
  return {
    limit, outstanding: bal.outstanding, overdue: bal.overdue, promised, available: limit > 0 ? limit - owes - promised : null,
    utilization_pct: limit > 0 ? Math.round(((owes + promised) / limit) * 1000) / 10 : null,
    policy: row.credit_policy || s.credit_policy, block_when_overdue: s.block_when_overdue
  };
};

/**
 * Would taking `amountPaise` more on credit break the customer's terms?
 * Returns { level: 'OK' | 'WARN' | 'BLOCK', reasons: [...], position }.
 */
export const checkCredit = async (db, { businessId, customerId, amountPaise, excludeOrderId = null, settings = null }) => {
  const position = await creditPosition(db, { businessId, customerId, excludeOrderId, settings });
  if (!position || position.policy === 'OFF') return { level: 'OK', reasons: [], position };
  const reasons = [];
  if (position.limit > 0 && Math.max(0, position.outstanding) + position.promised + amountPaise > position.limit) {
    reasons.push(`This takes them over their credit limit by ₹${Math.round((Math.max(0, position.outstanding) + position.promised + amountPaise - position.limit) / 100).toLocaleString('en-IN')}`);
  }
  if (position.block_when_overdue && position.overdue > 0) reasons.push(`They have ₹${Math.round(position.overdue / 100).toLocaleString('en-IN')} overdue`);
  if (!reasons.length) return { level: 'OK', reasons, position };
  return { level: position.policy === 'BLOCK' ? 'BLOCK' : 'WARN', reasons, position };
};
