import test from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS, escposBytes, fitLine, printable, toBase64 } from '../src/lib/escpos.ts';
import { cleanUpi, upiLabel, upiProblem } from '../src/lib/upi.ts';

test('the rupee sign and accents become what a thermal printer can print', () => {
  assert.equal(printable('Total ₹1,250.00'), 'Total Rs.1,250.00');
  assert.equal(printable('Café – 2 × Latte'), 'Cafe - 2 x Latte');
  assert.ok(!/[^ -~]/.test(printable('कॉफ़ी')), 'other scripts do not come out as rubbish bytes');
  assert.ok(!/[^\x20-\x7e\n]/.test(printable('Tea ☕ “ok” …')), 'nothing outside plain printable characters is left');
});

test('a long line is cut at a space, never in the middle of a word when it can be avoided', () => {
  assert.deepEqual(fitLine('Masala Chai with extra ginger', 16), ['Masala Chai with', 'extra ginger']);
  assert.deepEqual(fitLine('short', 32), ['short']);
  assert.deepEqual(fitLine('Supercalifragilisticexpialidocious', 10).map((l) => l.length), [10, 10, 10, 4]);
});

test('the receipt becomes: initialise, the lines, feed, cut', () => {
  const b = escposBytes('Hello\nTotal Rs.10', '58');
  assert.deepEqual([...b.slice(0, 2)], [0x1b, 0x40]);
  assert.equal(String.fromCharCode(...b.slice(2, 8)), 'Hello\n');
  assert.deepEqual([...b.slice(-3)], [0x1d, 0x56, 0x01], 'ends with a partial cut');
  assert.equal(escposBytes('x', '58', { cut: false }).at(-1), 0x0a, 'no cut when not wanted');
  assert.deepEqual([...escposBytes('x', '58', { drawer: true }).slice(2, 7)], [0x1b, 0x70, 0x00, 0x19, 0xfa], 'the drawer pulse comes first when asked for');
});

test('the paper decides the width', () => {
  assert.equal(COLUMNS['58'], 32); assert.equal(COLUMNS['80'], 48);
  const long = 'a'.repeat(40);
  assert.equal(escposBytes(long, '58').filter((x) => x === 0x0a).length, 2 + 3, '40 characters need two lines on 58 mm (plus the feed)');
  assert.equal(escposBytes(long, '80').filter((x) => x === 0x0a).length, 1 + 3, 'and one on 80 mm');
});

test('base64 of bytes matches the standard encoding', () => {
  for (const s of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', 'FlowXP ÿ']) {
    const bytes = Uint8Array.from(Buffer.from(s, 'latin1'));
    assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'), JSON.stringify(s));
  }
});

test('a UPI ID is name@bank; empty clears it', () => {
  for (const ok of ['shopname@okhdfcbank', 'a.b-c_d@ybl', '9876543210@paytm', '']) assert.equal(upiProblem(ok), null, ok);
  for (const bad of ['shopname', '@ybl', 'x@', 'a@1bank', 'two words@ybl', 'a@b@c', 'x@y']) assert.notEqual(upiProblem(bad), null, bad);
  assert.equal(cleanUpi(' shop name @ybl '), 'shopname@ybl');
  assert.equal(upiLabel(null), ''); assert.equal(upiLabel('  a@ybl '), 'a@ybl');
});

import { qrBytes } from '../src/lib/escpos.ts';
import { qrMatrix, qrSvg } from '../src/lib/qr.ts';
import { payRequestLines, upiPayLink } from '../src/lib/upiBill.ts';

test('the UPI link carries the exact amount, the shop and its UPI ID', () => {
  const link = upiPayLink('shop@okhdfcbank', 'Brew & Bloom', 12345);
  assert.match(link, /^upi:\/\/pay\?/);
  assert.match(link, /pa=shop%40okhdfcbank/); assert.match(link, /am=123\.45/); assert.match(link, /cu=INR/); assert.match(link, /pn=Brew%20%26%20Bloom/);
  assert.match(upiPayLink('a@ybl', 'x', 100), /am=1\.00/);
  assert.match(upiPayLink('a@ybl', 'x', 5), /am=0\.05/);
});

test("the printer's own QR command is well formed: size, level, the data with its length, then print", () => {
  const data = 'upi://pay?pa=a%40ybl&am=10.00';
  const b = qrBytes(data, '58');
  const store = b.findIndex((v, i) => v === 0x1d && b[i + 1] === 0x28 && b[i + 2] === 0x6b && b[i + 5] === 0x31 && b[i + 6] === 0x50);
  assert.ok(store > 0, 'a store-data command is there');
  assert.equal(b[store + 3] + b[store + 4] * 256, data.length + 3, 'its length field is the data plus three');
  assert.equal(String.fromCharCode(...b.slice(store + 8, store + 8 + data.length)), data);
  assert.deepEqual(b.slice(0, 3), [0x1b, 0x61, 0x01], 'centred first');
  assert.deepEqual(b.slice(-3), [0x1b, 0x61, 0x00], 'and back to the left');
  assert.equal(qrBytes(data, '80')[19], 7); assert.equal(qrBytes(data, '58')[19], 6);
});

test('a receipt with a QR code has it after the text and before the cut', () => {
  const data = 'upi://pay?pa=a%40ybl&am=10.00';
  const b = [...escposBytes('Total Rs.10', '58', { qr: data })];
  const text = String.fromCharCode(...b);
  assert.ok(text.indexOf('Total Rs.10') < text.indexOf(data), 'text first');
  assert.ok(text.indexOf(data) < text.lastIndexOf(String.fromCharCode(0x1d, 0x56)), 'the cut comes last');
  assert.ok(!String.fromCharCode(...escposBytes('x', '58')).includes('pay?'), 'no QR when none was asked for');
});

test('a QR picture for the print screen is a square grid with a border', () => {
  const m = qrMatrix('upi://pay?pa=a%40ybl&am=10.00');
  assert.ok(m.length >= 21 && m.every((r) => r.length === m.length), 'square');
  assert.ok(m[0][0] && m[0][6] && m[6][0], 'the finder pattern is in the corner');
  const svg = qrSvg('upi://pay?pa=a%40ybl&am=10.00', 200);
  assert.match(svg, /^<svg /); assert.match(svg, /width="200"/); assert.ok(svg.includes('<path d="M'));
});

test('the bill printed for UPI shows what to pay, and says what the code is for', () => {
  const summary = { rows: [{ name: 'Latte', qty: 2, paise: 32000 }, { name: 'Muffin', qty: 1, paise: 11000 }], items: 3, subtotalPaise: 43000, offersPaise: 3000, taxPaise: 2000, totalPaise: 42000 };
  const lines = payRequestLines({ businessName: 'Brew & Bloom', title: 'T4', customer: 'Asha', summary, totalPaise: 42000 });
  const text = lines.join('\n');
  assert.equal(lines[0], 'Brew & Bloom'); assert.match(text, /T4/); assert.match(text, /Asha/);
  assert.match(text, /TO PAY\s+₹420/); assert.match(text, /Offer\s+-₹30/); assert.match(text, /Scan to pay ₹420(\.00)? by UPI/);
  assert.ok(lines.every((l) => l.length <= 32 || !l.includes('  ')), 'lines fit the paper');
});
