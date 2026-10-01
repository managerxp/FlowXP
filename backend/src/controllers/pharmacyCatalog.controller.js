/*
 * Pharmacy products and categories.
 *
 * A product is still an ordinary `products` row — stock, tax, barcodes and invoices all keep working unchanged.
 * The pharmacy half (product type, manufacturer, batch/expiry/serial/prescription behavior) lives in
 * pharmacy_item_details, one row per product — see migrations/0061_pharmacy_foundation.js.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { branchFilter } from '../utils/scope.js';
import { PharmacyError, audit, bool, diff, int, like, money, num, ok, oneOf, page, paging, text, wrapAll } from '../modules/pharmacy/common.js';

const PRODUCT_TYPES = ['MEDICINE', 'DEVICE', 'CONSUMABLE', 'SURGICAL', 'WELLNESS', 'PERSONAL_CARE', 'BABY_CARE', 'ORTHOPEDIC', 'DIAGNOSTIC', 'OTHER'];
const paise = (v) => (v == null ? null : toRupees(v));

const LIST_SELECT = `
  SELECT p.product_id, p.name, p.sku, p.barcode, p.unit, p.category_id, c.name AS category_name, p.supplier_id,
         p.selling_price_paise, p.purchase_price_paise, p.tax_rate, p.hsn_sac, p.min_stock, p.status, p.description, p.track_inventory,
         d.product_type, d.manufacturer, d.mrp_paise, d.batch_tracking, d.expiry_tracking, d.serial_tracking,
         d.prescription_required, d.fefo_required, d.warranty_applicable, d.warranty_months, d.service_trackable,
         d.schedule_class, d.salt_composition, d.strength, d.dosage_form`;
const LIST_FROM = `FROM products p LEFT JOIN categories c ON c.category_id = p.category_id LEFT JOIN pharmacy_item_details d ON d.product_id = p.product_id`;

const shape = (r, stock) => ({
  product_id: r.product_id, name: r.name, sku: r.sku, barcode: r.barcode, unit: r.unit, status: r.status, description: r.description,
  category_id: r.category_id, category: r.category_name, supplier_id: r.supplier_id,
  hsn_sac: r.hsn_sac, tax_rate: Number(r.tax_rate), purchase_price: paise(r.purchase_price_paise), selling_price: paise(r.selling_price_paise),
  reorder_level: Number(r.min_stock), track_inventory: r.track_inventory,
  product_type: r.product_type || 'OTHER', manufacturer: r.manufacturer, mrp: paise(r.mrp_paise),
  batch_tracking: Boolean(r.batch_tracking), expiry_tracking: Boolean(r.expiry_tracking), serial_tracking: Boolean(r.serial_tracking),
  prescription_required: Boolean(r.prescription_required), fefo_required: Boolean(r.fefo_required),
  warranty_applicable: Boolean(r.warranty_applicable), warranty_months: r.warranty_months == null ? null : Number(r.warranty_months),
  service_trackable: Boolean(r.service_trackable), schedule_class: r.schedule_class, salt_composition: r.salt_composition,
  strength: r.strength, dosage_form: r.dosage_form,
  ...(stock ? { on_hand: stock.quantity, reserved: stock.reserved, available: stock.available, low: r.track_inventory && Number(r.min_stock) > 0 && stock.available <= Number(r.min_stock) } : {})
});

const stockFor = async (req, ids) => {
  const out = new Map(ids.map((id) => [id, { quantity: 0, reserved: 0, available: 0 }]));
  if (!ids.length) return out;
  const values = [ids];
  const scope = branchFilter(req.tenant, 'branch_id', values);
  const { rows } = await pool.query(`SELECT product_id, SUM(quantity) AS q, SUM(reserved_qty) AS r FROM branch_stock WHERE product_id = ANY($1::int[])${scope} GROUP BY product_id`, values);
  for (const r of rows) { const q = Number(r.q); const res = Number(r.r || 0); out.set(r.product_id, { quantity: q, reserved: res, available: Math.round((q - res) * 1000) / 1000 }); }
  return out;
};

/* GET /api/pharmacy/products?q=&category_id=&status=&type=&low_stock=1&limit=&offset= */
const list = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const values = [req.tenant.businessId];
  const where = [`p.business_id = $1`];
  const status = String(req.query.status || 'ACTIVE').toUpperCase();
  if (status !== 'ALL') { values.push(status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE'); where.push(`p.status = $${values.length}`); }
  if (req.query.category_id) { values.push(Number(req.query.category_id) || 0); where.push(`p.category_id = $${values.length}`); }
  if (req.query.type) { values.push(String(req.query.type).toUpperCase()); where.push(`d.product_type = $${values.length}`); }
  if (req.query.q) {
    const term = String(req.query.q).trim().slice(0, 80);
    values.push(like(term)); const f = values.length; values.push(term); const e = values.length;
    where.push(`(p.name ILIKE $${f} OR p.sku ILIKE $${f} OR p.barcode = $${e} OR d.manufacturer ILIKE $${f} OR d.salt_composition ILIKE $${f})`);
  }
  if (req.query.low_stock === '1' || req.query.low_stock === 'true') {
    const scopeVals = []; const sc = branchFilter(req.tenant, 'bs.branch_id', scopeVals);
    scopeVals.forEach((v) => values.push(v));
    const shifted = sc.replace(/\$(\d+)/g, (_, n) => `$${values.length - scopeVals.length + Number(n)}`);
    where.push(`p.track_inventory AND p.min_stock > 0 AND COALESCE((SELECT SUM(bs.quantity - bs.reserved_qty) FROM branch_stock bs WHERE bs.product_id = p.product_id${shifted}), 0) <= p.min_stock`);
  }
  const base = `${LIST_FROM} WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(`${LIST_SELECT} ${base} ORDER BY p.name LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  const stock = await stockFor(req, rows.map((r) => r.product_id));
  page(res, rows.map((r) => shape(r, stock.get(r.product_id))), total, pg);
};

const loadOne = async (req, id) => {
  const r = (await pool.query(`${LIST_SELECT} ${LIST_FROM} WHERE p.business_id = $1 AND p.product_id = $2`, [req.tenant.businessId, id])).rows[0];
  if (!r) return null;
  const stock = (await stockFor(req, [r.product_id])).get(r.product_id);
  return shape(r, stock);
};

const get = async (req, res) => {
  const p = await loadOne(req, req.params.id);
  if (!p) throw new PharmacyError(404, 'Not found');
  ok(res, p);
};

/* GET /api/pharmacy/products/lookup?q= — barcode, SKU or name. For POS, GRN and dispensing search. */
const lookup = async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 64);
  if (!q) return ok(res, []);
  const values = [req.tenant.businessId, q, like(q)];
  const rows = (await pool.query(
    `${LIST_SELECT} ${LIST_FROM} WHERE p.business_id = $1 AND p.status = 'ACTIVE' AND (p.barcode = $2 OR p.sku = $2 OR p.name ILIKE $3 OR p.sku ILIKE $3)
     ORDER BY (p.barcode = $2 OR p.sku = $2) DESC, p.name LIMIT 12`, values)).rows;
  const stock = await stockFor(req, rows.map((r) => r.product_id));
  ok(res, rows.map((r) => shape(r, stock.get(r.product_id))));
};

