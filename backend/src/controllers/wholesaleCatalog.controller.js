/*
 * Wholesale products and pricing.
 *
 * A product is still a `products` row — stock, tax, barcodes, invoices and every existing screen keep working. The
 * wholesale half (manufacturer, price tiers, MOQ, tracking, units) lives in wholesale_item_details and
 * wholesale_product_units. Stock is in the product's BASE unit; a selling unit is a multiple of it.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { branchFilter } from '../utils/scope.js';
import { visibleCustomer } from './wholesaleParties.controller.js';
import { priceLines } from '../modules/wholesale/pricing.js';
import { loadUnits } from '../modules/wholesale/units.js';
import {
  WholesaleError, audit, bool, diff, idList, int, like, money, num, ok, oneOf, page, paging, text, wrapAll
} from '../modules/wholesale/common.js';

const KINDS = ['DISH', 'INGREDIENT', 'PACKAGING'];
const paise = (v) => (v == null ? null : toRupees(v));

const LIST_SELECT = `
  SELECT p.product_id, p.name, p.sku, p.barcode, p.unit, p.category_id, c.name AS category_name, p.brand_id, b.name AS brand_name, p.supplier_id,
         p.selling_price_paise, p.purchase_price_paise, p.tax_rate, p.hsn_sac, p.min_stock, p.status, p.image_url, p.description, p.track_inventory,
         d.subcategory_id, sc.name AS subcategory_name, d.manufacturer, d.mrp_paise, d.distributor_price_paise, d.wholesale_price_paise, d.retailer_price_paise,
         COALESCE(d.moq, 1) AS moq, d.max_stock, COALESCE(d.batch_tracking, FALSE) AS batch_tracking, COALESCE(d.expiry_tracking, FALSE) AS expiry_tracking,
         COALESCE(d.serial_tracking, FALSE) AS serial_tracking, d.sale_unit, d.purchase_unit,
         d.principal_id, pr.name AS principal_name, d.principal_price_paise, d.pack_size`;
const LIST_FROM = `
  FROM products p LEFT JOIN categories c ON c.category_id = p.category_id LEFT JOIN brands b ON b.brand_id = p.brand_id
  LEFT JOIN wholesale_item_details d ON d.product_id = p.product_id LEFT JOIN categories sc ON sc.category_id = d.subcategory_id
  LEFT JOIN dist_principals pr ON pr.principal_id = d.principal_id`;

const shape = (r, stock, units) => ({
  product_id: r.product_id, name: r.name, sku: r.sku, barcode: r.barcode, unit: r.unit, status: r.status, image_url: r.image_url, description: r.description,
  category_id: r.category_id, category: r.category_name, subcategory_id: r.subcategory_id, subcategory: r.subcategory_name, brand_id: r.brand_id, brand: r.brand_name, manufacturer: r.manufacturer, supplier_id: r.supplier_id,
  hsn_sac: r.hsn_sac, tax_rate: Number(r.tax_rate), purchase_price: paise(r.purchase_price_paise), selling_price: paise(r.selling_price_paise),
  mrp: paise(r.mrp_paise), distributor_price: paise(r.distributor_price_paise), wholesale_price: paise(r.wholesale_price_paise ?? r.selling_price_paise), retailer_price: paise(r.retailer_price_paise),
  moq: Number(r.moq), reorder_level: Number(r.min_stock), max_stock: r.max_stock == null ? null : Number(r.max_stock),
  batch_tracking: r.batch_tracking, expiry_tracking: r.expiry_tracking, serial_tracking: r.serial_tracking, track_inventory: r.track_inventory,
  sale_unit: r.sale_unit, purchase_unit: r.purchase_unit,
  principal_id: r.principal_id ?? null, principal: r.principal_name ?? null, principal_price: paise(r.principal_price_paise), pack_size: r.pack_size ?? null,
  ...(stock ? { on_hand: stock.quantity, reserved: stock.reserved, available: stock.available, low: r.track_inventory && stock.available <= Number(r.min_stock) } : {}),
  ...(units ? { units: units.map((u) => ({ unit_name: u.name, factor: u.factor, barcode: u.barcode })) } : {})
});

const stockFor = async (req, ids) => {
  const out = new Map(ids.map((id) => [id, { quantity: 0, reserved: 0, available: 0 }]));
  if (!ids.length) return out;
  const values = [ids];
  const scope = branchFilter(req.tenant, 'branch_id', values);
  const { rows } = await pool.query(`SELECT product_id, SUM(quantity) AS q, SUM(reserved_qty) AS r FROM branch_stock WHERE product_id = ANY($1::int[])${scope} GROUP BY product_id`, values);
  for (const r of rows) { const q = Number(r.q); const res = Number(r.r); out.set(r.product_id, { quantity: q, reserved: res, available: Math.round((q - res) * 1000) / 1000 }); }
  return out;
};

/* GET /api/wholesale/products?q=&category_id=&brand_id=&status=&low_stock=1&tracked=batch|expiry|serial&limit=&offset= */
const list = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const values = [req.tenant.businessId];
  const where = [`p.business_id = $1`, `p.kind IN ('DISH','INGREDIENT','PACKAGING')`];
  const status = String(req.query.status || 'ACTIVE').toUpperCase();
  if (status !== 'ALL') { values.push(status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE'); where.push(`p.status = $${values.length}`); }
  if (req.query.category_id) { values.push(Number(req.query.category_id) || 0); where.push(`(p.category_id = $${values.length} OR d.subcategory_id = $${values.length})`); }
  if (req.query.principal_id) { values.push(Number(req.query.principal_id) || 0); where.push(`d.principal_id = $${values.length}`); }
  if (req.query.brand_id) { values.push(Number(req.query.brand_id) || 0); where.push(`p.brand_id = $${values.length}`); }
  if (req.query.q) {
    const term = String(req.query.q).trim().slice(0, 80);
    values.push(like(term)); const f = values.length; values.push(term); const e = values.length;
    where.push(`(p.name ILIKE $${f} OR p.sku ILIKE $${f} OR p.barcode = $${e} OR d.manufacturer ILIKE $${f}
                 OR EXISTS (SELECT 1 FROM wholesale_product_units u WHERE u.product_id = p.product_id AND u.barcode = $${e}))`);
  }
  if (req.query.tracked) {
    const col = { batch: 'batch_tracking', expiry: 'expiry_tracking', serial: 'serial_tracking' }[String(req.query.tracked)];
    if (col) where.push(`d.${col}`);
  }
  if (req.query.low_stock === '1' || req.query.low_stock === 'true') {
    const scopeVals = []; const sc = branchFilter(req.tenant, 'bs.branch_id', scopeVals);
    scopeVals.forEach((v) => values.push(v));
    const shifted = sc.replace(/\$(\d+)/g, (_, n) => `$${values.length - scopeVals.length + Number(n)}`);
    where.push(`p.track_inventory AND p.min_stock > 0 AND COALESCE((SELECT SUM(bs.quantity - bs.reserved_qty) FROM branch_stock bs WHERE bs.product_id = p.product_id${shifted}), 0) <= p.min_stock`);
  }
  const base = `${LIST_FROM} WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  const order = { name: 'p.name', sku: 'p.sku NULLS LAST', recent: 'p.product_id DESC' }[String(req.query.sort || 'name')] || 'p.name';
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(`${LIST_SELECT} ${base} ORDER BY ${order} LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  const ids = rows.map((r) => r.product_id);
  const stock = await stockFor(req, ids);
  const units = await loadUnits(pool, req.tenant.businessId, ids);
  page(res, rows.map((r) => shape(r, stock.get(r.product_id), [...units.get(r.product_id).units.values()].filter((u) => u.factor !== 1))), total, pg);
};

const loadOne = async (req, id) => {
  const r = (await pool.query(`${LIST_SELECT} ${LIST_FROM} WHERE p.business_id = $1 AND p.product_id = $2 AND p.kind IN ('DISH','INGREDIENT','PACKAGING')`, [req.tenant.businessId, id])).rows[0];
  if (!r) return null;
  const stock = (await stockFor(req, [r.product_id])).get(r.product_id);
  const units = (await loadUnits(pool, req.tenant.businessId, [r.product_id])).get(r.product_id);
  const perWarehouse = (await pool.query(
    `SELECT bs.branch_id, br.name AS warehouse, bs.quantity, bs.reserved_qty, l.code AS bin
     FROM branch_stock bs JOIN branches br ON br.branch_id = bs.branch_id LEFT JOIN wholesale_bin_assignments a ON a.branch_id = bs.branch_id AND a.product_id = bs.product_id
     LEFT JOIN wholesale_locations l ON l.location_id = a.location_id WHERE bs.product_id = $1 AND br.business_id = $2 ORDER BY br.name`, [r.product_id, req.tenant.businessId])).rows;
  return {
    ...shape(r, stock, [...units.units.values()].filter((u) => u.factor !== 1)),
    warehouses: perWarehouse.map((w) => ({ branch_id: w.branch_id, warehouse: w.warehouse, on_hand: Number(w.quantity), reserved: Number(w.reserved_qty), available: Math.round((Number(w.quantity) - Number(w.reserved_qty)) * 1000) / 1000, bin: w.bin }))
  };
};

const get = async (req, res) => {
  const p = await loadOne(req, req.params.id);
  if (!p) throw new WholesaleError(404, 'Not found');
  ok(res, p);
};

/* ── create / update ──────────────────────────────────────────────────────────────────────── */

const cleanUnits = (list, base) => {
  if (list == null) return null;
  if (!Array.isArray(list) || list.length > 8) throw new WholesaleError(400, 'A product can have up to eight extra units');
  const seen = new Set([String(base).toLowerCase()]);
  return list.map((u) => {
    const name = text(u.unit_name, 'Unit name', { max: 24, required: true });
    if (seen.has(name.toLowerCase())) throw new WholesaleError(400, `${name} is listed twice (or is the base unit)`);
    seen.add(name.toLowerCase());
    const factor = num(u.factor, `How many ${base} in a ${name}`, { min: 0.0001, max: 10000000, required: true });
    return { unit_name: name, factor, barcode: text(u.barcode, 'Unit barcode', { max: 64 }) };
  });
};

const fields = async (req, body, { partial, existing = null }) => {
  const p = {}; const d = {};
  if (!partial || 'name' in body) p.name = text(body.name, 'Product name', { max: 160, min: 2, required: true });
  if ('sku' in body) p.sku = text(body.sku, 'SKU', { max: 64 });
  if ('barcode' in body) p.barcode = text(body.barcode, 'Barcode', { max: 64 });
  if (!partial || 'unit' in body) p.unit = text(body.unit ?? 'pcs', 'Base unit', { max: 24, required: true });
  if ('description' in body) p.description = text(body.description, 'Description', { max: 1000 });
  if ('image_url' in body) p.image_url = text(body.image_url, 'Image', { max: 500 });
  if ('hsn_sac' in body) p.hsn_sac = text(body.hsn_sac, 'HSN code', { max: 16 });
  if (!partial || 'tax_rate' in body) p.tax_rate = num(body.tax_rate ?? 0, 'GST rate', { min: 0, max: 100, required: true });
  if ('purchase_price' in body || 'cost_price' in body) p.purchase_price_paise = money(body.purchase_price ?? body.cost_price, 'Purchase price', { min: 0, required: true });
  if ('status' in body) p.status = oneOf(body.status, 'Status', ['ACTIVE', 'ARCHIVED'], { required: true });
  if ('reorder_level' in body) p.min_stock = num(body.reorder_level, 'Reorder level', { min: 0, max: 100000000, required: true });
  for (const k of ['category_id', 'brand_id', 'supplier_id']) {
    if (k in body) {
      const id = int(body[k], k.replace('_id', ''), { min: 1 });
      if (id != null) {
        const table = { category_id: 'categories', brand_id: 'brands', supplier_id: 'suppliers' }[k];
        if (!(await pool.query(`SELECT 1 FROM ${table} WHERE ${k} = $1 AND business_id = $2`, [id, req.tenant.businessId])).rows.length) throw new WholesaleError(400, `Choose a ${k.replace('_id', '')} from your own list`);
      }
      p[k] = id;
    }
  }
  if ('subcategory_id' in body) {
    const id = int(body.subcategory_id, 'Subcategory', { min: 1 });
    if (id != null && !(await pool.query(`SELECT 1 FROM categories WHERE category_id = $1 AND business_id = $2`, [id, req.tenant.businessId])).rows.length) throw new WholesaleError(400, 'Choose a subcategory from your own list');
    d.subcategory_id = id;
  }
  if ('principal_id' in body) {
    const id = int(body.principal_id, 'Principal', { min: 1 });
    if (id != null && !(await pool.query(`SELECT 1 FROM dist_principals WHERE principal_id = $1 AND business_id = $2`, [id, req.tenant.businessId])).rows.length) throw new WholesaleError(400, 'Choose a principal from your own list');
    d.principal_id = id;
  }
  if ('principal_price' in body) d.principal_price_paise = body.principal_price === null || body.principal_price === '' ? null : money(body.principal_price, 'Principal price', { min: 0 });
  if ('pack_size' in body) d.pack_size = text(body.pack_size, 'Pack size', { max: 40 });
  if ('manufacturer' in body) d.manufacturer = text(body.manufacturer, 'Manufacturer', { max: 120 });
  for (const [k, col] of [['mrp', 'mrp_paise'], ['distributor_price', 'distributor_price_paise'], ['wholesale_price', 'wholesale_price_paise'], ['retailer_price', 'retailer_price_paise']]) {
    if (k in body) d[col] = body[k] === null || body[k] === '' ? null : money(body[k], k.replace('_', ' '), { min: 0 });
  }
  if ('moq' in body) d.moq = num(body.moq, 'Minimum order quantity', { min: 0.001, max: 100000000, required: true });
  if ('max_stock' in body) d.max_stock = body.max_stock === null || body.max_stock === '' ? null : num(body.max_stock, 'Maximum stock', { min: 0, max: 100000000 });
  for (const k of ['batch_tracking', 'expiry_tracking', 'serial_tracking']) if (k in body) d[k] = bool(body[k]);
  if (d.expiry_tracking && d.batch_tracking === undefined && !existing?.batch_tracking) d.batch_tracking = true;   // expiry belongs to a batch
  if ('sale_unit' in body) d.sale_unit = text(body.sale_unit, 'Sale unit', { max: 24 });
  if ('purchase_unit' in body) d.purchase_unit = text(body.purchase_unit, 'Purchase unit', { max: 24 });
  // the product's own selling price is the wholesale price (what every existing screen already uses)
  if ('wholesale_price_paise' in d && d.wholesale_price_paise != null) p.selling_price_paise = d.wholesale_price_paise;
  return { p, d };
};

const writeDetails = async (client, businessId, productId, d) => {
  const keys = Object.keys(d);
  if (!keys.length) return;
  await client.query(
    `INSERT INTO wholesale_item_details (product_id, business_id, ${keys.join(', ')}) VALUES ($1,$2,${keys.map((_, i) => `$${i + 3}`).join(',')})
     ON CONFLICT (product_id) DO UPDATE SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = CURRENT_TIMESTAMP`, [productId, businessId, ...keys.map((k) => d[k])]);
};

const writeUnits = async (client, businessId, productId, units) => {
  if (units == null) return;
  await client.query(`DELETE FROM wholesale_product_units WHERE product_id = $1 AND business_id = $2`, [productId, businessId]);
  for (const u of units) await client.query(`INSERT INTO wholesale_product_units (business_id, product_id, unit_name, factor, barcode) VALUES ($1,$2,$3,$4,$5)`, [businessId, productId, u.unit_name, u.factor, u.barcode]);
};

const conflict = (error) => {
  if (error.code === '23505') throw new WholesaleError(409, error.constraint?.includes('sku') ? 'Another product already has that SKU' : error.constraint?.includes('barcode') ? 'Another product already has that barcode' : 'That already exists');
  throw error;
};

/* POST /api/wholesale/products */
const create = async (req, res) => {
  const body = req.body || {};
  const { p, d } = await fields(req, body, { partial: false });
  const units = cleanUnits(body.units, p.unit);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cols = { ...p, selling_price_paise: p.selling_price_paise ?? 0, purchase_price_paise: p.purchase_price_paise ?? 0, kind: 'DISH', track_inventory: body.track_inventory !== false };
    const keys = Object.keys(cols);
    const id = (await client.query(`INSERT INTO products (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING product_id`, [req.tenant.businessId, ...keys.map((k) => cols[k])])).rows[0].product_id;
    await writeDetails(client, req.tenant.businessId, id, d);
    await writeUnits(client, req.tenant.businessId, id, units);
    await client.query('COMMIT');
    audit(req, 'wholesale.product_created', 'product', id, null, { name: p.name, sku: p.sku ?? null });
    ok(res, await loadOne(req, id), 201);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    conflict(error);
  } finally { client.release(); }
};

