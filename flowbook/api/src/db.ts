import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export type Db = pg.PoolClient;

/** FlowBook lives in its own schema of the database, so it can share FlowXP's database without its tables (organizations, payments, ...) meeting FlowXP's. */
export const SCHEMA = 'flowbook';

/* BIGINT columns (ids, paise) come back as bigint, never as a lossy number. Set on this pool only (not on pg globally),
   because FlowXP runs in the same process when FlowBook is mounted inside it and reads BIGINT as text. */
const types = { getTypeParser: (oid: number, format?: 'text' | 'binary') => (oid === 20 ? (v: string) => BigInt(v) : pg.types.getTypeParser(oid as never, format as never)) };

export const createPool = (connectionString: string): pg.Pool => new pg.Pool({ connectionString, options: `-c search_path=${SCHEMA},public`, types: types as never });

/**
 * Run `fn` as one organization: one transaction, the application role (so row level security applies),
 * and `app.org_id` set for the policies. The organization comes from the session, never from a request body.
 */
export const withOrg = async <T>(pool: pg.Pool, orgId: bigint, fn: (c: Db) => Promise<T>): Promise<T> => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE flowbook_app');
    await c.query(`SELECT set_config('app.org_id', $1, true)`, [orgId.toString()]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (error) {
    await c.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    c.release();
  }
};

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

/** Forward-only SQL migrations, each applied once, in file order. Run as the database owner. */
export const migrate = async (pool: pg.Pool): Promise<string[]> => {
  const c = await pool.connect();
  const applied: string[] = [];
  try {
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string));
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await c.query('BEGIN');
      try {
        await c.query(readFileSync(MIGRATIONS + file, 'utf8'));
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await c.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      }
    }
    // the application role reads the tables of this schema (the table grants are in the migrations)
    await c.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO flowbook_app`);
  } finally {
    c.release();
  }
  return applied;
};

/** Registration path: runs as the owner, outside any tenant. */
export const createOrganization = async (pool: pg.Pool, org: { name: string; legalName?: string; pan?: string }): Promise<bigint> => {
  const { rows } = await pool.query('INSERT INTO organizations (name, legal_name, pan) VALUES ($1, $2, $3) RETURNING id', [org.name, org.legalName ?? null, org.pan ?? null]);
  return rows[0].id as bigint;
};
