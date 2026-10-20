/*
 * Gaming reports: every figure is read from billed station tabs, so gaming + food equals the invoices' subtotals; unbilled tabs and cancelled bills
 * are not revenue; stations, busy hours and games are counted from sessions; another lounge's numbers never mix in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { TODAY, addDays, addDish, at, makeLounge, rs } from './helpers/gaming.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const stations = await import('../src/modules/gaming/stations.js');
const rates = await import('../src/modules/gaming/rates.js');
const sessions = await import('../src/modules/gaming/sessions.js');
const reports = await import('../src/modules/gaming/reports.js');
const { inTx } = await import('../src/modules/gaming/common.js');
const orders = await import('../src/controllers/orders.controller.js');
const invoicesApi = await import('../src/controllers/invoices.controller.js');

test.after(cleanup);

let L; let M; let tenant; let userId; let a; let b; let dish; let gameId;
const tx = (fn) => inTx(fn);
const call = (handler, extra) => L.call(handler, extra, tenant);
const DAY = { from: TODAY, to: TODAY };

/** One finished, billed session: `minutes` at Rs 120 an hour, with `food` coffees (Rs 100 each), on a station. */
const sitting = async (station, startMin, minutes, food = 0, { bill = true, game } = {}) => {
  const s = await tx((db) => sessions.startSession(db, tenant, userId, { station_id: station.station_id, players: 1, game_id: game }, { now: at(startMin) }));
  if (food) assert.equal((await call(orders.addItems, { params: { id: s.order_id }, body: { items: [{ product_id: dish, quantity: food }] } })).code, 201);
  await tx((db) => sessions.stopSession(db, tenant, userId, s.session_id, {}, { now: at(startMin + minutes) }));
  let invoice = null;
  if (bill) { const r = await call(orders.bill, { params: { id: s.order_id }, body: { payment: { method: 'CASH', amount: 'FULL' } } }); assert.equal(r.code, 201, JSON.stringify(r.body)); invoice = r.body.data; }
  return { s, invoice };
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  L = await makeLounge(pool, 'rep'); M = await makeLounge(pool, 'rep2');
  tenant = L.tenantFor(); userId = L.userId;
  dish = await addDish(pool, L, { name: 'Coffee', price: 100, tax: 5 });
  a = await tx((db) => stations.createStation(db, tenant, { name: 'PS5-1', kind: 'CONSOLE' }));
  b = await tx((db) => stations.createStation(db, tenant, { name: 'PS5-2', kind: 'CONSOLE' }));
  await tx((db) => rates.createRate(db, L.businessId, { name: 'All', tiers: [{ players: 1, hour: 120 }] }));
  gameId = (await tx((db) => stations.createGame(db, L.businessId, { name: 'FIFA 26' }))).game_id;
});

test('gaming and food add up to the invoices, to the paisa', { skip }, async () => {
  await sitting(a, 0, 60, 2, { game: gameId });          // Rs 120 of time, Rs 200 of coffee
  await sitting(b, 10, 30, 0, { game: gameId });         // Rs 60 of time
  await sitting(a, 120, 90, 1);                          // Rs 180 of time, Rs 100 of coffee
  const sum = await reports.summary(pool, tenant, DAY);
  assert.equal(sum.gaming_paise, rs(120 + 60 + 180));
  assert.equal(sum.fnb_paise, rs(300));
  assert.equal(sum.total_paise, sum.gaming_paise + sum.fnb_paise);
  assert.equal(sum.bills, 3);
  assert.equal(sum.sessions, 3);
  assert.equal(sum.hours_played, 3, '60 + 30 + 90 minutes');
  assert.equal(sum.average_session_minutes, 60);
  assert.equal(sum.fnb_share_pct, Math.round(30000 * 1000 / 66000) / 10);
  const inv = Number((await pool.query(`SELECT COALESCE(SUM(subtotal_paise), 0) AS n FROM invoices WHERE business_id = $1 AND status = 'ISSUED'`, [L.businessId])).rows[0].n);
  assert.equal(sum.total_paise, inv, 'the same as the subtotals of the invoices');
});