/* PUT /api/wholesale/products/:id — only the fields sent change; price changes are audited with before/after */
const update = async (req, res) => {
  const body = req.body || {};
  const before = await loadOne(req, req.params.id);
  if (!before) throw new WholesaleError(404, 'Not found');
  const { p, d } = await fields(req, body, { partial: true, existing: before });
  const units = cleanUnits(body.units, p.unit || before.unit);
  if (!Object.keys(p).length && !Object.keys(d).length && units == null) throw new WholesaleError(400, 'Nothing to update');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pk = Object.keys(p);
    if (pk.length) await client.query(`UPDATE products SET ${pk.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE product_id = $1 AND business_id = $2`, [before.product_id, req.tenant.businessId, ...pk.map((k) => p[k])]);
    await writeDetails(client, req.tenant.businessId, before.product_id, d);
    await writeUnits(client, req.tenant.businessId, before.product_id, units);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    conflict(error);
  } finally { client.release(); }
  const after = await loadOne(req, before.product_id);
  const pick = (x) => ({ mrp: x.mrp, distributor_price: x.distributor_price, wholesale_price: x.wholesale_price, retailer_price: x.retailer_price, purchase_price: x.purchase_price, tax_rate: x.tax_rate, moq: x.moq, reorder_level: x.reorder_level, status: x.status, name: x.name, sku: x.sku, units: x.units });
  const changes = diff(pick(before), pick(after));
  const priceKeys = ['mrp', 'distributor_price', 'wholesale_price', 'retailer_price', 'purchase_price'];
  const prices = Object.fromEntries(Object.entries(changes).filter(([k]) => priceKeys.includes(k)));
  if (Object.keys(prices).length) audit(req, 'wholesale.price_changed', 'product', before.product_id, null, null, { name: after.name, changes: prices });
  const rest = Object.fromEntries(Object.entries(changes).filter(([k]) => !priceKeys.includes(k)));
  if (Object.keys(rest).length) audit(req, 'wholesale.product_updated', 'product', before.product_id, null, null, { name: after.name, changes: rest });
  ok(res, after);
};

