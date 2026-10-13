/*
 * Station bookings: reserve a station for a stretch of time, hold it, seat the booking (which starts the session), mark no-shows.
 *
 * A booking names one station and a start and end. Two live bookings on a station cannot overlap: that is checked under the station's advisory lock (the
 * same lock sessions take), so two staff booking the same slot at the same moment cannot both win. A BOOKED station is held: inside `hold_minutes`
 * before a booking starts (and from then until it is seated or marked a no-show) a session cannot be started on it for someone else without an override.
 * Booking does not take money; a deposit is not part of this module.
 *
 * Times are instants (UTC in the database). The screen shows them in the lounge's own zone.
 */
import { GamingError, getSettings, int, phone, text, timezoneOf } from './common.js';
import { getStation } from './stations.js';
import { startGuards, startSession } from './sessions.js';

const lockStation = (db, stationId) => db.query(`SELECT pg_advisory_xact_lock(92, $1)`, [stationId]);

const MAX_ADVANCE_DAYS = 90;
const MIN_MINUTES = 15;
const MAX_MINUTES = 720;

const clockText = (iso, tz) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz });

const SELECT = `SELECT b.*, st.name AS station_name, st.kind AS station_kind, c.name AS customer_name, c.phone AS customer_phone
  FROM gaming_bookings b JOIN gaming_stations st ON st.station_id = b.station_id LEFT JOIN customers c ON c.customer_id = b.customer_id`;

const shape = (r) => ({
  booking_id: r.booking_id, station_id: r.station_id, station_name: r.station_name, station_kind: r.station_kind, starts_at: r.starts_at, ends_at: r.ends_at,
  minutes: Math.round((new Date(r.ends_at) - new Date(r.starts_at)) / 60000), players: r.players, customer_id: r.customer_id, name: r.customer_name || r.guest_name,
  phone: r.customer_phone || r.guest_phone, status: r.status, note: r.note, session_id: r.session_id
});

const when = (v, label) => {
  const d = new Date(v);
  if (!v || Number.isNaN(d.getTime())) throw new GamingError(400, `${label} must be a date and time`);
  return d;
};

/** Bookings between two instants (or on one lounge day), soonest first. */
export const listBookings = async (db, tenant, q = {}) => {
  const params = [tenant.businessId];
  let where = 'b.business_id = $1';
  if (tenant.scopeBranchId != null) { params.push(tenant.scopeBranchId); where += ` AND b.branch_id = $${params.length}`; }
  if (q.station_id) { params.push(Number(q.station_id)); where += ` AND b.station_id = $${params.length}`; }
  if (q.status) { params.push(String(q.status).toUpperCase()); where += ` AND b.status = $${params.length}`; }
  if (q.date) {
    const tz = await timezoneOf(db, tenant.businessId);
    params.push(String(q.date).slice(0, 10), tz);
    where += ` AND b.starts_at >= ($${params.length - 1}::date::timestamp AT TIME ZONE $${params.length}) AND b.starts_at < (($${params.length - 1}::date + 1)::timestamp AT TIME ZONE $${params.length})`;
  } else {
    if (q.from) { params.push(when(q.from, 'From')); where += ` AND b.ends_at >= $${params.length}`; }
    if (q.to) { params.push(when(q.to, 'To')); where += ` AND b.starts_at < $${params.length}`; }
  }
  return (await db.query(`${SELECT} WHERE ${where} ORDER BY b.starts_at, b.booking_id LIMIT 500`, params)).rows.map(shape);
};

const get = async (db, tenant, id, { lock = false } = {}) => {
  const r = (await db.query(`${SELECT} WHERE b.booking_id = $1 AND b.business_id = $2${lock ? ' FOR UPDATE OF b' : ''}`, [id, tenant.businessId])).rows[0];
  if (!r || (tenant.scopeBranchId != null && r.branch_id !== tenant.scopeBranchId)) throw new GamingError(404, 'Not found');
  return r;
};

/** Another live booking on this station that overlaps [start, end). */
const clash = async (db, stationId, start, end, exceptId = null) =>
  (await db.query(
    `SELECT b.booking_id, b.starts_at, b.ends_at, COALESCE(c.name, b.guest_name) AS who FROM gaming_bookings b LEFT JOIN customers c ON c.customer_id = b.customer_id
     WHERE b.station_id = $1 AND b.status = 'BOOKED' AND b.starts_at < $3 AND b.ends_at > $2 AND b.booking_id <> COALESCE($4, 0) ORDER BY b.starts_at LIMIT 1`, [stationId, start, end, exceptId])).rows[0];

