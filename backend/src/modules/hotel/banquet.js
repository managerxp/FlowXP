/*
 * Banquet and events.
 *
 * An event has an organiser (a guest record), a status and one or more functions: each function is a hall on a date between two times, with guests, a menu package and a
 * set-up. A hall cannot hold two functions that overlap in time. What holds a hall:
 *   ENQUIRY    nothing: someone asked
 *   TENTATIVE  the hall is held until `hold_until`, then it is free again by itself
 *   CONFIRMED  the hall is held
 * The organiser's charges are worked out from each function (the hall's rent, and the price a plate for the guaranteed number of guests), plus anything added by hand
 * (decor, sound, extra rooms). Changing a function's guests, package or rent rewrites its worked-out lines and leaves the hand-added ones alone.
 *
 * Completing an event makes one GST invoice, like a hotel stay: the advance and payments already taken go on it as they were paid, and what is left is paid now.
 */
import { createInvoiceInTransaction } from '../billing.js';
import { HotelError, getProperty, netByMethod } from './common.js';
import { taxFor } from './folio.js';
import { saveGuest } from './stay.js';

export const EVENT_TYPES = ['WEDDING', 'RECEPTION', 'ENGAGEMENT', 'BIRTHDAY', 'CORPORATE', 'CONFERENCE', 'PARTY', 'OTHER'];
export const SETUP_STYLES = ['BANQUET_ROUNDS', 'THEATRE', 'CLASSROOM', 'U_SHAPE', 'COCKTAIL', 'BOARDROOM', 'OTHER'];
export const CHARGE_CATEGORIES = ['HALL', 'FOOD', 'DECOR', 'AV', 'ROOMS', 'OTHER'];
export const HOLDING = ['TENTATIVE', 'CONFIRMED'];

/* ── halls and packages ────────────────────────────────────────────────── */

export const listHalls = async (db, tenant, { all = false } = {}) =>
  (await db.query(`SELECT * FROM banquet_halls WHERE branch_id = $1 ${all ? '' : 'AND is_active'} ORDER BY sort_order, name`, [tenant.branchId])).rows;

