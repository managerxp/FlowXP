/* Customers in plain words. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { arrange, headline, paymentBody, paymentProblem, since, sub, totalDuePaise } from '../src/lib/customers.ts';

const money = (n: number) => `₹${n}`;
const rows = [
  { name: 'Rahul', outstanding_balance: 0, total_purchases: 1250 }, { name: 'Aisha', outstanding_balance: 840, total_purchases: 900 },
  { name: 'John', outstanding_balance: 0, total_purchases: 3450 }, { name: 'Zed', outstanding_balance: 60, total_purchases: 0 }, { name: 'New', outstanding_balance: 0, total_purchases: 0 }
];

test('what to say about each person: dues first, then what they spent', () => {
  assert.deepEqual(headline(rows[1], money), { text: '₹840 due', due: true });
  assert.deepEqual(headline(rows[0], money), { text: '₹1250 spent', due: false });
  assert.equal(headline(rows[4], money), null);
});

test('who owes (most first), best customers, everyone by name; and the total due', () => {
  assert.deepEqual(arrange(rows, 'owing').map((c) => c.name), ['Aisha', 'Zed']);
  assert.deepEqual(arrange(rows, 'best').map((c) => c.name), ['John', 'Rahul', 'Aisha']);
  assert.deepEqual(arrange(rows, 'all').map((c) => c.name), ['Aisha', 'John', 'New', 'Rahul', 'Zed']);
  assert.equal(totalDuePaise(rows), 90000);
});

test('when they last came, in words', () => {
  const now = new Date('2026-10-08T12:00:00Z').getTime();
  assert.equal(since('2026-10-08T01:00:00Z', now), 'today');
  assert.equal(since('2026-10-07T01:00:00Z', now), 'yesterday');
  assert.equal(since('2026-10-03T01:00:00Z', now), '5 days ago');
  assert.equal(since('2026-07-01T01:00:00Z', now), '3 months ago');
  assert.equal(since(null, now), '');
  assert.equal(sub({ phone: '98', bills: 1, last_bill_date: null }), '98 · 1 bill');
  assert.equal(sub({ phone: null, bills: 0, last_bill_date: null }), 'New');
});

test('a payment is checked against what is owed on the bill', () => {
  assert.equal(paymentProblem('', 500), 'Enter how much they paid');
  assert.equal(paymentProblem('0', 500), 'Enter how much they paid');
  assert.equal(paymentProblem('600', 500), 'That is more than they owe on this bill');
  assert.equal(paymentProblem('500', 500), '');
  assert.deepEqual(paymentBody('250', 'UPI', ' ref1 '), { amount: 250, method: 'UPI', reference_number: 'ref1' });
  assert.deepEqual(paymentBody('250', 'CASH', ''), { amount: 250, method: 'CASH' });
});
