/* Owner reports: revenue split, renewal and churn, quiet members, wallet balances, and the CSV downloads. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addMember, addMembership, addPlan, day, makeGym } from './helpers/gym.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const members = (await import('../src/controllers/gymMembers.controller.js')).default;
const reports = (await import('../src/controllers/gymReports.controller.js')).default;
const walletApi = (await import('../src/controllers/gymWallet.controller.js')).default;

test.after(cleanup);

let A; let B; let plan; let sold;
const today = new Date().toISOString().slice(0, 10);
const okBody = (res, status = 200) => { assert.equal(res.code, status, JSON.stringify(res.body)); return res.body.data; };

test('setup', { skip }, async () => {
  await runMigrations(pool);
  A = await makeGym(pool, 'rep');
  B = await makeGym(pool, 'repB');
  plan = await addPlan(pool, A, { name: 'Monthly', price: 1000, duration: 30 });
  sold = okBody(await A.call(members.create, { body: { name: 'Sold Sam', phone: '9876500981' } }), 201).member_id;
  okBody(await A.call(members.sell, { params: { id: sold }, body: { plan_id: plan, payment: { method: 'UPI', amount: 'FULL' } } }), 201);
  okBody(await A.call(walletApi.deposit, { params: { id: sold }, body: { amount: 300, method: 'CASH' } }), 201);
});

test('revenue splits what was billed and shows how it was collected', { skip }, async () => {
  const d = okBody(await A.call(reports.revenue, { query: {} }));
  assert.equal(d.billed.membership.billed_paise, 118000);
  assert.equal(d.billed.shop.billed_paise, 0);
  assert.equal(d.collected_by_method[0].method, 'UPI');
  assert.equal(d.collected_paise, 118000, 'a wallet deposit is not a sale');
  assert.equal(okBody(await B.call(reports.revenue, { query: {} })).total_billed_paise, 0);
});

test('retention counts renewed and lapsed, and names members who have gone quiet', { skip }, async () => {
  const renewer = await addMember(pool, A, { name: 'Renews Ria', phone: '9876500982' });
  const leaver = await addMember(pool, A, { name: 'Leaves Lee', phone: '9876500983' });
  await addMembership(pool, A, renewer, { start: day(today, -40), end: day(today, -10) });
  await addMembership(pool, A, renewer, { start: day(today, -9), end: day(today, 20) });
  await addMembership(pool, A, leaver, { start: day(today, -40), end: day(today, -10) });
  const r = okBody(await A.call(reports.retention, { query: { from: day(today, -30), to: today } }));
  assert.equal(r.ended, 2);
  assert.equal(r.renewed, 1);
  assert.equal(r.renewal_rate, 50);
  assert.deepEqual(r.lapsed.map((m) => m.name), ['Leaves Lee']);
  assert.ok(r.quiet.some((m) => m.name === 'Renews Ria'), 'running membership, no visits');
  assert.equal(okBody(await B.call(reports.retention, { query: { from: day(today, -30), to: today } })).ended, 0);
});

test('the wallet report shows what is held; CSV downloads open in Excel', { skip }, async () => {
  const w = okBody(await A.call(reports.wallet, { query: {} }));
  assert.equal(w.held_paise, 30000);
  assert.equal(w.balances[0].name, 'Sold Sam');
  const res = await A.call(reports.wallet, { query: { format: 'csv' } });
  assert.match(res.text, /^﻿Member,Name,Phone,Balance/);
  assert.match(res.text, /Sold Sam,9876500981,300.00/);
  const bad = await A.call(reports.revenue, { query: { from: '2026-02-01', to: '2026-01-01' } });
  assert.equal(bad.code, 400);
});
