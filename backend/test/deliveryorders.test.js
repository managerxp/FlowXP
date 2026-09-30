/*
 * A delivery-platform order (Zomato/Swiggy/ONDC/Magicpin — one shared path)
 * arrives as PENDING_ACCEPT: no KOT, nothing sent to the kitchen, until
 * someone accepts or rejects it. See integrations.controller.js's webhook and
 * orders.controller.js's acceptDelivery/rejectDelivery.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const integrations = await import('../src/controllers/integrations.controller.js');
const orders = await import('../src/controllers/orders.controller.js');
const kitchen = await import('../src/controllers/kitchen.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const webhookReq = (platform, token, body) => ({ params: { platform, token }, body, headers: {}, ip: '127.0.0.1' });

let biz; let A; let B; let owner; let token;
const call = (fn, extra = {}) => { const res = fakeRes(); const tenant = { businessId: biz, branchId: A, scopeBranchId: A, role: 'OWNER', permissions: {} };
  return fn({ tenant, auth: { userId: owner }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res).then(() => res); };
const pinnedCall = (fn, branchId, extra = {}) => { const res = fakeRes(); const tenant = { businessId: biz, branchId, scopeBranchId: branchId, role: 'CASHIER', permissions: {} };
  return fn({ tenant, auth: { userId: owner }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res).then(() => res); };

const zomatoPayload = (id, items = [{ name: 'Paneer Tikka', quantity: 2, price: 220 }]) => ({
  order: { id, display_id: `#${id}`, customer: { name: 'Test Customer', phone: '+919000000000' }, items, instructions: 'Ring the bell' }
});

test('setup', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Owner','owner@delivery.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, subscription_status) VALUES ('Delivery Test',$1,'RESTAURANT','ACTIVE') RETURNING business_id`, [owner])).rows[0].business_id;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  B = (await pool.query(`INSERT INTO branches (business_id, name) VALUES ($1,'Second') RETURNING branch_id`, [biz])).rows[0].branch_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role) VALUES ($1,$2,'OWNER')`, [biz, owner]);

  token = 'a'.repeat(40);
  await pool.query(`INSERT INTO delivery_integrations (business_id, platform, is_enabled, webhook_token) VALUES ($1,'ZOMATO',TRUE,$2)`, [biz, token]);
});

test('a webhook order lands PENDING_ACCEPT with nothing sent to the kitchen', { skip }, async () => {
  const res = fakeRes();
  await integrations.webhook(webhookReq('zomato', token, zomatoPayload('Z100')), res);
  assert.equal(res.code, 201);
  const orderId = (await pool.query(`SELECT order_id FROM orders WHERE order_number = $1`, [res.body.order_number])).rows[0].order_id;

  const order = (await pool.query(`SELECT status, order_type, platform, branch_id FROM orders WHERE order_id = $1`, [orderId])).rows[0];
  assert.deepEqual([order.status, order.order_type, order.platform, order.branch_id], ['PENDING_ACCEPT', 'DELIVERY', 'ZOMATO', A]);

  const items = (await pool.query(`SELECT status, kot_id, sent_at, quantity, unit_price_paise FROM order_items WHERE order_id = $1`, [orderId])).rows;
  assert.equal(items.length, 1);
  assert.deepEqual([items[0].status, items[0].kot_id, items[0].sent_at], ['PENDING', null, null]);
  assert.deepEqual([Number(items[0].quantity), Number(items[0].unit_price_paise)], [2, 22000]);
  assert.equal((await pool.query(`SELECT COUNT(*) n FROM kot_tickets WHERE order_id = $1`, [orderId])).rows[0].n, '0');

  // not on the kitchen screen until accepted
  const tickets = (await call(kitchen.tickets)).body.data.tickets;
  assert.ok(!tickets.some((t) => t.order_id === orderId));

  // but it is a normal open order otherwise — the Orders/Billing "open orders" list sees it
  const open = (await call(orders.list, { query: { open_only: 'true' } })).body.data;
  assert.ok(open.some((o) => o.order_id === orderId));
});

test('the same platform order id is never created twice', { skip }, async () => {
  const first = fakeRes(); await integrations.webhook(webhookReq('zomato', token, zomatoPayload('Z101')), first);
  const second = fakeRes(); await integrations.webhook(webhookReq('zomato', token, zomatoPayload('Z101')), second);
  assert.deepEqual([second.code, second.body.duplicate, second.body.order_number], [200, true, first.body.order_number]);
  assert.equal((await pool.query(`SELECT COUNT(*) n FROM orders WHERE external_order_id = 'Z101'`)).rows[0].n, '1');
});

test('a disabled integration, an unknown platform and a malformed payload are all refused', { skip }, async () => {
  await pool.query(`INSERT INTO delivery_integrations (business_id, platform, is_enabled, webhook_token) VALUES ($1,'SWIGGY',FALSE,$2)`, [biz, 'b'.repeat(40)]);
  const off = fakeRes(); await integrations.webhook(webhookReq('swiggy', 'b'.repeat(40), zomatoPayload('S1')), off);
  assert.equal(off.code, 403);

  const unknown = fakeRes(); await integrations.webhook(webhookReq('doordash', token, {}), unknown);
  assert.equal(unknown.code, 404);

  const malformed = fakeRes(); await integrations.webhook(webhookReq('zomato', token, { order: { id: 'Z1', items: [] } }), malformed);
  assert.equal(malformed.code, 400);
});

test('pending-deliveries lists full item details, and drops off once decided', { skip }, async () => {
  const arrived = fakeRes(); await integrations.webhook(webhookReq('zomato', token, zomatoPayload('Z150', [{ name: 'Chicken 65', quantity: 1, price: 280 }, { name: 'Butter Naan', quantity: 3, price: 60 }])), arrived);
  const orderId = (await pool.query(`SELECT order_id FROM orders WHERE order_number = $1`, [arrived.body.order_number])).rows[0].order_id;

  const listed = (await call(orders.pendingDeliveries)).body.data.find((o) => o.order_id === orderId);
  assert.equal(listed.customer_name, 'Test Customer');
  assert.deepEqual(listed.items.map((i) => [i.description, i.quantity, i.unit_price]), [['Chicken 65', 1, 280], ['Butter Naan', 3, 60]]);

  await call(orders.acceptDelivery, { params: { id: orderId } });
  assert.ok(!(await call(orders.pendingDeliveries)).body.data.some((o) => o.order_id === orderId));
});

test('accepting sends it to the kitchen; a second accept or a reject after that both fail', { skip }, async () => {
  const arrived = fakeRes(); await integrations.webhook(webhookReq('zomato', token, zomatoPayload('Z200')), arrived);
  const orderId = (await pool.query(`SELECT order_id FROM orders WHERE order_number = $1`, [arrived.body.order_number])).rows[0].order_id;

  const accepted = await call(orders.acceptDelivery, { params: { id: orderId } });
  assert.equal(accepted.code, 200);
  assert.ok(accepted.body.data.kot_number);

  const order = (await pool.query(`SELECT status FROM orders WHERE order_id = $1`, [orderId])).rows[0];
  assert.equal(order.status, 'PREPARING');
  const item = (await pool.query(`SELECT status, sent_at, kot_id FROM order_items WHERE order_id = $1`, [orderId])).rows[0];
  assert.equal(item.status, 'PREPARING');
  assert.ok(item.sent_at && item.kot_id);

  // now on the kitchen screen
  const tickets = (await call(kitchen.tickets)).body.data.tickets;
  assert.ok(tickets.some((t) => t.order_id === orderId));

  assert.equal((await call(orders.acceptDelivery, { params: { id: orderId } })).code, 404, 'already accepted');
  assert.equal((await call(orders.rejectDelivery, { params: { id: orderId }, body: {} })).code, 404, 'too late to reject');
});

test('rejecting cancels it with no KOT and records why', { skip }, async () => {
  const arrived = fakeRes(); await integrations.webhook(webhookReq('zomato', token, zomatoPayload('Z300')), arrived);
  const orderId = (await pool.query(`SELECT order_id FROM orders WHERE order_number = $1`, [arrived.body.order_number])).rows[0].order_id;

  const rejected = await call(orders.rejectDelivery, { params: { id: orderId }, body: { reason: 'Kitchen closing for the night' } });
  assert.equal(rejected.code, 200);

  const order = (await pool.query(`SELECT status, rejection_reason FROM orders WHERE order_id = $1`, [orderId])).rows[0];
  assert.deepEqual([order.status, order.rejection_reason], ['CANCELLED', 'Kitchen closing for the night']);
  assert.equal((await pool.query(`SELECT status FROM order_items WHERE order_id = $1`, [orderId])).rows[0].status, 'CANCELLED');
  assert.equal((await pool.query(`SELECT COUNT(*) n FROM kot_tickets WHERE order_id = $1`, [orderId])).rows[0].n, '0');

  // it no longer needs anyone's attention
  const open = (await call(orders.list, { query: { open_only: 'true' } })).body.data;
  assert.ok(!open.some((o) => o.order_id === orderId));
});

test('another outlet cannot accept or reject it', { skip }, async () => {
  const arrived = fakeRes(); await integrations.webhook(webhookReq('zomato', token, zomatoPayload('Z400')), arrived);
  const orderId = (await pool.query(`SELECT order_id FROM orders WHERE order_number = $1`, [arrived.body.order_number])).rows[0].order_id;

  assert.equal((await pinnedCall(orders.acceptDelivery, B, { params: { id: orderId } })).code, 404);
  assert.equal((await pinnedCall(orders.rejectDelivery, B, { params: { id: orderId }, body: {} })).code, 404);

  // the order's own outlet still can
  assert.equal((await pinnedCall(orders.acceptDelivery, A, { params: { id: orderId } })).code, 200);
});
