/*
 * Banquet and events endpoints, mounted at /api/hotel/banquet (see hotel.routes.js). Money comes in as rupees and goes out as paise and rupees.
 */
import pool from '../config/database.js';
import { withTransaction } from '../modules/wholesale/common.js';
import { BOOKING_SOURCES, FOLIO_METHODS, HotelError, audit, bool, getProperty, int, isoDate, like, money, num, ok, oneOf, page, paging, text, withRupees, wrapAll } from '../modules/hotel/common.js';
import * as bq from '../modules/hotel/banquet.js';
import { saveGuest } from '../modules/hotel/stay.js';
import { addDaysISO } from '../utils/dates.js';

const out = (res, data, status = 200) => ok(res, withRupees(data), status);
const time = (v, field) => { const s = String(v ?? '').slice(0, 5); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) throw new HotelError(400, `${field} must be a time like 19:30`); return s; };
const amenities = (a) => (Array.isArray(a) ? a.map((x) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 30) : []);

const guestInput = (g = {}) => Object.fromEntries(Object.entries({
  guest_id: g.guest_id == null ? undefined : int(g.guest_id, 'Organiser', { min: 1 }), name: g.name === undefined ? undefined : text(g.name, 'The organiser’s name', { max: 120 }) ?? undefined,
  phone: g.phone === undefined ? undefined : text(g.phone, 'Phone', { max: 32 }), email: g.email === undefined ? undefined : text(g.email, 'Email', { max: 255 }),
  company: g.company === undefined ? undefined : text(g.company, 'Company', { max: 120 }), gstin: g.gstin === undefined ? undefined : text(g.gstin, 'GSTIN', { max: 20 })?.toUpperCase(),
  address: g.address === undefined ? undefined : text(g.address, 'Address', { max: 400 }), state: g.state === undefined ? undefined : text(g.state, 'State', { max: 80 })
}).filter(([, x]) => x !== undefined));

const functionInput = (f, { partial = false } = {}) => {
  const v = {
    hall_id: f.hall_id === undefined ? undefined : int(f.hall_id, 'Hall', { required: true, min: 1 }),
    name: f.name === undefined ? undefined : text(f.name, 'The function’s name', { required: true, max: 80 }),
    event_date: f.event_date === undefined ? undefined : isoDate(f.event_date, 'Date', { required: true }),
    start_time: f.start_time === undefined ? undefined : time(f.start_time, 'Start time'), end_time: f.end_time === undefined ? undefined : time(f.end_time, 'End time'),
    expected_guests: f.expected_guests === undefined ? undefined : int(f.expected_guests, 'Expected guests', { min: 0, max: 20000 }) ?? 0,
    guaranteed_guests: f.guaranteed_guests === undefined ? undefined : (f.guaranteed_guests === null || f.guaranteed_guests === '' ? null : int(f.guaranteed_guests, 'Guaranteed guests', { min: 0, max: 20000 })),
    package_id: f.package_id === undefined ? undefined : (f.package_id ? int(f.package_id, 'Package', { min: 1 }) : null),
    per_plate_paise: f.per_plate === undefined ? undefined : money(f.per_plate, 'The price a plate') ?? 0, rent_paise: f.rent === undefined ? undefined : money(f.rent, 'The hall rent') ?? 0,
    setup_style: f.setup_style === undefined ? undefined : oneOf(f.setup_style, 'Set-up', bq.SETUP_STYLES, { fallback: 'BANQUET_ROUNDS' }),
    menu: f.menu === undefined ? undefined : text(f.menu, 'Menu', { max: 4000 }), setup_notes: f.setup_notes === undefined ? undefined : text(f.setup_notes, 'Set-up notes', { max: 2000 })
  };
  if (!partial) for (const k of ['hall_id', 'name', 'event_date', 'start_time', 'end_time']) if (v[k] === undefined) throw new HotelError(400, `${k.replace('_', ' ')} is required`);
  if (v.start_time && v.end_time && !(v.end_time > v.start_time)) throw new HotelError(400, 'The function must end after it starts');
  if (!partial && v.expected_guests === undefined) v.expected_guests = 0;
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined));
};

const detail = (req, id) => bq.eventDetail(pool, req.tenant, id);

