import type { Db } from './db.ts';
import { audit } from './audit.ts';

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Open a financial year starting on the organization's first month, with one OPEN accounting period per month. */
export const openFinancialYear = async (c: Db, orgId: bigint, startYear: number, startMonth = 4, actor?: string): Promise<bigint> => {
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  const endMonth = startMonth === 1 ? 12 : startMonth - 1;
  const label = startMonth === 1 ? String(startYear) : `${startYear}-${String(endYear).slice(2)}`;
  const fy = (await c.query(
    `INSERT INTO financial_years (organization_id, label, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING id`,
    [orgId, label, iso(startYear, startMonth, 1), iso(endYear, endMonth, lastDay(endYear, endMonth))]
  )).rows[0].id as bigint;
  for (let i = 0; i < 12; i += 1) {
    const m0 = startMonth - 1 + i;
    const y = startYear + Math.floor(m0 / 12);
    const m = (m0 % 12) + 1;
    await c.query(
      `INSERT INTO accounting_periods (organization_id, financial_year_id, start_date, end_date) VALUES ($1, $2, $3, $4)`,
      [orgId, fy, iso(y, m, 1), iso(y, m, lastDay(y, m))]
    );
  }
  await audit(c, orgId, { actor, action: 'financial_year.opened', entityType: 'financial_year', entityId: fy, detail: { label } });
  return fy;
};

export type PeriodStatus = 'OPEN' | 'SOFT_LOCKED' | 'CLOSED';

/** Lock or reopen the period that contains `date`. Reopening a CLOSED period is allowed here but always audited. */
export const setPeriodStatus = async (c: Db, orgId: bigint, date: string, status: PeriodStatus, actor?: string): Promise<void> => {
  const row = (await c.query(
    `UPDATE accounting_periods SET status = $3 WHERE organization_id = $1 AND $2::date BETWEEN start_date AND end_date RETURNING id, status`,
    [orgId, date, status]
  )).rows[0];
  if (!row) throw new Error(`no accounting period contains ${date}`);
  await audit(c, orgId, { actor, action: 'period.status', entityType: 'accounting_period', entityId: row.id, detail: { date, status } });
};
