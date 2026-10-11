import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discountPct, pinProblem, needsApproval } from '../src/modules/approvals.js';

test('discount is a share of what it comes off', () => {
  assert.equal(discountPct(2000, 10000), 20);
  assert.equal(discountPct(500, 0), 0);
});

test('a PIN is 4 to 8 digits', () => {
  for (const ok of ['1234', '12345678']) assert.equal(pinProblem(ok), '');
  for (const bad of ['123', '123456789', '12a4', '', null, undefined]) assert.notEqual(pinProblem(bad), '');
});

test('owners and managers need no approval, cashiers do', () => {
  assert.equal(needsApproval({ role: 'OWNER', permissions: {} }), false);
  assert.equal(needsApproval({ role: 'MANAGER', permissions: {} }), false);
  assert.equal(needsApproval({ role: 'CASHIER', permissions: {} }), true);
});