export default wrapAll({
  /* ── halls and packages ─────────────────────────────────────── */
  listHalls: async (req, res) => out(res, (await bq.listHalls(pool, req.tenant, { all: req.query.all === '1' })).map((h) => ({ ...h, rent: Number(h.rent_paise) / 100 }))),

  saveHall: async (req, res) => {
    const b = req.body || {};
    const id = req.params.id ? Number(req.params.id) : null;
    const v = { name: text(b.name, 'Name', { required: true, max: 80 }), capacity_seated: int(b.capacity_seated, 'Seated capacity', { min: 0, max: 20000 }) ?? 0, capacity_floating: int(b.capacity_floating, 'Standing capacity', { min: 0, max: 20000 }) ?? 0,
      rent_paise: money(b.rent, 'The rent') ?? 0, amenities: amenities(b.amenities), sort_order: int(b.sort_order, 'Order', { min: 0, max: 1000 }) ?? 0, is_active: b.is_active === undefined ? true : bool(b.is_active) };
    const h = await withTransaction((c) => bq.saveHall(c, req.tenant, id, v));
    audit(req, id ? 'banquet.hall_updated' : 'banquet.hall_created', 'banquet_hall', h.hall_id, null, { name: h.name });
    out(res, h, id ? 200 : 201);
  },

  archiveHall: async (req, res) => { await withTransaction((c) => bq.archiveHall(c, req.tenant, Number(req.params.id))); ok(res, { archived: true }); },

  listPackages: async (req, res) => out(res, await bq.listPackages(pool, req.tenant, { all: req.query.all === '1' })),

  savePackage: async (req, res) => {
    const b = req.body || {};
    const id = req.params.id ? Number(req.params.id) : null;
    const tax = num(b.tax_rate, 'The GST rate', { min: 0, max: 100 }) ?? 18;
    const v = { name: text(b.name, 'Name', { required: true, max: 80 }), diet: oneOf(b.diet, 'Diet', ['VEG', 'NON_VEG', 'JAIN', 'MIXED'], { fallback: 'VEG' }), per_plate_paise: money(b.per_plate, 'The price a plate', { required: true }),
      min_guests: int(b.min_guests, 'Minimum guests', { min: 0, max: 20000 }) ?? 0, tax_rate: tax, menu: text(b.menu, 'Menu', { max: 4000 }), sort_order: int(b.sort_order, 'Order', { min: 0, max: 1000 }) ?? 0, is_active: b.is_active === undefined ? true : bool(b.is_active) };
    const p = await withTransaction((c) => bq.savePackage(c, req.tenant, id, v));
    audit(req, id ? 'banquet.package_updated' : 'banquet.package_created', 'banquet_package', p.package_id, null, { name: p.name });
    out(res, p, id ? 200 : 201);
  },

  archivePackage: async (req, res) => { await withTransaction((c) => bq.archivePackage(c, req.tenant, Number(req.params.id))); ok(res, { archived: true }); },

  /* ── the hall calendar ──────────────────────────────────────── */
  calendar: async (req, res) => {
    const property = await getProperty(pool, req.tenant);
    const from = isoDate(req.query.from, 'From') || property.business_date; const to = isoDate(req.query.to, 'To') || addDaysISO(from, 30);
    out(res, await bq.hallCalendar(pool, req.tenant, { from, to }));
  },

  checkHall: async (req, res) => {
    const q = req.query;
    out(res, { conflicts: await bq.hallConflicts(pool, req.tenant, { hallId: int(q.hall_id, 'Hall', { required: true }), date: isoDate(q.date, 'Date', { required: true }), start: time(q.start, 'Start time'), end: time(q.end, 'End time'), excludeFunctionId: int(q.exclude_function_id, 'Function') }) });
  },

  /* ── events ─────────────────────────────────────────────────── */
  listEvents: async (req, res) => {
    const p = paging(req.query, { max: 100, fallback: 30 });
    const { rows, total } = await bq.listEvents(pool, req.tenant, { status: req.query.status ? String(req.query.status).toUpperCase() : null, q: text(req.query.q, 'Search', { max: 80 }), like, from: isoDate(req.query.from, 'From'), to: isoDate(req.query.to, 'To'), ...p });
    page(res, withRupees(rows), total, p);
  },

  getEvent: async (req, res) => out(res, await detail(req, Number(req.params.id))),

  createEvent: async (req, res) => {
    const b = req.body || {};
    const functions = (Array.isArray(b.functions) ? b.functions : []).map((f) => functionInput(f));
    const v = {
      guest: guestInput(b.guest), title: text(b.title, 'The event’s title', { required: true, max: 160 }), event_type: oneOf(b.event_type, 'Type of event', bq.EVENT_TYPES, { fallback: 'OTHER' }),
      status: oneOf(b.status, 'Status', ['ENQUIRY', 'TENTATIVE', 'CONFIRMED'], { fallback: 'ENQUIRY' }), hold_until: isoDate(b.hold_until, 'Hold until') || undefined, company: text(b.company, 'Company', { max: 120 }) ?? undefined,
      source: oneOf(b.source, 'Source', BOOKING_SOURCES, { fallback: 'PHONE' }), notes: text(b.notes, 'Notes', { max: 1000 }) ?? undefined, instructions: text(b.instructions, 'Instructions', { max: 3000 }) ?? undefined, functions
    };
    const id = await withTransaction((c) => bq.createEvent(c, req.tenant, req.auth.userId, v));
    audit(req, 'banquet.event_created', 'banquet_event', id, null, { title: v.title, status: v.status });
    out(res, await detail(req, id), 201);
  },

  updateEvent: async (req, res) => {
    const b = req.body || {};
    const v = {
      title: b.title === undefined ? undefined : text(b.title, 'The event’s title', { required: true, max: 160 }), event_type: b.event_type === undefined ? undefined : oneOf(b.event_type, 'Type of event', bq.EVENT_TYPES, { required: true }),
      company: b.company === undefined ? undefined : text(b.company, 'Company', { max: 120 }), notes: b.notes === undefined ? undefined : text(b.notes, 'Notes', { max: 1000 }),
      instructions: b.instructions === undefined ? undefined : text(b.instructions, 'Instructions', { max: 3000 }), source: b.source === undefined ? undefined : oneOf(b.source, 'Source', BOOKING_SOURCES, { required: true }),
      hold_until: b.hold_until === undefined ? undefined : (isoDate(b.hold_until, 'Hold until') || null)
    };
    await withTransaction((c) => bq.updateEvent(c, req.tenant, req.auth.userId, Number(req.params.id), v));
    audit(req, 'banquet.event_updated', 'banquet_event', Number(req.params.id));
    out(res, await detail(req, Number(req.params.id)));
  },

  setStatus: async (req, res) => {
    const b = req.body || {};
    const status = oneOf(b.status, 'Status', ['ENQUIRY', 'TENTATIVE', 'CONFIRMED'], { required: true });
    await withTransaction((c) => bq.setStatus(c, req.tenant, req.auth.userId, Number(req.params.id), { status, holdUntil: isoDate(b.hold_until, 'Hold until') || null }));
    audit(req, 'banquet.event_status', 'banquet_event', Number(req.params.id), null, { status });
    out(res, await detail(req, Number(req.params.id)));
  },

  cancelEvent: async (req, res) => {
    const reason = text(req.body?.reason, 'The reason', { required: true, max: 300 });
    await withTransaction((c) => bq.cancelEvent(c, req.tenant, req.auth.userId, Number(req.params.id), reason));
    audit(req, 'banquet.event_cancelled', 'banquet_event', Number(req.params.id), null, { reason });
    out(res, await detail(req, Number(req.params.id)));
  },

  /* ── functions ──────────────────────────────────────────────── */
  addFunction: async (req, res) => {
    const f = functionInput(req.body || {});
    await withTransaction((c) => bq.addFunction(c, req.tenant, req.auth.userId, Number(req.params.id), f));
    audit(req, 'banquet.function_added', 'banquet_event', Number(req.params.id), null, { name: f.name });
    out(res, await detail(req, Number(req.params.id)), 201);
  },

  updateFunction: async (req, res) => {
    const f = functionInput(req.body || {}, { partial: true });
    const fid = Number(req.params.id);
    await withTransaction((c) => bq.updateFunction(c, req.tenant, req.auth.userId, fid, f));
    const ev = (await pool.query(`SELECT event_id FROM banquet_functions WHERE function_id = $1`, [fid])).rows[0];
    audit(req, 'banquet.function_updated', 'banquet_event', ev.event_id, null, { function_id: fid });
    out(res, await detail(req, ev.event_id));
  },

  removeFunction: async (req, res) => {
    const fid = Number(req.params.id);
    const ev = (await pool.query(`SELECT event_id FROM banquet_functions WHERE function_id = $1 AND branch_id = $2`, [fid, req.tenant.branchId])).rows[0];
    if (!ev) throw new HotelError(404, 'Function not found');
    await withTransaction((c) => bq.removeFunction(c, req.tenant, req.auth.userId, fid));
    audit(req, 'banquet.function_removed', 'banquet_event', ev.event_id, null, { function_id: fid });
    out(res, await detail(req, ev.event_id));
  },

  /* ── money ──────────────────────────────────────────────────── */
  postCharge: async (req, res) => {
    const b = req.body || {};
    const row = await withTransaction((c) => bq.postCharge(c, req.tenant, req.auth.userId, Number(req.params.id), {
      category: oneOf(b.category, 'What it is for', bq.CHARGE_CATEGORIES, { required: true }), description: text(b.description, 'Description', { required: true, max: 200 }), quantity: num(b.quantity, 'Quantity', { min: 0.001, max: 1000000 }) ?? 1,
      unit_price_paise: money(b.price, 'The price', { required: true }), tax_rate: num(b.tax_rate, 'The GST rate', { min: 0, max: 100 }) ?? 18, function_id: int(b.function_id, 'Function', { min: 1 }) ?? undefined
    }));
    audit(req, 'banquet.charge_posted', 'banquet_charge', row.charge_id, null, { event_id: Number(req.params.id), description: row.description, amount: (Number(row.amount_paise) + Number(row.tax_paise)) / 100 });
    out(res, row, 201);
  },

  voidCharge: async (req, res) => {
    const reason = text(req.body?.reason, 'The reason', { required: true, max: 200 });
    const c0 = await withTransaction((c) => bq.voidCharge(c, req.tenant, req.auth.userId, Number(req.params.id), reason));
    audit(req, 'banquet.charge_voided', 'banquet_charge', Number(req.params.id), null, { reason, description: c0.description });
    out(res, { voided: true });
  },

  addPayment: async (req, res) => {
    const b = req.body || {};
    const row = await withTransaction((c) => bq.addPayment(c, req.tenant, req.auth.userId, Number(req.params.id), {
      kind: oneOf(b.kind, 'Type', ['ADVANCE', 'PAYMENT', 'REFUND'], { fallback: 'ADVANCE' }), method: oneOf(b.method, 'Payment method', FOLIO_METHODS, { required: true }), amount_paise: money(b.amount, 'The amount', { required: true, min: 1 }), reference: text(b.reference, 'Reference', { max: 80 }) ?? undefined
    }));
    audit(req, `banquet.${row.kind.toLowerCase()}_recorded`, 'banquet_event', Number(req.params.id), null, { amount: Number(row.amount_paise) / 100, method: row.method });
    out(res, row, 201);
  },

  proforma: async (req, res) => out(res, await bq.proforma(pool, req.tenant, Number(req.params.id))),

  complete: async (req, res) => {
    const b = req.body || {};
    const settlement = b.settlement?.method ? { method: oneOf(b.settlement.method, 'Payment method', FOLIO_METHODS, { required: true }), reference: text(b.settlement.reference, 'Reference', { max: 80 }) } : null;
    const refundMethod = b.refund_method ? oneOf(b.refund_method, 'Refund method', FOLIO_METHODS, { required: true }) : null;
    const r = await withTransaction((c) => bq.complete(c, req.tenant, req.auth.userId, Number(req.params.id), { settlement, refundMethod }));
    audit(req, 'banquet.event_completed', 'banquet_event', Number(req.params.id), null, { invoice: r.invoice_number });
    out(res, { ...r, event: await detail(req, Number(req.params.id)) });
  },

  summary: async (req, res) => {
    const property = await getProperty(pool, req.tenant);
    const to = isoDate(req.query.to, 'To') || property.business_date; const from = isoDate(req.query.from, 'From') || `${to.slice(0, 8)}01`;
    out(res, await bq.banquetSummary(pool, req.tenant, from, to));
  }
});
