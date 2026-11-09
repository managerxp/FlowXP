/*
 * The floor's quick tools: the running bill of an open table (printed before payment, and shown as "bill printed" until the items change),
 * and the menu on/off switch of an outlet.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const tables = await import('../src/controllers/tables.controller.js');
const orders = await import('../src/controllers/orders.controller.js');
const products = await import('../src/controllers/products.controller.js');
const print = await import('../src/controllers/escpos.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

test('a running table: bill print marks it, new items clear the mark; menu off hides an item at this outlet only', { skip }, async () => {
  await runMigrations(pool);
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('f','f@floor.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Floor',$1,'RESTAURANT') RETURNING business_id`, [user])).rows[0].business_id;
  const main = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const other = (await pool.query(`INSERT INTO branches (business_id, name) VALUES ($1,'Other') RETURNING branch_id`, [biz])).rows[0].branch_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role) VALUES ($1,$2,'OWNER')`, [biz, user]);
  const at = (branchId) => ({ businessId: biz, branchId, scopeBranchId: branchId, role: 'OWNER', permissions: {} });
  const call = async (fn, extra = {}, tenant = at(main)) => { const res = fakeRes(); await fn({ tenant, auth: { userId: user }, params: {}, body: {}, query: {}, ...extra }, res); return res; };

  const dish = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, kind) VALUES ($1,'Fish Fry',25000,'DISH') RETURNING product_id`, [biz])).rows[0].product_id;
  const tbl = (await call(tables.create, { body: { name: 'F1' } })).body.data;
  const order = (await call(orders.create, { body: { order_type: 'DINE_IN', table_id: tbl.table_id } })).body.data;

  // nothing ordered yet: no bill to print
  assert.equal((await call(print.prebill, { params: { id: order.order_id } })).code, 400);

  await call(orders.addItems, { params: { id: order.order_id }, body: { items: [{ product_id: dish, quantity: 2 }] } });
  let t = (await call(tables.list)).body.data.find((x) => x.table_id === tbl.table_id);
  assert.equal(t.open_order.bill_printed_at, null);

  // looking at the bill without printing it (mark=0) leaves the table "running"; printing marks it
  const look = await call(print.prebill, { params: { id: order.order_id }, query: { mark: '0' } });
  assert.equal(look.code, 200);
  assert.ok(look.body.data.bytes > 50);
  assert.equal((await call(tables.list)).body.data.find((x) => x.table_id === tbl.table_id).open_order.bill_printed_at, null);
  assert.equal((await call(print.prebill, { params: { id: order.order_id } })).code, 200);
  t = (await call(tables.list)).body.data.find((x) => x.table_id === tbl.table_id);
  assert.ok(t.open_order.bill_printed_at);
  assert.equal(t.open_order.order_type, 'DINE_IN');

  // another item makes the printed bill out of date
  await call(orders.addItems, { params: { id: order.order_id }, body: { items: [{ product_id: dish, quantity: 1 }] } });
  assert.equal((await call(tables.list)).body.data.find((x) => x.table_id === tbl.table_id).open_order.bill_printed_at, null);

  // menu on/off: off at Main only; the other outlet still sells it; back on clears it
  let list = (await call(products.availability)).body.data;
  assert.equal(list.off, 0);
  assert.equal(list.items.find((i) => i.product_id === dish).is_available, true);
  assert.equal((await call(products.setAvailability, { params: { id: dish }, body: { is_available: 'no' } })).code, 400);
  assert.equal((await call(products.setAvailability, { params: { id: dish }, body: { is_available: false } })).code, 200);
  list = (await call(products.availability)).body.data;
  assert.equal(list.off, 1);
  assert.equal(list.items.find((i) => i.product_id === dish).is_available, false);
  assert.equal((await call(products.availability, {}, at(other))).body.data.off, 0);
  assert.equal((await call(products.availability, { query: { q: 'zzz' } })).body.data.items.length, 0);
  assert.equal((await call(products.setAvailability, { params: { id: dish }, body: { is_available: true } })).code, 200);
  assert.equal((await call(products.availability)).body.data.off, 0);
  assert.equal((await pool.query(`SELECT 1 FROM product_branch_settings WHERE product_id = $1`, [dish])).rowCount, 0);

  // an outlet's own price survives switching the item off and on
  await pool.query(`INSERT INTO product_branch_settings (product_id, branch_id, price_paise, is_available) VALUES ($1,$2,30000,TRUE)`, [dish, main]);
  await call(products.setAvailability, { params: { id: dish }, body: { is_available: false } });
  await call(products.setAvailability, { params: { id: dish }, body: { is_available: true } });
  assert.equal(Number((await pool.query(`SELECT price_paise FROM product_branch_settings WHERE product_id = $1 AND branch_id = $2`, [dish, main])).rows[0].price_paise), 30000);
});
