import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export type Db = pg.PoolClient;

/** FlowBook lives in its own schema of the database, so it can share FlowXP's database without its tables (organizations, payments, ...) meeting FlowXP's. */
export const SCHEMA = 'flowbook';

/* BIGINT columns (ids, paise) come back as bigint, never as a lossy number. Set on this pool only (not on pg globally),
   because FlowXP runs in the same process when FlowBook is mounted inside it and reads BIGINT as text. */
const types = { getTypeParser: (oid: number, format?: 'text' | 'binary') => (oid === 20 ? (v: string) => BigInt(v) : pg.types.getTypeParser(oid as never, format as never)) };

/** The role every request runs as, so row level security and the table grants apply. null when the database user may not create or use that role (a plain user on a shared FlowXP database): requests then run as that user itself, and row level security still applies because the tables force it. */
let appRole: string | null = 'flowbook_app';

export const createPool = (connectionString: string): pg.Pool => new pg.Pool({ connectionString, options: `-c search_path=${SCHEMA},public`, types: types as never });

/**
 * Run `fn` as one organization: one transaction, the application role (so row level security applies),
 * and `app.org_id` set for the policies. The organization comes from the session, never from a request body.
 */
export const withOrg = async <T>(pool: pg.Pool, orgId: bigint, fn: (c: Db) => Promise<T>): Promise<T> => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (appRole) await c.query(`SET LOCAL ROLE ${appRole}`);
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

/** Make the application role usable by this database user, or learn that it cannot be (then the migrations grant to the user itself). */
const ensureRole = async (c: Db): Promise<boolean> => {
  try {
    await c.query('BEGIN');
    await c.query("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'flowbook_app') THEN CREATE ROLE flowbook_app NOLOGIN; END IF; END $$");
    await c.query('SET LOCAL ROLE flowbook_app');   // fails if this user may not use the role
    await c.query('COMMIT');
    return true;
  } catch {
    await c.query('ROLLBACK').catch(() => {});
    return false;
  }
};

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

/** Forward-only SQL migrations, each applied once, in file order. Run as the database owner. */
export const migrate = async (pool: pg.Pool): Promise<string[]> => {
  const c = await pool.connect();
  const applied: string[] = [];
  try {
    appRole = (await ensureRole(c)) ? 'flowbook_app' : null;
    const me = (await c.query('SELECT current_user AS u')).rows[0].u as string;
    const sql = (text: string) => (appRole ? text : text.replaceAll("'flowbook_app'", `'${me.replaceAll("'", "''")}'`).replaceAll('flowbook_app', `"${me.replaceAll('"', '""')}"`));
    await c.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name as string));
    for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
      if (done.has(file)) continue;
      await c.query('BEGIN');
      try {
        await c.query(sql(readFileSync(MIGRATIONS + file, 'utf8')));
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await c.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await c.query('ROLLBACK');
        throw error;
      }
    }
    // the application role reads the tables of this schema (the table grants are in the migrations)
    const target = appRole ?? me;
    if (!(await c.query('SELECT has_schema_privilege($1, $2, $3) AS ok', [target, SCHEMA, 'USAGE'])).rows[0].ok) await c.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO "${target.replaceAll('"', '""')}"`);
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
