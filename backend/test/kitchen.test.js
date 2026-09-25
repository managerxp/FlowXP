/*
 * Kitchen stations, routing snapshots, live tickets with urgency, the pass,
 * and preparation-time performance.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const orders = await import('../src/controllers/orders.controller.js');
const kitchen = await import('../src/controllers/kitchen.controller.js');
const K = await import('../src/modules/kitchen.js');
const S = await import('../src/modules/scans.js');

test.after(cleanup);

/* ── pure ───────────────────────────────────────────────────────────────── */

test('percentiles use the nearest rank and cope with tiny lists', () => {
  assert.equal(K.percentile([], 90), null);
  assert.equal(K.percentile([7], 90), 7);
  assert.equal(K.percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90), 9);
  assert.equal(K.percentile([10, 1, 5], 50), 5);
});

test('a line is ok, then warning at 75% of its time, then late past it', () => {
  assert.equal(K.urgency(5, 20), 'ok');
  assert.equal(K.urgency(15, 20), 'warning');
  assert.equal(K.urgency(20, 20), 'warning');
  assert.equal(K.urgency(21, 20), 'late');
  assert.equal(K.urgency(50, null), 'ok');                 // no expectation, nothing to be late against
});

test('summaries give average, p90 and the share done within the expected time', () => {
  const s = K.summarise([{ prep_minutes: 10, expected_minutes: 15 }, { prep_minutes: 12, expected_minutes: 15 }, { prep_minutes: 20, expected_minutes: 15 }, { prep_minutes: 14, expected_minutes: null }]);
  assert.equal(s.lines, 4);
  assert.equal(s.avg_minutes, 14);
  assert.equal(s.on_time_pct, 66.7);                       // 2 of the 3 lines that had an expectation
  assert.equal(K.summarise([]).avg_minutes, null);
});

test('late alerts: one per order, only once well past the time, worst line described', () => {
  const rows = [
    { order_id: 1, order_number: 'ORD-1', table_name: 'T3', elapsed_minutes: 28, expected_minutes: 18 },
    { order_id: 1, order_number: 'ORD-1', table_name: 'T3', elapsed_minutes: 20, expected_minutes: 10 },
    { order_id: 2, order_number: 'ORD-2', table_name: null, elapsed_minutes: 12, expected_minutes: 10 },     // only 2 over: within grace
    { order_id: 3, order_number: 'ORD-3', table_name: 'T1', elapsed_minutes: 5, expected_minutes: 15 }
  ];
  const alerts = S.lateAlerts(rows);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].title, 'ORD-1 (T3) is running late');
  assert.match(alerts[0].body, /2 items have been in the kitchen for 28 minutes; the slowest was expected in 18\./);
  assert.equal(alerts[0].dedupeKey, 'late:1');
});

/* ── database ───────────────────────────────────────────────────────────── */

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
let A; let B;