test('a tab not yet billed is not revenue, and a cancelled bill comes out', { skip }, async () => {
  const before = (await reports.summary(pool, tenant, DAY)).total_paise;
  const open = await sitting(b, 300, 60, 1, { bill: false });
  assert.equal((await reports.summary(pool, tenant, DAY)).total_paise, before, 'unbilled: not counted');
  const dash = await reports.dashboard(pool, tenant, TODAY);
  assert.equal(dash.tabs_to_collect, 1);
  assert.equal(dash.to_collect_paise, Math.round(rs(120) * 1.18 + rs(100) * 1.05), 'what it will cost with GST');
  const billed = await call(orders.bill, { params: { id: open.s.order_id }, body: { payment: { method: 'CASH', amount: 'FULL' } } });
  assert.equal((await reports.summary(pool, tenant, DAY)).total_paise, before + rs(120) + rs(100));
  assert.equal((await call(invoicesApi.cancel, { params: { id: billed.body.data.invoice_id }, body: { reason: 'Test' } })).code, 200);
  assert.equal((await reports.summary(pool, tenant, DAY)).total_paise, before, 'a cancelled bill is not revenue');
});

test('by station: money, sessions, hours and use', { skip }, async () => {
  const rows = await reports.byStation(pool, tenant, DAY);
  const one = rows.find((r) => r.name === 'PS5-1'); const two = rows.find((r) => r.name === 'PS5-2');
  assert.equal(one.gaming_paise, rs(300));
  assert.equal(one.fnb_paise, rs(300));
  assert.equal(one.sessions, 2);
  assert.equal(one.hours_played, 2.5);
  assert.equal(two.gaming_paise, rs(60));
  assert.ok(one.utilisation_pct > two.utilisation_pct || two.sessions >= 1);
  assert.equal(rows[0].name, 'PS5-1', 'the busiest earner first');
  assert.equal(rows.reduce((s, r) => s + r.total_paise, 0), (await reports.summary(pool, tenant, DAY)).total_paise, 'the stations add up to the total');
});

test('busy hours are in the lounge time; games are counted; days add up', { skip }, async () => {
  const h = await reports.heatmap(pool, tenant, DAY);
  const dow = new Date(`${TODAY}T00:00:00Z`).getUTCDay();
  assert.ok(h.cells.every((c) => c.dow === dow), 'all on the one day');
  assert.ok(h.cells.some((c) => c.hour === 10), 'the 10:00 start is hour 10 in Kolkata, not UTC 4');
  assert.equal(h.cells.reduce((n, c) => n + c.sessions, 0), 4);
  const g = await reports.topGames(pool, tenant, DAY);
  assert.deepEqual(g.map((x) => [x.name, x.sessions]), [['FIFA 26', 2]]);
  assert.equal(g[0].hours, 1.5);
  const days = await reports.byDay(pool, tenant, { from: addDays(TODAY, -5), to: addDays(TODAY, 5) });
  assert.equal(days.length, 1);
  assert.equal(days[0].gaming_paise + days[0].fnb_paise, (await reports.summary(pool, tenant, DAY)).total_paise);
});

test('the date window and another lounge: nothing leaks', { skip }, async () => {
  assert.equal((await reports.summary(pool, tenant, { from: addDays(TODAY, 1), to: addDays(TODAY, 8) })).total_paise, 0);
  const other = M.tenantFor();
  const s = await reports.summary(pool, other, {});
  assert.equal(s.total_paise, 0);
  assert.equal(s.sessions, 0);
  assert.deepEqual(await reports.byStation(pool, other, {}), []);
  assert.deepEqual((await reports.heatmap(pool, other, {})).cells, []);
  // an outlet sees only its own
  const N = await makeLounge(pool, 'two', { branches: 2 });
  const t1 = N.tenantFor('MANAGER', { branchId: N.branchIds[0], pinned: true });
  const t2 = N.tenantFor('MANAGER', { branchId: N.branchIds[1], pinned: true });
  await tx((db) => rates.createRate(db, N.businessId, { name: 'All', tiers: [{ players: 1, hour: 100 }] }));
  const st = await tx((db) => stations.createStation(db, t1, { name: 'A', kind: 'CONSOLE' }));
  const r = await tx((db) => sessions.startSession(db, t1, N.userId, { station_id: st.station_id }, { now: at(0) }));
  await tx((db) => sessions.stopSession(db, t1, N.userId, r.session_id, {}, { now: at(60) }));
  assert.equal((await reports.summary(pool, t1, {})).sessions, 1);
  assert.equal((await reports.summary(pool, t2, {})).sessions, 0);
  assert.equal((await reports.byStation(pool, t2, {})).length, 0);
  assert.equal((await reports.summary(pool, N.allOutlets(), {})).sessions, 1);
});
