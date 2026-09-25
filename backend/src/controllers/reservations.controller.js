/*
 * Table reservations and the walk-in waitlist, per outlet.
 *
 * A table is "free for a guest" when it isn't closed, has no running order, and
 * no other live reservation overlaps the slot. Seating never creates an order:
 * the floor screen opens one on the table as usual, and occupancy stays derived
 * from that order (see tables.controller.js).
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { findCustomerByPhone, normalisePhone } from '../modules/loyalty.js';
import { businessToday } from '../utils/dates.js';
import { branchFilter } from '../utils/scope.js';

const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });
const words = (s) => String(s).toLowerCase().replace('_', ' ');
const WALKIN_HOLD_MIN = 60;   // a walk-in seated now shouldn't run into a booking within this long

const OPEN_ORDER = `EXISTS (SELECT 1 FROM orders o WHERE o.table_id = t.table_id AND o.status NOT IN ('BILLED','CANCELLED','MERGED'))`;
/* Another live reservation on table t overlaps [$n, $n + $n+1 minutes). */
const overlap = (n, exclude = '') => `EXISTS (SELECT 1 FROM reservations r WHERE r.table_id = t.table_id AND r.status IN ('BOOKED','SEATED')${exclude}
  AND r.reserved_at < $${n}::timestamptz + make_interval(mins => $${n + 1}::int)
  AND r.reserved_at + make_interval(mins => r.duration_min) > $${n}::timestamptz)`;

const guest = async (body, businessId) => {
  const name = String(body.guest_name ?? '').trim().slice(0, 120);
  if (!name) return { error: 'Enter the guest name' };
  const party = Number(body.party_size);
  if (!Number.isInteger(party) || party < 1 || party > 100) return { error: 'Party size must be a whole number from 1 to 100' };
  const phone = body.phone ? String(body.phone).trim().slice(0, 20) : null;
  if (phone && !normalisePhone(phone)) return { error: 'Enter a 10-digit mobile number, or leave it blank' };
  const customer = phone ? await findCustomerByPhone(pool, businessId, phone) : null;
  return { name, party, phone, customerId: customer?.customer_id ?? null };
};

const stayMinutes = (value) => {
  const minutes = value == null ? 90 : Number(value);
  return Number.isInteger(minutes) && minutes >= 15 && minutes <= 480 ? minutes : null;
};

/* A table of this outlet a guest could be put at, plus whether it is busy or clashes with a booking. */
const checkTable = async (req, tableId, { at, minutes, excludeReservation }) => {
  const values = [tableId, req.tenant.businessId];
  const scope = branchFilter(req.tenant, 't.branch_id', values);
  const table = (await pool.query(
    `SELECT t.*, ${OPEN_ORDER} AS busy FROM dining_tables t WHERE t.table_id = $1 AND t.business_id = $2${scope}`, values)).rows[0];
  if (!table || table.status === 'CLOSED') return { error: 'Choose one of this outlet\'s tables', status: 404 };
  const params = [tableId, at, minutes];
  if (excludeReservation) params.push(excludeReservation);
  const clash = (await pool.query(
    `SELECT ${overlap(2, excludeReservation ? ' AND r.reservation_id <> $4' : '')} AS taken FROM dining_tables t WHERE t.table_id = $1`, params)).rows[0].taken;
  return { table, clash, busy: table.busy };
};

/* ==========================================================================
   Reservations
   ========================================================================== */

/* GET /api/reservations?date=YYYY-MM-DD  (default: today at the business) */
export const list = async (req, res) => {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : await businessToday(req.tenant.businessId);
  const values = [req.tenant.businessId, date];
  const scope = branchFilter(req.tenant, 'r.branch_id', values);
  const { rows } = await pool.query(
    `SELECT r.*, t.name AS table_name FROM reservations r
     LEFT JOIN dining_tables t ON t.table_id = r.table_id
     WHERE r.business_id = $1
       AND (r.reserved_at AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata'))::date = $2::date${scope}
     ORDER BY r.reserved_at`, values);
  res.json({ success: true, data: rows });
};

