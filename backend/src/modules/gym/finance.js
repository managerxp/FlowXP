/*
 * What a member has paid, owes and bought: read-only figures over FlowXP's own invoices, items and payments (nothing is stored separately, so nothing can drift).
 * Dues are the invoices' balance_due; wallet and package balances are NOT mixed in here (they are separate ledgers).
 * A "purchase" is an invoice line that names a product (supplements, shakers...); membership, pack and personal-training lines are custom lines without one.
 */
import { branchFilter } from '../../utils/scope.js';
import { withRupees } from './common.js';

export const memberFinance = async (db, tenant, memberId, { limit = 50 } = {}) => {
  const cap = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const gm = (await db.query(`SELECT customer_id FROM gym_members WHERE business_id = $1 AND member_id = $2`, [tenant.businessId, memberId])).rows[0];
  if (!gm) return null;
  const p = [tenant.businessId, gm.customer_id];
  const scope = branchFilter(tenant, 'i.branch_id', p);
  const live = `i.business_id = $1 AND i.customer_id = $2 AND i.status <> 'CANCELLED'${scope}`;

  const totals = (await db.query(
    `SELECT COUNT(*)::int AS invoices,
            COALESCE(SUM(i.total_paise - i.credited_paise), 0)::bigint AS billed_paise,
            COALESCE(SUM(i.amount_paid_paise), 0)::bigint AS paid_paise,
            COALESCE(SUM(i.balance_due_paise), 0)::bigint AS due_paise,
            COALESCE(SUM(i.balance_due_paise) FILTER (WHERE i.balance_due_paise > 0), 0)::bigint AS owing_paise
       FROM invoices i WHERE ${live}`, p)).rows[0];

  const items = (await db.query(
    `SELECT COUNT(DISTINCT i.invoice_id)::int AS purchases, COALESCE(SUM(it.quantity), 0)::numeric AS quantity,
            COALESCE(SUM(it.line_total_paise), 0)::bigint AS spent_paise, MAX(i.invoice_date)::text AS last_on
       FROM invoice_items it JOIN invoices i ON i.invoice_id = it.invoice_id
      WHERE ${live} AND it.product_id IS NOT NULL`, p)).rows[0];

  const invoices = (await db.query(
    `SELECT i.invoice_id, i.invoice_number, i.invoice_date::text AS invoice_date, i.status, i.total_paise, i.credited_paise, i.amount_paid_paise, i.balance_due_paise,
            EXISTS (SELECT 1 FROM gym_memberships ms WHERE ms.invoice_id = i.invoice_id) AS is_membership,
            EXISTS (SELECT 1 FROM invoice_items it WHERE it.invoice_id = i.invoice_id AND it.product_id IS NOT NULL) AS has_products
       FROM invoices i WHERE ${live} ORDER BY i.invoice_date DESC, i.invoice_id DESC LIMIT ${cap}`, p)).rows;

  const purchases = (await db.query(
    `SELECT it.item_id, i.invoice_id, i.invoice_number, i.invoice_date::text AS invoice_date, it.description, it.quantity, it.unit_price_paise, it.discount_paise, it.tax_amount_paise, it.line_total_paise
       FROM invoice_items it JOIN invoices i ON i.invoice_id = it.invoice_id
      WHERE ${live} AND it.product_id IS NOT NULL ORDER BY i.invoice_date DESC, it.item_id DESC LIMIT ${cap}`, p)).rows;

  const pp = [tenant.businessId, gm.customer_id];
  const pscope = branchFilter(tenant, 'pm.branch_id', pp);
  const payments = (await db.query(
    `SELECT pm.payment_id, pm.payment_method, pm.amount_paise, pm.created_at, i.invoice_id, i.invoice_number
       FROM payments pm JOIN invoices i ON i.invoice_id = pm.invoice_id
      WHERE pm.business_id = $1 AND pm.customer_id = $2 AND i.status <> 'CANCELLED'${pscope} ORDER BY pm.created_at DESC, pm.payment_id DESC LIMIT ${cap}`, pp)).rows;

  return withRupees({
    summary: { ...totals, purchases: items.purchases, purchase_quantity: Number(items.quantity), purchase_spent_paise: items.spent_paise, last_purchase_on: items.last_on },
    invoices, purchases, payments
  });
};
