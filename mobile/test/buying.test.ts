/* Returns, expenses and receiving stock: what is sent, and what is checked before it is. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { expenseProblem, receiveBody, receiveProblem, receiveTotalPaise, returnBody, returnEstimatePaise, returnProblem, type ReceiveLine, type ReturnLine } from '../src/lib/buying.ts';

const L = (id: number, remaining: number, unit_total = 100): ReturnLine => ({ item_id: id, description: `Item ${id}`, quantity: remaining, remaining, unit_total, tax_rate: 5, tracks_stock: true });

test('a return sends only the chosen lines, never more than can still be returned, and the money choice', () => {
  const lines = [L(1, 3), L(2, 1), L(3, 2)];
  assert.deepEqual(returnBody(lines, { 1: 2, 2: 5, 3: 0 }, '  Damaged ', 'CASH', true), { reason: 'Damaged', items: [{ item_id: 1, quantity: 2 }, { item_id: 2, quantity: 1 }], refund: { method: 'CASH' }, restock: true });
  assert.equal('refund' in returnBody(lines, { 1: 1 }, 'x', 'NONE', false), false, 'no money back sends no refund');
});

test('the estimate is by what each unit cost, in paise, and ignores lines not chosen', () => {
  assert.equal(returnEstimatePaise([L(1, 3, 99.5), L(2, 1, 10)], { 1: 2 }), 19900);
});

test('a return needs an item and a reason', () => {
  const lines = [L(1, 1)];
  assert.match(returnProblem(lines, {}, 'x'), /at least one/);
  assert.match(returnProblem(lines, { 1: 1 }, '  '), /why/);
  assert.equal(returnProblem(lines, { 1: 1 }, 'Damaged'), '');
});

test('an expense needs a reason and an amount above zero', () => {
  assert.match(expenseProblem('', '5'), /what it was for/);
  for (const a of ['', '0', '-3', 'abc']) assert.match(expenseProblem('Rent', a), /amount/, a);
  assert.equal(expenseProblem('Rent', '1200'), '');
});

const R = (id: number, quantity: string, unit_cost = '10', expiry = ''): ReceiveLine => ({ product_id: id, name: `P${id}`, quantity, unit_cost, tax_rate: 5, expiry });

test('receiving stock sends lines with a quantity, a use-by date only when typed, the supplier, bill number and any payment', () => {
  const body = receiveBody([R(1, '4', '12.5', ' 2027-03-31 '), R(2, '0'), R(3, '')], 9, ' B-77 ', '50', 'CASH');
  assert.deepEqual(body, { supplier_id: 9, supplier_invoice_no: 'B-77', items: [{ product_id: 1, quantity: 4, unit_cost: 12.5, tax_rate: 5, expiry_date: '2027-03-31' }], payment: { amount: 50, method: 'CASH' } });
  assert.deepEqual(receiveBody([R(1, '1', '')], null, '', '', 'CASH'), { items: [{ product_id: 1, quantity: 1, unit_cost: 0, tax_rate: 5 }] }, 'no supplier, bill number or payment');
});

test('a delivery needs something that came, and costs that are numbers; the total is in paise', () => {
  assert.match(receiveProblem([R(1, '0')]), /at least one/);
  assert.match(receiveProblem([R(1, '2', 'x')]), /cost/);
  assert.equal(receiveProblem([R(1, '2', '')]), '');
  assert.equal(receiveTotalPaise([R(1, '3', '12.5'), R(2, '0', '99')]), 3750);
});