export const saveHall = async (db, tenant, id, v) => {
  if (id) {
    const r = (await db.query(`UPDATE banquet_halls SET name=$3, capacity_seated=$4, capacity_floating=$5, rent_paise=$6, amenities=$7, sort_order=$8, is_active=$9 WHERE hall_id=$1 AND branch_id=$2 RETURNING *`,
      [id, tenant.branchId, v.name, v.capacity_seated, v.capacity_floating, v.rent_paise, v.amenities, v.sort_order, v.is_active])).rows[0];
    if (!r) throw new HotelError(404, 'Hall not found');
    return r;
  }
  return (await db.query(`INSERT INTO banquet_halls (business_id, branch_id, name, capacity_seated, capacity_floating, rent_paise, amenities, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [tenant.businessId, tenant.branchId, v.name, v.capacity_seated, v.capacity_floating, v.rent_paise, v.amenities, v.sort_order])).rows[0];
};

export const archiveHall = async (db, tenant, id) => {
  const live = (await db.query(
    `SELECT 1 FROM banquet_functions f JOIN banquet_events e ON e.event_id = f.event_id WHERE f.hall_id = $1 AND e.status IN ('TENTATIVE','CONFIRMED') AND f.event_date >= (SELECT business_date FROM hotel_properties WHERE branch_id = $2) LIMIT 1`, [id, tenant.branchId])).rowCount;
  if (live) throw new HotelError(409, 'There are events booked in this hall');
  const { rowCount } = await db.query(`UPDATE banquet_halls SET is_active = FALSE WHERE hall_id = $1 AND branch_id = $2`, [id, tenant.branchId]);
  if (!rowCount) throw new HotelError(404, 'Hall not found');
};

export const listPackages = async (db, tenant, { all = false } = {}) =>
  (await db.query(`SELECT * FROM banquet_packages WHERE branch_id = $1 ${all ? '' : 'AND is_active'} ORDER BY sort_order, name`, [tenant.branchId])).rows;

export const savePackage = async (db, tenant, id, v) => {
  if (id) {
    const r = (await db.query(`UPDATE banquet_packages SET name=$3, diet=$4, per_plate_paise=$5, min_guests=$6, tax_rate=$7, menu=$8, sort_order=$9, is_active=$10 WHERE package_id=$1 AND branch_id=$2 RETURNING *`,
      [id, tenant.branchId, v.name, v.diet, v.per_plate_paise, v.min_guests, v.tax_rate, v.menu, v.sort_order, v.is_active])).rows[0];
    if (!r) throw new HotelError(404, 'Package not found');
    return r;
  }
  return (await db.query(`INSERT INTO banquet_packages (business_id, branch_id, name, diet, per_plate_paise, min_guests, tax_rate, menu, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [tenant.businessId, tenant.branchId, v.name, v.diet, v.per_plate_paise, v.min_guests, v.tax_rate, v.menu, v.sort_order])).rows[0];
};

export const archivePackage = async (db, tenant, id) => {
  const { rowCount } = await db.query(`UPDATE banquet_packages SET is_active = FALSE WHERE package_id = $1 AND branch_id = $2`, [id, tenant.branchId]);
  if (!rowCount) throw new HotelError(404, 'Package not found');
};

/* ── halls in use ──────────────────────────────────────────────────────── */

/** Functions already holding this hall at this time. */
export const hallConflicts = async (db, tenant, { hallId, date, start, end, excludeFunctionId = null }) => {
  const property = await getProperty(db, tenant);
  return (await db.query(
    `SELECT f.function_id, f.name AS function_name, f.start_time::text AS start_time, f.end_time::text AS end_time, e.event_id, e.event_no, e.title, e.status
     FROM banquet_functions f JOIN banquet_events e ON e.event_id = f.event_id
     WHERE f.hall_id = $1 AND f.event_date = $2 AND f.start_time < $4 AND f.end_time > $3 AND ($5::int IS NULL OR f.function_id <> $5)
       AND (e.status = 'CONFIRMED' OR (e.status = 'TENTATIVE' AND (e.hold_until IS NULL OR e.hold_until >= $6)))`,
    [hallId, date, start, end, excludeFunctionId, property.business_date])).rows;
};

const assertHallFree = async (client, tenant, f, excludeFunctionId = null) => {
  await client.query(`SELECT 1 FROM banquet_halls WHERE hall_id = $1 AND branch_id = $2 FOR UPDATE`, [f.hall_id, tenant.branchId]);
  const clash = (await hallConflicts(client, tenant, { hallId: f.hall_id, date: f.event_date, start: f.start_time, end: f.end_time, excludeFunctionId }))[0];
  if (clash) throw new HotelError(409, `The hall is already held on ${f.event_date} from ${clash.start_time.slice(0, 5)} to ${clash.end_time.slice(0, 5)} by ${clash.event_no} (${clash.title})`, { code: 'HALL_TAKEN' });
};

/** Every hall, and every function in it between two dates, for the calendar. */
export const hallCalendar = async (db, tenant, { from, to }) => {
  const property = await getProperty(db, tenant);
  const halls = await listHalls(db, tenant);
  const functions = (await db.query(
    `SELECT f.function_id, f.hall_id, f.name AS function_name, f.event_date::text AS event_date, f.start_time::text AS start_time, f.end_time::text AS end_time, f.expected_guests, f.guaranteed_guests,
            e.event_id, e.event_no, e.title, e.status, e.event_type, e.hold_until::text AS hold_until, g.name AS organiser
     FROM banquet_functions f JOIN banquet_events e ON e.event_id = f.event_id JOIN guests g ON g.guest_id = e.guest_id
     WHERE f.branch_id = $1 AND f.event_date >= $2 AND f.event_date <= $3 AND e.status IN ('TENTATIVE','CONFIRMED','COMPLETED')
       AND NOT (e.status = 'TENTATIVE' AND e.hold_until IS NOT NULL AND e.hold_until < $4)
     ORDER BY f.event_date, f.start_time`, [tenant.branchId, from, to, property.business_date])).rows;
  return { from, to, business_date: property.business_date, halls, functions };
};

/* ── charges: worked out from the functions ────────────────────────────── */

const lineFor = async (client, tenant, { quantity, unitPricePaise, taxRate }) => taxFor(client, tenant, { quantity, unitPricePaise, taxRate });

/** Rewrite the worked-out lines of a function: the hall's rent, and the price a plate for the guaranteed guests. Hand-added lines are left alone. */
export const recomputeFunction = async (client, tenant, userId, functionId) => {
  const f = (await client.query(
    `SELECT f.*, p.tax_rate AS package_tax, p.min_guests, p.name AS package_name, h.name AS hall_name FROM banquet_functions f LEFT JOIN banquet_packages p ON p.package_id = f.package_id JOIN banquet_halls h ON h.hall_id = f.hall_id WHERE f.function_id = $1`, [functionId])).rows[0];
  if (!f) return;
  await client.query(`DELETE FROM banquet_charges WHERE function_id = $1 AND auto`, [functionId]);
  const day = String(f.event_date).slice(0, 10);
  const add = async (category, description, quantity, unit, taxRate) => {
    const tax = await lineFor(client, tenant, { quantity, unitPricePaise: unit, taxRate });
    await client.query(
      `INSERT INTO banquet_charges (event_id, function_id, business_id, branch_id, category, description, quantity, unit_price_paise, tax_rate, amount_paise, tax_paise, auto, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12)`,
      [f.event_id, functionId, tenant.businessId, tenant.branchId, category, description, quantity, unit, taxRate, tax.taxable_paise, tax.tax_paise, userId]);
  };
  if (Number(f.rent_paise) > 0) await add('HALL', `${f.hall_name}: hall rent, ${f.name} (${day})`, 1, Number(f.rent_paise), 18);
  const guests = Math.max(f.guaranteed_guests ?? f.expected_guests, f.min_guests || 0);
  if (Number(f.per_plate_paise) > 0 && guests > 0) await add('FOOD', `${f.package_name || 'Catering'}: ${f.name} (${day}), ${guests} guests`, guests, Number(f.per_plate_paise), f.package_tax != null ? Number(f.package_tax) : 18);
};

export const totalsOf = async (db, eventId) => {
  const c = (await db.query(`SELECT COALESCE(SUM(amount_paise + tax_paise), 0)::bigint AS charges, COALESCE(SUM(tax_paise), 0)::bigint AS tax, COALESCE(SUM(amount_paise), 0)::bigint AS net FROM banquet_charges WHERE event_id = $1 AND voided_at IS NULL`, [eventId])).rows[0];
  const p = (await db.query(`SELECT COALESCE(SUM(CASE WHEN kind = 'REFUND' THEN -amount_paise ELSE amount_paise END), 0)::bigint AS paid FROM banquet_payments WHERE event_id = $1`, [eventId])).rows[0];
  const charges = Number(c.charges); const paid = Number(p.paid);
  return { net_paise: Number(c.net), tax_paise: Number(c.tax), charges_paise: charges, paid_paise: paid, balance_paise: charges - paid };
};

/* ── events ────────────────────────────────────────────────────────────── */

const lockEvent = async (client, tenant, id) => {
  const e = (await client.query(`SELECT * FROM banquet_events WHERE event_id = $1 AND branch_id = $2 FOR UPDATE`, [id, tenant.branchId])).rows[0];
  if (!e) throw new HotelError(404, 'Event not found');
  return e;
};

const nextNo = async (client, tenant) => {
  const p = (await client.query(`UPDATE hotel_properties SET next_event_no = next_event_no + 1 WHERE branch_id = $1 RETURNING event_prefix, next_event_no - 1 AS n`, [tenant.branchId])).rows[0];
  return `${p.event_prefix}-${String(p.n).padStart(5, '0')}`;
};

const checkHold = async (client, tenant, status, holdUntil) => {
  if (status === 'TENTATIVE') {
    const property = await getProperty(client, tenant);
    if (!holdUntil) throw new HotelError(400, 'Say until when the hall is held');
    if (holdUntil < property.business_date) throw new HotelError(400, 'The hold date has already passed');
  }
};

const assertCapacity = (hall, guests) => {
  const most = Math.max(Number(hall.capacity_seated), Number(hall.capacity_floating));
  if (most && guests > most) throw new HotelError(400, `${hall.name} holds up to ${most} people`);
};

const insertFunction = async (client, tenant, userId, eventId, f) => {
  const hall = (await client.query(`SELECT * FROM banquet_halls WHERE hall_id = $1 AND branch_id = $2 AND is_active`, [f.hall_id, tenant.branchId])).rows[0];
  if (!hall) throw new HotelError(400, 'Choose a hall');
  let pkg = null;
  if (f.package_id) {
    pkg = (await client.query(`SELECT * FROM banquet_packages WHERE package_id = $1 AND branch_id = $2`, [f.package_id, tenant.branchId])).rows[0];
    if (!pkg) throw new HotelError(400, 'Package not found');
  }
  assertCapacity(hall, f.expected_guests);
  const row = (await client.query(
    `INSERT INTO banquet_functions (event_id, business_id, branch_id, hall_id, name, event_date, start_time, end_time, expected_guests, guaranteed_guests, package_id, per_plate_paise, rent_paise, setup_style, menu, setup_notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [eventId, tenant.businessId, tenant.branchId, f.hall_id, f.name, f.event_date, f.start_time, f.end_time, f.expected_guests, f.guaranteed_guests ?? null, f.package_id || null,
     f.per_plate_paise ?? (pkg ? Number(pkg.per_plate_paise) : 0), f.rent_paise ?? Number(hall.rent_paise), f.setup_style || 'BANQUET_ROUNDS', f.menu ?? pkg?.menu ?? null, f.setup_notes ?? null])).rows[0];
  return row;
};

export const createEvent = async (client, tenant, userId, input) => {
  const property = await getProperty(client, tenant, { lock: true });
  const status = input.status || 'ENQUIRY';
  if (!['ENQUIRY', 'TENTATIVE', 'CONFIRMED'].includes(status)) throw new HotelError(400, 'An event starts as an enquiry, tentative or confirmed');
  await checkHold(client, tenant, status, input.hold_until);
  if (!input.functions?.length) throw new HotelError(400, 'Add at least one function: the hall, the date and the time');
  const guest = await saveGuest(client, tenant, input.guest || {});
  const eventNo = await nextNo(client, tenant);
  const e = (await client.query(
    `INSERT INTO banquet_events (business_id, branch_id, event_no, status, event_type, title, guest_id, company, hold_until, source, notes, instructions, created_by, created_on, confirmed_on)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [tenant.businessId, tenant.branchId, eventNo, status, input.event_type, input.title, guest.guest_id, input.company || null, status === 'TENTATIVE' ? input.hold_until : null, input.source || 'PHONE', input.notes || null, input.instructions || null,
     userId, property.business_date, status === 'CONFIRMED' ? property.business_date : null])).rows[0];
  for (const f of input.functions) {
    if (f.event_date < property.business_date) throw new HotelError(400, `A function cannot be on a date that has passed (${f.event_date})`);
    if (HOLDING.includes(status)) await assertHallFree(client, tenant, f);
    const row = await insertFunction(client, tenant, userId, e.event_id, f);
    await recomputeFunction(client, tenant, userId, row.function_id);
  }
  return e.event_id;
};

export const listEvents = async (db, tenant, { status, q, like, from, to, limit, offset }) => {
  const args = [tenant.branchId]; const where = ['e.branch_id = $1'];
  if (status) { args.push(status.split(',')); where.push(`e.status = ANY($${args.length}::text[])`); }
  if (from) { args.push(from); where.push(`EXISTS (SELECT 1 FROM banquet_functions f WHERE f.event_id = e.event_id AND f.event_date >= $${args.length})`); }
  if (to) { args.push(to); where.push(`EXISTS (SELECT 1 FROM banquet_functions f WHERE f.event_id = e.event_id AND f.event_date <= $${args.length})`); }
  if (q) { args.push(like(q)); where.push(`(lower(e.title) LIKE lower($${args.length}) OR lower(e.event_no) LIKE lower($${args.length}) OR lower(g.name) LIKE lower($${args.length}) OR g.phone LIKE $${args.length})`); }
  const base = `FROM banquet_events e JOIN guests g ON g.guest_id = e.guest_id WHERE ${where.join(' AND ')}`;
  const total = (await db.query(`SELECT COUNT(*)::int AS n ${base}`, args)).rows[0].n;
  args.push(limit, offset);
  const rows = (await db.query(
    `SELECT e.event_id, e.event_no, e.status, e.event_type, e.title, e.hold_until::text AS hold_until, e.company, e.source, g.name AS organiser, g.phone,
            (SELECT MIN(f.event_date)::text FROM banquet_functions f WHERE f.event_id = e.event_id) AS first_date,
            (SELECT COUNT(*) FROM banquet_functions f WHERE f.event_id = e.event_id)::int AS functions,
            (SELECT COALESCE(SUM(COALESCE(f.guaranteed_guests, f.expected_guests)), 0) FROM banquet_functions f WHERE f.event_id = e.event_id)::int AS guests,
            COALESCE((SELECT SUM(c.amount_paise + c.tax_paise) FROM banquet_charges c WHERE c.event_id = e.event_id AND c.voided_at IS NULL), 0)::bigint AS charges_paise,
            COALESCE((SELECT SUM(CASE WHEN p.kind = 'REFUND' THEN -p.amount_paise ELSE p.amount_paise END) FROM banquet_payments p WHERE p.event_id = e.event_id), 0)::bigint AS paid_paise
     ${base} ORDER BY (SELECT MIN(f.event_date) FROM banquet_functions f WHERE f.event_id = e.event_id) DESC NULLS LAST, e.event_id DESC LIMIT $${args.length - 1} OFFSET $${args.length}`, args)).rows;
  return { rows, total };
};

export const eventDetail = async (db, tenant, id) => {
  const e = (await db.query(`SELECT e.*, e.hold_until::text AS hold_until_text FROM banquet_events e WHERE e.event_id = $1 AND e.branch_id = $2`, [id, tenant.branchId])).rows[0];
  if (!e) throw new HotelError(404, 'Event not found');
  const guest = (await db.query(`SELECT * FROM guests WHERE guest_id = $1`, [e.guest_id])).rows[0];
  const functions = (await db.query(
    `SELECT f.*, f.event_date::text AS event_date, f.start_time::text AS start_time, f.end_time::text AS end_time, h.name AS hall_name, p.name AS package_name, p.diet
     FROM banquet_functions f JOIN banquet_halls h ON h.hall_id = f.hall_id LEFT JOIN banquet_packages p ON p.package_id = f.package_id WHERE f.event_id = $1 ORDER BY f.event_date, f.start_time`, [id])).rows;
  const charges = (await db.query(`SELECT * FROM banquet_charges WHERE event_id = $1 ORDER BY function_id NULLS LAST, charge_id`, [id])).rows;
  const payments = (await db.query(`SELECT * FROM banquet_payments WHERE event_id = $1 ORDER BY bp_id`, [id])).rows;
  return { ...e, hold_until: e.hold_until_text, guest, functions, charges, payments, totals: await totalsOf(db, id) };
};

export const updateEvent = async (client, tenant, userId, id, v) => {
  const e = await lockEvent(client, tenant, id);
  if (['COMPLETED', 'CANCELLED'].includes(e.status)) throw new HotelError(409, 'This event is closed');
  const m = { ...e, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) };
  if (m.status === 'TENTATIVE') await checkHold(client, tenant, 'TENTATIVE', m.hold_until && String(m.hold_until).slice(0, 10));
  await client.query(`UPDATE banquet_events SET title=$2, event_type=$3, company=$4, notes=$5, instructions=$6, source=$7, hold_until=$8 WHERE event_id=$1`,
    [id, m.title, m.event_type, m.company, m.notes, m.instructions, m.source, e.status === 'TENTATIVE' ? (m.hold_until ? String(m.hold_until).slice(0, 10) : null) : null]);
};

