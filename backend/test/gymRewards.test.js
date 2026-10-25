/*
 * Gym rewards, referrals and reminders: points are paid once, for things that really happened, taken back when they are refunded, expire, and cannot be
 * overspent; reminders go out once and only when they should.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addMember, addMembership, addPlan, day, fakeRes, makeGym, until } from './helpers/gym.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const rewards = await import('../src/modules/gym/rewards.js');
const automation = await import('../src/modules/gym/automation.js');
const membersApi = (await import('../src/controllers/gymMembers.controller.js')).default;
const api = (await import('../src/controllers/gymRewards.controller.js')).default;
const invoicesApi = await import('../src/controllers/invoices.controller.js');
const creditNotes = await import('../src/controllers/creditNotes.controller.js');
const router = (await import('../src/routes/gym.routes.js')).default;
const provider = await import('../src/modules/messaging/provider.js');
const { attempt } = await import('../src/modules/gym/access.js');
const { extend } = await import('../src/modules/gym/memberships.js');
const { inTx, localParts } = await import('../src/modules/gym/common.js');

const sent = [];
test.after(async () => { provider.setProvider(null); await cleanup(); });

/* Manual adjustments are stamped by the real clock, so the test day is the real today in Kolkata, at 10:00 local. */
const TODAY = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
const T0 = new Date(`${TODAY}T04:30:00Z`);
const at = (days, hours = 0) => new Date(T0.getTime() + days * 86400000 + hours * 3600000);
const ok = (res, status = 200) => { assert.equal(res.code, status, JSON.stringify(res.body)); return res.body.data; };
const fails = (res, status) => { assert.equal(res.code, status, JSON.stringify(res.body)); return res.body; };
const rules = (g, over) => inTx((db) => rewards.saveRules(db, g.businessId, { is_enabled: true, ...over }));
const bal = async (g, m, now = T0) => rewards.balanceOf(pool, g.businessId, m, (await localParts(pool, g.businessId, now)).date);
const total = (g, m) => rewards.ledgerTotal(pool, g.businessId, m);
const visit = (g, m, now) => attempt({ businessId: g.businessId, branchId: g.branchId, source: 'RECEPTION', memberId: m, confirm: true, now });
const reg = async (g, extra) => ok(await g.call(membersApi.create, { body: extra }), 201);
// payment: null means no payment at the till (the bill is left to be paid later)
const sell = async (g, memberId, planId, payment = { method: 'CASH', amount: 'FULL' }) => ok(await g.call(membersApi.sell, { params: { id: memberId }, body: { plan_id: planId, ...(payment ? { payment } : {}) } }), 201);
const entries = async (g, m) => (await pool.query(`SELECT kind, points, remaining, reason, source_ref FROM gym_points_ledger WHERE business_id = $1 AND member_id = $2 ORDER BY entry_id`, [g.businessId, m])).rows;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  provider.setProvider(async (m) => { sent.push(m); return { status: 'SENT', providerId: 'x' }; });
});

