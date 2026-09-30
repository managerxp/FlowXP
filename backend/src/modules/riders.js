/*
 * Who can be a delivery order's rider: an active team member who works the
 * floor (not kitchen or stock-only roles) and whose outlet is this one, or
 * who is not pinned. The exact mirror of modules/waiters.js — a small team
 * often has the same person waiting tables and running deliveries, so this
 * stays as lenient about role as the waiter picker already is, just ordered
 * to put DELIVERY-role people first.
 */
const FLOOR_ROLES_SQL = `bu.role NOT IN ('KITCHEN','INVENTORY_MANAGER')`;

export const eligibleRiders = async (db, businessId, branchId) => (await db.query(
  `SELECT u.user_id, u.name, bu.role FROM business_users bu JOIN users u ON u.user_id = bu.user_id
   WHERE bu.business_id = $1 AND bu.status = 'ACTIVE' AND ${FLOOR_ROLES_SQL} AND (bu.branch_id IS NULL OR bu.branch_id = $2)
   ORDER BY (bu.role = 'DELIVERY') DESC, u.name`,
  [businessId, branchId]
)).rows;

export const isEligibleRider = async (db, businessId, branchId, userId) => (await db.query(
  `SELECT 1 FROM business_users bu WHERE bu.business_id = $1 AND bu.user_id = $2 AND bu.status = 'ACTIVE'
     AND ${FLOOR_ROLES_SQL} AND (bu.branch_id IS NULL OR bu.branch_id = $3)`,
  [businessId, userId, branchId]
)).rows.length > 0;