/** ENQUIRY -> TENTATIVE (held until a date) -> CONFIRMED. Holding a hall checks every function against what is already booked. */
export const setStatus = async (client, tenant, userId, id, { status, holdUntil = null }) => {
  const e = await lockEvent(client, tenant, id);
  const property = await getProperty(client, tenant);
  if (['COMPLETED', 'CANCELLED'].includes(e.status)) throw new HotelError(409, 'This event is closed');
  if (!['ENQUIRY', 'TENTATIVE', 'CONFIRMED'].includes(status)) throw new HotelError(400, 'Choose a status');
  await checkHold(client, tenant, status, holdUntil);
  if (HOLDING.includes(status)) {
    for (const f of (await client.query(`SELECT *, event_date::text AS event_date, start_time::text AS start_time, end_time::text AS end_time FROM banquet_functions WHERE event_id = $1`, [id])).rows) {
      if (f.event_date < property.business_date) throw new HotelError(409, `A function is on ${f.event_date}, which has passed`);
      await assertHallFree(client, tenant, f, f.function_id);
    }
  }
  await client.query(`UPDATE banquet_events SET status = $2::varchar, hold_until = $3, confirmed_on = CASE WHEN $2::text = 'CONFIRMED' THEN COALESCE(confirmed_on, $4::date) ELSE confirmed_on END WHERE event_id = $1`,
    [id, status, status === 'TENTATIVE' ? holdUntil : null, property.business_date]);
};

