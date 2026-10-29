import { createHash } from 'node:crypto';
import type { Db } from './db.ts';
import { audit } from './audit.ts';
import { BASE, costOfForeign, holding, rateMicro, rateOn } from './fx.ts';
import { LedgerError, post } from './ledger.ts';
import { roundDiv } from './money.ts';
import { toPaise } from './money.ts';

/* Bank reconciliation. Statement lines are imported for one ledger account and matched one-to-one with journal lines on it. Entries that were
   reversed (and the reversals) are left out of the books side because together they are nothing. Nothing here changes a posted entry. */

export const IMPORT_LIMIT = 2000;
export type StatementRow = { date: string; description?: string; reference?: string; amount: string };
const SIGNED = /^-?\d{1,12}(\.\d{1,2})?$/;

const bankAccount = async (c: Db, orgId: bigint, accountId: bigint) => {
  const a = (await c.query(`SELECT id, code, name, type, currency FROM accounts WHERE organization_id = $1 AND id = $2`, [orgId, accountId])).rows[0];
  if (!a || a.type !== 'ASSET') throw new LedgerError('bad_account', 'choose a bank, UPI or card account (an asset account)');
  return a as { id: bigint; code: string; name: string; currency: string };
};

export const importStatement = async (c: Db, orgId: bigint, accountId: bigint, rows: StatementRow[], actor: string) => {
  await bankAccount(c, orgId, accountId);
  if (rows.length === 0) throw new LedgerError('empty', 'the statement has no lines');
  if (rows.length > IMPORT_LIMIT) throw new LedgerError('too_many', `import at most ${IMPORT_LIMIT} lines at a time`);
  const seen = new Map<string, number>();
  let imported = 0;
  for (const r of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date) || Number.isNaN(Date.parse(r.date))) throw new LedgerError('bad_date', `${r.date} is not a date (use YYYY-MM-DD)`);
    if (!SIGNED.test(r.amount.trim())) throw new LedgerError('bad_amount', `${r.amount} is not an amount`);
    const amount = r.amount.trim().startsWith('-') ? -toPaise(r.amount.trim().slice(1)) : toPaise(r.amount.trim());
    if (amount === 0n) throw new LedgerError('bad_amount', 'a statement line cannot be zero');
    const base = `${r.date}|${amount}|${(r.description ?? '').trim().toLowerCase()}|${(r.reference ?? '').trim().toLowerCase()}`;
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);   // identical lines in one file are all real; the same file again adds none
    const key = createHash('sha256').update(`${base}|${n}`).digest('hex').slice(0, 32);
    const res = await c.query(
      `INSERT INTO bank_statement_lines (organization_id, account_id, txn_date, description, reference, amount_minor, dedupe_key) VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (organization_id, account_id, dedupe_key) DO NOTHING`, [orgId, accountId, r.date, (r.description ?? '').trim().slice(0, 300), r.reference?.trim().slice(0, 100) || null, amount, key]);
    imported += res.rowCount ?? 0;
  }
  await audit(c, orgId, { actor, action: 'bank.statement_imported', entityType: 'account', entityId: accountId, detail: { lines: rows.length, imported } });
  return { imported, skipped: rows.length - imported };
};

/** Journal lines on the account that are not yet matched, signed from the account's side. */
const BOOK_LINES = `
  SELECT l.id, e.posting_date::text AS date, e.entry_no, COALESCE(NULLIF(l.memo, ''), e.memo, '') AS memo, CASE l.side WHEN 'D' THEN COALESCE(l.foreign_amount_minor, l.base_amount_minor) ELSE -COALESCE(l.foreign_amount_minor, l.base_amount_minor) END AS amount_minor
    FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id JOIN accounts ac ON ac.id = l.account_id
   WHERE l.organization_id = $1 AND l.account_id = $2 AND e.status = 'POSTED' AND e.reverses_entry_id IS NULL AND (ac.currency = 'INR' OR l.foreign_amount_minor IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = e.id)`;

