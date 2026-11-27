import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { logoBitsFrom } from '../src/modules/logoBits.js';
import { validLogoBits } from '../src/modules/escpos.js';

test('a bright colour prints black, the white around it is cut off, and the result is what a printer takes', async () => {
  const cyan = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#00e5d0' } }).png().toBuffer();
  const png = await sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: cyan, left: 200, top: 100 }]).png().toBuffer();
  const bits = await logoBitsFrom(png);
  assert.ok(validLogoBits(bits));
  assert.equal(bits.h, 96);   // trimmed to the square, then as tall as a printed logo is
  const black = [...Buffer.from(bits.data, 'base64')].reduce((n, b) => n + b.toString(2).split('1').length - 1, 0);
  assert.ok(black >= 96 * 96 * 0.98, `black dots ${black}`);
});
