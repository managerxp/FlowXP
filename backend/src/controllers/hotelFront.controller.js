/*
 * Hotel front office endpoints: availability and quotes, guests, bookings and their life (check-in, move, extend, cancel, no-show, check-out),
 * the folio (charges and payments), the room rack and housekeeping, and night audit. Mounted at /api/hotel (see hotel.routes.js).
 * Money comes in as rupees and goes out as both paise (`*_paise`) and rupees.
 */
import pool from '../config/database.js';
import { withTransaction } from '../modules/wholesale/common.js';
import {
  BOOKING_SOURCES, DEPARTMENTS, FOLIO_METHODS, HotelError, audit, bool, getProperty, int, isoDate, like, money, num, ok, oneOf, page, paging, phone, text, withRupees, wrapAll
} from '../modules/hotel/common.js';
import { availabilityGrid, freeRooms, stayChart } from '../modules/hotel/availability.js';
import { quoteStay } from '../modules/hotel/pricing.js';
import * as stay from '../modules/hotel/stay.js';
import * as folio from '../modules/hotel/folio.js';
import * as hk from '../modules/hotel/housekeeping.js';
import * as audits from '../modules/hotel/nightAudit.js';
import { inHouseGuests } from '../modules/hotel/roomCharge.js';
import { addDaysISO } from '../utils/dates.js';

const out = (res, data, status = 200) => ok(res, withRupees(data), status);

const guestInput = (g = {}) => {
  const v = {
    guest_id: g.guest_id == null ? undefined : int(g.guest_id, 'Guest', { min: 1 }),
    name: g.name === undefined ? undefined : text(g.name, 'The guest’s name', { max: 120 }) ?? undefined,
    phone: g.phone === undefined ? undefined : phone(g.phone, 'Phone'),
    email: g.email === undefined ? undefined : text(g.email, 'Email', { max: 255 }),
    company: g.company === undefined ? undefined : text(g.company, 'Company', { max: 120 }),
    gstin: g.gstin === undefined ? undefined : text(g.gstin, 'GSTIN', { max: 20 })?.toUpperCase(),
    id_type: g.id_type === undefined ? undefined : text(g.id_type, 'ID type', { max: 24 }),
    id_number: g.id_number === undefined ? undefined : text(g.id_number, 'ID number', { max: 40 }),
    nationality: g.nationality === undefined ? undefined : text(g.nationality, 'Nationality', { max: 60 }),
    address: g.address === undefined ? undefined : text(g.address, 'Address', { max: 400 }),
    city: g.city === undefined ? undefined : text(g.city, 'City', { max: 80 }),
    state: g.state === undefined ? undefined : text(g.state, 'State', { max: 80 }),
    country: g.country === undefined ? undefined : text(g.country, 'Country', { max: 60 }),
    dob: g.dob === undefined ? undefined : isoDate(g.dob, 'Date of birth'),
    is_vip: g.is_vip === undefined ? undefined : bool(g.is_vip),
    notes: g.notes === undefined ? undefined : text(g.notes, 'Notes', { max: 500 })
  };
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
};

const bookingInput = (b, { walkIn = false } = {}) => {
  const arrival = walkIn ? undefined : isoDate(b.arrival, 'Arrival', { required: true });
  const departure = isoDate(b.departure, 'Departure', { required: true });
  if (!Array.isArray(b.rooms) || !b.rooms.length) throw new HotelError(400, 'Choose at least one room');
  const rooms = b.rooms.map((r) => ({
    room_type_id: int(r.room_type_id, 'Room type', { required: true, min: 1 }), room_id: int(r.room_id, 'Room', { min: 1 }) ?? undefined,
    adults: int(r.adults, 'Adults', { min: 1, max: 20 }) ?? 1, children: int(r.children, 'Children', { min: 0, max: 20 }) ?? 0,
    rate_paise: r.rate == null || r.rate === '' ? undefined : money(r.rate, 'The rate'), guest_name: text(r.guest_name, 'Guest name', { max: 120 }) ?? undefined
  }));
  let advance;
  if (b.advance && Number(b.advance.amount) > 0) {
    advance = { amount_paise: money(b.advance.amount, 'The advance', { required: true, min: 1 }), method: oneOf(b.advance.method, 'Payment method', FOLIO_METHODS, { required: true }), reference: text(b.advance.reference, 'Reference', { max: 80 }) ?? undefined };
  }
  return {
    guest: guestInput(b.guest), arrival, departure, rooms, advance, rate_plan_id: int(b.rate_plan_id, 'Rate plan', { min: 1 }) ?? undefined,
    source: oneOf(b.source, 'Source', BOOKING_SOURCES, { fallback: walkIn ? 'WALK_IN' : 'PHONE' }), source_ref: text(b.source_ref, 'Reference', { max: 60 }) ?? undefined,
    company: text(b.company, 'Company', { max: 120 }) ?? undefined, notes: text(b.notes, 'Notes', { max: 1000 }) ?? undefined, allow_dirty: bool(b.allow_dirty)
  };
};

