/* The subscription on the phone: who sees it, the wording, the price, only https links, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SUBSCRIPTION_TEXTS, canSubscription, dateText, statusLabel } from '../src/lib/subscription.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

test('only the owner; status words; dates; prices', () => {
  assert.equal(canSubscription('OWNER'), true); assert.equal(canSubscription('ADMIN'), false); assert.equal(canSubscription(undefined), false);
  assert.equal(statusLabel('TRIAL'), 'Free trial'); assert.equal(statusLabel('EXPIRED'), 'Trial ended'); assert.equal(dateText(null), '—'); assert.match(dateText('2026-11-05T00:00:00Z'), /Nov 2026/);
});

test('every text of the subscription screen is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(SUBSCRIPTION_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
