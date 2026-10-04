/*
 * Appointments: booking, moving, cancelling, walk-ins, the day's schedule by staff member, and free slots.
 *
 * The rule that matters is "never two clients with one person at once". Every booking (and every move)
 * takes a transaction-scoped advisory lock per staff member, then checks the person's existing live
 * appointments for overlap inside the same transaction — two receptionists booking the last slot at the
 * same instant cannot both succeed. A booking also has to fall inside the person's working hours, on a day
 * they are not marked absent, for a service they perform.
 *
 * Times are stored as timestamptz and interpreted in the business's own timezone (modules/salon/schedule.js).
 */
import pool from '../config/database.js';
import { businessToday } from '../utils/dates.js';
import { branchFilter } from '../utils/scope.js';
import { findCustomerByPhone } from '../modules/loyalty.js';
import { ownStaffId } from '../modules/salon/access.js';
import {
  SalonError, audit, int, isoDate, ok, oneOf, phone, text, timestamp, wrapAll
} from '../modules/salon/common.js';
import { branchHours, getSettings } from '../modules/salon/settings.js';
import { afterAppointment } from '../modules/salon/automation.js';
import { fromLocal, freeSlots, localParts, toClock, workWindow } from '../modules/salon/schedule.js';
import { toRupees } from '../utils/money.js';

const LIVE = ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'];
const TRANSITIONS = {
  BOOKED: ['CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_SERVICE', 'CANCELLED'],
  IN_SERVICE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [], CANCELLED: [], NO_SHOW: []
};
const SOURCES = ['PHONE', 'WALK_IN', 'ONLINE', 'APP'];

const tzOf = async (db, businessId) => (await db.query(`SELECT COALESCE(timezone, 'Asia/Kolkata') AS tz FROM businesses WHERE business_id = $1`, [businessId])).rows[0].tz;
const clockText = (instant, tz) => toClock(localParts(instant, tz).minutes);

/* ── reading ──────────────────────────────────────────────────────────────────────────────── */

const LINES = `
  SELECT l.line_id, l.appointment_id, l.service_id, p.name AS service_name, l.staff_id, s.name AS staff_name, l.start_at, l.end_at, l.price_paise
  FROM salon_appointment_services l JOIN products p ON p.product_id = l.service_id JOIN salon_staff s ON s.staff_id = l.staff_id`;

const shape = (a, lines) => ({
  appointment_id: a.appointment_id, branch_id: a.branch_id,
  customer_id: a.customer_id, customer_name: a.customer_name || a.guest_name, customer_phone: a.customer_phone || a.guest_phone, is_guest: !a.customer_id,
  start_at: a.start_at, end_at: a.end_at, status: a.status, source: a.source, notes: a.notes, cancel_reason: a.cancel_reason, invoice_id: a.invoice_id,
  services: lines.map((l) => ({
    line_id: l.line_id, service_id: l.service_id, name: l.service_name, staff_id: l.staff_id, staff_name: l.staff_name,
    start_at: l.start_at, end_at: l.end_at, duration_min: Math.round((new Date(l.end_at) - new Date(l.start_at)) / 60000), price: toRupees(l.price_paise)
  })),
  total: toRupees(lines.reduce((s, l) => s + Number(l.price_paise), 0))
});

const loadMany = async (db, rows) => {
  if (!rows.length) return [];
  const lines = (await db.query(`${LINES} WHERE l.appointment_id = ANY($1::int[]) ORDER BY l.start_at, l.line_id`, [rows.map((r) => r.appointment_id)])).rows;
  const by = new Map();
  for (const l of lines) { if (!by.has(l.appointment_id)) by.set(l.appointment_id, []); by.get(l.appointment_id).push(l); }
  return rows.map((r) => shape(r, by.get(r.appointment_id) || []));
};

const HEADER = `
  SELECT a.*, c.name AS customer_name, c.phone AS customer_phone
  FROM salon_appointments a LEFT JOIN customers c ON c.customer_id = a.customer_id`;

