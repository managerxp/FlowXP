import test from 'node:test';
import assert from 'node:assert/strict';
import { INCOME_TEXTS, incomeBody, incomeProblem, incomeUrl } from '../src/lib/otherIncome.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

test('the income form: what is checked and what is sent', () => {
  assert.equal(incomeProblem('', '10'), 'Choose what it was for'); assert.equal(incomeProblem('Interest', '0'), 'Enter the amount'); assert.equal(incomeProblem('Interest', '250.5'), '');
  assert.deepEqual(incomeBody(' Interest ', '250.5', 'UPI', ' bank '), { category: 'Interest', amount: 250.5, payment_method: 'UPI', description: 'bank' });
  assert.deepEqual(incomeBody('Other', '5', 'CASH', ''), { category: 'Other', amount: 5, payment_method: 'CASH' });
  assert.equal(incomeUrl('2026-10-01', '2026-10-31'), '/other-income?from=2026-10-01&to=2026-10-31');
});

test('every text of the Other income screen is translated into all six languages', () => {
  const missing: string[] = [];
  for (const [name, dict] of Object.entries({ HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>)) for (const k of new Set(INCOME_TEXTS)) if (!(k in dict)) missing.push(`${name}: ${k}`);
  assert.deepEqual(missing, []);
});
