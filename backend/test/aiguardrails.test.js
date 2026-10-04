/* Flow AI's figure check and Gemini's safety filter: no database, no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { figuresIn, ungrounded } from '../src/modules/ai/grounding.js';
import { toGeminiBody } from '../src/modules/ai/provider.js';

const facts = [{ net_revenue: 118450, orders: 154, previous: { net_revenue: 99065 }, by_channel: [{ total: 34820 }, { total: 19420.75 }] }];

test('figures an answer states are read with commas, rupee signs and lakh/crore/k words, and small numbers or years are ignored', () => {
  assert.deepEqual(figuresIn('Sales were ₹1,18,450 on 154 bills in 2026 (up 12%) on 2026-10-04').map((f) => f.value), [118450]);
  assert.deepEqual(figuresIn('about ₹1.2 lakh, or Rs. 45k').map((f) => f.value), [120000, 45000]);
  assert.deepEqual(figuresIn('Rs 2.5 crore'), [{ text: 'Rs 2.5 crore', value: 25000000, rounded: true }]);
});

test('a figure the tools returned, rounded, summed or differenced, passes', () => {
  assert.deepEqual(ungrounded('Net sales were ₹1,18,450.', facts), []);
  assert.deepEqual(ungrounded('Sales were about ₹1.2 lakh.', facts), []);                          // rounding up to 5% on a "lakh"
  assert.deepEqual(ungrounded('Up ₹19,385 on the week before.', facts), []);                       // 118450 - 99065
  assert.deepEqual(ungrounded('Counter and dine-in together: ₹54,240.75.', facts), []);            // 34820 + 19420.75
});

test('a figure no tool returned is flagged, and an answer with no big figures is left alone', () => {
  assert.deepEqual(ungrounded('Sales were ₹2,50,000.', facts).map((f) => f.value), [250000]);
  assert.deepEqual(ungrounded('You had 154 bills, 12% more than before.', facts), []);
  assert.equal(ungrounded('Sales were ₹5,000.', []).length, 1, 'with no tool results nothing can back a figure');
});

test('Gemini requests carry safety settings', () => {
  const body = toGeminiBody({ system: 's', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(body.safetySettings.length, 4);
  assert.ok(body.safetySettings.every((s) => s.threshold === 'BLOCK_MEDIUM_AND_ABOVE' && s.category.startsWith('HARM_CATEGORY_')));
});