export const cancelEvent = async (client, tenant, userId, id, reason) => {
  const e = await lockEvent(client, tenant, id);
  const property = await getProperty(client, tenant);
  if (['COMPLETED', 'CANCELLED'].includes(e.status)) throw new HotelError(409, 'This event is closed');
  await client.query(`UPDATE banquet_events SET status = 'CANCELLED', cancel_reason = $2, cancelled_on = $3, hold_until = NULL WHERE event_id = $1`, [id, reason, property.business_date]);
  return totalsOf(client, id);
};

/* ── functions ─────────────────────────────────────────────────────────── */

export const addFunction = async (client, tenant, userId, eventId, f) => {
  const e = await lockEvent(client, tenant, eventId);
  const property = await getProperty(client, tenant);
  if (['COMPLETED', 'CANCELLED'].includes(e.status)) throw new HotelError(409, 'This event is closed');
  if (f.event_date < property.business_date) throw new HotelError(400, 'A function cannot be on a date that has passed');
  if (HOLDING.includes(e.status)) await assertHallFree(client, tenant, f);
  const row = await insertFunction(client, tenant, userId, eventId, f);
  await recomputeFunction(client, tenant, userId, row.function_id);
  return row.function_id;
};

export const updateFunction = async (client, tenant, userId, functionId, v) => {
  const f = (await client.query(`SELECT f.*, f.event_date::text AS event_date, f.start_time::text AS start_time, f.end_time::text AS end_time FROM banquet_functions f WHERE f.function_id = $1 AND f.branch_id = $2 FOR UPDATE`, [functionId, tenant.branchId])).rows[0];
  if (!f) throw new HotelError(404, 'Function not found');
  const e = await lockEvent(client, tenant, f.event_id);
  if (['COMPLETED', 'CANCELLED'].includes(e.status)) throw new HotelError(409, 'This event is closed');
  const m = { ...f, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) };
  if (!(m.end_time > m.start_time)) throw new HotelError(400, 'The function must end after it starts');
  const hall = (await client.query(`SELECT * FROM banquet_halls WHERE hall_id = $1 AND branch_id = $2 AND is_active`, [m.hall_id, tenant.branchId])).rows[0];
  if (!hall) throw new HotelError(400, 'Choose a hall');
  assertCapacity(hall, m.expected_guests);
  if (HOLDING.includes(e.status)) await assertHallFree(client, tenant, m, functionId);
  if (m.package_id && v.package_id !== undefined && Number(v.package_id) !== Number(f.package_id)) {
    const pkg = (await client.query(`SELECT * FROM banquet_packages WHERE package_id = $1 AND branch_id = $2`, [m.package_id, tenant.branchId])).rows[0];
    if (!pkg) throw new HotelError(400, 'Package not found');
    if (v.per_plate_paise === undefined) m.per_plate_paise = Number(pkg.per_plate_paise);
    if (v.menu === undefined) m.menu = pkg.menu;
  }
  await client.query(
    `UPDATE banquet_functions SET hall_id=$2, name=$3, event_date=$4, start_time=$5, end_time=$6, expected_guests=$7, guaranteed_guests=$8, package_id=$9, per_plate_paise=$10, rent_paise=$11, setup_style=$12, menu=$13, setup_notes=$14 WHERE function_id=$1`,
    [functionId, m.hall_id, m.name, m.event_date, m.start_time, m.end_time, m.expected_guests, m.guaranteed_guests, m.package_id || null, m.per_plate_paise, m.rent_paise, m.setup_style, m.menu, m.setup_notes]);
  await recomputeFunction(client, tenant, userId, functionId);
};