const makeBusiness = async (label) => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@k.test`])).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,'RESTAURANT') RETURNING business_id`, [label, user.user_id])).rows[0];
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz.business_id])).rows[0].branch_id;
  const tenant = { businessId: biz.business_id, branchId, role: 'OWNER', permissions: {} };
  const req = (extra = {}) => ({ tenant, auth: { userId: user.user_id }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra });
  const call = async (fn, extra) => { const res = fakeRes(); await fn(req(extra), res); return res; };
  const dish = async (name, price = 10000) => (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise) VALUES ($1,$2,$3) RETURNING product_id`, [biz.business_id, name, price])).rows[0].product_id;
  const table = async (name) => (await pool.query(`INSERT INTO dining_tables (business_id, branch_id, name, qr_token) VALUES ($1,$2,$3,$4) RETURNING table_id`, [biz.business_id, branchId, name, `${label}-${name}-${Math.random()}`])).rows[0].table_id;
  const open = async (tableId, items) => {
    const id = (await call(orders.create, { body: { order_type: 'DINE_IN', table_id: tableId } })).body.data.order_id;
    assert.equal((await call(orders.addItems, { params: { id }, body: { items } })).code, 201);
    return id;
  };
  return { biz: biz.business_id, tenant, req, call, dish, table, open };
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeBusiness('a'); B = await makeBusiness('b');
});

test('stations and routing: created, validated, and scoped to the business', { skip }, async () => {
  A.tandoor = (await A.call(kitchen.createStation, { body: { name: 'Tandoor' } })).body.data.station_id;
  A.curry = (await A.call(kitchen.createStation, { body: { name: 'Curry' } })).body.data.station_id;
  assert.equal((await A.call(kitchen.createStation, { body: { name: 'tandoor' } })).code, 409);          // same name, any case
  assert.equal((await A.call(kitchen.createStation, { body: { name: '  ' } })).code, 400);
  const bStation = (await B.call(kitchen.createStation, { body: { name: 'Tandoor' } })).body.data.station_id;   // another business may reuse a name

  A.naan = await A.dish('Naan'); A.biryani = await A.dish('Biryani', 30000); A.water = await A.dish('Water', 3000);
  let res = await A.call(kitchen.putRouting, { body: { default_prep_minutes: 12, dishes: [
    { product_id: A.naan, station_id: A.tandoor, prep_minutes: 6 },
    { product_id: A.biryani, station_id: A.curry, prep_minutes: 20 }
  ] } });
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal((await A.call(kitchen.putRouting, { body: { dishes: [{ product_id: A.naan, station_id: bStation }] } })).code, 400);   // someone else's station
  assert.equal((await A.call(kitchen.putRouting, { body: { dishes: [{ product_id: A.naan, prep_minutes: 0 }] } })).code, 400);
  assert.equal((await A.call(kitchen.putRouting, { body: { dishes: [{ product_id: 999999, prep_minutes: 5 }] } })).code, 404);
  assert.equal((await B.call(kitchen.putRouting, { body: { dishes: [{ product_id: A.naan, prep_minutes: 5 }] } })).code, 404);          // not B's dish

  res = await A.call(kitchen.getRouting);
  assert.equal(res.body.data.default_prep_minutes, 12);
  assert.deepEqual(res.body.data.dishes.map((d) => [d.name, d.station_id, d.prep_minutes]), [['Biryani', A.curry, 20], ['Naan', A.tandoor, 6], ['Water', null, null]]);
});

test('an ordered line remembers its station and expected time, even if routing changes later', { skip }, async () => {
  A.t1 = await A.table('T1');
  A.order = await A.open(A.t1, [{ product_id: A.naan, quantity: 2 }, { product_id: A.biryani, quantity: 1 }, { product_id: A.water, quantity: 1 }]);
  const lines = (await pool.query(`SELECT description, station_id, expected_minutes FROM order_items WHERE order_id = $1 ORDER BY order_item_id`, [A.order])).rows;
  assert.deepEqual(lines.map((l) => [l.description, l.station_id, l.expected_minutes]), [['Naan', A.tandoor, 6], ['Biryani', A.curry, 20], ['Water', null, 12]]);

  await A.call(kitchen.putRouting, { body: { dishes: [{ product_id: A.naan, station_id: A.curry, prep_minutes: 30 }] } });
  const after = (await pool.query(`SELECT station_id, expected_minutes FROM order_items WHERE order_id = $1 AND description = 'Naan'`, [A.order])).rows[0];
  assert.deepEqual([after.station_id, after.expected_minutes], [A.tandoor, 6]);           // the ticket in the kitchen did not move
  await A.call(kitchen.putRouting, { body: { dishes: [{ product_id: A.naan, station_id: A.tandoor, prep_minutes: 6 }] } });
});

test('sending starts the clock, a rush jumps the queue, and urgency follows the expected time', { skip }, async () => {
  assert.equal((await A.call(kitchen.tickets)).body.data.tickets.length, 0);              // nothing has been sent yet

  A.t2 = await A.table('T2');
  const other = await A.open(A.t2, [{ product_id: A.naan, quantity: 1 }]);
  await A.call(orders.sendKot, { params: { id: A.order }, body: {} });
  await A.call(orders.sendKot, { params: { id: other }, body: { priority: 'RUSH' } });

  let data = (await A.call(kitchen.tickets)).body.data;
  assert.deepEqual(data.tickets.map((t) => [t.table_name, t.priority]), [['T2', 'RUSH'], ['T1', 'NORMAL']]);   // the rush is first despite arriving second
  assert.ok(data.tickets[1].items.every((i) => i.urgency === 'ok' && i.elapsed_minutes === 0));

  // Age the naan past its 6 minutes, and the biryani to just over 75% of its 20.
  await pool.query(`UPDATE order_items SET sent_at = now() - interval '9 minutes' WHERE order_id = $1 AND description = 'Naan'`, [A.order]);
  await pool.query(`UPDATE order_items SET sent_at = now() - interval '16 minutes' WHERE order_id = $1 AND description = 'Biryani'`, [A.order]);
  data = (await A.call(kitchen.tickets)).body.data;
  const t1 = data.tickets.find((t) => t.table_name === 'T1');
  assert.deepEqual(Object.fromEntries(t1.items.map((i) => [i.description, i.urgency])), { Naan: 'late', Biryani: 'warning', Water: 'ok' });

  const chips = Object.fromEntries(data.stations.map((s) => [s.name, [s.making, s.late]]));
  assert.deepEqual(chips, { All: [4, 1], Tandoor: [2, 1], Curry: [1, 0], Unassigned: [1, 0] });   // 4 lines being made (a quantity of 2 is one line), one late, water has no station
});

test('the pass: ready, served and back again stamp the times; cancelled lines stay visible briefly', { skip }, async () => {
  const ids = (await pool.query(`SELECT order_item_id FROM order_items WHERE order_id = $1 AND description = 'Naan'`, [A.order])).rows.map((r) => r.order_item_id);
  assert.equal((await A.call(kitchen.advance, { body: { item_ids: ids, status: 'READY' } })).code, 200);
  let row = (await pool.query(`SELECT status, ready_at, served_at FROM order_items WHERE order_item_id = $1`, [ids[0]])).rows[0];
  assert.equal(row.status, 'READY'); assert.ok(row.ready_at); assert.equal(row.served_at, null);

  await A.call(kitchen.advance, { body: { item_ids: ids, status: 'SERVED' } });
  row = (await pool.query(`SELECT status, served_at FROM order_items WHERE order_item_id = $1`, [ids[0]])).rows[0];
  assert.ok(row.served_at);
  await A.call(kitchen.advance, { body: { item_ids: ids, status: 'PREPARING' } });          // recalled
  row = (await pool.query(`SELECT status, ready_at, served_at FROM order_items WHERE order_item_id = $1`, [ids[0]])).rows[0];
  assert.deepEqual([row.status, row.ready_at, row.served_at], ['PREPARING', null, null]);

  assert.equal((await A.call(kitchen.advance, { body: { item_ids: ids, status: 'CANCELLED' } })).code, 400);
  assert.equal((await B.call(kitchen.advance, { body: { item_ids: ids, status: 'READY' } })).code, 404);   // not B's items

  // Cancelling a line already in the kitchen: the kitchen still sees it for a while, marked cancelled.
  const water = (await pool.query(`SELECT order_item_id FROM order_items WHERE order_id = $1 AND description = 'Water'`, [A.order])).rows[0].order_item_id;
  assert.equal((await A.call(orders.updateItem, { params: { id: A.order, itemId: water }, body: { status: 'CANCELLED' } })).code, 200);
  let t1 = (await A.call(kitchen.tickets)).body.data.tickets.find((t) => t.table_name === 'T1');
  assert.equal(t1.items.find((i) => i.description === 'Water').cancelled, true);
  await pool.query(`UPDATE order_items SET cancelled_at = now() - interval '30 minutes' WHERE order_item_id = $1`, [water]);
  t1 = (await A.call(kitchen.tickets)).body.data.tickets.find((t) => t.table_name === 'T1');
  assert.equal(t1.items.some((i) => i.description === 'Water'), false);
});

test('a guest asking again rushes what is still being made', { skip }, async () => {
  assert.equal((await A.call(kitchen.rush, { params: { id: A.order } })).code, 200);
  const t1 = (await A.call(kitchen.tickets)).body.data.tickets.find((t) => t.table_name === 'T1');
  assert.equal(t1.priority, 'RUSH');
  assert.equal((await B.call(kitchen.rush, { params: { id: A.order } })).code, 404);
});

test('an order billed before the food is out stays on the kitchen screen', { skip }, async () => {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM order_items WHERE order_id = $1 AND status = 'PREPARING'`, [A.order]);
  assert.ok(rows[0].n > 0);
  await pool.query(`UPDATE orders SET status = 'BILLED' WHERE order_id = $1`, [A.order]);
  const t1 = (await A.call(kitchen.tickets)).body.data.tickets.find((t) => t.table_name === 'T1');
  assert.ok(t1 && t1.items.some((i) => i.status === 'PREPARING'));
});

