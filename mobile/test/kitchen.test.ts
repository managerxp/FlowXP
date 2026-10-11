/* The kitchen display's logic: urgency, the three columns per station, cancelled dishes, "cook now", the strip across the top, and the alerts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { alertFor, cookNow, dishKey, dueText, homeOf, inStation, itemsIn, minutesSince, sortTickets, span, statsOf, ticketTitle, urgencyOf, type KItem, type KTicket, type KitchenData } from '../src/lib/kitchen.ts';

const NOW = Date.parse('2026-10-07T10:30:00Z');
const ago = (min: number) => new Date(NOW - min * 60000).toISOString();
let seq = 0;
const item = (over: Partial<KItem> = {}): KItem => ({
  order_item_id: ++seq, description: 'Cafe Latte', quantity: 1, modifiers: [], kitchen_notes: null, status: 'PREPARING', station_id: 1, expected_minutes: 10,
  sent_at: ago(2), ready_at: null, served_at: null, cancelled: false, ...over
});
const ticket = (id: number, items: KItem[], over: Partial<KTicket> = {}): KTicket => ({
  order_id: id, order_number: `ORD-${String(id).padStart(4, '0')}`, order_type: 'DINE_IN', platform: null, table_name: `T${id}`, brand_name: null, priority: 'NORMAL', sent_at: ago(2), items, ...over
});

/* ── time and urgency ───────────────────────────────────────────────────── */

test('a dish is on time, nearly due at three quarters of its time, and late past it', () => {
  assert.equal(urgencyOf(0, 10), 'ok'); assert.equal(urgencyOf(7, 10), 'ok'); assert.equal(urgencyOf(8, 10), 'warning');
  assert.equal(urgencyOf(10, 10), 'warning', 'exactly on time is not yet late'); assert.equal(urgencyOf(11, 10), 'late');
  assert.equal(urgencyOf(90, null), 'ok', 'a dish with no expected time is never late'); assert.equal(urgencyOf(5, 0), 'ok');
});

test('the time left reads like a person: minutes left, due now, how far over', () => {
  assert.equal(dueText(4, 10), '6m left'); assert.equal(dueText(10, 10), 'Due now'); assert.equal(dueText(13, 10), '3m over'); assert.equal(dueText(75, 10), '1h 5m over');
  assert.equal(dueText(4, null), null); assert.equal(span(59), '59m'); assert.equal(span(60), '1h 0m'); assert.equal(span(125), '2h 5m');
  assert.equal(minutesSince(ago(7), NOW), 7); assert.equal(minutesSince(ago(-3), NOW), 0, 'a clock slightly ahead is never negative');
});

/* ── columns and stations ───────────────────────────────────────────────── */

test('tickets sort into To make, Ready and Served; a ticket can be in two at once', () => {
  const a = ticket(1, [item({ status: 'PREPARING' }), item({ status: 'READY', ready_at: ago(1) })]);
  const b = ticket(2, [item({ status: 'READY', ready_at: ago(3) })]);
  const c = ticket(3, [item({ status: 'SERVED', served_at: ago(10) })]);
  const s = sortTickets({ stations: [], tickets: [a, b, c] }, 'all');
  assert.deepEqual([s.making.map((t) => t.order_id), s.ready.map((t) => t.order_id), s.served.map((t) => t.order_id)], [[1], [1, 2], [3]]);
  assert.deepEqual(sortTickets(null, 'all'), { making: [], ready: [], served: [] });
});

test('a station sees only its own dishes, and a ticket with none of them disappears from that station', () => {
  const t1 = ticket(1, [item({ station_id: 1, description: 'Latte' }), item({ station_id: 2, description: 'Muffin' })]);
  const t2 = ticket(2, [item({ station_id: 2, description: 'Toast' })]);
  const t3 = ticket(3, [item({ station_id: null, description: 'Water' })]);
  const data: KitchenData = { stations: [], tickets: [t1, t2, t3] };
  assert.deepEqual(sortTickets(data, '1').making.map((t) => [t.order_id, t.items.map((i) => i.description)]), [[1, ['Latte']]]);
  assert.deepEqual(sortTickets(data, '2').making.map((t) => [t.order_id, t.items.map((i) => i.description)]), [[1, ['Muffin']], [2, ['Toast']]]);
  assert.deepEqual(sortTickets(data, 'none').making.map((t) => t.order_id), [3], 'dishes with no station');
  assert.equal(inStation(item({ station_id: 2 }), 'all'), true); assert.equal(inStation(item({ station_id: 2 }), '1'), false);
});

