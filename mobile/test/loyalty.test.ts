/* Loyalty on the phone: coupons, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LOYALTY_TEXTS, canLoyalty, couponBody, couponForm, couponLine, couponProblem, couponState, emptyCoupon, type Coupon } from '../src/lib/loyalty.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

test('only owners and admins reach loyalty', () => { assert.equal(canLoyalty('OWNER'), true); assert.equal(canLoyalty('ADMIN'), true); assert.equal(canLoyalty('CASHIER'), false); assert.equal(canLoyalty(undefined), false); });

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
