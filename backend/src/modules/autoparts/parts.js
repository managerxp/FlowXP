/*
 * The parts catalogue: a part's profile on top of its product row, the numbers it is known by, and finding parts.
 *
 * Creating the product itself (name, SKU, barcode, price, GST, opening stock) is the existing POST /api/products, so identity rules, the MRP ceiling, generated
 * SKUs, audit and the opening-stock ledger entry are exactly the ones every shop gets. This module saves the part profile and part numbers beside it.
 */
import { searchClause } from '../productIdentity.js';
import {
  CLASSIFICATIONS, FITMENT_STATUS, NUMBER_KINDS, PartsError, VEHICLE_TYPES, bool, int, money, num, oneOf, ownedProduct, partKey, text, withRupees
} from './common.js';

const likeEscape = (s) => String(s).replace(/[\\%_]/g, (c) => `\\${c}`);

/* ── part numbers ────────────────────────────────────────────────────────────────────────────────────────────────────── */

export const numbersOf = async (db, businessId, productId) =>
  (await db.query(`SELECT pn_id, number, key, kind, note FROM autoparts_part_numbers WHERE business_id = $1 AND product_id = $2 ORDER BY kind, number`, [businessId, productId])).rows;

/** Add one number to a part. The same number on the same part is a no-op; the same number on ANOTHER part is allowed (an alternate number is often shared) and is reported. */
export const addNumber = async (db, businessId, productId, userId, b) => {
  await ownedProduct(db, businessId, productId);
  const number = text(b.number, 'Part number', { max: 64, required: true });
  const key = partKey(number);
  if (!key) throw new PartsError(400, 'A part number has letters or digits in it');
  const kind = oneOf(b.kind ?? 'ALTERNATE', 'Kind', NUMBER_KINDS, { required: true });
  const row = (await db.query(
    `INSERT INTO autoparts_part_numbers (business_id, product_id, number, key, kind, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (product_id, key, kind) DO UPDATE SET number = EXCLUDED.number, note = COALESCE(EXCLUDED.note, autoparts_part_numbers.note) RETURNING pn_id, number, key, kind, note`,
    [businessId, productId, number, key, kind, text(b.note, 'Note', { max: 120 }), userId])).rows[0];
  const also = (await db.query(
    `SELECT p.product_id, p.name, p.sku FROM autoparts_part_numbers n JOIN products p ON p.product_id = n.product_id WHERE n.business_id = $1 AND n.key = $2 AND n.product_id <> $3 AND p.status = 'ACTIVE' LIMIT 5`, [businessId, key, productId])).rows;
  return { ...row, also_on: also };
};

export const removeNumber = async (db, businessId, productId, pnId) => {
  const n = (await db.query(`DELETE FROM autoparts_part_numbers WHERE pn_id = $1 AND business_id = $2 AND product_id = $3`, [pnId, businessId, productId])).rowCount;
  if (!n) throw new PartsError(404, 'Not found');
};

/* ── the profile ─────────────────────────────────────────────────────────────────────────────────────────────────────── */

const SPEC_LIMIT = 40;
const cleanSpecs = (specs) => {
  if (specs == null) return {};
  if (typeof specs !== 'object' || Array.isArray(specs)) throw new PartsError(400, 'Specifications are a list of names and values');
  const out = {};
  for (const [k, v] of Object.entries(specs)) {
    const key = String(k).trim().slice(0, 40);
    if (!key) continue;
    if (Object.keys(out).length >= SPEC_LIMIT) throw new PartsError(400, `Up to ${SPEC_LIMIT} specifications`);
    out[key] = String(v ?? '').trim().slice(0, 120);
  }
  return out;
};

const optionalInt = (v, label, max) => (v === undefined || v === null || v === '' ? null : int(v, label, { min: 0, max }));

