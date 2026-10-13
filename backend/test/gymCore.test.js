/*
 * Gym core: plans, members, the membership lifecycle with real invoices, who may see whom, and the lists and files around them.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addMember, addMembership, addPlan, day, fakeRes, makeGym, until } from './helpers/gym.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const setup = (await import('../src/controllers/gymSetup.controller.js')).default;
const members = (await import('../src/controllers/gymMembers.controller.js')).default;
const access = (await import('../src/controllers/gymAccess.controller.js')).default;
const reports = (await import('../src/controllers/gymReports.controller.js')).default;
const invoicesApi = await import('../src/controllers/invoices.controller.js');
const creditNotes = await import('../src/controllers/creditNotes.controller.js');
const router = (await import('../src/routes/gym.routes.js')).default;
const { localParts } = await import('../src/modules/gym/common.js');
const { attempt } = await import('../src/modules/gym/access.js');

test.after(cleanup);

let A; let B; let TODAY; let tenant; let tenantB; let plan; let familyPlan;

const body = (res) => { assert.ok(res.body, 'a body'); return res.body; };
const okBody = (res, status = 200) => { assert.equal(res.code, status, JSON.stringify(res.body)); assert.equal(res.body.success, true); return res.body.data; };
const fails = (res, status, code) => { assert.equal(res.code, status, JSON.stringify(res.body)); assert.equal(res.body.success, false); if (code) assert.equal(res.body.code, code); return res.body; };
const call = (handler, extra, t = tenant, g = A) => g.call(handler, extra, t);
const register = (extra, t = tenant, g = A) => call(members.create, { body: extra }, t, g);
const sell = async (memberId, input, t = tenant, g = A) => okBody(await call(members.sell, { params: { id: memberId }, body: input }, t, g), 201);
const view = async (memberId, t = tenant, g = A) => okBody(await call(members.get, { params: { id: memberId } }, t, g));
const money = async (invoiceId) => (await pool.query(`SELECT total_paise::int AS total, amount_paid_paise::int AS paid, balance_due_paise::int AS due, status, payment_status FROM invoices WHERE invoice_id = $1`, [invoiceId])).rows[0];

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeGym(pool, 'core', { branches: 2 });
  B = await makeGym(pool, 'coreB');
  TODAY = (await localParts(pool, A.businessId)).date;
  tenant = A.tenantFor('OWNER');
  tenantB = B.tenantFor('OWNER');
});

/* ── plans ────────────────────────────────────────────────────────────────── */

test('a plan: validated, priced, scoped, archived, and another gym cannot touch it', { skip }, async () => {
  fails(await call(setup.planCreate, { body: { name: 'No length', price: 500 } }), 400);
  fails(await call(setup.planCreate, { body: { name: 'Negative', duration_days: 30, price: -5 } }), 400);
  fails(await call(setup.planCreate, { body: { name: 'Family', duration_days: 30, price: 500, audience: 'FAMILY', max_members: 1 } }), 400);
  fails(await call(setup.planCreate, { body: { name: 'Later', duration_days: 30, price: 500, payment_policy: 'PAY_LATER' } }), 400);
  fails(await call(setup.planCreate, { body: { name: 'Pack', duration_days: 30, price: 500, kind: 'PT_PACK' } }), 400, undefined);
  fails(await call(setup.planCreate, { body: { name: 'Other branch', duration_days: 30, price: 500, allowed_branch_ids: [B.branchId] } }), 400);
  fails(await call(setup.planCreate, { body: { name: 'Odd time', duration_days: 30, price: 500, time_window: { from: '06:00' } } }), 400);
  fails(await call(setup.planCreate, { body: { name: 'Odd days', duration_days: 30, price: 500, time_window: { days: [9] } } }), 400);

  const made = okBody(await call(setup.planCreate, { body: { name: 'Monthly', duration_days: 30, price: 1000, tax_rate: 18, grace_days: 2, max_freeze_days: 10 } }), 201);
  assert.equal(made.price_paise, 100000);
  assert.equal(made.price, 1000);
  plan = made.plan_id;
  const fam = okBody(await call(setup.planCreate, { body: { name: 'Family', duration_days: 30, price: 1800, audience: 'FAMILY', max_members: 3 } }), 201);
  familyPlan = fam.plan_id;
  const off = okBody(await call(setup.planCreate, { body: { name: 'Off-peak', duration_days: 90, price: 2000, time_window: { days: [1, 2, 3, 4, 5], from: '06:00', to: '11:00' }, allowed_branch_ids: [A.branchIds[1]] } }), 201);
  assert.deepEqual(off.time_window, { days: [1, 2, 3, 4, 5], from: '06:00', to: '11:00' });
  assert.deepEqual(off.allowed_branch_ids, [A.branchIds[1]]);

  const upd = okBody(await call(setup.planUpdate, { params: { id: plan }, body: { price: 1200 } }));
  assert.equal(upd.price, 1200);
  assert.equal(upd.duration_days, 30, 'what was not sent stays');
  fails(await call(setup.planUpdate, { params: { id: plan }, body: { price: 99 } }, tenantB, B), 404);
  fails(await call(setup.planArchive, { params: { id: plan } }, tenantB, B), 404);
  await call(setup.planUpdate, { params: { id: plan }, body: { price: 1000 } });

  const list = okBody(await call(setup.plans, { query: {} }));
  assert.equal(list.length, 3);
  okBody(await call(setup.planArchive, { params: { id: familyPlan } }));
  assert.equal(okBody(await call(setup.plans, { query: {} })).length, 2, 'archived plans leave the list');
  assert.equal(okBody(await call(setup.plans, { query: { all: 'true' } })).length, 3);
  okBody(await call(setup.planRestore, { params: { id: familyPlan } }));
  assert.equal(okBody(await call(setup.plans, { query: {} }, tenantB, B)).length, 0, 'the other gym sees none of them');
});

/* ── members ──────────────────────────────────────────────────────────────── */

let asha; let walkIn;

