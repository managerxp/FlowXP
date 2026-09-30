/*
 * Migrations and idempotency against a real Postgres.
 *
 * Creates a throwaway database from the server in DATABASE_URL, runs the tests
 * in it, and drops it. Skipped when there is no reachable Postgres, so `npm test`
 * still passes on a machine without one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { idempotent } = await import('../src/middleware/idempotency.js');

test.after(cleanup);

test('migrations apply once, in order, and are safe to re-run', { skip }, async () => {
  const first = await runMigrations(pool);
  assert.deepEqual(first.slice(0, 2), ['0001_baseline.js', '0002_idempotency.js']);
  assert.deepEqual(await runMigrations(pool), []);

  const { rows } = await pool.query(`SELECT to_regclass('public.invoices') AS i, to_regclass('public.idempotency_keys') AS k`);
  assert.ok(rows[0].i && rows[0].k);
});

test('a failing migration rolls back and is not recorded', { skip }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-'));
  fs.writeFileSync(path.join(dir, '0001_bad.js'),
    `export const up = async (c) => { await c.query('CREATE TABLE half_done (x int)'); throw new Error('boom'); };`);
  await assert.rejects(runMigrations(pool, dir), /0001_bad.js failed: boom/);
  const { rows } = await pool.query(`SELECT to_regclass('public.half_done') AS t`);
  assert.equal(rows[0].t, null);
});

const call = (server, body, key) => new Promise((resolve, reject) => {
  const req = http.request({ port: server.address().port, method: 'POST', path: '/pay', headers: { 'Content-Type': 'application/json', ...(key && { 'Idempotency-Key': key }) } }, (res) => {
    let data = ''; res.on('data', (c) => { data += c; });
    res.on('end', () => resolve({ status: res.statusCode, replay: res.headers['idempotent-replay'], body: JSON.parse(data) }));
  });
  req.on('error', reject); req.end(JSON.stringify(body));
});

test('a repeated Idempotency-Key runs the handler once and replays the response', { skip }, async () => {
  const { default: express } = await import('express');
  let runs = 0; let failNext = false;
  const app = express();
  app.use(express.json());
  app.post('/pay', (req, _res, next) => { req.tenant = { businessId: 1 }; next(); }, idempotent(), (req, res) => {
    runs += 1;
    if (failNext) { failNext = false; return res.status(500).json({ success: false }); }
    res.status(201).json({ success: true, n: runs });
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  try {
    const first = await call(server, { amount: 5 }, 'k1');
    const second = await call(server, { amount: 5 }, 'k1');
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(second.replay, 'true');
    assert.equal(second.body.n, first.body.n);
    assert.equal(runs, 1);

    assert.equal((await call(server, { amount: 99 }, 'k1')).status, 422);   // same key, different request

    await call(server, { amount: 5 });                                       // no key: always runs
    await call(server, { amount: 5 });
    assert.equal(runs, 3);

    failNext = true;
    assert.equal((await call(server, { amount: 7 }, 'k2')).status, 500);
    assert.equal((await call(server, { amount: 7 }, 'k2')).status, 201);    // 5xx freed the key
  } finally {
    server.close();
  }
});
