/* Phone database upgrades: a customer's waiting bills, held bills and products survive every step, an interrupted upgrade starts again cleanly. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { LATEST, STEPS, migrate } from '../src/lib/migrate.ts';
import { SCHEMA as OUTBOX_SCHEMA, createOutbox } from '../src/lib/outbox.ts';
import { SCHEMA as CATALOG_SCHEMA } from '../src/lib/catalog.ts';
import { SCHEMA as HELD_SCHEMA, createHeld } from '../src/lib/held.ts';
import { nodeDb } from './helpers.ts';

const v1 = async () => {   // exactly what a phone running the first release has: no version number, the original tables
  const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(OUTBOX_SCHEMA); await db.exec(HELD_SCHEMA);
  return db;
};
const preview = { lines: [{ name: 'Tea', quantity: 2, unitPricePaise: 5000 }], subtotalPaise: 10000, taxPaise: 500, totalPaise: 10500, method: 'CASH' };

test('an old phone is upgraded step by step and keeps every waiting bill, held bill and product', async () => {
  const db = await v1();
  const outbox = createOutbox(db); const held = createHeld(db);
  await outbox.add({ id: 'k1', body: { items: [{ product_id: 1, quantity: 2 }] }, preview }); await outbox.add({ id: 'k2', body: { items: [] }, preview });
  await held.hold({ lines: [], customer_id: null, customer_name: null, coupon_code: null, discount: 0, notes: null }, 'Ravi', 100);
  await db.run(`INSERT INTO products (product_id, name, s, data) VALUES (1, 'Tea', 'tea', '{}')`);
  const before = await outbox.list();

  assert.deepEqual(await migrate(db), STEPS.map((s) => s.to), 'every step ran, in order');
  assert.equal(Number((await db.all<{ user_version: number }>('PRAGMA user_version'))[0].user_version), LATEST);
  const after = await createOutbox(db).list();
  assert.deepEqual(after.map((e) => [e.id, e.state, e.local_no, e.body, e.preview]), before.map((e) => [e.id, e.state, e.local_no, e.body, e.preview]), 'the waiting bills are exactly as they were');
  assert.equal((await createHeld(db).list()).length, 1); assert.equal(Number((await db.all<{ n: number }>('SELECT COUNT(*) AS n FROM products'))[0].n), 1);
  assert.ok((await db.all<{ name: string }>('PRAGMA table_info(outbox)')).some((c) => c.name === 'last_try'));
  assert.deepEqual(await migrate(db), [], 'running it again does nothing');
});

test('an upgrade that fails leaves the database exactly as it was, and the next start tries again', async () => {
  const db = await v1(); await createOutbox(db).add({ id: 'k1', body: {}, preview });
  const bad = [{ to: 2, name: 'half done then broken', up: ['CREATE TABLE half (x INTEGER)', 'THIS IS NOT SQL'] }];
  await assert.rejects(migrate(db, bad));
  assert.equal((await db.all(`SELECT name FROM sqlite_master WHERE name = 'half'`)).length, 0, 'nothing half-made');
  assert.equal(Number((await db.all<{ user_version: number }>('PRAGMA user_version'))[0].user_version), 0, 'version not recorded');
  assert.equal((await createOutbox(db).list()).length, 1, 'the bill is still there');
  assert.deepEqual(await migrate(db), STEPS.map((s) => s.to), 'the real upgrade then runs');
});

test('an upgrade interrupted after its column was added carries on instead of failing', async () => {
  const db = await v1(); await db.exec('ALTER TABLE outbox ADD COLUMN last_try INTEGER');
  assert.deepEqual(await migrate(db), STEPS.map((s) => s.to));
});
