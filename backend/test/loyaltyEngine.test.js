import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { LoyaltyError, pointsFor, programmeFields, redemptionValue } from '../src/modules/loyaltyEngine.js';

const rules = (o = {}) => programmeFields({ name: 'Points', kind: 'POINTS', earn_points: 10, per_amount_paise: 10000, redeem_points: 100, redeem_value_paise: 5000, min_redeem_points: 100, ...o });

test('points: earned per amount, rounded down, nothing under the minimum bill, a multiplier for a tier', () => {
  const p = { ...rules({ min_txn_paise: 20000 }) };
  assert.equal(pointsFor(p, 25000), 25);          // 10 points per Rs 100 -> Rs 250 earns 25
  assert.equal(pointsFor(p, 19999), 0);           // under the minimum bill
  assert.equal(pointsFor(p, 25000, 2), 50);
  const stamp = programmeFields({ name: 'Stamps', kind: 'STAMPS', earn_points: 1, redeem_points: 5 });
  assert.equal(pointsFor(stamp, 100), 1);         // a stamp per bill, whatever it came to
});

test('a programme is checked: type, name, amounts, dates and the stamp-card rule', () => {
  assert.throws(() => programmeFields({ name: 'x', kind: 'CASHBACK' }), LoyaltyError);   // not built yet, so not offered
  assert.throws(() => programmeFields({ kind: 'POINTS', per_amount_paise: 100 }), /name/);
  assert.throws(() => rules({ per_amount_paise: 0 }), LoyaltyError);
  assert.throws(() => rules({ starts_on: '2026-02-01', ends_on: '2026-01-01' }), /end date/);
  assert.throws(() => rules({ max_redeem_per_txn: 50 }), /most on one bill/i);
  assert.equal(programmeFields({ name: 'S', kind: 'STAMPS', redeem_points: 5, min_redeem_points: 1 }).min_redeem_points, 5);
});

test('redeeming: the balance, the minimum, the most on one bill, and whole rewards for a stamp card', () => {
  const p = rules({ max_redeem_per_txn: 300 });
  assert.equal(redemptionValue(p, 500, 100), 5000);   // 100 points = Rs 50
  assert.throws(() => redemptionValue(p, 500, 50), /least/);
  assert.throws(() => redemptionValue(p, 80, 100), /available/);
  assert.throws(() => redemptionValue(p, 900, 400), /At most/);
  const s = programmeFields({ name: 'S', kind: 'STAMPS', redeem_points: 5, redeem_value_paise: 0 });
  assert.throws(() => redemptionValue(s, 12, 7), /multiples of 5/);
});

const { pool, skip, cleanup } = await setupTestDb();
test.after(cleanup);

let ready;
const setup = () => (ready ||= build());
const build = async () => {
  const { runMigrations } = await import('../src/config/migrate.js');
  await runMigrations(pool);
  const engine = await import('../src/modules/loyaltyEngine.js');
  const { withTransaction } = await import('../src/modules/wholesale/common.js');
  const mk = async (tag) => {
    const u = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [`Owner ${tag}`, `le-${tag}@fx.test`])).rows[0];
    const b = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, state) VALUES ($1,$2,'RETAIL','Karnataka') RETURNING business_id`, [`Shop ${tag}`, u.user_id])).rows[0];
    const c = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Asha','9845011111') RETURNING customer_id`, [b.business_id])).rows[0];
    return { businessId: b.business_id, customerId: c.customer_id };
  };
  const A = await mk('a');
  const B = await mk('b');
  const prog = async (biz, o = {}) => (await pool.query(
    `INSERT INTO loyalty_programmes (business_id, name, kind, earn_points, per_amount_paise, redeem_points, redeem_value_paise, min_redeem_points) VALUES ($1,'Points','POINTS',10,10000,100,5000,100) RETURNING *`, [biz.businessId])).rows[0];
  return { engine, withTransaction, A, B, prog };
};

test('earn once per bill: a retry or a second request for the same invoice credits nothing more', { skip }, async () => {
  const { engine, withTransaction, A, prog } = await setup();
  const p = await prog(A);
  const { membership: m, created } = await withTransaction((c) => engine.enrol(c, { businessId: A.businessId, programmeId: p.programme_id, customerId: A.customerId }));
  assert.equal(created, true);
  assert.equal((await withTransaction((c) => engine.enrol(c, { businessId: A.businessId, programmeId: p.programme_id, customerId: A.customerId }))).created, false);   // no duplicate membership

  const inv = (await pool.query(`INSERT INTO invoices (business_id, customer_id, invoice_number, total_paise) VALUES ($1,$2,'T-1',50000) RETURNING invoice_id`, [A.businessId, A.customerId]).catch(() => ({ rows: [{ invoice_id: 9001 }] }))).rows[0];
  const one = await withTransaction((c) => engine.earn(c, { businessId: A.businessId, membershipId: m.membership_id, amountPaise: 50000, invoiceId: inv.invoice_id }));
  assert.equal(one.points, 50); assert.equal(one.balance, 50); assert.equal(one.duplicate, false);
  const again = await withTransaction((c) => engine.earn(c, { businessId: A.businessId, membershipId: m.membership_id, amountPaise: 50000, invoiceId: inv.invoice_id }));
  assert.equal(again.duplicate, true); assert.equal(again.balance, 50);
  await assert.rejects(() => withTransaction((c) => engine.earn(c, { businessId: A.businessId, membershipId: m.membership_id, amountPaise: 100 })), /request key or an invoice/);
});