const checkSlot = async (db, tenant, station, start, end, now, exceptId = null) => {
  if (station.status === 'OUT_OF_SERVICE') throw new GamingError(409, `${station.name} is out of service${station.status_note ? `: ${station.status_note}` : ''}`);
  if (station.status === 'ARCHIVED') throw new GamingError(404, 'Not found');
  const minutes = (end - start) / 60000;
  if (minutes < MIN_MINUTES || minutes > MAX_MINUTES) throw new GamingError(400, `A booking is from ${MIN_MINUTES} minutes to ${MAX_MINUTES / 60} hours`);
  if (start.getTime() < now.getTime() - 5 * 60000) throw new GamingError(400, 'That time has already passed');
  if (start.getTime() > now.getTime() + MAX_ADVANCE_DAYS * 86400000) throw new GamingError(400, `Bookings open ${MAX_ADVANCE_DAYS} days ahead`);
  const other = await clash(db, station.station_id, start, end, exceptId);
  if (other) {
    const tz = await timezoneOf(db, tenant.businessId);
    throw new GamingError(409, `${station.name} is already booked from ${clockText(other.starts_at, tz)} to ${clockText(other.ends_at, tz)}${other.who ? ` (${other.who})` : ''}`, { code: 'BOOKING_CLASH', data: { booking_id: other.booking_id } });
  }
};

const who = async (db, tenant, b) => {
  let customerId = null;
  if (b.customer_id) {
    customerId = Number(b.customer_id);
    if (!(await db.query(`SELECT 1 FROM customers WHERE customer_id = $1 AND business_id = $2`, [customerId, tenant.businessId])).rowCount) throw new GamingError(400, 'That customer does not exist');
  }
  const guest = text(b.guest_name, 'Name', { max: 60 });
  if (!customerId && !guest) throw new GamingError(400, 'Say who the booking is for');
  return { customerId, guest, guestPhone: phone(b.guest_phone, 'Mobile') };
};

export const createBooking = async (db, tenant, userId, b, { now = new Date() } = {}) => {
  const stationId = int(b.station_id, 'Station', { min: 1, required: true });
  await lockStation(db, stationId);
  const station = await getStation(db, tenant, stationId, { lock: true });
  const start = when(b.starts_at, 'Start');
  const end = b.ends_at ? when(b.ends_at, 'End') : new Date(start.getTime() + int(b.minutes ?? 60, 'Minutes', { min: MIN_MINUTES, max: MAX_MINUTES, required: true }) * 60000);
  const players = b.players === undefined || b.players === '' ? 1 : int(b.players, 'Players', { min: 1, max: 20, required: true });
  if (players > station.max_players) throw new GamingError(400, `${station.name} takes up to ${station.max_players} players`);
  await checkSlot(db, tenant, station, start, end, now);
  const w = await who(db, tenant, b);
  const row = (await db.query(
    `INSERT INTO gaming_bookings (business_id, branch_id, station_id, starts_at, ends_at, players, customer_id, guest_name, guest_phone, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING booking_id`,
    [tenant.businessId, station.branch_id, stationId, start, end, players, w.customerId, w.guest, w.guestPhone, text(b.note, 'Note', { max: 200 }), userId])).rows[0];
  return shape(await get(db, tenant, row.booking_id));
};

/** Move a booking to another time or station, with the same checks as a new one. */
export const updateBooking = async (db, tenant, userId, id, b, { now = new Date() } = {}) => {
  const cur = await get(db, tenant, id);
  const stationId = b.station_id === undefined ? cur.station_id : int(b.station_id, 'Station', { min: 1, required: true });
  await lockStation(db, stationId);
  const booking = await get(db, tenant, id, { lock: true });
  if (booking.status !== 'BOOKED') throw new GamingError(409, 'Only a booking that is still waiting can be changed');
  const station = await getStation(db, tenant, stationId, { lock: true });
  const start = b.starts_at === undefined ? new Date(booking.starts_at) : when(b.starts_at, 'Start');
  const end = b.ends_at !== undefined ? when(b.ends_at, 'End') : b.minutes !== undefined ? new Date(start.getTime() + int(b.minutes, 'Minutes', { min: MIN_MINUTES, max: MAX_MINUTES, required: true }) * 60000) : new Date(start.getTime() + (new Date(booking.ends_at) - new Date(booking.starts_at)));
  const players = b.players === undefined ? booking.players : int(b.players, 'Players', { min: 1, max: 20, required: true });
  if (players > station.max_players) throw new GamingError(400, `${station.name} takes up to ${station.max_players} players`);
  await checkSlot(db, tenant, station, start, end, now, id);
  const next = { station_id: stationId, starts_at: start, ends_at: end, players };
  if (b.note !== undefined) next.note = text(b.note, 'Note', { max: 200 });
  if (b.guest_name !== undefined || b.customer_id !== undefined || b.guest_phone !== undefined) {
    const w = await who(db, tenant, { customer_id: b.customer_id === undefined ? booking.customer_id : b.customer_id, guest_name: b.guest_name === undefined ? booking.guest_name : b.guest_name, guest_phone: b.guest_phone === undefined ? booking.guest_phone : b.guest_phone });
    Object.assign(next, { customer_id: w.customerId, guest_name: w.guest, guest_phone: w.guestPhone });
  }
  const keys = Object.keys(next);
  await db.query(`UPDATE gaming_bookings SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE booking_id = $1`, [id, ...keys.map((k) => next[k])]);
  return shape(await get(db, tenant, id));
};

