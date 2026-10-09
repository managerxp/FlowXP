/*
 * A van sale made with no signal arrives later (maybe days later). It is recorded once, dated the day it was made, never refused for stock or credit
 * (the goods are already handed over), and anything a person should look at is written on the order and the bill and returned as `review`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addCustomer, addProduct, makeWholesaler, stockOf } from './helpers/wholesale.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const parties = (await import('../src/controllers/wholesaleParties.controller.js')).default;
const vehicles = (await import('../src/controllers/distributorVehicles.controller.js')).default;

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);

const dayAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const hdr = (h) => ({ get: (name) => h[name] });
const offline = (key, day) => hdr({ 'X-Offline-Sale': '1', 'Idempotency-Key': key, ...(day ? { 'X-Sale-Date': day } : {}) });
const dist = (tag) => makeWholesaler(pool, tag, { type: 'DISTRIBUTOR' });
const van = async (w) => (await w.call(vehicles.create, { body: { vehicle_no: `TS${Math.floor(Math.random() * 9000 + 1000)}`, driver_name: 'Mahesh' } })).body.data;
const load = (w, v, items) => w.call(vehicles.load, { params: { id: v.vehicle_id }, body: { items } });
const sell = (w, v, body, extra = {}) => w.call(vehicles.sell, { params: { id: v.vehicle_id }, body, ...extra });
const onVan = async (productId) => Number((await pool.query(`SELECT COALESCE(SUM(qty_base), 0) AS q FROM dist_vehicle_stock WHERE product_id = $1`, [productId])).rows[0].q);

t('a van sale replayed with the same key returns the same bill, once, even after the duplicate guard has forgotten it; it keeps the day it was made', async () => {
  const w = await dist('vo1');
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, cost: 60, tax: 0, stock: 500 });
  const c = await addCustomer(pool, w, { name: 'Balaji Kirana' });
  const v = await van(w);
  await load(w, v, [{ product_id: p, quantity: 100 }]);
  const body = { customer_id: c, lines: [{ product_id: p, quantity: 10 }], payment: { amount: 'FULL', method: 'CASH' }, expected_total: 1000 };
  const a = await sell(w, v, body, offline('van-1', dayAgo(2)));
  assert.equal(a.code, 201, JSON.stringify(a.body));
  assert.deepEqual(a.body.data.review, []);
  await pool.query(`DELETE FROM idempotency_keys`).catch(() => {});
  const b = await sell(w, v, body, offline('van-1', dayAgo(2)));
  assert.equal(b.body.data.invoice_id, a.body.data.invoice_id);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`, [w.businessId])).rows[0].n, 1);
  assert.equal(await onVan(p), 90, 'taken off the van once');
  const row = (await pool.query(`SELECT i.invoice_date::text AS d, i.notes, o.order_date::text AS od, o.notes AS onotes, o.source FROM invoices i JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id JOIN wholesale_sales_orders o ON o.order_id = m.order_id WHERE i.invoice_id = $1`, [a.body.data.invoice_id])).rows[0];
  assert.deepEqual([row.d, row.od, row.source], [dayAgo(2), dayAgo(2), 'VAN']);
  assert.match(row.notes, /Taken offline/); assert.match(row.onotes, /Taken offline/);
});

t('more sold than the van held is recorded and flagged, not refused (online it is refused)', async () => {
  const w = await dist('vo2');
  const p = await addProduct(pool, w, { name: 'Tea', price: 50, cost: 30, tax: 0, stock: 200 });
  const c = await addCustomer(pool, w, { name: 'Kiran Mart' });
  const v = await van(w);
  await load(w, v, [{ product_id: p, quantity: 5 }]);
  const online = await sell(w, v, { customer_id: c, lines: [{ product_id: p, quantity: 8 }], payment: { amount: 'FULL', method: 'CASH' } });
  assert.equal(online.code, 409);
  const res = await sell(w, v, { customer_id: c, lines: [{ product_id: p, quantity: 8 }], payment: { amount: 'FULL', method: 'CASH' } }, offline('van-2', dayAgo(1)));
  assert.equal(res.code, 201, JSON.stringify(res.body));
  assert.match(res.body.data.review.join(' '), /3 more sold than the van held/);
  assert.equal(await onVan(p), 0, 'the van is empty, never negative');
  assert.match((await pool.query(`SELECT notes FROM invoices WHERE invoice_id = $1`, [res.body.data.invoice_id])).rows[0].notes, /Check: Tea: 3 more sold/);
});

t('an offline van sale to a shop over its credit limit is recorded and flagged; online it is refused', async () => {
  const w = await dist('vo3');
  const p = await addProduct(pool, w, { name: 'Oil', price: 100, cost: 70, tax: 0, stock: 100 });
  const c = await addCustomer(pool, w, { name: 'Small Shop', limit: 500 });
  const v = await van(w);
  await load(w, v, [{ product_id: p, quantity: 50 }]);
  await w.call(parties.updateSettings, { body: { credit_policy: 'BLOCK' } });
  const body = { customer_id: c, lines: [{ product_id: p, quantity: 20 }] };
  assert.equal((await sell(w, v, body)).code, 409);
  const res = await sell(w, v, body, offline('van-3'));
  assert.equal(res.code, 201, JSON.stringify(res.body));
  assert.match(res.body.data.review.join(' '), /over their credit limit/);
});

t('a total the phone showed that differs from the server\'s price is flagged, either way, because money may already have been taken', async () => {
  const w = await dist('vo4');
  const p = await addProduct(pool, w, { name: 'Salt', price: 20, cost: 10, tax: 0, stock: 100 });
  const c = await addCustomer(pool, w, { name: 'Kumar Stores' });
  const v = await van(w);
  await load(w, v, [{ product_id: p, quantity: 50 }]);
  const lo = await sell(w, v, { customer_id: c, lines: [{ product_id: p, quantity: 10 }], payment: { amount: 'FULL', method: 'CASH' }, expected_total: 150 }, offline('van-4a'));
  assert.match(lo.body.data.review.join(' '), /phone showed ₹150.*₹200/);
  const hi = await sell(w, v, { customer_id: c, lines: [{ product_id: p, quantity: 10 }], payment: { amount: 'FULL', method: 'CASH' }, expected_total: 260 }, offline('van-4b'));
  assert.match(hi.body.data.review.join(' '), /phone showed ₹260/);
});

t('an online van sale is not marked offline, and its warehouse stock is still never charged twice', async () => {
  const w = await dist('vo5');
  const p = await addProduct(pool, w, { name: 'Rice', price: 60, cost: 40, tax: 0, stock: 300 });
  const c = await addCustomer(pool, w, { name: 'Online Shop' });
  const v = await van(w);
  await load(w, v, [{ product_id: p, quantity: 100 }]);
  const before = await stockOf(pool, w.branchId, p);
  const res = await sell(w, v, { customer_id: c, lines: [{ product_id: p, quantity: 10 }], payment: { amount: 'FULL', method: 'CASH' } }, hdr({ 'Idempotency-Key': 'van-5' }));
  assert.equal(res.code, 201); assert.deepEqual(res.body.data.review, []);
  assert.deepEqual(await stockOf(pool, w.branchId, p), before);
  assert.equal((await pool.query(`SELECT notes FROM invoices WHERE invoice_id = $1`, [res.body.data.invoice_id])).rows[0].notes.includes('offline'), false);
});

t('the office can find what was taken offline and needs a look: the bill carries the flag, the list can be filtered, the summary counts them, and a wholesale order list can be filtered too', async () => {
  const invoices = await import('../src/controllers/invoices.controller.js');
  const orders = (await import('../src/controllers/wholesaleOrders.controller.js')).default;
  const { offlineInfo } = await import('../src/utils/offlineNote.js');
  const w = await dist('vo6');
  const p = await addProduct(pool, w, { name: 'Dal', price: 80, cost: 50, tax: 0, stock: 100 });
  const c = await addCustomer(pool, w, { name: 'Review Shop' });
  const v = await van(w);
  await load(w, v, [{ product_id: p, quantity: 4 }]);
  const flagged = await sell(w, v, { customer_id: c, lines: [{ product_id: p, quantity: 6 }], payment: { amount: 'FULL', method: 'CASH' } }, offline('van-6a'));
  const clean = await sell(w, v, { customer_id: c, lines: [], payment: { amount: 'FULL', method: 'CASH' } }, offline('van-6b')).catch(() => null);
  void clean;
  assert.deepEqual(offlineInfo('Van sale SO-1 | Taken offline. Check: Dal: 2 more sold than the van held; the phone showed ₹1'), { offline: true, review: 'Dal: 2 more sold than the van held; the phone showed ₹1' });
  assert.deepEqual(offlineInfo('Taken offline'), { offline: true, review: null });
  assert.deepEqual(offlineInfo('a normal note'), { offline: false, review: null });
  const list = await w.call(invoices.list, { query: { review: 'true' } });
  assert.deepEqual(list.body.data.map((i) => i.invoice_id), [flagged.body.data.invoice_id]);
  assert.equal(list.body.data[0].offline, true); assert.match(list.body.data[0].review, /2 more sold than the van held/);
  const sum = await w.call(invoices.summary, { query: {} });
  assert.deepEqual([sum.body.data.offline, sum.body.data.to_check], [1, 1]);
  const ords = await w.call(orders.list, { query: { review: '1' } });
  assert.equal(ords.body.data.length, 1); assert.equal(ords.body.data[0].offline, true);
});

t('a warehouse worker (no sales-order right) sees only the orders waiting to be picked, never a draft or an order already sent', async () => {
  const orders = (await import('../src/controllers/wholesaleOrders.controller.js')).default;
  const w = await dist('vo7');
  const p = await addProduct(pool, w, { name: 'Flour', price: 40, cost: 25, tax: 0, stock: 100 });
  const c = await addCustomer(pool, w, { name: 'Pick Shop' });
  const draft = (await w.call(orders.create, { body: { customer_id: c, lines: [{ product_id: p, quantity: 5 }] } })).body.data;
  const live = (await w.call(orders.create, { body: { customer_id: c, lines: [{ product_id: p, quantity: 5 }], submit: true } })).body.data;
  await w.call(orders.confirm, { params: { id: live.order_id }, body: {} });
  const staff = await w.call(orders.list, { query: {} }, w.tenantFor('WAREHOUSE_MANAGER'));
  assert.deepEqual(staff.body.data.map((o) => o.order_id), [live.order_id], 'only the confirmed order that waits to be picked');
  const owner = await w.call(orders.list, { query: {} });
  assert.equal(owner.body.data.some((o) => o.order_id === draft.order_id), true, 'the office still sees every order');
});
