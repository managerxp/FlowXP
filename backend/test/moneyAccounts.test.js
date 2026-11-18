/*
 * Cash, bank and loan accounts: the Cash account made on first look, payment methods landing in accounts, money not linked to any account,
 * transfers (deposit, loan received, instalment with interest, capital, drawings), a bank and a loan statement, and a trial balance and
 * balance sheet that balance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const M = await import('../src/controllers/moneyAccounts.controller.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const { businessToday, addDaysISO } = await import('../src/utils/dates.js');

test.after(cleanup);
const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

test('money accounts: balances, transfers, statements, trial balance and balance sheet', { skip }, async () => {
  await runMigrations(pool);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@ma.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, created_at) VALUES ('Shop',$1,'RETAIL', now() - interval '10 days') RETURNING business_id`, [owner])).rows[0].business_id;
  const br = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  const tenant = { businessId: biz, branchId: br, scopeBranchId: br, role: 'OWNER', businessType: 'RETAIL', permissions: {} };
  const call = async (fn, extra = {}) => { const res = fakeRes(); await fn({ tenant, auth: { userId: owner }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra }, res); return res; };
  const today = await businessToday(biz);

  // two sales: 500 in cash, 300 by UPI (no bank account yet)
  const pid = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, purchase_price_paise, tax_rate, track_inventory) VALUES ($1,'Pen',10000,6000,0,FALSE) RETURNING product_id`, [biz])).rows[0].product_id;
  const sell = async (qty, method) => {
    const c = await pool.connect();
    try { await c.query('BEGIN'); await createInvoiceInTransaction(c, tenant, owner, { items: [{ product_id: pid, quantity: qty }], payment: { amount: 'FULL', method } }); await c.query('COMMIT'); } finally { c.release(); }
  };
  await sell(5, 'CASH'); await sell(3, 'UPI');
  await pool.query(`INSERT INTO expenses (business_id, branch_id, category, amount_paise, payment_method, expense_date) VALUES ($1,$2,'Rent',10000,'CASH',$3)`, [biz, br, today]);

  let data = (await call(M.list)).body.data;
  const cash = data.accounts.find((a) => a.kind === 'CASH');
  assert.equal(cash.name, 'Cash in hand'); assert.equal(cash.balance, 400, '500 in, 100 rent out');
  assert.equal(data.payment_accounts.CASH, cash.account_id);
  assert.deepEqual(data.not_linked, [{ method: 'UPI', amount: 300 }]);

  // a bank account takes the bank methods, so the UPI money lands there
  const bank = (await call(M.create, { body: { name: 'HDFC current', kind: 'BANK', opening_balance: 1000, opening_date: addDaysISO(today, -10), ifsc: 'HDFC0001234', account_last4: '1234567890' } })).body.data;
  assert.equal(bank.account_last4, '7890');
  data = (await call(M.list)).body.data;
  assert.equal(data.payment_accounts.UPI, bank.account_id); assert.equal(data.payment_accounts.CASH, cash.account_id, 'cash stays where it was');
  assert.equal(data.accounts.find((a) => a.account_id === bank.account_id).balance, 1300);
  assert.equal(data.not_linked.length, 0);
  assert.equal((await call(M.create, { body: { name: 'hdfc CURRENT', kind: 'BANK' } })).code, 409);
  assert.equal((await call(M.create, { body: { name: 'Bad', kind: 'BANK', ifsc: 'NOPE' } })).code, 400);

  // a loan of 2000 already owed; 5000 more received into the bank; an instalment of 1000 plus 50 interest; cash deposited; owner money
  const loan = (await call(M.create, { body: { name: 'Shop loan', kind: 'LOAN', opening_balance: 2000, opening_date: addDaysISO(today, -10), lender: 'SBI', interest_rate: 11 } })).body.data;
  const move = (body) => call(M.createTransfer, { body: { date: today, ...body } });
  assert.equal((await move({ kind: 'LOAN_TAKEN', from_account_id: bank.account_id, to_account_id: cash.account_id, amount: 5 })).code, 400, 'a loan comes from a loan account');
  assert.equal((await move({ kind: 'LOAN_TAKEN', from_account_id: loan.account_id, to_account_id: bank.account_id, amount: 5000 })).code, 201);
  assert.equal((await move({ kind: 'LOAN_REPAID', from_account_id: bank.account_id, to_account_id: loan.account_id, amount: 1000, interest: 50 })).code, 201);
  assert.equal((await move({ kind: 'TRANSFER', from_account_id: cash.account_id, to_account_id: bank.account_id, amount: 300 })).code, 201);
  assert.equal((await move({ kind: 'CAPITAL_IN', to_account_id: bank.account_id, amount: 700 })).code, 201);
  const drawn = (await move({ kind: 'DRAWINGS', from_account_id: cash.account_id, amount: 50 })).body.data.transfer_id;
  assert.equal((await move({ kind: 'TRANSFER', from_account_id: cash.account_id, to_account_id: cash.account_id, amount: 1 })).code, 400);
  assert.equal((await move({ kind: 'TRANSFER', from_account_id: cash.account_id, to_account_id: bank.account_id, amount: 1, interest: 1 })).code, 400);

  data = (await call(M.list)).body.data;
  const bal = (id) => data.accounts.find((a) => a.account_id === id).balance;
  assert.equal(bal(cash.account_id), 400 - 300 - 50);
  assert.equal(bal(bank.account_id), 1300 + 5000 - 1050 + 300 + 700);
  assert.equal(bal(loan.account_id), 2000 + 5000 - 1000, 'what is still owed');

  // a voided transfer drops out
  await call(M.voidTransfer, { params: { id: String(drawn) } });
  assert.equal((await call(M.list)).body.data.accounts.find((a) => a.account_id === cash.account_id).balance, 100);

  // the bank statement: opening 1000, each line with its balance, closing what the list says
  const st = (await call(M.accountStatement, { params: { id: String(bank.account_id) }, query: { from: addDaysISO(today, -30), to: today } })).body.data;
  assert.equal(st.opening_balance, 1000); assert.equal(st.closing_balance, 6250);
  assert.equal(st.lines.at(-1).balance, 6250);
  assert.ok(st.lines.some((l) => l.what === 'Loan instalment' && l.out === 1050));
  const ls = (await call(M.accountStatement, { params: { id: String(loan.account_id) }, query: { from: addDaysISO(today, -30), to: today } })).body.data;
  assert.equal(ls.opening_balance, 2000); assert.equal(ls.closing_balance, 6000);

  // the trial balance balances, and so does the balance sheet
  const tb = (await call(M.trialBalance)).body.data;
  assert.equal(tb.total_debit, tb.total_credit, JSON.stringify(tb.rows));
  assert.ok(tb.rows.some((r) => r.name === 'Loan interest' && r.debit === 50));
  const bs = (await call(M.balanceSheet)).body.data;
  assert.equal(bs.total_assets, bs.total_liabilities_and_capital);
  assert.ok(bs.liabilities.some((l) => l.name === 'Shop loan' && l.amount === 6000));
});
