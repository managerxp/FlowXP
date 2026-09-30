/*
 * Who may see what inside the salon module, beyond the plain permission checks.
 *
 * A STYLIST holds only the 'appointments' permission, and even that is narrowed: they see the appointments
 * booked with them and their own staff profile. The link is salon_staff.user_id (set when the owner connects
 * a team member to a FlowXP login).
 */
import { hasPermission } from '../../middleware/auth.js';

/**
 * The staff_id a STYLIST is limited to, -1 when a stylist has no staff profile (sees nothing), or null when
 * the caller is not a stylist and sees everything their permissions allow.
 */
export const ownStaffId = async (db, tenant, userId) => {
  if (tenant.role !== 'STYLIST') return null;
  const row = (await db.query(
    `SELECT staff_id FROM salon_staff WHERE business_id = $1 AND user_id = $2 AND status = 'ACTIVE'`, [tenant.businessId, userId]
  )).rows[0];
  return row ? row.staff_id : -1;
};

/** Commission rates and payouts are visible to people who manage the team, not to everyone who can book. */
export const canSeeCommission = (tenant) => hasPermission(tenant, 'staff_commission');
