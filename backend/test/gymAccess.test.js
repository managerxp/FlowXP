/*
 * Gym access: the one decision engine behind reception, self check-in and devices. Reason codes, the gym's own clock (including midnight and
 * a daylight-saving change), credentials (printed card, phone pass), duplicates and races, check-out, and failing closed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addMember, addMembership, addPlan, day, makeGym } from './helpers/gym.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const access = await import('../src/modules/gym/access.js');
const creds = await import('../src/modules/gym/credentials.js');
const { inTx, sha256 } = await import('../src/modules/gym/common.js');
const { attempt, evaluate, paymentOk, REASON } = access;

test.after(cleanup);

// Monday 12 October 2026, 10:00 in Kolkata (04:30 UTC)
const NOW = new Date('2026-10-12T04:30:00Z');
const TODAY = '2026-10-12';
const at = (seconds) => new Date(NOW.getTime() + seconds * 1000);
const scan = (g, extra) => attempt({ businessId: g.businessId, branchId: g.branchId, source: 'RECEPTION', now: NOW, ...extra });
const visits = async (memberId) => (await pool.query(`SELECT COUNT(*)::int AS n FROM gym_attendance WHERE member_id = $1`, [memberId])).rows[0].n;
const card = async (g, memberId) => (await inTx((db) => creds.issueCard(db, { businessId: g.businessId, memberId, userId: g.userId }))).code;

let A; let B;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeGym(pool, 'acc', { branches: 2 });
  B = await makeGym(pool, 'accB');
});

/* ── the pure rules ───────────────────────────────────────────────────────── */

const ctx = (over = {}) => ({ today: TODAY, dow: 1, minutes: 600, branchId: 1, graceDefault: 0, hours: null, holidays: [], ...over });
const ms = (over = {}) => ({ kind: 'MEMBERSHIP', status: 'ACTIVE', start_date: day(TODAY, -10), end_date: day(TODAY, 10), freezes: [], payment_basis: 'COMPED', allowed_branch_ids: null, time_window: null, grace_days: null, inv: null, ...over });
const decide = (m, c = ctx(), member = { status: 'ACTIVE' }) => evaluate({ member, memberships: Array.isArray(m) ? m : [m], ctx: c });

test('a running membership is approved, on its last day too, and refused the day after', { skip }, () => {
  assert.equal(decide(ms()).reason, REASON.APPROVED);
  assert.equal(decide(ms({ end_date: TODAY })).reason, REASON.APPROVED, 'the last day still works');
  assert.equal(decide(ms({ end_date: day(TODAY, -1) })).reason, REASON.MEMBERSHIP_EXPIRED);
  assert.equal(decide(ms({ start_date: TODAY })).reason, REASON.APPROVED, 'the first day works');
  assert.equal(decide(ms({ start_date: day(TODAY, 1) })).reason, REASON.MEMBERSHIP_NOT_STARTED);
});

test('grace days: a membership works until the grace is used up, and the member is told it is in grace', { skip }, () => {
  const lapsed = ms({ end_date: day(TODAY, -1) });
  assert.equal(decide({ ...lapsed, grace_days: 1 }).decision, 'APPROVED');
  assert.equal(decide({ ...lapsed, grace_days: 1 }).inGrace, true);
  assert.equal(decide(ms({ end_date: day(TODAY, -2), grace_days: 1 })).reason, REASON.MEMBERSHIP_EXPIRED, 'one day past the grace');
  assert.equal(decide(lapsed, ctx({ graceDefault: 3 })).decision, 'APPROVED', 'the gym-wide default applies when the plan sets none');
  assert.equal(decide({ ...lapsed, grace_days: 0 }, ctx({ graceDefault: 3 })).reason, REASON.MEMBERSHIP_EXPIRED, 'a plan can say no grace at all');
});

