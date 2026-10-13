/*
 * Station bookings (overlaps, races, the hold, seating, no-shows, the lounge's own day) and tournaments (capacity, fees on a GST invoice, check-in,
 * results). Also: deleting a whole lounge removes everything it owns.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { TODAY, addDays, addDish, at, fakeRes, makeLounge, rs } from './helpers/gaming.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const stations = await import('../src/modules/gaming/stations.js');
const rates = await import('../src/modules/gaming/rates.js');
const sessions = await import('../src/modules/gaming/sessions.js');
const bookings = await import('../src/modules/gaming/bookings.js');
const tournaments = await import('../src/modules/gaming/tournaments.js');
const players = await import('../src/modules/gaming/players.js');
const wallet = await import('../src/modules/gaming/wallet.js');
const passes = await import('../src/modules/gaming/passes.js');
const { inTx, getSettings } = await import('../src/modules/gaming/common.js');
const router = (await import('../src/routes/gaming.routes.js')).default;

test.after(cleanup);

let L; let M; let tenant; let userId; let ps5; let ps5b; let asha;
const tx = (fn) => inTx(fn);
const MIN = 60000;
// "now" for these tests: Monday 12 October 2026, 09:00 in Kolkata
const NOW = at(-60);
const slot = (fromMin, minutes = 60) => ({ starts_at: new Date(NOW.getTime() + fromMin * MIN).toISOString(), minutes });
const book = (stationId, fromMin, minutes = 60, over = {}) => tx((db) => bookings.createBooking(db, tenant, userId, { station_id: stationId, guest_name: 'Guest', ...slot(fromMin, minutes), ...over }, { now: NOW }));
const start = (stationId, over = {}, when = NOW) => tx((db) => sessions.startSession(db, tenant, userId, { station_id: stationId, players: 1, ...over }, { now: when }));

test('setup', { skip }, async () => {
  await runMigrations(pool);
  L = await makeLounge(pool, 'book');
  M = await makeLounge(pool, 'book2');
  tenant = L.tenantFor();
  userId = L.userId;
  ps5 = await tx((db) => stations.createStation(db, tenant, { name: 'PS5-1', kind: 'CONSOLE', max_players: 4 }));
  ps5b = await tx((db) => stations.createStation(db, tenant, { name: 'PS5-2', kind: 'CONSOLE', max_players: 4 }));
  await tx((db) => rates.createRate(db, L.businessId, { name: 'All', tiers: [{ players: 1, hour: 100 }] }));
  asha = (await tx((db) => players.createPlayer(db, tenant, { name: 'Asha', phone: '9876500011' }))).customer_id;
  await getSettings(pool, L.businessId);
});

test('a booking reserves a station for a stretch of time, and two cannot overlap', { skip }, async () => {
  const a = await book(ps5.station_id, 120, 60, { guest_name: 'Rohan', guest_phone: '9811100001' });
  assert.equal(a.status, 'BOOKED');
  assert.equal(a.minutes, 60);
  assert.equal(a.name, 'Rohan');
  await assert.rejects(() => book(ps5.station_id, 150, 60), (e) => e.code === 'BOOKING_CLASH' && /already booked from 11:00 am to 12:00 pm \(Rohan\)/.test(e.message));
  await assert.rejects(() => book(ps5.station_id, 90, 60), (e) => e.code === 'BOOKING_CLASH', 'overlapping the front');
  await assert.rejects(() => book(ps5.station_id, 100, 120), (e) => e.code === 'BOOKING_CLASH', 'swallowing it whole');
  assert.ok(await book(ps5.station_id, 180, 60), 'one that starts as the other ends is fine');
  assert.ok(await book(ps5.station_id, 60, 60), 'and so is one that ends as it starts');
  assert.ok(await book(ps5b.station_id, 120, 60), 'another station is free');
});

test('a booking is checked: people, time, length, and who it is for', { skip }, async () => {
  await assert.rejects(() => book(ps5.station_id, 300, 60, { players: 9 }), /takes up to 4/);
  await assert.rejects(() => book(ps5.station_id, 300, 5), /from 15 to 720/);
  await assert.rejects(() => book(ps5.station_id, 300, 900), /from 15 to 720/);
  await assert.rejects(() => book(ps5.station_id, -120, 60), /already passed/);
  await assert.rejects(() => book(ps5.station_id, 95 * 24 * 60, 60), /90 days ahead/);
  await assert.rejects(() => book(ps5.station_id, 300, 60, { guest_name: '' }), /who the booking is for/);
  await assert.rejects(() => book(ps5.station_id, 300, 60, { starts_at: 'soon' }), /date and time/);
  const withCustomer = await book(ps5.station_id, 300, 60, { guest_name: undefined, customer_id: asha });
  assert.equal(withCustomer.name, 'Asha');
  assert.equal(withCustomer.phone, '9876500011');
  await assert.rejects(() => book(ps5.station_id, 400, 60, { guest_name: undefined, customer_id: 99999 }), /does not exist/);
  const spare = await tx((db) => stations.createStation(db, tenant, { name: 'Broken', kind: 'CONSOLE' }));
  await tx((db) => stations.setStationStatus(db, tenant, spare.station_id, { out_of_service: true, note: 'Cable' }));
  await assert.rejects(() => book(spare.station_id, 300, 60), /out of service: Cable/);
});

test('two staff booking the same slot at once: exactly one wins', { skip }, async () => {
  const lone = await tx((db) => stations.createStation(db, tenant, { name: 'Lone', kind: 'CONSOLE' }));
  const results = await Promise.allSettled([book(lone.station_id, 500), book(lone.station_id, 500), book(lone.station_id, 520), book(lone.station_id, 500)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.status === 409));
});

test('changing a booking: moving it, a clash, and what cannot be changed', { skip }, async () => {
  const x = await book(ps5b.station_id, 600, 60);
  const moved = await tx((db) => bookings.updateBooking(db, tenant, userId, x.booking_id, { starts_at: slot(660).starts_at }, { now: NOW }));
  assert.equal(moved.minutes, 60, 'the length is kept');
  await assert.rejects(() => tx((db) => bookings.updateBooking(db, tenant, userId, x.booking_id, { starts_at: slot(120).starts_at }, { now: NOW })), (e) => e.code === 'BOOKING_CLASH');
  const same = await tx((db) => bookings.updateBooking(db, tenant, userId, x.booking_id, { starts_at: slot(661).starts_at, note: 'Birthday' }, { now: NOW }));
  assert.equal(same.note, 'Birthday', 'a booking does not clash with itself');
  const over = await tx((db) => bookings.updateBooking(db, tenant, userId, x.booking_id, { station_id: ps5.station_id, starts_at: slot(900).starts_at, minutes: 90 }, { now: NOW }));
  assert.equal(over.station_name, 'PS5-1');
  assert.equal(over.minutes, 90);
  await tx((db) => bookings.cancelBooking(db, tenant, userId, x.booking_id));
  assert.equal((await tx((db) => bookings.cancelBooking(db, tenant, userId, x.booking_id))).status, 'CANCELLED', 'cancelling twice is harmless');
  await assert.rejects(() => tx((db) => bookings.updateBooking(db, tenant, userId, x.booking_id, { note: 'x' }, { now: NOW })), /still waiting/);
  assert.ok(await book(ps5.station_id, 900, 60), 'a cancelled booking frees its slot');
});

test('a booked station is held: it cannot be started for someone else inside the hold window without an override', { skip }, async () => {
  const h = await tx((db) => stations.createStation(db, tenant, { name: 'Held', kind: 'CONSOLE' }));
  await book(h.station_id, 10, 60, { guest_name: 'Meera' });            // starts in 10 minutes; the hold is 15
  await assert.rejects(() => start(h.station_id), (e) => e.code === 'BOOKED' && /booked from 9:10 am for Meera/.test(e.message));
  const board = (await sessions.board(pool, tenant, await stations.listStations(pool, tenant), NOW)).find((s) => s.station_id === h.station_id);
  assert.equal(board.state, 'RESERVED');
  const run = await start(h.station_id, { override: true });
  assert.equal(run.status, 'RUNNING', 'a manager can start it anyway');
  await tx((db) => sessions.stopSession(db, tenant, userId, run.session_id, { void: true, reason: 'cleanup' }, { now: at(-59) }));
  const far = await tx((db) => stations.createStation(db, tenant, { name: 'Far', kind: 'CONSOLE' }));
  await book(far.station_id, 240, 60);                                  // four hours away: no hold yet
  const ok = await start(far.station_id);
  await tx((db) => sessions.stopSession(db, tenant, userId, ok.session_id, { void: true, reason: 'cleanup' }, { now: at(-58) }));
});

test('seating a booking starts the session for the booked people and marks it seated, once', { skip }, async () => {
  const s = await tx((db) => stations.createStation(db, tenant, { name: 'Seat', kind: 'CONSOLE', max_players: 4 }));
  const b = await book(s.station_id, 5, 60, { guest_name: undefined, customer_id: asha, players: 3 });
  const seated = await tx((db) => bookings.seatBooking(db, tenant, userId, b.booking_id, {}, { now: NOW }));
  assert.equal(seated.booking.status, 'SEATED');
  assert.equal(seated.session.players, 3);
  assert.equal(seated.session.customer_id, asha);
  assert.equal(seated.booking.session_id, seated.session.session_id);
  await assert.rejects(() => tx((db) => bookings.seatBooking(db, tenant, userId, b.booking_id, {}, { now: NOW })), /already seated/);
  const other = await book(s.station_id, 200, 60);
  await assert.rejects(() => tx((db) => bookings.seatBooking(db, tenant, userId, other.booking_id, {}, { now: at(-30) })), (e) => e.code === 'STATION_BUSY');
  await tx((db) => sessions.stopSession(db, tenant, userId, seated.session.session_id, { void: true, reason: 'cleanup' }, { now: at(-20) }));
  await tx((db) => bookings.cancelBooking(db, tenant, userId, other.booking_id));
});

test('a no-show is marked only after the wait, and stops holding the station', { skip }, async () => {
  const s = await tx((db) => stations.createStation(db, tenant, { name: 'Late', kind: 'CONSOLE' }));
  const b = await book(s.station_id, 10, 60, { guest_name: 'Late one' });
  await assert.rejects(() => tx((db) => bookings.markNoShow(db, tenant, userId, b.booking_id, { now: at(-55) })), /15 minutes after/);
  const done = await tx((db) => bookings.markNoShow(db, tenant, userId, b.booking_id, { now: at(-60 + 10 + 16) }));
  assert.equal(done.status, 'NO_SHOW');
  assert.equal((await tx((db) => bookings.markNoShow(db, tenant, userId, b.booking_id, { now: at(0) }))).status, 'NO_SHOW', 'twice is harmless');
  const run = await start(s.station_id, {}, at(-60 + 30));
  assert.equal(run.status, 'RUNNING', 'no longer held');
  await tx((db) => sessions.stopSession(db, tenant, userId, run.session_id, { void: true, reason: 'cleanup' }, { now: at(-60 + 31) }));
});

test('the day list follows the lounge calendar, not UTC', { skip }, async () => {
  const lateNight = await tx((db) => stations.createStation(db, tenant, { name: 'Night', kind: 'CONSOLE' }));
  // 23:30 in Kolkata is 18:00 UTC on the same date; 00:30 on the next day is 19:00 UTC on the first
  const a = await tx((db) => bookings.createBooking(db, tenant, userId, { station_id: lateNight.station_id, guest_name: 'Before midnight', starts_at: `${TODAY}T18:00:00Z`, minutes: 30 }, { now: NOW }));
  const b = await tx((db) => bookings.createBooking(db, tenant, userId, { station_id: lateNight.station_id, guest_name: 'After midnight', starts_at: `${TODAY}T19:00:00Z`, minutes: 30 }, { now: NOW }));
  const monday = (await bookings.listBookings(pool, tenant, { date: TODAY, station_id: lateNight.station_id })).map((x) => x.booking_id);
  const tuesday = (await bookings.listBookings(pool, tenant, { date: addDays(TODAY, 1), station_id: lateNight.station_id })).map((x) => x.booking_id);
  assert.deepEqual(monday, [a.booking_id]);
  assert.deepEqual(tuesday, [b.booking_id]);
});

test('bookings belong to their lounge and outlet', { skip }, async () => {
  const mine = await book(ps5.station_id, 1000, 60);
  const other = M.tenantFor();
  await assert.rejects(() => tx((db) => bookings.cancelBooking(db, other, M.userId, mine.booking_id)), /Not found/);
  await assert.rejects(() => tx((db) => bookings.createBooking(db, other, M.userId, { station_id: ps5.station_id, guest_name: 'X', ...slot(2000) }, { now: NOW })), /Not found/);
  assert.equal((await bookings.listBookings(pool, other, {})).length, 0);
  const N = await makeLounge(pool, 'two', { branches: 2 });
  const t1 = N.tenantFor('MANAGER', { branchId: N.branchIds[0], pinned: true });
  const t2 = N.tenantFor('MANAGER', { branchId: N.branchIds[1], pinned: true });
  const st = await tx((db) => stations.createStation(db, t1, { name: 'A', kind: 'CONSOLE' }));
  const bk = await tx((db) => bookings.createBooking(db, t1, N.userId, { station_id: st.station_id, guest_name: 'X', ...slot(60) }, { now: NOW }));
  assert.equal((await bookings.listBookings(pool, t2, {})).length, 0);
  await assert.rejects(() => tx((db) => bookings.cancelBooking(db, t2, N.userId, bk.booking_id)), /Not found/);
  assert.equal((await bookings.listBookings(pool, N.allOutlets(), {})).length, 1);
});

/* ── tournaments ──────────────────────────────────────────────────────────── */

