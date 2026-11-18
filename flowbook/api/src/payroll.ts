import type { Db } from './db.ts';
import { LedgerError, post, reverse } from './ledger.ts';
import type { LineInput } from './ledger.ts';

/* Payroll for any business: the people you pay a salary, and a monthly run that works out each person's pay (days away come off it), the provident fund, ESI, professional tax
   and TDS, and posts it to the books. Three journals per month, each its own step so the books match what really happened:
     1. post the run     Dr Salaries and wages, Dr Employer PF and ESI  /  Cr Salary payable, Cr PF payable, Cr ESI payable, Cr Professional tax payable, Cr TDS on salary payable
     2. pay the staff    Dr Salary payable  /  Cr Cash, Bank, UPI or Card
     3. deposit the dues Dr PF, ESI, professional tax and TDS payable  /  Cr Cash, Bank, UPI or Card
   Amounts are minor units (paise). The professional tax and the TDS are the monthly figures typed for each person (the state's slab and the CA's figure), not worked out. */

const PF_CEILING = 1_500_000;      // Rs 15,000 of wages a month
const ESI_CEILING = 2_100_000;     // Rs 21,000 of pay a month
const pct = (n: number, rate: number) => Math.round((n * rate) / 100);
const upToRupee = (n: number) => Math.ceil(Math.round(n) / 100 - 1e-9) * 100;

export type Pay = { gross: number; pfEmployee: number; pfEmployer: number; pfAdmin: number; esiEmployee: number; esiEmployer: number; pt: number; tds: number; net: number };

/** One person's pay for the month: monthly pay less the days away (pro rata over the days in the month), plus a bonus, and what is held back and owed on it. */
export const computePay = (e: { monthlyPay: number; basic: number | null; pf: boolean; esi: boolean; pt: number; tds: number }, daysInMonth: number, daysAway: number, bonus: number): Pay => {
  const worked = Math.max(0, daysInMonth - daysAway) / daysInMonth;
  const base = Math.round(e.monthlyPay * worked);
  const gross = base + bonus;
  const basic = Math.round((e.basic ?? Math.round(e.monthlyPay / 2)) * worked);   // basic defaults to half the pay
  const wages = Math.min(basic, PF_CEILING);
  const pfEmployee = e.pf ? pct(wages, 12) : 0;
  const pfEmployer = e.pf ? pct(wages, 12) : 0;
  const pfAdmin = e.pf ? pct(wages, 0.5) + pct(wages, 0.5) : 0;
  const esiOn = e.esi && gross > 0 && gross <= ESI_CEILING;
  const esiEmployee = esiOn ? upToRupee((gross * 0.75) / 100) : 0;
  const esiEmployer = esiOn ? upToRupee((gross * 3.25) / 100) : 0;
  const pt = gross > 0 ? e.pt : 0; const tds = gross > 0 ? e.tds : 0;
  return { gross, pfEmployee, pfEmployer, pfAdmin, esiEmployee, esiEmployer, pt, tds, net: gross - pfEmployee - esiEmployee - pt - tds };
};

const daysIn = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const lastDay = (month: string) => `${month}-${String(daysIn(month)).padStart(2, '0')}`;

/* the accounts payroll posts to, made the first time they are needed (an older organization has none of them) */
const ACCOUNTS = [
  { code: '5200', name: 'Salaries and wages', type: 'EXPENSE', key: 'SALARIES' }, { code: '5220', name: 'Employer PF and ESI', type: 'EXPENSE', key: 'EMPLOYER_CONTRIB' },
  { code: '2310', name: 'Salary payable', type: 'LIABILITY', key: 'SALARY_PAYABLE' }, { code: '2320', name: 'PF payable', type: 'LIABILITY', key: 'PF_PAYABLE' },
  { code: '2330', name: 'ESI payable', type: 'LIABILITY', key: 'ESI_PAYABLE' }, { code: '2340', name: 'Professional tax payable', type: 'LIABILITY', key: 'PT_PAYABLE' },
  { code: '2420', name: 'TDS on salary payable', type: 'LIABILITY', key: 'SALARY_TDS_PAYABLE' }
] as const;
const ensureAccounts = async (c: Db, orgId: bigint) => {
  for (const a of ACCOUNTS) {
    if ((await c.query(`SELECT 1 FROM accounts WHERE organization_id = $1 AND system_key = $2`, [orgId, a.key])).rowCount) continue;
    const taken = (await c.query(`SELECT id FROM accounts WHERE organization_id = $1 AND code = $2`, [orgId, a.code])).rows[0];
    if (taken) await c.query(`UPDATE accounts SET system_key = $2 WHERE id = $1 AND system_key IS NULL`, [taken.id, a.key]);
    else await c.query(`INSERT INTO accounts (organization_id, code, name, type, normal_balance, system_key, is_system) VALUES ($1, $2, $3, $4, $5, $6, TRUE)`, [orgId, a.code, a.name, a.type, a.type === 'EXPENSE' ? 'D' : 'C', a.key]);
  }
};

