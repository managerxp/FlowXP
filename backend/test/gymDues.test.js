/* Dues control: the overdue list, a credit limit that stops the door, and a payment promise that lets the member in. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addPlan, makeGym } from './helpers/gym.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const members = (await import('../src/controllers/gymMembers.controller.js')).default;
const duesApi = (await import('../src/controllers/gymDues.controller.js')).default;
const { attempt } = await import('../src/modules/gym/access.js');
const { blockedByDues } = await import('../src/modules/gym/dues.js');

test.after(cleanup);

let A; let B; let member;
const okBody = (res, status = 200) => { assert.equal(res.code, status, JSON.stringify(res.body)); return res.body.data; };
const scan = () => attempt({ businessId: A.businessId, branchId: A.branchId, source: 'RECEPTION', now: new Date(), memberId: member, confirm: true });
const tomorrow = () => new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);

test('setup: a member with a part-paid membership (they may come in on any payment)', { skip }, async () => {
  await runMigrations(pool);
  A = await makeGym(pool, 'due');
  B = await makeGym(pool, 'dueB');
  const plan = await addPlan(pool, A, { name: 'Monthly', price: 1000, duration: 30, policy: 'ANY_PAYMENT' });
  member = okBody(await A.call(members.create, { body: { name: 'Meena', phone: '9876500961' } }), 201).member_id;
  okBody(await A.call(members.sell, { params: { id: member }, body: { plan_id: plan, payment: { method: 'CASH', amount: 400 } } }), 201);
});

test('the dues list shows what they owe, and only this gym sees it', { skip }, async () => {
  const d = okBody(await A.call(duesApi.list, { query: {} }));
  assert.equal(d.members, 1);
  assert.equal(d.rows[0].owed_paise, 78000);
  assert.equal(d.rows[0].over_limit, false);
  assert.equal(okBody(await B.call(duesApi.list, { query: {} })).members, 0);
  assert.equal(okBody(await A.call(duesApi.list, { query: { overdue_days: 5 } })).members, 0, 'a bill from today is not 5 days old');
});

test('without a limit they walk in; over the limit the door says payment due; a promise lets them in; paying clears it', { skip }, async () => {
  const first = await scan(); assert.equal(first.decision, 'APPROVED', JSON.stringify(first));
  okBody(await A.call(duesApi.setLimit, { params: { id: member }, body: { credit_limit: 500 } }));
  const stopped = await scan();
  assert.equal(stopped.decision, 'DENIED');
  assert.equal(stopped.reason, 'PAYMENT_REQUIRES_ATTENTION');
  assert.equal(okBody(await A.call(duesApi.list, { query: {} })).over_limit, 1);
  okBody(await A.call(duesApi.setPromise, { params: { id: member }, body: { promise_on: tomorrow(), amount: 780, note: 'pays on salary day' } }));
  const lifted = await scan(); assert.notEqual(lifted.reason, 'PAYMENT_REQUIRES_ATTENTION', 'the promise lifts the dues stop (a repeat scan is a duplicate, not a dues problem)');
  okBody(await A.call(duesApi.setLimit, { params: { id: member }, body: { credit_limit: '' } }));
  assert.equal((await pool.query(`SELECT credit_limit_paise FROM gym_members WHERE member_id = $1`, [member])).rows[0].credit_limit_paise, null);
});

test('a promise cannot be in the past; blockedByDues is the whole rule', { skip }, async () => {
  assert.equal((await A.call(duesApi.setPromise, { params: { id: member }, body: { promise_on: '2020-01-01' } })).code, 400);
  const m = { credit_limit_paise: 50000, owed_paise: 78000, promise_on: null };
  assert.equal(blockedByDues(m, '2026-11-22'), true);
  assert.equal(blockedByDues({ ...m, promise_on: '2026-11-22' }, '2026-11-22'), false);
  assert.equal(blockedByDues({ ...m, promise_on: '2026-11-21' }, '2026-11-22'), true);
  assert.equal(blockedByDues({ ...m, credit_limit_paise: null }, '2026-11-22'), false);
  assert.equal(blockedByDues({ ...m, owed_paise: 50000 }, '2026-11-22'), false, 'owing exactly the limit is allowed');
});
