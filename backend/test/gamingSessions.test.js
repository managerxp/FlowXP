/*
 * Gaming sessions: stations and their tables, rates, the timer (start, pause, resume, players, frames, extend, transfer, stop, undo), one tab for
 * time and food, billing through the ordinary bill path, races, repeats, and tenant isolation. The clock is passed in, so a session can run for an
 * exact number of minutes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addDish, at, fakeRes, iso, makeLounge, rs, T0 } from './helpers/gaming.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const stations = await import('../src/modules/gaming/stations.js');
const rates = await import('../src/modules/gaming/rates.js');
const sessions = await import('../src/modules/gaming/sessions.js');
const { inTx } = await import('../src/modules/gaming/common.js');
const orders = await import('../src/controllers/orders.controller.js');
const tabsApi = await import('../src/controllers/tabs.controller.js');

test.after(cleanup);

let L; let M; let tenant; let ps5; let ps5b; let room; let pool1; let dish; let userId;
const tx = (fn) => inTx(fn);
const station = (name, over = {}) => tx((db) => stations.createStation(db, tenant, { name, kind: 'CONSOLE', max_players: 4, ...over }));
const start = (stationId, over = {}, when = at(0)) => tx((db) => sessions.startSession(db, tenant, userId, { station_id: stationId, players: 1, ...over }, { now: when }));
const stop = (id, when, body = {}) => tx((db) => sessions.stopSession(db, tenant, userId, id, body, { now: when }));
const view = (id, when) => sessions.sessionView(pool, tenant, id, when);
const ok = (res) => { assert.equal(res.code, 200 === res.code || res.code === 201 ? res.code : 200, JSON.stringify(res.body)); assert.equal(res.body.success, true, JSON.stringify(res.body)); return res.body.data; };
const call = (handler, extra, t = tenant) => L.call(handler, extra, t);
const billTab = (orderId, body = { payment: { method: 'CASH', amount: 'FULL' } }) => call(orders.bill, { params: { id: orderId }, body });
const lines = async (orderId) => (await pool.query(`SELECT oi.*, p.kind, p.tax_rate FROM order_items oi LEFT JOIN products p ON p.product_id = oi.product_id WHERE oi.order_id = $1 ORDER BY oi.order_item_id`, [orderId])).rows;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  L = await makeLounge(pool, 'sess');
  M = await makeLounge(pool, 'other');
  tenant = L.tenantFor();
  userId = L.userId;
  dish = await addDish(pool, L, { name: 'Cold coffee', price: 120, tax: 5 });
  const z = await tx((db) => stations.createZone(db, tenant, { name: 'Console lounge' }));
  ps5 = await station('PS5-1', { zone_id: z.zone_id, label: 'PS5' });
  ps5b = await station('PS5-2', { zone_id: z.zone_id, label: 'PS5' });
  room = await station('Room-1', { kind: 'CONSOLE', max_players: 6, label: 'Private room' });
  pool1 = await station('Pool-1', { kind: 'POOL', max_players: 4, label: '8-ball' });
  // PS5: Rs 100 an hour for one, Rs 150 for two, Rs 200 for four; room: Rs 300 an hour flat; pool: Rs 5 a frame, no clock
  await tx((db) => rates.createRate(db, L.businessId, { name: 'Console', kind: 'CONSOLE', tiers: [{ players: 1, hour: 100 }, { players: 2, hour: 150 }, { players: 4, hour: 200 }] }));
  await tx((db) => rates.createRate(db, L.businessId, { name: 'Room', station_id: room.station_id, tiers: [{ players: 1, hour: 300 }], extra_player_hour: 0, min_minutes: 30 }));
  await tx((db) => rates.createRate(db, L.businessId, { name: 'Pool frames', kind: 'POOL', bill_time: false, unit_label: 'frame', unit_price: 50 }));
  await tx((db) => rates.createBundle(db, L.businessId, { name: '3 hours', minutes: 180, price: 250, players: 2, kinds: ['CONSOLE'] }));
});

test('a station owns a table, so food and drink for it use the ordinary tab', { skip }, async () => {
  const t = (await pool.query(`SELECT t.* FROM dining_tables t JOIN gaming_stations s ON s.table_id = t.table_id WHERE s.station_id = $1`, [ps5.station_id])).rows[0];
  assert.equal(t.name, 'PS5-1');
  assert.equal(t.zone, 'Console lounge');
  assert.equal(t.seats, 4);
  assert.ok(t.qr_token, 'the QR menu works at the station');
  await assert.rejects(() => station('PS5-1'), /already have/, 'one name for a station or a table');
  await assert.rejects(() => station('X', { kind: 'FRISBEE' }), /must be one of/);
  await assert.rejects(() => tx((db) => stations.updateStation(db, tenant, ps5.station_id, { name: 'PS5-2' })), /already have/);
  const renamed = await tx((db) => stations.updateStation(db, tenant, ps5b.station_id, { name: 'PS5-2' }));
  assert.equal(renamed.name, 'PS5-2');
});

test('a session starts, runs and stops; the time is a line on the tab, priced exactly', { skip }, async () => {
  const s = await start(ps5.station_id, { players: 2 });
  assert.equal(s.status, 'RUNNING');
  assert.equal(s.hour_rate_paise, rs(150));
  const mid = await view(s.session_id, at(30));
  assert.equal(mid.elapsed_seconds, 1800);
  assert.equal(mid.charge_paise, rs(75));
  const done = await stop(s.session_id, at(90));
  assert.equal(done.status, 'ENDED');
  assert.equal(done.time_paise, rs(225), '90 minutes for two at Rs 150 an hour');
  const items = await lines(s.order_id);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'SERVICE');
  assert.equal(items[0].status, 'SERVED');
  assert.equal(Number(items[0].unit_price_paise), rs(225));
  assert.match(items[0].description, /PS5-1 · 1h 30m · 2 players/);
  assert.equal(items[0].sent_at, null, 'it never goes to the kitchen');
  const again = await stop(s.session_id, at(120));
  assert.equal(again.repeated, true);
  assert.equal((await lines(s.order_id)).length, 1, 'stopping twice writes the line once');
  await billTab(s.order_id).then(ok);
});

test('time and food bill together on one invoice, with GST on each line at its own rate', { skip }, async () => {
  const s = await start(ps5.station_id, {}, at(200));
  ok(await call(orders.addItems, { params: { id: s.order_id }, body: { items: [{ product_id: dish, quantity: 2 }] } }));
  const done = await stop(s.session_id, at(260));
  assert.equal(done.time_paise, rs(100));
  const res = await billTab(s.order_id);
  const inv = ok(res);
  const rows = (await pool.query(`SELECT description, quantity, unit_price_paise, tax_rate, line_total_paise FROM invoice_items WHERE invoice_id = $1 ORDER BY item_id`, [inv.invoice_id])).rows;
  assert.equal(rows.length, 2, 'one invoice, a line for the coffee and a line for the time');
  const time = rows.find((r) => /PS5-1/.test(r.description));
  const food = rows.find((r) => /Cold coffee/.test(r.description));
  assert.equal(Number(time.tax_rate), 18, 'gaming time at the lounge GST rate');
  assert.equal(Number(food.tax_rate), 5);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1 AND order_id = $2`, [L.businessId, s.order_id])).rows[0].n), 1);
  // 100 + 18% = 118; 240 + 5% = 252; together 370
  assert.equal(Number((await pool.query(`SELECT total_paise FROM invoices WHERE invoice_id = $1`, [inv.invoice_id])).rows[0].total_paise), 37000);
  const paid = (await pool.query(`SELECT SUM(amount_paise)::int AS n FROM payments WHERE invoice_id = $1`, [inv.invoice_id])).rows[0].n;
  assert.equal(paid, 37000);
  const station = (await sessions.board(pool, tenant, await stations.listStations(pool, tenant), at(261))).find((b) => b.station_id === ps5.station_id);
  assert.equal(station.state, 'AVAILABLE', 'after payment the station is free again');
});

test('a station has one live session: a second start is refused, and two at once make exactly one', { skip }, async () => {
  const a = await start(ps5b.station_id, {}, at(300));
  await assert.rejects(() => start(ps5b.station_id, {}, at(301)), (e) => e.status === 409 && e.code === 'STATION_BUSY');
  await stop(a.session_id, at(310), { void: true, reason: 'test' });
  const results = await Promise.allSettled([start(ps5b.station_id, {}, at(320)), start(ps5b.station_id, {}, at(320)), start(ps5b.station_id, {}, at(320))]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').every((r) => r.reason.status === 409), true);
  const live = (await pool.query(`SELECT session_id FROM gaming_sessions WHERE station_id = $1 AND status IN ('RUNNING','PAUSED')`, [ps5b.station_id])).rows;
  assert.equal(live.length, 1);
  await stop(live[0].session_id, at(330), { void: true, reason: 'test' });
});

test('pause stops the clock, resume starts it again, and repeating either does nothing twice', { skip }, async () => {
  const s = await start(ps5b.station_id, {}, at(400));
  const p = await tx((db) => sessions.pauseSession(db, tenant, userId, s.session_id, { now: at(430) }));
  assert.equal(p.status, 'PAUSED');
  await tx((db) => sessions.pauseSession(db, tenant, userId, s.session_id, { now: at(440) }));
  assert.equal((await view(s.session_id, at(500))).elapsed_seconds, 1800, 'a pause is not counted');
  const r = await tx((db) => sessions.resumeSession(db, tenant, userId, s.session_id, { now: at(500) }));
  assert.equal(r.status, 'RUNNING');
  await tx((db) => sessions.resumeSession(db, tenant, userId, s.session_id, { now: at(501) }));
  const segs = (await pool.query(`SELECT COUNT(*)::int AS n FROM gaming_session_segments WHERE session_id = $1`, [s.session_id])).rows[0].n;
  assert.equal(segs, 2, 'one segment before the pause, one after');
  const done = await stop(s.session_id, at(530));
  assert.equal(done.time_paise, rs(100), '30 + 30 minutes at Rs 100 an hour');
  await billTab(s.order_id).then(ok);
});

test('a change of players is priced from the moment it happens; more than the station takes is refused', { skip }, async () => {
  const s = await start(ps5b.station_id, { players: 1 }, at(600));
  await tx((db) => sessions.setPlayers(db, tenant, userId, s.session_id, { players: 2 }, { now: at(630) }));
  await assert.rejects(() => tx((db) => sessions.setPlayers(db, tenant, userId, s.session_id, { players: 9 }, { now: at(631) })), /takes up to 4/);
  const done = await stop(s.session_id, at(660));
  assert.equal(done.time_paise, rs(50) + rs(75), '30 minutes for one, 30 for two');
  await billTab(s.order_id).then(ok);
  await assert.rejects(() => start(ps5b.station_id, { players: 5 }, at(700)), /takes up to 4/);
});

test('pool by the frame: the clock costs nothing, frames are counted and billed as a quantity', { skip }, async () => {
  const s = await start(pool1.station_id, { players: 2 }, at(800));
  await tx((db) => sessions.setUnits(db, tenant, userId, s.session_id, { delta: 1 }, { now: at(820) }));
  await tx((db) => sessions.setUnits(db, tenant, userId, s.session_id, { delta: 1 }, { now: at(850) }));
  const v = await tx((db) => sessions.setUnits(db, tenant, userId, s.session_id, { delta: 1 }, { now: at(880) }));
  assert.equal(v.units, 3);
  assert.equal(v.bills_time, false);
  await assert.rejects(() => tx((db) => sessions.setUnits(db, tenant, userId, s.session_id, { units: -1 }, { now: at(881) })), /Frames/);
  const done = await stop(s.session_id, at(1200));
  assert.equal(done.time_paise, 0);
  assert.equal(done.frames_paise, rs(150));
  const items = await lines(s.order_id);
  assert.equal(items.length, 1);
  assert.equal(Number(items[0].quantity), 3);
  assert.equal(Number(items[0].unit_price_paise), rs(50));
  await billTab(s.order_id).then(ok);
});

test('a bundle: sold time at a set price, overrun charged, a second offer extends it', { skip }, async () => {
  const bundle = (await rates.listBundles(pool, L.businessId))[0];
  await assert.rejects(() => start(ps5b.station_id, { mode: 'FIXED' }, at(1300)), /Choose the offer/);
  await assert.rejects(() => start(pool1.station_id, { mode: 'FIXED', bundle_id: bundle.bundle_id }, at(1300)), /not for Pool-1/);
  await assert.rejects(() => start(ps5b.station_id, { mode: 'FIXED', bundle_id: bundle.bundle_id, players: 3 }, at(1300)), /covers 2 players/);
  const s = await start(ps5b.station_id, { mode: 'FIXED', bundle_id: bundle.bundle_id, players: 2 }, at(1300));
  assert.equal(s.planned_minutes, 180);
  const near = await view(s.session_id, at(1300 + 176));
  assert.equal(near.alert, 'ENDING');
  assert.equal(near.remaining_seconds, 240);
  const over = await view(s.session_id, at(1300 + 190));
  assert.equal(over.alert, 'OVER');
  const done = await stop(s.session_id, at(1300 + 200));
  assert.equal(done.time_paise, rs(250) + Math.round(20 * rs(150) / 60), 'the bundle plus 20 minutes at the two-player rate');
  await billTab(s.order_id).then(ok);

  const s2 = await start(ps5b.station_id, { mode: 'FIXED', bundle_id: bundle.bundle_id, players: 1 }, at(1600));
  const ext = await tx((db) => sessions.extendSession(db, tenant, userId, s2.session_id, { bundle_id: bundle.bundle_id }, { now: at(1650) }));
  assert.equal(ext.planned_minutes, 360);
  const d2 = await stop(s2.session_id, at(1700));
  assert.equal(d2.time_paise, rs(500));
  await billTab(s2.order_id).then(ok);
});

test('an open session can be given a planned time as an alarm; extending moves it', { skip }, async () => {
  const s = await start(ps5b.station_id, { planned_minutes: 60 }, at(2000));
  assert.equal((await view(s.session_id, at(2058))).alert, 'ENDING');
  assert.equal((await view(s.session_id, at(2030))).alert, null);
  const e = await tx((db) => sessions.extendSession(db, tenant, userId, s.session_id, { minutes: 30 }, { now: at(2059) }));
  assert.equal(e.planned_minutes, 90);
  assert.equal((await view(s.session_id, at(2059))).alert, null);
  await stop(s.session_id, at(2060), { void: true, reason: 'alarm test' });
});

test('a room has its own rate and a minimum: 10 minutes is billed as 30', { skip }, async () => {
  const s = await start(room.station_id, {}, at(2200));
  const done = await stop(s.session_id, at(2210));
  assert.equal(done.time_paise, rs(150));
  assert.equal(done.billed_minutes, 30);
  await billTab(s.order_id).then(ok);
});

test('transfer moves the session and its tab, pricing each stretch at its own station rate', { skip }, async () => {
  const s = await start(ps5b.station_id, { players: 2 }, at(2400));
  ok(await call(orders.addItems, { params: { id: s.order_id }, body: { items: [{ product_id: dish, quantity: 1 }] } }));
  const moved = await tx((db) => sessions.transferSession(db, tenant, userId, s.session_id, { station_id: room.station_id }, { now: at(2430) }));
  assert.equal(moved.station_id, room.station_id);
  const tab = (await pool.query(`SELECT o.table_id, t.name FROM orders o JOIN dining_tables t ON t.table_id = o.table_id WHERE o.order_id = $1`, [s.order_id])).rows[0];
  assert.equal(tab.name, 'Room-1', 'the tab, with the coffee on it, went too');
  await assert.rejects(() => tx((db) => sessions.transferSession(db, tenant, userId, s.session_id, { station_id: room.station_id }, { now: at(2431) })).then((v) => { if (v.station_id !== room.station_id) throw new Error('moved'); return Promise.reject(new Error('same station is a no-op')); }), /same station is a no-op/);
  const done = await stop(s.session_id, at(2460));
  // 30 min for two on PS5 at Rs 150 an hour, then 30 min in the room at Rs 300 an hour (flat, no extra for the second player)
  assert.equal(done.time_paise, rs(75) + rs(150));
  await billTab(s.order_id).then(ok);
  const busy = await start(ps5.station_id, {}, at(2500));
  await assert.rejects(() => tx((db) => sessions.transferSession(db, tenant, userId, busy.session_id, { station_id: ps5b.station_id }, { now: at(2510) })).then(async () => { await start(room.station_id, {}, at(2511)); return tx((db) => sessions.transferSession(db, tenant, userId, busy.session_id, { station_id: room.station_id }, { now: at(2512) })); }), /already has a session running/);
  await stop(busy.session_id, at(2520), { void: true, reason: 'cleanup' });
  const roomLive = (await pool.query(`SELECT session_id FROM gaming_sessions WHERE station_id = $1 AND status IN ('RUNNING','PAUSED')`, [room.station_id])).rows[0];
  if (roomLive) await stop(roomLive.session_id, at(2530), { void: true, reason: 'cleanup' });
});

test('a tab with a running session cannot be billed, cancelled, moved or merged', { skip }, async () => {
  const s = await start(ps5b.station_id, {}, at(3000));
  ok(await call(orders.addItems, { params: { id: s.order_id }, body: { items: [{ product_id: dish, quantity: 1 }] } }));
  const bill = await billTab(s.order_id);
  assert.equal(bill.code, 409);
  assert.match(bill.body.message, /session is still running/);
  const cancel = await call(orders.cancelOrder, { params: { id: s.order_id } });
  assert.equal(cancel.code, 409);
  const free = (await pool.query(`SELECT table_id FROM dining_tables WHERE business_id = $1 AND name = 'Pool-1'`, [L.businessId])).rows[0].table_id;
  assert.equal((await call(tabsApi.transfer, { params: { id: s.order_id }, body: { table_id: free } })).code, 409);
  await stop(s.session_id, at(3010));
  await billTab(s.order_id).then(ok);
});

test('an unpaid finished session holds its station: the next start must wait for the bill', { skip }, async () => {
  const s = await start(ps5b.station_id, {}, at(3100));
  await stop(s.session_id, at(3160));
  const board = (await sessions.board(pool, tenant, await stations.listStations(pool, tenant), at(3161))).find((b) => b.station_id === ps5b.station_id);
  assert.equal(board.state, 'TO_BILL');
  assert.equal(board.tab.total_paise, 11800);
  await assert.rejects(() => start(ps5b.station_id, {}, at(3162)), (e) => e.code === 'TO_BILL');
  await billTab(s.order_id).then(ok);
  const next = await start(ps5b.station_id, {}, at(3170));
  await stop(next.session_id, at(3171), { void: true, reason: 'cleanup' });
});

test('stopping can be taken back until the time is billed', { skip }, async () => {
  const s = await start(ps5b.station_id, {}, at(3300));
  await stop(s.session_id, at(3330));
  const back = await tx((db) => sessions.reopenSession(db, tenant, userId, s.session_id, { now: at(3350) }));
  assert.equal(back.status, 'RUNNING');
  assert.equal((await lines(s.order_id)).filter((i) => i.status !== 'CANCELLED').length, 0, 'the time line came off the tab');
  const done = await stop(s.session_id, at(3380));
  assert.equal(done.time_paise, rs(100), '30 + 30 minutes; the 20 minutes between were not counted');
  await billTab(s.order_id).then(ok);
  await assert.rejects(() => tx((db) => sessions.reopenSession(db, tenant, userId, s.session_id, { now: at(3400) })), /already billed/);
});

test('a session that never happened is voided with a reason, and leaves nothing on the tab', { skip }, async () => {
  const s = await start(ps5b.station_id, {}, at(3500));
  await assert.rejects(() => stop(s.session_id, at(3501), { void: true }), /reason/);
  const v = await stop(s.session_id, at(3501), { void: true, reason: 'Started on the wrong station' });
  assert.equal(v.status, 'CANCELLED');
  assert.equal(v.tab_closed, true, 'an empty tab is closed so the station is free');
  assert.equal((await pool.query(`SELECT status FROM orders WHERE order_id = $1`, [s.order_id])).rows[0].status, 'CANCELLED');
  const next = await start(ps5b.station_id, {}, at(3510));
  await stop(next.session_id, at(3511), { void: true, reason: 'cleanup' });
});

test('out of service and archived stations cannot start; a running one cannot be taken out', { skip }, async () => {
  const spare = await station('Spare');
  await tx((db) => stations.setStationStatus(db, tenant, spare.station_id, { out_of_service: true, note: 'Controller drift' }));
  await assert.rejects(() => start(spare.station_id, {}, at(3600)), /out of service: Controller drift/);
  await tx((db) => stations.setStationStatus(db, tenant, spare.station_id, { out_of_service: false }));
  const s = await start(spare.station_id, {}, at(3600));
  await assert.rejects(() => tx((db) => stations.setStationStatus(db, tenant, spare.station_id, { out_of_service: true })), /Stop it first/);
  await assert.rejects(() => tx((db) => stations.archiveStation(db, tenant, spare.station_id)), /Stop it first/);
  await stop(s.session_id, at(3601), { void: true, reason: 'cleanup' });
  await tx((db) => stations.archiveStation(db, tenant, spare.station_id));
  assert.equal((await pool.query(`SELECT status FROM dining_tables WHERE table_id = $1`, [spare.table_id])).rows[0].status, 'CLOSED');
  await assert.rejects(() => start(spare.station_id, {}, at(3700)), /Not found/);
});

test('a station with no rate cannot start, and says what to do', { skip }, async () => {
  const s = await tx((db) => stations.createStation(db, tenant, { name: 'Racing sim', kind: 'VR' }));
  await assert.rejects(() => start(s.station_id, {}, at(3800)), (e) => e.code === 'NO_RATE' && /Add one under Rates/.test(e.message));
});

test('a rate for one station beats its zone, which beats its kind', { skip }, async () => {
  const z = (await stations.listZones(pool, tenant))[0];
  await tx((db) => rates.createRate(db, L.businessId, { name: 'Lounge zone', zone_id: z.zone_id, tiers: [{ players: 1, hour: 120 }] }));
  const live = await rates.rateFor(pool, L.businessId, { station_id: ps5.station_id, zone_id: z.zone_id, kind: 'CONSOLE' });
  assert.equal(live.name, 'Lounge zone');
  assert.equal((await rates.rateFor(pool, L.businessId, { station_id: room.station_id, zone_id: null, kind: 'CONSOLE' })).name, 'Room');
  const r = (await rates.listRates(pool, L.businessId)).find((x) => x.name === 'Lounge zone');
  await tx((db) => rates.archiveRate(db, L.businessId, r.rate_id));
  assert.equal((await rates.rateFor(pool, L.businessId, { station_id: ps5.station_id, zone_id: z.zone_id, kind: 'CONSOLE' })).name, 'Console');
  await assert.rejects(() => tx((db) => rates.createRate(db, L.businessId, { name: 'Both', kind: 'CONSOLE', zone_id: z.zone_id, tiers: [{ players: 1, hour: 1 }] })), /one thing/);
  await assert.rejects(() => tx((db) => rates.createRate(db, L.businessId, { name: 'No prices', kind: 'CONSOLE' })), /at least one price/);
});

test('editing a rate does not change a session already running', { skip }, async () => {
  const s = await start(ps5.station_id, {}, at(4000));
  const r = (await rates.listRates(pool, L.businessId)).find((x) => x.name === 'Console');
  await tx((db) => rates.updateRate(db, L.businessId, r.rate_id, { tiers: [{ players: 1, hour: 999 }] }));
  const done = await stop(s.session_id, at(4060));
  assert.equal(done.time_paise, rs(100), 'priced at the rate it started with');
  await tx((db) => rates.updateRate(db, L.businessId, r.rate_id, { tiers: [{ players: 1, hour: 100 }, { players: 2, hour: 150 }, { players: 4, hour: 200 }] }));
  await billTab(s.order_id).then(ok);
});

test('another business, and another outlet, see nothing of this lounge', { skip }, async () => {
  const s = await start(ps5.station_id, {}, at(4200));
  const other = M.tenantFor();
  await assert.rejects(() => sessions.sessionView(pool, other, s.session_id, at(4201)), /Not found/);
  await assert.rejects(() => tx((db) => sessions.stopSession(db, other, M.userId, s.session_id, {}, { now: at(4201) })), /Not found/);
  await assert.rejects(() => tx((db) => sessions.startSession(db, other, M.userId, { station_id: ps5.station_id }, { now: at(4201) })), /Not found/);
  assert.equal((await stations.listStations(pool, other)).length, 0);
  assert.equal((await rates.listRates(pool, M.businessId)).length, 0);
  // a second outlet of the same business
  const N = await makeLounge(pool, 'two', { branches: 2 });
  const t1 = N.tenantFor('MANAGER', { branchId: N.branchIds[0], pinned: true });
  const t2 = N.tenantFor('MANAGER', { branchId: N.branchIds[1], pinned: true });
  await tx((db) => rates.createRate(db, N.businessId, { name: 'All', tiers: [{ players: 1, hour: 100 }] }));
  const a = await tx((db) => stations.createStation(db, t1, { name: 'PS5-A', kind: 'CONSOLE' }));
  const run = await tx((db) => sessions.startSession(db, t1, N.userId, { station_id: a.station_id }, { now: at(4300) }));
  assert.equal((await stations.listStations(pool, t2)).length, 0, 'the other outlet does not list it');
  await assert.rejects(() => sessions.sessionView(pool, t2, run.session_id, at(4301)), /Not found/);
  await assert.rejects(() => tx((db) => sessions.pauseSession(db, t2, N.userId, run.session_id, { now: at(4301) })), /Not found/);
  assert.equal((await stations.listStations(pool, N.allOutlets())).length, 1, 'the owner viewing all outlets sees it');
  await tx((db) => sessions.stopSession(db, t1, N.userId, run.session_id, { void: true, reason: 'cleanup' }, { now: at(4310) }));
  await stop(s.session_id, at(4300), { void: true, reason: 'cleanup' });
});

test('history lists sessions with their charge and invoice', { skip }, async () => {
  const { rows, total } = await sessions.listSessions(pool, tenant, { status: 'ENDED' }, { limit: 50, offset: 0 });
  assert.ok(total >= 5);
  assert.ok(rows.some((r) => r.invoice_number), 'a billed session shows its invoice');
  assert.ok(rows.every((r) => r.charge_paise >= 0));
  const events = await sessions.eventsOf(pool, tenant, rows[0].session_id);
  assert.ok(events.some((e) => e.type === 'START') && events.some((e) => e.type === 'STOP'));
  void iso; void T0;
});

test('a player ordering from the station QR lands on the session tab, and an archived station\'s QR stops working', { skip }, async () => {
  const publicApi = await import('../src/controllers/publicOrdering.controller.js');
  const st = await station('QR-1');
  const s = await start(st.station_id, {}, at(5000));
  const order = (token, items) => new Promise((resolve) => {
    const res = fakeRes();
    publicApi.placeOrder({ params: { token }, body: { items }, headers: {}, get: () => undefined, ip: '127.0.0.1' }, res).then(() => resolve(res));
  });
  const placed = await order(st.qr_token, [{ product_id: dish, quantity: 2 }]);
  assert.equal(placed.code, 201, JSON.stringify(placed.body));
  const rows = await lines(s.order_id);
  assert.equal(rows.filter((r) => r.product_id === dish).length, 1, 'the order is on the session tab, not a new one');
  const done = await stop(s.session_id, at(5060));
  assert.equal(done.tab_closed, false);
  assert.equal((await lines(s.order_id)).length, 2, 'time and coffee on one tab');
  const bill = await billTab(s.order_id);
  assert.equal(bill.code, 201);
  await tx((db) => stations.archiveStation(db, tenant, st.station_id));
  const after = await order(st.qr_token, [{ product_id: dish, quantity: 1 }]);
  assert.equal(after.code, 404, 'a retired station\'s QR is no longer available');
});
