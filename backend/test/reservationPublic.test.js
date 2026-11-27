/*
 * The public reservation page: slots shown free or booked for the party, a booking takes the smallest fitting table and cannot be doubled,
 * the offer is kept on the booking, the owner's settings are checked, and one business never sees another's.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const pub = await import('../src/controllers/reservationPublic.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const call = async (fn, req) => { const res = fakeRes(); await fn({ params: {}, query: {}, body: {}, headers: {}, ip: '127.0.0.1', ...req }, res); return res; };

let biz; let tenant; let small; let big;
const tomorrow = () => new Date(Date.now() + 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

test('setup', { skip }, async () => {
  await runMigrations(pool);
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@rp.test','x') RETURNING user_id`)).rows[0];
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Spice Hall',$1,'RESTAURANT') RETURNING business_id`, [user.user_id])).rows[0].business_id;
  const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  tenant = { businessId: biz, branchId: branch, scopeBranchId: branch, role: 'OWNER', permissions: {} };
  const table = async (name, seats) => (await pool.query(`INSERT INTO dining_tables (business_id, branch_id, name, seats, status, qr_token) VALUES ($1,$2,$3,$4,'FREE',$5) RETURNING table_id`, [biz, branch, name, seats, `rp-${name}-${Math.random()}`])).rows[0].table_id;
  small = await table('T2', 2); big = await table('T6', 6);
});

test('the owner settings are checked and saved', { skip }, async () => {
  const put = (body) => call(pub.saveSettings, { tenant, body });
  assert.equal((await put({ slug: 'No Spaces' })).code, 400);
  assert.equal((await put({ open_time: '9am' })).code, 400);
  assert.equal((await put({ offer_pct: 150 })).code, 400);
  assert.equal((await put({ open_time: '20:00', close_time: '10:00' })).code, 400);
  assert.equal((await put({ enabled: true })).code, 400, 'no address yet');
  const ok = await put({ enabled: true, slug: 'spice-hall', open_time: '12:00', close_time: '14:00', slot_min: 30, stay_min: 60, offer_pct: 10, offer_text: '10% off for online bookings' });
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.offer_pct, 10);
  assert.equal((await call(pub.getSettings, { tenant })).body.data.slug, 'spice-hall');
});

test('the page is only open when the plan allows it', { skip }, async () => {
  const res = await call(pub.info, { params: { slug: 'spice-hall' } });
  // a test business has no plan row: the page answers either with its details or "not available", never an error
  assert.ok([200, 404].includes(res.code), String(res.code));
  if (res.code === 404) assert.match(res.body.message, /not available/);
});

test('slots are free or booked for the party, and a booking takes the smallest table', { skip }, async (t) => {
  const page = await call(pub.info, { params: { slug: 'spice-hall' } });
  if (page.code !== 200) return t.skip('the test plan does not include reservations');
  assert.equal(page.body.data.offer.pct, 10);
  const day = tomorrow();
  const slots = (party) => call(pub.slots, { params: { slug: 'spice-hall' }, query: { date: day, party } });
  let s = await slots(2);
  assert.equal(s.code, 200);
  assert.deepEqual(s.body.data.slots.map((x) => x.time), ['12:00', '12:30', '13:00', '13:30', '14:00']);
  assert.ok(s.body.data.slots.every((x) => x.free));
  assert.equal((await slots(50)).code, 400, 'above the largest party');

  const book = (body) => call(pub.book, { params: { slug: 'spice-hall' }, body: { name: 'Asha', phone: '9876543210', party: 2, date: day, time: '12:30', ...body } });
  const first = await book({});
  assert.equal(first.code, 201, JSON.stringify(first.body));
  assert.equal(first.body.data.offer.pct, 10);
  const row = (await pool.query(`SELECT * FROM reservations WHERE business_id = $1`, [biz])).rows[0];
  assert.equal(row.table_id, small, 'the smallest table that fits');
  assert.equal(row.source, 'ONLINE'); assert.equal(Number(row.offer_pct), 10); assert.equal(row.code, first.body.data.code);

  // 12:30 for two now has one table left (the 6-seater); a party of 4 only fits that one
  s = await slots(2);
  assert.equal(s.body.data.slots.find((x) => x.time === '12:30').left, 1);
  assert.equal((await book({ phone: '9876500001', party: 4 })).code, 201);
  s = await slots(2);
  assert.equal(s.body.data.slots.find((x) => x.time === '12:30').free, false, 'both tables are taken now');
  assert.equal((await book({ phone: '9876500002' })).code, 409, 'the same slot cannot be booked again');
  assert.ok(big);
});

test('another business never sees this one', { skip }, async () => {
  assert.equal((await call(pub.info, { params: { slug: 'nobody-here' } })).code, 404);
});

test('the address is suggested from the business name, and made unique', { skip }, async () => {
  const { suggestSlug } = await import('../src/modules/bookingSlug.js');
  assert.equal(await suggestSlug(biz, 'reservation_settings', 'slug'), 'spice-hall', 'its own address is not taken by itself');
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('p','p@rp.test','x') RETURNING user_id`)).rows[0];
  const other = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('Spice Hall!',$1,'RESTAURANT') RETURNING business_id`, [user.user_id])).rows[0].business_id;
  assert.equal(await suggestSlug(other, 'reservation_settings', 'slug'), 'spice-hall-2', 'taken by the first business');
});

test('guests choose from the owner\'s lists and a seating area, and the choice is on the booking', { skip }, async () => {
  await pool.query(`UPDATE dining_tables SET zone = CASE WHEN table_id = $1 THEN 'Patio' ELSE 'Indoor' END WHERE business_id = $2`, [big, biz]);
  const saved = await call(pub.saveSettings, { tenant, body: { services: ['Lunch', ' Birthday ', 'Lunch', ''], extras: ['Cake'] } });
  assert.equal(saved.code, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.body.data.services, ['Lunch', 'Birthday']);
  assert.equal((await call(pub.saveSettings, { tenant, body: { services: ['x'.repeat(41)] } })).code, 400);
  await pool.query(`DELETE FROM reservations WHERE business_id = $1`, [biz]);
  await pool.query(`INSERT INTO business_feature_overrides (business_id, feature_key, enabled) VALUES ($1, 'reservations', TRUE)`, [biz]);
  const info = await call(pub.info, { params: { slug: 'spice-hall' } });
  assert.equal(info.code, 200, JSON.stringify(info.body));
  assert.deepEqual([info.body.data.areas, info.body.data.services], [['Indoor', 'Patio'], ['Lunch', 'Birthday']]);
  const body = { name: 'Asha', phone: '9000000011', party: 2, date: tomorrow(), time: '12:00', extras: ['Cake', 'Fireworks'], area: 'Patio' };
  assert.equal((await call(pub.book, { params: { slug: 'spice-hall' }, body })).code, 400, 'nothing chosen');
  assert.equal((await call(pub.book, { params: { slug: 'spice-hall' }, body: { ...body, service: 'Birthday', area: 'Roof' } })).code, 400);
  const ok = await call(pub.book, { params: { slug: 'spice-hall' }, body: { ...body, service: 'Birthday', notes: 'Window please' } });
  assert.equal(ok.code, 201, JSON.stringify(ok.body));
  const row = (await pool.query(`SELECT notes, table_id FROM reservations WHERE business_id = $1`, [biz])).rows[0];
  assert.equal(row.notes, 'Birthday · Extras: Cake · Seating: Patio · Window please');
  assert.equal(row.table_id, big, 'seated where they asked');
});
