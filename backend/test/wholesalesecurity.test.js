/*
 * Wholesale security: who may reach what (the role table, enforced by the real route middleware), plan gating,
 * wholesale-only access, and a warehouse-pinned person being kept to their own warehouse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addCustomer, addProduct, fakeRes, makeWholesaler } from './helpers/wholesale.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const router = (await import('../src/routes/wholesale.routes.js')).default;
const { wholesaleOnly } = await import('../src/modules/wholesale/common.js');
const orders = (await import('../src/controllers/wholesaleOrders.controller.js')).default;
const ful = (await import('../src/controllers/wholesaleFulfilment.controller.js')).default;
const inv = (await import('../src/controllers/wholesaleInventory.controller.js')).default;

test.after(cleanup);

const routes = router.stack.filter((l) => l.route).map((l) => ({
  method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path, stack: l.route.stack.map((s) => s.handle)
}));

/** Run a route's own gates for this tenant (everything between sign-in / tenant lookup and the controller). */
const gate = async (route, tenant, { method = 'GET' } = {}) => {
  const chain = route.stack.slice(2, -1);
  for (const mw of chain) {
    const res = fakeRes(); let passed = false;
    await mw({ tenant, method, headers: {}, body: {}, get: () => undefined, originalUrl: route.path }, res, () => { passed = true; });
    if (!passed) return res.code;
  }
  return 200;
};
const find = (method, path) => { const r = routes.find((x) => x.method === method && x.path === path); assert.ok(r, `${method} ${path} exists`); return r; };

let W;
test('setup', { skip }, async () => { await runMigrations(pool); W = await makeWholesaler(pool, 'sec', { branches: 2 }); });

test('every wholesale route is wholesale-only and sits behind sign-in and a tenant', { skip }, () => {
  assert.ok(routes.length > 120, `the router has its routes (${routes.length})`);
  for (const r of routes) assert.ok(r.stack.slice(0, 3).includes(wholesaleOnly), `${r.method} ${r.path} is wholesale-only`);
  // every route has at least one gate beyond that: a permission
  for (const r of routes) assert.ok(r.stack.length >= 4, `${r.method} ${r.path} has a permission gate`);
});

