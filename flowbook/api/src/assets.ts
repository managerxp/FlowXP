import { audit } from './audit.ts';
import type { Db } from './db.ts';
import { LedgerError, post, reverse } from './ledger.ts';
import type { LineInput } from './ledger.ts';
import { paiseToString, roundDiv, toPaise } from './money.ts';

/* Fixed assets. Buying one posts Dr Fixed assets at cost; depreciation is posted a month at a time (Dr Depreciation, Cr Accumulated depreciation), starting
   with the month of its start date as a full month; selling or writing it off clears cost and accumulated depreciation and posts the difference as a gain or loss.
   Straight-line spreads cost minus scrap value over the life in months; written-down-value takes the yearly rate of what is left, a twelfth each month. */

export type AssetIn = {
  name: string; tag?: string; category?: string; purchaseDate: string; startDate?: string; cost: string; salvage?: string;
  method: 'SLM' | 'WDV' | 'NONE'; lifeYears?: string; ratePercent?: string;
  /** where the money came from: Bank, Cash, a vendor payable account, or OPENING_BALANCE for an asset the business already had */
  paidFrom: string; openingAccumulated?: string;
};

const monthStart = (d: string): string => `${d.slice(0, 7)}-01`;
const monthEnd = (m: string): string => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const nextMonth = (m: string): string => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const asDate = (d: string, what: string): string => { if (!DATE.test(d) || Number.isNaN(Date.parse(d))) throw new LedgerError('bad_date', `${what} is not a date (use YYYY-MM-DD)`); return d; };

export const addAsset = async (c: Db, orgId: bigint, a: AssetIn, actor: string, override?: { reason: string }) => {
  if (!a.name.trim()) throw new LedgerError('name_required', 'give the asset a name');
  asDate(a.purchaseDate, 'the purchase date');
  const start = monthStart(asDate(a.startDate ?? a.purchaseDate, 'the start date'));
  const cost = toPaise(a.cost); const salvage = toPaise(a.salvage ?? '0'); const opening = toPaise(a.openingAccumulated ?? '0');
  if (cost <= 0n) throw new LedgerError('bad_amount', 'the cost must be above zero');
  if (salvage >= cost) throw new LedgerError('bad_salvage', 'the scrap value must be less than the cost');
  if (opening > cost - salvage) throw new LedgerError('bad_opening', 'depreciation already taken cannot exceed cost minus scrap value');
  let lifeMonths: number | null = null; let rateBp: number | null = null;
  if (a.method === 'SLM') {
    const years = Number(a.lifeYears);
    if (!(years > 0) || years > 100) throw new LedgerError('bad_life', 'give the useful life in years (up to 100)');
    lifeMonths = Math.round(years * 12);
  } else if (a.method === 'WDV') {
    const pct = Number(a.ratePercent);
    if (!(pct > 0) || pct > 100) throw new LedgerError('bad_rate', 'give the yearly depreciation rate as a percent (above 0, up to 100)');
    rateBp = Math.round(pct * 100);
  }
  const row = (await c.query(
    `INSERT INTO fixed_assets (organization_id, name, tag, category, purchase_date, start_date, cost_minor, salvage_minor, method, life_months, rate_bp, opening_accum_minor, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) ON CONFLICT DO NOTHING RETURNING id`,
    [orgId, a.name.trim().slice(0, 160), a.tag?.trim() || null, a.category?.trim() || null, a.purchaseDate, start, cost, salvage, a.method, lifeMonths, rateBp, opening, actor])).rows[0];
  if (!row) throw new LedgerError('tag_taken', `the tag ${a.tag} is already used by another asset`);
  const id = row.id as bigint;
  const fromOpening = a.paidFrom === 'OPENING_BALANCE';
  if (opening > 0n && !fromOpening) throw new LedgerError('opening_only', 'depreciation already taken applies to an asset you already had: choose "Already owned" as where it came from');
  // an asset the business already had is brought in on the first day of its books, since the year it was bought in is not in them
  const first = (await c.query(`SELECT MIN(start_date)::text AS d FROM accounting_periods WHERE organization_id = $1`, [orgId])).rows[0].d as string | null;
  const postedOn = fromOpening && first && first > a.purchaseDate ? first : a.purchaseDate;
  const posted = await post(c, orgId, {
    date: postedOn, sourceType: 'asset', sourceId: `acq-${id}`, kind: 'ASSET', memo: `Asset: ${a.name.trim().slice(0, 100)}`, actor, override,
    lines: ([
      { account: 'FIXED_ASSETS', side: 'D', amount: cost },
      ...(opening > 0n ? [{ account: 'ACCUM_DEPRECIATION', side: 'C' as const, amount: opening }] : []),
      { account: a.paidFrom, side: 'C', amount: cost - opening }
    ] as LineInput[]).filter((l) => l.amount > 0n)
  });
  await c.query(`UPDATE fixed_assets SET acquisition_entry_id = $2 WHERE id = $1`, [id, posted.entryId]);
  await audit(c, orgId, { actor, action: 'asset.added', entityType: 'fixed_asset', entityId: id, detail: { name: a.name, cost: paiseToString(cost) } });
  return { id, entryNo: posted.entryNo };
};

