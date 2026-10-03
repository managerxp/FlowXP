/*
 * Spreadsheet import for a supermarket: products, and stock levels.
 *
 * The screen reads the CSV or Excel file and posts its rows. Every row is checked first (a dry run, nothing written);
 * the import is applied only when every row is good, in one transaction: a half-imported catalogue is worse than none.
 * Errors name the spreadsheet row (the header is row 1) so they can be fixed in the file.
 *
 * Products are matched the way the till finds them: by barcode, then SKU, then ERP code. A new product with no SKU
 * gets a FlowXP SKU like any other; a barcode that already belongs to another product is an error, never a steal.
 */
import { addBarcode, addAlias, cleanAlias, cleanBarcode, cleanCode, IdentityError } from './productIdentity.js';
import { generateSku } from './sku.js';
import { autoSkuOn, getRetailSettings } from './retailSettings.js';
import { moveStock } from './stock.js';
import { addToBatch } from './wholesale/stock.js';
import { defaultBatchNo, StockError, q3 } from './retailStock.js';
import { checkName } from '../utils/validate.js';

export const MAX_ROWS = 5000;

/* A spreadsheet's headers are whatever the owner's last tool called them: accept the usual ones. */
const HEADERS = {
  name: ['name', 'product', 'product_name', 'item', 'item_name', 'description'],
  sku: ['sku', 'item_code', 'product_code'],
  barcode: ['barcode', 'ean', 'upc', 'bar_code', 'barcode_no'],
  erp_code: ['erp_code', 'erp', 'erp_id'],
  category: ['category', 'group', 'department'],
  brand: ['brand', 'company'],
  unit: ['unit', 'uom'],
  mrp: ['mrp', 'maximum_retail_price'],
  selling_price: ['selling_price', 'price', 'sale_price', 'sell_price', 'rate'],
  purchase_price: ['purchase_price', 'cost', 'cost_price', 'buying_price', 'purchase_rate'],
  tax_rate: ['tax_rate', 'gst', 'gst_rate', 'gst_%', 'tax', 'tax_%'],
  hsn: ['hsn', 'hsn_sac', 'hsn_code'],
  min_stock: ['min_stock', 'reorder_level', 'minimum_stock', 'reorder'],
  opening_stock: ['opening_stock', 'stock', 'qty', 'quantity_on_hand'],
  quantity: ['quantity', 'qty', 'counted', 'stock', 'new_stock'],
  track_expiry: ['track_expiry', 'expiry_tracking', 'has_expiry'],
  batch_no: ['batch_no', 'batch', 'batch_number', 'lot'],
  expiry_date: ['expiry_date', 'expiry', 'exp', 'best_before'],
  mfg_date: ['mfg_date', 'manufacturing_date', 'mfd'],
  aliases: ['aliases', 'alternative_names', 'also_called']
};
export const PRODUCT_COLUMNS = ['Name', 'SKU', 'Barcode', 'Category', 'Brand', 'Unit', 'MRP', 'Selling Price', 'Purchase Price', 'Tax Rate', 'HSN', 'Min Stock', 'Opening Stock', 'Track Expiry', 'Batch No', 'Expiry Date', 'ERP Code', 'Aliases'];
export const STOCK_COLUMNS = ['Barcode', 'SKU', 'Quantity', 'Batch No', 'Expiry Date'];

const norm = (k) => String(k).trim().toLowerCase().replace(/[\s-]+/g, '_');
const blank = (v) => v == null || String(v).trim() === '';
const text = (v) => (blank(v) ? '' : String(v).trim());

const pick = (row, field) => {
  for (const key of HEADERS[field]) if (key in row && !blank(row[key])) return row[key];
  return '';
};
const lowerKeys = (raw) => Object.fromEntries(Object.entries(raw || {}).map(([k, v]) => [norm(k), v]));

class RowError extends Error {}
const fail = (message) => { throw new RowError(message); };