/* GET /api/salon/appointments?from=&to=&date=&staff_id=&status=&customer_id=  (dates are the salon's local days) */
const list = async (req, res) => {
  const tz = await tzOf(pool, req.tenant.businessId);
  const today = await businessToday(req.tenant.businessId);
  const day = isoDate(req.query.date, 'Date');
  const from = isoDate(req.query.from, 'From') || day || today;
  const to = isoDate(req.query.to, 'To') || day || from;
  if (to < from) throw new SalonError(400, 'The end date is before the start date');
  if (Date.parse(to) - Date.parse(from) > 62 * 86400000) throw new SalonError(400, 'Choose a range of two months or less');
  const values = [req.tenant.businessId, fromLocal(from, 0, tz), fromLocal(to, 24 * 60, tz)];
  let where = `a.business_id = $1 AND a.start_at >= $2 AND a.start_at < $3`;
  where += branchFilter(req.tenant, 'a.branch_id', values);
  if (req.query.status) { values.push(oneOf(req.query.status, 'Status', Object.keys(TRANSITIONS))); where += ` AND a.status = $${values.length}`; }
  if (req.query.customer_id) { values.push(Number(req.query.customer_id) || 0); where += ` AND a.customer_id = $${values.length}`; }
  const own = await ownStaffId(pool, req.tenant, req.auth.userId);
  const staffFilter = own != null ? own : (req.query.staff_id ? Number(req.query.staff_id) : null);
  if (staffFilter != null) { values.push(staffFilter); where += ` AND EXISTS (SELECT 1 FROM salon_appointment_services l WHERE l.appointment_id = a.appointment_id AND l.staff_id = $${values.length})`; }
  const rows = (await pool.query(`${HEADER} WHERE ${where} ORDER BY a.start_at, a.appointment_id LIMIT 1000`, values)).rows;
  ok(res, await loadMany(pool, rows));
};

const loadOne = async (db, req, id) => {
  const values = [req.tenant.businessId, id];
  const row = (await db.query(`${HEADER} WHERE a.business_id = $1 AND a.appointment_id = $2${branchFilter(req.tenant, 'a.branch_id', values)}`, values)).rows[0];
  if (!row) return null;
  const own = await ownStaffId(db, req.tenant, req.auth.userId);
  const [full] = await loadMany(db, [row]);
  if (own != null && !full.services.some((l) => l.staff_id === own)) return null;
  return full;
};

const get = async (req, res) => {
  const a = await loadOne(pool, req, req.params.id);
  if (!a) throw new SalonError(404, 'Not found');
  ok(res, a);
};

/* ── the schedule, by staff member ────────────────────────────────────────────────────────── */

/* GET /api/salon/schedule?date= — one column per bookable staff member: their hours that day and what is booked */
const schedule = async (req, res) => {
  const tz = await tzOf(pool, req.tenant.businessId);
  const date = isoDate(req.query.date, 'Date') || await businessToday(req.tenant.businessId);
  const branchId = req.tenant.scopeBranchId ?? req.tenant.branchId;
  const outlet = await branchHours(pool, req.tenant.businessId, branchId);
  const { isoDay } = localParts(fromLocal(date, 12 * 60, tz), tz);
  const own = await ownStaffId(pool, req.tenant, req.auth.userId);
  const values = [req.tenant.businessId, branchId, date];
  let staffWhere = `s.business_id = $1 AND s.branch_id = $2 AND s.status = 'ACTIVE' AND s.is_bookable`;
  if (own != null) { values.push(own); staffWhere += ` AND s.staff_id = $${values.length}`; }
  const staff = (await pool.query(
    `SELECT s.staff_id, s.name, s.staff_role, s.working_hours, a.status AS attendance
     FROM salon_staff s LEFT JOIN salon_attendance a ON a.staff_id = s.staff_id AND a.work_date = $3::date WHERE ${staffWhere} ORDER BY s.name`, values)).rows;
  const from = fromLocal(date, 0, tz); const to = fromLocal(date, 24 * 60, tz);
  const lines = (await pool.query(
    `${LINES} JOIN salon_appointments a ON a.appointment_id = l.appointment_id
     WHERE l.business_id = $1 AND l.branch_id = $2 AND a.status = ANY($3::text[]) AND l.start_at >= $4 AND l.start_at < $5 ORDER BY l.start_at`,
    [req.tenant.businessId, branchId, [...LIVE, 'COMPLETED'], from, to])).rows;
  ok(res, {
    date, timezone: tz, outlet: { open: outlet.open_time, close: outlet.close_time, open_today: outlet.working_days.includes(isoDay), slot_minutes: outlet.slot_minutes },
    staff: staff.map((s) => {
      const w = workWindow(s.working_hours, outlet, isoDay);
      const off = !w || ['ABSENT', 'LEAVE'].includes(s.attendance);
      return {
        staff_id: s.staff_id, name: s.name, staff_role: s.staff_role, attendance: s.attendance, off,
        window: w && !off ? { start: toClock(w.start), end: toClock(w.end) } : null,
        bookings: lines.filter((l) => l.staff_id === s.staff_id).map((l) => ({
          appointment_id: l.appointment_id, line_id: l.line_id, service: l.service_name, start_at: l.start_at, end_at: l.end_at
        }))
      };
    })
  });
};

