/*
 * FlowXP Mechanic, foundation: the MECHANIC business type, the shared vehicle master (seeded from the supplied lists) filtered by garage kind, and a garage using the job card engine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { makeShop } from './helpers/autoparts.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const jobs = (await import('../src/controllers/autopartsJobcards.controller.js')).default;
const master = await import('../src/modules/mechanic/vehicleMaster.js');
const { isParts, vehicleTypesFor } = await import('../src/modules/mechanic/types.js');
const { partsOnly } = await import('../src/modules/autoparts/common.js');
const { checkSignupType, checkBusinessType } = await import('../src/utils/validate.js');
const { industryDefaults, effectiveFeatureFlags } = await import('../src/modules/planFeatures.js');

test.after(cleanup);

let G; // a garage (kind set per test through the tenant)
const tenant = (kind) => ({ ...G.tenantFor(), garageKind: kind });
const call = (handler, extra, t) => G.call(handler, extra, t);

test('setup', { skip }, async () => {
  await runMigrations(pool);
  G = await makeShop(pool, 'mech', { type: 'MECHANIC' });
});

test('MECHANIC is a business type that can be chosen at signup, and counts as a parts shop with the workshop on', () => {
  assert.equal(checkSignupType('MECHANIC'), null);
  assert.equal(checkBusinessType('mechanic'), null);
  assert.ok(isParts('MECHANIC') && isParts('AUTO_PARTS') && !isParts('CLOTHING'));
  const off = industryDefaults('MECHANIC');
  assert.equal(off.ap_jobcards, undefined, 'job cards stay on');
  assert.equal(off.ap_staff, undefined, 'staff stays on');
  assert.equal(off.cl_catalog, false, 'the clothing catalogue is not for a garage');
  assert.equal(effectiveFeatureFlags([{}, {}], {}, 'MECHANIC', false).ap_jobcards, undefined, 'a garage has no mechanic-mode switch to turn it off');
  assert.deepEqual([vehicleTypesFor('BIKE'), vehicleTypesFor('CAR'), vehicleTypesFor('BOTH'), vehicleTypesFor(null)], [['BIKE'], ['CAR'], ['BIKE', 'CAR'], ['BIKE', 'CAR']]);
  let status = 0; let nexted = false;
  partsOnly({ tenant: { businessType: 'MECHANIC' } }, { status(c) { status = c; return { json() {} }; } }, () => { nexted = true; });
  assert.deepEqual([status, nexted], [0, true], 'the parts routes open for a garage');
});

test('the vehicle master is seeded with bikes, scooters and cars, old and new', { skip }, async () => {
  const r = (await pool.query(`SELECT vehicle_type, availability, count(*)::int AS n FROM vehicle_master GROUP BY 1, 2`)).rows;
  const n = (t, a) => r.find((x) => x.vehicle_type === t && x.availability === a)?.n ?? 0;
  assert.ok(n('BIKE', 'CURRENT') > 250 && n('CAR', 'CURRENT') > 350 && n('CAR', 'DISCONTINUED') > 200 && n('BIKE', 'UPCOMING') > 0);
  assert.equal(n('BIKE', 'DISCONTINUED'), 0);
});

test('a bike garage sees only two-wheeler brands; a car garage only cars; both see both', { skip }, async () => {
  const bike = await master.lookup(pool, tenant('BIKE'), {});
  const car = await master.lookup(pool, tenant('CAR'), {});
  const both = await master.lookup(pool, tenant('BOTH'), {});
  assert.ok(bike.brands.length > 10 && bike.brands.every((b) => b.vehicle_type === 'BIKE'));
  assert.ok(car.brands.every((b) => b.vehicle_type === 'CAR'));
  assert.ok(bike.brands.some((b) => /honda/i.test(b.brand)) && bike.brands.some((b) => /hero/i.test(b.brand)));
  assert.ok(both.brands.some((b) => b.vehicle_type === 'BIKE') && both.brands.some((b) => b.vehicle_type === 'CAR'));
  // a bike garage that asks for cars still gets bikes; a both-garage can narrow
  assert.deepEqual((await master.lookup(pool, tenant('BIKE'), { type: 'CAR' })).types, ['BIKE']);
  assert.deepEqual((await master.lookup(pool, tenant('BOTH'), { type: 'car' })).types, ['CAR']);
});

test('models of a brand: discontinued ones are there, upcoming ones only when asked; search works', { skip }, async () => {
  const swift = await master.lookup(pool, tenant('CAR'), { brand: 'maruti suzuki' });
  assert.ok(swift.models.length > 5 && swift.models.every((m) => Array.isArray(m.fuels) && m.fuels.length));
  assert.ok(swift.models.some((m) => m.availability === 'DISCONTINUED') || (await master.lookup(pool, tenant('CAR'), { brand: 'Audi' })).models.some((m) => m.availability === 'DISCONTINUED'), 'older models are in');
  const upcomingBike = (await pool.query(`SELECT brand, model FROM vehicle_master WHERE availability = 'UPCOMING' AND vehicle_type = 'BIKE' LIMIT 1`)).rows[0];
  const hidden = await master.lookup(pool, tenant('BIKE'), { brand: upcomingBike.brand });
  assert.ok(!hidden.models.some((m) => m.model === upcomingBike.model), 'an announced model is not offered as a customer vehicle');
  const shown = await master.lookup(pool, tenant('BIKE'), { brand: upcomingBike.brand, upcoming: '1' });
  assert.ok(shown.models.some((m) => m.model === upcomingBike.model));
  const found = await master.lookup(pool, tenant('BIKE'), { search: 'activa' });
  assert.ok(found.brands.some((b) => /honda/i.test(b.brand)));
});

test('the vehicle master route is for billing staff of a garage with job cards on; a garage runs a job card with a vehicle from the master', { skip }, async () => {
  const res = await call(jobs.vehicleMaster, { query: { brand: 'Honda' } }, tenant('BIKE'));
  assert.equal(res.code, 200);
  assert.ok(res.body.data.models.length > 3);
  const model = res.body.data.models[0].model;
  const cust = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Rahul','9000000020') RETURNING customer_id`, [G.businessId])).rows[0].customer_id;
  const made = await call(jobs.create, { body: { customer_id: cust, vehicle_reg: 'KA03AB1234', vehicle_type: 'BIKE', make: 'Honda', model, complaint: 'Service' } }, tenant('BIKE'));
  assert.equal(made.code, 201, JSON.stringify(made.body));
  assert.equal(made.body.data.make, 'Honda');
  assert.equal(made.body.data.model, model);
});

test('the garage day: vehicles by stage, what was collected today, what customers owe', { skip }, async () => {
  const { today } = await import('../src/modules/mechanic/today.js');
  const t0 = await today(pool, tenant('BOTH'));
  const cust = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Sita','9000000030') RETURNING customer_id`, [G.businessId])).rows[0].customer_id;
  const mk = async (reg) => (await call(jobs.create, { body: { customer_id: cust, vehicle_reg: reg, vehicle_type: 'CAR', make: 'Maruti Suzuki', model: 'Swift', complaint: 'Noise' } }, tenant('BOTH'))).body.data;
  const a = await mk('KA01AA1111'); await mk('KA01AA2222');
  assert.equal((await call(jobs.status, { params: { id: a.job_id }, body: { status: 'READY' } }, tenant('BOTH'))).code, 200);
  const t1 = await today(pool, tenant('BOTH'));
  assert.equal(t1.received_today, t0.received_today + 2);
  assert.equal(t1.in_progress, t0.in_progress + 1);
  assert.equal(t1.ready, t0.ready + 1);
  assert.ok(t1.work.length >= 2 && t1.work[0].status === 'READY', 'ready vehicles come first');
  // a payment today counts as collected; a supplier payment does not
  await pool.query(`INSERT INTO payments (business_id, branch_id, customer_id, payment_method, amount_paise) VALUES ($1,$2,$3,'CASH',50000),($1,$2,$3,'UPI',20000)`, [G.businessId, G.branchId, cust]);
  const t2 = await today(pool, tenant('BOTH'));
  assert.equal(t2.collected_paise - t1.collected_paise, 70000);
  assert.equal(t2.cash_collected_paise - t1.cash_collected_paise, 50000);
  const other = await makeShop(pool, 'mech2', { type: 'MECHANIC' });
  assert.equal((await today(pool, { ...other.tenantFor(), garageKind: 'BOTH' })).collected_paise, 0, 'another garage sees none of it');
});

test('job card flow: checking stage, intake notes, the customer\'s yes on record, and delivery only after billing', { skip }, async () => {
  const { today } = await import('../src/modules/mechanic/today.js');
  const T = tenant('BOTH');
  const cust = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Abdul','9000000040') RETURNING customer_id`, [G.businessId])).rows[0].customer_id;
  const made = await call(jobs.create, { body: { customer_id: cust, vehicle_reg: 'KA05ZZ4040', vehicle_type: 'CAR', make: 'Hyundai', model: 'Creta', complaint: 'AC' } }, T);
  const id = made.body.data.job_id;
  const st = (status) => call(jobs.status, { params: { id }, body: { status } }, T);
  assert.equal((await st('CHECKING')).body.data.status, 'CHECKING');
  assert.equal([].concat((await call(jobs.list, { query: { status: 'LIVE' } }, T)).body.data.rows ?? (await call(jobs.list, { query: { status: 'LIVE' } }, T)).body.data).some((j) => j.job_id === id), true, 'a vehicle being checked is still in the garage');
  const put = await call(jobs.update, { params: { id }, body: { fuel_level: 'HALF', belongings: 'Phone charger, umbrella' } }, T);
  assert.equal(put.body.data.fuel_level, 'HALF');
  assert.equal((await call(jobs.update, { params: { id }, body: { fuel_level: 'BRIMMING' } }, T)).code, 400);
  assert.equal((await call(jobs.approve, { params: { id }, body: {} }, T)).code, 400, 'nothing to approve before there is an estimate');
  await call(jobs.lineAdd, { params: { id }, body: { kind: 'LABOUR', description: 'AC gas refill', unit_price: 1500 } }, T);
  const ok = await call(jobs.approve, { params: { id }, body: { how: 'Said yes on the phone' } }, T);
  assert.equal(ok.code, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.estimate_approved_by, 'Said yes on the phone');
  assert.ok(ok.body.data.estimate_approved_at);
  assert.equal((await call(jobs.deliver, { params: { id } }, T)).code, 409, 'cannot hand over before billing');
  const before = (await today(pool, T)).delivered_today;
  assert.equal((await call(jobs.bill, { params: { id }, body: {}, headers: {} }, T)).code, 201);
  assert.equal((await call(jobs.deliver, { params: { id } }, T)).code, 200);
  assert.equal((await today(pool, T)).delivered_today, before + 1);
  assert.equal((await call(jobs.deliver, { params: { id } }, T)).code, 200, 'handing over twice changes nothing');
  assert.equal((await today(pool, T)).delivered_today, before + 1);
});

test('Money In and Money Out: customer payments and other income in; expenses and supplier payments out; the day card agrees', { skip }, async () => {
  const { today } = await import('../src/modules/mechanic/today.js');
  const { book } = await import('../src/modules/mechanic/money.js');
  const T = tenant('BOTH');
  const day = (await today(pool, T)).day;
  const t0 = await today(pool, T); const b0 = await book(pool, T, { from: day, to: day });
  const cust = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Money','9000000050') RETURNING customer_id`, [G.businessId])).rows[0].customer_id;
  const sup = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,'Parts House') RETURNING supplier_id`, [G.businessId])).rows[0].supplier_id;
  await pool.query(`INSERT INTO payments (business_id, branch_id, customer_id, payment_method, amount_paise, notes) VALUES ($1,$2,$3,'CASH',100000,'Advance'),($1,$2,$3,'CREDIT',999900,'on credit'),($1,$2,NULL,'UPI',30000,'to supplier')`, [G.businessId, G.branchId, cust]);
  await pool.query(`UPDATE payments SET supplier_id = $1 WHERE notes = 'to supplier' AND business_id = $2`, [sup, G.businessId]);
  await pool.query(`INSERT INTO other_income (business_id, branch_id, category, amount_paise, payment_method) VALUES ($1,$2,'Scrap sale',20000,'CASH')`, [G.businessId, G.branchId]);
  await pool.query(`INSERT INTO expenses (business_id, branch_id, category, amount_paise, payment_method) VALUES ($1,$2,'Tea and food',5000,'CASH')`, [G.businessId, G.branchId]);
  const b1 = await book(pool, T, { from: day, to: day });
  assert.equal(b1.in.total_paise - b0.in.total_paise, 120000, 'a pay-later entry is not money in');
  assert.equal(b1.out.total_paise - b0.out.total_paise, 35000, 'expense plus supplier payment');
  assert.ok(b1.in.entries.some((e) => e.kind === 'OTHER_IN' && e.who === 'Scrap sale') && b1.out.entries.some((e) => e.kind === 'SUPPLIER' && e.who === 'Parts House'));
  const t1 = await today(pool, T);
  assert.equal(t1.collected_paise - t0.collected_paise, 120000);
  assert.equal(t1.spent_paise - t0.spent_paise, 35000);
  assert.equal(t1.cash_in_hand_paise - t0.cash_in_hand_paise, 120000 - 5000, 'cash in hand: cash in less cash out (the UPI payment is not cash)');
  const other = await makeShop(pool, 'mech3', { type: 'MECHANIC' });
  assert.equal((await book(pool, { ...other.tenantFor(), garageKind: 'BOTH' }, { from: day, to: day })).in.total_paise, 0, 'another garage sees none of it');
});

test('the garage steps are for a garage only: a parts shop job card has no Checking, approval, handover or fuel notes', { skip }, async () => {
  const P = await makeShop(pool, 'partsshop', { type: 'AUTO_PARTS' });
  const pc = (handler, extra) => P.call(handler, extra, P.tenantFor());
  const cust = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Plain','9000000060') RETURNING customer_id`, [P.businessId])).rows[0].customer_id;
  const made = await pc(jobs.create, { body: { customer_id: cust, vehicle_reg: 'KA09PP0001', vehicle_type: 'CAR', make: 'Honda', model: 'City', complaint: 'Noise' } });
  assert.equal(made.code, 201, JSON.stringify(made.body));
  const id = made.body.data.job_id;
  assert.equal((await pc(jobs.status, { params: { id }, body: { status: 'CHECKING' } })).code, 400);
  assert.equal((await pc(jobs.status, { params: { id }, body: { status: 'IN_PROGRESS' } })).code, 200, 'the usual steps still work');
  assert.equal((await pc(jobs.approve, { params: { id }, body: {} })).code, 404);
  assert.equal((await pc(jobs.deliver, { params: { id } })).code, 404);
  const put = await pc(jobs.update, { params: { id }, body: { notes: 'checked', fuel_level: 'HALF', belongings: 'bag' } });
  assert.equal(put.body.data.fuel_level, null, 'fuel is ignored on a parts shop card');
});