test('registering a member: a code, a customer, a duplicate check, a shared phone for a dependent, and a walk-in reused', { skip }, async () => {
  fails(await register({ name: '', phone: '9876500001' }), 400);
  fails(await register({ name: 'No phone' }), 400);
  fails(await register({ name: 'Bad phone', phone: 'abc' }), 400);
  fails(await register({ name: 'Bad mail', phone: '9876500009', email: 'nope' }), 400);
  fails(await register({ name: 'Future', phone: '9876500008', dob: '2999-01-01' }), 400);

  const first = okBody(await register({ name: 'Asha Rao', phone: '+91 98765 00001', email: 'asha@example.com', dob: '1992-04-03', gender: 'FEMALE', emergency_name: 'Ravi', emergency_phone: '9876500099', consent_data: true, consent_marketing: false }), 201);
  asha = first.member_id;
  assert.equal(first.member_code, 'GYM-00001');
  assert.equal(first.name, 'Asha Rao');
  assert.ok(first.consent_data_at, 'consent is dated');
  const cust = (await pool.query(`SELECT marketing_opt_out FROM customers WHERE customer_id = $1`, [first.customer_id])).rows[0];
  assert.equal(cust.marketing_opt_out, true, 'no marketing consent means opted out of promotional messages');

  const dup = fails(await register({ name: 'Asha again', phone: '9876500001' }), 409, 'DUPLICATE_MEMBER');
  assert.equal(dup.data.members[0].member_id, asha, 'and it says who');
  const same = okBody(await register({ name: 'Ravi Rao', phone: '09876500001', confirm_duplicate: true }), 201);
  assert.equal(same.member_code, 'GYM-00002', 'a couple sharing a phone can both join once the desk confirms');

  const dep = okBody(await register({ name: 'Kid Rao', head_member_id: asha }), 201);
  assert.equal(dep.head.member_id, asha);
  fails(await register({ name: 'Orphan', head_member_id: 999999 }), 400);
  const dependents = (await view(asha)).dependents;
  assert.equal(dependents.length, 1);

  // someone billed before as a customer, never a member: becomes a member without a second customer record
  walkIn = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Walk In','98765 00777') RETURNING customer_id`, [A.businessId])).rows[0].customer_id;
  const joined = okBody(await register({ name: 'Walk In', phone: '9876500777' }), 201);
  assert.equal(joined.customer_id, walkIn);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM customers WHERE business_id = $1 AND phone ILIKE '%9876500777%' OR phone ILIKE '%98765 00777%'`, [A.businessId])).rows[0].n, 1);
});

test('the restricted health note is only for trainers and managers', { skip }, async () => {
  const desk = A.tenantFor('GYM_RECEPTIONIST');
  const trainer = A.tenantFor('TRAINER');
  const made = okBody(await register({ name: 'Health Test', phone: '9876500123', health_notes: 'Knee surgery 2024' }, desk), 201);
  assert.equal(made.health_notes, undefined, 'not echoed to the desk');
  assert.equal((await pool.query(`SELECT health_notes FROM gym_members WHERE member_id = $1`, [made.member_id])).rows[0].health_notes, null, 'and not saved from the desk either');
  // a trainer-only login sees just the members assigned to them
  fails(await call(members.update, { params: { id: made.member_id }, body: { health_notes: 'x' } }, trainer), 404);
  const coach = (await pool.query(`INSERT INTO gym_trainers (business_id, name, user_id) VALUES ($1,'Coach',$2) RETURNING trainer_id`, [A.businessId, trainer.userId])).rows[0];
  await pool.query(`UPDATE gym_members SET assigned_trainer_id = $2 WHERE member_id = $1`, [made.member_id, coach.trainer_id]);
  okBody(await call(members.update, { params: { id: made.member_id }, body: { health_notes: 'Knee surgery 2024' } }, trainer));
  assert.equal((await view(made.member_id, desk)).health_notes, undefined);
  assert.equal((await view(made.member_id, trainer)).health_notes, 'Knee surgery 2024');
  assert.equal((await view(made.member_id, tenant)).health_notes, 'Knee surgery 2024', 'the owner too');
  // updating something else from the desk leaves the note alone
  okBody(await call(members.update, { params: { id: made.member_id }, body: { company: 'Acme', health_notes: 'overwritten' } }, desk));
  assert.equal((await view(made.member_id, trainer)).health_notes, 'Knee surgery 2024');
});

test('changing a member records what changed, and the phone cannot collide with another member', { skip }, async () => {
  const one = okBody(await register({ name: 'Edit Me', phone: '9876500201' }), 201);
  okBody(await register({ name: 'Other One', phone: '9876500202' }), 201);
  fails(await call(members.update, { params: { id: one.member_id }, body: { phone: '9876500202' } }), 409, 'DUPLICATE_MEMBER');
  const after = okBody(await call(members.update, { params: { id: one.member_id }, body: { name: 'Edited', email: 'e@example.com', emergency_name: 'Mum' } }));
  assert.equal(after.name, 'Edited');
  assert.equal(after.emergency_name, 'Mum');
  const logged = await until(async () => (await pool.query(`SELECT metadata FROM audit_log WHERE business_id = $1 AND action = 'gym.member_updated' AND resource_id = $2`, [A.businessId, String(one.member_id)])).rows[0]);
  assert.ok(logged, 'the change is in the activity log');
  assert.equal(logged.metadata.after.name.to, 'Edited');
});

/* ── selling and the money ────────────────────────────────────────────────── */

test('selling a membership bills it once, with GST, and the dates are inclusive', { skip }, async () => {
  const sold = await sell(asha, { plan_id: plan, payment: { method: 'CASH', amount: 'FULL' } });
  assert.equal(sold.start_date, TODAY);
  assert.equal(sold.end_date, day(TODAY, 29), 'a 30-day membership starting today ends on the 30th day');
  const m = await money(sold.invoice.invoice_id);
  assert.equal(m.total, 118000, '1000 + 18% GST');
  assert.equal(m.paid, 118000);
  assert.equal(m.payment_status, 'PAID');
  const v = (await view(asha)).memberships[0];
  assert.equal(v.state, 'ACTIVE');
  assert.equal(v.payment, 'PAID');
  assert.equal(v.price_paise, 100000, 'the taxable price');
  assert.equal(v.days_left, 29);
  const ev = (await pool.query(`SELECT kind FROM gym_membership_events WHERE membership_id = $1`, [sold.membership_id])).rows;
  assert.deepEqual(ev.map((e) => e.kind), ['SOLD']);
  const r = await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'RECEPTION', memberId: asha, confirm: true });
  assert.equal(r.decision, 'APPROVED', 'and the member can come in');
});

test('a plan\'s own payment rule decides who may come in on an unpaid or part-paid membership', { skip }, async () => {
  const scanMember = async (id) => (await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'RECEPTION', memberId: id, confirm: true })).reason;
  const strict = await addPlan(pool, A, { name: 'Strict', price: 500, tax: 0 });
  const lenient = await addPlan(pool, A, { name: 'Lenient', price: 500, tax: 0, policy: 'ANY_PAYMENT' });
  const later = await addPlan(pool, A, { name: 'Later', price: 500, tax: 0, policy: 'PAY_LATER', payLater: 3 });

  const m1 = okBody(await register({ name: 'Unpaid One', phone: '9876500301' }), 201).member_id;
  const s1 = await sell(m1, { plan_id: strict });
  assert.equal(await scanMember(m1), 'PAYMENT_REQUIRES_ATTENTION', 'nothing paid');
  assert.equal((await view(m1)).memberships[0].payment, 'UNPAID');
  assert.equal((await view(m1)).memberships[0].amount_due, 500);
  // take part payment through the ordinary payment screen
  okBody(await call(invoicesApi.addPayment, { params: { id: s1.invoice.invoice_id }, body: { amount: 200, method: 'CASH' } }), 201);
  assert.equal(await scanMember(m1), 'PAYMENT_REQUIRES_ATTENTION', 'part paid is still not paid for this plan');
  assert.equal((await view(m1)).memberships[0].payment, 'PARTIAL');
  okBody(await call(invoicesApi.addPayment, { params: { id: s1.invoice.invoice_id }, body: { amount: 300, method: 'UPI' } }), 201);
  await pool.query(`DELETE FROM gym_access_events WHERE member_id = $1`, [m1]);
  assert.equal(await scanMember(m1), 'APPROVED', 'paid in full: in, with no second step');

  const m2 = okBody(await register({ name: 'Part Two', phone: '9876500302' }), 201).member_id;
  const s2 = await sell(m2, { plan_id: lenient });
  assert.equal(await scanMember(m2), 'PAYMENT_REQUIRES_ATTENTION');
  await pool.query(`DELETE FROM gym_access_events WHERE member_id = $1`, [m2]);
  okBody(await call(invoicesApi.addPayment, { params: { id: s2.invoice.invoice_id }, body: { amount: 100, method: 'CASH' } }), 201);
  assert.equal(await scanMember(m2), 'APPROVED', 'a part payment is enough for this plan');

  const m3 = okBody(await register({ name: 'Later Three', phone: '9876500303' }), 201).member_id;
  const s3 = await sell(m3, { plan_id: later });
  assert.equal(await scanMember(m3), 'APPROVED', 'inside the pay-later days');
  assert.equal((await view(m3)).memberships[0].payment, 'UNPAID');
  await pool.query(`UPDATE gym_memberships SET pay_later_until = $2 WHERE membership_id = $1`, [s3.membership_id, day(TODAY, -1)]);
  await pool.query(`DELETE FROM gym_access_events WHERE member_id = $1`, [m3]);
  assert.equal(await scanMember(m3), 'PAYMENT_REQUIRES_ATTENTION', 'after them');
});

test('a split payment, a discount, and who may give one', { skip }, async () => {
  const m = okBody(await register({ name: 'Split Pay', phone: '9876500401' }), 201).member_id;
  const desk = A.tenantFor('GYM_RECEPTIONIST');
  fails(await call(members.sell, { params: { id: m }, body: { plan_id: plan, discount: 100 } }, desk), 403);
  fails(await call(members.sell, { params: { id: m }, body: { plan_id: plan, complimentary: true } }, desk), 403);
  const s = await sell(m, { plan_id: plan, discount: 200, payments: [{ method: 'CASH', amount: 300 }, { method: 'UPI', amount: 'REST' }] });
  const mn = await money(s.invoice.invoice_id);
  assert.equal(mn.total, 94400, '(1000 - 200) + 18%');
  assert.equal(mn.paid, 94400);
  const v = (await view(m)).memberships[0];
  assert.equal(v.price_paise, 80000, 'the taxable value after the discount');
  const free = await sell(okBody(await register({ name: 'Free Pass', phone: '9876500402' }), 201).member_id, { plan_id: plan, complimentary: true });
  assert.equal(free.invoice, null);
  const fv = (await pool.query(`SELECT payment_basis FROM gym_memberships WHERE membership_id = $1`, [free.membership_id])).rows[0];
  assert.equal(fv.payment_basis, 'COMPED');
  fails(await call(members.sell, { params: { id: m }, body: { plan_id: 999999 } }), 400);
  fails(await call(members.sell, { params: { id: m }, body: { plan_id: plan, start_date: '2030-01-01' } }), 400);
  fails(await call(members.sell, { params: { id: m }, body: { plan_id: plan, start_date: 'tomorrow' } }), 400);
});

test('a sale that fails leaves neither an invoice nor a membership', { skip }, async () => {
  const m = okBody(await register({ name: 'Failing Sale', phone: '9876500501' }), 201).member_id;
  const before = { inv: (await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`, [A.businessId])).rows[0].n, ms: (await pool.query(`SELECT COUNT(*)::int AS n FROM gym_memberships WHERE business_id = $1`, [A.businessId])).rows[0].n };
  fails(await call(members.sell, { params: { id: m }, body: { plan_id: plan, payment: { method: 'BITCOIN', amount: 'FULL' } } }), 400);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1`, [A.businessId])).rows[0].n, before.inv);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_memberships WHERE business_id = $1`, [A.businessId])).rows[0].n, before.ms);
});