/* GET /api/wholesale/products/lookup?q= — barcode, SKU or name, for order entry. Matches unit barcodes too. */
const lookup = async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 64);
  if (!q) return ok(res, []);
  const values = [req.tenant.businessId, q, like(q)];
  const rows = (await pool.query(
    `${LIST_SELECT}, u.unit_name AS matched_unit, u.factor AS matched_factor
     ${LIST_FROM} LEFT JOIN wholesale_product_units u ON u.product_id = p.product_id AND u.barcode = $2
     WHERE p.business_id = $1 AND p.status = 'ACTIVE' AND p.kind IN ('DISH','INGREDIENT','PACKAGING')
       AND (p.barcode = $2 OR p.sku = $2 OR u.unit_id IS NOT NULL OR p.name ILIKE $3 OR p.sku ILIKE $3)
     ORDER BY (p.barcode = $2 OR p.sku = $2 OR u.unit_id IS NOT NULL) DESC, p.name LIMIT 12`, values)).rows;
  const stock = await stockFor(req, rows.map((r) => r.product_id));
  const units = await loadUnits(pool, req.tenant.businessId, rows.map((r) => r.product_id));
  ok(res, rows.map((r) => ({ ...shape(r, stock.get(r.product_id), [...units.get(r.product_id).units.values()].filter((u) => u.factor !== 1)), matched_unit: r.matched_unit || null })));
};

