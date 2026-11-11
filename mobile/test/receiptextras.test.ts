/* The extra receipt options (Business settings > Receipts) shape the phone's receipt like the website's and the thermal printer's. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { receiptLines, rupeesInWords, type Invoice } from '../src/lib/receipt.ts';
import { TERMS_TOGGLE, KITCHEN_TOGGLE, TOGGLES } from '../src/lib/bizSettings.ts';

const inv = (receipt?: Invoice['receipt']) => ({
  invoice_id: 1, invoice_number: 'INV-1', invoice_date: '2026-11-11', subtotal: 200, discount: 0, tax: 24, round_off: 0, total: 224, amount_paid: 224, balance_due: 0,
  outlet: { name: 'Shop', phone: '99999' }, items: [{ description: 'Tea', quantity: 2, unit_price: 100, discount: 0, tax_rate: 12, line_total: 224 }], payments: [], receipt
}) as unknown as Invoice;

test('amounts in words, Indian style', () => {
  assert.equal(rupeesInWords(2120.34), 'Two Thousand One Hundred Twenty Rupees and Thirty Four Paise Only');
  assert.equal(rupeesInWords(1234567), 'Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven Rupees Only');
});

test('the extras are off or on as the owner chose; the defaults keep the bill as it was', () => {
  const plain = receiptLines(inv(), 'Shop', 48).join('\n');
  assert.match(plain, /Ph: 99999/); assert.match(plain, /Total Qty: 2/); assert.doesNotMatch(plain, /Rupees|Terms:/);
  const full = receiptLines(inv({ header_text: 'Pure Veg since 1985', show_phone: false, show_total_qty: false, show_amount_words: true, show_terms: true, terms: 'No returns.' }), 'Shop', 48).join('\n');
  assert.match(full, /Pure Veg since 1985/); assert.doesNotMatch(full, /Ph:|Total Qty/); assert.match(full, /Two Hundred Twenty Four Rupees Only/); assert.match(full, /Terms: No returns\./);
});

test('the settings list: terms only for non-food, the kitchen screen only for food', () => {
  assert.ok(TOGGLES.some(([k]) => k === 'show_phone') && !TOGGLES.some(([k]) => k === TERMS_TOGGLE[0] || k === KITCHEN_TOGGLE[0]));
});