test('a cancelled dish stays with its own ticket: with To make while something there still cooks, else with Ready, else as a notice', () => {
  const cooking = ticket(1, [item({ status: 'PREPARING' }), item({ status: 'CANCELLED', cancelled: true })]);
  const carrying = ticket(2, [item({ status: 'READY' }), item({ status: 'CANCELLED', cancelled: true })]);
  const onlyCancelled = ticket(3, [item({ status: 'CANCELLED', cancelled: true })]);
  assert.equal(homeOf(cooking), 'making'); assert.equal(homeOf(carrying), 'ready'); assert.equal(homeOf(onlyCancelled), 'making');
  assert.equal(itemsIn(cooking, 'making').length, 2); assert.equal(itemsIn(carrying, 'ready').length, 2); assert.equal(itemsIn(carrying, 'making').length, 0);
  const s = sortTickets({ stations: [], tickets: [onlyCancelled, cooking] }, 'all');
  assert.deepEqual(s.making.map((t) => t.order_id), [1, 3], 'a notice with nothing left to cook goes last');
  const gone = new Set([onlyCancelled.items[0].order_item_id]);
  assert.deepEqual(sortTickets({ stations: [], tickets: [onlyCancelled, cooking] }, 'all', gone).making.map((t) => t.order_id), [1], '"Got it" hides the notice');
});

test('tickets keep the order the server sent: rush first, then oldest', () => {
  const rush = ticket(2, [item()], { priority: 'RUSH' }); const old = ticket(1, [item({ sent_at: ago(9) })]); const fresh = ticket(3, [item()]);
  assert.deepEqual(sortTickets({ stations: [], tickets: [rush, old, fresh] }, 'all').making.map((t) => t.order_id), [2, 1, 3]);
});

/* ── cook now, the strip, ticket titles ─────────────────────────────────── */

test('"cook now" adds up the same dish across tickets, counts late ones, and lists the biggest first', () => {
  const lat = (id: number, q: number, sent: number, mods: string[] = []) => ticket(id, [item({ description: 'Cafe Latte', quantity: q, sent_at: ago(sent), modifiers: mods.map((name) => ({ name })) })]);
  const rows = cookNow([lat(1, 2, 3), lat(2, 1, 14), lat(3, 4, 1, ['Oat']), ticket(4, [item({ description: 'Muffin', quantity: 1 }), item({ description: 'Done', status: 'READY' })])], NOW);
  assert.deepEqual(rows.map((r) => [r.name, r.extra, r.qty, r.tickets, r.late]), [['Cafe Latte', 'Oat', 4, 1, 0], ['Cafe Latte', '', 3, 2, 1], ['Muffin', '', 1, 1, 0]]);
  assert.equal(dishKey({ description: 'Latte', modifiers: [{ name: 'Oat' }, { name: 'Large' }] }), 'Latte|Oat · Large');
  assert.deepEqual(cookNow([], NOW), []);
});

test('the strip: tickets and dishes to make, late tickets, the oldest, and the longest a ready dish has waited', () => {
  const t1 = ticket(1, [item({ quantity: 2, sent_at: ago(4) })]); const t2 = ticket(2, [item({ quantity: 1, sent_at: ago(14), expected_minutes: 10 })]);
  const t3 = ticket(3, [item({ status: 'READY', sent_at: ago(20), ready_at: ago(6) })]);
  const st = statsOf(sortTickets({ stations: [], tickets: [t1, t2, t3] }, 'all'), NOW);
  assert.deepEqual(st, { tickets: 2, dishes: 3, lateTickets: 1, oldest: 14, readyTickets: 1, longestWait: 6 });
  assert.deepEqual(statsOf(sortTickets(null, 'all'), NOW), { tickets: 0, dishes: 0, lateTickets: 0, oldest: 0, readyTickets: 0, longestWait: 0 });
});

test('a ticket is titled by its table, or Takeaway, or the delivery platform', () => {
  assert.equal(ticketTitle(ticket(1, [], { table_name: 'T4' })), 'T4');
  assert.equal(ticketTitle(ticket(2, [], { table_name: null, order_type: 'TAKEAWAY' })), 'Takeaway');
  assert.equal(ticketTitle(ticket(3, [], { table_name: null, order_type: 'DELIVERY', platform: 'ZOMATO' })), 'ZOMATO');
  assert.equal(ticketTitle(ticket(4, [], { table_name: null, order_type: 'DELIVERY', platform: null })), 'Delivery');
});

/* ── the buzz ───────────────────────────────────────────────────────────── */

test('the first look is not news; a new dish buzzes once; a dish that has just gone late buzzes differently; a quiet poll is silent', () => {
  const a = item({ sent_at: ago(2) });
  const first = alertFor(null, { stations: [], tickets: [ticket(1, [a])] }, NOW);
  assert.equal(first.alert, null);
  const quiet = alertFor(first.seen, { stations: [], tickets: [ticket(1, [a])] }, NOW);
  assert.equal(quiet.alert, null);
  const b = item({ sent_at: ago(1) });
  const added = alertFor(quiet.seen, { stations: [], tickets: [ticket(1, [a]), ticket(2, [b])] }, NOW);
  assert.equal(added.alert, 'new');
  const later = NOW + 12 * 60000;                                    // 12 minutes on, the first dish (10 min) is now late
  const late = alertFor(added.seen, { stations: [], tickets: [ticket(1, [a]), ticket(2, [b])] }, later);
  assert.equal(late.alert, 'late');
  assert.equal(alertFor(late.seen, { stations: [], tickets: [ticket(1, [a]), ticket(2, [b])] }, later + 60000).alert, null, 'told once');
  const served = alertFor(late.seen, { stations: [], tickets: [ticket(1, [{ ...a, status: 'SERVED' }])] }, later);
  assert.equal(served.alert, null, 'a dish going away is not an alert');
});
