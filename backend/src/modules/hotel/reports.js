/*
 * Hotel reports. They follow the standard hotel property-management report set: the manager's flash, occupancy and revenue by day, revenue by
 * department, arrival / departure / in-house lists, high balance, collections, no-shows and cancellations, source of business, and a forecast.
 *
 * Closed days come from hotel_daily_stats, written by night audit exactly as the day was, so a later change of rate or a voided charge never rewrites
 * history. The open day (the hotel's current business date) is worked out live and marked `provisional`.
 *
 * Definitions, the same everywhere:
 *   rooms available  rooms in service that night (not out of order, not blocked)
 *   occupancy        rooms sold / rooms available
 *   ADR              average daily rate = room revenue / rooms sold
 *   RevPAR           revenue per available room = room revenue / rooms available
 * Revenue is before GST. Money is in paise; the controller turns it into rupees.
 */
import { HotelError, addDaysISO, daysBetween, getProperty } from './common.js';

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const avg = (a, b) => (b > 0 ? Math.round(a / b) : 0);

const figures = (r) => {
  const rooms = Number(r.rooms_available || 0); const sold = Number(r.rooms_sold || 0); const room = Number(r.room_revenue_paise || 0);
  const fnb = Number(r.fnb_revenue_paise || 0); const other = Number(r.other_revenue_paise || 0);
  return {
    rooms_available: rooms, rooms_sold: sold, rooms_out_of_order: Number(r.rooms_out_of_order || 0),
    occupancy_pct: pct(sold, rooms), adr_paise: avg(room, sold), revpar_paise: avg(room, rooms),
    room_revenue_paise: room, fnb_revenue_paise: fnb, other_revenue_paise: other, total_revenue_paise: room + fnb + other, tax_paise: Number(r.tax_paise || 0),
    arrivals: Number(r.arrivals || 0), departures: Number(r.departures || 0), in_house_guests: Number(r.in_house_guests || 0),
    walk_ins: Number(r.walk_ins || 0), no_shows: Number(r.no_shows || 0), cancellations: Number(r.cancellations || 0)
  };
};

const SUM_COLS = `COALESCE(SUM(rooms_available),0) AS rooms_available, COALESCE(SUM(rooms_sold),0) AS rooms_sold, COALESCE(SUM(rooms_out_of_order),0) AS rooms_out_of_order,
  COALESCE(SUM(room_revenue_paise),0) AS room_revenue_paise, COALESCE(SUM(fnb_revenue_paise),0) AS fnb_revenue_paise, COALESCE(SUM(other_revenue_paise),0) AS other_revenue_paise,
  COALESCE(SUM(tax_paise),0) AS tax_paise, COALESCE(SUM(arrivals),0) AS arrivals, COALESCE(SUM(departures),0) AS departures, COALESCE(MAX(in_house_guests),0) AS in_house_guests,
  COALESCE(SUM(walk_ins),0) AS walk_ins, COALESCE(SUM(no_shows),0) AS no_shows, COALESCE(SUM(cancellations),0) AS cancellations`;

const monthStart = (d) => `${d.slice(0, 8)}01`;
const fyStart = (d, startMonth) => {
  const y = Number(d.slice(0, 4)); const m = Number(d.slice(5, 7));
  return `${m >= startMonth ? y : y - 1}-${String(startMonth).padStart(2, '0')}-01`;
};

