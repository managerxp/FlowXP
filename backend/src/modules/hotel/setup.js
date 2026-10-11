/*
 * Hotel set-up: the property's settings, room types, rooms, rate plans, seasonal rates and rooms taken out of sale.
 * Every function takes a pg client or pool, the tenant ({ businessId, branchId }) and plain values already checked by the controller.
 */
import { HotelError, getProperty, MEAL_PLANS } from './common.js';

/* ── property settings ─────────────────────────────────────────────────── */

export const settingsOf = async (db, tenant) => {
  const p = await getProperty(db, tenant);
  const counts = (await db.query(
    `SELECT (SELECT COUNT(*) FROM rooms WHERE branch_id = $1 AND is_active)::int AS rooms,
            (SELECT COUNT(*) FROM room_types WHERE branch_id = $1 AND is_active)::int AS room_types,
            (SELECT COUNT(*) FROM hotel_night_audits WHERE branch_id = $1)::int AS audits`, [tenant.branchId])).rows[0];
  return { ...p, ...counts };
};

export const updateSettings = async (db, tenant, v) => {
  const before = await settingsOf(db, tenant);
  const sets = []; const args = [tenant.branchId];
  const put = (col, val) => { if (val !== undefined) { args.push(val); sets.push(`${col} = $${args.length}`); } };
  put('check_in_time', v.check_in_time ?? undefined);
  put('check_out_time', v.check_out_time ?? undefined);
  put('tax_threshold_paise', v.tax_threshold_paise ?? undefined);
  put('tax_low_pct', v.tax_low_pct ?? undefined);
  put('tax_high_pct', v.tax_high_pct ?? undefined);
  put('allow_overbooking', v.allow_overbooking ?? undefined);
  put('res_prefix', v.res_prefix ?? undefined);
  if (v.business_date) {
    // the hotel's date can be set only before the first night audit; after that, only night audit moves it
    if (before.audits > 0) throw new HotelError(409, 'The business date moves on only when you run night audit');
    put('business_date', v.business_date);
  }
  if (sets.length) await db.query(`UPDATE hotel_properties SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE branch_id = $1`, args);
  return { before, after: await settingsOf(db, tenant) };
};

/* ── room types ────────────────────────────────────────────────────────── */

export const listRoomTypes = async (db, tenant, { includeInactive = false } = {}) =>
  (await db.query(
    `SELECT t.*, COALESCE(r.n, 0)::int AS room_count
     FROM room_types t
     LEFT JOIN (SELECT room_type_id, COUNT(*) AS n FROM rooms WHERE is_active GROUP BY room_type_id) r ON r.room_type_id = t.room_type_id
     WHERE t.branch_id = $1 ${includeInactive ? '' : 'AND t.is_active'} ORDER BY t.sort_order, t.name`, [tenant.branchId])).rows;

const ensureDefaultPlan = async (db, tenant) => {
  const has = (await db.query(`SELECT 1 FROM rate_plans WHERE branch_id = $1 LIMIT 1`, [tenant.branchId])).rowCount;
  if (!has) await db.query(`INSERT INTO rate_plans (business_id, branch_id, name, code, meal_plan, is_default) VALUES ($1,$2,'Room only','EP','EP',TRUE)`, [tenant.businessId, tenant.branchId]);
};

