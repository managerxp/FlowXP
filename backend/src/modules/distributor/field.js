/*
 * What a field order remembers about where it came from: the retailer's territory, the beat, the visit that produced
 * it, and whether it was taken in the office or in the field. Kept next to the order so secondary-sales reports can
 * group by territory, beat and salesperson without guessing from the customer's current assignment.
 */
import pool from '../../config/database.js';
import { WholesaleError, int, oneOf } from '../wholesale/common.js';

export const fieldContext = async (req, b, customer) => {
  const businessId = req.tenant.businessId;
  const profile = (await pool.query(`SELECT territory_id FROM wholesale_customer_profiles WHERE customer_id = $1`, [customer.customer_id])).rows[0] || {};
  let visit = null;
  const visitId = int(b.visit_id, 'Visit', { min: 1 });
  if (visitId) {
    visit = (await pool.query(`SELECT visit_id, customer_id, beat_id FROM dist_visits WHERE business_id = $1 AND visit_id = $2`, [businessId, visitId])).rows[0];
    if (!visit) throw new WholesaleError(400, 'That visit was not found');
    if (visit.customer_id !== customer.customer_id) throw new WholesaleError(400, 'That visit was to a different retailer');
  }
  let beatId = visit?.beat_id ?? null;
  if ('beat_id' in b) {
    beatId = int(b.beat_id, 'Beat', { min: 1 });
    if (beatId && !(await pool.query(`SELECT 1 FROM dist_beats WHERE business_id = $1 AND beat_id = $2`, [businessId, beatId])).rowCount) throw new WholesaleError(400, 'That beat was not found');
  }
  const source = 'source' in b ? oneOf(b.source, 'Source', ['OFFICE', 'FIELD'], { required: true }) : (req.tenant.role === 'FIELD_SALES' ? 'FIELD' : 'OFFICE');
  return { territory_id: profile.territory_id ?? null, beat_id: beatId, visit_id: visit?.visit_id ?? null, source };
};
