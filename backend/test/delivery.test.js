/*
 * Every delivery adapter's parseWebhookOrder() is a pure function turning one
 * platform's payload shape into the same normalized order shape — the one
 * place a malformed or subtly-wrong parse would silently mis-price a
 * delivery order's kitchen ticket. No database needed.
 *
 * Run: npm test
 */
process.env.DATABASE_URL ||= 'postgres://unused/unused';
process.env.JWT_SECRET ||= 'test-secret-not-used-for-signing-anything-real';

import test from 'node:test';
import assert from 'node:assert/strict';

const zomato = await import('../src/modules/delivery/adapters/zomato.js');
const swiggy = await import('../src/modules/delivery/adapters/swiggy.js');
const ondc = await import('../src/modules/delivery/adapters/ondc.js');
const magicpin = await import('../src/modules/delivery/adapters/magicpin.js');
const { getAdapter, PLATFORMS } = await import('../src/modules/delivery/registry.js');

const ADAPTERS = { ZOMATO: zomato, SWIGGY: swiggy, ONDC: ondc, MAGICPIN: magicpin };

test('every platform is reachable through the registry and matches its own module', () => {
  for (const platform of PLATFORMS) {
    assert.equal(getAdapter(platform), ADAPTERS[platform]);
  }
  assert.throws(() => getAdapter('DOORDASH'), /Unknown delivery platform/);
});

test('each adapter normalizes its own sample payload to the common order shape', () => {
  for (const platform of PLATFORMS) {
    const adapter = ADAPTERS[platform];
    const payload = adapter.generateSamplePayload();
    const order = adapter.parseWebhookOrder(payload);

    assert.ok(order.external_order_id, `${platform}: missing external_order_id`);
    assert.ok(order.items.length > 0, `${platform}: no items parsed`);
    for (const item of order.items) {
      assert.ok(item.description, `${platform}: item missing description`);
      assert.ok(item.quantity > 0, `${platform}: item quantity must be positive`);
      assert.ok(item.unit_price >= 0, `${platform}: item price must not be negative`);
    }
  }
});

test('zomato: fields map to the names its payload actually uses', () => {
  const order = zomato.parseWebhookOrder({
    order: {
      id: 'Z1', display_id: '#42', customer: { name: 'Asha', phone: '+911111111111' },
      items: [{ name: 'Dosa', quantity: 2, price: 90 }], instructions: 'no chutney'
    }
  });
  assert.deepEqual(order, {
    external_order_id: 'Z1', external_order_number: '#42',
    customer_name: 'Asha', customer_phone: '+911111111111',
    items: [{ description: 'Dosa', quantity: 2, unit_price: 90 }],
    notes: 'no chutney'
  });
});

test('swiggy: reads items from the nested cart, not the top level', () => {
  const order = swiggy.parseWebhookOrder({
    order_id: 'S1', order_number: 'SW-1', customer_details: { name: 'Bala', mobile: '+912222222222' },
    cart: { items: [{ item_name: 'Idli', quantity: 4, item_price: 20 }] }, special_instructions: null
  });
  assert.equal(order.items.length, 1);
  assert.equal(order.items[0].description, 'Idli');
  assert.equal(order.notes, null);
});

test('ondc: unwraps the Beckn-style message.order nesting', () => {
  const order = ondc.parseWebhookOrder({
    context: { transaction_id: 'txn-1' },
    message: { order: {
      id: 'O1', billing: { name: 'Chitra', phone: '+913333333333' },
      items: [{ descriptor: { name: 'Filter Coffee' }, quantity: { count: 3 }, price: { value: '25' } }]
    } }
  });
  assert.equal(order.external_order_number, 'txn-1');
  assert.equal(order.items[0].quantity, 3);
  assert.equal(order.items[0].unit_price, 25);
});

test('magicpin: reads lineItems with its own field names', () => {
  const order = magicpin.parseWebhookOrder({
    orderId: 'M1', orderRef: 'MP-1', customer: { fullName: 'Deepak', contactNumber: '+914444444444' },
    lineItems: [{ title: 'Thali', qty: 1, rate: 150 }]
  });
  assert.equal(order.items[0].description, 'Thali');
  assert.equal(order.items[0].unit_price, 150);
});

test('every adapter rejects a payload with no items rather than silently billing zero', () => {
  assert.throws(() => zomato.parseWebhookOrder({ order: { id: 'Z1', items: [] } }));
  assert.throws(() => swiggy.parseWebhookOrder({ order_id: 'S1', cart: { items: [] } }));
  assert.throws(() => ondc.parseWebhookOrder({ message: { order: { id: 'O1', items: [] } } }));
  assert.throws(() => magicpin.parseWebhookOrder({ orderId: 'M1', lineItems: [] }));
});

test('mock adapters accept every webhook — verifySignature is a documented stub', () => {
  for (const platform of PLATFORMS) {
    assert.equal(ADAPTERS[platform].verifySignature({}, {}), true);
  }
});