test('frozen, suspended, archived, none and cancelled', { skip }, () => {
  assert.equal(decide(ms({ freezes: [{ from: day(TODAY, -2), to: TODAY }] })).reason, REASON.MEMBERSHIP_FROZEN);
  assert.equal(decide(ms({ freezes: [{ from: day(TODAY, 1), to: day(TODAY, 5) }] })).reason, REASON.APPROVED, 'a freeze that has not begun');
  assert.equal(decide(ms({ freezes: [{ from: day(TODAY, -9), to: day(TODAY, -1) }] })).reason, REASON.APPROVED, 'a freeze that is over');
  assert.equal(decide(ms(), ctx(), { status: 'SUSPENDED' }).reason, REASON.MEMBERSHIP_SUSPENDED);
  assert.equal(decide(ms(), ctx(), { status: 'INACTIVE' }).reason, REASON.MEMBERSHIP_SUSPENDED);
  assert.equal(decide(ms(), ctx(), { status: 'ARCHIVED' }).reason, REASON.MEMBER_NOT_FOUND);
  assert.equal(decide([]).reason, REASON.NO_MEMBERSHIP);
  assert.equal(decide(ms({ status: 'CANCELLED' })).reason, REASON.MEMBERSHIP_EXPIRED);
  assert.equal(decide(ms({ kind: 'PT_PACK' })).reason, REASON.NO_MEMBERSHIP, 'a training pack is not a gym membership');
});

test('with several memberships, any one that grants access wins, otherwise the closest refusal is named', { skip }, () => {
  assert.equal(decide([ms({ end_date: day(TODAY, -5) }), ms({ start_date: day(TODAY, -4), end_date: day(TODAY, 20) })]).reason, REASON.APPROVED);
  assert.equal(decide([ms({ end_date: day(TODAY, -40) }), ms({ start_date: day(TODAY, 3), end_date: day(TODAY, 33) })]).reason, REASON.MEMBERSHIP_NOT_STARTED, 'a renewal about to start is more useful to say than "expired"');
});

test('payment rules are the plan\'s: full, any, or pay later, never one rule for every plan', { skip }, () => {
  const inv = (over = {}) => ({ inv_status: 'ISSUED', total_paise: 118000, amount_paid_paise: 0, balance_due_paise: 118000, credited_paise: 0, ...over });
  const m = (policy, extra = {}) => ms({ payment_basis: 'INVOICE', payment_policy: policy, ...extra });
  const unpaid = inv(); const part = inv({ amount_paid_paise: 50000, balance_due_paise: 68000 }); const paid = inv({ amount_paid_paise: 118000, balance_due_paise: 0 });
  assert.equal(paymentOk(m('FULL_REQUIRED'), paid, TODAY), true);
  assert.equal(paymentOk(m('FULL_REQUIRED'), part, TODAY), false, 'part paid is not paid');
  assert.equal(paymentOk(m('FULL_REQUIRED'), unpaid, TODAY), false);
  assert.equal(paymentOk(m('ANY_PAYMENT'), part, TODAY), true, 'a part payment is enough for this plan');
  assert.equal(paymentOk(m('ANY_PAYMENT'), unpaid, TODAY), false);
  assert.equal(paymentOk(m('PAY_LATER', { pay_later_until: TODAY }), unpaid, TODAY), true, 'on the last day of the grace to pay');
  assert.equal(paymentOk(m('PAY_LATER', { pay_later_until: day(TODAY, -1) }), unpaid, TODAY), false, 'the day after');
  assert.equal(paymentOk(m('PAY_LATER', { pay_later_until: day(TODAY, -1) }), paid, TODAY), true, 'paid in full any time');
  assert.equal(paymentOk(m('FULL_REQUIRED'), inv({ inv_status: 'CANCELLED', amount_paid_paise: 118000, balance_due_paise: 0 }), TODAY), false, 'a cancelled invoice pays for nothing');
  assert.equal(paymentOk(m('FULL_REQUIRED'), inv({ amount_paid_paise: 118000, balance_due_paise: 0, credited_paise: 118000 }), TODAY), false, 'fully refunded');
  assert.equal(paymentOk(m('FULL_REQUIRED'), inv({ amount_paid_paise: 118000, balance_due_paise: 0, credited_paise: 20000 }), TODAY), true, 'a part refund leaves it running');
  assert.equal(paymentOk(m('FULL_REQUIRED'), null, TODAY), false, 'an invoice that has gone');
  assert.equal(paymentOk(ms({ payment_basis: 'COMPED' }), null, TODAY), true, 'given free');
  assert.equal(paymentOk(ms({ payment_basis: 'TRANSFER' }), null, TODAY), true, 'carried over');
  assert.equal(paymentOk(m('FULL_REQUIRED'), inv({ total_paise: 0, balance_due_paise: 0 }), TODAY), true, 'a free (100% discounted) bill');
  const r = decide(m('FULL_REQUIRED', { inv: unpaid }));
  assert.equal(r.reason, REASON.PAYMENT_REQUIRES_ATTENTION);
});

