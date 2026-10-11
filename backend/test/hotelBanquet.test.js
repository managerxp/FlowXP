/*
 * Banquet and events: halls and packages, an event with several functions, the hall that cannot be held twice, tentative holds that lapse, the charges worked out from each
 * function (and rewritten when the guests change, leaving hand-added lines alone), advances and refunds, completing an event into one GST invoice, cancelling, and the figures
 * night audit and the reports take from it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { makeHotel } from './helpers/hotel.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const setup = (await import('../src/controllers/hotelSetup.controller.js')).default;
const front = (await import('../src/controllers/hotelFront.controller.js')).default;
const banquet = (await import('../src/controllers/hotelBanquet.controller.js')).default;
const reports = (await import('../src/controllers/hotelReports.controller.js')).default;
const { ROLE_PERMISSIONS } = await import('../src/middleware/auth.js');

test.after(cleanup);

let H; let grand; let lawn; let veg;
const D0 = '2026-12-10';
const call = (handler, extra, tenant) => H.call(handler, extra, tenant);
const ok = (res) => { assert.equal(res.code < 300, true, `${res.code} ${res.body?.message}`); return res.body.data; };
const fn = (over = {}) => ({ hall_id: grand, name: 'Reception', event_date: '2026-12-12', start_time: '19:00', end_time: '23:30', expected_guests: 200, guaranteed_guests: 180, package_id: veg, ...over });
const make = (over = {}) => call(banquet.createEvent, { body: { guest: { name: 'Meera Pillai', phone: '9876511111' }, title: 'Pillai wedding', event_type: 'WEDDING', status: 'CONFIRMED', functions: [fn()], ...over } });

test('set up the halls and a package', { skip }, async () => {
  await runMigrations(pool);
  H = await makeHotel(pool, 'banq');
  ok(await call(setup.updateSettings, { body: { business_date: D0 } }));
  grand = ok(await call(banquet.saveHall, { body: { name: 'Grand Ballroom', capacity_seated: 300, capacity_floating: 450, rent: 80000, amenities: ['Stage', 'AC'] } })).hall_id;
  lawn = ok(await call(banquet.saveHall, { body: { name: 'Sea Lawn', capacity_seated: 150, rent: 40000 } })).hall_id;
  veg = ok(await call(banquet.savePackage, { body: { name: 'Classic Veg', diet: 'VEG', per_plate: 1200, min_guests: 100, tax_rate: 18, menu: 'Welcome drink, 2 starters, 3 mains, dessert' } })).package_id;
  assert.equal(ok(await call(banquet.listHalls)).length, 2);
  const dup = await call(banquet.saveHall, { body: { name: 'Grand Ballroom' } });
  assert.equal(dup.code, 409);
});

let e1;
test('an event with two functions works out the hall rent and the food from each', { skip }, async () => {
  const res = await make({ functions: [fn({ name: 'Sangeet', event_date: '2026-12-11', start_time: '18:00', end_time: '22:00', hall_id: lawn, expected_guests: 120, guaranteed_guests: 100 }), fn()] });
  assert.equal(res.code, 201);
  e1 = res.body.data;
  assert.match(e1.event_no, /^BQ-0000\d$/);
  assert.equal(e1.status, 'CONFIRMED');
  assert.equal(e1.functions.length, 2);
  const auto = e1.charges.filter((c) => c.auto);
  assert.equal(auto.length, 4);
  const rent = auto.find((c) => c.category === 'HALL' && /Grand/.test(c.description));
  assert.equal(Number(rent.amount_paise), 8000000);
  assert.equal(Number(rent.tax_paise), 1440000);          // 18% of ₹80,000
  const food = auto.find((c) => c.category === 'FOOD' && /Reception/.test(c.description));
  assert.equal(Number(food.quantity), 180);
  assert.equal(Number(food.amount_paise), 21600000);       // 180 plates at ₹1,200
  const sangeet = auto.find((c) => c.category === 'FOOD' && /Sangeet/.test(c.description));
  assert.equal(Number(sangeet.quantity), 100);              // the package's minimum is 100
  assert.equal(e1.totals.charges_paise, e1.charges.reduce((s, c) => s + Number(c.amount_paise) + Number(c.tax_paise), 0));
});

test('a hall cannot be held twice at the same time, but can at another', { skip }, async () => {
  const clash = await make({ guest: { name: 'Rival', phone: '9876522222' }, title: 'Rival wedding', functions: [fn({ start_time: '22:00', end_time: '23:59' })] });
  assert.equal(clash.code, 409);
  assert.equal(clash.body.code, 'HALL_TAKEN');
  assert.match(clash.body.message, /BQ-/);
  const later = await make({ guest: { name: 'Next Day', phone: '9876533333' }, title: 'Birthday', event_type: 'BIRTHDAY', functions: [fn({ event_date: '2026-12-13', name: 'Party', expected_guests: 60, guaranteed_guests: 50 })] });
  assert.equal(later.code, 201);
  const sameHallEarlier = await make({ guest: { name: 'Lunch', phone: '9876544444' }, title: 'Lunch', functions: [fn({ start_time: '11:00', end_time: '14:00', name: 'Lunch' })] });
  assert.equal(sameHallEarlier.code, 201);
  const check = ok(await call(banquet.checkHall, { query: { hall_id: String(grand), date: '2026-12-12', start: '20:00', end: '21:00' } }));
  assert.equal(check.conflicts.length, 1);
  const racing = await Promise.all([1, 2, 3].map((i) => make({ guest: { name: `Racer ${i}`, phone: `98765555${i}0` }, title: `Race ${i}`, functions: [fn({ event_date: '2026-12-20', name: 'Gala' })] })));
  assert.equal(racing.filter((r) => r.code === 201).length, 1, 'only one of three can hold the hall at once');
});

test('an enquiry holds nothing; a tentative hold blocks the hall until it lapses', { skip }, async () => {
  const enquiry = ok(await make({ guest: { name: 'Asker', phone: '9876566666' }, title: 'Just asking', status: 'ENQUIRY', functions: [fn({ event_date: '2026-12-25', name: 'Gala' })] }));
  assert.equal(enquiry.status, 'ENQUIRY');
  const holder = ok(await make({ guest: { name: 'Holder', phone: '9876577777' }, title: 'Held', status: 'TENTATIVE', hold_until: '2026-12-15', functions: [fn({ event_date: '2026-12-25', name: 'Gala' })] }));
  assert.equal(holder.status, 'TENTATIVE');
  const noDate = await make({ guest: { name: 'No Date', phone: '9876588888' }, title: 'No hold date', status: 'TENTATIVE', functions: [fn({ event_date: '2026-12-26' })] });
  assert.equal(noDate.code, 400);
  const blocked = await call(banquet.setStatus, { params: { id: String(enquiry.event_id) }, body: { status: 'CONFIRMED' } });
  assert.equal(blocked.code, 409);       // the tentative hold has the hall
  await pool.query(`UPDATE banquet_events SET hold_until = '2026-12-09' WHERE event_id = $1`, [holder.event_id]);   // the hold lapsed yesterday
  const confirmed = ok(await call(banquet.setStatus, { params: { id: String(enquiry.event_id) }, body: { status: 'CONFIRMED' } }));
  assert.equal(confirmed.status, 'CONFIRMED');
  const cal = ok(await call(banquet.calendar, { query: { from: '2026-12-10', to: '2026-12-31' } }));
  assert.ok(!cal.functions.some((f) => f.event_id === holder.event_id), 'a lapsed hold is not on the calendar');
});

test('changing the guests rewrites the worked-out lines and leaves hand-added lines alone', { skip }, async () => {
  const decor = ok(await call(banquet.postCharge, { params: { id: String(e1.event_id) }, body: { category: 'DECOR', description: 'Stage and floral decor', quantity: 1, price: 150000, tax_rate: 18 } }));
  assert.equal(Number(decor.tax_paise), 2700000);
  const reception = e1.functions.find((f) => f.name === 'Reception');
  const after = ok(await call(banquet.updateFunction, { params: { id: String(reception.function_id) }, body: { guaranteed_guests: 220 } }));
  const food = after.charges.find((c) => c.category === 'FOOD' && /Reception/.test(c.description));
  assert.equal(Number(food.quantity), 220);
  assert.equal(Number(food.amount_paise), 26400000);
  assert.equal(after.charges.filter((c) => c.auto && c.category === 'FOOD').length, 2, 'rewritten, not duplicated');
  assert.ok(after.charges.some((c) => c.charge_id === decor.charge_id && !c.voided_at), 'the hand-added line is kept');
  const tooBig = await call(banquet.updateFunction, { params: { id: String(reception.function_id) }, body: { expected_guests: 5000 } });
  assert.equal(tooBig.code, 400);
  const voidAuto = await call(banquet.voidCharge, { params: { id: String(food.charge_id) }, body: { reason: 'no' } });
  assert.equal(voidAuto.code, 409);
  ok(await call(banquet.voidCharge, { params: { id: String(decor.charge_id) }, body: { reason: 'Decor done by the family' } }));
  const detail = ok(await call(banquet.getEvent, { params: { id: String(e1.event_id) } }));
  assert.equal(detail.totals.charges_paise, detail.charges.filter((c) => !c.voided_at).reduce((s, c) => s + Number(c.amount_paise) + Number(c.tax_paise), 0));
  e1 = detail;
});

test('a function moved onto a held hall is refused, and an event keeps at least one function', { skip }, async () => {
  const sangeet = e1.functions.find((f) => f.name === 'Sangeet');
  const clash = await call(banquet.updateFunction, { params: { id: String(sangeet.function_id) }, body: { hall_id: grand, event_date: '2026-12-12', start_time: '20:00', end_time: '22:00' } });
  assert.equal(clash.code, 409);
  ok(await call(banquet.removeFunction, { params: { id: String(sangeet.function_id) } }));
  const only = (await call(banquet.getEvent, { params: { id: String(e1.event_id) } })).body.data;
  assert.equal(only.functions.length, 1);
  const last = await call(banquet.removeFunction, { params: { id: String(only.functions[0].function_id) } });
  assert.equal(last.code, 409);
  assert.ok(!only.charges.some((c) => /Sangeet/.test(c.description)), 'the removed function’s lines went with it');
});

test('advance and refund are recorded, a refund cannot exceed what was paid', { skip }, async () => {
  ok(await call(banquet.addPayment, { params: { id: String(e1.event_id) }, body: { kind: 'ADVANCE', method: 'BANK_TRANSFER', amount: 200000, reference: 'NEFT1' } }));
  ok(await call(banquet.addPayment, { params: { id: String(e1.event_id) }, body: { kind: 'ADVANCE', method: 'UPI', amount: 50000 } }));
  const tooMuch = await call(banquet.addPayment, { params: { id: String(e1.event_id) }, body: { kind: 'REFUND', method: 'UPI', amount: 999999 } });
  assert.equal(tooMuch.code, 409);
  const p = ok(await call(banquet.proforma, { params: { id: String(e1.event_id) } }));
  assert.equal(p.totals.paid_paise, 25000000);
  assert.ok(p.lines.every((l) => l.total_paise === l.amount_paise + l.tax_paise));
});

test('an event is completed only after its last function, into one invoice with the advances as paid', { skip }, async () => {
  const early = await call(banquet.complete, { params: { id: String(e1.event_id) }, body: {} });
  assert.equal(early.code, 409);
  assert.match(early.body.message, /2026-12-12/);
  await pool.query(`UPDATE hotel_properties SET business_date = '2026-12-12' WHERE branch_id = $1`, [H.branchId]);
  const due = await call(banquet.complete, { params: { id: String(e1.event_id) }, body: {} });
  assert.equal(due.code, 409);
  assert.equal(due.body.code, 'BALANCE_DUE');
  const d = ok(await call(banquet.getEvent, { params: { id: String(e1.event_id) } }));
  const done = ok(await call(banquet.complete, { params: { id: String(e1.event_id) }, body: { settlement: { method: 'CARD', reference: 'AUTH9' } } }));
  assert.ok(done.invoice_id);
  const inv = (await pool.query(`SELECT * FROM invoices WHERE invoice_id = $1`, [done.invoice_id])).rows[0];
  assert.equal(Number(inv.total_paise), d.totals.charges_paise);
  assert.equal(inv.payment_status, 'PAID');
  const pays = (await pool.query(`SELECT payment_method, amount_paise FROM payments WHERE invoice_id = $1 ORDER BY payment_id`, [done.invoice_id])).rows.map((x) => [x.payment_method, Number(x.amount_paise)]);
  assert.deepEqual(pays, [['BANK_TRANSFER', 200000 * 100], ['UPI', 50000 * 100], ['CARD', d.totals.charges_paise - 25000000]].sort((a, b) => (pays.findIndex((p) => p[0] === a[0]) - pays.findIndex((p) => p[0] === b[0]))));
  const after = ok(await call(banquet.getEvent, { params: { id: String(e1.event_id) } }));
  assert.equal(after.status, 'COMPLETED');
  assert.equal(after.invoice_id, done.invoice_id);
  const closed = await call(banquet.postCharge, { params: { id: String(e1.event_id) }, body: { category: 'OTHER', description: 'x', price: 1 } });
  assert.equal(closed.code, 409);
  const again = await call(banquet.complete, { params: { id: String(e1.event_id) }, body: {} });
  assert.equal(again.code, 409);
});

test('a cancelled event frees its hall, and the advance can be refunded', { skip }, async () => {
  const e = ok(await make({ guest: { name: 'Cancel Me', phone: '9876599999' }, title: 'Cancelled event', functions: [fn({ event_date: '2026-12-30', name: 'Gala' })] }));
  ok(await call(banquet.addPayment, { params: { id: String(e.event_id) }, body: { kind: 'ADVANCE', method: 'CASH', amount: 25000 } }));
  const c = ok(await call(banquet.cancelEvent, { params: { id: String(e.event_id) }, body: { reason: 'Venue changed' } }));
  assert.equal(c.status, 'CANCELLED');
  const free = await make({ guest: { name: 'Takes Over', phone: '9876500000' }, title: 'Takes the hall', functions: [fn({ event_date: '2026-12-30', name: 'Gala' })] });
  assert.equal(free.code, 201);
  ok(await call(banquet.addPayment, { params: { id: String(e.event_id) }, body: { kind: 'REFUND', method: 'CASH', amount: 25000 } }));
  assert.equal(ok(await call(banquet.getEvent, { params: { id: String(e.event_id) } })).totals.paid_paise, 0);
});

test('night audit counts the banquet on the day it was held; reports show it by department, collections and hall', { skip }, async () => {
  // the hotel is on 12 December; add a room so the audit has a property to close
  ok(await call(setup.createRoomType, { body: { name: 'Std', code: 'STD', base_rate: 3000 } }));
  const a = ok(await call(front.runAudit, { body: { no_show_all: true } }));
  assert.equal(a.audited, '2026-12-12');
  const flash = ok(await call(reports.flash, { query: { date: '2026-12-12' } }));
  // every function held that day counts: the reception and the lunch in the same hall earlier on
  const net = Number((await pool.query(
    `SELECT COALESCE(SUM(c.amount_paise), 0) AS n FROM banquet_charges c JOIN banquet_functions f ON f.function_id = c.function_id JOIN banquet_events e ON e.event_id = c.event_id
     WHERE c.branch_id = $1 AND f.event_date = '2026-12-12' AND c.voided_at IS NULL AND e.status IN ('CONFIRMED','COMPLETED')`, [H.branchId])).rows[0].n);
  assert.ok(net > 34400000);
  assert.equal(flash.day.other_revenue_paise, net);
  const dep = ok(await call(reports.departments, { query: { from: '2026-12-01', to: '2026-12-31' } }));
  assert.ok(dep.departments.find((d) => d.department === 'BANQUET').revenue_paise >= net);
  const col = ok(await call(reports.collections, { query: { from: '2026-12-01', to: '2026-12-31' } }));
  assert.ok(col.methods.find((m) => m.method === 'BANK_TRANSFER').banquet_paise === 20000000);
  const sum = ok(await call(banquet.summary, { query: { from: '2026-12-01', to: '2026-12-31' } }));
  assert.ok(sum.halls.find((h) => h.name === 'Grand Ballroom').functions >= 2);
  assert.ok(sum.total_revenue_paise >= net);
});

test('the banquet manager has banquet rights and nothing at the front desk', { skip }, () => {
  assert.ok(ROLE_PERMISSIONS.BANQUET_MANAGER.includes('banquet'));
  assert.ok(!ROLE_PERMISSIONS.BANQUET_MANAGER.includes('front_desk'));
  assert.ok(!ROLE_PERMISSIONS.FRONT_DESK.includes('banquet'));
  assert.ok(ROLE_PERMISSIONS.MANAGER.includes('banquet'));
});
