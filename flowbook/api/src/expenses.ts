import type { Db } from './db.ts';
import { LedgerError, post, reverse } from './ledger.ts';
import type { LineInput } from './ledger.ts';
import { taxOn, toPaise } from './money.ts';

/* Expenses paid at the time: rent, fuel, tea, repairs. One journal: the expense (and the GST you can claim back) is debited, the cash, bank,
   UPI or card account is credited. An expense you will pay later is a purchase bill, not this. */

const PAID_WITH = { CASH: 'CASH', BANK: 'BANK', UPI: 'UPI_CLEARING', CARD: 'CARD_CLEARING' } as const;
export type ExpenseIn = { date: string; accountId: bigint; amount: string; taxCode?: string; interState?: boolean; paidWith: keyof typeof PAID_WITH; description: string; paidTo?: string; reference?: string; idempotencyKey: string };

export const recordExpense = async (c: Db, orgId: bigint, e: ExpenseIn, actor: string, override?: { reason: string }): Promise<{ entryId: bigint; entryNo: string }> => {
  const acct = (await c.query(`SELECT type, active FROM accounts WHERE organization_id = $1 AND id = $2`, [orgId, e.accountId])).rows[0];
  if (!acct || acct.type !== 'EXPENSE' || !acct.active) throw new LedgerError('bad_expense_account', 'choose an active expense account');
  const net = toPaise(e.amount);
  if (net <= 0n) throw new LedgerError('bad_amount', 'the amount must be above zero');
  let tax = 0n; let rateBp = 0;
  if (e.taxCode) {
    const rate = (await c.query(`SELECT rate_bp FROM tax_rates WHERE code = $1 AND effective_from <= $2::date ORDER BY effective_from DESC LIMIT 1`, [e.taxCode, e.date])).rows[0];
    if (!rate) throw new LedgerError('unknown_tax_code', `no rate for ${e.taxCode} on ${e.date}`);
    rateBp = rate.rate_bp as number; tax = taxOn(net, rateBp);
  }
  const half = tax / 2n;
  const lines: LineInput[] = [{ account: e.accountId, side: 'D', amount: net }];
  if (e.interState) lines.push({ account: 'INPUT_IGST', side: 'D', amount: tax, taxRateBp: rateBp });
  else lines.push({ account: 'INPUT_CGST', side: 'D', amount: half, taxRateBp: rateBp }, { account: 'INPUT_SGST', side: 'D', amount: tax - half, taxRateBp: rateBp });
  lines.push({ account: PAID_WITH[e.paidWith], side: 'C', amount: net + tax });
  const memo = [e.description.trim(), e.paidTo && `to ${e.paidTo.trim()}`, e.reference && `ref ${e.reference.trim()}`].filter(Boolean).join(' · ');
  const out = await post(c, orgId, { date: e.date, sourceType: 'expense', sourceId: e.idempotencyKey, kind: 'EXPENSE', memo, actor, override, lines: lines.filter((l) => l.amount !== 0n) });
  return { entryId: out.entryId, entryNo: out.entryNo };
};

export const listExpenses = async (c: Db, q: { from: string; to: string; limit: number }) => (await c.query(
  `SELECT e.id, e.entry_no, e.posting_date::text AS date, e.memo,
          (SELECT a.name FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = e.id AND l.side = 'D' AND a.type = 'EXPENSE' LIMIT 1) AS account,
          (SELECT a.name FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = e.id AND l.side = 'C' LIMIT 1) AS paid_with,
          (SELECT COALESCE(SUM(l.base_amount_minor), 0)::bigint FROM journal_lines l WHERE l.entry_id = e.id AND l.side = 'C') AS total_minor,
          (SELECT COALESCE(SUM(l.base_amount_minor), 0)::bigint FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE l.entry_id = e.id AND l.side = 'D' AND a.type = 'ASSET') AS tax_minor,
          EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = e.id) AS reversed
     FROM journal_entries e WHERE e.source_type = 'expense' AND e.status = 'POSTED' AND e.posting_date BETWEEN $1::date AND $2::date ORDER BY e.posting_date DESC, e.id DESC LIMIT $3`,
  [q.from, q.to, q.limit])).rows;

export const voidExpense = async (c: Db, orgId: bigint, entryId: bigint, o: { date: string; reason: string }, actor: string) => {
  const ok = (await c.query(`SELECT 1 FROM journal_entries WHERE organization_id = $1 AND id = $2 AND source_type = 'expense'`, [orgId, entryId])).rowCount;
  if (!ok) throw new LedgerError('not_found', 'no such expense');
  return reverse(c, orgId, entryId, { ...o, actor });
};