/* ── availability ─────────────────────────────────────────────────────────────────────────── */

const loadServices = async (db, req, serviceIds) => {
  const ids = [...new Set(serviceIds.map(Number))];
  if (!ids.length || ids.some((n) => !Number.isInteger(n) || n <= 0)) throw new SalonError(400, 'Choose at least one service');
  const { rows } = await db.query(
    `SELECT p.product_id, p.name, COALESCE(pbs.price_paise, p.selling_price_paise) AS price_paise, COALESCE(d.duration_min, 30) AS duration_min,
            (pbs.is_available IS FALSE) AS unavailable
     FROM products p LEFT JOIN salon_item_details d ON d.product_id = p.product_id
     LEFT JOIN product_branch_settings pbs ON pbs.product_id = p.product_id AND pbs.branch_id = $3
     WHERE p.business_id = $1 AND p.kind = 'SERVICE' AND p.status = 'ACTIVE' AND p.product_id = ANY($2::int[])`,
    [req.tenant.businessId, ids, req.tenant.branchId]
  );
  if (rows.length !== ids.length) throw new SalonError(400, 'One of those services is not available');
  const bad = rows.find((r) => r.unavailable);
  if (bad) throw new SalonError(409, `${bad.name} is not offered at this outlet`);
  return new Map(rows.map((r) => [r.product_id, r]));
};

/* Staff who could perform all of these services at an outlet: bookable, active, and (if they list services) listing each. */
const eligibleStaff = async (db, businessId, branchId, serviceIds) => (await db.query(
  `SELECT s.staff_id, s.name, s.working_hours FROM salon_staff s
   WHERE s.business_id = $1 AND s.branch_id = $2 AND s.status = 'ACTIVE' AND s.is_bookable
     AND (NOT EXISTS (SELECT 1 FROM salon_staff_services x WHERE x.staff_id = s.staff_id)
          OR (SELECT COUNT(DISTINCT x.product_id) FROM salon_staff_services x WHERE x.staff_id = s.staff_id AND x.product_id = ANY($3::int[])) = $4)
   ORDER BY s.name`, [businessId, branchId, serviceIds, new Set(serviceIds).size])).rows;

/* GET /api/salon/availability?date=&service_ids=1,2&staff_id= — free start times, with who is free for each */
const availability = async (req, res) => {
  const tz = await tzOf(pool, req.tenant.businessId);
  const settings = await getSettings(pool, req.tenant.businessId);
  const date = isoDate(req.query.date, 'Date', { required: true });
  const serviceIds = String(req.query.service_ids || '').split(',').filter(Boolean).map(Number);
  const services = await loadServices(pool, req, serviceIds);
  const duration = [...services.values()].reduce((s, x) => s + Number(x.duration_min), 0);
  const branchId = req.tenant.branchId;
  const outlet = await branchHours(pool, req.tenant.businessId, branchId);
  const { isoDay } = localParts(fromLocal(date, 12 * 60, tz), tz);
  let staff = await eligibleStaff(pool, req.tenant.businessId, branchId, [...services.keys()]);
  if (req.query.staff_id) staff = staff.filter((s) => s.staff_id === Number(req.query.staff_id));
  if (!staff.length) return ok(res, { date, duration_min: duration, slots: [] });

  const from = fromLocal(date, 0, tz); const to = fromLocal(date, 24 * 60, tz);
  const busyRows = (await pool.query(
    `SELECT l.staff_id, l.start_at, l.end_at FROM salon_appointment_services l JOIN salon_appointments a ON a.appointment_id = l.appointment_id
     WHERE l.staff_id = ANY($1::int[]) AND a.status = ANY($2::text[]) AND l.start_at < $4 AND l.end_at > $3`,
    [staff.map((s) => s.staff_id), LIVE, from, to])).rows;
  const away = new Set((await pool.query(`SELECT staff_id FROM salon_attendance WHERE staff_id = ANY($1::int[]) AND work_date = $2::date AND status IN ('ABSENT','LEAVE')`, [staff.map((s) => s.staff_id), date])).rows.map((r) => r.staff_id));
  const now = localParts(Date.now(), tz);
  const notBefore = date === now.date ? now.minutes + Number(settings.min_advance_minutes) : date < now.date ? 24 * 60 : 0;

  const slots = new Map();
  for (const s of staff) {
    if (away.has(s.staff_id)) continue;
    const window = workWindow(s.working_hours, outlet, isoDay);
    const busy = busyRows.filter((b) => b.staff_id === s.staff_id).map((b) => [localParts(b.start_at, tz).minutes, localParts(b.end_at, tz).minutes || 24 * 60]);
    for (const t of freeSlots({ window, busy, duration, step: outlet.slot_minutes, buffer: settings.buffer_minutes, notBefore })) {
      if (!slots.has(t)) slots.set(t, []);
      slots.get(t).push({ staff_id: s.staff_id, name: s.name });
    }
  }
  ok(res, { date, duration_min: duration, slots: [...slots].sort((a, b) => a[0] - b[0]).map(([t, who]) => ({ time: toClock(t), staff: who })) });
};

