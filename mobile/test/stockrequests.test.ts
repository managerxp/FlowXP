import test from 'node:test';
import assert from 'node:assert/strict';
import { addAsk, askBody, askProblem, dropAsk, isOpen, sendBody, setAskQty, type StockRequest } from '../src/lib/stockRequests.ts';

const req: StockRequest = { request_id: 1, status: 'PARTIAL', notes: null, decision_note: null, created_at: '2026-11-10', from_branch_id: 2, from_name: 'MG Road', to_branch_id: 3, to_name: 'Indiranagar',
  items: [{ item_id: 10, product_id: 5, name: 'Rice', unit: 'kg', requested: 20, sent: 5, remaining: 15 }, { item_id: 11, product_id: 6, name: 'Oil', unit: 'l', requested: 4, sent: 0, remaining: 4 }] };

test('a request needs an outlet and at least one amount; the body carries only lines with an amount', () => {
  assert.match(askProblem(null, []), /outlet/);
  const lines = addAsk(addAsk([], { product_id: 5, name: 'Rice', unit: 'kg' }), { product_id: 5, name: 'Rice', unit: 'kg' });
  assert.equal(lines.length, 1, 'the same item is not added twice');
  assert.match(askProblem(2, lines), /how much/);
  const filled = setAskQty(addAsk(lines, { product_id: 6, name: 'Oil', unit: 'l' }), 5, '12.5kg');
  assert.equal(askProblem(2, filled), '');
  assert.deepEqual(askBody(2, filled, ' for the weekend '), { from_branch_id: 2, notes: 'for the weekend', items: [{ product_id: 5, quantity: 12.5 }] });
  assert.equal(dropAsk(filled, 5).length, 1);
});

test('sending defaults to everything still owed, never more than that, and leaves out zeros', () => {
  assert.deepEqual(sendBody(req, {}).items, [{ item_id: 10, quantity: 15 }, { item_id: 11, quantity: 4 }]);
  assert.deepEqual(sendBody(req, { 10: '99', 11: '0' }).items, [{ item_id: 10, quantity: 15 }]);
  assert.deepEqual(sendBody(req, { 10: '6' }).items[0], { item_id: 10, quantity: 6 });
  assert.equal(isOpen(req), true); assert.equal(isOpen({ status: 'FULFILLED' }), false);
});
