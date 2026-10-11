/*
 * Housekeeping and the room rack: the state of every room, what is in it, and who is coming or going today.
 *
 * A room is CLEAN, DIRTY (a guest has left, or it is being serviced), INSPECTED (cleaned and checked) or OUT_OF_ORDER. Whether it is occupied is a
 * separate fact: it follows from the bookings.
 */
import { HotelError, getProperty } from './common.js';

export const HK_STATUSES = ['CLEAN', 'DIRTY', 'INSPECTED', 'OUT_OF_ORDER'];

/** Every room with its housekeeping state, the guest in it (if any) and who arrives into it today. */
export const roomRack = async (db, tenant) => {
  const property = await getProperty(db, tenant);
  const rows = (await db.query(
    `SELECT r.room_id, r.room_no, r.floor, r.hk_status, r.hk_note, r.hk_updated_at, t.room_type_id, t.name AS room_type, t.code AS room_type_code,
            cur.booking_id AS stay_booking_id, cur.res_no AS stay_res_no, cur.guest_name AS stay_guest, cur.departure::text AS stay_departure, cur.is_vip AS stay_vip, cur.rr_id AS stay_rr_id,
            nxt.booking_id AS next_booking_id, nxt.guest_name AS next_guest, nxt.arrival::text AS next_arrival,
            EXISTS (SELECT 1 FROM room_blocks k WHERE k.room_id = r.room_id AND k.from_date <= $2 AND k.to_date > $2) AS blocked
     FROM rooms r JOIN room_types t ON t.room_type_id = r.room_type_id
     LEFT JOIN LATERAL (SELECT x.rr_id, x.departure, b.booking_id, b.res_no, g.name AS guest_name, g.is_vip FROM hotel_booking_rooms x JOIN hotel_bookings b ON b.booking_id = x.booking_id JOIN guests g ON g.guest_id = b.guest_id
                        WHERE x.room_id = r.room_id AND x.status = 'IN_HOUSE' LIMIT 1) cur ON TRUE
     LEFT JOIN LATERAL (SELECT x.arrival, b.booking_id, g.name AS guest_name FROM hotel_booking_rooms x JOIN hotel_bookings b ON b.booking_id = x.booking_id JOIN guests g ON g.guest_id = b.guest_id
                        WHERE x.room_id = r.room_id AND x.status = 'RESERVED' AND x.arrival >= $2 ORDER BY x.arrival LIMIT 1) nxt ON TRUE
     WHERE r.branch_id = $1 AND r.is_active
     ORDER BY NULLIF(regexp_replace(r.room_no, '\\D', '', 'g'), '')::int NULLS LAST, r.room_no`, [tenant.branchId, property.business_date])).rows;
  return {
    business_date: property.business_date,
    rooms: rows.map((r) => ({
      ...r,
      occupancy: r.stay_booking_id ? (r.stay_departure <= property.business_date ? 'DUE_OUT' : 'OCCUPIED') : r.next_arrival === property.business_date ? 'ARRIVING' : 'VACANT'
    }))
  };
};

export const setRoomStatus = async (client, tenant, userId, roomId, status, note = null) => {
  if (!HK_STATUSES.includes(status)) throw new HotelError(400, 'Choose a housekeeping status');
  const room = (await client.query(`SELECT * FROM rooms WHERE room_id = $1 AND branch_id = $2 AND is_active FOR UPDATE`, [roomId, tenant.branchId])).rows[0];
  if (!room) throw new HotelError(404, 'Room not found');
  if (status === 'OUT_OF_ORDER') {
    const guest = (await client.query(`SELECT 1 FROM hotel_booking_rooms WHERE room_id = $1 AND status = 'IN_HOUSE' LIMIT 1`, [roomId])).rowCount;
    if (guest) throw new HotelError(409, 'A guest is in this room. Move them first.');
    const booked = (await client.query(`SELECT 1 FROM hotel_booking_rooms WHERE room_id = $1 AND status = 'RESERVED' LIMIT 1`, [roomId])).rowCount;
    if (booked) throw new HotelError(409, 'A guest is booked into this room. Give them another room first.');
  }
  await client.query(`UPDATE rooms SET hk_status = $2, hk_note = $3, hk_updated_at = CURRENT_TIMESTAMP WHERE room_id = $1`, [roomId, status, note]);
  return { before: room.hk_status, after: status, room_no: room.room_no };
};
