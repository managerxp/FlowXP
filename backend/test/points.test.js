/*
 * Loyalty points and tiers: earning, tiers, spending as a discount, and what cancelling or crediting a bill does.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const invoices = await import('../src/controllers/invoices.controller.js');
const notes = await import('../src/controllers/creditNotes.controller.js');
const points = await import('../src/controllers/points.controller.js');
const loyalty = await import('../src/controllers/loyalty.controller.js');
const { tierFor, earnFor, redemption, PointsError } = await import('../src/modules/points.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

/* ── pure ───────────────────────────────────────────────────────────────── */

const cfg = {
  program: { earn_per_100: 5, point_value_paise: 100, min_redeem_points: 50, max_redeem_pct: 50 },
  tiers: [{ name: 'Silver', min_points: 0, multiplier: 1 }, { name: 'Gold', min_points: 500, multiplier: 1.5 }, { name: 'Platinum', min_points: 2000, multiplier: 2 }]
};

test('a tier is the highest one the lifetime points reach', () => {
  assert.equal(tierFor(cfg.tiers, 0).current.name, 'Silver');
  assert.equal(tierFor(cfg.tiers, 499).next.name, 'Gold');
  assert.equal(tierFor(cfg.tiers, 500).current.name, 'Gold');
  assert.equal(tierFor(cfg.tiers, 5000).next, null);
  assert.equal(tierFor([], 10).current, null);
});

test('points earned are per Rs 100, times the tier, rounded down', () => {
  assert.equal(earnFor(cfg, { tier: { multiplier: 1 } }, 45000), 22);     // Rs 450 x 5 / 100 = 22.5
  assert.equal(earnFor(cfg, { tier: { multiplier: 1.5 } }, 45000), 33);    // 33.75
  assert.equal(earnFor(cfg, { tier: null }, 9999), 4);                     // just under Rs 100
  assert.equal(earnFor(cfg, { tier: null }, 0), 0);
});

test('spending points has to respect the minimum, the balance and the cap', () => {
  const st = { balance: 300 };
  assert.equal(redemption(cfg, st, 100, 100000), 10000);                   // 100 points x Rs 1
  assert.throws(() => redemption(cfg, st, 10, 100000), /least you can use is 50/);
  assert.throws(() => redemption(cfg, st, 301, 100000), /Only 300 points/);
  assert.throws(() => redemption(cfg, st, 200, 25000), (e) => e instanceof PointsError && /At most 125 points/.test(e.message));   // 50% of Rs 250
  assert.throws(() => redemption(cfg, st, 60.5, 100000), /whole number/);
});

/* ── database ───────────────────────────────────────────────────────────── */

let A; let B;
const makeBusiness = async (label) => {
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [label, `${label}@pts.test`])).rows[0];
  const biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type) VALUES ($1,$2,'RESTAURANT') RETURNING business_id`, [label, user.user_id])).rows[0];
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE) RETURNING branch_id`, [biz.business_id])).rows[0].branch_id;
  const tenant = { businessId: biz.business_id, branchId, scopeBranchId: branchId, role: 'OWNER', permissions: {} };
  const req = (extra = {}) => ({ tenant, auth: { userId: user.user_id }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra });
  const call = async (fn, extra) => { const res = fakeRes(); await fn(req(extra), res); return res; };
  const dish = (await pool.query(`INSERT INTO products (business_id, name, selling_price_paise, track_inventory) VALUES ($1,'Thali',25000,FALSE) RETURNING product_id`, [biz.business_id])).rows[0].product_id;
  const customer = async (name, phone) => (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [biz.business_id, name, phone])).rows[0].customer_id;
  const bill = (customerId, qty = 1, extra = {}) => call(invoices.create, { body: { customer_id: customerId, items: [{ product_id: dish, quantity: qty }], ...extra } });
  const balance = async (customerId) => Number((await pool.query(`SELECT COALESCE(SUM(points),0) AS n FROM points_ledger WHERE customer_id = $1 AND voided_at IS NULL`, [customerId])).rows[0].n);
  return { tenant, biz: biz.business_id, req, call, dish, customer, bill, balance };
};

const PROGRAM = { is_enabled: true, earn_per_100: 5, point_value: 1, min_redeem_points: 50, max_redeem_pct: 50,
  tiers: [{ name: 'Silver', min_points: 0, multiplier: 1 }, { name: 'Gold', min_points: 500, multiplier: 1.5 }] };

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeBusiness('a'); B = await makeBusiness('b');
  A.asha = await A.customer('Asha', '9876543210');
  A.ravi = await A.customer('Ravi', '9876500001');
  B.other = await B.customer('Other', '9000000001');
});

