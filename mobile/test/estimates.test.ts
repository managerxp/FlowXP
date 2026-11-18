import test from 'node:test';
import assert from 'node:assert/strict';
import { addProduct, blankLine, draftTotalPaise, estimateBody, estimateHtml, estimateProblem, estimateText, productLine, type Estimate } from '../src/lib/estimates.ts';

test('an estimate needs real lines', () => {
  assert.equal(estimateProblem([blankLine()]), 'Add at least one item');
  assert.equal(estimateProblem([{ description: '', quantity: '1', price: '5' }]), 'Every line needs a name');
  assert.equal(estimateProblem([{ description: 'Pen', quantity: '0', price: '5' }]), 'Enter a quantity above zero');
  assert.equal(estimateProblem([{ description: 'Pen', quantity: '1', price: '' }]), 'Enter a price');
  assert.equal(estimateProblem([{ description: 'Pen', quantity: '2', price: '5' }, blankLine()]), null);
});

test('the body skips empty lines and the draft total follows the discount', () => {
  const lines = [{ description: ' Pen ', quantity: '3', price: '10' }, { description: 'Delivery', quantity: '1', price: '50' }, blankLine()];
  assert.deepEqual(estimateBody(' Rahul ', '10', lines), { customer_name: 'Rahul', discount: 10, items: [{ description: 'Pen', quantity: 3, unit_price: 10 }, { description: 'Delivery', quantity: 1, unit_price: 50 }] });
  assert.equal(draftTotalPaise(lines, '10'), 7000);
  assert.equal(draftTotalPaise(lines, '9999'), 0);
});

test('the shared message lists the lines and total', () => {
  const e: Estimate = { estimate_id: 1, estimate_number: 'EST-0001', customer_name: 'Rahul', items: [{ description: 'Pen', quantity: 3, unit_price: 10 }], discount: 0, total: 30, notes: null, valid_until: '2026-12-01', status: 'OPEN', invoice_id: null };
  const text = estimateText(e, 'Sharma Stores');
  assert.match(text, /Sharma Stores - Estimate EST-0001/);
  assert.match(text, /1\. Pen/);
  assert.match(text, /Valid until: 2026-12-01/);
  assert.doesNotMatch(text, /Discount/);
});

test('a catalogue item fills an empty line, a second tap adds one more, and it is sent with its product', () => {
  const pen = productLine({ product_id: 7, name: 'Pen', selling_price: 10, tax_rate: 18 });
  let lines = addProduct([blankLine()], pen);
  assert.equal(lines.length, 1); assert.equal(lines[0].description, 'Pen'); assert.equal(lines[0].price, '10');
  lines = addProduct(lines, pen); assert.equal(lines.length, 1); assert.equal(lines[0].quantity, '2');
  lines = addProduct(lines, productLine({ product_id: 8, name: 'Ink', selling_price: 50, tax_rate: 5 })); assert.equal(lines.length, 2);
  assert.deepEqual(estimateBody('', '', lines).items[0], { product_id: 7, description: 'Pen', quantity: 2, unit_price: 10 });
  assert.equal(estimateBody('', '', [{ description: 'Fitting', quantity: '1', price: '100' }]).items[0].product_id, undefined);
});

test('the printed page: estimate or proforma, with GST only when there is some, and nothing typed is run as HTML', () => {
  const e: Estimate = { estimate_id: 1, estimate_number: 'EST-0001', customer_name: '<b>Asha</b>', items: [{ description: 'Bag', quantity: 2, unit_price: 100, tax_rate: 18 }], discount: 0, subtotal: 200, tax: 36, total: 236, notes: null, valid_until: null, status: 'OPEN', invoice_id: null };
  const biz = { name: 'Shop', gstin: '29ABCDE1234F1Z5' };
  const page = estimateHtml(e, biz);
  assert.match(page, /Estimate EST-0001/); assert.match(page, /GSTIN 29ABCDE1234F1Z5/); assert.match(page, /18%/); assert.match(page, /not a bill/);
  assert.ok(!page.includes('<b>Asha</b>') && page.includes('&lt;b&gt;Asha'));
  const pro = estimateHtml(e, biz, true);
  assert.match(pro, /Proforma invoice EST-0001/); assert.match(pro, /not a tax invoice/);
  assert.ok(!estimateHtml({ ...e, tax: 0 }, biz).includes('<th class="r">GST</th>'));
});
