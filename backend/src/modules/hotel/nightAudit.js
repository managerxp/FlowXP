/*
 * Night audit: closing the hotel's day.
 *
 * The hotel's business date is its "today", and it moves only here. Running night audit for date D:
 *   1. every booking that should have arrived by D and has not must be settled first: checked in, or marked as a no-show
 *   2. each guest in the hotel is charged the room for night D (once, however often audit is retried), at the rate agreed for that night; a guest who
 *      stayed past their departure date is kept on and charged
 *   3. the day's figures are written down (rooms sold, revenue, arrivals, departures...) exactly as they were, for the reports
 *   4. the business date moves to D + 1
 * Everything runs in one transaction: if any step fails nothing changes.
 */
import { HotelError, addDaysISO, getProperty, roomTaxRate } from './common.js';
import { taxFor } from './folio.js';
import { markNoShow } from './stay.js';

export const auditPreview = async (db, tenant) => {
  const property = await getProperty(db, tenant);
  const d = property.business_date;
  const pendingArrivals = (await db.query(
    `SELECT b.booking_id, b.res_no, b.arrival::text, g.name AS guest_name, (SELECT COUNT(*) FROM hotel_booking_rooms x WHERE x.booking_id = b.booking_id AND x.status = 'RESERVED')::int AS rooms
     FROM hotel_bookings b JOIN guests g ON g.guest_id = b.guest_id WHERE b.branch_id = $1 AND b.status = 'CONFIRMED' AND b.arrival <= $2 ORDER BY b.arrival, b.booking_id`, [tenant.branchId, d])).rows;
  const dueOut = (await db.query(
    `SELECT b.booking_id, b.res_no, g.name AS guest_name, string_agg(r.room_no, ', ') AS rooms
     FROM hotel_bookings b JOIN guests g ON g.guest_id = b.guest_id JOIN hotel_booking_rooms x ON x.booking_id = b.booking_id AND x.status = 'IN_HOUSE' JOIN rooms r ON r.room_id = x.room_id
     WHERE b.branch_id = $1 AND b.status = 'CHECKED_IN' AND x.departure <= $2 GROUP BY b.booking_id, b.res_no, g.name`, [tenant.branchId, d])).rows;
  const inHouse = (await db.query(`SELECT COUNT(*)::int AS n FROM hotel_booking_rooms WHERE branch_id = $1 AND status = 'IN_HOUSE'`, [tenant.branchId])).rows[0].n;
  const last = (await db.query(`SELECT audit_date::text, run_at FROM hotel_night_audits WHERE branch_id = $1 ORDER BY audit_date DESC LIMIT 1`, [tenant.branchId])).rows[0] || null;
  return { business_date: d, next_date: addDaysISO(d, 1), pending_arrivals: pendingArrivals, overdue_departures: dueOut, rooms_in_house: inHouse, last_audit: last };
};