test('renewing starts the day after the current one ends, or today if it has lapsed', { skip }, async () => {
  const m = okBody(await register({ name: 'Renew Me', phone: '9876500601' }), 201).member_id;
  const first = await sell(m, { plan_id: plan, payment: { method: 'CASH', amount: 'FULL' } });
  const r1 = okBody(await call(members.renew, { params: { id: first.membership_id }, body: { plan_id: plan, payment: { method: 'CASH', amount: 'FULL' } } }), 201);
  assert.equal(r1.start_date, day(TODAY, 30));
  assert.equal(r1.end_date, day(TODAY, 59));
  const list = (await view(m)).memberships;
  assert.equal(list.length, 2);
  assert.equal(list.find((x) => x.membership_id === r1.membership_id).state, 'UPCOMING');
  assert.equal(list.find((x) => x.membership_id === r1.membership_id).renewed_from, first.membership_id);
  // let the first lapse long ago and renew it: the new one starts today
  await pool.query(`UPDATE gym_memberships SET start_date = $2, end_date = $3 WHERE membership_id = $1`, [first.membership_id, day(TODAY, -90), day(TODAY, -60)]);
  const r2 = okBody(await call(members.renew, { params: { id: first.membership_id }, body: { plan_id: plan, payment: { method: 'CASH', amount: 'FULL' } } }), 201);
  assert.equal(r2.start_date, TODAY);
  const kinds = (await pool.query(`SELECT kind FROM gym_membership_events WHERE membership_id = $1`, [r2.membership_id])).rows.map((r) => r.kind);
  assert.deepEqual(kinds, ['RENEWED']);
  fails(await call(members.renew, { params: { id: first.membership_id }, body: { plan_id: plan } }, tenantB, B), 404);
});

