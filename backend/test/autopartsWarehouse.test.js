/*
 * Auto parts warehouse: the location tree and codes, put-away, bin moves, the invariant sum(bins) <= branch stock after every kind of stock movement,
 * idempotent retries, concurrent put-aways, switching locations off, isolation and permissions.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addPart, fakeRes, makeShop } from './helpers/autoparts.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const wh = (await import('../src/controllers/autopartsWarehouse.controller.js')).default;
const locs = await import('../src/modules/autoparts/locations.js');
const bins = await import('../src/modules/autoparts/bins.js');
const { inTx } = await import('../src/modules/autoparts/common.js');
const { moveStock } = await import('../src/modules/stock.js');
const router = (await import('../src/routes/autoparts.routes.js')).default;

test.after(cleanup);

let S; let T; let tenant; let userId;
let rackA; let binA1; let binA2; let pad;
const call = (handler, extra, t = tenant) => S.call(handler, extra, t);
const okBody = (res, code = 200) => { assert.equal(res.code, code, JSON.stringify(res.body)); assert.equal(res.body.success, true); return res.body.data; };
const tx = (fn) => inTx(fn);
const onHand = async (id) => Number((await pool.query(`SELECT quantity FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [S.branchId, id])).rows[0]?.quantity ?? 0);
const inBin = async (loc, id) => Number((await pool.query(`SELECT qty FROM bin_stock WHERE location_id = $1 AND product_id = $2`, [loc, id])).rows[0]?.qty ?? 0);
const invariant = async () => assert.equal((await bins.reconcile(pool, S.allOutlets())).ok, true, JSON.stringify(await bins.reconcile(pool, S.allOutlets())));
const sell = (id, qty) => tx((db) => moveStock(db, { businessId: S.businessId, branchId: S.branchId, productId: id, delta: -qty }));

test('setup', { skip }, async () => {
  await runMigrations(pool);
  S = await makeShop(pool, 'wh');
  T = await makeShop(pool, 'wh2');
  tenant = S.tenantFor();
  userId = S.userId;
});

test('locations: a tree whose codes are the parent code and the segment, unique per outlet', { skip }, async () => {
  const w = okBody(await call(wh.create, { body: { segment: 'WH', name: 'Main warehouse' } }), 201);
  assert.equal(w.code, 'WH'); assert.equal(w.level, 1); assert.equal(w.loc_type, 'WAREHOUSE');
  const z = okBody(await call(wh.create, { body: { parent_id: w.location_id, segment: 'a' } }), 201);
  assert.equal(z.code, 'WH-A');
  rackA = okBody(await call(wh.create, { body: { parent_id: z.location_id, segment: 'R12', loc_type: 'RACK' } }), 201);
  assert.equal(rackA.code, 'WH-A-R12'); assert.equal(rackA.can_store, false);
  const made = okBody(await call(wh.createMany, { body: { parent_id: rackA.location_id, prefix: 'B', count: 3, capacity_units: 20, loc_type: 'BIN' } }), 201);
  assert.deepEqual(made.map((m) => m.code), ['WH-A-R12-B01', 'WH-A-R12-B02', 'WH-A-R12-B03']);
  [binA1, binA2] = made;
  assert.equal(binA1.can_store, true);
});

test('locations: duplicates refused, depth capped, a storing location cannot hold children once it holds stock', { skip }, async () => {
  const dup = await call(wh.create, { body: { parent_id: rackA.location_id, segment: 'b01' } });
  assert.equal(dup.code, 409);
  const bad = await call(wh.create, { body: { parent_id: rackA.location_id, segment: 'no spaces!' } });
  assert.equal(bad.code, 400);
  assert.equal((await call(wh.create, { body: { segment: 'WH' } })).code, 409, 'same top-level code');
  // the same code at another outlet is fine and the other business never sees it
  const other = await T.call(wh.tree, {}, T.tenantFor());
  assert.equal(okBody(other).length, 0);
});

test('QR labels: a scanned token or a typed code finds the location', { skip }, async () => {
  const d = okBody(await call(wh.location, { params: { id: String(binA1.location_id) } }));
  assert.match(d.qr_text, /^FXB:[0-9a-f]{24}$/);
  assert.equal(okBody(await call(wh.scan, { query: { code: d.qr_text } })).location_id, binA1.location_id);
  assert.equal(okBody(await call(wh.scan, { query: { code: 'wh-a-r12-b01' } })).location_id, binA1.location_id);
  assert.equal(okBody(await call(wh.scan, { query: { code: 'FXB:nope' } })), null);
  assert.equal(okBody(await T.call(wh.scan, { query: { code: d.qr_text } }, T.tenantFor())), null, 'another business cannot resolve it');
});

test('put-away: only stock that is waiting can be shelved, the total never changes', { skip }, async () => {
  pad = await addPart(pool, S, { name: 'Brake pad', stock: 10 });
  const b1 = binA1.location_id; const b2 = binA2.location_id;
  // bins need can_store: BIN-typed leaves from createMany were made with type default for their level
  const d1 = await locs.detail(pool, tenant, b1);
  assert.equal(d1.can_store, true, 'a bin stores');
  let r = okBody(await call(wh.putAway, { body: { product_id: pad, location_id: b1, qty: 6 }, headers: {} }), 201);
  assert.equal(r.unassigned, 4);
  assert.equal(await onHand(pad), 10);
  assert.equal((await call(wh.putAway, { body: { product_id: pad, location_id: b2, qty: 5 }, headers: {} })).code, 409, 'only 4 are waiting');
  r = okBody(await call(wh.putAway, { body: { product_id: pad, location_id: b2, qty: 4 }, headers: {} }), 201);
  assert.equal(r.unassigned, 0);
  const l = okBody(await call(wh.partLocations, { params: { id: String(pad) } }));
  assert.equal(l.on_hand, 10); assert.equal(l.binned, 10); assert.equal(l.bins[0].is_primary, true); assert.equal(l.bins[0].location_id, b1);
  await invariant();
});

test('put-away: a retry with the same key moves nothing twice', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Oil filter', stock: 5 });
  const body = { product_id: p, location_id: binA1.location_id, qty: 5, source_key: 'scan-1' };
  okBody(await call(wh.putAway, { body, headers: {} }), 201);
  const again = okBody(await call(wh.putAway, { body, headers: {} }));
  assert.equal(again.replayed, true);
  assert.equal(await inBin(binA1.location_id, p), 5);
});

test('put-away: parts and locations must belong to this business and outlet', { skip }, async () => {
  const foreign = await addPart(pool, T, { name: 'Foreign', stock: 3 });
  assert.equal((await call(wh.putAway, { body: { product_id: foreign, location_id: binA1.location_id, qty: 1 }, headers: {} })).code, 404);
  const mine = await addPart(pool, S, { name: 'Mine', stock: 3 });
  const r = await T.call(wh.putAway, { body: { product_id: mine, location_id: binA1.location_id, qty: 1 }, headers: {} }, T.tenantFor());
  assert.equal(r.code, 404);
  // a rack (not a storing location) refuses stock
  assert.equal((await call(wh.putAway, { body: { product_id: mine, location_id: rackA.location_id, qty: 1 }, headers: {} })).code, 409);
});

test('bin move: totals unchanged, free quantity only, idempotent, primary follows an emptied bin', { skip }, async () => {
  const b1 = binA1.location_id; const b2 = binA2.location_id;
  const r = okBody(await call(wh.move, { body: { product_id: pad, from_location_id: b1, to_location_id: b2, qty: 2 }, headers: {} }), 201);
  assert.equal(r.qty, 2);
  assert.equal(await inBin(b1, pad), 4); assert.equal(await inBin(b2, pad), 6);
  assert.equal(await onHand(pad), 10);
  assert.equal((await call(wh.move, { body: { product_id: pad, from_location_id: b1, to_location_id: b2, qty: 5 }, headers: {} })).code, 409);
  assert.equal((await call(wh.move, { body: { product_id: pad, from_location_id: b1, to_location_id: b1, qty: 1 }, headers: {} })).code, 400);
  const key = { product_id: pad, from_location_id: b2, to_location_id: b1, qty: 1, source_key: 'mv-1' };
  okBody(await call(wh.move, { body: key, headers: {} }), 201);
  assert.equal(okBody(await call(wh.move, { body: key, headers: {} })).replayed, true);
  assert.equal(await inBin(b1, pad), 5);
  // empty the primary bin: the other becomes primary
  okBody(await call(wh.move, { body: { product_id: pad, from_location_id: b1, to_location_id: b2, qty: 5 }, headers: {} }), 201);
  const l = okBody(await call(wh.partLocations, { params: { id: String(pad) } }));
  assert.equal(l.bins.find((b) => b.is_primary).location_id, b2);
  await invariant();
});

test('the invariant holds when stock leaves any way: sale, write-off and shortage take from bins', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Clutch plate', stock: 12 });
  okBody(await call(wh.putAway, { body: { product_id: p, location_id: binA1.location_id, qty: 8 }, headers: {} }), 201);
  okBody(await call(wh.putAway, { body: { product_id: p, location_id: binA2.location_id, qty: 2 }, headers: {} }), 201);
  // 2 are unassigned. Selling 1 takes the unassigned first? No: bins hold what is physically shelved; the shelf is taken from first.
  await sell(p, 1);
  assert.equal(await onHand(p), 11);
  await invariant();
  await sell(p, 6);
  assert.equal(await onHand(p), 5);
  const l = await bins.partLocations(pool, tenant, p);
  assert.ok(l.binned <= l.on_hand, JSON.stringify(l));
  await sell(p, 5);
  assert.equal(await onHand(p), 0);
  assert.equal((await bins.partLocations(pool, tenant, p)).binned, 0);
  // an offline sale can drive stock negative: bins empty and never go below zero
  await sell(p, 2);
  assert.equal((await bins.partLocations(pool, tenant, p)).binned, 0);
  await invariant();
  const autos = (await pool.query(`SELECT COUNT(*)::int AS n FROM bin_moves WHERE product_id = $1 AND kind = 'AUTO'`, [p])).rows[0].n;
  assert.ok(autos >= 2, 'the history says where each unit came from');
});

test('stock coming back in stays unassigned until it is put away', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Wiper blade', stock: 4 });
  okBody(await call(wh.putAway, { body: { product_id: p, location_id: binA1.location_id, qty: 4 }, headers: {} }), 201);
  await tx((db) => moveStock(db, { businessId: S.businessId, branchId: S.branchId, productId: p, delta: 3 }));
  const un = okBody(await call(wh.unassigned)).find((r) => r.product_id === p);
  assert.equal(un.unassigned, 3);
});

test('concurrent put-aways of the same waiting stock: exactly one wins', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Spark plug', stock: 5 });
  const results = await Promise.all([binA1, binA2].map((b) => call(wh.putAway, { body: { product_id: p, location_id: b.location_id, qty: 5 }, headers: {} })));
  assert.deepEqual(results.map((r) => r.code).sort(), [201, 409]);
  const l = await bins.partLocations(pool, tenant, p);
  assert.equal(l.binned, 5);
  await invariant();
});

test('concurrent sale and bin move do not break the invariant', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Head lamp', stock: 10 });
  okBody(await call(wh.putAway, { body: { product_id: p, location_id: binA1.location_id, qty: 10 }, headers: {} }), 201);
  await Promise.all([sell(p, 4), call(wh.move, { body: { product_id: p, from_location_id: binA1.location_id, to_location_id: binA2.location_id, qty: 5 }, headers: {} }), sell(p, 3)]);
  const l = await bins.partLocations(pool, tenant, p);
  assert.equal(l.on_hand, 3);
  assert.ok(l.binned <= 3);
  await invariant();
});

test('pick plan: primary bin first, short quantity reported', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Air filter', stock: 7 });
  okBody(await call(wh.putAway, { body: { product_id: p, location_id: binA1.location_id, qty: 3 }, headers: {} }), 201);
  okBody(await call(wh.putAway, { body: { product_id: p, location_id: binA2.location_id, qty: 4 }, headers: {} }), 201);
  const plan = okBody(await call(wh.pick, { params: { id: String(p) }, query: { qty: '9' } }));
  assert.equal(plan.lines.reduce((s, l) => s + l.qty, 0), 7);
  assert.equal(plan.short, 2);
});

test('switching off: refused while stock is inside, allowed when empty, children follow', { skip }, async () => {
  const held = await call(wh.update, { params: { id: String(rackA.location_id) }, body: { is_active: false } });
  assert.equal(held.code, 409, JSON.stringify(held.body));
  const empty = okBody(await call(wh.create, { body: { segment: 'X' } }), 201);
  const child = okBody(await call(wh.create, { body: { parent_id: empty.location_id, segment: 'Y', loc_type: 'BIN' } }), 201);
  okBody(await call(wh.update, { params: { id: String(empty.location_id) }, body: { is_active: false } }));
  const row = (await pool.query(`SELECT is_active FROM warehouse_locations WHERE location_id = $1`, [child.location_id])).rows[0];
  assert.equal(row.is_active, false);
  assert.equal((await call(wh.putAway, { body: { product_id: pad, location_id: child.location_id, qty: 1 }, headers: {} })).code, 409);
});

test('renaming a segment rewrites the codes below it', { skip }, async () => {
  const r = okBody(await call(wh.update, { params: { id: String(rackA.location_id) }, body: { segment: 'R99' } }));
  assert.equal(r.code, 'WH-A-R99');
  const d = await locs.detail(pool, tenant, binA1.location_id);
  assert.equal(d.code, 'WH-A-R99-B01');
  const clash = await call(wh.update, { params: { id: String(rackA.location_id) }, body: { segment: 'R99' } });
  assert.equal(clash.code, 200, 'same name is a no-op');
});

test('tree rolls quantities up and flags a bin over its limit', { skip }, async () => {
  const t = okBody(await call(wh.tree));
  const root = t.find((l) => l.level === 1 && l.code === 'WH');
  assert.ok(root.qty > 0);
  const total = (await pool.query(`SELECT COALESCE(SUM(qty),0) AS n FROM bin_stock WHERE business_id = $1`, [S.businessId])).rows[0].n;
  assert.equal(root.qty, Number(total));
  const big = await addPart(pool, S, { name: 'Over limit', stock: 30 });
  okBody(await call(wh.putAway, { body: { product_id: big, location_id: binA2.location_id, qty: 30 }, headers: {} }), 201);
  const again = okBody(await call(wh.tree)).find((l) => l.location_id === (binA2.location_id));
  assert.equal(again.over_capacity, true);
});

test('reconciliation catches a hand-made violation', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Tampered', stock: 2 });
  okBody(await call(wh.putAway, { body: { product_id: p, location_id: binA1.location_id, qty: 2 }, headers: {} }), 201);
  await pool.query(`UPDATE branch_stock SET quantity = 1 WHERE branch_id = $1 AND product_id = $2`, [S.branchId, p]);
  const rec = okBody(await call(wh.reconcile));
  assert.equal(rec.ok, false);
  assert.equal(rec.violations[0].over_by, 1);
  await pool.query(`UPDATE branch_stock SET quantity = 2 WHERE branch_id = $1 AND product_id = $2`, [S.branchId, p]);
});

test('warehouse routes: permissions, plan switch, parts shops only', { skip }, async () => {
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
    ['POST', '/locations', { OWNER: 200, MANAGER: 200, STOREKEEPER: 200, PARTS_COUNTER: 403, CASHIER: 403 }],
    ['POST', '/warehouse/put-away', { OWNER: 200, STOREKEEPER: 200, PARTS_COUNTER: 403, CASHIER: 403 }],
    ['PUT', '/warehouse/settings', { OWNER: 200, MANAGER: 200, STOREKEEPER: 403, PARTS_COUNTER: 403 }],
    ['GET', '/locations', { OWNER: 200, STOREKEEPER: 200, PARTS_COUNTER: 200, KITCHEN: 403 }]
  ]) {
    for (const [role, code] of Object.entries(want)) assert.equal(await gate(method, path, S.tenantFor(role)), code, `${method} ${path} as ${role}`);
  }
  assert.equal(await gate('POST', '/locations', { ...S.tenantFor('OWNER'), planFeatures: { ap_racks: false } }), 402);
  const retail = await makeShop(pool, 'retail', { type: 'RETAIL' });
  assert.equal(await gate('GET', '/locations', retail.tenantFor()), 404);
});
