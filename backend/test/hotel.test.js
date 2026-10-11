/*
 * The hotel module, end to end through the controllers: set-up, availability and quotes, a booking with an advance, check-in, charges, night
 * audit (the room charge, GST slab, the day's figures, the date moving on), check-out into a GST invoice, cancel, no-show, room moves, extensions,
 * and the manager's flash. Money is checked to the paisa.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { makeHotel } from './helpers/hotel.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const setup = (await import('../src/controllers/hotelSetup.controller.js')).default;
const front = (await import('../src/controllers/hotelFront.controller.js')).default;
const reports = (await import('../src/controllers/hotelReports.controller.js')).default;
const { ROLE_PERMISSIONS } = await import('../src/middleware/auth.js');

test.after(cleanup);

let H; let deluxe; let suite; let r101; let r102; let r103; let r201; let plan;
const D0 = '2026-11-02';   // the hotel's date when the tests start
const call = (handler, extra, tenant) => H.call(handler, extra, tenant);
const ok = (res) => { assert.equal(res.code < 300, true, `${res.code} ${res.body?.message}`); return res.body.data; };

const guest = (name, phone) => ({ name, phone });
const book = (body) => call(front.createBooking, { body });
const bookingBody = (over = {}) => ({ guest: guest('Asha Rao', '9876500001'), arrival: D0, departure: '2026-11-04', rooms: [{ room_type_id: deluxe, adults: 2 }], source: 'PHONE', ...over });

test('set up the property', { skip }, async () => {
  await runMigrations(pool);
  H = await makeHotel(pool, 'front');
  ok(await call(setup.updateSettings, { body: { business_date: D0 } }));
  deluxe = ok(await call(setup.createRoomType, { body: { name: 'Deluxe', code: 'DLX', base_rate: 3000, extra_adult: 500, base_adults: 2, max_adults: 3, max_children: 1 } })).room_type_id;
  suite = ok(await call(setup.createRoomType, { body: { name: 'Suite', code: 'STE', base_rate: 8000, max_adults: 4 } })).room_type_id;
  const made = ok(await call(setup.createRooms, { body: { room_type_id: deluxe, from: 101, to: 103, floor: '1' } }));
  assert.equal(made.length, 3);
  const rooms = ok(await call(setup.listRooms));
  [r101, r102, r103] = ['101', '102', '103'].map((n) => rooms.find((r) => r.room_no === n).room_id);
  r201 = ok(await call(setup.createRoom, { body: { room_type_id: suite, room_no: '201', floor: '2' } })).room_id;
  plan = ok(await call(setup.listRatePlans)).find((p) => p.is_default);
  assert.equal(plan.code, 'EP');
  const dup = await call(setup.createRoom, { body: { room_type_id: deluxe, room_no: '101' } });
  assert.equal(dup.code, 409);
});

test('the business date can be set only before the first night audit and the GST slab is editable', { skip }, async () => {
  const s = ok(await call(setup.getSettings));
  assert.equal(s.business_date, D0);
  assert.equal(s.tax_low_pct, '5.00');
  assert.equal(s.tax_threshold, 7500);
  const bad = await call(setup.updateSettings, { body: { tax_low_pct: 150 } });
  assert.equal(bad.code, 400);
});

test('availability counts rooms by type and night', { skip }, async () => {
  const a = ok(await call(front.availability, { query: { from: D0, to: '2026-11-05' } }));
  const dlx = a.room_types.find((t) => t.code === 'DLX');
  assert.deepEqual(dlx.nights.map((n) => n.available), [3, 3, 3]);
  assert.equal(a.room_types.find((t) => t.code === 'STE').nights[0].total, 1);
});

test('a quote uses the rack rate, the plan rate, then a seasonal rate; extra adults are added', { skip }, async () => {
  const q = ok(await call(front.quote, { query: { room_type_id: String(deluxe), arrival: D0, departure: '2026-11-04', adults: '2' } }));
  assert.deepEqual(q.nights.map((n) => n.rate_paise), [300000, 300000]);
  assert.equal(q.nights[0].basis, 'Rack rate');
  ok(await call(setup.saveRatePlan, { params: { id: String(plan.rate_plan_id) }, body: { name: 'Room only', code: 'EP', meal_plan: 'EP', is_default: true, rates: { [deluxe]: 2800 } } }));
  const q2 = ok(await call(front.quote, { query: { room_type_id: String(deluxe), rate_plan_id: String(plan.rate_plan_id), arrival: D0, departure: '2026-11-03', adults: '3' } }));
  assert.equal(q2.nights[0].rate_paise, 280000 + 50000);   // plan rate + one extra adult
  assert.equal(q2.nights[0].basis, 'Rate plan');
  const over = ok(await call(setup.createOverride, { body: { room_type_id: deluxe, name: 'Diwali', from_date: '2026-11-03', to_date: '2026-11-03', rate: 4200 } }));
  assert.equal(over.rate, 4200);
  const q3 = ok(await call(front.quote, { query: { room_type_id: String(deluxe), rate_plan_id: String(plan.rate_plan_id), arrival: D0, departure: '2026-11-04', adults: '2' } }));
  assert.deepEqual(q3.nights.map((n) => [n.rate_paise, n.basis]), [[280000, 'Rate plan'], [420000, 'Diwali']]);
  const tooMany = await call(front.quote, { query: { room_type_id: String(deluxe), arrival: D0, departure: '2026-11-04', adults: '5' } });
  assert.equal(tooMany.code, 400);
});

let b1;
test('a booking takes the rate for each night, an advance, and uses up a room', { skip }, async () => {
  const res = await book(bookingBody({ advance: { amount: 1000, method: 'UPI', reference: 'UTR1' } }));
  assert.equal(res.code, 201);
  b1 = res.body.data;
  assert.match(b1.res_no, /^RES-0000\d$/);
  assert.equal(b1.status, 'CONFIRMED');
  assert.equal(b1.rooms.length, 1);
  assert.deepEqual(Object.values(b1.rooms[0].night_rates), [280000, 420000]);   // plan rate, then the Diwali rate: locked for this guest
  assert.equal(b1.paid_paise, 100000);
  const a = ok(await call(front.availability, { query: { from: D0, to: '2026-11-04' } }));
  assert.deepEqual(a.room_types.find((t) => t.code === 'DLX').nights.map((n) => n.sold), [1, 1]);
});

test('a rate typed by the desk replaces the rate card, and a later change of the card does not touch a booking', { skip }, async () => {
  const res = await book(bookingBody({ guest: guest('Vikram Shah', '9876500002'), rooms: [{ room_type_id: deluxe, adults: 2, rate: 2500 }] }));
  const b = ok(res);
  assert.deepEqual(Object.values(b.rooms[0].night_rates), [250000, 250000]);
  await pool.query(`UPDATE room_types SET base_rate_paise = 999900 WHERE room_type_id = $1`, [deluxe]);
  await pool.query(`UPDATE room_types SET base_rate_paise = 300000 WHERE room_type_id = $1`, [deluxe]);
  assert.deepEqual(Object.values(ok(await call(front.getBooking, { params: { id: String(b.booking_id) } })).rooms[0].night_rates), [250000, 250000]);
  ok(await call(front.cancel, { params: { id: String(b.booking_id) }, body: { reason: 'Changed plans' } }));
});

test('the last room cannot be sold twice, and a past arrival is refused', { skip }, async () => {
  const wanted = await book(bookingBody({ guest: guest('Group', '9876500003'), rooms: [{ room_type_id: deluxe }, { room_type_id: deluxe }, { room_type_id: deluxe }] }));
  assert.equal(wanted.code, 409);
  assert.equal(wanted.body.code, 'NO_AVAILABILITY');
  const past = await book(bookingBody({ arrival: '2026-11-01', departure: '2026-11-02' }));
  assert.equal(past.code, 400);
  const backwards = await book(bookingBody({ departure: D0 }));
  assert.equal(backwards.code, 400);
  const racing = await Promise.all([1, 2, 3].map((i) => book(bookingBody({ guest: guest(`Racer ${i}`, `98765001${i}0`), rooms: [{ room_type_id: deluxe }, { room_type_id: deluxe }] }))));
  assert.equal(racing.filter((r) => r.code === 201).length, 1, 'only one of three bookings for two of the remaining two rooms can succeed');
  for (const r of racing.filter((x) => x.code === 201)) ok(await call(front.cancel, { params: { id: String(r.body.data.booking_id) }, body: { reason: 'test' } }));
});

test('check-in needs a clean room that is free, and starts the stay', { skip }, async () => {
  await pool.query(`UPDATE rooms SET hk_status = 'DIRTY' WHERE room_id = $1`, [r101]);
  const dirty = await call(front.checkIn, { params: { id: String(b1.booking_id) }, body: { assignments: [{ rr_id: b1.rooms[0].rr_id, room_id: r101 }] } });
  assert.equal(dirty.code, 409);
  assert.equal(dirty.body.code, 'ROOM_DIRTY');
  const noRoom = await call(front.checkIn, { params: { id: String(b1.booking_id) }, body: {} });
  assert.equal(noRoom.code, 400);
  ok(await call(front.setRoomStatus, { params: { id: String(r101) }, body: { status: 'CLEAN' } }));
  const done = ok(await call(front.checkIn, { params: { id: String(b1.booking_id) }, body: { assignments: [{ rr_id: b1.rooms[0].rr_id, room_id: r101 }] } }));
  assert.equal(done.status, 'CHECKED_IN');
  assert.equal(done.rooms[0].room_no, '101');
  const again = await call(front.checkIn, { params: { id: String(b1.booking_id) }, body: {} });
  assert.equal(again.code, 409);
  const rack = ok(await call(front.rack));
  assert.equal(rack.rooms.find((r) => r.room_no === '101').occupancy, 'OCCUPIED');
});

test('charges post to the folio with GST, and a void keeps the history', { skip }, async () => {
  const c = ok(await call(front.postCharge, { params: { id: String(b1.booking_id) }, body: { department: 'LAUNDRY', description: 'Laundry', quantity: 2, price: 150, tax_rate: 18 } }));
  assert.equal(Number(c.amount_paise), 30000);
  assert.equal(Number(c.tax_paise), 5400);
  const bad = await call(front.postCharge, { params: { id: String(b1.booking_id) }, body: { department: 'NOPE', description: 'x', price: 1 } });
  assert.equal(bad.code, 400);
  const extra = ok(await call(front.postCharge, { params: { id: String(b1.booking_id) }, body: { department: 'MISC', description: 'Mistake', price: 500, tax_rate: 0 } }));
  ok(await call(front.voidCharge, { params: { id: String(extra.charge_id) }, body: { reason: 'Posted to the wrong room' } }));
  const f = ok(await call(front.getFolio, { params: { id: String(b1.booking_id) } }));
  assert.equal(f.charges.length, 2);
  assert.equal(f.totals.charges_paise, 35400);   // the voided line is not counted
  assert.equal(f.charges.find((x) => x.charge_id === extra.charge_id).voided_at !== null, true);
});

test('night audit refuses while a booking has not arrived, then posts the night and moves the date on', { skip }, async () => {
  const late = ok(await book(bookingBody({ guest: guest('Neha Das', '9876500004'), departure: '2026-11-03', rooms: [{ room_type_id: deluxe }] })));
  const blocked = await call(front.runAudit, { body: {} });
  assert.equal(blocked.code, 409);
  assert.equal(blocked.body.code, 'PENDING_ARRIVALS');
  const preview = ok(await call(front.auditPreview));
  assert.equal(preview.pending_arrivals.length, 1);
  const audit = ok(await call(front.runAudit, { body: { no_show_all: true } }));
  assert.equal(audit.audited, D0);
  assert.equal(audit.business_date, '2026-11-03');
  assert.equal(audit.room_charges_posted, 1);
  assert.equal(audit.no_shows_marked, 1);
  assert.equal(ok(await call(front.getBooking, { params: { id: String(late.booking_id) } })).status, 'NO_SHOW');
  const f = ok(await call(front.getFolio, { params: { id: String(b1.booking_id) } }));
  const room = f.charges.find((x) => x.department === 'ROOM');
  assert.equal(Number(room.amount_paise), 280000);
  assert.equal(room.tax_rate, '5.00');                 // ₹2,800 is under the ₹7,500 slab
  assert.equal(Number(room.tax_paise), 14000);
  const settings = ok(await call(setup.getSettings));
  const lateDate = await call(setup.updateSettings, { body: { business_date: D0 } });
  assert.equal(lateDate.code, 409);                     // only night audit moves the date now
  assert.equal(settings.business_date, '2026-11-03');
  const twice = await pool.query(`SELECT COUNT(*)::int AS n FROM folio_charges WHERE rr_id = $1 AND department = 'ROOM'`, [b1.rooms[0].rr_id]);
  assert.equal(twice.rows[0].n, 1);
});

test('the day just closed is recorded as it was, and the flash reads from it', { skip }, async () => {
  const s = (await pool.query(`SELECT * FROM hotel_daily_stats WHERE branch_id = $1 AND stat_date = $2`, [H.branchId, D0])).rows[0];
  assert.equal(s.rooms_available, 4);
  assert.equal(s.rooms_sold, 1);
  assert.equal(Number(s.room_revenue_paise), 280000);
  assert.equal(s.no_shows, 1);
  const flash = ok(await call(reports.flash, { query: { date: D0 } }));
  assert.equal(flash.provisional, false);
  assert.equal(flash.day.occupancy_pct, 25);
  assert.equal(flash.day.adr_paise, 280000);
  assert.equal(flash.day.revpar_paise, 70000);     // ₹2,800 / 4 rooms
  assert.equal(flash.day.rooms_sold, 1);
  assert.equal(flash.month_to_date.room_revenue_paise, 280000);
  assert.equal(flash.now.rooms_in_house, 1);
});

test('the second night is charged at the Diwali rate, in the 18% slab only above ₹7,500', { skip }, async () => {
  const a = ok(await call(front.runAudit, { body: {} }));
  assert.equal(a.audited, '2026-11-03');
  const f = ok(await call(front.getFolio, { params: { id: String(b1.booking_id) } }));
  const nights = f.charges.filter((x) => x.department === 'ROOM').sort((x, y) => (x.charge_date < y.charge_date ? -1 : 1));
  assert.deepEqual(nights.map((n) => Number(n.amount_paise)), [280000, 420000]);
  assert.deepEqual(nights.map((n) => n.tax_rate), ['5.00', '5.00']);
  await pool.query(`UPDATE hotel_properties SET tax_threshold_paise = 400000 WHERE branch_id = $1`, [H.branchId]);
});

test('check-out asks for the balance, makes one GST invoice and releases the room to housekeeping', { skip }, async () => {
  const due = await call(front.checkOut, { params: { id: String(b1.booking_id) }, body: {} });
  assert.equal(due.code, 409);
  assert.equal(due.body.code, 'BALANCE_DUE');
  // charges: 2800 + 4200 room, 300 laundry = 7300, tax 140 + 210 + 54 = 404, total 7704; advance 1000
  const f = ok(await call(front.getFolio, { params: { id: String(b1.booking_id) } }));
  assert.equal(f.totals.charges_paise, 280000 + 14000 + 420000 + 21000 + 30000 + 5400);
  const out = ok(await call(front.checkOut, { params: { id: String(b1.booking_id) }, body: { settlement: { method: 'CARD', reference: 'AUTH77' } } }));
  assert.ok(out.invoice_id);
  const inv = (await pool.query(`SELECT * FROM invoices WHERE invoice_id = $1`, [out.invoice_id])).rows[0];
  assert.equal(Number(inv.total_paise), f.totals.charges_paise);
  assert.equal(Number(inv.amount_paid_paise), f.totals.charges_paise);
  assert.equal(inv.payment_status, 'PAID');
  const pays = (await pool.query(`SELECT payment_method, amount_paise FROM payments WHERE invoice_id = $1 ORDER BY payment_id`, [out.invoice_id])).rows;
  assert.deepEqual(pays.map((p) => [p.payment_method, Number(p.amount_paise)]), [['UPI', 100000], ['CARD', f.totals.charges_paise - 100000]]);
  const items = (await pool.query(`SELECT description, quantity FROM invoice_items WHERE invoice_id = $1 ORDER BY item_id`, [out.invoice_id])).rows;
  assert.ok(items.some((i) => /Room 101/.test(i.description)));
  const room = (await pool.query(`SELECT hk_status FROM rooms WHERE room_id = $1`, [r101])).rows[0];
  assert.equal(room.hk_status, 'DIRTY');
  const after = ok(await call(front.getBooking, { params: { id: String(b1.booking_id) } }));
  assert.equal(after.status, 'CHECKED_OUT');
  assert.equal(after.invoice_id, out.invoice_id);
  const closed = await call(front.postCharge, { params: { id: String(b1.booking_id) }, body: { department: 'MISC', description: 'x', price: 1 } });
  assert.equal(closed.code, 409);
});

test('a walk-in checks in at once, a stay moves to another room, extends, and an overstay is kept on by night audit', { skip }, async () => {
  const w = ok(await call(front.walkIn, { body: { guest: guest('Imran Khan', '9876500005'), departure: '2026-11-05', rooms: [{ room_type_id: deluxe, room_id: r102, adults: 1 }] } }));
  assert.equal(w.status, 'CHECKED_IN');
  assert.equal(w.source, 'WALK_IN');
  const rr = w.rooms[0].rr_id;
  const moved = ok(await call(front.moveRoom, { params: { id: String(w.booking_id) }, body: { rr_id: rr, room_id: r201, rate: 8000, reason: 'Wanted a suite' } }));
  assert.equal(moved.rooms[0].room_no, '201');
  assert.equal((await pool.query(`SELECT hk_status FROM rooms WHERE room_id = $1`, [r102])).rows[0].hk_status, 'DIRTY');
  const longer = ok(await call(front.changeDates, { params: { id: String(w.booking_id) }, body: { departure: '2026-11-06' } }));
  assert.equal(longer.departure, '2026-11-06');
  assert.equal(Object.keys(longer.rooms[0].night_rates).length, 2);   // the walk-in arrived on 4 November: nights of the 4th and 5th
  assert.deepEqual(Object.values(longer.rooms[0].night_rates), [800000, 800000]);   // the extra night keeps the rate typed for the move
  const busy = await call(front.moveRoom, { params: { id: String(w.booking_id) }, body: { rr_id: rr, room_id: r201 } });
  assert.equal(busy.code, 400);   // already in it
  // the audit charges a suite night at 18% because ₹8,000 is above the (now ₹4,000) limit
  const a = ok(await call(front.runAudit, { body: {} }));
  assert.equal(a.audited, '2026-11-04');
  const f = ok(await call(front.getFolio, { params: { id: String(w.booking_id) } }));
  const night = f.charges.find((x) => x.department === 'ROOM');
  assert.equal(night.tax_rate, '18.00');
  assert.equal(Number(night.tax_paise), 144000);
});

test('cancel and no-show release the room; a cancelled booking keeps its advance until it is refunded', { skip }, async () => {
  const b = ok(await book(bookingBody({ guest: guest('Cancel Me', '9876500006'), arrival: '2026-11-06', departure: '2026-11-07', advance: { amount: 500, method: 'CASH' } })));
  const c = ok(await call(front.cancel, { params: { id: String(b.booking_id) }, body: { reason: 'Guest ill' } }));
  assert.equal(c.status, 'CANCELLED');
  assert.equal(c.paid_paise, 50000);
  const noReason = await call(front.cancel, { params: { id: String(b.booking_id) }, body: {} });
  assert.equal(noReason.code, 400);
  ok(await call(front.addPayment, { params: { id: String(b.booking_id) }, body: { kind: 'REFUND', method: 'CASH', amount: 500 } }));
  assert.equal(ok(await call(front.getBooking, { params: { id: String(b.booking_id) } })).paid_paise, 0);
  const tooMuch = await call(front.addPayment, { params: { id: String(b.booking_id) }, body: { kind: 'REFUND', method: 'CASH', amount: 1 } });
  assert.equal(tooMuch.code, 409);
  const lost = ok(await call(reports.lost, { query: { from: D0, to: '2026-11-30' } }));
  assert.ok(lost.cancellations >= 1);
  assert.ok(lost.no_shows >= 1);
});

test('reports: arrivals, in-house, high balance, revenue by department, collections, sources and forecast', { skip }, async () => {
  const inHouse = ok(await call(reports.inHouse));
  assert.equal(inHouse.rows.length, 1);
  assert.equal(inHouse.rows[0].guest_name, 'Imran Khan');
  const high = ok(await call(reports.highBalance));
  assert.equal(high.rows.length, 1);
  assert.ok(high.rows[0].balance_paise > 0);
  const dep = ok(await call(reports.departments, { query: { from: D0, to: '2026-11-30' } }));
  const rooms = dep.departments.find((d) => d.department === 'ROOM');
  assert.equal(rooms.revenue_paise, 280000 + 420000 + 800000);
  const col = ok(await call(reports.collections, { query: { from: D0, to: '2026-11-30' } }));
  assert.equal(col.methods.find((m) => m.method === 'UPI').net_paise, 100000 - 0);
  const src = ok(await call(reports.sources, { query: { from: D0, to: '2026-11-30' } }));
  assert.ok(src.sources.find((s) => s.source === 'PHONE').room_revenue_paise >= 700000);
  const fc = ok(await call(reports.forecast, { query: { from: '2026-11-04', to: '2026-11-07' } }));
  assert.equal(fc.days.length, 4);
  assert.equal(fc.days[0].rooms_booked, 1);
  const occ = ok(await call(reports.occupancy, { query: { from: D0, to: '2026-11-30' } }));
  assert.equal(occ.days.length, 3);
  assert.equal(occ.total.rooms_sold, 3);
});

test('a hotel that is not a hotel gets nothing, and roles see only what they should', { skip }, async () => {
  assert.ok(ROLE_PERMISSIONS.FRONT_DESK.includes('front_desk'));
  assert.ok(!ROLE_PERMISSIONS.HOUSEKEEPER.includes('front_desk'));
  assert.ok(ROLE_PERMISSIONS.HOUSEKEEPER.includes('housekeeping'));
  assert.ok(!ROLE_PERMISSIONS.FRONT_DESK.includes('night_audit'));
  assert.ok(ROLE_PERMISSIONS.NIGHT_AUDITOR.includes('night_audit'));
  const { hotelOnly } = await import('../src/modules/hotel/common.js');
  const res = { code: 200, status(c) { this.code = c; return this; }, json() { return this; } };
  let passed = false;
  hotelOnly({ tenant: { businessType: 'RESTAURANT' } }, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.code, 404);
  hotelOnly({ tenant: { businessType: 'HOTEL' } }, res, () => { passed = true; });
  assert.equal(passed, true);
});

test('an advance refunded by another method still comes off what goes on the invoice', { skip }, async () => {
  const { netByMethod } = await import('../src/modules/hotel/common.js');
  assert.deepEqual(netByMethod([{ method: 'CHEQUE', kind: 'ADVANCE', amount_paise: 20000000 }, { method: 'BANK_TRANSFER', kind: 'REFUND', amount_paise: 13822700 }]), [{ method: 'CHEQUE', paise: 6177300 }]);
  assert.deepEqual(netByMethod([{ method: 'CASH', kind: 'ADVANCE', amount_paise: 1000 }, { method: 'UPI', kind: 'PAYMENT', amount_paise: 3000 }, { method: 'UPI', kind: 'REFUND', amount_paise: 500 }, { method: 'CARD', kind: 'REFUND', amount_paise: 1000 }]), [{ method: 'CASH', paise: 1000 }, { method: 'UPI', paise: 1500 }]);
  assert.deepEqual(netByMethod([{ method: 'CASH', kind: 'ADVANCE', amount_paise: 500 }, { method: 'CASH', kind: 'REFUND', amount_paise: 500 }]), []);
  // end to end: a stay whose advance was taken by cheque and refunded in cash at check-out
  const { setup2 } = { setup2: setup };
  const h = await makeHotel(pool, 'refund');
  const call2 = (handler, extra) => h.call(handler, extra);
  ok(await call2(setup2.updateSettings, { body: { business_date: '2027-02-01' } }));
  const t = ok(await call2(setup2.createRoomType, { body: { name: 'Std', code: 'STD', base_rate: 1000 } })).room_type_id;
  const rid = ok(await call2(setup2.createRoom, { body: { room_type_id: t, room_no: '1' } })).room_id;
  const b = ok(await call2(front.createBooking, { body: { guest: { name: 'Over Payer', phone: '9876500077' }, arrival: '2027-02-01', departure: '2027-02-02', rooms: [{ room_type_id: t }], advance: { amount: 5000, method: 'CHEQUE' } } }));
  ok(await call2(front.checkIn, { params: { id: String(b.booking_id) }, body: { assignments: [{ rr_id: b.rooms[0].rr_id, room_id: rid }] } }));
  const refund = await call2(front.checkOut, { params: { id: String(b.booking_id) }, body: {} });
  assert.equal(refund.code, 409);
  assert.equal(refund.body.code, 'REFUND_DUE');
  const out = ok(await call2(front.checkOut, { params: { id: String(b.booking_id) }, body: { refund_method: 'CASH' } }));
  const inv = (await pool.query(`SELECT total_paise, amount_paid_paise, payment_status FROM invoices WHERE invoice_id = $1`, [out.invoice_id])).rows[0];
  assert.equal(Number(inv.amount_paid_paise), Number(inv.total_paise));
  assert.equal(inv.payment_status, 'PAID');
  const pays = (await pool.query(`SELECT payment_method, amount_paise FROM payments WHERE invoice_id = $1`, [out.invoice_id])).rows;
  assert.deepEqual(pays.map((p) => [p.payment_method, Number(p.amount_paise)]), [['CHEQUE', Number(inv.total_paise)]]);
});
