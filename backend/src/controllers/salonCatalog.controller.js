/*
 * The salon catalogue: service categories, services (with the consumables each one uses) and the salon
 * side of retail products.
 *
 * A service is a `products` row with kind = 'SERVICE' and no stock of its own, so invoices, GST, HSN/SAC,
 * per-outlet price overrides and reports treat it like any sold item. What a salon adds lives in
 * salon_item_details (duration, gender, commission, loyalty flags). The consumables a service uses are
 * `recipe_items` — the same bill of materials restaurants use — so billing already deducts them from stock.
 * Retail products and consumables are created with the existing /products API; this file adds their salon
 * details and a salon-shaped list.
 */
import pool from '../config/database.js';
import { loadRecipes, recipeCostPaise } from '../modules/recipes.js';
import { toRupees } from '../utils/money.js';
import {
  SalonError, audit, bool, diff, idList, int, like, money, num, ok, oneOf, page, paging, text, wrapAll
} from '../modules/salon/common.js';
import { getSettings } from '../modules/salon/settings.js';

const SCOPES = ['ANY', 'SERVICE', 'PRODUCT', 'CONSUMABLE'];
const GENDERS = ['ANY', 'WOMEN', 'MEN', 'KIDS'];

/* ── categories ───────────────────────────────────────────────────────────────────────────── */

/* GET /api/salon/categories?scope= */
const listCategories = async (req, res) => {
  const values = [req.tenant.businessId];
  let where = 'c.business_id = $1';
  if (req.query.scope) { values.push(oneOf(req.query.scope, 'Scope', SCOPES)); where += ` AND (c.item_scope = $${values.length} OR c.item_scope = 'ANY')`; }
  const { rows } = await pool.query(
    `SELECT c.category_id, c.name, c.item_scope,
            (SELECT COUNT(*)::int FROM products p WHERE p.category_id = c.category_id AND p.status = 'ACTIVE') AS items
     FROM categories c WHERE ${where} ORDER BY lower(c.name)`, values);
  ok(res, rows);
};

const createCategory = async (req, res) => {
  const name = text(req.body?.name, 'Category name', { max: 120, required: true });
  const scope = oneOf(req.body?.scope, 'Scope', SCOPES, { fallback: 'SERVICE' });
  const dup = (await pool.query(`SELECT 1 FROM categories WHERE business_id = $1 AND lower(name) = lower($2) AND item_scope = $3`, [req.tenant.businessId, name, scope])).rows.length;
  if (dup) throw new SalonError(409, `You already have a category called ${name}`);
  const row = (await pool.query(`INSERT INTO categories (business_id, name, item_scope) VALUES ($1,$2,$3) RETURNING category_id, name, item_scope`, [req.tenant.businessId, name, scope])).rows[0];
  audit(req, 'salon.category_created', 'category', row.category_id, null, row);
  ok(res, row, 201);
};

