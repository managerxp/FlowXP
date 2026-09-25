/*
 * A throwaway Postgres database per test file. Reads DATABASE_URL (via .env),
 * creates flowxp_test_<random> on the same server, points the app at it, and
 * drops it afterwards. `skip` is a reason string when no Postgres is reachable
 * so the tests can skip instead of failing on a machine without one.
 */
import crypto from 'node:crypto';
import pg from 'pg';
import 'dotenv/config';

export const setupTestDb = async () => {
  const baseUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/flowxp';
  const dbName = `flowxp_test_${crypto.randomBytes(4).toString('hex')}`;
  const url = new URL(baseUrl);
  url.pathname = `/${dbName}`;

  let admin; let skip = false;
  try {
    admin = new pg.Client({ connectionString: baseUrl });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${dbName}`);
  } catch (error) {
    skip = `no Postgres available (${error.message})`;
  }

  process.env.DATABASE_URL = url.toString();
  process.env.JWT_SECRET ||= 'test-secret-not-used-for-signing-anything-real';

  const { default: pool } = await import('../../src/config/database.js');
  const cleanup = async () => {
    await pool.end().catch(() => {});
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
      await admin.end().catch(() => {});
    }
  };
  return { pool, skip, cleanup };
};