/* ── create / update ──────────────────────────────────────────────────────────────────────── */

const fields = (body, { partial, existing = null }) => {
  const p = {}; const d = {};
  if (!partial || 'name' in body) p.name = text(body.name, 'Product name', { max: 160, min: 2, required: true });
  if ('sku' in body) p.sku = text(body.sku, 'SKU', { max: 64 });
  if ('barcode' in body) p.barcode = text(body.barcode, 'Barcode', { max: 64 });
  if (!partial || 'unit' in body) p.unit = text(body.unit ?? 'pcs', 'Unit', { max: 24, required: true });
  if ('description' in body) p.description = text(body.description, 'Description', { max: 1000 });
  if ('hsn_sac' in body) p.hsn_sac = text(body.hsn_sac, 'HSN/SAC code', { max: 16 });
  if (!partial || 'tax_rate' in body) p.tax_rate = num(body.tax_rate ?? 0, 'GST rate', { min: 0, max: 100, required: true });
  if ('purchase_price' in body) p.purchase_price_paise = money(body.purchase_price, 'Purchase price', { min: 0 }) ?? 0;
  if ('selling_price' in body) p.selling_price_paise = money(body.selling_price, 'Selling price', { min: 0, required: true });
  if ('status' in body) p.status = oneOf(body.status, 'Status', ['ACTIVE', 'ARCHIVED'], { required: true });
  if ('reorder_level' in body) p.min_stock = num(body.reorder_level, 'Reorder level', { min: 0, max: 100000000 }) ?? 0;
  if ('category_id' in body) p.category_id = int(body.category_id, 'Category', { min: 1 });
  if ('track_inventory' in body) p.track_inventory = bool(body.track_inventory);

  if ('product_type' in body) d.product_type = oneOf(body.product_type, 'Product type', PRODUCT_TYPES, { fallback: 'OTHER' });
  if ('manufacturer' in body) d.manufacturer = text(body.manufacturer, 'Manufacturer', { max: 120 });
  if ('mrp' in body) d.mrp_paise = body.mrp === null || body.mrp === '' ? null : money(body.mrp, 'MRP', { min: 0 });
  for (const k of ['batch_tracking', 'expiry_tracking', 'serial_tracking', 'prescription_required', 'fefo_required', 'warranty_applicable', 'service_trackable']) {
    if (k in body) d[k] = bool(body[k]);
  }
  // expiry belongs to a batch: turning expiry on without an explicit batch choice turns batch tracking on too
  if (d.expiry_tracking && d.batch_tracking === undefined && !existing?.batch_tracking) d.batch_tracking = true;
  if ('warranty_months' in body) d.warranty_months = body.warranty_months === null || body.warranty_months === '' ? null : int(body.warranty_months, 'Warranty length', { min: 1, max: 600 });
  if ('schedule_class' in body) d.schedule_class = text(body.schedule_class, 'Schedule', { max: 8 });
  if ('salt_composition' in body) d.salt_composition = text(body.salt_composition, 'Composition', { max: 300 });
  if ('strength' in body) d.strength = text(body.strength, 'Strength', { max: 40 });
  if ('dosage_form' in body) d.dosage_form = text(body.dosage_form, 'Dosage form', { max: 40 });
  return { p, d };
};