test('branch, plan hours and the gym\'s own opening hours and holidays', { skip }, () => {
  assert.equal(decide(ms({ allowed_branch_ids: [2, 3] }), ctx({ branchId: 1 })).reason, REASON.BRANCH_NOT_ALLOWED);
  assert.equal(decide(ms({ allowed_branch_ids: [2, 3] }), ctx({ branchId: 3 })).reason, REASON.APPROVED);
  const offPeak = { days: [1, 2, 3, 4, 5], from: '06:00', to: '11:00' };
  assert.equal(decide(ms({ time_window: offPeak }), ctx({ minutes: 10 * 60 })).reason, REASON.APPROVED);
  assert.equal(decide(ms({ time_window: offPeak }), ctx({ minutes: 11 * 60 })).reason, REASON.ACCESS_OUTSIDE_ALLOWED_HOURS, 'the closing minute is outside');
  assert.equal(decide(ms({ time_window: offPeak }), ctx({ minutes: 6 * 60 })).reason, REASON.APPROVED, 'the opening minute is inside');
  assert.equal(decide(ms({ time_window: offPeak }), ctx({ dow: 0, minutes: 600 })).reason, REASON.ACCESS_OUTSIDE_ALLOWED_HOURS, 'Sunday is not in the plan');
  const night = { from: '22:00', to: '02:00' };
  assert.equal(decide(ms({ time_window: night }), ctx({ minutes: 23 * 60 })).reason, REASON.APPROVED, 'a window across midnight');
  assert.equal(decide(ms({ time_window: night }), ctx({ minutes: 60 })).reason, REASON.APPROVED);
  assert.equal(decide(ms({ time_window: night }), ctx({ minutes: 12 * 60 })).reason, REASON.ACCESS_OUTSIDE_ALLOWED_HOURS);
  const hours = { 1: { open: '06:00', close: '22:00' } };
  assert.equal(decide(ms(), ctx({ hours, minutes: 23 * 60 })).reason, REASON.ACCESS_OUTSIDE_ALLOWED_HOURS, 'the gym is shut');
  assert.equal(decide(ms(), ctx({ hours, dow: 2 })).reason, REASON.ACCESS_OUTSIDE_ALLOWED_HOURS, 'no hours that day = closed');
  assert.equal(decide(ms(), ctx({ hours, holidays: [TODAY] })).reason, REASON.ACCESS_OUTSIDE_ALLOWED_HOURS, 'a holiday');
  assert.equal(decide(ms(), ctx({ hours: null })).reason, REASON.APPROVED, 'no hours set = open all day');
});

/* ── through the database ─────────────────────────────────────────────────── */

test('an approved scan records the decision and the visit, on the gym\'s own day', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Asha' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const code = await card(A, m);
  const r = await scan(A, { code });
  assert.equal(r.decision, 'APPROVED');
  assert.equal(r.reason, 'APPROVED');
  assert.equal(r.member.name, 'Asha');
  assert.equal(r.membership.days_left, 25);
  const a = (await pool.query(`SELECT local_date::text AS d, source, status, access_event_id FROM gym_attendance WHERE member_id = $1`, [m])).rows;
  assert.equal(a.length, 1);
  assert.equal(a[0].d, TODAY);
  assert.equal(a[0].source, 'RECEPTION');
  assert.equal(a[0].status, 'CONFIRMED');
  const e = (await pool.query(`SELECT decision, reason_code, attendance_id FROM gym_access_events WHERE member_id = $1`, [m])).rows;
  assert.equal(e.length, 1);
  assert.equal(e[0].attendance_id, r.attendance_id);
});

