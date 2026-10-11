/* Moving guests around: which tables and orders are offered, what a split sends, and the booking time and guest checks. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { clockToday, freeTables, guestProblem, otherOrders, splitBody } from '../src/lib/floor.ts';
import type { Order, OrderItem, TableRow } from '../src/lib/orders.ts';

const table = (id: number, over: Partial<TableRow> = {}): TableRow => ({ table_id: id, name: `T${id}`, zone: null, seats: 4, status: 'FREE', open_order_id: null, open_order_number: null, open_order: null, waiter_name: null, next_reservation: null, ...over });
const order = (id: number, over: Partial<Order> = {}): Order => ({ order_id: id, order_number: `O${id}`, order_type: 'DINE_IN', table_id: id, table_name: `T${id}`, customer_id: null, customer_name: null, status: 'OPEN', notes: null, items: [], ...over });
const item = (id: number, quantity: number): OrderItem => ({ order_item_id: id, product_id: id, description: `Dish ${id}`, modifiers: [], quantity, unit_price: 100, line_total: 100 * quantity, kitchen_notes: null, status: 'PENDING', billed: false });

test('only a free table with nothing on it is offered, never the one the order is already at', () => {
  const tables = [table(1), table(2, { status: 'OCCUPIED', open_order_id: 9 }), table(3, { status: 'RESERVED' }), table(4, { status: 'CLOSED' }), table(5)];
  assert.deepEqual(freeTables(tables).map((t) => t.table_id), [1, 5]);
  assert.deepEqual(freeTables(tables, 1).map((t) => t.table_id), [5]);
});

test('only running dine-in orders at a table can be joined; not this one, not takeaway, not closed ones', () => {
  const all = [order(1), order(2), order(3, { order_type: 'TAKEAWAY', table_id: null }), order(4, { status: 'BILLED' }), order(5, { status: 'MERGED' })];
  assert.deepEqual(otherOrders(all, 1).map((o) => o.order_id), [2]);
});

test('a split sends the chosen lines, a part-quantity only when fewer than all, and where they go', () => {
  const lines = [item(1, 3), item(2, 1), item(3, 2)];
  assert.deepEqual(splitBody(lines, { 1: 2, 2: 1, 3: 0 }, { table_id: 7 }), { items: [{ order_item_id: 1, quantity: 2 }, { order_item_id: 2 }], table_id: 7 });
  assert.deepEqual(splitBody(lines, { 1: 99 }, { to_order_id: 4 }), { items: [{ order_item_id: 1 }], to_order_id: 4 }, 'more than there is means all of it');
  assert.deepEqual(splitBody(lines, {}, { table_id: 7 }).items, []);
});

test('a booking time is today only, in 24-hour form, and not already past', () => {
  const now = new Date(2026, 9, 8, 18, 0, 0);
  assert.equal(new Date(clockToday('19:30', now)!).getHours(), 19);
  assert.equal(clockToday('7.05', now), null, 'this morning has passed');
  assert.ok(clockToday('17:50', now), 'ten minutes late is still allowed');
  for (const bad of ['', 'six', '25:00', '19:60', '17:00', '1930']) assert.equal(clockToday(bad, now), null, bad);
});

test('a guest needs a name, a party of 1 to 100 and, if given, a 10-digit mobile number', () => {
  assert.equal(guestProblem('Aanya', '4', '9816202111'), '');
  assert.equal(guestProblem('Aanya', '4', ''), '');
  assert.match(guestProblem('', '4', ''), /name/);
  for (const p of ['0', '101', '2.5', 'x']) assert.match(guestProblem('A', p, ''), /Party size/, p);
  assert.match(guestProblem('A', '2', '12345'), /10-digit/);
});