test('rewards start switched off, and nothing is paid until the gym turns them on', { skip }, async () => {
  const G = await makeGym(pool, 'off');
  const m = await addMember(pool, G, { name: 'Off' });
  await addMembership(pool, G, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  assert.equal((await rewards.getRules(pool, G.businessId)).is_enabled, false);
  assert.equal((await visit(G, m, T0)).decision, 'APPROVED');
  assert.equal(await bal(G, m), 0);
  assert.equal((await entries(G, m)).length, 0);
});

test('the rules are validated', { skip }, async () => {
  const G = await makeGym(pool, 'val');
  const tenant = G.tenantFor('OWNER');
  for (const bad of [{ visit_points: -1 }, { visit_points: 5000 }, { milestones: 'x' }, { milestones: [{ visits: 0, points: 5 }] }, { milestones: [{ visits: 5, points: 1 }, { visits: 5, points: 2 }] }, { expiry_days: 0 }, { max_points_per_day: 0 }, { point_value: -1 }]) {
    assert.equal((await G.call(api.putRules, { body: bad }, tenant)).code, 400, JSON.stringify(bad));
  }
  const saved = ok(await G.call(api.putRules, { body: { is_enabled: true, visit_points: 5, milestones: [{ visits: 25, points: 100 }, { visits: 10, points: 50 }], expiry_days: 90, point_value: 0.5 } }, tenant));
  assert.deepEqual(saved.milestones, [{ visits: 10, points: 50 }, { visits: 25, points: 100 }], 'sorted');
  assert.equal(saved.point_value, 0.5);
  assert.equal(ok(await G.call(api.getRules, {}, tenant)).visit_points, 5);
});

test('a visit earns once a day: not a repeat scan, not a refused one, not a second visit the same day', { skip }, async () => {
  const G = await makeGym(pool, 'visit', { settings: { cooldown_seconds: 5 } });
  await rules(G, { visit_points: 10 });
  const m = await addMember(pool, G, { name: 'Visitor' });
  await addMembership(pool, G, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  assert.equal((await visit(G, m, T0)).decision, 'APPROVED');
  assert.equal(await bal(G, m), 10);
  assert.equal((await visit(G, m, new Date(T0.getTime() + 2000))).reason, 'DUPLICATE_SCAN', 'a repeat scan');
  assert.equal(await bal(G, m), 10);
  assert.equal((await visit(G, m, at(0, 3))).decision, 'APPROVED', 'back in the afternoon');
  assert.equal(await bal(G, m), 10, 'the same day pays once');
  assert.equal((await visit(G, m, at(1))).decision, 'APPROVED');
  assert.equal(await bal(G, m, at(1)), 20, 'the next day pays again');

  const lapsed = await addMember(pool, G, { name: 'Lapsed' });
  await addMembership(pool, G, lapsed, { start: day(TODAY, -60), end: day(TODAY, -30) });
  assert.equal((await visit(G, lapsed, T0)).decision, 'DENIED');
  assert.equal(await bal(G, lapsed), 0, 'a refused visit earns nothing');
  const susp = await addMember(pool, G, { name: 'Held', status: 'SUSPENDED' });
  await addMembership(pool, G, susp, { start: day(TODAY, -5), end: day(TODAY, 25) });
  assert.equal((await visit(G, susp, T0)).decision, 'DENIED');
  assert.equal((await entries(G, susp)).length, 0);
});

test('a milestone is paid once when the visit count reaches it; a voided visit does not count', { skip }, async () => {
  const G = await makeGym(pool, 'mile', { settings: { cooldown_seconds: 5 } });
  await rules(G, { visit_points: 1, milestones: [{ visits: 3, points: 50 }, { visits: 5, points: 100 }] });
  const m = await addMember(pool, G, { name: 'Regular' });
  await addMembership(pool, G, m, { start: day(TODAY, -50), end: day(TODAY, 50) });
  for (let d = 0; d < 2; d++) await visit(G, m, at(d));
  assert.equal(await bal(G, m, at(2)), 2, 'two visits: no milestone yet');
  await visit(G, m, at(2));
  assert.equal(await bal(G, m, at(2)), 3 + 50);
  await visit(G, m, at(3)); await visit(G, m, at(4));
  assert.equal(await bal(G, m, at(4)), 5 + 50 + 100);
  await visit(G, m, at(5));
  assert.equal(await bal(G, m, at(5)), 6 + 150, 'no second payment for a milestone already reached');
  const refs = (await entries(G, m)).filter((e) => e.reason === 'MILESTONE').map((e) => e.source_ref).sort();
  assert.deepEqual(refs, ['milestone:3', 'milestone:5']);
});

test('a daily cap trims the day\'s points, and an excluded member earns none', { skip }, async () => {
  const G = await makeGym(pool, 'cap', { settings: { cooldown_seconds: 5 } });
  await rules(G, { visit_points: 30, max_points_per_day: 40, milestones: [{ visits: 1, points: 30 }] });
  const m = await addMember(pool, G, { name: 'Capped' });
  await addMembership(pool, G, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  await visit(G, m, T0);
  assert.equal(await bal(G, m), 40, '30 for the visit, then 10 of the 30 milestone points: 40 in all that day');
  const ex = await addMember(pool, G, { name: 'Excluded' });
  await addMembership(pool, G, ex, { start: day(TODAY, -5), end: day(TODAY, 25) });
  ok(await G.call(api.exclude, { params: { id: ex }, body: { excluded: true } }));
  await visit(G, ex, T0);
  assert.equal(await bal(G, ex), 0);
  ok(await G.call(api.exclude, { params: { id: ex }, body: { excluded: false } }));
  await visit(G, ex, at(1));
  assert.equal(await bal(G, ex, at(1)), 40, 'a visit, and the 10 the cap left of the first-visit milestone');
});

test('a membership earns its points only when it is paid in full, and only once', { skip }, async () => {
  const G = await makeGym(pool, 'sale');
  await rules(G, { visit_points: 0, renewal_flat_points: 100, renewal_points_per_100: 1 });
  const plan = await addPlan(pool, G, { price: 1000, tax: 18 });
  const paid = await reg(G, { name: 'Pays Now', phone: '9500000001' });
  const s1 = await sell(G, paid.member_id, plan);
  assert.equal(await bal(G, paid.member_id), 100 + 10, '100 flat + 1 per ₹100 of the ₹1000 price (not the GST)');

  const later = await reg(G, { name: 'Pays Later', phone: '9500000002' });
  const s2 = await sell(G, later.member_id, plan, null);
  assert.equal(await bal(G, later.member_id), 0, 'unpaid: no points');
  ok(await G.call(invoicesApi.addPayment, { params: { id: s2.invoice.invoice_id }, body: { amount: 500, method: 'CASH' } }), 201);
  assert.equal(await bal(G, later.member_id), 0, 'part paid: still none');
  ok(await G.call(invoicesApi.addPayment, { params: { id: s2.invoice.invoice_id }, body: { amount: 680, method: 'UPI' } }), 201);
  assert.equal(await bal(G, later.member_id), 110, 'paid in full: now');
  // the same completion arriving again (a replayed payment event) pays nothing more
  await inTx((db) => import('../src/modules/gym/memberships.js').then((m) => m.onInvoicePaid(db, { businessId: G.businessId, invoiceId: s2.invoice.invoice_id })));
  await inTx((db) => rewards.awardForMembership(db, { businessId: G.businessId, membershipId: s2.membership_id }));
  assert.equal(await bal(G, later.member_id), 110);
  assert.equal((await entries(G, later.member_id)).length, 1);
  assert.equal(s1.invoice.payment_status, 'PAID');

  const free = await reg(G, { name: 'Comped', phone: '9500000003' });
  const comp = ok(await G.call(membersApi.sell, { params: { id: free.member_id }, body: { plan_id: plan, complimentary: true } }), 201);
  assert.equal(comp.invoice, null);
  assert.equal(await bal(G, free.member_id), 0, 'a free membership is not a purchase');
});

test('a referral pays both people when the new member\'s first membership is paid, and never twice', { skip }, async () => {
  const G = await makeGym(pool, 'ref');
  await rules(G, { visit_points: 0, referral_points: 200, referee_points: 50 });
  const plan = await addPlan(pool, G, { price: 1000 });
  const referrer = await reg(G, { name: 'Referrer', phone: '9500001001' });
  fails(await G.call(membersApi.create, { body: { name: 'Bad Ref', phone: '9500001009', referred_by: 'IRON-99999' } }), 400);
  const friend = await reg(G, { name: 'Friend', phone: '9500001002', referred_by: referrer.member_code });
  const sale = await sell(G, friend.member_id, plan, null);
  assert.equal(await bal(G, referrer.member_id), 0, 'nothing for a promise');
  ok(await G.call(invoicesApi.addPayment, { params: { id: sale.invoice.invoice_id }, body: { amount: 1180, method: 'CASH' } }), 201);
  assert.equal(await bal(G, referrer.member_id), 200);
  assert.equal(await bal(G, friend.member_id), 50);
  // a second membership does not pay a second referral
  await sell(G, friend.member_id, plan);
  assert.equal(await bal(G, referrer.member_id), 200);
  assert.equal(await bal(G, friend.member_id), 50);
  // a member cannot refer themselves into rewards: the friend referring back to the referrer is just another referral
  const other = await reg(G, { name: 'Other', phone: '9500001003', referred_by: String(friend.member_id) });
  await sell(G, other.member_id, plan);
  assert.equal(await bal(G, friend.member_id), 50 + 200, 'the friend is now a referrer');
});

test('a refund takes back what a sale earned, as far as it is unspent, and does it once', { skip }, async () => {
  const G = await makeGym(pool, 'refund');
  await rules(G, { visit_points: 0, renewal_flat_points: 100, referral_points: 100, referee_points: 0 });
  const plan = await addPlan(pool, G, { price: 1000, tax: 0 });
  await inTx((db) => rewards.saveRules(db, G.businessId, { min_redeem_points: 0 }));
  const referrer = await reg(G, { name: 'Referrer', phone: '9500002001' });
  const friend = await reg(G, { name: 'Friend', phone: '9500002002', referred_by: referrer.member_code });
  const sale = await sell(G, friend.member_id, plan);
  assert.equal(await bal(G, friend.member_id), 100);
  assert.equal(await bal(G, referrer.member_id), 100);

  // the friend spends 30 of their 100 first
  await inTx((db) => rewards.adjust(db, { businessId: G.businessId, memberId: friend.member_id, points: -30, reason: 'Took a water bottle', userId: G.userId }));
  const itemId = (await pool.query(`SELECT item_id FROM invoice_items WHERE invoice_id = $1`, [sale.invoice.invoice_id])).rows[0].item_id;
  ok(await G.call(creditNotes.create, { params: { id: sale.invoice.invoice_id }, body: { items: [{ item_id: itemId, quantity: 1 }], reason: 'Changed their mind', refund: { method: 'CASH' } } }), 201);
  assert.equal(await bal(G, friend.member_id), 0, 'only the 70 still unspent could be taken back');
  assert.equal(await bal(G, referrer.member_id), 0, 'and the referral reward goes with the sale');
  for (const m of [friend.member_id, referrer.member_id]) assert.equal(await total(G, m), 0, 'the ledger adds up to the balance');
  // doing it again takes nothing more
  await inTx((db) => rewards.reverseForMembership(db, { businessId: G.businessId, membershipId: sale.membership_id }));
  assert.equal(await bal(G, friend.member_id), 0);
  const rev = (await entries(G, friend.member_id)).filter((e) => e.kind === 'REVERSAL');
  assert.equal(rev.length, 1);
  assert.equal(rev[0].points, -70);

  // cancelling a bill does the same
  const m2 = await reg(G, { name: 'Cancel', phone: '9500002003' });
  const s2 = await sell(G, m2.member_id, plan);
  assert.equal(await bal(G, m2.member_id), 100);
  ok(await G.call(invoicesApi.cancel, { params: { id: s2.invoice.invoice_id }, body: { reason: 'Keyed twice' } }));
  assert.equal(await bal(G, m2.member_id), 0);
});

test('points expire: they leave the balance on their date, cannot be spent, and the ledger still adds up', { skip }, async () => {
  const G = await makeGym(pool, 'expiry', { settings: { cooldown_seconds: 5 } });
  await rules(G, { visit_points: 10, expiry_days: 30 });
  const m = await addMember(pool, G, { name: 'Expiring' });
  await addMembership(pool, G, m, { start: day(TODAY, -5), end: day(TODAY, 300) });
  await visit(G, m, T0);
  await visit(G, m, at(20));
  assert.equal(await bal(G, m, at(20)), 20);
  assert.equal(await bal(G, m, at(30)), 20, 'the first lot runs to the 30th day');
  assert.equal(await bal(G, m, at(31)), 10, 'the first lot has run out: only the second is left');
  assert.equal(await bal(G, m, at(51)), 0);
  const cat = ok(await G.call(api.rewardCreate, { body: { name: 'Shake', points_cost: 10, kind: 'ITEM' } }), 201);
  await assert.rejects(inTx((db) => rewards.redeem(db, { businessId: G.businessId, memberId: m, rewardId: cat.reward_id, userId: G.userId, now: at(60) })), /0 points/, 'expired points cannot be spent');
  // posting the expiry makes the ledger agree with the balance, and doing it twice does nothing
  await inTx((db) => rewards.sweepExpired(db, G.businessId, m, '2026-12-31'));
  await inTx((db) => rewards.sweepExpired(db, G.businessId, m, '2026-12-31'));
  assert.equal(await total(G, m), 0);
  assert.equal((await entries(G, m)).filter((e) => e.kind === 'EXPIRE').length, 2);
});

test('spending uses the oldest points first, and respects stock and the minimum', { skip }, async () => {
  const G = await makeGym(pool, 'spend');
  await rules(G, { visit_points: 0, min_redeem_points: 20 });
  const m = await addMember(pool, G, { name: 'Spender' });
  await addMembership(pool, G, m, { start: day(TODAY, -5), end: day(TODAY, 300) });
  await pool.query(`INSERT INTO gym_points_ledger (business_id, member_id, kind, points, remaining, expires_on, reason, source_type, source_ref) VALUES ($1,$2,'EARN',50,50,'2026-12-01','VISIT','TEST','a'), ($1,$2,'EARN',50,50,'2026-11-01','VISIT','TEST','b'), ($1,$2,'EARN',50,50,NULL,'VISIT','TEST','c')`, [G.businessId, m]);
  const cheap = ok(await G.call(api.rewardCreate, { body: { name: 'Towel', points_cost: 10, kind: 'ITEM' } }), 201);
  const shake = ok(await G.call(api.rewardCreate, { body: { name: 'Shake', points_cost: 60, kind: 'ITEM', stock: 1 } }), 201);
  assert.equal((await G.call(api.redeem, { params: { id: m }, body: { reward_id: cheap.reward_id } })).code, 409, 'below the minimum to spend');
  ok(await G.call(api.redeem, { params: { id: m }, body: { reward_id: shake.reward_id } }), 201);
  const lots = (await pool.query(`SELECT source_ref, remaining FROM gym_points_ledger WHERE member_id = $1 AND kind = 'EARN' ORDER BY source_ref`, [m])).rows;
  assert.deepEqual(lots, [{ source_ref: 'a', remaining: 40 }, { source_ref: 'b', remaining: 0 }, { source_ref: 'c', remaining: 50 }], 'the lot that expires first (November) is used up, then the December one; the lot that never expires is kept for last');
  assert.equal(await bal(G, m), 90);
  assert.equal((await G.call(api.redeem, { params: { id: m }, body: { reward_id: shake.reward_id } })).code, 409, 'out of stock');
  assert.equal((await pool.query(`SELECT stock FROM gym_rewards WHERE reward_id = $1`, [shake.reward_id])).rows[0].stock, 0);
  fails(await G.call(api.redeem, { params: { id: m }, body: { reward_id: 999999 } }), 400);
});

test('five people redeeming for one member at once cannot spend more than they have', { skip }, async () => {
  const G = await makeGym(pool, 'race');
  await rules(G, { visit_points: 0 });
  const m = await addMember(pool, G, { name: 'Racer' });
  await addMembership(pool, G, m, { start: day(TODAY, -5), end: day(TODAY, 300) });
  await inTx((db) => rewards.adjust(db, { businessId: G.businessId, memberId: m, points: 100, reason: 'Starting points', userId: G.userId }));
  const r = ok(await G.call(api.rewardCreate, { body: { name: 'Big prize', points_cost: 60, kind: 'ITEM' } }), 201);
  const results = await Promise.all(Array.from({ length: 5 }, () => G.call(api.redeem, { params: { id: m }, body: { reward_id: r.reward_id } })));
  assert.equal(results.filter((x) => x.code === 201).length, 1, 'exactly one');
  assert.equal(results.filter((x) => x.code === 409).length, 4);
  assert.equal(await bal(G, m), 40);
  assert.equal(await total(G, m), 40);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_reward_redemptions WHERE member_id = $1`, [m])).rows[0].n, 1);
});

test('free days go straight onto the membership; other rewards are handed over, or cancelled to give the points back', { skip }, async () => {
  const G = await makeGym(pool, 'kinds');
  await rules(G, { visit_points: 0 });
  const m = await addMember(pool, G, { name: 'Winner' });
  const ms = await addMembership(pool, G, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  await inTx((db) => rewards.adjust(db, { businessId: G.businessId, memberId: m, points: 300, reason: 'Starting points', userId: G.userId }));
  fails(await G.call(api.rewardCreate, { body: { name: 'Bad free days', points_cost: 10, kind: 'FREE_DAYS', value: 0 } }), 400);
  const days = ok(await G.call(api.rewardCreate, { body: { name: '7 free days', points_cost: 100, kind: 'FREE_DAYS', value: 7 } }), 201);
  const bottle = ok(await G.call(api.rewardCreate, { body: { name: 'Bottle', points_cost: 50, kind: 'ITEM', stock: 3 } }), 201);
  const r1 = ok(await G.call(api.redeem, { params: { id: m }, body: { reward_id: days.reward_id } }), 201);
  assert.equal((await pool.query(`SELECT end_date::text AS e FROM gym_memberships WHERE membership_id = $1`, [ms])).rows[0].e, day(TODAY, 32));
  assert.equal((await pool.query(`SELECT status FROM gym_reward_redemptions WHERE redemption_id = $1`, [r1.redemption_id])).rows[0].status, 'FULFILLED');
  const hist = (await pool.query(`SELECT kind, detail FROM gym_membership_events WHERE membership_id = $1`, [ms])).rows;
  assert.ok(hist.some((h) => h.kind === 'EXTENDED' && /7 free days/.test(h.detail.reason)), 'it is on the membership\'s history');
  fails(await G.call(api.cancelRedemption, { params: { id: r1.redemption_id } }), 409);

  const r2 = ok(await G.call(api.redeem, { params: { id: m }, body: { reward_id: bottle.reward_id } }), 201);
  assert.equal(r2.balance, 150);
  assert.equal((await pool.query(`SELECT stock FROM gym_rewards WHERE reward_id = $1`, [bottle.reward_id])).rows[0].stock, 2);
  assert.equal(ok(await G.call(api.redemptions, { query: { status: 'ISSUED' } })).length, 1);
  const back = ok(await G.call(api.cancelRedemption, { params: { id: r2.redemption_id } }));
  assert.equal(back.returned, 50);
  assert.equal(await bal(G, m), 200);
  assert.equal((await pool.query(`SELECT stock FROM gym_rewards WHERE reward_id = $1`, [bottle.reward_id])).rows[0].stock, 3);
  fails(await G.call(api.cancelRedemption, { params: { id: r2.redemption_id } }), 409);
  const r3 = ok(await G.call(api.redeem, { params: { id: m }, body: { reward_id: bottle.reward_id } }), 201);
  ok(await G.call(api.fulfil, { params: { id: r3.redemption_id }, body: {} }));
  fails(await G.call(api.fulfil, { params: { id: r3.redemption_id }, body: {} }), 409);

  const nobody = await addMember(pool, G, { name: 'No Membership' });
  await inTx((db) => rewards.adjust(db, { businessId: G.businessId, memberId: nobody, points: 200, reason: 'x', userId: G.userId }));
  fails(await G.call(api.redeem, { params: { id: nobody }, body: { reward_id: days.reward_id } }), 409);
  assert.equal(await bal(G, nobody), 200, 'the points were not spent on a reward that could not be given');
});

test('a manual change needs a reason and a manager, and cannot take more than there is', { skip }, async () => {
  const G = await makeGym(pool, 'adj');
  await rules(G, { visit_points: 0 });
  const m = await addMember(pool, G, { name: 'Adjusted' });
  const tenant = G.tenantFor('OWNER');
  fails(await G.call(api.adjust, { params: { id: m }, body: { points: 50 } }, tenant), 400);
  fails(await G.call(api.adjust, { params: { id: m }, body: { points: 0, reason: 'x' } }, tenant), 400);
  fails(await G.call(api.adjust, { params: { id: m }, body: { points: 'lots', reason: 'x' } }, tenant), 400);
  assert.equal(ok(await G.call(api.adjust, { params: { id: m }, body: { points: 80, reason: 'Compensation for the closed week' } }, tenant)).balance, 80);
  fails(await G.call(api.adjust, { params: { id: m }, body: { points: -100, reason: 'Too many' } }, tenant), 409);
  assert.equal(ok(await G.call(api.adjust, { params: { id: m }, body: { points: -30, reason: 'Correction' } }, tenant)).balance, 50);
  const view = ok(await G.call(api.memberPoints, { params: { id: m } }, tenant));
  assert.equal(view.balance, 50);
  assert.deepEqual(view.entries.map((e) => [e.kind, e.points, e.reason]), [['ADJUST', -30, 'MANUAL'], ['EARN', 80, 'MANUAL']]);
  assert.equal(await total(G, m), 50);
  const logged = await until(async () => (await pool.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE business_id = $1 AND action = 'gym.points_adjusted'`, [G.businessId])).rows[0].n >= 2);
  assert.ok(logged);
});

