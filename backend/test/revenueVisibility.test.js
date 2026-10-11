import test from 'node:test';
import assert from 'node:assert/strict';
import { seesRevenue } from '../src/controllers/dashboard.controller.js';

test('takings are for people who handle money or run the business', () => {
  for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER']) assert.equal(seesRevenue({ role, permissions: {} }), true, role);
  for (const role of ['WAITER', 'KITCHEN']) assert.equal(seesRevenue({ role, permissions: {} }), false, role);
  assert.equal(seesRevenue({ role: 'WAITER', permissions: { reports: true } }), true);
});
