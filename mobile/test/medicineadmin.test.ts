/* Medicines and items on the phone: the form, its checks, the body, the list line, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MEDICINE_ADMIN_TEXTS, canMedicineAdmin, categoryProblem, emptyItem, itemBody, itemForm, itemProblem, itemSub, withExpiry, type Item } from '../src/lib/medicineAdmin.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const p: Item = {
  product_id: 1, name: 'Paracetamol 500', sku: 'PCM500', barcode: null, unit: 'strip', status: 'ACTIVE', description: null, category_id: 3, category: 'Fever', hsn_sac: '3004', tax_rate: 12, purchase_price: 18, selling_price: 25, reorder_level: 20, track_inventory: true,
  product_type: 'MEDICINE', manufacturer: 'Cipla', mrp: 30, batch_tracking: true, expiry_tracking: true, serial_tracking: false, prescription_required: false, fefo_required: true, warranty_applicable: false, warranty_months: null, service_trackable: false,
  schedule_class: null, salt_composition: 'Paracetamol', strength: '500mg', dosage_form: 'Tablet', on_hand: 8, available: 8, low: true
};

test('only people with the products right', () => { assert.equal(canMedicineAdmin((x) => x === 'products'), true); assert.equal(canMedicineAdmin(() => false), false); });

test('form round trip, checks and body', () => {
  const f = itemForm(p);
  assert.equal(f.category_id, '3'); assert.equal(f.barcode, ''); assert.equal(f.mrp, '30'); assert.equal(itemProblem(f), '');
  const b = itemBody({ ...f, name: ' Crocin ', sku: '', mrp: '', schedule_class: 'h' });
  assert.equal(b.name, 'Crocin'); assert.equal(b.sku, null); assert.equal(b.mrp, null); assert.equal(b.selling_price, 25); assert.equal(b.category_id, 3); assert.equal(b.warranty_months, null); assert.equal(b.schedule_class, 'h');
  assert.equal(itemBody({ ...f, warranty_applicable: true, warranty_months: '12' }).warranty_months, 12); assert.equal(itemBody(emptyItem()).reorder_level, 0);
  assert.notEqual(itemProblem({ ...f, name: 'P' }), ''); assert.notEqual(itemProblem({ ...f, unit: ' ' }), ''); assert.notEqual(itemProblem({ ...f, tax_rate: '101' }), ''); assert.notEqual(itemProblem({ ...f, selling_price: '' }), '');
  assert.notEqual(itemProblem({ ...f, purchase_price: 'x' }), ''); assert.notEqual(itemProblem({ ...f, mrp: '-1' }), ''); assert.notEqual(itemProblem({ ...f, warranty_applicable: true, warranty_months: '' }), ''); assert.equal(categoryProblem('A'), 'Give the category a name');
  const e = withExpiry({ ...emptyItem(), batch_tracking: false, expiry_tracking: false }, true);
  assert.equal(e.batch_tracking, true); assert.equal(withExpiry({ ...e, batch_tracking: true }, false).batch_tracking, true);
});

test('the list line', () => {
  assert.equal(itemSub(p), '500mg Cipla · ₹25.00 · 8 in stock · Running low');
  assert.equal(itemSub({ ...p, low: false, prescription_required: true, status: 'ARCHIVED', track_inventory: false }), '500mg Cipla · ₹25.00 · Prescription needed · Archived');
});

test('every text of the medicines screen is translated into all six languages', () => {
  const names = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(MEDICINE_ADMIN_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