export const removeFunction = async (client, tenant, userId, functionId) => {
  const f = (await client.query(`SELECT event_id FROM banquet_functions WHERE function_id = $1 AND branch_id = $2 FOR UPDATE`, [functionId, tenant.branchId])).rows[0];
  if (!f) throw new HotelError(404, 'Function not found');
  const e = await lockEvent(client, tenant, f.event_id);
  if (['COMPLETED', 'CANCELLED'].includes(e.status)) throw new HotelError(409, 'This event is closed');
  const left = (await client.query(`SELECT COUNT(*)::int AS n FROM banquet_functions WHERE event_id = $1`, [f.event_id])).rows[0].n;
  if (left <= 1) throw new HotelError(409, 'An event needs at least one function. Cancel the event instead.');
  await client.query(`DELETE FROM banquet_functions WHERE function_id = $1`, [functionId]);
};

/* ── charges and payments ──────────────────────────────────────────────── */

export const postCharge = async (client, tenant, userId, eventId, v) => {
  const e = await lockEvent(client, tenant, eventId);
  if (['COMPLETED', 'CANCELLED'].includes(e.status)) throw new HotelError(409, 'This event is closed');
  if (!CHARGE_CATEGORIES.includes(v.category)) throw new HotelError(400, 'Choose what the charge is for');
  if (v.function_id) {
    const ok = (await client.query(`SELECT 1 FROM banquet_functions WHERE function_id = $1 AND event_id = $2`, [v.function_id, eventId])).rowCount;
    if (!ok) throw new HotelError(400, 'That function is not part of this event');
  }
  const tax = await lineFor(client, tenant, { quantity: v.quantity, unitPricePaise: v.unit_price_paise, taxRate: v.tax_rate });
  return (await client.query(
    `INSERT INTO banquet_charges (event_id, function_id, business_id, branch_id, category, description, quantity, unit_price_paise, tax_rate, amount_paise, tax_paise, auto, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE,$12) RETURNING *`,
    [eventId, v.function_id || null, tenant.businessId, tenant.branchId, v.category, v.description, v.quantity, v.unit_price_paise, v.tax_rate, tax.taxable_paise, tax.tax_paise, userId])).rows[0];
};

