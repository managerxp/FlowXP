/* Hotel set-up on the phone: room types and rooms, rate plans and seasonal rates, rooms out of sale, banquet halls and packages, settings, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOTEL_SETUP_TEXTS, blockBody, blockLine, blockProblem, bulkBody, bulkCount, bulkProblem, bulkText, canHotelSetup, emptyBlock, emptyBulk, emptyHall, emptyPackage, emptyPlan, emptySeason, emptyType, hallBody, hallForm, hallProblem, hallSub, list, packageBody, packageForm, packageProblem, packageSub,
  planBody, planForm, planProblem, planSub, roomBody, roomProblem, roomSub, seasonBody, seasonLine, seasonProblem, settingsBody, settingsForm, settingsProblem, typeBody, typeForm, typeProblem, typeSub, type HotelSettings, type RatePlan, type RoomType
} from '../src/lib/hotelSetup.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const types: RoomType[] = [
  { room_type_id: 5, name: 'Standard AC', code: 'STD', description: null, base_rate: 3200, extra_adult: 700, extra_child: 0, base_adults: 2, max_adults: 3, max_children: 1, amenities: ['TV', 'Wi-Fi'], room_count: 8 },
  { room_type_id: 6, name: 'Deluxe', code: 'DLX', description: 'Big', base_rate: 4800, extra_adult: 0, extra_child: 0, base_adults: 2, max_adults: 3, max_children: 2, amenities: [], room_count: 8 }
];

test('only people with the hotel set-up right', () => { assert.equal(canHotelSetup((p) => p === 'hotel_setup'), true); assert.equal(canHotelSetup(() => false), false); assert.deepEqual(list(' a, ,b ,c'), ['a', 'b', 'c']); });

test('room types: round trip, checks, body (the code defaults to the name), the line', () => {
  const f = typeForm(types[0]);
  assert.equal(f.amenities, 'TV, Wi-Fi'); assert.equal(f.extra_child, ''); assert.equal(typeProblem(f), '');
  const b = typeBody({ ...f, code: '', name: 'Sea View', amenities: 'AC, TV' });
  assert.equal(b.code, 'Sea '); assert.deepEqual(b.amenities, ['AC', 'TV']); assert.equal(b.base_rate, 3200); assert.equal(b.extra_child, 0);
  assert.notEqual(typeProblem({ ...f, name: ' ' }), ''); assert.notEqual(typeProblem({ ...f, base_rate: '' }), ''); assert.notEqual(typeProblem({ ...f, extra_adult: 'x' }), ''); assert.notEqual(typeProblem({ ...f, max_adults: '1', base_adults: '2' }), ''); assert.notEqual(typeProblem({ ...f, base_adults: '0' }), '');
  assert.equal(typeSub(types[0]), 'Rack rate ₹3,200.00 · extra adult ₹700.00 · 2 included · up to 3 adults, 1 children · 8 rooms'); assert.equal(typeProblem(emptyType()), 'Give the room type a name');
});

test('rooms: add many (range, limit, what was added) and add one', () => {
  const f = { ...emptyBulk(5), from: '101', to: '110', floor: ' 1 ', prefix: 'A' };
  assert.equal(bulkProblem(f), ''); assert.deepEqual(bulkBody(f), { room_type_id: 5, from: 101, to: 110, floor: '1', prefix: 'A' }); assert.equal(bulkCount(f), 10); assert.equal(bulkBody({ ...f, floor: '', prefix: '' }).floor, undefined);
  assert.notEqual(bulkProblem({ ...f, to: '100' }), ''); assert.notEqual(bulkProblem({ ...f, to: '400' }), ''); assert.notEqual(bulkProblem({ ...f, from: 'x' }), ''); assert.notEqual(bulkProblem({ ...f, room_type_id: '' }), '');
  assert.equal(bulkText(10, 10), '10 rooms added'); assert.equal(bulkText(1, 1), '1 room added'); assert.equal(bulkText(6, 10), '6 rooms added (the rest already existed)');
  assert.equal(roomProblem({ room_no: '', floor: '', room_type_id: '5' }), 'Give the room a number'); assert.notEqual(roomProblem({ room_no: '101', floor: '', room_type_id: '' }), '');
  assert.deepEqual(roomBody({ room_no: ' 101 ', floor: '', room_type_id: '5' }), { room_no: '101', floor: undefined, room_type_id: 5 }); assert.equal(roomBody({ room_no: '1', floor: '2', room_type_id: '5' }, false).is_active, false);
  assert.equal(roomSub({ room_id: 1, room_no: '101', floor: '1', room_type_id: 5, room_type: 'Standard AC', is_active: false }), 'Standard AC · floor 1 · Retired');
});

test('rate plans: blank rate means the rack rate; every room type is sent; seasonal rates are checked', () => {
  const plan: RatePlan = { rate_plan_id: 4, name: 'With breakfast', code: 'CP', meal_plan: 'CP', meal_plan_name: 'With breakfast', is_default: false, rates: { '5': 3800 } };
  const f = planForm(plan);
  assert.equal(f.rates['5'], '3800'); assert.equal(planProblem(f), '');
  assert.deepEqual((planBody(f, types) as { rates: object }).rates, { 5: 3800, 6: null }); assert.equal(planBody({ ...emptyPlan(), name: 'Half board' }, types).code, 'Half');
  assert.notEqual(planProblem({ ...f, name: ' ' }), ''); assert.notEqual(planProblem({ ...f, rates: { '5': 'x' } }), '');
  assert.equal(planSub(plan, types), 'With breakfast · Standard AC ₹3,800.00 · Deluxe ₹4,800.00');
  const s = { ...emptySeason(5), name: ' Diwali ', from_date: '2026-11-01', to_date: '2026-11-05', rate: '9000', weekends: true };
  assert.equal(seasonProblem(s), ''); assert.deepEqual(seasonBody(s), { room_type_id: 5, rate_plan_id: undefined, name: 'Diwali', from_date: '2026-11-01', to_date: '2026-11-05', rate: 9000, days_of_week: [5, 6] });
  assert.notEqual(seasonProblem({ ...s, from_date: '1/11' }), ''); assert.notEqual(seasonProblem({ ...s, to_date: '2026-10-01' }), ''); assert.notEqual(seasonProblem({ ...s, rate: '0' }), ''); assert.notEqual(seasonProblem({ ...s, from_date: '2026-13-01' }), '');
  assert.equal(seasonLine({ override_id: 1, name: 'x', room_type_id: 5, room_type: 'Suite', rate_plan_id: null, rate_plan: null, from_date: '2026-11-01T00:00:00Z', to_date: '2027-03-31', days_of_week: [5, 6], rate: 14000 }), 'Suite · Every plan · 2026-11-01 → 2027-03-31 · (Fri and Sat)');
});

test('rooms out of sale: the room, dates, and a later return date', () => {
  const b = { ...emptyBlock(25), from_date: '2026-11-01', to_date: '2026-11-04', reason: ' Repainting ' };
  assert.equal(blockProblem(b), ''); assert.deepEqual(blockBody(b), { room_id: 25, from_date: '2026-11-01', to_date: '2026-11-04', reason: 'Repainting' });
  assert.notEqual(blockProblem({ ...b, room_id: '' }), ''); assert.notEqual(blockProblem({ ...b, to_date: '2026-11-01' }), ''); assert.notEqual(blockProblem({ ...b, from_date: 'x' }), '');
  assert.equal(blockLine({ block_id: 1, room_id: 25, room_no: '101', from_date: '2026-11-01T00:00:00Z', to_date: '2026-11-04', reason: 'Repainting' }), 'from 2026-11-01 · until 2026-11-04 · Repainting');
});

test('banquet halls and packages', () => {
  const h = { hall_id: 4, name: 'Coral', capacity_seated: 300, capacity_floating: 450, rent: 90000, amenities: ['Stage', 'AC'] };
  const f = hallForm(h); assert.equal(hallProblem(f), ''); assert.deepEqual(hallBody({ ...f, amenities: 'Stage, , AC' }), { name: 'Coral', capacity_seated: 300, capacity_floating: 450, rent: 90000, amenities: ['Stage', 'AC'] });
  assert.notEqual(hallProblem({ ...f, name: '' }), ''); assert.notEqual(hallProblem({ ...f, capacity_seated: '1.5' }), ''); assert.notEqual(hallProblem({ ...f, rent: 'x' }), ''); assert.equal(hallProblem(emptyHall()), 'Give the hall a name');
  assert.equal(hallSub(h), '300 seated · 450 standing · rent ₹90,000.00 · Stage, AC');
  const p = { package_id: 5, name: 'Classic Veg', diet: 'VEG', per_plate: 950, min_guests: 50, tax_rate: '18.00', menu: 'Welcome drink' };
  const pf = packageForm(p); assert.equal(pf.tax_rate, '18'); assert.equal(packageProblem(pf), ''); assert.deepEqual(packageBody(pf), { name: 'Classic Veg', diet: 'VEG', per_plate: 950, min_guests: 50, tax_rate: 18, menu: 'Welcome drink' });
  assert.notEqual(packageProblem({ ...pf, per_plate: '' }), ''); assert.notEqual(packageProblem({ ...pf, tax_rate: '120' }), ''); assert.notEqual(packageProblem({ ...pf, min_guests: '2.5' }), ''); assert.equal(packageProblem(emptyPackage()), 'Give the package a name');
  assert.equal(packageSub(p), 'Vegetarian · ₹950.00 a plate · from 50 guests · 18% GST · Welcome drink');
});

test('settings: times, prefix, GST slab; the hotel date is sent only before the first night audit', () => {
  const s: HotelSettings = { check_in_time: '12:00:00', check_out_time: '11:00:00', tax_threshold: 7500, tax_low_pct: '5.00', tax_high_pct: '18.00', allow_overbooking: false, res_prefix: 'SPR', business_date: '2026-10-13T00:00:00.000Z', audits: 40 };
  const f = settingsForm(s);
  assert.equal(f.check_in_time, '12:00'); assert.equal(f.tax_low_pct, '5'); assert.equal(f.business_date, '2026-10-13'); assert.equal(settingsProblem(f, 40), '');
  assert.equal('business_date' in settingsBody(f, 40), false); assert.equal(settingsBody(f, 0).business_date, '2026-10-13'); assert.equal(settingsBody({ ...f, res_prefix: 'abc' }, 40).res_prefix, 'ABC');
  assert.notEqual(settingsProblem({ ...f, check_in_time: '12' }, 40), ''); assert.notEqual(settingsProblem({ ...f, res_prefix: '' }, 40), ''); assert.notEqual(settingsProblem({ ...f, tax_high_pct: '101' }, 40), ''); assert.notEqual(settingsProblem({ ...f, tax_threshold: '-1' }, 40), ''); assert.notEqual(settingsProblem({ ...f, business_date: 'x' }, 0), ''); assert.equal(settingsProblem({ ...f, business_date: 'x' }, 40), '');
});

test('every text of the hotel set-up screens is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(HOTEL_SETUP_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
