import { audit } from './audit.ts';
import type { Db } from './db.ts';
import { LedgerError } from './ledger.ts';
import { roundDiv, toPaise } from './money.ts';

/* Two yearly views of fixed assets, for a financial year April to March (fy = the year it starts in, 2025 is 2025-26).
   assetSchedule: the Companies Act style schedule from the books, per asset: gross block and accumulated depreciation, opening, movement, closing.
   taxDepreciation: the Income Tax Act block schedule, a report only. Assets pool into blocks by class; the year's depreciation is the block rate on the
   opening value plus additions, with half the rate on additions used under 180 days and sale proceeds taken off the block. */

/** Rates of the Income Tax Rules appendix, in basis points. Check against the current rules with your CA before filing. */
export const IT_BLOCKS: Record<string, { label: string; bp: number }> = {
  BUILDING_RES: { label: 'Residential building', bp: 500 },
  BUILDING_OTHER: { label: 'Other buildings', bp: 1000 },
  BUILDING_TEMP: { label: 'Temporary structures', bp: 4000 },
  FURNITURE: { label: 'Furniture and fittings', bp: 1000 },
  PLANT: { label: 'Plant and machinery', bp: 1500 },
  MOTOR_CAR: { label: 'Motor cars (not for hire)', bp: 1500 },
  MOTOR_COMMERCIAL: { label: 'Commercial vehicles (buses, lorries, taxis)', bp: 3000 },
  COMPUTERS: { label: 'Computers and software', bp: 4000 },
  INTANGIBLE: { label: 'Patents, licences, know-how, trademarks', bp: 2500 },
  POLLUTION: { label: 'Pollution control equipment', bp: 4000 },
  ENERGY_SAVING: { label: 'Energy saving and renewable devices', bp: 4000 }
};

const fyOf = (d: string): number => Number(d.slice(0, 4)) - (Number(d.slice(5, 7)) < 4 ? 1 : 0);
const fyStart = (fy: number): string => `${fy}-04-01`;
const fyEnd = (fy: number): string => `${fy + 1}-03-31`;
const days = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
const checkFy = (fy: number): number => { if (!Number.isInteger(fy) || fy < 1990 || fy > 2200) throw new LedgerError('bad_year', 'give the financial year as the year it starts in, such as 2025 for 2025-26'); return fy; };