/* ── freeze, extend, cancel, transfer, change plan ────────────────────────── */

test('a freeze pushes the end date out by the days frozen; ending it early gives the rest back', { skip }, async () => {
  const m = okBody(await register({ name: 'Freezer', phone: '9876500701' }), 201).member_id;
  const s = await sell(m, { plan_id: plan, payment: { method: 'CASH', amount: 'FULL' } });
  const id = s.membership_id;
  fails(await call(members.freeze, { params: { id }, body: { from: day(TODAY, -1), to: day(TODAY, 3) } }), 400);
  fails(await call(members.freeze, { params: { id }, body: { from: day(TODAY, 5), to: day(TODAY, 3) } }), 400);
  fails(await call(members.freeze, { params: { id }, body: { from: day(TODAY, 2), to: day(TODAY, 20) } }), 409);   // plan allows 10 days
  const f = okBody(await call(members.freeze, { params: { id }, body: { from: day(TODAY, 2), to: day(TODAY, 6), reason: 'Travel' } }));
  assert.equal(f.days, 5);
  assert.equal(f.end_date, day(TODAY, 34));
  fails(await call(members.freeze, { params: { id }, body: { from: day(TODAY, 4), to: day(TODAY, 8) } }), 409);   // overlaps
  fails(await call(members.freeze, { params: { id }, body: { from: day(TODAY, 10), to: day(TODAY, 15) } }), 409);   // 5 + 6 > 10
  const ok2 = okBody(await call(members.freeze, { params: { id }, body: { from: day(TODAY, 10), to: day(TODAY, 14) } }));
  assert.equal(ok2.end_date, day(TODAY, 39), 'ten days used, the limit');

  // not frozen yet today: in
  assert.equal((await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'RECEPTION', memberId: m, confirm: true })).decision, 'APPROVED');
  // on a frozen day: refused as frozen
  const inFreeze = new Date(Date.now() + 3 * 86400000);
  const frozen = await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'RECEPTION', memberId: m, confirm: true, now: inFreeze });
  assert.equal(frozen.reason, 'MEMBERSHIP_FROZEN');

  // the second freeze has not started: ending it removes it altogether
  const un = okBody(await call(members.unfreeze, { params: { id } }));
  assert.equal(un.days_returned, 5);
  assert.equal(un.end_date, day(TODAY, 34));
  const left = (await pool.query(`SELECT COUNT(*)::int AS n FROM gym_freezes WHERE membership_id = $1`, [id])).rows[0].n;
  assert.equal(left, 1);
  const kinds = (await pool.query(`SELECT kind FROM gym_membership_events WHERE membership_id = $1 ORDER BY event_id`, [id])).rows.map((r) => r.kind);
  assert.deepEqual(kinds, ['SOLD', 'FROZEN', 'FROZEN', 'UNFROZEN']);
  fails(await call(members.unfreeze, { params: { id } }, tenantB, B), 404);

  // a plan that does not freeze
  const nofreeze = await addPlan(pool, A, { name: 'No freeze', freeze: false });
  const m2 = okBody(await register({ name: 'No Freeze', phone: '9876500702' }), 201).member_id;
  const s2 = await sell(m2, { plan_id: nofreeze, payment: { method: 'CASH', amount: 'FULL' } });
  fails(await call(members.freeze, { params: { id: s2.membership_id }, body: { from: day(TODAY, 1), to: day(TODAY, 2) } }), 409);
});

test('extending adds days; only a manager may; cancelling moves no money', { skip }, async () => {
  const m = okBody(await register({ name: 'Extend', phone: '9876500801' }), 201).member_id;
  const s = await sell(m, { plan_id: plan, payment: { method: 'CASH', amount: 'FULL' } });
  const e = okBody(await call(members.extend, { params: { id: s.membership_id }, body: { days: 7, reason: 'Gym was shut' } }));
  assert.equal(e.end_date, day(TODAY, 36));
  fails(await call(members.extend, { params: { id: s.membership_id }, body: { days: 0 } }), 400);
  fails(await call(members.extend, { params: { id: s.membership_id }, body: { days: 400 } }), 400);
  const c = okBody(await call(members.cancel, { params: { id: s.membership_id }, body: { reason: 'Moved city' } }));
  assert.equal(c.invoice_id, s.invoice.invoice_id);
  assert.equal((await money(s.invoice.invoice_id)).paid, 118000, 'the money is untouched: a refund is a credit note');
  assert.equal((await view(m)).memberships[0].state, 'CANCELLED');
  fails(await call(members.cancel, { params: { id: s.membership_id }, body: {} }), 409);
  fails(await call(members.extend, { params: { id: s.membership_id }, body: { days: 3 } }), 409);
  assert.equal((await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'RECEPTION', memberId: m, confirm: true })).reason, 'MEMBERSHIP_EXPIRED');
});

