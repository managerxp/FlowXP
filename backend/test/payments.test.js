/*
 * Payments: money in (customers) and paid out (suppliers) kept apart in the
 * list and the totals, and a bill cannot be paid more than it is owed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const payments = await import('../src/controllers/payments.controller.js');
const invoices = await import('../src/controllers/invoices.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
let biz; let user; let A; let B; let customer; let supplier; let item;
const at = (scope, branchId = scope ?? A) => ({ businessId: biz, branchId, scopeBranchId: scope, role: 'OWNER', permissions: {} });
const call = async (fn, tenant, extra = {}) => { const res = fakeRes(); await fn({ tenant, auth: { userId: user }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res); return res; };
const today = new Date().toISOString().slice(0, 10);

test('setup', { skip }, async () => {
  await runMigrations(pool);
  user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('p','p@pay.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Shop',$1,'RETAIL') RETURNING business_id`, [user])).rows[0].business_id;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'A',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  B = (await pool.query(`INSERT INTO branches (business_id, name) VALUES ($1,'B') RETURNING branch_id`, [biz])).rows[0].branch_id;
  customer = (await pool.query(`INSERT INTO customers (business_id, name) VALUES ($1,'Asha') RETURNING customer_id`, [biz])).rows[0].customer_id;
  supplier = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,'Veg Co') RETURNING supplier_id`, [biz])).rows[0].supplier_id;
  item = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, track_inventory) VALUES ($1,'Bag',50000,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
});

test('a bill can be paid up to what is due, by a known method, and no more', { skip }, async () => {
  const inv = (await call(invoices.create, at(A), { body: { customer_id: customer, items: [{ product_id: item, quantity: 2 }] } })).body.data;   // ₹1,000, unpaid
  const pay = (body) => call(invoices.addPayment, at(A), { params: { id: inv.invoice_id }, body });
  assert.match((await pay({ amount: 100, method: 'BITCOIN' })).body.message, /Unknown payment method/);
  const over = await pay({ amount: 1000.01, method: 'UPI' });
  assert.equal(over.code, 400);
  assert.match(over.body.message, /more than the ₹1,000.00 still due/);
  assert.deepEqual((await pay({ amount: 400, method: 'upi', reference_number: 'UTR1' })).body.data, { amount_paid: 400, balance_due: 600 });
  assert.deepEqual((await pay({ amount: 600 })).body.data, { amount_paid: 1000, balance_due: 0 });
  assert.match((await pay({ amount: 1 })).body.message, /already paid/);
  const stored = (await pool.query(`SELECT payment_method, reference_number FROM payments WHERE invoice_id = $1 ORDER BY payment_id`, [inv.invoice_id])).rows;
  assert.deepEqual(stored.map((r) => [r.payment_method, r.reference_number]), [['UPI', 'UTR1'], ['CASH', null]]);
});

test('the invoice summary counts issued bills exactly; cancelled ones apart; owing lists only what is still due', { skip }, async () => {
  const bill = async () => (await call(invoices.create, at(A), { body: { customer_id: customer, items: [{ product_id: item, quantity: 1 }] } })).body.data;   // ₹500 each
  const unpaid = await bill();
  const part = await bill();
  await call(invoices.addPayment, at(A), { params: { id: part.invoice_id }, body: { amount: 200, method: 'CASH' } });
  const gone = await bill();
  assert.equal((await call(invoices.cancel, at(A), { params: { id: gone.invoice_id } })).code, 200);

  const s = (await call(invoices.summary, at(A), { query: { from: today, to: today } })).body.data;
  // the earlier ₹1,000 bill (paid) + two ₹500 bills; the cancelled one is not in the totals
  assert.deepEqual([s.bills, s.billed, s.paid, s.due, s.owing, s.paid_bills, s.cancelled, s.cancelled_value, s.average], [3, 2000, 1200, 800, 2, 1, 1, 500, 666.67]);
  const owing = (await call(invoices.list, at(A), { query: { owing: 'true' } })).body.data;
  assert.deepEqual(owing.map((i) => i.invoice_id).sort(), [unpaid.invoice_id, part.invoice_id].sort());
  assert.ok(owing.every((i) => i.created_at && i.customer_name === 'Asha'));
  assert.equal((await call(invoices.summary, at(B), { query: { from: today, to: today } })).body.data.bills, 0, 'the other outlet');
  assert.equal((await call(invoices.list, at(A), { query: { from: '27-09-2026' } })).code, 400);
});

test('money in and paid out are kept apart, in the list and in the totals', { skip }, async () => {
  assert.equal((await call(payments.create, at(A), { body: { customer_id: customer, amount: 250, method: 'CASH' } })).code, 201);   // an advance
  assert.equal((await call(payments.create, at(A), { body: { customer_id: customer, amount: 5, method: 'IOU' } })).code, 400);
  const po = (await pool.query(`INSERT INTO purchase_orders (business_id, branch_id, supplier_id, po_number, subtotal_paise, tax_paise, total_paise, amount_paid_paise, balance_due_paise, payment_status, status)
    VALUES ($1,$2,$3,'PO-P1',70000,0,70000,70000,0,'PAID','RECEIVED') RETURNING po_id`, [biz, A, supplier])).rows[0].po_id;
  await pool.query(`INSERT INTO payments (business_id, branch_id, po_id, supplier_id, payment_method, amount_paise) VALUES ($1,$2,$3,$4,'BANK_TRANSFER',70000)`, [biz, A, po, supplier]);
  await pool.query(`INSERT INTO payments (business_id, branch_id, customer_id, payment_method, amount_paise) VALUES ($1,$2,$3,'CARD',9900)`, [biz, B, customer]);   // the other outlet

  const s = (await call(payments.summary, at(A), { query: { from: today, to: today } })).body.data;
  assert.deepEqual([s.in.total, s.in.count], [1450, 4], 'the ₹1,000 bill, ₹200 on a part-paid bill and the ₹250 advance');
  assert.deepEqual(s.in.by_method.map((m) => [m.method, m.total]).sort(), [['CASH', 1050], ['UPI', 400]]);
  assert.deepEqual([s.out.total, s.out.count, s.out.by_method[0].method], [700, 1, 'BANK_TRANSFER']);
  assert.equal((await call(payments.summary, at(null), { query: { from: today, to: today } })).body.data.in.total, 1549, 'all outlets');

  const out = (await call(payments.list, at(A), { query: { direction: 'out' } })).body.data;
  assert.deepEqual(out.map((p) => [p.direction, p.supplier_name, p.po_number, p.amount]), [['out', 'Veg Co', 'PO-P1', 700]]);
  const inside = (await call(payments.list, at(A), { query: { direction: 'in' } })).body.data;
  assert.ok(inside.length === 4 && inside.every((p) => p.direction === 'in' && p.po_id === null));
  assert.equal((await call(payments.summary, at(A), { query: { from: 'soon' } })).code, 400);
});
