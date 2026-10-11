/*
 * Charging a restaurant bill to a guest's room: the till's bill is a normal GST invoice left unpaid on the guest, a line on the folio points at it,
 * it is not hotel revenue, and at check-out the payment is applied to it as well as to the room invoice.
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
const invoices = await import('../src/controllers/invoices.controller.js');

test.after(cleanup);

let H; let deluxe; let r101; let r102; let r103;
const D0 = '2026-11-02';
const call = (handler, extra, tenant) => H.call(handler, extra, tenant);
const ok = (res) => { assert.equal(res.code < 300, true, `${res.code} ${res.body?.message}`); return res.body.data; };
const walkIn = async (name, phone, room) => ok(await call(front.walkIn, { body: { guest: { name, phone }, departure: '2026-11-03', rooms: [{ room_type_id: deluxe, room_id: room, adults: 1 }] } }));
const sale = (bookingId, price, extra = {}) => {
  const res = H.call(invoices.create, { body: { items: [{ description: 'Dinner', unit_price: price, quantity: 1, tax_rate: 5 }], charge_to_booking_id: bookingId, ...extra } });
  return res;
};
const folio = async (id) => ok(await call(front.getFolio, { params: { id: String(id) } }));

test('set up a property with two guests in the hotel', { skip }, async () => {
  await runMigrations(pool);
  H = await makeHotel(pool, 'rc');
  ok(await call(setup.updateSettings, { body: { business_date: D0 } }));
  deluxe = ok(await call(setup.createRoomType, { body: { name: 'Deluxe', code: 'DLX', base_rate: 3000, base_adults: 2, max_adults: 3 } })).room_type_id;
  ok(await call(setup.createRooms, { body: { room_type_id: deluxe, from: 101, to: 103 } }));
  const rooms = ok(await call(setup.listRooms));
  [r101, r102, r103] = ['101', '102', '103'].map((n) => rooms.find((r) => r.room_no === n).room_id);
});

let a; let b;
test('a bill charged to a room is an unpaid invoice on the guest and a line on the folio', { skip }, async () => {
  a = await walkIn('Meera Nair', '9876500101', r101);
  b = await walkIn('Karan Shah', '9876500102', r102);
  const res = await sale(a.booking_id, 1000);
  const inv = ok(res);
  assert.equal(inv.total, 1050);
  const row = (await pool.query(`SELECT * FROM invoices WHERE invoice_id = $1`, [inv.invoice_id])).rows[0];
  assert.equal(row.payment_status, 'UNPAID');
  assert.equal(Number(row.balance_due_paise), 105000);
  assert.ok(row.customer_id);
  const f = await folio(a.booking_id);
  const line = f.charges.find((c) => c.invoiced);
  assert.equal(line.invoice_number, inv.invoice_number);
  assert.equal(Number(line.amount_paise) + Number(line.tax_paise), 105000);
  assert.equal(f.totals.charges_paise, 105000);
  assert.equal(f.totals.restaurant_paise, 105000);
  assert.equal(f.totals.balance_paise, 105000);
  const list = ok(await call(front.roomChargeGuests, { query: { q: '101' } }));
  assert.deepEqual(list.map((g) => g.guest_name), ['Meera Nair']);
  assert.equal(Number(list[0].balance_paise), 105000);
  assert.equal(ok(await call(front.roomChargeGuests, { query: { q: 'karan' } })).length, 1);
});

test('a guest who is not in the hotel cannot be charged, and nothing is left behind', { skip }, async () => {
  const later = ok(await call(front.createBooking, { body: { guest: { name: 'Not Yet', phone: '9876500103' }, arrival: '2026-11-05', departure: '2026-11-06', rooms: [{ room_type_id: deluxe, adults: 1 }] } }));
  const before = Number((await pool.query(`SELECT COUNT(*) FROM invoices WHERE business_id = $1`, [H.businessId])).rows[0].count);
  const res = await sale(later.booking_id, 500);
  assert.equal(res.code, 409);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) FROM invoices WHERE business_id = $1`, [H.businessId])).rows[0].count), before);
  const noGuest = await sale(999999, 500);
  assert.equal(noGuest.code, 404);
});

test('it is the restaurant’s sale, not hotel revenue, and it is not counted twice in collections', { skip }, async () => {
  const dep = ok(await call(reports.departments, { query: { from: D0, to: '2026-11-30' } }));
  assert.equal(Number(dep.departments.find((d) => d.department === 'FNB')?.revenue_paise ?? 0), 0);
  const flash = ok(await call(reports.flash, { query: { date: D0 } }));
  assert.equal(Number(flash.day.fnb_revenue_paise ?? 0), 0);
  const high = ok(await call(reports.highBalance));
  assert.ok(high.rows.some((r) => Number(r.balance_paise) === 105000));
});

test('a cancelled bill falls off the folio', { skip }, async () => {
  const inv = ok(await sale(b.booking_id, 400));
  assert.equal((await folio(b.booking_id)).totals.charges_paise, 42000);
  await pool.query(`UPDATE invoices SET status = 'CANCELLED' WHERE invoice_id = $1`, [inv.invoice_id]);
  const f = await folio(b.booking_id);
  assert.equal(f.totals.charges_paise, 0);
  assert.equal(f.totals.balance_paise, 0);
});

test('check-out pays the restaurant bill and the room invoice, refunding what was overpaid', { skip }, async () => {
  ok(await call(front.addPayment, { params: { id: String(a.booking_id) }, body: { kind: 'PAYMENT', method: 'CASH', amount: 5000 } }));
  // a short stay still pays the day's room: 3,000 + 5% = 3,150, plus the 1,050 restaurant bill = 4,200; 5,000 paid
  const need = await call(front.checkOut, { params: { id: String(a.booking_id) }, body: {} });
  assert.equal(need.code, 409);
  assert.equal(need.body.code, 'REFUND_DUE');
  assert.equal(need.body.data.refund_paise, 80000);
  const out = ok(await call(front.checkOut, { params: { id: String(a.booking_id) }, body: { refund_method: 'CASH' } }));
  assert.equal(out.total, 3150);
  assert.equal(out.restaurant_bills_paid.length, 1);
  const room = (await pool.query(`SELECT * FROM invoices WHERE invoice_id = $1`, [out.invoice_id])).rows[0];
  assert.equal(room.payment_status, 'PAID');
  assert.equal(Number(room.amount_paid_paise), 315000);
  const rest = (await pool.query(`SELECT * FROM invoices WHERE invoice_number = $1`, [out.restaurant_bills_paid[0]])).rows[0];
  assert.equal(rest.payment_status, 'PAID');
  assert.equal(Number(rest.amount_paid_paise), 105000);
  assert.equal(Number(rest.balance_due_paise), 0);
  const pay = (await pool.query(`SELECT payment_method, amount_paise, reference_number FROM payments WHERE invoice_id = $1`, [rest.invoice_id])).rows;
  assert.deepEqual(pay.map((p) => [p.payment_method, Number(p.amount_paise)]), [['CASH', 105000]]);
  assert.match(pay[0].reference_number, /^Stay /);
  assert.equal((await folio(a.booking_id)).totals.balance_paise, 0);
});

test('check-out asks for what is owed on the restaurant bill too, and a settlement is shared out', { skip }, async () => {
  ok(await sale(b.booking_id, 600));
  ok(await sale(b.booking_id, 200));
  // room 3,150 + 630 + 210 = 3,990 owed
  const need = await call(front.checkOut, { params: { id: String(b.booking_id) }, body: {} });
  assert.equal(need.code, 409);
  assert.equal(need.body.code, 'BALANCE_DUE');
  assert.equal(need.body.data.balance_paise, 399000);
  const out = ok(await call(front.checkOut, { params: { id: String(b.booking_id) }, body: { settlement: { method: 'UPI', reference: 'UTR1' } } }));
  assert.equal(out.restaurant_bills_paid.length, 2);
  const all = (await pool.query(`SELECT payment_status, amount_paid_paise FROM invoices WHERE customer_id = (SELECT customer_id FROM invoices WHERE invoice_id = $1) AND status <> 'CANCELLED'`, [out.invoice_id])).rows;
  assert.equal(all.length, 3);
  assert.ok(all.every((i) => i.payment_status === 'PAID'));
  assert.equal(all.reduce((s, i) => s + Number(i.amount_paid_paise), 0), 399000);
  // the money was taken once: the stay's collections show it under the folio, not again on the restaurant bills
  const col = ok(await call(reports.collections, { query: { from: D0, to: '2026-11-30' } }));
  const upi = col.methods.find((m) => m.method === 'UPI');
  assert.equal(Number(upi.net_paise), 399000);
});