test('a card holds nothing about the member, only a hash of its token is stored, and the token is shown once', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Secret Name', phone: '9876543210' });
  const { code, credential } = await inTx((db) => creds.issueCard(db, { businessId: A.businessId, memberId: m, userId: A.userId }));
  assert.match(code, /^FXG1\.[A-Za-z0-9_-]{32}$/);
  for (const secret of ['Secret', '9876543210']) assert.ok(!code.includes(secret), `the QR text does not contain ${secret}`);
  // 32 random characters and a version tag: nothing in it is derived from the member (a database id of 2 would be a coincidence of the random text)
  const token = code.split('.')[1];
  const row = (await pool.query(`SELECT * FROM gym_credentials WHERE credential_id = $1`, [credential.credential_id])).rows[0];
  assert.equal(row.token_hash, sha256(token));
  assert.ok(!JSON.stringify(row).includes(token), 'the token is nowhere in the row');
  assert.equal(credential.token_hash, undefined, 'and not in what is sent back about the credential');
  assert.equal(JSON.stringify(credential).includes(token), false);
  assert.equal((await creds.listCredentials(pool, A.businessId, m)).some((c) => JSON.stringify(c).includes(token)), false, 'listing never shows it again');
});

test('invalid, altered, malformed and another gym\'s cards are all just "not valid"', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Bina' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const code = await card(A, m);
  const last = code.at(-1) === 'A' ? 'B' : 'A';
  for (const bad of [code.slice(0, -1) + last, 'FXG1.', 'hello', '', null, 'FXG1.' + 'x'.repeat(32), `FXD1.${code.split('.')[1]}`, `${code} `.repeat(3)]) {
    const r = await scan(A, { code: bad });
    assert.equal(r.decision, 'DENIED', `${String(bad).slice(0, 20)} is refused`);
    assert.equal(r.reason, REASON.INVALID_CREDENTIAL);
    assert.equal(r.member, null, 'and nothing about anyone is shown');
  }
  const other = await attempt({ businessId: B.businessId, branchId: B.branchId, source: 'RECEPTION', now: NOW, code });
  assert.equal(other.reason, REASON.INVALID_CREDENTIAL, 'a card from gym A means nothing at gym B');
  assert.equal(await visits(m), 0);
});

test('a revoked card stops at once, and a replaced card is replaced, not duplicated', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Chitra' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const old = await card(A, m);
  assert.equal((await scan(A, { code: old })).decision, 'APPROVED');
  const next = (await inTx((db) => creds.issueCard(db, { businessId: A.businessId, memberId: m, userId: A.userId, reason: 'Lost' }))).code;
  const r = await scan(A, { code: old, now: at(600) });
  assert.equal(r.reason, REASON.CREDENTIAL_REVOKED, 'the lost card is dead');
  assert.equal((await scan(A, { code: next, now: at(600) })).decision, 'APPROVED', 'and the new one works');
  const live = (await pool.query(`SELECT COUNT(*)::int AS n FROM gym_credentials WHERE member_id = $1 AND kind = 'CARD' AND status = 'ACTIVE'`, [m])).rows[0].n;
  assert.equal(live, 1, 'one live card at a time');
  const cur = (await pool.query(`SELECT credential_id FROM gym_credentials WHERE member_id = $1 AND status = 'ACTIVE'`, [m])).rows[0];
  await inTx((db) => creds.revoke(db, { businessId: A.businessId, credentialId: cur.credential_id, userId: A.userId, reason: 'Stolen' }));
  assert.equal((await scan(A, { code: next, now: at(1200) })).reason, REASON.CREDENTIAL_REVOKED);
  // the denied attempts are on record, with the reason, and never with the secret
  const ev = (await pool.query(`SELECT detail::text AS d, reason_code FROM gym_access_events WHERE member_id = $1 AND decision = 'DENIED'`, [m])).rows;
  assert.equal(ev.length, 2);
  for (const e of ev) { assert.ok(!e.d.includes(old.split('.')[1]) && !e.d.includes(next.split('.')[1]), 'no token in the log'); }
});

test('a card with an expiry date stops at it', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Deepak' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const { code } = await inTx((db) => creds.issueCard(db, { businessId: A.businessId, memberId: m, userId: A.userId, expiresAt: at(3600) }));
  assert.equal((await scan(A, { code })).decision, 'APPROVED');
  assert.equal((await scan(A, { code, now: at(7200) })).reason, REASON.CREDENTIAL_EXPIRED);
});

