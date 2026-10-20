/*
 * Auto parts receiving: received = accepted + damaged + rejected, only accepted is sellable, put-away on receipt or as a task, no duplicate supplier invoice,
 * cancel only while the stock is still there, and the bin invariant after every step.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addPart, makeShop } from './helpers/autoparts.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const recv = (await import('../src/controllers/autopartsReceiving.controller.js')).default;
const wh = (await import('../src/controllers/autopartsWarehouse.controller.js')).default;
const bins = await import('../src/modules/autoparts/bins.js');
const { inTx } = await import('../src/modules/autoparts/common.js');
const { moveStock } = await import('../src/modules/stock.js');

test.after(cleanup);

let S; let T; let tenant; let supplier; let bin; let part;
const call = (handler, extra, t = tenant) => S.call(handler, extra, t);
const okBody = (res, code = 200) => { assert.equal(res.code, code, JSON.stringify(res.body)); assert.equal(res.body.success, true); return res.body.data; };
const onHand = async (id) => Number((await pool.query(`SELECT quantity FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [S.branchId, id])).rows[0]?.quantity ?? 0);
const damagedNet = async (id) => Number((await pool.query(`SELECT COALESCE(SUM(qty),0) AS n FROM wholesale_damaged_log WHERE business_id = $1 AND product_id = $2`, [S.businessId, id])).rows[0].n);
const invariant = async () => assert.equal((await bins.reconcile(pool, S.allOutlets())).ok, true);
let inv = 0;
const post = (items, extra = {}) => call(recv.create, { body: { supplier_id: supplier, supplier_invoice_no: `INV-${++inv}`, items, ...extra } });

test('setup', { skip }, async () => {
  await runMigrations(pool);
  S = await makeShop(pool, 'rc');
  T = await makeShop(pool, 'rc2');
  tenant = S.tenantFor();
  supplier = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,'Bosch Dealer') RETURNING supplier_id`, [S.businessId])).rows[0].supplier_id;
  const w = okBody(await call(wh.create, { body: { segment: 'WH' } }), 201);
  bin = okBody(await call(wh.create, { body: { parent_id: w.location_id, segment: 'B1', loc_type: 'BIN' } }), 201);
  part = await addPart(pool, S, { name: 'Brake pad', cost: 300 });
});

test('GRN: received 10 = accepted 7 + damaged 2 + rejected 1; only 7 become stock', { skip }, async () => {
  const g = okBody(await post([{ product_id: part, received: 10, damaged: 2, rejected: 1, unit_cost: 300 }]), 201);
  assert.equal(await onHand(part), 7);
  assert.equal(await damagedNet(part), 2);
  assert.equal(g.items[0].rejected, 1);
  assert.equal(g.putaway_tasks.length, 1);
  const un = await bins.unassigned(pool, tenant);
  assert.equal(un.find((r) => r.product_id === part).unassigned, 7);
  const detail = okBody(await call(recv.get, { params: { id: String(g.grn_id) } }));
  assert.equal(detail.items[0].rejected, 1);
  await invariant();
});

test('GRN: damaged and rejected cannot exceed what arrived', { skip }, async () => {
  const r = await post([{ product_id: part, received: 3, damaged: 2, rejected: 2 }]);
  assert.equal(r.code, 400, JSON.stringify(r.body));
  assert.equal(await onHand(part), 7);
});

test('GRN: naming a bin puts the stock away on the spot', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Oil filter' });
  const g = okBody(await post([{ product_id: p, received: 5, bin_id: bin.location_id, unit_cost: 100 }]), 201);
  assert.equal(g.putaway_tasks.length, 0);
  const l = await bins.partLocations(pool, tenant, p);
  assert.equal(l.binned, 5); assert.equal(l.unassigned, 0);
  await invariant();
});

test('GRN: the same supplier invoice cannot be booked twice, and a retry with the same key posts once', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Wiper' });
  okBody(await call(recv.create, { body: { supplier_id: supplier, supplier_invoice_no: 'DUP-1', items: [{ product_id: p, received: 4, unit_cost: 50 }] } }), 201);
  const again = await call(recv.create, { body: { supplier_id: supplier, supplier_invoice_no: 'DUP-1', items: [{ product_id: p, received: 4, unit_cost: 50 }] } });
  assert.equal(again.code, 409, JSON.stringify(again.body));
  assert.equal(await onHand(p), 4);
});

test('GRN: a bin from another outlet or business is refused before anything is posted', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Gasket' });
  const r = await post([{ product_id: p, received: 2, bin_id: 999999 }]);
  assert.equal(r.code, 404);
  assert.equal(await onHand(p), 0);
  const tb = okBody(await T.call(wh.create, { body: { segment: 'X', loc_type: 'BIN' } }, T.tenantFor()), 201);
  const r2 = await post([{ product_id: p, received: 2, bin_id: tb.location_id }]);
  assert.equal(r2.code, 404);
  assert.equal(await onHand(p), 0);
});

test('cancel: reverses stock and the damaged log while the stock is still there', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Fuse' });
  const g = okBody(await post([{ product_id: p, received: 6, damaged: 1, bin_id: bin.location_id, unit_cost: 10 }]), 201);
  assert.equal(await onHand(p), 5);
  okBody(await call(recv.cancel, { params: { id: String(g.grn_id) }, body: { reason: 'Wrong delivery' } }));
  assert.equal(await onHand(p), 0);
  assert.equal(await damagedNet(p), 0);
  assert.equal((await bins.partLocations(pool, tenant, p)).binned, 0);
  assert.equal((await call(recv.cancel, { params: { id: String(g.grn_id) }, body: { reason: 'again' } })).code, 409);
  await invariant();
});

test('cancel: refused once some of it was sold', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Bulb' });
  const g = okBody(await post([{ product_id: p, received: 4, unit_cost: 20 }]), 201);
  await inTx((db) => moveStock(db, { businessId: S.businessId, branchId: S.branchId, productId: p, delta: -2 }));
  const r = await call(recv.cancel, { params: { id: String(g.grn_id) }, body: { reason: 'oops' } });
  assert.equal(r.code, 409);
  assert.equal(await onHand(p), 2);
});

test('receipts are isolated per business', { skip }, async () => {
  const g = okBody(await post([{ product_id: part, received: 1, unit_cost: 1 }]), 201);
  assert.equal((await T.call(recv.get, { params: { id: String(g.grn_id) } }, T.tenantFor())).code, 404);
  assert.equal((await T.call(recv.cancel, { params: { id: String(g.grn_id) }, body: { reason: 'x' } }, T.tenantFor())).code, 404);
});
