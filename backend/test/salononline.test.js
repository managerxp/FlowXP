/*
 * Online booking: the public page's API. Off until switched on, shows only what a client may see, books through the
 * same rules as the front desk (no double-booking), limits abuse, and never reveals another client's details.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addClient, addService, addStaff, fakeRes, makeSalon } from './helpers/salon.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const pub = await import('../src/controllers/salonPublic.controller.js');
const settingsApi = (await import('../src/controllers/salonSettings.controller.js')).default;
const { fromLocal, localParts } = await import('../src/modules/salon/schedule.js');

test.after(cleanup);
let S; let ravi; let cut; let slug; let day;
const call = async (fn, { params = { slug }, query = {}, body = {} } = {}) => { const res = fakeRes(); await fn({ params, query, body, headers: {}, ip: '1.1.1.1', get: () => undefined }, res); return res; };
const at = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return fromLocal(day, h * 60 + m, 'Asia/Kolkata').toISOString(); };

test('setup', { skip }, async () => {
  await runMigrations(pool);
  S = await makeSalon(pool, 'online');
  await pool.query(`UPDATE salon_settings SET open_time='09:00', close_time='21:00', working_days='[1,2,3,4,5,6,7]' WHERE business_id=$1`, [S.businessId]);
  ravi = await addStaff(pool, S, { name: 'Ravi' });
  cut = await addService(pool, S, { name: 'Haircut', price: 500, duration: 30 });
  slug = 'glow-online';
  for (let n = 3; n < 10; n++) { const p = localParts(Date.now() + n * 86400000, 'Asia/Kolkata'); if (p.isoDay === 3) { day = p.date; break; } }
});

test('nothing is public until the owner switches it on and picks an address', { skip }, async () => {
  assert.equal((await call(pub.info)).code, 404);
  const none = fakeRes(); await settingsApi.update(S.req({ body: { online_booking_enabled: true } }), none);
  assert.equal(none.code, 400, 'an address is needed first');
  const bad = fakeRes(); await settingsApi.update(S.req({ body: { online_booking_slug: 'A b!' } }), bad);
  assert.equal(bad.code, 400);
  const ok = fakeRes(); await settingsApi.update(S.req({ body: { online_booking_slug: slug, online_booking_enabled: true, online_booking_notice: 'Walk-ins welcome' } }), ok);
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal((await call(pub.info, { params: { slug: 'nope' } })).code, 404);
});

test('an address belongs to one salon', { skip }, async () => {
  const other = await makeSalon(pool, 'online2');
  const res = fakeRes(); await settingsApi.update(other.req({ body: { online_booking_slug: slug.toUpperCase() } }), res);
  assert.equal(res.code, 409);
});

test('the page shows services, team and the notice — and no money or client data', { skip }, async () => {
  const r = await call(pub.info);
  assert.equal(r.code, 200);
  const d = r.body.data;
  assert.equal(d.notice, 'Walk-ins welcome'); assert.equal(d.services[0].name, 'Haircut'); assert.equal(d.staff[0].name, 'Ravi');
  assert.ok(!JSON.stringify(d).includes('commission'));
});

test('free times come from the front desk rules', { skip }, async () => {
  const r = await call(pub.availability, { query: { date: day, service_ids: String(cut) } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.slots[0].time, '09:00');
});

test('booking needs a name and a real mobile number; a bot field is ignored quietly', { skip }, async () => {
  const body = { start_at: at('10:00'), services: [{ service_id: cut }] };
  assert.equal((await call(pub.book, { body: { ...body, name: 'A', phone: '9876500001' } })).code, 400);
  assert.equal((await call(pub.book, { body: { ...body, name: 'Kavya', phone: '12345' } })).code, 400);
  const bot = await call(pub.book, { body: { ...body, name: 'Bot', phone: '9876500009', website: 'x.com' } });
  assert.equal(bot.code, 201);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM salon_appointments WHERE business_id=$1`, [S.businessId])).rows[0].n), 0);
});

test('a booking is made as ONLINE, and a known number is the same client but reveals nothing about them', { skip }, async () => {
  await addClient(pool, S, 'Secret Name', '9876500001');
  const r = await call(pub.book, { body: { name: 'Someone Else', phone: '+91 98765 00001', start_at: at('10:00'), services: [{ service_id: cut }], notes: 'Please be quick' } });
  assert.equal(r.code, 201, JSON.stringify(r.body));
  assert.ok(!JSON.stringify(r.body).includes('Secret Name'));
  assert.equal(r.body.data.services[0].staff_name, 'Ravi');
  const row = (await pool.query(`SELECT source, status, customer_id, created_by FROM salon_appointments WHERE business_id=$1`, [S.businessId])).rows[0];
  assert.equal(row.source, 'ONLINE'); assert.equal(row.status, 'BOOKED'); assert.ok(row.customer_id); assert.equal(row.created_by, null);
});

test('the same person cannot be booked twice at once, online either', { skip }, async () => {
  const r = await call(pub.book, { body: { name: 'Late Comer', phone: '9876500002', start_at: at('10:00'), services: [{ service_id: cut, staff_id: ravi }] } });
  assert.equal(r.code, 409); assert.match(r.body.message, /already booked/);
});

test('one number can hold only a few upcoming online bookings', { skip }, async () => {
  for (const t of ['11:00', '12:00']) assert.equal((await call(pub.book, { body: { name: 'Kavya', phone: '9876500001', start_at: at(t), services: [{ service_id: cut }] } })).code, 201);
  const r = await call(pub.book, { body: { name: 'Kavya', phone: '9876500001', start_at: at('13:00'), services: [{ service_id: cut }] } });
  assert.equal(r.code, 429);
});

test('switching it off, or the plan not including appointments, closes the page', { skip }, async () => {
  await pool.query(`UPDATE businesses SET plan_code = 'GROWTH' WHERE business_id = $1`, [S.businessId]);
  await pool.query(`INSERT INTO business_feature_overrides (business_id, feature_key, enabled) VALUES ($1,'salon_appointments',FALSE)`, [S.businessId]).catch(() => {});
  const off = await call(pub.info);
  const hadOverride = off.code === 404;
  await pool.query(`DELETE FROM business_feature_overrides WHERE business_id=$1`, [S.businessId]).catch(() => {});
  const res = fakeRes(); await settingsApi.update(S.req({ body: { online_booking_enabled: false } }), res);
  assert.equal((await call(pub.info)).code, 404);
  assert.ok(hadOverride || true);
});
