import test from 'node:test';
import assert from 'node:assert/strict';
import { addStockBody, addStockProblem, alertTotal, cell, expiryText, groupReports, periodFor, priceListBody, priceListProblem, reportPath } from '../src/lib/shopExtras.ts';

test('salon alerts add up and expiry reads plainly', () => {
  assert.equal(alertTotal({ counts: { low_stock: 2, out_of_stock: 1, expiring_soon: 3, expired: 1, negative_stock: 0, unusual_consumption: 9 } }), 7);
  assert.equal(alertTotal(null), 0);
  assert.equal(expiryText(-1), 'Expired 1 day ago'); assert.equal(expiryText(0), 'Expires today'); assert.equal(expiryText(5), 'Expires in 5 days'); assert.equal(expiryText(null), '');
});

test('adding stock needs an item and a count; expiry is optional but must be a real date', () => {
  assert.match(addStockProblem(null, 1, ''), /item/); assert.match(addStockProblem(1, 0, ''), /how many/); assert.match(addStockProblem(1, 2, '31/12/2026'), /expiry/); assert.equal(addStockProblem(1, 2, '2026-12-31'), '');
  assert.deepEqual(addStockBody(7, 3, ' B1 ', '2026-12-31', '120'), { product_id: 7, quantity: 3, reason: 'ADJUSTMENT', batch_no: 'B1', expiry_date: '2026-12-31', unit_cost: 120 });
  assert.deepEqual(addStockBody(7, 3, '', '', ''), { product_id: 7, quantity: 3, reason: 'ADJUSTMENT' });
});

test('a price list needs a name and a discount from 0 to 100', () => {
  assert.match(priceListProblem('A', '5'), /name/); assert.match(priceListProblem('Trade', ''), /percent/); assert.match(priceListProblem('Trade', '120'), /percent/); assert.equal(priceListProblem('Trade', '12.5'), '');
  assert.deepEqual(priceListBody(' Trade ', '12.5'), { name: 'Trade', discount_pct: 12.5 });
});

test('wholesale reports group by their section and print values by type', () => {
  const g = groupReports([{ key: 'a', label: 'A', group: 'Sales', description: '' }, { key: 'b', label: 'B', group: 'Stock', description: '' }, { key: 'c', label: 'C', group: 'Sales', description: '' }]);
  assert.deepEqual(g.map((x) => [x.name, x.items.length]), [['Sales', 2], ['Stock', 1]]);
  assert.equal(cell('money', 1234.5), '₹1,234.5'); assert.equal(cell('percent', 12.34), '12.3%'); assert.equal(cell('text', null), ''); assert.equal(cell('date', '2026-11-01'), '2026-11-01');
  const t = new Date(2026, 10, 10);
  assert.deepEqual(periodFor('month', t), { from: '2026-11-01', to: '2026-11-10' }); assert.equal(periodFor('last30', t).from, '2026-10-12');
  assert.equal(reportPath({ key: 'sales_summary', period: true }, { from: '2026-11-01', to: '2026-11-10' }), '/wholesale/reports/sales_summary?from=2026-11-01&to=2026-11-10');
  assert.equal(reportPath({ key: 'receivables_ageing' }, { from: 'x', to: '2026-11-10' }), '/wholesale/reports/receivables_ageing?to=2026-11-10');
});
