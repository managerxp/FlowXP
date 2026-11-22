/*
 * The supplement desk: sell products (supplements, shakers, towels) to a member or a walk-in, and watch the stock.
 * Money and stock stay in FlowXP's own invoice engine (createInvoiceInTransaction: GST, stock check and deduction, numbering). This module only
 * adds what a gym desk needs: the member's wallet as a way to pay, and the rule that a walk-in must pay in full (dues belong to members).
 * A member who does not pay in full is simply owed the rest (it shows under Dues).
 */
import { createInvoiceInTransaction } from '../billing.js';
import { expiryList } from '../retailStock.js';
import { GymError, withRupees } from './common.js';
import { visibleTo } from './members.js';
import { payInvoice } from './wallet.js';

const CASH_METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'];
const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Products the desk can sell, with what is on the shelf at this outlet. */
export const products = async (db, tenant, { q = '', limit = 30 } = {}) => {
  const p = [tenant.businessId];
  let stock = 'p.current_stock'; let join = '';
  if (tenant.branchId != null) { p.push(tenant.branchId); join = ' LEFT JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = $2'; stock = 'COALESCE(bs.quantity, 0)'; }
  let where = '';
  const like = String(q || '').trim();
  if (like) { p.push(`%${escapeLike(like)}%`); where = ` AND (p.name ILIKE $${p.length} OR p.sku ILIKE $${p.length} OR p.barcode ILIKE $${p.length})`; }
  const rows = (await db.query(
    `SELECT p.product_id, p.name, p.sku, p.selling_price_paise, p.tax_rate, p.track_inventory, ${stock} AS stock, p.min_stock
       FROM products p${join} WHERE p.business_id = $1 AND p.status = 'ACTIVE'${where} ORDER BY p.name LIMIT ${Math.min(Math.max(Number(limit) || 30, 1), 100)}`, p)).rows;
  return withRupees(rows.map((r) => ({ ...r, stock: Number(r.stock), min_stock: Number(r.min_stock), tax_rate: Number(r.tax_rate) })));
};

/** A sale at the desk. Returns the invoice number plus what the wallet paid and what is still owed. */
export const sell = async (db, tenant, userId, b) => {
  const items = (Array.isArray(b.items) ? b.items : []).map((i) => ({ product_id: Number(i.product_id), quantity: Number(i.quantity) }));
  if (!items.length || items.some((i) => !i.product_id || !(i.quantity > 0))) throw new GymError(400, 'Add at least one product with a quantity');
  let member = null;
  if (b.member_id) {
    const p = [tenant.businessId, Number(b.member_id)];
    member = (await db.query(`SELECT gm.member_id, gm.customer_id FROM gym_members gm WHERE gm.business_id = $1 AND gm.member_id = $2 AND gm.status <> 'ARCHIVED'${visibleTo(tenant, p)}`, p)).rows[0];
    if (!member) throw new GymError(404, 'Member not found');
  }
  const method = String(b.method || 'CASH').toUpperCase();
  if (!CASH_METHODS.includes(method)) throw new GymError(400, 'Choose how it was paid');
  if (b.use_wallet && !member) throw new GymError(400, 'Choose the member whose wallet pays');
  const cash = b.amount === 'REST' ? 'FULL' : b.amount;
  const restByMethod = b.use_wallet && cash === 'FULL';   // the wallet pays first, then the chosen method pays the rest
  const invoice = await createInvoiceInTransaction(db, tenant, userId, {
    customerId: member?.customer_id ?? null, items, notes: 'Gym shop sale',
    payment: cash != null && cash !== '' && !restByMethod ? { method, amount: cash, reference_number: b.reference_number } : undefined
  });
  let walletPaid = 0;
  if (b.use_wallet && Number(invoice.balance_due) > 0) {
    try { walletPaid = (await payInvoice(db, tenant, userId, member.member_id, { invoice_id: invoice.invoice_id })).paid_paise; }
    catch (e) { if (e.code !== 'WALLET_SHORT') throw e; }   // an empty wallet just pays nothing
  }
  let left = Math.round(Number(invoice.balance_due) * 100) - walletPaid;
  if (restByMethod && left > 0) {
    await db.query(`INSERT INTO payments (business_id, branch_id, invoice_id, customer_id, payment_method, amount_paise, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [tenant.businessId, tenant.branchId, invoice.invoice_id, member.customer_id, method, left, userId]);
    await db.query(`UPDATE invoices SET amount_paid_paise = total_paise - credited_paise, balance_due_paise = 0, payment_status = 'PAID' WHERE invoice_id = $1`, [invoice.invoice_id]);
    left = 0;
  }
  if (!member && left > 0) throw new GymError(400, 'A sale without a member must be paid in full');
  return { invoice_id: invoice.invoice_id, invoice_number: invoice.invoice_number, total: Number(invoice.total), wallet_paid: walletPaid / 100, still_owed: left / 100 };
};

/** What needs attention on the shelves: products at or under their minimum, and batches that expired or will soon (batches exist only if stock is received that way). */
export const stockAlerts = async (db, tenant, { days = 30 } = {}) => {
  const p = [tenant.businessId];
  let qty = 'p.current_stock'; let join = '';
  if (tenant.scopeBranchId != null) { p.push(tenant.scopeBranchId); join = ' LEFT JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = $2'; qty = 'COALESCE(bs.quantity, 0)'; }
  const low = (await db.query(
    `SELECT p.product_id, p.name, ${qty} AS stock, p.min_stock FROM products p${join}
      WHERE p.business_id = $1 AND p.track_inventory AND p.status = 'ACTIVE' AND ${qty} <= p.min_stock ORDER BY ${qty}, p.name LIMIT 100`, p)).rows
    .map((r) => ({ ...r, stock: Number(r.stock), min_stock: Number(r.min_stock) }));
  const window = Math.min(Math.max(Number(days) || 30, 1), 365);
  const exp = await expiryList(db, { tenant, state: 'all', days: window, limit: 100 });
  return { low_stock: low, batches: exp.rows.filter((r) => r.days_left <= window), expired: Number(exp.counts.expired), expiring: Number(exp.counts.expiring) };
};
