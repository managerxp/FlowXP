import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLaterDay, payablePaise } from '../src/modules/salon/appointmentRules.js';

test('the amount quoted is what the till charges: GST on top, or inside the price, or none, with round-off', () => {
  const line = { price_paise: 45000, tax_rate: '18', price_includes_tax: false };
  const till = { gstEnabled: true, gstSettings: null, taxInclusive: false, roundOff: false };
  assert.equal(payablePaise([line], till), 53100);
  assert.equal(payablePaise([line], { ...till, taxInclusive: true }), 45000);
  assert.equal(payablePaise([line], { ...till, gstEnabled: false }), 45000);
  assert.equal(payablePaise([line], { ...till, gstSettings: { composite: true } }), 45000);
  assert.equal(payablePaise([{ ...line, price_paise: 8000 }], { ...till, roundOff: true }), 9400);
});

test('only a later day in the salon\'s own calendar is refused', () => {
  const now = new Date('2026-11-27T20:00:00Z');   // 28 Nov, 01:30 in India
  assert.equal(isLaterDay('2026-11-28T14:00:00Z', 'Asia/Kolkata', now), false);
  assert.equal(isLaterDay('2026-11-29T05:00:00Z', 'Asia/Kolkata', now), true);
  assert.equal(isLaterDay('2026-11-26T05:00:00Z', 'Asia/Kolkata', now), false);
});
