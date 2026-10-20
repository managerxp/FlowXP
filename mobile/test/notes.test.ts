/* Credit and debit notes on the phone: the lines shown, raising a debit note (checks, body, estimate), and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTES_TEXTS, canRaise, creditLine, debitBody, debitEffect, debitEstimate, debitLine, debitProblem, emptyDebit, maxFor, type CreditNote, type DebitNote, type DebitOptionLine } from '../src/lib/notes.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

const cn: CreditNote = { cn_id: 1, cn_number: 'CN-0001', date: '2026-10-15T00:00:00Z', invoice_id: 9, invoice_number: 'INV-0009', customer_name: 'Ravi', reason: 'Damaged', subtotal: 100, tax: 5, total: 105, settled_against_balance: 0, refunded: 50, credit_left: 55 };
const dn: DebitNote = { dn_id: 2, dn_number: 'DN-0002', dn_date: '2026-10-16', kind: 'RETURN', reason: 'Expired', po_id: 4, po_number: 'PO-0004', supplier_name: 'Agro Ltd', subtotal: 200, tax: 10, total: 210, applied: 150, credit: 60 };
const lines: DebitOptionLine[] = [
  { item_id: 1, description: 'Rice 5kg', received: 10, returned: 4, returnable: 6, unit_cost: 100, tax_rate: 5, tracks_stock: true },
  { item_id: 2, description: 'Oil 1L', received: 5, returned: 0, returnable: 5, unit_cost: 200, tax_rate: 12, tracks_stock: true }
];

test('the lines under each note', () => {
  assert.equal(creditLine(cn), '2026-10-15 · Ravi · Bill INV-0009 · ₹50.00 paid back · ₹55.00 credit left'); assert.equal(creditLine({ ...cn, customer_name: null, refunded: 0, credit_left: 0 }), '2026-10-15 · Walk-in · Bill INV-0009');
  assert.equal(debitLine(dn), '2026-10-16 · Agro Ltd · Order PO-0004 · Goods back · Credit from the supplier: ₹60.00'); assert.equal(debitLine({ ...dn, kind: 'PRICE', credit: 0, supplier_name: null }), '2026-10-16 · Order PO-0004 · Price');
  assert.equal(debitEffect(dn), 'Taken off what you owed: ₹150.00 · Credit from the supplier: ₹60.00'); assert.equal(debitEffect({ applied: 10, credit: 0 }), 'Taken off what you owed: ₹10.00');
});

test('a debit note can be raised only on an order that has arrived; goods back is limited to what can still go back, a price fix to what arrived', () => {
  assert.equal(canRaise('RECEIVED'), true); assert.equal(canRaise('PARTIAL'), true); assert.equal(canRaise('DRAFT'), false); assert.equal(canRaise('CANCELLED'), false);
  assert.equal(maxFor('RETURN', lines[0]), 6); assert.equal(maxFor('PRICE', lines[0]), 10);
  const f = { ...emptyDebit(), reason: ' Expired stock ', entries: { 1: { qty: '2', unit_cost: '' } } };
  assert.equal(debitProblem(f, lines), ''); assert.deepEqual(debitBody(f, lines), { kind: 'RETURN', reason: 'Expired stock', items: [{ item_id: 1, quantity: 2 }] });
  assert.notEqual(debitProblem({ ...f, reason: ' ' }, lines), ''); assert.notEqual(debitProblem({ ...f, entries: {} }, lines), ''); assert.match(debitProblem({ ...f, entries: { 1: { qty: '7', unit_cost: '' } } }, lines), /Only 6 of Rice 5kg can still be returned/);
  const p = { ...f, kind: 'PRICE' as const, entries: { 2: { qty: '3', unit_cost: '20' } } };
  assert.equal(debitProblem(p, lines), ''); assert.deepEqual(debitBody(p, lines).items, [{ item_id: 2, quantity: 3, unit_cost: 20 }]);
  assert.match(debitProblem({ ...p, entries: { 2: { qty: '3', unit_cost: '' } } }, lines), /overcharge per unit for Oil 1L/); assert.match(debitProblem({ ...p, entries: { 2: { qty: '3', unit_cost: '250' } } }, lines), /cannot be more than the price paid/); assert.match(debitProblem({ ...p, entries: { 2: { qty: '9', unit_cost: '20' } } }, lines), /Only 5 of Oil 1L arrived/);
});

test('the estimate: quantity × price (or the overcharge) plus tax, in paise', () => {
  assert.equal(debitEstimate({ ...emptyDebit(), entries: { 1: { qty: '2', unit_cost: '' } } }, lines), 21000);
  assert.equal(debitEstimate({ ...emptyDebit(), kind: 'PRICE', entries: { 2: { qty: '3', unit_cost: '20' } } }, lines), 6720);
  assert.equal(debitEstimate(emptyDebit(), lines), 0);
});

test('every text of the notes screens is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(NOTES_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
