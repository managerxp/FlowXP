/* Moving stock between warehouses: what is checked, what is sent, and what receiving does with short and damaged goods. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { addTLine, dropTLine, receiveBody, receiveProblem, receiveSummary, setDamaged, setGood, setTQty, shortBy, startReceive, transferActions, transferBody, transferProblem, type TItem } from '../src/lib/transfers.ts';
import type { WProduct } from '../src/lib/wholesale.ts';

const atta = { product_id: 7, name: 'Atta', unit: 'bag', units: [{ unit_name: 'carton', factor: 10, barcode: null }] } as unknown as WProduct;
const item = (id: number, qty: number): TItem => ({ item_id: id, product_id: id, product: `P${id}`, unit: 'pcs', qty_base: qty, received_base: 0, damaged_base: 0, batches: [] });

test('a transfer needs two different warehouses and something to move', () => {
  const lines = addTLine([], atta);
  assert.equal(transferProblem(null, 2, lines), 'Choose the warehouse the goods leave from');
  assert.equal(transferProblem(1, null, lines), 'Choose the warehouse they go to');
  assert.equal(transferProblem(1, 1, lines), 'Choose two different warehouses');
  assert.equal(transferProblem(1, 2, []), 'Add the items and how many');
  assert.equal(transferProblem(1, 2, setTQty(lines, 7, '0')), 'Add the items and how many');
  assert.equal(transferProblem(1, 2, lines), '');
  assert.equal(addTLine(lines, atta).length, 1, 'the same item is not added twice');
  assert.equal(dropTLine(lines, 7).length, 0);
});

test('what is sent', () => {
  const lines = setTQty(addTLine([], atta), 7, '4');
  assert.deepEqual(transferBody(1, 2, lines), { from_branch_id: 1, to_branch_id: 2, items: [{ product_id: 7, quantity: 4 }] });
  assert.deepEqual(transferBody(1, 2, lines, { vehicle: ' MH12AB1234 ', notes: 'n', sendNow: true }), { from_branch_id: 1, to_branch_id: 2, items: [{ product_id: 7, quantity: 4 }], vehicle_no: 'MH12AB1234', notes: 'n', dispatch: true });
});

test('actions follow where the transfer is', () => {
  assert.deepEqual(transferActions({ status: 'DRAFT' }).map((a) => a.id), ['send', 'cancel']);
  assert.deepEqual(transferActions({ status: 'IN_TRANSIT' }).map((a) => a.id), ['receive', 'cancel']);
  assert.deepEqual(transferActions({ status: 'RECEIVED' }), []);
});

test('receiving starts as everything good; short and damaged are worked out', () => {
  let r = startReceive([item(1, 10), item(2, 5)]);
  assert.equal(receiveProblem(r), '');
  assert.equal(receiveSummary(r), 'Everything arrived in good condition.');
  r = setDamaged(setGood(r, 1, '7'), 1, '2');
  assert.equal(shortBy(r[0]), 1);
  assert.match(receiveSummary(r), /1 item is short, 1 item has damaged goods/);
  assert.deepEqual(receiveBody(r), { items: [{ item_id: 1, received_base: 7, damaged_base: 2 }, { item_id: 2, received_base: 5, damaged_base: 0 }] });
  assert.match(receiveProblem(setGood(r, 2, '6')), /more than the 5 that was sent/);
});