/* ── categories (with subcategories) ──────────────────────────────────────────────────────── */

const categories = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.category_id, c.name, c.parent_id, (SELECT COUNT(*)::int FROM products p WHERE p.business_id = c.business_id AND (p.category_id = c.category_id)) AS products
     FROM categories c WHERE c.business_id = $1 ORDER BY lower(c.name)`, [req.tenant.businessId]);
  ok(res, rows);
};
const createCategory = async (req, res) => {
  const name = text(req.body?.name, 'Category name', { max: 120, min: 2, required: true });
  const parent = int(req.body?.parent_id, 'Parent', { min: 1 });
  if (parent && !(await pool.query(`SELECT 1 FROM categories WHERE category_id = $1 AND business_id = $2 AND parent_id IS NULL`, [parent, req.tenant.businessId])).rows.length) throw new WholesaleError(400, 'Choose a top-level category as the parent');
  if ((await pool.query(`SELECT 1 FROM categories WHERE business_id = $1 AND lower(name) = lower($2) AND parent_id IS NOT DISTINCT FROM $3`, [req.tenant.businessId, name, parent])).rows.length) throw new WholesaleError(409, `You already have ${name} there`);
  const row = (await pool.query(`INSERT INTO categories (business_id, name, parent_id) VALUES ($1,$2,$3) RETURNING category_id, name, parent_id`, [req.tenant.businessId, name, parent])).rows[0];
  audit(req, 'wholesale.category_created', 'category', row.category_id, null, row);
  ok(res, row, 201);
};
const renameCategory = async (req, res) => {
  const name = text(req.body?.name, 'Category name', { max: 120, min: 2, required: true });
  const row = (await pool.query(`UPDATE categories SET name = $3 WHERE category_id = $1 AND business_id = $2 RETURNING category_id, name, parent_id`, [req.params.id, req.tenant.businessId, name])).rows[0];
  if (!row) throw new WholesaleError(404, 'Not found');
  audit(req, 'wholesale.category_renamed', 'category', row.category_id, null, row);
  ok(res, row);
};

/* ── price lists ──────────────────────────────────────────────────────────────────────────── */

const CUSTOMER_TYPES = ['RETAILER', 'DEALER', 'DISTRIBUTOR', 'BUSINESS', 'CORPORATE', 'OTHER'];

const listShape = (r) => ({ list_id: r.list_id, name: r.name, kind: r.kind, customer_type: r.customer_type, starts_on: r.starts_on, ends_on: r.ends_on, is_active: r.is_active, notes: r.notes, items: r.items == null ? undefined : Number(r.items), customers: r.customers == null ? undefined : Number(r.customers), is_default: Boolean(r.is_default) });

const priceLists = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT l.*, (SELECT COUNT(*) FROM wholesale_price_list_items i WHERE i.list_id = l.list_id) AS items,
            (SELECT COUNT(*) FROM wholesale_customer_profiles w WHERE w.price_list_id = l.list_id) AS customers,
            (s.default_price_list_id = l.list_id) AS is_default
     FROM wholesale_price_lists l LEFT JOIN wholesale_settings s ON s.business_id = l.business_id WHERE l.business_id = $1 ORDER BY l.is_active DESC, l.kind, lower(l.name)`, [req.tenant.businessId]);
  ok(res, rows.map(listShape));
};