let cup;
const cash = { payment: { method: 'CASH', amount: 'FULL' } };
test('a tournament takes entries up to its limit; the fee is a GST invoice', { skip }, async () => {
  cup = await tx((db) => tournaments.createTournament(db, tenant, userId, { name: 'FIFA Night', game_name: 'FIFA 26', starts_at: '2026-10-17T14:00:00Z', entry_fee: 200, prize_pool: 1000, max_players: 3 }));
  assert.equal(cup.status, 'OPEN');
  assert.equal(cup.entry_fee, 200);
  const a = await tx((db) => tournaments.register(db, tenant, userId, cup.tournament_id, { customer_id: asha, ...cash }));
  assert.equal(a.entry.name, 'Asha');
  const inv = (await pool.query(`SELECT total_paise, payment_status FROM invoices WHERE invoice_id = $1`, [a.invoice.invoice_id])).rows[0];
  assert.equal(Number(inv.total_paise), 23600, '200 + 18% GST');
  assert.equal(inv.payment_status, 'PAID');
  await assert.rejects(() => tx((db) => tournaments.register(db, tenant, userId, cup.tournament_id, { customer_id: asha, ...cash })), /already entered/);
  const b = await tx((db) => tournaments.register(db, tenant, userId, cup.tournament_id, { player_name: 'Walk-in Wasim', phone: '9811100002' }));
  assert.equal(b.invoice, null, 'registered, not paid');
  assert.equal(b.entry.paid, false);
  await assert.rejects(() => tx((db) => tournaments.checkIn(db, tenant, b.entry.entry_id)), (e) => e.code === 'UNPAID');
  const paid = await tx((db) => tournaments.payEntry(db, tenant, userId, b.entry.entry_id, { payment: { method: 'UPI', amount: 'FULL' } }));
  assert.ok(paid.invoice.invoice_id);
  await assert.rejects(() => tx((db) => tournaments.payEntry(db, tenant, userId, b.entry.entry_id, cash)), /already paid/);
  assert.equal((await tx((db) => tournaments.checkIn(db, tenant, b.entry.entry_id))).status, 'CHECKED_IN');
  const c = await tx((db) => tournaments.register(db, tenant, userId, cup.tournament_id, { player_name: 'Chitra', ...cash }));
  await assert.rejects(() => tx((db) => tournaments.register(db, tenant, userId, cup.tournament_id, { player_name: 'Fourth', ...cash })), (e) => e.code === 'FULL');
  assert.equal((await tournaments.getTournament(pool, tenant, cup.tournament_id)).entries, 3);
  // someone withdraws: a place opens, and a paid entry says how to refund it
  const w = await tx((db) => tournaments.withdraw(db, tenant, c.entry.entry_id));
  assert.match(w.refund_hint, /credit note/);
  assert.ok(await tx((db) => tournaments.register(db, tenant, userId, cup.tournament_id, { player_name: 'Fourth', ...cash })));
  await assert.rejects(() => tx((db) => tournaments.updateTournament(db, tenant, cup.tournament_id, { max_players: 2 })), /already in/);
  await assert.rejects(() => tx((db) => tournaments.updateTournament(db, tenant, cup.tournament_id, { entry_fee: 500 })), /old fee/);
});

