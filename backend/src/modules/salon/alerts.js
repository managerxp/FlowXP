/*
 * What needs attention in salon stock: low, out of stock, negative, expiring, expired and unusual consumption.
 * One computation shared by the alerts screen, the dashboard card and the daily notification.
 */
import { getSettings } from './settings.js';
import { batchPositions } from './stock.js';

/** The full picture for the outlets in scope (`scope` = a branch id, or null for every outlet). */
export const computeAlerts = async (pool, businessId, { scope = null, today }) => {
  const settings = await getSettings(pool, businessId);
  const values = [businessId];
  // the outlet condition sits in the join, so a product that has never been stocked there still shows as out of stock
  const branchSql = scope != null ? (values.push(scope), ` AND bs.branch_id = $${values.length}`) : '';

  const levels = (await pool.query(
    `SELECT p.product_id, p.name, p.unit, p.kind, p.min_stock, COALESCE(SUM(bs.quantity), 0) AS qty,
            EXISTS (SELECT 1 FROM inventory_transactions t WHERE t.product_id = p.product_id) AS has_history
     FROM products p LEFT JOIN branch_stock bs ON bs.product_id = p.product_id${branchSql}
     WHERE p.business_id = $1 AND p.status = 'ACTIVE' AND p.track_inventory AND p.kind IN ('DISH','INGREDIENT','PACKAGING')
     GROUP BY p.product_id, p.name, p.unit, p.kind, p.min_stock`, values)).rows.map((r) => ({ ...r, qty: Number(r.qty), min_stock: Number(r.min_stock) }));
  const item = (r) => ({ product_id: r.product_id, name: r.name, unit: r.unit, stock: r.qty, min_stock: r.min_stock, kind: r.kind === 'DISH' ? 'PRODUCT' : 'CONSUMABLE' });
  const low = levels.filter((r) => r.qty > 0 && r.qty <= r.min_stock).map(item);
  const out = levels.filter((r) => r.qty === 0 && (r.min_stock > 0 || r.has_history)).map(item);
  const negative = levels.filter((r) => r.qty < 0).map(item);

  const positions = await batchPositions(pool, businessId, { branchId: scope, today });
  const live = positions.filter((b) => b.remaining > 0 && b.expiry_date);
  const expired = live.filter((b) => b.days_to_expiry < 0);
  const expiring = live.filter((b) => b.days_to_expiry >= 0 && b.days_to_expiry <= settings.expiry_alert_days);
  const batchItem = (b) => ({ batch_id: b.batch_id, product_id: b.product_id, name: b.product, unit: b.unit, batch_no: b.batch_no, expiry_date: b.expiry_date, days_to_expiry: b.days_to_expiry, remaining: b.remaining, branch: b.branch });

  // unusual consumption: the last 7 days against the weekly average of the 4 weeks before
  const cv = [businessId];
  const cBranch = scope != null ? (cv.push(scope), ` AND t.branch_id = $${cv.length}`) : '';
  cv.push(settings.consumption_alert_factor);
  const factor = cv.length;
  const usage = (await pool.query(
    `SELECT p.product_id, p.name, p.unit,
            COALESCE(SUM(-t.quantity) FILTER (WHERE t.created_at >= now() - interval '7 days'), 0) AS last7,
            COALESCE(SUM(-t.quantity) FILTER (WHERE t.created_at < now() - interval '7 days'), 0) / 4.0 AS weekly_before
     FROM inventory_transactions t JOIN products p ON p.product_id = t.product_id
     WHERE t.business_id = $1 AND t.transaction_type = 'SALE' AND t.quantity < 0 AND t.created_at >= now() - interval '35 days' AND p.kind IN ('INGREDIENT','PACKAGING','DISH')${cBranch}
     GROUP BY p.product_id, p.name, p.unit
     HAVING COALESCE(SUM(-t.quantity) FILTER (WHERE t.created_at < now() - interval '7 days'), 0) / 4.0 > 0
        AND COALESCE(SUM(-t.quantity) FILTER (WHERE t.created_at >= now() - interval '7 days'), 0) > $${factor}::numeric *
            COALESCE(SUM(-t.quantity) FILTER (WHERE t.created_at < now() - interval '7 days'), 0) / 4.0`, cv)).rows;
  const unusual = usage.map((u) => ({ product_id: u.product_id, name: u.name, unit: u.unit, last_7_days: Number(u.last7), usual_week: Math.round(Number(u.weekly_before) * 100) / 100, times_usual: Math.round((Number(u.last7) / Number(u.weekly_before)) * 10) / 10 }));

  const cap = (xs) => xs.slice(0, 50);
  return {
    counts: { low_stock: low.length, out_of_stock: out.length, expiring_soon: expiring.length, expired: expired.length, negative_stock: negative.length, unusual_consumption: unusual.length },
    low_stock: cap(low), out_of_stock: cap(out), negative_stock: cap(negative), expiring_soon: cap(expiring.map(batchItem)), expired: cap(expired.map(batchItem)), unusual_consumption: cap(unusual),
    settings: { expiry_alert_days: settings.expiry_alert_days, consumption_alert_factor: settings.consumption_alert_factor }
  };
};

/** Just the counts the daily notification needs. */
export const alertCounts = async (pool, businessId, today) => {
  const a = await computeAlerts(pool, businessId, { scope: null, today });
  return { low: a.counts.low_stock, out: a.counts.out_of_stock, expiring: a.counts.expiring_soon, expired: a.counts.expired };
};
