import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceText, variantProduct, type Cell } from '../src/lib/clothing.ts';
import { RETAIL_TYPES, CLOTHING_TYPES } from '../src/lib/retail.ts';
import { BUSINESS_TYPES } from '../src/lib/account.ts';

const cell: Cell = { product_id: 7, stock: 4, sku: 'TS-RED-M', barcode: '890100', selling_price_paise: 59900, low: false };

test('a grid cell becomes a till product with its own price, GST and barcode', () => {
  const p = variantProduct({ name: 'Polo Tee', tax_rate: '5.00' }, 'Red', 'M', cell);
  assert.equal(p.product_id, 7);
  assert.equal(p.name, 'Polo Tee · Red · M');
  assert.equal(p.selling_price, 599);
  assert.equal(p.tax_rate, 5);
  assert.deepEqual(p.barcodes, ['890100']);
  assert.equal(p.track_inventory, true);
});

test('price text shows a plus when sizes are priced differently', () => {
  const r = (n: number) => `₹${n / 100}`;
  assert.equal(priceText(59900, 59900, r), '₹599');
  assert.equal(priceText(59900, 69900, r), '₹599+');
  assert.equal(priceText(null, null, r), '');
});

test('clothing is a retail type and can be chosen at signup', () => {
  assert.ok(RETAIL_TYPES.includes('CLOTHING'));
  assert.deepEqual(CLOTHING_TYPES, ['CLOTHING']);
  assert.ok(BUSINESS_TYPES.some(([k]) => k === 'CLOTHING'));
});
