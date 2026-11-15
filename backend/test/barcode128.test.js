import test from 'node:test';
import assert from 'node:assert/strict';
import { code128, PATTERNS } from '../../frontend/src/lib/barcode.js';

/* A small decoder, to prove what the printed bars say is the text we meant (what a scanner would read back). */
const decode = (widths) => {
  const body = [];
  let rest = widths;
  while (rest.length > 7) { body.push(PATTERNS.findIndex((p) => p !== PATTERNS[106] && rest.startsWith(p))); rest = rest.slice(6); }
  assert.equal(rest, PATTERNS[106], 'ends with the stop pattern');
  const [start, ...data] = body; const check = data.pop();
  assert.equal(body.slice(0, -1).reduce((s, c, i) => s + c * (i === 0 ? 1 : i), 0) % 103, check, 'checksum');
  let set = start === 105 ? 'C' : 'B'; let out = '';
  for (const c of data) {
    if (set === 'C') { if (c === 100) set = 'B'; else out += String(c).padStart(2, '0'); } else out += String.fromCharCode(c + 32);
  }
  return out;
};

test('a number-only barcode is packed in pairs and reads back the same', () => {
  for (const t of ['2000000012100', '200000001210', '123456', '12345', 'SKU-12', 'A1B2C3']) assert.equal(decode(code128(t)), t, t);
  assert.ok(code128('2000000012100').length < code128('SKU-12345678').length + 20);
  const widths = (t) => [...code128(t)].reduce((s, d) => s + Number(d), 0);
  assert.ok(widths('2000000012100') < 140, 'narrower than one symbol per digit (about 178)');
});
