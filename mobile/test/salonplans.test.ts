/* The salon's membership plans and packages. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPackage, blankPlan, daysText, packageBody, packageChanged, packageFrom, packageLine, packageProblem, planBody, planChanged, planFrom, planLine, planProblem, savingText, valueOf, type Package, type Plan } from '../src/lib/salonPlans.ts';

const money = (n: number) => `₹${n}`;
const gold: Plan = { plan_id: 1, name: 'Gold', description: null, price: 5000, tax_rate: 18, duration_days: 365, is_active: true, active_members: 3,
  benefits: { discount_pct: 10, discount_applies_to: ['SERVICE'], free_services: [{ service_id: 7, qty: 2 }], priority_booking: true, points_multiplier: 2, perks: ['Free tea'] } };
const bridal: Package = { package_id: 2, name: 'Bridal', description: null, price: 6000, tax_rate: 18, validity_days: 90, is_active: true, services_value: 7500, saving: 1500, items: [{ service_id: 7, name: 'Facial', quantity: 3 }, { service_id: 8, name: 'Cut', quantity: 1 }] };

test('days in words', () => { assert.deepEqual([30, 90, 365, 60, 730, 45].map(daysText), ['1 month', '3 months', '1 year', '2 months', '2 years', '45 days']); });

test('a plan needs a name, a price, a length and something to give', () => {
  const d = blankPlan();
  assert.equal(planProblem(d), 'Give the plan a name');
  assert.equal(planProblem({ ...d, name: 'Gold' }), 'Enter the price');
  assert.equal(planProblem({ ...d, name: 'Gold', price: '5000' }), 'Give the plan something: a discount, free services or priority booking');
  assert.equal(planProblem({ ...d, name: 'Gold', price: '5000', discount: '120' }), 'The discount must be from 0 to 100 percent');
  assert.equal(planProblem({ ...d, name: 'Gold', price: '5000', discount: '10', days: '0' }), 'Enter how many days it lasts');
  assert.equal(planProblem({ ...d, name: 'Gold', price: '5000', free: [{ service_id: 7, qty: '0' }] }), 'Each free service needs a number of 1 or more');
  assert.equal(planProblem({ ...d, name: 'Gold', price: '5000', discount: '10' }), '');
});

test('what is sent for a plan, and the benefits it already had are kept', () => {
  const d = planFrom(gold);
  const b = planBody(d);
  assert.deepEqual(b.benefits, { discount_pct: 10, discount_applies_to: ['SERVICE'], free_services: [{ service_id: 7, qty: 2 }], priority_booking: true, points_multiplier: 2, perks: ['Free tea'] });
  assert.deepEqual(planChanged(d, d), {});
  assert.deepEqual(planChanged(d, { ...d, price: '5500' }), { price: 5500 });
  const more = planChanged(d, { ...d, discount: '15' });
  assert.deepEqual(Object.keys(more), ['benefits']);
  assert.equal((more.benefits as { points_multiplier: number }).points_multiplier, 2, 'the extra points and perks go along, so they are not lost');
  assert.deepEqual(planBody({ ...blankPlan(), name: 'X', price: '1', discount: '5', applies: 'BOTH' }).benefits.discount_applies_to, ['SERVICE', 'PRODUCT']);
});

test('a plan reads in one line', () => {
  assert.equal(planLine(gold), '1 year · 10% off · 1 free service · priority booking · 3 members');
  assert.equal(planLine({ ...gold, benefits: { discount_pct: 5 }, active_members: 0, is_active: false }), '1 year · 5% off · switched off');
});

test('a package needs services, each at least one visit', () => {
  const d = blankPackage();
  assert.equal(packageProblem(d), 'Give the package a name');
  assert.equal(packageProblem({ ...d, name: 'Bridal', price: '6000' }), 'Add at least one service');
  assert.equal(packageProblem({ ...d, name: 'Bridal', price: '6000', items: [{ service_id: 7, qty: '0' }] }), 'Each service needs a number of 1 or more');
  assert.equal(packageProblem({ ...d, name: 'Bridal', price: '6000', items: [{ service_id: 7, qty: '3' }] }), '');
});

test('what is sent for a package, and only what changed', () => {
  const d = packageFrom(bridal);
  assert.deepEqual(packageBody(d).items, [{ service_id: 7, quantity: 3 }, { service_id: 8, quantity: 1 }]);
  assert.deepEqual(packageChanged(d, d), {});
  assert.deepEqual(packageChanged(d, { ...d, price: '6500', days: '180' }), { price: 6500, validity_days: 180 });
  assert.deepEqual(Object.keys(packageChanged(d, { ...d, items: [{ service_id: 7, qty: '4' }, d.items[1]] })), ['items']);
  assert.equal(packageLine(bridal), '3 months · 4 visits · saves the client money');
});

test('what the package is worth, and what the client saves', () => {
  const services = [{ service_id: 7, name: 'Facial', price: 2000 }, { service_id: 8, name: 'Cut', price: 1500 }];
  const items = [{ service_id: 7, qty: '3' }, { service_id: 8, qty: '1' }];
  assert.equal(valueOf(items, services), 7500);
  assert.match(savingText('6000', 7500, money), /the client saves ₹1500/);
  assert.match(savingText('7500', 7500, money), /no saving/);
  assert.match(savingText('9000', 7500, money), /costs more/);
  assert.equal(savingText('', 7500, money), '');
});
