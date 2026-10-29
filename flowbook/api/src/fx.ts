import { audit } from './audit.ts';
import type { Db } from './db.ts';
import { LedgerError, post, reverse } from './ledger.ts';
import type { LineInput } from './ledger.ts';
import { roundDiv } from './money.ts';

/* Foreign currency. Books are in rupees; a document written in another currency is converted at its rate and keeps the foreign amount beside it.
   Rates are rupees per one unit, held to six places and handled as whole micro-rupees so there is no floating point. */

/** Currencies with two decimal places, which is what the books' minor units assume. */
export const CURRENCIES: Record<string, string> = {
  USD: 'US dollar', EUR: 'Euro', GBP: 'British pound', AED: 'UAE dirham', SGD: 'Singapore dollar', AUD: 'Australian dollar', CAD: 'Canadian dollar',
  CHF: 'Swiss franc', CNY: 'Chinese yuan', HKD: 'Hong Kong dollar', NZD: 'New Zealand dollar', SAR: 'Saudi riyal', QAR: 'Qatari riyal', MYR: 'Malaysian ringgit', THB: 'Thai baht', ZAR: 'South African rand'
};
export const BASE = 'INR';

/** "83.2" to 83_200_000 micro-rupees. */
export const rateMicro = (text: string): bigint => {
  const m = /^(\d{1,9})(?:\.(\d{1,6}))?$/.exec(String(text).trim());
  const v = m ? BigInt(m[1] as string) * 1_000_000n + BigInt(((m[2] ?? '') + '000000').slice(0, 6)) : 0n;
  if (v <= 0n) throw new LedgerError('bad_rate', `${text} is not an exchange rate (rupees for one unit, up to six decimals)`);
  return v;
};

export const checkCurrency = (code: string): void => {
  if (!CURRENCIES[code]) throw new LedgerError('bad_currency', `${code} is not a currency FlowBook handles`);
};

/** The rate in force on a date: the latest one saved on or before it. */
export const rateOn = async (c: Db, currency: string, date: string): Promise<string | null> => {
  const r = (await c.query(`SELECT rate::text FROM exchange_rates WHERE currency = $1 AND rate_date <= $2::date ORDER BY rate_date DESC LIMIT 1`, [currency, date])).rows[0];
  return r ? (r.rate as string) : null;
};

export const saveRate = async (c: Db, orgId: bigint, o: { currency: string; date: string; rate: string }, actor: string): Promise<void> => {
  checkCurrency(o.currency);
  rateMicro(o.rate);
  await c.query(`INSERT INTO exchange_rates (organization_id, currency, rate_date, rate) VALUES ($1, $2, $3, $4) ON CONFLICT (organization_id, currency, rate_date) DO UPDATE SET rate = $4`, [orgId, o.currency, o.date, o.rate]);
  await audit(c, orgId, { actor, action: 'fx.rate_saved', entityType: 'organization', entityId: orgId, detail: o });
};

export const listRates = async (c: Db) => (await c.query(
  `SELECT currency, rate_date::text AS date, rate::text AS rate FROM exchange_rates ORDER BY rate_date DESC, currency LIMIT 200`)).rows;

/** What a foreign-currency account holds: the amount in its own currency and the rupee value it is carried at, as of a date. Revaluation entries (and their reversals) are left out, so this is always the booked value. */
export const holding = async (c: Db, accountId: bigint, asOf?: string): Promise<{ foreign: bigint; base: bigint }> => {
  const r = (await c.query(
    `SELECT COALESCE(SUM(CASE l.side WHEN 'D' THEN l.foreign_amount_minor ELSE -l.foreign_amount_minor END), 0)::bigint AS foreign,
            COALESCE(SUM(CASE l.side WHEN 'D' THEN l.base_amount_minor ELSE -l.base_amount_minor END) FILTER (WHERE l.foreign_amount_minor IS NOT NULL), 0)::bigint AS base
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id AND e.status = 'POSTED'
      WHERE l.account_id = $1 AND ($2::date IS NULL OR e.posting_date <= $2::date)
        AND e.source_type <> 'fx_reval' AND NOT EXISTS (SELECT 1 FROM journal_entries o WHERE o.id = e.reverses_entry_id AND o.source_type = 'fx_reval')`, [accountId, asOf ?? null])).rows[0];
  return { foreign: r.foreign as bigint, base: r.base as bigint };
};

/** The rupee value of spending `foreign` from an account's holding: the average it was bought at. */
export const costOfForeign = (h: { foreign: bigint; base: bigint }, foreign: bigint): bigint => {
  if (foreign > h.foreign) throw new LedgerError('insufficient_foreign', 'the account does not hold that much');
  return foreign === h.foreign ? h.base : roundDiv(h.base * foreign, h.foreign);
};

const dayAfter = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Restate open foreign invoices and bills at the rate in force on a date and post the difference as an unrealised exchange gain or loss
 * (same account as the realised one). The entry is reversed the next day, so settling a document later still works from its original rupees.
 * Every currency with something open needs a saved rate on or before the date.
 */
