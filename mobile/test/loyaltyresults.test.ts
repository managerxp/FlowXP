import test from 'node:test';
import assert from 'node:assert/strict';
import { HI } from '../src/lib/i18n.ts';
import { ML, TA, BN, TE, KN } from '../src/lib/i18n.more.ts';
import { PERIODS, RESULTS_TEXTS, canSeeResults, money, problemCount, resultsPath, share } from '../src/lib/loyaltyResults.ts';

test('only an owner or admin sees card results', () => {
  assert.equal(canSeeResults('OWNER'), true); assert.equal(canSeeResults('ADMIN'), true); assert.equal(canSeeResults('CASHIER'), false); assert.equal(canSeeResults(undefined), false);
});

test('the period asked for is one the server offers; anything else becomes 30 days', () => {
  assert.equal(resultsPath('7'), '/loyalty/analytics?days=7'); assert.equal(resultsPath('365'), '/loyalty/analytics?days=365');
  assert.equal(resultsPath('9999'), '/loyalty/analytics?days=30'); assert.equal(resultsPath('1; drop'), '/loyalty/analytics?days=30');
  assert.deepEqual(PERIODS.map((p) => p.id), ['7', '30', '90', '365']);
});

test('money arrives as paise and a share is a dash when nobody is a member', () => {
  assert.equal(money('0'), money(0)); assert.match(money('15000'), /150/); assert.equal(share(null), '-'); assert.equal(share(67), '67%');
});

test('the health check is counted across every kind of problem', () => {
  assert.equal(problemCount({ problems: [] }), 0);
  assert.equal(problemCount({ problems: [{ code: 'A', text: 'x', ids: [1, 2] }, { code: 'B', text: 'y', ids: [3] }] }), 3);
});

test('every text of the results screen is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(RESULTS_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
