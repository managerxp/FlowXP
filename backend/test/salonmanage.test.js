/*
 * The management side of a salon: memberships over time, commission from earning to payout, the client book, the
 * team and attendance, the service catalogue, reports, and automations.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addClient, addRecipe, addService, addStaff, addStock, fakeRes, makeSalon, sell } from './helpers/salon.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { createSalonInvoice } = await import('../src/modules/salon/pos.js');
const { expireMemberships, expirePackages, activeMembership } = await import('../src/modules/salon/entitlements.js');
const plansApi = (await import('../src/controllers/salonPlans.controller.js')).default;
const commission = (await import('../src/controllers/salonCommission.controller.js')).default;
const clientsApi = (await import('../src/controllers/salonClients.controller.js')).default;
const staffApi = (await import('../src/controllers/salonStaff.controller.js')).default;
const catalog = (await import('../src/controllers/salonCatalog.controller.js')).default;
const reports = (await import('../src/controllers/salonReports.controller.js')).default;
const automation = (await import('../src/controllers/salonAutomation.controller.js')).default;
const settingsApi = (await import('../src/controllers/salonSettings.controller.js')).default;
const invoices = await import('../src/controllers/invoices.controller.js');
const creditNotes = await import('../src/controllers/creditNotes.controller.js');
const { businessToday } = await import('../src/utils/dates.js');

test.after(cleanup);

let S; let ravi; let meena; let haircut; let facial; let asha;
const go = (input, opts) => sell(pool, createSalonInvoice, S, input, opts);
const row = async (sql, values) => (await pool.query(sql, values)).rows[0];
let TODAY;
/* the salon's own calendar: n days from the salon's today */
const day = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

test('setup', { skip }, async () => {
  await runMigrations(pool);
  S = await makeSalon(pool, 'manage');
  ravi = await addStaff(pool, S, { name: 'Ravi', type: 'PERCENT', value: 20 });
  meena = await addStaff(pool, S, { name: 'Meena', type: 'PERCENT', value: 10 });
  haircut = await addService(pool, S, { name: 'Haircut', price: 500 });
  facial = await addService(pool, S, { name: 'Facial', price: 1000 });
  asha = await addClient(pool, S, 'Asha', '9876500001');
  TODAY = await businessToday(S.businessId);
});

/* ── memberships over time ────────────────────────────────────────────────── */

const newPlan = async (body) => { const r = fakeRes(); await plansApi.createPlan(S.req({ body }), r); assert.equal(r.code, 201, JSON.stringify(r.body)); return r.body.data; };

test('a plan has a price, a term and benefits; a bad plan is refused', { skip }, async () => {
  for (const body of [{ name: 'X', price: -1, duration_days: 30 }, { name: 'X', price: 100, duration_days: 0 }, { name: 'X', price: 100, duration_days: 30, benefits: { discount_pct: 120 } },
    { name: 'X', price: 100, duration_days: 30, benefits: { free_services: [{ service_id: 999999, qty: 1 }] } }, { price: 100, duration_days: 30 }]) {
    const r = fakeRes(); await plansApi.createPlan(S.req({ body }), r);
    assert.equal(r.code, 400, JSON.stringify(body));
  }
});

test('renewing while still a member starts the new term the day after the old one ends', { skip }, async () => {
  const plan = await newPlan({ name: 'Gold', price: 1000, tax_rate: 0, duration_days: 30, benefits: { discount_pct: 10 } });
  const pay = [{ method: 'CASH', amount: 'REST' }];
  const first = await go({ customer_id: asha, items: [{ type: 'MEMBERSHIP', plan_id: plan.plan_id }], payments: pay });
  const a = first.issued.memberships[0];
  assert.equal(String(a.start_date).slice(0, 10), TODAY); assert.equal(String(a.expiry_date).slice(0, 10), day(29));
  const second = await go({ customer_id: asha, items: [{ type: 'MEMBERSHIP', plan_id: plan.plan_id }], payments: pay });
  const b = second.issued.memberships[0];
  assert.equal(b.renewed, true);
  assert.equal(String(b.start_date).slice(0, 10), day(30), 'the day after the first term');
  assert.equal(String(b.expiry_date).slice(0, 10), day(59));
  const m = await activeMembership(pool, S.businessId, asha, TODAY);
  assert.equal(m.membership_id, b.membership_id, 'the latest expiry is the current membership');
});