test('a race for the last place: exactly one entry gets it', { skip }, async () => {
  const t = await tx((db) => tournaments.createTournament(db, tenant, userId, { name: 'Pool Night', starts_at: '2026-10-18T14:00:00Z', max_players: 2 }));
  const results = await Promise.allSettled(['A', 'B', 'C', 'D'].map((n) => tx((db) => tournaments.register(db, tenant, userId, t.tournament_id, { player_name: `Player ${n}` }))));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
  assert.equal((await tournaments.getTournament(pool, tenant, t.tournament_id)).entries, 2);
});

test('results: distinct places, prizes within the pool, only real entries; they close the tournament', { skip }, async () => {
  const t = await tournaments.getTournament(pool, tenant, cup.tournament_id);
  const live = t.entries_list.filter((e) => e.status !== 'WITHDRAWN');
  const [first, second] = live;
  await assert.rejects(() => tx((db) => tournaments.recordResults(db, tenant, cup.tournament_id, [])), /at least the winner/);
  await assert.rejects(() => tx((db) => tournaments.recordResults(db, tenant, cup.tournament_id, [{ entry_id: first.entry_id, placement: 1, prize: 600 }, { entry_id: second.entry_id, placement: 1, prize: 100 }])), /both finish 1/);
  await assert.rejects(() => tx((db) => tournaments.recordResults(db, tenant, cup.tournament_id, [{ entry_id: first.entry_id, placement: 1, prize: 800 }, { entry_id: second.entry_id, placement: 2, prize: 300 }])), /more than the prize pool/);
  await assert.rejects(() => tx((db) => tournaments.recordResults(db, tenant, cup.tournament_id, [{ entry_id: 999999, placement: 1, prize: 100 }])), /not in this tournament/);
  const done = await tx((db) => tournaments.recordResults(db, tenant, cup.tournament_id, [{ entry_id: first.entry_id, placement: 1, prize: 600 }, { entry_id: second.entry_id, placement: 2, prize: 300 }]));
  assert.equal(done.status, 'DONE');
  assert.equal(done.entries_list[0].placement, 1);
  assert.equal(done.entries_list[0].prize, 600);
  await assert.rejects(() => tx((db) => tournaments.register(db, tenant, userId, cup.tournament_id, { player_name: 'Late' })), /not taking entries/);
  await assert.rejects(() => tournaments.getTournament(pool, M.tenantFor(), cup.tournament_id), /Not found/);
  await assert.rejects(() => tx((db) => tournaments.checkIn(db, M.tenantFor(), first.entry_id)), /Not found/);
});

