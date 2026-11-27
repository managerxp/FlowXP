import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pendingReceiptText, receiptText, type Invoice } from '../src/lib/receipt.ts';

const preview = { lines: [{ name: 'Tea', quantity: 2, unitPricePaise: 5000 }], subtotalPaise: 10000, taxPaise: 500, totalPaise: 10500, method: 'CASH' };

test('a slip with the phone’s own series is the bill number; without one it stays provisional', () => {
  const numbered = pendingReceiptText({ local_no: 'M1-0001', taken_at: Date.now(), preview }, 'Shop', 32, 'Priya');
  assert.ok(numbered.includes('PENDING BILL') && numbered.includes('M1-0001') && numbered.includes('Biller: Priya') && !numbered.includes('(about)') && !numbered.includes('real bill number'));
  const provisional = pendingReceiptText({ local_no: 'P-ABC-0001', taken_at: Date.now(), preview }, 'Shop');
  assert.ok(provisional.includes('Not final') && provisional.includes('TOTAL (about)'));
  assert.ok([numbered, provisional].every((t) => t.split('\n').every((l) => l.length <= 32)));
});

test('one payment of the whole bill says only how it was paid; a split shows each amount', () => {
  const bill = { invoice_id: 1, invoice_number: 'INV-1', invoice_date: '2026-11-27', subtotal: 100, discount: 0, tax: 0, round_off: 0, total: 100, amount_paid: 100, balance_due: 0, items: [], payments: [{ method: 'CASH', amount: 100 }] } as Invoice;
  assert.ok(receiptText(bill, 'Shop').split('\n').includes('Paid by Cash'));
  const split = receiptText({ ...bill, payments: [{ method: 'CASH', amount: 40 }, { method: 'UPI', amount: 60 }] }, 'Shop');
  assert.match(split, /Paid by Cash +₹40\.00\nPaid by UPI +₹60\.00/);
  assert.match(receiptText({ ...bill, balance_due: 70, payments: [{ method: 'CARD', amount: 30 }] }, 'Shop'), /Paid by Card +₹30\.00/);
});
