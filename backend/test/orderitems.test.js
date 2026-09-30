/*
 * Changing a line on an open order while viewing one outlet (how the app runs
 * for a business with outlets): more / fewer and cancelling must find the line.
 * These used to fail with "Not found" because the outlet filter shifted the
 * query's parameters.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const orders = await import('../src/controllers/orders.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
let biz; let user; let A; let B; let dish; let order; let line;
const at = (branch) => ({ businessId: biz, branchId: branch, scopeBranchId: branch, role: 'OWNER', permissions: {} });
const call = async (fn, tenant, extra = {}) => { const res = fakeRes(); await fn({ tenant, auth: { userId: user }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res); return res; };

test('setup', { skip }, async () => {
  await runMigrations(pool);
  user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@items.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Dhaba',$1,'RESTAURANT') RETURNING business_id`, [user])).rows[0].business_id;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'A',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  B = (await pool.query(`INSERT INTO branches (business_id, name) VALUES ($1,'B') RETURNING branch_id`, [biz])).rows[0].branch_id;
  dish = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, track_inventory) VALUES ($1,'Butter Chicken',34000,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  order = (await call(orders.create, at(A), { body: { order_type: 'TAKEAWAY' } })).body.data.order_id;
  const added = await call(orders.addItems, at(A), { params: { id: order }, body: { items: [{ product_id: dish, quantity: 1 }] } });
  assert.equal(added.code, 201, JSON.stringify(added.body));
  line = added.body.data[0].order_item_id;
});

test('at an outlet, a line can go up and down', { skip }, async () => {
  const up = await call(orders.updateItem, at(A), { params: { id: order, itemId: line }, body: { quantity: 3 } });
  assert.equal(up.code, 200, JSON.stringify(up.body));
  assert.equal(up.body.data.quantity, 3);
  assert.equal((await call(orders.updateItem, at(A), { params: { id: order, itemId: line }, body: { quantity: 2 } })).body.data.quantity, 2);
});

test('a quantity must be a number above zero', { skip }, async () => {
  for (const quantity of [0, -1, 'lots']) {
    assert.equal((await call(orders.updateItem, at(A), { params: { id: order, itemId: line }, body: { quantity } })).code, 400, String(quantity));
  }
});

test('another outlet cannot change it; this one can cancel it', { skip }, async () => {
  assert.equal((await call(orders.updateItem, at(B), { params: { id: order, itemId: line }, body: { quantity: 5 } })).code, 404);
  const cancel = await call(orders.updateItem, at(A), { params: { id: order, itemId: line }, body: { status: 'CANCELLED' } });
  assert.equal(cancel.code, 200, JSON.stringify(cancel.body));
  assert.equal(cancel.body.data.status, 'CANCELLED');
});