export const createRoomType = async (db, tenant, v) => {
  await getProperty(db, tenant);
  const { rows } = await db.query(
    `INSERT INTO room_types (business_id, branch_id, name, code, description, base_rate_paise, extra_adult_paise, extra_child_paise, base_adults, max_adults, max_children, amenities, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [tenant.businessId, tenant.branchId, v.name, v.code, v.description, v.base_rate_paise, v.extra_adult_paise, v.extra_child_paise, v.base_adults, v.max_adults, v.max_children, v.amenities, v.sort_order]);
  await ensureDefaultPlan(db, tenant);
  return rows[0];
};

export const updateRoomType = async (db, tenant, id, v) => {
  const before = (await db.query(`SELECT * FROM room_types WHERE room_type_id = $1 AND branch_id = $2 FOR UPDATE`, [id, tenant.branchId])).rows[0];
  if (!before) throw new HotelError(404, 'Room type not found');
  const merged = { ...before, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) };
  if (merged.max_adults < merged.base_adults) throw new HotelError(400, 'The most adults cannot be fewer than the adults the rate includes');
  const { rows } = await db.query(
    `UPDATE room_types SET name=$3, code=$4, description=$5, base_rate_paise=$6, extra_adult_paise=$7, extra_child_paise=$8, base_adults=$9, max_adults=$10, max_children=$11, amenities=$12, sort_order=$13, is_active=$14
     WHERE room_type_id=$1 AND branch_id=$2 RETURNING *`,
    [id, tenant.branchId, merged.name, merged.code, merged.description, merged.base_rate_paise, merged.extra_adult_paise, merged.extra_child_paise, merged.base_adults, merged.max_adults, merged.max_children, merged.amenities, merged.sort_order, merged.is_active]);
  return { before, after: rows[0] };
};

export const archiveRoomType = async (db, tenant, id) => {
  const live = (await db.query(`SELECT 1 FROM rooms WHERE room_type_id = $1 AND is_active LIMIT 1`, [id])).rowCount;
  if (live) throw new HotelError(409, 'Move or remove the rooms of this type first');
  const future = (await db.query(`SELECT 1 FROM hotel_booking_rooms WHERE room_type_id = $1 AND status IN ('RESERVED','IN_HOUSE') LIMIT 1`, [id])).rowCount;
  if (future) throw new HotelError(409, 'There are bookings for this room type');
  const { rowCount } = await db.query(`UPDATE room_types SET is_active = FALSE WHERE room_type_id = $1 AND branch_id = $2`, [id, tenant.branchId]);
  if (!rowCount) throw new HotelError(404, 'Room type not found');
};

/* ── rooms ─────────────────────────────────────────────────────────────── */

export const listRooms = async (db, tenant, { includeInactive = false } = {}) =>
  (await db.query(
    `SELECT r.*, t.name AS room_type, t.code AS room_type_code
     FROM rooms r JOIN room_types t ON t.room_type_id = r.room_type_id
     WHERE r.branch_id = $1 ${includeInactive ? '' : 'AND r.is_active'}
     ORDER BY NULLIF(regexp_replace(r.room_no, '\\D', '', 'g'), '')::int NULLS LAST, r.room_no`, [tenant.branchId])).rows;

const typeInBranch = async (db, tenant, id) => {
  const t = (await db.query(`SELECT room_type_id FROM room_types WHERE room_type_id = $1 AND branch_id = $2 AND is_active`, [id, tenant.branchId])).rows[0];
  if (!t) throw new HotelError(400, 'Choose a room type');
};

export const createRoom = async (db, tenant, v) => {
  await typeInBranch(db, tenant, v.room_type_id);
  const { rows } = await db.query(
    `INSERT INTO rooms (business_id, branch_id, room_type_id, room_no, floor) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [tenant.businessId, tenant.branchId, v.room_type_id, v.room_no, v.floor]);
  return rows[0];
};

/** Many rooms at once: numbers from..to (101 to 110) of one type on one floor. */
export const createRooms = async (db, tenant, { room_type_id, from, to, floor, prefix = '' }) => {
  await typeInBranch(db, tenant, room_type_id);
  if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) throw new HotelError(400, 'Enter the first and last room number');
  if (to - from >= 200) throw new HotelError(400, 'Add up to 200 rooms at a time');
  const made = [];
  for (let n = from; n <= to; n++) {
    const { rows } = await db.query(
      `INSERT INTO rooms (business_id, branch_id, room_type_id, room_no, floor) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (branch_id, room_no) DO NOTHING RETURNING *`,
      [tenant.businessId, tenant.branchId, room_type_id, `${prefix}${n}`, floor]);
    if (rows[0]) made.push(rows[0]);
  }
  return made;
};

export const updateRoom = async (db, tenant, id, v) => {
  const before = (await db.query(`SELECT * FROM rooms WHERE room_id = $1 AND branch_id = $2 FOR UPDATE`, [id, tenant.branchId])).rows[0];
  if (!before) throw new HotelError(404, 'Room not found');
  if (v.room_type_id !== undefined && v.room_type_id !== before.room_type_id) await typeInBranch(db, tenant, v.room_type_id);
  if (v.is_active === false) {
    const busy = (await db.query(`SELECT 1 FROM hotel_booking_rooms WHERE room_id = $1 AND status IN ('RESERVED','IN_HOUSE') LIMIT 1`, [id])).rowCount;
    if (busy) throw new HotelError(409, 'A guest is booked into this room');
  }
  const m = { ...before, ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) };
  const { rows } = await db.query(
    `UPDATE rooms SET room_no=$3, floor=$4, room_type_id=$5, is_active=$6 WHERE room_id=$1 AND branch_id=$2 RETURNING *`,
    [id, tenant.branchId, m.room_no, m.floor, m.room_type_id, m.is_active]);
  return { before, after: rows[0] };
};

/* ── rate plans, their rates, seasonal rates ───────────────────────────── */

export const listRatePlans = async (db, tenant) => {
  const plans = (await db.query(`SELECT * FROM rate_plans WHERE branch_id = $1 AND is_active ORDER BY is_default DESC, name`, [tenant.branchId])).rows;
  const rates = (await db.query(`SELECT rpr.* FROM rate_plan_rates rpr JOIN rate_plans p ON p.rate_plan_id = rpr.rate_plan_id WHERE p.branch_id = $1`, [tenant.branchId])).rows;
  return plans.map((p) => ({ ...p, rates: Object.fromEntries(rates.filter((r) => r.rate_plan_id === p.rate_plan_id).map((r) => [r.room_type_id, Number(r.rate_paise)])) }));
};

