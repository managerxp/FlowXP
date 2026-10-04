/*
 * Two cashiers selling the last unit of the same batch at once: exactly one sale must succeed. This proves the
 * lockProducts (sorted-id, FOR UPDATE) -> allocateBatches (FOR UPDATE) -> consumeBatches (guarded UPDATE) chain
 * in modules/pharmacy/pos.js actually holds under real concurrency, not just in sequential test code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addBatch, addProduct, makePharmacy, stockOf } from './helpers/pharmacy.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const pos = (await import('../src/controllers/pharmacyPos.controller.js')).default;

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);

t('only one of two simultaneous sales of the last unit succeeds', async () => {
  const p = await makePharmacy(pool, 'race');
  const device = await addProduct(pool, p, { name: 'BP Monitor', batch: true, price: 2000 });
  await addBatch(pool, p, device, { batchNo: 'LAST1', qty: 1, cost: 1200 });

  const sell = () => p.call(pos.create, { body: { items: [{ product_id: device, quantity: 1 }], payment: { amount: 'FULL', method: 'CASH' } } });
  const [a, b] = await Promise.all([sell(), sell()]);

  const codes = [a.code, b.code].sort();
  assert.deepEqual(codes, [201, 409], JSON.stringify({ a: a.body, b: b.body }));

  const stock = await stockOf(pool, p.branchId, device);
  assert.equal(stock.on_hand, 0);   // never negative, never double-sold
  const batch = (await pool.query(`SELECT qty_on_hand FROM wholesale_batches WHERE product_id = $1`, [device])).rows[0];
  assert.equal(Number(batch.qty_on_hand), 0);

  const invoices = (await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`, [p.businessId])).rows[0].n;
  assert.equal(invoices, 1);   // exactly one invoice, not two, not zero
});

t('a non-batch-tracked product also blocks overselling its last unit', async () => {
  const p = await makePharmacy(pool, 'racenobatch');
  const consumable = await addProduct(pool, p, { name: 'Examination Gloves (box)', stock: 1, price: 150 });

  const sell = () => p.call(pos.create, { body: { items: [{ product_id: consumable, quantity: 1 }], payment: { amount: 'FULL', method: 'CASH' } } });
  const [a, b] = await Promise.all([sell(), sell()]);
  const codes = [a.code, b.code].sort();
  assert.deepEqual(codes, [201, 409], JSON.stringify({ a: a.body, b: b.body }));
  assert.equal((await stockOf(pool, p.branchId, consumable)).on_hand, 0);
});
