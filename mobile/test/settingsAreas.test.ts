/* Settings is a short list of areas; owner-only ones are hidden from everyone else; every link goes somewhere real. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { AREA_TITLE, SETTINGS_GROUPS, isArea, settingsFor } from '../src/lib/settingsAreas.ts';
import { staggerDelay } from '../src/lib/motionRules.ts';

const lefts = (role: string) => settingsFor(role).flatMap((g) => g.items.map((i) => i.left));

test('the owner sees the business and GST settings; a cashier does not', () => {
  assert.ok(lefts('OWNER').includes('GST settings'));
  assert.ok(lefts('OWNER').includes('Printers and Bluetooth'));
  assert.ok(!lefts('CASHIER').includes('GST settings'));
  assert.ok(!lefts('CASHIER').includes('Business details and receipt'));
  assert.ok(lefts('CASHIER').includes('Printers and Bluetooth'));   // printers are this phone's, not the business's
});

test('every area link opens a known area, and no entry is listed twice', () => {
  const all = SETTINGS_GROUPS.flatMap((g) => g.items);
  for (const i of all.filter((x) => x.go.startsWith('/settings-area'))) assert.ok(isArea(new URL(i.go, 'http://x').searchParams.get('area')), i.go);
  assert.equal(new Set(all.map((i) => i.go)).size, all.length);
  assert.equal(Object.keys(AREA_TITLE).length, 8);
});

test('a list fades in with a short stagger that never exceeds a quarter second', () => {
  assert.deepEqual([0, 1, 2].map((i) => staggerDelay(i)), [0, 40, 80]);
  assert.equal(staggerDelay(50), 240);
  assert.equal(staggerDelay(-3), 0);
});
