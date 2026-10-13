import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryStage, hasNewOrders, itemsText, nextStep, pendingTotal, platformLabel, rejectBody, waitedText } from '../src/lib/delivery.ts';

test('platforms are named, an unknown one is tidied, none means online', () => {
  assert.equal(platformLabel('ZOMATO'), 'Zomato');
  assert.equal(platformLabel('swiggy'), 'Swiggy');
  assert.equal(platformLabel('DUNZO'), 'Dunzo');
  assert.equal(platformLabel(null), 'Online');
});

test('how long an order has waited', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  assert.equal(waitedText('2026-10-13T11:59:40Z', now), 'just now');
  assert.equal(waitedText('2026-10-13T11:59:00Z', now), '1 min ago');
  assert.equal(waitedText('2026-10-13T11:45:00Z', now), '15 min ago');
  assert.equal(waitedText('2026-10-13T10:30:00Z', now), '1 h 30 min ago');
});

test('what is ordered, in a line and as a total', () => {
  const o = { items: [{ order_item_id: 1, description: 'Paneer tikka', quantity: 2, unit_price: 250.5 }, { order_item_id: 2, description: 'Naan', quantity: 3, unit_price: 40 }, { order_item_id: 3, description: 'Lassi', quantity: 1, unit_price: 90 }, { order_item_id: 4, description: 'Raita', quantity: 1, unit_price: 60 }] };
  assert.equal(pendingTotal(o), 771);
  assert.equal(itemsText(o), '2 x Paneer tikka, 3 x Naan, 1 x Lassi and 1 more');
  assert.equal(itemsText({ items: o.items.slice(0, 2) }), '2 x Paneer tikka, 3 x Naan');
});

test('a delivery needs a rider, then goes picked up, out, delivered in that order', () => {
  const o = { rider_user_id: null as number | null, picked_up_at: null as string | null, out_for_delivery_at: null as string | null, delivered_at: null as string | null };
  assert.equal(nextStep(o), null); assert.equal(deliveryStage(o), 'Needs a rider');
  o.rider_user_id = 7;
  assert.equal(nextStep(o), 'PICKED_UP'); assert.equal(deliveryStage(o), 'Rider assigned');
  o.picked_up_at = 'x';
  assert.equal(nextStep(o), 'OUT_FOR_DELIVERY'); assert.equal(deliveryStage(o), 'Picked up');
  o.out_for_delivery_at = 'x';
  assert.equal(nextStep(o), 'DELIVERED'); assert.equal(deliveryStage(o), 'Out for delivery');
  o.delivered_at = 'x';
  assert.equal(nextStep(o), null); assert.equal(deliveryStage(o), 'Delivered');
});

test('a reason for turning an order down is optional and kept short', () => {
  assert.deepEqual(rejectBody('  '), {});
  assert.deepEqual(rejectBody(' Out of paneer '), { reason: 'Out of paneer' });
  assert.equal((rejectBody('x'.repeat(500)) as { reason: string }).reason.length, 300);
});

test('the phone buzzes only when more orders are waiting than before', () => {
  assert.equal(hasNewOrders(0, 1), true);
  assert.equal(hasNewOrders(2, 2), false);
  assert.equal(hasNewOrders(3, 1), false);
});
