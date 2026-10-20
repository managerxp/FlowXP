/* Loyalty on the phone: the visit card, points and tiers, coupons, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOYALTY_TEXTS, adjustBody, adjustProblem, canLoyalty, couponBody, couponForm, couponLine, couponProblem, couponState, daysAgoText, emptyCoupon, exampleEarn, newTier, percentOf, pointsBody, pointsForm, pointsProblem, programBody, programForm, programProblem, type Coupon, type PointsProgram } from '../src/lib/loyalty.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

test('only owners and admins reach loyalty', () => { assert.equal(canLoyalty('OWNER'), true); assert.equal(canLoyalty('ADMIN'), true); assert.equal(canLoyalty('CASHIER'), false); assert.equal(canLoyalty(undefined), false); });

test('the visit card form round-trips and is checked like the server', () => {
  const f = programForm({ is_enabled: true, visits_required: 7, reward_product_id: 12, reward_name: 'Tea', reward_price: 20, reward_quantity: 2, min_bill: 150 });
  assert.deepEqual(f, { is_enabled: true, visits_required: '7', reward_product_id: '12', reward_quantity: '2', min_bill: '150' });
  assert.deepEqual(programBody(f), { is_enabled: true, visits_required: 7, reward_product_id: 12, reward_quantity: 2, min_bill: 150 });
  assert.equal(programProblem(f), ''); assert.notEqual(programProblem({ ...f, visits_required: '1' }), ''); assert.notEqual(programProblem({ ...f, visits_required: '51' }), '');
  assert.match(programProblem({ ...f, reward_product_id: '' }), /free item/); assert.equal(programProblem({ ...f, reward_product_id: '', is_enabled: false }), '');
  assert.equal(programBody({ ...f, min_bill: '' }).min_bill, 0); assert.equal(programForm({ is_enabled: false, visits_required: 7, reward_product_id: null, reward_name: null, reward_price: null, reward_quantity: 1, min_bill: 0 }).min_bill, '');
});

test('days since a visit, and a share of members', () => {
  const now = new Date(2026, 9, 15, 15, 0);
  assert.equal(daysAgoText('2026-10-15', now), 'today'); assert.equal(daysAgoText('2026-10-14', now), 'yesterday'); assert.equal(daysAgoText('2026-10-05', now), '10 days ago'); assert.equal(daysAgoText(null, now), '');
  assert.equal(percentOf(1, 3), 33); assert.equal(percentOf(5, 0), 0);
});

test('points: the form, the body, the tier rules and the earning example', () => {
  const p: PointsProgram = { is_enabled: true, earn_per_100: 5, point_value: 1, min_redeem_points: 50, max_redeem_pct: 50, tiers: [{ name: 'Silver', min_points: 0, multiplier: 1 }, { name: 'Gold', min_points: 500, multiplier: 1.5 }] };
  const f = pointsForm(p);
  assert.deepEqual(pointsBody(f).tiers, [{ name: 'Silver', min_points: 0, multiplier: 1 }, { name: 'Gold', min_points: 500, multiplier: 1.5 }]); assert.equal(pointsProblem(f), '');
  assert.notEqual(pointsProblem({ ...f, earn_per_100: '0' }), ''); assert.notEqual(pointsProblem({ ...f, point_value: '1001' }), ''); assert.notEqual(pointsProblem({ ...f, max_redeem_pct: '101' }), ''); assert.notEqual(pointsProblem({ ...f, min_redeem_points: '0' }), '');
  assert.match(pointsProblem({ ...f, tiers: [{ name: 'Gold', min_points: '500', multiplier: '1' }] }), /first tier/); assert.match(pointsProblem({ ...f, tiers: [f.tiers[0], { ...f.tiers[0], name: 'Dup' }] }), /same number/);
  assert.notEqual(pointsProblem({ ...f, tiers: [{ name: '', min_points: '0', multiplier: '1' }] }), ''); assert.notEqual(pointsProblem({ ...f, tiers: [{ name: 'A', min_points: '0', multiplier: '11' }] }), '');
  assert.equal(pointsProblem({ ...f, tiers: [] }), ''); assert.equal(newTier({ ...f, tiers: [] }).min_points, '0'); assert.equal(newTier(f).min_points, ''); assert.equal(exampleEarn('5'), 25); assert.equal(exampleEarn('2.5'), 12);
  assert.equal(adjustProblem('50', 'Birthday'), ''); assert.equal(adjustProblem('-20', 'Mistake'), ''); assert.notEqual(adjustProblem('0', 'x'), ''); assert.notEqual(adjustProblem('1.5', 'x'), ''); assert.notEqual(adjustProblem('10', ' '), ''); assert.deepEqual(adjustBody('-20', ' Mistake '), { points: -20, note: 'Mistake' });
});

const coupon: Coupon = { coupon_id: 1, code: 'WELCOME10', description: 'First visit', kind: 'PERCENT', value: 10, min_bill: 200, max_discount: 50, valid_from: '2026-10-01', valid_to: '2026-10-31', max_uses: 100, max_uses_per_customer: 1, is_active: true, used: 3, discount_given: 120 };

test('coupons: the form, the body, limits that can be cleared, and the status', () => {
  const f = couponForm(coupon);
  assert.equal(f.max_discount, '50'); assert.equal(couponProblem(f), '');
  assert.deepEqual(couponBody({ ...f, code: ' welcome10 ' }), { code: 'WELCOME10', description: 'First visit', kind: 'PERCENT', value: 10, min_bill: 200, max_discount: 50, valid_from: '2026-10-01', valid_to: '2026-10-31', max_uses: 100, max_uses_per_customer: 1 });
  const cleared = couponBody({ ...f, max_uses: '', min_bill: '', valid_to: '' }); assert.equal(cleared.max_uses, null); assert.equal(cleared.min_bill, null); assert.equal(cleared.valid_to, null);
  assert.equal(couponBody({ ...f, kind: 'FLAT' }).max_discount, null, 'a flat coupon has no cap');
  assert.notEqual(couponProblem({ ...f, code: 'ab' }), ''); assert.notEqual(couponProblem({ ...f, value: '0' }), ''); assert.notEqual(couponProblem({ ...f, value: '101' }), ''); assert.equal(couponProblem({ ...f, kind: 'FLAT', value: '101' }), '');
  assert.notEqual(couponProblem({ ...f, valid_to: '2026-09-30' }), ''); assert.notEqual(couponProblem({ ...f, valid_from: '2026-13-01' }), ''); assert.notEqual(couponProblem({ ...f, max_uses: '0' }), ''); assert.notEqual(couponProblem({ ...f, min_bill: 'x' }), '');
  assert.notEqual(couponProblem(emptyCoupon()), '');
  assert.equal(couponState(coupon, '2026-10-15'), 'Live'); assert.equal(couponState({ ...coupon, is_active: false }, '2026-10-15'), 'Off'); assert.equal(couponState(coupon, '2026-11-01'), 'Expired'); assert.equal(couponState(coupon, '2026-09-01'), 'Scheduled'); assert.equal(couponState({ ...coupon, used: 100 }, '2026-10-15'), 'Used up');
  assert.match(couponLine(coupon), /10% off .*\(max .*50.*\) on bills of .*200.*\+ · 2026-10-01 → 2026-10-31 · Used 3 \/ 100 · given off .*120/);
});

test('every text of the Loyalty screens is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(LOYALTY_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
