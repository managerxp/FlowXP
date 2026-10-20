/* Stock counts on the phone: who counts, the bodies sent, the signed differences, the apply question, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { STOCK_COUNT_TEXTS, canQuickAdd, emptyQuick, quickBody, quickProblem, appliedText, applyText, canCount, itemSub, listLine, scanEntry, scanNote, scopeText, signed, startBody, startProblem, statusLabel, typedEntry, varianceText, type CountRow } from '../src/lib/stockCount.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const row: CountRow = { count_id: 1, name: 'Aisle 3', status: 'OPEN', scope: 'CATEGORY', category: 'Dairy', outlet: 'Main', lines: 12, created_at: '2026-10-16', applied_at: null, lines_adjusted: null, net_units: null, net_value: null };

test('only people with the inventory permission count', () => { assert.equal(canCount((p) => p === 'inventory'), true); assert.equal(canCount(() => false), false); });

test('starting a count: a name, an optional category', () => {
  assert.equal(startProblem('Aisle 3'), ''); assert.notEqual(startProblem('   '), ''); assert.notEqual(startProblem('x'.repeat(81)), '');
  assert.deepEqual(startBody(' Aisle 3 ', '4'), { name: 'Aisle 3', category_id: 4 }); assert.equal(startBody('All', '').category_id, undefined);
});

test('what is sent for a scan and for a typed number', () => {
  assert.deepEqual(scanEntry(9), { product_id: 9, add: 1 });
  assert.deepEqual(typedEntry(9, ' 12.5 '), { product_id: 9, counted: 12.5 }); assert.deepEqual(typedEntry(9, '0'), { product_id: 9, counted: 0 });
  assert.equal(typedEntry(9, ''), null); assert.equal(typedEntry(9, '-3'), null); assert.equal(typedEntry(9, 'abc'), null);
});

test('differences carry their sign; the lines and the apply question read plainly', () => {
  assert.equal(signed(3), '+3'); assert.equal(signed(-2), '-2'); assert.equal(signed(0), '0'); assert.equal(varianceText(0), 'Matches'); assert.equal(varianceText(-4), '-4');
  assert.equal(scanNote('Milk', { counted_qty: 5, variance: -1 }), 'Milk: counted 5 · -1'); assert.equal(scanNote('Milk', { counted_qty: 5, variance: 0 }), 'Milk: counted 5');
  assert.equal(scopeText(row), 'Counting only Dairy · Main'); assert.equal(scopeText({ category: null, outlet: null }), 'Counting the whole store');
  assert.equal(listLine(row), 'Category: Dairy · 12 counted'); assert.equal(listLine({ ...row, status: 'APPLIED', category: null, lines_adjusted: 3, net_units: -2 }), 'Whole store · 3 adjusted · -2 units');
  assert.equal(statusLabel('OPEN'), 'In progress'); assert.equal(itemSub({ product_id: 1, name: 'Milk', sku: 'MLK', barcode: '890', system_qty: 1, counted_qty: 1, variance: 0 }), 'MLK · 890');
  assert.match(applyText({ totals: { lines: 5, variance_lines: 0, short_units: 0, extra_units: 0, net_value: 0 } }), /nothing will change/);
  assert.equal(applyText({ totals: { lines: 5, variance_lines: 2, short_units: 3, extra_units: 1, net_value: -45.5 } }), 'The stock of 2 products will be corrected: 3 units short, 1 units extra, worth 45.50.');
  assert.equal(appliedText({ lines_adjusted: 2, net_units: -2, net_value: -10 }), 'Applied: 2 products corrected, -2 units.');
});

test('a product made while scanning: checked like the web, the scanned barcode attached', () => {
  const f = { ...emptyQuick(), name: ' Tata Salt ', selling_price: '27', mrp: '28' };
  assert.equal(quickProblem(f), ''); assert.deepEqual(quickBody(f, '8904043901015'), { name: 'Tata Salt', selling_price: '27', mrp: '28', tax_rate: '5', unit: 'pc', barcode: '8904043901015' });
  assert.equal(quickBody({ ...f, mrp: '' }, '1').mrp, undefined);
  assert.notEqual(quickProblem({ ...f, name: ' ' }), ''); assert.notEqual(quickProblem({ ...f, selling_price: '' }), ''); assert.notEqual(quickProblem({ ...f, mrp: 'x' }), ''); assert.notEqual(quickProblem({ ...f, selling_price: '30' }), '', 'more than the MRP');
  assert.equal(canQuickAdd((p) => p === 'product_quick_add'), true); assert.equal(canQuickAdd(() => false), false);
});

test('every text of the Stock count screens is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(STOCK_COUNT_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
