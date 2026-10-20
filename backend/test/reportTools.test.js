/*
 * The report tools the assistant can use: they run the same controllers as the Reports page for the asker's tenant, return aggregates
 * only (no party names), and respect permissions and the outlet an asker is pinned to.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { runTool, toolsFor } = await import('../src/modules/ai/tools.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');

test.after(cleanup);

test('report tools answer from the books, without names, and keep to permissions', { skip }, async () => {
  await runMigrations(pool);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Priya','o@rt.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state) VALUES ('Shop',$1,'RETAIL',TRUE,'Karnataka') RETURNING business_id`, [owner])).rows[0].business_id;
  const A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const product = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, purchase_price_paise, tax_rate, hsn_sac, track_inventory) VALUES ($1,'Bolt','DISH',10000,6000,18,'73181500',FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  const customer = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Ravi Motors','9000044444') RETURNING customer_id`, [biz])).rows[0].customer_id;
  const client = await pool.connect();
  try { await client.query('BEGIN'); await createInvoiceInTransaction(client, { businessId: biz, branchId: A }, owner, { customerId: customer, items: [{ product_id: product, quantity: 2 }], payment: { amount: 'FULL' } }); await client.query('COMMIT'); } finally { client.release(); }

  await pool.query('UPDATE products SET track_inventory = TRUE, current_stock = 2, min_stock = 5 WHERE product_id = $1', [product]);   // two left, warn below five
  const tenant = { businessId: biz, branchId: A, scopeBranchId: null, role: 'OWNER', permissions: {}, pinned: false };
  const pl = await runTool(tenant, 'profit_and_loss', {});
  assert.equal(pl.net_sales, 200);
  assert.equal(pl.cost_of_goods, 120);
  assert.equal(pl.gross_profit, 80);

  const items = await runTool(tenant, 'profit_by_item', { order: 'worst', limit: 5 });
  assert.equal(items.items[0].name, 'Bolt');
  assert.equal(items.items[0].profit, 80);

  const gst = await runTool(tenant, 'gst_summary', {});
  assert.deepEqual([gst.totals.output_tax, gst.totals.net_tax], [36, 36]);
  const hsn = await runTool(tenant, 'sales_by_hsn', {});
  assert.equal(hsn.rows[0].code, '73181500');

  const low = await runTool(tenant, 'low_stock_list', {});
  assert.equal(low.items[0].name, 'Bolt');
  const cat = await runTool(tenant, 'category_sales', {});
  assert.equal(cat.totals.taxable, 200);
  const money = await runTool(tenant, 'money_in_out', {});
  assert.deepEqual([money.sales, money.money_in], [236, 236], 'the bill with tax, paid in full');

  // aggregates only: no customer name anywhere in what the assistant is given
  assert.ok(!JSON.stringify([pl, items, gst, hsn, low, cat, money]).includes('Ravi'));
  // permissions: a stock-only role gets stock tools but not profit
  const stockOnly = { ...tenant, role: 'INVENTORY_MANAGER' };
  assert.ok(toolsFor(stockOnly).some((t) => t.name === 'low_stock_list') && !toolsFor(stockOnly).some((t) => t.name === 'profit_and_loss'));
  await assert.rejects(() => runTool(stockOnly, 'profit_and_loss', {}), /does not have access/);
});