/** The open day, from live data: who is in the hotel tonight and what they will be charged. */
const liveDay = async (db, tenant, date) => {
  const inv = (await db.query(
    `SELECT (SELECT COUNT(*) FROM rooms r WHERE r.branch_id = $1 AND r.is_active AND r.hk_status <> 'OUT_OF_ORDER' AND NOT EXISTS (SELECT 1 FROM room_blocks k WHERE k.room_id = r.room_id AND k.from_date <= $2 AND k.to_date > $2))::int AS available,
            (SELECT COUNT(*) FROM hotel_booking_rooms x WHERE x.branch_id = $1 AND x.status = 'IN_HOUSE' AND x.arrival <= $2)::int AS sold,
            (SELECT COALESCE(SUM(COALESCE((x.night_rates ->> $2::text)::bigint, x.rate_paise)), 0) FROM hotel_booking_rooms x WHERE x.branch_id = $1 AND x.status = 'IN_HOUSE' AND x.arrival <= $2)::bigint AS room_rev,
            (SELECT COALESCE(SUM(adults + children), 0) FROM hotel_booking_rooms x WHERE x.branch_id = $1 AND x.status = 'IN_HOUSE')::int AS guests`, [tenant.branchId, date])).rows[0];
  const mv = (await db.query(
    `SELECT COUNT(*) FILTER (WHERE checked_in_on = $2)::int AS arrivals, COUNT(*) FILTER (WHERE checked_out_on = $2)::int AS departures, COUNT(*) FILTER (WHERE no_show_on = $2)::int AS no_shows,
            COUNT(*) FILTER (WHERE cancelled_on = $2)::int AS cancellations, COUNT(*) FILTER (WHERE checked_in_on = $2 AND created_on = $2 AND source = 'WALK_IN')::int AS walk_ins
     FROM hotel_bookings WHERE branch_id = $1`, [tenant.branchId, date])).rows[0];
  const other = (await db.query(
    `SELECT COALESCE(SUM(amount_paise) FILTER (WHERE department = 'FNB'), 0)::bigint AS fnb, COALESCE(SUM(amount_paise) FILTER (WHERE department NOT IN ('ROOM','FNB')), 0)::bigint AS other
     FROM folio_charges WHERE NOT invoiced AND branch_id = $1 AND charge_date = $2 AND voided_at IS NULL`, [tenant.branchId, date])).rows[0];
  const pos = (await db.query(
    `SELECT COALESCE(SUM(subtotal_paise - discount_paise), 0)::bigint AS fnb FROM invoices WHERE branch_id = $1 AND invoice_date = $2 AND status <> 'CANCELLED' AND invoice_id NOT IN (SELECT invoice_id FROM hotel_bookings WHERE invoice_id IS NOT NULL UNION SELECT invoice_id FROM banquet_events WHERE invoice_id IS NOT NULL)`, [tenant.branchId, date])).rows[0];
  const banq = (await db.query(
    `SELECT COALESCE(SUM(c.amount_paise), 0)::bigint AS revenue FROM banquet_charges c JOIN banquet_functions f ON f.function_id = c.function_id JOIN banquet_events e ON e.event_id = c.event_id
     WHERE c.branch_id = $1 AND f.event_date = $2 AND c.voided_at IS NULL AND e.status IN ('CONFIRMED','COMPLETED')`, [tenant.branchId, date])).rows[0];
  return {
    rooms_available: inv.available, rooms_sold: inv.sold, room_revenue_paise: inv.room_rev, fnb_revenue_paise: Number(other.fnb) + Number(pos.fnb), other_revenue_paise: Number(other.other) + Number(banq.revenue),
    tax_paise: 0, in_house_guests: inv.guests, ...mv
  };
};