/* ---- people */
export type EmployeeIn = { name: string; designation?: string; monthlyPay: string; basic?: string; pf?: boolean; esi?: boolean; pt?: string; tds?: string; active?: boolean };
const minor = (v: string | undefined): number => { const n = Math.round(Number(v ?? 0) * 100); if (!Number.isFinite(n) || n < 0) throw new LedgerError('bad_amount', 'amounts must be zero or more'); return n; };

export const listEmployees = async (c: Db) => (await c.query(
  `SELECT id::text, name, designation, monthly_pay_minor::text, basic_minor::text, pf, esi, pt_minor::text, tds_minor::text, active FROM payroll_employees ORDER BY active DESC, name`)).rows;

export const saveEmployee = async (c: Db, orgId: bigint, id: bigint | null, e: EmployeeIn) => {
  if (!e.name?.trim()) throw new LedgerError('name_required', 'give the person a name');
  const v = [e.name.trim(), e.designation?.trim() || null, minor(e.monthlyPay), e.basic ? minor(e.basic) : null, Boolean(e.pf), Boolean(e.esi), minor(e.pt), minor(e.tds), e.active !== false];
  if (id) {
    const r = await c.query(`UPDATE payroll_employees SET name = $2, designation = $3, monthly_pay_minor = $4, basic_minor = $5, pf = $6, esi = $7, pt_minor = $8, tds_minor = $9, active = $10 WHERE id = $1 AND organization_id = $11 RETURNING id::text`, [id, ...v, orgId]);
    if (!r.rowCount) throw new LedgerError('not_found', 'no such person');
    return r.rows[0];
  }
  return (await c.query(`INSERT INTO payroll_employees (organization_id, name, designation, monthly_pay_minor, basic_minor, pf, esi, pt_minor, tds_minor, active) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id::text`, [orgId, ...v])).rows[0];
};

/* ---- the run */
export type RunLineIn = { employeeId: string; daysAway?: number; bonus?: string };