export const cancelBooking = async (db, tenant, userId, id) => {
  const b = await get(db, tenant, id, { lock: true });
  if (b.status === 'CANCELLED') return shape(b);
  if (b.status !== 'BOOKED') throw new GamingError(409, 'Only a booking that is still waiting can be cancelled');
  await db.query(`UPDATE gaming_bookings SET status = 'CANCELLED' WHERE booking_id = $1`, [id]);
  return shape(await get(db, tenant, id));
};

/** They did not come. Allowed once the start time plus the settings' wait has passed. */
export const markNoShow = async (db, tenant, userId, id, { now = new Date() } = {}) => {
  const b = await get(db, tenant, id, { lock: true });
  if (b.status === 'NO_SHOW') return shape(b);
  if (b.status !== 'BOOKED') throw new GamingError(409, 'Only a booking that is still waiting can be a no-show');
  const wait = (await getSettings(db, tenant.businessId)).noshow_minutes;
  if (now.getTime() < new Date(b.starts_at).getTime() + wait * 60000) throw new GamingError(409, wait ? `A booking can be marked a no-show ${wait} minutes after it was due to start` : 'A booking can be marked a no-show once it was due to start');
  await db.query(`UPDATE gaming_bookings SET status = 'NO_SHOW' WHERE booking_id = $1`, [id]);
  return shape(await get(db, tenant, id));
};

/** They came: start the session on the booked station for the booked people, and mark the booking seated. `b` is what the board sends to start a session. */
export const seatBooking = async (db, tenant, userId, id, b = {}, { now = new Date() } = {}) => {
  const booking = await get(db, tenant, id, { lock: true });
  if (booking.status !== 'BOOKED') throw new GamingError(409, booking.status === 'SEATED' ? 'This booking was already seated' : 'Only a booking that is still waiting can be seated');
  const session = await startSession(db, tenant, userId, { players: booking.players, customer_id: booking.customer_id, player_name: booking.customer_id ? undefined : booking.guest_name, ...b, station_id: booking.station_id, booking_id: booking.booking_id }, { now });
  await db.query(`UPDATE gaming_bookings SET status = 'SEATED', session_id = $2 WHERE booking_id = $1`, [id, session.session_id]);
  return { booking: shape(await get(db, tenant, id)), session };
};

/* The hold: a session cannot be started on a booked station for someone else without an override. */
startGuards.push(async (db, tenant, station, { now, override, bookingId }) => {
  const hold = (await getSettings(db, tenant.businessId)).hold_minutes;
  const upcoming = (await db.query(
    `SELECT b.booking_id, b.starts_at, b.ends_at, COALESCE(c.name, b.guest_name) AS who FROM gaming_bookings b LEFT JOIN customers c ON c.customer_id = b.customer_id
     WHERE b.station_id = $1 AND b.status = 'BOOKED' AND b.ends_at > $2 AND b.starts_at <= $3::timestamptz + make_interval(mins => $4) AND b.booking_id <> COALESCE($5, 0)
     ORDER BY b.starts_at LIMIT 1`, [station.station_id, now, now, hold, bookingId ?? null])).rows[0];
  if (!upcoming || override) return;
  const tz = await timezoneOf(db, tenant.businessId);
  throw new GamingError(409, `${station.name} is booked from ${clockText(upcoming.starts_at, tz)}${upcoming.who ? ` for ${upcoming.who}` : ''}`, { code: 'BOOKED', data: { booking_id: upcoming.booking_id, starts_at: upcoming.starts_at } });
});