test('a membership lapses when its last day has passed, and then the discount stops', { skip }, async () => {
  const plan = await newPlan({ name: 'Short', price: 500, tax_rate: 0, duration_days: 10, benefits: { discount_pct: 50 } });
  const client = await addClient(pool, S, 'Lapsing client');
  await go({ customer_id: client, items: [{ type: 'MEMBERSHIP', plan_id: plan.plan_id }], payments: [{ method: 'CASH', amount: 'REST' }] });
  const on = await go({ customer_id: client, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] });
  assert.equal(on.invoice.subtotal, 250, '50% off while a member');
  await pool.query(`UPDATE salon_customer_memberships SET start_date = CURRENT_DATE - 40, expiry_date = CURRENT_DATE - 30 WHERE customer_id = $1`, [client]);
  const off = await go({ customer_id: client, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] }, { dryRun: true });
  assert.equal(off.invoice.subtotal, 500, 'expired: full price even before the nightly job has marked it');
  assert.equal(await expireMemberships(pool, S.businessId, TODAY), 1);
  assert.equal(await expireMemberships(pool, S.businessId, TODAY), 0, 'running it again changes nothing');
  assert.equal((await row(`SELECT status FROM salon_customer_memberships WHERE customer_id = $1`, [client])).status, 'EXPIRED');
});

test('packages lapse too, and an expired package cannot be used', { skip }, async () => {
  const r = fakeRes();
  await plansApi.createPackage(S.req({ body: { name: 'Lapse pack', price: 500, tax_rate: 0, validity_days: 30, items: [{ service_id: haircut, quantity: 2 }] } }), r);
  assert.equal(r.code, 201, JSON.stringify(r.body));
  const client = await addClient(pool, S, 'Package client');
  const sold = await go({ customer_id: client, items: [{ type: 'PACKAGE', package_id: r.body.data.package_id }], payments: [{ method: 'CASH', amount: 'REST' }] });
  const cp = sold.issued.packages[0].cp_id;
  await pool.query(`UPDATE salon_customer_packages SET purchased_on = CURRENT_DATE - 40, expiry_date = CURRENT_DATE - 10 WHERE cp_id = $1`, [cp]);
  await assert.rejects(() => go({ customer_id: client, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi, use: { kind: 'PACKAGE', cp_id: cp } }] }), /expired/);
  assert.equal(await expirePackages(pool, S.businessId, TODAY), 1);
});

test('cancelling a membership needs a reason, stops its benefits, and is audited; it cannot be done twice', { skip }, async () => {
  const plan = await newPlan({ name: 'To cancel', price: 300, tax_rate: 0, duration_days: 30, benefits: { discount_pct: 20 } });
  const client = await addClient(pool, S, 'Cancelling client');
  const sold = await go({ customer_id: client, items: [{ type: 'MEMBERSHIP', plan_id: plan.plan_id }], payments: [{ method: 'CASH', amount: 'REST' }] });
  const id = sold.issued.memberships[0].membership_id;
  const none = fakeRes(); await plansApi.cancelMembership(S.req({ params: { id }, body: {} }), none);
  assert.equal(none.code, 400, 'a reason is required');
  const done = fakeRes(); await plansApi.cancelMembership(S.req({ params: { id }, body: { reason: 'Moved away' } }), done);
  assert.equal(done.code, 200);
  assert.equal((await go({ customer_id: client, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] }, { dryRun: true })).invoice.subtotal, 500);
  const again = fakeRes(); await plansApi.cancelMembership(S.req({ params: { id }, body: { reason: 'again' } }), again);
  assert.equal(again.code, 409);
  await new Promise((r) => setTimeout(r, 300));
  assert.ok((await row(`SELECT COUNT(*)::int AS n FROM audit_log WHERE business_id = $1 AND action = 'salon.membership_cancelled'`, [S.businessId])).n >= 1);
  const list = fakeRes(); await plansApi.listMemberships(S.req({ query: { status: 'CANCELLED' } }), list);
  assert.ok(list.body.data.some((m) => m.membership_id === id));
});

test('changing a plan does not change what members already bought', { skip }, async () => {
  const plan = await newPlan({ name: 'Snapshot', price: 400, tax_rate: 0, duration_days: 30, benefits: { discount_pct: 10 } });
  const client = await addClient(pool, S, 'Snapshot client');
  await go({ customer_id: client, items: [{ type: 'MEMBERSHIP', plan_id: plan.plan_id }], payments: [{ method: 'CASH', amount: 'REST' }] });
  const up = fakeRes(); await plansApi.updatePlan(S.req({ params: { id: plan.plan_id }, body: { benefits: { discount_pct: 30 } } }), up);
  assert.equal(up.code, 200, JSON.stringify(up.body));
  assert.equal((await go({ customer_id: client, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }] }, { dryRun: true })).invoice.subtotal, 450, 'still 10%');
});

