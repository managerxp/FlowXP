import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPassword } from '../src/utils/validate.js';
import { isFresh } from '../src/modules/payments/cashfree.js';

test('passwords: 10 or more, and not an obvious one', () => {
  assert.notEqual(checkPassword('short123'), null);
  assert.notEqual(checkPassword('Password123'), null);
  assert.notEqual(checkPassword('1234567890'), null);
  assert.notEqual(checkPassword('aaaaaaaaaaaa'), null);
  assert.equal(checkPassword('blue-tiger-lamp'), null);
});

test('a webhook older than 15 minutes is stale, in ms or seconds', () => {
  const now = Date.now();
  assert.equal(isFresh(String(now - 60_000)), true);
  assert.equal(isFresh(String(now - 3_600_000)), false);
  assert.equal(isFresh(String(Math.floor((now - 3_600_000) / 1000))), false);
  assert.equal(isFresh(String(Math.floor(now / 1000))), true);
  assert.equal(isFresh('not a number'), true);
});

import { checkSignupType, checkBusinessType, SIGNUP_TYPES } from '../src/utils/validate.js';

test('a new business can only be one of the built industries; older types are still known', () => {
  for (const t of SIGNUP_TYPES) assert.equal(checkSignupType(t), null, t);
  for (const t of ['ELECTRONICS', 'CLOTHING', 'GAMING_CAFE', 'RACING', 'SERVICES', 'OTHER', 'nonsense', '', null]) assert.notEqual(checkSignupType(t), null, String(t));
  for (const t of ['ELECTRONICS', 'OTHER']) assert.equal(checkBusinessType(t), null, `${t} still valid for an existing business`);
});
