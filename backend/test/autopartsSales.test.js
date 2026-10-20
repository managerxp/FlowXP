/*
 * Auto parts selling: holds for customers, trade price lists, garage credit limits, the unit guard, and bins/ledger staying consistent through all of it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addPart, fakeRes, makeShop, rs } from './helpers/autoparts.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const sell = (await import('../src/controllers/autopartsSales.controller.js')).default;
const wh = (await import('../src/controllers/autopartsWarehouse.controller.js')).default;
const bins = await import('../src/modules/autoparts/bins.js');
const { inTx } = await import('../src/modules/autoparts/common.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const router = (await import('../src/routes/autoparts.routes.js')).default;
const invoicesApi = await import('../src/controllers/invoices.controller.js');

test.after(cleanup);

let S; let tenant; let bin; let garage; let walkin;
const call = (handler, extra, t = tenant) => S.call(handler, extra, t);
const okBody = (res, code = 200) => { assert.equal(res.code, code, JSON.stringify(res.body)); assert.equal(res.body.success, true); return res.body.data; };
const row = async (id) => (await pool.query(`SELECT quantity, reserved_qty FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [S.branchId, id])).rows[0];
const binRow = async (id) => (await pool.query(`SELECT COALESCE(SUM(qty),0) AS qty, COALESCE(SUM(reserved_qty),0) AS res FROM bin_stock WHERE product_id = $1`, [id])).rows[0];
const bill = (items, { customerId = null, pay = 'FULL' } = {}) => inTx((db) => createInvoiceInTransaction(db, { businessId: S.businessId, branchId: S.branchId, businessType: 'AUTO_PARTS' }, S.userId,
  { customerId, items, payment: pay === null ? undefined : { amount: pay, method: 'CASH' } }));
const rejected = async (p) => { try { await p; } catch (error) { return error; } return null; };
const invariant = async () => assert.equal((await bins.reconcile(pool, S.allOutlets())).ok, true);
const shelve = async (p, qty) => okBody(await call(wh.putAway, { body: { product_id: p, location_id: bin.location_id, qty }, headers: {} }), 201);

test('setup', { skip }, async () => {
  await runMigrations(pool);
  S = await makeShop(pool, 'sl');
  tenant = S.tenantFor();
  const w = okBody(await call(wh.create, { body: { segment: 'WH' } }), 201);
  bin = okBody(await call(wh.create, { body: { parent_id: w.location_id, segment: 'B1', loc_type: 'BIN' } }), 201);
  garage = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Ravi Garage','9000000001') RETURNING customer_id`, [S.businessId])).rows[0].customer_id;
  walkin = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Walk In','9000000002') RETURNING customer_id`, [S.businessId])).rows[0].customer_id;
});

test('a hold takes stock out of what others can buy, and is used up when its customer is billed', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Brake disc', stock: 10, price: 1000 });
  await shelve(p, 10);
  const r = okBody(await call(sell.reserve, { body: { product_id: p, qty: 3, customer_id: garage }, headers: {} }), 201);
  assert.equal((await row(p)).reserved_qty, '3.000');
  assert.equal((await binRow(p)).res, '3.000');
  const e = await rejected(bill([{ product_id: p, quantity: 8 }], { customerId: walkin }));
  assert.equal(e?.status, 409, 'only 7 are free to sell');
  assert.match(e.message, /held for other customers/);
  await bill([{ product_id: p, quantity: 7 }], { customerId: walkin });
  assert.equal((await row(p)).quantity, '3.000');
  // the holder gets theirs
  await bill([{ product_id: p, quantity: 3 }], { customerId: garage });
  assert.equal((await row(p)).quantity, '0.000');
  assert.equal((await row(p)).reserved_qty, '0.000');
  const done = okBody(await call(sell.reservations, { query: { status: 'FULFILLED' } }));
  assert.equal(done.find((x) => x.reservation_id === r.reservation_id).qty_fulfilled, 3);
  assert.deepEqual(await binRow(p), { qty: '0.000', res: '0.000' });
  await invariant();
});

test('release gives the held stock back; a closed hold cannot be released twice', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Clutch cable', stock: 4 });
  await shelve(p, 4);
  const r = okBody(await call(sell.reserve, { body: { product_id: p, qty: 4 }, headers: {} }), 201);
  assert.equal((await call(sell.reserve, { body: { product_id: p, qty: 1 }, headers: {} })).code, 409, 'nothing left to hold');
  okBody(await call(sell.release, { params: { id: String(r.reservation_id) } }));
  assert.equal((await row(p)).reserved_qty, '0.000');
  assert.equal((await binRow(p)).res, '0.000');
  assert.equal((await call(sell.release, { params: { id: String(r.reservation_id) } })).code, 409);
  await bill([{ product_id: p, quantity: 4 }], { customerId: walkin });
  await invariant();
});

test('two people holding the last units at once: exactly one succeeds', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Tail lamp', stock: 3 });
  const rs2 = await Promise.all([1, 2, 3].map(() => call(sell.reserve, { body: { product_id: p, qty: 3 }, headers: {} })));
  assert.equal(rs2.filter((r) => r.code === 201).length, 1);
  assert.equal((await row(p)).reserved_qty, '3.000');
});

test('concurrent sales of the last unit: one bill, one refusal, stock never negative', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Side mirror', stock: 1 });
  await shelve(p, 1);
  const out = await Promise.all([bill([{ product_id: p, quantity: 1 }]).then(() => 'ok', (e) => e.status), bill([{ product_id: p, quantity: 1 }]).then(() => 'ok', (e) => e.status)]);
  assert.deepEqual(out.sort(), [409, 'ok']);
  assert.equal((await row(p)).quantity, '0.000');
  await invariant();
});

test('trade price: a customer on a price list pays it; a fixed part price beats the percentage', { skip }, async () => {
  const a = await addPart(pool, S, { name: 'Oil', stock: 20, price: 1000, tax: 0 });
  const b = await addPart(pool, S, { name: 'Coolant', stock: 20, price: 400, tax: 0 });
  const list = okBody(await call(sell.priceListSave, { body: { name: 'Garage 10', discount_pct: 10 } }), 201);
  okBody(await call(sell.priceListItem, { params: { id: String(list.price_list_id), pid: String(b) }, body: { price: 300 } }));
  okBody(await call(sell.profileSave, { params: { id: String(garage) }, body: { customer_class: 'GARAGE', price_list_id: list.price_list_id, credit_limit: 0 } }));
  const inv = await bill([{ product_id: a, quantity: 1 }, { product_id: b, quantity: 1 }], { customerId: garage });
  const lines = (await pool.query(`SELECT product_id, unit_price_paise FROM invoice_items WHERE invoice_id = $1`, [inv.invoice_id])).rows;
  assert.equal(Number(lines.find((l) => l.product_id === a).unit_price_paise), rs(900));
  assert.equal(Number(lines.find((l) => l.product_id === b).unit_price_paise), rs(300));
  const w = await bill([{ product_id: a, quantity: 1 }], { customerId: walkin });
  assert.equal(Number((await pool.query(`SELECT unit_price_paise FROM invoice_items WHERE invoice_id = $1`, [w.invoice_id])).rows[0].unit_price_paise), rs(1000));
  // the list belongs to this business only
  const t = okBody(await call(sell.priceLists));
  assert.equal(t.length, 1); assert.equal(t[0].customers, 1);
});

test('credit limit: BLOCK refuses a bill over the limit, WARN allows it and says so, OFF ignores it', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Alternator', stock: 50, price: 1000, tax: 0 });
  okBody(await call(sell.profileSave, { params: { id: String(garage) }, body: { customer_class: 'GARAGE', credit_limit: 2500, credit_policy: 'BLOCK' } }));
  await bill([{ product_id: p, quantity: 2 }], { customerId: garage, pay: null });
  const check = okBody(await call(sell.creditCheck, { params: { id: String(garage) }, query: { amount: '1000' } }));
  assert.equal(check.level, 'BLOCK'); assert.equal(check.owes, rs(2000));
  const e = await rejected(bill([{ product_id: p, quantity: 1 }], { customerId: garage, pay: null }));
  assert.equal(e?.status, 409); assert.equal(e.code, 'CREDIT_LIMIT');
  // paid in cash it is not credit at all
  await bill([{ product_id: p, quantity: 1 }], { customerId: garage });
  await bill([{ product_id: p, quantity: 0.5 }], { customerId: garage, pay: null });
  okBody(await call(sell.profileSave, { params: { id: String(garage) }, body: { credit_limit: 2500, credit_policy: 'WARN' } }));
  assert.equal(okBody(await call(sell.creditCheck, { params: { id: String(garage) }, query: { amount: '5000' } })).level, 'WARN');
  await bill([{ product_id: p, quantity: 3 }], { customerId: garage, pay: null });
  okBody(await call(sell.profileSave, { params: { id: String(garage) }, body: { credit_limit: 100, credit_policy: 'OFF' } }));
  await bill([{ product_id: p, quantity: 3 }], { customerId: garage, pay: null });
});

test('parts are sold by the piece: a pack conversion on a bill line is refused', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Bolt', stock: 100 });
  const e = await rejected(bill([{ product_id: p, quantity: 1, unit_factor: 12 }]));
  assert.equal(e?.status, 400);
  assert.equal((await row(p)).quantity, '100.000');
});

test('selling from bins: shelf stock goes first and the invariant holds', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Fan belt', stock: 10 });
  await shelve(p, 6);
  await bill([{ product_id: p, quantity: 4 }], { customerId: walkin });
  const l = await bins.partLocations(pool, tenant, p);
  assert.equal(l.on_hand, 6); assert.equal(l.binned, 2); assert.equal(l.unassigned, 4);
  await invariant();
});

test('a sale taken offline that leaves a part below zero is flagged for a check; an ordinary offline sale is only marked', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Horn', stock: 1, price: 200 });
  const q = await addPart(pool, S, { name: 'Relay', stock: 9, price: 100 });
  const offline = async (items) => {
    const res = fakeRes();
    await invoicesApi.create({ tenant, auth: { userId: S.userId }, params: {}, query: {}, ip: '127.0.0.1', get: (h) => (h === 'X-Offline-Sale' ? '1' : undefined), headers: { 'x-offline-sale': '1' },
      body: { items, payment: { amount: 'FULL', method: 'CASH' } } }, res);
    assert.equal(res.code, 201, JSON.stringify(res.body));
    return (await pool.query(`SELECT notes FROM invoices WHERE invoice_id = $1`, [res.body.data.invoice_id])).rows[0].notes;
  };
  const clean = await offline([{ product_id: q, quantity: 2 }]);
  assert.match(clean, /Taken offline/); assert.doesNotMatch(clean, /Check:/);
  const flagged = await offline([{ product_id: p, quantity: 3 }]);
  assert.match(flagged, /Taken offline\. Check: Horn is now -2/);
  assert.equal((await row(p)).quantity, '-2.000');
});

test('sales routes: permissions and isolation', { skip }, async () => {
  const routes = router.stack.filter((l) => l.route).map((l) => ({ method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path, stack: l.route.stack.map((s) => s.handle) }));
  const gate = async (method, path, t) => {
    const route = routes.find((r) => r.method === method && r.path === path);
    assert.ok(route, `${method} ${path}`);
    for (const mw of route.stack.slice(2, -1)) {
      const res = fakeRes(); let passed = false;
      await mw({ tenant: t, method, headers: {}, body: {}, get: () => undefined, originalUrl: path }, res, () => { passed = true; });
      if (!passed) return res.code;
    }
    return 200;
  };
  for (const [method, path, want] of [
    ['POST', '/price-lists', { OWNER: 200, MANAGER: 200, PARTS_COUNTER: 403, STOREKEEPER: 403, CASHIER: 403 }],
    ['PUT', '/customers/:id/terms', { OWNER: 200, PARTS_COUNTER: 403, CASHIER: 403 }],
    ['POST', '/reservations', { OWNER: 200, PARTS_COUNTER: 200, STOREKEEPER: 200, KITCHEN: 403 }],
    ['GET', '/customers/:id/credit-check', { OWNER: 200, PARTS_COUNTER: 200, STOREKEEPER: 403 }]
  ]) {
    for (const [role, code] of Object.entries(want)) assert.equal(await gate(method, path, S.tenantFor(role)), code, `${method} ${path} as ${role}`);
  }
  const other = await makeShop(pool, 'sl2');
  assert.equal((await other.call(sell.profile, { params: { id: String(garage) } }, other.tenantFor())).code, 404);
});
