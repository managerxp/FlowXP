import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptLines, type Invoice } from '../src/lib/receipt.ts';

const item = (description: string, quantity: number, unit_price: number) => ({ description, quantity, unit_price, discount: 0, tax_rate: 0, line_total: quantity * unit_price });
const bill = { invoice_id: 1, invoice_number: 'INV-2429', invoice_date: '2026-11-27', created_at: new Date(2026, 10, 27, 14, 5).toISOString(), customer_name: 'Asha Rao', cashier: 'Priya Sharma', subtotal: 0, discount: 0, tax: 0, round_off: 0, total: 0, amount_paid: 0, balance_due: 0, payments: [],
  items: [item('Gulab Jamun', 1, 90), item('Paneer Butter Masala with Extra Cheese', 2, 110)] } as Invoice;

test('the quantity and prices sit on the item line, the columns fit the paper, and the time and biller print', () => {
  for (const width of [32, 48]) {
    const out = receiptLines(bill, 'The Food Hub', width);
    if (process.env.SHOW) console.log(out.join('\n'));
    assert.ok(out.every((l) => l.length <= width), 'nothing runs off the paper');
    assert.match(out.find((l) => l.startsWith('Gulab Jamun'))!, /^Gulab Jamun +1 +90\.00 +90\.00$/);
    assert.match(out.find((l) => l.startsWith('Paneer'))!, / 2 +110\.00 +220\.00$/);
    assert.ok(out.some((l) => /^INV-2429 +2026-11-27 2:05 PM$/.test(l)) && out.includes('Biller: Priya Sharma') && !out.join().includes('Asha Rao'));
  }
});
