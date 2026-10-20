import test from 'node:test';
import assert from 'node:assert/strict';
import { clock, countBy, duration, liveCharge, liveElapsed, liveRemaining, offersFor, startBody, startProblem, stations, stopBody, stopProblem, timeWarning, type Board, type Station } from '../src/lib/gaming.ts';

const st = (id: number, state: Station['state'], over: Partial<Station> = {}): Station => ({ station_id: id, name: `PS5-${id}`, label: null, kind: 'CONSOLE', max_players: 4, status_note: null, state, session: null, tab: null, order_id: null, next_booking: null, ...over });

test('clocks read like a clock, over time keeps its sign, durations like a list', () => {
  assert.equal(clock(3725), '1:02:05'); assert.equal(clock(125), '2:05'); assert.equal(clock(-125), '-2:05'); assert.equal(clock(0), '0:00');
  assert.equal(duration(3900), '1h 05m'); assert.equal(duration(2520), '42m'); assert.equal(duration(-5), '0m');
});

test('only a running session moves between refreshes: time played, time left and the charge so far', () => {
  const run = { status: 'RUNNING', elapsed_seconds: 600, remaining_seconds: 1200, charge: 50, bills_time: true, hour_rate: 120 };
  assert.equal(liveElapsed(run, 30), 630); assert.equal(liveRemaining(run, 30), 1170); assert.equal(liveCharge(run, 1800), 110);
  const paused = { ...run, status: 'PAUSED' };
  assert.equal(liveElapsed(paused, 30), 600); assert.equal(liveRemaining(paused, 30), 1200); assert.equal(liveCharge(paused, 1800), 50);
  assert.equal(liveRemaining({ status: 'RUNNING', remaining_seconds: null }, 30), null);
  assert.equal(liveCharge({ status: 'RUNNING', charge: 40, bills_time: false, hour_rate: 120 }, 3600), 40, 'a session that does not bill time (a pass) adds nothing');
});

test('the warning: time up past the booked time, ending soon inside the alarm', () => {
  assert.equal(timeWarning(null, 5), null); assert.equal(timeWarning(1000, 5), null);
  assert.equal(timeWarning(299, 5), 'soon'); assert.equal(timeWarning(-1, 5), 'over'); assert.equal(timeWarning(0, 5), 'soon');
});

test('the board is flattened by zone and counted by state', () => {
  const b: Board = { alert_minutes: 10, zones: [{ name: 'Lounge', stations: [st(1, 'RUNNING'), st(2, 'AVAILABLE')] }, { name: null, stations: [st(3, 'RUNNING'), st(4, 'TO_BILL')] }] };
  const all = stations(b);
  assert.equal(all.length, 4); assert.equal(all[0].alert_minutes, 10);
  assert.equal(countBy(all, 'RUNNING'), 2); assert.equal(countBy(all, 'TO_BILL'), 1); assert.equal(countBy(all, 'RESERVED'), 0);
  assert.deepEqual(stations(null), []);
});

test('starting: players within the station, an offer when paying by offer; the body carries only what was chosen', () => {
  const s = { station_id: 7, max_players: 4 };
  assert.equal(startProblem(s, { players: 2, how: 'OPEN', bundleId: null, alarm: '' }), '');
  assert.match(startProblem(s, { players: 5, how: 'OPEN', bundleId: null, alarm: '' }), /1 to 4/);
  assert.match(startProblem(s, { players: 0, how: 'OPEN', bundleId: null, alarm: '' }), /1 to 4/);
  assert.match(startProblem(s, { players: 2, how: 'FIXED', bundleId: null, alarm: '' }), /offer/);
  assert.deepEqual(startBody(s, { players: 2, how: 'OPEN', bundleId: null, alarm: '60' }), { station_id: 7, players: 2, mode: 'OPEN', customer_id: null, game_id: null, note: null, planned_minutes: 60 });
  assert.deepEqual(startBody(s, { players: 3, how: 'FIXED', bundleId: 9, alarm: '60' }, true), { station_id: 7, players: 3, mode: 'FIXED', customer_id: null, game_id: null, note: null, override: true, bundle_id: 9 });
});

test('offers: only those for this kind of station, or for every kind', () => {
  const list = [{ bundle_id: 1, name: 'A', kinds: ['CONSOLE'] }, { bundle_id: 2, name: 'B', kinds: ['POOL'] }, { bundle_id: 3, name: 'C', kinds: null }];
  assert.deepEqual(offersFor(list, 'CONSOLE').map((b) => b.bundle_id), [1, 3]);
});

test('stopping bills the time; cancelling a mistaken start needs a reason and charges nothing', () => {
  assert.equal(stopProblem(false, ''), ''); assert.match(stopProblem(true, '  '), /why/); assert.equal(stopProblem(true, 'Wrong station'), '');
  assert.deepEqual(stopBody(false, 'x'), {}); assert.deepEqual(stopBody(true, ' Wrong station '), { void: true, reason: 'Wrong station' });
});