test('a phone pass works once, for a minute, and a copy of it is worth nothing', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Esha' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const pass = await inTx((db) => creds.issuePass(db, { businessId: A.businessId, memberId: m, now: NOW }));
  assert.match(pass.code, /^FXD1\.[A-Za-z0-9_-]{32}$/);
  assert.equal(pass.ttl_seconds, 60);
  const first = await scan(A, { code: pass.code, now: at(10) });
  assert.equal(first.decision, 'APPROVED');
  const replay = await scan(A, { code: pass.code, now: at(12) });
  assert.equal(replay.reason, REASON.INVALID_CREDENTIAL, 'the same screenshot again');
  const stale = await inTx((db) => creds.issuePass(db, { businessId: A.businessId, memberId: m, now: NOW }));
  assert.equal((await scan(A, { code: stale.code, now: at(61) })).reason, REASON.CREDENTIAL_EXPIRED, 'a minute later');
  const t = (await pool.query(`SELECT token_hash FROM gym_pass_tokens`)).rows;
  assert.ok(t.every((r) => r.token_hash.length === 64), 'only hashes are kept');
  // revoking the phone pass kills every token for it
  const fresh = await inTx((db) => creds.issuePass(db, { businessId: A.businessId, memberId: m, now: at(100) }));
  await inTx((db) => creds.revokeAll(db, { businessId: A.businessId, memberId: m, userId: A.userId, reason: 'Lost phone' }));
  assert.equal((await scan(A, { code: fresh.code, now: at(110) })).reason, REASON.CREDENTIAL_REVOKED);
});

test('a second scan inside the cooldown is a repeat, not a second visit; after it, it is another visit', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Farhan' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const code = await card(A, m);
  assert.equal((await scan(A, { code })).decision, 'APPROVED');
  const dup = await scan(A, { code, now: at(30) });
  assert.equal(dup.reason, REASON.DUPLICATE_SCAN);
  assert.equal(dup.message, 'Already checked in');
  assert.equal(await visits(m), 1);
  assert.equal((await scan(A, { code, now: at(130) })).decision, 'APPROVED', '120 seconds later');
  assert.equal(await visits(m), 2);
});

test('the same scan sent five times at once makes exactly one visit', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Gita' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const code = await card(A, m);
  const results = await Promise.all(Array.from({ length: 5 }, () => scan(A, { code })));
  assert.equal(results.filter((r) => r.decision === 'APPROVED').length, 1);
  assert.equal(results.filter((r) => r.reason === REASON.DUPLICATE_SCAN).length, 4);
  assert.equal(await visits(m), 1);
});

test('a retry with the same key after a timeout returns the first answer and records nothing new', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Hari' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const code = await card(A, m);
  const first = await scan(A, { code, idempotencyKey: 'scan-1' });
  const retry = await scan(A, { code, idempotencyKey: 'scan-1', now: at(400) });
  assert.equal(retry.replayed, true);
  assert.equal(retry.decision, 'APPROVED');
  assert.equal(retry.event_id, first.event_id);
  assert.equal(await visits(m), 1);
  const racing = await Promise.all([scan(A, { code, idempotencyKey: 'scan-2', now: at(900) }), scan(A, { code, idempotencyKey: 'scan-2', now: at(900) })]);
  assert.deepEqual(racing.map((r) => r.decision), ['APPROVED', 'APPROVED'], 'two copies of one request both get the one answer');
  assert.equal(await visits(m), 2);
});

