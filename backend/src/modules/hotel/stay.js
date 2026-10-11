/*
 * Guests and bookings, and everything that happens to a booking: made, changed, checked in, moved to another room, cancelled, marked no-show and
 * checked out.
 *
 * A booking has one or more rooms. Each room is held by TYPE until check-in, when a particular room is assigned (a room number may also be chosen at
 * booking time). The nightly rate of every night is fixed when the booking is made, so a later change to the rate card does not touch it.
 *
 * Check-out turns the folio into one GST tax invoice, made by the same invoice engine as every other bill, with the advance and the payment taken
 * now recorded against it.
 */
import { createInvoiceInTransaction, paymentStatus } from '../billing.js';
import { HotelError, MAX_ROOMS_PER_BOOKING, netByMethod, MAX_STAY_NIGHTS, addDaysISO, daysBetween, getProperty, nightsOf, roomTaxRate } from './common.js';
import { assertAvailable, freeRooms } from './availability.js';
import { quoteStay } from './pricing.js';
import { taxFor, totalsOf } from './folio.js';

/* ── guests ────────────────────────────────────────────────────────────── */

const GUEST_FIELDS = ['name', 'phone', 'email', 'company', 'gstin', 'id_type', 'id_number', 'nationality', 'address', 'city', 'state', 'country', 'dob', 'is_vip', 'notes'];

