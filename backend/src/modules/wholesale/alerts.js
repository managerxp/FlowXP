/*
 * The counts behind the wholesale stock alerts — shared by the inventory screen, the dashboard and the scheduled
 * scan that notifies the team, so all three always tell the same story.
 */
import { getSettings } from './common.js';

export const stockAlertCounts = async (db, { businessId, branchIds, settings = null }) => {
  const s = settings || await getSettings(db, businessId);
  const q = async (sql, extra = []) => Number((await db.query(sql, [businessId, branchIds, ...extra])).rows[0].n);
  const stocked = `FROM products p WHERE p.business_id = $1 AND p.status = 'ACTIVE' AND p.track_inventory AND p.kind IN ('DISH','INGREDIENT','PACKAGING')`;
  const onHand = `COALESCE((SELECT SUM(quantity) FROM branch_stock WHERE product_id = p.product_id AND branch_id = ANY($2::int[])), 0)`;
  const avail = `COALESCE((SELECT SUM(quantity - reserved_qty) FROM branch_stock WHERE product_id = p.product_id AND branch_id = ANY($2::int[])), 0)`;
  const sold = (days) => `EXISTS (SELECT 1 FROM inventory_transactions t WHERE t.product_id = p.product_id AND t.transaction_type = 'SALE' AND t.created_at > CURRENT_TIMESTAMP - make_interval(days => ${Number(days) | 0}))`;
  return {
    low_stock: await q(`SELECT COUNT(*) AS n ${stocked} AND p.min_stock > 0 AND ${avail} <= p.min_stock AND ${onHand} > 0`),
    out_of_stock: await q(`SELECT COUNT(*) AS n ${stocked} AND ${onHand} <= 0 AND EXISTS (SELECT 1 FROM branch_stock WHERE product_id = p.product_id)`),
    overstock: await q(`SELECT COUNT(*) AS n ${stocked} AND EXISTS (SELECT 1 FROM wholesale_item_details d WHERE d.product_id = p.product_id AND d.max_stock IS NOT NULL AND ${onHand} > d.max_stock)`),
    expired: await q(`SELECT COUNT(*) AS n FROM wholesale_batches WHERE business_id = $1 AND branch_id = ANY($2::int[]) AND qty_on_hand > 0 AND expiry_date < CURRENT_DATE`),
    expiring: await q(`SELECT COUNT(*) AS n FROM wholesale_batches WHERE business_id = $1 AND branch_id = ANY($2::int[]) AND qty_on_hand > 0 AND expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + $3::int`, [s.expiry_alert_days.at(-1) ?? 90]),
    slow_moving: await q(`SELECT COUNT(*) AS n ${stocked} AND ${onHand} > 0 AND NOT ${sold(s.slow_moving_days)} AND ${sold(s.dead_stock_days)}`),
    dead_stock: await q(`SELECT COUNT(*) AS n ${stocked} AND ${onHand} > 0 AND NOT ${sold(s.dead_stock_days)}`),
    damaged_units: Number((await db.query(`SELECT COALESCE(SUM(qty), 0) AS n FROM wholesale_damaged_log WHERE business_id = $1 AND branch_id = ANY($2::int[])`, [businessId, branchIds])).rows[0].n),
    in_transit_transfers: await q(`SELECT COUNT(*) AS n FROM wholesale_transfers WHERE business_id = $1 AND status = 'IN_TRANSIT' AND (to_branch_id = ANY($2::int[]) OR from_branch_id = ANY($2::int[]))`)
  };
};