test('another gym sees none of it', { skip }, async () => {
  const A = await makeGym(pool, 'isoA'); const B = await makeGym(pool, 'isoB');
  await rules(A, { visit_points: 0 });
  const m = await addMember(pool, A, { name: 'Mine' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  await inTx((db) => rewards.adjust(db, { businessId: A.businessId, memberId: m, points: 100, reason: 'x', userId: A.userId }));
  const reward = ok(await A.call(api.rewardCreate, { body: { name: 'Prize', points_cost: 10, kind: 'ITEM' } }), 201);
  const red = ok(await A.call(api.redeem, { params: { id: m }, body: { reward_id: reward.reward_id } }), 201);
  for (const [h, extra] of [[api.memberPoints, { params: { id: m } }], [api.adjust, { params: { id: m }, body: { points: 5, reason: 'x' } }], [api.redeem, { params: { id: m }, body: { reward_id: reward.reward_id } }],
    [api.exclude, { params: { id: m }, body: { excluded: true } }], [api.fulfil, { params: { id: red.redemption_id }, body: {} }], [api.cancelRedemption, { params: { id: red.redemption_id } }], [api.rewardUpdate, { params: { id: reward.reward_id }, body: { name: 'x' } }], [api.rewardArchive, { params: { id: reward.reward_id } }]]) {
    fails(await B.call(h, extra, B.tenantFor('OWNER')), 404);
  }
  assert.equal(ok(await B.call(api.catalogue, { query: {} }, B.tenantFor('OWNER'))).length, 0);
  assert.equal(ok(await B.call(api.redemptions, { query: {} }, B.tenantFor('OWNER'))).length, 0);
  // another gym's reward id is "not available", never spendable
  await rules(B, { visit_points: 0 });
  const theirs = await addMember(pool, B, { name: 'Theirs' });
  await addMembership(pool, B, theirs, { start: day(TODAY, -5), end: day(TODAY, 25) });
  await inTx((db) => rewards.adjust(db, { businessId: B.businessId, memberId: theirs, points: 100, reason: 'x', userId: B.userId }));
  fails(await B.call(api.redeem, { params: { id: theirs }, body: { reward_id: reward.reward_id } }, B.tenantFor('OWNER')), 400);
  assert.equal(await bal(B, theirs), 100);
});

test('the liability report is what the ledger says', { skip }, async () => {
  const G = await makeGym(pool, 'liab', { settings: { cooldown_seconds: 5 } });
  await rules(G, { visit_points: 10, expiry_days: 20, point_value: 2 });
  const a = await addMember(pool, G, { name: 'A' }); const b = await addMember(pool, G, { name: 'B' });
  for (const m of [a, b]) await addMembership(pool, G, m, { start: day(TODAY, -5), end: day(TODAY, 300) });
  await visit(G, a, T0); await visit(G, b, T0); await visit(G, a, at(1));
  await inTx((db) => rewards.adjust(db, { businessId: G.businessId, memberId: b, points: 5, reason: 'bonus', userId: G.userId }));
  const r = ok(await G.call(api.liability, { query: { from: TODAY, to: TODAY } }));
  assert.equal(r.outstanding_points, 35);
  assert.equal(r.members_with_points, 2);
  assert.equal(r.liability_paise, 7000);
  assert.equal(r.liability, 70);
  assert.equal(r.expiring_in_30_days, 30, 'the visit points expire within 30 days; the manual ones never do');
  assert.equal(r.earned, 25, 'what was earned today: 10 + 10 + 5');
  const reasons = Object.fromEntries(r.earned_by_reason.map((x) => [x.reason, x.points]));
  assert.deepEqual(reasons, { VISIT: 20, MANUAL: 5 });
});

test('the ledger always adds up to the balance, whatever mix of events happened', { skip }, async () => {
  const G = await makeGym(pool, 'prop', { settings: { cooldown_seconds: 5 } });
  await rules(G, { visit_points: 7, expiry_days: 25, milestones: [{ visits: 3, points: 20 }], max_points_per_day: 60 });
  const m = await addMember(pool, G, { name: 'Mixed' });
  await addMembership(pool, G, m, { start: day(TODAY, -5), end: day(TODAY, 400) });
  const r = ok(await G.call(api.rewardCreate, { body: { name: 'Thing', points_cost: 15, kind: 'ITEM' } }), 201);
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let d = 0; d < 80; d++) {
    const now = at(d);
    const roll = rnd();
    if (roll < 0.5) await visit(G, m, now);
    else if (roll < 0.65) await inTx((db) => rewards.adjust(db, { businessId: G.businessId, memberId: m, points: 10, reason: 'bonus', userId: G.userId, now }));
    else if (roll < 0.85) await inTx((db) => rewards.redeem(db, { businessId: G.businessId, memberId: m, rewardId: r.reward_id, userId: G.userId, now })).catch(() => {});
    else if (roll < 0.9) await inTx((db) => rewards.adjust(db, { businessId: G.businessId, memberId: m, points: -5, reason: 'fix', userId: G.userId, now })).catch(() => {});
    const date = (await localParts(pool, G.businessId, now)).date;
    await inTx((db) => rewards.sweepExpired(db, G.businessId, m, date));
    assert.equal(await total(G, m), await rewards.balanceOf(pool, G.businessId, m, date), `day ${d}: ledger = balance`);
    const lots = Number((await pool.query(`SELECT COALESCE(SUM(remaining),0) AS n FROM gym_points_ledger WHERE member_id = $1 AND kind = 'EARN'`, [m])).rows[0].n);
    assert.equal(lots, await total(G, m), `day ${d}: lots = ledger`);
    assert.ok(await total(G, m) >= 0, 'never negative');
  }
});

/* ── reminders ────────────────────────────────────────────────────────────── */

const messagesTo = (kind) => sent.filter((m) => m.kind === kind);
const channelOn = (g) => pool.query(`UPDATE businesses SET messaging_settings = '{"channel":"SMS"}'::jsonb WHERE business_id = $1`, [g.businessId]);
const on = (g, key, config = {}) => automation.saveAutomation(pool, g.businessId, key, { is_enabled: true, config });

test('a reminder is sent once however often the scan runs, and never to someone who has renewed', { skip }, async () => {
  const G = await makeGym(pool, 'remind');
  await channelOn(G);
  await on(G, 'EXPIRY_REMINDER', { days_before: 7 });
  const ending = await addMember(pool, G, { name: 'Ending Soon', phone: '9600000001' });
  await addMembership(pool, G, ending, { start: day(TODAY, -23), end: day(TODAY, 7), planName: 'Monthly' });
  const renewed = await addMember(pool, G, { name: 'Renewed', phone: '9600000002' });
  await addMembership(pool, G, renewed, { start: day(TODAY, -23), end: day(TODAY, 7) });
  await addMembership(pool, G, renewed, { start: day(TODAY, 8), end: day(TODAY, 38) });
  const notYet = await addMember(pool, G, { name: 'Not Yet', phone: '9600000003' });
  await addMembership(pool, G, notYet, { start: day(TODAY, -20), end: day(TODAY, 10) });
  const before = messagesTo('GYM_EXPIRY').length;
  const n1 = await automation.runBusiness(G.businessId, { now: T0 });
  const n2 = await automation.runBusiness(G.businessId, { now: new Date(T0.getTime() + 600000) });
  const n3 = await automation.runBusiness(G.businessId, { now: new Date(T0.getTime() + 3 * 3600000) });
  await until(() => messagesTo('GYM_EXPIRY').length > before);
  assert.equal(n1, 1);
  assert.equal(n2 + n3, 0, 'the same reminder is not sent again');
  const got = messagesTo('GYM_EXPIRY').slice(before);
  assert.equal(got.length, 1);
  assert.match(got[0].text, /Ending Soon/);
  assert.match(got[0].text, /Monthly membership/);
  assert.equal(got[0].to, '9600000001');
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_message_log WHERE business_id = $1`, [G.businessId])).rows[0].n, 1);
});

test('no reminders without a messaging channel, in the middle of the night, or for people without a phone', { skip }, async () => {
  const G = await makeGym(pool, 'quiet');
  await on(G, 'EXPIRY_REMINDER', { days_before: 7 });
  const m = await addMember(pool, G, { name: 'Quiet Member', phone: '9600001001' });
  await addMembership(pool, G, m, { start: day(TODAY, -23), end: day(TODAY, 7) });
  const before = sent.length;
  assert.equal(await automation.runBusiness(G.businessId, { now: T0 }), 0, 'no channel');
  await channelOn(G);
  assert.equal(await automation.runBusiness(G.businessId, { now: new Date('2026-10-11T20:30:00Z') }), 0, '2 am in Kolkata');
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_message_log WHERE business_id = $1`, [G.businessId])).rows[0].n, 0, 'nothing was claimed, so it goes out later');
  assert.equal(await automation.runBusiness(G.businessId, { now: T0 }), 1, 'in the morning it goes');
  const noPhone = await addMember(pool, G, { name: 'No Phone' });
  await addMembership(pool, G, noPhone, { start: day(TODAY, -23), end: day(TODAY, 7) });
  assert.equal(await automation.runBusiness(G.businessId, { now: new Date(T0.getTime() + 60000) }), 0);
  assert.ok(sent.length >= before);
});