export const voidCharge = async (client, tenant, userId, chargeId, reason) => {
  const c = (await client.query(`SELECT c.*, e.status FROM banquet_charges c JOIN banquet_events e ON e.event_id = c.event_id WHERE c.charge_id = $1 AND c.branch_id = $2 FOR UPDATE OF c`, [chargeId, tenant.branchId])).rows[0];
  if (!c) throw new HotelError(404, 'Charge not found');
  if (c.auto) throw new HotelError(409, 'This line comes from the function. Change the guests, package or rent on the function instead.');
  if (c.voided_at) throw new HotelError(409, 'That charge is already voided');
  if (['COMPLETED', 'CANCELLED'].includes(c.status)) throw new HotelError(409, 'This event is closed');
  await client.query(`UPDATE banquet_charges SET voided_at = CURRENT_TIMESTAMP, void_reason = $2 WHERE charge_id = $1`, [chargeId, reason]);
  return c;
};

export const addPayment = async (client, tenant, userId, eventId, v) => {
  const e = await lockEvent(client, tenant, eventId);
  const property = await getProperty(client, tenant);
  if (e.status === 'COMPLETED') throw new HotelError(409, 'This event has been invoiced, so the bill is closed');
  if (e.status === 'CANCELLED' && v.kind !== 'REFUND') throw new HotelError(409, 'This event is cancelled');
  if (v.kind === 'REFUND') {
    const t = await totalsOf(client, eventId);
    if (v.amount_paise > t.paid_paise) throw new HotelError(409, 'That is more than has been paid');
  }
  return (await client.query(
    `INSERT INTO banquet_payments (event_id, business_id, branch_id, kind, method, amount_paise, reference, pay_date, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [eventId, tenant.businessId, tenant.branchId, v.kind, v.method, v.amount_paise, v.reference || null, property.business_date, userId])).rows[0];
};

/* ── the proforma and the invoice ──────────────────────────────────────── */

/** What the organiser would be billed today, line by line with GST: the provisional proforma invoice. */
export const proforma = async (db, tenant, id) => {
  const e = await eventDetail(db, tenant, id);
  const lines = e.charges.filter((c) => !c.voided_at).map((c) => ({ description: c.description, category: c.category, quantity: Number(c.quantity), unit_price_paise: Number(c.unit_price_paise), tax_rate: Number(c.tax_rate), amount_paise: Number(c.amount_paise), tax_paise: Number(c.tax_paise), total_paise: Number(c.amount_paise) + Number(c.tax_paise) }));
  return { event_no: e.event_no, title: e.title, status: e.status, organiser: e.guest, company: e.company, functions: e.functions, lines, totals: e.totals, payments: e.payments };
};

const money2 = (paise) => (Number(paise) / 100).toFixed(2);

export const complete = async (client, tenant, userId, id, { settlement = null, refundMethod = null }) => {
  const e = await lockEvent(client, tenant, id);
  const property = await getProperty(client, tenant);
  if (e.status !== 'CONFIRMED') throw new HotelError(409, e.status === 'COMPLETED' ? 'This event has already been invoiced' : 'Only a confirmed event can be completed');
  const last = (await client.query(`SELECT MAX(event_date)::text AS d FROM banquet_functions WHERE event_id = $1`, [id])).rows[0].d;
  if (last > property.business_date) throw new HotelError(409, `The last function is on ${last}. Complete the event once it has taken place.`);
  const charges = (await client.query(`SELECT * FROM banquet_charges WHERE event_id = $1 AND voided_at IS NULL ORDER BY function_id NULLS LAST, charge_id`, [id])).rows;
  if (!charges.length) throw new HotelError(409, 'There is nothing on this event’s bill');
  const business = (await client.query(`SELECT round_off_enabled FROM businesses WHERE business_id = $1`, [tenant.businessId])).rows[0];
  let totals = await totalsOf(client, id);
  const billTotal = business.round_off_enabled ? Math.round(totals.charges_paise / 100) * 100 : totals.charges_paise;
  if (totals.paid_paise > billTotal) {
    const extra = totals.paid_paise - billTotal;
    if (!refundMethod) throw new HotelError(409, `₹${money2(extra)} more has been paid than the bill. Refund it to complete the event.`, { code: 'REFUND_DUE', data: { refund_paise: extra } });
    await client.query(`INSERT INTO banquet_payments (event_id, business_id, branch_id, kind, method, amount_paise, reference, pay_date, created_by) VALUES ($1,$2,$3,'REFUND',$4,$5,'Refund at completion',$6,$7)`, [id, tenant.businessId, tenant.branchId, refundMethod, extra, property.business_date, userId]);
    totals = await totalsOf(client, id);
  }
  const due = billTotal - totals.paid_paise;
  if (due > 0 && !settlement) throw new HotelError(409, `₹${money2(due)} is still to be paid`, { code: 'BALANCE_DUE', data: { balance_paise: due } });
  const paidBy = netByMethod((await client.query(`SELECT method, kind, amount_paise FROM banquet_payments WHERE event_id = $1`, [id])).rows);
  const payments = paidBy.map((p) => ({ method: p.method, amount: money2(p.paise), reference_number: `Event ${e.event_no}` }));
  if (due > 0) payments.push({ method: settlement.method, amount: 'REST', reference_number: settlement.reference || `Event ${e.event_no}` });
  const items = charges.map((c) => ({ description: c.description, unit_price: money2(c.unit_price_paise), quantity: Number(c.quantity), tax_rate: Number(c.tax_rate) }));
  const guest = (await client.query(`SELECT * FROM guests WHERE guest_id = $1`, [e.guest_id])).rows[0];
  let customerId = guest.customer_id;
  if (!customerId) {
    customerId = (await client.query(`INSERT INTO customers (business_id, name, phone, email, gstin, state) VALUES ($1,$2,$3,$4,$5,$6) RETURNING customer_id`, [tenant.businessId, guest.name, guest.phone || null, guest.email || null, guest.gstin || null, guest.state || null])).rows[0].customer_id;
    await client.query(`UPDATE guests SET customer_id = $2 WHERE guest_id = $1`, [guest.guest_id, customerId]);
  }
  const invoice = await createInvoiceInTransaction(client, tenant, userId, { customerId, items, payments, invoiceDate: property.business_date, notes: `Banquet event ${e.event_no}: ${e.title}` });
  await client.query(`UPDATE banquet_events SET status = 'COMPLETED', completed_on = $2, invoice_id = $3 WHERE event_id = $1`, [id, property.business_date, invoice.invoice_id]);
  return { invoice_id: invoice.invoice_id, invoice_number: invoice.invoice_number, total: invoice.total };
};

/* ── reports ───────────────────────────────────────────────────────────── */

/** Banquet revenue by function date (before GST), and how it stands: what is booked, what is paid. */
export const banquetSummary = async (db, tenant, from, to) => {
  const property = await getProperty(db, tenant);
  const byStatus = (await db.query(
    `SELECT e.status, COUNT(DISTINCT e.event_id)::int AS events, COALESCE(SUM(f.expected_guests), 0)::int AS guests
     FROM banquet_events e JOIN banquet_functions f ON f.event_id = e.event_id WHERE e.branch_id = $1 AND f.event_date >= $2 AND f.event_date <= $3 GROUP BY e.status`, [tenant.branchId, from, to])).rows;
  const revenue = (await db.query(
    `SELECT c.category, COALESCE(SUM(c.amount_paise), 0)::bigint AS revenue, COALESCE(SUM(c.tax_paise), 0)::bigint AS tax
     FROM banquet_charges c JOIN banquet_functions f ON f.function_id = c.function_id JOIN banquet_events e ON e.event_id = c.event_id
     WHERE c.branch_id = $1 AND c.voided_at IS NULL AND e.status IN ('CONFIRMED','COMPLETED') AND f.event_date >= $2 AND f.event_date <= $3 GROUP BY c.category ORDER BY 2 DESC`, [tenant.branchId, from, to])).rows;
  const halls = (await db.query(
    `SELECT h.name, COUNT(f.function_id)::int AS functions, COALESCE(SUM(COALESCE(f.guaranteed_guests, f.expected_guests)), 0)::int AS guests,
            COUNT(DISTINCT f.event_date)::int AS days_used
     FROM banquet_halls h LEFT JOIN banquet_functions f ON f.hall_id = h.hall_id AND f.event_date >= $2 AND f.event_date <= $3
       AND EXISTS (SELECT 1 FROM banquet_events e WHERE e.event_id = f.event_id AND e.status IN ('CONFIRMED','COMPLETED'))
     WHERE h.branch_id = $1 AND h.is_active GROUP BY h.hall_id, h.name ORDER BY h.name`, [tenant.branchId, from, to])).rows;
  const outstanding = (await db.query(
    `SELECT e.event_id, e.event_no, e.title, e.status, g.name AS organiser, (SELECT MIN(event_date)::text FROM banquet_functions WHERE event_id = e.event_id) AS first_date,
            COALESCE((SELECT SUM(c.amount_paise + c.tax_paise) FROM banquet_charges c WHERE c.event_id = e.event_id AND c.voided_at IS NULL), 0)::bigint AS charges,
            COALESCE((SELECT SUM(CASE WHEN p.kind = 'REFUND' THEN -p.amount_paise ELSE p.amount_paise END) FROM banquet_payments p WHERE p.event_id = e.event_id), 0)::bigint AS paid
     FROM banquet_events e JOIN guests g ON g.guest_id = e.guest_id WHERE e.branch_id = $1 AND e.status = 'CONFIRMED' ORDER BY 5`, [tenant.branchId])).rows
    .map((r) => ({ ...r, charges_paise: Number(r.charges), paid_paise: Number(r.paid), balance_paise: Number(r.charges) - Number(r.paid) })).filter((r) => r.balance_paise > 0);
  return {
    from, to, business_date: property.business_date, by_status: byStatus,
    revenue: revenue.map((r) => ({ category: r.category, revenue_paise: Number(r.revenue), tax_paise: Number(r.tax) })), total_revenue_paise: revenue.reduce((s, r) => s + Number(r.revenue), 0),
    halls, outstanding
  };
};