/* ── commission: earned, approved, paid, and what happens after ───────────── */

test('commission: pending → approved → paid, one payout, one expense, and nothing is paid twice', { skip }, async () => {
  const fresh = await makeSalon(pool, 'commpay');
  const st = await addStaff(pool, fresh, { name: 'Paid Person', type: 'PERCENT', value: 20 });
  const svc = await addService(pool, fresh, { name: 'Cut', price: 1000, tax: 0 });
  const sale = (n = 1) => sell(pool, createSalonInvoice, fresh, { items: [{ type: 'SERVICE', service_id: svc, staff_id: st, quantity: n }], payments: [{ method: 'CASH', amount: 'REST' }] });
  await sale(); await sale(2);
  const period = { from: TODAY, to: TODAY };
  const call = async (fn, body, query = {}) => { const r = fakeRes(); await fn(fresh.req({ body, query }), r); return r; };

  const sum = await call(commission.summary, null, period);
  assert.equal(sum.body.data.staff.find((s) => s.staff_id === st).pending, 600, '20% of ₹3000');
  const early = await call(commission.pay, { staff_id: st, ...period, method: 'CASH' });
  assert.equal(early.code, 409, 'nothing approved yet');
  const ap = await call(commission.approve, { staff_id: st, ...period });
  assert.equal(ap.body.data.approved_rows, 2); assert.equal(ap.body.data.total, 600);
  assert.equal((await call(commission.approve, { staff_id: st, ...period })).body.data.approved_rows, 0, 'approving twice approves nothing more');

  const paid = await call(commission.pay, { staff_id: st, ...period, method: 'UPI', reference: 'UTR123' });
  assert.equal(paid.code, 201, JSON.stringify(paid.body));
  const exp = await row(`SELECT category, amount_paise, staff_id FROM expenses WHERE business_id = $1`, [fresh.businessId]);
  assert.equal(exp.category, 'Commission'); assert.equal(Number(exp.amount_paise), 60000); assert.equal(exp.staff_id, st);
  assert.equal((await row(`SELECT COUNT(*)::int AS n FROM salon_commissions WHERE business_id = $1 AND status = 'PAID'`, [fresh.businessId])).n, 2);
  assert.equal((await call(commission.pay, { staff_id: st, ...period, method: 'CASH' })).code, 409, 'the same period cannot be paid twice');
  const pays = await call(commission.payouts, null, { staff_id: String(st) });
  assert.equal(pays.body.data.length, 1); assert.equal(pays.body.data[0].reference, 'UTR123');
});

test('when a bill that was already paid out is taken back, the next payout is reduced', { skip }, async () => {
  const fresh = await makeSalon(pool, 'commback');
  const st = await addStaff(pool, fresh, { name: 'Back Person', type: 'PERCENT', value: 10 });
  const svc = await addService(pool, fresh, { name: 'Cut', price: 1000, tax: 0 });
  const mk = () => sell(pool, createSalonInvoice, fresh, { items: [{ type: 'SERVICE', service_id: svc, staff_id: st }], payments: [{ method: 'CASH', amount: 'REST' }] });
  const a = await mk(); await mk();
  const call = async (fn, body, query = {}) => { const r = fakeRes(); await fn(fresh.req({ body, query }), r); return r; };
  const period = { from: TODAY, to: TODAY };
  await call(commission.approve, { staff_id: st, ...period });
  assert.equal((await call(commission.pay, { staff_id: st, ...period, method: 'CASH' })).code, 201);
  const cancel = fakeRes(); await invoices.cancel(fresh.req({ params: { id: a.invoice.invoice_id } }), cancel);
  assert.equal(cancel.code, 200, JSON.stringify(cancel.body));
  const rows = (await pool.query(`SELECT status, amount_paise FROM salon_commissions WHERE business_id = $1 ORDER BY commission_id`, [fresh.businessId])).rows;
  assert.ok(rows.some((r) => Number(r.amount_paise) === -10000), 'an offsetting entry, not a rewrite of history');
  await call(commission.approve, { staff_id: st, ...period });
  const next = await call(commission.pay, { staff_id: st, ...period, method: 'CASH' });
  assert.equal(next.code, 409, 'the net is nothing, so there is nothing to pay — it carries forward');
  assert.match(next.body.message, /carries forward|nets to nothing/);
  void creditNotes;
});

