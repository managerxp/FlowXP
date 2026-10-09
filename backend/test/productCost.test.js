import test from 'node:test';
import assert from 'node:assert/strict';
import { seesCost, withoutCost } from '../src/controllers/products.controller.js';

test('cost is for people who buy, stock, price or report', () => {
  for (const role of ['OWNER', 'MANAGER', 'INVENTORY_MANAGER']) assert.equal(seesCost({ role, permissions: {} }), true, role);
  for (const role of ['WAITER', 'CASHIER', 'KITCHEN']) assert.equal(seesCost({ role, permissions: {} }), false, role);
  assert.equal(seesCost({ role: 'WAITER', permissions: { inventory: true } }), true);
});

test('the cost fields are dropped, the rest stays', () => {
  const out = withoutCost({ name: 'Tea', selling_price: 40, purchase_price: 12, unit_cost: 12, margin_pct: 70, cost_source: 'purchase' });
  assert.deepEqual(out, { name: 'Tea', selling_price: 40 });
});