test('booking and tournament routes: permissions and plan switches', { skip }, async () => {
  const routes = router.stack.filter((l) => l.route).map((l) => ({ method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path, stack: l.route.stack.map((s) => s.handle) }));
  const gate = async (method, path, t) => {
    const route = routes.find((r) => r.method === method && r.path === path);
    assert.ok(route, `${method} ${path}`);
    for (const mw of route.stack.slice(2, -1)) {
      const res = fakeRes(); let passed = false;
      await mw({ tenant: t, method, headers: {}, body: {}, get: () => undefined, originalUrl: path }, res, () => { passed = true; });
      if (!passed) return res.code;
    }
    return 200;
  };
  for (const [method, path, want] of [
    ['POST', '/bookings', { OWNER: 200, GAMING_ATTENDANT: 200, CASHIER: 403 }],
    ['POST', '/bookings/:id/seat', { OWNER: 200, GAMING_ATTENDANT: 200, CASHIER: 403 }],
    ['POST', '/tournaments', { OWNER: 200, MANAGER: 200, GAMING_ATTENDANT: 403 }],
    ['POST', '/tournaments/:id/results', { OWNER: 200, GAMING_ATTENDANT: 403 }],
    ['POST', '/tournaments/:id/entries', { OWNER: 200, GAMING_ATTENDANT: 200, CASHIER: 403 }],
    ['GET', '/tournaments', { OWNER: 200, GAMING_ATTENDANT: 200, CASHIER: 403 }]
  ]) for (const [role, code] of Object.entries(want)) assert.equal(await gate(method, path, L.tenantFor(role)), code, `${role} ${method} ${path}`);
  assert.equal(await gate('POST', '/bookings', L.tenantFor('OWNER', { planFeatures: { gaming_bookings: false } })), 402);
  assert.equal(await gate('GET', '/tournaments', L.tenantFor('OWNER', { planFeatures: { gaming_tournaments: false } })), 402);
  assert.equal(await gate('GET', '/board', L.tenantFor('OWNER', { planFeatures: { gaming_bookings: false, gaming_tournaments: false } })), 200, 'the board needs neither');
});

