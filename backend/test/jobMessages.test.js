/* Workshop updates to the customer: received, estimate, ready, next service due. Only on a plan with messaging and a channel that is on; nothing is really sent (log provider). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { makeShop } from './helpers/autoparts.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const jobs = (await import('../src/controllers/autopartsJobcards.controller.js')).default;
const { sendJobUpdate, runServiceDue } = await import('../src/modules/autoparts/jobMessages.js');

test.after(cleanup);

let S; let tenant; let customer;
const call = (handler, extra, t = tenant) => S.call(handler, extra, t);
const data = (res, code = 200) => { assert.equal(res.code, code, JSON.stringify(res.body)); return res.body.data; };
const sent = async (kind) => (await pool.query(`SELECT kind, body, related_id FROM messages WHERE business_id = $1 AND kind = $2 ORDER BY message_id`, [S.businessId, kind])).rows;

test('setup', { skip }, async () => {
  await runMigrations(pool);
  S = await makeShop(pool, 'jm');
  tenant = { ...S.tenantFor(), planFeatures: { messaging: true } };
  customer = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Anil Kumar','9000000020') RETURNING customer_id`, [S.businessId])).rows[0].customer_id;
  await pool.query(`UPDATE businesses SET messaging_settings = $2 WHERE business_id = $1`, [S.businessId, JSON.stringify({ channel: 'WHATSAPP' })]);
});

test('opening a card tells the customer; marking it ready tells them again; the estimate goes when the counter sends it', { skip }, async () => {
  const job = data(await call(jobs.create, { body: { customer_id: customer, vehicle_reg: 'KA01AB1234', vehicle_type: 'CAR', make: 'Maruti', model: 'Swift', complaint: 'Brake noise' } }), 201);
  await new Promise((r) => setTimeout(r, 300));
  const got = await sent('JOB_RECEIVED');
  assert.equal(got.length, 1);
  assert.match(got[0].body, /received your Maruti Swift KA01AB1234 at .*Job card /);
  assert.equal(got[0].related_id, job.job_id);

  assert.equal((await sendJobUpdate(tenant, job.job_id, 'estimate', { manual: true })).skipped, 'NO_ESTIMATE', 'nothing on the card yet');
  data(await call(jobs.lineAdd, { params: { id: String(job.job_id) }, body: { kind: 'LABOUR', description: 'Brake service', unit_price: 500, tax_rate: 18 } }), 201);
  const est = await sendJobUpdate(tenant, job.job_id, 'estimate', { manual: true });
  assert.ok(!est.skipped, JSON.stringify(est));
  assert.match((await sent('JOB_ESTIMATE'))[0].body, /is ₹590 including GST/);

  data(await call(jobs.status, { params: { id: String(job.job_id) }, body: { status: 'READY' } }));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await sent('JOB_READY')).length, 1);
});

test('no plan, switched off, or no number: nothing goes; a manual send ignores only the switch', { skip }, async () => {
  const before = (await pool.query(`SELECT COUNT(*)::int AS n FROM messages WHERE business_id = $1`, [S.businessId])).rows[0].n;
  const job = data(await call(jobs.create, { body: { customer_id: customer, vehicle_reg: 'KA02CD5678', vehicle_type: 'BIKE' } }), 201);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM messages WHERE business_id = $1`, [S.businessId])).rows[0].n, before + 1);

  assert.equal((await sendJobUpdate({ ...tenant, planFeatures: { messaging: false } }, job.job_id, 'ready', { manual: true })).skipped, 'PLAN');
  await pool.query(`UPDATE businesses SET messaging_settings = $2 WHERE business_id = $1`, [S.businessId, JSON.stringify({ channel: 'WHATSAPP', job_updates: false })]);
  assert.equal((await sendJobUpdate(tenant, job.job_id, 'ready')).skipped, 'SWITCHED_OFF');
  assert.ok(!(await sendJobUpdate(tenant, job.job_id, 'ready', { manual: true })).skipped, 'the counter pressed send');
  await pool.query(`UPDATE customers SET phone = NULL WHERE customer_id = $1`, [customer]);
  assert.equal((await sendJobUpdate(tenant, job.job_id, 'ready', { manual: true })).skipped, 'NO_PHONE');
  await pool.query(`UPDATE customers SET phone = '9000000020' WHERE customer_id = $1`, [customer]);
  await pool.query(`UPDATE businesses SET messaging_settings = $2 WHERE business_id = $1`, [S.businessId, JSON.stringify({ channel: 'WHATSAPP' })]);
});

test('the service reminder goes once, three days ahead, to a vehicle that was billed', { skip }, async () => {
  const job = data(await call(jobs.create, { body: { customer_id: customer, vehicle_reg: 'KA03EF9999', vehicle_type: 'CAR' } }), 201);
  await pool.query(`UPDATE job_cards SET status = 'BILLED', billed_at = now(), next_service_on = CURRENT_DATE + 2 WHERE job_id = $1`, [job.job_id]);
  await pool.query(`UPDATE businesses SET plan_code = 'TRIAL' WHERE business_id = $1`, [S.businessId]);
  assert.equal(await runServiceDue({ force: true }), 1);
  const got = await sent('SERVICE_DUE');
  assert.equal(got.length, 1);
  assert.match(got[0].body, /KA03EF9999 is due for its next service on /);
  assert.equal(await runServiceDue({ force: true }), 0, 'never twice for the same visit');
});
