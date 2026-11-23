/* Enquiries and follow-ups: the call-today list, notes that move the next call, losing one with a reason, and turning one into a member. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { makeGym } from './helpers/gym.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const api = (await import('../src/controllers/gymEnquiries.controller.js')).default;

test.after(cleanup);
let A; let B; let id1; let id2;
const okBody = (res, status = 200) => { assert.equal(res.code, status, JSON.stringify(res.body)); return res.body.data; };
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

test('setup', { skip }, async () => { await runMigrations(pool); A = await makeGym(pool, 'enqA'); B = await makeGym(pool, 'enqB'); });

test('an enquiry needs a name and a number; the call-back defaults to tomorrow', { skip }, async () => {
  assert.equal((await A.call(api.create, { body: { name: 'Ravi' } })).code, 400);
  assert.equal((await A.call(api.create, { body: { name: 'Ravi', phone: '9876500111', follow_up_on: day(-3) } })).code, 400, 'not in the past');
  const a = okBody(await A.call(api.create, { body: { name: 'Ravi', phone: '9876500111', source: 'INSTAGRAM', interest: 'weight loss', note: 'Saw the offer' } }), 201);
  assert.equal(a.next_follow_up, day(1)); id1 = a.enquiry_id;
  id2 = okBody(await A.call(api.create, { body: { name: 'Sita', phone: '9876500222', follow_up_on: day(0) } }), 201).enquiry_id;
});

test('the call-today list holds only those whose day has come; the other lists and the counts follow', { skip }, async () => {
  const t = okBody(await A.call(api.list, { query: {} }));
  assert.deepEqual(t.rows.map((r) => r.name), ['Sita']);
  assert.equal(t.counts.today, 1); assert.equal(t.counts.open, 2);
  assert.equal(okBody(await A.call(api.list, { query: { view: 'open' } })).rows.length, 2);
  assert.equal(okBody(await A.call(api.list, { query: { view: 'open', q: 'rav' } })).rows.length, 1);
  assert.equal(okBody(await B.call(api.list, { query: { view: 'open' } })).rows.length, 0, 'another gym sees nothing');
});

test('a note after a call moves the next call and is kept', { skip }, async () => {
  assert.equal((await A.call(api.note, { params: { id: id2 }, body: {} })).code, 400, 'say what was said');
  okBody(await A.call(api.note, { params: { id: id2 }, body: { note: 'Will come Saturday', next_follow_up_on: day(5) } }));
  assert.equal(okBody(await A.call(api.list, { query: {} })).rows.length, 0);
  const n = okBody(await A.call(api.notes, { params: { id: id2 } }));
  assert.equal(n[0].note, 'Will come Saturday');
  assert.equal((await B.call(api.note, { params: { id: id2 }, body: { note: 'x' } })).code, 404, 'not another gym\'s');
});

test('losing one needs a reason; joining makes a member and closes it', { skip }, async () => {
  assert.equal((await A.call(api.lost, { params: { id: id2 }, body: {} })).code, 400);
  okBody(await A.call(api.lost, { params: { id: id2 }, body: { reason: 'Too far away' } }));
  assert.equal(okBody(await A.call(api.list, { query: { view: 'lost' } })).rows[0].lost_reason, 'Too far away');
  assert.equal((await A.call(api.note, { params: { id: id2 }, body: { note: 'again' } })).code, 409, 'closed');
  const j = okBody(await A.call(api.join, { params: { id: id1 }, body: {} }), 201);
  assert.ok(j.member_id);
  const row = (await pool.query(`SELECT status, member_id FROM gym_enquiries WHERE enquiry_id = $1`, [id1])).rows[0];
  assert.equal(row.status, 'JOINED'); assert.equal(row.member_id, j.member_id);
  assert.equal(okBody(await A.call(api.list, { query: {} })).counts.joined_30d, 1);
});
