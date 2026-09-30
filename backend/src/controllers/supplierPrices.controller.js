/*
 * Supplier price lists: what each supplier charges for each product (and their minimum order and lead time).
 * A price fills a new purchase order line, ranks suppliers for a product, and lets a delivery billed above the
 * list be flagged (see purchaseOrders.controller receive).
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { toPaise, toRupees } from '../utils/money.js';

const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });

/** Map(productId -> { price_paise, min_qty, lead_time_days }) for one supplier's list, limited to `productIds` when given. */
export const listPrices = async (db, businessId, supplierId, productIds = null) => {
  const { rows } = await db.query(
    `SELECT product_id, price_paise, min_qty, lead_time_days FROM supplier_prices
     WHERE business_id = $1 AND supplier_id = $2 AND ($3::int[] IS NULL OR product_id = ANY($3::int[]))`,
    [businessId, supplierId, productIds && productIds.length ? productIds : (productIds ? [0] : null)]
  );
  return new Map(rows.map((r) => [r.product_id, { price_paise: Number(r.price_paise), min_qty: Number(r.min_qty), lead_time_days: r.lead_time_days }]));
};

const ownsSupplier = async (req) =>
  (await pool.query(`SELECT name FROM suppliers WHERE supplier_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];

/* GET /api/suppliers/:id/prices */
export const forSupplier = async (req, res) => {
  const supplier = await ownsSupplier(req);
  if (!supplier) return bad(res, 'Not found', 404);
  const { rows } = await pool.query(
    `SELECT sp.product_id, p.name, p.unit, sp.price_paise, sp.min_qty, sp.lead_time_days, sp.updated_at, p.purchase_price_paise AS last_paid_paise
     FROM supplier_prices sp JOIN products p ON p.product_id = sp.product_id
     WHERE sp.business_id = $1 AND sp.supplier_id = $2 ORDER BY p.name`, [req.tenant.businessId, req.params.id]);
  res.json({ success: true, data: rows.map((r) => ({ product_id: r.product_id, name: r.name, unit: r.unit, price: toRupees(r.price_paise), min_qty: Number(r.min_qty), lead_time_days: r.lead_time_days, last_paid: toRupees(r.last_paid_paise), updated_at: r.updated_at })) });
};

/* PUT /api/suppliers/:id/prices { prices: [{ product_id, price, min_qty?, lead_time_days? }] } — adds or updates those entries */
export const setPrices = async (req, res) => {
  const supplier = await ownsSupplier(req);
  if (!supplier) return bad(res, 'Not found', 404);
  const list = req.body?.prices;
  if (!Array.isArray(list) || !list.length) return bad(res, 'Send the prices to set');
  if (list.length > 500) return bad(res, 'Up to 500 prices at a time');

  const seen = new Set(); const clean = [];
  for (const p of list) {
    let paise;
    try { paise = toPaise(p.price); } catch { return bad(res, 'Every price must be a number'); }
    const minQty = p.min_qty == null || p.min_qty === '' ? 1 : Number(p.min_qty);
    const lead = p.lead_time_days == null || p.lead_time_days === '' ? null : Number(p.lead_time_days);
    if (!p.product_id || paise < 0) return bad(res, 'Every price needs a product and an amount of 0 or more');
    if (!(minQty > 0)) return bad(res, 'The minimum order must be above zero');
    if (lead != null && !(Number.isInteger(lead) && lead >= 0 && lead <= 365)) return bad(res, 'Lead time must be 0 to 365 days');
    if (seen.has(Number(p.product_id))) return bad(res, 'A product is listed twice');
    seen.add(Number(p.product_id));
    clean.push({ product_id: Number(p.product_id), paise, minQty, lead });
  }
  const owned = (await pool.query(`SELECT COUNT(*)::int AS n FROM products WHERE business_id = $1 AND product_id = ANY($2::int[])`, [req.tenant.businessId, [...seen]])).rows[0].n;
  if (owned !== seen.size) return bad(res, 'One of those products was not found', 404);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of clean) {
      await client.query(
        `INSERT INTO supplier_prices (business_id, supplier_id, product_id, price_paise, min_qty, lead_time_days) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (supplier_id, product_id) DO UPDATE SET price_paise = EXCLUDED.price_paise, min_qty = EXCLUDED.min_qty, lead_time_days = EXCLUDED.lead_time_days, updated_at = CURRENT_TIMESTAMP`,
        [req.tenant.businessId, req.params.id, c.product_id, c.paise, c.minQty, c.lead]
      );
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  recordAudit(req, { action: 'supplier.prices_set', resource_type: 'supplier', resource_id: req.params.id, metadata: { count: clean.length } });
  return forSupplier(req, res);
};

/* DELETE /api/suppliers/:id/prices/:productId */
export const removePrice = async (req, res) => {
  const { rowCount } = await pool.query(`DELETE FROM supplier_prices WHERE business_id = $1 AND supplier_id = $2 AND product_id = $3`, [req.tenant.businessId, req.params.id, req.params.productId]);
  if (!rowCount) return bad(res, 'Not found', 404);
  res.json({ success: true });
};

/* GET /api/products/:id/supplier-prices — who sells this, cheapest first */
export const forProduct = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.supplier_id, s.name, sp.price_paise, sp.min_qty, sp.lead_time_days
     FROM supplier_prices sp JOIN suppliers s ON s.supplier_id = sp.supplier_id
     WHERE sp.business_id = $1 AND sp.product_id = $2 AND s.status = 'ACTIVE' ORDER BY sp.price_paise, s.name`, [req.tenant.businessId, req.params.id]);
  res.json({ success: true, data: rows.map((r, i) => ({ supplier_id: r.supplier_id, name: r.name, price: toRupees(r.price_paise), min_qty: Number(r.min_qty), lead_time_days: r.lead_time_days, cheapest: i === 0 && rows.length > 1 })) });
};