test('the role table: who may do what', { skip }, async () => {
  const tenantOf = (role) => W.tenantFor(role);
  const table = [
    ['POST', '/orders', { OWNER: 200, SALES_MANAGER: 200, SALES_EXECUTIVE: 200, WAREHOUSE_MANAGER: 403, WAREHOUSE_STAFF: 403, PURCHASE_MANAGER: 403, ACCOUNTANT: 403, DELIVERY: 403 }],
    ['POST', '/orders/:id/confirm', { OWNER: 200, SALES_MANAGER: 200, SALES_EXECUTIVE: 200, WAREHOUSE_STAFF: 403 }],
    ['POST', '/orders/:id/close', { OWNER: 200, SALES_MANAGER: 200, SALES_EXECUTIVE: 403, WAREHOUSE_MANAGER: 403 }],
    ['POST', '/orders/:id/pick-lists', { OWNER: 200, WAREHOUSE_MANAGER: 200, WAREHOUSE_STAFF: 200, DELIVERY: 200, SALES_EXECUTIVE: 403, ACCOUNTANT: 403 }],
    ['POST', '/pick-lists/:id/dispatch', { OWNER: 200, WAREHOUSE_MANAGER: 200, WAREHOUSE_STAFF: 200, SALES_EXECUTIVE: 403, PURCHASE_MANAGER: 403 }],
    ['POST', '/deliveries/:id/status', { OWNER: 200, DELIVERY: 200, WAREHOUSE_STAFF: 200, SALES_EXECUTIVE: 403, ACCOUNTANT: 403 }],
    ['POST', '/inventory/adjust', { OWNER: 200, WAREHOUSE_MANAGER: 200, PURCHASE_MANAGER: 200, WAREHOUSE_STAFF: 403, SALES_EXECUTIVE: 403, DELIVERY: 403 }],
    ['POST', '/transfers', { OWNER: 200, WAREHOUSE_MANAGER: 200, WAREHOUSE_STAFF: 403, SALES_MANAGER: 403 }],
    ['POST', '/purchase-orders', { OWNER: 200, PURCHASE_MANAGER: 200, WAREHOUSE_MANAGER: 200, SALES_MANAGER: 403, WAREHOUSE_STAFF: 403, ACCOUNTANT: 403 }],
    ['POST', '/purchase-orders/:id/approve', { OWNER: 200, PURCHASE_MANAGER: 200, WAREHOUSE_MANAGER: 403, SALES_MANAGER: 403, ACCOUNTANT: 403 }],
    ['POST', '/grns', { OWNER: 200, WAREHOUSE_MANAGER: 200, PURCHASE_MANAGER: 200, WAREHOUSE_STAFF: 403, SALES_EXECUTIVE: 403 }],
    ['POST', '/receipts', { OWNER: 200, SALES_MANAGER: 200, ACCOUNTANT: 200, PURCHASE_MANAGER: 200, SALES_EXECUTIVE: 403, WAREHOUSE_STAFF: 403, DELIVERY: 403 }],
    ['POST', '/receipts/:id/reverse', { OWNER: 200, SALES_MANAGER: 200, ACCOUNTANT: 200, PURCHASE_MANAGER: 403, SALES_EXECUTIVE: 403 }],
    ['POST', '/refunds', { OWNER: 200, SALES_MANAGER: 200, ACCOUNTANT: 200, SALES_EXECUTIVE: 403, WAREHOUSE_MANAGER: 403 }],
    ['POST', '/returns/sales', { OWNER: 200, SALES_MANAGER: 200, ACCOUNTANT: 200, SALES_EXECUTIVE: 403, WAREHOUSE_STAFF: 403 }],
    ['POST', '/returns/purchase', { OWNER: 200, PURCHASE_MANAGER: 200, WAREHOUSE_MANAGER: 200, SALES_MANAGER: 403 }],
    ['PUT', '/customers/:id/credit-limit', { OWNER: 200, SALES_MANAGER: 200, ACCOUNTANT: 200, SALES_EXECUTIVE: 403, PURCHASE_MANAGER: 200 }],
    ['PUT', '/price-lists/:id/items', { OWNER: 200, SALES_MANAGER: 200, SALES_EXECUTIVE: 403, ACCOUNTANT: 403, WAREHOUSE_MANAGER: 403 }],
    ['POST', '/products/bulk-price', { OWNER: 200, SALES_MANAGER: 200, SALES_EXECUTIVE: 403, WAREHOUSE_MANAGER: 403 }],
    ['PUT', '/settings', { OWNER: 200, ADMIN: 200, MANAGER: 403, SALES_MANAGER: 403, ACCOUNTANT: 403 }],
    ['GET', '/reports/:key', { OWNER: 200, SALES_MANAGER: 200, ACCOUNTANT: 200, PURCHASE_MANAGER: 200, SALES_EXECUTIVE: 403, WAREHOUSE_STAFF: 403, DELIVERY: 403 }],
    ['GET', '/dashboard', { OWNER: 200, SALES_EXECUTIVE: 200, WAREHOUSE_STAFF: 200, DELIVERY: 200, KITCHEN: 403 }],
    ['POST', '/import/products', { OWNER: 200, MANAGER: 200, SALES_EXECUTIVE: 403, WAREHOUSE_STAFF: 403, ACCOUNTANT: 403 }],
    ['GET', '/customers/:id/ledger', { OWNER: 200, SALES_MANAGER: 200, ACCOUNTANT: 200, SALES_EXECUTIVE: 200, WAREHOUSE_STAFF: 403 }]
  ];
  for (const [method, path, expect] of table) {
    const route = find(method, path);
    for (const [role, want] of Object.entries(expect)) assert.equal(await gate(route, tenantOf(role), { method }), want, `${role} ${method} ${path}`);
  }
});

test('a per-person override can widen or narrow a role, and the owner cannot be locked out', { skip }, async () => {
  const approve = find('POST', '/purchase-orders/:id/approve');
  assert.equal(await gate(approve, W.tenantFor('WAREHOUSE_MANAGER', { permissions: { purchase_approve: true } })), 200, 'granted');
  assert.equal(await gate(approve, W.tenantFor('PURCHASE_MANAGER', { permissions: { purchase_approve: false } })), 403, 'revoked');
  assert.equal(await gate(approve, W.tenantFor('OWNER', { permissions: { purchase_approve: false } })), 200, 'owner wildcard stands');
});

test('plans gate the separately-priced features, for everyone including the owner', { skip }, async () => {
  const cases = [['GET', '/orders', 'wholesale_orders'], ['POST', '/pick-lists/:id/pack', 'wholesale_fulfilment'], ['POST', '/transfers', 'wholesale_fulfilment'],
    ['GET', '/price-lists', 'wholesale_pricing'], ['POST', '/pricing/quote', null], ['GET', '/inventory/batches', 'wholesale_batches'], ['GET', '/inventory/expiry', 'wholesale_batches']];
  for (const [method, path, feature] of cases) {
    if (!feature) continue;
    const route = find(method, path);
    assert.equal(await gate(route, W.tenantFor('OWNER', { planFeatures: { [feature]: false } }), { method }), 402, `${feature} off → ${method} ${path}`);
    assert.equal(await gate(route, W.tenantFor('OWNER', { planFeatures: { [feature]: true } }), { method }), 200, `${feature} on`);
  }
  // products, customers, suppliers, purchasing, receipts, stock levels and reports stay open on every plan
  const allOff = { wholesale_orders: false, wholesale_fulfilment: false, wholesale_pricing: false, wholesale_batches: false };
  for (const [method, path] of [['GET', '/products'], ['GET', '/customers'], ['POST', '/purchase-orders'], ['POST', '/receipts'], ['GET', '/inventory'], ['GET', '/dashboard']]) {
    assert.equal(await gate(find(method, path), W.tenantFor('OWNER', { planFeatures: allOff }), { method }), 200, `${method} ${path}`);
  }
});

