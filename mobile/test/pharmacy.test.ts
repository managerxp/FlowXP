/* The pharmacy till and stock: the bill, prescriptions, batches, use-by dates, receiving a delivery. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMedicine, batchActions, daysTo, expiryFromMonth, expiryText, grnBody, grnLineProblem, grnProblem, itemsBody, newGrnLine, pharmacyProblem, pickBatch, quoteBody, removeLine, roughPaise, rxNote, saleBody, sellable, setQuantity, shortBy,
  type Batch, type Medicine
} from '../src/lib/pharmacy.ts';

const med = (id: number, over: Partial<Medicine> = {}): Medicine => ({
  product_id: id, name: `Med ${id}`, sku: null, barcode: null, unit: 'strip', selling_price: 50, mrp: 55, tax_rate: 12, manufacturer: null, strength: null, dosage_form: null, salt_composition: null, schedule_class: null,
  batch_tracking: true, expiry_tracking: true, prescription_required: false, track_inventory: true, available: 10, ...over
});
const batch = (over: Partial<Batch> = {}): Batch => ({ batch_id: 9, product_id: 1, product: 'Med 1', unit: 'strip', batch_no: 'B1', mfg_date: null, expiry_date: '2027-03-31', qty_on_hand: 5, cost: 30, status: 'ACTIVE', branch: 'Main', ...over });

test('the same medicine added twice is one line of two; a chosen batch is its own line; zero takes it off', () => {
  let l = addMedicine(addMedicine([], med(1)), med(1));
  assert.deepEqual(l.map((x) => x.quantity), [2]);
  l = pickBatch(l, l[0].key, batch());
  l = addMedicine(l, med(1));
  assert.equal(l.length, 2, 'one from the chosen batch, one automatic');
  assert.equal(setQuantity(l, l[0].key, 0).length, 1);
  assert.equal(removeLine(l, l[1].key).length, 1);
  assert.equal(roughPaise(addMedicine([], med(1), 3)), 15000);
});

test('what is sent: the medicine and how many, a chosen batch only when chosen, the customer as customerId, one payment of the whole bill, a note only if typed', () => {
  let l = addMedicine(addMedicine([], med(1), 2), med(2));
  l = pickBatch(l, l[1].key, batch({ batch_id: 44 }));
  assert.deepEqual(itemsBody(l), [{ product_id: 1, quantity: 2 }, { product_id: 2, quantity: 1, batch_id: 44 }]);
  assert.deepEqual(quoteBody(l, 7), { items: itemsBody(l), customerId: 7 });
  assert.equal('customerId' in quoteBody(l, null), false);
  const sale = saleBody(l, null, 'UPI', ' ref ', ' Rx seen ');
  assert.deepEqual([sale.payments, sale.notes], [[{ method: 'UPI', amount: 'FULL', reference_number: 'ref' }], 'Rx seen']);
  assert.equal('notes' in saleBody(l, null, 'CASH', '', ''), false);
});

test('a prescription medicine must be checked before the bill, and the note says who it was for', () => {
  const l = addMedicine(addMedicine([], med(1)), med(2, { prescription_required: true }));
  assert.match(pharmacyProblem(l, false), /prescription/i);
  assert.equal(pharmacyProblem(l, true), '');
  assert.equal(pharmacyProblem(addMedicine([], med(1)), false), '');
  assert.match(pharmacyProblem([], true), /at least one/);
  assert.equal(rxNote(l, ' Dr Rao ', 'Meena'), 'Prescription checked. Doctor: Dr Rao. Patient: Meena');
  assert.equal(rxNote(addMedicine([], med(1)), 'x', 'y'), '', 'no note when nothing needed one');
});

test('asking for more than the shelf has is flagged before the server refuses', () => {
  assert.equal(shortBy(addMedicine([], med(1, { available: 3 }), 5)[0]), 2);
  assert.equal(shortBy(addMedicine([], med(1, { available: 30 }), 5)[0]), 0);
  assert.equal(shortBy(addMedicine([], med(1, { track_inventory: false, available: 0 }), 5)[0]), 0);
});

test('a batch can be sold only if it is on sale, in date and has stock', () => {
  assert.equal(sellable(batch(), '2026-10-08'), true);
  assert.equal(sellable(batch({ expiry_date: '2026-10-07' }), '2026-10-08'), false);
  assert.equal(sellable(batch({ status: 'RECALLED' }), '2026-10-08'), false);
  assert.equal(sellable(batch({ qty_on_hand: 0 }), '2026-10-08'), false);
  assert.equal(sellable(batch({ expiry_date: null }), '2026-10-08'), true);
});

test('use-by dates are typed as month and year and mean the last day of that month', () => {
  assert.equal(expiryFromMonth('03/2027'), '2027-03-31');
  assert.equal(expiryFromMonth('3/27'), '2027-03-31');
  assert.equal(expiryFromMonth('2028-02'), '2028-02-29');
  assert.equal(expiryFromMonth('2027-06-15'), '2027-06-15');
  for (const bad of ['', '13/2027', '00/2027', 'soon', '2027-02-31']) assert.equal(expiryFromMonth(bad), null, bad);
  assert.equal(daysTo('2026-10-18', '2026-10-08'), 10);
  assert.deepEqual(['2026-10-05', '2026-10-08', '2026-10-20', '2027-12-31', null].map((d) => expiryText(d, '2026-10-08')), ['Expired 3 days ago', 'Last day today', '12 days left', 'Use by 2027-12-31', 'No use-by date']);
});

test('a delivery line needs a cost, a batch and a future use-by date where the medicine is tracked, and damaged cannot exceed received', () => {
  const today = '2026-10-08';
  const line = (over: object = {}) => ({ ...newGrnLine(med(1)), received: '10', unit_cost: '30', batch_no: 'B7', expiry: '03/2027', ...over });
  assert.equal(grnLineProblem(line(), today), '');
  assert.match(grnLineProblem(line({ unit_cost: '' }), today), /cost/);
  assert.match(grnLineProblem(line({ batch_no: ' ' }), today), /batch number/);
  assert.match(grnLineProblem(line({ expiry: '' }), today), /use-by/);
  assert.match(grnLineProblem(line({ expiry: '01/2026' }), today), /expired/);
  assert.match(grnLineProblem(line({ damaged: '11' }), today), /damaged/);
  assert.equal(grnLineProblem({ ...line({ batch_no: '', expiry: '' }), product: med(1, { batch_tracking: false, expiry_tracking: false }) }, today), '', 'an untracked item needs neither');
  assert.equal(grnLineProblem({ ...line(), received: '' }, today), '', 'a line with nothing received is left out');
});

test('a delivery needs a supplier and something that came; what is sent has the dates as real dates and a payment only if typed', () => {
  const today = '2026-10-08';
  const l = { ...newGrnLine(med(1)), received: '10', damaged: '1', unit_cost: '30', batch_no: ' B7 ', expiry: '03/2027', mfg: '3/25' };
  assert.match(grnProblem([l], null, today), /supplier/i);
  assert.match(grnProblem([newGrnLine(med(1))], 3, today), /at least one/);
  assert.equal(grnProblem([l], 3, today), '');
  assert.deepEqual(grnBody([l, newGrnLine(med(2))], 3, ' INV-9 ', '100', 'CASH'), {
    supplier_id: 3, supplier_invoice_no: 'INV-9',
    items: [{ product_id: 1, received: 10, damaged: 1, unit_cost: 30, tax_rate: 12, batch_no: 'B7', expiry_date: '2027-03-31', mfg_date: '2025-03-31' }],
    payment: { amount: 100, method: 'CASH' }
  });
});

test('an on-sale batch can be held back, recalled or blocked; any other goes back on sale', () => {
  assert.deepEqual(batchActions('ACTIVE').map((a) => a.to), ['QUARANTINED', 'RECALLED', 'BLOCKED']);
  assert.deepEqual(batchActions('RECALLED').map((a) => a.to), ['ACTIVE']);
});
