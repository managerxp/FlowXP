import type pg from 'pg';
import { audit } from './audit.ts';
import { seedChartOfAccounts, TEMPLATES } from './coa.ts';
import { seedTaxRates } from './masters.ts';
import { openFinancialYear } from './periods.ts';

export type NewOrg = { name: string; legalName?: string; pan?: string; template?: string; fyStartYear?: number; ownerUserId: bigint };

/** One transaction: the organization, its chart of accounts, its first financial year and its owner. All or nothing. */
export const provisionOrganization = async (pool: pg.Pool, o: NewOrg): Promise<bigint> => {
  const template = (o.template ?? 'GENERAL').toUpperCase();
  if (!TEMPLATES.includes(template)) throw new RangeError(`unknown chart template ${template}`);
  const now = new Date();
  // the Indian financial year starts in April: before April we are still in the year that began last April
  const startYear = o.fyStartYear ?? (now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const orgId = (await c.query('INSERT INTO organizations (name, legal_name, pan) VALUES ($1, $2, $3) RETURNING id', [o.name, o.legalName ?? null, o.pan ?? null])).rows[0].id as bigint;
    await c.query(`SELECT set_config('app.org_id', $1, true)`, [orgId.toString()]);
    await c.query('INSERT INTO memberships (organization_id, user_id, role) VALUES ($1, $2, $3)', [orgId, o.ownerUserId, 'owner']);
    await seedChartOfAccounts(c, orgId, template);
    await openFinancialYear(c, orgId, startYear, 4, `user:${o.ownerUserId}`);
    await seedTaxRates(c, orgId);
    await audit(c, orgId, { actor: `user:${o.ownerUserId}`, action: 'organization.created', entityType: 'organization', entityId: orgId, detail: { template } });
    await c.query('COMMIT');
    return orgId;
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    c.release();
  }
};