const updateCategory = async (req, res) => {
  const name = text(req.body?.name, 'Category name', { max: 120, required: true });
  const before = (await pool.query(`SELECT category_id, name, item_scope FROM categories WHERE category_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!before) throw new SalonError(404, 'Not found');
  const dup = (await pool.query(`SELECT 1 FROM categories WHERE business_id = $1 AND lower(name) = lower($2) AND item_scope = $3 AND category_id <> $4`, [req.tenant.businessId, name, before.item_scope, before.category_id])).rows.length;
  if (dup) throw new SalonError(409, `You already have a category called ${name}`);
  await pool.query(`UPDATE categories SET name = $1 WHERE category_id = $2`, [name, before.category_id]);
  audit(req, 'salon.category_renamed', 'category', before.category_id, { name: before.name }, { name });
  ok(res, { ...before, name });
};

const removeCategory = async (req, res) => {
  const cat = (await pool.query(`SELECT category_id, name FROM categories WHERE category_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!cat) throw new SalonError(404, 'Not found');
  const used = Number((await pool.query(`SELECT COUNT(*) AS n FROM products WHERE category_id = $1 AND status = 'ACTIVE'`, [cat.category_id])).rows[0].n);
  if (used) throw new SalonError(409, `${used} active item${used === 1 ? ' is' : 's are'} still in ${cat.name}. Move or archive them first.`);
  await pool.query(`DELETE FROM categories WHERE category_id = $1`, [cat.category_id]);
  audit(req, 'salon.category_deleted', 'category', cat.category_id, { name: cat.name });
  ok(res, { deleted: true });
};

/* ── services ─────────────────────────────────────────────────────────────────────────────── */

const serviceRow = (r, cost) => ({
  service_id: r.product_id, name: r.name, category_id: r.category_id, category_name: r.category_name,
  price: toRupees(r.selling_price_paise), tax_rate: Number(r.tax_rate), hsn_sac: r.hsn_sac, description: r.description,
  duration_min: r.duration_min, gender: r.gender, status: r.status,
  points_earnable: r.points_earnable, points_redeemable: r.points_redeemable,
  commission_type: r.commission_type, commission_value: r.commission_value == null ? null : Number(r.commission_value),
  consumables: Number(r.consumable_count ?? 0),
  ...(cost != null ? { cost: toRupees(cost), margin_pct: Number(r.selling_price_paise) > 0 ? Math.round(((Number(r.selling_price_paise) - cost) / Number(r.selling_price_paise)) * 1000) / 10 : null } : {})
});

const SERVICE_SELECT = `
  SELECT p.product_id, p.name, p.category_id, c.name AS category_name, p.selling_price_paise, p.tax_rate, p.hsn_sac, p.description, p.status,
         d.duration_min, d.gender, d.points_earnable, d.points_redeemable, d.commission_type, d.commission_value,
         (SELECT COUNT(*) FROM recipe_items r WHERE r.dish_product_id = p.product_id AND r.branch_id IS NULL) AS consumable_count
  FROM products p
  JOIN salon_item_details d ON d.product_id = p.product_id AND d.item_type = 'SERVICE'
  LEFT JOIN categories c ON c.category_id = p.category_id`;

/* GET /api/salon/services?q=&category_id=&status=&limit=&offset= */
const listServices = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 100 });
  const values = [req.tenant.businessId];
  const where = [`p.business_id = $1`, `p.kind = 'SERVICE'`];
  const status = String(req.query.status || 'ACTIVE').toUpperCase();
  if (status !== 'ALL') { values.push(status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE'); where.push(`p.status = $${values.length}`); }
  if (req.query.category_id) { values.push(Number(req.query.category_id) || 0); where.push(`p.category_id = $${values.length}`); }
  if (req.query.q) { values.push(like(String(req.query.q).slice(0, 80))); where.push(`p.name ILIKE $${values.length}`); }
  const count = Number((await pool.query(`SELECT COUNT(*) AS n FROM products p WHERE ${where.join(' AND ')}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const { rows } = await pool.query(
    `${SERVICE_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.name NULLS LAST, p.name LIMIT $${values.length - 1} OFFSET $${values.length}`, values);

  // cost and margin from the consumables, in one query for the whole page
  const recipes = await loadRecipes(pool, req.tenant.businessId, rows.map((r) => r.product_id));
  page(res, rows.map((r) => serviceRow(r, recipes.has(r.product_id) ? recipeCostPaise(recipes.get(r.product_id)) : 0)), count, pg);
};

const loadService = async (db, businessId, id) => {
  const row = (await db.query(`${SERVICE_SELECT} WHERE p.business_id = $1 AND p.product_id = $2 AND p.kind = 'SERVICE'`, [businessId, id])).rows[0];
  if (!row) return null;
  const consumables = await readConsumables(db, businessId, id);
  const staff = (await db.query(`SELECT s.staff_id, s.name, ss.commission_type, ss.commission_value FROM salon_staff_services ss JOIN salon_staff s ON s.staff_id = ss.staff_id WHERE ss.product_id = $1 AND s.business_id = $2 ORDER BY s.name`, [id, businessId])).rows;
  const cost = recipeCostPaise(consumables.map((c) => ({ quantity: c.quantity, wastage_pct: c.wastage_pct, price_paise: c.price_paise })));
  return { ...serviceRow(row, cost), consumable_items: consumables.map(({ price_paise, ...c }) => ({ ...c, cost_per_unit: toRupees(price_paise) })), staff };
};

const readConsumables = async (db, businessId, serviceId) => (await db.query(
  `SELECT r.ingredient_product_id AS ingredient_id, i.name, i.unit, i.kind, r.quantity, r.wastage_pct, r.is_variable,
          i.purchase_price_paise AS price_paise, i.current_stock
   FROM recipe_items r JOIN products i ON i.product_id = r.ingredient_product_id
   WHERE r.business_id = $1 AND r.dish_product_id = $2 AND r.branch_id IS NULL ORDER BY r.recipe_item_id`,
  [businessId, serviceId]
)).rows.map((r) => ({ ...r, quantity: Number(r.quantity), wastage_pct: Number(r.wastage_pct), price_paise: Number(r.price_paise), current_stock: Number(r.current_stock) }));

/* GET /api/salon/services/:id */
const getService = async (req, res) => {
  const s = await loadService(pool, req.tenant.businessId, req.params.id);
  if (!s) throw new SalonError(404, 'Not found');
  ok(res, s);
};

const checkCategory = async (db, businessId, id) => {
  if (id == null) return null;
  const c = (await db.query(`SELECT category_id FROM categories WHERE category_id = $1 AND business_id = $2`, [id, businessId])).rows[0];
  if (!c) throw new SalonError(400, 'Choose one of your categories');
  return c.category_id;
};

/* Consumables: an ingredient or packaging item of this business that is tracked in stock. */
const cleanConsumables = async (db, businessId, list, serviceId = null) => {
  if (list == null) return null;
  if (!Array.isArray(list)) throw new SalonError(400, 'Consumables must be a list');
  if (list.length > 40) throw new SalonError(400, 'A service can use at most 40 consumables');
  const out = []; const seen = new Set();
  for (const c of list) {
    const id = int(c.ingredient_id, 'Consumable', { min: 1, required: true });
    if (id === serviceId) throw new SalonError(400, 'A service cannot consume itself');
    if (seen.has(id)) throw new SalonError(400, 'A consumable is listed twice');
    seen.add(id);
    const quantity = num(c.quantity, 'Consumable quantity', { min: 0.0001, max: 1000000, required: true });
    const wastage = num(c.wastage_pct ?? 0, 'Wastage', { min: 0, max: 99 });
    out.push({ ingredient_id: id, quantity, wastage_pct: wastage, is_variable: bool(c.is_variable) });
  }
  if (out.length) {
    const found = (await db.query(`SELECT product_id FROM products WHERE business_id = $1 AND product_id = ANY($2::int[]) AND kind IN ('INGREDIENT','PACKAGING') AND status = 'ACTIVE'`, [businessId, out.map((o) => o.ingredient_id)])).rows.length;
    if (found !== out.length) throw new SalonError(400, 'Every consumable must be one of your consumable stock items');
  }
  return out;
};

const writeConsumables = async (db, businessId, serviceId, list) => {
  await db.query(`DELETE FROM recipe_items WHERE dish_product_id = $1 AND business_id = $2 AND branch_id IS NULL`, [serviceId, businessId]);
  for (const c of list) {
    await db.query(
      `INSERT INTO recipe_items (business_id, dish_product_id, ingredient_product_id, quantity, wastage_pct, is_variable) VALUES ($1,$2,$3,$4,$5,$6)`,
      [businessId, serviceId, c.ingredient_id, c.quantity, c.wastage_pct ?? 0, c.is_variable]
    );
  }
};

const writeStaff = async (db, businessId, serviceId, staffIds) => {
  if (staffIds == null) return;
  if (staffIds.length) {
    const found = Number((await db.query(`SELECT COUNT(*) AS n FROM salon_staff WHERE business_id = $1 AND staff_id = ANY($2::int[])`, [businessId, staffIds])).rows[0].n);
    if (found !== staffIds.length) throw new SalonError(400, 'Choose staff from your own team');
  }
  // keep the commission override of anyone who stays on the list
  await db.query(`DELETE FROM salon_staff_services WHERE product_id = $1 AND NOT (staff_id = ANY($2::int[]))`, [serviceId, staffIds]);
  for (const id of staffIds) {
    await db.query(`INSERT INTO salon_staff_services (staff_id, product_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [id, serviceId]);
  }
};

const serviceFields = async (db, businessId, body, { partial }) => {
  const settings = await getSettings(db, businessId);
  const f = {};
  if (!partial || 'name' in body) f.name = text(body.name, 'Service name', { max: 160, min: 2, required: true });
  if (!partial || 'price' in body) f.selling_price_paise = money(body.price, 'Price', { required: true });
  if (!partial || 'tax_rate' in body) f.tax_rate = body.tax_rate == null || body.tax_rate === '' ? settings.default_service_tax_rate : num(body.tax_rate, 'Tax rate', { min: 0, max: 100 });
  if (!partial || 'hsn_sac' in body) f.hsn_sac = text(body.hsn_sac, 'SAC code', { max: 16 }) ?? (partial ? null : settings.default_service_sac);
  if ('description' in body) f.description = text(body.description, 'Description', { max: 500 });
  if ('category_id' in body) f.category_id = await checkCategory(db, businessId, int(body.category_id, 'Category'));
  const d = {};
  if (!partial || 'duration_min' in body) d.duration_min = int(body.duration_min ?? (partial ? undefined : 30), 'Duration', { min: 5, max: 720, required: true });
  if ('gender' in body) d.gender = oneOf(body.gender, 'Gender', GENDERS, { required: true });
  if ('points_earnable' in body) d.points_earnable = bool(body.points_earnable);
  if ('points_redeemable' in body) d.points_redeemable = bool(body.points_redeemable);
  if ('commission_type' in body || 'commission_value' in body) {
    const type = body.commission_type == null || body.commission_type === '' ? null : oneOf(body.commission_type, 'Commission type', ['PERCENT', 'FIXED'], { required: true });
    d.commission_type = type;
    d.commission_value = type ? num(body.commission_value, 'Commission', { min: 0, max: type === 'PERCENT' ? 100 : 1000000, required: true }) : null;
  }
  return { f, d };
};

/* POST /api/salon/services */
const createService = async (req, res) => {
  const body = req.body || {};
  const { f, d } = await serviceFields(pool, req.tenant.businessId, body, { partial: false });
  const consumables = await cleanConsumables(pool, req.tenant.businessId, body.consumables);
  const staffIds = 'staff_ids' in body ? idList(body.staff_ids, 'Staff') : null;
  const dup = (await pool.query(`SELECT 1 FROM products WHERE business_id = $1 AND kind = 'SERVICE' AND status = 'ACTIVE' AND lower(name) = lower($2)`, [req.tenant.businessId, f.name])).rows.length;
  if (dup) throw new SalonError(409, `You already have a service called ${f.name}`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const id = (await client.query(
      `INSERT INTO products (business_id, category_id, name, unit, selling_price_paise, purchase_price_paise, tax_rate, hsn_sac, track_inventory, description, kind)
       VALUES ($1,$2,$3,'visit',$4,0,$5,$6,FALSE,$7,'SERVICE') RETURNING product_id`,
      [req.tenant.businessId, f.category_id ?? null, f.name, f.selling_price_paise, f.tax_rate, f.hsn_sac ?? null, f.description ?? null]
    )).rows[0].product_id;
    await client.query(
      `INSERT INTO salon_item_details (product_id, business_id, item_type, duration_min, gender, points_earnable, points_redeemable, commission_type, commission_value)
       VALUES ($1,$2,'SERVICE',$3,$4,$5,$6,$7,$8)`,
      [id, req.tenant.businessId, d.duration_min, d.gender ?? 'ANY', d.points_earnable ?? true, d.points_redeemable ?? true, d.commission_type ?? null, d.commission_value ?? null]
    );
    if (consumables) await writeConsumables(client, req.tenant.businessId, id, consumables);
    await writeStaff(client, req.tenant.businessId, id, staffIds);
    await client.query('COMMIT');
    audit(req, 'salon.service_created', 'product', id, null, { name: f.name, price: toRupees(f.selling_price_paise), tax_rate: f.tax_rate });
    ok(res, await loadService(pool, req.tenant.businessId, id), 201);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/* PUT /api/salon/services/:id — only the fields sent change */
const updateService = async (req, res) => {
  const body = req.body || {};
  const before = await loadService(pool, req.tenant.businessId, req.params.id);
  if (!before) throw new SalonError(404, 'Not found');
  const { f, d } = await serviceFields(pool, req.tenant.businessId, body, { partial: true });
  const consumables = await cleanConsumables(pool, req.tenant.businessId, body.consumables, before.service_id);
  const staffIds = 'staff_ids' in body ? idList(body.staff_ids, 'Staff') : null;
  if (f.name && f.name.toLowerCase() !== before.name.toLowerCase()) {
    const dup = (await pool.query(`SELECT 1 FROM products WHERE business_id = $1 AND kind = 'SERVICE' AND status = 'ACTIVE' AND lower(name) = lower($2) AND product_id <> $3`, [req.tenant.businessId, f.name, before.service_id])).rows.length;
    if (dup) throw new SalonError(409, `You already have a service called ${f.name}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pk = Object.keys(f);
    if (pk.length) await client.query(`UPDATE products SET ${pk.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE product_id = $1 AND business_id = $2`, [before.service_id, req.tenant.businessId, ...pk.map((k) => f[k])]);
    const dk = Object.keys(d);
    if (dk.length) await client.query(`UPDATE salon_item_details SET ${dk.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE product_id = $1`, [before.service_id, ...dk.map((k) => d[k])]);
    if (consumables) await writeConsumables(client, req.tenant.businessId, before.service_id, consumables);
    await writeStaff(client, req.tenant.businessId, before.service_id, staffIds);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const after = await loadService(pool, req.tenant.businessId, before.service_id);
  const changes = diff(before, { name: after.name, price: after.price, tax_rate: after.tax_rate, duration_min: after.duration_min, category_id: after.category_id, commission_type: after.commission_type, commission_value: after.commission_value, status: after.status });
  if ('price' in changes) audit(req, 'salon.price_changed', 'product', before.service_id, { price: before.price }, { price: after.price }, { name: after.name });
  if (Object.keys(changes).some((k) => k !== 'price')) audit(req, 'salon.service_updated', 'product', before.service_id, null, null, { changes });
  if (consumables) audit(req, 'salon.service_consumables_changed', 'product', before.service_id, null, null, { consumables: consumables.length });
  ok(res, after);
};

/* POST /api/salon/services/:id/archive | /restore */
const setServiceStatus = (status) => async (req, res) => {
  const row = (await pool.query(`UPDATE products SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE product_id = $1 AND business_id = $2 AND kind = 'SERVICE' RETURNING product_id, name`, [req.params.id, req.tenant.businessId, status])).rows[0];
  if (!row) throw new SalonError(404, 'Not found');
  audit(req, status === 'ARCHIVED' ? 'salon.service_archived' : 'salon.service_restored', 'product', row.product_id, null, null, { name: row.name });
  ok(res, { service_id: row.product_id, status });
};

/* GET /api/salon/services/:id/consumables, PUT replaces the default list */
const getConsumables = async (req, res) => {
  const own = (await pool.query(`SELECT 1 FROM products WHERE product_id = $1 AND business_id = $2 AND kind = 'SERVICE'`, [req.params.id, req.tenant.businessId])).rows.length;
  if (!own) throw new SalonError(404, 'Not found');
  ok(res, (await readConsumables(pool, req.tenant.businessId, Number(req.params.id))).map(({ price_paise, ...c }) => ({ ...c, cost_per_unit: toRupees(price_paise) })));
};

const setConsumables = async (req, res) => {
  const own = (await pool.query(`SELECT name FROM products WHERE product_id = $1 AND business_id = $2 AND kind = 'SERVICE'`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!own) throw new SalonError(404, 'Not found');
  const list = await cleanConsumables(pool, req.tenant.businessId, req.body?.consumables ?? [], Number(req.params.id));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await writeConsumables(client, req.tenant.businessId, Number(req.params.id), list);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  audit(req, 'salon.service_consumables_changed', 'product', req.params.id, null, null, { name: own.name, consumables: list.length });
  ok(res, (await readConsumables(pool, req.tenant.businessId, Number(req.params.id))).map(({ price_paise, ...c }) => ({ ...c, cost_per_unit: toRupees(price_paise) })));
};

/* ── retail products and consumables (the salon's view of /products) ──────────────────────── */

/* GET /api/salon/products?type=PRODUCT|CONSUMABLE&q=&category_id=&low_stock=1&limit=&offset= */
const listProducts = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const type = oneOf(req.query.type, 'Type', ['PRODUCT', 'CONSUMABLE'], { fallback: 'PRODUCT' });
  const values = [req.tenant.businessId];
  const where = ['p.business_id = $1', type === 'PRODUCT' ? `p.kind = 'DISH'` : `p.kind IN ('INGREDIENT','PACKAGING')`];
  const status = String(req.query.status || 'ACTIVE').toUpperCase();
  if (status !== 'ALL') { values.push(status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE'); where.push(`p.status = $${values.length}`); }
  if (req.query.category_id) { values.push(Number(req.query.category_id) || 0); where.push(`p.category_id = $${values.length}`); }
  if (req.query.q) {
    const term = String(req.query.q).slice(0, 80);
    values.push(like(term)); const fuzzy = values.length;
    values.push(term); const exact = values.length;
    where.push(`(p.name ILIKE $${fuzzy} OR p.sku ILIKE $${fuzzy} OR p.barcode = $${exact})`);
  }
  const scopeBranch = req.tenant.scopeBranchId;
  const stockExpr = scopeBranch != null
    ? (values.push(scopeBranch), `COALESCE((SELECT quantity FROM branch_stock bs WHERE bs.product_id = p.product_id AND bs.branch_id = $${values.length}), 0)`)
    : `COALESCE((SELECT SUM(quantity) FROM branch_stock bs WHERE bs.product_id = p.product_id), 0)`;
  const low = req.query.low_stock === '1' || req.query.low_stock === 'true';
  const base = `FROM products p LEFT JOIN categories c ON c.category_id = p.category_id LEFT JOIN salon_item_details d ON d.product_id = p.product_id
                LEFT JOIN suppliers s ON s.supplier_id = p.supplier_id WHERE ${where.join(' AND ')}${low ? ` AND p.track_inventory AND ${stockExpr} <= p.min_stock` : ''}`;
  const count = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const { rows } = await pool.query(
    `SELECT p.product_id, p.name, p.sku, p.barcode, p.unit, p.kind, p.category_id, c.name AS category_name, p.supplier_id, s.name AS supplier_name,
            p.selling_price_paise, p.purchase_price_paise, p.tax_rate, p.hsn_sac, p.track_inventory, p.min_stock, p.status,
            ${stockExpr} AS stock, d.max_stock, d.brand, d.points_earnable, d.points_redeemable, d.commission_type, d.commission_value
     ${base} ORDER BY p.name LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  page(res, rows.map((r) => ({
    product_id: r.product_id, name: r.name, sku: r.sku, barcode: r.barcode, unit: r.unit, kind: r.kind,
    category_id: r.category_id, category: r.category_name, supplier_id: r.supplier_id, supplier: r.supplier_name, brand: r.brand,
    selling_price: toRupees(r.selling_price_paise), cost_price: toRupees(r.purchase_price_paise), tax_rate: Number(r.tax_rate), hsn_sac: r.hsn_sac,
    stock: Number(r.stock), min_stock: Number(r.min_stock), max_stock: r.max_stock == null ? null : Number(r.max_stock),
    low: Boolean(r.track_inventory) && Number(r.stock) <= Number(r.min_stock), status: r.status,
    points_earnable: r.points_earnable ?? true, points_redeemable: r.points_redeemable ?? true,
    commission_type: r.commission_type, commission_value: r.commission_value == null ? null : Number(r.commission_value)
  })), count, pg);
};

/* PUT /api/salon/products/:id/details — the salon fields of a retail product or consumable */
const setProductDetails = async (req, res) => {
  const p = (await pool.query(`SELECT product_id, name, kind FROM products WHERE product_id = $1 AND business_id = $2 AND kind IN ('DISH','INGREDIENT','PACKAGING')`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!p) throw new SalonError(404, 'Not found');
  const b = req.body || {};
  const cols = {};
  if ('brand' in b) cols.brand = text(b.brand, 'Brand', { max: 80 });
  if ('max_stock' in b) cols.max_stock = b.max_stock === null || b.max_stock === '' ? null : num(b.max_stock, 'Maximum stock', { min: 0, max: 100000000 });
  if ('points_earnable' in b) cols.points_earnable = bool(b.points_earnable);
  if ('points_redeemable' in b) cols.points_redeemable = bool(b.points_redeemable);
  if ('commission_type' in b || 'commission_value' in b) {
    const type = b.commission_type == null || b.commission_type === '' ? null : oneOf(b.commission_type, 'Commission type', ['PERCENT', 'FIXED'], { required: true });
    cols.commission_type = type;
    cols.commission_value = type ? num(b.commission_value, 'Commission', { min: 0, max: type === 'PERCENT' ? 100 : 1000000, required: true }) : null;
  }
  const keys = Object.keys(cols);
  if (!keys.length) throw new SalonError(400, 'Nothing to update');
  const before = (await pool.query(`SELECT brand, max_stock, commission_type, commission_value FROM salon_item_details WHERE product_id = $1`, [p.product_id])).rows[0] || null;
  await pool.query(
    `INSERT INTO salon_item_details (product_id, business_id, item_type, ${keys.join(', ')}) VALUES ($1,$2,$3,${keys.map((_, i) => `$${i + 4}`).join(', ')})
     ON CONFLICT (product_id) DO UPDATE SET ${keys.map((k, i) => `${k} = $${i + 4}`).join(', ')}, updated_at = CURRENT_TIMESTAMP`,
    [p.product_id, req.tenant.businessId, 'PRODUCT', ...keys.map((k) => cols[k])]
  );
  audit(req, 'salon.product_details_changed', 'product', p.product_id, before, cols, { name: p.name });
  ok(res, { product_id: p.product_id, ...cols });
};

export default wrapAll({
  listCategories, createCategory, updateCategory, removeCategory,
  listServices, getService, createService, updateService,
  archiveService: setServiceStatus('ARCHIVED'), restoreService: setServiceStatus('ACTIVE'),
  getConsumables, setConsumables, listProducts, setProductDetails
});
