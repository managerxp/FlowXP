/*
 * Auto parts returns and counts: a credit note with a reason and a disposition (only RESTOCK adds sellable stock), supplier claims, a stock count whose differences need approval,
 * and the bin invariant throughout.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addPart, makeShop } from './helpers/autoparts.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const rets = (await import('../src/controllers/autopartsReturns.controller.js')).default;
const wh = (await import('../src/controllers/autopartsWarehouse.controller.js')).default;
const notes = await import('../src/controllers/creditNotes.controller.js');
const bins = await import('../src/modules/autoparts/bins.js');
const stockMod = await import('../src/modules/retailStock.js');
const { inTx } = await import('../src/modules/autoparts/common.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');

test.after(cleanup);

let S; let tenant; let bin; let supplier;
const call = (handler, extra, t = tenant) => S.call(handler, extra, t);
const okBody = (res, code = 200) => { assert.equal(res.code, code, JSON.stringify(res.body)); assert.equal(res.body.success, true); return res.body.data; };
const onHand = async (id) => Number((await pool.query(`SELECT quantity FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [S.branchId, id])).rows[0]?.quantity ?? 0);
const damagedNet = async (id) => Number((await pool.query(`SELECT COALESCE(SUM(qty),0) AS n FROM wholesale_damaged_log WHERE business_id = $1 AND product_id = $2`, [S.businessId, id])).rows[0].n);
const invariant = async () => assert.equal((await bins.reconcile(pool, S.allOutlets())).ok, true);
const bill = (items) => inTx((db) => createInvoiceInTransaction(db, { businessId: S.businessId, branchId: S.branchId, businessType: 'AUTO_PARTS' }, S.userId, { items, payment: { amount: 'FULL', method: 'CASH' } }));
const credit = async (invoice, body) => {
  const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  const lines = (await pool.query(`SELECT item_id FROM invoice_items WHERE invoice_id = $1 ORDER BY item_id`, [invoice.invoice_id])).rows;
  await notes.create({ tenant, auth: { userId: S.userId }, params: { id: String(invoice.invoice_id) }, body: { items: [{ item_id: lines[0].item_id, quantity: 1 }], reason: 'Customer brought it back', ...body }, query: {}, headers: {}, ip: '127.0.0.1' }, res);
  return res;
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  S = await makeShop(pool, 'rt');
  tenant = S.tenantFor();
  supplier = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,'Valeo') RETURNING supplier_id`, [S.businessId])).rows[0].supplier_id;
  const w = okBody(await call(wh.create, { body: { segment: 'WH' } }), 201);
  bin = okBody(await call(wh.create, { body: { parent_id: w.location_id, segment: 'B1', loc_type: 'BIN' } }), 201);
});

test('a parts return must say why and what becomes of the part', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Radiator', stock: 5, price: 2000 });
  const inv = await bill([{ product_id: p, quantity: 2 }]);
  assert.equal((await credit(inv, {})).code, 400);
  assert.equal((await credit(inv, { return_reason: 'DEFECTIVE' })).code, 400);
  assert.equal((await credit(inv, { return_reason: 'MADE_UP', disposition: 'RESTOCK' })).code, 400);
  assert.equal(await onHand(p), 3);
});

test('RESTOCK adds sellable stock (to a chosen bin or as a put-away task); DAMAGED and SCRAP do not', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Thermostat', stock: 10, price: 500 });
  const inv = await bill([{ product_id: p, quantity: 4 }]);
  okBody(await credit(inv, { return_reason: 'NOT_REQUIRED', disposition: 'RESTOCK', bin_id: bin.location_id }), 201);
  assert.equal(await onHand(p), 7);
  assert.equal((await bins.partLocations(pool, tenant, p)).binned, 1);
  okBody(await credit(inv, { return_reason: 'NOT_REQUIRED', disposition: 'RESTOCK' }), 201);
  assert.equal(await onHand(p), 8);
  assert.equal((await bins.openTasks(pool, tenant)).filter((t) => t.product_id === p && t.source === 'RETURN').length, 1);
  okBody(await credit(inv, { return_reason: 'TRANSIT_DAMAGE', disposition: 'DAMAGED' }), 201);
  assert.equal(await onHand(p), 8); assert.equal(await damagedNet(p), 1);
  okBody(await credit(inv, { return_reason: 'DEFECTIVE', disposition: 'SCRAP' }), 201);
  assert.equal(await onHand(p), 8); assert.equal(await damagedNet(p), 1);
  const log = okBody(await call(rets.log, {}));
  assert.deepEqual(log.filter((r) => r.product_id === p).map((r) => r.disposition).sort(), ['DAMAGED', 'RESTOCK', 'RESTOCK', 'SCRAP']);
  await invariant();
});

test('SUPPLIER return: not sellable, damaged log, and an open claim on the supplier that can be resolved once', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Water pump', stock: 6, price: 900 });
  const inv = await bill([{ product_id: p, quantity: 1 }]);
  okBody(await credit(inv, { return_reason: 'WARRANTY', disposition: 'SUPPLIER', supplier_id: supplier }), 201);
  assert.equal(await onHand(p), 5); assert.equal(await damagedNet(p), 1);
  const claims = okBody(await call(rets.claims, {}));
  const c = claims.find((x) => x.product_id === p);
  assert.equal(c.reason, 'WARRANTY'); assert.equal(c.supplier, 'Valeo'); assert.equal(c.status, 'OPEN');
  okBody(await call(rets.claimResolve, { params: { id: String(c.claim_id) }, body: { status: 'CREDITED', amount: 850 } }));
  assert.equal((await call(rets.claimResolve, { params: { id: String(c.claim_id) }, body: { status: 'CREDITED' } })).code, 409);
  assert.equal(okBody(await call(rets.claims, { query: { status: 'CREDITED' } })).find((x) => x.claim_id === c.claim_id).amount_paise, 85000);
  const manual = okBody(await call(rets.claimCreate, { body: { product_id: p, supplier_id: supplier, qty: 2, reason: 'REJECTED', amount: 100 } }), 201);
  assert.equal(manual.status, 'OPEN');
});

test('a count with differences needs someone who may approve stock; matching counts do not', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Gear oil', stock: 10 });
  const clerk = S.tenantFor('STOREKEEPER');
  const start = async (t) => (await stockMod.createCount(pool, { tenant: t, userId: S.userId, name: `Count ${Math.random()}` })).count_id;
  const apply = (t, countId) => inTx((db) => stockMod.applyCount(db, { tenant: t, userId: S.userId, countId }));
  // storekeepers hold stock_count but not stock_approve
  let id = await start(clerk);
  await inTx((db) => stockMod.recordCounts(db, { tenant: clerk, userId: S.userId, countId: id, entries: [{ product_id: p, counted: 7 }] }));
  await assert.rejects(apply(clerk, id), (e) => e.status === 403);
  assert.equal(await onHand(p), 10);
  // the owner applies it: the ledger moves and bins stay consistent
  await apply(S.tenantFor('OWNER'), id);
  assert.equal(await onHand(p), 7);
  // a count that matches has nothing to approve
  id = await start(clerk);
  await inTx((db) => stockMod.recordCounts(db, { tenant: clerk, userId: S.userId, countId: id, entries: [{ product_id: p, counted: 7 }] }));
  await apply(clerk, id);
  await invariant();
});

test('a count shortage takes from the bins', { skip }, async () => {
  const p = await addPart(pool, S, { name: 'Valve', stock: 8 });
  okBody(await call(wh.putAway, { body: { product_id: p, location_id: bin.location_id, qty: 8 }, headers: {} }), 201);
  const id = (await stockMod.createCount(pool, { tenant, userId: S.userId, name: 'Shelf check' })).count_id;
  await inTx((db) => stockMod.recordCounts(db, { tenant, userId: S.userId, countId: id, entries: [{ product_id: p, counted: 5 }] }));
  await inTx((db) => stockMod.applyCount(db, { tenant, userId: S.userId, countId: id }));
  const l = await bins.partLocations(pool, tenant, p);
  assert.equal(l.on_hand, 5); assert.equal(l.binned, 5);
  await invariant();
});
