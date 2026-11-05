/*
 * The vehicle master: every garage picks a brand and model from the same platform list, filtered to what the garage repairs (bikes, cars or both). Older and discontinued models
 * are included (a customer brings a 2008 car); models that are only announced ("upcoming") stay out unless asked for. The master is never forced: a garage can type any vehicle.
 */
import { vehicleTypesFor } from './types.js';

const like = (s) => `%${String(s).replace(/[\\%_]/g, '\\$&')}%`;

/** Which vehicle types to show: the garage's kind unless the caller narrows it to one that the kind allows. */
export const allowedTypes = (tenant, wanted) => {
  const own = vehicleTypesFor(tenant.garageKind);
  const w = String(wanted ?? '').toUpperCase();
  return own.includes(w) ? [w] : own;
};

/** Brands (with how many models each), or, given a brand, its models with the fuels each comes in. */
export const lookup = async (db, tenant, q = {}) => {
  const types = allowedTypes(tenant, q.type);
  const params = [types];
  const where = ['vehicle_type = ANY($1::text[])'];
  if (String(q.upcoming) !== '1') where.push(`availability <> 'UPCOMING'`);
  if (q.search) { params.push(like(String(q.search).trim().slice(0, 60))); where.push(`(brand ILIKE $${params.length} OR model ILIKE $${params.length})`); }
  if (!q.brand) {
    const rows = (await db.query(
      `SELECT brand, vehicle_type, COUNT(DISTINCT model)::int AS models FROM vehicle_master WHERE ${where.join(' AND ')} GROUP BY brand, vehicle_type ORDER BY brand, vehicle_type`, params)).rows;
    return { types, brands: rows };
  }
  params.push(String(q.brand).trim());
  where.push(`lower(brand) = lower($${params.length})`);
  const rows = (await db.query(
    `SELECT model, vehicle_type, MIN(body_type) AS body_type, array_agg(DISTINCT fuel_type ORDER BY fuel_type) AS fuels,
            CASE WHEN bool_or(availability = 'CURRENT') THEN 'CURRENT' WHEN bool_or(availability = 'DISCONTINUED') THEN 'DISCONTINUED' ELSE 'UPCOMING' END AS availability, MIN(intro_year) AS intro_year
       FROM vehicle_master WHERE ${where.join(' AND ')} GROUP BY model, vehicle_type ORDER BY model LIMIT 500`, params)).rows;
  return { types, brand: String(q.brand).trim(), models: rows };
};