const detail = (req, id) => stay.bookingDetail(pool, req.tenant, id);

export default wrapAll({
  /* ── the till's "Charge to room" picker: guests in the hotel now ── */
  roomChargeGuests: async (req, res) => out(res, await inHouseGuests(pool, req.tenant, text(req.query.q, 'Search', { max: 60 }) ?? '')),

  /* ── the front desk at a glance ─────────────────────────────── */
  dashboard: async (req, res) => {
    const property = await getProperty(pool, req.tenant);
    const d = property.business_date;
    const one = async (sql, args = [req.tenant.branchId, d]) => (await pool.query(sql, args)).rows[0];
    const n = await one(
      `SELECT (SELECT COUNT(*) FROM hotel_bookings WHERE branch_id = $1 AND status = 'CONFIRMED' AND arrival = $2)::int AS arrivals_due,
              (SELECT COUNT(*) FROM hotel_bookings WHERE branch_id = $1 AND status = 'CONFIRMED' AND arrival < $2)::int AS arrivals_late,
              (SELECT COUNT(*) FROM hotel_bookings WHERE branch_id = $1 AND status = 'CHECKED_IN' AND departure <= $2)::int AS departures_due,
              (SELECT COUNT(*) FROM hotel_booking_rooms WHERE branch_id = $1 AND status = 'IN_HOUSE')::int AS rooms_in_house,
              (SELECT COALESCE(SUM(adults + children), 0) FROM hotel_booking_rooms WHERE branch_id = $1 AND status = 'IN_HOUSE')::int AS guests_in_house,
              (SELECT COUNT(*) FROM rooms WHERE branch_id = $1 AND is_active)::int AS total_rooms,
              (SELECT COUNT(*) FROM rooms WHERE branch_id = $1 AND is_active AND hk_status = 'OUT_OF_ORDER')::int AS out_of_order,
              (SELECT COUNT(*) FROM rooms WHERE branch_id = $1 AND is_active AND hk_status = 'DIRTY')::int AS dirty,
              (SELECT COUNT(*) FROM hotel_booking_rooms WHERE branch_id = $1 AND status = 'RESERVED' AND arrival = $2)::int AS rooms_arriving`);
    const sellable = n.total_rooms - n.out_of_order;
    out(res, { business_date: d, check_in_time: property.check_in_time, check_out_time: property.check_out_time, ...n, occupancy_pct: sellable > 0 ? Math.round((n.rooms_in_house / sellable) * 1000) / 10 : 0 });
  },

  availability: async (req, res) => {
    const from = isoDate(req.query.from, 'From', { required: true }); const to = isoDate(req.query.to, 'To') || addDaysISO(from, 14);
    out(res, { from, to, room_types: await availabilityGrid(pool, req.tenant, { from, to }) });
  },

  chart: async (req, res) => {
    const from = isoDate(req.query.from, 'From', { required: true }); const to = isoDate(req.query.to, 'To') || addDaysISO(from, 14);
    out(res, await stayChart(pool, req.tenant, { from, to }));
  },

  quote: async (req, res) => {
    const q = req.query;
    const arrival = isoDate(q.arrival, 'Arrival', { required: true }); const departure = isoDate(q.departure, 'Departure', { required: true });
    if (!(departure > arrival)) throw new HotelError(400, 'The departure must be after the arrival');
    out(res, await quoteStay(pool, {
      branchId: req.tenant.branchId, roomTypeId: int(q.room_type_id, 'Room type', { required: true }), ratePlanId: int(q.rate_plan_id, 'Rate plan'), arrival, departure,
      adults: int(q.adults, 'Adults', { min: 1 }) ?? 1, children: int(q.children, 'Children', { min: 0 }) ?? 0
    }));
  },

  freeRooms: async (req, res) => {
    const arrival = isoDate(req.query.arrival, 'Arrival', { required: true }); const departure = isoDate(req.query.departure, 'Departure', { required: true });
    out(res, await freeRooms(pool, req.tenant, { roomTypeId: int(req.query.room_type_id, 'Room type'), arrival, departure, excludeRrId: int(req.query.exclude_rr_id, 'Room') }));
  },

  /* ── guests ─────────────────────────────────────────────────── */
  searchGuests: async (req, res) => out(res, await stay.searchGuests(pool, req.tenant, { q: text(req.query.q, 'Search', { max: 80 }), like, limit: 20 })),

  saveGuest: async (req, res) => {
    const v = guestInput({ ...(req.body || {}), guest_id: req.params.id ? Number(req.params.id) : undefined });
    const g = await withTransaction((c) => stay.saveGuest(c, req.tenant, v));
    audit(req, req.params.id ? 'hotel.guest_updated' : 'hotel.guest_created', 'guest', g.guest_id, null, { name: g.name });
    out(res, g, req.params.id ? 200 : 201);
  },

  /* ── bookings ───────────────────────────────────────────────── */
  listBookings: async (req, res) => {
    const p = paging(req.query, { max: 100, fallback: 30 });
    const { rows, total } = await stay.listBookings(pool, req.tenant, {
      status: req.query.status ? String(req.query.status).toUpperCase() : null, from: isoDate(req.query.from, 'From'), to: isoDate(req.query.to, 'To'),
      q: text(req.query.q, 'Search', { max: 80 }), like, guestId: int(req.query.guest_id, 'Guest'), ...p
    });
    page(res, withRupees(rows), total, p);
  },

  getBooking: async (req, res) => out(res, await detail(req, Number(req.params.id))),

  createBooking: async (req, res) => {
    const v = bookingInput(req.body || {});
    const id = await withTransaction((c) => stay.createBooking(c, req.tenant, req.auth.userId, v));
    audit(req, 'hotel.booking_created', 'booking', id, null, { arrival: v.arrival, departure: v.departure, rooms: v.rooms.length });
    out(res, await detail(req, id), 201);
  },

  walkIn: async (req, res) => {
    const v = bookingInput(req.body || {}, { walkIn: true });
    const id = await withTransaction((c) => stay.walkIn(c, req.tenant, req.auth.userId, v));
    audit(req, 'hotel.walk_in', 'booking', id, null, { rooms: v.rooms.length });
    out(res, await detail(req, id), 201);
  },

  checkIn: async (req, res) => {
    const b = req.body || {};
    const assignments = (Array.isArray(b.assignments) ? b.assignments : []).map((a) => ({ rr_id: int(a.rr_id, 'Room', { required: true }), room_id: int(a.room_id, 'Room number', { required: true }) }));
    await withTransaction((c) => stay.checkIn(c, req.tenant, req.auth.userId, Number(req.params.id), { assignments, allowDirty: bool(b.allow_dirty), guest: b.guest ? guestInput(b.guest) : undefined }));
    audit(req, 'hotel.checked_in', 'booking', Number(req.params.id));
    out(res, await detail(req, Number(req.params.id)));
  },

  changeDates: async (req, res) => {
    const b = req.body || {};
    const arrival = isoDate(b.arrival, 'Arrival'); const departure = isoDate(b.departure, 'Departure');
    if (!arrival && !departure) throw new HotelError(400, 'Choose the new dates');
    await withTransaction((c) => stay.changeDates(c, req.tenant, req.auth.userId, Number(req.params.id), { rrId: int(b.rr_id, 'Room'), arrival, departure }));
    audit(req, 'hotel.dates_changed', 'booking', Number(req.params.id), null, { arrival, departure });
    out(res, await detail(req, Number(req.params.id)));
  },

  moveRoom: async (req, res) => {
    const b = req.body || {};
    const r = await withTransaction((c) => stay.moveRoom(c, req.tenant, req.auth.userId, Number(req.params.id), {
      rrId: int(b.rr_id, 'Room', { required: true }), roomId: int(b.room_id, 'New room', { required: true }), newRatePaise: b.rate == null || b.rate === '' ? null : money(b.rate, 'The rate')
    }));
    audit(req, 'hotel.room_moved', 'booking', Number(req.params.id), null, { reason: text(b.reason, 'Reason', { max: 200 }), ...r });
    out(res, await detail(req, Number(req.params.id)));
  },

  cancel: async (req, res) => {
    const reason = text(req.body?.reason, 'The reason', { required: true, max: 300 });
    await withTransaction((c) => stay.cancelBooking(c, req.tenant, req.auth.userId, Number(req.params.id), reason));
    audit(req, 'hotel.booking_cancelled', 'booking', Number(req.params.id), null, { reason });
    out(res, await detail(req, Number(req.params.id)));
  },

  noShow: async (req, res) => {
    await withTransaction((c) => stay.markNoShow(c, req.tenant, req.auth.userId, Number(req.params.id)));
    audit(req, 'hotel.no_show', 'booking', Number(req.params.id));
    out(res, await detail(req, Number(req.params.id)));
  },

  checkOut: async (req, res) => {
    const b = req.body || {};
    const settlement = b.settlement?.method ? { method: oneOf(b.settlement.method, 'Payment method', FOLIO_METHODS, { required: true }), reference: text(b.settlement.reference, 'Reference', { max: 80 }) } : null;
    const refundMethod = b.refund_method ? oneOf(b.refund_method, 'Refund method', FOLIO_METHODS, { required: true }) : null;
    const r = await withTransaction((c) => stay.checkOut(c, req.tenant, req.auth.userId, Number(req.params.id), { settlement, refundMethod }));
    audit(req, 'hotel.checked_out', 'booking', Number(req.params.id), null, { invoice: r.invoice_number });
    out(res, { ...r, booking: await detail(req, Number(req.params.id)) });
  },

  /* ── folio ──────────────────────────────────────────────────── */
  getFolio: async (req, res) => out(res, await folio.folioOf(pool, req.tenant, Number(req.params.id))),

  postCharge: async (req, res) => {
    const b = req.body || {};
    const row = await withTransaction((c) => folio.postCharge(c, req.tenant, req.auth.userId, Number(req.params.id), {
      department: oneOf(b.department, 'Department', DEPARTMENTS, { required: true }), description: text(b.description, 'Description', { required: true, max: 200 }),
      quantity: num(b.quantity, 'Quantity', { min: 0.001, max: 100000 }) ?? 1, unit_price_paise: money(b.price, 'The price', { required: true }), tax_rate: num(b.tax_rate, 'The GST rate', { min: 0, max: 100 }) ?? 0,
      rr_id: int(b.rr_id, 'Room', { min: 1 }) ?? undefined
    }));
    audit(req, 'hotel.charge_posted', 'folio_charge', row.charge_id, null, { booking_id: Number(req.params.id), description: row.description, amount: (Number(row.amount_paise) + Number(row.tax_paise)) / 100 });
    out(res, row, 201);
  },

  voidCharge: async (req, res) => {
    const reason = text(req.body?.reason, 'The reason', { required: true, max: 200 });
    const c0 = await withTransaction((c) => folio.voidCharge(c, req.tenant, req.auth.userId, Number(req.params.id), reason));
    audit(req, 'hotel.charge_voided', 'folio_charge', Number(req.params.id), null, { reason, description: c0.description, amount: (Number(c0.amount_paise) + Number(c0.tax_paise)) / 100 });
    out(res, { voided: true });
  },

  addPayment: async (req, res) => {
    const b = req.body || {};
    const row = await withTransaction((c) => folio.addPayment(c, req.tenant, req.auth.userId, Number(req.params.id), {
      kind: oneOf(b.kind, 'Type', ['ADVANCE', 'PAYMENT', 'REFUND'], { fallback: 'PAYMENT' }), method: oneOf(b.method, 'Payment method', FOLIO_METHODS, { required: true }),
      amount_paise: money(b.amount, 'The amount', { required: true, min: 1 }), reference: text(b.reference, 'Reference', { max: 80 }) ?? undefined
    }));
    audit(req, `hotel.${row.kind.toLowerCase()}_recorded`, 'booking', Number(req.params.id), null, { amount: Number(row.amount_paise) / 100, method: row.method });
    out(res, row, 201);
  },

  /* ── room rack, housekeeping ────────────────────────────────── */
  rack: async (req, res) => out(res, await hk.roomRack(pool, req.tenant)),

  setRoomStatus: async (req, res) => {
    const b = req.body || {};
    const r = await withTransaction((c) => hk.setRoomStatus(c, req.tenant, req.auth.userId, Number(req.params.id), oneOf(b.status, 'Status', hk.HK_STATUSES, { required: true }), text(b.note, 'Note', { max: 200 })));
    audit(req, 'hotel.room_status', 'room', Number(req.params.id), { status: r.before }, { status: r.after });
    out(res, r);
  },

  /* ── night audit ────────────────────────────────────────────── */
  auditPreview: async (req, res) => out(res, await audits.auditPreview(pool, req.tenant)),

  runAudit: async (req, res) => {
    const r = await withTransaction((c) => audits.runNightAudit(c, req.tenant, req.auth.userId, { noShowAll: bool(req.body?.no_show_all), notes: text(req.body?.notes, 'Notes', { max: 300 }) }));
    audit(req, 'hotel.night_audit', 'hotel_property', req.tenant.branchId, null, r);
    out(res, r);
  }
});
