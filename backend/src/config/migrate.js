/*
 * Forward-only migration runner.
 *
 * Applies backend/migrations/*.js in filename order, each inside its own
 * transaction, and records it in schema_migrations. A migration exports
 * `up(client)` with a pg client. Never edit one that has been applied
 * anywhere — add the next numbered file instead.
 *
 * ponytail: no down migrations and no CLI generator. Add when a rollback is
 * actually needed; on money data a hand-written fix-forward is safer anyway.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');
// Arbitrary constant; serialises concurrent runners (two pm2 instances, a deploy script + boot).
const LOCK_ID = 727301;

export const runMigrations = async (pool, dir = DIR) => {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name TEXT PRIMARY KEY,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`
    );
    const applied = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();

    const ran = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      const { up } = await import(pathToFileURL(path.join(dir, file)).href);
      try {
        await client.query('BEGIN');
        await up(client);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        ran.push(file);
        console.log(`[db] applied ${file}`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${file} failed: ${error.message}`);
      }
    }
    return ran;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {});
    client.release();
  }
};
