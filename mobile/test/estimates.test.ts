import test from 'node:test';
import assert from 'node:assert/strict';
import { blankLine, draftTotalPaise, estimateBody, estimateProblem, estimateText, type Estimate } from '../src/lib/estimates.ts';

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
