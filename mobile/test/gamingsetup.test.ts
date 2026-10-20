/* Gaming set-up on the phone: stations and zones, rates with peak times, offers and packs, settings, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GAMING_SETUP_TEXTS, canGamingSetup, emptyOffer, emptyRate, emptyStation, gsettingsBody, gsettingsForm, gsettingsProblem, newBand, offerBody, offerForm, offerProblem, offerSub, rateBody, rateForm, rateProblem, rateSummary, scopeName, scopeOf,
  stationBody, stationForm, stationProblem, stationSub, zoneProblem, type GSettings, type GStation, type Offer, type Rate, type Zone
} from '../src/lib/gamingSetup.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const station: GStation = { station_id: 7, name: 'PS5-1', kind: 'CONSOLE', label: 'PS5', max_players: 4, zone_id: 2, zone_name: 'Lounge', status: 'AVAILABLE', status_note: null };
const rate: Rate = { rate_id: 3, name: 'PS5 hourly', kind: 'CONSOLE', zone_id: null, station_id: null, bill_time: true, tiers: [{ players: 1, hour: 100 }, { players: 2, hour: 150 }], bands: [{ name: 'Evening', days: [5, 6], from: '18:00', to: '23:00', multiplier_pct: 120 }], extra_player_hour: null, block_minutes: 15, grace_minutes: 5, min_minutes: 30, unit_label: null, unit_price: 0 };

test('only people with the gaming set-up right', () => { assert.equal(canGamingSetup((p) => p === 'gaming_setup'), true); assert.equal(canGamingSetup(() => false), false); });

test('stations and zones', () => {
  const f = stationForm(station);
  assert.equal(stationProblem(f), ''); assert.deepEqual(stationBody({ ...f, name: ' PS5-2 ', label: '' }), { name: 'PS5-2', kind: 'CONSOLE', label: null, max_players: 4, zone_id: 2 });
  assert.equal(stationBody({ ...f, zone_id: '' }).zone_id, null); assert.notEqual(stationProblem({ ...f, name: ' ' }), ''); assert.notEqual(stationProblem({ ...f, max_players: '0' }), ''); assert.notEqual(stationProblem({ ...f, max_players: '21' }), ''); assert.notEqual(stationProblem({ ...f, max_players: '2.5' }), '');
  assert.equal(emptyStation(3).zone_id, '3'); assert.equal(stationSub(station), 'Console · PS5 · Lounge · up to 4'); assert.equal(zoneProblem(' '), 'Give the zone a name'); assert.equal(zoneProblem('Pool'), '');
});

test('rates: round trip, scope, checks, body, summary', () => {
  const f = rateForm(rate);
  assert.equal(f.scope, 'kind:CONSOLE'); assert.equal(rateProblem(f), ''); assert.equal(scopeOf({ kind: null, zone_id: 4, station_id: null }), 'zone:4'); assert.equal(scopeOf({ kind: 'POOL', zone_id: null, station_id: 9 }), 'station:9'); assert.equal(scopeOf({ kind: null, zone_id: null, station_id: null }), 'all');
  assert.deepEqual(rateBody(f), { name: 'PS5 hourly', kind: 'CONSOLE', zone_id: null, station_id: null, bill_time: true, tiers: [{ players: 1, hour: 100 }, { players: 2, hour: 150 }], extra_player_hour: null, block_minutes: 15, grace_minutes: 5, min_minutes: 30, unit_label: null, unit_price: 0, bands: [{ name: 'Evening', days: [5, 6], from: '18:00', to: '23:00', multiplier_pct: 120 }] });
  assert.deepEqual(rateBody({ ...f, scope: 'station:9' }).station_id, 9); assert.equal(rateBody({ ...f, scope: 'zone:4' }).zone_id, 4); assert.equal(rateBody({ ...f, scope: 'all' }).kind, null);
  assert.notEqual(rateProblem({ ...f, name: '' }), ''); assert.notEqual(rateProblem({ ...f, tiers: [{ players: '1', hour: '' }] }), ''); assert.notEqual(rateProblem({ ...f, tiers: [{ players: '1', hour: '100' }, { players: '1', hour: '120' }] }), ''); assert.notEqual(rateProblem({ ...f, tiers: [{ players: '0', hour: '100' }] }), '');
  assert.notEqual(rateProblem({ ...f, block: '0' }), ''); assert.notEqual(rateProblem({ ...f, grace: '61' }), ''); assert.notEqual(rateProblem({ ...f, bands: [{ ...newBand(), days: [] }] }), ''); assert.notEqual(rateProblem({ ...f, bands: [{ ...newBand(), from: '6pm' }] }), ''); assert.notEqual(rateProblem({ ...f, bands: [{ ...newBand(), pct: '5' }] }), '');
  assert.notEqual(rateProblem({ ...f, bands: Array.from({ length: 9 }, newBand) }), '');
  const frame = { ...emptyRate(), name: 'Pool', scope: 'kind:POOL', bill_time: false, unitLabel: 'frame' };
  assert.equal(rateProblem(frame), 'A table charged only per frame needs a price per frame'); assert.equal(rateProblem({ ...frame, unitPrice: '60' }), ''); assert.deepEqual(rateBody({ ...frame, unitPrice: '60' }).tiers, []); assert.equal(rateBody({ ...frame, unitPrice: '60' }).unit_price, 60);
  assert.equal(rateSummary(rate), '1 players ₹100 an hour · 2 players ₹150 an hour · billed every 15 min · minimum 30 min · 1 peak times');
  const zones: Zone[] = [{ zone_id: 2, name: 'Lounge', stations: 3 }];
  assert.equal(scopeName(rate, zones, [station]), 'Console'); assert.equal(scopeName({ ...rate, kind: null, zone_id: 2 }, zones, [station]), 'Zone Lounge'); assert.equal(scopeName({ ...rate, kind: null, station_id: 7 }, zones, [station]), 'PS5-1'); assert.equal(scopeName({ ...rate, kind: null }, zones, []), 'Every station');
});

test('offers and hour packs', () => {
  const o: Offer = { bundle_id: 1, name: '3 hours', minutes: 180, price: 250, players: 2, kinds: ['CONSOLE'], valid_days: null };
  const f = offerForm(o);
  assert.equal(f.hours, '3'); assert.equal(offerProblem(f, false), ''); assert.deepEqual(offerBody(f, false), { name: '3 hours', kind: 'SESSION', minutes: 180, price: 250, players: 2, kinds: ['CONSOLE'], valid_days: null });
  assert.equal(offerSub(o, false), '3 hours for ₹250 · 2 players covered · Console');
  const pack = { ...emptyOffer(true), name: '10 hour pack', price: '800' };
  assert.equal(offerProblem(pack, true), ''); assert.deepEqual(offerBody(pack, true), { name: '10 hour pack', kind: 'PACK', minutes: 600, price: 800, players: 1, kinds: [], valid_days: 90 });
  assert.equal(offerBody({ ...pack, valid: '' }, true).valid_days, null); assert.equal(offerSub({ ...o, kinds: null, minutes: 90, valid_days: 30 }, true), '90 min for ₹250 · good for 30 days');
  assert.notEqual(offerProblem({ ...f, name: '' }, false), ''); assert.notEqual(offerProblem({ ...f, price: '' }, false), ''); assert.notEqual(offerProblem({ ...f, hours: '0' }, false), ''); assert.notEqual(offerProblem({ ...f, players: '0' }, false), ''); assert.notEqual(offerProblem({ ...pack, valid: '1.5' }, true), '');
});

test('settings and the wallet top-up bonus', () => {
  const s: GSettings = { alert_minutes: 10, hold_minutes: 15, noshow_minutes: 20, gst_rate: 18, topup_bonus: [{ min: 500, bonus: 50 }] };
  const f = gsettingsForm(s);
  assert.equal(gsettingsProblem(f, true), ''); assert.deepEqual(gsettingsBody(f, true), { alert_minutes: 10, hold_minutes: 15, noshow_minutes: 20, gst_rate: 18, topup_bonus: [{ min: 500, bonus: 50 }] }); assert.equal('topup_bonus' in gsettingsBody(f, false), false);
  assert.notEqual(gsettingsProblem({ ...f, alert: '0' }, true), ''); assert.notEqual(gsettingsProblem({ ...f, hold: '300' }, true), ''); assert.notEqual(gsettingsProblem({ ...f, gst: '41' }, true), '');
  assert.notEqual(gsettingsProblem({ ...f, bonus: [{ min: '500', bonus: '0' }] }, true), ''); assert.notEqual(gsettingsProblem({ ...f, bonus: [{ min: '500', bonus: '50' }, { min: '500', bonus: '60' }] }, true), '');
  assert.equal(gsettingsProblem({ ...f, bonus: [{ min: '', bonus: '' }] }, false), '');
});

test('every text of the gaming set-up screens is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(GAMING_SETUP_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