/* GET /api/reservations/availability?reserved_at=&party_size=&duration_min= : tables that fit and are free then */
export const availability = async (req, res) => {
  const at = new Date(req.query.reserved_at);
  if (Number.isNaN(at.getTime())) return bad(res, 'Choose a date and time');
  const minutes = stayMinutes(req.query.duration_min);
  if (!minutes) return bad(res, 'Stay length must be 15 minutes to 8 hours');
  const values = [req.tenant.businessId, at.toISOString(), minutes, Number(req.query.party_size) || 1];
  const scope = branchFilter(req.tenant, 't.branch_id', values);
  const { rows } = await pool.query(
    `SELECT t.table_id, t.name, t.zone, t.seats FROM dining_tables t
     WHERE t.business_id = $1 AND t.status <> 'CLOSED' AND (t.seats IS NULL OR t.seats >= $4)${scope}
       AND NOT ${overlap(2)}
     ORDER BY t.seats NULLS LAST, t.name`, values);
  res.json({ success: true, data: rows });
};

/* Validate a table for a booking; returns an error response body or the table id. */
const bookTable = async (req, res, { tableId, party, at, minutes, excludeReservation }) => {
  if (!tableId) return { id: null };
  const s = await checkTable(req, Number(tableId), { at: at.toISOString(), minutes, excludeReservation });
  if (s.error) return bad(res, s.error, s.status) && null;
  if (s.table.seats && s.table.seats < party) return bad(res, `${s.table.name} seats ${s.table.seats}, the party is ${party}`, 409) && null;
  if (s.clash) return bad(res, `${s.table.name} is already reserved around then`, 409) && null;
  return { id: s.table.table_id };
};