test('with points off a bill earns nothing and asking to spend is refused', { skip }, async () => {
  const res = await A.bill(A.asha);
  assert.equal(res.code, 201);
  assert.equal(res.body.data.loyalty_points, null);
  assert.equal(res.body.data.points_earned, 0);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM points_ledger WHERE business_id = $1`, [A.biz])).rows[0].n, 0);
  const spend = await A.bill(A.asha, 1, { redeem_points: 50 });
  assert.equal(spend.code, 400);
  assert.match(spend.body.message, /not switched on/);
});

test('the owner sets the scheme; bad settings are refused', { skip }, async () => {
  const put = (body) => A.call(points.putProgram, { body });
  assert.equal((await put({ ...PROGRAM, earn_per_100: 0 })).code, 400);
  assert.equal((await put({ ...PROGRAM, max_redeem_pct: 0 })).code, 400);
  assert.equal((await put({ ...PROGRAM, min_redeem_points: 0 })).code, 400);
  assert.match((await put({ ...PROGRAM, tiers: [{ name: 'Gold', min_points: 500, multiplier: 1.5 }] })).body.message, /first tier must start at 0/);
  assert.equal((await put({ ...PROGRAM, tiers: [{ name: 'A', min_points: 0, multiplier: 1 }, { name: 'B', min_points: 0, multiplier: 2 }] })).code, 400);
  assert.equal((await put({ ...PROGRAM, tiers: [{ name: 'A', min_points: 0, multiplier: 0.5 }] })).code, 400);
  const ok = await put(PROGRAM);
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.point_value, 1);
  assert.deepEqual(ok.body.data.tiers.map((t) => t.name), ['Silver', 'Gold']);
  assert.equal((await A.call(points.getProgram)).body.data.is_enabled, true);
  assert.equal((await B.call(points.getProgram)).body.data.is_enabled, false);   // per business
});

test('a bill earns points on what was paid for, and the customer has a card', { skip }, async () => {
  const res = await A.bill(A.asha, 2);                       // Rs 500, GST off
  assert.equal(res.code, 201, JSON.stringify(res.body));
  assert.equal(res.body.data.points_earned, 25);
  assert.deepEqual(res.body.data.loyalty_points, { earned: 25, redeemed: 0, balance: 25, tier: 'Silver' });
  assert.equal(await A.balance(A.asha), 25);

  const card = (await A.call(loyalty.customerCard, { params: { id: A.asha } })).body.data.points;
  assert.equal(card.balance, 25);
  assert.equal(card.tier.name, 'Silver');
  assert.equal(card.next_tier.points_needed, 475);
  assert.equal(card.balance_value, 25);

  const found = (await A.call(loyalty.lookup, { query: { phone: '98765 43210' } })).body.data;
  assert.equal(found.points.balance, 25);
  assert.equal((await A.bill(null, 1)).body.data.loyalty_points, null);   // a walk-in earns nothing
});

test('points can be spent as a discount, capped, and the rest of the bill earns again', { skip }, async () => {
  await A.call(points.adjust, { params: { id: A.asha }, body: { points: 175, note: 'Welcome gift' } });   // 200 now
  assert.equal(await A.balance(A.asha), 200);

  const c = (n, extra) => A.bill(A.asha, n, { redeem_points: 200, ...extra });
  assert.match((await c(1)).body.message, /At most 125 points/);                    // Rs 250 bill: half is 125
  assert.match((await A.bill(A.asha, 2, { redeem_points: 20 })).body.message, /least you can use is 50/);
  assert.match((await A.bill(A.asha, 2, { redeem_points: 5000 })).body.message, /Only 200 points/);
  assert.match((await A.bill(null, 2, { redeem_points: 60 })).body.message, /Choose a customer/);
  assert.equal(await A.balance(A.asha), 200);                                         // refusals took nothing

  const spent = await A.bill(A.asha, 2, { redeem_points: 60 });                      // Rs 500 - Rs 60
  assert.equal(spent.code, 201, JSON.stringify(spent.body));
  assert.equal(spent.body.data.total, 440);
  assert.equal(spent.body.data.points_discount, 60);
  assert.equal(spent.body.data.points_redeemed, 60);
  assert.equal(spent.body.data.points_earned, 22);                                    // on the Rs 440 actually paid
  assert.equal(await A.balance(A.asha), 200 - 60 + 22);
  A.spentInvoice = spent.body.data;
});

test('lifetime points decide the tier, and a higher tier earns faster', { skip }, async () => {
  const before = (await A.call(points.customerPoints, { params: { id: A.asha } })).body.data.points;
  assert.equal(before.tier.name, 'Silver');
  await A.call(points.adjust, { params: { id: A.asha }, body: { points: 400, note: 'Anniversary' } });   // gifts do not count towards a tier
  assert.equal((await A.call(points.customerPoints, { params: { id: A.asha } })).body.data.points.tier.name, 'Silver');

  // earn the tier the honest way: lifetime earned so far is 25 + 22; add a big bill
  A.big = await A.customer('Big Spender', '9876500050');
  const first = await A.bill(A.big, 40);                                              // Rs 10,000 x 5% = 500
  assert.equal(first.body.data.points_earned, 500);
  assert.equal(first.body.data.loyalty_points.tier, 'Gold');
  const next = await A.bill(A.big, 2);                                                // Rs 500 at 1.5x = 37.5 -> 37
  assert.equal(next.body.data.points_earned, 37);

  // spending never demotes
  await A.bill(A.big, 20, { redeem_points: 400 });
  assert.equal((await A.call(points.customerPoints, { params: { id: A.big } })).body.data.points.tier.name, 'Gold');
});

test('cancelling a bill gives back spent points and takes back earned ones', { skip }, async () => {
  const balanceBefore = await A.balance(A.asha);
  const cancelled = await A.call(invoices.cancel, { params: { id: A.spentInvoice.invoice_id }, body: { reason: 'Wrong order' } });
  assert.equal(cancelled.code, 200, JSON.stringify(cancelled.body));
  assert.equal(await A.balance(A.asha), balanceBefore + 60 - 22);
});

test('a credit note takes back a share of the points, never below zero', { skip }, async () => {
  A.cn = await A.customer('Credit Cathy', '9876500060');
  const inv = (await A.bill(A.cn, 4)).body.data;                                      // Rs 1000 -> 50 points
  assert.equal(await A.balance(A.cn), 50);
  const line = (await pool.query(`SELECT item_id FROM invoice_items WHERE invoice_id = $1`, [inv.invoice_id])).rows[0].item_id;
  const one = await A.call(notes.create, { params: { id: inv.invoice_id }, body: { reason: 'Cold food', items: [{ item_id: line, quantity: 1 }] } });
  assert.equal(one.code, 201, JSON.stringify(one.body));
  assert.equal(await A.balance(A.cn), 50 - 13);                                       // a quarter of 50 is 12.5, rounded to 13
  await A.call(notes.create, { params: { id: inv.invoice_id }, body: { reason: 'Rest', items: [{ item_id: line, quantity: 3 }] } });
  assert.equal(await A.balance(A.cn), 0);                                             // all 50 taken back in total

  // spent points are not clawed below zero
  A.cn2 = await A.customer('Spender Sam', '9876500061');
  const bigBill = (await A.bill(A.cn2, 4)).body.data;                                 // earns 50
  await A.bill(A.cn2, 2, { redeem_points: 50 });                                      // spends them (and earns 22)
  const bl = (await pool.query(`SELECT item_id FROM invoice_items WHERE invoice_id = $1`, [bigBill.invoice_id])).rows[0].item_id;
  await A.call(notes.create, { params: { id: bigBill.invoice_id }, body: { reason: 'All of it', items: [{ item_id: bl, quantity: 4 }] } });
  assert.ok((await A.balance(A.cn2)) >= 0);
});

test('two bills spending the same points at once cannot overspend', { skip }, async () => {
  const c = await A.customer('Racer', '9876500070');
  await A.call(points.adjust, { params: { id: c }, body: { points: 60, note: 'seed' } });
  // exactly enough for one bill: what the first earns back (22) is below the 50-point minimum to spend
  const [x, y] = await Promise.all([A.bill(c, 2, { redeem_points: 60 }), A.bill(c, 2, { redeem_points: 60 })]);
  assert.deepEqual([x.code, y.code].sort(), [201, 400], JSON.stringify([x.body, y.body]));
  assert.ok((await A.balance(c)) >= 0);
});

test('manual adjustments need a reason, stay above zero and are per business', { skip }, async () => {
  const adj = (id, body, who = A) => who.call(points.adjust, { params: { id }, body });
  assert.equal((await adj(A.ravi, { points: 10 })).code, 400);                       // no note
  assert.equal((await adj(A.ravi, { points: 0, note: 'x' })).code, 400);
  assert.equal((await adj(A.ravi, { points: -10, note: 'oops' })).code, 409);         // he has none
  assert.equal((await adj(A.ravi, { points: 30, note: 'Compensation' })).body.data.balance, 30);
  assert.equal((await adj(A.ravi, { points: -30, note: 'Reverted' })).body.data.balance, 0);
  await B.call(points.putProgram, { body: PROGRAM });
  assert.equal((await adj(A.ravi, { points: 5, note: 'x' }, B)).code, 404);           // B cannot touch A's customer
  assert.equal((await B.call(points.customerPoints, { params: { id: A.asha } })).code, 404);
  const history = (await A.call(points.customerPoints, { params: { id: A.ravi } })).body.data.ledger;
  assert.deepEqual(history.map((h) => h.points), [-30, 30]);
});

test('the summary shows what is owed to customers in points', { skip }, async () => {
  const s = (await A.call(points.summary)).body.data;
  assert.equal(s.enabled, true);
  assert.ok(s.members_with_points >= 3);
  assert.equal(s.liability, s.outstanding_points);                                    // one point is Rs 1
  assert.ok(s.earned_30d > 0 && s.redeemed_30d >= 60);
  assert.ok(s.by_tier.Silver >= 1 && s.by_tier.Gold >= 1);
  assert.equal(s.top[0].balance >= s.top[1].balance, true);
  assert.equal((await B.call(points.summary)).body.data.members_with_points, 0);
});
