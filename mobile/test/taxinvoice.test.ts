/* The GST tax invoice on the phone: the amount in words, which businesses get it, the details a bill sends, and the HTML the PDF is made from. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { DETAIL_FIELDS, detailsBody, inWords, taxInvoiceHtml, usesTaxInvoice, type TaxInvoice } from '../src/lib/taxInvoice.ts';
import { saleBody, emptyCart } from '../src/lib/cart.ts';

const invoice: TaxInvoice = {
  invoice_id: 7, invoice_number: 'INV-0007', invoice_date: '2026-10-15', customer_name: 'Ravi <Motors>', customer_gstin: '29ABCDE1234F1Z5', customer_state: 'Karnataka', customer_state_code: '29',
  subtotal: 1000, discount: 0, tax: 280, cgst: 140, sgst: 140, igst: 0, cess: 120, tcs: 10, round_off: 0, total: 1410, balance_due: 0,
  seller: { state: 'Karnataka', state_code: '29', gstin: '29AAAAA0000A1Z5', address: '12 MG Road', city: 'Bengaluru' },
  print_extra: { consignee_name: 'Ravi Garage', consignee_address: 'Plot 4\nPeenya', destination: 'Peenya', payment_terms: 'UPI' },
  print_details: { pan: 'ABCDE1234F', bank_name: 'SBI', bank_account: '39485051498', bank_ifsc: 'SBIN0017178', terms: 'Goods once sold are not returned' },
  invoice_print: { paper: 'A5', accent: '#1d4ed8', copies: ['Original for Recipient', 'Duplicate for Transporter'], show: { bank: true } },
  items: [{ item_id: 1, description: 'Brake pad', quantity: 2, unit_price: 500, discount: 0, tax_rate: 28, tax_amount: 280, cess: 120, line_total: 1400, hsn: '8708', unit: 'pc' }],
  payments: [{ method: 'CASH' }]
};
const business = { name: 'Raj Auto', email: 'raj@auto.test', receipt_settings: { logo_url: null } };

test('the total in words uses Indian grouping and paise', () => {
  assert.equal(inWords(13900), 'Thirteen Thousand Nine Hundred INR Only');
  assert.equal(inWords(2120.34), 'Two Thousand One Hundred Twenty INR and Thirty Four paise Only');
  assert.equal(inWords(0), 'Zero INR Only'); assert.equal(inWords(12345678), 'One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight INR Only');
});

test('trade businesses get the tax invoice by default, and the owner can force either layout', () => {
  assert.equal(usesTaxInvoice({ invoice_print: {} }, 'AUTO_PARTS'), true); assert.equal(usesTaxInvoice({ invoice_print: { layout: 'auto' } }, 'RESTAURANT'), false);
  assert.equal(usesTaxInvoice({ invoice_print: { layout: 'tally' } }, 'RESTAURANT'), true); assert.equal(usesTaxInvoice({ invoice_print: { layout: 'standard' } }, 'AUTO_PARTS'), false);
  assert.equal(usesTaxInvoice(null, 'WHOLESALE'), true);
});

test('only filled details are sent with a bill, trimmed; nothing filled sends nothing', () => {
  assert.equal(detailsBody({}), null); assert.equal(detailsBody({ destination: '   ' }), null);
  assert.deepEqual(detailsBody({ destination: ' Pune ', consignee_name: 'Ravi', other: 'x' }), { destination: 'Pune', consignee_name: 'Ravi' });
  assert.equal(DETAIL_FIELDS.length, 15);
  assert.deepEqual((saleBody(emptyCart(), { method: 'CASH' }, { printDetails: { destination: 'Pune' } }) as Record<string, unknown>).print_details, { destination: 'Pune' });
  assert.equal('print_details' in (saleBody(emptyCart(), { method: 'CASH' }) as Record<string, unknown>), false);
});

test('the invoice HTML carries the parties, the tax lines, the words, the bank and one sheet per copy at the paper width', () => {
  const { html, width } = taxInvoiceHtml(invoice, business);
  assert.equal(width, 540, 'A5');
  assert.match(html, /Tax Invoice/); assert.match(html, /INV-0007/); assert.match(html, /15-Oct-26/); assert.match(html, /GSTIN\/UIN: 29ABCDE1234F1Z5/);
  assert.match(html, /Consignee \(Ship to\)/); assert.match(html, /Ravi Garage/); assert.match(html, /Plot 4<br\/>Peenya/, 'a multi-line address keeps its lines');
  assert.match(html, /SGST\/UTGST/); assert.match(html, /Cess/); assert.match(html, /TCS/);
  assert.match(html, /One Thousand Four Hundred Ten INR Only/); assert.match(html, /Two Hundred Eighty INR Only/);
  assert.match(html, /Company's Bank Details/); assert.match(html, /SBIN0017178/); assert.match(html, /Goods once sold are not returned/);
  assert.equal((html.match(/<article/g) || []).length, 2, 'Original and Duplicate'); assert.match(html, /Original for Recipient/); assert.match(html, /Duplicate for Transporter/);
  assert.match(html, /--acc:#1d4ed8/);
});

test('the amount column excludes cess (it is on its own line), and the tax summary is by HSN', () => {
  const { html } = taxInvoiceHtml(invoice, business);
  assert.match(html, />1,000\.00</, 'taxable ₹1,000 = 1400 - 280 - 120');
  assert.doesNotMatch(html, />1,120\.00</);
  assert.match(html, />8708</);
});

test('text from the customer is escaped, and a bill with no tax is a Bill of Supply', () => {
  const { html } = taxInvoiceHtml(invoice, business);
  assert.match(html, /Ravi &lt;Motors&gt;/); assert.doesNotMatch(html, /Ravi <Motors>/);
  const bos = taxInvoiceHtml({ ...invoice, tax: 0, cgst: 0, sgst: 0, cess: 0, tcs: 0, bill_of_supply: true, total: 1000, invoice_print: {} }, business).html;
  assert.match(bos, /Bill of Supply/); assert.doesNotMatch(bos, /Tax Invoice/); assert.equal((bos.match(/<article/g) || []).length, 1);
  assert.match(taxInvoiceHtml({ ...invoice, reverse_charge: true }, business).html, /Tax is payable on reverse charge/);
});

test('an inter-state bill shows IGST instead of CGST and SGST; settings can hide blocks', () => {
  const inter = taxInvoiceHtml({ ...invoice, cgst: 0, sgst: 0, igst: 280 }, business).html;
  assert.match(inter, /IGST/); assert.doesNotMatch(inter, /SGST\/UTGST/);
  const slim = taxInvoiceHtml({ ...invoice, invoice_print: { show: { bank: false, tax_summary: false, signature: false, hsn: false } } }, business).html;
  assert.doesNotMatch(slim, /Bank Details/); assert.doesNotMatch(slim, /Tax Amount \(in words\)/); assert.doesNotMatch(slim, /HSN\/SAC/);
});
