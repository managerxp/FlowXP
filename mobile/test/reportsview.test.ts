/* Reports in plain words. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { averageBill, hourWords, insights, profitNote } from '../src/lib/reportsView.ts';
import type { SalesReport } from '../src/lib/types.ts';

const money = (n: number) => `₹${n}`;
const r = {
  range: { from: 'a', to: 'b' }, total_sales: 1850, total_tax: 0, invoice_count: 5, outstanding: 0, by_day: [],
  top_products: [{ product_id: 1, name: 'Cappuccino', quantity: 12, revenue: 900 }],
  by_payment_method: [{ method: 'UPI', amount: 1200 }, { method: 'CASH', amount: 650 }],
  by_hour: [{ hour: 9, invoice_count: 1, total: 200 }, { hour: 13, invoice_count: 4, total: 1650 }], by_channel: [], by_category: []
} as SalesReport;

test('the average bill, and none when there were no bills', () => {
  assert.equal(averageBill(r), 370);
  assert.equal(averageBill({ total_sales: 0, invoice_count: 0 }), 0);
});

test('hours in words', () => { assert.equal(hourWords(13), '1 pm to 2 pm'); assert.equal(hourWords(0), '12 am to 1 am'); assert.equal(hourWords(11), '11 am to 12 pm'); });

test('what happened, in sentences; nothing when there were no sales', () => {
  assert.deepEqual(insights(r, money), ['Cappuccino sold the most: 12 for ₹900.', 'Busiest time was 1 pm to 2 pm.', 'Most people paid by UPI (65%).']);
  assert.deepEqual(insights({ ...r, invoice_count: 0 }, money), []);
  assert.equal(insights({ ...r, by_hour: [r.by_hour[0]], by_payment_method: [] }, money).length, 1);
});

test('the profit line says it is an estimate', () => {
  assert.match(profitNote({ net_revenue: 1, contribution: 1, estimated_net: 1, food_cost_pct: 19.7 }), /estimate.*19.7% of sales.*expenses and wastage/);
  assert.match(profitNote({ net_revenue: 1, contribution: 1, estimated_net: 1, food_cost_pct: null }), /^An estimate after what the items cost, expenses/);
});
