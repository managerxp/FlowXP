import test from 'node:test';
import assert from 'node:assert/strict';
import { effectivePermissions } from '../src/modules/permissions.js';

test('a kitchen cook can do the kitchen and nothing else; a waiter can bill but not see reports', () => {
  const kitchen = effectivePermissions('KITCHEN');
  assert.equal(kitchen.kitchen, true);
  assert.equal(kitchen.billing, false); assert.equal(kitchen.reports, false); assert.equal(kitchen.expenses, false);
  const waiter = effectivePermissions('WAITER');
  assert.equal(waiter.billing, true); assert.equal(waiter.reports, false); assert.equal(waiter.settings, false);
});

test('an owner can do everything, and a person\'s own overrides win in both directions', () => {
  assert.ok(Object.values(effectivePermissions('OWNER')).every(Boolean));
  const cashier = effectivePermissions('CASHIER', { reports: true, billing: false });
  assert.equal(cashier.reports, true, 'switched on for this person');
  assert.equal(cashier.billing, false, 'switched off for this person');
});
