/*
 * The India PIN code lookup (modules/geo/pincode.js, real India Post data via
 * the india-pincode package — not a hand-typed table) and its route. Pure
 * function, no database.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePincode } from '../src/modules/geo/pincode.js';
import { pincode } from '../src/controllers/locations.controller.js';

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });

test('resolves a real PIN to its city, state and district', () => {
  assert.deepEqual(resolvePincode('500001'), { pincode: '500001', city: 'Hyderabad', district: 'Hyderabad', state: 'Telangana', country: 'India' });
  const bengaluru = resolvePincode('560001');
  assert.deepEqual([bengaluru.state, bengaluru.country], ['Karnataka', 'India']);
  const delhi = resolvePincode('110001');
  assert.deepEqual([delhi.state, delhi.country], ['Delhi', 'India']);
});

test('the returned state name matches lib/states.js exactly (round-trips through the same GST alias table)', () => {
  // A handful of states India Post sometimes spells differently from the canonical GST name.
  const cases = [['500001', 'Telangana'], ['682001', 'Kerala'], ['605001', 'Puducherry']];
  for (const [pin, expected] of cases) {
    const r = resolvePincode(pin);
    assert.equal(r.state, expected, `${pin} → ${r?.state}`);
  }
});

test('never fabricates a result: bad shape, wrong length, and a pincode that does not exist all return null', () => {
  assert.equal(resolvePincode('12345'), null, 'too short');
  assert.equal(resolvePincode('1234567'), null, 'too long');
  assert.equal(resolvePincode('000000'), null, 'cannot start with 0');
  assert.equal(resolvePincode('abcdef'), null, 'not digits');
  assert.equal(resolvePincode(''), null);
  assert.equal(resolvePincode(null), null);
  assert.equal(resolvePincode('999999'), null, 'well-formed but not a real PIN — no guessing');
});

test('the route: 200 with data for a real PIN, 404 with no fabricated data for an unreal one', () => {
  const ok = fakeRes(); pincode({ params: { code: '500001' } }, ok);
  assert.equal(ok.code, 200);
  assert.equal(ok.body.data.city, 'Hyderabad');

  const missing = fakeRes(); pincode({ params: { code: '999999' } }, missing);
  assert.equal(missing.code, 404);
  assert.equal(missing.body.data, undefined);
});
