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
export const partyBalances = async (c: Db, orgId: bigint, accountKey: string, to: string, opts: { withoutEvents?: boolean } = {}) => (await c.query(
  `SELECT l.party_id, SUM(CASE WHEN l.side = 'D' THEN l.base_amount_minor ELSE -l.base_amount_minor END)::bigint AS balance
     FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'POSTED' AND e.posting_date <= $3::date
     JOIN accounts a ON a.id = l.account_id
    WHERE l.organization_id = $1 AND a.system_key = $2
      AND (NOT $4::boolean OR (e.source_type NOT LIKE 'flowxp\\_%'
           AND NOT (e.source_type = 'reversal' AND EXISTS (SELECT 1 FROM journal_entries o WHERE o.id = e.reverses_entry_id AND o.source_type LIKE 'flowxp\\_%'))))
    GROUP BY l.party_id ORDER BY l.party_id`, [orgId, accountKey, to, opts.withoutEvents ?? false])).rows as { party_id: bigint | null; balance: bigint }[];

/** The documents' own balances must agree, party by party, with the receivable and payable accounts they post to.
    Kept apart from `reconcile` because journals posted by hand (or by rules without a document) have no document to match. */
export const documentIssues = async (c: Db, orgId: bigint): Promise<string[]> => {
  const issues: string[] = [];
  const expected = async (sql: string) => new Map((await c.query(sql, [orgId])).rows.map((r) => [String(r.party_id), r.balance as bigint]));
  const checks: [string, string, string][] = [
    ['AR', 'receivables', `SELECT party_id, SUM(v)::bigint AS balance FROM (
        SELECT party_id, balance_minor AS v FROM documents WHERE organization_id = $1 AND kind = 'INVOICE' AND status = 'ISSUED'
        UNION ALL SELECT party_id, -balance_minor FROM documents WHERE organization_id = $1 AND kind = 'CREDIT_NOTE' AND status = 'ISSUED'
        UNION ALL SELECT party_id, -unallocated_minor FROM payments WHERE organization_id = $1 AND direction = 'IN' AND status = 'POSTED') x GROUP BY party_id`],
    ['AP', 'payables', `SELECT party_id, SUM(v)::bigint AS balance FROM (
        SELECT party_id, -balance_minor AS v FROM documents WHERE organization_id = $1 AND kind = 'BILL' AND status = 'ISSUED'
        UNION ALL SELECT party_id, balance_minor FROM documents WHERE organization_id = $1 AND kind = 'DEBIT_NOTE' AND status = 'ISSUED'
        UNION ALL SELECT party_id, unallocated_minor FROM payments WHERE organization_id = $1 AND direction = 'OUT' AND status = 'POSTED') x GROUP BY party_id`]
  ];
  for (const [key, label, sql] of checks) {
    const docs = await expected(sql);
    const ledger = new Map((await partyBalances(c, orgId, key, '9999-12-31', { withoutEvents: true })).map((r) => [String(r.party_id), r.balance]));
    for (const party of new Set([...docs.keys(), ...ledger.keys()])) {
      const d = docs.get(party) ?? 0n; const l = ledger.get(party) ?? 0n;
      if (d !== l) issues.push(`${label}: party ${party} is ${l} in the ledger but ${d} in the documents`);
    }
  }
  return issues;
};

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

/* Cash flow (direct method): every entry that moved money in a cash, bank, UPI or card account, grouped by what the money was for.
   The other lines of the entry say what for; when one entry has several (a sale with GST), the cash is split between them in proportion. */
const CASH_KEYS = ['CASH', 'BANK', 'UPI_CLEARING', 'CARD_CLEARING'];
const sectionOf = (type: string, key: string | null): 'investing' | 'financing' | 'operating' =>
  key === 'FIXED_ASSETS' || key === 'ACCUM_DEPRECIATION' || key === 'ASSET_SALE_GAIN_LOSS' ? 'investing' : type === 'EQUITY' ? 'financing' : 'operating';

export const cashFlow = async (c: Db, orgId: bigint, from: string, to: string) => {
  const cashIds = (await c.query(`SELECT id FROM accounts WHERE organization_id = $1 AND type = 'ASSET' AND (is_bank OR system_key = ANY($2))`, [orgId, CASH_KEYS])).rows.map((r) => r.id as bigint);
  const sumCash = async (a: string, b: string) => BigInt((await c.query(
    `SELECT COALESCE(SUM(CASE WHEN l.side = 'D' THEN l.base_amount_minor ELSE -l.base_amount_minor END), 0)::text AS n
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'POSTED'
      WHERE l.organization_id = $1 AND l.account_id = ANY($2) AND e.posting_date BETWEEN $3::date AND $4::date`, [orgId, cashIds, a, b])).rows[0].n);
  const opening = await sumCash(BEGINNING, new Date(new Date(`${from}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10));
  const lines = (await c.query(
    `SELECT l.entry_id, l.account_id, l.side, l.base_amount_minor::bigint AS amt, a.name, a.type, a.system_key
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'POSTED'
       JOIN accounts a ON a.id = l.account_id
      WHERE l.organization_id = $1 AND e.posting_date BETWEEN $2::date AND $3::date
        AND l.entry_id IN (SELECT entry_id FROM journal_lines WHERE organization_id = $1 AND account_id = ANY($4))
      ORDER BY l.entry_id, l.line_no`, [orgId, from, to, cashIds])).rows as { entry_id: string; account_id: bigint; side: 'D' | 'C'; amt: bigint; name: string; type: string; system_key: string | null }[];
  const byEntry = new Map<string, typeof lines>();
  for (const l of lines) byEntry.set(String(l.entry_id), [...(byEntry.get(String(l.entry_id)) ?? []), l]);
  const cash = new Set(cashIds.map(String));
  const buckets = new Map<string, { section: string; name: string; in: bigint; out: bigint }>();
  const put = (section: string, name: string, v: bigint) => { const k = `${section}|${name}`; const b = buckets.get(k) ?? { section, name, in: 0n, out: 0n }; if (v > 0n) b.in += v; else b.out += -v; buckets.set(k, b); };
  for (const ls of byEntry.values()) {
    const net = ls.filter((l) => cash.has(String(l.account_id))).reduce((a, l) => a + (l.side === 'D' ? l.amt : -l.amt), 0n);
    if (net === 0n) continue;
    // the lines that explain the cash: on the opposite side of the money
    const others = ls.filter((l) => !cash.has(String(l.account_id)) && l.side === (net > 0n ? 'C' : 'D'));
    const abs = net > 0n ? net : -net; const sign = net > 0n ? 1n : -1n;
    if (!others.length) { put('operating', 'Other', net); continue; }
    const total = others.reduce((a, l) => a + l.amt, 0n); let left = abs;
    others.forEach((l, i) => { const share = i === others.length - 1 ? left : (abs * l.amt) / total; left -= share; put(sectionOf(l.type, l.system_key), l.name, sign * share); });
  }
  const rows = [...buckets.values()];
  const section = (s: string) => { const r = rows.filter((x) => x.section === s).sort((a, b) => a.name.localeCompare(b.name)); const i = r.reduce((a, x) => a + x.in, 0n); const o = r.reduce((a, x) => a + x.out, 0n); return { rows: r, totalIn: i, totalOut: o, net: i - o }; };
  const operating = section('operating'); const investing = section('investing'); const financing = section('financing');
  const change = operating.net + investing.net + financing.net;
  const closing = opening + change;
  return { opening, operating, investing, financing, change, closing, matchesBooks: closing === await sumCash(BEGINNING, to) };
};
