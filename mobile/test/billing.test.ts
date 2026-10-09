/* Quicker billing: popular items, payment order, cash to tap. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bump, cashSuggestions, METHOD_ORDER, parseUsage, popular, trim } from '../src/lib/billing.ts';

test('the busiest items come first, the most recent breaks a tie', () => {
  let u = {};
  u = bump(u, 1, 100); u = bump(u, 2, 200); u = bump(u, 2, 300); u = bump(u, 3, 400);
  assert.deepEqual(popular(u), [2, 3, 1]);
  assert.deepEqual(popular(u, 1), [2]);
  assert.deepEqual(Object.keys(trim(u, 2)).sort(), ['2', '3']);
});

test('a damaged memory is just an empty one', () => {
  assert.deepEqual(parseUsage('{not json'), {});
  assert.deepEqual(parseUsage(null), {});
  assert.deepEqual(parseUsage('{"4":{"n":2,"t":1}}'), { '4': { n: 2, t: 1 } });
});

test('UPI comes first, then cash, then card', () => assert.deepEqual(METHOD_ORDER, ['UPI', 'CASH', 'CARD']));

test('cash to tap: the exact amount, then round notes above it', () => {
  assert.deepEqual(cashSuggestions(42000), [42000, 45000, 50000, 200000]);
  assert.deepEqual(cashSuggestions(50000), [50000, 200000]);
  assert.deepEqual(cashSuggestions(0), []);
  assert.equal(cashSuggestions(12345)[0], 12345);
});

import { cartSummary, orderSummary } from '../src/lib/billing.ts';
const product = (id: number, name: string, price: number, tax: number) => ({ product_id: id, name, selling_price: price, tax_rate: tax } as never);

test('the pay screen lists the till bill: lines, offers off before GST, totals', () => {
  const cart = { lines: [
    { key: 'a', product: product(1, 'Cappuccino', 120, 5), quantity: 2, modifierIds: [], modifierNames: ['Large'], deltaPaise: 1000 },
    { key: 'b', product: product(2, 'Burger', 180, 5), quantity: 1, modifierIds: [], modifierNames: [], deltaPaise: 0 }
  ] };
  const s = cartSummary(cart, new Map([['b', 1800]]));
  assert.deepEqual(s.rows, [{ name: 'Cappuccino (Large)', qty: 2, paise: 26000 }, { name: 'Burger', qty: 1, paise: 18000 }]);
  assert.equal(s.items, 3); assert.equal(s.subtotalPaise, 44000); assert.equal(s.offersPaise, 1800);
  assert.equal(s.taxPaise, 1300 + 810); assert.equal(s.totalPaise, 44000 - 1800 + 2110);
});

test('the pay screen lists a table\'s order: only what is not yet billed or cancelled', () => {
  const o = { order_id: 1, order_number: 'ORD-1', order_type: 'DINE_IN', table_id: 5, table_name: 'T5', customer_id: null, customer_name: null, status: 'OPEN', notes: null, items: [
    { order_item_id: 1, product_id: 1, description: 'Burger', modifiers: [{ name: 'Cheese' }], quantity: 2, unit_price: 100, line_total: 200, tax_rate: 5, kitchen_notes: null, status: 'SERVED', billed: false },
    { order_item_id: 2, product_id: 2, description: 'Tea', modifiers: [], quantity: 1, unit_price: 20, line_total: 20, tax_rate: 5, kitchen_notes: null, status: 'CANCELLED', billed: false },
    { order_item_id: 3, product_id: 3, description: 'Fries', modifiers: [], quantity: 1, unit_price: 50, line_total: 50, tax_rate: 5, kitchen_notes: null, status: 'SERVED', billed: true }
  ] };
  const s = orderSummary(o as never);
  assert.deepEqual(s.rows, [{ name: 'Burger (Cheese)', qty: 2, paise: 20000 }]);
  assert.equal(s.items, 2); assert.equal(s.subtotalPaise, 20000); assert.equal(s.taxPaise, 1000); assert.equal(s.totalPaise, 21000);
});
