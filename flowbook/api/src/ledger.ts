import type { Db } from './db.ts';
import { audit } from './audit.ts';

export type Side = 'D' | 'C';
/** `account` is a system key (SALES), an account code (4000) or, as a bigint, an account id. */
export type LineInput = { account: string | bigint; side: Side; amount: bigint; partyId?: bigint; memo?: string; taxRateBp?: number };
export type PostInput = {
  date: string; sourceType: string; sourceId: string; lines: LineInput[];
  kind?: string; sourceSystem?: string; memo?: string; actor?: string; rulesVersion?: number;
  /** a period that is locked can only be posted into with a stated reason (accounting-rules.md I8) */
  override?: { reason: string };
  reverses?: bigint;
};
export type Posted = { entryId: bigint; entryNo: string; replayed: boolean };

export class LedgerError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = 'LedgerError'; this.code = code; }
}

const resolveAccounts = async (c: Db, orgId: bigint, lines: LineInput[]): Promise<Map<string | bigint, bigint>> => {
  const refs = [...new Set(lines.map((l) => l.account))];
  const names = refs.filter((r): r is string => typeof r === 'string');
  const ids = refs.filter((r): r is bigint => typeof r === 'bigint');
  const rows = (await c.query(
    `SELECT id, code, system_key, active FROM accounts WHERE organization_id = $1 AND (system_key = ANY($2::text[]) OR code = ANY($2::text[]) OR id = ANY($3::bigint[]))`,
    [orgId, names, ids]
  )).rows;
  const map = new Map<string | bigint, bigint>();
  for (const ref of refs) {
    const hit = rows.find((r) => (typeof ref === 'bigint' ? r.id === ref : r.system_key === ref || r.code === ref));
    if (!hit) throw new LedgerError('unknown_account', `no account ${String(ref)} in this organization`);
    if (!hit.active) throw new LedgerError('inactive_account', `account ${String(ref)} is inactive`);
    map.set(ref, hit.id as bigint);
  }
  return map;
};

/**
 * The one way anything reaches the ledger. Call it inside `withOrg`. It validates, claims the posting key (so a retry
 * or a duplicate event returns the original entry instead of posting twice), checks the period, numbers the entry,
 * writes it as a draft and flips it to POSTED, where the database re-checks the balance. Nothing is half-posted.
 */
export const post = async (c: Db, orgId: bigint, input: PostInput): Promise<Posted> => {
  // atomic even if the caller catches the error and carries on in the same transaction: a failed post never keeps its claim
  await c.query('SAVEPOINT ledger_post');
  try {
    const out = await postInner(c, orgId, input);
    await c.query('RELEASE SAVEPOINT ledger_post');
    return out;
  } catch (error) {
    await c.query('ROLLBACK TO SAVEPOINT ledger_post');
    throw error;
  }
};