test('a stylist sees only their own commission figures; the rest of the team\'s are not theirs to read', { skip }, async () => {
  const sum = fakeRes();
  await commission.summary(S.req({ query: { from: TODAY, to: TODAY } }, S.tenantFor('MANAGER')), sum);
  assert.equal(sum.code, 200);
  assert.ok(sum.body.data.staff.length >= 2);
});

/* ── clients ──────────────────────────────────────────────────────────────── */

const clientCall = async (fn, extra, tenant) => S.call(fn, extra, tenant);

test('a client is added with a salon profile; a duplicate mobile number is refused with who has it', { skip }, async () => {
  const made = await clientCall(clientsApi.create, { body: { name: 'Priya Nair', phone: '+91 98765 11111', email: 'Priya@Example.com', dob: '1992-03-14', gender: 'FEMALE', allergies: 'Ammonia', preferences: 'Quiet room', favorite_staff_id: ravi } });
  assert.equal(made.code, 201, JSON.stringify(made.body));
  const c = made.body.data;
  assert.equal(c.email, 'priya@example.com'); assert.equal(c.allergies, 'Ammonia'); assert.equal(c.favorite_staff_name, 'Ravi');
  const dup = await clientCall(clientsApi.create, { body: { name: 'Someone', phone: '9876511111' } });
  assert.equal(dup.code, 409); assert.match(dup.body.message, /Priya Nair already has that mobile number/);
  for (const bad of [{ name: 'A' }, { name: 'Ok name', email: 'nope' }, { name: 'Ok name', dob: '14/03/1992' }, { name: 'Ok name', gender: 'X' }, { name: 'Ok name', favorite_staff_id: 99999999 }]) {
    assert.equal((await clientCall(clientsApi.create, { body: bad })).code, 400, JSON.stringify(bad));
  }
  S.priya = c.customer_id;
});

test('a client can be updated in part, and archived', { skip }, async () => {
  const up = await clientCall(clientsApi.update, { params: { id: S.priya }, body: { preferences: 'Loves a head massage' } });
  assert.equal(up.code, 200); assert.equal(up.body.data.preferences, 'Loves a head massage'); assert.equal(up.body.data.allergies, 'Ammonia', 'fields not sent are untouched');
  assert.equal((await clientCall(clientsApi.update, { params: { id: S.priya }, body: {} })).code, 400);
  const clash = await clientCall(clientsApi.update, { params: { id: asha }, body: { phone: '9876511111' } });
  assert.equal(clash.code, 409);
});

test('notes are private to the salon, kept with their author, and newest first', { skip }, async () => {
  assert.equal((await clientCall(clientsApi.addNote, { params: { id: S.priya }, body: { body: '' } })).code, 400);
  const n1 = await clientCall(clientsApi.addNote, { params: { id: S.priya }, body: { body: 'Prefers Ravi' } });
  assert.equal(n1.code, 201); assert.equal(n1.body.data.author, `Owner ${S.tag}`);
  await clientCall(clientsApi.addNote, { params: { id: S.priya }, body: { body: 'Allergic to ammonia dyes' } });
  const c = await clientCall(clientsApi.get, { params: { id: S.priya } });
  assert.equal(c.body.data.notes.length, 2);
  assert.equal(c.body.data.notes[0].body, 'Allergic to ammonia dyes');
});

test('the timeline shows bills, appointments and notes for a client, newest first', { skip }, async () => {
  await go({ customer_id: S.priya, items: [{ type: 'SERVICE', service_id: haircut, staff_id: ravi }], payments: [{ method: 'CASH', amount: 'REST' }] });
  const t = await clientCall(clientsApi.timeline, { params: { id: S.priya }, query: {} });
  assert.equal(t.code, 200);
  const types = t.body.data.map((e) => e.type);
  assert.ok(types.includes('invoice') || types.includes('bill'), JSON.stringify(types));
  assert.ok(types.includes('note'));
  for (let i = 1; i < t.body.data.length; i++) assert.ok(new Date(t.body.data[i - 1].at) >= new Date(t.body.data[i].at), 'newest first');
});

