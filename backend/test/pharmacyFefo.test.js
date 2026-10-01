/*
 * FEFO allocation (modules/wholesale/stock.js::allocateBatches, reused unmodified by pharmacy — see
 * migrations/0061_pharmacy_foundation.js's header note): soonest expiry first, and a quarantined/recalled/
 * blocked batch is never picked regardless of how early it expires.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addBatch, addProduct, makePharmacy } from './helpers/pharmacy.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { allocateBatches } = await import('../src/modules/pharmacy/stock.js');

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);

t('FEFO picks the soonest-expiry ACTIVE batch first and skips a quarantined one', async () => {
  const p = await makePharmacy(pool, 'fefo');
  const med = await addProduct(pool, p, { name: 'Azithromycin 250mg', batch: true, expiry: true });
  // deliberately inserted out of expiry order, and the soonest of all three is quarantined
  await addBatch(pool, p, med, { batchNo: 'MID', qty: 30, expiry: '2026-08-01' });
  await addBatch(pool, p, med, { batchNo: 'SOON-BUT-QUARANTINED', qty: 20, expiry: '2026-03-01', status: 'QUARANTINED' });
  await addBatch(pool, p, med, { batchNo: 'LATE', qty: 40, expiry: '2026-12-01' });
  await addBatch(pool, p, med, { batchNo: 'EARLIEST-ACTIVE', qty: 10, expiry: '2026-05-01' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { allocations, unbatched } = await allocateBatches(client, { branchId: p.branchId, productId: med, qty: 35, fefo: true, today: '2026-01-01' });
    await client.query('ROLLBACK');
    // EARLIEST-ACTIVE (10, May) then MID (30, Aug) covers 35 without ever touching the quarantined or LATE batch
    const picked = (await pool.query(`SELECT batch_no FROM wholesale_batches WHERE batch_id = ANY($1::bigint[]) ORDER BY expiry_date`, [allocations.map((a) => a.batch_id)])).rows.map((r) => r.batch_no);
    assert.deepEqual(picked, ['EARLIEST-ACTIVE', 'MID']);
    assert.equal(allocations.reduce((s, a) => s + a.qty, 0), 35);
    assert.equal(unbatched, 0);
  } finally { client.release(); }
});

t('expired batches are never allocated, regardless of status', async () => {
  const p = await makePharmacy(pool, 'fefoexp');
  const med = await addProduct(pool, p, { name: 'Omeprazole 20mg', batch: true, expiry: true });
  await addBatch(pool, p, med, { batchNo: 'EXPIRED', qty: 50, expiry: '2025-01-01' });
  await addBatch(pool, p, med, { batchNo: 'GOOD', qty: 5, expiry: '2026-12-01' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { allocations, unbatched } = await allocateBatches(client, { branchId: p.branchId, productId: med, qty: 10, fefo: true, today: '2026-01-01' });
    await client.query('ROLLBACK');
    assert.equal(allocations.length, 1);
    assert.equal(unbatched, 5);   // only the 5 good units could be covered; the 50 expired ones are invisible to FEFO
  } finally { client.release(); }
});