export const setAssetTax = async (c: Db, orgId: bigint, id: bigint, t: { itBlock: string | null; itOpeningWdv?: string | null; itUseDate?: string | null }, actor: string) => {
  if (t.itBlock !== null && !IT_BLOCKS[t.itBlock]) throw new LedgerError('bad_block', 'unknown tax block');
  const a = (await c.query(`SELECT purchase_date::text AS pd FROM fixed_assets WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!a) throw new LedgerError('not_found', 'no such asset');
  const wdv = t.itOpeningWdv ? toPaise(t.itOpeningWdv) : null;
  if (wdv !== null) {
    const first = (await c.query(`SELECT MIN(start_date)::text AS d FROM accounting_periods WHERE organization_id = $1`, [orgId])).rows[0].d as string | null;
    if (first && fyOf(a.pd) >= fyOf(first)) throw new LedgerError('opening_only', 'a tax opening value is only for an asset bought before the financial year these books begin in');
  }
  await c.query(`UPDATE fixed_assets SET it_block = $2, it_opening_wdv_minor = $3, it_use_date = $4 WHERE id = $1`, [id, t.itBlock, t.itBlock ? wdv : null, t.itBlock ? t.itUseDate || null : null]);
  await audit(c, orgId, { actor, action: 'asset.tax_block', entityType: 'fixed_asset', entityId: id, detail: { block: t.itBlock } });
};

type Row = {
  id: bigint; name: string; tag: string | null; purchase_date: string; booked: string; cost_minor: bigint; opening_accum_minor: bigint; status: string; disposed_on: string | null;
  proceeds_minor: bigint | null; it_block: string | null; it_opening_wdv_minor: bigint | null; it_use_date: string | null;
};
const ASSETS = `SELECT a.id, a.name, a.tag, a.purchase_date::text AS purchase_date, COALESCE(e.posting_date::text, a.purchase_date::text) AS booked, a.cost_minor, a.opening_accum_minor,
       a.status, a.disposed_on::text AS disposed_on, a.proceeds_minor, a.it_block, a.it_opening_wdv_minor, a.it_use_date::text AS it_use_date
  FROM fixed_assets a LEFT JOIN journal_entries e ON e.id = a.acquisition_entry_id WHERE a.status <> 'CANCELLED' ORDER BY a.purchase_date, a.id`;

const BOOK_KEYS = ['gross_opening_minor', 'gross_additions_minor', 'gross_disposals_minor', 'gross_closing_minor', 'accum_opening_minor', 'depreciation_minor', 'accum_on_disposals_minor', 'accum_closing_minor', 'wdv_opening_minor', 'wdv_closing_minor'];
const TAX_KEYS = ['opening_minor', 'additions_full_minor', 'additions_half_minor', 'sales_minor', 'depreciation_minor', 'capital_gain_minor', 'closing_minor'];
const totals = (keys: string[], rows: object[]) => Object.fromEntries(keys.map((k) => [k, rows.reduce((s: bigint, r) => s + (r as Record<string, bigint>)[k]!, 0n)]));

/** Per asset, per financial year, from the books. Closing figures of one year are the opening figures of the next. */
export const assetSchedule = async (c: Db, fy: number) => {
  checkFy(fy);
  const rows = (await c.query(ASSETS)).rows as Row[];
  const dep = (await c.query(`SELECT asset_id, month::text AS month, amount_minor FROM asset_depreciation`)).rows as { asset_id: bigint; month: string; amount_minor: bigint }[];
  const from = fyStart(fy); const to = fyEnd(fy);
  const lines = [];
  for (const a of rows) {
    const bought = fyOf(a.booked); const gone = a.disposed_on ? fyOf(a.disposed_on) : null;
    if (bought > fy || (gone !== null && gone < fy)) continue;
    const mine = dep.filter((d) => d.asset_id === a.id);
    const before = mine.filter((d) => d.month < from).reduce((s, d) => s + d.amount_minor, 0n);
    const during = mine.filter((d) => d.month >= from && d.month <= to).reduce((s, d) => s + d.amount_minor, 0n);
    const added = bought === fy; const sold = gone === fy;
    const openGross = added ? 0n : a.cost_minor;
    const openAccum = added ? 0n : a.opening_accum_minor + before;
    const addAccum = added ? a.opening_accum_minor : 0n;   // depreciation already taken on an asset brought in this year
    const accum = openAccum + addAccum + during;
    lines.push({
      id: a.id, name: a.name, tag: a.tag,
      gross_opening_minor: openGross, gross_additions_minor: added ? a.cost_minor : 0n, gross_disposals_minor: sold ? a.cost_minor : 0n, gross_closing_minor: sold ? 0n : a.cost_minor,
      accum_opening_minor: openAccum, depreciation_minor: during + addAccum, accum_on_disposals_minor: sold ? accum : 0n, accum_closing_minor: sold ? 0n : accum,
      wdv_opening_minor: openGross - openAccum, wdv_closing_minor: sold ? 0n : a.cost_minor - accum,
      sold_on: sold ? a.disposed_on : null, sale_minor: sold ? a.proceeds_minor : null
    });
  }
  const first = rows.length ? Math.min(...rows.map((r) => fyOf(r.booked))) : fy;
  const last = Math.max(fy, fyOf(new Date().toISOString().slice(0, 10)), ...rows.map((r) => fyOf(r.disposed_on ?? r.booked)));
  return { fy, label: `${fy}-${String(fy + 1).slice(2)}`, years: Array.from({ length: Math.min(last, first + 80) - first + 1 }, (_, i) => first + i), lines, totals: totals(BOOK_KEYS, lines) };
};

/** The block schedule, rolled forward from the first year anything was bought to `fy`. */
export const taxDepreciation = async (c: Db, orgId: bigint, fy: number) => {
  checkFy(fy);
  const rows = (await c.query(ASSETS)).rows as Row[];
  const firstPeriod = (await c.query(`SELECT MIN(start_date)::text AS d FROM accounting_periods WHERE organization_id = $1`, [orgId])).rows[0].d as string | null;
  const booksFy = firstPeriod ? fyOf(firstPeriod) : fy;
  const inBlock = rows.filter((r) => r.it_block);
  const unassigned = rows.filter((r) => !r.it_block && r.status === 'ACTIVE').length;
  const start = inBlock.length ? Math.min(...inBlock.map((r) => (r.it_opening_wdv_minor !== null ? booksFy : fyOf(r.it_use_date ?? r.purchase_date)))) : fy;
  if (fy - start > 80) throw new LedgerError('too_many', 'that is more than eighty years back');
  const out = [];
  for (const key of Object.keys(IT_BLOCKS)) {
    const mine = inBlock.filter((r) => r.it_block === key);
    if (!mine.length) continue;
    const { bp, label } = IT_BLOCKS[key]!;
    let closing = 0n; let line = null;
    for (let y = Math.min(start, fy); y <= fy; y++) {
      let open = closing; let addFull = 0n; let addHalf = 0n; let sales = 0n;
      for (const a of mine) {
        if (a.it_opening_wdv_minor !== null) { if (y === booksFy) open += a.it_opening_wdv_minor; }
        else if (fyOf(a.it_use_date ?? a.purchase_date) === y) {
          if (days(a.it_use_date ?? a.purchase_date, fyEnd(y)) >= 180) addFull += a.cost_minor; else addHalf += a.cost_minor;
        }
        if (a.disposed_on && fyOf(a.disposed_on) === y) sales += a.proceeds_minor ?? 0n;
      }
      const left = mine.filter((a) => !(a.disposed_on && fyOf(a.disposed_on) <= y)).length;
      let full = open + addFull - sales; let half = addHalf;
      if (full < 0n) { half += full; full = 0n; }
      let gain = 0n;   // positive: a short-term capital gain; negative: a loss
      if (half < 0n) { gain = -half; half = 0n; }
      let depreciation = roundDiv(full * BigInt(bp), 10_000n) + roundDiv(half * BigInt(bp), 20_000n);
      const total = open + addFull + addHalf - sales;
      if (left === 0 && sales > 0n) { gain = -total; depreciation = 0n; closing = 0n; }   // the block ceased: what is left is a capital loss (or gain), not depreciation
      else if (gain > 0n) { depreciation = 0n; closing = 0n; }
      else closing = total - depreciation;
      line = { block: key, label, rate_percent: bp / 100, assets: mine.length, opening_minor: open, additions_full_minor: addFull, additions_half_minor: addHalf, sales_minor: sales, depreciation_minor: depreciation, capital_gain_minor: gain, closing_minor: closing };
    }
    out.push(line as NonNullable<typeof line>);
  }
  return { fy, label: `${fy}-${String(fy + 1).slice(2)}`, blocks: out, unassigned, totals: totals(TAX_KEYS, out) };
};