const listFields = (body, partial) => {
  const f = {};
  if (!partial || 'name' in body) f.name = text(body.name, 'Name', { max: 80, min: 2, required: true });
  if ('kind' in body) f.kind = oneOf(body.kind, 'Kind', ['STANDARD', 'PROMOTION'], { required: true });
  if ('customer_type' in body) f.customer_type = body.customer_type ? oneOf(body.customer_type, 'Customer type', CUSTOMER_TYPES) : null;
  if ('starts_on' in body) f.starts_on = text(body.starts_on, 'Start date', { max: 10 }) || null;
  if ('ends_on' in body) f.ends_on = text(body.ends_on, 'End date', { max: 10 }) || null;
  if ('is_active' in body) f.is_active = bool(body.is_active);
  if ('notes' in body) f.notes = text(body.notes, 'Notes', { max: 300 });
  if (f.starts_on && f.ends_on && f.ends_on < f.starts_on) throw new WholesaleError(400, 'The end date is before the start date');
  return f;
};

const createList = async (req, res) => {
  const f = listFields(req.body || {}, false);
  const keys = Object.keys(f);
  try {
    const row = (await pool.query(`INSERT INTO wholesale_price_lists (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`, [req.tenant.businessId, ...keys.map((k) => f[k])])).rows[0];
    audit(req, 'wholesale.price_list_created', 'price_list', row.list_id, null, { name: row.name, kind: row.kind });
    ok(res, listShape(row), 201);
  } catch (error) { if (error.code === '23505') throw new WholesaleError(409, 'You already have a price list with that name'); throw error; }
};

