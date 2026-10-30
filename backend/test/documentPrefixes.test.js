/*
 * Document-number prefixes the owner can set: credit note, debit note and purchase order (the invoice prefix already was).
 * Capitals are stored, bad values are refused, and getCurrent returns them for the settings card.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const business = await import('../src/controllers/business.controller.js');
test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

test('prefixes are validated, stored in capitals and returned', { skip }, async () => {
  await runMigrations(pool);
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('p','p@pre.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Shop',$1,'RETAIL') RETURNING business_id`, [user])).rows[0].business_id;
  const req = (body) => ({ tenant: { businessId: biz, role: 'OWNER', permissions: {} }, auth: { userId: user }, params: {}, body, query: {}, headers: {}, ip: '127.0.0.1' });
  const patch = async (body) => { const res = fakeRes(); await business.updateCurrent(req(body), res); return res; };

  assert.match((await patch({ credit_note_prefix: 'bad prefix!' })).body.message, /1 to 12 letters or digits/);
  assert.match((await patch({ po_prefix: '' })).body.message, /1 to 12/);
  assert.match((await patch({ debit_note_prefix: 'x'.repeat(13) })).body.message, /1 to 12/);

  assert.equal((await patch({ credit_note_prefix: 'crn-', debit_note_prefix: 'dbn', po_prefix: 'buy' })).code, 200);
  const row = (await pool.query(`SELECT credit_note_prefix, debit_note_prefix, po_prefix FROM businesses WHERE business_id = $1`, [biz])).rows[0];
  assert.deepEqual(row, { credit_note_prefix: 'CRN-', debit_note_prefix: 'DBN', po_prefix: 'BUY' });

  const res = fakeRes(); await business.getCurrent(req({}), res);
  assert.deepEqual([res.body.data.credit_note_prefix, res.body.data.debit_note_prefix, res.body.data.po_prefix], ['CRN-', 'DBN', 'BUY']);
});
