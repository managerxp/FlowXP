/*
 * Gaming pricing: pure functions, no database. Every rule is checked with exact instants. The lounge's clock is Asia/Kolkata (UTC+5:30, no daylight
 * saving), and one test uses a zone that does change its clock, to show bands follow the wall clock.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { RateError, billedMinutes, bandAt, cleanBands, cleanTiers, durationLabel, elapsedSeconds, hourPrice, hourRateAt, inWindow, localAt, priceSession, remainingSeconds, snapshotOf } from '../src/modules/gaming/pricing.js';

// Monday 12 October 2026, 10:00 in Kolkata
const T0 = Date.parse('2026-10-12T04:30:00Z');
const min = (m) => T0 + m * 60000;
const iso = (ms) => new Date(ms).toISOString();

const rate = (over = {}) => ({ bill_time: true, tiers: [{ players: 1, hour_paise: 10000 }, { players: 2, hour_paise: 15000 }, { players: 4, hour_paise: 20000 }], extra_player_hour_paise: 5000, bands: [], block_minutes: 1, grace_minutes: 0, min_minutes: 0, unit_label: null, unit_price_paise: 0, ...over });
const seg = (fromMin, toMin, players = 1, r = rate()) => ({ started_at: iso(min(fromMin)), ended_at: toMin == null ? null : iso(min(toMin)), players, rate: r });
const open = { mode: 'OPEN', units: 0 };
const price = (segments, session = open, atMin = 1000, opts) => priceSession(segments, session, min(atMin), opts);

test('the local clock follows the zone, including a day that loses an hour', () => {
  assert.deepEqual(localAt(T0), { dow: 1, minutes: 600 });
  assert.deepEqual(localAt(Date.parse('2026-10-11T18:30:00Z')), { dow: 1, minutes: 0 }, 'midnight in Kolkata is Monday 00:00');
  // New York springs forward at 02:00 on 8 March 2026: 01:59 is followed by 03:00
  assert.equal(localAt(Date.parse('2026-03-08T06:59:00Z'), 'America/New_York').minutes, 119);
  assert.equal(localAt(Date.parse('2026-03-08T07:00:00Z'), 'America/New_York').minutes, 180);
});

test('windows: inside, outside, wrapping past midnight, and the same time twice meaning all day', () => {
  assert.ok(inWindow(18 * 60, '18:00', '23:00'));
  assert.ok(!inWindow(23 * 60, '18:00', '23:00'), 'the end is outside');
  assert.ok(inWindow(23 * 60 + 30, '22:00', '02:00') && inWindow(60, '22:00', '02:00'));
  assert.ok(!inWindow(12 * 60, '22:00', '02:00'));
  assert.ok(inWindow(5, '00:00', '00:00'));
});

test('the hourly price by number of players, and for more players than the biggest tier', () => {
  const t = rate().tiers;
  assert.equal(hourPrice(t, 1), 10000);
  assert.equal(hourPrice(t, 2), 15000);
  assert.equal(hourPrice(t, 3), 20000, 'three players pay the next tier up');
  assert.equal(hourPrice(t, 4), 20000);
  assert.equal(hourPrice(t, 6, 5000), 30000, 'two over the biggest tier, Rs 50 an hour each');
  assert.equal(hourPrice(t, 6, null), 20000, 'no extra set: the biggest tier');
  assert.equal(hourPrice([], 2), 0);
});

test('by the minute: the exact price of the time used', () => {
  assert.equal(price([seg(0, 30)]).time_paise, 5000);
  assert.equal(price([seg(0, 60, 2)]).time_paise, 15000);
  assert.equal(price([seg(0, 90, 4)]).time_paise, 30000);
  assert.equal(price([seg(0, 0)]).total_paise, 0, 'a session that never ran costs nothing');
  // 1 hour 1.5 minutes: rounded up to 62 whole minutes
  const p = price([{ ...seg(0, 0), ended_at: iso(min(0) + 3690000) }]);
  assert.equal(p.billed_minutes, 62);
  assert.equal(p.time_paise, 10333);
});

test('a pause is not billed', () => {
  const p = price([seg(0, 30), seg(60, 90)]);
  assert.equal(p.elapsed_seconds, 3600);
  assert.equal(p.time_paise, 10000);
});

test('a running session is priced up to now', () => {
  const p = price([seg(0, null)], open, 45);
  assert.equal(p.elapsed_seconds, 2700);
  assert.equal(p.time_paise, 7500);
});

test('blocks: time over a block is rounded up unless it is within the grace', () => {
  const r = rate({ block_minutes: 30, grace_minutes: 5 });
  assert.equal(billedMinutes(62 * 60, r), 60, '2 minutes over: inside the grace');
  assert.equal(billedMinutes(65 * 60, r), 60, 'exactly the grace');
  assert.equal(billedMinutes(66 * 60, r), 90, 'one minute past the grace');
  assert.equal(billedMinutes(60 * 60, r), 60);
  assert.equal(billedMinutes(1, r), 30, 'a few seconds is a whole block');
  assert.equal(price([seg(0, 66, 1, r)]).time_paise, 15000, '90 minutes at Rs 100 an hour');
  assert.equal(price([seg(0, 62, 1, r)]).time_paise, 10000);
});

test('the minimum: the least billed for a session that was used, and nothing for one that was not', () => {
  const r = rate({ min_minutes: 30 });
  assert.equal(price([seg(0, 12, 1, r)]).time_paise, 5000, 'a 12 minute session is billed 30 minutes');
  assert.equal(price([seg(0, 45, 1, r)]).time_paise, 7500, 'past the minimum the real time counts');
  assert.equal(price([seg(0, 0, 1, r)]).time_paise, 0);
});

test('by the minute with a grace: a few seconds into the next minute are not billed', () => {
  const r = rate({ grace_minutes: 1 });
  assert.equal(billedMinutes(60 * 60 + 30, r), 60, '30 seconds over inside a one-minute grace');
  assert.equal(billedMinutes(60 * 60 + 61, r), 61);
});

test('peak bands follow the local wall clock, by percentage or by their own prices', () => {
  const evening = { name: 'Evening', days: [0, 1, 2, 3, 4, 5, 6], from: '11:00', to: '12:00', multiplier_pct: 150 };
  const r = rate({ bands: [evening] });
  // 10:30 to 11:30: half at Rs 100, half at Rs 150 an hour
  const p = price([seg(30, 90, 1, r)]);
  assert.equal(p.time_paise, 5000 + 7500);
  assert.equal(bandAt(r, localAt(min(70)))?.name, 'Evening');
  assert.equal(bandAt(r, localAt(min(10))), null);
  const own = rate({ bands: [{ name: 'Happy hour', days: [1], from: '10:00', to: '11:00', tiers: [{ players: 1, hour_paise: 6000 }] }] });
  assert.equal(price([seg(0, 60, 1, own)]).time_paise, 6000, 'the band replaces the tiers');
  assert.equal(hourRateAt(own, 1, { dow: 2, minutes: 630 }), 10000, 'a Tuesday is not a Monday band');
});

test('a band that runs past midnight is matched by the weekday of each minute', () => {
  // Saturday only, 22:00 to 02:00 at double: Saturday 23:30 is in, Sunday 00:30 is not (Sunday is not ticked)
  const r = rate({ bands: [{ name: 'Late', days: [6], from: '22:00', to: '02:00', multiplier_pct: 200 }] });
  const sat2330 = Date.parse('2026-10-17T18:00:00Z');      // Saturday 23:30 IST
  const s = { started_at: new Date(sat2330).toISOString(), ended_at: new Date(sat2330 + 3600000).toISOString(), players: 1, rate: r };
  assert.equal(priceSession([s], open, sat2330 + 7200000).time_paise, 5000 * 2 + 5000, 'half an hour at double, half an hour at normal');
});

test('a change of players splits the stretch, each priced for its players', () => {
  const p = price([seg(0, 30, 1), seg(30, 60, 2)]);
  assert.equal(p.time_paise, 5000 + 7500);
});

test('a transfer to another station is priced at that station rate from the moment it moves', () => {
  const room = rate({ tiers: [{ players: 1, hour_paise: 30000 }], extra_player_hour_paise: null });
  const p = price([seg(0, 30, 2), seg(30, 60, 2, room)]);
  assert.equal(p.time_paise, 7500 + 15000);
});

test('a bundle: the price covers its time, over it is charged by the minute, stopping early refunds nothing', () => {
  const bundle = { mode: 'FIXED', bundle_price_paise: 20000, planned_minutes: 180, units: 0 };
  assert.equal(price([seg(0, 120)], bundle).time_paise, 20000, 'two of three hours used');
  assert.equal(price([seg(0, 180)], bundle).time_paise, 20000, 'exactly the time');
  const over = price([seg(0, 200)], bundle);
  assert.equal(over.over_seconds, 1200);
  assert.equal(over.time_paise, 20000 + Math.round(20 * 10000 / 60), '20 minutes over at Rs 100 an hour');
  assert.equal(price([seg(0, 183)], bundle, 1000, { overrunGraceMinutes: 5 }).time_paise, 20000, 'inside the overrun grace');
});

test('a prepaid pack covers its minutes; the rest is charged pro rata', () => {
  const pack = { mode: 'PACK', pack_minutes: 60, units: 0 };
  assert.equal(price([seg(0, 45)], pack).time_paise, 0, 'all covered');
  const p = price([seg(0, 90)], pack);
  assert.equal(p.covered_minutes, 60);
  assert.equal(p.time_paise, 5000, 'the last 30 of 90 minutes at Rs 100 an hour');
  assert.equal(price([seg(0, 90)], { mode: 'PACK', pack_minutes: 0, units: 0 }).time_paise, 15000);
});

test('pool by the frame: units are added, and a frame-only table charges nothing for the clock', () => {
  const frames = rate({ bill_time: false, tiers: [], unit_label: 'frame', unit_price_paise: 5000 });
  const p = price([seg(0, 600, 2, frames)], { mode: 'OPEN', units: 3 });
  assert.equal(p.time_paise, 0);
  assert.equal(p.units_paise, 15000);
  assert.equal(p.total_paise, 15000);
  // a timed table that also counts frames
  const both = rate({ unit_price_paise: 2000 });
  assert.equal(price([seg(0, 60, 1, both)], { mode: 'OPEN', units: 2 }).total_paise, 10000 + 4000);
});

test('time left on a timed session, and none on an untimed one', () => {
  const s = [seg(0, null)];
  assert.equal(remainingSeconds(s, { planned_minutes: 60 }, min(45)), 900);
  assert.equal(remainingSeconds(s, { planned_minutes: 60 }, min(70)), -600, 'negative once over');
  assert.equal(remainingSeconds(s, {}, min(45)), null);
  assert.equal(elapsedSeconds([seg(0, 10), seg(20, 25)], min(100)), 900);
});

test('what a person types is cleaned, or refused with a sentence', () => {
  assert.deepEqual(cleanTiers([{ players: 2, hour: 150 }, { players: 1, hour: 100 }]), [{ players: 1, hour_paise: 10000 }, { players: 2, hour_paise: 15000 }]);
  assert.throws(() => cleanTiers([{ players: 1, hour: 100 }, { players: 1, hour: 90 }]), RateError);
  assert.throws(() => cleanTiers([], { required: true }), /at least one price/);
  assert.throws(() => cleanTiers([{ players: 0, hour: 100 }]), RateError);
  assert.throws(() => cleanTiers([{ players: 1, hour: -5 }]), RateError);
  assert.equal(cleanBands([{ name: 'Peak', from: '18:00', to: '23:00', multiplier_pct: 120 }])[0].days.length, 7, 'every day unless chosen');
  assert.throws(() => cleanBands([{ from: '6pm', to: '23:00', multiplier_pct: 120 }]), /time like 18:00/);
  assert.throws(() => cleanBands([{ from: '18:00', to: '23:00' }]), /percentage/);
  assert.throws(() => cleanBands([{ days: [9], from: '18:00', to: '23:00', multiplier_pct: 120 }]), /days/);
});

test('the snapshot keeps only what pricing reads, and a duration reads plainly', () => {
  const s = snapshotOf({ rate_id: 4, name: 'PS5', tiers: [], bands: [], block_minutes: 30, secret: 'x' });
  assert.equal(s.secret, undefined);
  assert.equal(s.block_minutes, 30);
  assert.equal(durationLabel(65 * 60), '1h 05m');
  assert.equal(durationLabel(42 * 60 + 10), '42m');
  assert.equal(durationLabel(-5), '0m');
});