test('payment reminders repeat on a schedule, and "we miss you" only goes to members who agreed to offers', { skip }, async () => {
  const G = await makeGym(pool, 'nudge');
  await channelOn(G);
  await on(G, 'PAYMENT_DUE', { days_overdue: 2, repeat_days: 7 });
  await on(G, 'INACTIVE', { days: 21 });
  const plan = await addPlan(pool, G, { price: 1000, tax: 0 });
  const m = ok(await G.call(membersApi.create, { body: { name: 'Owes Money', phone: '9600002001', consent_marketing: true } }), 201);
  const s = ok(await G.call(membersApi.sell, { params: { id: m.member_id }, body: { plan_id: plan } }), 201);
  await pool.query(`UPDATE gym_memberships SET created_at = $2 WHERE membership_id = $1`, [s.membership_id, new Date(T0.getTime() - 3 * 86400000)]);
  const before = messagesTo('GYM_PAYMENT_DUE').length;
  assert.equal(await automation.runBusiness(G.businessId, { now: T0 }), 1);
  assert.equal(await automation.runBusiness(G.businessId, { now: at(3) }), 0, 'not again inside the week');
  assert.equal(await automation.runBusiness(G.businessId, { now: at(7) }), 1, 'a week later, a second reminder');
  await until(() => messagesTo('GYM_PAYMENT_DUE').length >= before + 2);
  assert.match(messagesTo('GYM_PAYMENT_DUE').at(-1).text, /₹1,000/);

  // inactive: one member agreed to offers, one did not
  const yes = await addMember(pool, G, { name: 'Agreed', phone: '9600002002' });
  const no = await addMember(pool, G, { name: 'Declined', phone: '9600002003' });
  await pool.query(`UPDATE gym_members SET consent_marketing = TRUE, joined_on = $2 WHERE member_id = $1`, [yes, day(TODAY, -40)]);
  await pool.query(`UPDATE gym_members SET joined_on = $2 WHERE member_id = $1`, [no, day(TODAY, -40)]);
  for (const x of [yes, no]) await addMembership(pool, G, x, { start: day(TODAY, -30), end: day(TODAY, 60) });
  const b2 = messagesTo('GYM_INACTIVE').length;
  await automation.runBusiness(G.businessId, { now: at(10) });
  await until(() => messagesTo('GYM_INACTIVE').length > b2);
  const names = messagesTo('GYM_INACTIVE').slice(b2).map((x) => x.text);
  assert.equal(names.length, 1);
  assert.match(names[0], /Agreed/);
});

