/* GST options on the phone: the bill preview (cess, TCS, TDS, composite), the sale body's ticks, and the receipt lines. The server prices the real bill. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { addProduct, emptyCart, saleBody, totals } from '../src/lib/cart.ts';
import { cartSummary } from '../src/lib/billing.ts';
import { gstView } from '../src/lib/gst.ts';
import { previewOf } from '../src/lib/till.ts';
import { pendingReceiptLines, receiptLines, type Invoice } from '../src/lib/receipt.ts';
import type { Product } from '../src/lib/catalog.ts';

const cola = { product_id: 1, name: 'Cola', sku: null, barcodes: [], unit: 'pc', selling_price: 1000, mrp: null, tax_rate: 28, cess_rate: 12, track_inventory: false, current_stock: null, category_name: null, is_available: true, modifier_group_ids: [] } as Product;
const cart = addProduct(emptyCart(), cola);
const biz = (gst_options: Record<string, unknown>, gst_enabled = true) => gstView({ gst_enabled, gst_options });

test('with no GST options the preview is exactly as before', () => {
  assert.equal(totals(cart).totalPaise, 128000);   // ₹1000 + 28% GST, no cess: the cess rate is ignored until the owner switches it on
  const t = totals(cart, new Map(), biz({}));
  assert.deepEqual([t.taxPaise, t.cessPaise, t.tcsPaise, t.tdsPaise, t.totalPaise], [28000, 0, 0, 0, 128000]);
  assert.equal(totals(cart, new Map(), gstView(null)).totalPaise, 128000, 'a copy with no word on GST keeps charging tax');
});

test('cess is added on the taxable value; TCS is added when ticked; TDS is held back, not added', () => {
  const g = biz({ cess: true, tcs: true, tcs_rate: 1, tds: true, tds_rate: 2 });
  const plain = totals(cart, new Map(), g);
  assert.equal(plain.cessPaise, 12000); assert.equal(plain.totalPaise, 140000);
  const ticked = totals(cart, new Map(), g, { tcs: true, tds: true });
  assert.equal(ticked.tcsPaise, 1000); assert.equal(ticked.tdsPaise, 2000); assert.equal(ticked.totalPaise, 141000, 'TCS is inside the total, TDS is not taken off it');
  assert.equal(totals(cart, new Map(), biz({ tcs: false }), { tcs: true }).tcsPaise, 0, 'a tick only counts when the option is on');
  const s = cartSummary(cart, new Map(), g, { tds: true });
  assert.equal(s.tdsPaise, 2000); assert.equal(s.cessPaise, 12000);
});

test('an offer comes off before cess and TCS, as on the server', () => {
  const t = totals(cart, new Map([['1:', 20000]]), biz({ cess: true, tcs: true }), { tcs: true });   // ₹200 off the ₹1000 line
  assert.deepEqual([t.taxPaise, t.cessPaise, t.tcsPaise], [22400, 9600, 800]);
});

test('a composite dealer, or a business without GST, previews no tax at all', () => {
  const c = totals(cart, new Map(), biz({ composite: true, cess: true }));
  assert.deepEqual([c.taxPaise, c.cessPaise, c.totalPaise], [0, 0, 100000]);
  assert.equal(totals(cart, new Map(), biz({}, false)).totalPaise, 100000);
});

test('the sale body carries only the ticks that count', () => {
  const pay = { method: 'CASH' };
  const g = biz({ tcs: true, reverse_charge: true });
  const body = saleBody(cart, pay, { gst: g, levies: { tcs: true, tds: true, reverse_charge: true } }) as Record<string, unknown>;
  assert.equal(body.tcs, true); assert.equal(body.reverse_charge, true); assert.equal('tds' in body, false, 'TDS is not enabled');
  assert.equal('tcs' in (saleBody(cart, pay) as Record<string, unknown>), false);
});

const invoice = { invoice_id: 1, invoice_number: 'INV-1', invoice_date: '2026-10-15', subtotal: 1000, discount: 0, tax: 280, cess: 120, tcs: 10, tds: 20, reverse_charge: true, round_off: 0, total: 1410, amount_paid: 1410, balance_due: 0, items: [{ description: 'Cola', quantity: 1, unit_price: 1000, discount: 0, tax_rate: 28, line_total: 1400 }], payments: [{ method: 'CASH', amount: 1390 }] } as Invoice;

test('the receipt shows cess, TCS, TDS held back and the reverse-charge note; a Bill of Supply has no GST line', () => {
  const text = receiptLines(invoice, 'Raj Auto').join('\n');
  for (const word of ['Cess', 'TCS', 'TDS held back', 'Tax payable on reverse charge']) assert.match(text, new RegExp(word));
  const bos = receiptLines({ ...invoice, tax: 0, cess: 0, tcs: 0, tds: 0, reverse_charge: false, bill_of_supply: true, total: 1000 }, 'Raj Auto').join('\n');
  assert.match(bos, /BILL OF SUPPLY/); assert.doesNotMatch(bos, /GST/);
  assert.doesNotMatch(receiptLines({ ...invoice, cess: undefined, tcs: undefined, tds: undefined, reverse_charge: false }, 'Raj Auto').join('\n'), /Cess|TCS|TDS/);
});

test('a bill waiting to sync keeps the same figures, and what was paid excludes the TDS', () => {
  const g = biz({ cess: true, tcs: true, tds: true });
  const preview = previewOf(cart, 'CASH', undefined, g, { tcs: true, tds: true });
  assert.deepEqual([preview.cessPaise, preview.tcsPaise, preview.tdsPaise, preview.totalPaise], [12000, 1000, 2000, 141000]);
  const text = pendingReceiptLines({ local_no: 'L-1', taken_at: Date.UTC(2026, 9, 15), preview }, 'Raj Auto').join('\n');
  assert.match(text, /Cess \(about\)/); assert.match(text, /TDS held back \(about\)/);
  assert.match(text, /CASH\s+₹1,390\.00/, 'the customer pays the total less TDS');
});
