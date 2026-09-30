/*
 * A counter sale sent to the kitchen (the café way: pay first, collect later):
 * one transaction makes the bill, a takeaway order and its kitchen ticket.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const orders = await import('../src/controllers/orders.controller.js');
const kitchen = await import('../src/controllers/kitchen.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

const makeBusiness = async (label, type) => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@counter.test`])).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,$3) RETURNING business_id`, [label, user, type])).rows[0].business_id;
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role) VALUES ($1,$2,'OWNER')`, [biz, user]);
  const tenant = { businessId: biz, branchId, scopeBranchId: branchId, role: 'OWNER', permissions: {}, businessType: type };
  const call = async (fn, extra = {}) => { const res = fakeRes(); await fn({ tenant, auth: { userId: user }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res); return res; };
  const product = async (name, paise, status = 'ACTIVE') => (await pool.query(
    `INSERT INTO products (business_id, name, selling_price_paise, status, track_inventory) VALUES ($1,$2,$3,$4,FALSE) RETURNING product_id`, [biz, name, paise, status])).rows[0].product_id;
  const count = async (table) => Number((await pool.query(`SELECT COUNT(*) FROM ${table} WHERE business_id = $1`, [biz])).rows[0].count);
  return { biz, call, product, count };
};

test('a counter sale goes to the kitchen and is billed once', { skip }, async () => {
  await runMigrations(pool);
  const cafe = await makeBusiness('cafe', 'CAFE');
  const latte = await cafe.product('Latte', 18000);
  const muffin = await cafe.product('Muffin', 9000);

  const res = await cafe.call(invoices.create, { body: {
    send_to_kitchen: true,
    items: [{ product_id: latte, quantity: 2 }, { product_id: muffin, quantity: 1 }, { description: 'Extra sauce', unit_price: 10, quantity: 1 }],
    payment: { method: 'CASH', amount: 'FULL' }
  } });
  assert.equal(res.code, 201, res.body?.message);
  const inv = res.body.data;
  assert.ok(inv.order?.order_number && inv.order?.kot_number);
  assert.equal(inv.total, 460);
  assert.equal(inv.payment_status, 'PAID');

  // one order, billed, linked both ways; every line is on the ticket and billed
  const order = (await pool.query(`SELECT * FROM orders WHERE order_id = $1`, [inv.order.order_id])).rows[0];
  assert.deepEqual([order.status, order.order_type, order.invoice_id], ['BILLED', 'TAKEAWAY', inv.invoice_id]);
  assert.equal((await pool.query(`SELECT order_id FROM invoices WHERE invoice_id = $1`, [inv.invoice_id])).rows[0].order_id, order.order_id);
  const lines = (await pool.query(`SELECT status, invoice_id, kot_id FROM order_items WHERE order_id = $1`, [order.order_id])).rows;
  assert.equal(lines.length, 3);
  assert.ok(lines.every((l) => l.status === 'PREPARING' && l.invoice_id === inv.invoice_id && l.kot_id === inv.order.kot_id));

  // the kitchen sees it; the open-orders list does not (nothing left to bill)
  const ticket = (await cafe.call(kitchen.tickets)).body.data.tickets.find((t) => t.order_id === order.order_id);
  assert.equal(ticket.items.length, 3);
  assert.equal(ticket.order_type, 'TAKEAWAY');
  assert.ok(!(await cafe.call(orders.list, { query: { open_only: 'true' } })).body.data.some((o) => o.order_id === order.order_id));

  // a plain sale still makes no order
  const before = await cafe.count('orders');
  assert.equal((await cafe.call(invoices.create, { body: { items: [{ product_id: muffin, quantity: 1 }] } })).code, 201);
  assert.equal(await cafe.count('orders'), before);

  // any failure leaves nothing behind: no order, no ticket, no bill
  const archived = await cafe.product('Old cake', 5000, 'ARCHIVED');
  const [o, k, i] = [await cafe.count('orders'), await cafe.count('kot_tickets'), await cafe.count('invoices')];
  const failed = await cafe.call(invoices.create, { body: { send_to_kitchen: true, items: [{ product_id: latte, quantity: 1 }, { product_id: archived, quantity: 1 }] } });
  assert.equal(failed.code, 400);
  assert.deepEqual([await cafe.count('orders'), await cafe.count('kot_tickets'), await cafe.count('invoices')], [o, k, i]);

  // a shop has no kitchen
  const shop = await makeBusiness('shop', 'RETAIL');
  const pen = await shop.product('Pen', 1000);
  assert.equal((await shop.call(invoices.create, { body: { send_to_kitchen: true, items: [{ product_id: pen, quantity: 1 }] } })).code, 400);
});