/* POST /api/reservations */
export const create = async (req, res) => {
  const body = req.body || {};
  const g = await guest(body, req.tenant.businessId);
  if (g.error) return bad(res, g.error);
  const at = new Date(body.reserved_at);
  if (Number.isNaN(at.getTime())) return bad(res, 'Choose a date and time');
  if (at.getTime() < Date.now() - 15 * 60 * 1000) return bad(res, 'That time has already passed');
  const minutes = stayMinutes(body.duration_min);
  if (!minutes) return bad(res, 'Stay length must be 15 minutes to 8 hours');

  const table = await bookTable(req, res, { tableId: body.table_id, party: g.party, at, minutes });
  if (!table) return;
  const { rows } = await pool.query(
    `INSERT INTO reservations (business_id, branch_id, table_id, customer_id, guest_name, phone, party_size, reserved_at, duration_min, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [req.tenant.businessId, req.tenant.branchId, table.id, g.customerId, g.name, g.phone, g.party, at.toISOString(), minutes,
      body.notes ? String(body.notes).slice(0, 300) : null, req.auth.userId]);
  recordAudit(req, { action: 'reservation.created', resource_type: 'reservation', resource_id: rows[0].reservation_id, metadata: { guest: g.name, party: g.party, at: at.toISOString() }, branch_id: req.tenant.branchId });
  res.status(201).json({ success: true, data: rows[0] });
};

const load = async (req) => {
  const values = [req.params.id, req.tenant.businessId];
  const scope = branchFilter(req.tenant, 'branch_id', values);
  return (await pool.query(`SELECT * FROM reservations WHERE reservation_id = $1 AND business_id = $2${scope}`, values)).rows[0];
};

/* PATCH /api/reservations/:id : change details or move the booking; only while it is still BOOKED */
export const update = async (req, res) => {
  const cur = await load(req);
  if (!cur) return bad(res, 'Not found', 404);
  if (cur.status !== 'BOOKED') return bad(res, `This reservation is ${words(cur.status)} and can't be edited`, 409);
  const body = { ...cur, ...(req.body || {}) };
  const g = await guest(body, req.tenant.businessId);
  if (g.error) return bad(res, g.error);
  const at = new Date(body.reserved_at);
  if (Number.isNaN(at.getTime())) return bad(res, 'Choose a date and time');
  const minutes = stayMinutes(body.duration_min);
  if (!minutes) return bad(res, 'Stay length must be 15 minutes to 8 hours');

  const table = await bookTable(req, res, { tableId: body.table_id, party: g.party, at, minutes, excludeReservation: cur.reservation_id });
  if (!table) return;
  const { rows } = await pool.query(
    `UPDATE reservations SET table_id=$1, customer_id=$2, guest_name=$3, phone=$4, party_size=$5, reserved_at=$6, duration_min=$7, notes=$8
     WHERE reservation_id=$9 RETURNING *`,
    [table.id, g.customerId, g.name, g.phone, g.party, at.toISOString(), minutes, body.notes || null, cur.reservation_id]);
  recordAudit(req, { action: 'reservation.updated', resource_type: 'reservation', resource_id: cur.reservation_id, branch_id: cur.branch_id });
  res.json({ success: true, data: rows[0] });
};

/* POST /api/reservations/:id/status  { status: CANCELLED | NO_SHOW | COMPLETED } */
export const setStatus = async (req, res) => {
  const cur = await load(req);
  if (!cur) return bad(res, 'Not found', 404);
  const next = req.body?.status;
  const allowed = { BOOKED: ['CANCELLED', 'NO_SHOW'], SEATED: ['COMPLETED'] }[cur.status] || [];
  if (!allowed.includes(next)) return bad(res, `A ${words(cur.status)} reservation can't be marked ${words(next)}`, 409);
  const { rows } = await pool.query(`UPDATE reservations SET status = $1 WHERE reservation_id = $2 RETURNING *`, [next, cur.reservation_id]);
  recordAudit(req, { action: `reservation.${next.toLowerCase()}`, resource_type: 'reservation', resource_id: cur.reservation_id, metadata: { guest: cur.guest_name }, branch_id: cur.branch_id });
  res.json({ success: true, data: rows[0] });
};

/* POST /api/reservations/:id/seat  { table_id? } : the guests have arrived */
export const seat = async (req, res) => {
  const cur = await load(req);
  if (!cur) return bad(res, 'Not found', 404);
  if (cur.status !== 'BOOKED') return bad(res, `This reservation is ${words(cur.status)}`, 409);
  const tableId = Number(req.body?.table_id || cur.table_id);
  if (!tableId) return bad(res, 'Choose a table to seat them at');
  const s = await checkTable(req, tableId, { at: cur.reserved_at.toISOString(), minutes: cur.duration_min, excludeReservation: cur.reservation_id });
  if (s.error) return bad(res, s.error, s.status);
  if (s.busy) return bad(res, `${s.table.name} still has a running order`, 409);
  if (s.clash) return bad(res, `${s.table.name} is reserved for someone else around then`, 409);
  const { rows } = await pool.query(`UPDATE reservations SET status = 'SEATED', table_id = $1 WHERE reservation_id = $2 RETURNING *`, [tableId, cur.reservation_id]);
  recordAudit(req, { action: 'reservation.seated', resource_type: 'reservation', resource_id: cur.reservation_id, metadata: { guest: cur.guest_name, table: s.table.name }, branch_id: cur.branch_id });
  res.json({ success: true, data: rows[0] });
};

/* ==========================================================================
   Waitlist
   ========================================================================== */

/* GET /api/waitlist : who is waiting, in order, with how long they have waited */
export const waitlist = async (req, res) => {
  const values = [req.tenant.businessId];
  const scope = branchFilter(req.tenant, 'w.branch_id', values);
  const { rows } = await pool.query(
    `SELECT w.*, FLOOR(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - w.created_at)) / 60)::int AS waited_min
     FROM waitlist_entries w WHERE w.business_id = $1 AND w.status IN ('WAITING','NOTIFIED')${scope} ORDER BY w.created_at`, values);
  res.json({ success: true, data: rows });
};

/* POST /api/waitlist */
export const waitlistAdd = async (req, res) => {
  const body = req.body || {};
  const g = await guest(body, req.tenant.businessId);
  if (g.error) return bad(res, g.error);
  // ponytail: 10 minutes per party already waiting; replace with real table-turn times when there is data
  const ahead = (await pool.query(
    `SELECT COUNT(*)::int AS n FROM waitlist_entries WHERE business_id = $1 AND branch_id = $2 AND status IN ('WAITING','NOTIFIED')`,
    [req.tenant.businessId, req.tenant.branchId])).rows[0].n;
  const quoted = body.quoted_wait_min != null ? Math.max(0, Math.min(480, Number(body.quoted_wait_min) || 0)) : (ahead + 1) * 10;
  const { rows } = await pool.query(
    `INSERT INTO waitlist_entries (business_id, branch_id, customer_id, guest_name, phone, party_size, quoted_wait_min, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [req.tenant.businessId, req.tenant.branchId, g.customerId, g.name, g.phone, g.party, quoted, req.auth.userId]);
  recordAudit(req, { action: 'waitlist.added', resource_type: 'waitlist', resource_id: rows[0].entry_id, metadata: { guest: g.name, party: g.party }, branch_id: req.tenant.branchId });
  res.status(201).json({ success: true, data: rows[0] });
};

/* Load a still-waiting entry (WAITING or NOTIFIED) or answer 404/409 and return null. */
const waiting = async (req, res) => {
  const values = [req.params.id, req.tenant.businessId];
  const scope = branchFilter(req.tenant, 'branch_id', values);
  const cur = (await pool.query(`SELECT * FROM waitlist_entries WHERE entry_id = $1 AND business_id = $2${scope}`, values)).rows[0];
  if (!cur) { bad(res, 'Not found', 404); return null; }
  if (!['WAITING', 'NOTIFIED'].includes(cur.status)) { bad(res, 'That party has already been seated or left', 409); return null; }
  return cur;
};

/* POST /api/waitlist/:id/notify : "your table is ready" (the host calls or messages them) */
export const waitlistNotify = async (req, res) => {
  const cur = await waiting(req, res);
  if (!cur) return;
  const { rows } = await pool.query(`UPDATE waitlist_entries SET status = 'NOTIFIED', notified_at = CURRENT_TIMESTAMP WHERE entry_id = $1 RETURNING *`, [cur.entry_id]);
  res.json({ success: true, data: rows[0] });
};

/* POST /api/waitlist/:id/seat  { table_id, force? } */
export const waitlistSeat = async (req, res) => {
  const cur = await waiting(req, res);
  if (!cur) return;
  const s = await checkTable(req, Number(req.body?.table_id), { at: new Date().toISOString(), minutes: WALKIN_HOLD_MIN });
  if (s.error) return bad(res, s.error, s.status);
  if (s.busy) return bad(res, `${s.table.name} still has a running order`, 409);
  if (s.clash && req.body?.force !== true) return bad(res, `${s.table.name} is reserved within the next hour`, 409);
  const { rows } = await pool.query(
    `UPDATE waitlist_entries SET status = 'SEATED', table_id = $1, closed_at = CURRENT_TIMESTAMP WHERE entry_id = $2 RETURNING *`, [s.table.table_id, cur.entry_id]);
  recordAudit(req, { action: 'waitlist.seated', resource_type: 'waitlist', resource_id: cur.entry_id, metadata: { guest: cur.guest_name, table: s.table.name }, branch_id: cur.branch_id });
  res.json({ success: true, data: rows[0] });
};

/* POST /api/waitlist/:id/leave : gave up and left */
export const waitlistLeave = async (req, res) => {
  const cur = await waiting(req, res);
  if (!cur) return;
  const { rows } = await pool.query(`UPDATE waitlist_entries SET status = 'LEFT', closed_at = CURRENT_TIMESTAMP WHERE entry_id = $1 RETURNING *`, [cur.entry_id]);
  res.json({ success: true, data: rows[0] });
};
