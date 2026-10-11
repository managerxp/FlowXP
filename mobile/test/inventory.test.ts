/* Stock in plain words: status, counts, search, and the checks before a change. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustBody, adjustProblem, afterText, counts, statusOf, urgent, visible } from '../src/lib/inventory.ts';

const rows = [
  { name: 'Milk', current_stock: 12, low_stock: true }, { name: 'Coffee Beans', current_stock: 8, low_stock: false },
  { name: 'Sugar', current_stock: 0, low_stock: true }, { name: 'Cups', current_stock: -2, low_stock: true }
];

test('out, low or in stock; zero and below are out', () => {
  assert.deepEqual(rows.map(statusOf), ['low', 'in', 'out', 'out']);
  assert.deepEqual(counts(rows), { all: 4, out: 2, low: 1, in: 1 });
});

test('filtering and search; what needs buying comes first', () => {
  assert.deepEqual(visible(rows, 'out', '').map((r) => r.name), ['Sugar', 'Cups']);
  assert.deepEqual(visible(rows, 'all', ' mil ').map((r) => r.name), ['Milk']);
  assert.deepEqual(urgent(rows).map((r) => r.name), ['Cups', 'Sugar', 'Milk', 'Coffee Beans']);
});

test('a change is checked: add never takes away, adjust needs a reason', () => {
  assert.match(adjustProblem('add', '', ''), /how many came in/);
  assert.match(adjustProblem('add', '-2', ''), /use Adjust stock/);
  assert.equal(adjustProblem('add', '10', ''), '');
  assert.match(adjustProblem('adjust', '0', 'x'), /add \(like 10\)/);
  assert.match(adjustProblem('adjust', '-3', ' '), /why/);
  assert.equal(adjustProblem('adjust', '-3', 'Damaged'), '');
});

test('what is sent, and what the shelf will show', () => {
  assert.deepEqual(adjustBody(7, 'add', '10', ''), { product_id: 7, quantity: 10, reason: 'Stock received' });
  assert.deepEqual(adjustBody(7, 'adjust', '-3', ' Damaged '), { product_id: 7, quantity: -3, reason: 'Damaged' });
  assert.equal(afterText(12, '-3', 'packets'), 'Will be: 9 packets');
  assert.equal(afterText(2, '-5', 'kg'), 'Below zero: -3 kg');
  assert.equal(afterText(2, '', 'kg'), '');
});
