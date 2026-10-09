/* Quicker billing: popular items, payment order, cash to tap. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { bump, cashSuggestions, METHOD_ORDER, parseUsage, popular, trim } from '../src/lib/billing.ts';

test('the busiest items come first, the most recent breaks a tie', () => {
  let u = {};
  u = bump(u, 1, 100); u = bump(u, 2, 200); u = bump(u, 2, 300); u = bump(u, 3, 400);
  assert.deepEqual(popular(u), [2, 3, 1]);
  assert.deepEqual(popular(u, 1), [2]);
  assert.deepEqual(Object.keys(trim(u, 2)).sort(), ['2', '3']);
});

test('a damaged memory is just an empty one', () => {
  assert.deepEqual(parseUsage('{not json'), {});
  assert.deepEqual(parseUsage(null), {});
  assert.deepEqual(parseUsage('{"4":{"n":2,"t":1}}'), { '4': { n: 2, t: 1 } });
});

test('UPI comes first, then cash, then card', () => assert.deepEqual(METHOD_ORDER, ['UPI', 'CASH', 'CARD']));

test('cash to tap: the exact amount, then round notes above it', () => {
  assert.deepEqual(cashSuggestions(42000), [42000, 45000, 50000, 200000]);
  assert.deepEqual(cashSuggestions(50000), [50000, 200000]);
  assert.deepEqual(cashSuggestions(0), []);
  assert.equal(cashSuggestions(12345)[0], 12345);
});

import { cartSummary, orderSummary } from '../src/lib/billing.ts';
const product = (id: number, name: string, price: number, tax: number) => ({ product_id: id, name, selling_price: price, tax_rate: tax } as never);

test('the pay screen lists the till bill: lines, offers off before GST, totals', () => {
  const cart = { lines: [
    { key: 'a', product: product(1, 'Cappuccino', 120, 5), quantity: 2, modifierIds: [], modifierNames: ['Large'], deltaPaise: 1000 },
    { key: 'b', product: product(2, 'Burger', 180, 5), quantity: 1, modifierIds: [], modifierNames: [], deltaPaise: 0 }
  ] };
  const s = cartSummary(cart, new Map([['b', 1800]]));
  assert.deepEqual(s.rows, [{ name: 'Cappuccino (Large)', qty: 2, paise: 26000 }, { name: 'Burger', qty: 1, paise: 18000 }]);
  assert.equal(s.items, 3); assert.equal(s.subtotalPaise, 44000); assert.equal(s.offersPaise, 1800);
  assert.equal(s.taxPaise, 1300 + 810); assert.equal(s.totalPaise, 44000 - 1800 + 2110);
});

test('the pay screen lists a table\'s order: only what is not yet billed or cancelled', () => {
  const o = { order_id: 1, order_number: 'ORD-1', order_type: 'DINE_IN', table_id: 5, table_name: 'T5', customer_id: null, customer_name: null, status: 'OPEN', notes: null, items: [
    { order_item_id: 1, product_id: 1, description: 'Burger', modifiers: [{ name: 'Cheese' }], quantity: 2, unit_price: 100, line_total: 200, tax_rate: 5, kitchen_notes: null, status: 'SERVED', billed: false },
    { order_item_id: 2, product_id: 2, description: 'Tea', modifiers: [], quantity: 1, unit_price: 20, line_total: 20, tax_rate: 5, kitchen_notes: null, status: 'CANCELLED', billed: false },
    { order_item_id: 3, product_id: 3, description: 'Fries', modifiers: [], quantity: 1, unit_price: 50, line_total: 50, tax_rate: 5, kitchen_notes: null, status: 'SERVED', billed: true }
  ] };
  const s = orderSummary(o as never);
  assert.deepEqual(s.rows, [{ name: 'Burger (Cheese)', qty: 2, paise: 20000 }]);
  assert.equal(s.items, 2); assert.equal(s.subtotalPaise, 20000); assert.equal(s.taxPaise, 1000); assert.equal(s.totalPaise, 21000);
});

import { payPlan } from '../src/lib/billing.ts';
import { saleBody, addProduct, emptyCart } from '../src/lib/cart.ts';
import { previewOf } from '../src/lib/till.ts';
import { pendingReceiptLines } from '../src/lib/receipt.ts';
import { payRequestLines } from '../src/lib/upiBill.ts';
import { P as makeProduct } from './helpers.ts';

test('paying in full needs nothing; a part payment or pay later needs a customer and sensible amounts', () => {
  assert.deepEqual(payPlan({ how: 'FULL', totalPaise: 26250, now: '', hasCustomer: false }), { ok: true, payNowPaise: null, balancePaise: 0, problem: '' });
  const noCustomer = payPlan({ how: 'PART', totalPaise: 26250, now: '100', hasCustomer: false });
  assert.equal(noCustomer.ok, false); assert.match(noCustomer.problem, /Choose the customer/);
  assert.equal(payPlan({ how: 'LATER', totalPaise: 26250, now: '', hasCustomer: false }).ok, false);
  assert.deepEqual(payPlan({ how: 'LATER', totalPaise: 26250, now: '', hasCustomer: true }), { ok: true, payNowPaise: 0, balancePaise: 26250, problem: '' });
  assert.deepEqual(payPlan({ how: 'PART', totalPaise: 26250, now: '100', hasCustomer: true }), { ok: true, payNowPaise: 10000, balancePaise: 16250, problem: '' });
  assert.deepEqual(payPlan({ how: 'PART', totalPaise: 26250, now: '100.50', hasCustomer: true }).balancePaise, 16200);
  assert.equal(payPlan({ how: 'PART', totalPaise: 26250, now: '', hasCustomer: true }).problem, '', 'nothing typed yet: not ready, but no scolding');
  for (const bad of ['0', '-5', 'abc']) { const p = payPlan({ how: 'PART', totalPaise: 26250, now: bad, hasCustomer: true }); assert.equal(p.ok, false, bad); assert.match(p.problem, /how much/i, bad); }
  for (const whole of ['262.50', '500']) { const p = payPlan({ how: 'PART', totalPaise: 26250, now: whole, hasCustomer: true }); assert.equal(p.ok, false, whole); assert.match(p.problem, /whole bill/); }
  assert.equal(payPlan({ how: 'FULL', totalPaise: 0, now: '', hasCustomer: true }).ok, true, 'a bill that comes to nothing is simply paid');
  assert.equal(payPlan({ how: 'PART', totalPaise: 0, now: '5', hasCustomer: true }).ok, false, 'but there is nothing to owe or part-pay on it');
  assert.equal(payPlan({ how: 'LATER', totalPaise: 0, now: '', hasCustomer: true }).ok, false);
});

test('the sale sends the whole bill, part of it, or no payment at all', () => {
  const cart = addProduct(emptyCart(), makeProduct(1, 'Latte', 150));
  assert.equal((saleBody(cart, { method: 'UPI' }).payment as { amount: unknown }).amount, 'FULL');
  assert.equal((saleBody(cart, { method: 'UPI', payNowPaise: null }).payment as { amount: unknown }).amount, 'FULL');
  const part = saleBody(cart, { method: 'UPI', reference: 'T1', payNowPaise: 10050 });
  assert.deepEqual(part.payment, { method: 'UPI', amount: 100.5, reference_number: 'T1' });
  assert.equal('payment' in saleBody(cart, { method: 'CASH', payNowPaise: 0 }), false, 'pay later: no payment is sent, so the server leaves the bill unpaid');
});

test('a part-paid sale waiting on the phone shows what was paid and what is still owed', () => {
  const cart = addProduct(emptyCart(), makeProduct(1, 'Latte', 150));
  const entry = (paid?: number) => ({ local_no: 'P-1', taken_at: Date.UTC(2026, 9, 9), preview: previewOf(cart, 'CASH', paid) });
  const whole = pendingReceiptLines(entry(), 'Shop').join('\n');
  assert.ok(!/BALANCE DUE/.test(whole), 'paid in full: no balance');
  const part = pendingReceiptLines(entry(5000), 'Shop').join('\n');
  assert.match(part, /CASH\s+₹50\.00/); assert.match(part, /BALANCE DUE\s+₹/);
  const later = pendingReceiptLines(entry(0), 'Shop').join('\n');
  assert.ok(!/CASH\s+₹/.test(later), 'nothing paid: no payment line'); assert.match(later, /BALANCE DUE/);
});

test('the bill printed for a part UPI payment shows the part, the rest, and the QR line for the part', () => {
  const summary = { rows: [{ name: 'Latte', qty: 1, paise: 26250 }], items: 1, subtotalPaise: 26250, offersPaise: 0, taxPaise: 0, totalPaise: 26250 };
  const text = payRequestLines({ businessName: 'Shop', summary, totalPaise: 26250, payNowPaise: 10000 }).join('\n');
  assert.match(text, /TOTAL\s+₹262\.50/); assert.match(text, /TO PAY NOW\s+₹100\.00/); assert.match(text, /BALANCE LATER\s+₹162\.50/); assert.match(text, /Scan to pay ₹100\.00 by UPI/);
  const full = payRequestLines({ businessName: 'Shop', summary, totalPaise: 26250, payNowPaise: null }).join('\n');
  assert.ok(!/BALANCE LATER/.test(full)); assert.match(full, /Scan to pay ₹262\.50 by UPI/);
});