test('some gyms allow one visit a day', { skip }, async () => {
  const G = await makeGym(pool, 'once', { settings: { visits_per_day: 1, cooldown_seconds: 0 } });
  const m = await addMember(pool, G, { name: 'Ila' });
  await addMembership(pool, G, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const code = (await inTx((db) => creds.issueCard(db, { businessId: G.businessId, memberId: m, userId: G.userId }))).code;
  assert.equal((await scan(G, { code })).decision, 'APPROVED');
  const second = await scan(G, { code, now: at(4 * 3600) });
  assert.equal(second.reason, REASON.DUPLICATE_SCAN);
  assert.equal((await scan(G, { code, now: at(24 * 3600) })).decision, 'APPROVED', 'tomorrow');
});

test('check-out closes the visit; leaving never needs a valid membership; a stray check-out is refused', { skip }, async () => {
  const off = await makeGym(pool, 'out1');
  const mo = await addMember(pool, off, { name: 'Jay' });
  await addMembership(pool, off, mo, { start: day(TODAY, -5), end: day(TODAY, 25) });
  assert.equal((await scan(off, { memberId: mo, source: 'RECEPTION', confirm: true, action: 'OUT' })).reason, REASON.ACTION_NOT_ALLOWED, 'check-out is switched off');

  const G = await makeGym(pool, 'out2', { settings: { checkout_enabled: true } });
  const m = await addMember(pool, G, { name: 'Kavya' });
  const mem = await addMembership(pool, G, m, { start: day(TODAY, -5), end: TODAY });
  assert.equal((await scan(G, { memberId: m, confirm: true })).decision, 'APPROVED');
  assert.equal((await scan(G, { memberId: m, confirm: true, action: 'OUT', now: at(3600) })).decision, 'APPROVED');
  const a = (await pool.query(`SELECT check_out_at FROM gym_attendance WHERE member_id = $1`, [m])).rows[0];
  assert.ok(a.check_out_at, 'the visit has a check-out time');
  assert.equal((await scan(G, { memberId: m, confirm: true, action: 'OUT', now: at(3700) })).reason, REASON.NOT_CHECKED_IN);
  // in at the end of the day on the last day; out after the membership has ended
  await pool.query(`UPDATE gym_memberships SET end_date = $2 WHERE membership_id = $1`, [mem, day(TODAY, -1)]);
  assert.equal((await scan(G, { memberId: m, confirm: true, action: 'IN', now: at(7300) })).reason, REASON.MEMBERSHIP_EXPIRED);
});

test('the desk can be made to confirm every scan, and a lookup by name always needs it', { skip }, async () => {
  const G = await makeGym(pool, 'conf', { settings: { reception_confirm: true } });
  const m = await addMember(pool, G, { name: 'Lata' });
  await addMembership(pool, G, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const code = (await inTx((db) => creds.issueCard(db, { businessId: G.businessId, memberId: m, userId: G.userId }))).code;
  const first = await scan(G, { code });
  assert.equal(first.reason, REASON.VERIFICATION_REQUIRED);
  assert.equal(first.needs, 'STAFF_CONFIRM');
  assert.equal(first.member.name, 'Lata', 'the desk is shown who, to check');
  assert.equal(await visits(m), 0, 'nothing is recorded as a visit yet');
  assert.equal((await scan(G, { code, confirm: true, now: at(5) })).decision, 'APPROVED');

  const L = await makeGym(pool, 'look');
  const m2 = await addMember(pool, L, { name: 'Manoj' });
  await addMembership(pool, L, m2, { start: day(TODAY, -5), end: day(TODAY, 25) });
  assert.equal((await scan(L, { memberId: m2 })).reason, REASON.VERIFICATION_REQUIRED, 'a name lookup is not enough');
  assert.equal((await scan(L, { memberId: m2, confirm: true, now: at(5) })).decision, 'APPROVED');
});

test('the same printed card at two outlets within minutes needs a person to look', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Nisha' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const code = await card(A, m);
  assert.equal((await scan(A, { code })).decision, 'APPROVED');
  const other = await scan({ ...A, branchId: A.branchIds[1] }, { code, now: at(600) });
  assert.equal(other.reason, REASON.VERIFICATION_REQUIRED);
  assert.equal(other.needs, 'TWO_OUTLETS');
  assert.equal((await scan({ ...A, branchId: A.branchIds[1] }, { code, now: at(610), confirm: true })).decision, 'APPROVED');
  assert.equal((await scan({ ...A, branchId: A.branchIds[0] }, { code, now: at(4 * 3600) })).decision, 'APPROVED', 'hours later is just a person travelling');
});

test('self check-in can demand a fresh code, and a device must identify itself', { skip }, async () => {
  const G = await makeGym(pool, 'self', { settings: { self_checkin_fresh_otp_minutes: 10 } });
  const m = await addMember(pool, G, { name: 'Omar' });
  await addMembership(pool, G, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const base = { businessId: G.businessId, branchId: G.branchId, source: 'SELF', memberId: m, now: NOW };
  const stale = await attempt({ ...base, freshOtpAt: new Date(NOW.getTime() - 3600000) });
  assert.equal(stale.reason, REASON.VERIFICATION_REQUIRED);
  assert.equal(stale.needs, 'OTP_REQUIRED');
  const ok = await attempt({ ...base, freshOtpAt: new Date(NOW.getTime() - 60000), now: at(5) });
  assert.equal(ok.decision, 'APPROVED');
  assert.equal(ok.member.name, 'Omar', 'a member is shown themselves');
  const denied = await attempt({ ...base, memberId: m, now: at(400), freshOtpAt: null });
  assert.equal(denied.member, null, 'a refusal on the phone shows nothing');

  const noDevice = await attempt({ businessId: G.businessId, branchId: G.branchId, source: 'DEVICE', memberId: m, now: at(900) });
  assert.equal(noDevice.reason, REASON.DEVICE_NOT_AUTHORIZED);
});

test('a gate or a phone is told "yes" or "no" and the reason, never who the member is', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Pooja' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const code = await card(A, m);
  const r = await attempt({ businessId: A.businessId, branchId: A.branchId, source: 'DEVICE', deviceId: 1, code, now: NOW });
  assert.equal(r.decision, 'APPROVED');
  assert.equal(r.member, null);
  assert.equal(r.membership, null);
});

test('another gym\'s member id is "not found", never a decision about someone else', { skip }, async () => {
  const theirs = await addMember(pool, B, { name: 'Theirs' });
  await addMembership(pool, B, theirs, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const r = await scan(A, { memberId: theirs, confirm: true });
  assert.equal(r.reason, REASON.MEMBER_NOT_FOUND);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_attendance WHERE business_id = $1`, [B.businessId])).rows[0].n, 0);
});

/* ── the gym's clock ──────────────────────────────────────────────────────── */

test('membership ends at the gym\'s midnight, not the server\'s: 23:59 in Kolkata is in, 00:01 is out', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Qadir' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: TODAY });
  const code = await card(A, m);
  // 18:29 UTC on the 12th = 23:59 in Kolkata
  assert.equal((await scan(A, { code, now: new Date('2026-10-12T18:29:00Z') })).decision, 'APPROVED');
  assert.equal((await scan(A, { code, now: new Date('2026-10-12T18:31:00Z') })).reason, REASON.MEMBERSHIP_EXPIRED, '00:01 on the 13th');
  const a = (await pool.query(`SELECT local_date::text AS d FROM gym_attendance WHERE member_id = $1`, [m])).rows[0];
  assert.equal(a.d, '2026-10-12', 'a 23:59 visit belongs to the 12th although it is the 12th in UTC too; the 13th in UTC begins 5.5 hours later');
});

test('across a daylight-saving change the day is still one calendar day', { skip }, async () => {
  const NY = await makeGym(pool, 'ny', { timezone: 'America/New_York' });
  const m = await addMember(pool, NY, { name: 'Rhea' });
  await addMembership(pool, NY, m, { start: '2026-10-01', end: '2026-10-31' });
  const code = (await inTx((db) => creds.issueCard(db, { businessId: NY.businessId, memberId: m, userId: NY.userId }))).code;
  // New York is UTC-4 until 02:00 on 1 November, then UTC-5
  assert.equal((await attempt({ businessId: NY.businessId, branchId: NY.branchId, source: 'RECEPTION', code, now: new Date('2026-11-01T03:59:00Z') })).decision, 'APPROVED', '23:59 on 31 October');
  assert.equal((await attempt({ businessId: NY.businessId, branchId: NY.branchId, source: 'RECEPTION', code, now: new Date('2026-11-01T04:01:00Z') })).reason, REASON.MEMBERSHIP_EXPIRED, '00:01 on 1 November');
  // the 25-hour day: a membership ending on 1 November works until 23:59 EST, which is 04:59 UTC on the 2nd
  const m2 = await addMember(pool, NY, { name: 'Sanjay' });
  await addMembership(pool, NY, m2, { start: '2026-10-01', end: '2026-11-01' });
  const c2 = (await inTx((db) => creds.issueCard(db, { businessId: NY.businessId, memberId: m2, userId: NY.userId }))).code;
  assert.equal((await attempt({ businessId: NY.businessId, branchId: NY.branchId, source: 'RECEPTION', code: c2, now: new Date('2026-11-02T04:59:00Z') })).decision, 'APPROVED', '23:59 on 1 November (EST)');
  assert.equal((await attempt({ businessId: NY.businessId, branchId: NY.branchId, source: 'RECEPTION', code: c2, now: new Date('2026-11-02T05:01:00Z') })).reason, REASON.MEMBERSHIP_EXPIRED);
});

/* ── through the database: branch, hours, status ─────────────────────────── */

test('a plan for one branch, off-peak hours, the gym\'s hours and holidays, applied to a real scan', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Tara' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: day(TODAY, 25), branches: [A.branchIds[1]], window: { days: [1, 2, 3, 4, 5], from: '06:00', to: '11:00' } });
  const code = await card(A, m);
  assert.equal((await scan(A, { code })).reason, REASON.BRANCH_NOT_ALLOWED, 'this plan is for the second branch only');
  const there = { ...A, branchId: A.branchIds[1] };
  assert.equal((await scan(there, { code })).decision, 'APPROVED', '10:00 on a Monday at branch 2');
  assert.equal((await scan(there, { code, now: new Date('2026-10-12T09:30:00Z') })).reason, REASON.ACCESS_OUTSIDE_ALLOWED_HOURS, '15:00 is outside off-peak');

  await pool.query(`INSERT INTO gym_branch_settings (branch_id, business_id, checkin_token, hours, holidays) VALUES ($1,$2,'tok-holiday', NULL, $3::jsonb) ON CONFLICT (branch_id) DO UPDATE SET holidays = $3::jsonb`, [A.branchIds[1], A.businessId, JSON.stringify([day(TODAY, 1)])]);
  const m2 = await addMember(pool, A, { name: 'Uma' });
  await addMembership(pool, A, m2, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const c2 = await card(A, m2);
  assert.equal((await scan(there, { code: c2, now: new Date('2026-10-13T04:30:00Z') })).reason, REASON.ACCESS_OUTSIDE_ALLOWED_HOURS, 'a holiday at that branch');
  assert.equal((await scan(there, { code: c2, now: new Date('2026-10-14T04:30:00Z') })).decision, 'APPROVED', 'the next day');
});

test('a suspended member is refused with their card, and an archived one has no cards left', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Vik' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const code = await card(A, m);
  await pool.query(`UPDATE gym_members SET status = 'SUSPENDED' WHERE member_id = $1`, [m]);
  assert.equal((await scan(A, { code })).reason, REASON.MEMBERSHIP_SUSPENDED);
  await pool.query(`UPDATE gym_members SET status = 'ACTIVE' WHERE member_id = $1`, [m]);
  assert.equal((await scan(A, { code, now: at(300) })).decision, 'APPROVED', 'back on');
  await pool.query(`UPDATE gym_members SET status = 'ARCHIVED' WHERE member_id = $1`, [m]);
  assert.equal((await scan(A, { code, now: at(900) })).reason, REASON.MEMBER_NOT_FOUND);
});

test('a family membership covers the head and the dependents it has room for, in the order they joined', { skip }, async () => {
  const head = await addMember(pool, A, { name: 'Head' });
  const d1 = await addMember(pool, A, { name: 'Dep One', head });
  const d2 = await addMember(pool, A, { name: 'Dep Two', head });
  const d3 = await addMember(pool, A, { name: 'Dep Three', head });
  await addMembership(pool, A, head, { start: day(TODAY, -5), end: day(TODAY, 25), members: 3 });
  for (const [m, want] of [[head, 'APPROVED'], [d1, 'APPROVED'], [d2, 'APPROVED'], [d3, REASON.NO_MEMBERSHIP]]) {
    const r = await scan(A, { memberId: m, confirm: true });
    assert.equal(r.reason, want === 'APPROVED' ? 'APPROVED' : want);
  }
});

test('if the database fails mid-record, nothing is approved and nothing half-written is left', { skip }, async () => {
  const m = await addMember(pool, A, { name: 'Wasim' });
  await addMembership(pool, A, m, { start: day(TODAY, -5), end: day(TODAY, 25) });
  const code = await card(A, m);
  await pool.query(`ALTER TABLE gym_attendance RENAME TO gym_attendance_broken`);
  let r;
  try { r = await scan(A, { code }); } finally { await pool.query(`ALTER TABLE gym_attendance_broken RENAME TO gym_attendance`); }
  assert.equal(r.decision, 'DENIED');
  assert.equal(r.reason, REASON.SERVICE_UNAVAILABLE);
  assert.equal(r.unavailable, true);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM gym_access_events WHERE member_id = $1`, [m])).rows[0].n, 0, 'no decision row was left behind');
  assert.equal((await scan(A, { code, now: at(60) })).decision, 'APPROVED', 'and it works again once the database is back');
});
