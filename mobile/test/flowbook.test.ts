import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOWBOOK_TEXTS, checkLine, financialYear, hasBooks, money, overdueOf, todayISO } from '../src/lib/flowbook.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

test('the financial year runs April to March', () => {
  assert.deepEqual(financialYear('2026-11-05'), { from: '2026-04-01', to: '2027-03-31', label: 'FY 2026-27' });
  assert.deepEqual(financialYear('2027-03-31'), { from: '2026-04-01', to: '2027-03-31', label: 'FY 2026-27' });
  assert.equal(financialYear('2027-04-01').label, 'FY 2027-28'); assert.equal(todayISO(new Date(2026, 10, 5)), '2026-11-05');
});

test('overdue is everything past due; money is rupees; the books check line', () => {
  const a = { total: '900.00', rows: [{ days_1_30: '100.50', days_31_60: '0', days_61_90: '50', days_over_90: '25' }, { days_1_30: '10', days_31_60: '0', days_61_90: '0', days_over_90: '0' }] };
  assert.equal(overdueOf(a), 185.5); assert.equal(overdueOf(null), 0);
  assert.equal(money('1234.5'), '₹1,234.50'); assert.equal(money(null), '₹0.00');
  assert.equal(checkLine({ issues: [] }), ''); assert.equal(checkLine({ issues: ['a', 'b', 'c', 'd'] }), 'a · b · c (+1)'); assert.equal(checkLine(null), '');
});

test('FlowBook shows only when the plan has it', () => {
  const b = (flags: Record<string, boolean>, business_type = 'RESTAURANT') => ({ business_type, subscription: { feature_flags: flags } }) as never;
  assert.equal(hasBooks(b({ flowbook_app: true, flowbook: true })), true);
  assert.equal(hasBooks(b({ flowbook_app: false })), false); assert.equal(hasBooks(b({ flowbook: false })), false);
  assert.equal(hasBooks(b({ flowbook: false }, 'FLOWBOOK')), true);
});

test('every text of the FlowBook screen is translated into all six languages', () => {
  const missing: string[] = [];
  for (const [name, dict] of Object.entries({ HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>)) for (const k of new Set(FLOWBOOK_TEXTS)) if (!(k in dict)) missing.push(`${name}: ${k}`);
  assert.deepEqual(missing, []);
});
