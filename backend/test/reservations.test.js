/*
 * Table reservations and the walk-in waitlist: overlap rules, seating, outlet isolation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const rv = await import('../src/controllers/reservations.controller.js');
const tables = await import('../src/controllers/tables.controller.js');
const orders = await import('../src/controllers/orders.controller.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const inMin = (m) => new Date(Date.now() + m * 60000).toISOString();

let A; let B;
const makeBusiness = async (label, { pinnedBranch } = {}) => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@rv.test`])).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,'RESTAURANT') RETURNING business_id`, [label, user.user_id])).rows[0];
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz.business_id])).rows[0].branch_id;
  const tenant = { businessId: biz.business_id, branchId, scopeBranchId: branchId, role: 'OWNER', permissions: {} };
  const req = (extra = {}, t = tenant) => ({ tenant: t, auth: { userId: user.user_id }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra });
  const table = async (name, seats, status = 'FREE') => (await pool.query(
    `INSERT INTO dining_tables (business_id, branch_id, name, seats, status, qr_token) VALUES ($1,$2,$3,$4,$5,$6) RETURNING table_id`,
    [biz.business_id, branchId, name, seats, status, `${label}-${name}-${Math.random()}`])).rows[0].table_id;
  const call = async (fn, extra, t) => { const res = fakeRes(); await fn(req(extra, t), res); return res; };
  return { tenant, biz: biz.business_id, branchId, req, table, call };
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeBusiness('a'); B = await makeBusiness('b');
  [A.t2, A.t4, A.t6] = [await A.table('T2', 2), await A.table('T4', 4), await A.table('T6', 6)];
  A.closed = await A.table('Closed', 4, 'CLOSED');
  A.b = await A.table('B1', 4);
  B.t = await B.table('T1', 4);
});

test('a reservation is validated and stored', { skip }, async () => {
  const bad = (body) => A.call(rv.create, { body });
  assert.equal((await bad({ party_size: 2, reserved_at: inMin(60) })).code, 400);                       // no name
  assert.equal((await bad({ guest_name: 'Ravi', party_size: 0, reserved_at: inMin(60) })).code, 400);
  assert.equal((await bad({ guest_name: 'Ravi', party_size: 2, reserved_at: 'soon' })).code, 400);
  assert.equal((await bad({ guest_name: 'Ravi', party_size: 2, reserved_at: inMin(-120) })).code, 400); // in the past
  assert.equal((await bad({ guest_name: 'Ravi', party_size: 2, phone: '123', reserved_at: inMin(60) })).code, 400);
  assert.equal((await bad({ guest_name: 'Ravi', party_size: 2, reserved_at: inMin(60), duration_min: 5 })).code, 400);

  const ok = await bad({ guest_name: 'Ravi', party_size: 2, phone: '98765 43210', reserved_at: inMin(180), table_id: A.t2 });
  assert.equal(ok.code, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.data.status, 'BOOKED');
  assert.equal(ok.body.data.duration_min, 90);
  A.r1 = ok.body.data;
});

test('a booking links to the customer with that mobile', { skip }, async () => {
  await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Meena','+91 98111 22233')`, [A.biz]);
  const res = await A.call(rv.create, { body: { guest_name: 'Meena K', party_size: 3, phone: '9811122233', reserved_at: inMin(600), table_id: A.t4 } });
  assert.equal(res.code, 201);
  assert.ok(res.body.data.customer_id);
});

test('two bookings cannot overlap on one table, but back-to-back is fine', { skip }, async () => {
  const base = new Date(A.r1.reserved_at).getTime();
  const at = (offsetMin) => new Date(base + offsetMin * 60000).toISOString();
  const book = (offset, party = 2) => A.call(rv.create, { body: { guest_name: 'X', party_size: party, reserved_at: at(offset), table_id: A.t2 } });
  assert.equal((await book(30)).code, 409);      // starts inside the 90-minute slot
  assert.equal((await book(-60)).code, 409);     // ends inside it
  assert.equal((await book(90)).code, 201);      // starts exactly when the first ends
  assert.equal((await A.call(rv.create, { body: { guest_name: 'X', party_size: 5, reserved_at: at(400), table_id: A.t4 } })).code, 409); // 5 people, 4 seats
  assert.equal((await A.call(rv.create, { body: { guest_name: 'X', party_size: 2, reserved_at: at(400), table_id: A.closed } })).code, 404);
  assert.equal((await A.call(rv.create, { body: { guest_name: 'X', party_size: 2, reserved_at: at(400), table_id: B.t } })).code, 404); // another business's table
});

test('availability lists tables that fit and are free for the slot', { skip }, async () => {
  const q = (party, when) => A.call(rv.availability, { query: { reserved_at: when, party_size: String(party), duration_min: '90' } });
  const names = (r) => r.body.data.map((t) => t.name);
  assert.deepEqual(names(await q(2, A.r1.reserved_at)), ['B1', 'T4', 'T6']);   // T2 is taken, closed one is hidden
  assert.deepEqual(names(await q(5, A.r1.reserved_at)), ['T6']);                // only the six-seater fits
  assert.ok(names(await q(2, inMin(1200))).includes('T2'));                     // a different time is free again
});

test('editing moves a booking, keeping the clash rule (not against itself)', { skip }, async () => {
  const same = await A.call(rv.update, { params: { id: A.r1.reservation_id }, body: { notes: 'window seat' } });
  assert.equal(same.code, 200, JSON.stringify(same.body));
  assert.equal(same.body.data.notes, 'window seat');
  const clash = await A.call(rv.update, { params: { id: A.r1.reservation_id }, body: { reserved_at: new Date(new Date(A.r1.reserved_at).getTime() + 100 * 60000).toISOString() } });
  assert.equal(clash.code, 409);   // collides with the back-to-back booking
});

test('seating: needs a free table; a booking cannot be seated twice', { skip }, async () => {
  const r = (await A.call(rv.create, { body: { guest_name: 'Seat Me', party_size: 2, reserved_at: inMin(20), table_id: A.b } })).body.data;
  // a running order on the table blocks seating
  const order = (await pool.query(`INSERT INTO orders (business_id, branch_id, table_id, order_type, status, order_number) VALUES ($1,$2,$3,'DINE_IN','OPEN','O-1') RETURNING order_id`, [A.biz, A.branchId, A.b])).rows[0].order_id;
  const blocked = await A.call(rv.seat, { params: { id: r.reservation_id }, body: {} });
  assert.equal(blocked.code, 409);
  assert.match(blocked.body.message, /running order/);
  await pool.query(`UPDATE orders SET status = 'BILLED' WHERE order_id = $1`, [order]);

  const seated = await A.call(rv.seat, { params: { id: r.reservation_id }, body: {} });
  assert.equal(seated.code, 200, JSON.stringify(seated.body));
  assert.equal(seated.body.data.status, 'SEATED');
  assert.equal((await A.call(rv.seat, { params: { id: r.reservation_id }, body: {} })).code, 409);
  assert.equal((await A.call(rv.setStatus, { params: { id: r.reservation_id }, body: { status: 'CANCELLED' } })).code, 409);  // already seated
  assert.equal((await A.call(rv.setStatus, { params: { id: r.reservation_id }, body: { status: 'COMPLETED' } })).code, 200);
});

test('cancelling frees the table; a no-show also does', { skip }, async () => {
  const t = await A.table('T9', 4);
  const mk = async (offset) => (await A.call(rv.create, { body: { guest_name: 'G', party_size: 2, reserved_at: inMin(offset), table_id: t } })).body.data;
  const r = await mk(300);
  assert.equal((await A.call(rv.create, { body: { guest_name: 'H', party_size: 2, reserved_at: inMin(310), table_id: t } })).code, 409);
  assert.equal((await A.call(rv.setStatus, { params: { id: r.reservation_id }, body: { status: 'CANCELLED' } })).code, 200);
  const again = await mk(310);
  assert.ok(again.reservation_id);
  assert.equal((await A.call(rv.setStatus, { params: { id: again.reservation_id }, body: { status: 'NO_SHOW' } })).code, 200);
  assert.equal((await A.call(rv.setStatus, { params: { id: again.reservation_id }, body: { status: 'BOGUS' } })).code, 409);
});

test('the day list is per outlet and per business', { skip }, async () => {
  const day = (await pool.query(`SELECT ($1::timestamptz AT TIME ZONE 'Asia/Kolkata')::date::text AS d`, [A.r1.reserved_at])).rows[0].d;
  const listed = await A.call(rv.list, { query: { date: day } });
  assert.ok(listed.body.data.some((x) => x.reservation_id === A.r1.reservation_id));
  assert.equal((await B.call(rv.list, { query: { date: day } })).body.data.length, 0);

  // a second outlet of A: a user pinned there sees nothing of Main's bookings and cannot reach them by id
  const other = (await pool.query(`INSERT INTO branches (business_id, name) VALUES ($1,'Second') RETURNING branch_id`, [A.biz])).rows[0].branch_id;
  const pinned = { ...A.tenant, branchId: other, scopeBranchId: other, pinned: true };
  assert.equal((await A.call(rv.list, { query: { date: day } }, pinned)).body.data.length, 0);
  assert.equal((await A.call(rv.update, { params: { id: A.r1.reservation_id }, body: { notes: 'x' } }, pinned)).code, 404);
  assert.equal((await A.call(rv.seat, { params: { id: A.r1.reservation_id }, body: {} }, pinned)).code, 404);
  assert.equal((await A.call(rv.setStatus, { params: { id: A.r1.reservation_id }, body: { status: 'CANCELLED' } }, pinned)).code, 404);
});

test('the floor shows a booking that is due within the hour', { skip }, async () => {
  const t = await A.table('T10', 4);
  await A.call(rv.create, { body: { guest_name: 'Soon', party_size: 4, reserved_at: inMin(30), table_id: t } });
  const floor = (await A.call(tables.list)).body.data;
  assert.equal(floor.find((x) => x.table_id === t).next_reservation.guest_name, 'Soon');
  assert.equal(floor.find((x) => x.table_id === A.t6).next_reservation, null);   // nothing due there
});

test('waitlist: quote, notify, seat, leave; a booked table needs force', { skip }, async () => {
  const add = async (name, extra = {}) => (await A.call(rv.waitlistAdd, { body: { guest_name: name, party_size: 2, ...extra } }));
  assert.equal((await add('')).code, 400);
  const w1 = (await add('Walk One')).body.data;
  const w2 = (await add('Walk Two')).body.data;
  assert.equal(w1.quoted_wait_min, 10);
  assert.equal(w2.quoted_wait_min, 20);
  assert.equal((await add('Walk Three', { quoted_wait_min: 5 })).body.data.quoted_wait_min, 5);

  const list = (await A.call(rv.waitlist)).body.data;
  assert.deepEqual(list.map((w) => w.guest_name), ['Walk One', 'Walk Two', 'Walk Three']);
  assert.equal(list[0].waited_min, 0);

  const notified = await A.call(rv.waitlistNotify, { params: { id: w1.entry_id } });
  assert.equal(notified.body.data.status, 'NOTIFIED');

  const free = await A.table('W1', 4);
  const booked = await A.table('W2', 4);
  await A.call(rv.create, { body: { guest_name: 'Booked', party_size: 2, reserved_at: inMin(30), table_id: booked } });
  const held = await A.call(rv.waitlistSeat, { params: { id: w1.entry_id }, body: { table_id: booked } });
  assert.equal(held.code, 409);
  assert.match(held.body.message, /reserved within the next hour/);
  assert.equal((await A.call(rv.waitlistSeat, { params: { id: w1.entry_id }, body: { table_id: booked, force: true } })).code, 200);
  assert.equal((await A.call(rv.waitlistSeat, { params: { id: w1.entry_id }, body: { table_id: free } })).code, 409);   // already seated

  assert.equal((await A.call(rv.waitlistSeat, { params: { id: w2.entry_id }, body: { table_id: free } })).code, 200);
  assert.equal((await A.call(rv.waitlistLeave, { params: { id: w2.entry_id } })).code, 409);                            // seated, not waiting
  const remaining = (await A.call(rv.waitlist)).body.data.map((w) => w.guest_name);
  assert.deepEqual(remaining, ['Walk Three']);
  assert.equal((await A.call(rv.waitlistLeave, { params: { id: (await A.call(rv.waitlist)).body.data[0].entry_id } })).code, 200);
  assert.equal((await B.call(rv.waitlistLeave, { params: { id: w1.entry_id } })).code, 404);                            // another business
});
