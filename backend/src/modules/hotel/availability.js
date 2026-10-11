/*
 * What is free to sell. Inventory is counted by room type and night:
 *   rooms of the type that are in service
 *   minus rooms booked for that night (a room on a confirmed or in-house booking, with or without a room number yet)
 *   minus rooms taken out of sale that night (a block, or a room marked out of order from today on).
 * A night is the date a guest sleeps: arrival <= night < departure.
 */
import { HotelError, addDaysISO, daysBetween, nightsOf } from './common.js';

/** For each room type, for each night from..to (to exclusive): { total, sold, blocked, available }. */
export const availabilityGrid = async (db, tenant, { from, to }) => {
  if (!(to > from)) throw new HotelError(400, 'Choose the dates to look at');
  if (daysBetween(from, to) > 62) throw new HotelError(400, 'Look at up to 62 nights at a time');
  const { rows } = await db.query(
    `WITH nights AS (SELECT d::date AS night FROM generate_series($2::date, ($3::date - 1), '1 day') d),
          prop AS (SELECT business_date FROM hotel_properties WHERE branch_id = $1)
     SELECT t.room_type_id, t.name, t.code, n.night::text AS night,
            (SELECT COUNT(*) FROM rooms r WHERE r.room_type_id = t.room_type_id AND r.is_active)::int AS total,
            (SELECT COUNT(*) FROM hotel_booking_rooms b WHERE b.room_type_id = t.room_type_id AND b.status IN ('RESERVED','IN_HOUSE') AND b.arrival <= n.night AND b.departure > n.night)::int AS sold,
            (SELECT COUNT(*) FROM rooms r WHERE r.room_type_id = t.room_type_id AND r.is_active AND (
                EXISTS (SELECT 1 FROM room_blocks k WHERE k.room_id = r.room_id AND k.from_date <= n.night AND k.to_date > n.night)
                OR (r.hk_status = 'OUT_OF_ORDER' AND n.night >= (SELECT business_date FROM prop))))::int AS blocked
     FROM room_types t CROSS JOIN nights n WHERE t.branch_id = $1 AND t.is_active ORDER BY t.sort_order, t.name, n.night`,
    [tenant.branchId, from, to]);
  const byType = new Map();
  for (const r of rows) {
    if (!byType.has(r.room_type_id)) byType.set(r.room_type_id, { room_type_id: r.room_type_id, name: r.name, code: r.code, nights: [] });
    byType.get(r.room_type_id).nights.push({ date: r.night, total: r.total, sold: r.sold, blocked: r.blocked, available: r.total - r.sold - r.blocked });
  }
  return [...byType.values()];
};

/**
 * Check that `count` more rooms of a type can be sold for a stay. Locks the room type row so two desks booking the last room at the same moment
 * cannot both succeed. Returns the lowest number free across the stay.
 */
export const assertAvailable = async (client, tenant, { roomTypeId, arrival, departure, count = 1, excludeRrIds = [], allowOverbooking = false }) => {
  await client.query(`SELECT 1 FROM room_types WHERE room_type_id = $1 AND branch_id = $2 FOR UPDATE`, [roomTypeId, tenant.branchId]);
  const { rows } = await client.query(
    `WITH nights AS (SELECT d::date AS night FROM generate_series($3::date, ($4::date - 1), '1 day') d)
     SELECT n.night::text AS night,
            (SELECT COUNT(*) FROM rooms r WHERE r.room_type_id = $2 AND r.is_active)::int
            - (SELECT COUNT(*) FROM hotel_booking_rooms b WHERE b.room_type_id = $2 AND b.status IN ('RESERVED','IN_HOUSE') AND b.arrival <= n.night AND b.departure > n.night AND NOT (b.rr_id = ANY($5::int[])))::int
            - (SELECT COUNT(*) FROM rooms r WHERE r.room_type_id = $2 AND r.is_active AND (
                EXISTS (SELECT 1 FROM room_blocks k WHERE k.room_id = r.room_id AND k.from_date <= n.night AND k.to_date > n.night)
                OR (r.hk_status = 'OUT_OF_ORDER' AND n.night >= (SELECT business_date FROM hotel_properties WHERE branch_id = $1))))::int AS free
     FROM nights n`, [tenant.branchId, roomTypeId, arrival, departure, excludeRrIds]);
  const lowest = rows.reduce((m, r) => Math.min(m, r.free), Infinity);
  if (!allowOverbooking && lowest < count) {
    const tight = rows.find((r) => r.free < count);
    throw new HotelError(409, lowest <= 0 ? `No room of this type is free on ${tight.night}` : `Only ${lowest} room${lowest === 1 ? ' is' : 's are'} of this type free for those dates`, { code: 'NO_AVAILABILITY' });
  }
  return lowest;
};

