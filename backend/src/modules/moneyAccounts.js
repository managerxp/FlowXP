/*
 * Cash, bank and loan accounts (migration 0140). Nothing new is recorded at the till: every payment, supplier payment, expense, other income and
 * refund already says its method (cash, UPI, card ...), and businesses.payment_accounts says which account each method lands in. Transfers
 * typed by hand (cash into the bank, a loan, an instalment, money the owner put in or took out) do the rest.
 *
 * Balances are worked out, never stored: an account holds its opening balance plus everything that landed in it since its opening date.
 * A LOAN account holds what is owed; inside the arithmetic it is the negative of that, so one formula serves every kind.
 *
 * Methods that are not money moving today: CREDIT (owed, not paid), WALLET and GIFT_CARD (spent from a balance paid for earlier).
 */
import { toRupees } from '../utils/money.js';
import { addDaysISO, businessToday } from '../utils/dates.js';

export const KINDS = ['CASH', 'BANK', 'LOAN'];
export const MONEY_METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'];
export const TRANSFER_KINDS = ['TRANSFER', 'LOAN_TAKEN', 'LOAN_REPAID', 'CAPITAL_IN', 'DRAWINGS'];
const NOT_MONEY = `('CREDIT','WALLET','GIFT_CARD')`;

/** A Cash account is there from the start, holding cash from the day the business began, and cash payments go to it. */
export const ensureAccounts = async (db, businessId) => {
  const has = (await db.query(`SELECT 1 FROM money_accounts WHERE business_id = $1 LIMIT 1`, [businessId])).rows.length;
  if (has) return;
  const cash = (await db.query(
    `INSERT INTO money_accounts (business_id, name, kind, opening_date)
     SELECT $1, 'Cash in hand', 'CASH', (created_at AT TIME ZONE COALESCE(timezone, 'Asia/Kolkata'))::date FROM businesses WHERE business_id = $1
     ON CONFLICT DO NOTHING RETURNING account_id`, [businessId])).rows[0];
  if (cash) await db.query(`UPDATE businesses SET payment_accounts = payment_accounts || jsonb_build_object('CASH', $2::int) WHERE business_id = $1 AND NOT (payment_accounts ? 'CASH')`, [businessId, cash.account_id]);
};

export const loadAccounts = async (db, businessId) => {
  await ensureAccounts(db, businessId);
  const accounts = (await db.query(`SELECT * FROM money_accounts WHERE business_id = $1 ORDER BY CASE kind WHEN 'CASH' THEN 0 WHEN 'BANK' THEN 1 ELSE 2 END, account_id`, [businessId])).rows;
  const map = (await db.query(`SELECT payment_accounts FROM businesses WHERE business_id = $1`, [businessId])).rows[0]?.payment_accounts || {};
  return { accounts, map };
};

/** Every movement of money by method, one row each, between two dates (the sources the cash flow report already reads). */
export const movements = async (db, businessId, from, to) => (await db.query(
  `SELECT d::text AS date, upper(method) AS method, in_p::bigint AS in_p, out_p::bigint AS out_p, what, ref FROM (
     SELECT x.payment_date AS d, x.payment_method AS method,
            CASE WHEN x.po_id IS NULL AND x.supplier_id IS NULL THEN x.amount_paise ELSE 0 END AS in_p,
            CASE WHEN x.po_id IS NULL AND x.supplier_id IS NULL THEN 0 ELSE x.amount_paise END AS out_p,
            CASE WHEN x.po_id IS NOT NULL OR x.supplier_id IS NOT NULL THEN 'Paid to supplier' WHEN x.invoice_id IS NOT NULL THEN 'Bill paid' ELSE 'Received from customer' END AS what,
            COALESCE(i.invoice_number, s.name, c.name, x.reference_number, '') AS ref, x.created_at AS ts
     FROM payments x LEFT JOIN invoices i ON i.invoice_id = x.invoice_id LEFT JOIN suppliers s ON s.supplier_id = x.supplier_id LEFT JOIN customers c ON c.customer_id = x.customer_id
     WHERE x.business_id = $1 AND x.payment_date BETWEEN $2 AND $3
     UNION ALL
     SELECT x.expense_date, COALESCE(x.payment_method, 'CASH'), 0, x.amount_paise, 'Expense', concat_ws(' · ', x.category, x.description), x.created_at
     FROM expenses x WHERE x.business_id = $1 AND x.expense_date BETWEEN $2 AND $3
     UNION ALL
     SELECT x.income_date, COALESCE(x.payment_method, 'CASH'), x.amount_paise, 0, 'Other income', concat_ws(' · ', x.category, x.description), x.created_at
     FROM other_income x WHERE x.business_id = $1 AND x.income_date BETWEEN $2 AND $3
     UNION ALL
     SELECT (r.created_at AT TIME ZONE COALESCE(b.timezone, 'Asia/Kolkata'))::date, COALESCE(r.method, 'CASH'), 0, r.amount_paise, 'Refund', x.invoice_number, r.created_at
     FROM refunds r JOIN invoices x ON x.invoice_id = r.invoice_id JOIN businesses b ON b.business_id = x.business_id
     WHERE x.business_id = $1 AND (r.created_at AT TIME ZONE COALESCE(b.timezone, 'Asia/Kolkata'))::date BETWEEN $2 AND $3
   ) t WHERE upper(method) NOT IN ${NOT_MONEY} ORDER BY d, ts`, [businessId, from, to])).rows;