test('performance: averages, on-time share, and how an item compares with the period before', { skip }, async () => {
  const order = (await pool.query(`INSERT INTO orders (business_id, order_number, order_type, status) VALUES ($1,'P-1','DINE_IN','BILLED') RETURNING order_id`, [A.biz])).rows[0].order_id;
  const line = (daysAgo, prepMinutes, expected = 15) => pool.query(
    `INSERT INTO order_items (order_id, product_id, description, quantity, unit_price_paise, status, station_id, expected_minutes, sent_at, ready_at)
     VALUES ($1,$2,'Biryani',1,30000,'SERVED',$3,$4, now() - ($5 || ' days')::interval, now() - ($5 || ' days')::interval + ($6 || ' minutes')::interval)`,
    [order, A.biryani, A.curry, expected, String(daysAgo), String(prepMinutes)]);
  for (const m of [12, 14, 22]) await line(3, m);                  // this period: 12, 14, 22
  for (const m of [8, 8, 8]) await line(20, m);                    // the 14 days before: 8 each

  const res = await A.call(kitchen.performanceReport);
  const d = res.body.data;
  const biryani = d.items.find((i) => i.name === 'Biryani');
  assert.equal(biryani.lines, 3);
  assert.equal(biryani.avg_minutes, 16);
  assert.equal(biryani.on_time_pct, 66.7);
  assert.equal(biryani.previous_avg_minutes, 8);
  assert.equal(biryani.change_minutes, 8);                          // "Biryani went from 8 to 16 minutes"
  assert.equal(d.stations.find((s) => s.name === 'Curry').lines, 3);
  assert.equal(d.previous.avg_minutes, 8);
  assert.ok(d.hours.length >= 1);

  assert.equal((await A.call(kitchen.performanceReport, { query: { from: '2026-01-01', to: '2026-01-02' } })).code, 400);   // too short
  const other = await B.call(kitchen.performanceReport);
  assert.equal(other.body.data.overall.lines, 0);                    // B sees none of A's kitchen
});
