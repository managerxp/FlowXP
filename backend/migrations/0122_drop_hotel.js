/* The hotel and banquet feature was removed from the product (2026-11-10), so its tables go. Staff and payroll (hr_*) stay: the spare parts workshop uses them.
   Children first; IF EXISTS so it is safe on a database that never had a hotel. This cannot be undone: the data in these tables is gone for good. */
const TABLES = [
  'banquet_payments', 'banquet_charges', 'banquet_functions', 'banquet_events', 'banquet_packages', 'banquet_halls',
  'hk_assignments', 'folio_payments', 'folio_charges', 'hotel_booking_rooms', 'hotel_bookings', 'guests',
  'rate_overrides', 'rate_plan_rates', 'rate_plans', 'room_blocks', 'rooms', 'room_types',
  'hotel_night_audits', 'hotel_daily_stats', 'hotel_properties'
];

export const up = async (client) => {
  for (const t of TABLES) await client.query(`DROP TABLE IF EXISTS ${t}`);
};
