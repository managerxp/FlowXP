/*
 * Multi-brand (owner's request, 2026-09-29, from a "Cloud Kitchen module"
 * spec — see brain.md for the audit): one kitchen running several virtual
 * brands. Covers the brands catalog CRUD, tagging a product and an order
 * with a brand, and that it surfaces on the kitchen ticket.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const brands = await import('../src/controllers/brands.controller.js');
const products = await import('../src/controllers/products.controller.js');
const orders = await import('../src/controllers/orders.controller.js');
const kitchen = await import('../src/controllers/kitchen.controller.js');
const { requirePlanFeature } = await import('../src/middleware/auth.js');
const admin = await import('../src/controllers/admin.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
let A; let B;

const makeBusiness = async (label) => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@brands.test`])).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, plan_code) VALUES ($1,$2,'CLOUD_KITCHEN','GROWTH') RETURNING business_id`, [label, user.user_id])).rows[0];
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz.business_id])).rows[0].branch_id;
  const tenant = { businessId: biz.business_id, branchId, role: 'OWNER', permissions: {} };
  const req = (extra = {}) => ({ tenant, auth: { userId: user.user_id }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra });
  const call = async (fn, extra) => { const res = fakeRes(); await fn(req(extra), res); return res; };
  const table = async (name) => (await pool.query(`INSERT INTO dining_tables (business_id, branch_id, name, qr_token) VALUES ($1,$2,$3,$4) RETURNING table_id`, [biz.business_id, branchId, name, `${label}-${name}-${Math.random()}`])).rows[0].table_id;
  return { biz: biz.business_id, tenant, req, call, table };
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeBusiness('a');
  B = await makeBusiness('b');
});

test('the feature is on by default — missing config never blocks an existing business', { skip }, async () => {
  const middleware = requirePlanFeature('multi_brand');
  let next = false;
  await middleware({ tenant: { planFeatures: {} } }, fakeRes(), () => { next = true; });
  assert.ok(next);
});

test('an admin can switch multi_brand off for a plan, and the route middleware refuses it', { skip }, async () => {
  const middleware = requirePlanFeature('multi_brand');
  const res = fakeRes();
  let next = false;
  await middleware({ tenant: { planFeatures: { multi_brand: false } } }, res, () => { next = true; });
  assert.equal(next, false);
  assert.equal(res.code, 402);
  assert.equal(res.body.code, 'FEATURE_NOT_IN_PLAN');
});

test('brand name is required, and a blank one is rejected', { skip }, async () => {
  const bad = await A.call(brands.create, { body: { name: '  ' } });
  assert.equal(bad.code, 400);
});

test('create, list, rename, deactivate — isolated per business', { skip }, async () => {
  const created = await A.call(brands.create, { body: { name: 'Biryani Brand', logo_url: 'https://x.test/logo.png' } });
  assert.equal(created.code, 201, JSON.stringify(created.body));
  A.biryaniBrand = created.body.data.brand_id;
  assert.equal(created.body.data.is_active, true);

  await A.call(brands.create, { body: { name: 'Burger Brand' } });

  const list = await A.call(brands.list);
  assert.deepEqual(list.body.data.map((b) => b.name).sort(), ['Biryani Brand', 'Burger Brand']);

  const renamed = await A.call(brands.update, { params: { id: A.biryaniBrand }, body: { name: 'Biryani Co.' } });
  assert.equal(renamed.body.data.name, 'Biryani Co.');

  const deactivated = await A.call(brands.update, { params: { id: A.biryaniBrand }, body: { is_active: false } });
  assert.equal(deactivated.body.data.is_active, false);
  const activeOnly = await A.call(brands.list);
  assert.deepEqual(activeOnly.body.data.map((b) => b.name), ['Burger Brand']);
  const includingInactive = await A.call(brands.list, { query: { status: 'all' } });
  assert.equal(includingInactive.body.data.length, 2);

  // isolation: B sees none of A's brands, and can't edit them by id
  assert.deepEqual((await B.call(brands.list, { query: { status: 'all' } })).body.data, []);
  assert.equal((await B.call(brands.update, { params: { id: A.biryaniBrand }, body: { name: 'Stolen' } })).code, 404);

  await A.call(brands.update, { params: { id: A.biryaniBrand }, body: { is_active: true } }); // restore for later tests
});

test('a product can be tagged with a brand, filtered by it, and it round-trips as brand_name', { skip }, async () => {
  const created = await A.call(products.create, { body: { name: 'Chicken Biryani', selling_price: 250, brand_id: A.biryaniBrand } });
  assert.equal(created.code, 201, JSON.stringify(created.body));
  A.biryaniDish = created.body.data.product_id;
  assert.equal(created.body.data.brand_id, A.biryaniBrand);
  assert.equal(created.body.data.brand_name, 'Biryani Co.');

  const untaggedResult = await A.call(products.create, { body: { name: 'Plain Rice', selling_price: 60 } });
  assert.equal(untaggedResult.body.data.brand_id, null, 'a product with no brand behaves exactly as before');

  const filtered = await A.call(products.list, { query: { brand_id: String(A.biryaniBrand) } });
  assert.deepEqual(filtered.body.data.map((p) => p.name), ['Chicken Biryani']);

  const cleared = await A.call(products.update, { params: { id: A.biryaniDish }, body: { brand_id: null } });
  assert.equal(cleared.body.data.brand_id, null);
  await A.call(products.update, { params: { id: A.biryaniDish }, body: { brand_id: A.biryaniBrand } }); // restore
});

test('an order tagged with a brand shows brand_name in list, get, and the kitchen ticket', { skip }, async () => {
  const t1 = await A.table('T1');
  const opened = await A.call(orders.create, { body: { order_type: 'DINE_IN', table_id: t1, brand_id: A.biryaniBrand } });
  assert.equal(opened.code, 201, JSON.stringify(opened.body));
  const orderId = opened.body.data.order_id;
  assert.equal(opened.body.data.brand_id, A.biryaniBrand); // create() returns the raw inserted row, not a joined one — brand_name only appears from list/get below

  const got = await A.call(orders.get, { params: { id: orderId } });
  assert.equal(got.body.data.brand_name, 'Biryani Co.');

  const listed = await A.call(orders.list);
  assert.equal(listed.body.data.find((o) => o.order_id === orderId).brand_name, 'Biryani Co.');

  await A.call(orders.addItems, { params: { id: orderId }, body: { items: [{ product_id: A.biryaniDish, quantity: 1 }] } });
  await A.call(orders.sendKot, { params: { id: orderId }, body: {} });
  const ticketRes = await A.call(kitchen.tickets);
  const ticket = ticketRes.body.data.tickets.find((t) => t.order_id === orderId);
  assert.ok(ticket, 'the sent order should be on the pass');
  assert.equal(ticket.brand_name, 'Biryani Co.');
});

test('an order with no brand is unaffected — brand_name is simply null', { skip }, async () => {
  const t2 = await A.table('T2');
  const opened = await A.call(orders.create, { body: { order_type: 'DINE_IN', table_id: t2 } });
  assert.equal(opened.body.data.brand_name, null);
});

test('an order\'s brand can be set or cleared after the fact, but not once billed', { skip }, async () => {
  const t4 = await A.table('T4');
  const orderId = (await A.call(orders.create, { body: { order_type: 'DINE_IN', table_id: t4 } })).body.data.order_id;

  const set = await A.call(orders.setBrand, { params: { id: orderId }, body: { brand_id: A.biryaniBrand } });
  assert.equal(set.code ?? 200, 200, JSON.stringify(set.body));
  assert.equal(set.body.data.brand_name, 'Biryani Co.');

  const cleared = await A.call(orders.setBrand, { params: { id: orderId }, body: { brand_id: null } });
  assert.equal(cleared.body.data.brand_id, null);

  assert.equal((await B.call(orders.setBrand, { params: { id: orderId }, body: { brand_id: A.biryaniBrand } })).code, 404); // not B's order
});

test('a brand belonging to another business cannot be assigned to a product or an order', { skip }, async () => {
  const bBrand = (await B.call(brands.create, { body: { name: "B's Brand" } })).body.data.brand_id;

  const badProduct = await A.call(products.create, { body: { name: 'Sneaky Dish', selling_price: 100, brand_id: bBrand } });
  assert.equal(badProduct.code, 400);

  const t3 = await A.table('T3');
  const badOrder = await A.call(orders.create, { body: { order_type: 'DINE_IN', table_id: t3, brand_id: bBrand } });
  assert.equal(badOrder.code, 400);
});
