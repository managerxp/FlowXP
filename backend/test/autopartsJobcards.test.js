/*
 * Auto parts workshop: job cards (a vehicle in for service, its parts held for the customer, labour, one bill) and the staff and payroll a workshop needs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addPart, makeShop } from './helpers/autoparts.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const jobs = (await import('../src/controllers/autopartsJobcards.controller.js')).default;
const staff = (await import('../src/controllers/hotelStaff.controller.js')).default;
const { estimateOf } = await import('../src/modules/autoparts/jobcards.js');

test.after(cleanup);

test('the estimate on a card: parts and labour before tax, the tax, the total', () => {
  const e = estimateOf([{ kind: 'PART', quantity: 2, unit_price_paise: 100000, tax_rate: 18 }, { kind: 'LABOUR', quantity: 1, unit_price_paise: 50000, tax_rate: 18 }]);
  assert.deepEqual(e, { parts_paise: 200000, labour_paise: 50000, tax_paise: 45000, total_paise: 295000 });
});

let S; let tenant; let customer; let pad; let oil; let mechanic;
const call = (handler, extra, t = tenant) => S.call(handler, extra, t);
const okBody = (res, code = 200) => { assert.equal(res.code, code, JSON.stringify(res.body)); assert.equal(res.body.success, true); return res.body.data; };
const stockRow = async (id) => (await pool.query(`SELECT quantity, reserved_qty FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [S.branchId, id])).rows[0];
const open = (extra = {}) => call(jobs.create, { body: { customer_id: customer, vehicle_reg: 'ka01 ab 1234', vehicle_type: 'CAR', complaint: 'Brake noise', ...extra } });

test('setup', { skip }, async () => {
  await runMigrations(pool);
  S = await makeShop(pool, 'jc');
  tenant = S.tenantFor();
  customer = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Anil Kumar','9000000010') RETURNING customer_id`, [S.businessId])).rows[0].customer_id;
  pad = await addPart(pool, S, { name: 'Brake pad set', stock: 5, price: 1000 });
  oil = await addPart(pool, S, { name: 'Engine oil 1L', stock: 1, price: 400 });
});

test('staff: a mechanic is an employee; attendance and payroll work for a parts shop', { skip }, async () => {
  const e = okBody(await call(staff.saveEmployee, { body: { name: 'Raju Mechanic', designation: 'Mechanic', salary: 18000, pay_type: 'MONTHLY', joined_on: '2026-01-01' } }), 201);
  mechanic = e.employee_id;
  assert.equal(e.salary, 18000);
  const noPay = await call(staff.listEmployees, { query: {} }, S.tenantFor('PARTS_COUNTER'));
  assert.equal(noPay.code, 200);
  assert.ok(noPay.body.data.every((x) => x.salary_paise === undefined && x.salary === undefined), 'a counter person never sees a salary');
  const month = '2026-09';
  okBody(await call(staff.markAttendance, { body: { date: '2026-09-02', entries: [{ employee_id: mechanic, status: 'PRESENT' }] } }));
  const run = okBody(await call(staff.generate, { body: { month } }));
  assert.equal(run.month, month);
  const slip = run.slips.find((p) => p.employee_id === mechanic);
  assert.ok(slip && slip.net_pay_paise >= 0, 'a payslip is made from attendance');
  const today = (await call(staff.attendanceDay, { query: {} }));
  assert.equal(today.code, 200, 'the staff screens start on the shop\'s own date, not a hotel\'s');
});

test('a job card: open, hold parts, labour, shortage, fitment, re-quantity, ready, bill', { skip }, async () => {
  const j = okBody(await open({ mechanic_id: mechanic, odometer_km: 42000 }), 201);
  assert.equal(j.job_no, 'JC-0001'); assert.equal(j.status, 'OPEN'); assert.equal(j.vehicle_reg, 'KA01 AB 1234'); assert.equal(j.mechanic_name, 'Raju Mechanic');
  const id = j.job_id;

  let g = okBody(await call(jobs.lineAdd, { params: { id }, body: { kind: 'PART', product_id: pad, quantity: 2 } }), 201);
  assert.equal(g.lines[0].held, true); assert.equal(g.lines[0].unit_price_paise, 100000);
  assert.equal((await stockRow(pad)).reserved_qty, '2.000', 'the parts are held for the customer');
  g = okBody(await call(jobs.lineAdd, { params: { id }, body: { kind: 'LABOUR', description: 'Fit brake pads', unit_price: 500 } }), 201);
  assert.equal(g.estimate.total_paise, 295000, '2 pads and labour with 18% GST');

  const short = await call(jobs.lineAdd, { params: { id }, body: { kind: 'PART', product_id: oil, quantity: 3 } });
  assert.equal(short.code, 409); assert.match(short.body.message, /free to hold/);
  g = okBody(await call(jobs.lineAdd, { params: { id }, body: { kind: 'PART', product_id: oil, quantity: 3, allow_short: true } }), 201);
  const oilLine = g.lines.find((l) => l.product_id === oil);
  assert.equal(oilLine.held, false, 'a part the shop lacks is quoted but not held');

  // fitment: the part is recorded as not fitting this vehicle model
  const make = (await pool.query(`INSERT INTO vehicle_makes (business_id, name, vehicle_type) VALUES ($1,'Maruti','CAR') RETURNING make_id`, [S.businessId])).rows[0].make_id;
  const model = (await pool.query(`INSERT INTO vehicle_models (business_id, make_id, name) VALUES ($1,$2,'Swift') RETURNING model_id`, [S.businessId, make])).rows[0].model_id;
  await pool.query(`INSERT INTO part_fitment (business_id, product_id, model_id, status) VALUES ($1,$2,$3,'NOT_FIT')`, [S.businessId, pad, model]);
  g = okBody(await call(jobs.update, { params: { id }, body: { model_id: model } }));
  assert.equal(g.model, 'Swift'); assert.equal(g.make, 'Maruti');
  assert.equal(g.lines.find((l) => l.product_id === pad).fitment, 'NOT_FIT', 'a part marked as not fitting is flagged on the card');
  assert.equal(g.lines.find((l) => l.product_id === oil).fitment, 'UNKNOWN');

  g = okBody(await call(jobs.lineUpdate, { params: { id: g.lines.find((l) => l.product_id === pad).line_id }, body: { quantity: 3 } }));
  assert.equal((await stockRow(pad)).reserved_qty, '3.000', 'changing the quantity changes the hold');
  g = okBody(await call(jobs.lineRemove, { params: { id: oilLine.line_id } }));
  assert.equal(g.lines.length, 2);

  g = okBody(await call(jobs.status, { params: { id }, body: { status: 'READY' } }));
  assert.equal(g.status, 'READY'); assert.ok(g.ready_at);

  const billed = okBody(await call(jobs.bill, { params: { id }, body: { payment: { amount: 'FULL', method: 'CASH' } } }), 201);
  assert.equal(billed.job.status, 'BILLED'); assert.ok(billed.job.invoice_id);
  assert.equal(billed.invoice.total, 4130, '3 pads 3000 + labour 500, plus 18% GST');
  const codes = (await pool.query(`SELECT product_id IS NULL AS labour, hsn_sac FROM invoice_items WHERE invoice_id = $1 ORDER BY item_id`, [billed.job.invoice_id])).rows;
  assert.ok(codes.filter((c) => c.labour).every((c) => c.hsn_sac === '998714'), 'labour carries the SAC for vehicle repair');
  assert.ok(codes.filter((c) => !c.labour).every((c) => c.hsn_sac !== '998714'), 'parts keep their own code');
  const after = await stockRow(pad);
  assert.equal(after.quantity, '2.000', 'billing took 3 of 5'); assert.equal(after.reserved_qty, '0.000', 'and used the hold up');
  const res = (await pool.query(`SELECT status FROM part_reservations WHERE business_id = $1`, [S.businessId])).rows;
  assert.ok(res.every((r) => r.status !== 'OPEN'), 'no hold is left open');
  assert.ok(res.some((r) => r.status === 'FULFILLED'), 'billing used the hold up');

  const late = await call(jobs.lineAdd, { params: { id }, body: { kind: 'LABOUR', description: 'More', unit_price: 100 } });
  assert.equal(late.code, 409, 'a billed card is closed');
  assert.equal((await call(jobs.status, { params: { id }, body: { status: 'CANCELLED' } })).code, 409);
  assert.equal(okBody(await call(jobs.get, { params: { id } })).invoice_id, billed.job.invoice_id);
});

test('cancelling a card gives every held part back; a lower price needs the price change right', { skip }, async () => {
  const before = await stockRow(pad);
  const j = okBody(await open({ vehicle_reg: 'MH12 XY 9999', complaint: 'Service' }), 201);
  assert.equal(j.job_no, 'JC-0002');
  okBody(await call(jobs.lineAdd, { params: { id: j.job_id }, body: { kind: 'PART', product_id: pad, quantity: 1 } }), 201);
  assert.equal((await stockRow(pad)).reserved_qty, '1.000');
  const counter = S.tenantFor('PARTS_COUNTER');
  const cheap = await call(jobs.lineAdd, { params: { id: j.job_id }, body: { kind: 'PART', product_id: pad, quantity: 1, unit_price: 100 } }, counter);
  assert.equal(cheap.code, 403, 'the counter cannot undercut the list price');
  const cancelled = okBody(await call(jobs.status, { params: { id: j.job_id }, body: { status: 'CANCELLED' } }));
  assert.equal(cancelled.status, 'CANCELLED');
  const now = await stockRow(pad);
  assert.equal(now.reserved_qty, before.reserved_qty, 'the hold is released'); assert.equal(now.quantity, before.quantity);
});

test('history and reminders: earlier visits of the same vehicle, and services that are due', { skip }, async () => {
  const list = okBody(await call(jobs.list, { query: { reg: 'ka01ab1234', status: 'ALL' } }));
  assert.equal(list.length, 1); assert.equal(list[0].status, 'BILLED');
  const next = okBody(await open({ vehicle_reg: 'KA01 AB 1234' }), 201);
  assert.equal(next.earlier_visits, 1, 'the card knows the vehicle has been here before');
  await pool.query(`UPDATE job_cards SET next_service_on = CURRENT_DATE + 5, status = 'BILLED', billed_at = now() WHERE job_id = $1`, [next.job_id]);
  const due = okBody(await call(jobs.due, { query: { days: '14' } }));
  assert.equal(due.length, 1); assert.equal(due[0].vehicle_reg, 'KA01 AB 1234'); assert.equal(due[0].overdue, false); assert.equal(due[0].customer_name, 'Anil Kumar');
  const live = okBody(await call(jobs.list, { query: {} }));
  assert.ok(live.every((x) => ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS', 'READY'].includes(x.status)), 'the default list is the work in hand');
});

test('another shop never sees this shop\'s cards, and a card needs a real customer and registration', { skip }, async () => {
  const other = await makeShop(pool, 'jc2');
  const list = await other.call(jobs.list, { query: { status: 'ALL' } });
  assert.deepEqual(list.body.data, []);
  const first = okBody(await call(jobs.list, { query: { status: 'ALL' } }))[0];
  assert.equal((await other.call(jobs.get, { params: { id: first.job_id } })).code, 404);
  assert.equal((await call(jobs.create, { body: { customer_id: 999999, vehicle_reg: 'KA01AB1' } })).code, 400);
  assert.equal((await call(jobs.create, { body: { customer_id: customer, vehicle_reg: '!!' } })).code, 400);
});

test('a new workshop starts with workshop departments and shifts, not a hotel\'s', { skip }, async () => {
  const shop = await makeShop(pool, 'jc3');
  const d = (await shop.call(staff.departments, {})).body.data.map((x) => x.name);
  assert.deepEqual(d, ['Accounts', 'Management', 'Parts counter', 'Stores', 'Workshop']);
  const s = (await shop.call(staff.shifts, {})).body.data.map((x) => x.name);
  assert.deepEqual(s.sort(), ['Day', 'Late']);
});

test('the usual Indian bikes, scooters and cars can be added once, never as fitment', { skip }, async () => {
  const cat = (await import('../src/controllers/autopartsCatalog.controller.js')).default;
  const first = okBody(await call(cat.loadDefaultVehicles, { body: { types: ['BIKE', 'CAR'] } }), 201);
  assert.ok(first.added_makes >= 20 && first.added_models >= 150, JSON.stringify(first));
  const again = okBody(await call(cat.loadDefaultVehicles, { body: { types: ['BIKE', 'CAR'] } }), 201);
  assert.deepEqual([again.added_makes, again.added_models], [0, 0], 'adding twice adds nothing');
  const tree = okBody(await call(cat.vehicles, { query: {} }));
  const splendor = tree.find((m) => m.name === 'Hero MotoCorp' && m.vehicle_type === 'BIKE')?.models.some((m) => m.name === 'Splendor Plus');
  assert.ok(splendor && tree.some((m) => m.name === 'Maruti Suzuki' && m.vehicle_type === 'CAR'));
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM part_fitment WHERE business_id = $1 AND model_id IN (SELECT model_id FROM vehicle_models WHERE name = 'Splendor Plus')`, [S.businessId])).rows[0].n, 0, 'no fitment is assumed');
});

test('services the shop charges for: add, change the charge, pick on a card, remove', { skip }, async () => {
  const a = okBody(await call(jobs.saveService, { body: { name: 'Wheel alignment', price: 600 } }), 201);
  assert.equal(a.price_paise, 60000);
  const again = okBody(await call(jobs.saveService, { body: { name: 'wheel ALIGNMENT', price: 650, tax_rate: 12 } }), 201);
  assert.equal(again.service_id, a.service_id, 'the same name changes the charge, it is not doubled');
  const list = okBody(await call(jobs.services, {}));
  assert.deepEqual(list.map((x) => [x.name, x.price_paise, x.tax_rate]), [['Wheel alignment', 65000, 12]]);
  const j = okBody(await open({ vehicle_reg: 'KA05 CD 9999' }), 201);
  const g = okBody(await call(jobs.lineAdd, { params: { id: j.job_id }, body: { kind: 'LABOUR', description: list[0].name, unit_price: list[0].price_paise / 100, tax_rate: list[0].tax_rate } }), 201);
  assert.equal(g.estimate.labour_paise, 65000); assert.equal(g.estimate.tax_paise, 7800, 'the service carries its own GST rate');
  assert.equal((await call(jobs.saveService, { body: { name: 'x', price: -1 } })).code, 400);
  okBody(await call(jobs.removeService, { params: { id: a.service_id } }));
  assert.deepEqual(okBody(await call(jobs.services, {})), []);
  okBody(await call(jobs.status, { params: { id: j.job_id }, body: { status: 'CANCELLED' } }));
});

test('a billed job counts in the shop\'s sales, and the workshop report splits labour from parts', { skip }, async () => {
  const reports = await import('../src/controllers/reports.controller.js');
  const before = okBody(await call(reports.sales, { query: {} }));
  const j = okBody(await open({ vehicle_reg: 'KA09 EF 1111', mechanic_id: mechanic }), 201);
  okBody(await call(jobs.lineAdd, { params: { id: j.job_id }, body: { kind: 'PART', product_id: pad, quantity: 1 } }), 201);
  okBody(await call(jobs.lineAdd, { params: { id: j.job_id }, body: { kind: 'LABOUR', description: 'Fit pads', unit_price: 200 } }), 201);
  const billed = okBody(await call(jobs.bill, { params: { id: j.job_id }, body: { payment: { amount: 'FULL', method: 'UPI' } } }), 201);
  const after = okBody(await call(reports.sales, { query: {} }));
  const gain = (x) => x.total_sales;
  assert.equal(Math.round((gain(after) - gain(before)) * 100), Math.round(billed.invoice.total * 100), 'the job bill is in the sales total');
  const r = okBody(await call(jobs.report, { query: {} }));
  assert.ok(r.totals.jobs >= 2 && r.totals.labour_paise >= 70000 && r.totals.parts_paise >= 100000 + 300000, JSON.stringify(r.totals));
  assert.ok(r.mechanics.some((m) => m.name === 'Raju Mechanic' && m.labour_paise >= 20000));
  await pool.query(`UPDATE invoices SET status = 'CANCELLED' WHERE invoice_id = $1`, [billed.invoice.invoice_id]);
  const r2 = okBody(await call(jobs.report, { query: {} }));
  assert.equal(r.totals.jobs - r2.totals.jobs, 1, 'a cancelled bill leaves the workshop report');
});

test('the customer is told on WhatsApp: words and a wa.me link, nothing is sent from the server', { skip }, async () => {
  const j = okBody(await open({ vehicle_reg: 'KA03 GH 2222', promised_on: '2026-12-01' }), 201);
  const share = (event) => call(jobs.share, { params: { id: j.job_id }, query: { event } });
  const got = okBody(await share('received'));
  assert.match(got.text, /received your .*KA03 GH 2222.*JC-\d+/); assert.match(got.text, /2026-12-01/);
  assert.equal(got.phone, '919000000010'); assert.ok(got.wa_url.startsWith('https://wa.me/919000000010?text='));
  assert.equal((await share('estimate')).code, 400, 'no estimate without lines');
  okBody(await call(jobs.lineAdd, { params: { id: j.job_id }, body: { kind: 'LABOUR', description: 'Oil change', unit_price: 300 } }), 201);
  assert.match(okBody(await share('estimate')).text, /Oil change: ₹300.*Total ₹354/);
  assert.match(okBody(await share('ready')).text, /is ready at/);
  assert.equal((await share('bill')).code, 409, 'the bill message needs a bill');
  assert.equal((await share('nonsense')).code, 400);
  const billed = okBody(await call(jobs.bill, { params: { id: j.job_id }, body: { payment: { amount: 'FULL', method: 'CASH' } } }), 201);
  assert.match(okBody(await share('bill')).text, new RegExp(billed.invoice.invoice_number));
});

test('a make and model typed on a job card are remembered once, in the right type, and never imply fitment', { skip }, async () => {
  const cat = (await import('../src/controllers/autopartsCatalog.controller.js')).default;
  const j = okBody(await open({ vehicle_reg: 'KA11 ZZ 0001', vehicle_type: 'BIKE', make: 'hero motocorp', model: 'Splendor Plus Black', vehicle_year: 2021 }), 201);
  assert.equal(j.make, 'Hero MotoCorp', 'it joins the company that is already in the list, whatever the capitals');
  assert.equal(j.model, 'Splendor Plus Black'); assert.ok(j.model_id);
  const typed = okBody(await open({ vehicle_reg: 'KA11 ZZ 0002', vehicle_type: 'BIKE', make: 'Hero MotoCorp', model: 'splendor plus black' }), 201);
  assert.equal(typed.model_id, j.model_id, 'the same model typed again is the same model, not a copy');
  const fresh = okBody(await open({ vehicle_reg: 'KA11 ZZ 0003', vehicle_type: 'CAR', make: 'Datsun Newbrand', model: 'Z1' }), 201);
  assert.equal(fresh.make, 'Datsun Newbrand');
  const tree = okBody(await call(cat.vehicles, { query: {} }));
  const mk = tree.find((m) => m.name === 'Datsun Newbrand' && m.vehicle_type === 'CAR');
  assert.ok(mk && mk.models.some((m) => m.name === 'Z1'), 'the new company and model are now in the list');
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM part_fitment WHERE business_id = $1 AND model_id = $2`, [S.businessId, fresh.model_id])).rows[0].n, 0);
  const upd = okBody(await call(jobs.update, { params: { id: fresh.job_id }, body: { model: 'Z2' } }));
  assert.equal(upd.model, 'Z2'); assert.notEqual(upd.model_id, fresh.model_id, 'changing only the model finds or adds that model under the same company');
  for (const id of [j.job_id, typed.job_id, fresh.job_id]) okBody(await call(jobs.status, { params: { id }, body: { status: 'CANCELLED' } }));
});
