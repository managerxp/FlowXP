/*
 * Which kitchen station cooks a dish at a given outlet.
 *
 * A dish is routed to a station (products.station_id). Stations may belong to one outlet or to all of them, and
 * outlets can each have their own "Grill". So the dish's station is read as a NAME: at an outlet, use that
 * station if it applies there, otherwise the outlet's own station with the same name, otherwise none (the ticket
 * shows it under the general kitchen).
 */
export const resolveStation = async (db, businessId, branchId, stationId) => {
  if (!stationId) return null;
  const s = (await db.query(`SELECT station_id, name, branch_id, is_active FROM kitchen_stations WHERE station_id = $1 AND business_id = $2`, [stationId, businessId])).rows[0];
  if (!s) return null;
  if (s.is_active && (s.branch_id == null || s.branch_id === branchId)) return s.station_id;
  // routed to another outlet's station: this outlet's station of the same name, if it has one (its own before a shared one)
  const same = (await db.query(
    `SELECT station_id FROM kitchen_stations
     WHERE business_id = $1 AND is_active AND lower(name) = lower($2) AND (branch_id = $3 OR branch_id IS NULL)
     ORDER BY (branch_id IS NULL) LIMIT 1`, [businessId, s.name, branchId])).rows[0];
  return same?.station_id ?? null;
};

/** SQL condition: stations that apply at the outlet in scope (all of them when viewing every outlet). */
export const stationScope = (tenant, column, params) => {
  if (tenant.scopeBranchId == null) return '';
  params.push(tenant.scopeBranchId);
  return ` AND (${column} IS NULL OR ${column} = $${params.length})`;
};
