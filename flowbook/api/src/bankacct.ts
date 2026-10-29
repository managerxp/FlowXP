import { audit } from './audit.ts';
import type { Db } from './db.ts';
import { BASE, checkCurrency, costOfForeign, holding } from './fx.ts';
import { LedgerError, post, reverse } from './ledger.ts';
import type { LineInput } from './ledger.ts';

/* Your own bank accounts, in rupees or in a foreign currency. A foreign account keeps what it holds in its own currency beside the rupee value it
   was bought at. Money coming in is valued at the day's rate; money going out leaves at the average rupee value of what the account holds, and any
   difference from what it fetched or was worth is the realised exchange gain or loss. */

const CASHLIKE = ['BANK', 'CASH', 'UPI_CLEARING', 'CARD_CLEARING'];

/** An account money can be held in: a bank account made here, or one of the standard cash, bank, UPI or card accounts. */
export const moneyAccount = async (c: Db, orgId: bigint, id: bigint) => {
  const a = (await c.query(`SELECT id, name, code, currency, active, is_bank, system_key, type FROM accounts WHERE organization_id = $1 AND id = $2`, [orgId, id])).rows[0] as
    { id: bigint; name: string; code: string; currency: string; active: boolean; is_bank: boolean; system_key: string | null; type: string } | undefined;
  if (!a || a.type !== 'ASSET' || !(a.is_bank || (a.system_key && CASHLIKE.includes(a.system_key)))) throw new LedgerError('bad_account', 'choose a bank, cash, UPI or card account');
  if (!a.active) throw new LedgerError('inactive_account', `${a.name} is switched off`);
  return a;
};

export const createBankAccount = async (c: Db, orgId: bigint, o: { name: string; currency?: string }, actor: string) => {
  const name = o.name.trim().slice(0, 80);
  if (!name) throw new LedgerError('name_required', 'give the account a name');
  const currency = o.currency ?? BASE;
  if (currency !== BASE) checkCurrency(currency);
  const used = new Set((await c.query(`SELECT code FROM accounts WHERE organization_id = $1 AND code ~ '^10[0-9]{2}$'`, [orgId])).rows.map((r) => r.code as string));
  let code = '';
  for (let n = 1011; n <= 1099; n++) if (!used.has(String(n))) { code = String(n); break; }
  if (!code) throw new LedgerError('too_many', 'there is no room for another bank account');
  const id = (await c.query(
    `INSERT INTO accounts (organization_id, code, name, type, normal_balance, is_system, currency, is_bank) VALUES ($1, $2, $3, 'ASSET', 'D', false, $4, true) RETURNING id`,
    [orgId, code, currency === BASE ? name : `${name} (${currency})`, currency])).rows[0].id as bigint;
  await audit(c, orgId, { actor, action: 'bank.account_created', entityType: 'account', entityId: id, detail: { name, currency } });
  return { id, code };
};

export type TransferIn = { fromAccountId: bigint; toAccountId: bigint; date: string; fromAmount: bigint; toAmount: bigint; memo?: string; idempotencyKey: string };

