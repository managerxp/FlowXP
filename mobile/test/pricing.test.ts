/* Price lists: the summary line, the plain-words rule, and what is sent. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { listSummary, newListBody, newListProblem, ruleBody, ruleProblem, ruleText, type RuleDraft } from '../src/lib/pricing.ts';

const money = (n: number) => `₹${n}`;
const base = { kind: 'STANDARD' as const, items: 3, customers: 2, is_default: false, is_active: true, starts_on: null, ends_on: null };

test('a list is summed up in plain words', () => {
  assert.equal(listSummary(base), 'Everyday prices · 3 prices · 2 customers');
  assert.match(listSummary({ ...base, is_default: true }), /for everyone without their own list/);
  assert.match(listSummary({ ...base, kind: 'PROMOTION', items: 1, customers: 0, is_active: false, ends_on: '2026-12-31T00:00:00Z' }), /Offer prices · 1 price · no customer yet · now to 2026-12-31 · switched off/);
});

test('a rule reads as words', () => {
  assert.equal(ruleText({ price: 42, discount_pct: null, min_qty: 1, unit_name: 'carton' }, money), '₹42 per carton');
  assert.equal(ruleText({ price: null, discount_pct: 5, min_qty: 10, unit_name: null }, money), '5% off, from 10 piece');
});

test('a rule is checked before it is sent', () => {
  const d: RuleDraft = { product_id: 7, name: 'Atta', unit_name: 'bag', min_qty: '1', mode: 'price', value: '' };
  assert.equal(ruleProblem(null), 'Choose an item first');
  assert.equal(ruleProblem(d), 'Enter the price');
  assert.equal(ruleProblem({ ...d, value: '0' }), 'Enter the price');
  assert.equal(ruleProblem({ ...d, mode: 'percent', value: '120' }), 'The discount cannot be more than 100%');
  assert.equal(ruleProblem({ ...d, value: '210', min_qty: '0' }), 'Enter how many they must buy for this price');
  assert.equal(ruleProblem({ ...d, value: '210' }), '');
});

test('what is sent: a price or a percentage, never both', () => {
  const d: RuleDraft = { product_id: 7, name: 'Atta', unit_name: 'bag', min_qty: '10', mode: 'price', value: '210' };
  assert.deepEqual(ruleBody(d), { items: [{ product_id: 7, unit_name: 'bag', min_qty: 10, price: 210 }] });
  assert.deepEqual(ruleBody({ ...d, unit_name: null, mode: 'percent', value: '5' }), { items: [{ product_id: 7, min_qty: 10, discount_pct: 5 }] });
});

test('a new list needs a name', () => {
  assert.equal(newListProblem(' a '), 'Give the list a name');
  assert.deepEqual(newListBody(' Dealers ', 'STANDARD'), { name: 'Dealers', kind: 'STANDARD' });
});