test('a transfer hands the rest of a membership to someone else and bills nobody again', { skip }, async () => {
  const from = okBody(await register({ name: 'Giver', phone: '9876500901' }), 201).member_id;
  const to = okBody(await register({ name: 'Taker', phone: '9876500902' }), 201).member_id;
  const s = await sell(from, { plan_id: plan, payment: { method: 'CASH', amount: 'FULL' } });
  const t = okBody(await call(members.transfer, { params: { id: s.membership_id }, body: { to_member_id: to } }));
  const gave = (await view(from)).memberships[0];
  assert.equal(gave.state, 'TRANSFERRED');
  const got = (await view(to)).memberships[0];
  assert.equal(got.membership_id, t.membership_id);
  assert.equal(got.start_date, TODAY);
  assert.equal(got.end_date, s.end_date, 'the same end date');
  assert.equal(got.payment, 'CARRIED_OVER');
  assert.equal(got.transferred_from, s.membership_id);
  assert.equal((await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'RECEPTION', memberId: to, confirm: true })).decision, 'APPROVED');
  assert.equal((await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'RECEPTION', memberId: from, confirm: true })).decision, 'DENIED');
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE customer_id = (SELECT customer_id FROM gym_members WHERE member_id = $1)`, [to])).rows[0].n, 0);
  fails(await call(members.transfer, { params: { id: s.membership_id }, body: { to_member_id: to } }), 409);
  const other = okBody(await register({ name: 'Third', phone: '9876500903' }), 201).member_id;
  const s2 = await sell(other, { plan_id: plan, payment: { method: 'CASH', amount: 'FULL' } });
  fails(await call(members.transfer, { params: { id: s2.membership_id }, body: { to_member_id: other } }), 400);
  fails(await call(members.transfer, { params: { id: s2.membership_id }, body: { to_member_id: 999999 } }), 404);
});

test('changing plan credits the unused days against the new plan', { skip }, async () => {
  const m = okBody(await register({ name: 'Upgrader', phone: '9876501001' }), 201).member_id;
  const cheap = await addPlan(pool, A, { name: 'Basic', duration: 30, price: 900, tax: 18 });
  const dear = await addPlan(pool, A, { name: 'Premium', duration: 30, price: 1500, tax: 18 });
  const s = await sell(m, { plan_id: cheap, payment: { method: 'CASH', amount: 'FULL' } });
  // ten days in: 20 of 30 days left, worth 900 * 20/30 = 600
  await pool.query(`UPDATE gym_memberships SET start_date = $2, end_date = $3 WHERE membership_id = $1`, [s.membership_id, day(TODAY, -10), day(TODAY, 19)]);
  const desk = A.tenantFor('GYM_RECEPTIONIST');
  fails(await call(members.changePlan, { params: { id: s.membership_id }, body: { plan_id: dear, discount: 50 } }, desk), 403);
  const c = okBody(await call(members.changePlan, { params: { id: s.membership_id }, body: { plan_id: dear, payment: { method: 'CASH', amount: 'FULL' } } }, desk), 201);
  assert.equal(c.unused_days, 20);
  assert.equal(c.credit_paise, 60000);
  const mn = await money(c.invoice.invoice_id);
  assert.equal(mn.total, 106200, '(1500 - 600) + 18%');
  const list = (await view(m)).memberships;
  assert.equal(list.find((x) => x.membership_id === s.membership_id).state, 'CANCELLED');
  const old = (await pool.query(`SELECT end_date::text AS e, cancel_reason FROM gym_memberships WHERE membership_id = $1`, [s.membership_id])).rows[0];
  assert.equal(old.e, day(TODAY, -1), 'the old one ends yesterday');
  assert.equal(old.cancel_reason, 'Changed plan');
  assert.equal(list.find((x) => x.membership_id === c.membership_id).start_date, TODAY);
  assert.equal(list.filter((x) => x.state === 'ACTIVE').length, 1, 'one running membership, not two');
});

/* ── when the invoice changes under a membership ──────────────────────────── */

test('cancelling the invoice ends the membership; a full credit note does too; a part credit does not', { skip }, async () => {
  const a = okBody(await register({ name: 'Cancelled Bill', phone: '9876501101' }), 201).member_id;
  const sa = await sell(a, { plan_id: plan, payment: { method: 'CASH', amount: 'FULL' } });
  okBody(await call(invoicesApi.cancel, { params: { id: sa.invoice.invoice_id }, body: { reason: 'Keyed wrongly' } }));
  assert.equal((await view(a)).memberships[0].state, 'CANCELLED');
  assert.equal((await view(a)).memberships[0].payment, 'INVOICE_CANCELLED');
  assert.equal((await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'RECEPTION', memberId: a, confirm: true })).decision, 'DENIED');

  const b = okBody(await register({ name: 'Part Refund', phone: '9876501102' }), 201).member_id;
  const sb = await sell(b, { plan_id: plan, payment: { method: 'CASH', amount: 'FULL' } });
  const itemId = (await pool.query(`SELECT item_id FROM invoice_items WHERE invoice_id = $1`, [sb.invoice.invoice_id])).rows[0].item_id;
  // a part credit (a quantity of 0.25 of the one line) leaves the membership running
  const part = await call(creditNotes.create, { params: { id: sb.invoice.invoice_id }, body: { items: [{ item_id: itemId, quantity: 0.25 }], reason: 'Goodwill', refund: { method: 'CASH' } } });
  assert.equal(part.code, 201, JSON.stringify(part.body));
  assert.equal((await view(b)).memberships[0].state, 'ACTIVE');
  assert.equal((await view(b)).memberships[0].payment, 'PAID');
  const full = await call(creditNotes.create, { params: { id: sb.invoice.invoice_id }, body: { items: [{ item_id: itemId, quantity: 0.75 }], reason: 'Refund the rest', refund: { method: 'CASH' } } });
  assert.equal(full.code, 201, JSON.stringify(full.body));
  const v = (await view(b)).memberships[0];
  assert.equal(v.state, 'CANCELLED');
  assert.equal(v.payment, 'REFUNDED');
  const kinds = (await pool.query(`SELECT kind FROM gym_membership_events WHERE membership_id = $1 ORDER BY event_id`, [sb.membership_id])).rows.map((r) => r.kind);
  assert.deepEqual(kinds, ['SOLD', 'REFUNDED']);
});

/* ── who can see whom ─────────────────────────────────────────────────────── */

test('another gym can reach none of this gym\'s members, memberships or credentials', { skip }, async () => {
  const mine = okBody(await register({ name: 'Private Member', phone: '9876501201' }), 201).member_id;
  const s = await sell(mine, { plan_id: plan, payment: { method: 'CASH', amount: 'FULL' } });
  const code = (await pool.query(`SELECT credential_id FROM gym_credentials LIMIT 1`)).rows[0];
  for (const [handler, extra] of [
    [members.get, { params: { id: mine } }], [members.update, { params: { id: mine }, body: { name: 'Hacked' } }], [members.status, { params: { id: mine }, body: { status: 'SUSPENDED' } }],
    [members.sell, { params: { id: mine }, body: { plan_id: plan } }], [members.issueCard, { params: { id: mine }, body: {} }],
    [members.freeze, { params: { id: s.membership_id }, body: { from: TODAY, to: day(TODAY, 1) } }], [members.cancel, { params: { id: s.membership_id }, body: {} }],
    [members.extend, { params: { id: s.membership_id }, body: { days: 5 } }], [members.history, { params: { id: s.membership_id } }],
    [members.transfer, { params: { id: s.membership_id }, body: { to_member_id: mine } }], [members.revokeCredential, { params: { id: code?.credential_id ?? 1 }, body: {} }],
    [access.manual, { body: { member_id: mine, confirm: true } }]
  ]) {
    fails(await call(handler, extra, tenantB, B), 404);
  }
  assert.equal(okBody(await call(members.list, { query: {} }, tenantB, B)).length, 0);
  assert.equal(body(await call(members.list, { query: {} }, tenantB, B)).meta.total, 0);
  const dash = okBody(await call(reports.dashboard, {}, tenantB, B));
  assert.equal(dash.members.ACTIVE, 0);
  assert.equal((await view(mine)).name, 'Private Member', 'and it is untouched');
});

test('a person at one outlet sees that outlet\'s members, not another\'s', { skip }, async () => {
  const [b1, b2] = A.branchIds;
  const here = A.tenantFor('GYM_RECEPTIONIST', { branchId: b1, pinned: true });
  const there = A.tenantFor('GYM_RECEPTIONIST', { branchId: b2, pinned: true });
  const m1 = await addMember(pool, A, { name: 'Branch One Only', branchId: b1 });
  await addMembership(pool, A, m1, { start: day(TODAY, -3), end: day(TODAY, 30), branches: [b1] });
  const m2 = await addMember(pool, A, { name: 'Anywhere Member', branchId: b1 });
  await addMembership(pool, A, m2, { start: day(TODAY, -3), end: day(TODAY, 30), branches: null });
  const names = async (t) => (await call(members.list, { query: { limit: 200 } }, t)).body.data.map((r) => r.name);
  const seenHere = await names(here); const seenThere = await names(there);
  assert.ok(seenHere.includes('Branch One Only') && seenHere.includes('Anywhere Member'));
  assert.ok(!seenThere.includes('Branch One Only'), 'branch 2 does not see branch 1\'s own member');
  assert.ok(seenThere.includes('Anywhere Member'), 'but does see a member whose plan is good at both');
  fails(await call(members.get, { params: { id: m1 } }, there), 404);
  okBody(await call(members.get, { params: { id: m1 } }, here));
  fails(await call(members.update, { params: { id: m1 }, body: { name: 'x' } }, there), 404);
  fails(await call(members.sell, { params: { id: m1 }, body: { plan_id: plan } }, there), 404);
  fails(await call(access.manual, { body: { member_id: m1, confirm: true } }, there), 404);
  const all = (await call(members.list, { query: { limit: 200 } }, A.allOutlets())).body.data.map((r) => r.name);
  assert.ok(all.includes('Branch One Only'), 'the owner sees every outlet');
});

/* ── the list ─────────────────────────────────────────────────────────────── */

test('the member list searches, filters by state, sorts and pages', { skip }, async () => {
  const L = await makeGym(pool, 'list');
  const tL = L.tenantFor('OWNER');
  const today = (await localParts(pool, L.businessId)).date;
  const mk = async (name, phone, ms, last) => {
    const id = await addMember(pool, L, { name, phone });
    if (ms) await addMembership(pool, L, id, ms);
    if (last) await pool.query(`INSERT INTO gym_attendance (business_id, branch_id, member_id, check_in_at, local_date, source) VALUES ($1,$2,$3,$4,$5,'RECEPTION')`, [L.businessId, L.branchId, id, last, last.toISOString().slice(0, 10)]);
    return id;
  };
  await mk('Alice Active', '9000000001', { start: day(today, -5), end: day(today, 60) }, new Date());
  await mk('Bob Expiring', '9000000002', { start: day(today, -25), end: day(today, 4) }, new Date(Date.now() - 20 * 86400000));
  await mk('Cara Expired', '9000000003', { start: day(today, -60), end: day(today, -3) }, null);
  await mk('Dev Upcoming', '9000000004', { start: day(today, 5), end: day(today, 35) }, null);
  await mk('Esha None', '9000000005', null, null);
  const frozen = await mk('Farid Frozen', '9000000006', { start: day(today, -5), end: day(today, 60) }, new Date());
  await pool.query(`INSERT INTO gym_freezes (membership_id, business_id, from_date, to_date) SELECT membership_id, $2, $3, $4 FROM gym_memberships WHERE member_id = $1`, [frozen, L.businessId, today, day(today, 3)]);
  const get = async (query) => (await call(members.list, { query }, tL, L)).body;
  const byState = async (state) => (await get({ state })).data.map((r) => r.name);
  assert.deepEqual(await byState('ACTIVE'), ['Alice Active']);
  assert.deepEqual(await byState('EXPIRING'), ['Bob Expiring']);
  assert.deepEqual(await byState('EXPIRED'), ['Cara Expired']);
  assert.deepEqual(await byState('UPCOMING'), ['Dev Upcoming']);
  assert.deepEqual(await byState('NONE'), ['Esha None']);
  assert.deepEqual(await byState('FROZEN'), ['Farid Frozen']);
  assert.deepEqual((await get({ q: '9000000003' })).data.map((r) => r.name), ['Cara Expired']);
  assert.deepEqual((await get({ q: 'bob' })).data.map((r) => r.name), ['Bob Expiring']);
  assert.equal((await get({ q: '%' })).meta.total, 0, 'a percent sign is searched for, not treated as everything');
  const paged = await get({ limit: 2, offset: 2, sort: 'name' });
  assert.deepEqual(paged.data.map((r) => r.name), ['Cara Expired', 'Dev Upcoming']);
  assert.equal(paged.meta.total, 6);
  assert.equal((await get({ sort: 'expiry' })).data[0].name, 'Cara Expired');
  assert.deepEqual((await get({ inactive_days: 14 })).data.map((r) => r.name), ['Bob Expiring'], 'running memberships with no visit in 14 days');
  assert.equal((await get({ status: 'SUSPENDED' })).meta.total, 0);
});

/* ── status, merge ────────────────────────────────────────────────────────── */

test('suspending stops access; archiving stops every card and cannot be undone; merging moves everything', { skip }, async () => {
  const m = okBody(await register({ name: 'Status Test', phone: '9876501301' }), 201).member_id;
  await sell(m, { plan_id: plan, payment: { method: 'CASH', amount: 'FULL' } });
  const card = okBody(await call(members.issueCard, { params: { id: m }, body: {} }), 201);
  assert.match(card.code, /^FXG1\./);
  okBody(await call(members.status, { params: { id: m }, body: { status: 'SUSPENDED', reason: 'Unpaid fees' } }));
  assert.equal((await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'RECEPTION', code: card.code })).reason, 'MEMBERSHIP_SUSPENDED');
  fails(await call(members.status, { params: { id: m }, body: { status: 'GONE' } }), 400);
  okBody(await call(members.status, { params: { id: m }, body: { status: 'ACTIVE' } }));

  const keep = okBody(await register({ name: 'Keep', phone: '9876501302' }), 201).member_id;
  const dupe = okBody(await register({ name: 'Keep Dupe', phone: '9876501303' }), 201).member_id;
  const ds = await sell(dupe, { plan_id: plan, payment: { method: 'CASH', amount: 'FULL' } });
  const dcard = okBody(await call(members.issueCard, { params: { id: dupe }, body: {} }), 201);
  await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'RECEPTION', code: dcard.code });
  fails(await call(members.merge, { body: { from_member_id: dupe, into_member_id: dupe } }), 400);
  okBody(await call(members.merge, { body: { from_member_id: dupe, into_member_id: keep } }));
  assert.equal((await view(keep)).memberships[0].membership_id, ds.membership_id, 'the membership moved');
  assert.equal((await view(keep)).stats.visits, 1, 'and the visit');
  assert.equal((await view(dupe)).status, 'ARCHIVED');
  assert.equal((await view(dupe)).merged_into, keep);
  assert.equal((await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'RECEPTION', code: dcard.code, now: new Date(Date.now() + 600000) })).reason, 'CREDENTIAL_REVOKED', 'the duplicate\'s card is dead');
  fails(await call(members.merge, { body: { from_member_id: dupe, into_member_id: keep } }), 409);
  fails(await call(members.status, { params: { id: dupe }, body: { status: 'ACTIVE' } }), 409);
  fails(await call(members.merge, { body: { from_member_id: keep, into_member_id: 999999 } }), 404);
});

/* ── files ────────────────────────────────────────────────────────────────── */

test('import checks every row and loads all or none; export defuses spreadsheet formulas', { skip }, async () => {
  const I = await makeGym(pool, 'imp');
  const tI = I.tenantFor('OWNER');
  const rows = [
    { name: 'Row One', phone: '9111100001', email: 'one@example.com' },
    { name: 'Row Two', phone: '9111100002' },
    { name: '', phone: '9111100003' },
    { name: 'No Phone' },
    { name: 'Dup Phone', phone: '9111100001' },
    { name: 'Bad Mail', phone: '9111100005', email: 'nope' }
  ];
  const dry = okBody(await call(members.importCheck, { body: { rows } }, tI, I));
  assert.equal(dry.ok, false);
  assert.deepEqual(dry.problems.map((p) => p.row), [4, 5, 6, 7], 'row numbers as a spreadsheet shows them (the header is row 1)');
  const live = okBody(await call(members.importCheck, { body: { rows, dry_run: false } }, tI, I));
  assert.equal(live.imported, 0, 'a file with a problem loads nothing');
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_members WHERE business_id = $1`, [I.businessId])).rows[0].n, 0);

  const good = [{ name: '=HYPERLINK("http://evil","click")', phone: '9111100011' }, { name: 'Fine, Name', phone: '9111100012' }];
  const done = okBody(await call(members.importCheck, { body: { rows: good, dry_run: false } }, tI, I));
  assert.equal(done.imported, 2);
  const csv = (await call(members.exportCsv, {}, tI, I)).text;
  assert.ok(csv.startsWith('member_code,name,phone'));
  assert.ok(csv.includes(`"'=HYPERLINK(""http://evil"",""click"")"`) || csv.includes(`'=HYPERLINK`), 'the formula is defused with a leading quote');
  assert.ok(!/^=/m.test(csv.split('\n').slice(1).join('\n')), 'no cell starts with =');
  assert.ok(csv.includes('"Fine, Name"'), 'commas are quoted');
  assert.equal(body(await call(members.importCheck, { body: { rows: [] } }, tI, I)).success, false);
  fails(await call(members.importCheck, { body: { rows: Array.from({ length: 2001 }, (_, i) => ({ name: `n${i}`, phone: `9222${String(i).padStart(6, '0')}` })) } }, tI, I), 400);
});

