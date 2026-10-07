/* Held bills (on the server, and on the phone with no signal) and table orders (the floor, the order, its sums). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { SCHEMA as OUTBOX_SCHEMA } from '../src/lib/outbox.ts';
import { SCHEMA as HELD_SCHEMA, createHeld, estimateOf, fromSnapshot, holdBill, toSnapshot } from '../src/lib/held.ts';
import { addProduct, emptyCart, lineName } from '../src/lib/cart.ts';
import { picked, type Group } from '../src/lib/options.ts';
import { ApiError } from '../src/lib/api.ts';
import { byZone, liveItems, orderTotals, tableState, type Order, type OrderItem, type TableRow } from '../src/lib/orders.ts';
import { fakeServer, nodeDb, P } from './helpers.ts';

const SIZE: Group = { group_id: 1, name: 'Size', is_variant: true, min_select: 1, max_select: 1, modifiers: [{ modifier_id: 11, name: 'Small', price_delta: 0 }, { modifier_id: 13, name: 'Large', price_delta: 40 }] };
const latte = P(1, 'Cafe Latte', 160, { modifier_group_ids: [1], tax_rate: 5 });
const muffin = P(2, 'Blueberry Muffin', 110, { tax_rate: 5 });

const open = async () => {
  const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(OUTBOX_SCHEMA); await db.exec(HELD_SCHEMA);
  return { db, catalog: createCatalog(db), held: createHeld(db) };
};

/* ── held bills ─────────────────────────────────────────────────────────── */

test('a held bill is saved in the same shape the website till uses, options and customer included', () => {
  const cart = addProduct(addProduct(emptyCart(), latte, 2, picked([SIZE], { 1: [13] })), muffin);
  const snap = toSnapshot(cart, { id: 257, name: 'Aanya' });
  assert.deepEqual(snap.lines[0], { product_id: 1, custom: false, name: 'Cafe Latte (Large)', unit: 'pc', unit_price: 200, quantity: 2, discount: 0, tax_rate: 5, modifier_ids: [13], sig: '13', track_inventory: false, current_stock: 0 });
  assert.deepEqual([snap.lines[1].product_id, snap.lines[1].modifier_ids, snap.lines[1].sig], [2, [], '']);
  assert.deepEqual([snap.customer_id, snap.customer_name, snap.discount, snap.coupon_code], [257, 'Aanya', 0, null]);
  assert.equal(estimateOf(cart), (2 * 200 + 110) * 1.05);
  assert.equal(toSnapshot(cart, null).customer_id, null);
});

test('resuming puts the lines back from the phone\'s menu; a custom item, a removed product or changed options are named, not lost silently', async () => {
  const server = fakeServer([latte, muffin]); server.state.groups = [SIZE];
  const { catalog } = await open(); await catalog.sync(server.api);
  const bill = toSnapshot(addProduct(addProduct(emptyCart(), latte, 2, picked([SIZE], { 1: [13] })), muffin), { id: 257, name: 'Aanya' });
  bill.lines.push({ ...bill.lines[1], product_id: null, custom: true, name: 'Birthday candle' });
  bill.lines.push({ ...bill.lines[1], product_id: 999, name: 'Old special' });
  bill.lines.push({ ...bill.lines[0], modifier_ids: [77], name: 'Cafe Latte (Jumbo)' });
  const r = await fromSnapshot(bill, (id) => catalog.byId(id), (p) => catalog.groupsFor(p));
  assert.deepEqual(r.cart.lines.map((l) => [lineName(l), l.quantity]), [['Cafe Latte (Large)', 2], ['Blueberry Muffin', 1]]);
  assert.deepEqual(r.customer, { id: 257, name: 'Aanya' });
  assert.equal(r.skipped.length, 3); assert.ok(r.skipped[0].includes('Birthday candle') && r.skipped[1].includes('Old special') && r.skipped[2].includes('options have changed'));
  assert.equal((await fromSnapshot({ ...bill, customer_id: null, lines: [] }, (id) => catalog.byId(id), (p) => catalog.groupsFor(p))).customer, null);
});

test('hold goes to the server when it can be reached, to the phone when it cannot, and a refusal is shown rather than hidden', async () => {
  const { held } = await open(); const server = fakeServer([]);
  const bill = toSnapshot(addProduct(emptyCart(), muffin, 3), null);
  assert.equal(await holdBill({ api: server.api, held, bill, label: 'Table 4', estimate: 346.5 }), 'server');
  assert.deepEqual([server.state.held.length, server.state.held[0].label, server.state.held[0].item_count, await held.count()], [1, 'Table 4', 3, 0]);
  server.state.down = true;
  assert.equal(await holdBill({ api: server.api, held, bill, label: null, estimate: 100 }), 'phone');
  assert.equal(await held.count(), 1);
  server.state.down = false; server.state.heldFull = true;
  await assert.rejects(holdBill({ api: server.api, held, bill, label: null, estimate: 1 }), (e) => e instanceof ApiError && /50 bills/.test(e.message));
  assert.equal(await held.count(), 1, 'a refusal is not quietly kept on the phone');
});