test('two redemptions at once cannot spend the same points; a repeated key does not spend twice', { skip }, async () => {
  const { engine, withTransaction, A, prog } = await setup();
  const p = await prog(A);
  const ravi = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Ravi','9845022222') RETURNING customer_id`, [A.businessId])).rows[0].customer_id;
  const m = (await withTransaction((c) => engine.enrol(c, { businessId: A.businessId, programmeId: p.programme_id, customerId: ravi }))).membership;
  await withTransaction((c) => engine.earn(c, { businessId: A.businessId, membershipId: m.membership_id, amountPaise: 150000, key: 'earn-1' }));   // 150 points
  const go = (key) => withTransaction((c) => engine.redeem(c, { businessId: A.businessId, membershipId: m.membership_id, points: 100, key }));
  const results = await Promise.allSettled([go('r1'), go('r2')]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);   // only one 100-point redemption fits in 150
  assert.match(results.find((r) => r.status === 'rejected').reason.message, /available/);
  const won = results.find((r) => r.status === 'fulfilled').value;
  assert.equal(won.value_paise, 5000);
  const retry = await go(won.entry.idempotency_key);
  assert.equal(retry.duplicate, true);
  assert.equal((await engine.balanceOf(pool, m.membership_id)).balance, 50);
  await assert.rejects(go(''), /request key/);
});

test('reversals: partial, then the rest, never more; the ledger row itself can never be edited', { skip }, async () => {
  const { engine, withTransaction, A, prog } = await setup();
  const p = await prog(A);
  const cust = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Mani','9845033333') RETURNING customer_id`, [A.businessId])).rows[0].customer_id;
  const m = (await withTransaction((c) => engine.enrol(c, { businessId: A.businessId, programmeId: p.programme_id, customerId: cust }))).membership;
  const e = (await withTransaction((c) => engine.earn(c, { businessId: A.businessId, membershipId: m.membership_id, amountPaise: 100000, key: 'e1' }))).entry;   // 100 points
  const r1 = await withTransaction((c) => engine.reverse(c, { businessId: A.businessId, entryId: e.entry_id, points: 30, key: 'rv1' }));
  assert.equal(r1.balance, 70);
  assert.equal((await withTransaction((c) => engine.reverse(c, { businessId: A.businessId, entryId: e.entry_id, points: 30, key: 'rv1' }))).duplicate, true);   // a retry is not a second reversal
  await assert.rejects(() => withTransaction((c) => engine.reverse(c, { businessId: A.businessId, entryId: e.entry_id, points: 80, key: 'rv2' })), /Only 70/);
  assert.equal((await withTransaction((c) => engine.reverse(c, { businessId: A.businessId, entryId: e.entry_id, key: 'rv3' }))).balance, 0);
  await assert.rejects(() => withTransaction((c) => engine.reverse(c, { businessId: A.businessId, entryId: e.entry_id, key: 'rv4' })), /already been reversed/);
  await assert.rejects(() => pool.query(`UPDATE points_ledger SET points = 999 WHERE entry_id = $1`, [e.entry_id]), /cannot be changed/);

  // a redemption given back returns the points
  const e2 = (await withTransaction((c) => engine.earn(c, { businessId: A.businessId, membershipId: m.membership_id, amountPaise: 200000, key: 'e2' }))).entry;
  const spent = (await withTransaction((c) => engine.redeem(c, { businessId: A.businessId, membershipId: m.membership_id, points: 100, key: 's1' }))).entry;
  assert.equal((await engine.balanceOf(pool, m.membership_id)).balance, 100);
  assert.equal((await withTransaction((c) => engine.reverse(c, { businessId: A.businessId, entryId: spent.entry_id, key: 'rs1' }))).balance, 200);
  assert.ok(e2);
});

