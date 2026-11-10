import test from 'node:test';
import assert from 'node:assert/strict';
import { escposBytes, validLogo } from '../src/lib/escpos.ts';
import { logoFrom } from '../src/lib/printLogo.ts';

const logo = { w: 16, h: 2, data: Buffer.from([0xff, 0x00, 0x0f, 0xf0]).toString('base64') };
const find = (bytes: Uint8Array, seq: number[]) => Buffer.from(bytes).indexOf(Buffer.from(seq));

test('a logo is checked: whole bytes per row, at most 384 x 200, exactly the bytes it says', () => {
  assert.ok(validLogo(logo));
  assert.ok(!validLogo({ ...logo, h: 3 }) && !validLogo({ ...logo, w: 12 }) && !validLogo({ ...logo, w: 392 }) && !validLogo({ ...logo, h: 201 }) && !validLogo(null) && !validLogo({ ...logo, data: '!!' }));
});

test('a thermal receipt starts with the logo as a centred picture, then the text', () => {
  const out = escposBytes('Hello', '58', { logo, cut: false, extraLines: 0 });
  assert.equal(find(out, [0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1d, 0x76, 0x30, 0x00, 2, 0, 2, 0, 0xff, 0x00, 0x0f, 0xf0, 0x0a, 0x1b, 0x61, 0x00]), 0);
  assert.ok(find(out, [...Buffer.from('Hello')]) > 20);
  assert.equal(find(escposBytes('Hello', '58', { logo: { ...logo, h: 9 } }), [0x1d, 0x76, 0x30]), -1);   // a bad logo is simply not printed
  assert.equal(find(escposBytes('Hello', '58', { logo: null }), [0x1d, 0x76, 0x30]), -1);
});

test('the logo comes from the business settings only when it is switched on and valid', () => {
  assert.deepEqual(logoFrom({ logo_bits: logo }), logo);
  assert.equal(logoFrom({ logo_bits: logo, show_logo: false }), null);
  assert.equal(logoFrom({ logo_bits: { ...logo, w: 5 } }), null);
  assert.equal(logoFrom({}), null);
  assert.equal(logoFrom(undefined), null);
});