/** Make (or redo, while it is a draft) the month's run for everyone active. `lines` carries the days away and bonus typed for some people; the rest were there all month. */
export const makeRun = async (c: Db, orgId: bigint, month: string, lines: RunLineIn[] = []) => {
  let run = (await c.query(`SELECT id, status FROM payroll_runs WHERE organization_id = $1 AND month = $2 FOR UPDATE`, [orgId, month])).rows[0];
  if (run?.status === 'POSTED') throw new LedgerError('already_posted', `payroll for ${month} is already posted`);
  if (!run) run = (await c.query(`INSERT INTO payroll_runs (organization_id, month) VALUES ($1, $2) RETURNING id, status`, [orgId, month])).rows[0];
  const typed = new Map(lines.map((l) => [l.employeeId, l]));
  const kept = new Map((await c.query(`SELECT employee_id::text AS e, days_away, bonus_minor::text AS b FROM payroll_run_lines WHERE run_id = $1`, [run.id])).rows.map((r) => [r.e as string, r]));
  await c.query(`DELETE FROM payroll_run_lines WHERE run_id = $1`, [run.id]);
  const days = daysIn(month);
  for (const e of (await c.query(`SELECT * FROM payroll_employees WHERE organization_id = $1 AND active ORDER BY name`, [orgId])).rows) {
    const t = typed.get(String(e.id)); const k = kept.get(String(e.id));
    const away = t?.daysAway ?? (k ? Number(k.days_away) : 0);
    const bonus = t?.bonus !== undefined ? minor(t.bonus) : (k ? Number(k.b) : 0);
    if (away < 0 || away > days) throw new LedgerError('bad_days', `${e.name}: days away must be between 0 and ${days}`);
    const p = computePay({ monthlyPay: Number(e.monthly_pay_minor), basic: e.basic_minor == null ? null : Number(e.basic_minor), pf: e.pf, esi: e.esi, pt: Number(e.pt_minor), tds: Number(e.tds_minor) }, days, away, bonus);
    await c.query(
      `INSERT INTO payroll_run_lines (organization_id, run_id, employee_id, name, days_in_month, days_away, bonus_minor, gross_minor, pf_employee_minor, pf_employer_minor, pf_admin_minor, esi_employee_minor, esi_employer_minor, pt_minor, tds_minor, net_minor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [orgId, run.id, e.id, e.name, days, away, bonus, p.gross, p.pfEmployee, p.pfEmployer, p.pfAdmin, p.esiEmployee, p.esiEmployer, p.pt, p.tds, p.net]);
  }
  return getRun(c, month);
};

export const getRun = async (c: Db, month: string) => {
  const run = (await c.query(`SELECT id::text, month, status, entry_id::text, paid_entry_id::text, dues_entry_id::text FROM payroll_runs WHERE month = $1`, [month])).rows[0];
  if (!run) return null;
  const lines = (await c.query(`SELECT employee_id::text, name, days_in_month, days_away::float AS days_away, bonus_minor::text, gross_minor::text, pf_employee_minor::text, pf_employer_minor::text, pf_admin_minor::text, esi_employee_minor::text, esi_employer_minor::text, pt_minor::text, tds_minor::text, net_minor::text FROM payroll_run_lines WHERE run_id = $1 ORDER BY name`, [run.id])).rows;
  return { ...run, lines };
};

const sums = async (c: Db, runId: string) => (await c.query(
  `SELECT COALESCE(SUM(gross_minor), 0)::bigint AS gross, COALESCE(SUM(net_minor), 0)::bigint AS net, COALESCE(SUM(pf_employee_minor + pf_employer_minor + pf_admin_minor), 0)::bigint AS pf,
          COALESCE(SUM(pf_employer_minor + pf_admin_minor + esi_employer_minor), 0)::bigint AS employer, COALESCE(SUM(esi_employee_minor + esi_employer_minor), 0)::bigint AS esi,
          COALESCE(SUM(pt_minor), 0)::bigint AS pt, COALESCE(SUM(tds_minor), 0)::bigint AS tds FROM payroll_run_lines WHERE run_id = $1`, [runId])).rows[0] as { gross: bigint; net: bigint; pf: bigint; employer: bigint; esi: bigint; pt: bigint; tds: bigint };

const lock = async (c: Db, orgId: bigint, month: string) => {
  const run = (await c.query(`SELECT id::text, status, entry_id, paid_entry_id, dues_entry_id FROM payroll_runs WHERE organization_id = $1 AND month = $2 FOR UPDATE`, [orgId, month])).rows[0];
  if (!run) throw new LedgerError('not_found', `there is no payroll for ${month}`);
  return run;
};

/** Post the month's salary to the books. After this the run cannot be changed; reverse it with void to start again. */
export const postRun = async (c: Db, orgId: bigint, month: string, actor: string, date?: string) => {
  const run = await lock(c, orgId, month);
  if (run.status === 'POSTED') throw new LedgerError('already_posted', `payroll for ${month} is already posted`);
  const s = await sums(c, run.id);
  if (s.gross <= 0n) throw new LedgerError('nothing_to_post', 'there is no pay to post. Add people with a monthly pay first.');
  await ensureAccounts(c, orgId);
  const lines: LineInput[] = [
    { account: 'SALARIES', side: 'D', amount: s.gross }, { account: 'EMPLOYER_CONTRIB', side: 'D', amount: s.employer },
    { account: 'SALARY_PAYABLE', side: 'C', amount: s.net }, { account: 'PF_PAYABLE', side: 'C', amount: s.pf }, { account: 'ESI_PAYABLE', side: 'C', amount: s.esi },
    { account: 'PT_PAYABLE', side: 'C', amount: s.pt }, { account: 'SALARY_TDS_PAYABLE', side: 'C', amount: s.tds }
  ];
  const out = await post(c, orgId, { date: date ?? lastDay(month), sourceType: 'payroll', sourceId: `run-${run.id}`, memo: `Salaries for ${month}`, actor, lines: lines.filter((l) => l.amount !== 0n) });
  await c.query(`UPDATE payroll_runs SET status = 'POSTED', entry_id = $2 WHERE id = $1`, [run.id, out.entryId]);
  return out;
};

const PAID_WITH = { CASH: 'CASH', BANK: 'BANK', UPI: 'UPI_CLEARING', CARD: 'CARD_CLEARING' } as const;
export type PaidWith = keyof typeof PAID_WITH;

/** Pay the staff what the run owes them. */
export const payStaff = async (c: Db, orgId: bigint, month: string, o: { date: string; paidWith: PaidWith }, actor: string) => {
  const run = await lock(c, orgId, month);
  if (run.status !== 'POSTED') throw new LedgerError('not_posted', 'post the payroll before paying the staff');
  if (run.paid_entry_id) throw new LedgerError('already_paid', 'the staff for this month are already marked as paid');
  const s = await sums(c, run.id);
  if (s.net <= 0n) throw new LedgerError('nothing_to_pay', 'there is nothing to pay the staff');
  const out = await post(c, orgId, { date: o.date, sourceType: 'payroll_pay', sourceId: `run-${run.id}`, memo: `Salaries paid for ${month}`, actor, lines: [{ account: 'SALARY_PAYABLE', side: 'D', amount: s.net }, { account: PAID_WITH[o.paidWith], side: 'C', amount: s.net }] });
  await c.query(`UPDATE payroll_runs SET paid_entry_id = $2 WHERE id = $1`, [run.id, out.entryId]);
  return out;
};

/** Deposit the PF, ESI, professional tax and TDS the run holds. */
export const payDues = async (c: Db, orgId: bigint, month: string, o: { date: string; paidWith: PaidWith }, actor: string) => {
  const run = await lock(c, orgId, month);
  if (run.status !== 'POSTED') throw new LedgerError('not_posted', 'post the payroll first');
  if (run.dues_entry_id) throw new LedgerError('already_paid', 'the PF, ESI and tax for this month are already marked as deposited');
  const s = await sums(c, run.id);
  const parts: LineInput[] = [{ account: 'PF_PAYABLE', side: 'D' as const, amount: s.pf }, { account: 'ESI_PAYABLE', side: 'D' as const, amount: s.esi }, { account: 'PT_PAYABLE', side: 'D' as const, amount: s.pt }, { account: 'SALARY_TDS_PAYABLE', side: 'D' as const, amount: s.tds }].filter((l) => l.amount !== 0n);
  const total = parts.reduce((n, l) => n + l.amount, 0n);
  if (total <= 0n) throw new LedgerError('nothing_to_pay', 'there is no PF, ESI, professional tax or TDS to deposit');
  const out = await post(c, orgId, { date: o.date, sourceType: 'payroll_dues', sourceId: `run-${run.id}`, memo: `PF, ESI, professional tax and TDS for ${month}`, actor, lines: [...parts, { account: PAID_WITH[o.paidWith], side: 'C', amount: total }] });
  await c.query(`UPDATE payroll_runs SET dues_entry_id = $2 WHERE id = $1`, [run.id, out.entryId]);
  return out;
};

/** Take a posted run back (every journal of it is reversed), so the month can be made again. */
export const voidRun = async (c: Db, orgId: bigint, month: string, o: { date: string; reason: string }, actor: string) => {
  const run = await lock(c, orgId, month);
  if (run.status !== 'POSTED') throw new LedgerError('not_posted', 'this payroll is not posted');
  for (const id of [run.dues_entry_id, run.paid_entry_id, run.entry_id]) if (id) await reverse(c, orgId, BigInt(id), { ...o, actor });
  await c.query(`DELETE FROM payroll_runs WHERE id = $1`, [run.id]);
};