test('a refund takes back its share of the points, and no more than the balance holds', { skip }, async () => {
  const { engine, withTransaction, A, prog } = await setup();
  const p = await prog(A);
  const cust = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Lata','9845044444') RETURNING customer_id`, [A.businessId])).rows[0].customer_id;
  const m = (await withTransaction((c) => engine.enrol(c, { businessId: A.businessId, programmeId: p.programme_id, customerId: cust }))).membership;
  await pool.query(`INSERT INTO points_ledger (business_id, customer_id, invoice_id, kind, points, amount_paise, programme_id, membership_id, idempotency_key) VALUES ($1,$2,777,'EARN',100,100000,$3,$4,'inv777')`, [A.businessId, cust, p.programme_id, m.membership_id]);
  await withTransaction((c) => engine.reverseForRefund(c, { businessId: A.businessId, invoiceId: 777, refundedPaise: 25000, totalPaise: 100000, key: 'cn1' }));
  assert.equal((await engine.balanceOf(pool, m.membership_id)).balance, 75);   // a quarter of the bill refunded: a quarter of the points
  await withTransaction((c) => engine.reverseForRefund(c, { businessId: A.businessId, invoiceId: 777, refundedPaise: 25000, totalPaise: 100000, key: 'cn1' }));   // the same credit note again
  assert.equal((await engine.balanceOf(pool, m.membership_id)).balance, 75);
  await withTransaction((c) => engine.reverseForRefund(c, { businessId: A.businessId, invoiceId: 777, refundedPaise: 100000, totalPaise: 100000, key: 'cn2' }));   // the rest of the bill
  assert.equal((await engine.balanceOf(pool, m.membership_id)).balance, 0);
});

test('one business can never see or use another business\'s members', { skip }, async () => {
  const { engine, withTransaction, A, B, prog } = await setup();
  const p = await prog(A);
  const cust = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Zoya','9845055555') RETURNING customer_id`, [A.businessId])).rows[0].customer_id;
  const m = (await withTransaction((c) => engine.enrol(c, { businessId: A.businessId, programmeId: p.programme_id, customerId: cust }))).membership;
  await assert.rejects(() => engine.findMembership(pool, B.businessId, { token: m.token }), /No membership/);
  await assert.rejects(() => engine.findMembership(pool, B.businessId, { membershipNo: m.membership_no }), /No membership/);
  await assert.rejects(() => engine.findMembership(pool, B.businessId, { phone: '9845055555' }), /No membership/);
  await assert.rejects(() => withTransaction((c) => engine.earn(c, { businessId: B.businessId, membershipId: m.membership_id, amountPaise: 10000, key: 'x' })), /not found/);
  await assert.rejects(() => withTransaction((c) => engine.enrol(c, { businessId: B.businessId, programmeId: p.programme_id, customerId: B.customerId })), /not found/);   // not even by programme id
  assert.equal((await engine.findMembership(pool, A.businessId, { token: m.token }))[0].membership_id, m.membership_id);
});

test('expired, switched-off, out-of-dates, wrong-outlet and over-limit cards are refused', { skip }, async () => {
  const { engine, withTransaction, A, prog } = await setup();
  const p = await prog(A);
  const mk = async (name, phone) => {
    const cid = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [A.businessId, name, phone])).rows[0].customer_id;
    return (await withTransaction((c) => engine.enrol(c, { businessId: A.businessId, programmeId: p.programme_id, customerId: cid }))).membership;
  };
  const earn = (m, extra = {}) => withTransaction((c) => engine.earn(c, { businessId: A.businessId, membershipId: m.membership_id, amountPaise: 10000, key: `k${Math.random()}`, ...extra }));

  const expired = await mk('Old', '9845066661');
  await pool.query(`UPDATE loyalty_memberships SET expires_at = CURRENT_TIMESTAMP - interval '1 day' WHERE membership_id = $1`, [expired.membership_id]);
  await assert.rejects(earn(expired), /expired/);

  const off = await mk('Off', '9845066662');
  await pool.query(`UPDATE loyalty_memberships SET status = 'INACTIVE' WHERE membership_id = $1`, [off.membership_id]);
  await assert.rejects(earn(off), /switched off/);

  const fine = await mk('Fine', '9845066663');
  await pool.query(`UPDATE loyalty_programmes SET branch_ids = ARRAY[999] WHERE programme_id = $1`, [p.programme_id]);
  await assert.rejects(earn(fine, { branchId: 5 }), /not offered at this outlet/);
  await pool.query(`UPDATE loyalty_programmes SET branch_ids = NULL, ends_on = CURRENT_DATE - 1 WHERE programme_id = $1`, [p.programme_id]);
  await assert.rejects(earn(fine), /has ended/);
  await pool.query(`UPDATE loyalty_programmes SET ends_on = NULL, is_active = FALSE WHERE programme_id = $1`, [p.programme_id]);
  await assert.rejects(earn(fine), /switched off/);

  await pool.query(`UPDATE loyalty_programmes SET is_active = TRUE, reward_limit_per_member = 1 WHERE programme_id = $1`, [p.programme_id]);
  await earn(fine, { amountPaise: 500000 });
  const redeem = (key) => withTransaction((c) => engine.redeem(c, { businessId: A.businessId, membershipId: fine.membership_id, points: 100, key }));
  await redeem('lim1');
  await assert.rejects(redeem('lim2'), /already had the 1 reward/);
});
