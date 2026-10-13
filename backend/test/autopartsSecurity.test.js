/*
 * Auto parts, across the module: every route is closed to other business types and to people without a permission, stock-changing actions leave an audit trail, a business's
 * parts data goes away with the business, migrations run twice without harm, and the bin invariant holds after a mixed run of everything.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addPart, fakeRes, makeShop } from './helpers/autoparts.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const router = (await import('../src/routes/autoparts.routes.js')).default;
const wh = (await import('../src/controllers/autopartsWarehouse.controller.js')).default;
const recv = (await import('../src/controllers/autopartsReceiving.controller.js')).default;
const sell = (await import('../src/controllers/autopartsSales.controller.js')).default;
const bins = await import('../src/modules/autoparts/bins.js');
const { inTx } = await import('../src/modules/autoparts/common.js');
const { moveStock } = await import('../src/modules/stock.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const { industryDefaults } = await import('../src/modules/planFeatures.js');

test.after(cleanup);

let S;
const okBody = (res, code = 200) => { assert.equal(res.code, code, JSON.stringify(res.body)); assert.equal(res.body.success, true); return res.body.data; };
const routes = () => router.stack.filter((l) => l.route).map((l) => ({ method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path, stack: l.route.stack.map((s) => s.handle) }));
const gate = async (route, tenant) => {
  for (const mw of route.stack.slice(2, -1)) {
    const res = fakeRes(); let passed = false;
    await mw({ tenant, method: route.method, headers: {}, body: {}, get: () => undefined, originalUrl: route.path }, res, () => { passed = true; });
    if (!passed) return res.code;
  }
  return 200;
};

test('setup', { skip }, async () => { await runMigrations(pool); S = await makeShop(pool, 'sec'); });

test('every route is 404 for any other kind of business', { skip }, async () => {
  const other = await makeShop(pool, 'sec-retail', { type: 'RETAIL' });
  const gym = await makeShop(pool, 'sec-gym', { type: 'RESTAURANT' });
  const all = routes();
  assert.ok(all.length > 60, `${all.length} routes`);
  for (const r of all) {
    assert.equal(await gate(r, other.tenantFor()), 404, `${r.method} ${r.path} for a retail shop`);
    assert.equal(await gate(r, gym.tenantFor()), 404, `${r.method} ${r.path} for a restaurant`);
  }
});

test('no route is open to a role with no permissions, and every one has auth, a business and a permission or plan check', { skip }, async () => {
  for (const r of routes()) {
    assert.ok(r.stack.length >= 5, `${r.method} ${r.path} has only ${r.stack.length} steps`);
    assert.notEqual(await gate(r, S.tenantFor('KITCHEN')), 200, `${r.method} ${r.path} opens to a kitchen role`);
  }
});

test('a plan without the feature is refused on every route that names it', { skip }, async () => {
  const off = { ap_catalog: false, ap_racks: false, ap_grn: false, ap_pricing: false, ap_intelligence: false };
  let refused = 0;
  for (const r of routes()) { if ((await gate(r, { ...S.tenantFor('OWNER'), planFeatures: off })) === 402) refused += 1; }
  assert.ok(refused >= routes().length - 2, `${refused} of ${routes().length} routes are plan-gated`);
});

test('the parts features exist for a parts shop and for no other business type', { skip }, async () => {
  const keys = ['ap_catalog', 'ap_racks', 'ap_grn', 'ap_transfers', 'ap_counts', 'ap_pricing', 'ap_intelligence'];
  const parts = industryDefaults('AUTO_PARTS');
  for (const k of keys) assert.notEqual(parts[k], false, `${k} is on for AUTO_PARTS`);
  for (const t of ['RESTAURANT', 'RETAIL', 'SUPERMARKET', 'PHARMACY', 'WHOLESALE', 'SALON', 'GYM', 'GAMING_CAFE', 'HOTEL']) {
    const d = industryDefaults(t);
    for (const k of keys) assert.equal(d[k], false, `${k} is off for ${t}`);
  }
});

test('stock-changing actions leave an audit trail', { skip }, async () => {
  const tenant = S.tenantFor();
  const call = (h, extra) => S.call(h, extra, tenant);
  const w = okBody(await call(wh.create, { body: { segment: 'WH' } }), 201);
  const b = okBody(await call(wh.create, { body: { parent_id: w.location_id, segment: 'B1', loc_type: 'BIN' } }), 201);
  const p = await addPart(pool, S, { name: 'Audit part', stock: 5, price: 100 });
  okBody(await call(wh.putAway, { body: { product_id: p, location_id: b.location_id, qty: 5 }, headers: {} }), 201);
  okBody(await call(sell.reserve, { body: { product_id: p, qty: 1 }, headers: {} }), 201);
  const sup = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,'Aud') RETURNING supplier_id`, [S.businessId])).rows[0].supplier_id;
  okBody(await call(recv.create, { body: { supplier_id: sup, supplier_invoice_no: 'A-1', items: [{ product_id: p, received: 2, unit_cost: 5 }] } }), 201);
  await new Promise((r) => setTimeout(r, 400));   // the audit write is fire-and-forget
  const actions = (await pool.query(`SELECT DISTINCT action FROM audit_log WHERE business_id = $1`, [S.businessId])).rows.map((r) => r.action);
  for (const a of ['autoparts.location_created', 'autoparts.put_away', 'autoparts.reserved', 'autoparts.grn_posted']) assert.ok(actions.includes(a), `${a} in ${actions.join(', ')}`);
});

test('the bin invariant holds after a mixed run of receiving, put-away, moves, sales, holds and counts', { skip }, async () => {
  const tenant = S.tenantFor();
  const call = (h, extra) => S.call(h, extra, tenant);
  const w = (await pool.query(`SELECT location_id FROM warehouse_locations WHERE business_id = $1 AND code = 'WH'`, [S.businessId])).rows[0];
  const b2 = okBody(await call(wh.create, { body: { parent_id: w.location_id, segment: 'B2', loc_type: 'BIN' } }), 201);
  const b3 = okBody(await call(wh.create, { body: { parent_id: w.location_id, segment: 'B3', loc_type: 'BIN' } }), 201);
  const ps = [];
  for (let i = 0; i < 6; i++) ps.push(await addPart(pool, S, { name: `Mixed ${i}`, stock: 20, price: 100 }));
  const bill = (p, q) => inTx((db) => createInvoiceInTransaction(db, { businessId: S.businessId, branchId: S.branchId, businessType: 'AUTO_PARTS' }, S.userId, { items: [{ product_id: p, quantity: q }], payment: { amount: 'FULL', method: 'CASH' } })).catch(() => null);
  for (const p of ps) { okBody(await call(wh.putAway, { body: { product_id: p, location_id: b2.location_id, qty: 12 }, headers: {} }), 201); }
  const jobs = [];
  for (const [i, p] of ps.entries()) {
    jobs.push(bill(p, 3 + (i % 3)));
    jobs.push(call(wh.move, { body: { product_id: p, from_location_id: b2.location_id, to_location_id: b3.location_id, qty: 4 }, headers: {} }));
    jobs.push(call(sell.reserve, { body: { product_id: p, qty: 2 }, headers: {} }));
    jobs.push(inTx((db) => moveStock(db, { businessId: S.businessId, branchId: S.branchId, productId: p, delta: -2 })));
    jobs.push(inTx((db) => moveStock(db, { businessId: S.businessId, branchId: S.branchId, productId: p, delta: 5 })));
  }
  await Promise.all(jobs);
  const rec = await bins.reconcile(pool, S.allOutlets());
  assert.equal(rec.ok, true, JSON.stringify(rec.violations));
  const bad = (await pool.query(`SELECT 1 FROM bin_stock WHERE reserved_qty > qty OR qty < 0`)).rowCount;
  assert.equal(bad, 0);
  const res = (await pool.query(`SELECT COUNT(*) FILTER (WHERE bs.reserved_qty > GREATEST(bs.quantity, 0) + 5) AS n FROM branch_stock bs`)).rows[0].n;
  assert.equal(Number(res), 0, 'holds never run far past the stock');
});

test('deleting a business removes all of its parts data, and migrations run twice without harm', { skip }, async () => {
  const doomed = await makeShop(pool, 'doomed');
  const call = (h, extra) => doomed.call(h, extra, doomed.tenantFor());
  const p = await addPart(pool, doomed, { name: 'Doomed part', stock: 3 });
  const l = okBody(await call(wh.create, { body: { segment: 'X', loc_type: 'BIN' } }), 201);
  okBody(await call(wh.putAway, { body: { product_id: p, location_id: l.location_id, qty: 3 }, headers: {} }), 201);
  // a receipt (and the supplier and put-away task it makes) goes with the business too
  const sup = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,'Doomed supplier') RETURNING supplier_id`, [doomed.businessId])).rows[0].supplier_id;
  okBody(await call(recv.create, { body: { supplier_id: sup, supplier_invoice_no: 'D-1', items: [{ product_id: p, received: 2, damaged: 1, unit_cost: 5 }] } }), 201);
  const tables = ['autoparts_parts', 'autoparts_part_numbers', 'warehouse_locations', 'bin_stock', 'bin_moves', 'part_reservations', 'putaway_tasks', 'autoparts_settings', 'wholesale_grns'];
  const count = async () => { const out = {}; for (const t of tables) out[t] = Number((await pool.query(`SELECT COUNT(*) AS n FROM ${t} WHERE business_id = $1`, [doomed.businessId])).rows[0].n); return out; };
  assert.ok((await count()).bin_stock > 0);
  await pool.query(`DELETE FROM businesses WHERE business_id = $1`, [doomed.businessId]);
  for (const [t, n] of Object.entries(await count())) assert.equal(n, 0, t);
  await runMigrations(pool);   // nothing left to apply, nothing breaks
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM bin_stock`)).rows[0].n) > 0, true, 'other businesses keep theirs');
});