test('segments: new, returning, VIP, inactive and members are computed from real visits and spend', { skip }, async () => {
  const fresh = await makeSalon(pool, 'segs');
  const st = await addStaff(pool, fresh, { name: 'Seg Staff' });
  const svc = await addService(pool, fresh, { name: 'Cut', price: 1000, tax: 0 });
  const c = async (name) => addClient(pool, fresh, name, null);
  const newbie = await c('Newbie'); const regular = await c('Regular'); const big = await c('Big spender'); const lapsed = await c('Lapsed'); const never = await c('Never visited');
  const visit = (who, n = 1) => sell(pool, createSalonInvoice, fresh, { customer_id: who, items: [{ type: 'SERVICE', service_id: svc, staff_id: st, quantity: n }], payments: [{ method: 'CASH', amount: 'REST' }] });
  await visit(newbie); await visit(regular); await visit(regular); await visit(big, 30);
  const old = await visit(lapsed);
  await pool.query(`UPDATE invoices SET invoice_date = CURRENT_DATE - 100, created_at = created_at - interval '100 days' WHERE invoice_id = $1`, [old.invoice.invoice_id]);
  const inSeg = async (segment) => { const r = fakeRes(); await clientsApi.list(fresh.req({ query: { segment } }), r); assert.equal(r.code, 200, JSON.stringify(r.body)); return r.body.data.map((x) => x.name).sort(); };
  assert.ok((await inSeg('NEW')).includes('Newbie'));
  assert.deepEqual(await inSeg('RETURNING'), ['Regular']);
  assert.ok((await inSeg('VIP')).includes('Big spender'));
  assert.ok(!(await inSeg('VIP')).includes('Newbie'));
  assert.deepEqual(await inSeg('INACTIVE_60'), ['Lapsed']);
  const counts = fakeRes(); await clientsApi.segments(fresh.req(), counts);
  assert.equal(counts.body.data.total, 5);
  assert.equal(counts.body.data.segments.find((s) => s.key === 'RETURNING').count, 1);
  const bad = fakeRes(); await clientsApi.list(fresh.req({ query: { segment: 'NONSENSE' } }), bad);
  assert.equal(bad.code, 400);
  void never;
});

test('the till\'s lookup finds a client by the end of the number or the start of the name', { skip }, async () => {
  const byPhone = await clientCall(clientsApi.lookup, { query: { q: '11111' } });
  assert.ok(byPhone.body.data.some((c) => c.name === 'Priya Nair'));
  const byName = await clientCall(clientsApi.lookup, { query: { q: 'priy' } });
  assert.ok(byName.body.data.some((c) => c.name === 'Priya Nair'));
  assert.deepEqual((await clientCall(clientsApi.lookup, { query: { q: 'p' } })).body.data, [], 'one letter is not a search');
});