export const managersFlash = async (db, tenant, date) => {
  const property = await getProperty(db, tenant);
  const day = date || (await db.query(`SELECT MAX(stat_date)::text AS d FROM hotel_daily_stats WHERE branch_id = $1`, [tenant.branchId])).rows[0].d || property.business_date;
  const fy = (await db.query(`SELECT financial_year_start_month AS m FROM businesses WHERE business_id = $1`, [tenant.businessId])).rows[0]?.m || 4;
  const stat = (await db.query(`SELECT * FROM hotel_daily_stats WHERE branch_id = $1 AND stat_date = $2`, [tenant.branchId, day])).rows[0];
  const provisional = !stat && day >= property.business_date;
  const today = stat || (provisional ? await liveDay(db, tenant, day) : null);
  const range = async (from) => (await db.query(`SELECT ${SUM_COLS} FROM hotel_daily_stats WHERE branch_id = $1 AND stat_date >= $2 AND stat_date <= $3`, [tenant.branchId, from, day])).rows[0];
  const live = (await db.query(
    `SELECT (SELECT COUNT(*) FROM hotel_booking_rooms WHERE branch_id = $1 AND status = 'IN_HOUSE')::int AS rooms_in_house,
            (SELECT COUNT(*) FROM hotel_bookings WHERE branch_id = $1 AND status = 'CONFIRMED' AND arrival = $2)::int AS arrivals_expected,
            (SELECT COUNT(*) FROM hotel_bookings b WHERE b.branch_id = $1 AND b.status = 'CHECKED_IN' AND b.departure <= $2)::int AS departures_expected,
            (SELECT COUNT(*) FROM rooms WHERE branch_id = $1 AND is_active AND hk_status = 'OUT_OF_ORDER')::int AS rooms_out_of_order,
            (SELECT COUNT(*) FROM rooms WHERE branch_id = $1 AND is_active AND hk_status = 'DIRTY')::int AS rooms_dirty`, [tenant.branchId, property.business_date])).rows[0];
  return {
    date: day, business_date: property.business_date, provisional,
    day: today ? figures(today) : null, month_to_date: figures(await range(monthStart(day))), year_to_date: figures(await range(fyStart(day, fy))), now: live
  };
};

export const occupancyRevenue = async (db, tenant, from, to) => {
  if (daysBetween(from, to) > 366) throw new HotelError(400, 'Choose up to a year at a time');
  const rows = (await db.query(`SELECT * FROM hotel_daily_stats WHERE branch_id = $1 AND stat_date >= $2 AND stat_date <= $3 ORDER BY stat_date`, [tenant.branchId, from, to])).rows;
  const total = (await db.query(`SELECT ${SUM_COLS} FROM hotel_daily_stats WHERE branch_id = $1 AND stat_date >= $2 AND stat_date <= $3`, [tenant.branchId, from, to])).rows[0];
  return { from, to, days: rows.map((r) => ({ date: r.stat_date, ...figures(r) })), total: figures(total) };
};

export const revenueByDepartment = async (db, tenant, from, to) => {
  const rows = (await db.query(
    `SELECT department, COALESCE(SUM(amount_paise),0)::bigint AS revenue, COALESCE(SUM(tax_paise),0)::bigint AS tax, COUNT(*)::int AS lines
     FROM folio_charges WHERE NOT invoiced AND branch_id = $1 AND charge_date >= $2 AND charge_date <= $3 AND voided_at IS NULL GROUP BY department`, [tenant.branchId, from, to])).rows;
  const pos = (await db.query(
    `SELECT COALESCE(SUM(subtotal_paise - discount_paise), 0)::bigint AS revenue, COALESCE(SUM(tax_paise), 0)::bigint AS tax, COUNT(*)::int AS bills FROM invoices
     WHERE branch_id = $1 AND invoice_date >= $2 AND invoice_date <= $3 AND status <> 'CANCELLED' AND invoice_id NOT IN (SELECT invoice_id FROM hotel_bookings WHERE invoice_id IS NOT NULL UNION SELECT invoice_id FROM banquet_events WHERE invoice_id IS NOT NULL)`, [tenant.branchId, from, to])).rows[0];
  const out = rows.map((r) => ({ department: r.department, revenue_paise: Number(r.revenue), tax_paise: Number(r.tax), lines: r.lines }));
  out.push({ department: 'RESTAURANT', revenue_paise: Number(pos.revenue), tax_paise: Number(pos.tax), lines: pos.bills });
  const banq = (await db.query(
    `SELECT COALESCE(SUM(c.amount_paise), 0)::bigint AS revenue, COALESCE(SUM(c.tax_paise), 0)::bigint AS tax, COUNT(*)::int AS lines
     FROM banquet_charges c JOIN banquet_functions f ON f.function_id = c.function_id JOIN banquet_events e ON e.event_id = c.event_id
     WHERE c.branch_id = $1 AND f.event_date >= $2 AND f.event_date <= $3 AND c.voided_at IS NULL AND e.status IN ('CONFIRMED','COMPLETED')`, [tenant.branchId, from, to])).rows[0];
  out.push({ department: 'BANQUET', revenue_paise: Number(banq.revenue), tax_paise: Number(banq.tax), lines: banq.lines });
  const daily = (await db.query(
    `SELECT charge_date::text AS date, department, COALESCE(SUM(amount_paise),0)::bigint AS revenue FROM folio_charges WHERE NOT invoiced AND branch_id = $1 AND charge_date >= $2 AND charge_date <= $3 AND voided_at IS NULL GROUP BY charge_date, department ORDER BY charge_date`, [tenant.branchId, from, to])).rows;
  return { from, to, departments: out, total_paise: out.reduce((s, r) => s + r.revenue_paise, 0), daily: daily.map((d) => ({ ...d, revenue: Number(d.revenue) })) };
};