type Asset = { id: bigint; name: string; start_date: string; cost_minor: bigint; salvage_minor: bigint; method: string; life_months: number | null; rate_bp: number | null; opening_accum_minor: bigint; dep: bigint; n: number; last: string | null };
const ACTIVE = `
  SELECT a.id, a.name, a.start_date::text AS start_date, a.cost_minor, a.salvage_minor, a.method, a.life_months, a.rate_bp, a.opening_accum_minor,
         COALESCE((SELECT SUM(d.amount_minor) FROM asset_depreciation d WHERE d.asset_id = a.id), 0)::bigint AS dep,
         (SELECT COUNT(*)::int FROM asset_depreciation d WHERE d.asset_id = a.id) AS n,
         (SELECT MAX(d.month)::text FROM asset_depreciation d WHERE d.asset_id = a.id) AS last
    FROM fixed_assets a WHERE a.status = 'ACTIVE'`;

/** What one month costs, never taking the asset below its scrap value. */
const monthly = (a: Asset): bigint => {
  const taken = a.opening_accum_minor + a.dep;
  const room = a.cost_minor - a.salvage_minor - taken;
  if (room <= 0n || a.method === 'NONE') return 0n;
  // straight-line: the last month takes whatever rounding left, so cost minus scrap is exactly written off at the end of the life
  if (a.method === 'SLM' && a.opening_accum_minor === 0n && a.n + 1 >= (a.life_months as number)) return room;
  const want = a.method === 'SLM' ? roundDiv(a.cost_minor - a.salvage_minor, BigInt(a.life_months as number)) : roundDiv((a.cost_minor - taken) * BigInt(a.rate_bp as number), 120_000n);
  return want > room ? room : want;
};