/* ── corrections and the dashboard ────────────────────────────────────────── */

test('a visit can be added or voided only with a reason, and both are on record', { skip }, async () => {
  const m = okBody(await register({ name: 'Visit Fix', phone: '9876501401' }), 201).member_id;
  fails(await call(access.addVisit, { body: { member_id: m } }), 400);
  const added = okBody(await call(access.addVisit, { body: { member_id: m, reason: 'Scanner was down', check_in_at: new Date(Date.now() - 3600000).toISOString() } }), 201);
  const row = (await pool.query(`SELECT source, status, corrected_by, access_event_id FROM gym_attendance WHERE attendance_id = $1`, [added.attendance_id])).rows[0];
  assert.equal(row.corrected_by, A.userId);
  assert.ok(row.access_event_id);
  fails(await call(access.addVisit, { body: { member_id: m, reason: 'Future', check_in_at: new Date(Date.now() + 86400000).toISOString() } }), 400);
  fails(await call(access.correct, { params: { id: added.attendance_id }, body: { void: true } }), 400);
  okBody(await call(access.correct, { params: { id: added.attendance_id }, body: { void: true, reason: 'Entered twice' } }));
  fails(await call(access.correct, { params: { id: added.attendance_id }, body: { void: true, reason: 'again' } }), 409);
  fails(await call(access.correct, { params: { id: added.attendance_id }, body: { void: true, reason: 'x' } }, tenantB, B), 404);
  const days = okBody(await call(access.attendance, { query: { member_id: m } }));
  assert.equal(days.length ?? (await call(access.attendance, { query: { member_id: m } })).body.data.length, 0, 'a voided visit leaves the list');
  const withVoided = (await call(access.attendance, { query: { member_id: m, include_voided: 'true' } })).body.data;
  assert.equal(withVoided[0].status, 'VOIDED');
  assert.equal(withVoided[0].void_reason, 'Entered twice');
  const logged = await until(async () => (await pool.query(`SELECT COUNT(*)::int AS n FROM audit_log WHERE business_id = $1 AND resource_type = 'gym_attendance' AND action IN ('gym.attendance_added','gym.attendance_voided')`, [A.businessId])).rows[0].n >= 2);
  assert.ok(logged, 'both changes are in the activity log');
});

