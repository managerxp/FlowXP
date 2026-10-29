import { audit } from './audit.ts';
import type { Db } from './db.ts';
import { LedgerError } from './ledger.ts';

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
