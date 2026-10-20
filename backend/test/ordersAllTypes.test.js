/*
 * Sales orders and delivery challans for every kind of business: a RETAIL shop, with a product and a customer made the ordinary retail way (none of
 * the wholesale-only profile rows), takes an order, picks, packs and dispatches it, and gets the challan and the invoice; the routes for orders and
 * deliveries no longer carry the wholesale-only gate, and the ones that are still wholesale business (purchasing, price lists) do.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { makeWholesaler } from './helpers/wholesale.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const orders = (await import('../src/controllers/wholesaleOrders.controller.js')).default;
const ful = (await import('../src/controllers/wholesaleFulfilment.controller.js')).default;
const parties = (await import('../src/controllers/wholesaleParties.controller.js')).default;
const catalog = (await import('../src/controllers/wholesaleCatalog.controller.js')).default;
const router = (await import('../src/routes/wholesale.routes.js')).default;
const { wholesaleOnly } = await import('../src/modules/wholesale/common.js');

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);

/* the middleware stack of one route, found by method and path */
const stackOf = (method, path) => router.stack.find((l) => l.route?.path === path && l.route.methods[method])?.route.stack.map((s) => s.handle) ?? null;

t('orders, deliveries and the lookups the order screen needs are open to any business type; purchasing and price lists are not', () => {
  for (const [method, path] of [['get', '/orders'], ['post', '/orders'], ['post', '/orders/:id/confirm'], ['get', '/deliveries'], ['post', '/pick-lists/:id/dispatch'], ['get', '/customers'], ['get', '/products'], ['get', '/salespeople']]) {
    const stack = stackOf(method, path);
    assert.ok(stack, `${method} ${path} exists`);
    assert.ok(!stack.includes(wholesaleOnly), `${method} ${path} has no wholesale-only gate`);
  }
  for (const [method, path] of [['get', '/purchase-orders'], ['get', '/price-lists'], ['post', '/products']]) {
    const stack = stackOf(method, path);
    assert.ok(stack, `${method} ${path} exists`);
    assert.ok(stack.includes(wholesaleOnly), `${method} ${path} is still wholesale-only`);
  }
});

t('a retail shop takes an order and delivers it: challan, invoice and stock all follow', async () => {
  const w = await makeWholesaler(pool, 'retail', { type: 'RETAIL', state: 'Karnataka' });
  // made the way a shop makes them: no wholesale item details, no wholesale customer profile
  const product = (await pool.query(`INSERT INTO products (business_id, name, unit, selling_price_paise, purchase_price_paise, tax_rate, track_inventory, current_stock, kind) VALUES ($1,'Bolt','pcs',10000,6000,18,TRUE,50,'DISH') RETURNING product_id`, [w.businessId])).rows[0].product_id;
  await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,50)`, [w.branchId, product]);
  const customer = (await pool.query(`INSERT INTO customers (business_id, name, phone, state) VALUES ($1,'Ravi Motors','9000077777','Karnataka') RETURNING customer_id`, [w.businessId])).rows[0].customer_id;

  // the lookups the order screen makes work for a retail tenant
  const cust = await w.call(parties.listCustomers, { query: { q: 'Ravi' } });
  assert.equal(cust.code, 200, JSON.stringify(cust.body));
  const prod = await w.call(catalog.list, { query: { q: 'Bolt' } });
  assert.equal(prod.code, 200, JSON.stringify(prod.body));

  const o = await w.call(orders.create, { body: { customer_id: customer, lines: [{ product_id: product, quantity: 5 }] } });
  assert.equal(o.code, 201, JSON.stringify(o.body));
  const confirmed = await w.call(orders.confirm, { params: { id: o.body.data.order_id } });
  assert.equal(confirmed.code, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.data.total, 590, '5 x ₹100 + 18% GST');

  const pl = await w.call(ful.createPick, { params: { id: o.body.data.order_id }, body: {} });
  assert.equal(pl.code, 201, JSON.stringify(pl.body));
  const id = pl.body.data.pick_id;
  assert.equal((await w.call(ful.startPick, { params: { id } })).code, 200);
  assert.equal((await w.call(ful.recordPick, { params: { id }, body: { all: true } })).code, 200);
  assert.equal((await w.call(ful.pack, { params: { id }, body: {} })).code, 200);
  const sent = await w.call(ful.dispatch, { params: { id }, body: { driver_name: 'Raju', vehicle_no: 'KA01AB1234' } });
  assert.equal(sent.code, 201, JSON.stringify(sent.body));
  assert.equal(sent.body.data.invoice_total, 590, 'the invoice equals the order');

  const challan = await w.call(ful.challan, { params: { id: sent.body.data.delivery_id } });
  assert.equal(challan.code, 200, JSON.stringify(challan.body));
  const stock = (await pool.query(`SELECT quantity, COALESCE(reserved_qty, 0) AS reserved FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [w.branchId, product])).rows[0];
  assert.deepEqual([Number(stock.quantity), Number(stock.reserved)], [45, 0], 'five left the shelf and nothing is still held');
});