/** Post depreciation for every month up to and including `through` (a month, YYYY-MM) that has not been done, one entry per month. */
export const runDepreciation = async (c: Db, orgId: bigint, through: string, actor: string, override?: { reason: string }) => {
  if (!/^\d{4}-\d{2}$/.test(through)) throw new LedgerError('bad_month', 'say which month to depreciate through (YYYY-MM)');
  const last = `${through}-01`;
  const assets = (await c.query(`${ACTIVE} ORDER BY a.id FOR UPDATE OF a`)).rows as Asset[];
  const state = new Map(assets.map((a) => [a.id, { ...a }]));
  const months: string[] = [];
  for (let m = assets.reduce((lo, a) => (lo === '' || monthStart(a.start_date) < lo ? monthStart(a.start_date) : lo), ''); m !== '' && m <= last; m = nextMonth(m)) months.push(m);
  if (months.length > 600) throw new LedgerError('too_many', 'that is more than fifty years of months; start closer to now');
  const done: { month: string; total: bigint; entryNo: string }[] = [];
  for (const m of months) {
    const lines: { assetId: bigint; amount: bigint; name: string }[] = [];
    for (const a of state.values()) {
      if (monthStart(a.start_date) > m || (a.last !== null && a.last >= m)) continue;
      const amount = monthly(a);
      if (amount > 0n) lines.push({ assetId: a.id, amount, name: a.name });
    }
    if (!lines.length) continue;
    const total = lines.reduce((s, l) => s + l.amount, 0n);
    const n = ((await c.query(`SELECT COUNT(DISTINCT entry_id)::int AS n FROM asset_depreciation WHERE month = $1`, [m])).rows[0].n as number) + 1;
    const posted = await post(c, orgId, { date: monthEnd(m), sourceType: 'depreciation', sourceId: `${m.slice(0, 7)}-${n}`, kind: 'DEPRECIATION', memo: `Depreciation for ${m.slice(0, 7)}`, actor, override,
      lines: [{ account: 'DEPRECIATION', side: 'D', amount: total }, { account: 'ACCUM_DEPRECIATION', side: 'C', amount: total }] });
    for (const l of lines) {
      await c.query(`INSERT INTO asset_depreciation (organization_id, asset_id, month, amount_minor, entry_id) VALUES ($1, $2, $3, $4, $5)`, [orgId, l.assetId, m, l.amount, posted.entryId]);
      const s = state.get(l.assetId) as Asset; s.dep += l.amount; s.n += 1; s.last = m;
    }
    done.push({ month: m.slice(0, 7), total, entryNo: posted.entryNo });
  }
  if (done.length) await audit(c, orgId, { actor, action: 'asset.depreciated', entityType: 'organization', entityId: orgId, detail: { through, months: done.length } });
  return done;
};