/** Check and clean what a person typed for a part's profile. Nothing is saved, so a create can check it BEFORE it makes the product. `mrpPaise` is the part's MRP, if known. */
export const cleanProfile = async (db, businessId, b, { mrpPaise = null } = {}) => {
  const f = {};
  const has = (k) => b[k] !== undefined;
  if (has('mfr_part_no')) f.mfr_part_no = text(b.mfr_part_no, 'Manufacturer part number', { max: 64 });
  if (has('oem_part_no')) f.oem_part_no = text(b.oem_part_no, 'OEM part number', { max: 64 });
  if (has('classification')) f.classification = oneOf(b.classification, 'Type of part', CLASSIFICATIONS, { required: true });
  if (has('vehicle_type')) f.vehicle_type = oneOf(b.vehicle_type, 'Vehicle type', VEHICLE_TYPES, { required: true });
  if (has('subcategory')) f.subcategory = text(b.subcategory, 'Subcategory', { max: 80 });
  if (has('pack_qty')) f.pack_qty = num(b.pack_qty, 'Pack quantity', { min: 0.001, max: 100000, required: true });
  if (has('max_stock')) f.max_stock = b.max_stock === '' || b.max_stock === null ? null : num(b.max_stock, 'Maximum stock', { min: 0, max: 100000000 });
  if (has('reorder_level')) f.reorder_level = b.reorder_level === '' || b.reorder_level === null ? null : num(b.reorder_level, 'Reorder level', { min: 0, max: 100000000 });
  if (has('preferred_supplier_id')) {
    const id = b.preferred_supplier_id === '' || b.preferred_supplier_id === null ? null : Number(b.preferred_supplier_id);
    if (id && !(await db.query(`SELECT 1 FROM suppliers WHERE supplier_id = $1 AND business_id = $2`, [id, businessId])).rowCount) throw new PartsError(400, 'That supplier does not exist');
    f.preferred_supplier_id = id;
  }
  if (has('specs')) f.specs = JSON.stringify(cleanSpecs(b.specs));
  if (has('weight_g')) f.weight_g = optionalInt(b.weight_g, 'Weight', 100000000);
  if (has('length_mm')) f.length_mm = optionalInt(b.length_mm, 'Length', 100000);
  if (has('width_mm')) f.width_mm = optionalInt(b.width_mm, 'Width', 100000);
  if (has('height_mm')) f.height_mm = optionalInt(b.height_mm, 'Height', 100000);
  if (has('handling')) f.handling = text(b.handling, 'Handling', { max: 200 });
  if (has('wholesale_price')) f.wholesale_price_paise = b.wholesale_price === '' || b.wholesale_price === null ? null : money(b.wholesale_price, 'Wholesale price', { min: 0 });
  if (f.wholesale_price_paise != null && mrpPaise != null && f.wholesale_price_paise > Number(mrpPaise)) throw new PartsError(400, 'The wholesale price cannot be above the MRP');
  if (Array.isArray(b.numbers)) for (const n of b.numbers.slice(0, 40)) { if (!partKey(n?.number)) throw new PartsError(400, 'A part number has letters or digits in it'); oneOf(n.kind ?? 'ALTERNATE', 'Kind', NUMBER_KINDS, { required: true }); }
  return f;
};

/** Save a part's profile (created if it is the first time) and, when given, its numbers (the manufacturer and OEM numbers are kept as numbers too, so they can be searched). */
export const saveProfile = async (db, businessId, productId, userId, b) => {
  const product = await ownedProduct(db, businessId, productId, { lock: true });
  const cur = (await db.query(`SELECT * FROM autoparts_parts WHERE product_id = $1`, [productId])).rows[0];
  const has = (k) => b[k] !== undefined;
  const f = await cleanProfile(db, businessId, b, { mrpPaise: product.mrp_paise });
  const keys = Object.keys(f);
  if (!cur) {
    await db.query(`INSERT INTO autoparts_parts (product_id, business_id${keys.length ? `, ${keys.join(', ')}` : ''}) VALUES ($1,$2${keys.map((_, i) => `,$${i + 3}`).join('')})`, [productId, businessId, ...keys.map((k) => f[k])]);
  } else if (keys.length) {
    await db.query(`UPDATE autoparts_parts SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE product_id = $1`, [productId, ...keys.map((k) => f[k])]);
  }
  // the two main numbers are searchable numbers too
  if (has('mfr_part_no') && f.mfr_part_no) await addNumber(db, businessId, productId, userId, { number: f.mfr_part_no, kind: 'MFR' });
  if (has('oem_part_no') && f.oem_part_no) await addNumber(db, businessId, productId, userId, { number: f.oem_part_no, kind: 'OEM' });
  if (Array.isArray(b.numbers)) for (const n of b.numbers.slice(0, 40)) await addNumber(db, businessId, productId, userId, n);
  return getPart(db, { businessId, scopeBranchId: null }, productId);
};

