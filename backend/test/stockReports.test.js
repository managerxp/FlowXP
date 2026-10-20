/*
 * Stock reports: an item's period is opening + bought + sold + returned + adjusted = closing, the ledger's running balance ends where the item
 * report does, and the stock summary values what is on hand at cost.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const stock = await import('../src/controllers/stockReports.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
let biz; let A; let owner; let product;
const call = async (fn, query = {}) => {
  const res = fakeRes();
  await fn({ tenant: { businessId: biz, branchId: A, scopeBranchId: null, role: 'OWNER', permissions: {} }, auth: { userId: owner }, query, params: {}, body: {}, headers: {}, ip: '127.0.0.1' }, res);
  return res;
};

test('item movement, ledger and stock summary agree', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Priya','o@sk.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state) VALUES ('Shop',$1,'RETAIL','Karnataka') RETURNING business_id`, [owner])).rows[0].business_id;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const category = (await pool.query(`INSERT INTO categories (business_id, name) VALUES ($1,'Brakes') RETURNING category_id`, [biz])).rows[0].category_id;
  product = (await pool.query(`INSERT INTO products (business_id, name, kind, category_id, selling_price_paise, purchase_price_paise, track_inventory, current_stock, min_stock) VALUES ($1,'Pad','DISH',$2,15000,10000,TRUE,7,10) RETURNING product_id`, [biz, category])).rows[0].product_id;
  const move = (type, qty, at) => pool.query(`INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, [biz, A, product, type, qty, at]);
  await move('OPENING', 10, '2026-01-05T10:00:00Z');   // before the period
  await move('PURCHASE', 5, '2026-02-10T10:00:00Z');
  await move('SALE', -3, '2026-02-12T10:00:00Z');
  await move('RETURN', 1, '2026-02-14T10:00:00Z');
  await move('ADJUSTMENT', -6, '2026-02-20T10:00:00Z');

  const items = (await call(stock.items, { from: '2026-02-01', to: '2026-02-28' })).body.data;
  const row = items.rows.find((r) => r.product_id === product);
  assert.deepEqual([row.opening, row.bought, row.sold, row.returned, row.adjusted, row.closing], [10, 5, 3, 1, -6, 7]);
  assert.equal(row.opening + row.bought - row.sold + row.returned + row.adjusted, row.closing);
  assert.equal(row.value, 700, '7 on hand at ₹100 cost');

  const led = (await call(stock.ledger, { product_id: product, from: '2026-02-01', to: '2026-02-28' })).body.data;
  assert.equal(led.opening, 10);
  assert.equal(led.closing, 7);
  assert.deepEqual(led.lines.map((l) => l.balance), [15, 12, 13, 7]);
  assert.equal((await call(stock.ledger, { product_id: 'x' })).code, 400);

  const sum = (await call(stock.summary)).body.data;
  assert.deepEqual([sum.rows[0].category, sum.rows[0].qty, sum.rows[0].cost_value, sum.rows[0].sell_value, sum.rows[0].low], ['Brakes', 7, 700, 1050, 1]);
  const low = (await call(stock.low)).body.data;
  assert.deepEqual([low.rows[0].short, low.rows[0].refill_cost], [3, 300]);
});