const LIST_SQL = `
  SELECT b.booking_id, b.res_no, b.status, b.arrival::text, b.departure::text, b.source, b.company, g.name AS guest_name, g.phone, g.is_vip, g.nationality,
         (SELECT string_agg(COALESCE(r.room_no, t.code), ', ' ORDER BY x.rr_id) FROM hotel_booking_rooms x JOIN room_types t ON t.room_type_id = x.room_type_id LEFT JOIN rooms r ON r.room_id = x.room_id WHERE x.booking_id = b.booking_id AND x.status <> 'CANCELLED') AS rooms,
         (SELECT COALESCE(SUM(x.adults), 0) FROM hotel_booking_rooms x WHERE x.booking_id = b.booking_id AND x.status <> 'CANCELLED')::int AS adults,
         hotel_charges_paise(b.booking_id) AS charges_paise,
         hotel_paid_paise(b.booking_id) AS paid_paise,
         b.notes
  FROM hotel_bookings b JOIN guests g ON g.guest_id = b.guest_id`;

const withBalance = (rows) => rows.map((r) => ({ ...r, charges_paise: Number(r.charges_paise), paid_paise: Number(r.paid_paise), balance_paise: Number(r.charges_paise) - Number(r.paid_paise) }));

export const arrivals = async (db, tenant, date) => withBalance((await db.query(`${LIST_SQL} WHERE b.branch_id = $1 AND b.arrival = $2 AND b.status IN ('CONFIRMED','CHECKED_IN') ORDER BY g.name`, [tenant.branchId, date])).rows);
export const departures = async (db, tenant, date) => withBalance((await db.query(`${LIST_SQL} WHERE b.branch_id = $1 AND b.departure = $2 AND b.status IN ('CHECKED_IN','CHECKED_OUT') ORDER BY g.name`, [tenant.branchId, date])).rows);
export const inHouse = async (db, tenant) => withBalance((await db.query(`${LIST_SQL} WHERE b.branch_id = $1 AND b.status = 'CHECKED_IN' ORDER BY b.departure, g.name`, [tenant.branchId])).rows);

/** In-house guests who owe more than `minPaise`. */
export const highBalance = async (db, tenant, minPaise = 0) => (await inHouse(db, tenant)).filter((r) => r.balance_paise > minPaise).sort((a, b) => b.balance_paise - a.balance_paise);

