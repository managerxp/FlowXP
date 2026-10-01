/*
 * Shared plumbing for the distributor module. It sits on the wholesale module (same errors, validators, number
 * series, settings and audit), adds the gate that keeps distributor routes for distributors, and the territory
 * helpers every report and filter uses.
 */
import pool from '../../config/database.js';
export * from '../wholesale/common.js';
import { WholesaleError } from '../wholesale/common.js';

/**
 * Distributor routes exist for a DISTRIBUTOR business, and for a WHOLESALE business that switched
 * "Wholesale + Distributor" on in settings. Anyone else gets the answer a missing route gives.
 */
export const distributorOn = async (req, res, next) => {
  try {
    if (req.tenant?.businessType === 'DISTRIBUTOR') return next();
    if (req.tenant?.businessType === 'WHOLESALE') {
      const row = (await pool.query(`SELECT distributor_enabled FROM wholesale_settings WHERE business_id = $1`, [req.tenant.businessId])).rows[0];
      if (row?.distributor_enabled) return next();
    }
    return res.status(404).json({ success: false, message: 'Not found' });
  } catch (error) { next(error); }
};

/** A territory node and everything under it (the ids a "this territory" filter means). */
export const territoryScope = async (db, businessId, territoryId) => {
  const { rows } = await db.query(
    `WITH RECURSIVE t AS (
       SELECT territory_id FROM dist_territories WHERE business_id = $1 AND territory_id = $2
       UNION ALL
       SELECT c.territory_id FROM dist_territories c JOIN t ON c.parent_id = t.territory_id WHERE c.business_id = $1
     ) SELECT territory_id FROM t`, [businessId, territoryId]);
  return rows.map((r) => r.territory_id);
};

/** region / territory / area names for a customer's territory node, as SQL joined on `node` (an alias of dist_territories) */
export const TERRITORY_PATH_JOINS = (nodeCol) => `
  LEFT JOIN dist_territories ta ON ta.territory_id = ${nodeCol}
  LEFT JOIN dist_territories tt ON tt.territory_id = CASE WHEN ta.level = 'AREA' THEN ta.parent_id WHEN ta.level = 'TERRITORY' THEN ta.territory_id END
  LEFT JOIN dist_territories tr ON tr.territory_id = CASE WHEN ta.level = 'REGION' THEN ta.territory_id WHEN tt.level = 'TERRITORY' THEN tt.parent_id END`;

export const mustExist = async (db, businessId, table, idCol, id, label) => {
  if (id == null) return;
  if (!(await db.query(`SELECT 1 FROM ${table} WHERE business_id = $1 AND ${idCol} = $2`, [businessId, id])).rowCount) throw new WholesaleError(400, `${label} was not found`);
};