export const bankAccounts = async (c: Db, orgId: bigint) => (await c.query(
  `SELECT a.id, a.code, a.name, a.currency,
          COALESCE((SELECT SUM(CASE l.side WHEN 'D' THEN COALESCE(l.foreign_amount_minor, l.base_amount_minor) ELSE -COALESCE(l.foreign_amount_minor, l.base_amount_minor) END) FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'POSTED' WHERE l.account_id = a.id AND (a.currency = 'INR' OR l.foreign_amount_minor IS NOT NULL)), 0)::bigint AS book_balance_minor,
          COALESCE((SELECT SUM(CASE l.side WHEN 'D' THEN l.base_amount_minor ELSE -l.base_amount_minor END) FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'POSTED' WHERE l.account_id = a.id), 0)::bigint AS rupee_value_minor,
          (SELECT COUNT(*) FROM bank_statement_lines s WHERE s.account_id = a.id AND s.status = 'OPEN')::int AS open_statement_lines
     FROM accounts a WHERE a.organization_id = $1 AND a.type = 'ASSET' AND a.active AND (a.is_bank OR a.system_key IN ('BANK', 'UPI_CLEARING', 'CARD_CLEARING') OR EXISTS (SELECT 1 FROM bank_statement_lines s WHERE s.account_id = a.id))
    ORDER BY a.code`, [orgId])).rows;

const DAYS = 5;
export const workbench = async (c: Db, orgId: bigint, accountId: bigint, asOf: string) => {
  const account = await bankAccount(c, orgId, accountId);
  const statement = (await c.query(
    `SELECT id, txn_date::text AS date, description, reference, amount_minor, status, journal_line_id FROM bank_statement_lines
      WHERE organization_id = $1 AND account_id = $2 AND status <> 'MATCHED' AND txn_date <= $3::date ORDER BY txn_date, id`, [orgId, accountId, asOf])).rows;
  const book = (await c.query(
    `SELECT * FROM (${BOOK_LINES}) b WHERE b.date <= $3 AND NOT EXISTS (SELECT 1 FROM bank_statement_lines s WHERE s.journal_line_id = b.id) ORDER BY b.date, b.id`, [orgId, accountId, asOf])).rows as { id: bigint; date: string; amount_minor: bigint }[];
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  const taken = new Set<bigint>();
  const lines = statement.map((s) => {
    let best: { id: bigint; gap: number } | undefined;
    if (s.status === 'OPEN') for (const b of book) {
      if (b.amount_minor !== s.amount_minor || taken.has(b.id)) continue;
      const gap = Math.abs(day(b.date) - day(s.date));
      if (gap <= DAYS && (!best || gap < best.gap)) best = { id: b.id, gap };
    }
    if (best) taken.add(best.id);   // one suggestion per books line
    return { ...s, suggestion_id: best?.id ?? null };
  });
  const book_balance = (await c.query(
    `SELECT COALESCE(SUM(CASE l.side WHEN 'D' THEN COALESCE(l.foreign_amount_minor, l.base_amount_minor) ELSE -COALESCE(l.foreign_amount_minor, l.base_amount_minor) END), 0)::bigint AS v
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'POSTED' WHERE l.organization_id = $1 AND l.account_id = $2 AND e.posting_date <= $3::date AND ($4 OR l.foreign_amount_minor IS NOT NULL)`, [orgId, accountId, asOf, account.currency === 'INR'])).rows[0].v as bigint;
  const sum = (xs: { amount_minor: bigint }[]) => xs.reduce((a, x) => a + x.amount_minor, 0n);
  const open = lines.filter((l) => l.status === 'OPEN');
  return {
    account, asOf, statement: lines, book,
    /* closing balance on the bank's statement = books − things in the books the bank has not shown + things the bank shows that the books lack */
    summary: { bookBalance: book_balance, notOnStatement: sum(book), notInBooks: sum(open), expectedStatementBalance: book_balance - sum(book) + sum(open) }
  };
};