test('a welcome is sent once after a registration; a birthday pays its points once a year', { skip }, async () => {
  const G = await makeGym(pool, 'welcome');
  await channelOn(G);
  const before = messagesTo('GYM_WELCOME').length;
  const m = ok(await G.call(membersApi.create, { body: { name: 'Newcomer', phone: '9600003001', dob: `1990-${TODAY.slice(5)}` } }), 201);
  await until(() => messagesTo('GYM_WELCOME').length > before);
  assert.match(messagesTo('GYM_WELCOME').at(-1).text, new RegExp(m.member_code));
  await automation.sendWelcome(G.businessId, m.member_id);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(messagesTo('GYM_WELCOME').length, before + 1, 'not twice');

  await rules(G, { visit_points: 0, birthday_points: 100 });
  await automation.runBusiness(G.businessId, { now: T0 });
  assert.equal(await bal(G, m.member_id), 100, 'it is their birthday');
  await automation.runBusiness(G.businessId, { now: new Date(T0.getTime() + 7200000) });
  assert.equal(await bal(G, m.member_id), 100, 'once');
  await automation.runBusiness(G.businessId, { now: new Date(`${Number(TODAY.slice(0, 4)) + 1}-${TODAY.slice(5)}T04:30:00Z`) });
  assert.equal(await bal(G, m.member_id, new Date(`${Number(TODAY.slice(0, 4)) + 1}-${TODAY.slice(5)}T04:30:00Z`)), 200, 'and again next year');
});

