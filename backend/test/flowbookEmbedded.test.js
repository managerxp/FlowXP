/*
 * FlowBook inside the FlowXP API: answers under /books, keeps its tables in the `flowbook` schema of the same database, and leaves FlowXP's
 * own tables and number parsing alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);

test('FlowBook mounts at /books in the FlowXP database, in its own schema', { skip }, async () => {
  process.env.INBOX_WORKER = 'false'; process.env.WHATSAPP_WORKER = 'false';
  const { runMigrations } = await import('../src/config/migrate.js');
  await runMigrations(pool);
  const { bootFlowbook } = await import('../../flowbook/api/src/boot.ts');
  const fb = await bootFlowbook(process.env.DATABASE_URL);
  const app = express();
  app.use('/books', (req, res) => fb.app.routing(req, res));
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.deepEqual(await (await fetch(`${base}/books/health`)).json(), { ok: true });
    assert.equal((await fetch(`${base}/books/v1/me`)).status, 401);

    const where = async (name) => (await pool.query(`SELECT table_schema FROM information_schema.tables WHERE table_name = $1`, [name])).rows.map((r) => r.table_schema);
    assert.deepEqual(await where('journal_entries'), ['flowbook']);
    assert.deepEqual(await where('invoices'), ['public']);
    assert.deepEqual(await where('schema_migrations').then((r) => r.sort()), ['flowbook', 'public']);

    // FlowBook's bigint parsing is its own pool's: FlowXP's pool still returns a plain string for a count
    assert.equal(typeof (await pool.query('SELECT COUNT(*) AS n FROM users')).rows[0].n, 'string');
  } finally { server.close(); await fb.close(); }
});
