/*
 * Hotel set-up endpoints: property settings, room types, rooms, rate plans, seasonal rates and rooms taken out of sale.
 * Mounted at /api/hotel (see hotel.routes.js). Reading needs any front-office permission; changing needs 'hotel_setup'.
 */
import pool from '../config/database.js';
import { withTransaction } from '../modules/wholesale/common.js';
import { HotelError, MEAL_PLAN_NAMES, audit, bool, diff, idList, int, isoDate, money, ok, oneOf, text, wrapAll } from '../modules/hotel/common.js';
import * as setup from '../modules/hotel/setup.js';
import { MEAL_PLANS } from '../modules/hotel/common.js';

const rupees = (p) => (p == null ? null : Number(p) / 100);
const asType = (t) => ({ ...t, base_rate: rupees(t.base_rate_paise), extra_adult: rupees(t.extra_adult_paise), extra_child: rupees(t.extra_child_paise) });
const code = (v, field) => { const c = text(v, field, { required: true, max: 12 }).toUpperCase().replace(/\s+/g, ''); if (!/^[A-Z0-9_-]+$/.test(c)) throw new HotelError(400, `${field} can use letters, numbers and dashes`); return c; };
const time = (v, field) => { if (v == null || v === '') return undefined; if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v).slice(0, 5))) throw new HotelError(400, `${field} must be a time like 12:00`); return String(v).slice(0, 5); };
const pctOf = (v, field) => { if (v == null || v === '') return undefined; const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 100) throw new HotelError(400, `${field} must be from 0 to 100`); return n; };

const settingsView = (s) => ({ ...s, tax_threshold: rupees(s.tax_threshold_paise) });

