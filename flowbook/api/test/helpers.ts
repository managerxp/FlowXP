/* A throwaway Postgres database per test file, migrated, so the real constraints, triggers and row level security are tested. */
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
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
  pool.on('error', () => {});   // the forced drop at the end cuts idle connections; that is not a failure
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

/* Inside the FlowXP app, the FlowXP API puts who is signed in on the request. A test app is given the same, from a header. */
export const fromHeader = (app: FastifyInstance): FastifyInstance => { app.addHook('onRequest', async (req) => { const who = req.headers['x-test-who']; if (typeof who === 'string') (req.raw as { flowxp?: unknown }).flowxp = JSON.parse(who); }); return app; };
export const identity = (bid: string, over: object = {}) => ({ sub: bid, email: `u${bid}@shop.example`, name: 'U', bid, bname: `Shop ${bid}`, role: 'OWNER', status: 'TRIAL', tend: new Date(Date.now() + 3 * 86400_000).toISOString(), ...over });
/** Open the books as that FlowXP person: the headers to send, and the books' organization id. */
export const enter = async (app: FastifyInstance, who: object) => {
  const headers = { 'x-test-who': JSON.stringify(who) };
  const me = (await app.inject({ method: 'GET', url: '/v1/me', headers })).json();
  return { headers, org: me.organizations[0]?.id as string };
};
