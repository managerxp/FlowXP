/*
 * The catalogue billing works from.
 *
 * current_stock lives on this table as a maintained cache — every write to it
 * happens alongside a row in inventory_transactions (see inventory.controller
 * and invoices.controller), so the two can never drift as long as nothing
 * writes to current_stock directly. This file never does.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { toPaise, toRupees } from '../utils/money.js';
import { checkName, firstError } from '../utils/validate.js';
import { moveStock, stockAt } from '../modules/stock.js';
import { outletSettingsFor } from '../modules/menu.js';
import { EXT_BY_MIME, putFile, removeFile } from '../modules/storage.js';
import { looksLikeImage } from '../middleware/upload.js';
import { branchFilter } from '../utils/scope.js';
import { loadRecipes, recipeCostPaise, recipeMargin } from '../modules/recipes.js';

/* Products are one shared menu. When the request is for one outlet, show that
   outlet's stock, price and availability instead of the business-wide ones. */
const forOutlet = async (rows, tenant) => {
  const branchId = tenant.scopeBranchId;
  if (branchId == null || !rows.length) return rows;
  const ids = rows.map((r) => r.product_id);
  const [stock, settings] = await Promise.all([stockAt(pool, branchId, ids), outletSettingsFor(pool, branchId, ids)]);
  return rows.map((r) => {
    const s = settings.get(r.product_id);
    return { ...r, shared_selling_price_paise: r.selling_price_paise, current_stock: stock.get(r.product_id), selling_price_paise: s?.price_paise ?? r.selling_price_paise, is_available: s ? s.is_available : true, price_overridden: s?.price_paise != null };
  });
};

/* What one of each sold item costs you, and what is left of its price: from its
   recipe (at the viewer's outlet) when it has one, else what you pay for it.
   Pre-tax, like the recipe editor; ingredients and packaging get none. */
const withCosts = async (rows, tenant) => {
  const dishes = rows.filter((r) => r.kind === 'DISH').map((r) => r.product_id);
  if (!dishes.length) return rows;
  const recipes = await loadRecipes(pool, tenant.businessId, dishes, tenant.scopeBranchId ?? null);
  return rows.map((r) => {
    if (r.kind !== 'DISH') return r;
    const recipe = recipes.get(r.product_id);
    const costPaise = recipe?.length ? recipeCostPaise(recipe) : Number(r.purchase_price_paise) || null;
    if (!costPaise) return { ...r, cost_source: null };
    const m = recipeMargin(costPaise, r.selling_price_paise);
    return { ...r, cost_source: recipe?.length ? 'recipe' : 'purchase', unit_cost_paise: costPaise, margin_pct: m.gross_margin_pct };
  });
};

const asProduct = (row) => ({
  product_id: row.product_id,
  category_id: row.category_id,
  category_name: row.category_name,
  brand_id: row.brand_id,
  brand_name: row.brand_name,
  supplier_id: row.supplier_id,
  name: row.name,
  kind: row.kind,
  food_type: row.food_type || null,
  is_combo: Boolean(row.is_combo),
  lead_time_days: row.lead_time_days,
  modifier_group_ids: row.modifier_group_ids || [],
  sku: row.sku,
  barcode: row.barcode,
  unit: row.unit,
  description: row.description,
  image_url: row.image_url,
  selling_price: toRupees(row.selling_price_paise),
  // The price every outlet without its own override charges: what an edit form must show and save.
  shared_price: toRupees(row.shared_selling_price_paise ?? row.selling_price_paise),
  purchase_price: toRupees(row.purchase_price_paise),
  tax_rate: Number(row.tax_rate),
  hsn_sac: row.hsn_sac,
  track_inventory: row.track_inventory,
  current_stock: Number(row.current_stock),
  min_stock: Number(row.min_stock),
  low_stock: row.track_inventory && Number(row.current_stock) <= Number(row.min_stock),
  status: row.status,
  is_available: row.is_available !== false,
  price_overridden: Boolean(row.price_overridden),
  ...(row.cost_source !== undefined ? { cost_source: row.cost_source, unit_cost: row.cost_source ? toRupees(row.unit_cost_paise) : null, margin_pct: row.cost_source ? row.margin_pct : null } : {})
});

