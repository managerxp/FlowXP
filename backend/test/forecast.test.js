/*
 * Forecast maths (pure) and the endpoints against a business with ten weeks of
 * a perfectly regular weekly pattern, where the right answer is known exactly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const F = await import('../src/modules/forecast.js');
const controller = await import('../src/controllers/forecast.controller.js');

test.after(cleanup);

const dow = (date) => new Date(`${date}T00:00:00Z`).getUTCDay();
const weekly = (start, days, valueOf) => Array.from({ length: days }, (_, i) => { const date = F.addDays(start, i); return { date, value: valueOf(date, i) }; });

test('a regular weekly pattern is predicted exactly, with no spread and high confidence', () => {
  const history = weekly('2026-06-01', 70, (d) => 10 + dow(d) * 5);
  const target = F.addDays('2026-06-01', 70);
  const p = F.predictDay(history, target);
  assert.equal(Math.round(p.predicted * 1000) / 1000, 10 + dow(target) * 5);
  assert.equal(p.low, p.high);
  assert.equal(p.confidence, 'high');
  assert.equal(p.trend, 1);
});

test('an event multiplier scales the prediction and its range', () => {
  const history = weekly('2026-06-01', 70, (d, i) => 100 + (i % 2));
  const target = F.addDays('2026-06-01', 70);
  const plain = F.predictDay(history, target);
  const boosted = F.predictDay(history, target, { multiplier: 1.5 });
  assert.ok(Math.abs(boosted.predicted - plain.predicted * 1.5) < 1e-9);
  assert.ok(Math.abs(boosted.high - boosted.low - (plain.high - plain.low) * 1.5) < 1e-9);
});

test('too little comparable history gives no prediction rather than a guess', () => {
  const history = weekly('2026-06-01', 15, () => 10);            // only two of each weekday
  assert.equal(F.predictDay(history, F.addDays('2026-06-01', 15)), null);
});

test('recent growth lifts the forecast, but only within a sensible cap', () => {
  const history = weekly('2026-06-01', 70, (d, i) => (i >= 56 ? 300 : 100));   // demand tripled in the last two weeks
  const target = F.addDays('2026-06-01', 70);
  const p = F.predictDay(history, target);
  assert.equal(p.trend, 1.15);
  const flat = F.predictDay(weekly('2026-06-01', 70, () => 100), target);
  assert.ok(p.predicted > flat.predicted);
});

test('backtesting a regular pattern shows zero error; a noisy one shows some', () => {
  const regular = weekly('2026-06-01', 70, (d) => 10 + dow(d) * 5);
  assert.equal(F.backtest(regular).mape_pct, 0);
  const noisy = weekly('2026-06-01', 70, (d, i) => 10 + dow(d) * 5 + ((i * 7) % 5));
  const b = F.backtest(noisy);
  assert.ok(b.mape_pct > 0 && b.mape_pct < 60);
  assert.equal(F.backtest(weekly('2026-06-01', 10, () => 5)), null);   // not enough to judge
});

test('stock planning: low stock against a big day orders now, and sizes the purchase', () => {
  const demand = Array(14).fill(27);
  const r = F.planStock({ stock: 8, minStock: 5, demand, sigma: 3, leadDays: 1, coverDays: 3, step: 1 });
  assert.equal(r.status, 'ORDER_NOW');
  assert.equal(Math.round(r.safety_stock * 100) / 100, 4.95);
  assert.equal(r.recommended_qty, 105);                 // 27 x (1 + 3 days) + 4.95 safety - 8 in stock, rounded up
  assert.equal(r.stockout_in_days, 1);
  assert.equal(r.below_static_min, false);              // the old "low stock" rule would say all is well
  assert.equal(r.days_of_cover, 0.3);
});

test('stock planning: soon, and fine', () => {
  const demand = Array(14).fill(27);
  const soon = F.planStock({ stock: 60, demand, sigma: 3, leadDays: 1, step: 1 });
  assert.equal(soon.status, 'ORDER_SOON');
  assert.equal(soon.recommended_qty, 53);
  const fine = F.planStock({ stock: 200, demand, sigma: 3, leadDays: 1, step: 1 });
  assert.equal(fine.status, 'OK');
  assert.equal(fine.recommended_qty, 0);
  assert.equal(fine.stockout_in_days, 8);               // it will run out eventually, just not yet a reason to order
});

test('purchase quantities round up in sensible steps', () => {
  assert.equal(F.stepFor('pc'), 1);
  assert.equal(F.stepFor('kg'), 0.5);
  assert.equal(F.planStock({ stock: 0, demand: Array(14).fill(2.2), sigma: 0, leadDays: 1, step: 0.5 }).recommended_qty, 9);   // 8.8 -> 9.0
});

test('hourly shares are the weekday\'s own pattern and add up to one', () => {
  const rows = []; const start = '2026-06-01';
  for (let i = 0; i < 70; i++) { const date = F.addDays(start, i); rows.push({ date, hour: 13, n: 3 }, { date, hour: 20, n: 7 }); }
  const shares = F.hourShares(rows, F.addDays(start, 70));
  assert.deepEqual(shares.map((s) => s.hour), [13, 20]);
  assert.ok(Math.abs(shares.reduce((s, x) => s + x.share, 0) - 1) < 1e-9);
  assert.ok(Math.abs(shares[1].share - 0.7) < 1e-9);
});

/* ── end to end ─────────────────────────────────────────────────────────── */

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