const line = async (c: Db, orgId: bigint, id: bigint) => {
  const s = (await c.query(`SELECT id, account_id, amount_minor, status, journal_line_id FROM bank_statement_lines WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [orgId, id])).rows[0];
  if (!s) throw new LedgerError('not_found', 'no such statement line');
  return s as { id: bigint; account_id: bigint; amount_minor: bigint; status: string; journal_line_id: bigint | null };
};

export const matchLine = async (c: Db, orgId: bigint, id: bigint, journalLineId: bigint, actor: string) => {
  const s = await line(c, orgId, id);
  if (s.status !== 'OPEN') throw new LedgerError('not_open', 'this statement line is already matched or ignored');
  const b = (await c.query(`${BOOK_LINES} AND l.id = $3`, [orgId, s.account_id, journalLineId])).rows[0];
  if (!b) throw new LedgerError('bad_match', 'that entry is not on this account, or it was reversed');
  if ((b.amount_minor as bigint) !== s.amount_minor) throw new LedgerError('amount_differs', 'the amounts differ; match lines of the same amount (use "Add entry" for a charge or interest the books lack)');
  if ((await c.query(`SELECT 1 FROM bank_statement_lines WHERE journal_line_id = $1`, [journalLineId])).rowCount) throw new LedgerError('already_matched', 'that entry is matched to another statement line');
  await c.query(`UPDATE bank_statement_lines SET status = 'MATCHED', journal_line_id = $2, matched_at = now() WHERE id = $1`, [id, journalLineId]);
  await audit(c, orgId, { actor, action: 'bank.matched', entityType: 'bank_statement_line', entityId: id, detail: { journalLineId: String(journalLineId) } });
};

export const unmatchLine = async (c: Db, orgId: bigint, id: bigint, actor: string) => {
  const s = await line(c, orgId, id);
  if (s.status !== 'MATCHED') throw new LedgerError('not_matched', 'this statement line is not matched');
  await c.query(`UPDATE bank_statement_lines SET status = 'OPEN', journal_line_id = NULL, matched_at = NULL WHERE id = $1`, [id]);
  await audit(c, orgId, { actor, action: 'bank.unmatched', entityType: 'bank_statement_line', entityId: id });
};

export const setIgnored = async (c: Db, orgId: bigint, id: bigint, ignored: boolean, actor: string) => {
  const s = await line(c, orgId, id);
  if (s.status === 'MATCHED') throw new LedgerError('is_matched', 'unmatch this line first');
  await c.query(`UPDATE bank_statement_lines SET status = $2 WHERE id = $1`, [id, ignored ? 'IGNORED' : 'OPEN']);
  await audit(c, orgId, { actor, action: ignored ? 'bank.ignored' : 'bank.unignored', entityType: 'bank_statement_line', entityId: id });
};

/** A line the books lack (a bank charge, interest, a deposit nobody recorded): post the entry against the account you choose and match it at once. */
export const addEntry = async (c: Db, orgId: bigint, id: bigint, o: { counterAccountId: bigint; memo?: string }, actor: string, override?: { reason: string }) => {
  const s = await line(c, orgId, id);
  if (s.status !== 'OPEN') throw new LedgerError('not_open', 'this statement line is already matched or ignored');
  if (o.counterAccountId === s.account_id) throw new LedgerError('same_account', 'choose a different account for the other side');
  const counter = (await c.query(`SELECT id, active FROM accounts WHERE organization_id = $1 AND id = $2`, [orgId, o.counterAccountId])).rows[0];
  if (!counter || !counter.active) throw new LedgerError('bad_account', 'choose an active account for the other side');
  const full = (await c.query(`SELECT txn_date::text AS d, description FROM bank_statement_lines WHERE id = $1`, [id])).rows[0];
  const amount = s.amount_minor < 0n ? -s.amount_minor : s.amount_minor;
  const deposit = s.amount_minor > 0n;
  // a foreign account's statement is in its own currency: a deposit is valued at the day's rate, a withdrawal at the average the account holds
  const acct = (await c.query(`SELECT currency FROM accounts WHERE id = $1`, [s.account_id])).rows[0];
  if ((await c.query(`SELECT 1 FROM accounts WHERE id = $1 AND currency <> 'INR'`, [o.counterAccountId])).rowCount) throw new LedgerError('bad_account', 'the other side must be a rupee account');
  let rupees = amount; let foreign: bigint | undefined;
  if (acct.currency !== BASE) {
    foreign = amount;
    if (deposit) {
      const rate = await rateOn(c, acct.currency as string, full.d as string);
      if (!rate) throw new LedgerError('rate_required', `save a ${acct.currency} rate on or before ${full.d} first`);
      rupees = roundDiv(amount * rateMicro(rate), 1_000_000n);
    } else rupees = costOfForeign(await holding(c, s.account_id, full.d as string), amount);
  }
  const posted = await post(c, orgId, {
    date: full.d as string, sourceType: 'bank_line', sourceId: String(id), kind: 'BANK', memo: o.memo?.trim() || (full.description as string) || 'Bank statement line', actor, override,
    lines: [{ account: s.account_id, side: deposit ? 'D' : 'C', amount: rupees, foreignAmount: foreign }, { account: o.counterAccountId, side: deposit ? 'C' : 'D', amount: rupees }]
  });
  const jl = (await c.query(`SELECT id FROM journal_lines WHERE entry_id = $1 AND account_id = $2`, [posted.entryId, s.account_id])).rows[0].id as bigint;
  await c.query(`UPDATE bank_statement_lines SET status = 'MATCHED', journal_line_id = $2, matched_at = now() WHERE id = $1`, [id, jl]);
  await audit(c, orgId, { actor, action: 'bank.entry_added', entityType: 'bank_statement_line', entityId: id, detail: { entryNo: posted.entryNo } });
  return { entryId: posted.entryId, entryNo: posted.entryNo };
};