export const revalue = async (c: Db, orgId: bigint, asOf: string, actor: string, override?: { reason: string }) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw new LedgerError('bad_date', 'the date must be YYYY-MM-DD');
  if ((await c.query(`SELECT 1 FROM fx_revaluations WHERE as_of = $1`, [asOf])).rowCount) throw new LedgerError('already_done', `the books were already revalued on ${asOf}`);
  const open = (await c.query(
    `SELECT id, kind, party_id, currency, balance_minor, foreign_balance_minor FROM documents
      WHERE status = 'ISSUED' AND currency <> 'INR' AND kind IN ('INVOICE', 'BILL') AND issue_date <= $1::date AND foreign_balance_minor > 0 ORDER BY id`, [asOf])).rows;
  const rates = new Map<string, bigint>();
  const lines: LineInput[] = []; let net = 0n; let touched = 0;
  for (const d of open) {
    const cur = d.currency as string;
    if (!rates.has(cur)) { const r = await rateOn(c, cur, asOf); if (!r) throw new LedgerError('no_rate', `save a ${cur} rate on or before ${asOf} first`); rates.set(cur, rateMicro(r)); }
    const target = ((d.foreign_balance_minor as bigint) * (rates.get(cur) as bigint) + 500_000n) / 1_000_000n;
    const diff = target - (d.balance_minor as bigint);
    if (diff === 0n) continue;
    const up = diff > 0n; const amount = up ? diff : -diff; touched += 1;
    // an invoice owed to us is worth more when the rate rises; a bill we owe costs more
    const gainSide = d.kind === 'INVOICE' ? up : !up;
    lines.push({ account: d.kind === 'INVOICE' ? 'AR' : 'AP', side: (d.kind === 'INVOICE') === up ? 'D' : 'C', amount, partyId: d.party_id as bigint });
    net += gainSide ? amount : -amount;
  }
  // foreign-currency bank accounts: what they hold, at the day's rate, against the rupees they are carried at
  for (const acct of (await c.query(`SELECT id, currency FROM accounts WHERE currency <> 'INR' AND active ORDER BY id`)).rows) {
    const h = await holding(c, acct.id as bigint, asOf);
    if (h.foreign <= 0n) continue;
    const cur = acct.currency as string;
    if (!rates.has(cur)) { const r = await rateOn(c, cur, asOf); if (!r) throw new LedgerError('no_rate', `save a ${cur} rate on or before ${asOf} first`); rates.set(cur, rateMicro(r)); }
    const diff = (h.foreign * (rates.get(cur) as bigint) + 500_000n) / 1_000_000n - h.base;
    if (diff === 0n) continue;
    touched += 1;
    lines.push({ account: acct.id as bigint, side: diff > 0n ? 'D' : 'C', amount: diff > 0n ? diff : -diff });
    net += diff;   // a rise in the rupee value of what we hold is a gain
  }
  if (!touched) throw new LedgerError('nothing_to_revalue', 'no open foreign invoice, bill or account needs restating at that date');
  // gain is a credit to the exchange account; a net loss a debit
  lines.push({ account: 'EXCHANGE_GAIN_LOSS', side: net >= 0n ? 'C' : 'D', amount: net >= 0n ? net : -net });
  const posted = await post(c, orgId, { date: asOf, sourceType: 'fx_reval', sourceId: asOf, kind: 'FX', memo: `Unrealised exchange difference on open foreign balances at ${asOf}`, actor, override, restate: true, lines: lines.filter((l) => l.amount !== 0n) });
  let reversalId: bigint | null = null;
  try {
    await c.query('SAVEPOINT fx_rev');
    reversalId = (await reverse(c, orgId, posted.entryId, { date: dayAfter(asOf), reason: 'Unrealised exchange difference reversed the next day', actor, override })).entryId;
    await c.query('RELEASE SAVEPOINT fx_rev');
  } catch { await c.query('ROLLBACK TO SAVEPOINT fx_rev'); }   // the next day may fall in a period that is not open yet; reversePending finishes it later
  await c.query(`INSERT INTO fx_revaluations (organization_id, as_of, entry_id, reversal_entry_id, net_minor, created_by) VALUES ($1, $2, $3, $4, $5, $6)`, [orgId, asOf, posted.entryId, reversalId, net, actor]);
  await audit(c, orgId, { actor, action: 'fx.revalued', entityType: 'organization', entityId: orgId, detail: { asOf, documents: touched } });
  return { entryNo: posted.entryNo, net, documents: touched, reversed: reversalId !== null };
};

/** Finish any revaluation whose next-day reversal could not be posted when it was made (that day's period was not open). */
export const reversePending = async (c: Db, orgId: bigint, actor: string): Promise<number> => {
  let done = 0;
  for (const r of (await c.query(`SELECT id, as_of::text AS as_of, entry_id FROM fx_revaluations WHERE reversal_entry_id IS NULL ORDER BY as_of`)).rows) {
    await c.query('SAVEPOINT fx_rev');
    try {
      const rev = await reverse(c, orgId, r.entry_id as bigint, { date: dayAfter(r.as_of as string), reason: 'Unrealised exchange difference reversed the next day', actor });
      await c.query(`UPDATE fx_revaluations SET reversal_entry_id = $2 WHERE id = $1`, [r.id, rev.entryId]);
      await c.query('RELEASE SAVEPOINT fx_rev'); done += 1;
    } catch { await c.query('ROLLBACK TO SAVEPOINT fx_rev'); }
  }
  return done;
};

export const listRevaluations = async (c: Db) => (await c.query(
  `SELECT id, as_of::text AS as_of, net_minor, reversal_entry_id IS NOT NULL AS reversed, created_by FROM fx_revaluations ORDER BY as_of DESC LIMIT 100`)).rows;