const writeDetails = async (client, businessId, productId, d) => {
  const keys = Object.keys(d);
  if (!keys.length) return;
  await client.query(
    `INSERT INTO pharmacy_item_details (product_id, business_id, ${keys.join(', ')}) VALUES ($1,$2,${keys.map((_, i) => `$${i + 3}`).join(',')})
     ON CONFLICT (product_id) DO UPDATE SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = CURRENT_TIMESTAMP`, [productId, businessId, ...keys.map((k) => d[k])]);
};

const conflict = (error) => {
  if (error.code === '23505') throw new PharmacyError(409, error.constraint?.includes('sku') ? 'Another product already has that SKU' : error.constraint?.includes('barcode') ? 'Another product already has that barcode' : 'That already exists');
  throw error;
};

/* POST /api/pharmacy/products */
const create = async (req, res) => {
  const body = req.body || {};
  const { p, d } = fields(body, { partial: false });
  if (p.category_id != null && !(await pool.query(`SELECT 1 FROM categories WHERE category_id = $1 AND business_id = $2`, [p.category_id, req.tenant.businessId])).rowCount) throw new PharmacyError(400, 'Choose a category from your own list');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cols = { ...p, selling_price_paise: p.selling_price_paise ?? 0, purchase_price_paise: p.purchase_price_paise ?? 0, track_inventory: body.track_inventory !== false };
    const keys = Object.keys(cols);
    const id = (await client.query(`INSERT INTO products (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING product_id`, [req.tenant.businessId, ...keys.map((k) => cols[k])])).rows[0].product_id;
    await writeDetails(client, req.tenant.businessId, id, d);
    await client.query('COMMIT');
    audit(req, 'pharmacy.product_created', 'product', id, null, { name: p.name, sku: p.sku ?? null, type: d.product_type ?? null });
    ok(res, await loadOne(req, id), 201);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    conflict(error);
  } finally { client.release(); }
};

/* PUT /api/pharmacy/products/:id — only the fields sent change */
const update = async (req, res) => {
  const body = req.body || {};
  const before = await loadOne(req, req.params.id);
  if (!before) throw new PharmacyError(404, 'Not found');
  const { p, d } = fields(body, { partial: true, existing: before });
  if (p.category_id != null && !(await pool.query(`SELECT 1 FROM categories WHERE category_id = $1 AND business_id = $2`, [p.category_id, req.tenant.businessId])).rowCount) throw new PharmacyError(400, 'Choose a category from your own list');
  if (!Object.keys(p).length && !Object.keys(d).length) throw new PharmacyError(400, 'Nothing to update');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pk = Object.keys(p);
    if (pk.length) await client.query(`UPDATE products SET ${pk.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE product_id = $1 AND business_id = $2`, [before.product_id, req.tenant.businessId, ...pk.map((k) => p[k])]);
    await writeDetails(client, req.tenant.businessId, before.product_id, d);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    conflict(error);
  } finally { client.release(); }
  const after = await loadOne(req, before.product_id);
  const changes = diff(before, after);
  if (Object.keys(changes).length) audit(req, 'pharmacy.product_updated', 'product', before.product_id, null, null, { name: after.name, changes });
  ok(res, after);
};

/* ── categories (flat — pharmacy doesn't need wholesale's subcategory layer) ────────────────── */

const categories = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.category_id, c.name, (SELECT COUNT(*)::int FROM products p WHERE p.business_id = c.business_id AND p.category_id = c.category_id) AS products
     FROM categories c WHERE c.business_id = $1 ORDER BY lower(c.name)`, [req.tenant.businessId]);
  ok(res, rows);
};
const createCategory = async (req, res) => {
  const name = text(req.body?.name, 'Category name', { max: 120, min: 2, required: true });
  if ((await pool.query(`SELECT 1 FROM categories WHERE business_id = $1 AND lower(name) = lower($2)`, [req.tenant.businessId, name])).rowCount) throw new PharmacyError(409, `You already have ${name}`);
  const row = (await pool.query(`INSERT INTO categories (business_id, name) VALUES ($1,$2) RETURNING category_id, name`, [req.tenant.businessId, name])).rows[0];
  audit(req, 'pharmacy.category_created', 'category', row.category_id, null, row);
  ok(res, row, 201);
};

export default wrapAll({ list, get, create, update, lookup, categories, createCategory });