const KINDS = ['DISH', 'INGREDIENT', 'PACKAGING'];
const FOOD_TYPES = ['VEG', 'NON_VEG', 'EGG'];
/* '' or null clears the mark; anything else must be one of the three. Returns [value, error]. */
const foodType = (v) => (v == null || v === '' ? [null, null] : FOOD_TYPES.includes(String(v).toUpperCase()) ? [String(v).toUpperCase(), null] : [null, 'Choose veg, non-veg or egg']);

const SELECT = `
  SELECT p.*, c.name AS category_name, br.name AS brand_name,
         COALESCE((SELECT array_agg(pg.group_id ORDER BY pg.group_id) FROM product_modifier_groups pg WHERE pg.product_id = p.product_id), '{}') AS modifier_group_ids
  FROM products p
  LEFT JOIN categories c ON c.category_id = p.category_id
  LEFT JOIN brands br ON br.brand_id = p.brand_id
  WHERE p.business_id = $1
`;

/* ==========================================================================
   GET /api/products
   ========================================================================== */
export const list = async (req, res) => {
  const { search, category_id, brand_id, low_stock, kind, status = 'ACTIVE' } = req.query;
  const clauses = [];
  const values = [req.tenant.businessId];

  if (status !== 'all') { values.push(status); clauses.push(`p.status = $${values.length}`); }
  if (kind) { values.push(String(kind).toUpperCase()); clauses.push(`p.kind = $${values.length}`); }
  if (category_id) { values.push(Number(category_id)); clauses.push(`p.category_id = $${values.length}`); }
  if (brand_id) { values.push(Number(brand_id)); clauses.push(`p.brand_id = $${values.length}`); }
  if (search) {
    values.push(`%${search}%`);
    const likeIndex = values.length;
    values.push(String(search));
    clauses.push(`(p.name ILIKE $${likeIndex} OR p.sku ILIKE $${likeIndex} OR p.barcode = $${values.length})`);
  }
  if (low_stock === 'true') {
    if (req.tenant.scopeBranchId != null) {
      values.push(req.tenant.scopeBranchId);
      clauses.push(`p.track_inventory AND COALESCE((SELECT quantity FROM branch_stock bs WHERE bs.product_id = p.product_id AND bs.branch_id = $${values.length}), 0) <= p.min_stock`);
    } else clauses.push(`p.track_inventory AND p.current_stock <= p.min_stock`);
  }

  const { rows } = await pool.query(
    `${SELECT} ${clauses.map((c) => `AND ${c}`).join(' ')} ORDER BY p.name`,
    values
  );
  res.json({ success: true, data: (await withCosts(await forOutlet(rows, req.tenant), req.tenant)).map(asProduct) });
};

/* One product by id or, given a barcode, by scan — the billing screen's two
   ways of finding a product are the same lookup with a different key. */
export const get = async (req, res) => {
  const { rows } = await pool.query(`${SELECT} AND p.product_id = $2`, [req.tenant.businessId, req.params.id]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: asProduct((await withCosts(await forOutlet(rows, req.tenant), req.tenant))[0]) });
};

export const findByBarcode = async (req, res) => {
  const { rows } = await pool.query(`${SELECT} AND p.barcode = $2 AND p.status = 'ACTIVE'`, [
    req.tenant.businessId, req.params.barcode
  ]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'No product with that barcode' });
  res.json({ success: true, data: asProduct((await forOutlet(rows, req.tenant))[0]) });
};

/* ==========================================================================
   POST /api/products
   ========================================================================== */
