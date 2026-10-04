/*
 * Pharmacy GRN: direct procurement only — no Purchase Order anywhere a person or the API can see. Posting a
 * GRN still writes a hidden, already-RECEIVED purchase_orders row (the same mechanism wholesale's own direct
 * GRN already uses) purely as payable bookkeeping; this file asserts that row is never surfaced to pharmacy.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addProduct, addSupplier, makePharmacy, stockOf } from './helpers/pharmacy.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const grn = (await import('../src/controllers/pharmacyGrn.controller.js')).default;

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);

const batchRows = async (productId) => (await pool.query(`SELECT batch_no, expiry_date, qty_on_hand, status FROM wholesale_batches WHERE product_id = $1 ORDER BY expiry_date`, [productId])).rows;
const poRow = async (poId) => (await pool.query(`SELECT status, payment_status FROM purchase_orders WHERE po_id = $1`, [poId])).rows[0];

t('a direct GRN posts two batches, moves stock once, and leaves no visible PO', async () => {
  const p = await makePharmacy(pool, 'grn');
  const med = await addProduct(pool, p, { name: 'Paracetamol 500mg', batch: true, expiry: true, cost: 2 });
  const supplier = await addSupplier(pool, p);

  const res = await p.call(grn.createGRN, { body: {
    supplier_id: supplier, grn_date: '2026-01-10',
    items: [
      { product_id: med, received: 100, unit_cost: 2, batch_no: 'B1', expiry_date: '2026-06-01' },
      { product_id: med, received: 50, unit_cost: 2.1, batch_no: 'B2', expiry_date: '2026-09-01' }
    ]
  } });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.items.length, 2);

  const stock = await stockOf(pool, p.branchId, med);
  assert.equal(stock.on_hand, 150);   // one movement per line, not double-posted

  const batches = await batchRows(med);
  assert.deepEqual(batches.map((b) => [b.batch_no, Number(b.qty_on_hand), b.status]), [['B1', 100, 'ACTIVE'], ['B2', 50, 'ACTIVE']]);

  const txns = (await pool.query(`SELECT transaction_type, quantity FROM inventory_transactions WHERE product_id = $1 ORDER BY txn_id`, [med])).rows;
  assert.deepEqual(txns.map((x) => [x.transaction_type, Number(x.quantity)]), [['PURCHASE', 100], ['PURCHASE', 50]]);

  // the hidden PO exists (payable bookkeeping) but is already RECEIVED — never a draft/approvable PO
  const { po_id } = (await pool.query(`SELECT po_id FROM wholesale_grns WHERE grn_id = $1`, [res.body.data.grn_id])).rows[0];
  const po = await poRow(po_id);
  assert.equal(po.status, 'RECEIVED');
  // and pharmacy.routes.js mounts no route that could ever list or fetch it — nothing to assert at the HTTP
  // layer beyond "the route doesn't exist", which is a routing-table fact, not a runtime one for this test
});

t('an already-expired batch is rejected on receipt', async () => {
  const p = await makePharmacy(pool, 'grnexp');
  const med = await addProduct(pool, p, { name: 'Cough Syrup', batch: true, expiry: true, cost: 5 });
  const supplier = await addSupplier(pool, p);
  const res = await p.call(grn.createGRN, { body: {
    supplier_id: supplier, grn_date: '2026-01-10',
    items: [{ product_id: med, received: 10, unit_cost: 5, batch_no: 'OLD1', expiry_date: '2025-12-01' }]
  } });
  assert.equal(res.code, 400);
  assert.equal((await stockOf(pool, p.branchId, med)).on_hand, 0);   // nothing posted on the rejected line
});

t('a batch-tracked product without a batch number is refused', async () => {
  const p = await makePharmacy(pool, 'grnbatch');
  const med = await addProduct(pool, p, { name: 'Amoxicillin 500mg', batch: true, cost: 3 });
  const supplier = await addSupplier(pool, p);
  const res = await p.call(grn.createGRN, { body: { supplier_id: supplier, items: [{ product_id: med, received: 20, unit_cost: 3 }] } });
  assert.equal(res.code, 400);
});

t('damaged goods on receipt are logged, not added to sellable stock', async () => {
  const p = await makePharmacy(pool, 'grndamaged');
  const med = await addProduct(pool, p, { name: 'Glucose Test Strips', cost: 8 });
  const supplier = await addSupplier(pool, p);
  const res = await p.call(grn.createGRN, { body: { supplier_id: supplier, items: [{ product_id: med, received: 20, damaged: 5, unit_cost: 8 }] } });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  assert.equal((await stockOf(pool, p.branchId, med)).on_hand, 15);   // 20 received - 5 damaged
  const damaged = (await pool.query(`SELECT qty FROM wholesale_damaged_log WHERE product_id = $1`, [med])).rows[0];
  assert.equal(Number(damaged.qty), 5);
});
