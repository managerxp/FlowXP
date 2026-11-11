/* The hotel and banquet feature was removed from the product (2026-11-10), so its tables go. Staff and payroll (hr_*) stay: the spare parts workshop uses them.
   Irreversible, so it refuses to run while any of these tables still holds real records, unless DROP_HOTEL_DATA=yes is set for the run (take a backup first).
   Businesses of type HOTEL become restaurants (a hotel always had the restaurant screens), and people with hotel-only roles get the nearest everyday role,
   so nobody is left with a type or a role the product no longer knows. */
const TABLES = [
  'banquet_payments', 'banquet_charges', 'banquet_functions', 'banquet_events', 'banquet_packages', 'banquet_halls',
  'hk_assignments', 'folio_payments', 'folio_charges', 'hotel_booking_rooms', 'hotel_bookings', 'guests',
  'rate_overrides', 'rate_plan_rates', 'rate_plans', 'room_blocks', 'rooms', 'room_types',
  'hotel_night_audits', 'hotel_daily_stats', 'hotel_properties'
];
/* The tables that hold what guests and events produced; empty set-up tables (rooms, rates, halls) are not worth blocking over. */
const RECORDS = ['hotel_bookings', 'folio_charges', 'folio_payments', 'banquet_events', 'banquet_payments', 'guests'];
const ROLE_MAP = { FRONT_DESK: 'CASHIER', NIGHT_AUDITOR: 'ACCOUNTANT', HOUSEKEEPER: 'STAFF', HOUSEKEEPING_SUPERVISOR: 'STAFF', BANQUET_MANAGER: 'STAFF' };

export const up = async (client) => {
  if (process.env.DROP_HOTEL_DATA !== 'yes') {
    const held = [];
    for (const t of RECORDS) {
      const { rows } = await client.query(`SELECT to_regclass($1) AS t`, [t]);
      if (rows[0].t && Number((await client.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n) > 0) held.push(t);
    }
    if (held.length) throw new Error(`Not dropping the hotel tables: ${held.join(', ')} still hold records. Back the database up, then run the migration again with DROP_HOTEL_DATA=yes.`);
  }
  await client.query(`UPDATE businesses SET business_type = 'RESTAURANT' WHERE business_type = 'HOTEL'`);
  for (const [from, to] of Object.entries(ROLE_MAP)) await client.query(`UPDATE business_users SET role = $2 WHERE role = $1`, [from, to]);
  for (const t of TABLES) await client.query(`DROP TABLE IF EXISTS ${t}`);
};