export const transfersBetween = async (db, businessId, from, to) => (await db.query(
  `SELECT transfer_id, kind, from_account_id, to_account_id, amount_paise::bigint AS amount_paise, interest_paise::bigint AS interest_paise, transfer_date::text AS date, note
   FROM money_transfers WHERE business_id = $1 AND voided_at IS NULL AND transfer_date BETWEEN $2 AND $3 ORDER BY transfer_date, transfer_id`, [businessId, from, to])).rows;

const TRANSFER_TEXT = { TRANSFER: 'Moved', LOAN_TAKEN: 'Loan received', LOAN_REPAID: 'Loan instalment', CAPITAL_IN: 'Owner put money in', DRAWINGS: 'Owner took money out' };

/** What a transfer does to one account: [in, out] in paise. A loan instalment also takes its interest out of the account that paid it. */
export const transferEffect = (t, accountId) => {
  const inP = t.to_account_id === accountId ? Number(t.amount_paise) : 0;
  const outP = t.from_account_id === accountId ? Number(t.amount_paise) + Number(t.interest_paise || 0) : 0;
  return [inP, outP];
};
/** The arithmetic starting point: money held for cash and bank, minus what is owed for a loan. */
export const base = (a) => (a.kind === 'LOAN' ? -Number(a.opening_balance_paise) : Number(a.opening_balance_paise));
const accountOf = (map, method) => (map[method] != null ? Number(map[method]) : null);

/** Every account's balance at the end of `to`, plus money that came or went by a method no account is set for. */
export const balances = async (db, businessId, to) => {
  const { accounts, map } = await loadAccounts(db, businessId);
  const earliest = accounts.reduce((m, a) => (String(a.opening_date) < m ? String(a.opening_date) : m), '2000-01-01');
  const start = (await db.query(`SELECT LEAST($2::date, (created_at AT TIME ZONE COALESCE(timezone, 'Asia/Kolkata'))::date)::text AS d FROM businesses WHERE business_id = $1`, [businessId, earliest])).rows[0].d;
  const rows = await movements(db, businessId, start, to);
  const transfers = await transfersBetween(db, businessId, start, to);
  const held = new Map(accounts.map((a) => [a.account_id, base(a)]));
  const opening = new Map(accounts.map((a) => [a.account_id, iso(a.opening_date)]));
  const unassigned = new Map();
  for (const r of rows) {
    const id = accountOf(map, r.method);
    if (id != null && held.has(id)) { if (r.date >= opening.get(id)) held.set(id, held.get(id) + Number(r.in_p) - Number(r.out_p)); }
    else unassigned.set(r.method, (unassigned.get(r.method) || 0) + Number(r.in_p) - Number(r.out_p));
  }
  for (const t of transfers) {
    for (const id of [t.from_account_id, t.to_account_id]) {
      if (id == null || !held.has(id) || t.date < opening.get(id)) continue;
      const [i, o] = transferEffect(t, id); held.set(id, held.get(id) + i - o);
    }
  }
  return { accounts, map, held, unassigned, transfers };
};
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

export const asAccount = (a, heldPaise) => ({
  account_id: a.account_id, name: a.name, kind: a.kind, opening_balance: toRupees(a.opening_balance_paise), opening_date: iso(a.opening_date),
  bank_name: a.bank_name, account_last4: a.account_last4, ifsc: a.ifsc, lender: a.lender, interest_rate: a.interest_rate == null ? null : Number(a.interest_rate),
  is_active: a.is_active,
  // cash and bank: what is in it; loan: what is still owed
  balance: heldPaise == null ? null : toRupees(a.kind === 'LOAN' ? -heldPaise : heldPaise)
});