/* ── reading ─────────────────────────────────────────────────────────────────────────────────────────────────────────── */

/** The stock figure for the outlet being viewed (or the business total). The outlet id comes from the signed-in session, never from the request, and is written as a number. */
const stockSql = (tenant) => {
  if (tenant.scopeBranchId != null) return `COALESCE((SELECT quantity FROM branch_stock bs WHERE bs.product_id = p.product_id AND bs.branch_id = ${Math.trunc(Number(tenant.scopeBranchId))}), 0)`;
  return 'p.current_stock';
};

const shape = (r) => withRupees({
  product_id: r.product_id, name: r.name, sku: r.sku, barcode: r.barcode, status: r.status, unit: r.unit, category_id: r.category_id, category_name: r.category_name ?? null,
  brand_id: r.brand_id, brand_name: r.brand_name ?? null, selling_price_paise: Number(r.selling_price_paise), purchase_price_paise: Number(r.purchase_price_paise),
  mrp_paise: r.mrp_paise == null ? null : Number(r.mrp_paise), tax_rate: Number(r.tax_rate), hsn_sac: r.hsn_sac, description: r.description, image_url: r.image_url,
  has_profile: r.mfr_part_no !== undefined && r.has_profile !== false,
  mfr_part_no: r.mfr_part_no ?? null, oem_part_no: r.oem_part_no ?? null, classification: r.classification ?? null, vehicle_type: r.vehicle_type ?? null, subcategory: r.subcategory ?? null,
  pack_qty: r.pack_qty == null ? null : Number(r.pack_qty), max_stock: r.max_stock == null ? null : Number(r.max_stock), reorder_level: r.reorder_level == null ? null : Number(r.reorder_level),
  min_stock: Number(r.min_stock), preferred_supplier_id: r.preferred_supplier_id ?? null, specs: r.specs ?? {}, weight_g: r.weight_g ?? null, length_mm: r.length_mm ?? null,
  width_mm: r.width_mm ?? null, height_mm: r.height_mm ?? null, handling: r.handling ?? null, wholesale_price_paise: r.wholesale_price_paise == null ? null : Number(r.wholesale_price_paise),
  stock: r.stock == null ? undefined : Number(r.stock), matched_on: r.matched_on
});

const BASE = `FROM products p LEFT JOIN autoparts_parts a ON a.product_id = p.product_id LEFT JOIN categories c ON c.category_id = p.category_id LEFT JOIN brands br ON br.brand_id = p.brand_id`;
const COLS = `p.*, a.mfr_part_no, a.oem_part_no, a.classification, a.vehicle_type, a.subcategory, a.pack_qty, a.max_stock, a.reorder_level, a.preferred_supplier_id, a.specs, a.weight_g, a.length_mm,
  a.width_mm, a.height_mm, a.handling, a.wholesale_price_paise, (a.product_id IS NOT NULL) AS has_profile, c.name AS category_name, br.name AS brand_name`;

/** The words of a search, each matched on the usual places (name, SKU, barcode, aliases ...) and on part numbers typed with or without dashes and spaces: the shared product search does both. */
export const partSearch = (search, params) => searchClause(search, params);