export default wrapAll({
  getSettings: async (req, res) => ok(res, settingsView(await setup.settingsOf(pool, req.tenant))),

  updateSettings: async (req, res) => {
    const b = req.body || {};
    const prefix = b.res_prefix == null ? undefined : text(b.res_prefix, 'Booking number prefix', { max: 8, required: true }).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const values = {
      check_in_time: time(b.check_in_time, 'Check-in time'), check_out_time: time(b.check_out_time, 'Check-out time'),
      tax_threshold_paise: b.tax_threshold == null ? undefined : money(b.tax_threshold, 'The tariff limit', { required: true }),
      tax_low_pct: pctOf(b.tax_low_pct, 'The GST rate up to the limit'), tax_high_pct: pctOf(b.tax_high_pct, 'The GST rate above the limit'),
      allow_overbooking: b.allow_overbooking == null ? undefined : bool(b.allow_overbooking), res_prefix: prefix || undefined,
      business_date: b.business_date ? isoDate(b.business_date, 'The hotel’s date') : undefined
    };
    const out = await withTransaction((c) => setup.updateSettings(c, req.tenant, values));
    audit(req, 'hotel.settings_updated', 'hotel_property', req.tenant.branchId, null, null, diff(out.before, out.after));
    ok(res, settingsView(out.after));
  },

  /* ── room types ─────────────────────────────────────────────── */
  listRoomTypes: async (req, res) => ok(res, (await setup.listRoomTypes(pool, req.tenant, { includeInactive: req.query.all === '1' })).map(asType)),

  createRoomType: async (req, res) => {
    const b = req.body || {};
    const base_adults = int(b.base_adults, 'Adults included in the rate', { min: 1, max: 20 }) ?? 2;
    const max_adults = int(b.max_adults, 'Most adults', { min: 1, max: 20 }) ?? Math.max(2, base_adults);
    if (max_adults < base_adults) throw new HotelError(400, 'The most adults cannot be fewer than the adults the rate includes');
    const v = {
      name: text(b.name, 'Name', { required: true, max: 80 }), code: code(b.code ?? String(b.name || '').slice(0, 4), 'Short code'), description: text(b.description, 'Description', { max: 500 }),
      base_rate_paise: money(b.base_rate, 'The rate', { required: true }), extra_adult_paise: money(b.extra_adult, 'The extra adult rate') ?? 0, extra_child_paise: money(b.extra_child, 'The extra child rate') ?? 0,
      base_adults, max_adults, max_children: int(b.max_children, 'Most children', { min: 0, max: 20 }) ?? 1,
      amenities: Array.isArray(b.amenities) ? b.amenities.map((a) => String(a).trim().slice(0, 40)).filter(Boolean).slice(0, 30) : [], sort_order: int(b.sort_order, 'Order', { min: 0, max: 1000 }) ?? 0
    };
    const row = await withTransaction((c) => setup.createRoomType(c, req.tenant, v));
    audit(req, 'hotel.room_type_created', 'room_type', row.room_type_id, null, { name: row.name });
    ok(res, asType(row), 201);
  },

  updateRoomType: async (req, res) => {
    const b = req.body || {};
    const v = {
      name: b.name === undefined ? undefined : text(b.name, 'Name', { required: true, max: 80 }), code: b.code === undefined ? undefined : code(b.code, 'Short code'),
      description: b.description === undefined ? undefined : text(b.description, 'Description', { max: 500 }),
      base_rate_paise: b.base_rate === undefined ? undefined : money(b.base_rate, 'The rate', { required: true }),
      extra_adult_paise: b.extra_adult === undefined ? undefined : money(b.extra_adult, 'The extra adult rate') ?? 0, extra_child_paise: b.extra_child === undefined ? undefined : money(b.extra_child, 'The extra child rate') ?? 0,
      base_adults: b.base_adults === undefined ? undefined : int(b.base_adults, 'Adults included in the rate', { min: 1, max: 20, required: true }),
      max_adults: b.max_adults === undefined ? undefined : int(b.max_adults, 'Most adults', { min: 1, max: 20, required: true }),
      max_children: b.max_children === undefined ? undefined : int(b.max_children, 'Most children', { min: 0, max: 20, required: true }),
      amenities: Array.isArray(b.amenities) ? b.amenities.map((a) => String(a).trim().slice(0, 40)).filter(Boolean).slice(0, 30) : undefined,
      sort_order: b.sort_order === undefined ? undefined : int(b.sort_order, 'Order', { min: 0, max: 1000, required: true }),
      is_active: b.is_active === undefined ? undefined : bool(b.is_active)
    };
    const out = await withTransaction((c) => setup.updateRoomType(c, req.tenant, Number(req.params.id), v));
    audit(req, 'hotel.room_type_updated', 'room_type', Number(req.params.id), null, null, diff(out.before, out.after));
    ok(res, asType(out.after));
  },

  archiveRoomType: async (req, res) => {
    await withTransaction((c) => setup.archiveRoomType(c, req.tenant, Number(req.params.id)));
    audit(req, 'hotel.room_type_archived', 'room_type', Number(req.params.id));
    ok(res, { archived: true });
  },

  /* ── rooms ──────────────────────────────────────────────────── */
  listRooms: async (req, res) => ok(res, await setup.listRooms(pool, req.tenant, { includeInactive: req.query.all === '1' })),

  createRoom: async (req, res) => {
    const b = req.body || {};
    const row = await withTransaction((c) => setup.createRoom(c, req.tenant, {
      room_type_id: int(b.room_type_id, 'Room type', { required: true }), room_no: text(b.room_no, 'Room number', { required: true, max: 16 }), floor: text(b.floor, 'Floor', { max: 16 })
    }));
    audit(req, 'hotel.room_created', 'room', row.room_id, null, { room_no: row.room_no });
    ok(res, row, 201);
  },

  createRooms: async (req, res) => {
    const b = req.body || {};
    const made = await withTransaction((c) => setup.createRooms(c, req.tenant, {
      room_type_id: int(b.room_type_id, 'Room type', { required: true }), from: int(b.from, 'First room number', { required: true, min: 0, max: 99999 }), to: int(b.to, 'Last room number', { required: true, min: 0, max: 99999 }),
      floor: text(b.floor, 'Floor', { max: 16 }), prefix: text(b.prefix, 'Prefix', { max: 6 }) || ''
    }));
    audit(req, 'hotel.rooms_created', 'room', null, null, { count: made.length });
    ok(res, made, 201);
  },

  updateRoom: async (req, res) => {
    const b = req.body || {};
    const out = await withTransaction((c) => setup.updateRoom(c, req.tenant, Number(req.params.id), {
      room_no: b.room_no === undefined ? undefined : text(b.room_no, 'Room number', { required: true, max: 16 }), floor: b.floor === undefined ? undefined : text(b.floor, 'Floor', { max: 16 }),
      room_type_id: b.room_type_id === undefined ? undefined : int(b.room_type_id, 'Room type', { required: true }), is_active: b.is_active === undefined ? undefined : bool(b.is_active)
    }));
    audit(req, 'hotel.room_updated', 'room', Number(req.params.id), null, null, diff(out.before, out.after));
    ok(res, out.after);
  },

  /* ── rate plans, seasonal rates ─────────────────────────────── */
  listRatePlans: async (req, res) => ok(res, (await setup.listRatePlans(pool, req.tenant)).map((p) => ({ ...p, meal_plan_name: MEAL_PLAN_NAMES[p.meal_plan], rates: Object.fromEntries(Object.entries(p.rates).map(([k, v]) => [k, v / 100])) }))),

  saveRatePlan: async (req, res) => {
    const b = req.body || {};
    const rates = {};
    for (const [typeId, value] of Object.entries(b.rates || {})) rates[typeId] = value === null || value === '' ? null : money(value, 'A rate');
    const plan = await withTransaction((c) => setup.saveRatePlan(c, req.tenant, req.params.id ? Number(req.params.id) : null, {
      name: text(b.name, 'Name', { required: true, max: 80 }), code: code(b.code, 'Short code'), meal_plan: oneOf(b.meal_plan, 'Meal plan', MEAL_PLANS, { fallback: 'EP' }), is_default: bool(b.is_default), rates
    }));
    audit(req, req.params.id ? 'hotel.rate_plan_updated' : 'hotel.rate_plan_created', 'rate_plan', plan.rate_plan_id, null, { name: plan.name });
    ok(res, plan, req.params.id ? 200 : 201);
  },

  archiveRatePlan: async (req, res) => {
    await withTransaction((c) => setup.archiveRatePlan(c, req.tenant, Number(req.params.id)));
    ok(res, { archived: true });
  },

  listOverrides: async (req, res) => ok(res, (await setup.listOverrides(pool, req.tenant)).map((o) => ({ ...o, rate: rupees(o.rate_paise) }))),

  createOverride: async (req, res) => {
    const b = req.body || {};
    const days = idList(b.days_of_week, 'Days', { max: 7 });
    if (days.some((d) => d < 0 || d > 6)) throw new HotelError(400, 'Days run from 0 (Sunday) to 6 (Saturday)');
    const from_date = isoDate(b.from_date, 'From', { required: true }); const to_date = isoDate(b.to_date, 'To', { required: true });
    if (to_date < from_date) throw new HotelError(400, 'The end date cannot be before the start');
    const row = await withTransaction((c) => setup.createOverride(c, req.tenant, {
      room_type_id: int(b.room_type_id, 'Room type', { required: true }), rate_plan_id: int(b.rate_plan_id, 'Rate plan'), name: text(b.name, 'Name', { max: 80 }), from_date, to_date, days_of_week: days,
      rate_paise: money(b.rate, 'The rate', { required: true })
    }));
    audit(req, 'hotel.seasonal_rate_created', 'rate_override', row.override_id, null, { from_date, to_date });
    ok(res, { ...row, rate: rupees(row.rate_paise) }, 201);
  },

  deleteOverride: async (req, res) => {
    await withTransaction((c) => setup.deleteOverride(c, req.tenant, Number(req.params.id)));
    ok(res, { deleted: true });
  },

  /* ── rooms out of sale ──────────────────────────────────────── */
  listBlocks: async (req, res) => ok(res, await setup.listBlocks(pool, req.tenant)),

  createBlock: async (req, res) => {
    const b = req.body || {};
    const from_date = isoDate(b.from_date, 'From', { required: true }); const to_date = isoDate(b.to_date, 'Until', { required: true });
    if (to_date <= from_date) throw new HotelError(400, 'The room must be out of sale for at least one night');
    const row = await withTransaction((c) => setup.createBlock(c, req.tenant, req.auth.userId, { room_id: int(b.room_id, 'Room', { required: true }), from_date, to_date, reason: text(b.reason, 'Reason', { max: 200 }) }));
    audit(req, 'hotel.room_blocked', 'room', row.room_id, null, { from_date, to_date, reason: b.reason || null });
    ok(res, row, 201);
  },

  deleteBlock: async (req, res) => {
    await withTransaction((c) => setup.deleteBlock(c, req.tenant, Number(req.params.id)));
    ok(res, { deleted: true });
  }
});