test('the dashboard and reports count what the desk has really recorded', { skip }, async () => {
  const D = await makeGym(pool, 'dash');
  const tD = D.tenantFor('OWNER');
  const today = (await localParts(pool, D.businessId)).date;
  const p = await addPlan(pool, D, { name: 'Dash plan', price: 1000, tax: 0 });
  const mk = async (name, phone) => (await call(members.create, { body: { name, phone } }, tD, D)).body.data.member_id;
  const a = await mk('Dash A', '9333300001'); const b = await mk('Dash B', '9333300002'); await mk('Dash C', '9333300003');
  const sa = okBody(await call(members.sell, { params: { id: a }, body: { plan_id: p, payment: { method: 'CASH', amount: 'FULL' } } }, tD, D), 201);
  okBody(await call(members.sell, { params: { id: b }, body: { plan_id: p } }, tD, D), 201);   // unpaid
  await attempt({ businessId: D.businessId, branchId: D.branchId, source: 'RECEPTION', memberId: a, confirm: true });
  await attempt({ businessId: D.businessId, branchId: D.branchId, source: 'RECEPTION', memberId: b, confirm: true });   // denied: unpaid
  const d = okBody(await call(reports.dashboard, {}, tD, D));
  assert.equal(d.today, today);
  assert.equal(d.members.ACTIVE, 2);
  assert.equal(d.members.NONE, 1);
  assert.equal(d.visits.today, 1);
  assert.equal(d.visits.open_now, 1);
  assert.deepEqual(d.denied_today, [{ reason_code: 'PAYMENT_REQUIRES_ATTENTION', n: 1 }]);
  assert.equal(d.joined_this_month, 3);
  assert.equal(d.sales_this_month.sold, 2);
  assert.equal(d.sales_this_month.sales_paise, 200000);
  assert.equal(d.sales_this_month.due_paise, 100000);
  assert.equal(d.last_7_days.length, 7);
  assert.equal(d.last_7_days.at(-1).visits, 1);
  const att = okBody(await call(reports.attendance, { query: {} }, tD, D));
  assert.equal(att.totals.visits, 1);
  assert.equal(att.by_day.at(-1).visits, 1);
  assert.equal(att.most_frequent[0].name, 'Dash A');
  const mr = okBody(await call(reports.memberships, { query: {} }, tD, D));
  assert.equal(mr.flow.new_sales, 2);
  assert.equal(mr.money.billed_paise, 200000);
  assert.equal(mr.money.outstanding_paise, 100000);
  assert.equal(mr.by_plan[0].plan_name, 'Dash plan');
  await call(members.cancel, { params: { id: sa.membership_id }, body: { reason: 'x' } }, tD, D);
  assert.equal(okBody(await call(reports.memberships, { query: {} }, tD, D)).flow.cancelled, 1);
});

