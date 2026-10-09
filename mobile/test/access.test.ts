/* What a person is shown follows what they are allowed to do. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { allowed } from '../src/lib/access.ts';

test('any one of the rights is enough; unknown rights do not shut a person out', () => {
  const cashier = { effective_permissions: { billing: true, customers: true, reports: false } };
  assert.equal(allowed(cashier, 'billing'), true);
  assert.equal(allowed(cashier, 'reports'), false);
  assert.equal(allowed(cashier, 'reports', 'customers'), true);
  assert.equal(allowed(cashier, 'expenses'), false);
  assert.equal(allowed({ effective_permissions: {} }, 'reports'), true, 'nothing known yet: the server decides');
  assert.equal(allowed({}, 'reports'), true, 'an older sign-in that has no list yet');
  assert.equal(allowed(null, 'reports'), true);
});
