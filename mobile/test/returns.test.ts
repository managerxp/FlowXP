/* Returns for a wholesaler: goods back from a shop (credit note, and where the goods go) and goods back to a supplier (debit note). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditEstimatePaise, defaultDisposition, editP, editS, needsBatch, purchaseReturnBody, purchaseReturnProblem, salesReturnBody, salesReturnProblem, sentence, startLines, startPurchaseLines, withReason,
  type PRItem, type Returnable, type ReturnableItem
} from '../src/lib/returns.ts';

const item = (id: number, over: Partial<ReturnableItem> = {}): ReturnableItem => ({ item_id: id, product_id: id + 100, description: `Item ${id}`, unit_name: 'Carton', quantity: 5, credited: 1, returnable: 4, unit_price: 100, tax_rate: 18, tracks_stock: true, batches: [], ...over });
const inv = (items: ReturnableItem[]): Returnable => ({ invoice_id: 7, invoice_number: 'INV-7', status: 'ISSUED', balance_due: 0, items });
const batch = (id: number) => ({ batch_id: id, batch_no: `B${id}`, expiry_date: null, qty_base: 10 });

test('a return starts with the items that can still come back; a single batch is chosen for you; damaged goods are not put back on the shelf', () => {
  const l = startLines(inv([item(1), item(2, { returnable: 0 }), item(3, { batches: [batch(9)] }), item(4, { batches: [batch(8), batch(9)] })]), null);
  assert.deepEqual(l.map((x) => [x.item.item_id, x.batchId, x.disposition]), [[1, null, 'RESTOCK'], [3, 9, 'RESTOCK'], [4, null, 'RESTOCK']]);
  assert.deepEqual(['DAMAGED', 'EXPIRED', 'QUALITY', 'OTHER'].map((r) => defaultDisposition(r as never)), ['DAMAGED', 'EXPIRED', 'RESTOCK', 'RESTOCK']);
});

test('changing the reason moves the lines you have not touched, and leaves the ones you set yourself', () => {
  let l = startLines(inv([item(1), item(2)]), null);
  l = editS(l, 2, { disposition: 'NONE' });
  l = withReason(l, null, 'DAMAGED');
  assert.deepEqual(l.map((x) => x.disposition), ['DAMAGED', 'NONE']);
});

test('a batch-tracked item that the bill took from several batches must say which one it goes back to, only when it is going back on the shelf', () => {
  const [a] = startLines(inv([item(4, { batches: [batch(8), batch(9)] })]), null);
  assert.equal(needsBatch(a), true);
  assert.equal(needsBatch({ ...a, batchId: 8 }), false);
  assert.equal(needsBatch({ ...a, disposition: 'DAMAGED' }), false);
  assert.equal(needsBatch({ ...a, item: { ...a.item, tracks_stock: false } }), false);
});

test('a return needs a reason, something coming back, no more than can still be returned, and a batch where it matters', () => {
  let l = startLines(inv([item(1), item(4, { batches: [batch(8), batch(9)] })]), null);
  assert.match(salesReturnProblem(l, null), /why/);
  assert.match(salesReturnProblem(l, 'DAMAGED'), /how many/);
  assert.match(salesReturnProblem(editS(l, 1, { qty: '5' }), 'DAMAGED'), /only 4 Carton can still be returned/);
  l = editS(l, 4, { qty: '1' });
  assert.match(salesReturnProblem(l, 'QUALITY'), /choose which batch/);
  assert.equal(salesReturnProblem(editS(l, 4, { batchId: 8 }), 'QUALITY'), '');
  assert.equal(salesReturnProblem(editS(l, 4, { disposition: 'NONE' }), 'QUALITY'), '');
});

test('what a return sends: the bill, the reason, each line that comes back with where the goods go, and a refund only if chosen', () => {
  let l = startLines(inv([item(1), item(4, { batches: [batch(8), batch(9)] })]), 'DAMAGED');
  l = editS(editS(l, 1, { qty: '2' }), 4, { qty: '1', batchId: 9, disposition: 'RESTOCK' });
  assert.deepEqual(salesReturnBody(7, l, 'DAMAGED', ' crushed ', ''), { invoice_id: 7, reason: 'DAMAGED', notes: 'crushed', items: [{ invoice_item_id: 1, quantity: 2, disposition: 'DAMAGED' }, { invoice_item_id: 4, quantity: 1, disposition: 'RESTOCK', batch_id: 9 }] });
  assert.deepEqual(salesReturnBody(7, l, 'DAMAGED', '', 'UPI').refund, { method: 'UPI' });
  assert.equal('refund' in salesReturnBody(7, l, 'DAMAGED', '', null), false);
});

test('the credit estimate is price plus GST of what comes back', () => {
  const l = editS(startLines(inv([item(1, { unit_price: 100, tax_rate: 18 })]), null), 1, { qty: '2' });
  assert.equal(creditEstimatePaise(l), 23600);
});

const pr = (id: number, received: number): PRItem => ({ item_id: id, description: `Goods ${id}`, unit_name: 'Bag', received, product_id: id + 50 });

test('goods going back to a supplier: only what arrived, a reason, something to send', () => {
  let l = startPurchaseLines([pr(1, 10), pr(2, 0)]);
  assert.deepEqual(l.map((x) => x.item.item_id), [1], 'what never arrived cannot go back');
  assert.match(purchaseReturnProblem(l, null), /why/); assert.match(purchaseReturnProblem(l, 'DAMAGED'), /how many/);
  assert.match(purchaseReturnProblem(editP(l, 1, '11'), 'DAMAGED'), /only 10 Bag arrived/);
  l = editP(l, 1, '3');
  assert.equal(purchaseReturnProblem(l, 'DAMAGED'), '');
  assert.deepEqual(purchaseReturnBody(9, l, 'DAMAGED', ' wet '), { po_id: 9, reason: 'DAMAGED', notes: 'wet', items: [{ po_item_id: 1, quantity: 3 }] });
});

test('what a return did is said in one line, both ways', () => {
  const m = (n: number) => `₹${n}`;
  assert.equal(sentence({ return_number: 'RT-1', credit_note_total: 236, refunded: 100, unrefunded: 136 }, m), 'RT-1: credit note for ₹236, ₹100 paid back, ₹136 kept as credit.');
  assert.equal(sentence({ return_number: 'RT-2', credit_note_total: 236, refunded: 0, unrefunded: 0 }, m), 'RT-2: credit note for ₹236.');
  assert.equal(sentence({ return_number: 'RT-3', debit_note_total: 500, credit_with_supplier: 200 }, m), 'RT-3: debit note for ₹500, ₹200 credit with the supplier. Stock is taken off.');
});