test('deleting a whole lounge removes everything it owns, without a constraint getting in the way', { skip }, async () => {
  const D = await makeLounge(pool, 'doomed');
  const t = D.tenantFor();
  await tx((db) => rates.createRate(db, D.businessId, { name: 'All', tiers: [{ players: 1, hour: 100 }] }));
  const st = await tx((db) => stations.createStation(db, t, { name: 'S1', kind: 'CONSOLE' }));
  const p = (await tx((db) => players.createPlayer(db, t, { name: 'Gone', phone: '9876500099' }))).customer_id;
  await tx(async (db) => wallet.topUp(db, t, D.userId, p, { amount: 500, method: 'CASH' }, { settings: await getSettings(db, D.businessId) }));
  const pack = await tx((db) => rates.createBundle(db, D.businessId, { name: 'Pack', kind: 'PACK', minutes: 60, price: 100 }));
  await tx((db) => passes.sellPass(db, t, D.userId, p, { bundle_id: pack.bundle_id, payment: { method: 'CASH', amount: 'FULL' } }));
  const s = await tx((db) => sessions.startSession(db, t, D.userId, { station_id: st.station_id, customer_id: p }, { now: at(0) }));
  await tx((db) => sessions.stopSession(db, t, D.userId, s.session_id, {}, { now: at(30) }));
  await tx((db) => bookings.createBooking(db, t, D.userId, { station_id: st.station_id, guest_name: 'Z', ...slot(300) }, { now: NOW }));
  await tx((db) => tournaments.createTournament(db, t, D.userId, { name: 'T', starts_at: '2026-10-20T10:00:00Z' }));
  await addDish(pool, D, { name: 'Tea' });
  const count = async (sql, params = []) => Number((await pool.query(sql, params)).rows[0].n);
  const segmentsBefore = await count(`SELECT COUNT(*) AS n FROM gaming_session_segments`);
  const mine = await count(`SELECT COUNT(*) AS n FROM gaming_session_segments WHERE session_id IN (SELECT session_id FROM gaming_sessions WHERE business_id = $1)`, [D.businessId]);
  assert.ok(mine >= 1);
  await pool.query(`DELETE FROM businesses WHERE business_id = $1`, [D.businessId]);
  for (const table of ['gaming_stations', 'gaming_sessions', 'gaming_session_events', 'gaming_bookings', 'gaming_wallet_ledger', 'gaming_passes', 'gaming_tournaments', 'gaming_rates', 'gaming_bundles', 'gaming_players', 'gaming_settings']) {
    assert.equal(await count(`SELECT COUNT(*) AS n FROM ${table} WHERE business_id = $1`, [D.businessId]), 0, `${table} rows left behind`);
  }
  assert.equal(await count(`SELECT COUNT(*) AS n FROM gaming_session_segments`), segmentsBefore - mine, 'its segments went too');
  void rs;
});
