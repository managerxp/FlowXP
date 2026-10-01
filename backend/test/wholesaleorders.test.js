/*
 * Wholesale sales orders: pricing at order time, reservation, back-orders, credit control, approval, cancel / close,
 * and that the last cartons can only be promised once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addCustomer, addProduct, makeWholesaler, stockOf } from './helpers/wholesale.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const orders = (await import('../src/controllers/wholesaleOrders.controller.js')).default;
const parties = (await import('../src/controllers/wholesaleParties.controller.js')).default;

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);

const place = (w, body, tenant) => w.call(orders.create, { body }, tenant);

t('an order is priced from the price rules, totals include GST, and carton lines convert to base units', async () => {
  const w = await makeWholesaler(pool, 'o1');
  const p = await addProduct(pool, w, { name: 'Biscuit', price: 10, tax: 18, stock: 1000, units: [{ name: 'carton', factor: 288 }] });
  const c = await addCustomer(pool, w, { name: 'Sharma', type: 'RETAILER' });
  const res = await place(w, { customer_id: c, lines: [{ product_id: p, unit_name: 'carton', quantity: 2 }], shipping_charge: 100, shipping_tax_rate: 18 });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  const o = res.body.data;
  assert.equal(o.status, 'DRAFT');
  assert.equal(o.items[0].base_qty, 576);
  assert.equal(o.items[0].price, 2880);                    // a carton is 288 × ₹10
  assert.equal(o.subtotal, 5860);                          // 2 × 2880 + 100 shipping
  assert.equal(o.tax, 1054.8);                             // 18% on both
  assert.equal(o.total, 6914.8);
  assert.match(o.order_number, /^SO-\d{5}$/);
});

t('confirming reserves stock; what is short becomes a back-order and is reserved when stock arrives', async () => {
  const w = await makeWholesaler(pool, 'o2');
  const p = await addProduct(pool, w, { name: 'Oil', price: 100, stock: 30 });
  const c = await addCustomer(pool, w, {});
  const o = (await place(w, { customer_id: c, lines: [{ product_id: p, quantity: 50 }] })).body.data;
  const confirmed = await w.call(orders.confirm, { params: { id: o.order_id } });
  assert.equal(confirmed.code, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.data.status, 'CONFIRMED');
  assert.deepEqual(await stockOf(pool, w.branchId, p), { on_hand: 30, reserved: 30 });
  assert.equal(confirmed.body.data.items[0].backorder, 20);
  assert.equal(confirmed.body.data.backordered[0].short, 20);
  assert.equal((await w.call(orders.backorders, {})).body.data.length, 1);

  await pool.query(`UPDATE branch_stock SET quantity = quantity + 40 WHERE branch_id = $1 AND product_id = $2`, [w.branchId, p]);
  const again = await w.call(orders.reserve, { params: { id: o.order_id } });
  assert.equal(again.body.data.items[0].backorder, 0);
  assert.deepEqual(await stockOf(pool, w.branchId, p), { on_hand: 70, reserved: 50 });
});

t('two orders for the last cartons: only one is promised them', async () => {
  const w = await makeWholesaler(pool, 'o3');
  const p = await addProduct(pool, w, { name: 'Last', price: 100, stock: 10 });
  const c = await addCustomer(pool, w, {});
  const a = (await place(w, { customer_id: c, lines: [{ product_id: p, quantity: 10 }] })).body.data;
  const b = (await place(w, { customer_id: c, lines: [{ product_id: p, quantity: 10 }] })).body.data;
  const [ra, rb] = await Promise.all([w.call(orders.confirm, { params: { id: a.order_id } }), w.call(orders.confirm, { params: { id: b.order_id } })]);
  assert.equal(ra.code, 200); assert.equal(rb.code, 200);
  assert.deepEqual(await stockOf(pool, w.branchId, p), { on_hand: 10, reserved: 10 });   // never more than is there
  const left = [ra, rb].map((r) => r.body.data.items[0].backorder).sort();
  assert.deepEqual(left, [0, 10]);
});

t('cancelling gives the stock back; a cancelled order cannot be confirmed', async () => {
  const w = await makeWholesaler(pool, 'o4');
  const p = await addProduct(pool, w, { name: 'X', price: 10, stock: 20 });
  const c = await addCustomer(pool, w, {});
  const o = (await place(w, { customer_id: c, lines: [{ product_id: p, quantity: 15 }], submit: true })).body.data;
  assert.equal(o.status, 'PENDING');
  await w.call(orders.confirm, { params: { id: o.order_id } });
  assert.equal((await stockOf(pool, w.branchId, p)).reserved, 15);
  assert.equal((await w.call(orders.cancel, { params: { id: o.order_id }, body: {} })).code, 400);     // a reason is needed
  const gone = await w.call(orders.cancel, { params: { id: o.order_id }, body: { reason: 'Customer changed mind' } });
  assert.equal(gone.body.data.status, 'CANCELLED');
  assert.equal((await stockOf(pool, w.branchId, p)).reserved, 0);
  assert.equal((await w.call(orders.confirm, { params: { id: o.order_id } })).code, 409);
});

t('editing a confirmed order releases and re-reserves', async () => {
  const w = await makeWholesaler(pool, 'o5');
  const p = await addProduct(pool, w, { name: 'X', price: 10, stock: 100 });
  const c = await addCustomer(pool, w, {});
  const o = (await place(w, { customer_id: c, lines: [{ product_id: p, quantity: 10 }] })).body.data;
  await w.call(orders.confirm, { params: { id: o.order_id } });
  const edited = await w.call(orders.update, { params: { id: o.order_id }, body: { lines: [{ product_id: p, quantity: 25 }] } });
  assert.equal(edited.code, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.data.items[0].reserved, 25);
  assert.equal((await stockOf(pool, w.branchId, p)).reserved, 25);
});

t('credit control: BLOCK refuses over the limit, a manager can override, WARN lets it through with a note', async () => {
  const w = await makeWholesaler(pool, 'o6');
  const p = await addProduct(pool, w, { name: 'Pricey', price: 1000, tax: 0, stock: 100 });
  const c = await addCustomer(pool, w, { name: 'Limited', limit: 5000, opening: 0 });
  await w.call(parties.updateSettings, { body: { credit_policy: 'BLOCK' } });
  const big = (await place(w, { customer_id: c, lines: [{ product_id: p, quantity: 8 }] })).body.data;
  const refused = await w.call(orders.confirm, { params: { id: big.order_id } });
  assert.equal(refused.code, 409);
  assert.equal(refused.body.code, 'CREDIT_BLOCK');
  assert.equal((await stockOf(pool, w.branchId, p)).reserved, 0);

  // a sales executive cannot override; the owner can
  const exec = w.tenantFor('SALES_EXECUTIVE');
  assert.equal((await w.call(orders.confirm, { params: { id: big.order_id }, body: { credit_override: true } }, exec)).code, 409);
  const forced = await w.call(orders.confirm, { params: { id: big.order_id }, body: { credit_override: true, reason: 'Owner approved' } });
  assert.equal(forced.code, 200);
  assert.match(forced.body.data.credit_note, /Override/);

  // open orders count against the limit: ₹8,000 is already promised, so another ₹1,000 order is refused too
  const next = (await place(w, { customer_id: c, lines: [{ product_id: p, quantity: 1 }] })).body.data;
  assert.equal((await w.call(orders.confirm, { params: { id: next.order_id } })).code, 409);

  await w.call(parties.updateSettings, { body: { credit_policy: 'WARN' } });
  const warned = await w.call(orders.confirm, { params: { id: next.order_id } });
  assert.equal(warned.code, 200);
  assert.ok(warned.body.data.warnings.length);
});

t('big orders need a manager to confirm; below-MOQ and hand-set prices need permission', async () => {
  const w = await makeWholesaler(pool, 'o7');
  const p = await addProduct(pool, w, { name: 'Bulk', price: 100, tax: 0, stock: 1000, moq: 10 });
  const c = await addCustomer(pool, w, {});
  await w.call(parties.updateSettings, { body: { order_approval_over: 5000 } });
  const exec = w.tenantFor('SALES_EXECUTIVE');
  const sp = (await pool.query(`INSERT INTO wholesale_salespeople (business_id, user_id, name) VALUES ($1,$2,'Exec') RETURNING salesperson_id`, [w.businessId, w.userId])).rows[0].salesperson_id;
  await pool.query(`UPDATE wholesale_customer_profiles SET salesperson_id = $2 WHERE customer_id = $1`, [c, sp]);
  const small = await place(w, { customer_id: c, lines: [{ product_id: p, quantity: 5 }] }, exec);
  assert.equal(small.code, 400);                                  // below the minimum order quantity
  const big = (await place(w, { customer_id: c, lines: [{ product_id: p, quantity: 100 }] }, exec)).body.data;
  assert.equal(big.approval_needed, true);
  assert.equal((await w.call(orders.confirm, { params: { id: big.order_id } }, exec)).code, 403);
  assert.equal((await w.call(orders.confirm, { params: { id: big.order_id } })).code, 200);    // the owner may
  const hand = await place(w, { customer_id: c, lines: [{ product_id: p, quantity: 20, price: 1 }] }, exec);
  assert.equal(hand.code, 403);
  // an executive sees only their own customers: another customer is not theirs
  const other = await addCustomer(pool, w, { name: 'Not mine' });
  assert.equal((await place(w, { customer_id: other, lines: [{ product_id: p, quantity: 20 }] }, exec)).code, 403);
  assert.deepEqual((await w.call(parties.listCustomers, {}, exec)).body.data.map((x) => x.customer_id), [c]);
});

t('tenancy: another wholesaler cannot see, confirm or cancel the order', async () => {
  const a = await makeWholesaler(pool, 'ta');
  const b = await makeWholesaler(pool, 'tb');
  const p = await addProduct(pool, a, { name: 'X', stock: 10 });
  const c = await addCustomer(pool, a, {});
  const o = (await place(a, { customer_id: c, lines: [{ product_id: p, quantity: 1 }] })).body.data;
  for (const fn of [orders.get, orders.confirm, orders.cancel]) assert.equal((await b.call(fn, { params: { id: o.order_id }, body: { reason: 'xx' } })).code, 404);
  assert.equal((await b.call(orders.list, {})).body.data.length, 0);
  const cross = await place(b, { customer_id: c, lines: [{ product_id: p, quantity: 1 }] });
  assert.equal(cross.code, 400);
});
