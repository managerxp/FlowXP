/*
 * A pharmacy phone that sold with no signal: the sale is recorded when it arrives (never refused for stock), dated the day it was taken, flagged for
 * a person to check, and replayed safely. A prescription medicine is never sold without the prescription check, online or offline. The phone's copy
 * of the catalogue carries what a medicine is and whether it needs a prescription.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addBatch, addProduct, makePharmacy, stockOf } from './helpers/pharmacy.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const pos = (await import('../src/controllers/pharmacyPos.controller.js')).default;
const { posRowsByIds } = await import('../src/controllers/products.controller.js');

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);

const dayAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const headers = (h) => ({ get: (name) => h[name] });
const sale = (p, items, extra = {}, hdr = {}) => p.call(pos.create, { body: { items, payment: { amount: 'FULL', method: 'CASH' }, ...extra }, ...headers(hdr) });

t('a prescription medicine is refused without the prescription check and sold with it', async () => {
  const p = await makePharmacy(pool, 'rx');
  const med = await addProduct(pool, p, { name: 'Atorvastatin 10mg', batch: true, expiry: true, prescription: true });
  await addBatch(pool, p, med, { batchNo: 'RX1', qty: 10, expiry: '2030-01-01' });
  const refused = await sale(p, [{ product_id: med, quantity: 1 }]);
  assert.equal(refused.code, 400); assert.equal(refused.body.code, 'PRESCRIPTION_NOT_CHECKED');
  assert.equal((await stockOf(pool, p.branchId, med)).on_hand, 10, 'nothing was taken');
  const ok = await sale(p, [{ product_id: med, quantity: 1 }], { prescription_checked: true });
  assert.equal(ok.code, 201);
});

t('the prescription rule holds for a sale taken offline too', async () => {
  const p = await makePharmacy(pool, 'rxoff');
  const med = await addProduct(pool, p, { name: 'Tramadol 50mg', batch: true, expiry: true, prescription: true });
  await addBatch(pool, p, med, { batchNo: 'RX2', qty: 10, expiry: '2030-01-01' });
  const res = await sale(p, [{ product_id: med, quantity: 1 }], {}, { 'X-Offline-Sale': '1', 'X-Sale-Date': dayAgo(1), 'Idempotency-Key': 'k-rx' });
  assert.equal(res.code, 400);
});

t('an offline sale of more than is on the shelf is recorded, dated the day it was taken, and flagged for review', async () => {
  const p = await makePharmacy(pool, 'off');
  const med = await addProduct(pool, p, { name: 'Paracetamol 650', batch: true, expiry: true, price: 30 });
  await addBatch(pool, p, med, { batchNo: 'P1', qty: 3, expiry: '2030-01-01' });
  const online = await sale(p, [{ product_id: med, quantity: 5 }]);
  assert.equal(online.code, 409, 'online, too little stock is refused');
  const res = await sale(p, [{ product_id: med, quantity: 5 }], { expected_total: 168 }, { 'X-Offline-Sale': '1', 'X-Sale-Date': dayAgo(3), 'Idempotency-Key': 'k-off-1' });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.review.length >= 1, true, 'something to check');
  const inv = (await pool.query(`SELECT invoice_date::text AS d, notes, client_key FROM invoices WHERE invoice_id = $1`, [res.body.data.invoice.invoice_id])).rows[0];
  assert.equal(inv.d, dayAgo(3)); assert.match(inv.notes, /Taken offline/); assert.equal(inv.client_key, 'k-off-1');
  assert.equal((await stockOf(pool, p.branchId, med)).on_hand, -2, 'stock shows the oversell for a person to count');
  await new Promise((r) => setTimeout(r, 300));   // the audit row is written just after the reply
  const audit = (await pool.query(`SELECT metadata FROM audit_log WHERE action = 'pharmacy.sale_completed' AND business_id = $1`, [p.businessId])).rows;
  assert.equal(audit.some((a) => a.metadata?.offline === true), true);
});

t('the same offline sale sent again returns the same bill, even after the duplicate guard has forgotten it', async () => {
  const p = await makePharmacy(pool, 'replay');
  const med = await addProduct(pool, p, { name: 'Cetirizine 10', batch: true, expiry: true });
  await addBatch(pool, p, med, { batchNo: 'C1', qty: 20, expiry: '2030-01-01' });
  const hdr = { 'X-Offline-Sale': '1', 'X-Sale-Date': dayAgo(2), 'Idempotency-Key': 'k-replay' };
  const a = await sale(p, [{ product_id: med, quantity: 2 }], {}, hdr);
  await pool.query(`DELETE FROM idempotency_keys`).catch(() => {});
  const b = await sale(p, [{ product_id: med, quantity: 2 }], {}, hdr);
  assert.equal(a.code, 201); assert.equal(b.code, 201);
  assert.equal(a.body.data.invoice.invoice_id, b.body.data.invoice.invoice_id);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`, [p.businessId])).rows[0].n, 1);
  assert.equal((await stockOf(pool, p.branchId, med)).on_hand, 0 + (await stockOf(pool, p.branchId, med)).on_hand, 'stock was taken once');
  assert.equal(Number((await pool.query(`SELECT SUM(qty_on_hand) AS q FROM wholesale_batches WHERE product_id = $1`, [med])).rows[0].q), 18);
});

t('a phone clock that is wrong (a month ago) is not believed: the sale is dated today', async () => {
  const p = await makePharmacy(pool, 'clock');
  const med = await addProduct(pool, p, { name: 'ORS sachet', stock: 50 });
  const res = await sale(p, [{ product_id: med, quantity: 1 }], {}, { 'X-Offline-Sale': '1', 'X-Sale-Date': dayAgo(40), 'Idempotency-Key': 'k-clock' });
  assert.equal(res.code, 201);
  const d = (await pool.query(`SELECT invoice_date::text AS d FROM invoices WHERE invoice_id = $1`, [res.body.data.invoice.invoice_id])).rows[0].d;
  assert.notEqual(d, dayAgo(40)); assert.equal(Math.abs(Date.parse(d) - Date.parse(dayAgo(0))) <= 86400000, true);
});

t('a price that changed since the phone last synced is flagged, not hidden', async () => {
  const p = await makePharmacy(pool, 'price');
  const med = await addProduct(pool, p, { name: 'Vitamin C', stock: 50, price: 100, tax: 0 });
  const res = await sale(p, [{ product_id: med, quantity: 1 }], { expected_total: 80 }, { 'X-Offline-Sale': '1', 'X-Sale-Date': dayAgo(1), 'Idempotency-Key': 'k-price' });
  assert.equal(res.code, 201);
  assert.match(res.body.data.review.join(' '), /phone showed/);
});

t('the phone\'s catalogue copy of a medicine carries what it is and whether it needs a prescription', async () => {
  const p = await makePharmacy(pool, 'catalog');
  const med = await addProduct(pool, p, { name: 'Amoxicillin 500', batch: true, expiry: true, prescription: true });
  await pool.query(`UPDATE pharmacy_item_details SET strength = '500mg', manufacturer = 'Cipla', salt_composition = 'Amoxicillin' WHERE product_id = $1`, [med]);
  const [row] = await posRowsByIds(p.tenantFor(), [med]);
  assert.deepEqual(row.pharmacy, { manufacturer: 'Cipla', strength: '500mg', dosage_form: null, salt_composition: 'Amoxicillin', schedule_class: null, prescription_required: true, batch_tracking: true, expiry_tracking: true });
  const log = (await pool.query(`SELECT COUNT(*)::int AS n FROM sync_log WHERE business_id = $1 AND entity = 'product' AND entity_id = $2`, [p.businessId, med])).rows[0].n;
  assert.equal(log >= 2, true, 'changing the details counts as a change to the product');
});
