/*
 * Cash, bank and loan accounts: the list with balances, adding and changing an account, which payment method lands where, transfers typed by hand,
 * an account's statement, and the trial balance and balance sheet worked out from them (modules/moneyAccounts.js).
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { toPaise, toRupees } from '../utils/money.js';
import { addDaysISO, businessToday } from '../utils/dates.js';
import * as profit from './profitReports.controller.js';
import { KINDS, MONEY_METHODS, TRANSFER_KINDS, asAccount, balances, loadAccounts, position, statement } from '../modules/moneyAccounts.js';

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
const R = toRupees;

/* GET /money-accounts — every account with its balance today, where each method lands, and money from methods with no account */
export const list = async (req, res) => {
  const today = await businessToday(req.tenant.businessId);
  const { accounts, map, held, unassigned } = await balances(pool, req.tenant.businessId, today);
  res.json({
    success: true,
    data: {
      accounts: accounts.map((a) => asAccount(a, held.get(a.account_id))), methods: MONEY_METHODS,
      payment_accounts: Object.fromEntries(MONEY_METHODS.map((m) => [m, map[m] != null ? Number(map[m]) : null])),
      not_linked: [...unassigned].filter(([, v]) => v !== 0).map(([method, paise]) => ({ method, amount: R(paise) }))
    }
  });
};

const clean = (b, kind) => {
  const name = String(b.name ?? '').trim().slice(0, 80);
  if (!name) return [null, 'Give the account a name'];
  let opening = 0;
  try { opening = toPaise(b.opening_balance ?? 0); } catch { return [null, 'The opening balance must be a number']; }
  if (kind === 'LOAN' && opening < 0) return [null, 'Enter what is still owed on the loan'];
  const rate = b.interest_rate == null || b.interest_rate === '' ? null : Number(b.interest_rate);
  if (rate != null && !(rate >= 0 && rate <= 100)) return [null, 'The interest rate must be from 0 to 100'];
  const last4 = b.account_last4 ? String(b.account_last4).replace(/\D/g, '').slice(-4) : null;
  const ifsc = b.ifsc ? String(b.ifsc).trim().toUpperCase() : null;
  if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return [null, 'An IFSC is 11 characters, like SBIN0001234'];
  return [{ name, opening, rate, last4, ifsc, bank: b.bank_name ? String(b.bank_name).trim().slice(0, 80) : null, lender: b.lender ? String(b.lender).trim().slice(0, 120) : null }, null];
};