export const collections = async (db, tenant, from, to) => {
  const folio = (await db.query(
    `SELECT f.method, f.kind, COALESCE(u.name, 'Unknown') AS person, SUM(f.amount_paise)::bigint AS paise, COUNT(*)::int AS n
     FROM folio_payments f LEFT JOIN users u ON u.user_id = f.created_by WHERE f.branch_id = $1 AND f.pay_date >= $2 AND f.pay_date <= $3 GROUP BY f.method, f.kind, u.name`, [tenant.branchId, from, to])).rows;
  // the restaurant's own takings (the hotel's check-out invoices are already in the folio payments above)
  const pos = (await db.query(
    `SELECT p.payment_method AS method, COALESCE(u.name, 'Unknown') AS person, SUM(p.amount_paise)::bigint AS paise, COUNT(*)::int AS n
     FROM payments p LEFT JOIN users u ON u.user_id = p.created_by
     WHERE p.branch_id = $1 AND p.payment_date >= $2 AND p.payment_date <= $3 AND p.invoice_id IS NOT NULL AND COALESCE(p.reference_number, '') NOT LIKE 'Stay %' AND p.invoice_id NOT IN (SELECT invoice_id FROM hotel_bookings WHERE invoice_id IS NOT NULL UNION SELECT invoice_id FROM banquet_events WHERE invoice_id IS NOT NULL)
     GROUP BY p.payment_method, u.name`, [tenant.branchId, from, to])).rows;
  const events = (await db.query(
    `SELECT f.method, f.kind, COALESCE(u.name, 'Unknown') AS person, SUM(f.amount_paise)::bigint AS paise FROM banquet_payments f LEFT JOIN users u ON u.user_id = f.created_by
     WHERE f.branch_id = $1 AND f.pay_date >= $2 AND f.pay_date <= $3 GROUP BY f.method, f.kind, u.name`, [tenant.branchId, from, to])).rows;
  const byMethod = new Map();
  const add = (m, key, paise) => { const x = byMethod.get(m) || { method: m, hotel_paise: 0, banquet_paise: 0, refunds_paise: 0, restaurant_paise: 0 }; x[key] += Number(paise); byMethod.set(m, x); };
  for (const r of folio) add(r.method, r.kind === 'REFUND' ? 'refunds_paise' : 'hotel_paise', r.paise);
  for (const r of pos) add(r.method, 'restaurant_paise', r.paise);
  for (const r of events) add(r.method, r.kind === 'REFUND' ? 'refunds_paise' : 'banquet_paise', r.paise);
  const methods = [...byMethod.values()].map((m) => ({ ...m, net_paise: m.hotel_paise + m.banquet_paise + m.restaurant_paise - m.refunds_paise }));
  const people = new Map();
  for (const r of [...folio.map((x) => ({ ...x, sign: x.kind === 'REFUND' ? -1 : 1 })), ...events.map((x) => ({ ...x, sign: x.kind === 'REFUND' ? -1 : 1 })), ...pos.map((x) => ({ ...x, sign: 1 }))]) people.set(r.person, (people.get(r.person) || 0) + r.sign * Number(r.paise));
  return { from, to, methods, by_person: [...people.entries()].map(([person, paise]) => ({ person, net_paise: paise })).sort((a, b) => b.net_paise - a.net_paise), total_paise: methods.reduce((s, m) => s + m.net_paise, 0) };
};

export const noShowsAndCancellations = async (db, tenant, from, to) => {
  const rows = (await db.query(
    `SELECT b.booking_id, b.res_no, b.status, g.name AS guest_name, b.source, b.arrival::text, b.departure::text, COALESCE(b.cancelled_on, b.no_show_on)::text AS on_date, b.cancel_reason,
            COALESCE((SELECT SUM(f.amount_paise) FROM folio_payments f WHERE f.booking_id = b.booking_id AND f.kind <> 'REFUND'), 0)::bigint AS advance_paise,
            COALESCE((SELECT SUM(f.amount_paise) FROM folio_payments f WHERE f.booking_id = b.booking_id AND f.kind = 'REFUND'), 0)::bigint AS refunded_paise,
            COALESCE((SELECT SUM((SELECT COALESCE(SUM(v::bigint), 0) FROM jsonb_each_text(x.night_rates) e(k, v))) FROM hotel_booking_rooms x WHERE x.booking_id = b.booking_id), 0)::bigint AS room_value_paise
     FROM hotel_bookings b JOIN guests g ON g.guest_id = b.guest_id
     WHERE b.branch_id = $1 AND b.status IN ('CANCELLED','NO_SHOW') AND COALESCE(b.cancelled_on, b.no_show_on) >= $2 AND COALESCE(b.cancelled_on, b.no_show_on) <= $3 ORDER BY on_date DESC, b.booking_id DESC`, [tenant.branchId, from, to])).rows;
  const out = rows.map((r) => ({ ...r, advance_paise: Number(r.advance_paise), refunded_paise: Number(r.refunded_paise), room_value_paise: Number(r.room_value_paise), advance_kept_paise: Number(r.advance_paise) - Number(r.refunded_paise) }));
  return {
    from, to, rows: out, cancellations: out.filter((r) => r.status === 'CANCELLED').length, no_shows: out.filter((r) => r.status === 'NO_SHOW').length,
    room_value_lost_paise: out.reduce((s, r) => s + r.room_value_paise, 0), advance_kept_paise: out.reduce((s, r) => s + r.advance_kept_paise, 0)
  };
};