test('the reminder settings are checked, and only a manager can change them', { skip }, async () => {
  const G = await makeGym(pool, 'cfg');
  const owner = G.tenantFor('OWNER');
  const list = ok(await G.call(api.automations, {}, owner));
  assert.ok(list.find((a) => a.key === 'WELCOME').is_enabled, 'the welcome is on by default');
  assert.equal(list.find((a) => a.key === 'EXPIRY_REMINDER').is_enabled, false);
  fails(await G.call(api.putAutomation, { params: { key: 'EXPIRY_REMINDER' }, body: { is_enabled: true, config: { days_before: 0 } } }, owner), 400);
  fails(await G.call(api.putAutomation, { params: { key: 'NOPE' }, body: {} }, owner), 404);
  const saved = ok(await G.call(api.putAutomation, { params: { key: 'EXPIRY_REMINDER' }, body: { is_enabled: true, config: { days_before: 10, hacked: 1 } } }, owner));
  assert.deepEqual(saved.config, { days_before: 10 });
});

/* ── routes ───────────────────────────────────────────────────────────────── */

const routes = router.stack.filter((l) => l.route).map((l) => ({ method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path, stack: l.route.stack.map((s) => s.handle) }));
const gate = async (route, t, method = 'GET') => {
  for (const mw of route.stack.slice(2, -1)) {
    const res = fakeRes(); let passed = false;
    await mw({ tenant: t, method, headers: {}, body: {}, get: () => undefined, originalUrl: route.path }, res, () => { passed = true; });
    if (!passed) return res.code;
  }
  return 200;
};
const find = (method, path) => { const r = routes.find((x) => x.method === method && x.path === path); assert.ok(r, `${method} ${path}`); return r; };