/** Sell or write off an asset on a date. Depreciation must be up to date through the month before. Proceeds go to the account you say (0 for a write-off). */
export const disposeAsset = async (c: Db, orgId: bigint, id: bigint, o: { date: string; proceeds: string; receivedIn?: string }, actor: string, override?: { reason: string }) => {
  asDate(o.date, 'the date');
  const a = (await c.query(`SELECT id, name, status, start_date::text AS start_date, cost_minor, salvage_minor, method, opening_accum_minor, purchase_date::text AS purchase_date FROM fixed_assets WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!a) throw new LedgerError('not_found', 'no such asset');
  if (a.status !== 'ACTIVE') throw new LedgerError('not_active', 'this asset was already sold, written off or cancelled');
  if (o.date < a.purchase_date) throw new LedgerError('before_purchase', 'it cannot be disposed of before it was bought');
  const dep = (await c.query(`SELECT COALESCE(SUM(amount_minor), 0)::bigint AS s, MAX(month)::text AS last FROM asset_depreciation WHERE asset_id = $1`, [id])).rows[0];
  const owed = dep.last ? nextMonth(dep.last) : a.start_date;   // the first month not yet depreciated
  const stillDepreciating = a.method !== 'NONE' && (a.cost_minor as bigint) - (a.salvage_minor as bigint) - (a.opening_accum_minor as bigint) - (dep.s as bigint) > 0n;
  if (stillDepreciating && owed < monthStart(o.date)) throw new LedgerError('depreciation_behind', `post depreciation through ${new Date(Date.parse(`${monthStart(o.date)}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 7)} first`);
  const proceeds = toPaise(o.proceeds || '0');
  if (proceeds < 0n) throw new LedgerError('bad_amount', 'proceeds cannot be negative');
  if (proceeds > 0n && !o.receivedIn) throw new LedgerError('account_required', 'say where the money went (Bank, Cash...)');
  const accumulated = (a.opening_accum_minor as bigint) + (dep.s as bigint);
  const book = (a.cost_minor as bigint) - accumulated;
  const gain = proceeds - book;
  const posted = await post(c, orgId, {
    date: o.date, sourceType: 'asset', sourceId: `disp-${id}`, kind: 'ASSET', memo: `${proceeds > 0n ? 'Sale' : 'Write-off'} of asset: ${String(a.name).slice(0, 100)}`, actor, override,
    lines: [
      ...(proceeds > 0n ? [{ account: o.receivedIn as string, side: 'D' as const, amount: proceeds }] : []),
      ...(accumulated > 0n ? [{ account: 'ACCUM_DEPRECIATION', side: 'D' as const, amount: accumulated }] : []),
      ...(gain < 0n ? [{ account: 'ASSET_SALE_GAIN_LOSS', side: 'D' as const, amount: -gain }] : []),
      { account: 'FIXED_ASSETS', side: 'C', amount: a.cost_minor as bigint },
      ...(gain > 0n ? [{ account: 'ASSET_SALE_GAIN_LOSS', side: 'C' as const, amount: gain }] : [])
    ]
  });
  await c.query(`UPDATE fixed_assets SET status = 'DISPOSED', disposed_on = $2, proceeds_minor = $3, disposal_entry_id = $4 WHERE id = $1`, [id, o.date, proceeds, posted.entryId]);
  await audit(c, orgId, { actor, action: 'asset.disposed', entityType: 'fixed_asset', entityId: id, detail: { proceeds: paiseToString(proceeds), gain: paiseToString(gain) } });
  return { entryNo: posted.entryNo, gain };
};

/** Take back an asset entered by mistake, only while no depreciation has been posted against it. */
export const cancelAsset = async (c: Db, orgId: bigint, id: bigint, reason: string, date: string, actor: string, override?: { reason: string }) => {
  const a = (await c.query(`SELECT status, acquisition_entry_id FROM fixed_assets WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!a) throw new LedgerError('not_found', 'no such asset');
  if (a.status !== 'ACTIVE') throw new LedgerError('not_active', 'only an asset still on the books can be cancelled');
  if ((await c.query(`SELECT 1 FROM asset_depreciation WHERE asset_id = $1 LIMIT 1`, [id])).rowCount) throw new LedgerError('has_depreciation', 'depreciation has been posted; sell or write the asset off instead');
  await reverse(c, orgId, a.acquisition_entry_id as bigint, { date, reason, actor, override });
  await c.query(`UPDATE fixed_assets SET status = 'CANCELLED' WHERE id = $1`, [id]);
  await audit(c, orgId, { actor, action: 'asset.cancelled', entityType: 'fixed_asset', entityId: id, detail: { reason } });
};

/** The register: each asset with what it cost, what has been written off so far and what it is worth on the books. */
export const assetRegister = async (c: Db) => {
  const rows = (await c.query(
    `SELECT a.id, a.name, a.tag, a.category, a.purchase_date::text AS purchase_date, a.method, a.life_months, a.rate_bp, a.status, a.cost_minor, a.salvage_minor,
            a.disposed_on::text AS disposed_on, a.proceeds_minor,
            (a.opening_accum_minor + COALESCE((SELECT SUM(d.amount_minor) FROM asset_depreciation d WHERE d.asset_id = a.id), 0))::bigint AS accumulated_minor,
            (SELECT MAX(d.month)::text FROM asset_depreciation d WHERE d.asset_id = a.id) AS depreciated_through
       FROM fixed_assets a WHERE a.status <> 'CANCELLED' ORDER BY a.status, a.purchase_date, a.id`)).rows;
  const live = rows.filter((r) => r.status === 'ACTIVE');
  const sum = (k: string) => live.reduce((s, r) => s + (r[k] as bigint), 0n);
  return {
    assets: rows.map((r) => ({ ...r, book_value_minor: r.status === 'ACTIVE' ? (r.cost_minor as bigint) - (r.accumulated_minor as bigint) : 0n, depreciated_through: r.depreciated_through ? (r.depreciated_through as string).slice(0, 7) : null })),
    totals: { cost_minor: sum('cost_minor'), accumulated_minor: sum('accumulated_minor'), book_value_minor: sum('cost_minor') - sum('accumulated_minor') }
  };
};