test('the wholesale module does not exist for any other kind of business', { skip }, () => {
  for (const businessType of ['RESTAURANT', 'RETAIL', 'SALON', 'GENERAL', undefined]) {
    const res = fakeRes(); let passed = false;
    wholesaleOnly({ tenant: { businessType } }, res, () => { passed = true; });
    assert.deepEqual([passed, res.code], [false, 404], String(businessType));
  }
  for (const businessType of ['WHOLESALE', 'DISTRIBUTOR']) {
    let passed = false; wholesaleOnly({ tenant: { businessType } }, fakeRes(), () => { passed = true; });
    assert.equal(passed, true, businessType);
  }
});

test('writes need an active subscription', { skip }, () => {
  // the write chain is [requireAuth, withBusiness({ requireActive: true }), wholesaleOnly, ...]; the read chain uses withBusiness() — different functions
  const read = find('GET', '/orders').stack[1]; const write = find('POST', '/orders').stack[1];
  assert.notEqual(read, write);
  const readOnlyPosts = new Set(['/pricing/quote', '/orders/preview']);   // POSTs that only calculate
  for (const r of routes.filter((x) => x.method !== 'GET' && !readOnlyPosts.has(x.path))) assert.notEqual(r.stack[1], read, `${r.method} ${r.path} is a write`);
});

test('a sales executive sees only the customers assigned to them, everywhere', { skip }, async () => {
  const parties = (await import('../src/controllers/wholesaleParties.controller.js')).default;
  const catalog = (await import('../src/controllers/wholesaleCatalog.controller.js')).default;
  const mine = await addCustomer(pool, W, { name: 'Mine' }); const theirs = await addCustomer(pool, W, { name: 'Theirs' });
  const sp = (await pool.query(`INSERT INTO wholesale_salespeople (business_id, user_id, name) VALUES ($1,$2,'Exec') RETURNING salesperson_id`, [W.businessId, W.userId])).rows[0].salesperson_id;
  await pool.query(`UPDATE wholesale_customer_profiles SET salesperson_id = $2 WHERE customer_id = $1`, [mine, sp]);
  const exec = W.tenantFor('SALES_EXECUTIVE');
  assert.equal((await W.call(parties.getCustomer, { params: { id: mine } }, exec)).code, 200);
  for (const fn of [parties.getCustomer, parties.customerLedger, parties.customerAgeing, parties.customerInvoices, parties.customerCredit, parties.updateCustomer, parties.archiveCustomer, catalog.customerPrices]) {
    assert.equal((await W.call(fn, { params: { id: theirs }, body: { name: 'x' } }, exec)).code, 404, fn.name || 'handler');
  }
  assert.deepEqual((await W.call(parties.listCustomers, {}, exec)).body.data.map((x) => x.name), ['Mine']);
});

test('a person pinned to one warehouse is kept to it', { skip }, async () => {
  const [a, b] = W.branchIds;
  const p = await addProduct(pool, W, { name: 'X', price: 10, tax: 0, stock: 50, branchId: a });
  const c = await addCustomer(pool, W, {});
  const pinned = W.tenantFor('WAREHOUSE_MANAGER', { branchId: b, pinned: true });
  // cannot create an order from, receive into, adjust or list the other warehouse
  assert.equal((await W.call(orders.create, { body: { customer_id: c, branch_id: a, lines: [{ product_id: p, quantity: 1 }] } }, W.tenantFor('SALES_MANAGER', { branchId: b, pinned: true }))).code, 403);
  assert.equal((await W.call(inv.adjust, { body: { branch_id: a, product_id: p, mode: 'ADD', quantity: 1, reason: 'test' } }, pinned)).code, 404);
  const mine = await W.call(inv.listWarehouses, {}, pinned);
  assert.deepEqual(mine.body.data.map((x) => x.branch_id), [b]);
  // an order at warehouse A is invisible to a picker at B
  const o = (await W.call(orders.create, { body: { customer_id: c, branch_id: a, lines: [{ product_id: p, quantity: 5 }] } })).body.data;
  await W.call(orders.confirm, { params: { id: o.order_id } });
  assert.equal((await W.call(ful.createPick, { params: { id: o.order_id }, body: {} }, pinned)).code, 404);
  assert.equal((await W.call(orders.list, {}, W.tenantFor('SALES_MANAGER', { branchId: b, pinned: true }))).body.data.length, 0);
  // "all warehouses" viewers must name a warehouse before changing anything
  const all = { ...W.tenantFor('OWNER'), viewAll: true };
  assert.equal((await W.call(orders.create, { body: { customer_id: c, lines: [{ product_id: p, quantity: 1 }] } }, all)).code, 400);
  assert.equal((await W.call(inv.adjust, { body: { product_id: p, mode: 'ADD', quantity: 1, reason: 'test' } }, all)).code, 400);
});