export const saveRatePlan = async (db, tenant, id, v) => {
  if (!MEAL_PLANS.includes(v.meal_plan)) throw new HotelError(400, 'Choose a meal plan');
  let plan;
  if (id) {
    plan = (await db.query(`UPDATE rate_plans SET name=$3, code=$4, meal_plan=$5 WHERE rate_plan_id=$1 AND branch_id=$2 RETURNING *`, [id, tenant.branchId, v.name, v.code, v.meal_plan])).rows[0];
    if (!plan) throw new HotelError(404, 'Rate plan not found');
  } else {
    plan = (await db.query(`INSERT INTO rate_plans (business_id, branch_id, name, code, meal_plan) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [tenant.businessId, tenant.branchId, v.name, v.code, v.meal_plan])).rows[0];
  }
  if (v.is_default) {
    await db.query(`UPDATE rate_plans SET is_default = (rate_plan_id = $2) WHERE branch_id = $1`, [tenant.branchId, plan.rate_plan_id]);
  }
  for (const [typeId, paise] of Object.entries(v.rates || {})) {
    await typeInBranch(db, tenant, Number(typeId));
    if (paise == null) await db.query(`DELETE FROM rate_plan_rates WHERE rate_plan_id = $1 AND room_type_id = $2`, [plan.rate_plan_id, Number(typeId)]);
    else await db.query(`INSERT INTO rate_plan_rates (rate_plan_id, room_type_id, rate_paise) VALUES ($1,$2,$3) ON CONFLICT (rate_plan_id, room_type_id) DO UPDATE SET rate_paise = EXCLUDED.rate_paise`, [plan.rate_plan_id, Number(typeId), paise]);
  }
  return plan;
};

export const archiveRatePlan = async (db, tenant, id) => {
  const p = (await db.query(`SELECT is_default FROM rate_plans WHERE rate_plan_id = $1 AND branch_id = $2`, [id, tenant.branchId])).rows[0];
  if (!p) throw new HotelError(404, 'Rate plan not found');
  if (p.is_default) throw new HotelError(409, 'Choose another default plan first');
  await db.query(`UPDATE rate_plans SET is_active = FALSE WHERE rate_plan_id = $1`, [id]);
};

export const listOverrides = async (db, tenant) =>
  (await db.query(
    `SELECT o.*, t.name AS room_type, p.name AS rate_plan FROM rate_overrides o JOIN room_types t ON t.room_type_id = o.room_type_id
     LEFT JOIN rate_plans p ON p.rate_plan_id = o.rate_plan_id WHERE o.branch_id = $1 ORDER BY o.from_date DESC, o.override_id DESC`, [tenant.branchId])).rows;

export const createOverride = async (db, tenant, v) => {
  await typeInBranch(db, tenant, v.room_type_id);
  if (v.rate_plan_id) {
    const ok = (await db.query(`SELECT 1 FROM rate_plans WHERE rate_plan_id = $1 AND branch_id = $2`, [v.rate_plan_id, tenant.branchId])).rowCount;
    if (!ok) throw new HotelError(400, 'Rate plan not found');
  }
  return (await db.query(
    `INSERT INTO rate_overrides (business_id, branch_id, room_type_id, rate_plan_id, name, from_date, to_date, days_of_week, rate_paise)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [tenant.businessId, tenant.branchId, v.room_type_id, v.rate_plan_id || null, v.name, v.from_date, v.to_date, v.days_of_week?.length ? v.days_of_week : null, v.rate_paise])).rows[0];
};

export const deleteOverride = async (db, tenant, id) => {
  const { rowCount } = await db.query(`DELETE FROM rate_overrides WHERE override_id = $1 AND branch_id = $2`, [id, tenant.branchId]);
  if (!rowCount) throw new HotelError(404, 'Seasonal rate not found');
};

/* ── rooms taken out of sale ───────────────────────────────────────────── */

export const listBlocks = async (db, tenant) =>
  (await db.query(`SELECT b.*, r.room_no FROM room_blocks b JOIN rooms r ON r.room_id = b.room_id WHERE b.branch_id = $1 AND b.to_date >= (SELECT business_date FROM hotel_properties WHERE branch_id = $1) ORDER BY b.from_date`, [tenant.branchId])).rows;

export const createBlock = async (db, tenant, userId, v) => {
  const room = (await db.query(`SELECT room_id FROM rooms WHERE room_id = $1 AND branch_id = $2 AND is_active`, [v.room_id, tenant.branchId])).rows[0];
  if (!room) throw new HotelError(400, 'Room not found');
  const clash = (await db.query(
    `SELECT 1 FROM hotel_booking_rooms WHERE room_id = $1 AND status IN ('RESERVED','IN_HOUSE') AND arrival < $3 AND departure > $2 LIMIT 1`, [v.room_id, v.from_date, v.to_date])).rowCount;
  if (clash) throw new HotelError(409, 'A guest is booked into this room on those dates. Move them first.');
  return (await db.query(
    `INSERT INTO room_blocks (business_id, branch_id, room_id, from_date, to_date, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [tenant.businessId, tenant.branchId, v.room_id, v.from_date, v.to_date, v.reason, userId])).rows[0];
};

export const deleteBlock = async (db, tenant, id) => {
  const { rowCount } = await db.query(`DELETE FROM room_blocks WHERE block_id = $1 AND branch_id = $2`, [id, tenant.branchId]);
  if (!rowCount) throw new HotelError(404, 'Not found');
};