export const listParts = async (db, tenant, q, { limit, offset }) => {
  const params = [tenant.businessId];
  const stock = stockSql(tenant);
  const where = [`p.business_id = $1`, `p.kind NOT IN ('SERVICE','INGREDIENT','PACKAGING')`];
  const status = q.status === 'all' ? null : (q.status ? String(q.status).toUpperCase() : 'ACTIVE');
  if (status) { params.push(status); where.push(`p.status = $${params.length}`); }
  const searched = partSearch(q.search, params);
  if (searched) where.push(searched);
  if (q.vehicle_type) { params.push(oneOf(q.vehicle_type, 'Vehicle type', VEHICLE_TYPES)); where.push(`a.vehicle_type = $${params.length}`); }
  if (q.classification) { params.push(oneOf(q.classification, 'Type of part', CLASSIFICATIONS)); where.push(`a.classification = $${params.length}`); }
  if (q.category_id) { params.push(Number(q.category_id)); where.push(`p.category_id = $${params.length}`); }
  if (q.brand_id) { params.push(Number(q.brand_id)); where.push(`p.brand_id = $${params.length}`); }
  if (q.supplier_id) { params.push(Number(q.supplier_id)); where.push(`(p.supplier_id = $${params.length} OR a.preferred_supplier_id = $${params.length})`); }
  if (q.model_id) {
    params.push(Number(q.model_id));
    let fit = `p.product_id IN (SELECT f.product_id FROM part_fitment f WHERE f.business_id = $1 AND f.model_id = $${params.length} AND f.status <> 'NOT_FIT'`;
    if (q.variant_id) { params.push(Number(q.variant_id)); fit += ` AND (f.variant_id IS NULL OR f.variant_id = $${params.length})`; }
    if (q.year) { params.push(Number(q.year)); fit += ` AND (f.year_from IS NULL OR f.year_from <= $${params.length}) AND (f.year_to IS NULL OR f.year_to >= $${params.length})`; }
    where.push(`${fit})`);
  }
  const s = String(q.stock || '');
  if (s === 'out') where.push(`${stock} <= 0`);
  else if (s === 'low') where.push(`p.track_inventory AND ${stock} <= GREATEST(COALESCE(a.reorder_level, 0), p.min_stock) AND ${stock} > 0`);
  else if (s === 'in') where.push(`${stock} > 0`);
  else if (s === 'over') where.push(`a.max_stock IS NOT NULL AND ${stock} > a.max_stock`);
  if (q.no_profile === 'true') where.push('a.product_id IS NULL');
  const total = Number((await db.query(`SELECT COUNT(*) AS n ${BASE} WHERE ${where.join(' AND ')}`, params)).rows[0].n);
  const sortable = { name: 'p.name', sku: 'p.sku', stock: stock, price: 'p.selling_price_paise' };
  const order = sortable[q.sort] || 'p.name';
  const dir = String(q.dir).toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  params.push(limit, offset);
  const rows = (await db.query(
    `SELECT ${COLS}, ${stock} AS stock ${BASE} WHERE ${where.join(' AND ')} ORDER BY ${order} ${dir}, p.product_id LIMIT $${params.length - 1} OFFSET $${params.length}`, params)).rows;
  return { rows: rows.map(shape), total };
};

/** One part with its numbers, fitment, stock at every outlet this person may see, and the identifiers the product already has. */
export const getPart = async (db, tenant, productId) => {
  const params = [tenant.businessId];
  const stock = stockSql(tenant);
  params.push(Number(productId));
  const r = (await db.query(`SELECT ${COLS}, ${stock} AS stock ${BASE} WHERE p.business_id = $1 AND p.product_id = $${params.length}`, params)).rows[0];
  if (!r) throw new PartsError(404, 'Not found');
  const numbers = await numbersOf(db, tenant.businessId, productId);
  const branches = (await db.query(
    `SELECT b.branch_id, b.name, COALESCE(bs.quantity, 0) AS quantity, COALESCE(bs.reserved_qty, 0) AS reserved
     FROM branches b LEFT JOIN branch_stock bs ON bs.branch_id = b.branch_id AND bs.product_id = $2
     WHERE b.business_id = $1 AND b.status = 'ACTIVE'${tenant.scopeBranchId != null ? ' AND b.branch_id = $3' : ''} ORDER BY b.is_primary DESC, b.name`,
    tenant.scopeBranchId != null ? [tenant.businessId, productId, tenant.scopeBranchId] : [tenant.businessId, productId])).rows.map((x) => ({ ...x, quantity: Number(x.quantity), reserved: Number(x.reserved), available: Number(x.quantity) - Number(x.reserved) }));
  const barcodes = (await db.query(`SELECT barcode FROM product_barcodes WHERE business_id = $1 AND product_id = $2 ORDER BY barcode_id`, [tenant.businessId, productId])).rows.map((x) => x.barcode);
  return { ...shape(r), numbers, barcodes, branches };
};