test('reward routes: who may do what, and the plan can switch the whole feature off', { skip }, async () => {
  const G = await makeGym(pool, 'gates');
  const as = async (role, method, path, extra) => gate(find(method, path), G.tenantFor(role, extra), method);
  assert.equal(await as('GYM_RECEPTIONIST', 'POST', '/members/:id/redeem'), 200);
  assert.equal(await as('GYM_RECEPTIONIST', 'POST', '/members/:id/points/adjust'), 403, 'the desk cannot change points by hand');
  assert.equal(await as('GYM_RECEPTIONIST', 'PUT', '/rewards/rules'), 403);
  assert.equal(await as('GYM_RECEPTIONIST', 'POST', '/redemptions/:id/cancel'), 403);
  assert.equal(await as('TRAINER', 'POST', '/members/:id/redeem'), 403);
  assert.equal(await as('OWNER', 'PUT', '/rewards/rules'), 200);
  assert.equal(await as('CASHIER', 'GET', '/rewards'), 403);
  assert.equal(await as('GYM_RECEPTIONIST', 'PUT', '/automations/:key'), 403);
  assert.equal(await as('OWNER', 'GET', '/rewards', { planFeatures: { gym_rewards: false } }), 402);
  assert.equal(await as('OWNER', 'POST', '/members/:id/redeem', { planFeatures: { gym_rewards: false } }), 402);
  assert.equal(await as('OWNER', 'GET', '/members', { planFeatures: { gym_rewards: false } }), 200);
});