export const create = async (req, res) => {
  const body = req.body || {};
  const error = firstError([checkName(body.name, 'Product name')]);
  if (error) return res.status(400).json({ success: false, message: error });

  let sellingPaise, purchasePaise;
  try {
    sellingPaise = toPaise(body.selling_price ?? 0);
    purchasePaise = toPaise(body.purchase_price ?? 0);
  } catch {
    return res.status(400).json({ success: false, message: 'Prices must be numbers' });
  }
  if (sellingPaise < 0 || purchasePaise < 0) {
    return res.status(400).json({ success: false, message: 'Prices cannot be negative' });
  }

  const kind = body.kind ? String(body.kind).toUpperCase() : 'DISH';
  if (!KINDS.includes(kind)) return res.status(400).json({ success: false, message: 'Kind must be DISH, INGREDIENT or PACKAGING' });
  const [food, foodError] = foodType(body.food_type);
  if (foodError) return res.status(400).json({ success: false, message: foodError });
  if (body.brand_id && !(await pool.query(`SELECT 1 FROM brands WHERE brand_id = $1 AND business_id = $2`, [body.brand_id, req.tenant.businessId])).rows.length) {
    return res.status(400).json({ success: false, message: 'Brand not found' });
  }

  const trackInventory = body.track_inventory !== false;

  try {
    const { rows } = await pool.query(
      `INSERT INTO products
         (business_id, category_id, supplier_id, name, sku, barcode, unit,
          selling_price_paise, purchase_price_paise, tax_rate, hsn_sac,
          track_inventory, current_stock, min_stock, description, kind, food_type, brand_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING product_id`,
      [
        req.tenant.businessId,
        body.category_id || null,
        body.supplier_id || null,
        String(body.name).trim(),
        body.sku ? String(body.sku).trim() : null,
        body.barcode ? String(body.barcode).trim() : null,
        body.unit ? String(body.unit).trim() : 'pc',
        sellingPaise,
        purchasePaise,
        Number(body.tax_rate) || 0,
        body.hsn_sac ? String(body.hsn_sac).trim() : null,
        trackInventory,
        0,   // opening stock is added below, through moveStock, so outlet and total agree
        Number(body.min_stock) || 0,
        body.description ? String(body.description).trim() : null,
        kind,
        food,
        body.brand_id || null
      ]
    );

    const productId = rows[0].product_id;

    /* Opening stock is itself a stock movement — it goes through the same
       ledger a sale or a purchase does, so "where did this product's stock
       come from" always has one answer: the transactions table. */
    if (trackInventory && Number(body.opening_stock) > 0) {
      await moveStock(pool, { businessId: req.tenant.businessId, branchId: req.tenant.branchId, productId, delta: Number(body.opening_stock) });
      await pool.query(
        `INSERT INTO inventory_transactions
           (business_id, branch_id, product_id, transaction_type, quantity, reference_type, created_by)
         VALUES ($1,$2,$3,'OPENING',$4,'manual',$5)`,
        [req.tenant.businessId, req.tenant.branchId, productId, Number(body.opening_stock), req.auth.userId]
      );
    }

    recordAudit(req, { action: 'product.created', resource_type: 'product', resource_id: productId });
    const { rows: full } = await pool.query(`${SELECT} AND p.product_id = $2`, [req.tenant.businessId, productId]);
    res.status(201).json({ success: true, data: asProduct(full[0]) });
  } catch (dbError) {
    if (dbError.code === '23505') {
      return res.status(409).json({ success: false, message: 'A product with that SKU or barcode already exists' });
    }
    console.error('[products] create failed:', dbError.message);
    res.status(500).json({ success: false, message: 'Could not create the product' });
  }
};

/* ==========================================================================
   PATCH /api/products/:id

   Pricing and stock levels are corrected here directly; the current_stock
   NUMBER itself is not — that only ever moves through a transaction (a sale,
   a purchase, or an explicit adjustment in inventory.controller.js), so this
   allowlist excludes it on purpose.
   ========================================================================== */
const EDITABLE = ['name', 'category_id', 'supplier_id', 'brand_id', 'sku', 'barcode', 'unit',
  'tax_rate', 'hsn_sac', 'min_stock', 'status', 'description', 'kind', 'lead_time_days', 'food_type'];

