import test from 'node:test';
import assert from 'node:assert/strict';
import { GARAGE_TEXTS, emptyMoney, garageTypes, mergeNames, moneyProblem, moneyRequest, rangeFor, suggestNames } from '../src/lib/garage.ts';
import { HI } from '../src/lib/i18n.ts';
import { ML, TA, BN, TE, KN } from '../src/lib/i18n.more.ts';

test('periods run from the right day', () => {
  const now = new Date(2026, 10, 4);
  assert.deepEqual(rangeFor('today', now), { from: '2026-11-04', to: '2026-11-04' });
  assert.deepEqual(rangeFor('week', now), { from: '2026-10-29', to: '2026-11-04' });
  assert.deepEqual(rangeFor('month', now), { from: '2026-11-01', to: '2026-11-04' });
});

test('money entry: needs an amount, and a customer for a customer payment; goes to the right place', () => {
  const f = emptyMoney('in');
  assert.equal(moneyProblem(f), 'Choose a customer');
  f.customer_id = 3; assert.equal(moneyProblem(f), 'Enter an amount above zero');
  f.amount = '500'; assert.equal(moneyProblem(f), '');
  assert.deepEqual(moneyRequest(f), { path: '/payments', body: { customer_id: 3, amount: 500, method: 'CASH' } });
  const o = emptyMoney('out'); o.amount = '120'; assert.equal(moneyProblem(o), '');
  assert.equal(moneyRequest(o).path, '/expenses');
  const i = emptyMoney('in'); i.kind = 'OTHER_IN'; i.amount = '60'; assert.equal(moneyRequest(i).path, '/other-income');
});

test('a bike garage sees bikes only, a car garage cars, others both', () => {
  assert.deepEqual(garageTypes('BIKE').map((x) => x.id), ['BIKE']);
  assert.deepEqual(garageTypes('CAR').map((x) => x.id), ['CAR']);
  assert.deepEqual(garageTypes('BOTH').map((x) => x.id), ['CAR', 'BIKE']);
  assert.deepEqual(garageTypes(null).map((x) => x.id), ['CAR', 'BIKE']);
});

test('vehicle suggestions: merged once, best matches first, a full name is not suggested again', () => {
  const names = mergeNames(['Maruti Suzuki', 'Hero'], ['maruti suzuki', 'Mahindra', 'Maserati']);
  assert.equal(names.length, 4);
  assert.deepEqual(suggestNames(names, 'ma'), ['Mahindra', 'Maruti Suzuki', 'Maserati']);
  assert.deepEqual(suggestNames(names, 'Hero'), []);
});

test('every garage text is translated into all six languages', () => {
  const ph = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [n, d] of Object.entries(dicts)) for (const k of new Set(GARAGE_TEXTS)) { if (!(k in d)) missing.push(`${n}: ${k}`); else assert.equal(ph(d[k]), ph(k), `${n}: ${k}`); }
  assert.deepEqual(missing, []);
});