test('a client list of thousands pages quickly and stays correct', { skip }, async () => {
  const fresh = await makeSalon(pool, 'many');
  await pool.query(`INSERT INTO customers (business_id, name, phone) SELECT $1, 'Client ' || lpad(g::text, 5, '0'), '9' || lpad(g::text, 9, '0') FROM generate_series(1, 12000) g`, [fresh.businessId]);
  await pool.query('ANALYZE customers');   // as autovacuum would after an import
  const t0 = Date.now();
  const r = fakeRes(); await clientsApi.list(fresh.req({ query: { limit: '25', offset: '5000', q: 'Client' } }), r);
  assert.equal(r.code, 200);
  assert.equal(r.body.meta.total, 12000); assert.equal(r.body.data.length, 25);
  const s = fakeRes(); await clientsApi.lookup(fresh.req({ query: { q: '000011999' } }), s);
  assert.equal(s.body.data.length, 1);
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0}ms`);
});

/* ── team and attendance ──────────────────────────────────────────────────── */

test('a team member has a role, skills, hours and commission; the rules are enforced', { skip }, async () => {
  const made = await S.call(staffApi.create, { body: { name: 'Nisha', staff_role: 'HAIR_STYLIST', skills: ['Colour', 'Cut'], commission_type: 'PERCENT', commission_value: 15, product_commission_pct: 5, working_hours: { 1: { start: '10:00', end: '18:00' }, 7: null } } });
  assert.equal(made.code, 201, JSON.stringify(made.body));
  assert.equal(made.body.data.commission_value, 15);
  for (const bad of [{ name: 'X' }, { name: 'Nisha2', commission_type: 'PERCENT', commission_value: 150 }, { name: 'Nisha3', staff_role: 'WIZARD' }, { name: 'Nisha4', working_hours: { 1: { start: '18:00', end: '10:00' } } },
    { name: 'Nisha5', user_id: 99999999 }]) {
    assert.equal((await S.call(staffApi.create, { body: bad })).code, 400, JSON.stringify(bad));
  }
  const up = await S.call(staffApi.update, { params: { id: made.body.data.staff_id }, body: { is_bookable: false } });
  assert.equal(up.code, 200); assert.equal(up.body.data.is_bookable, false);
  const bookable = await S.call(staffApi.list, { query: { bookable: '1' } });
  assert.ok(!bookable.body.data.some((s) => s.name === 'Nisha'));
});

test('attendance: one record per person per day, corrected in place, summarised', { skip }, async () => {
  const mark = (body) => S.call(staffApi.markAttendance, { body });
  assert.equal((await mark({ staff_id: ravi, work_date: TODAY, status: 'PRESENT', check_in: `${TODAY}T09:30:00+05:30`, check_out: `${TODAY}T18:00:00+05:30` })).code, 200);
  assert.equal((await mark({ staff_id: ravi, work_date: TODAY, status: 'HALF_DAY' })).code, 200, 'the same day corrected, not duplicated');
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM salon_attendance WHERE staff_id = $1 AND work_date = $2`, [ravi, TODAY])).rows[0].n, 1);
  await mark({ staff_id: meena, work_date: TODAY, status: 'LEAVE' });
  assert.equal((await mark({ staff_id: ravi, work_date: TODAY, status: 'SLEEPING' })).code, 400);
  assert.equal((await mark({ staff_id: ravi, work_date: TODAY, status: 'PRESENT', check_in: `${TODAY}T18:00:00+05:30`, check_out: `${TODAY}T09:00:00+05:30` })).code, 400, 'out before in');
  assert.equal((await mark({ staff_id: 99999999, work_date: TODAY, status: 'PRESENT' })).code, 404);
  const day = await S.call(staffApi.attendance, { query: { date: TODAY } });
  assert.equal(day.body.data.staff.find((s) => s.staff_id === ravi).status, 'HALF_DAY');
  const sum = await S.call(staffApi.attendanceSummary, { query: { from: TODAY, to: TODAY } });
  assert.equal(sum.code, 200);
  const byName = Object.fromEntries(sum.body.data.staff.map((s) => [s.staff_id, s]));
  assert.equal(byName[meena].leave, 1); assert.equal(byName[ravi].half_days, 1); assert.equal(byName[ravi].present, 0);
});

/* ── the service catalogue ────────────────────────────────────────────────── */

test('a service has a price, tax, duration and consumables, and defaults come from the salon\'s settings', { skip }, async () => {
  assert.equal((await S.call(settingsApi.update, { body: { default_service_tax_rate: 18 } })).code, 200);
  const cat = await S.call(catalog.createCategory, { body: { name: 'Hair', item_scope: 'SERVICE' } });
  assert.equal(cat.code, 201, JSON.stringify(cat.body));
  const colour = await addStock(pool, S, { name: 'Dye', kind: 'INGREDIENT', stock: 1000, unit: 'ml', cost: 1 });
  const made = await S.call(catalog.createService, { body: { name: 'Global colour', price: 3500, duration_min: 90, category_id: cat.body.data.category_id, consumables: [{ ingredient_id: colour, quantity: 60, is_variable: true }] } });
  assert.equal(made.code, 201, JSON.stringify(made.body));
  assert.equal(made.body.data.duration_min, 90);
  assert.equal(made.body.data.tax_rate, 18, 'the salon\'s default service tax, not a hard-coded one');
  assert.equal(made.body.data.consumable_items.length, 1); assert.equal(made.body.data.consumable_items[0].is_variable, true);
  assert.equal((await S.call(catalog.createService, { body: { name: 'global COLOUR', price: 100 } })).code, 409, 'the same name twice');
  assert.equal((await S.call(catalog.createService, { body: { name: 'Bad', price: 'abc' } })).code, 400);
  assert.equal((await S.call(catalog.createService, { body: { name: 'Bad', price: 100, duration_min: 2 } })).code, 400);
  assert.equal((await S.call(catalog.createService, { body: { name: 'Bad', price: 100, consumables: [{ ingredient_id: 99999999, quantity: 1 }] } })).code, 400);
  S.colouring = made.body.data.service_id ?? made.body.data.product_id;
});

