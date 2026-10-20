/*
 * Gaming access: the route table with the real permission and plan-feature middleware, the lounge-only guard, the plan switches, roles, and the
 * timer alerts. Nothing here talks to a device: FlowXP keeps the time and tells people; it does not control a station.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { at, fakeRes, makeLounge, until } from './helpers/gaming.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const router = (await import('../src/routes/gaming.routes.js')).default;
const { runAlerts, alertFor } = await import('../src/modules/gaming/alerts.js');
const sessions = await import('../src/modules/gaming/sessions.js');
const stations = await import('../src/modules/gaming/stations.js');
const rates = await import('../src/modules/gaming/rates.js');
const { inTx } = await import('../src/modules/gaming/common.js');
const { effectiveFeatureFlags, INDUSTRY_OFF, industryDefaults } = await import('../src/modules/planFeatures.js');
const { ROLE_PERMISSIONS } = await import('../src/middleware/auth.js');

test.after(cleanup);

const routes = router.stack.filter((l) => l.route).map((l) => ({ method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path, stack: l.route.stack.map((s) => s.handle) }));
const gate = async (route, t, method = 'GET') => {
  for (const mw of route.stack.slice(2, -1)) {
    const res = fakeRes(); let passed = false;
    await mw({ tenant: t, method, headers: {}, body: {}, get: () => undefined, originalUrl: route.path }, res, () => { passed = true; });
    if (!passed) return res.code;
  }
  return 200;
};
const find = (method, path) => { const r = routes.find((x) => x.method === method && x.path === path); assert.ok(r, `${method} ${path} exists`); return r; };

let L;
test('setup', { skip }, async () => { await runMigrations(pool); L = await makeLounge(pool, 'sec'); });

test('every gaming route is behind a permission, and each role gets only what it should', { skip }, async () => {
  assert.ok(routes.length > 30, `routes: ${routes.length}`);
  const can = async (role, method, path) => (await gate(find(method, path), L.tenantFor(role), method)) === 200;
  const table = [
    ['GET', '/board', { OWNER: true, MANAGER: true, ADMIN: true, GAMING_ATTENDANT: true, CASHIER: false, WAITER: false, STAFF: false, ACCOUNTANT: false }],
    ['POST', '/sessions', { OWNER: true, MANAGER: true, GAMING_ATTENDANT: true, CASHIER: false, WAITER: false }],
    ['POST', '/sessions/:id/stop', { OWNER: true, GAMING_ATTENDANT: true, CASHIER: false }],
    ['POST', '/sessions/:id/transfer', { OWNER: true, GAMING_ATTENDANT: true, CASHIER: false }],
    ['GET', '/sessions', { OWNER: true, GAMING_ATTENDANT: true, CASHIER: false }],
    ['POST', '/stations', { OWNER: true, MANAGER: true, ADMIN: true, GAMING_ATTENDANT: false, CASHIER: false }],
    ['POST', '/stations/:id/archive', { OWNER: true, GAMING_ATTENDANT: false }],
    ['POST', '/rates', { OWNER: true, MANAGER: true, GAMING_ATTENDANT: false }],
    ['PUT', '/settings', { OWNER: true, MANAGER: true, GAMING_ATTENDANT: false }],
    ['GET', '/rates', { OWNER: true, GAMING_ATTENDANT: true, CASHIER: false }],
    ['POST', '/bundles', { OWNER: true, GAMING_ATTENDANT: false }],
    ['POST', '/zones', { OWNER: true, GAMING_ATTENDANT: false }]
  ];
  for (const [method, path, roles] of table) for (const [role, want] of Object.entries(roles)) assert.equal(await can(role, method, path), want, `${role} ${method} ${path}`);
  // a per-person override wins both ways
  assert.equal(await gate(find('POST', '/sessions'), L.tenantFor('CASHIER', { permissions: { gaming_desk: true } }), 'POST'), 200);
  assert.equal(await gate(find('POST', '/sessions'), L.tenantFor('GAMING_ATTENDANT', { permissions: { gaming_desk: false } }), 'POST'), 403);
  // the plan can switch the timer off
  assert.equal(await gate(find('GET', '/board'), L.tenantFor('OWNER', { planFeatures: { gaming_stations: false } })), 402);
  // an attendant also takes orders and payments for the tab through the ordinary permissions
  assert.ok(ROLE_PERMISSIONS.GAMING_ATTENDANT.includes('billing') && ROLE_PERMISSIONS.GAMING_ATTENDANT.includes('payments'));
  assert.ok(!ROLE_PERMISSIONS.GAMING_ATTENDANT.includes('gaming_setup'), 'stations and rates are not for an attendant');
});

test('gaming routes exist only for a gaming lounge', { skip }, async () => {
  const guard = find('GET', '/board').stack[2];
  for (const type of ['SALON', 'GYM', 'RESTAURANT', 'CAFE', 'HOTEL', 'RETAIL']) {
    const res = fakeRes(); let passed = false;
    guard({ tenant: { businessType: type } }, res, () => { passed = true; });
    assert.equal(passed, false, type);
    assert.equal(res.code, 404, type);
  }
  const ok = fakeRes(); let passed = false;
  guard({ tenant: { businessType: 'GAMING_CAFE' } }, ok, () => { passed = true; });
  assert.equal(passed, true);
});

test('the gaming plan switches are on for a lounge and off for every other kind of business', { skip }, async () => {
  const keys = ['gaming_stations', 'gaming_wallet', 'gaming_bookings', 'gaming_tournaments'];
  const lounge = industryDefaults('GAMING_CAFE');
  for (const k of keys) assert.equal(lounge[k], undefined, `${k} stays on for a lounge`);
  assert.equal(lounge.gym_access, false, 'and the gym tools are off');
  for (const type of Object.keys(INDUSTRY_OFF).filter((t) => t !== 'GAMING_CAFE')) {
    for (const k of keys) assert.equal(industryDefaults(type)[k], false, `${k} is off for ${type}`);
  }
  // a plan can still switch a gaming feature off, and the lounge keeps the table floor and kitchen for its food and drink
  assert.equal(effectiveFeatureFlags([{ gaming_wallet: false }], {}, 'GAMING_CAFE').gaming_wallet, false);
  assert.notEqual(effectiveFeatureFlags([{}], {}, 'GAMING_CAFE').tables, false);
  assert.notEqual(effectiveFeatureFlags([{}], {}, 'GAMING_CAFE').kitchen, false);
});

test('a gaming station cannot be renamed or closed from the table floor', { skip }, async () => {
  const tables = await import('../src/controllers/tables.controller.js');
  const tenant = L.tenantFor();
  const st = await inTx((db) => stations.createStation(db, tenant, { name: 'PS5-1', kind: 'CONSOLE' }));
  const rename = fakeRes();
  await tables.update({ params: { id: st.table_id }, body: { name: 'Hacked' }, tenant, auth: { userId: L.userId } }, rename);
  assert.equal(rename.code, 409);
  const close = fakeRes();
  await tables.update({ params: { id: st.table_id }, body: { status: 'CLOSED' }, tenant, auth: { userId: L.userId } }, close);
  assert.equal(close.code, 409);
});

test('timer alerts: ending soon once, time over once, never for an untimed or stopped session', { skip }, async () => {
  const tenant = L.tenantFor();
  await inTx((db) => rates.createRate(db, L.businessId, { name: 'All', tiers: [{ players: 1, hour: 100 }] }));
  const st = await inTx((db) => stations.createStation(db, tenant, { name: 'PS5-9', kind: 'CONSOLE' }));
  const free = await inTx((db) => stations.createStation(db, tenant, { name: 'PS5-10', kind: 'CONSOLE' }));
  const timed = await inTx((db) => sessions.startSession(db, tenant, L.userId, { station_id: st.station_id, planned_minutes: 60 }, { now: at(0) }));
  const untimed = await inTx((db) => sessions.startSession(db, tenant, L.userId, { station_id: free.station_id }, { now: at(0) }));
  assert.equal(alertFor(null, 5), null);
  assert.equal(alertFor(600, 5), null);
  assert.equal(alertFor(300, 5), 'ENDING');
  assert.equal(alertFor(0, 5), 'OVER');
  const count = async (type) => Number((await pool.query(`SELECT COUNT(*) AS n FROM notifications WHERE business_id = $1 AND type = $2`, [L.businessId, type])).rows[0].n);

  await runAlerts(pool, at(30));
  assert.equal(await count('gaming_time_soon'), 0, 'half an hour left: nothing yet');
  await runAlerts(pool, at(56));
  assert.equal(await until(async () => (await count('gaming_time_soon')) === 1), true);
  await runAlerts(pool, at(57));
  await runAlerts(pool, at(58));
  assert.equal(await count('gaming_time_soon'), 1, 'said once, however many times it is checked');
  await runAlerts(pool, at(61));
  assert.equal(await count('gaming_time_over'), 1);
  await runAlerts(pool, at(70));
  assert.equal(await count('gaming_time_over'), 1);
  const n = (await pool.query(`SELECT title FROM notifications WHERE business_id = $1 AND type = 'gaming_time_over'`, [L.businessId])).rows[0];
  assert.match(n.title, /PS5-9: time is up/);
  assert.equal(await count('gaming_time_soon') + await count('gaming_time_over'), 2, 'the untimed session never alerts');
  for (const s of [timed, untimed]) await inTx((db) => sessions.stopSession(db, tenant, L.userId, s.session_id, { void: true, reason: 'cleanup' }, { now: at(80) }));
});

test('a stopped or paused session sends no alert', { skip }, async () => {
  const tenant = L.tenantFor();
  const st = (await stations.listStations(pool, tenant)).find((s) => s.name === 'PS5-9');
  const s = await inTx((db) => sessions.startSession(db, tenant, L.userId, { station_id: st.station_id, planned_minutes: 30 }, { now: at(100) }));
  await inTx((db) => sessions.pauseSession(db, tenant, L.userId, s.session_id, { now: at(110) }));
  const before = Number((await pool.query(`SELECT COUNT(*) AS n FROM notifications WHERE business_id = $1`, [L.businessId])).rows[0].n);
  await runAlerts(pool, at(135));
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM notifications WHERE business_id = $1`, [L.businessId])).rows[0].n), before);
  await inTx((db) => sessions.stopSession(db, tenant, L.userId, s.session_id, { void: true, reason: 'cleanup' }, { now: at(140) }));
});
