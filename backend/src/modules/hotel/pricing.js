/*
 * What a night costs. For one room type on one date the rate is, in order:
 *   1. a seasonal rate for that room type and the chosen rate plan that covers the date (and the weekday, if it names weekdays)
 *   2. a seasonal rate for that room type that is for every plan
 *   3. the rate plan's own rate for the room type
 *   4. the room type's rack rate
 * The newest seasonal rate wins when two cover the same date. Extra adults and children over what the rate includes are added on top.
 * Rates are before GST.
 */
import { HotelError, nightsOf, weekday } from './common.js';

const loadFor = async (db, { branchId, roomTypeId, ratePlanId, arrival, departure }) => {
  const type = (await db.query(`SELECT * FROM room_types WHERE room_type_id = $1 AND branch_id = $2`, [roomTypeId, branchId])).rows[0];
  if (!type) throw new HotelError(400, 'Room type not found');
  const planRate = ratePlanId
    ? (await db.query(`SELECT rate_paise FROM rate_plan_rates WHERE rate_plan_id = $1 AND room_type_id = $2`, [ratePlanId, roomTypeId])).rows[0]
    : null;
  const overrides = (await db.query(
    `SELECT * FROM rate_overrides WHERE branch_id = $1 AND room_type_id = $2 AND (rate_plan_id IS NULL OR rate_plan_id = $3) AND from_date < $5 AND to_date >= $4 ORDER BY override_id DESC`,
    [branchId, roomTypeId, ratePlanId || null, arrival, departure])).rows;
  return { type, planRate, overrides };
};

const rateOn = (date, { type, planRate, overrides }, ratePlanId) => {
  const dow = weekday(date);
  const hits = overrides.filter((o) => String(o.from_date).slice(0, 10) <= date && date <= String(o.to_date).slice(0, 10) && (!o.days_of_week || o.days_of_week.includes(dow)));
  const specific = hits.find((o) => ratePlanId && o.rate_plan_id === ratePlanId);
  const general = hits.find((o) => o.rate_plan_id == null);
  const hit = specific || general;
  if (hit) return { rate: Number(hit.rate_paise), basis: hit.name || 'Seasonal rate' };
  if (planRate) return { rate: Number(planRate.rate_paise), basis: 'Rate plan' };
  return { rate: Number(type.base_rate_paise), basis: 'Rack rate' };
};

/** The per-night extra for people beyond what the rate includes. */
export const extrasFor = (type, adults, children) => {
  const extraAdults = Math.max(0, adults - Number(type.base_adults));
  return extraAdults * Number(type.extra_adult_paise) + children * Number(type.extra_child_paise);
};

/** A quote for a stay: each night's rate (with the extra-person charge in it) and the total before GST. */
export const quoteStay = async (db, { branchId, roomTypeId, ratePlanId = null, arrival, departure, adults = 1, children = 0 }) => {
  const data = await loadFor(db, { branchId, roomTypeId, ratePlanId, arrival, departure });
  if (adults > data.type.max_adults) throw new HotelError(400, `${data.type.name} takes ${data.type.max_adults} adult${data.type.max_adults === 1 ? '' : 's'} at most`);
  if (children > data.type.max_children) throw new HotelError(400, `${data.type.name} takes ${data.type.max_children} child${data.type.max_children === 1 ? '' : 'ren'} at most`);
  const extra = extrasFor(data.type, adults, children);
  const nights = nightsOf(arrival, departure).map((date) => {
    const { rate, basis } = rateOn(date, data, ratePlanId);
    return { date, rate_paise: rate + extra, basis };
  });
  return { room_type: data.type.name, nights, total_paise: nights.reduce((s, n) => s + n.rate_paise, 0) };
};