/** Move money between two of your accounts. Amounts are in each account's own currency: rupees out and dollars in is buying dollars; dollars out and rupees in is selling them. */
export const transfer = async (c: Db, orgId: bigint, t: TransferIn, actor: string, override?: { reason: string }) => {
  await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${orgId}:transfer:${t.idempotencyKey}`]);
  const prior = (await c.query(`SELECT id FROM bank_transfers WHERE idempotency_key = $1`, [t.idempotencyKey])).rows[0];
  if (prior) return { id: prior.id as bigint, replayed: true };
  if (t.fromAccountId === t.toAccountId) throw new LedgerError('same_account', 'choose two different accounts');
  if (t.fromAmount <= 0n || t.toAmount <= 0n) throw new LedgerError('bad_amount', 'amounts must be above zero');
  const from = await moneyAccount(c, orgId, t.fromAccountId); const to = await moneyAccount(c, orgId, t.toAccountId);
  const fromF = from.currency !== BASE; const toF = to.currency !== BASE;
  const lines: LineInput[] = [];
  if (!fromF && !toF) {
    if (t.fromAmount !== t.toAmount) throw new LedgerError('amounts_differ', 'between rupee accounts the two amounts must be the same');
    lines.push({ account: to.id, side: 'D', amount: t.toAmount }, { account: from.id, side: 'C', amount: t.fromAmount });
  } else if (!fromF && toF) {
    // buying foreign currency: carried at the rupees paid
    lines.push({ account: to.id, side: 'D', amount: t.fromAmount, foreignAmount: t.toAmount }, { account: from.id, side: 'C', amount: t.fromAmount });
  } else if (fromF && !toF) {
    // selling foreign currency: it leaves at its average value; what the rupees fetched, against that, is the exchange gain or loss
    const base = costOfForeign(await holding(c, from.id, t.date), t.fromAmount);
    const gain = t.toAmount - base;
    lines.push({ account: to.id, side: 'D', amount: t.toAmount }, { account: from.id, side: 'C', amount: base, foreignAmount: t.fromAmount });
    if (gain !== 0n) lines.push({ account: 'EXCHANGE_GAIN_LOSS', side: gain > 0n ? 'C' : 'D', amount: gain > 0n ? gain : -gain });
  } else {
    if (from.currency !== to.currency) throw new LedgerError('currency_pair', 'to move between two foreign currencies, sell one for rupees and buy the other');
    if (t.fromAmount !== t.toAmount) throw new LedgerError('amounts_differ', 'between accounts in the same currency the two amounts must be the same');
    const base = costOfForeign(await holding(c, from.id, t.date), t.fromAmount);
    lines.push({ account: to.id, side: 'D', amount: base, foreignAmount: t.toAmount }, { account: from.id, side: 'C', amount: base, foreignAmount: t.fromAmount });
  }
  const id = (await c.query(
    `INSERT INTO bank_transfers (organization_id, from_account_id, to_account_id, transfer_date, from_amount_minor, to_amount_minor, memo, idempotency_key, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [orgId, from.id, to.id, t.date, t.fromAmount, t.toAmount, t.memo?.trim().slice(0, 200) || null, t.idempotencyKey, actor])).rows[0].id as bigint;
  const posted = await post(c, orgId, { date: t.date, sourceType: 'bank_transfer', sourceId: String(id), kind: 'TRANSFER', memo: t.memo?.trim() || `Transfer from ${from.name} to ${to.name}`, actor, override, lines });
  await c.query(`UPDATE bank_transfers SET journal_entry_id = $2 WHERE id = $1`, [id, posted.entryId]);
  await audit(c, orgId, { actor, action: 'bank.transfer', entityType: 'bank_transfer', entityId: id, detail: { from: from.name, to: to.name, out: String(t.fromAmount), in: String(t.toAmount) } });
  return { id, entryNo: posted.entryNo, replayed: false };
};

export const voidTransfer = async (c: Db, orgId: bigint, id: bigint, o: { date: string; reason: string }, actor: string, override?: { reason: string }) => {
  const t = (await c.query(`SELECT status, journal_entry_id FROM bank_transfers WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!t) throw new LedgerError('not_found', 'no such transfer');
  if (t.status !== 'POSTED') throw new LedgerError('not_posted', 'this transfer is already void');
  await reverse(c, orgId, t.journal_entry_id as bigint, { date: o.date, reason: o.reason, actor, override });
  await c.query(`UPDATE bank_transfers SET status = 'VOID' WHERE id = $1`, [id]);
  await audit(c, orgId, { actor, action: 'bank.transfer_voided', entityType: 'bank_transfer', entityId: id, detail: { reason: o.reason } });
};

export const listTransfers = async (c: Db) => (await c.query(
  `SELECT t.id, t.transfer_date::text AS date, t.from_account_id, f.name AS from_name, f.currency AS from_currency, t.to_account_id, x.name AS to_name, x.currency AS to_currency,
          t.from_amount_minor, t.to_amount_minor, t.memo, t.status
     FROM bank_transfers t JOIN accounts f ON f.id = t.from_account_id JOIN accounts x ON x.id = t.to_account_id ORDER BY t.id DESC LIMIT 100`)).rows;
