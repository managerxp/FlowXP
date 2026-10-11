/*
 * Hotel bookings, refined:
 *   hotel_booking_rooms.night_rates   the rate agreed for each night, { "2026-11-02": 450000 } in paise. Locked when the booking is made (or a rate is typed in), so a
 *                                     later change to the rate card never changes what a guest was promised. rate_paise stays as the first night's rate for display.
 *   hotel_bookings.*_on               the hotel's business date on which the booking was checked in, checked out, cancelled or marked no-show. Reports count by
 *                                     these dates, not by the server's clock.
 */
export const up = async (client) => {
  await client.query(`ALTER TABLE hotel_booking_rooms ADD COLUMN IF NOT EXISTS night_rates JSONB NOT NULL DEFAULT '{}'::jsonb`);
  await client.query(`ALTER TABLE hotel_bookings ADD COLUMN IF NOT EXISTS created_on DATE`);
  await client.query(`ALTER TABLE hotel_bookings ADD COLUMN IF NOT EXISTS checked_in_on DATE`);
  await client.query(`ALTER TABLE hotel_bookings ADD COLUMN IF NOT EXISTS checked_out_on DATE`);
  await client.query(`ALTER TABLE hotel_bookings ADD COLUMN IF NOT EXISTS cancelled_on DATE`);
  await client.query(`ALTER TABLE hotel_bookings ADD COLUMN IF NOT EXISTS no_show_on DATE`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_hotel_bookings_checked_in_on ON hotel_bookings (branch_id, checked_in_on) WHERE checked_in_on IS NOT NULL`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_hotel_bookings_checked_out_on ON hotel_bookings (branch_id, checked_out_on) WHERE checked_out_on IS NOT NULL`);
};