/* ── booking ──────────────────────────────────────────────────────────────────────────────── */

/* Every line must sit inside its person's hours, on a day they are in, and not clash with their other bookings. */
const assertFree = async (db, req, { lines, tz, settings, outlet, excludeAppointmentId = null }) => {
  const staffIds = [...new Set(lines.map((l) => l.staff_id))].sort((a, b) => a - b);
  for (const id of staffIds) await db.query(`SELECT pg_advisory_xact_lock($1, $2)`, [req.tenant.businessId, id]);   // serialises bookings per person

  const staffRows = (await db.query(`SELECT staff_id, name, working_hours, status, is_bookable, branch_id FROM salon_staff WHERE business_id = $1 AND staff_id = ANY($2::int[])`, [req.tenant.businessId, staffIds])).rows;
  const byId = new Map(staffRows.map((s) => [s.staff_id, s]));
  for (const l of lines) {
    const s = byId.get(l.staff_id);
    if (!s || s.branch_id !== req.tenant.branchId) throw new SalonError(400, 'Choose a team member from this outlet');
    if (s.status !== 'ACTIVE' || !s.is_bookable) throw new SalonError(409, `${s.name} is not taking bookings`);
    const a = localParts(l.start_at, tz); const b = localParts(new Date(l.end_at.getTime() - 1), tz);
    if (a.date !== b.date) throw new SalonError(400, 'An appointment cannot run past midnight');
    const w = workWindow(s.working_hours, outlet, a.isoDay);
    if (!w) throw new SalonError(409, `${s.name} is not working that day`);
    if (a.minutes < w.start || b.minutes + 1 > w.end) throw new SalonError(409, `${s.name} works ${toClock(w.start)}–${toClock(w.end)} that day`);
    const away = (await db.query(`SELECT status FROM salon_attendance WHERE staff_id = $1 AND work_date = $2::date AND status IN ('ABSENT','LEAVE')`, [s.staff_id, a.date])).rows[0];
    if (away) throw new SalonError(409, `${s.name} is marked ${away.status === 'LEAVE' ? 'on leave' : 'absent'} that day`);
  }
  // a person cannot be in two places inside one booking either
  for (const id of staffIds) {
    const mine = lines.filter((l) => l.staff_id === id).sort((x, y) => x.start_at - y.start_at);
    for (let i = 1; i < mine.length; i++) if (mine[i].start_at < mine[i - 1].end_at) throw new SalonError(409, `${byId.get(id).name} cannot do two services at the same time`);
  }
  for (const l of lines) {
    const clash = (await db.query(
      `SELECT l.start_at, l.end_at FROM salon_appointment_services l JOIN salon_appointments a ON a.appointment_id = l.appointment_id
       WHERE l.staff_id = $1 AND a.status = ANY($2::text[]) AND l.start_at < $4::timestamptz AND l.end_at + make_interval(mins => $5::int) > $3::timestamptz
         AND ($6::int IS NULL OR a.appointment_id <> $6) LIMIT 1`,
      [l.staff_id, LIVE, l.start_at, l.end_at, settings.buffer_minutes, excludeAppointmentId])).rows[0];
    if (clash) throw new SalonError(409, `${byId.get(l.staff_id).name} is already booked ${clockText(clash.start_at, tz)}–${clockText(clash.end_at, tz)}`);
  }
};

