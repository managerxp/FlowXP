/*
 * FlowBook inside the FlowXP API: answers under /api/books for whoever FlowXP has signed in, keeps its tables in the `flowbook` schema of the same database, and leaves FlowXP's
 * own tables and number parsing alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);

test('FlowBook mounts at /api/books in the FlowXP database, in its own schema', { skip }, async () => {
  process.env.INBOX_WORKER = 'false'; process.env.WHATSAPP_WORKER = 'false';
  const { runMigrations } = await import('../src/config/migrate.js');
  await runMigrations(pool);
  const { bootFlowbook } = await import('../../flowbook/api/src/boot.ts');
  const fb = await bootFlowbook(process.env.DATABASE_URL, [], { shared: true });
  const app = express();
  // what FlowXP's own sign-in does in front of it (middleware/auth.js, embed.js): say who is signed in
  app.use('/api/books', (req, res) => { if (req.headers['x-test-who']) req.flowxp = JSON.parse(req.headers['x-test-who']); return fb.app.routing(req, res); });
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.deepEqual(await (await fetch(`${base}/api/books/health`)).json(), { ok: true });
    assert.equal((await fetch(`${base}/api/books/v1/me`)).status, 401, 'nobody signed in by FlowXP');
    const who = { sub: '1', email: 'o@shop.test', name: 'O', bid: '5', bname: 'Shop', role: 'OWNER', status: 'TRIAL', tend: new Date(Date.now() + 86400000).toISOString() };
    const me = await (await fetch(`${base}/api/books/v1/me`, { headers: { 'x-test-who': JSON.stringify(who) } })).json();
    assert.equal(me.organizations.length, 1);
    assert.equal(me.organizations[0].name, 'Shop');

    const where = async (name) => (await pool.query(`SELECT table_schema FROM information_schema.tables WHERE table_name = $1`, [name])).rows.map((r) => r.table_schema);
    assert.deepEqual(await where('journal_entries'), ['flowbook']);
    assert.deepEqual(await where('invoices'), ['public']);
    assert.deepEqual(await where('schema_migrations').then((r) => r.sort()), ['flowbook', 'public']);

    // FlowBook's bigint parsing is its own pool's: FlowXP's pool still returns a plain string for a count
    assert.equal(typeof (await pool.query('SELECT COUNT(*) AS n FROM users')).rows[0].n, 'string');
  } finally { server.close(); await fb.close(); }
});
