/*
 * A field rep's phone with no signal: the visit, the order and the payment are queued and arrive later (maybe days later). Each is recorded once,
 * linked to its visit, and a price that changed since the phone last synced is written on the order. The phone's catalogue copy carries the
 * wholesale details (carton sizes, minimum order).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addCustomer, addProduct, makeWholesaler } from './helpers/wholesale.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const orders = (await import('../src/controllers/wholesaleOrders.controller.js')).default;
const money = (await import('../src/controllers/wholesaleMoney.controller.js')).default;
const team = (await import('../src/controllers/distributorTeam.controller.js')).default;
const { posRowsByIds } = await import('../src/controllers/products.controller.js');

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);

const hdr = (h) => ({ get: (name) => h[name] });
const offline = (key) => hdr({ 'X-Offline-Sale': '1', 'Idempotency-Key': key });

t('a visit, an order and a payment taken offline arrive once each, linked to the visit, even after the duplicate guard has forgotten them', async () => {
  const w = await makeWholesaler(pool, 'field', { type: 'DISTRIBUTOR' });
  const prod = await addProduct(pool, w, { name: 'Biscuit carton', price: 100, tax: 0, stock: 100 });
  const shop = await addCustomer(pool, w, { name: 'Ravi Stores' });
  // the visit: named by the phone's own reference
  const visit = await w.call(team.recordVisit, { body: { customer_id: shop, outcome: 'ORDER', client_ref: 'visit-1' } });
  assert.equal(visit.code, 201, JSON.stringify(visit.body));
  const again = await w.call(team.recordVisit, { body: { customer_id: shop, outcome: 'ORDER', client_ref: 'visit-1' } });
  assert.equal(again.body.data.visit_id, visit.body.data.visit_id, 'a visit replayed from the queue is still one visit');
  // the order, linked to that visit by its reference, with the rep's total
  const body = { customer_id: shop, lines: [{ product_id: prod, quantity: 5 }], submit: true, visit_ref: 'visit-1', expected_total: 500, source: 'FIELD' };
  const first = await w.call(orders.create, { body, ...offline('ord-1') });
  assert.equal(first.code, 201, JSON.stringify(first.body));
  assert.equal(first.body.data.status, 'PENDING', 'arrives for the office to confirm; credit and stock are decided then');
  assert.deepEqual(first.body.data.review, []);
  const row = (await pool.query(`SELECT visit_id, source, client_key, notes FROM wholesale_sales_orders WHERE order_id = $1`, [first.body.data.order_id])).rows[0];
  assert.equal(row.visit_id, visit.body.data.visit_id); assert.equal(row.source, 'FIELD'); assert.equal(row.client_key, 'ord-1'); assert.match(row.notes, /Taken offline/);
  await pool.query(`DELETE FROM idempotency_keys`).catch(() => {});
  const replay = await w.call(orders.create, { body, ...offline('ord-1') });
  assert.equal(replay.code, 201); assert.equal(replay.body.data.order_id, first.body.data.order_id);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM wholesale_sales_orders WHERE business_id = $1`, [w.businessId])).rows[0].n, 1);
  // the payment, linked to the same visit
  const pay = { customer_id: shop, amount: 200, method: 'UPI', reference: 'UTR-1', visit_ref: 'visit-1' };
  const r1 = await w.call(money.create, { body: pay, ...offline('rc-1') });
  assert.equal(r1.code, 201, JSON.stringify(r1.body));
  await pool.query(`DELETE FROM idempotency_keys`).catch(() => {});
  const r2 = await w.call(money.create, { body: pay, ...offline('rc-1') });
  assert.equal(r2.body.data.receipt_id, r1.body.data.receipt_id);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM wholesale_receipts WHERE business_id = $1`, [w.businessId])).rows[0].n, 1);
  assert.equal((await pool.query(`SELECT visit_id FROM wholesale_receipts WHERE receipt_id = $1`, [r1.body.data.receipt_id])).rows[0].visit_id, visit.body.data.visit_id);
});

t('a price that changed since the phone last synced is written on the order for the office to see', async () => {
  const w = await makeWholesaler(pool, 'fieldprice', { type: 'DISTRIBUTOR' });
  const prod = await addProduct(pool, w, { name: 'Soap', price: 40, tax: 0, stock: 100 });
  const shop = await addCustomer(pool, w, { name: 'Kiran Mart' });
  const res = await w.call(orders.create, { body: { customer_id: shop, lines: [{ product_id: prod, quantity: 10 }], submit: true, expected_total: 350 }, ...offline('ord-price') });
  assert.equal(res.code, 201);
  assert.match(res.body.data.review.join(' '), /phone showed ₹350.*₹400/);
  const notes = (await pool.query(`SELECT notes FROM wholesale_sales_orders WHERE order_id = $1`, [res.body.data.order_id])).rows[0].notes;
  assert.match(notes, /Check: the phone showed/);
});

t('an order made online with no offline header is not marked offline, and the same key still returns the same order', async () => {
  const w = await makeWholesaler(pool, 'fieldon', { type: 'DISTRIBUTOR' });
  const prod = await addProduct(pool, w, { name: 'Tea', price: 60, tax: 0, stock: 50 });
  const shop = await addCustomer(pool, w, { name: 'Online Shop' });
  const body = { customer_id: shop, lines: [{ product_id: prod, quantity: 2 }] };
  const a = await w.call(orders.create, { body, ...hdr({ 'Idempotency-Key': 'on-1' }) });
  const b = await w.call(orders.create, { body, ...hdr({ 'Idempotency-Key': 'on-1' }) });
  assert.equal(a.body.data.order_id, b.body.data.order_id);
  assert.equal((await pool.query(`SELECT notes FROM wholesale_sales_orders WHERE order_id = $1`, [a.body.data.order_id])).rows[0].notes, null);
});

t('the phone\'s catalogue copy of a wholesale product carries the wholesale price, minimum order and carton sizes, and a change there reaches the sync log', async () => {
  const w = await makeWholesaler(pool, 'fieldcopy', { type: 'DISTRIBUTOR' });
  const prod = await addProduct(pool, w, { name: 'Oil 1L', price: 140, moq: 6, units: [{ name: 'Carton', factor: 12 }], stock: 10 });
  const [row] = await posRowsByIds(w.tenantFor(), [prod]);
  assert.deepEqual(row.wholesale, { wholesale_price: 140, moq: 6, sale_unit: null, units: [{ unit_name: 'Carton', factor: 12 }] });
  await pool.query(`UPDATE wholesale_item_details SET moq = 12 WHERE product_id = $1`, [prod]);
  await pool.query(`INSERT INTO wholesale_product_units (business_id, product_id, unit_name, factor) VALUES ($1,$2,'Case',24)`, [w.businessId, prod]);
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM sync_log WHERE business_id = $1 AND entity = 'product' AND entity_id = $2`, [w.businessId, prod])).rows[0].n;
  assert.equal(n >= 3, true);
});

t('a field rep, who has no billing permission, may keep the catalogue on the phone (it is how an order is taken with no signal)', async () => {
  const { hasPermission } = await import('../src/middleware/auth.js');
  const rep = { role: 'FIELD_SALES', permissions: {} };
  assert.equal(hasPermission(rep, 'billing'), false);
  assert.equal(hasPermission(rep, 'sales_orders'), true);
  assert.equal(hasPermission({ role: 'WAREHOUSE_STAFF', permissions: {} }, 'fulfilment'), true);
});

t('a price LOWER than the shop was shown is not flagged (good news); only a higher one is', async () => {
  const w = await makeWholesaler(pool, 'fieldlow', { type: 'DISTRIBUTOR' });
  const prod = await addProduct(pool, w, { name: 'Salt', price: 20, tax: 0, stock: 100 });
  const shop = await addCustomer(pool, w, { name: 'Low Price Shop' });
  const res = await w.call(orders.create, { body: { customer_id: shop, lines: [{ product_id: prod, quantity: 10 }], submit: true, expected_total: 500 }, ...offline('ord-low') });
  assert.equal(res.code, 201);
  assert.deepEqual(res.body.data.review, []);
});