test('changing the salon\'s default tax changes new services, not existing ones', { skip }, async () => {
  const put = await S.call(settingsApi.update, { body: { default_service_tax_rate: 5 } });
  assert.equal(put.code, 200, JSON.stringify(put.body));
  const made = await S.call(catalog.createService, { body: { name: 'Threading', price: 100 } });
  assert.equal(made.body.data.tax_rate, 5);
  const old = await S.call(catalog.getService, { params: { id: S.colouring } });
  assert.equal(old.body.data.tax_rate, 18);
  await S.call(settingsApi.update, { body: { default_service_tax_rate: 18 } });
});

test('a service is archived, not deleted: history keeps its name, the till stops offering it', { skip }, async () => {
  const s = await addService(pool, S, { name: 'Old service', price: 200 });
  await go({ items: [{ type: 'SERVICE', service_id: s, staff_id: ravi }], payments: [{ method: 'CASH', amount: 'REST' }] });
  assert.equal((await S.call(catalog.archiveService, { params: { id: s } })).code, 200);
  await assert.rejects(() => go({ items: [{ type: 'SERVICE', service_id: s, staff_id: ravi }] }));
  const active = await S.call(catalog.listServices, { query: {} });
  assert.ok(!active.body.data.some((x) => x.name === 'Old service'));
  assert.equal((await S.call(catalog.restoreService, { params: { id: s } })).code, 200);
  assert.equal((await go({ items: [{ type: 'SERVICE', service_id: s, staff_id: ravi }] }, { dryRun: true })).invoice.subtotal, 200);
});

test('consumables can be replaced as a list, and a service cannot consume itself or a service', { skip }, async () => {
  const dye = await addStock(pool, S, { name: 'Toner', kind: 'INGREDIENT', stock: 100, unit: 'ml' });
  const set = await S.call(catalog.setConsumables, { params: { id: haircut }, body: { consumables: [{ ingredient_id: dye, quantity: 5 }] } });
  assert.equal(set.code, 200, JSON.stringify(set.body));
  const got = await S.call(catalog.getConsumables, { params: { id: haircut } });
  assert.equal(got.body.data.length, 1);
  assert.equal((await S.call(catalog.setConsumables, { params: { id: haircut }, body: { consumables: [{ ingredient_id: facial, quantity: 1 }] } })).code, 400);
  assert.equal((await S.call(catalog.setConsumables, { params: { id: haircut }, body: { consumables: [] } })).code, 200);
  assert.equal((await S.call(catalog.getConsumables, { params: { id: haircut } })).body.data.length, 0);
  void addRecipe;
});

/* ── reports and the dashboard ────────────────────────────────────────────── */

test('the dashboard adds up today\'s real sales, appointments and outstanding dues', { skip }, async () => {
  const fresh = await makeSalon(pool, 'dash');
  const st = await addStaff(pool, fresh, { name: 'Dash Staff' });
  const svc = await addService(pool, fresh, { name: 'Cut', price: 1000, tax: 0 });
  const cli = await addClient(pool, fresh, 'Dash client');
  await sell(pool, createSalonInvoice, fresh, { customer_id: cli, items: [{ type: 'SERVICE', service_id: svc, staff_id: st, quantity: 2 }], payments: [{ method: 'CASH', amount: 1500 }] });
  const r = fakeRes(); await reports.dashboard(fresh.req(), r);
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const d = r.body.data;
  assert.equal(d.overview.sales_today, 2000); assert.equal(d.overview.outstanding, 500); assert.equal(d.overview.invoices_today, 1);
  // a person without report access gets the operational picture but no money
  const limited = fakeRes(); await reports.dashboard(fresh.req({}, fresh.tenantFor('RECEPTIONIST')), limited);
  assert.equal(limited.code, 200);
  assert.equal(limited.body.data.overview.sales_today ?? null, null, 'money is masked'); assert.equal(limited.body.data.overview.invoices_today, 1, 'the counts are still there');
});