/* Turn the request's service list into timed lines: each service starts when the previous one ends unless told otherwise. */
const planLines = async (db, req, body, start, services) => {
  const raw = Array.isArray(body.services) ? body.services : [];
  if (!raw.length) throw new SalonError(400, 'Choose at least one service');
  if (raw.length > 12) throw new SalonError(400, 'An appointment can have at most 12 services');
  let cursor = start.getTime();
  const lines = [];
  for (const r of raw) {
    const service = services.get(Number(r.service_id));
    const minutes = r.duration_min != null ? int(r.duration_min, 'Duration', { min: 5, max: 720, required: true }) : Number(service.duration_min);
    const at = r.start_at ? timestamp(r.start_at, 'Service start', { required: true }).getTime() : cursor;
    lines.push({ service_id: service.product_id, staff_id: int(r.staff_id, 'Staff', { min: 1 }), start_at: new Date(at), end_at: new Date(at + minutes * 60000), price_paise: Number(service.price_paise) });
    cursor = Math.max(cursor, at + minutes * 60000);
  }
  return lines;
};

/* A walk-in or "any available" booking: the eligible person with the lightest day who is free for the whole slot. */
const autoAssign = async (db, req, lines, tz, settings, outlet) => {
  const unassigned = lines.filter((l) => !l.staff_id);
  if (!unassigned.length) return;
  const all = await eligibleStaff(db, req.tenant.businessId, req.tenant.branchId, [...new Set(lines.map((l) => l.service_id))]);
  const load = new Map((await db.query(
    `SELECT l.staff_id, COUNT(*) AS n FROM salon_appointment_services l JOIN salon_appointments a ON a.appointment_id = l.appointment_id
     WHERE l.branch_id = $1 AND a.status = ANY($2::text[]) AND l.start_at >= $3 AND l.start_at < $4 GROUP BY l.staff_id`,
    [req.tenant.branchId, LIVE, fromLocal(localParts(lines[0].start_at, tz).date, 0, tz), fromLocal(localParts(lines[0].start_at, tz).date, 24 * 60, tz)])).rows.map((r) => [r.staff_id, Number(r.n)]));
  const candidates = all.sort((a, b) => (load.get(a.staff_id) || 0) - (load.get(b.staff_id) || 0));
  for (const l of unassigned) {
    let chosen = null;
    for (const c of candidates) {
      try { await assertFree(db, req, { lines: [{ ...l, staff_id: c.staff_id }], tz, settings, outlet }); chosen = c; break; } catch (e) { if (e.name !== 'SalonError') throw e; }
    }
    if (!chosen) throw new SalonError(409, 'Nobody is free for that time. Try another time or pick a team member.');
    l.staff_id = chosen.staff_id;
  }
};

const guestDetails = async (req, body) => {
  if (body.customer_id != null && body.customer_id !== '') {
    const id = int(body.customer_id, 'Client', { min: 1, required: true });
    const c = (await pool.query(`SELECT customer_id FROM customers WHERE customer_id = $1 AND business_id = $2 AND status = 'ACTIVE'`, [id, req.tenant.businessId])).rows[0];
    if (!c) throw new SalonError(400, 'Client not found');
    return { customerId: id, name: null, phone: null };
  }
  const name = text(body.guest_name, 'Guest name', { max: 120, required: true });
  const ph = phone(body.guest_phone, 'Phone');
  const found = ph ? await findCustomerByPhone(pool, req.tenant.businessId, ph) : null;   // a known number is the same person
  return found ? { customerId: found.customer_id, name: null, phone: null } : { customerId: null, name, phone: ph };
};