/** The universal lookup behind the counter's search box and a scan: barcode, SKU, any part number, or words. Returns each match with how it matched. */
export const lookup = async (db, tenant, term, { limit = 12 } = {}) => {
  const t = String(term ?? '').trim();
  if (!t) return [];
  const params = [tenant.businessId];
  const key = partKey(t);
  params.push(t, key);
  const exact = `$${params.length - 1}`; const keyp = `$${params.length}`;
  const hits = (await db.query(
    `SELECT product_id, how FROM (
       SELECT product_id, 'barcode' AS how, 1 AS rank FROM product_barcodes WHERE business_id = $1 AND barcode = ${exact}
       UNION ALL SELECT product_id, 'sku', 2 FROM products WHERE business_id = $1 AND lower(sku) = lower(${exact})
       UNION ALL SELECT product_id, 'oem', 3 FROM autoparts_part_numbers WHERE business_id = $1 AND key = ${keyp} AND kind = 'OEM'
       UNION ALL SELECT product_id, 'mfr', 4 FROM autoparts_part_numbers WHERE business_id = $1 AND key = ${keyp} AND kind = 'MFR'
       UNION ALL SELECT product_id, 'part_number', 5 FROM autoparts_part_numbers WHERE business_id = $1 AND key = ${keyp} AND kind NOT IN ('OEM','MFR')
     ) h ORDER BY rank LIMIT 30`, params)).rows;
  const how = new Map();
  for (const h of hits) if (!how.has(h.product_id)) how.set(h.product_id, h.how);
  let ids = [...how.keys()];
  if (!ids.length) {
    const sp = [tenant.businessId];
    const clause = partSearch(t, sp);
    ids = clause ? (await db.query(`SELECT p.product_id FROM products p LEFT JOIN autoparts_parts a ON a.product_id = p.product_id WHERE p.business_id = $1 AND p.status = 'ACTIVE' AND p.kind NOT IN ('SERVICE','INGREDIENT','PACKAGING') AND ${clause} ORDER BY p.name LIMIT ${Math.min(50, limit)}`, sp)).rows.map((x) => x.product_id) : [];
    for (const id of ids) how.set(id, 'search');
  }
  if (!ids.length) return [];
  const p2 = [tenant.businessId];
  const st2 = stockSql(tenant);
  p2.push(ids);
  const rows = (await db.query(`SELECT ${COLS}, ${st2} AS stock ${BASE} WHERE p.business_id = $1 AND p.product_id = ANY($${p2.length}::int[]) AND p.status = 'ACTIVE'`, p2)).rows;
  return rows.map((r) => ({ ...shape({ ...r, matched_on: how.get(r.product_id) }) })).sort((a, b) => ids.indexOf(a.product_id) - ids.indexOf(b.product_id)).slice(0, limit);
};

/** Parts that look like the same part twice: sharing a number or an identical name. For a person to look at; nothing is merged here. */
export const duplicates = async (db, businessId) => {
  const byNumber = (await db.query(
    `SELECT n.key, array_agg(DISTINCT n.product_id ORDER BY n.product_id) AS ids, array_agg(DISTINCT p.name) AS names
     FROM autoparts_part_numbers n JOIN products p ON p.product_id = n.product_id AND p.status = 'ACTIVE'
     WHERE n.business_id = $1 AND n.kind IN ('OEM','MFR') GROUP BY n.key HAVING COUNT(DISTINCT n.product_id) > 1 ORDER BY n.key LIMIT 200`, [businessId])).rows
    .map((r) => ({ reason: 'SAME_NUMBER', detail: r.key, product_ids: r.ids, names: r.names }));
  const byName = (await db.query(
    `SELECT lower(p.name) AS n, COALESCE(p.brand_id, 0) AS b, array_agg(p.product_id ORDER BY p.product_id) AS ids, array_agg(p.name) AS names
     FROM products p WHERE p.business_id = $1 AND p.status = 'ACTIVE' AND p.kind NOT IN ('SERVICE','INGREDIENT','PACKAGING') GROUP BY lower(p.name), COALESCE(p.brand_id, 0) HAVING COUNT(*) > 1 LIMIT 200`, [businessId])).rows
    .map((r) => ({ reason: 'SAME_NAME', detail: r.n, product_ids: r.ids, names: r.names }));
  return [...byNumber, ...byName];
};

void bool; void FITMENT_STATUS;