/**
 * The rooms of a type that could take a guest for these dates: in service, not blocked, not out of order, and not already assigned to another
 * booking that overlaps. (A booking with no room number yet does not hold a particular room.)
 */
export const freeRooms = async (db, tenant, { roomTypeId = null, arrival, departure, excludeRrId = null }) =>
  (await db.query(
    `SELECT r.room_id, r.room_no, r.floor, r.hk_status, r.room_type_id, t.name AS room_type
     FROM rooms r JOIN room_types t ON t.room_type_id = r.room_type_id
     WHERE r.branch_id = $1 AND r.is_active AND r.hk_status <> 'OUT_OF_ORDER' AND ($2::int IS NULL OR r.room_type_id = $2)
       AND NOT EXISTS (SELECT 1 FROM room_blocks k WHERE k.room_id = r.room_id AND k.from_date < $4 AND k.to_date > $3)
       AND NOT EXISTS (SELECT 1 FROM hotel_booking_rooms b WHERE b.room_id = r.room_id AND b.status IN ('RESERVED','IN_HOUSE') AND b.arrival < $4 AND b.departure > $3 AND ($5::int IS NULL OR b.rr_id <> $5))
     ORDER BY (r.hk_status = 'DIRTY'), NULLIF(regexp_replace(r.room_no, '\\D', '', 'g'), '')::int NULLS LAST, r.room_no`,
    [tenant.branchId, roomTypeId, arrival, departure, excludeRrId])).rows;

/**
 * The calendar (tape chart): every room, and every stay and block that touches the dates. A stay with no room number yet is held by type and
 * comes back with room_id null.
 */
export const stayChart = async (db, tenant, { from, to }) => {
  if (!(to > from)) throw new HotelError(400, 'Choose the dates to look at');
  if (daysBetween(from, to) > 62) throw new HotelError(400, 'Look at up to 62 nights at a time');
  const rooms = (await db.query(
    `SELECT r.room_id, r.room_no, r.floor, r.hk_status, r.room_type_id, t.name AS room_type, t.code AS room_type_code
     FROM rooms r JOIN room_types t ON t.room_type_id = r.room_type_id WHERE r.branch_id = $1 AND r.is_active
     ORDER BY t.sort_order, t.name, NULLIF(regexp_replace(r.room_no, '\\D', '', 'g'), '')::int NULLS LAST, r.room_no`, [tenant.branchId])).rows;
  const stays = (await db.query(
    `SELECT x.rr_id, x.booking_id, x.room_id, x.room_type_id, x.arrival::text, x.departure::text, x.status, b.res_no, b.status AS booking_status, b.source, g.name AS guest_name, g.is_vip,
            hotel_charges_paise(b.booking_id) - hotel_paid_paise(b.booking_id) AS balance_paise
     FROM hotel_booking_rooms x JOIN hotel_bookings b ON b.booking_id = x.booking_id JOIN guests g ON g.guest_id = b.guest_id
     WHERE x.branch_id = $1 AND x.status IN ('RESERVED','IN_HOUSE') AND x.arrival < $3 AND x.departure > $2 ORDER BY x.arrival, x.rr_id`, [tenant.branchId, from, to])).rows;
  const blocks = (await db.query(`SELECT block_id, room_id, from_date::text AS from_date, to_date::text AS to_date, reason FROM room_blocks WHERE branch_id = $1 AND from_date < $3 AND to_date > $2`, [tenant.branchId, from, to])).rows;
  const property = (await db.query(`SELECT business_date FROM hotel_properties WHERE branch_id = $1`, [tenant.branchId])).rows[0];
  return { from, to, business_date: property?.business_date ?? null, rooms, stays, blocks };
};

export { addDaysISO, nightsOf };
