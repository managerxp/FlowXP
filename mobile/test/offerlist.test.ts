/* Offers on the phone: how each offer reads, the status, the form checks, the body sent, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { OFFERS_TEXTS, canOffers, describeOffer, emptyOffer, offerBody, offerLine, offerProblem, offerState, type Offer } from '../src/lib/offerList.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const base: Offer = { promo_id: 1, name: 'Milk', kind: 'BUNDLE_PRICE', percent: null, min_qty: 1, buy_qty: null, get_qty: null, bundle_qty: 3, bundle_price: 140, products: [], product_name: 'Milk 1L', category_name: null, starts_on: null, ends_on: null, days_of_week: null, start_time: null, end_time: null, members_only: false, is_active: true, live: true, on_now: true };

test('each kind of offer reads as the website reads it', () => {
  assert.match(describeOffer(base), /^3 for .*140/);
  assert.equal(describeOffer({ ...base, kind: 'PERCENT_OFF', percent: 10 }), '10% off');
  assert.equal(describeOffer({ ...base, kind: 'PERCENT_OFF', percent: 15, min_qty: 3 }), '15% off when you buy 3 or more');
  assert.equal(describeOffer({ ...base, kind: 'BUY_X_GET_Y', buy_qty: 1, get_qty: 1 }), 'Buy 1, get 1 free');
  assert.match(describeOffer({ ...base, kind: 'MIX_BUNDLE' }), /^Any 3 for .*140/);
  const line = offerLine({ ...base, days_of_week: [6, 0, 1], start_time: '16:00', end_time: '18:00', members_only: true, ends_on: '2026-12-31' });
  assert.match(line, /Milk 1L · until 2026-12-31 · Mon, Sat, Sun, 16:00 to 18:00 · customers only/);
  assert.match(offerLine({ ...base, product_name: null, category_name: 'Dairy' }), /All Dairy · no end date/);
});

test('the status: on now, not now, not today, off', () => {
  assert.equal(offerState(base), 'On now'); assert.equal(offerState({ ...base, on_now: false }), 'Not now');
  assert.equal(offerState({ ...base, on_now: false, live: false }), 'Not today'); assert.equal(offerState({ ...base, on_now: false, live: false, is_active: false }), 'Off');
});

test('the form is checked and sent only with what the kind uses', () => {
  const f = emptyOffer();
  assert.notEqual(offerProblem(f), ''); f.name = 'Ten off';
  assert.match(offerProblem(f), /product/); f.product = { product_id: 9, name: 'Tea' }; assert.equal(offerProblem(f), '');
  assert.deepEqual(offerBody(f), { name: 'Ten off', kind: 'PERCENT_OFF', members_only: false, starts_on: undefined, ends_on: undefined, days_of_week: undefined, start_time: undefined, end_time: undefined, product_id: 9, percent: 10, min_qty: 1 });
  assert.notEqual(offerProblem({ ...f, percent: '0' }), ''); assert.notEqual(offerProblem({ ...f, percent: '101' }), '');
  assert.notEqual(offerProblem({ ...f, starts_on: '2026-02-30' }), ''); assert.notEqual(offerProblem({ ...f, starts_on: '2026-13-01' }), ''); assert.notEqual(offerProblem({ ...f, starts_on: '2026-05-02', ends_on: '2026-05-01' }), '');
  assert.notEqual(offerProblem({ ...f, start_time: '16:00' }), ''); assert.notEqual(offerProblem({ ...f, start_time: '25:00', end_time: '18:00' }), ''); assert.equal(offerProblem({ ...f, start_time: '22:00', end_time: '02:00' }), '');
  const mix = { ...emptyOffer(), name: 'Biscuits', kind: 'MIX_BUNDLE' as const, bundle_price: '50', products: [{ product_id: 1, name: 'A' }] };
  assert.match(offerProblem(mix), /two products/); mix.products.push({ product_id: 2, name: 'B' }); assert.equal(offerProblem(mix), '');
  assert.deepEqual(offerBody({ ...mix, days: [1, 2] }).product_ids, [1, 2]); assert.equal(offerBody(mix).product_id, undefined); assert.equal(offerBody(mix).bundle_price, '50');
  const cat = { ...emptyOffer(), name: 'Dairy', target: 'category' as const, category_id: '4', kind: 'BUY_X_GET_Y' as const };
  assert.equal(offerProblem(cat), ''); assert.equal(offerBody(cat).category_id, 4); assert.equal(offerBody(cat).buy_qty, 1); assert.equal(offerBody(cat).percent, undefined);
});

test('products or settings permission opens offers', () => {
  assert.equal(canOffers((p) => p === 'products'), true); assert.equal(canOffers((p) => p === 'settings'), true); assert.equal(canOffers(() => false), false);
});

test('every text of the Offers screens is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(OFFERS_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