test('held on the phone: listed in order, taken back once, and gone when taken', async () => {
  const { held } = await open();
  const bill = toSnapshot(addProduct(emptyCart(), muffin, 2), null);
  await held.hold(bill, 'First', 231); await held.hold(bill, null, 100);
  const list = await held.list();
  assert.deepEqual(list.map((h) => [h.label, h.item_count, h.estimate, h.local]), [['First', 2, 231, true], [null, 2, 100, true]]);
  const taken = await held.take(String(list[0].hold_id));
  assert.equal(taken!.label, 'First'); assert.equal(taken!.bill.lines[0].product_id, 2);
  assert.equal(await held.take(String(list[0].hold_id)), null, 'already taken');
  assert.equal(await held.count(), 1);
});

test('resuming from the server removes it first, so two tills cannot both resume the same bill', async () => {
  const server = fakeServer([]); const bill = toSnapshot(addProduct(emptyCart(), muffin), null);
  await server.api.post('/held-bills', { bill, estimate: 115.5 });
  const id = server.state.held[0].hold_id;
  assert.equal((await server.api.call(`/held-bills/${id}`, { method: 'DELETE' })).success, true);
  await assert.rejects(server.api.call(`/held-bills/${id}`, { method: 'DELETE' }), (e) => e instanceof ApiError && e.status === 404 && /resumed it/.test(e.message));
});

/* ── tables and orders ──────────────────────────────────────────────────── */

const table = (over: Partial<TableRow> = {}): TableRow => ({ table_id: 1, name: 'T1', zone: null, seats: 4, status: 'FREE', open_order_id: null, open_order_number: null, open_order: null, waiter_name: null, next_reservation: null, ...over });
const summary = (over = {}) => ({ opened_at: '2026-10-07T10:00:00Z', items: 3, estimate: 400, not_sent: 0, cooking: 0, ready: 0, ...over });

test('a table looks free, booked, open, cooking, ready or served from what the kitchen has done', () => {
  assert.equal(tableState(table()), 'free');
  assert.equal(tableState(table({ next_reservation: { reserved_at: 'x', guest_name: 'Rao', party_size: 4 } })), 'reserved');
  assert.equal(tableState(table({ open_order_id: 5, open_order: summary({ items: 0 }) })), 'new', 'opened, nothing on it yet');
  assert.equal(tableState(table({ open_order_id: 5, open_order: summary({ not_sent: 2 }) })), 'new');
  assert.equal(tableState(table({ open_order_id: 5, open_order: summary({ cooking: 2 }) })), 'cooking');
  assert.equal(tableState(table({ open_order_id: 5, open_order: summary({ cooking: 1, ready: 1 }) })), 'ready', 'something to carry out wins');
  assert.equal(tableState(table({ open_order_id: 5, open_order: summary() })), 'served');
});

test('the floor groups tables by zone, with the unzoned ones first', () => {
  const groups = byZone([table({ table_id: 1, name: 'T1', zone: 'Terrace' }), table({ table_id: 2, name: 'T2', zone: null }), table({ table_id: 3, name: 'T3', zone: 'Indoor' }), table({ table_id: 4, name: 'T4', zone: 'Terrace' })]);
  assert.deepEqual(groups.map((g) => [g.zone, g.tables.map((t) => t.name)]), [['', ['T2']], ['Indoor', ['T3']], ['Terrace', ['T1', 'T4']]]);
});

const item = (over: Partial<OrderItem> = {}): OrderItem => ({ order_item_id: 1, product_id: 1, description: 'Latte', modifiers: [], quantity: 1, unit_price: 100, line_total: 100, tax_rate: 5, kitchen_notes: null, status: 'PENDING', billed: false, ...over });
const orderOf = (items: OrderItem[]): Order => ({ order_id: 9, order_number: 'ORD-0009', order_type: 'DINE_IN', table_id: 1, table_name: 'T1', customer_id: null, customer_name: null, status: 'OPEN', notes: null, items });

test('the order total counts what is still to bill: not cancelled, not already on an invoice; GST per line; not-sent and ready are counted', () => {
  const o = orderOf([
    item({ order_item_id: 1, quantity: 2, unit_price: 100 }),                                  // 200 + 10
    item({ order_item_id: 2, quantity: 1, unit_price: 50, tax_rate: 12, status: 'READY' }),    // 50 + 6
    item({ order_item_id: 3, quantity: 5, unit_price: 99, status: 'CANCELLED' }),              // not counted
    item({ order_item_id: 4, quantity: 1, unit_price: 80, billed: true, status: 'SERVED' }),   // already billed
    item({ order_item_id: 5, quantity: 1, unit_price: 40, tax_rate: undefined, status: 'PREPARING' })  // no tax rate sent: 0%
  ]);
  assert.deepEqual(liveItems(o).map((i) => i.order_item_id), [1, 2, 5]);
  assert.deepEqual(orderTotals(o), { lines: 3, items: 4, subtotalPaise: 29000, taxPaise: 1600, totalPaise: 30600, notSent: 1, ready: 1 });
  assert.deepEqual(orderTotals(orderOf([])), { lines: 0, items: 0, subtotalPaise: 0, taxPaise: 0, totalPaise: 0, notSent: 0, ready: 0 });
});
