/* The subscription on the phone: who sees it, the wording, the price, only https links, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SUBSCRIPTION_TEXTS, canSubscription, cycleText, dateText, payText, planPrice, safeLink, statusLabel } from '../src/lib/subscription.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

test('only the owner; status words; dates; prices', () => {
  assert.equal(canSubscription('OWNER'), true); assert.equal(canSubscription('ADMIN'), false); assert.equal(canSubscription(undefined), false);
  assert.equal(statusLabel('TRIAL'), 'Free trial'); assert.equal(statusLabel('EXPIRED'), 'Trial ended'); assert.equal(dateText(null), '—'); assert.match(dateText('2026-11-05T00:00:00Z'), /Nov 2026/);
  assert.equal(planPrice({ plan_code: 'p', name: 'Pro', description: '', price_monthly_paise: 99900 }), '₹999.00/month'); assert.equal(planPrice({ plan_code: 'e', name: 'Ent', description: '', price_monthly_paise: 0 }), 'Pricing on request');
  assert.equal(cycleText('MONTHLY'), 'monthly'); assert.equal(payText({ amount: 1499, billing_cycle: 'YEARLY' }), '₹1,499.00 / yearly');
});
test('only a secure link is opened', () => { assert.equal(safeLink('https://pay.cashfree.com/x'), 'https://pay.cashfree.com/x'); assert.equal(safeLink('http://x'), null); assert.equal(safeLink('javascript:alert(1)'), null); assert.equal(safeLink(null), null); });

test('every text of the subscription screen is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(SUBSCRIPTION_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