const postInner = async (c: Db, orgId: bigint, input: PostInput): Promise<Posted> => {
  const { lines } = input;
  if (lines.length < 2) throw new LedgerError('too_few_lines', 'a journal entry needs at least two lines');
  let debit = 0n; let credit = 0n;
  for (const l of lines) {
    if (l.amount <= 0n) throw new LedgerError('bad_amount', 'every line must be above zero');
    if (l.side === 'D') debit += l.amount; else credit += l.amount;
  }
  if (debit !== credit) throw new LedgerError('unbalanced', `debits ${debit} and credits ${credit} differ`);

  const kind = input.kind ?? 'POST';
  const system = input.sourceSystem ?? 'flowbook';
  const claim = await c.query(
    `INSERT INTO posting_register (organization_id, source_system, source_type, source_id, posting_kind) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
    [orgId, system, input.sourceType, input.sourceId, kind]
  );
  if (claim.rowCount === 0) {
    const prior = (await c.query(
      `SELECT r.entry_id, e.entry_no FROM posting_register r JOIN journal_entries e ON e.id = r.entry_id
        WHERE r.organization_id = $1 AND r.source_system = $2 AND r.source_type = $3 AND r.source_id = $4 AND r.posting_kind = $5`,
      [orgId, system, input.sourceType, input.sourceId, kind]
    )).rows[0];
    if (!prior) throw new LedgerError('posting_in_progress', 'this document is being posted; try again');
    return { entryId: prior.entry_id as bigint, entryNo: prior.entry_no as string, replayed: true };
  }

  const accounts = await resolveAccounts(c, orgId, lines);

  const period = (await c.query(
    `SELECT status FROM accounting_periods WHERE organization_id = $1 AND $2::date BETWEEN start_date AND end_date`, [orgId, input.date]
  )).rows[0];
  if (!period) throw new LedgerError('no_period', `no accounting period covers ${input.date}`);
  if (period.status !== 'OPEN') {
    if (!input.override?.reason?.trim()) throw new LedgerError('period_locked', `the period containing ${input.date} is ${String(period.status).toLowerCase().replace('_', ' ')}`);
    await audit(c, orgId, { actor: input.actor, action: 'period.override', entityType: 'journal_entry', entityId: `${input.sourceType}:${input.sourceId}`, detail: { date: input.date, reason: input.override.reason } });
  }

  // a count of numbers issued; the row lock on the conflict-update serialises callers, so numbers have no gaps
  const n = (await c.query(
    `INSERT INTO document_sequences (organization_id, key, next_value) VALUES ($1, 'JE', 1)
       ON CONFLICT (organization_id, key) DO UPDATE SET next_value = document_sequences.next_value + 1 RETURNING next_value`, [orgId]
  )).rows[0].next_value as bigint;
  const entryNo = `JE-${String(n).padStart(6, '0')}`;

  const entryId = (await c.query(
    `INSERT INTO journal_entries (organization_id, entry_no, posting_date, source_type, source_id, memo, reverses_entry_id, rules_version, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [orgId, entryNo, input.date, input.sourceType, input.sourceId, input.memo ?? null, input.reverses ?? null, input.rulesVersion ?? 1, input.actor ?? null]
  )).rows[0].id as bigint;
  let no = 0;
  for (const l of lines) {
    no += 1;
    await c.query(
      `INSERT INTO journal_lines (organization_id, entry_id, line_no, account_id, side, amount_minor, base_amount_minor, party_id, tax_rate_bp, memo)
       VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9)`,
      [orgId, entryId, no, accounts.get(l.account), l.side, l.amount, l.partyId ?? null, l.taxRateBp ?? null, l.memo ?? null]
    );
  }
  await c.query(`UPDATE journal_entries SET status = 'POSTED', posted_at = now() WHERE id = $1`, [entryId]);
  await c.query(
    `UPDATE posting_register SET entry_id = $6 WHERE organization_id = $1 AND source_system = $2 AND source_type = $3 AND source_id = $4 AND posting_kind = $5`,
    [orgId, system, input.sourceType, input.sourceId, kind, entryId]
  );
  await audit(c, orgId, { actor: input.actor, action: 'journal.posted', entityType: 'journal_entry', entityId: entryId, detail: { entryNo, source: `${input.sourceType}:${input.sourceId}`, kind } });
  return { entryId, entryNo, replayed: false };
};

/** Correct a posted entry the only allowed way: a new entry with every side swapped, linked to the original (I3). */
export const reverse = async (c: Db, orgId: bigint, entryId: bigint, opts: { date: string; reason: string; actor?: string; override?: { reason: string } }): Promise<Posted> => {
  if (!opts.reason.trim()) throw new LedgerError('reason_required', 'a reversal needs a reason');
  const entry = (await c.query(`SELECT id, entry_no, status FROM journal_entries WHERE organization_id = $1 AND id = $2`, [orgId, entryId])).rows[0];
  if (!entry) throw new LedgerError('not_found', 'no such journal entry');
  if (entry.status !== 'POSTED') throw new LedgerError('not_posted', 'only a posted entry can be reversed');
  const taken = (await c.query(`SELECT 1 FROM journal_entries WHERE organization_id = $1 AND reverses_entry_id = $2`, [orgId, entryId])).rowCount;
  if (taken) throw new LedgerError('already_reversed', `${entry.entry_no} has already been reversed`);
  const lines = (await c.query(
    `SELECT account_id, side, base_amount_minor, party_id, tax_rate_bp, memo FROM journal_lines WHERE entry_id = $1 ORDER BY line_no`, [entryId]
  )).rows;
  const out = await post(c, orgId, {
    date: opts.date, sourceType: 'reversal', sourceId: String(entryId), kind: 'REVERSAL', reverses: entryId, actor: opts.actor, override: opts.override,
    memo: `Reversal of ${entry.entry_no}: ${opts.reason}`,
    lines: lines.map((l) => ({ account: l.account_id as bigint, side: (l.side === 'D' ? 'C' : 'D') as Side, amount: l.base_amount_minor as bigint, partyId: (l.party_id as bigint | null) ?? undefined, taxRateBp: (l.tax_rate_bp as number | null) ?? undefined, memo: (l.memo as string | null) ?? undefined }))
  });
  await audit(c, orgId, { actor: opts.actor, action: 'journal.reversed', entityType: 'journal_entry', entityId: entryId, detail: { reversal: out.entryNo, reason: opts.reason } });
  return out;
};