test('the start-of-month reminder goes once, on the chosen day, to members whose membership ends that month and who have not renewed', { skip }, async () => {
  const G = await makeGym(pool, 'monthstart');
  await channelOn(G);
  await on(G, 'MONTH_START', { day: 1 });
  const first = new Date('2026-12-01T04:30:00Z');          // 10 am on the 1st, Kolkata
  const mk = async (name, phone, start, end, price = 1500) => { const m = await addMember(pool, G, { name, phone }); await addMembership(pool, G, m, { start, end, planName: 'Monthly', price }); return m; };
  await mk('Ends Mid Month', '9600002001', '2026-11-16', '2026-12-15');
  await mk('Ends Month End', '9600002002', '2026-12-01', '2026-12-31');
  await mk('Ended Last Month', '9600002003', '2026-11-01', '2026-11-30');
  await mk('Ends Next Month', '9600002004', '2026-12-10', '2027-01-09');
  const renewed = await mk('Renewed Already', '9600002005', '2026-11-16', '2026-12-15');
  await addMembership(pool, G, renewed, { start: '2026-12-16', end: '2027-01-15', planName: 'Monthly', price: 1500 });
  const before = messagesTo('GYM_MONTH_START').length;
  const n1 = await automation.runBusiness(G.businessId, { now: first });
  const n2 = await automation.runBusiness(G.businessId, { now: new Date(first.getTime() + 3 * 3600000) });
  await until(() => messagesTo('GYM_MONTH_START').length >= before + 2);
  assert.equal(n1, 2); assert.equal(n2, 0, 'the same month is not reminded twice');
  const got = messagesTo('GYM_MONTH_START').slice(before);
  assert.deepEqual(got.map((m) => m.to).sort(), ['9600002001', '9600002002']);
  assert.match(got.find((m) => m.to === '9600002001').text, /Ends Mid Month.*Monthly.*15 Dec 2026.*₹1,500/);
  assert.equal(await automation.runBusiness(G.businessId, { now: new Date('2026-12-02T04:30:00Z') }), 0, 'not on any other day of the month');
  const next = new Date('2027-01-01T04:30:00Z');
  await automation.runBusiness(G.businessId, { now: next });
  await until(() => messagesTo('GYM_MONTH_START').length >= before + 3);
  assert.ok(messagesTo('GYM_MONTH_START').slice(before).some((m) => m.to === '9600002004'), 'next month it is that member\'s turn');
});