test('demand and stock forecasts, event uplift, and business scoping', { skip }, async () => {
  await runMigrations(pool);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('o','o@fc.test','x') RETURNING user_id`)).rows[0].user_id;
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ('fc',$1,'RESTAURANT') RETURNING business_id`, [owner])).rows[0].business_id;
  const dish = (await pool.query(`INSERT INTO products (business_id, name, kind, selling_price_paise) VALUES ($1,'Biryani','DISH',10000) RETURNING product_id`, [biz])).rows[0].product_id;
  const mkIngredient = async (name, stock) => (await pool.query(
    `INSERT INTO products (business_id, name, kind, unit, track_inventory, current_stock, purchase_price_paise, lead_time_days) VALUES ($1,$2,'INGREDIENT','kg',TRUE,$3,10000,1) RETURNING product_id`, [biz, name, stock])).rows[0].product_id;
  const low = await mkIngredient('Chicken', 3);
  const plenty = await mkIngredient('Rice', 500);

  // Ten weeks: on a day with weekday w there are (5 + w) orders, each using 0.5 kg of each ingredient.
  const base = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
  await pool.query(
    `INSERT INTO invoices (business_id, invoice_number, invoice_date, total_paise, created_at)
     SELECT $1, 'T-' || d::text || '-' || n, d, 10000, d + time '13:00'
     FROM generate_series(${base} - 70, ${base} - 1, interval '1 day') d, generate_series(1, 12) n
     WHERE n <= 5 + EXTRACT(DOW FROM d)`, [biz]);
  await pool.query(`INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price_paise, line_total_paise) SELECT invoice_id, $2, 'Biryani', 2, 5000, 10000 FROM invoices WHERE business_id = $1`, [biz, dish]);
  for (const id of [low, plenty]) {
    await pool.query(
      `INSERT INTO inventory_transactions (business_id, product_id, transaction_type, quantity, reference_type, reference_id, created_at)
       SELECT $1, $2, 'SALE', -0.5 * (5 + EXTRACT(DOW FROM d)), 'invoice', 1, d + time '13:00'
       FROM generate_series(${base} - 70, ${base} - 1, interval '1 day') d`, [biz, id]);
  }

  const req = (extra = {}) => ({ tenant: { businessId: biz }, auth: { userId: owner }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra });
  let res = fakeRes();
  await controller.demand(req(), res);
  const d = res.body.data;
  const tomorrow = d.daily[0];
  const expectedOrders = 5 + dow(d.focus.date);
  assert.equal(d.is_prediction, true);
  assert.equal(tomorrow.orders.predicted, expectedOrders);
  assert.equal(tomorrow.confidence, 'high');
  assert.equal(d.daily.length, 7);
  assert.equal(d.accuracy.orders.mape_pct, 0);
  assert.equal(d.focus.items[0].name, 'Biryani');
  assert.equal(d.focus.items[0].portions.predicted, expectedOrders * 2);
  assert.ok(Math.abs(d.focus.hourly.reduce((s, h) => s + h.orders, 0) - expectedOrders) < 0.5);

  res = fakeRes();
  await controller.inventory(req(), res);
  const inv = res.body.data;
  const chicken = inv.items.find((i) => i.name === 'Chicken');
  const rice = inv.items.find((i) => i.name === 'Rice');
  assert.equal(chicken.status, 'ORDER_NOW');
  assert.ok(chicken.recommended_qty > 0 && chicken.recommended_qty % 0.5 === 0);
  assert.equal(chicken.tomorrow_need, expectedOrders * 0.5);
  assert.equal(rice.status, 'OK');
  assert.equal(inv.items[0].name, 'Chicken');                              // most urgent first
  assert.equal(inv.by_supplier[0].items[0].name, 'Chicken');
  assert.equal(inv.summary.order_now, 1);

  // A known event lifts that day's forecast.
  const focus = d.focus.date;
  res = fakeRes();
  await controller.addEvent(req({ body: { date: focus, label: 'Match night', uplift_pct: 50 } }), res);
  assert.equal(res.code, 201);
  res = fakeRes();
  await controller.demand(req(), res);
  assert.equal(res.body.data.daily[0].orders.predicted, expectedOrders * 1.5);
  assert.equal(res.body.data.daily[0].events[0].label, 'Match night');

  // Bad input and scoping.
  res = fakeRes();
  await controller.addEvent(req({ body: { date: '2020-01-01', label: 'Past', uplift_pct: 10 } }), res);
  assert.equal(res.code, 400);
  const other = (await pool.query(`INSERT INTO businesses (name, owner_user_id) VALUES ('other',$1) RETURNING business_id`, [owner])).rows[0].business_id;
  res = fakeRes();
  await controller.removeEvent(req({ tenant: { businessId: other }, params: { id: 1 } }), res);
  assert.equal(res.code, 404);
  res = fakeRes();
  await controller.demand(req({ tenant: { businessId: other } }), res);
  assert.ok(res.body.data.daily.every((x) => x.insufficient_data));
});
