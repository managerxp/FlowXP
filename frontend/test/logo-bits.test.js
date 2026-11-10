import test from 'node:test';
import assert from 'node:assert/strict';
import { bitsFromRgba, dotSize } from '../src/lib/logoBits.js';

test('black pixels become set bits, left dot in the top bit; transparent and light ones stay white', () => {
  const px = (r, g, b, a = 255) => [r, g, b, a];
  const row = [px(0, 0, 0), px(255, 255, 255), px(0, 0, 0, 0), px(20, 20, 20), px(200, 200, 200), px(0, 0, 0), px(255, 255, 255), px(0, 0, 0)].flat();
  const { w, h, data } = bitsFromRgba(Uint8Array.from(row), 8, 1);
  assert.deepEqual([w, h], [8, 1]);
  assert.equal(atob(data).charCodeAt(0), 0b10010101);
});

test('the drawing size keeps the shape, fits 384 x 200 and is a multiple of 8 wide', () => {
  assert.deepEqual(dotSize(1000, 500), { w: 384, h: 192 });
  assert.deepEqual(dotSize(1000, 1000), { w: 200, h: 200 });
  assert.deepEqual(dotSize(100, 50), { w: 96, h: 50 });
});
