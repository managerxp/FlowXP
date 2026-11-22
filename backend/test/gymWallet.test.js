/* The member wallet: deposits, paying a bill from it, refunds, the append-only ledger, and who may do what. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addPlan, makeGym } from './helpers/gym.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const members = (await import('../src/controllers/gymMembers.controller.js')).default;
const walletApi = (await import('../src/controllers/gymWallet.controller.js')).default;

test.after(cleanup);

let A; let B; let member; let invoiceId;
const okBody = (res, status = 200) => { assert.equal(res.code, status, JSON.stringify(res.body)); return res.body.data; };

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeGym(pool, 'wal');
  B = await makeGym(pool, 'walB');
  const plan = await addPlan(pool, A, { name: 'Monthly', price: 1000, duration_days: 30 });
  member = okBody(await A.call(members.create, { body: { name: 'Ravi', phone: '9876500951' } }), 201).member_id;
  invoiceId = okBody(await A.call(members.sell, { params: { id: member }, body: { plan_id: plan, payment: { method: 'CASH', amount: 0 } } }), 201).invoice.invoice_id;
});

test('a deposit raises the balance; paying a bill from it lowers it and settles the bill', { skip }, async () => {
  assert.equal(okBody(await A.call(walletApi.deposit, { params: { id: member }, body: { amount: 500, method: 'UPI' } }), 201).balance_paise, 50000);
  const part = okBody(await A.call(walletApi.payInvoice, { params: { id: member }, body: { invoice_id: invoiceId } }), 201);
  assert.equal(part.paid_paise, 50000, 'with no amount it pays as much as the balance covers');
  assert.equal(part.balance_paise, 0);
  assert.equal(part.balance_due_paise, 68000);
  assert.equal(okBody(await A.call(walletApi.deposit, { params: { id: member }, body: { amount: 1000 } }), 201).balance_paise, 100000);
  const rest = okBody(await A.call(walletApi.payInvoice, { params: { id: member }, body: { invoice_id: invoiceId, amount: 680 } }), 201);
  assert.equal(rest.balance_due_paise, 0);
  assert.equal(rest.balance_paise, 32000);
  const inv = (await pool.query(`SELECT payment_status, amount_paid_paise FROM invoices WHERE invoice_id = $1`, [invoiceId])).rows[0];
  assert.equal(inv.payment_status, 'PAID');
  assert.equal(Number(inv.amount_paid_paise), 118000);
});

test('the wallet cannot go below zero, and a bill that is already paid is refused', { skip }, async () => {
  const short = await A.call(walletApi.refund, { params: { id: member }, body: { amount: 500, reason: 'left the gym' } });
  assert.equal(short.code, 400);
  const paid = await A.call(walletApi.payInvoice, { params: { id: member }, body: { invoice_id: invoiceId, amount: 1 } });
  assert.equal(paid.code, 400);
  assert.equal(okBody(await A.call(walletApi.get, { params: { id: member } })).balance_paise, 32000);
});

test('a refund needs a reason; the ledger cannot be edited', { skip }, async () => {
  // the router limits refunds to gym_setup (checked in gymCore's role table); the handler needs a reason
  const noReason = await A.call(walletApi.refund, { params: { id: member }, body: { amount: 100 } });
  assert.equal(noReason.code, 400);
  assert.equal(okBody(await A.call(walletApi.refund, { params: { id: member }, body: { amount: 120, reason: 'asked for it back' } }), 201).balance_paise, 20000);
  await assert.rejects(pool.query(`UPDATE gym_wallet_ledger SET amount_paise = amount_paise + 1`), /cannot be changed/);
  await assert.rejects(pool.query(`DELETE FROM gym_wallet_ledger`), /cannot be changed/);
});

test('two bills at once cannot spend the same money; another gym cannot see the wallet', { skip }, async () => {
  const plan = await addPlan(pool, A, { name: 'Weekly', price: 100, duration_days: 7 });
  const bills = [];
  for (let i = 0; i < 2; i++) bills.push(okBody(await A.call(members.sell, { params: { id: member }, body: { plan_id: plan, payment: { method: 'CASH', amount: 0 } } }), 201).invoice.invoice_id);
  // balance is Rs 200; each bill is Rs 118: only one can be paid in full
  const [x, y] = await Promise.all(bills.map((invoice_id) => A.call(walletApi.payInvoice, { params: { id: member }, body: { invoice_id, amount: 118 } })));
  assert.deepEqual([x.code, y.code].sort(), [201, 400]);
  const gone = await B.call(walletApi.get, { params: { id: member } });
  assert.equal(gone.code, 404);
});

test('cancelling a bill paid from the wallet returns the money once', { skip }, async () => {
  const before = okBody(await A.call(walletApi.get, { params: { id: member } })).balance_paise;
  const { returnForCancelled } = await import('../src/modules/gym/wallet.js');
  const spent = (await pool.query(`SELECT invoice_id FROM gym_wallet_ledger WHERE member_id = $1 AND kind = 'SPEND' ORDER BY entry_id DESC LIMIT 1`, [member])).rows[0].invoice_id;
  assert.equal(await returnForCancelled(pool, { businessId: A.businessId, invoiceId: spent, userId: null }) > 0, true);
  assert.equal(await returnForCancelled(pool, { businessId: A.businessId, invoiceId: spent, userId: null }), 0);
  assert.ok(okBody(await A.call(walletApi.get, { params: { id: member } })).balance_paise > before);
});