/** An existing guest (by id, optionally updating what was sent) or a new one. */
export const saveGuest = async (db, tenant, input) => {
  if (input.guest_id) {
    const g = (await db.query(`SELECT * FROM guests WHERE guest_id = $1 AND business_id = $2 FOR UPDATE`, [input.guest_id, tenant.businessId])).rows[0];
    if (!g) throw new HotelError(400, 'Guest not found');
    const sets = []; const args = [g.guest_id];
    for (const f of GUEST_FIELDS) if (input[f] !== undefined && input[f] !== g[f]) { args.push(input[f]); sets.push(`${f} = $${args.length}`); }
    if (!sets.length) return g;
    return (await db.query(`UPDATE guests SET ${sets.join(', ')} WHERE guest_id = $1 RETURNING *`, args)).rows[0];
  }
  if (!input.name) throw new HotelError(400, 'Enter the guest’s name');
  const cols = GUEST_FIELDS.filter((f) => input[f] !== undefined && input[f] !== null);
  const { rows } = await db.query(
    `INSERT INTO guests (business_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
    [tenant.businessId, ...cols.map((c) => input[c])]);
  return rows[0];
};

export const searchGuests = async (db, tenant, { q, like, limit = 20 }) =>
  (await db.query(
    `SELECT g.*, (SELECT COUNT(*) FROM hotel_bookings b WHERE b.guest_id = g.guest_id AND b.status IN ('CHECKED_IN','CHECKED_OUT'))::int AS stays,
            (SELECT MAX(arrival) FROM hotel_bookings b WHERE b.guest_id = g.guest_id AND b.status IN ('CHECKED_IN','CHECKED_OUT')) AS last_stay
     FROM guests g WHERE g.business_id = $1 ${q ? `AND (lower(g.name) LIKE lower($2) OR g.phone LIKE $2 OR lower(g.company) LIKE lower($2))` : ''}
     ORDER BY g.is_vip DESC, g.name LIMIT ${Number(limit)}`, q ? [tenant.businessId, like(q)] : [tenant.businessId])).rows;

/** The billing customer for a guest (made on first need, kept on the guest) so the stay's invoice carries their name, phone and GSTIN. */
export const customerFor = async (client, tenant, guest) => {
  if (guest.customer_id) return guest.customer_id;
  const { rows } = await client.query(
    `INSERT INTO customers (business_id, name, phone, email, gstin, state) VALUES ($1,$2,$3,$4,$5,$6) RETURNING customer_id`,
    [tenant.businessId, guest.name, guest.phone || null, guest.email || null, guest.gstin || null, guest.state || null]);
  await client.query(`UPDATE guests SET customer_id = $2 WHERE guest_id = $1`, [guest.guest_id, rows[0].customer_id]);
  return rows[0].customer_id;
};

/* ── reading bookings ──────────────────────────────────────────────────── */

const BOOKING_SQL = `
  SELECT b.*, g.name AS guest_name, g.phone AS guest_phone, g.is_vip, p.name AS rate_plan,
         (SELECT COUNT(*) FROM hotel_booking_rooms x WHERE x.booking_id = b.booking_id AND x.status <> 'CANCELLED')::int AS room_count,
         (SELECT string_agg(COALESCE(r.room_no, t.code), ', ' ORDER BY x.rr_id) FROM hotel_booking_rooms x JOIN room_types t ON t.room_type_id = x.room_type_id
            LEFT JOIN rooms r ON r.room_id = x.room_id WHERE x.booking_id = b.booking_id AND x.status <> 'CANCELLED') AS room_list,
         hotel_charges_paise(b.booking_id) AS charges_paise,
         hotel_paid_paise(b.booking_id) AS paid_paise
  FROM hotel_bookings b JOIN guests g ON g.guest_id = b.guest_id LEFT JOIN rate_plans p ON p.rate_plan_id = b.rate_plan_id`;

export const listBookings = async (db, tenant, { status, from, to, q, like, limit, offset, guestId }) => {
  const args = [tenant.branchId]; const where = ['b.branch_id = $1'];
  if (status) { args.push(status.split(',')); where.push(`b.status = ANY($${args.length}::text[])`); }
  if (from) { args.push(from); where.push(`b.departure > $${args.length}`); }
  if (to) { args.push(to); where.push(`b.arrival <= $${args.length}`); }
  if (guestId) { args.push(guestId); where.push(`b.guest_id = $${args.length}`); }
  if (q) { args.push(like(q)); where.push(`(lower(g.name) LIKE lower($${args.length}) OR g.phone LIKE $${args.length} OR lower(b.res_no) LIKE lower($${args.length}) OR EXISTS (SELECT 1 FROM hotel_booking_rooms x JOIN rooms r ON r.room_id = x.room_id WHERE x.booking_id = b.booking_id AND r.room_no = $${args.length + 1}))`); args.push(q.trim()); }
  const total = (await db.query(`SELECT COUNT(*)::int AS n FROM hotel_bookings b JOIN guests g ON g.guest_id = b.guest_id WHERE ${where.join(' AND ')}`, args)).rows[0].n;
  args.push(limit, offset);
  const rows = (await db.query(`${BOOKING_SQL} WHERE ${where.join(' AND ')} ORDER BY b.arrival DESC, b.booking_id DESC LIMIT $${args.length - 1} OFFSET $${args.length}`, args)).rows;
  return { rows, total };
};

export const bookingDetail = async (db, tenant, bookingId) => {
  const booking = (await db.query(`${BOOKING_SQL} WHERE b.booking_id = $1 AND b.branch_id = $2`, [bookingId, tenant.branchId])).rows[0];
  if (!booking) throw new HotelError(404, 'Booking not found');
  const rooms = (await db.query(
    `SELECT x.*, t.name AS room_type, t.code AS room_type_code, r.room_no, r.hk_status
     FROM hotel_booking_rooms x JOIN room_types t ON t.room_type_id = x.room_type_id LEFT JOIN rooms r ON r.room_id = x.room_id WHERE x.booking_id = $1 ORDER BY x.rr_id`, [bookingId])).rows;
  const guest = (await db.query(`SELECT * FROM guests WHERE guest_id = $1`, [booking.guest_id])).rows[0];
  return { ...booking, guest, rooms, balance_paise: Number(booking.charges_paise) - Number(booking.paid_paise) };
};

/* ── making a booking ──────────────────────────────────────────────────── */

const nextResNo = async (client, tenant) => {
  const p = (await client.query(`UPDATE hotel_properties SET next_res_no = next_res_no + 1 WHERE branch_id = $1 RETURNING res_prefix, next_res_no - 1 AS n`, [tenant.branchId])).rows[0];
  return `${p.res_prefix}-${String(p.n).padStart(5, '0')}`;
};

const flatRates = (nights, rate) => Object.fromEntries(nights.map((d) => [d, rate]));

export const createBooking = async (client, tenant, userId, input) => {
  const property = await getProperty(client, tenant, { lock: true });
  const { arrival, departure } = input;
  if (arrival < property.business_date) throw new HotelError(400, `The arrival cannot be before the hotel’s date, ${property.business_date}`);
  if (!(departure > arrival)) throw new HotelError(400, 'The departure must be after the arrival');
  if (daysBetween(arrival, departure) > MAX_STAY_NIGHTS) throw new HotelError(400, `A stay can be up to ${MAX_STAY_NIGHTS} nights`);
  if (!input.rooms?.length) throw new HotelError(400, 'Choose at least one room');
  if (input.rooms.length > MAX_ROOMS_PER_BOOKING) throw new HotelError(400, `A booking can have up to ${MAX_ROOMS_PER_BOOKING} rooms`);

  if (input.rate_plan_id) {
    const plan = (await client.query(`SELECT 1 FROM rate_plans WHERE rate_plan_id = $1 AND branch_id = $2 AND is_active`, [input.rate_plan_id, tenant.branchId])).rowCount;
    if (!plan) throw new HotelError(400, 'Rate plan not found');
  }
  const ratePlanId = input.rate_plan_id || (await client.query(`SELECT rate_plan_id FROM rate_plans WHERE branch_id = $1 AND is_default AND is_active`, [tenant.branchId])).rows[0]?.rate_plan_id || null;

  // availability, one room type at a time, then the rooms picked by number
  const perType = new Map();
  for (const r of input.rooms) perType.set(r.room_type_id, (perType.get(r.room_type_id) || 0) + 1);
  for (const [roomTypeId, count] of [...perType.entries()].sort((a, b) => a[0] - b[0])) {
    await assertAvailable(client, tenant, { roomTypeId, arrival, departure, count, allowOverbooking: property.allow_overbooking });
  }
  const picked = new Set();
  for (const r of input.rooms) {
    if (!r.room_id) continue;
    if (picked.has(r.room_id)) throw new HotelError(400, 'The same room is chosen twice');
    picked.add(r.room_id);
    const free = await freeRooms(client, tenant, { roomTypeId: r.room_type_id, arrival, departure });
    if (!free.some((f) => f.room_id === r.room_id)) throw new HotelError(409, 'That room is not free for those dates');
  }

  const guest = await saveGuest(client, tenant, input.guest || {});
  const resNo = await nextResNo(client, tenant);
  const booking = (await client.query(
    `INSERT INTO hotel_bookings (business_id, branch_id, res_no, guest_id, arrival, departure, source, source_ref, rate_plan_id, company, notes, created_by, created_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [tenant.businessId, tenant.branchId, resNo, guest.guest_id, arrival, departure, input.source || 'WALK_IN', input.source_ref || null, ratePlanId, input.company || null, input.notes || null, userId, property.business_date])).rows[0];

  const nights = nightsOf(arrival, departure);
  for (const r of input.rooms) {
    const adults = r.adults || 1; const children = r.children || 0;
    const quote = await quoteStay(client, { branchId: tenant.branchId, roomTypeId: r.room_type_id, ratePlanId, arrival, departure, adults, children });
    const nightRates = r.rate_paise != null ? flatRates(nights, r.rate_paise) : Object.fromEntries(quote.nights.map((n) => [n.date, n.rate_paise]));
    await client.query(
      `INSERT INTO hotel_booking_rooms (booking_id, business_id, branch_id, room_type_id, room_id, arrival, departure, adults, children, rate_paise, night_rates, guest_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [booking.booking_id, tenant.businessId, tenant.branchId, r.room_type_id, r.room_id || null, arrival, departure, adults, children, nightRates[nights[0]], JSON.stringify(nightRates), r.guest_name || null]);
  }
  if (input.advance?.amount_paise > 0) {
    await client.query(
      `INSERT INTO folio_payments (business_id, branch_id, booking_id, kind, method, amount_paise, reference, pay_date, created_by) VALUES ($1,$2,$3,'ADVANCE',$4,$5,$6,$7,$8)`,
      [tenant.businessId, tenant.branchId, booking.booking_id, input.advance.method, input.advance.amount_paise, input.advance.reference || null, property.business_date, userId]);
  }
  return booking.booking_id;
};

/* ── check-in ──────────────────────────────────────────────────────────── */

const lockBooking = async (client, tenant, bookingId) => {
  const b = (await client.query(`SELECT * FROM hotel_bookings WHERE booking_id = $1 AND branch_id = $2 FOR UPDATE`, [bookingId, tenant.branchId])).rows[0];
  if (!b) throw new HotelError(404, 'Booking not found');
  return b;
};

export const checkIn = async (client, tenant, userId, bookingId, { assignments = [], allowDirty = false, guest }) => {
  const booking = await lockBooking(client, tenant, bookingId);
  const property = await getProperty(client, tenant, { lock: true });
  if (booking.status !== 'CONFIRMED') throw new HotelError(409, booking.status === 'CHECKED_IN' ? 'This guest is already checked in' : 'This booking cannot be checked in');
  if (booking.arrival > property.business_date) throw new HotelError(409, `This booking arrives on ${booking.arrival.toISOString?.().slice(0, 10) ?? booking.arrival}`);
  const rooms = (await client.query(`SELECT * FROM hotel_booking_rooms WHERE booking_id = $1 AND status = 'RESERVED' ORDER BY rr_id FOR UPDATE`, [bookingId])).rows;
  if (!rooms.length) throw new HotelError(409, 'There is no room to check in');
  const chosen = new Map(assignments.map((a) => [a.rr_id, a.room_id]));
  const taken = new Set();
  for (const rr of rooms) {
    const roomId = chosen.get(rr.rr_id) ?? rr.room_id;
    if (!roomId) throw new HotelError(400, 'Choose a room for each room on the booking', { code: 'ROOM_REQUIRED' });
    if (taken.has(roomId)) throw new HotelError(400, 'The same room is chosen twice');
    taken.add(roomId);
    const room = (await client.query(`SELECT * FROM rooms WHERE room_id = $1 AND branch_id = $2 AND is_active FOR UPDATE`, [roomId, tenant.branchId])).rows[0];
    if (!room) throw new HotelError(400, 'Room not found');
    if (room.hk_status === 'OUT_OF_ORDER') throw new HotelError(409, `Room ${room.room_no} is out of order`);
    if (room.hk_status === 'DIRTY' && !allowDirty) throw new HotelError(409, `Room ${room.room_no} has not been cleaned yet`, { code: 'ROOM_DIRTY' });
    const stayFrom = rr.arrival < property.business_date ? property.business_date : rr.arrival;
    const busy = (await client.query(
      `SELECT 1 FROM hotel_booking_rooms WHERE room_id = $1 AND rr_id <> $2 AND status IN ('RESERVED','IN_HOUSE') AND arrival < $4 AND departure > $3 LIMIT 1`, [roomId, rr.rr_id, stayFrom, rr.departure])).rowCount;
    if (busy) throw new HotelError(409, `Room ${room.room_no} is booked for those dates`);
    // a late arrival keeps the nights it still has; the nights already gone are not charged
    const rates = JSON.parse(JSON.stringify(rr.night_rates || {}));
    for (const d of Object.keys(rates)) if (d < stayFrom) delete rates[d];
    await client.query(
      `UPDATE hotel_booking_rooms SET room_id = $2, room_type_id = $3, status = 'IN_HOUSE', arrival = $4, night_rates = $5 WHERE rr_id = $1`,
      [rr.rr_id, roomId, room.room_type_id, stayFrom, JSON.stringify(rates)]);
  }
  if (guest) await saveGuest(client, tenant, { ...guest, guest_id: booking.guest_id });
  await client.query(
    `UPDATE hotel_bookings SET status = 'CHECKED_IN', checked_in_at = CURRENT_TIMESTAMP, checked_in_on = $2,
       arrival = LEAST(arrival, $2::date) WHERE booking_id = $1`, [bookingId, property.business_date]);
};

/** A guest with no booking: make it and check in at once. */
export const walkIn = async (client, tenant, userId, input) => {
  const property = await getProperty(client, tenant);
  const bookingId = await createBooking(client, tenant, userId, { ...input, arrival: property.business_date, source: input.source || 'WALK_IN' });
  const rooms = (await client.query(`SELECT rr_id, room_id FROM hotel_booking_rooms WHERE booking_id = $1 ORDER BY rr_id`, [bookingId])).rows;
  const missing = rooms.find((r) => !r.room_id);
  if (missing) throw new HotelError(400, 'Choose a room for the walk-in guest', { code: 'ROOM_REQUIRED' });
  await checkIn(client, tenant, userId, bookingId, { assignments: [], allowDirty: input.allow_dirty === true });
  return bookingId;
};

/* ── changing a stay ───────────────────────────────────────────────────── */

/** Change the dates of a booking (every room, or one). Before check-in both dates may move; after it only the departure. */
export const changeDates = async (client, tenant, userId, bookingId, { rrId = null, arrival, departure }) => {
  const booking = await lockBooking(client, tenant, bookingId);
  const property = await getProperty(client, tenant, { lock: true });
  if (!['CONFIRMED', 'CHECKED_IN'].includes(booking.status)) throw new HotelError(409, 'This booking can no longer be changed');
  const rooms = (await client.query(
    `SELECT * FROM hotel_booking_rooms WHERE booking_id = $1 AND status IN ('RESERVED','IN_HOUSE') ${rrId ? 'AND rr_id = $2' : ''} ORDER BY rr_id FOR UPDATE`, rrId ? [bookingId, rrId] : [bookingId])).rows;
  if (!rooms.length) throw new HotelError(404, 'Room not found on this booking');
  for (const rr of rooms) {
    const newArrival = rr.status === 'IN_HOUSE' ? rr.arrival : (arrival || rr.arrival);
    const newDeparture = departure || rr.departure;
    const a = String(newArrival).slice(0, 10); const d = String(newDeparture).slice(0, 10);
    if (rr.status === 'IN_HOUSE' && arrival && arrival !== String(rr.arrival).slice(0, 10)) throw new HotelError(409, 'The arrival of a guest who is in the hotel cannot change');
    if (rr.status === 'RESERVED' && a < property.business_date) throw new HotelError(400, `The arrival cannot be before the hotel’s date, ${property.business_date}`);
    if (!(d > a)) throw new HotelError(400, 'The departure must be after the arrival');
    if (daysBetween(a, d) > MAX_STAY_NIGHTS) throw new HotelError(400, `A stay can be up to ${MAX_STAY_NIGHTS} nights`);
    if (rr.status === 'IN_HOUSE') {
      const lastPosted = (await client.query(`SELECT MAX(charge_date)::text AS d FROM folio_charges WHERE rr_id = $1 AND source = 'NIGHT_AUDIT' AND voided_at IS NULL`, [rr.rr_id])).rows[0].d;
      const earliest = lastPosted ? addDaysISO(lastPosted, 1) : addDaysISO(property.business_date, 0);
      if (d < earliest) throw new HotelError(409, `The guest has been charged up to ${lastPosted}, so the departure cannot be before ${earliest}`);
    }
    await assertAvailable(client, tenant, { roomTypeId: rr.room_type_id, arrival: a, departure: d, count: 1, excludeRrIds: [rr.rr_id], allowOverbooking: property.allow_overbooking });
    if (rr.room_id) {
      const busy = (await client.query(
        `SELECT 1 FROM hotel_booking_rooms WHERE room_id = $1 AND rr_id <> $2 AND status IN ('RESERVED','IN_HOUSE') AND arrival < $4 AND departure > $3 LIMIT 1`, [rr.room_id, rr.rr_id, a, d])).rowCount;
      if (busy) throw new HotelError(409, 'That room is booked by someone else on those dates');
    }
    // keep the agreed rate of the nights that stay; new nights are priced from the rate card
    const rates = JSON.parse(JSON.stringify(rr.night_rates || {}));
    const nights = nightsOf(a, d);
    for (const night of Object.keys(rates)) if (!nights.includes(night)) delete rates[night];
    const fresh = nights.filter((n) => rates[n] == null);
    if (fresh.length) {
      const quote = await quoteStay(client, { branchId: tenant.branchId, roomTypeId: rr.room_type_id, ratePlanId: booking.rate_plan_id, arrival: a, departure: d, adults: rr.adults, children: rr.children });
      const last = Object.values(rates).at(-1);
      for (const q of quote.nights) if (rates[q.date] == null) rates[q.date] = last != null && rr.status === 'IN_HOUSE' ? last : q.rate_paise;
    }
    await client.query(`UPDATE hotel_booking_rooms SET arrival = $2, departure = $3, night_rates = $4, rate_paise = $5 WHERE rr_id = $1`, [rr.rr_id, a, d, JSON.stringify(rates), rates[nights[0]]]);
  }
  await client.query(
    `UPDATE hotel_bookings b SET arrival = x.a, departure = x.d FROM (SELECT MIN(arrival) AS a, MAX(departure) AS d FROM hotel_booking_rooms WHERE booking_id = $1 AND status IN ('RESERVED','IN_HOUSE')) x WHERE b.booking_id = $1`, [bookingId]);
};

/** Move an in-house guest to another room (a different room of the same type, or an upgrade or downgrade). The old room goes to housekeeping. */
export const moveRoom = async (client, tenant, userId, bookingId, { rrId, roomId, newRatePaise = null }) => {
  const booking = await lockBooking(client, tenant, bookingId);
  const property = await getProperty(client, tenant);
  if (booking.status !== 'CHECKED_IN') throw new HotelError(409, 'Only a guest who is checked in can be moved');
  const rr = (await client.query(`SELECT * FROM hotel_booking_rooms WHERE rr_id = $1 AND booking_id = $2 AND status = 'IN_HOUSE' FOR UPDATE`, [rrId, bookingId])).rows[0];
  if (!rr) throw new HotelError(404, 'Room not found on this booking');
  if (rr.room_id === roomId) throw new HotelError(400, 'The guest is already in that room');
  const room = (await client.query(`SELECT * FROM rooms WHERE room_id = $1 AND branch_id = $2 AND is_active FOR UPDATE`, [roomId, tenant.branchId])).rows[0];
  if (!room) throw new HotelError(400, 'Room not found');
  if (room.hk_status === 'OUT_OF_ORDER') throw new HotelError(409, `Room ${room.room_no} is out of order`);
  const free = await freeRooms(client, tenant, { roomTypeId: room.room_type_id, arrival: property.business_date, departure: String(rr.departure).slice(0, 10), excludeRrId: rr.rr_id });
  if (!free.some((f) => f.room_id === roomId)) throw new HotelError(409, `Room ${room.room_no} is not free for the rest of the stay`);
  const rates = JSON.parse(JSON.stringify(rr.night_rates || {}));
  if (newRatePaise != null) for (const n of nightsOf(property.business_date, String(rr.departure).slice(0, 10))) rates[n] = newRatePaise;
  await client.query(`UPDATE hotel_booking_rooms SET room_id = $2, room_type_id = $3, night_rates = $4 WHERE rr_id = $1`, [rr.rr_id, roomId, room.room_type_id, JSON.stringify(rates)]);
  await client.query(`UPDATE rooms SET hk_status = 'DIRTY', hk_updated_at = CURRENT_TIMESTAMP WHERE room_id = $1`, [rr.room_id]);
  return { from_room_id: rr.room_id, to_room_id: roomId };
};

/* ── cancel and no-show ────────────────────────────────────────────────── */

const release = async (client, bookingId) => client.query(`UPDATE hotel_booking_rooms SET status = 'CANCELLED' WHERE booking_id = $1 AND status = 'RESERVED'`, [bookingId]);

export const cancelBooking = async (client, tenant, userId, bookingId, reason) => {
  const booking = await lockBooking(client, tenant, bookingId);
  const property = await getProperty(client, tenant);
  if (booking.status !== 'CONFIRMED') throw new HotelError(409, booking.status === 'CHECKED_IN' ? 'This guest has checked in. Check them out instead.' : 'This booking cannot be cancelled');
  await release(client, bookingId);
  await client.query(`UPDATE hotel_bookings SET status = 'CANCELLED', cancel_reason = $2, cancelled_at = CURRENT_TIMESTAMP, cancelled_on = $3 WHERE booking_id = $1`, [bookingId, reason, property.business_date]);
  return totalsOf(client, bookingId);
};

export const markNoShow = async (client, tenant, userId, bookingId) => {
  const booking = await lockBooking(client, tenant, bookingId);
  const property = await getProperty(client, tenant);
  if (booking.status !== 'CONFIRMED') throw new HotelError(409, 'Only a booking that has not arrived can be marked as a no-show');
  if (booking.arrival > property.business_date) throw new HotelError(409, 'This booking has not reached its arrival date yet');
  await release(client, bookingId);
  await client.query(`UPDATE hotel_bookings SET status = 'NO_SHOW', no_show_on = $2 WHERE booking_id = $1`, [bookingId, property.business_date]);
  return totalsOf(client, bookingId);
};

/* ── check-out ─────────────────────────────────────────────────────────── */

const money2 = (paise) => (Number(paise) / 100).toFixed(2);

export const checkOut = async (client, tenant, userId, bookingId, { settlement = null, refundMethod = null }) => {
  const booking = await lockBooking(client, tenant, bookingId);
  const property = await getProperty(client, tenant, { lock: true });
  if (booking.status !== 'CHECKED_IN') throw new HotelError(409, booking.status === 'CHECKED_OUT' ? 'This guest has already checked out' : 'Only a guest who is checked in can check out');
  const rooms = (await client.query(
    `SELECT x.*, r.room_no, t.name AS room_type FROM hotel_booking_rooms x JOIN rooms r ON r.room_id = x.room_id JOIN room_types t ON t.room_type_id = x.room_type_id
     WHERE x.booking_id = $1 AND x.status = 'IN_HOUSE' ORDER BY x.rr_id FOR UPDATE OF x`, [bookingId])).rows;

  // a stay shorter than a night is still a night: a guest who checks in and out before night audit is charged the day's room
  for (const rr of rooms) {
    const has = (await client.query(`SELECT 1 FROM folio_charges WHERE rr_id = $1 AND department = 'ROOM' AND voided_at IS NULL LIMIT 1`, [rr.rr_id])).rowCount;
    if (has) continue;
    const date = property.business_date;
    const rate = Number(rr.night_rates?.[date] ?? rr.rate_paise);
    const taxRate = roomTaxRate(property, rate);
    const tax = await taxFor(client, tenant, { quantity: 1, unitPricePaise: rate, taxRate });
    await client.query(
      `INSERT INTO folio_charges (business_id, branch_id, booking_id, rr_id, charge_date, department, description, quantity, unit_price_paise, tax_rate, amount_paise, tax_paise, source, created_by)
       VALUES ($1,$2,$3,$4,$5,'ROOM',$6,1,$7,$8,$9,$10,'MANUAL',$11)`,
      [tenant.businessId, tenant.branchId, bookingId, rr.rr_id, date, `Room ${rr.room_no} (${rr.room_type}), ${date}`, rate, taxRate, tax.taxable_paise, tax.tax_paise, userId]);
  }

  const business = (await client.query(`SELECT round_off_enabled FROM businesses WHERE business_id = $1`, [tenant.businessId])).rows[0];
  // what is billed now: the room, extras and anything posted by hand. Restaurant bills charged to the room are already invoices: they are paid, not billed again.
  const charges = (await client.query(`SELECT c.*, x.room_type_id FROM folio_charges c LEFT JOIN hotel_booking_rooms x ON x.rr_id = c.rr_id WHERE c.booking_id = $1 AND c.voided_at IS NULL AND NOT c.invoiced ORDER BY c.charge_date, c.charge_id`, [bookingId])).rows;
  const posted = (await client.query(
    `SELECT i.invoice_id, i.invoice_number, i.customer_id, i.total_paise, i.amount_paid_paise, i.balance_due_paise FROM folio_charges c JOIN invoices i ON i.invoice_id = c.ref_id
     WHERE c.booking_id = $1 AND c.invoiced AND c.voided_at IS NULL AND i.status <> 'CANCELLED' ORDER BY i.invoice_id FOR UPDATE OF i`, [bookingId])).rows;
  if (!charges.length && !posted.length) throw new HotelError(409, 'There is nothing on this guest’s bill');

  const roomEstimate = charges.reduce((s, c) => s + Number(c.amount_paise) + Number(c.tax_paise), 0);
  const roomBill = !charges.length ? 0 : business.round_off_enabled ? Math.round(roomEstimate / 100) * 100 : roomEstimate;
  const postedDue = posted.reduce((s, p) => s + Math.max(0, Number(p.total_paise) - Number(p.amount_paid_paise)), 0);
  const totalDue = roomBill + postedDue;
  let tokens = netByMethod((await client.query(`SELECT method, kind, amount_paise FROM folio_payments WHERE booking_id = $1`, [bookingId])).rows);
  let paid = tokens.reduce((s, t) => s + t.paise, 0);
  if (paid > totalDue) {
    const extra = paid - totalDue;
    if (!refundMethod) throw new HotelError(409, `The guest has paid ₹${money2(extra)} more than the bill. Refund it to check out.`, { code: 'REFUND_DUE', data: { refund_paise: extra } });
    await client.query(
      `INSERT INTO folio_payments (business_id, branch_id, booking_id, kind, method, amount_paise, reference, pay_date, created_by) VALUES ($1,$2,$3,'REFUND',$4,$5,'Refund at check-out',$6,$7)`,
      [tenant.businessId, tenant.branchId, bookingId, refundMethod, extra, property.business_date, userId]);
    tokens = netByMethod((await client.query(`SELECT method, kind, amount_paise FROM folio_payments WHERE booking_id = $1`, [bookingId])).rows);
    paid = tokens.reduce((s, t) => s + t.paise, 0);
  }
  const due = totalDue - paid;
  if (due > 0 && !settlement) throw new HotelError(409, `₹${money2(due)} is still to be paid`, { code: 'BALANCE_DUE', data: { balance_paise: due } });
  // every payment applied to an invoice here is marked "Stay ..." so that reports and the folio know the money is already in the folio payments
  const reference = `Stay ${booking.res_no}`;
  tokens = tokens.map((t) => ({ method: t.method, paise: t.paise, reference }));
  if (due > 0) {
    // what is taken at check-out goes into the folio as well, so collections and the folio see it
    await client.query(
      `INSERT INTO folio_payments (business_id, branch_id, booking_id, kind, method, amount_paise, reference, pay_date, created_by) VALUES ($1,$2,$3,'PAYMENT',$4,$5,$6,$7,$8)`,
      [tenant.businessId, tenant.branchId, bookingId, settlement.method, due, settlement.reference || 'Check-out', property.business_date, userId]);
    tokens.push({ method: settlement.method, paise: due, reference: settlement.reference ? `${reference} · ${settlement.reference}` : reference, settlement: true });
  }

  // the restaurant bills charged to the room are paid first, from what the guest has paid
  const paidInvoices = [];
  for (const inv of posted) {
    let need = Math.max(0, Number(inv.total_paise) - Number(inv.amount_paid_paise)); const start = need;
    while (need > 0 && tokens.length) {
      const t = tokens[0]; const take = Math.min(need, t.paise);
      await client.query(
        `INSERT INTO payments (business_id, branch_id, invoice_id, customer_id, payment_method, amount_paise, reference_number, payment_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [tenant.businessId, tenant.branchId, inv.invoice_id, inv.customer_id, t.method, take, t.reference, property.business_date, userId]);
      t.paise -= take; need -= take;
      if (t.paise === 0) tokens.shift();
    }
    const newPaid = Number(inv.amount_paid_paise) + (start - need);
    await client.query(`UPDATE invoices SET amount_paid_paise = $2, balance_due_paise = $3, payment_status = $4 WHERE invoice_id = $1`, [inv.invoice_id, newPaid, Number(inv.total_paise) - newPaid, paymentStatus(Number(inv.total_paise), newPaid)]);
    paidInvoices.push(inv.invoice_number);
  }

  let invoice = null;
  if (charges.length) {
    // the room invoice: nights together by room and rate, everything else line by line
    const items = []; const roomLines = new Map();
    for (const c of charges) {
      if (c.department === 'ROOM' && c.rr_id) {
        const rr = rooms.find((x) => x.rr_id === c.rr_id);
        const key = `${c.rr_id}|${c.unit_price_paise}|${c.tax_rate}`;
        if (!roomLines.has(key)) roomLines.set(key, { description: `Room ${rr?.room_no ?? ''} (${rr?.room_type ?? 'room'}) night`, unit: Number(c.unit_price_paise), tax: Number(c.tax_rate), qty: 0 });
        roomLines.get(key).qty += Number(c.quantity);
      } else {
        items.push({ description: `${c.description} (${String(c.charge_date).slice(0, 10)})`, unit_price: money2(c.unit_price_paise), quantity: Number(c.quantity), tax_rate: Number(c.tax_rate) });
      }
    }
    const roomItems = [...roomLines.values()].map((l) => ({ description: `${l.description}${l.qty === 1 ? '' : 's'} × ${l.qty}`, unit_price: money2(l.unit), quantity: l.qty, tax_rate: l.tax }));
    const guest = (await client.query(`SELECT * FROM guests WHERE guest_id = $1`, [booking.guest_id])).rows[0];
    const customerId = await customerFor(client, tenant, guest);
    const payments = tokens.map((t) => ({ method: t.method, amount: t.settlement ? 'REST' : money2(t.paise), reference_number: t.reference }));
    invoice = await createInvoiceInTransaction(client, tenant, userId, {
      customerId, items: [...roomItems, ...items], payments, invoiceDate: property.business_date, notes: `Hotel stay ${booking.res_no}`
    });
  }

  await client.query(`UPDATE hotel_booking_rooms SET status = 'DEPARTED', departure = GREATEST(arrival + 1, LEAST(departure, $2::date)) WHERE booking_id = $1 AND status = 'IN_HOUSE'`, [bookingId, property.business_date]);
  await client.query(`UPDATE rooms SET hk_status = 'DIRTY', hk_updated_at = CURRENT_TIMESTAMP WHERE room_id = ANY($1::int[])`, [rooms.map((r) => r.room_id)]);
  await client.query(
    `UPDATE hotel_bookings SET status = 'CHECKED_OUT', checked_out_at = CURRENT_TIMESTAMP, checked_out_on = $2, invoice_id = $3, departure = GREATEST(arrival + 1, LEAST(departure, $2::date)) WHERE booking_id = $1`,
    [bookingId, property.business_date, invoice?.invoice_id ?? null]);
  return { invoice_id: invoice?.invoice_id ?? null, invoice_number: invoice?.invoice_number ?? null, total: invoice?.total ?? 0, restaurant_bills_paid: paidInvoices };
};
