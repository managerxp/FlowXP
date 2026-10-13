/*
 * Auto parts reports: every figure is checked against the ledger it comes from (stock, invoices, receipts, bins), the rules are stated in the answer, CSV is safe,
 * and the suggestions change nothing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addPart, fakeRes, makeShop } from './helpers/autoparts.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const rep = (await import('../src/controllers/autopartsReports.controller.js')).default;
const recv = (await import('../src/controllers/autopartsReceiving.controller.js')).default;
const wh = (await import('../src/controllers/autopartsWarehouse.controller.js')).default;
const { inTx } = await import('../src/modules/autoparts/common.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const router = (await import('../src/routes/autoparts.routes.js')).default;

test.after(cleanup);

let S; let T; let tenant; let supplier;
const call = (handler, extra, t = tenant) => S.call(handler, extra, t);
const okBody = (res, code = 200) => { assert.equal(res.code, code, JSON.stringify(res.body)); assert.equal(res.body.success, true); return res.body.data; };
const bill = (items, date) => inTx((db) => createInvoiceInTransaction(db, { businessId: S.businessId, branchId: S.branchId, businessType: 'AUTO_PARTS' }, S.userId, { items, invoiceDate: date, payment: { amount: 'FULL', method: 'CASH' } }));
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
let fast; let slow; let dead; let reorderPart; let pairA; let pairB;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  S = await makeShop(pool, 'rp');
  T = await makeShop(pool, 'rp2');
  tenant = S.tenantFor();
  supplier = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,'Gabriel') RETURNING supplier_id`, [S.businessId])).rows[0].supplier_id;
  fast = await addPart(pool, S, { name: 'Engine oil 1L', stock: 500, price: 300, cost: 200 });
  slow = await addPart(pool, S, { name: 'Headlamp bulb', stock: 20, price: 100, cost: 60 });
  dead = await addPart(pool, S, { name: 'Old model gasket', stock: 7, price: 400, cost: 250 });
  reorderPart = await addPart(pool, S, { name: 'Brake fluid', stock: 105, price: 150, cost: 90 });
  pairA = await addPart(pool, S, { name: 'Brake pad set', stock: 50, price: 900, cost: 600 });
  pairB = await addPart(pool, S, { name: 'Brake clip kit', stock: 50, price: 100, cost: 40 });
  for (let d = 1; d <= 10; d++) await bill([{ product_id: fast, quantity: 5 }], daysAgo(d));
  await bill([{ product_id: slow, quantity: 1 }], daysAgo(120));
  await bill([{ product_id: dead, quantity: 1 }], daysAgo(300));
  for (let d = 0; d < 90; d += 3) await bill([{ product_id: reorderPart, quantity: 3 }], daysAgo(d + 1));
  await bill([{ product_id: pairA, quantity: 1 }, { product_id: pairB, quantity: 1 }], daysAgo(5));
  await bill([{ product_id: pairA, quantity: 1 }, { product_id: pairB, quantity: 2 }], daysAgo(4));
  await bill([{ product_id: pairA, quantity: 1 }], daysAgo(3));
  await pool.query(`UPDATE products SET created_at = now() - interval '400 days' WHERE product_id = ANY($1::int[])`, [[slow, dead]]);
  await pool.query(`UPDATE autoparts_parts SET max_stock = 60 WHERE product_id = $1`, [reorderPart]);
  await pool.query(`UPDATE products SET lead_time_days = 3 WHERE product_id = $1`, [reorderPart]);
});

test('overview equals the stock ledger', { skip }, async () => {
  const o = okBody(await call(rep.overview));
  const truth = (await pool.query(
    `SELECT SUM(GREATEST(bs.quantity,0)) AS u, SUM(GREATEST(bs.quantity,0) * p.purchase_price_paise) AS c FROM branch_stock bs JOIN products p ON p.product_id = bs.product_id WHERE p.business_id = $1`, [S.businessId])).rows[0];
  assert.equal(o.units, Number(truth.u)); assert.equal(o.stock_cost_paise, Number(truth.c));
  assert.equal(o.parts, 6);
  assert.equal(o.unassigned_units, o.units, 'nothing is shelved yet, so all of it waits for a bin');
});

test('valuation and ageing add up to the same stock value as the overview', { skip }, async () => {
  const o = okBody(await call(rep.overview));
  const v = okBody(await call(rep.valuation));
  const a = okBody(await call(rep.ageing));
  assert.equal(v.total_cost_paise, o.stock_cost_paise);
  assert.equal(a.buckets.reduce((s, b) => s + b.cost_paise, 0), o.stock_cost_paise);
  assert.ok(a.basis);
});

test('movers: fast, slow and dead by the stated rules', { skip }, async () => {
  const m = okBody(await call(rep.movers));
  const cls = (id) => m.parts.find((p) => p.product_id === id)?.class;
  assert.equal(cls(fast), 'FAST');
  assert.equal(cls(slow), 'SLOW');
  assert.equal(cls(dead), 'DEAD');
  assert.match(m.rules.dead, /180 days/);
  assert.equal(m.parts.find((p) => p.product_id === fast).sold_30, 50);
  assert.equal(m.summary.DEAD.stock_cost_paise, 6 * 25000, 'six left after the one sold, at cost 250');
});

test('reorder: sales speed x cover days, less on hand, capped by max stock; nothing changes', { skip }, async () => {
  const before = (await pool.query(`SELECT SUM(quantity) AS q FROM branch_stock`)).rows[0].q;
  const r = okBody(await call(rep.reorder));
  const x = r.parts.find((p) => p.product_id === reorderPart);
  // 30 bills of 3 = 90 units in 90 days = 1 a day; cover 3 lead + 7 safety + 30 review = 40 days; on hand 15 -> 25, max stock 60 allows it
  assert.equal(x.sold_90, 90); assert.equal(x.on_hand, 15); assert.equal(x.suggested_qty, 25);
  assert.match(x.rule, /lead time/);
  assert.equal(r.parts.find((p) => p.product_id === dead), undefined, 'a part that does not sell is not suggested');
  assert.equal((await pool.query(`SELECT SUM(quantity) AS q FROM branch_stock`)).rows[0].q, before);
  await pool.query(`UPDATE autoparts_parts SET max_stock = 20 WHERE product_id = $1`, [reorderPart]);
  assert.equal(okBody(await call(rep.reorder)).parts.find((p) => p.product_id === reorderPart).suggested_qty, 5, 'capped by max stock');
});

test('bought together counts the bills the two parts share', { skip }, async () => {
  const t = okBody(await call(rep.together, { params: { id: String(pairA) } }));
  assert.equal(t.length, 1); assert.equal(t[0].product_id, pairB); assert.equal(t[0].bills, 2);
});

test('supplier performance comes from the receipts: damaged and rejected shares, fill rate', { skip }, async () => {
  const w = okBody(await call(wh.create, { body: { segment: 'WH' } }), 201);
  void w;
  const g = await call(recv.create, { body: { supplier_id: supplier, supplier_invoice_no: 'R-1', items: [{ product_id: pairA, received: 20, damaged: 2, rejected: 3, unit_cost: 600 }] } });
  okBody(g, 201);
  const s = okBody(await call(rep.suppliers)).find((x) => x.supplier === 'Gabriel');
  assert.equal(s.received, 20); assert.equal(s.accepted, 15); assert.equal(s.damaged_pct, 10); assert.equal(s.rejected_pct, 15); assert.equal(s.receipts, 1);
});

test('occupancy reflects the bins', { skip }, async () => {
  const wl = (await pool.query(`SELECT location_id FROM warehouse_locations WHERE business_id = $1 AND code = 'WH'`, [S.businessId])).rows[0];
  const b1 = okBody(await call(wh.create, { body: { parent_id: wl.location_id, segment: 'B1', loc_type: 'BIN', capacity_units: 10 } }), 201);
  okBody(await call(wh.create, { body: { parent_id: wl.location_id, segment: 'B2', loc_type: 'BIN', capacity_units: 10 } }), 201);
  okBody(await call(wh.putAway, { body: { product_id: slow, location_id: b1.location_id, qty: 12 }, headers: {} }), 201);
  const o = okBody(await call(rep.occupancy));
  assert.equal(o.storing_locations, 2); assert.equal(o.occupied, 1); assert.equal(o.empty, 1);
  assert.equal(o.over_capacity[0].code, 'WH-B1'); assert.equal(o.over_capacity[0].qty, 12);
});

test('part ledger lists stock and bin movements', { skip }, async () => {
  const l = okBody(await call(rep.ledger, { params: { id: String(slow) } }));
  assert.ok(l.movements.some((m) => m.ledger === 'BIN' && m.kind === 'PUTAWAY'));
  assert.ok(l.movements.some((m) => m.ledger === 'STOCK' && m.kind === 'SALE'));
  assert.equal((await T.call(rep.ledger, { params: { id: String(slow) } }, T.tenantFor())).code, 404);
});

test('CSV export: safe against formulas and quotes', { skip }, async () => {
  await pool.query(`UPDATE products SET name = '=HYPERLINK("x")' WHERE product_id = $1`, [fast]);
  const res = { code: 200, headers: {}, body: null, status(c) { this.code = c; return this; }, setHeader(k, v) { this.headers[k] = v; }, send(b) { this.body = b; return this; }, json(b) { this.body = b; return this; } };
  await rep.movers({ tenant, auth: { userId: S.userId }, query: { format: 'csv' }, params: {}, body: {}, headers: {}, ip: '127.0.0.1', get: () => undefined }, res);
  assert.match(res.headers['Content-Type'], /text\/csv/);
  assert.ok(res.body.split('\r\n')[0].startsWith('product_id,name'));
  assert.ok(res.body.includes(`"'=HYPERLINK(""x"")"`), res.body.slice(0, 400));
});

test('report routes: valuation needs its own permission; roles and isolation', { skip }, async () => {
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
    ['GET', '/reports/valuation', { OWNER: 200, MANAGER: 200, STOREKEEPER: 403, PARTS_COUNTER: 403, CASHIER: 403 }],
    ['GET', '/reports/movers', { OWNER: 200, MANAGER: 200, PARTS_COUNTER: 403 }],
    ['GET', '/overview', { OWNER: 200, STOREKEEPER: 200, PARTS_COUNTER: 403 }]
  ]) {
    for (const [role, code] of Object.entries(want)) assert.equal(await gate(method, path, S.tenantFor(role)), code, `${method} ${path} as ${role}`);
  }
  const other = okBody(await T.call(rep.overview, {}, T.tenantFor()));
  assert.equal(other.parts, 0); assert.equal(other.units, 0);
});
