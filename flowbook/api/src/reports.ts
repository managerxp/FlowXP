import type { Db } from './db.ts';
import { verifyAudit } from './audit.ts';

/* Every report is a query over POSTED journal lines and nothing else (I4, I7). Drafts never appear. */

export type TbRow = { id: bigint; code: string; name: string; type: string; debit: bigint; credit: bigint };

const BALANCES = `
  SELECT a.id, a.code, a.name, a.type,
         COALESCE(SUM(l.base_amount_minor) FILTER (WHERE l.side = 'D'), 0)::bigint AS debit,
         COALESCE(SUM(l.base_amount_minor) FILTER (WHERE l.side = 'C'), 0)::bigint AS credit
    FROM accounts a
    LEFT JOIN (journal_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'POSTED' AND e.posting_date BETWEEN $2::date AND $3::date)
           ON l.account_id = a.id
   WHERE a.organization_id = $1
   GROUP BY a.id ORDER BY a.code`;

const balances = async (c: Db, orgId: bigint, from: string, to: string): Promise<TbRow[]> => (await c.query(BALANCES, [orgId, from, to])).rows as TbRow[];
const BEGINNING = '0001-01-01';

/** Trial balance: each account's net balance on its normal side, for a date range (or since the start). Totals must match. */
export const trialBalance = async (c: Db, orgId: bigint, opts: { to: string; from?: string }) => {
  const rows = (await balances(c, orgId, opts.from ?? BEGINNING, opts.to)).filter((r) => r.debit !== 0n || r.credit !== 0n);
  const view = rows.map((r) => ({ ...r, debitBalance: r.debit > r.credit ? r.debit - r.credit : 0n, creditBalance: r.credit > r.debit ? r.credit - r.debit : 0n }));
  const totalDebit = view.reduce((a, r) => a + r.debitBalance, 0n);
  const totalCredit = view.reduce((a, r) => a + r.creditBalance, 0n);
  return { rows: view, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
};

export const profitAndLoss = async (c: Db, orgId: bigint, from: string, to: string) => {
  const rows = await balances(c, orgId, from, to);
  const income = rows.filter((r) => r.type === 'INCOME' && (r.debit || r.credit)).map((r) => ({ code: r.code, name: r.name, amount: r.credit - r.debit }));
  const expense = rows.filter((r) => r.type === 'EXPENSE' && (r.debit || r.credit)).map((r) => ({ code: r.code, name: r.name, amount: r.debit - r.credit }));
  const totalIncome = income.reduce((a, r) => a + r.amount, 0n);
  const totalExpense = expense.reduce((a, r) => a + r.amount, 0n);
  return { income, expense, totalIncome, totalExpense, netProfit: totalIncome - totalExpense };
};

/** Balance sheet as of a date. Profit not yet closed to retained earnings is shown as its own line, so the sheet always balances. */
export const balanceSheet = async (c: Db, orgId: bigint, asOf: string) => {
  const rows = await balances(c, orgId, BEGINNING, asOf);
  const side = (type: string, sign: 1n | -1n) => rows.filter((r) => r.type === type && (r.debit || r.credit)).map((r) => ({ code: r.code, name: r.name, amount: sign * (r.debit - r.credit) }));
  const assets = side('ASSET', 1n);
  const liabilities = side('LIABILITY', -1n);
  const equity = side('EQUITY', -1n);
  const profitToDate = rows.filter((r) => r.type === 'INCOME').reduce((a, r) => a + (r.credit - r.debit), 0n) - rows.filter((r) => r.type === 'EXPENSE').reduce((a, r) => a + (r.debit - r.credit), 0n);
  const sum = (xs: { amount: bigint }[]) => xs.reduce((a, r) => a + r.amount, 0n);
  const totalAssets = sum(assets);
  const totalLiabilitiesAndEquity = sum(liabilities) + sum(equity) + profitToDate;
  return { assets, liabilities, equity, profitToDate, totalAssets, totalLiabilitiesAndEquity, balanced: totalAssets === totalLiabilitiesAndEquity };
};

/** Balances by party on one account (the sub-ledger), for comparison with the control account. */
export const partyBalances = async (c: Db, orgId: bigint, accountKey: string, to: string) => (await c.query(
  `SELECT l.party_id, SUM(CASE WHEN l.side = 'D' THEN l.base_amount_minor ELSE -l.base_amount_minor END)::bigint AS balance
     FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'POSTED' AND e.posting_date <= $3::date
     JOIN accounts a ON a.id = l.account_id
    WHERE l.organization_id = $1 AND a.system_key = $2 GROUP BY l.party_id ORDER BY l.party_id`, [orgId, accountKey, to])).rows as { party_id: bigint | null; balance: bigint }[];

/** The nightly self-check (backlog FB-017): anything returned here is a defect to investigate. Empty means the books are consistent. */
export const reconcile = async (c: Db, orgId: bigint): Promise<string[]> => {
  const issues: string[] = [];
  const tb = await trialBalance(c, orgId, { to: '9999-12-31' });
  if (!tb.balanced) issues.push(`trial balance does not balance: debits ${tb.totalDebit} credits ${tb.totalCredit}`);
  const bad = (await c.query(
    `SELECT e.entry_no FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id WHERE e.organization_id = $1 AND e.status = 'POSTED'
      GROUP BY e.id HAVING SUM(CASE WHEN l.side = 'D' THEN l.base_amount_minor ELSE -l.base_amount_minor END) <> 0`, [orgId])).rows;
  for (const r of bad) issues.push(`entry ${r.entry_no} is unbalanced`);
  const orphans = (await c.query(`SELECT source_type, source_id FROM posting_register WHERE organization_id = $1 AND entry_id IS NULL`, [orgId])).rows;
  for (const r of orphans) issues.push(`posting key ${r.source_type}:${r.source_id} has no entry`);
  const broken = await verifyAudit(c, orgId);
  if (broken !== null) issues.push(`audit chain broken at row ${broken}`);
  return issues;
};
