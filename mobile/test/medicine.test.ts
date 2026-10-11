/* Adding and editing a medicine: checks, what is sent, and only-what-changed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, changedBody, fromMedicine, medicineBody, medicineProblem, trackingLocked, withTracking, type MedicineFull } from '../src/lib/medicine.ts';

const full: MedicineFull = {
  product_id: 3, name: 'Paracetamol 500', sku: null, barcode: '890', unit: 'strip', category_id: null, category: null, hsn_sac: '3004', tax_rate: 12, selling_price: 20, purchase_price: 14, mrp: 22, reorder_level: 10,
  status: 'ACTIVE', manufacturer: 'Cipla', strength: '500 mg', dosage_form: 'Tablet', salt_composition: 'Paracetamol', schedule_class: null, batch_tracking: true, expiry_tracking: true,
  prescription_required: false, track_inventory: true, on_hand: 40
};

test('a medicine needs a name, a price and a unit, and a price within the MRP', () => {
  const d = blank();
  assert.equal(medicineProblem(d), 'Give the medicine a name');
  assert.equal(medicineProblem({ ...d, name: 'Crocin' }), 'Enter the selling price');
  assert.equal(medicineProblem({ ...d, name: 'Crocin', price: '30', mrp: '25' }), 'The selling price cannot be more than the MRP');
  assert.equal(medicineProblem({ ...d, name: 'Crocin', price: '20', unit: ' ' }), 'Say how it is sold (strip, bottle, piece)');
  assert.equal(medicineProblem({ ...d, name: 'Crocin', price: '20', mrp: '22' }), '');
});

test('expiry needs batches, and dropping batches drops expiry', () => {
  const d = { ...blank(), batch_tracking: false, expiry_tracking: false };
  assert.deepEqual([withTracking(d, { expiry_tracking: true }).batch_tracking, withTracking(d, { expiry_tracking: true }).expiry_tracking], [true, true]);
  assert.equal(withTracking(blank(), { batch_tracking: false }).expiry_tracking, false);
});

test('tracking cannot be switched off while there is stock', () => {
  assert.equal(trackingLocked(full), true);
  assert.equal(trackingLocked({ ...full, on_hand: 0 }), false);
  assert.equal(trackingLocked({ ...full, batch_tracking: false, expiry_tracking: false }), false);
  assert.equal(trackingLocked(null), false);
});

test('what is sent: a scheduled medicine always needs a prescription; empty optional fields clear', () => {
  const b = medicineBody({ ...blank(), name: ' Alprax ', price: '40', schedule_class: 'H1' });
  assert.equal(b.name, 'Alprax'); assert.equal(b.prescription_required, true); assert.equal(b.schedule_class, 'H1');
  assert.equal(b.mrp, null); assert.equal(b.purchase_price, 0); assert.equal(b.category_id, null); assert.equal(b.product_type, 'MEDICINE');
});

test('an edit sends only what changed', () => {
  const before = fromMedicine(full);
  assert.deepEqual(changedBody(before, before), {});
  assert.deepEqual(changedBody(before, { ...before, price: '21', strength: '650 mg' }), { selling_price: 21, strength: '650 mg' });
  assert.deepEqual(changedBody(before, { ...before, mrp: '' }), { mrp: null });
});
