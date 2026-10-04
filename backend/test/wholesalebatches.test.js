/*
 * The batch list: it answers whichever filter is chosen (or none). It once failed with a 500 for every view except
 * "expiring" and "ok", because the alert window was sent as a parameter the query only used in those two.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addBatch, addProduct, dayFromNow, makeWholesaler } from './helpers/wholesale.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const inv = (await import('../src/controllers/wholesaleInventory.controller.js')).default;
test.after(cleanup);

test('the batch list works with no filter and with every state filter', { skip }, async () => {
  await runMigrations(pool);
  const w = await makeWholesaler(pool, 'bt');
  const p = await addProduct(pool, w, { name: 'Curd 1kg', batch: true, expiry: true });
  await addBatch(pool, w, p, { batchNo: 'OLD', qty: 5, expiry: dayFromNow(-3) });
  await addBatch(pool, w, p, { batchNo: 'SOON', qty: 5, expiry: dayFromNow(10) });
  await addBatch(pool, w, p, { batchNo: 'LATER', qty: 5, expiry: dayFromNow(400) });
  const names = async (query) => { const r = await w.call(inv.batches, { query }); assert.equal(r.code, 200, JSON.stringify(r.body)); return r.body.data.map((b) => b.batch_no).sort(); };
  assert.deepEqual(await names({}), ['LATER', 'OLD', 'SOON']);
  assert.deepEqual(await names({ state: 'expired' }), ['OLD']);
  assert.deepEqual(await names({ state: 'expiring' }), ['SOON']);
  assert.deepEqual(await names({ state: 'ok' }), ['LATER']);
  assert.deepEqual(await names({ q: 'soon' }), ['SOON']);
});