/** One account's statement between two dates: the balance before, each movement with the balance after it, and the balance at the end. */
export const statement = async (db, businessId, accountId, from, to) => {
  const { accounts, map } = await loadAccounts(db, businessId);
  const a = accounts.find((x) => x.account_id === Number(accountId));
  if (!a) return null;
  const open = iso(a.opening_date);
  const methods = Object.entries(map).filter(([, id]) => Number(id) === a.account_id).map(([m]) => m);
  const start = from < open ? open : from;
  let bal = base(a);
  if (start > open) {
    for (const r of await movements(db, businessId, open, addDaysISO(start, -1))) if (methods.includes(r.method)) bal += Number(r.in_p) - Number(r.out_p);
    for (const t of await transfersBetween(db, businessId, open, addDaysISO(start, -1))) { const [i, o] = transferEffect(t, a.account_id); bal += i - o; }
  }
  const sign = a.kind === 'LOAN' ? -1 : 1;
  const opening = bal;
  const lines = [];
  for (const r of await movements(db, businessId, start, to)) {
    if (!methods.includes(r.method)) continue;
    lines.push({ date: r.date, what: r.what, detail: r.ref, method: r.method, in: Number(r.in_p), out: Number(r.out_p) });
  }
  const names = new Map(accounts.map((x) => [x.account_id, x.name]));
  for (const t of await transfersBetween(db, businessId, start, to)) {
    const [i, o] = transferEffect(t, a.account_id);
    if (!i && !o) continue;
    const other = t.from_account_id === a.account_id ? t.to_account_id : t.from_account_id;
    const detail = [other != null ? `${t.from_account_id === a.account_id ? 'to' : 'from'} ${names.get(other)}` : '', Number(t.interest_paise) && t.from_account_id === a.account_id ? `interest ${toRupees(t.interest_paise)}` : '', t.note || ''].filter(Boolean).join(' · ');
    lines.push({ date: t.date, what: TRANSFER_TEXT[t.kind], detail, method: null, in: i, out: o, transfer_id: t.transfer_id });
  }
  lines.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  // for a loan, "in" (money borrowed out of it) raises what is owed: shown from the lender's side, the columns read as borrowed / repaid
  const out = lines.map((l) => { bal += l.in - l.out; return { ...l, in: toRupees(l.in), out: toRupees(l.out), balance: toRupees(sign * bal) }; });
  return { account: asAccount(a, null), from: start, to, opening_balance: toRupees(sign * opening), closing_balance: toRupees(sign * bal), lines: out };
};

/* ── Trial balance and balance sheet ───────────────────────────────────── */

/** The indian financial year (April to March) that `today` falls in. */
export const financialYear = (today) => {
  const [y, m] = today.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: today };
};

/**
 * The position today, worked out from what FlowXP records: money in each account, what customers owe, the stock at cost, what is owed to suppliers
 * and lenders, and this financial year's profit and loss. FlowXP keeps no ledger of the owner's capital, so the capital is the figure that makes it
 * balance (assets less liabilities less this year's profit), and the screens say so.
 */
export const position = async (db, businessId, plFigures) => {
  const today = await businessToday(businessId);
  const { accounts, held, unassigned } = await balances(db, businessId, today);
  const cashBank = accounts.filter((a) => a.kind !== 'LOAN').map((a) => ({ name: a.name, kind: a.kind, paise: held.get(a.account_id) }));
  const loans = accounts.filter((a) => a.kind === 'LOAN').map((a) => ({ name: a.name, paise: -held.get(a.account_id) }));
  const notLinked = [...unassigned].filter(([, v]) => v !== 0).map(([method, paise]) => ({ method, paise }));
  const receivable = Number((await db.query(`SELECT COALESCE(SUM(balance_due_paise), 0) AS p FROM invoices WHERE business_id = $1 AND status = 'ISSUED'`, [businessId])).rows[0].p);
  const payable = Number((await db.query(`SELECT COALESCE(SUM(balance_due_paise), 0) AS p FROM purchase_orders WHERE business_id = $1 AND status NOT IN ('CANCELLED','DRAFT')`, [businessId])).rows[0].p);
  const stock = Number((await db.query(
    `SELECT COALESCE(SUM(GREATEST(bs.quantity, 0) * p.purchase_price_paise), 0)::bigint AS p FROM branch_stock bs JOIN products p ON p.product_id = bs.product_id
     WHERE p.business_id = $1 AND p.track_inventory`, [businessId])).rows[0].p);
  const fy = financialYear(today);
  const interest = Number((await db.query(`SELECT COALESCE(SUM(interest_paise), 0) AS p FROM money_transfers WHERE business_id = $1 AND voided_at IS NULL AND transfer_date BETWEEN $2 AND $3`, [businessId, fy.from, fy.to])).rows[0].p);
  const drawings = Number((await db.query(`SELECT COALESCE(SUM(amount_paise), 0) AS p FROM money_transfers WHERE business_id = $1 AND voided_at IS NULL AND kind = 'DRAWINGS' AND transfer_date BETWEEN $2 AND $3`, [businessId, fy.from, fy.to])).rows[0].p);
  const capitalIn = Number((await db.query(`SELECT COALESCE(SUM(amount_paise), 0) AS p FROM money_transfers WHERE business_id = $1 AND voided_at IS NULL AND kind = 'CAPITAL_IN' AND transfer_date BETWEEN $2 AND $3`, [businessId, fy.from, fy.to])).rows[0].p);
  const pl = await plFigures(fy);   // paise: { net_sales, cogs, expenses, other_income, discounts_at_payment }
  const profit = pl.net_sales - pl.cogs - pl.expenses + pl.other_income - pl.discounts_at_payment - interest;
  const assets = cashBank.reduce((s, x) => s + x.paise, 0) + notLinked.reduce((s, x) => s + x.paise, 0) + receivable + stock;
  const liabilities = loans.reduce((s, x) => s + x.paise, 0) + payable;
  const openingCapital = assets - liabilities - profit - capitalIn + drawings;
  return { today, fy, cashBank, notLinked, receivable, stock, loans, payable, pl: { ...pl, interest }, profit, capitalIn, drawings, openingCapital, assets, liabilities };
};