const updateList = async (req, res) => {
  const before = (await pool.query(`SELECT * FROM wholesale_price_lists WHERE list_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!before) throw new WholesaleError(404, 'Not found');
  const f = listFields(req.body || {}, true);
  const keys = Object.keys(f);
  if (!keys.length && !('make_default' in (req.body || {}))) throw new WholesaleError(400, 'Nothing to update');
  let after = before;
  if (keys.length) {
    try { after = (await pool.query(`UPDATE wholesale_price_lists SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE list_id = $1 AND business_id = $2 RETURNING *`, [before.list_id, req.tenant.businessId, ...keys.map((k) => f[k])])).rows[0]; }
    catch (error) { if (error.code === '23505') throw new WholesaleError(409, 'You already have a price list with that name'); throw error; }
  }
  if ('make_default' in req.body) {
    await pool.query(`INSERT INTO wholesale_settings (business_id, default_price_list_id) VALUES ($1,$2) ON CONFLICT (business_id) DO UPDATE SET default_price_list_id = $2, updated_at = CURRENT_TIMESTAMP`, [req.tenant.businessId, req.body.make_default ? before.list_id : null]);
  }
  audit(req, 'wholesale.price_list_changed', 'price_list', before.list_id, null, null, { name: after.name, changes: diff(listShape(before), listShape(after)) });
  ok(res, listShape(after));
};

const itemShape = (r) => ({ item_id: r.item_id, product_id: r.product_id, product: r.product_name ?? null, sku: r.sku ?? null, category_id: r.category_id, category: r.category_name ?? null, unit_name: r.unit_name, min_qty: Number(r.min_qty), price: paise(r.price_paise), discount_pct: r.discount_pct == null ? null : Number(r.discount_pct) });

const listItems = async (req, res) => {
  const list = (await pool.query(`SELECT * FROM wholesale_price_lists WHERE list_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!list) throw new WholesaleError(404, 'Not found');
  const pg = paging(req.query, { max: 500, fallback: 100 });
  const values = [list.list_id]; let where = 'i.list_id = $1';
  if (req.query.q) { values.push(like(String(req.query.q).slice(0, 80))); where += ` AND (p.name ILIKE $${values.length} OR p.sku ILIKE $${values.length} OR c.name ILIKE $${values.length})`; }
  const base = `FROM wholesale_price_list_items i LEFT JOIN products p ON p.product_id = i.product_id LEFT JOIN categories c ON c.category_id = i.category_id WHERE ${where}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(`SELECT i.*, p.name AS product_name, p.sku, c.name AS category_name ${base} ORDER BY COALESCE(p.name, c.name), i.min_qty LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  page(res, rows.map(itemShape), total, pg);
};

/** One rule: a price or a % off, for a product or a category, with a quantity break. Shared by lists and customer prices. */
export const cleanRule = async (businessId, r) => {
  const productId = int(r.product_id, 'Product', { min: 1 }); const categoryId = int(r.category_id, 'Category', { min: 1 });
  if ((productId == null) === (categoryId == null)) throw new WholesaleError(400, 'Each rule is for one product or one category');
  const price = r.price == null || r.price === '' ? null : money(r.price, 'Price', { min: 0 });
  const disc = r.discount_pct == null || r.discount_pct === '' ? null : num(r.discount_pct, 'Discount', { min: 0, max: 100 });
  if ((price == null) === (disc == null)) throw new WholesaleError(400, 'Give either a price or a discount percentage');
  const unit = text(r.unit_name, 'Unit', { max: 24 });
  if (productId) {
    const units = await loadUnits(pool, businessId, [productId]);
    const entry = units.get(productId);
    if (!entry) throw new WholesaleError(400, 'Product not found');
    if (unit && !entry.units.has(unit.toLowerCase())) throw new WholesaleError(400, `That product is not sold in ${unit}`);
  } else if (!(await pool.query(`SELECT 1 FROM categories WHERE category_id = $1 AND business_id = $2`, [categoryId, businessId])).rows.length) throw new WholesaleError(400, 'Category not found');
  return { product_id: productId, category_id: categoryId, unit_name: unit, min_qty: num(r.min_qty ?? 1, 'Minimum quantity', { min: 0.001, max: 100000000 }), price_paise: price, discount_pct: disc };
};

/* PUT /api/wholesale/price-lists/:id/items { items: [...], replace?: true } — add (or replace) the rules in bulk */
const setItems = async (req, res) => {
  const list = (await pool.query(`SELECT * FROM wholesale_price_lists WHERE list_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!list) throw new WholesaleError(404, 'Not found');
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items || items.length > 5000) throw new WholesaleError(400, 'Send up to 5,000 rules at a time');
  const rules = []; for (const r of items) rules.push(await cleanRule(req.tenant.businessId, r));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (req.body.replace) await client.query(`DELETE FROM wholesale_price_list_items WHERE list_id = $1`, [list.list_id]);
    for (const r of rules) {
      // the same product / category / unit / break is one rule: writing it again changes it
      await client.query(`DELETE FROM wholesale_price_list_items WHERE list_id = $1 AND product_id IS NOT DISTINCT FROM $2 AND category_id IS NOT DISTINCT FROM $3 AND unit_name IS NOT DISTINCT FROM $4 AND min_qty = $5`, [list.list_id, r.product_id, r.category_id, r.unit_name, r.min_qty]);
      await client.query(`INSERT INTO wholesale_price_list_items (list_id, business_id, product_id, category_id, unit_name, min_qty, price_paise, discount_pct) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [list.list_id, req.tenant.businessId, r.product_id, r.category_id, r.unit_name, r.min_qty, r.price_paise, r.discount_pct]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  audit(req, 'wholesale.price_list_items_set', 'price_list', list.list_id, null, null, { name: list.name, rules: rules.length, replaced: Boolean(req.body.replace) });
  ok(res, { list_id: list.list_id, rules: rules.length });
};

const removeItem = async (req, res) => {
  const r = (await pool.query(`DELETE FROM wholesale_price_list_items WHERE item_id = $1 AND list_id = $2 AND business_id = $3 RETURNING item_id`, [req.params.itemId, req.params.id, req.tenant.businessId])).rows[0];
  if (!r) throw new WholesaleError(404, 'Not found');
  audit(req, 'wholesale.price_list_item_removed', 'price_list', req.params.id, null, null, { item_id: r.item_id });
  ok(res, { deleted: true });
};

/* ── customer-specific prices ─────────────────────────────────────────────────────────────── */

const customerPrices = async (req, res) => {
  await visibleCustomer(req, req.params.id);
  const own = (await pool.query(`SELECT 1 FROM customers WHERE customer_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows.length;
  if (!own) throw new WholesaleError(404, 'Not found');
  const rows = (await pool.query(
    `SELECT w.*, p.name AS product_name, p.sku, c.name AS category_name FROM wholesale_customer_prices w LEFT JOIN products p ON p.product_id = w.product_id LEFT JOIN categories c ON c.category_id = w.category_id
     WHERE w.business_id = $1 AND w.customer_id = $2 ORDER BY COALESCE(p.name, c.name), w.min_qty`, [req.tenant.businessId, req.params.id])).rows;
  ok(res, rows.map((r) => ({ ...itemShape({ ...r, item_id: r.price_id }), starts_on: r.starts_on, ends_on: r.ends_on, price_id: r.price_id })));
};

const setCustomerPrices = async (req, res) => {
  const own = (await pool.query(`SELECT name FROM customers WHERE customer_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!own) throw new WholesaleError(404, 'Not found');
  const items = Array.isArray(req.body?.items) ? req.body.items : null;
  if (!items || items.length > 2000) throw new WholesaleError(400, 'Send up to 2,000 prices at a time');
  const rules = [];
  for (const r of items) rules.push({ ...(await cleanRule(req.tenant.businessId, r)), starts_on: text(r.starts_on, 'Start', { max: 10 }) || null, ends_on: text(r.ends_on, 'End', { max: 10 }) || null });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (req.body.replace) await client.query(`DELETE FROM wholesale_customer_prices WHERE business_id = $1 AND customer_id = $2`, [req.tenant.businessId, req.params.id]);
    for (const r of rules) {
      await client.query(`DELETE FROM wholesale_customer_prices WHERE business_id = $1 AND customer_id = $2 AND product_id IS NOT DISTINCT FROM $3 AND category_id IS NOT DISTINCT FROM $4 AND unit_name IS NOT DISTINCT FROM $5 AND min_qty = $6`, [req.tenant.businessId, req.params.id, r.product_id, r.category_id, r.unit_name, r.min_qty]);
      await client.query(`INSERT INTO wholesale_customer_prices (business_id, customer_id, product_id, category_id, unit_name, min_qty, price_paise, discount_pct, starts_on, ends_on) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [req.tenant.businessId, req.params.id, r.product_id, r.category_id, r.unit_name, r.min_qty, r.price_paise, r.discount_pct, r.starts_on, r.ends_on]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  audit(req, 'wholesale.customer_prices_set', 'customer', req.params.id, null, null, { customer: own.name, rules: rules.length });
  ok(res, { rules: rules.length });
};

const removeCustomerPrice = async (req, res) => {
  const r = (await pool.query(`DELETE FROM wholesale_customer_prices WHERE price_id = $1 AND customer_id = $2 AND business_id = $3 RETURNING price_id`, [req.params.priceId, req.params.id, req.tenant.businessId])).rows[0];
  if (!r) throw new WholesaleError(404, 'Not found');
  audit(req, 'wholesale.customer_price_removed', 'customer', req.params.id, null, null, { price_id: r.price_id });
  ok(res, { deleted: true });
};

/* POST /api/wholesale/pricing/quote { customer_id?, lines: [{ product_id, unit_name?, quantity }] } — the price each line would get */
const quote = async (req, res) => {
  const lines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  if (!lines.length || lines.length > 300) throw new WholesaleError(400, 'Send between 1 and 300 lines');
  const customerId = int(req.body.customer_id, 'Customer', { min: 1 });
  if (customerId && !(await pool.query(`SELECT 1 FROM customers WHERE customer_id = $1 AND business_id = $2`, [customerId, req.tenant.businessId])).rows.length) throw new WholesaleError(400, 'Customer not found');
  const clean = lines.map((l) => ({ product_id: int(l.product_id, 'Product', { min: 1, required: true }), unit_name: l.unit_name || null, quantity: num(l.quantity ?? 1, 'Quantity', { min: 0.001, max: 100000000 }) }));
  const owned = Number((await pool.query(`SELECT COUNT(*) AS n FROM products WHERE business_id = $1 AND product_id = ANY($2::int[])`, [req.tenant.businessId, [...new Set(clean.map((l) => l.product_id))]])).rows[0].n);
  if (owned !== new Set(clean.map((l) => l.product_id)).size) throw new WholesaleError(400, 'One of those products was not found');
  const priced = await priceLines(pool, { businessId: req.tenant.businessId, customerId, lines: clean });
  ok(res, clean.map((l, i) => { const p = priced.get(i); return { ...l, price: toRupees(p.price_paise), source: p.source, unit_name: p.unit_name, factor: p.factor, discount_pct: p.discount_pct, mrp: paise(p.mrp_paise), moq: p.moq, below_moq: p.below_moq }; }));
};

/* POST /api/wholesale/pricing/bulk-update — change many product prices at once; preview first (apply: false) */
const bulkUpdate = async (req, res) => {
  const b = req.body || {};
  const field = oneOf(b.field, 'Price', ['mrp', 'distributor', 'wholesale', 'retailer', 'purchase'], { required: true });
  const mode = oneOf(b.mode, 'How', ['PERCENT', 'AMOUNT', 'SET'], { required: true });
  const value = num(b.value, 'Value', { min: mode === 'SET' ? 0 : -100000000, max: 100000000, required: true });
  const col = { mrp: 'd.mrp_paise', distributor: 'd.distributor_price_paise', wholesale: 'COALESCE(d.wholesale_price_paise, p.selling_price_paise)', retailer: 'd.retailer_price_paise', purchase: 'p.purchase_price_paise' }[field];
  const values = [req.tenant.businessId]; const where = [`p.business_id = $1`, `p.status = 'ACTIVE'`, `p.kind IN ('DISH','INGREDIENT','PACKAGING')`];
  if (b.category_id) { values.push(Number(b.category_id)); where.push(`(p.category_id = $${values.length} OR d.subcategory_id = $${values.length})`); }
  if (b.brand_id) { values.push(Number(b.brand_id)); where.push(`p.brand_id = $${values.length}`); }
  if (Array.isArray(b.product_ids) && b.product_ids.length) { values.push(idList(b.product_ids, 'Products', { max: 5000 })); where.push(`p.product_id = ANY($${values.length}::int[])`); }
  const rows = (await pool.query(`SELECT p.product_id, p.name, ${col} AS current FROM products p LEFT JOIN wholesale_item_details d ON d.product_id = p.product_id WHERE ${where.join(' AND ')} ${field !== 'purchase' ? '' : ''} ORDER BY p.name LIMIT 5001`, values)).rows;
  if (rows.length > 5000) throw new WholesaleError(400, 'That touches more than 5,000 products. Narrow it by category or brand.');
  const next = (cur) => {
    const c = cur == null ? null : Number(cur);
    if (mode === 'SET') return Math.round(value * 100);
    if (c == null) return null;
    return Math.max(0, Math.round(mode === 'PERCENT' ? c * (1 + value / 100) : c + value * 100));
  };
  const changes = rows.map((r) => ({ product_id: r.product_id, name: r.name, from: r.current == null ? null : Number(r.current), to: next(r.current) })).filter((c) => c.to != null && c.to !== c.from);
  if (b.apply !== true) return ok(res, { applied: false, count: changes.length, sample: changes.slice(0, 50).map((c) => ({ ...c, from: paise(c.from), to: paise(c.to) })) });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of changes) {
      if (field === 'purchase') await client.query(`UPDATE products SET purchase_price_paise = $2, updated_at = CURRENT_TIMESTAMP WHERE product_id = $1`, [c.product_id, c.to]);
      else {
        const dcol = { mrp: 'mrp_paise', distributor: 'distributor_price_paise', wholesale: 'wholesale_price_paise', retailer: 'retailer_price_paise' }[field];
        await client.query(`INSERT INTO wholesale_item_details (product_id, business_id, ${dcol}) VALUES ($1,$2,$3) ON CONFLICT (product_id) DO UPDATE SET ${dcol} = EXCLUDED.${dcol}, updated_at = CURRENT_TIMESTAMP`, [c.product_id, req.tenant.businessId, c.to]);
        if (field === 'wholesale') await client.query(`UPDATE products SET selling_price_paise = $2, updated_at = CURRENT_TIMESTAMP WHERE product_id = $1`, [c.product_id, c.to]);
      }
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  audit(req, 'wholesale.bulk_price_update', 'product', null, null, null, { field, mode, value, products: changes.length, category_id: b.category_id ?? null, brand_id: b.brand_id ?? null });
  ok(res, { applied: true, count: changes.length });
};

export default wrapAll({
  list, get, create, update, lookup, categories, createCategory, renameCategory,
  priceLists, createList, updateList, listItems, setItems, removeItem, customerPrices, setCustomerPrices, removeCustomerPrice, quote, bulkUpdate
});