/* POST /api/salon/appointments { customer_id | guest_name+guest_phone, start_at, services: [{ service_id, staff_id?, duration_min? }], source, notes } */
const create = async (req, res) => {
  const body = req.body || {};
  const tz = await tzOf(pool, req.tenant.businessId);
  const settings = await getSettings(pool, req.tenant.businessId);
  const outlet = await branchHours(pool, req.tenant.businessId, req.tenant.branchId);
  const source = oneOf(body.source, 'Source', SOURCES, { fallback: 'PHONE' });
  const walkIn = source === 'WALK_IN';
  const now = Date.now();
  let start = timestamp(body.start_at, 'Start time');
  if (!start) {
    if (!walkIn) throw new SalonError(400, 'Choose a date and time');
    start = new Date(Math.floor(now / 60000) * 60000);   // a walk-in starts now
  }
  if (!walkIn) {
    if (start.getTime() < now - 5 * 60000) throw new SalonError(400, 'That time has already passed');
    if (start.getTime() < now + settings.min_advance_minutes * 60000) throw new SalonError(409, `Bookings need at least ${settings.min_advance_minutes} minutes' notice`);
  }
  if (start.getTime() > now + settings.max_advance_days * 86400000) throw new SalonError(400, `Bookings open up to ${settings.max_advance_days} days ahead`);

  const who = await guestDetails(req, body);
  const services = await loadServices(pool, req, (body.services || []).map((s) => s.service_id));
  const lines = await planLines(pool, req, body, start, services);
  const notes = text(body.notes, 'Notes', { max: 500 });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await autoAssign(client, req, lines, tz, settings, outlet);
    await assertFree(client, req, { lines, tz, settings, outlet });
    const first = new Date(Math.min(...lines.map((l) => l.start_at.getTime())));
    const last = new Date(Math.max(...lines.map((l) => l.end_at.getTime())));
    const id = (await client.query(
      `INSERT INTO salon_appointments (business_id, branch_id, customer_id, guest_name, guest_phone, start_at, end_at, status, source, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING appointment_id`,
      [req.tenant.businessId, req.tenant.branchId, who.customerId, who.name, who.phone, first, last, walkIn ? 'CHECKED_IN' : 'BOOKED', source, notes, req.auth.userId]
    )).rows[0].appointment_id;
    for (const l of lines) {
      await client.query(
        `INSERT INTO salon_appointment_services (appointment_id, business_id, branch_id, service_id, staff_id, start_at, end_at, price_paise) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, req.tenant.businessId, req.tenant.branchId, l.service_id, l.staff_id, l.start_at, l.end_at, l.price_paise]
      );
    }
    await client.query('COMMIT');
    audit(req, 'salon.appointment_created', 'salon_appointment', id, null, { start_at: first, services: lines.length, source });
    const out = await loadOne(pool, req, id);
    afterAppointment(req.tenant.businessId, id, 'BOOKED');
    ok(res, out, 201);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/* PUT /api/salon/appointments/:id { start_at?, services?: [{ line_id, staff_id }], notes? } — move it, or change who does a service */
const reschedule = async (req, res) => {
  const body = req.body || {};
  const tz = await tzOf(pool, req.tenant.businessId);
  const settings = await getSettings(pool, req.tenant.businessId);
  const outlet = await branchHours(pool, req.tenant.businessId, req.tenant.branchId);
  const before = await loadOne(pool, req, req.params.id);
  if (!before) throw new SalonError(404, 'Not found');
  if (!['BOOKED', 'CONFIRMED'].includes(before.status)) throw new SalonError(409, `A ${before.status.toLowerCase().replace('_', ' ')} appointment cannot be changed`);
  if (before.branch_id !== req.tenant.branchId) throw new SalonError(409, 'Switch to this appointment\'s outlet to change it');

  const newStart = body.start_at ? timestamp(body.start_at, 'Start time', { required: true }) : new Date(before.start_at);
  const shift = newStart.getTime() - new Date(before.start_at).getTime();
  if (body.start_at && newStart.getTime() < Date.now() - 5 * 60000) throw new SalonError(400, 'That time has already passed');
  const staffFor = new Map((Array.isArray(body.services) ? body.services : []).map((s) => [Number(s.line_id), Number(s.staff_id)]));
  const lines = before.services.map((l) => ({
    line_id: l.line_id, service_id: l.service_id, staff_id: staffFor.get(l.line_id) || l.staff_id,
    start_at: new Date(new Date(l.start_at).getTime() + shift), end_at: new Date(new Date(l.end_at).getTime() + shift)
  }));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await assertFree(client, req, { lines, tz, settings, outlet, excludeAppointmentId: before.appointment_id });
    for (const l of lines) await client.query(`UPDATE salon_appointment_services SET staff_id = $2, start_at = $3, end_at = $4 WHERE line_id = $1`, [l.line_id, l.staff_id, l.start_at, l.end_at]);
    const first = new Date(Math.min(...lines.map((l) => l.start_at.getTime()))); const last = new Date(Math.max(...lines.map((l) => l.end_at.getTime())));
    const notes = 'notes' in body ? text(body.notes, 'Notes', { max: 500 }) : before.notes;
    await client.query(`UPDATE salon_appointments SET start_at = $2, end_at = $3, notes = $4, reminder_sent_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE appointment_id = $1`, [before.appointment_id, first, last, notes]);
    await client.query('COMMIT');
    audit(req, 'salon.appointment_rescheduled', 'salon_appointment', before.appointment_id, { start_at: before.start_at }, { start_at: first });
    const after = await loadOne(pool, req, before.appointment_id);
    if (body.start_at) afterAppointment(req.tenant.businessId, before.appointment_id, 'RESCHEDULED');
    ok(res, after);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/* POST /api/salon/appointments/:id/status { status, reason? } */
const setStatus = async (req, res) => {
  const to = oneOf(req.body?.status, 'Status', Object.keys(TRANSITIONS), { required: true });
  const reason = text(req.body?.reason, 'Reason', { max: 200 });
  const before = await loadOne(pool, req, req.params.id);
  if (!before) throw new SalonError(404, 'Not found');
  if (!TRANSITIONS[before.status].includes(to)) throw new SalonError(409, `A ${before.status.toLowerCase().replace('_', ' ')} appointment cannot be marked ${to.toLowerCase().replace('_', ' ')}`);
  if (to === 'COMPLETED') throw new SalonError(409, 'An appointment is completed when its bill is taken');
  if (to === 'NO_SHOW' && new Date(before.start_at).getTime() > Date.now()) throw new SalonError(409, 'It is not yet time for this appointment');
  // a stylist may only move their own clients along the service, not cancel or no-show
  if (req.tenant.role === 'STYLIST' && !['CHECKED_IN', 'IN_SERVICE'].includes(to)) throw new SalonError(403, 'Ask the front desk to do that');

  const settings = await getSettings(pool, req.tenant.businessId);
  await pool.query(`UPDATE salon_appointments SET status = $2::text, cancel_reason = CASE WHEN $2::text = 'CANCELLED' THEN $3::text ELSE cancel_reason END, updated_at = CURRENT_TIMESTAMP WHERE appointment_id = $1 AND business_id = $4`,
    [before.appointment_id, to, reason, req.tenant.businessId]);
  audit(req, 'salon.appointment_status', 'salon_appointment', before.appointment_id, { status: before.status }, { status: to }, reason ? { reason } : {});
  const out = await loadOne(pool, req, before.appointment_id);
  // the salon's own cancellation / no-show policy, for the screen to show — nothing is charged automatically
  const notice = settings.cancellation_policy?.min_notice_hours;
  const late = to === 'CANCELLED' && notice != null && new Date(before.start_at).getTime() - Date.now() < notice * 3600000;
  if (to === 'CANCELLED') afterAppointment(req.tenant.businessId, before.appointment_id, 'CANCELLED');
  ok(res, { ...out, policy: late ? { late_cancellation: true, fee_pct: settings.cancellation_policy.fee_pct ?? 0, text: settings.cancellation_policy.text ?? null } : to === 'NO_SHOW' ? { fee_pct: settings.no_show_policy?.fee_pct ?? 0, text: settings.no_show_policy?.text ?? null } : null });
};

/* GET /api/salon/appointments/:id/cart — the appointment as a POS cart (customer + services with staff) */
const cart = async (req, res) => {
  const a = await loadOne(pool, req, req.params.id);
  if (!a) throw new SalonError(404, 'Not found');
  if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(a.status)) throw new SalonError(409, `This appointment is ${a.status.toLowerCase().replace('_', ' ')}`);
  ok(res, {
    appointment_id: a.appointment_id, customer_id: a.customer_id, guest_name: a.is_guest ? a.customer_name : null,
    items: a.services.map((s) => ({ type: 'SERVICE', service_id: s.service_id, name: s.name, staff_id: s.staff_id, staff_name: s.staff_name, price: s.price, quantity: 1 }))
  });
};

export default wrapAll({ list, get, schedule, availability, create, reschedule, setStatus, cart });