/* ── the route table, with the real permission middleware ─────────────────── */

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

test('every gym route is behind a permission, and each role gets only what it should', { skip }, async () => {
  assert.ok(routes.length > 30, `routes: ${routes.length}`);
  const T = (role) => A.tenantFor(role);
  const can = async (role, method, path) => (await gate(find(method, path), T(role), method)) === 200;
  const table = [
    ['POST', '/access/scan', { OWNER: true, MANAGER: true, GYM_RECEPTIONIST: true, TRAINER: false, CASHIER: false, WAITER: false, STAFF: false }],
    ['POST', '/members', { OWNER: true, MANAGER: true, GYM_RECEPTIONIST: true, TRAINER: false, CASHIER: false }],
    ['GET', '/members', { OWNER: true, GYM_RECEPTIONIST: true, TRAINER: true, CASHIER: false, WAITER: false, ACCOUNTANT: false }],
    ['POST', '/members/:id/memberships', { OWNER: true, GYM_RECEPTIONIST: true, TRAINER: false, CASHIER: false }],
    ['POST', '/plans', { OWNER: true, MANAGER: true, ADMIN: true, GYM_RECEPTIONIST: false, TRAINER: false, CASHIER: false }],
    ['PUT', '/settings', { OWNER: true, MANAGER: true, GYM_RECEPTIONIST: false, TRAINER: false }],
    ['POST', '/memberships/:id/extend', { OWNER: true, GYM_RECEPTIONIST: false }],
    ['POST', '/memberships/:id/cancel', { OWNER: true, GYM_RECEPTIONIST: false }],
    ['POST', '/memberships/:id/freeze', { OWNER: true, GYM_RECEPTIONIST: true }],
    ['POST', '/members/merge', { OWNER: true, GYM_RECEPTIONIST: false }],
    ['POST', '/members/import', { OWNER: true, GYM_RECEPTIONIST: false }],
    ['GET', '/members/export', { OWNER: true, ADMIN: true, GYM_RECEPTIONIST: false, TRAINER: false, ACCOUNTANT: true }],
    ['POST', '/attendance/:id/correct', { OWNER: true, GYM_RECEPTIONIST: false }],
    ['POST', '/credentials/:id/revoke', { OWNER: true, GYM_RECEPTIONIST: true, TRAINER: false }],
    ['GET', '/reports/attendance', { OWNER: true, GYM_RECEPTIONIST: false, ACCOUNTANT: true }],
    ['GET', '/access/events', { OWNER: true, GYM_RECEPTIONIST: true, TRAINER: false }]
  ];
  for (const [method, path, roles] of table) for (const [role, want] of Object.entries(roles)) assert.equal(await can(role, method, path), want, `${role} ${method} ${path}`);
  // a per-person override wins both ways
  assert.equal(await gate(find('POST', '/access/scan'), A.tenantFor('CASHIER', { permissions: { gym_desk: true } }), 'POST'), 200);
  assert.equal(await gate(find('POST', '/access/scan'), A.tenantFor('GYM_RECEPTIONIST', { permissions: { gym_desk: false } }), 'POST'), 403);
  // the plan can switch access control off for a gym (gym_access)
  assert.equal(await gate(find('POST', '/access/scan'), A.tenantFor('OWNER', { planFeatures: { gym_access: false } }), 'POST'), 402, 'the plan does not include it');
  assert.equal(await gate(find('GET', '/members'), A.tenantFor('OWNER', { planFeatures: { gym_access: false } })), 200, 'members still work without it');
});

test('gym routes exist only for a gym', { skip }, async () => {
  const guard = routes.find((r) => r.method === 'GET' && r.path === '/members').stack[2];
  const res = fakeRes(); let passed = false;
  guard({ tenant: { businessType: 'SALON' } }, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.code, 404);
  const ok2 = fakeRes(); let passed2 = false;
  guard({ tenant: { businessType: 'GYM' } }, ok2, () => { passed2 = true; });
  assert.equal(passed2, true);
});
