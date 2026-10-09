import test from 'node:test';
import assert from 'node:assert/strict';
import { InputError, toPaise, toQuantity } from '../src/utils/money.js';

test('a quantity or amount that cannot be used is the caller\'s mistake (400), not a crash', () => {
  for (const bad of [0, -2, 'abc', NaN, Infinity, null, undefined]) {
    assert.throws(() => toQuantity(bad), (e) => e instanceof InputError && e.status === 400, `quantity ${String(bad)}`);
  }
  for (const bad of ['abc', NaN, Infinity]) assert.throws(() => toPaise(bad), (e) => e instanceof InputError && e.status === 400, `amount ${String(bad)}`);
  assert.equal(toQuantity('2.5'), 2.5);
  assert.equal(toPaise('199.50'), 19950);
});