export const sourceOfBusiness = async (db, tenant, from, to) => {
  const rows = (await db.query(
    `SELECT b.source, COUNT(DISTINCT b.booking_id)::int AS bookings,
            COUNT(*) FILTER (WHERE c.department = 'ROOM')::int AS room_nights,
            COALESCE(SUM(c.amount_paise) FILTER (WHERE c.department = 'ROOM'), 0)::bigint AS room_revenue,
            COALESCE(SUM(c.amount_paise), 0)::bigint AS total_revenue
     FROM hotel_bookings b LEFT JOIN folio_charges c ON c.booking_id = b.booking_id AND c.voided_at IS NULL AND NOT c.invoiced AND c.charge_date >= $2 AND c.charge_date <= $3
     WHERE b.branch_id = $1 AND b.status IN ('CHECKED_IN','CHECKED_OUT') AND b.arrival <= $3 AND b.departure > $2 GROUP BY b.source ORDER BY room_revenue DESC`, [tenant.branchId, from, to])).rows;
  return {
    from, to, sources: rows.map((r) => ({ source: r.source, bookings: r.bookings, room_nights: r.room_nights, room_revenue_paise: Number(r.room_revenue), total_revenue_paise: Number(r.total_revenue), adr_paise: avg(Number(r.room_revenue), r.room_nights) })),
    total_room_revenue_paise: rows.reduce((s, r) => s + Number(r.room_revenue), 0)
  };
};

/** Looking ahead: for each coming night, the rooms booked, how full that is and the room revenue already on the books. */
export const forecast = async (db, tenant, from, to) => {
  if (daysBetween(from, to) > 120) throw new HotelError(400, 'Look ahead up to 120 days at a time');
  const rows = (await db.query(
    `WITH nights AS (SELECT d::date AS night FROM generate_series($2::date, $3::date, '1 day') d)
     SELECT n.night::text AS date,
            (SELECT COUNT(*) FROM rooms r WHERE r.branch_id = $1 AND r.is_active AND r.hk_status <> 'OUT_OF_ORDER' AND NOT EXISTS (SELECT 1 FROM room_blocks k WHERE k.room_id = r.room_id AND k.from_date <= n.night AND k.to_date > n.night))::int AS available,
            (SELECT COUNT(*) FROM hotel_booking_rooms x WHERE x.branch_id = $1 AND x.status IN ('RESERVED','IN_HOUSE') AND x.arrival <= n.night AND x.departure > n.night)::int AS booked,
            (SELECT COALESCE(SUM(COALESCE((x.night_rates ->> n.night::text)::bigint, x.rate_paise)), 0) FROM hotel_booking_rooms x WHERE x.branch_id = $1 AND x.status IN ('RESERVED','IN_HOUSE') AND x.arrival <= n.night AND x.departure > n.night)::bigint AS revenue,
            (SELECT COUNT(*) FROM hotel_bookings b WHERE b.branch_id = $1 AND b.status = 'CONFIRMED' AND b.arrival = n.night)::int AS arrivals,
            (SELECT COUNT(*) FROM hotel_bookings b WHERE b.branch_id = $1 AND b.status IN ('CONFIRMED','CHECKED_IN') AND b.departure = n.night)::int AS departures
     FROM nights n ORDER BY n.night`, [tenant.branchId, from, to])).rows;
  return { from, to, days: rows.map((r) => ({ date: r.date, rooms_available: r.available, rooms_booked: r.booked, occupancy_pct: pct(r.booked, r.available), expected_room_revenue_paise: Number(r.revenue), adr_paise: avg(Number(r.revenue), r.booked), arrivals: r.arrivals, departures: r.departures })) };
};

export { addDaysISO };
