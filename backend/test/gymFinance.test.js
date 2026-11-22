/*
 * The member's money view: what they were billed, paid, owe and bought. Figures come from the invoices, never from a separate store.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addPlan, makeGym } from './helpers/gym.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const members = (await import('../src/controllers/gymMembers.controller.js')).default;
const invoicesApi = await import('../src/controllers/invoices.controller.js');

test.after(cleanup);

let A; let B; let plan; let member;
const okBody = (res, status = 200) => { assert.equal(res.code, status, JSON.stringify(res.body)); return res.body.data; };

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeGym(pool, 'fin', { branches: 2 });
  B = await makeGym(pool, 'finB');
  plan = await addPlan(pool, A, { name: 'Monthly', price: 1000, duration_days: 30 });
  member = okBody(await A.call(members.create, { body: { name: 'Asha', phone: '9876500901' } }), 201).member_id;
});

test('a part-paid membership shows what was billed, paid and still owed, and a bought product shows as a purchase', { skip }, async () => {
  const sold = okBody(await A.call(members.sell, { params: { id: member }, body: { plan_id: plan, payment: { method: 'CASH', amount: 400 } } }), 201);
  const invoiceId = sold.invoice.invoice_id;
  const product = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise, purchase_price_paise, tax_rate, track_inventory) VALUES ($1,'Whey 1kg','DISH',200000,150000,18,FALSE) RETURNING product_id`, [A.businessId])).rows[0].product_id;
  const f0 = okBody(await A.call(members.finance, { params: { id: member } }));
  assert.equal(f0.summary.billed_paise, 118000);
  assert.equal(f0.summary.paid_paise, 40000);
  assert.equal(f0.summary.due_paise, 78000);
  assert.equal(f0.summary.purchases, 0, 'a membership line is not a product purchase');
  assert.equal(f0.invoices.length, 1);
  assert.equal(f0.invoices[0].is_membership, true);
  assert.equal(f0.payments.length, 1);
  assert.equal(f0.payments[0].payment_method, 'CASH');

  // a product line on the member's invoice counts as a purchase
  await pool.query(`INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price_paise, discount_paise, tax_rate, tax_amount_paise, line_total_paise) VALUES ($1,$2,'Whey 1kg',2,200000,0,18,0,400000)`, [invoiceId, product]);
  const f1 = okBody(await A.call(members.finance, { params: { id: member } }));
  assert.equal(f1.summary.purchases, 1);
  assert.equal(f1.summary.purchase_quantity, 2);
  assert.equal(f1.summary.purchase_spent_paise, 400000);
  assert.equal(f1.purchases[0].description, 'Whey 1kg');

  // collecting the rest moves the due to zero
  okBody(await A.call(invoicesApi.addPayment, { params: { id: invoiceId }, body: { amount: 780, method: 'UPI' } }), 201);
  const f2 = okBody(await A.call(members.finance, { params: { id: member } }));
  assert.equal(f2.summary.due_paise, 0);
  assert.equal(f2.payments.length, 2);
});

test('another gym cannot read it, and an unknown member is not found', { skip }, async () => {
  const other = await B.call(members.finance, { params: { id: member } });
  assert.equal(other.code, 404);
  const none = await A.call(members.finance, { params: { id: 999999 } });
  assert.equal(none.code, 404);
});