/* POST /money-accounts { name, kind, opening_balance, opening_date, bank_name?, account_last4?, ifsc?, lender?, interest_rate? } */
export const create = async (req, res) => {
  const b = req.body || {};
  const kind = String(b.kind || '').toUpperCase();
  if (!KINDS.includes(kind)) return fail(res, 400, 'Choose cash, bank or loan');
  const [c, error] = clean(b, kind);
  if (error) return fail(res, 400, error);
  const openingDate = isDate(b.opening_date) ? b.opening_date : await businessToday(req.tenant.businessId);
  await loadAccounts(pool, req.tenant.businessId);
  try {
    const { rows } = await pool.query(
      `INSERT INTO money_accounts (business_id, name, kind, opening_balance_paise, opening_date, bank_name, account_last4, ifsc, lender, interest_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.tenant.businessId, c.name, kind, c.opening, openingDate, c.bank, c.last4, c.ifsc, c.lender, c.rate]);
    // the first bank account takes the methods that are bank money, unless they already go somewhere
    if (kind === 'BANK') {
      await pool.query(
        `UPDATE businesses SET payment_accounts = (SELECT jsonb_object_agg(m, COALESCE(payment_accounts -> m, to_jsonb($2::int))) FROM unnest(ARRAY['UPI','CARD','BANK_TRANSFER','CHEQUE']) m) || payment_accounts
         WHERE business_id = $1`, [req.tenant.businessId, rows[0].account_id]);
    }
    recordAudit(req, { action: 'money_account.created', resource_type: 'money_account', resource_id: rows[0].account_id, metadata: { name: c.name, kind } });
    res.status(201).json({ success: true, data: asAccount(rows[0], null) });
  } catch (e) {
    if (e.code === '23505') return fail(res, 409, 'You already have an account with that name');
    throw e;
  }
};

/* PATCH /money-accounts/:id — details, opening balance and date, or switch it off */
export const update = async (req, res) => {
  const before = (await pool.query(`SELECT * FROM money_accounts WHERE account_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!before) return fail(res, 404, 'Not found');
  const b = { ...before, opening_balance: R(before.opening_balance_paise), ...req.body };
  const [c, error] = clean(b, before.kind);
  if (error) return fail(res, 400, error);
  const openingDate = isDate(req.body?.opening_date) ? req.body.opening_date : before.opening_date;
  const active = typeof req.body?.is_active === 'boolean' ? req.body.is_active : before.is_active;
  try {
    const { rows } = await pool.query(
      `UPDATE money_accounts SET name = $3, opening_balance_paise = $4, opening_date = $5, bank_name = $6, account_last4 = $7, ifsc = $8, lender = $9, interest_rate = $10, is_active = $11
       WHERE account_id = $1 AND business_id = $2 RETURNING *`,
      [before.account_id, req.tenant.businessId, c.name, c.opening, openingDate, c.bank, c.last4, c.ifsc, c.lender, c.rate, active]);
    recordAudit(req, { action: 'money_account.updated', resource_type: 'money_account', resource_id: before.account_id, metadata: req.body });
    res.json({ success: true, data: asAccount(rows[0], null) });
  } catch (e) {
    if (e.code === '23505') return fail(res, 409, 'You already have an account with that name');
    throw e;
  }
};

/* PUT /money-accounts/methods { CASH: id, UPI: id | null, ... } — which account each payment method lands in */
export const setMethods = async (req, res) => {
  const { accounts } = await loadAccounts(pool, req.tenant.businessId);
  const ids = new Set(accounts.filter((a) => a.kind !== 'LOAN').map((a) => a.account_id));
  const next = {};
  for (const m of MONEY_METHODS) {
    const v = req.body?.[m];
    if (v == null || v === '') continue;
    if (!ids.has(Number(v))) return fail(res, 400, `Choose a cash or bank account for ${m}`);
    next[m] = Number(v);
  }
  await pool.query(`UPDATE businesses SET payment_accounts = $2 WHERE business_id = $1`, [req.tenant.businessId, JSON.stringify(next)]);
  recordAudit(req, { action: 'money_account.methods_set', resource_type: 'business', resource_id: req.tenant.businessId, metadata: next });
  res.json({ success: true, data: next });
};

/* the accounts a kind of transfer may move between: [from kinds, to kinds] (null = outside the business) */
const ROUTES = {
  TRANSFER: [['CASH', 'BANK'], ['CASH', 'BANK']],
  LOAN_TAKEN: [['LOAN'], ['CASH', 'BANK']],
  LOAN_REPAID: [['CASH', 'BANK'], ['LOAN']],
  CAPITAL_IN: [null, ['CASH', 'BANK']],
  DRAWINGS: [['CASH', 'BANK'], null]
};

/* POST /money-accounts/transfers { kind, from_account_id?, to_account_id?, amount, interest?, date, note? } */
export const createTransfer = async (req, res) => {
  const b = req.body || {};
  const kind = String(b.kind || 'TRANSFER').toUpperCase();
  if (!TRANSFER_KINDS.includes(kind)) return fail(res, 400, 'Unknown kind of transfer');
  let amount; let interest = 0;
  try { amount = toPaise(b.amount); interest = b.interest ? toPaise(b.interest) : 0; } catch { return fail(res, 400, 'Enter the amount as a number'); }
  if (!(amount > 0)) return fail(res, 400, 'Enter an amount above zero');
  if (interest < 0 || (interest > 0 && kind !== 'LOAN_REPAID')) return fail(res, 400, 'Interest goes only with a loan instalment');
  const date = isDate(b.date) ? b.date : await businessToday(req.tenant.businessId);
  const { accounts } = await loadAccounts(pool, req.tenant.businessId);
  const find = (id) => (id == null || id === '' ? null : accounts.find((a) => a.account_id === Number(id)) ?? false);
  const from = find(b.from_account_id); const to = find(b.to_account_id);
  const [fromKinds, toKinds] = ROUTES[kind];
  if (from === false || to === false) return fail(res, 400, 'Account not found');
  if (fromKinds ? !from || !fromKinds.includes(from.kind) : from) return fail(res, 400, kind === 'LOAN_TAKEN' ? 'Choose the loan the money came from' : fromKinds ? 'Choose the account the money leaves' : 'Money the owner puts in comes from outside the business');
  if (toKinds ? !to || !toKinds.includes(to.kind) : to) return fail(res, 400, kind === 'LOAN_REPAID' ? 'Choose the loan being paid' : toKinds ? 'Choose the account the money goes into' : 'Money the owner takes out leaves the business');
  if (from && to && from.account_id === to.account_id) return fail(res, 400, 'Choose two different accounts');
  const { rows } = await pool.query(
    `INSERT INTO money_transfers (business_id, kind, from_account_id, to_account_id, amount_paise, interest_paise, transfer_date, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [req.tenant.businessId, kind, from?.account_id ?? null, to?.account_id ?? null, amount, interest, date, b.note ? String(b.note).slice(0, 200) : null, req.auth.userId]);
  recordAudit(req, { action: 'money_transfer.created', resource_type: 'money_transfer', resource_id: rows[0].transfer_id, metadata: { kind, amount: R(amount), interest: R(interest) } });
  res.status(201).json({ success: true, data: { transfer_id: rows[0].transfer_id } });
};

/* POST /money-accounts/transfers/:id/void — a mistake is voided, never deleted, so the statement shows what happened */
export const voidTransfer = async (req, res) => {
  const { rowCount } = await pool.query(`UPDATE money_transfers SET voided_at = CURRENT_TIMESTAMP WHERE transfer_id = $1 AND business_id = $2 AND voided_at IS NULL`, [req.params.id, req.tenant.businessId]);
  if (!rowCount) return fail(res, 404, 'Not found');
  recordAudit(req, { action: 'money_transfer.voided', resource_type: 'money_transfer', resource_id: Number(req.params.id) });
  res.json({ success: true });
};

/* GET /money-accounts/:id/statement?from&to — a bank statement, or for a loan, the loan statement */
export const accountStatement = async (req, res) => {
  const to = isDate(req.query.to) ? req.query.to : await businessToday(req.tenant.businessId);
  const from = isDate(req.query.from) ? req.query.from : addDaysISO(to, -30);
  if (from > to) return fail(res, 400, 'The start date is after the end date');
  const data = await statement(pool, req.tenant.businessId, req.params.id, from, to);
  if (!data) return fail(res, 404, 'Not found');
  res.json({ success: true, data });
};

/* this financial year's profit and loss in paise, from the same report the Reports page shows */
const plFor = (req) => async ({ from, to }) => {
  const out = { body: null, status() { return this; }, json(b) { this.body = b; return this; } };
  await profit.profitLoss({ tenant: { ...req.tenant, scopeBranchId: null }, query: { from, to }, params: {}, body: {}, headers: {} }, out);
  const d = out.body.data;
  const p = (v) => toPaise(v || 0);
  return { net_sales: p(d.net_sales), cogs: p(d.cost_of_goods), expenses: p(d.total_expenses), other_income: p(d.total_other_income), discounts_at_payment: p(d.discounts_at_payment) };
};

/* GET /reports/balance-sheet — today's position */
export const balanceSheet = async (req, res) => {
  const p = await position(pool, req.tenant.businessId, plFor(req));
  const line = (name, paise) => ({ name, amount: R(paise) });
  res.json({
    success: true,
    data: {
      as_on: p.today, financial_year: p.fy,
      assets: [
        ...p.cashBank.map((a) => line(a.name, a.paise)),
        ...p.notLinked.map((x) => line(`${x.method} not linked to an account`, x.paise)),
        line('Customers owe you', p.receivable), line('Stock at cost', p.stock)
      ],
      liabilities: [...p.loans.map((l) => line(l.name, l.paise)), line('You owe suppliers', p.payable)],
      capital: [line('Capital at the start of the year', p.openingCapital), line('Money put in this year', p.capitalIn), line('Money taken out this year', -p.drawings), line('Profit this year', p.profit)],
      total_assets: R(p.assets), total_liabilities_and_capital: R(p.liabilities + p.openingCapital + p.capitalIn - p.drawings + p.profit),
      notes: ['Worked out from your sales, purchases, expenses and money accounts. FlowXP does not keep a ledger of the owner\'s capital, so the capital at the start of the year is the figure that makes the two sides equal.', 'Stock is valued at each item\'s purchase price. GST owed to the government is not shown separately.']
    }
  });
};

/* GET /reports/trial-balance — the same figures as debits and credits, this financial year */
export const trialBalance = async (req, res) => {
  const p = await position(pool, req.tenant.businessId, plFor(req));
  const rows = [];
  const add = (name, paise, side) => { if (paise) rows.push({ name, debit: side === 'D' ? R(Math.abs(paise)) : 0, credit: side === 'C' ? R(Math.abs(paise)) : 0 }); };
  const asset = (name, paise) => add(name, paise, paise >= 0 ? 'D' : 'C');
  for (const a of p.cashBank) asset(a.name, a.paise);
  for (const x of p.notLinked) asset(`${x.method} not linked to an account`, x.paise);
  asset('Customers owe you (sundry debtors)', p.receivable);
  asset('Stock at cost', p.stock);
  for (const l of p.loans) add(l.name, l.paise, l.paise >= 0 ? 'C' : 'D');
  add('You owe suppliers (sundry creditors)', p.payable, 'C');
  add('Sales (after discounts and returns)', p.pl.net_sales, 'C');
  add('Other income', p.pl.other_income, 'C');
  add('Cost of goods sold', p.pl.cogs, 'D');
  add('Expenses', p.pl.expenses, 'D');
  add('Discounts given at payment', p.pl.discounts_at_payment, 'D');
  add('Loan interest', p.pl.interest, 'D');
  add('Money taken out by the owner', p.drawings, 'D');
  add('Money put in by the owner', p.capitalIn, 'C');
  add('Capital at the start of the year', p.openingCapital, p.openingCapital >= 0 ? 'C' : 'D');
  const total = (k) => Math.round(rows.reduce((s, r) => s + r[k] * 100, 0)) / 100;
  res.json({ success: true, data: { as_on: p.today, financial_year: p.fy, rows, total_debit: total('debit'), total_credit: total('credit'), notes: ['Profit and loss figures are for this financial year so far; money, stock, dues and loans are as on today. The capital at the start of the year is the balancing figure.'] } });
};