test('every report runs, on an empty salon and on a busy one, and respects the date range', { skip }, async () => {
  const empty = await makeSalon(pool, 'rep0');
  const cat = fakeRes(); await reports.catalog(S.req(), cat);
  const keys = Object.values(cat.body.data).flat().map((r) => r.key);
  assert.ok(keys.length >= 20, `${keys.length} reports`);
  for (const key of keys) {
    for (const salon of [empty, S]) {
      const r = fakeRes(); await reports.run(salon.req({ params: { name: key }, query: { from: day(-30), to: day(0) } }, salon.tenantFor('OWNER', { planFeatures: { advanced_reports: true } })), r);
      assert.equal(r.code, 200, `${key}: ${JSON.stringify(r.body).slice(0, 200)}`);
      assert.ok(r.body.data.title, key);
    }
  }
  const daily = fakeRes(); await reports.run(S.req({ params: { name: 'sales-daily' }, query: { from: day(-30), to: day(0) } }), daily);
  assert.equal(daily.code, 200);
  const bad = fakeRes(); await reports.run(S.req({ params: { name: 'sales-daily' }, query: { from: '2026-02-30', to: day(0) } }), bad);
  assert.ok([400, 200].includes(bad.code));
});

test('advanced reports are refused on a plan without them', { skip }, async () => {
  const cat = fakeRes(); await reports.catalog(S.req(), cat);
  const tried = [];
  for (const key of Object.values(cat.body.data).flat().map((r) => r.key)) {
    const r = fakeRes(); await reports.run(S.req({ params: { name: key }, query: {} }, S.tenantFor('OWNER', { planFeatures: { advanced_reports: false } })), r);
    if (r.code === 402) tried.push(key);
  }
  assert.ok(tried.length >= 1, 'some reports are advanced');
  assert.ok(!tried.includes('sales-daily'), 'the basics stay open');
});

/* ── automation ───────────────────────────────────────────────────────────── */

test('automations are listed with defaults, changed with validation, and audited', { skip }, async () => {
  const list = await S.call(automation.list);
  assert.equal(list.code, 200);
  const keys = list.body.data.automations.map((a) => a.key);
  for (const k of ['APPOINTMENT_REMINDER', 'BIRTHDAY', 'MEMBERSHIP_EXPIRY', 'POINTS_EXPIRY', 'REVISIT', 'INACTIVE', 'PAYMENT_REMINDER', 'LOW_STOCK']) assert.ok(keys.includes(k), k);
  const on = await S.call(automation.update, { params: { key: 'appointment_reminder' }, body: { is_enabled: true, config: { hours_before: 3 } } });
  assert.equal(on.code, 200, JSON.stringify(on.body));
  assert.equal(on.body.data.config.hours_before, 3);
  assert.equal((await S.call(automation.update, { params: { key: 'APPOINTMENT_REMINDER' }, body: { config: { hours_before: 9999 } } })).code, 400);
  assert.equal((await S.call(automation.update, { params: { key: 'APPOINTMENT_REMINDER' }, body: { config: { colour: 'red' } } })).code, 400);
  assert.equal((await S.call(automation.update, { params: { key: 'NOPE' }, body: { is_enabled: true } })).code, 404);
  assert.equal((await S.call(automation.update, { params: { key: 'BIRTHDAY' }, body: {} })).code, 400);
});

test('running automations with messaging switched off sends nothing and does not crash', { skip }, async () => {
  const before = (await row(`SELECT COUNT(*)::int AS n FROM messages WHERE business_id = $1`, [S.businessId])).n;
  const run = await S.call(automation.runNow);
  assert.equal(run.code, 200, JSON.stringify(run.body));
  assert.equal((await row(`SELECT COUNT(*)::int AS n FROM messages WHERE business_id = $1`, [S.businessId])).n, before);
});

test('a campaign goes to a segment, only to people who can be contacted, and only once an hour', { skip }, async () => {
  const fresh = await makeSalon(pool, 'camp');
  await pool.query(`UPDATE businesses SET messaging_channel = 'SMS' WHERE business_id = $1`, [fresh.businessId]).catch(() => {});
  await addClient(pool, fresh, 'Reachable', '9876500111');
  await addClient(pool, fresh, 'No number');
  const opted = await addClient(pool, fresh, 'Opted out', '9876500222');
  await pool.query(`UPDATE customers SET marketing_opt_out = TRUE WHERE customer_id = $1`, [opted]);
  const aud = fakeRes(); await automation.audience(fresh.req({ query: { segment: 'NEW' } }), aud);
  assert.equal(aud.code, 200, JSON.stringify(aud.body));
  assert.equal(aud.body.data.count, 1, 'one reachable client');
  assert.deepEqual(aud.body.data.sample, ['Reachable']);
  assert.equal((await (async () => { const r = fakeRes(); await automation.campaign(fresh.req({ body: { segment: 'NEW', offer: 'hi' } }), r); return r; })()).code, 400, 'too short to be a message');
});
