/*
 * "Start fresh": while a shop is still on its free trial (never paid), the owner can wipe the sales and stock history made while trying the
 * software, and begin real work from bill number 1. Kept: the business, outlets, staff, products, customers, suppliers, settings, audit log.
 * Wiped: bills, orders, payments, returns, purchases, expenses, income, stock movements (stock goes back to 0, to be counted again), loyalty.
 * One transaction: all of it, or none of it. Tables are listed in the order that satisfies foreign keys; a table this database does not have is skipped.
 */
const WIPE = [   // children before parents; each has a business_id column
  'refunds', 'credit_notes', 'debit_notes', 'payments', 'invoices', 'orders', 'held_bills', 'inventory_transactions',
  'expenses', 'other_income', 'estimates', 'purchase_orders', 'loyalty_events', 'points_ledger', 'customer_feedback', 'reservations', 'waitlist_entries',
  'stock_counts', 'stock_transfers', 'transfer_requests', 'messages', 'notifications',
];

export const canStartFresh = async (db, businessId) => {
  const b = (await db.query(`SELECT subscription_status FROM businesses WHERE business_id = $1`, [businessId])).rows[0];
  if (!b) return false;
  if (b.subscription_status !== 'TRIAL') return false;
  return (await db.query(`SELECT 1 FROM subscription_orders WHERE business_id = $1 AND status = 'PAID' LIMIT 1`, [businessId])).rows.length === 0;
};

export const startFresh = async (client, businessId) => {
  const cleared = {};
  for (const table of WIPE) {
    const has = (await client.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = 'business_id'`, [table])).rows.length;
    if (!has) continue;
    const n = (await client.query(`DELETE FROM ${table} WHERE business_id = $1`, [businessId])).rowCount;
    if (n) cleared[table] = n;
  }
  await client.query(`DELETE FROM branch_stock WHERE product_id IN (SELECT product_id FROM products WHERE business_id = $1)`, [businessId]);
  await client.query(`UPDATE products SET current_stock = 0 WHERE business_id = $1`, [businessId]);
  await client.query(`UPDATE businesses SET invoice_next_number = 1, credit_note_next_number = 1, debit_note_next_number = 1 WHERE business_id = $1`, [businessId]);
  await client.query(`UPDATE branches SET invoice_next_number = 1 WHERE business_id = $1`, [businessId]);
  return cleared;
};