const money = (v, label) => {
  if (blank(v)) return null;
  const n = Number(String(v).replace(/[₹,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) fail(`${label} is not an amount`);
  return Math.round(n * 100);
};
const number = (v, label, { min = 0, max = 1e9 } = {}) => {
  if (blank(v)) return null;
  const n = Number(String(v).replace(/,/g, ''));
  if (!Number.isFinite(n) || n < min || n > max) fail(`${label} is not a valid number`);
  return n;
};
const yes = (v) => ['yes', 'y', 'true', '1', 'x'].includes(String(v ?? '').trim().toLowerCase());

/** 2026-12-31, 31/12/2026 or 31-12-2026 (what Indian sheets use) -> 2026-12-31. */
export const isoDate = (v, label) => {
  if (blank(v)) return null;
  const s = String(v).trim();
  let y; let m; let d;
  let hit = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (hit) [, y, m, d] = hit;
  else if ((hit = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) [, d, m, y] = hit;
  else fail(`${label} is not a date (use 2026-12-31 or 31/12/2026)`);
  const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  if (new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) !== iso) fail(`${label} is not a real date`);
  return iso;
};

const rowsOf = (rows) => {
  if (!Array.isArray(rows) || !rows.length) throw new StockError(400, 'The file has no rows');
  if (rows.length > MAX_ROWS) throw new StockError(400, `Import up to ${MAX_ROWS.toLocaleString('en-IN')} rows at a time`);
  return rows;
};

const lookups = async (db, businessId, { barcodes, skus, erps }) => {
  const byBarcode = new Map(); const bySku = new Map(); const byErp = new Map();
  const cols = 'p.product_id, p.name, p.selling_price_paise, p.mrp_paise, p.track_expiry, p.track_inventory';
  if (barcodes.length) for (const r of (await db.query(`SELECT b.barcode, ${cols} FROM product_barcodes b JOIN products p ON p.product_id = b.product_id WHERE b.business_id = $1 AND b.barcode = ANY($2::text[])`, [businessId, barcodes])).rows) byBarcode.set(r.barcode, r);
  if (skus.length) for (const r of (await db.query(`SELECT lower(p.sku) AS k, ${cols} FROM products p WHERE p.business_id = $1 AND p.sku IS NOT NULL AND lower(p.sku) = ANY($2::text[])`, [businessId, skus.map((s) => s.toLowerCase())])).rows) bySku.set(r.k, r);
  if (erps.length) for (const r of (await db.query(`SELECT lower(p.erp_code) AS k, ${cols} FROM products p WHERE p.business_id = $1 AND p.erp_code IS NOT NULL AND lower(p.erp_code) = ANY($2::text[])`, [businessId, erps.map((s) => s.toLowerCase())])).rows) byErp.set(r.k, r);
  return { byBarcode, bySku, byErp };
};

/** The one existing product a row refers to (barcode, then SKU, then ERP code), or an error when its codes name two different products. */
const matchOf = (p, maps) => {
  const found = [p.barcode && maps.byBarcode.get(p.barcode), p.sku && maps.bySku.get(p.sku.toLowerCase()), p.erp_code && maps.byErp.get(p.erp_code.toLowerCase())].filter(Boolean);
  if (new Set(found.map((f) => f.product_id)).size > 1) fail('Its barcode, SKU and ERP code belong to different products');
  return found[0] || null;
};

/* ── products ─────────────────────────────────────────────────────────────────────────────── */

const parseProduct = (raw) => {
  const r = lowerKeys(raw);
  const p = {
    name: text(pick(r, 'name')), sku: text(pick(r, 'sku')), barcode: text(pick(r, 'barcode')), erp_code: text(pick(r, 'erp_code')),
    category: text(pick(r, 'category')), brand: text(pick(r, 'brand')), unit: text(pick(r, 'unit')), hsn: text(pick(r, 'hsn')),
    batch_no: text(pick(r, 'batch_no'))
  };
  const nameProblem = checkName(p.name, 'Name');
  if (nameProblem) fail(nameProblem);
  if (p.sku.length > 64) fail('SKU is up to 64 characters');
  try {
    if (p.barcode) p.barcode = cleanBarcode(p.barcode.replace(/\.0$/, ''));   // a spreadsheet turns 8901719101012 into 8901719101012.0
    if (p.erp_code) p.erp_code = cleanCode(p.erp_code, 'ERP code');
  } catch (e) { if (e instanceof IdentityError) fail(e.message); throw e; }
  p.mrp = money(pick(r, 'mrp'), 'MRP'); p.selling = money(pick(r, 'selling_price'), 'Selling price'); p.purchase = money(pick(r, 'purchase_price'), 'Purchase price');
  p.tax = number(pick(r, 'tax_rate'), 'Tax rate', { max: 100 }); p.min_stock = number(pick(r, 'min_stock'), 'Min stock');
  p.opening = number(pick(r, 'opening_stock'), 'Opening stock');
  const expiryFlag = pick(r, 'track_expiry');
  p.track_expiry = blank(expiryFlag) ? null : yes(expiryFlag);
  p.expiry = isoDate(pick(r, 'expiry_date'), 'Expiry date'); p.mfg = isoDate(pick(r, 'mfg_date'), 'Manufacturing date');
  if (p.expiry && p.track_expiry === null) p.track_expiry = true;   // an expiry date on the row means it is tracked
  p.aliases = text(pick(r, 'aliases')).split(/[|;]/).map((a) => a.trim()).filter(Boolean);
  if (p.aliases.length > 8) fail('Up to 8 alternative names per product');
  try { p.aliases.forEach(cleanAlias); } catch (e) { if (e instanceof IdentityError) fail(e.message); throw e; }
  return p;
};

/**
 * mode: 'create' (a product that already exists is a mistake) or 'upsert' (it is updated: only the columns you fill in
 * change). Opening stock applies to new products only; changing stock of an existing one is a stock count or a stock import.
 */
export const importProducts = async (db, { tenant, userId, rows, mode = 'create', apply = false }) => {
  rowsOf(rows);
  const businessId = tenant.businessId;
  const upsert = mode === 'upsert';
  const parsed = []; const errors = [];
  rows.forEach((raw, i) => { try { parsed.push({ i, p: parseProduct(raw) }); } catch (e) { if (e instanceof RowError) errors.push({ row: i + 2, message: e.message }); else throw e; } });

  const maps = await lookups(db, businessId, {
    barcodes: [...new Set(parsed.map((x) => x.p.barcode).filter(Boolean))], skus: [...new Set(parsed.map((x) => x.p.sku).filter(Boolean))], erps: [...new Set(parsed.map((x) => x.p.erp_code).filter(Boolean))]
  });
  const seen = { barcode: new Map(), sku: new Map(), erp_code: new Map() };
  const plan = [];
  for (const { i, p } of parsed) {
    try {
      for (const [field, key] of [['barcode', p.barcode], ['sku', p.sku.toLowerCase()], ['erp_code', p.erp_code.toLowerCase()]]) {
        if (!key) continue;
        if (seen[field].has(key)) fail(`Its ${field === 'erp_code' ? 'ERP code' : field} is also on row ${seen[field].get(key)}`);
        seen[field].set(key, i + 2);
      }
      const existing = matchOf(p, maps);
      if (existing && !upsert) fail(`Already in your catalogue as "${existing.name}". Choose "Add new products and update ones I already have" to change it.`);
      if (!existing) {
        if (p.selling == null && p.mrp == null) fail('A new product needs a selling price or an MRP');
        if (p.opening > 0 && p.track_expiry && !p.expiry) fail('Add the expiry date: this product tracks expiry');
      }
      const selling = p.selling ?? (existing ? Number(existing.selling_price_paise) : p.mrp);
      const mrp = p.mrp ?? (existing?.mrp_paise != null ? Number(existing.mrp_paise) : null);
      if (mrp != null && selling > mrp) fail('The selling price cannot be above the MRP');
      // a barcode on an existing product's row that another product holds
      if (existing && p.barcode) { const owner = maps.byBarcode.get(p.barcode); if (owner && owner.product_id !== existing.product_id) fail(`Barcode ${p.barcode} belongs to "${owner.name}"`); }
      plan.push({ i, p, existing, selling: p.selling ?? (existing ? null : p.mrp), mrp: p.mrp });
    } catch (e) { if (e instanceof RowError) errors.push({ row: i + 2, message: e.message }); else throw e; }
  }

  errors.sort((a, b) => a.row - b.row);
  const toCreate = plan.filter((x) => !x.existing).length; const toUpdate = plan.length - toCreate;
  const result = { rows: rows.length, to_create: toCreate, to_update: toUpdate, errors: errors.slice(0, 200), total_errors: errors.length, applied: false };
  if (!apply || errors.length) return result;

  const settings = await getRetailSettings(db, businessId);
  const generate = autoSkuOn(tenant, settings);
  const cats = new Map((await db.query(`SELECT category_id, lower(name) AS n FROM categories WHERE business_id = $1`, [businessId])).rows.map((r) => [r.n, r.category_id]));
  const brands = new Map((await db.query(`SELECT brand_id, lower(name) AS n FROM brands WHERE business_id = $1`, [businessId])).rows.map((r) => [r.n, r.brand_id]));
  const ensure = async (map, table, idCol, name) => {
    if (!name) return null;
    const key = name.toLowerCase();
    if (!map.has(key)) map.set(key, (await db.query(`INSERT INTO ${table} (business_id, name) VALUES ($1,$2) RETURNING ${idCol}`, [businessId, name.slice(0, table === 'brands' ? 80 : 120)])).rows[0][idCol]);
    return map.get(key);
  };
  let created = 0; let updated = 0;
  for (const { p, existing, selling } of plan) {
    const categoryId = await ensure(cats, 'categories', 'category_id', p.category);
    const brandId = await ensure(brands, 'brands', 'brand_id', p.brand);
    if (!existing) {
      const sku = p.sku || (generate ? await generateSku(db, { businessId, categoryName: p.category, name: p.name }) : null);
      const id = (await db.query(
        `INSERT INTO products (business_id, category_id, brand_id, name, sku, barcode, unit, selling_price_paise, purchase_price_paise, tax_rate, hsn_sac, track_inventory, current_stock, min_stock, kind, mrp_paise, erp_code, track_expiry)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,0,$12,'DISH',$13,$14,$15) RETURNING product_id`,
        [businessId, categoryId, brandId, p.name, sku, p.barcode || null, p.unit || 'pc', selling ?? 0, p.purchase ?? 0, p.tax ?? 0, p.hsn || null, p.min_stock ?? 0, p.mrp, p.erp_code || null, Boolean(p.track_expiry)])).rows[0].product_id;
      for (const a of p.aliases) await addAlias(db, { businessId, productId: id, alias: a, userId });
      if (p.opening > 0) {
        await moveStock(db, { businessId, branchId: tenant.branchId, productId: id, delta: p.opening });
        await db.query(`INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, notes, created_by) VALUES ($1,$2,$3,'OPENING',$4,'import','Imported from a file',$5)`, [businessId, tenant.branchId, id, p.opening, userId]);
        if (p.track_expiry) await addToBatch(db, { businessId, branchId: tenant.branchId, productId: id, batchNo: p.batch_no || defaultBatchNo(p.expiry), mfgDate: p.mfg, expiryDate: p.expiry, qty: p.opening, costPaise: p.purchase, source: 'OPENING', refType: 'OPENING' });
      }
      created += 1;
    } else {
      const sets = []; const vals = [existing.product_id, businessId];
      const set = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
      set('name', p.name);
      if (p.sku) set('sku', p.sku);
      if (categoryId) set('category_id', categoryId);
      if (brandId) set('brand_id', brandId);
      if (p.unit) set('unit', p.unit);
      if (p.selling != null) set('selling_price_paise', p.selling);
      if (p.purchase != null) set('purchase_price_paise', p.purchase);
      if (p.mrp != null) set('mrp_paise', p.mrp);
      if (p.tax != null) set('tax_rate', p.tax);
      if (p.hsn) set('hsn_sac', p.hsn);
      if (p.min_stock != null) set('min_stock', p.min_stock);
      if (p.erp_code) set('erp_code', p.erp_code);
      if (p.track_expiry != null) set('track_expiry', p.track_expiry);
      await db.query(`UPDATE products SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE product_id = $1 AND business_id = $2`, vals);
      if (p.barcode) { try { await addBarcode(db, { businessId, productId: existing.product_id, barcode: p.barcode, userId }); } catch (e) { if (!(e instanceof IdentityError)) throw e; } }
      for (const a of p.aliases) { try { await addAlias(db, { businessId, productId: existing.product_id, alias: a, userId }); } catch (e) { if (!(e instanceof IdentityError)) throw e; } }
      updated += 1;
    }
  }
  return { ...result, applied: true, created, updated };
};

/* ── stock levels ─────────────────────────────────────────────────────────────────────────── */

/** mode 'add' (this is a delivery: add the quantity) or 'set' (this is what is on the shelf now). */
export const importStock = async (db, { tenant, userId, rows, mode = 'set', apply = false }) => {
  rowsOf(rows);
  if (!['add', 'set'].includes(mode)) throw new StockError(400, 'Mode must be add or set');
  const businessId = tenant.businessId;
  const parsed = []; const errors = [];
  rows.forEach((raw, i) => {
    try {
      const r = lowerKeys(raw);
      const p = { barcode: text(pick(r, 'barcode')).replace(/\.0$/, ''), sku: text(pick(r, 'sku')), qty: number(pick(r, 'quantity'), 'Quantity'), batch: text(pick(r, 'batch_no')), expiry: isoDate(pick(r, 'expiry_date'), 'Expiry date') };
      if (!p.barcode && !p.sku) fail('Give a barcode or a SKU');
      if (p.qty == null) fail('Quantity is missing');
      parsed.push({ i, p });
    } catch (e) { if (e instanceof RowError) errors.push({ row: i + 2, message: e.message }); else throw e; }
  });
  const maps = await lookups(db, businessId, { barcodes: [...new Set(parsed.map((x) => x.p.barcode).filter(Boolean))], skus: [...new Set(parsed.map((x) => x.p.sku).filter(Boolean))], erps: [] });
  const plan = []; const seen = new Set();
  for (const { i, p } of parsed) {
    try {
      const product = (p.barcode && maps.byBarcode.get(p.barcode)) || (p.sku && maps.bySku.get(p.sku.toLowerCase()));
      if (!product) fail(`No product with ${p.barcode ? `barcode ${p.barcode}` : `SKU ${p.sku}`}`);
      if (!product.track_inventory) fail(`${product.name} does not track stock`);
      if (seen.has(product.product_id)) fail(`${product.name} is on another row too`);
      seen.add(product.product_id);
      if (mode === 'add' && product.track_expiry && p.qty > 0 && !p.expiry) fail(`Add the expiry date for ${product.name}`);
      plan.push({ i, p, product });
    } catch (e) { if (e instanceof RowError) errors.push({ row: i + 2, message: e.message }); else throw e; }
  }
  errors.sort((a, b) => a.row - b.row);
  const result = { rows: rows.length, to_update: plan.length, errors: errors.slice(0, 200), total_errors: errors.length, applied: false };
  if (!apply || errors.length) return result;

  let changed = 0;
  for (const { p, product } of plan.sort((a, b) => a.product.product_id - b.product.product_id)) {
    await db.query(`SELECT 1 FROM products WHERE product_id = $1 FOR UPDATE`, [product.product_id]);
    const here = Number((await db.query(`SELECT quantity FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [tenant.branchId, product.product_id])).rows[0]?.quantity ?? 0);
    const delta = mode === 'add' ? q3(p.qty) : q3(p.qty - here);
    if (!delta) continue;
    if (here + delta < 0) throw new StockError(400, `${product.name} would go below zero`);
    await moveStock(db, { businessId, branchId: tenant.branchId, productId: product.product_id, delta });
    await db.query(`INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, notes, created_by) VALUES ($1,$2,$3,'ADJUSTMENT',$4,'import',$5,$6)`,
      [businessId, tenant.branchId, product.product_id, delta, mode === 'add' ? 'Stock import (added)' : 'Stock import (set to file)', userId]);
    if (mode === 'add' && product.track_expiry && delta > 0) await addToBatch(db, { businessId, branchId: tenant.branchId, productId: product.product_id, batchNo: p.batch || defaultBatchNo(p.expiry), expiryDate: p.expiry, qty: delta, source: 'GRN', refType: 'IMPORT' });
    changed += 1;
  }
  return { ...result, applied: true, changed };
};
