/* The distributor items: planning the day, offers offline, and where a visit was. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOrder, dueText, followUps, move, parseOrder, planDays, suggest, type Stop } from '../src/lib/route.ts';
import { hints, keptText, live, parseKept, type Scheme } from '../src/lib/schemeHints.ts';
import { visitBody } from '../src/lib/field.ts';
import type { FLine } from '../src/lib/field.ts';

const stop = (id: number, seq: number, o: Partial<Stop> = {}): Stop => ({ seq, customer_id: id, name: `S${id}`, phone: null, address: null, contact_person: null, city: null, last_order: '2026-09-01', outstanding: 0, overdue: 0, credit_limit: 0, visit_id: null, visit_outcome: null, visited: false, beat_id: 1, beat: 'North', ...o });

test('the days to plan: today, tomorrow, then the next five', () => {
  const d = planDays(new Date(2026, 9, 8));
  assert.equal(d.length, 7); assert.deepEqual(d.slice(0, 2), [{ id: '2026-10-08', label: 'Today' }, { id: '2026-10-09', label: 'Tomorrow' }]); assert.equal(d[6].id, '2026-10-14');
});

test('a suggested order: not yet visited first, overdue money first, longest since an order, then the beat order', () => {
  const stops = [stop(1, 1, { visited: true }), stop(2, 2), stop(3, 3, { overdue: 500 }), stop(4, 4, { last_order: '2026-08-01' }), stop(5, 5, { overdue: 900 })];
  assert.deepEqual(suggest(stops).map((s) => s.customer_id), [5, 3, 4, 2, 1]);
  assert.deepEqual(suggest(stops, new Set([5])).map((s) => s.customer_id), [3, 4, 2, 5, 1], 'a shop already visited from this phone goes to the end');
});

test('the order the rep chose is kept; shops added since come last; moving a stop', () => {
  const stops = [stop(1, 1), stop(2, 2), stop(3, 3), stop(4, 4)];
  assert.deepEqual(applyOrder(stops, [3, 1, 2]).map((s) => s.customer_id), [3, 1, 2, 4]);
  assert.equal(applyOrder(stops, null), stops);
  assert.deepEqual(move([1, 2, 3], 2, -1), [2, 1, 3]); assert.deepEqual(move([1, 2, 3], 1, -1), [1, 2, 3]); assert.deepEqual(move([1, 2, 3], 3, 1), [1, 2, 3]);
  assert.deepEqual(parseOrder('[3,1]'), [3, 1]); assert.equal(parseOrder('{bad'), null); assert.equal(parseOrder('["a"]'), null);
});

test('follow-ups: told to come back, not on the route, not visited since', () => {
  const v = (id: number, date: string, next: string | null) => ({ customer_id: id, customer: `C${id}`, visit_date: date, outcome: 'FOLLOW_UP' as const, next_visit_date: next });
  const visits = [v(1, '2026-10-01', '2026-10-05'), v(1, '2026-09-20', '2026-09-25'), v(2, '2026-10-02', '2026-10-08'), v(3, '2026-10-03', '2026-10-20'), v(4, '2026-10-02', '2026-10-06'), v(5, '2026-10-02', null)];
  const out = followUps(visits, '2026-10-08', new Set([2]), new Map([[4, '2026-10-07']]));
  assert.deepEqual(out.map((x) => x.customer_id), [1], 'C2 is on the route, C3 is later, C4 was visited since, C5 had no date');
  assert.equal(dueText('2026-10-08', '2026-10-08'), 'due today'); assert.equal(dueText('2026-10-07', '2026-10-08'), '1 day late'); assert.equal(dueText('2026-10-03', '2026-10-08'), '5 days late');
});

const scheme = (o: Partial<Scheme>): Scheme => ({ scheme_id: 1, name: 'Parle', kind: 'BUY_X_GET_Y', description: 'Buy 10 carton of Parle-G, get 1 carton free', buy_product_id: 7, buy_brand_id: null, buy_category_id: null, buy_scope: 'PRODUCT', buy_unit_name: 'carton', buy_min_qty: 10, min_value: null, free_qty: 1, free_unit_name: 'carton', repeat: true, discount_pct: null, discount: null, days_left: 5, status: 'ACTIVE', ends_on: null, ...o });
const line = (qty: string, unit: string | null): FLine => ({ key: 'a', product: { product_id: 7, name: 'Parle-G', wholesale: { units: [{ unit_name: 'carton', factor: 48 }] } } as never, unit_name: unit, quantity: qty });

test('offers that have ended are dropped from a kept list', () => {
  const list = [scheme({}), scheme({ scheme_id: 2, ends_on: '2026-10-01' }), scheme({ scheme_id: 3, status: 'EXPIRED' }), scheme({ scheme_id: 4, starts_on: '2026-10-20' })];
  assert.deepEqual(live(list, '2026-10-08').map((s) => s.scheme_id), [1]);
});

test('how far an order is from an offer, counted in the offer\'s own unit', () => {
  assert.match(hints([scheme({})], [], '2026-10-08')[0].text, /Add 10 carton more to get it/);
  assert.match(hints([scheme({})], [line('6', 'carton')], '2026-10-08')[0].text, /Add 4 carton more/);
  assert.match(hints([scheme({})], [line('240', null)], '2026-10-08')[0].text, /Add 5 carton more/, '240 pieces is 5 cartons of 48');
  const reached = hints([scheme({})], [line('10', 'carton')], '2026-10-08')[0];
  assert.equal(reached.reached, true); assert.match(reached.text, /This order qualifies/);
  assert.equal(hints([scheme({ buy_scope: 'BRAND', buy_product_id: null })], [], '2026-10-08')[0].text, 'Buy 10 carton of Parle-G, get 1 carton free', 'a brand offer is shown as it is: the phone cannot count it');
});

test('a kept list, damaged or fresh; and when it was kept', () => {
  assert.equal(parseKept('{bad'), null); assert.equal(parseKept('{"at":1}'), null);
  assert.equal(parseKept('{"at":5,"schemes":[]}')?.at, 5);
  const now = 10_000_000;
  assert.deepEqual([now, now - 5 * 60000, now - 3 * 3600000, now - 2 * 86400000].map((a) => keptText(a, now)), ['just now', '5 min ago', '3 h ago', '2 days ago']);
});

test('a visit carries where it was only when there is somewhere to say', () => {
  const base = { customerId: 4, outcome: 'ORDER' as const, ref: 'r1' };
  assert.deepEqual(visitBody(base), { customer_id: 4, outcome: 'ORDER', client_ref: 'r1' });
  assert.deepEqual(visitBody({ ...base, where: { lat: 17.385, lng: 78.4867 } }), { customer_id: 4, outcome: 'ORDER', client_ref: 'r1', lat: 17.385, lng: 78.4867 });
  assert.deepEqual(visitBody({ ...base, where: null }), { customer_id: 4, outcome: 'ORDER', client_ref: 'r1' });
});

import { freshEnough, place, settingOn, withinMs } from '../src/lib/spot.ts';
test('where a visit was: recent enough, sensible, and only when the business said yes', async () => {
  assert.equal(freshEnough(1000, 1000 + 119000), true); assert.equal(freshEnough(1000, 1000 + 121000), false); assert.equal(freshEnough(5000, 1000), false);
  assert.deepEqual(place(17.38504712, 78.48667), { lat: 17.385047, lng: 78.48667 });
  assert.equal(place(91, 10), null); assert.equal(place(10, 181), null); assert.equal(place(NaN, 1), null);
  assert.equal(settingOn('1'), true); assert.equal(settingOn('0'), false); assert.equal(settingOn(null), false, 'unknown means no');
  assert.equal(await withinMs(new Promise((r) => setTimeout(() => r('late'), 50)), 5), null, 'gives up rather than keep a rep waiting');
  assert.equal(await withinMs(Promise.resolve('fast'), 50), 'fast');
  assert.equal(await withinMs(Promise.reject(new Error('x')), 50), null);
});

import { keepForRoute, keepSchemes, parseKept as readKept, schemeKey } from '../src/lib/schemeHints.ts';
const memory = () => { const m = new Map<string, string>(); return { m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); } }; };

test('the offers a shop qualifies for are kept for when there is no signal', async () => {
  const kv = memory(); const asked: string[] = [];
  const api = { get: async <T>(path: string) => { asked.push(path); return [scheme({})] as unknown as T; } };
  const kept = await keepSchemes(api, kv, 1, 9, '2026-10-08', 1000);
  assert.equal(kept?.schemes.length, 1); assert.equal(readKept(kv.m.get(schemeKey(1, 9)) ?? null)?.at, 1000);
  assert.match(asked[0], /customer_id=9&date=2026-10-08/);
  const down = { get: async () => { throw new TypeError('Network request failed'); } };
  assert.equal(await keepSchemes(down as never, kv, 1, 9, '2026-10-08', 2000), null);
  assert.equal(readKept(kv.m.get(schemeKey(1, 9)) ?? null)?.at, 1000, 'what was kept stays when the server cannot be reached');
});

test('a route\'s shops are kept a few at a time, fresh ones are skipped, and a failure stops quietly', async () => {
  const kv = memory(); let calls = 0;
  const api = { get: async <T>(_p: string) => { calls++; return [] as unknown as T; } };
  await kv.set(schemeKey(1, 2), JSON.stringify({ at: 1000, schemes: [] }));
  assert.equal(await keepForRoute(api, kv, 1, [1, 2, 3, 4], '2026-10-08', 1000 + 60000), 3, 'shop 2 was kept a minute ago');
  assert.equal(calls, 3);
  const flaky = { get: async () => { throw new TypeError('offline'); } };
  assert.equal(await keepForRoute(flaky as never, memory(), 1, [1, 2, 3], '2026-10-08'), 0);
});
