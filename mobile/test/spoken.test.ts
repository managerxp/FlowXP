import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spoken, type OrderItem } from '../src/lib/orders.ts';

const line = (id: number, over: Partial<OrderItem> = {}): OrderItem => ({ order_item_id: id, product_id: 1, description: 'Espresso', modifiers: [{ name: 'Small' }], quantity: 1, unit_price: 90, line_total: 90, kitchen_notes: null, status: 'PENDING', billed: false, ...over });

test('the same dish is read out once; a different size, note or kitchen state stays its own line', () => {
  const out = spoken([line(1), line(2), line(3, { modifiers: [{ name: 'Large' }] }), line(4, { kitchen_notes: 'no sugar' }), line(5, { status: 'SERVED' })]);
  assert.deepEqual(out.map((i) => [i.order_item_id, i.quantity, i.line_total]), [[1, 2, 180], [3, 1, 90], [4, 1, 90], [5, 1, 90]]);
});
