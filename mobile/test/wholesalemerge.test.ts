/* Wholesale and distribution are one app: the field extras (my route, my van) follow the distributor switch the web uses. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDistributor, isWholesale } from '../src/lib/retail.ts';

test('a wholesaler is wholesale, with the field extras only when the switch is on', () => {
  assert.equal(isWholesale({ business_type: 'WHOLESALE' }), true);
  assert.equal(isDistributor({ business_type: 'WHOLESALE' }), false);
  assert.equal(isDistributor({ business_type: 'WHOLESALE', distributor_enabled: false }), false);
  assert.equal(isDistributor({ business_type: 'WHOLESALE', distributor_enabled: true }), true);
});

test('a distributor always has the field extras, whatever the flag says', () => {
  assert.equal(isDistributor({ business_type: 'DISTRIBUTOR' }), true);
  assert.equal(isDistributor({ business_type: 'DISTRIBUTOR', distributor_enabled: false }), true);
});

test('no other business type is wholesale or distributor, even with the flag set', () => {
  for (const t of ['RETAIL', 'AUTO_PARTS', 'RESTAURANT', 'PHARMACY', 'SALON', 'HOTEL']) {
    assert.equal(isWholesale({ business_type: t }), false);
    assert.equal(isDistributor({ business_type: t, distributor_enabled: true }), false);
  }
  assert.equal(isDistributor(null), false);
  assert.equal(isDistributor(undefined), false);
});