export const update = async (req, res) => {
  const body = req.body || {};
  const updates = [];
  const values = [];

  if ('lead_time_days' in body && !(Number.isInteger(Number(body.lead_time_days)) && body.lead_time_days >= 0 && body.lead_time_days <= 30)) {
    return res.status(400).json({ success: false, message: 'Lead time must be a whole number of days from 0 to 30' });
  }
  if ('food_type' in body) {
    const [food, foodError] = foodType(body.food_type);
    if (foodError) return res.status(400).json({ success: false, message: foodError });
    body.food_type = food;
  }
  if ('kind' in body) {
    body.kind = String(body.kind).toUpperCase();
    if (!KINDS.includes(body.kind)) return res.status(400).json({ success: false, message: 'Kind must be DISH, INGREDIENT or PACKAGING' });
  }
  if (body.brand_id && !(await pool.query(`SELECT 1 FROM brands WHERE brand_id = $1 AND business_id = $2`, [body.brand_id, req.tenant.businessId])).rows.length) {
    return res.status(400).json({ success: false, message: 'Brand not found' });
  }
  for (const field of EDITABLE) {
    if (!(field in body)) continue;
    values.push(body[field]);
    updates.push(`${field} = $${values.length}`);
  }
  if ('selling_price' in body) {
    try { values.push(toPaise(body.selling_price)); updates.push(`selling_price_paise = $${values.length}`); }
    catch { return res.status(400).json({ success: false, message: 'Selling price must be a number' }); }
  }
  if ('purchase_price' in body) {
    try { values.push(toPaise(body.purchase_price)); updates.push(`purchase_price_paise = $${values.length}`); }
    catch { return res.status(400).json({ success: false, message: 'Purchase price must be a number' }); }
  }
  if (!updates.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

  values.push(req.tenant.businessId, req.params.id);
  const { rows } = await pool.query(
    `UPDATE products SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $${values.length - 1} AND product_id = $${values.length}
     RETURNING product_id`,
    values
  );
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  recordAudit(req, { action: 'product.updated', resource_type: 'product', resource_id: req.params.id, metadata: { fields: Object.keys(body) } });
  const { rows: full } = await pool.query(`${SELECT} AND p.product_id = $2`, [req.tenant.businessId, req.params.id]);
  res.json({ success: true, data: asProduct(full[0]) });
};

/* ==========================================================================
   POST /api/products/:id/image — multipart, one file field named "image"

   Runs after middleware/upload.js's multer instance has already written the
   file to disk and set req.file; this just confirms the product exists and
   points image_url at it. See upload.js for why this is local disk, not
   object storage, and what that limits.
   ========================================================================== */
export const uploadImage = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Choose an image to upload' });
  if (!looksLikeImage(req.file.buffer, req.file.mimetype)) return res.status(400).json({ success: false, message: 'That file is not a valid JPEG, PNG or WebP image' });

  const own = await pool.query(`SELECT image_url FROM products WHERE business_id = $1 AND product_id = $2`, [req.tenant.businessId, req.params.id]);
  if (!own.rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  // Files are namespaced by business, so one tenant's files can never collide with another's.
  let imageUrl;
  try {
    imageUrl = await putFile({ key: `products/${req.tenant.businessId}/${req.params.id}-${Date.now()}${EXT_BY_MIME[req.file.mimetype]}`, buffer: req.file.buffer, contentType: req.file.mimetype });
  } catch (error) {
    console.error('[products] photo upload failed:', error.message);
    return res.status(502).json({ success: false, message: 'Could not save the photo. Try again in a moment.' });
  }
  await pool.query(`UPDATE products SET image_url = $1, updated_at = CURRENT_TIMESTAMP WHERE business_id = $2 AND product_id = $3`, [imageUrl, req.tenant.businessId, req.params.id]);
  if (own.rows[0].image_url) removeFile(own.rows[0].image_url);   // the replaced photo, best effort

  recordAudit(req, { action: 'product.image_uploaded', resource_type: 'product', resource_id: req.params.id });
  const { rows: full } = await pool.query(`${SELECT} AND p.product_id = $2`, [req.tenant.businessId, req.params.id]);
  res.json({ success: true, data: asProduct(full[0]) });
};

/* Archived, not deleted — a product referenced by a year of invoices cannot
   be dropped without breaking every one of them. Archiving hides it from
   billing while every past invoice still reads correctly. */
export const archive = async (req, res) => {
  const { rowCount } = await pool.query(
    `UPDATE products SET status = 'ARCHIVED', updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1 AND product_id = $2`,
    [req.tenant.businessId, req.params.id]
  );
  if (!rowCount) return res.status(404).json({ success: false, message: 'Not found' });
  recordAudit(req, { action: 'product.archived', resource_type: 'product', resource_id: req.params.id });
  res.json({ success: true });
};

/* ==========================================================================
   GET/PUT /api/products/:id/outlets — per-outlet price and availability

   The menu is shared; an outlet may charge a different price for a dish or
   stop selling it. A price of null (or omitted) means "use the shared price".
   ========================================================================== */
export const getOutletSettings = async (req, res) => {
  const own = await pool.query(`SELECT selling_price_paise FROM products WHERE product_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId]);
  if (!own.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  const params = [req.tenant.businessId, req.params.id];
  const { rows } = await pool.query(
    `SELECT b.branch_id, b.name, s.price_paise, COALESCE(s.is_available, TRUE) AS is_available
     FROM branches b LEFT JOIN product_branch_settings s ON s.branch_id = b.branch_id AND s.product_id = $2
     WHERE b.business_id = $1 AND b.status = 'ACTIVE'${branchFilter(req.tenant, 'b.branch_id', params)} ORDER BY b.is_primary DESC, b.branch_id`,
    params
  );
  res.json({ success: true, data: { shared_price: toRupees(own.rows[0].selling_price_paise), outlets: rows.map((r) => ({ branch_id: r.branch_id, name: r.name, price: r.price_paise == null ? null : toRupees(r.price_paise), is_available: r.is_available })) } });
};

export const setOutletSettings = async (req, res) => {
  const body = req.body || {};
  const branchId = Number(body.branch_id);
  if (req.tenant.pinned && branchId !== req.tenant.branchId) return res.status(403).json({ success: false, message: 'You can only change your own outlet' });
  const outlet = await pool.query(`SELECT 1 FROM branches WHERE branch_id = $1 AND business_id = $2 AND status = 'ACTIVE'`, [branchId, req.tenant.businessId]);
  const own = await pool.query(`SELECT 1 FROM products WHERE product_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId]);
  if (!outlet.rows.length || !own.rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  let pricePaise = null;
  if (body.price != null && body.price !== '') {
    try { pricePaise = toPaise(body.price); } catch { return res.status(400).json({ success: false, message: 'Price must be a number' }); }
    if (pricePaise < 0) return res.status(400).json({ success: false, message: 'Price cannot be negative' });
  }
  const available = body.is_available !== false;
  if (pricePaise == null && available) {
    await pool.query(`DELETE FROM product_branch_settings WHERE product_id = $1 AND branch_id = $2`, [req.params.id, branchId]);
  } else {
    await pool.query(
      `INSERT INTO product_branch_settings (product_id, branch_id, price_paise, is_available) VALUES ($1,$2,$3,$4)
       ON CONFLICT (product_id, branch_id) DO UPDATE SET price_paise = EXCLUDED.price_paise, is_available = EXCLUDED.is_available`,
      [req.params.id, branchId, pricePaise, available]
    );
  }
  recordAudit(req, { action: 'product.outlet_settings', resource_type: 'product', resource_id: req.params.id, metadata: { branch_id: branchId, price_paise: pricePaise, is_available: available } });
  res.json({ success: true });
};
