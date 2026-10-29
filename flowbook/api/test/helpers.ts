/* A throwaway Postgres database per test file, migrated, so the real constraints, triggers and row level security are tested. */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createOrganization, createPool, migrate, withOrg } from '../src/db.ts';
import { seedChartOfAccounts } from '../src/coa.ts';
import { openFinancialYear } from '../src/periods.ts';

try { process.loadEnvFile(new URL('../../../backend/.env', import.meta.url)); } catch { /* no local env file: use defaults */ }

export const setup = async () => {
  const baseUrl = process.env.FLOWBOOK_ADMIN_URL || process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/postgres';
  const name = `flowbook_test_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: baseUrl });
  let skip: string | false = false;
  try { await admin.connect(); await admin.query(`CREATE DATABASE ${name}`); } catch (e) { skip = `no Postgres available (${(e as Error).message})`; }
  const url = new URL(baseUrl); url.pathname = `/${name}`;
  const pool = createPool(url.toString());
  if (!skip) await migrate(pool);
  const cleanup = async () => { await pool.end().catch(() => {}); if (!skip) { await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`).catch(() => {}); } await admin.end().catch(() => {}); };
  return { pool, skip, cleanup };
};

/** An organization with the general chart and the financial year 2026-27 (April 2026 to March 2027). */
export const newOrg = async (pool: pg.Pool, name = 'Test Cafe', template = 'GENERAL'): Promise<bigint> => {
  const id = await createOrganization(pool, { name });
  await withOrg(pool, id, async (c) => { await seedChartOfAccounts(c, id, template); await openFinancialYear(c, id, 2026, 4, 'test'); });
  return id;
};
