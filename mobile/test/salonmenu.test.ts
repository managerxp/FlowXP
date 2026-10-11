/* The salon's service menu. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { blank, changedBody, durationText, fromService, grouped, rowText, serviceBody, serviceProblem, type MenuService } from '../src/lib/salonMenu.ts';

const cut: MenuService = { service_id: 1, name: 'Haircut', category_id: 4, category_name: 'Hair', price: 500, tax_rate: 18, duration_min: 45, gender: 'WOMEN', description: null, status: 'ACTIVE' };

test('a service needs a name, a price and a sensible time', () => {
  const d = blank();
  assert.equal(serviceProblem(d), 'Give the service a name');
  assert.equal(serviceProblem({ ...d, name: 'Facial' }), 'Enter the price');
  assert.match(serviceProblem({ ...d, name: 'Facial', price: '800', minutes: '2' }), /how long it takes/);
  assert.match(serviceProblem({ ...d, name: 'Facial', price: '800', minutes: '30.5' }), /how long it takes/);
  assert.equal(serviceProblem({ ...d, name: 'Facial', price: '800' }), '');
});

test('what is sent, and only what changed on an edit', () => {
  assert.deepEqual(serviceBody({ ...blank('0'), name: ' Facial ', price: '800', category_id: '4' }), { name: 'Facial', price: 800, duration_min: 30, tax_rate: 0, category_id: 4, gender: 'ANY', description: null });
  const before = fromService(cut);
  assert.deepEqual(changedBody(before, before), {});
  assert.deepEqual(changedBody(before, { ...before, price: '550', minutes: '60' }), { price: 550, duration_min: 60 });
  assert.deepEqual(changedBody(before, { ...before, category_id: '0' }), { category_id: null });
});

test('how a service reads', () => {
  assert.equal(durationText(45), '45 min'); assert.equal(durationText(60), '1 h'); assert.equal(durationText(90), '1 h 30 min');
  assert.equal(rowText(cut), '45 min · Women');
  assert.equal(rowText({ ...cut, gender: 'ANY', status: 'ARCHIVED' }), '45 min · removed');
});

test('the menu by category, Other last', () => {
  const rows = [{ name: 'Wax', category_name: null }, { name: 'Spa', category_name: 'Skin' }, { name: 'Blow dry', category_name: 'Hair' }, { name: 'Cut', category_name: 'Hair' }];
  assert.deepEqual(grouped(rows).map((g) => [g.category, g.rows.map((r) => r.name)]), [['Hair', ['Blow dry', 'Cut']], ['Skin', ['Spa']], ['Other', ['Wax']]]);
});
