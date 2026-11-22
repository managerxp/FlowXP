/*
 * The two shelves the till shows beside the categories, the same on the web and on the phone:
 *   Popular  the products that really sell here: most units over the last 60 days, and only those sold on several different bills.
 *            Nothing is typed in; it follows the sales (this outlet's, when the person is pinned to one).
 *   Offers   every product an offer is running on right now: named in the offer, or in a category the offer covers, or in a mix bundle.
 *            Each carries a short label ("10% off", "Buy 2 get 1 free", "3 for ₹100") for the tile.
 * Both are lists of product ids; the screens ask the ordinary product list for those ids, so search, paging and stock all work the same.
 */
import pool from '../config/database.js';
import { activePromotions } from './promotions.js';
import { businessNow } from '../utils/dates.js';

const inr = (paise) => `₹${(Number(paise) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** The words on an offer's badge. */
export const offerLabel = (p) => {
  const who = p.members_only ? ' (members)' : '';
  if (p.kind === 'PERCENT_OFF') return `${Number(p.percent)}% off${Number(p.min_qty) > 1 ? ` from ${Number(p.min_qty)}` : ''}${who}`;
  if (p.kind === 'BUY_X_GET_Y') return `Buy ${p.buy_qty} get ${p.get_qty} free${who}`;
  if (p.kind === 'BUNDLE_PRICE') return `${p.bundle_qty} for ${inr(p.bundle_price_paise)}${who}`;
  if (p.kind === 'MIX_BUNDLE') return `Any ${p.bundle_qty} for ${inr(p.bundle_price_paise)}${who}`;
  return 'Offer';
};

/** Map(product_id -> label) of the products with an offer on right now. Only products still on sale are listed. */
export const offerMap = async (tenant, db = pool) => {
  const promos = await activePromotions(db, tenant.businessId, await businessNow(tenant.businessId, db));
  const out = new Map();
  if (!promos.length) return out;
  const direct = new Map();                                   // product_id -> label (named by an offer)
  const categories = new Map();                               // category_id -> label
  for (const p of promos) {
    const label = offerLabel(p);
    for (const id of [p.product_id, ...(p.product_ids || [])]) if (id && !direct.has(id)) direct.set(id, label);
    if (p.category_id && !categories.has(p.category_id)) categories.set(p.category_id, label);
  }
  const rows = (await db.query(
    `SELECT product_id, category_id FROM products WHERE business_id = $1 AND status = 'ACTIVE' AND kind NOT IN ('SERVICE','INGREDIENT','PACKAGING')
        AND (product_id = ANY($2::int[]) OR category_id = ANY($3::int[]))`, [tenant.businessId, [...direct.keys()], [...categories.keys()]])).rows;
  for (const r of rows) out.set(r.product_id, direct.get(r.product_id) ?? categories.get(r.category_id));
  return out;
};

/** Product ids, best sellers first: units sold in the last `days` days on at least `minBills` different bills. */
export const popularIds = async (tenant, { days = 60, limit = 24, minBills = 3, db = pool } = {}) => {
  const p = [tenant.businessId, days, minBills, limit];
  const scope = tenant.scopeBranchId != null ? (p.push(tenant.scopeBranchId), ` AND i.branch_id = $${p.length}`) : '';
  return (await db.query(
    `SELECT it.product_id FROM invoice_items it JOIN invoices i ON i.invoice_id = it.invoice_id JOIN products pr ON pr.product_id = it.product_id
      WHERE i.business_id = $1 AND i.status <> 'CANCELLED' AND i.invoice_date >= CURRENT_DATE - $2::int AND it.product_id IS NOT NULL
        AND pr.status = 'ACTIVE' AND pr.kind NOT IN ('SERVICE','INGREDIENT','PACKAGING')${scope}
      GROUP BY it.product_id HAVING COUNT(DISTINCT i.invoice_id) >= $3::int ORDER BY SUM(it.quantity) DESC, it.product_id LIMIT $4::int`, p)).rows.map((r) => r.product_id);
};