export const runNightAudit = async (client, tenant, userId, { noShowAll = false, notes = null } = {}) => {
  const property = await getProperty(client, tenant, { lock: true });
  const d = property.business_date;
  if ((await client.query(`SELECT 1 FROM hotel_night_audits WHERE branch_id = $1 AND audit_date = $2`, [tenant.branchId, d])).rowCount) throw new HotelError(409, `Night audit for ${d} has already been run`);

  const pending = (await client.query(`SELECT booking_id, res_no FROM hotel_bookings WHERE branch_id = $1 AND status = 'CONFIRMED' AND arrival <= $2 ORDER BY booking_id`, [tenant.branchId, d])).rows;
  if (pending.length && !noShowAll) {
    throw new HotelError(409, `${pending.length} booking${pending.length === 1 ? ' has' : 's have'} not arrived. Check them in or mark them as no-shows before closing the day.`, { code: 'PENDING_ARRIVALS', data: { bookings: pending } });
  }
  for (const p of pending) await markNoShow(client, tenant, userId, p.booking_id);

  // room charge for night D, once per room
  const rooms = (await client.query(
    `SELECT x.*, r.room_no, t.name AS room_type FROM hotel_booking_rooms x JOIN rooms r ON r.room_id = x.room_id JOIN room_types t ON t.room_type_id = x.room_type_id
     WHERE x.branch_id = $1 AND x.status = 'IN_HOUSE' AND x.arrival <= $2 ORDER BY x.rr_id FOR UPDATE OF x`, [tenant.branchId, d])).rows;
  let posted = 0;
  for (const rr of rooms) {
    const rate = Number(rr.night_rates?.[d] ?? rr.rate_paise);
    const taxRate = roomTaxRate(property, rate);
    const tax = await taxFor(client, tenant, { quantity: 1, unitPricePaise: rate, taxRate });
    const { rowCount } = await client.query(
      `INSERT INTO folio_charges (business_id, branch_id, booking_id, rr_id, charge_date, department, description, quantity, unit_price_paise, tax_rate, amount_paise, tax_paise, source, created_by)
       VALUES ($1,$2,$3,$4,$5,'ROOM',$6,1,$7,$8,$9,$10,'NIGHT_AUDIT',$11)
       ON CONFLICT (rr_id, charge_date) WHERE source = 'NIGHT_AUDIT' AND voided_at IS NULL DO NOTHING`,
      [tenant.businessId, tenant.branchId, rr.booking_id, rr.rr_id, d, `Room ${rr.room_no} (${rr.room_type}), ${d}`, rate, taxRate, tax.taxable_paise, tax.tax_paise, userId]);
    posted += rowCount;
    // a guest staying past their departure date is kept on for tomorrow too
    if (String(rr.departure).slice(0, 10) <= d) {
      const next = addDaysISO(d, 1);
      const rates = { ...(rr.night_rates || {}), [next]: rate };
      await client.query(`UPDATE hotel_booking_rooms SET departure = $2, night_rates = $3 WHERE rr_id = $1`, [rr.rr_id, next, JSON.stringify(rates)]);
      await client.query(`UPDATE hotel_bookings SET departure = GREATEST(departure, $2::date) WHERE booking_id = $1`, [rr.booking_id, next]);
    }
  }

  // the day's figures, kept as they were
  const one = async (sql, args) => (await client.query(sql, args)).rows[0];
  const rev = await one(
    `SELECT COALESCE(SUM(amount_paise) FILTER (WHERE department = 'ROOM'), 0)::bigint AS room, COALESCE(SUM(amount_paise) FILTER (WHERE department = 'FNB'), 0)::bigint AS fnb,
            COALESCE(SUM(amount_paise) FILTER (WHERE department NOT IN ('ROOM','FNB')), 0)::bigint AS other, COALESCE(SUM(tax_paise), 0)::bigint AS tax,
            COUNT(DISTINCT rr_id) FILTER (WHERE department = 'ROOM')::int AS sold
     FROM folio_charges WHERE NOT invoiced AND branch_id = $1 AND charge_date = $2 AND voided_at IS NULL`, [tenant.branchId, d]);
  // the restaurant's own sales that day (not the hotel's check-out invoices, which carry the same charges again)
  const pos = await one(
    `SELECT COALESCE(SUM(subtotal_paise - discount_paise), 0)::bigint AS fnb, COALESCE(SUM(tax_paise), 0)::bigint AS tax FROM invoices
     WHERE branch_id = $1 AND invoice_date = $2 AND status <> 'CANCELLED' AND invoice_id NOT IN (SELECT invoice_id FROM hotel_bookings WHERE invoice_id IS NOT NULL UNION SELECT invoice_id FROM banquet_events WHERE invoice_id IS NOT NULL)`, [tenant.branchId, d]);
  // banquet functions held that day count on their own day, whatever happens to the event afterwards
  const banq = await one(
    `SELECT COALESCE(SUM(c.amount_paise), 0)::bigint AS revenue, COALESCE(SUM(c.tax_paise), 0)::bigint AS tax FROM banquet_charges c
     JOIN banquet_functions f ON f.function_id = c.function_id JOIN banquet_events e ON e.event_id = c.event_id
     WHERE c.branch_id = $1 AND f.event_date = $2 AND c.voided_at IS NULL AND e.status IN ('CONFIRMED','COMPLETED')`, [tenant.branchId, d]);
  const inv = await one(
    `SELECT (SELECT COUNT(*) FROM rooms WHERE branch_id = $1 AND is_active)::int AS total,
            (SELECT COUNT(*) FROM rooms r WHERE r.branch_id = $1 AND r.is_active AND (r.hk_status = 'OUT_OF_ORDER' OR EXISTS (SELECT 1 FROM room_blocks k WHERE k.room_id = r.room_id AND k.from_date <= $2 AND k.to_date > $2)))::int AS ooo`, [tenant.branchId, d]);
  const moves = await one(
    `SELECT COUNT(*) FILTER (WHERE checked_in_on = $2)::int AS arrivals, COUNT(*) FILTER (WHERE checked_out_on = $2)::int AS departures,
            COUNT(*) FILTER (WHERE checked_in_on = $2 AND created_on = $2 AND source = 'WALK_IN')::int AS walk_ins,
            COUNT(*) FILTER (WHERE no_show_on = $2)::int AS no_shows, COUNT(*) FILTER (WHERE cancelled_on = $2)::int AS cancellations
     FROM hotel_bookings WHERE branch_id = $1`, [tenant.branchId, d]);
  const guests = await one(`SELECT COALESCE(SUM(adults + children), 0)::int AS n FROM hotel_booking_rooms WHERE branch_id = $1 AND status = 'IN_HOUSE'`, [tenant.branchId]);
  await client.query(
    `INSERT INTO hotel_daily_stats (branch_id, stat_date, business_id, rooms_available, rooms_sold, rooms_out_of_order, room_revenue_paise, fnb_revenue_paise, other_revenue_paise, tax_paise,
                                    arrivals, departures, in_house_guests, walk_ins, no_shows, cancellations)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (branch_id, stat_date) DO UPDATE SET rooms_available = EXCLUDED.rooms_available, rooms_sold = EXCLUDED.rooms_sold, rooms_out_of_order = EXCLUDED.rooms_out_of_order,
       room_revenue_paise = EXCLUDED.room_revenue_paise, fnb_revenue_paise = EXCLUDED.fnb_revenue_paise, other_revenue_paise = EXCLUDED.other_revenue_paise, tax_paise = EXCLUDED.tax_paise,
       arrivals = EXCLUDED.arrivals, departures = EXCLUDED.departures, in_house_guests = EXCLUDED.in_house_guests, walk_ins = EXCLUDED.walk_ins, no_shows = EXCLUDED.no_shows, cancellations = EXCLUDED.cancellations`,
    [tenant.branchId, d, tenant.businessId, inv.total - inv.ooo, rev.sold, inv.ooo, rev.room, Number(rev.fnb) + Number(pos.fnb), Number(rev.other) + Number(banq.revenue), Number(rev.tax) + Number(pos.tax) + Number(banq.tax),
     moves.arrivals, moves.departures, guests.n, moves.walk_ins, moves.no_shows, moves.cancellations]);

  await client.query(`INSERT INTO hotel_night_audits (business_id, branch_id, audit_date, run_by, notes) VALUES ($1,$2,$3,$4,$5)`, [tenant.businessId, tenant.branchId, d, userId, notes]);
  const next = addDaysISO(d, 1);
  await client.query(`UPDATE hotel_properties SET business_date = $2, updated_at = CURRENT_TIMESTAMP WHERE branch_id = $1`, [tenant.branchId, next]);
  return { audited: d, business_date: next, room_charges_posted: posted, no_shows_marked: pending.length, rooms_sold: rev.sold };
};
