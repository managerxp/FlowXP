import test from 'node:test';
import assert from 'node:assert/strict';
import { clampCopies, code128, codeOf, labelsHtml, totalLabels } from '../src/lib/labels.ts';

const rice = { product_id: 1, name: 'Basmati <Rice>', sku: 'RICE-1', barcodes: [] as string[], selling_price: 95, mrp: 110 };
const tea = { product_id: 2, name: 'Tea', sku: null, barcodes: ['8901234567890'], selling_price: 50, mrp: null };
const none = { product_id: 3, name: 'Loose item', sku: null, barcodes: [] as string[], selling_price: 5, mrp: null };

test('Code 128: a known value, and every symbol adds up to 11 modules (the stop to 13)', () => {
  const w = code128('A');   // start B, 'A' (33), checksum, stop
  assert.equal(w.slice(0, 6), '211214', 'start B');
  assert.equal(w.endsWith('2331112'), true, 'stop');
  const sum = (s: string) => s.split('').reduce((a, b) => a + Number(b), 0);
  assert.equal(sum(w), 11 * 3 + 13);
});

test('a label uses the product barcode first, then the SKU; a product with neither gets no label', () => {
  assert.equal(codeOf(tea), '8901234567890'); assert.equal(codeOf(rice), 'RICE-1'); assert.equal(codeOf(none), '');
  assert.equal(totalLabels([{ product: rice, copies: 3 }, { product: tea, copies: 2 }, { product: none, copies: 9 }]), 5);
  assert.equal(clampCopies(999), 200); assert.equal(clampCopies(-4), 0); assert.equal(clampCopies(NaN), 0);
});

test('the page has one label per copy, escapes the name, and shows the MRP only when it is higher and asked for', () => {
  const sheet = labelsHtml([{ product: rice, copies: 2 }, { product: none, copies: 5 }], 'sheet', true);
  assert.equal((sheet.html.match(/class="l"/g) ?? []).length, 2);
  assert.ok(sheet.html.includes('Basmati &lt;Rice&gt;') && !sheet.html.includes('<Rice>'));
  assert.ok(sheet.html.includes('<s ') && sheet.html.includes('₹110'));
  assert.ok(!labelsHtml([{ product: rice, copies: 1 }], 'sheet', false).html.includes('<s '));
  const roll = labelsHtml([{ product: tea, copies: 1 }], 'roll', true);
  assert.ok(roll.html.includes('50mm 25mm') && !roll.html.includes('<s '));
});
