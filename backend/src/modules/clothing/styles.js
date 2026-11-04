/*
 * The clothing catalogue: a style (one product as the shopper thinks of it) and its size/colour variants.
 *
 * Each variant is a `products` row (kind DISH, unit "pc"), made here with a generated SKU and an in-store barcode, so billing, stock, GST, returns,
 * exchanges and offers treat it like any other product. Opening stock goes through moveStock and the ledger, as it does everywhere.
 */
import { moveStock } from '../stock.js';
import {
  ClothingError, DEFAULT_CATEGORIES, DEFAULT_SIZE_SETS, GENDERS, COMMON_COLOURS, colourCode, hexOf, like, money, num, oneOf, sizeCode, storeBarcode, text, withRupees
} from './common.js';

const MAX_COLOURS = 30;
const MAX_SIZES = 20;
const MAX_VARIANTS = 300;

const stockExpr = (tenant, params) => {
  if (tenant.scopeBranchId == null) return 'p.current_stock';
  params.push(tenant.scopeBranchId);
  return `COALESCE((SELECT bs.quantity FROM branch_stock bs WHERE bs.product_id = p.product_id AND bs.branch_id = $${params.length}), 0)`;
};

/* ── sizes, categories ─────────────────────────────────────────────────────────────────────────── */

export const sizeSets = async (db, businessId) => {
  const custom = (await db.query(`SELECT set_id, name, sizes FROM clothing_size_sets WHERE business_id = $1 ORDER BY name`, [businessId])).rows;
  return [...DEFAULT_SIZE_SETS.map((s) => ({ ...s, custom: false })), ...custom.map((s) => ({ set_id: s.set_id, name: s.name, sizes: s.sizes, custom: true }))];
};

const cleanSizes = (list, label = 'Sizes') => {
  if (!Array.isArray(list)) throw new ClothingError(400, `${label} must be a list`);
  const out = [];
  for (const s of list) {
    const v = String(s ?? '').trim().slice(0, 20);
    if (v && !out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v);
  }
  if (out.length > MAX_SIZES) throw new ClothingError(400, `Up to ${MAX_SIZES} sizes`);
  return out;
};

export const saveSizeSet = async (db, businessId, b) => {
  const name = text(b.name, 'Set name', { max: 40, required: true });
  const sizes = cleanSizes(b.sizes);
  if (!sizes.length) throw new ClothingError(400, 'Add at least one size');
  if (DEFAULT_SIZE_SETS.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new ClothingError(409, 'That name is used by a built-in set');
  const row = (await db.query(
    `INSERT INTO clothing_size_sets (business_id, name, sizes) VALUES ($1,$2,$3)
     ON CONFLICT (business_id, lower(name)) DO UPDATE SET sizes = EXCLUDED.sizes RETURNING set_id, name, sizes`, [businessId, name, JSON.stringify(sizes)])).rows[0];
  return { ...row, custom: true };
};

/** Make the usual clothing categories (and their subcategories) for a shop that has none of the same name. Idempotent. */
export const ensureCategories = async (db, businessId) => {
  let made = 0;
  for (const [name, subs] of Object.entries(DEFAULT_CATEGORIES)) {
    let top = (await db.query(`SELECT category_id FROM categories WHERE business_id = $1 AND lower(name) = lower($2) AND parent_id IS NULL`, [businessId, name])).rows[0];
    if (!top) { top = (await db.query(`INSERT INTO categories (business_id, name) VALUES ($1,$2) RETURNING category_id`, [businessId, name])).rows[0]; made += 1; }
    for (const sub of subs) {
      const has = (await db.query(`SELECT 1 FROM categories WHERE business_id = $1 AND parent_id = $2 AND lower(name) = lower($3)`, [businessId, top.category_id, sub])).rowCount;
      if (!has) { await db.query(`INSERT INTO categories (business_id, name, parent_id) VALUES ($1,$2,$3)`, [businessId, sub, top.category_id]); made += 1; }
    }
  }
  return made;
};

export const meta = async (db, businessId) => ({
  size_sets: await sizeSets(db, businessId),
  colours: COMMON_COLOURS.map(([name, hex]) => ({ name, hex })),
  genders: GENDERS,
  categories: (await db.query(`SELECT category_id, name, parent_id FROM categories WHERE business_id = $1 ORDER BY name`, [businessId])).rows,
  needs_setup: !(await db.query(`SELECT 1 FROM categories WHERE business_id = $1 LIMIT 1`, [businessId])).rowCount
});

/* ── checking what a person typed ──────────────────────────────────────────────────────────────── */

const cleanColours = (list) => {
  if (!Array.isArray(list)) throw new ClothingError(400, 'Colours must be a list');
  const out = [];
  for (const c of list) {
    const name = String(typeof c === 'string' ? c : c?.name ?? '').trim().slice(0, 40);
    if (name && !out.some((o) => o.name.toLowerCase() === name.toLowerCase())) out.push({ name, hex: (typeof c === 'object' && /^#[0-9a-f]{6}$/i.test(c?.hex ?? '') ? c.hex : hexOf(name)) });
  }
  if (out.length > MAX_COLOURS) throw new ClothingError(400, `Up to ${MAX_COLOURS} colours`);
  return out;
};

/** A brand by id (must be this shop's) or by name (found, or made when it is new). No brand given is no brand. */
const brandFor = async (db, businessId, b) => {
  if (b.brand_id) {
    const id = Number(b.brand_id);
    if (!(await db.query(`SELECT 1 FROM brands WHERE brand_id = $1 AND business_id = $2`, [id, businessId])).rowCount) throw new ClothingError(400, 'That brand does not exist');
    return id;
  }
  const name = text(b.brand, 'Brand', { max: 80 });
  if (!name) return null;
  const found = (await db.query(`SELECT brand_id FROM brands WHERE business_id = $1 AND lower(name) = lower($2)`, [businessId, name])).rows[0];
  return found ? found.brand_id : (await db.query(`INSERT INTO brands (business_id, name) VALUES ($1,$2) RETURNING brand_id`, [businessId, name])).rows[0].brand_id;
};

const cleanStyle = async (db, businessId, b, { partial = false } = {}) => {
  const f = {};
  const has = (k) => !partial || b[k] !== undefined;
  if (has('name')) f.name = text(b.name, 'Product name', { max: 160, required: true });
  if (has('category_id')) {
    const id = b.category_id ? Number(b.category_id) : null;
    if (id && !(await db.query(`SELECT 1 FROM categories WHERE category_id = $1 AND business_id = $2`, [id, businessId])).rowCount) throw new ClothingError(400, 'That category does not exist');
    f.category_id = id;
  }
  if (has('brand_id') || b.brand !== undefined) f.brand_id = await brandFor(db, businessId, b);
  if (has('gender')) f.gender = oneOf(b.gender, 'Gender', GENDERS, { fallback: 'UNISEX' });
  for (const [key, label, max] of [['subcategory', 'Subcategory', 80], ['season', 'Season', 40], ['fabric', 'Fabric', 60], ['pattern', 'Pattern', 40], ['fit', 'Fit', 40], ['size_set', 'Size set', 40], ['hsn_sac', 'HSN code', 12], ['description', 'Description', 2000], ['image_url', 'Image', 500]]) {
    if (b[key] !== undefined) f[key] = text(b[key], label, { max });
  }
  if (b.tax_rate !== undefined) f.tax_rate = num(b.tax_rate, 'GST rate', { min: 0, max: 100 }) ?? 0;
  if (b.mrp !== undefined) f.mrp_paise = money(b.mrp, 'MRP');
  if (b.selling_price !== undefined) f.selling_price_paise = money(b.selling_price, 'Selling price') ?? 0;
  if (b.purchase_price !== undefined) f.purchase_price_paise = money(b.purchase_price, 'Purchase cost') ?? 0;
  if (f.mrp_paise != null && f.selling_price_paise != null && f.selling_price_paise > f.mrp_paise) throw new ClothingError(400, 'The selling price cannot be above the MRP');
  return f;
};

const cleanCode = (v) => {
  const code = String(v ?? '').trim().toUpperCase();
  if (!code) return null;
  if (!/^[A-Z0-9-]{2,24}$/.test(code)) throw new ClothingError(400, 'A style code has 2 to 24 letters, digits or dashes');
  return code;
};

/** The opening stock grid, as rows { colour, size, qty, selling_price?, purchase_price?, mrp? }. */
const cleanStockRows = (rows) => {
  if (rows == null) return [];
  if (!Array.isArray(rows)) throw new ClothingError(400, 'Stock must be a list of colour, size and quantity');
  return rows.map((r) => {
    const out = { colour: String(r?.colour ?? '').trim(), size: String(r?.size ?? '').trim(), qty: num(r?.qty ?? 0, 'Quantity', { min: 0, max: 1000000 }) ?? 0 };
    if (!out.colour || !out.size) throw new ClothingError(400, 'Every stock row needs a colour and a size');
    for (const [k, label] of [['selling_price', 'Selling price'], ['purchase_price', 'Purchase cost'], ['mrp', 'MRP']]) if (r?.[k] !== undefined && r[k] !== '' && r[k] !== null) out[k] = money(r[k], label);
    return out;
  });
};

/* ── making variants ───────────────────────────────────────────────────────────────────────────── */

const nextBarcode = async (client) => storeBarcode((await client.query(`SELECT nextval('clothing_barcode_seq') AS n`)).rows[0].n);

/**
 * Add the colour x size grid to a style: one product per combination that does not exist yet. `stockRows` carry opening quantities and optional per-variant prices.
 * Returns the variants made.
 */
const makeVariants = async (client, ctx, style, colours, sizes, stockRows) => {
  const { tenant, userId } = ctx;
  if (colours.length * sizes.length > MAX_VARIANTS) throw new ClothingError(400, `That is more than ${MAX_VARIANTS} variants at once: use fewer colours or sizes`);
  const existing = (await client.query(`SELECT colour, colour_code, size FROM clothing_variants WHERE style_id = $1`, [style.style_id])).rows;
  const have = new Set(existing.map((v) => `${v.colour.toLowerCase()}|${v.size.toLowerCase()}`));
  const codes = new Map(existing.map((v) => [v.colour.toLowerCase(), v.colour_code]));
  const order = (await client.query(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM clothing_variants WHERE style_id = $1`, [style.style_id])).rows[0].n;
  const stockOf = new Map(stockRows.map((r) => [`${r.colour.toLowerCase()}|${r.size.toLowerCase()}`, r]));
  const only = ctx.only ?? null;   // import: make just the cells that were listed, not every colour x size
  const needStock = stockRows.some((r) => r.qty > 0);
  if (needStock && tenant.branchId == null) throw new ClothingError(400, 'Choose an outlet before entering opening stock');
  const made = [];
  let pos = Number(order);
  for (const c of colours) {
    if (!codes.has(c.name.toLowerCase())) codes.set(c.name.toLowerCase(), colourCode(c.name, new Set(codes.values())));
    const cc = codes.get(c.name.toLowerCase());
    for (const size of sizes) {
      const key = `${c.name.toLowerCase()}|${size.toLowerCase()}`;
      if (have.has(key) || (only && !only.has(key))) continue;
      have.add(key);
      const row = stockOf.get(key);
      const selling = row?.selling_price ?? Number(style.selling_price_paise);
      const mrp = row?.mrp ?? (style.mrp_paise == null ? null : Number(style.mrp_paise));
      if (mrp != null && selling > mrp) throw new ClothingError(400, `${c.name} ${size}: the selling price cannot be above the MRP`);
      const sku = `${style.style_code}-${cc}-${sizeCode(size)}`;
      const barcode = await nextBarcode(client);
      const product = (await client.query(
        `INSERT INTO products (business_id, category_id, name, sku, barcode, unit, selling_price_paise, purchase_price_paise, tax_rate, hsn_sac, track_inventory, current_stock, min_stock,
                               description, kind, brand_id, mrp_paise, status)
         VALUES ($1,$2,$3,$4,$5,'pc',$6,$7,$8,$9,TRUE,0,$10,$11,'DISH',$12,$13,'ACTIVE') RETURNING product_id`,
        [tenant.businessId, style.category_id, `${style.name} · ${c.name} · ${size}`, sku, barcode, selling, row?.purchase_price ?? Number(style.purchase_price_paise), Number(style.tax_rate), style.hsn_sac,
          ctx.reorder ?? 0, style.description, style.brand_id, mrp])).rows[0];
      await client.query(`UPDATE products SET image_url = $2 WHERE product_id = $1`, [product.product_id, style.image_url]);
      await client.query(
        `INSERT INTO clothing_variants (product_id, business_id, style_id, colour, colour_code, colour_hex, size, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [product.product_id, tenant.businessId, style.style_id, c.name, cc, c.hex, size, pos++]);
      if (row?.qty > 0) {
        await moveStock(client, { businessId: tenant.businessId, branchId: tenant.branchId, productId: product.product_id, delta: row.qty });
        await client.query(
          `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, created_by) VALUES ($1,$2,$3,'OPENING',$4,'clothing',$5)`,
          [tenant.businessId, tenant.branchId, product.product_id, row.qty, userId]);
      }
      made.push({ product_id: product.product_id, sku, barcode, colour: c.name, size });
    }
  }
  return made;
};

/** Make a style with its variants in one go: details, the colours and sizes picked, and the opening stock grid. */
export const createStyle = async (client, ctx, b) => {
  const { tenant, userId } = ctx;
  const f = await cleanStyle(client, tenant.businessId, b);
  const colours = cleanColours(b.colours ?? []);
  const sizes = cleanSizes(b.sizes ?? []);
  if (!colours.length) throw new ClothingError(400, 'Pick at least one colour');
  if (!sizes.length) throw new ClothingError(400, 'Pick at least one size');
  const stockRows = cleanStockRows(b.stock);
  for (const r of stockRows) {
    if (!colours.some((c) => c.name.toLowerCase() === r.colour.toLowerCase()) || !sizes.some((s) => s.toLowerCase() === r.size.toLowerCase())) throw new ClothingError(400, `${r.colour} ${r.size} is not one of the colours and sizes picked`);
  }
  const code = cleanCode(b.style_code);
  let style;
  try {
    style = (await client.query(
      `INSERT INTO clothing_styles (business_id, style_code, name, category_id, subcategory, brand_id, gender, season, fabric, pattern, fit, description, image_url, hsn_sac, tax_rate, mrp_paise,
                                    selling_price_paise, purchase_price_paise, size_set, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING *`,
      [tenant.businessId, code ?? `TMP${Date.now()}${Math.floor(Math.random() * 1000)}`, f.name, f.category_id ?? null, f.subcategory ?? null, f.brand_id ?? null, f.gender, f.season ?? null, f.fabric ?? null,
        f.pattern ?? null, f.fit ?? null, f.description ?? null, f.image_url ?? null, f.hsn_sac ?? null, f.tax_rate ?? 0, f.mrp_paise ?? null, f.selling_price_paise ?? 0, f.purchase_price_paise ?? 0,
        f.size_set ?? null, userId])).rows[0];
  } catch (error) {
    if (error.code === '23505') throw new ClothingError(409, 'That style code is already used');
    throw error;
  }
  if (!code) style = (await client.query(`UPDATE clothing_styles SET style_code = 'ST' || lpad(style_id::text, 5, '0') WHERE style_id = $1 RETURNING *`, [style.style_id])).rows[0];
  const reorder = b.reorder_level === undefined ? 0 : num(b.reorder_level, 'Reorder level', { min: 0, max: 1000000 }) ?? 0;
  const only = b.only_listed === true ? new Set(stockRows.map((r) => `${r.colour.toLowerCase()}|${r.size.toLowerCase()}`)) : null;
  const variants = await makeVariants(client, { tenant, userId, reorder, only }, style, colours, sizes, stockRows);
  return { style_id: style.style_id, style_code: style.style_code, variants };
};

/** Add colours and/or sizes to a style that exists: only the combinations it does not have yet are made. */
export const addVariants = async (client, ctx, styleId, b) => {
  const style = (await client.query(`SELECT * FROM clothing_styles WHERE style_id = $1 AND business_id = $2 FOR UPDATE`, [Number(styleId), ctx.tenant.businessId])).rows[0];
  if (!style) throw new ClothingError(404, 'Not found');
  if (style.status !== 'ACTIVE') throw new ClothingError(409, 'Bring the style back before adding to it');
  const cur = (await client.query(`SELECT colour, colour_hex, size FROM clothing_variants WHERE style_id = $1 ORDER BY sort_order`, [style.style_id])).rows;
  const colours = cleanColours([...(b.colours ?? []), ...(b.colours ? [] : [...new Map(cur.map((v) => [v.colour.toLowerCase(), { name: v.colour, hex: v.colour_hex }])).values()])]);
  const sizes = cleanSizes([...(b.sizes ?? []), ...(b.sizes ? [] : [...new Set(cur.map((v) => v.size))])]);
  if (!colours.length || !sizes.length) throw new ClothingError(400, 'Pick the colours and sizes to add');
  const variants = await makeVariants(client, { ...ctx, reorder: b.reorder_level == null ? 0 : num(b.reorder_level, 'Reorder level', { min: 0, max: 1000000 }) ?? 0 }, style, colours, sizes, cleanStockRows(b.stock));
  return { style_id: style.style_id, variants };
};

/* ── reading ───────────────────────────────────────────────────────────────────────────────────── */

export const listStyles = async (db, tenant, q, { limit, offset }) => {
  const params = [tenant.businessId];
  const stock = stockExpr(tenant, params);
  const where = ['s.business_id = $1'];
  const status = q.status === 'all' ? null : (q.status ? String(q.status).toUpperCase() : 'ACTIVE');
  if (status) { params.push(status); where.push(`s.status = $${params.length}`); }
  if (q.category_id) { params.push(Number(q.category_id)); where.push(`(s.category_id = $${params.length} OR s.category_id IN (SELECT category_id FROM categories WHERE parent_id = $${params.length}))`); }
  if (q.brand_id) { params.push(Number(q.brand_id)); where.push(`s.brand_id = $${params.length}`); }
  if (q.gender) { params.push(String(q.gender).toUpperCase()); where.push(`s.gender = $${params.length}`); }
  if (q.search) {
    params.push(like(String(q.search).trim()));
    where.push(`(s.name ILIKE $${params.length} OR s.style_code ILIKE $${params.length} OR EXISTS (SELECT 1 FROM clothing_variants v JOIN products p ON p.product_id = v.product_id
      WHERE v.style_id = s.style_id AND (p.sku ILIKE $${params.length} OR p.barcode ILIKE $${params.length})))`);
  }
  const base = `FROM clothing_styles s LEFT JOIN categories c ON c.category_id = s.category_id LEFT JOIN brands b ON b.brand_id = s.brand_id
    LEFT JOIN LATERAL (SELECT count(*)::int AS variants, COALESCE(SUM(${stock}), 0) AS stock, MIN(p.selling_price_paise) AS price_from, MAX(p.selling_price_paise) AS price_to,
        count(*) FILTER (WHERE ${stock} <= 0)::int AS sold_out, array_agg(DISTINCT v.colour) AS colours, array_agg(p.product_id) AS product_ids
      FROM clothing_variants v JOIN products p ON p.product_id = v.product_id WHERE v.style_id = s.style_id AND p.status = 'ACTIVE') a ON TRUE
    WHERE ${where.join(' AND ')}`;
  const total = Number((await db.query(`SELECT count(*) ${base}`, params)).rows[0].count);
  const rows = (await db.query(
    `SELECT s.*, c.name AS category_name, b.name AS brand_name, COALESCE(a.variants, 0) AS variants, COALESCE(a.stock, 0) AS stock, a.price_from, a.price_to, COALESCE(a.sold_out, 0) AS sold_out, COALESCE(a.colours, '{}') AS colours, COALESCE(a.product_ids, '{}') AS product_ids
     ${base} ORDER BY s.created_at DESC, s.style_id DESC LIMIT ${limit} OFFSET ${offset}`, params)).rows;
  return { rows: withRupees(rows.map((r) => ({ ...r, stock: Number(r.stock), price_from_paise: r.price_from == null ? null : Number(r.price_from), price_to_paise: r.price_to == null ? null : Number(r.price_to), price_from: undefined, price_to: undefined }))), total };
};

/** One style with its variants and the size x colour grid (stock and price per cell). */
export const getStyle = async (db, tenant, styleId) => {
  const params = [tenant.businessId, Number(styleId)];
  const stock = stockExpr(tenant, params);
  const style = (await db.query(
    `SELECT s.*, c.name AS category_name, b.name AS brand_name FROM clothing_styles s LEFT JOIN categories c ON c.category_id = s.category_id LEFT JOIN brands b ON b.brand_id = s.brand_id
      WHERE s.business_id = $1 AND s.style_id = $2`, [tenant.businessId, Number(styleId)])).rows[0];
  if (!style) throw new ClothingError(404, 'Not found');
  const variants = (await db.query(
    `SELECT v.product_id, v.colour, v.colour_hex, v.size, v.sort_order, p.sku, p.barcode, p.selling_price_paise, p.purchase_price_paise, p.mrp_paise, p.min_stock, p.status, ${stock} AS stock
       FROM clothing_variants v JOIN products p ON p.product_id = v.product_id WHERE v.business_id = $1 AND v.style_id = $2 ORDER BY v.sort_order`, params)).rows
    .map((v) => ({ ...v, stock: Number(v.stock), min_stock: Number(v.min_stock) }));
  const colours = [...new Map(variants.map((v) => [v.colour, { name: v.colour, hex: v.colour_hex }])).values()];
  const sizes = [...new Map(variants.map((v) => [v.size, v.sort_order])).keys()];
  const grid = {};
  for (const v of variants) (grid[v.colour] ??= {})[v.size] = { product_id: v.product_id, stock: v.stock, sku: v.sku, barcode: v.barcode, selling_price_paise: Number(v.selling_price_paise), low: v.stock <= v.min_stock };
  return withRupees({ ...style, variants, matrix: { colours, sizes, grid }, stock: variants.reduce((a, v) => a + v.stock, 0) });
};

/* ── changing ──────────────────────────────────────────────────────────────────────────────────── */

/** Change a style. Identity details (name, category, brand, GST, HSN, description, picture) follow to every variant; prices only when `apply_prices` is set. */
export const updateStyle = async (client, ctx, styleId, b) => {
  const { tenant } = ctx;
  const cur = (await client.query(`SELECT * FROM clothing_styles WHERE style_id = $1 AND business_id = $2 FOR UPDATE`, [Number(styleId), tenant.businessId])).rows[0];
  if (!cur) throw new ClothingError(404, 'Not found');
  const f = await cleanStyle(client, tenant.businessId, b, { partial: true });
  if (b.status !== undefined) f.status = oneOf(b.status, 'Status', ['ACTIVE', 'ARCHIVED'], { required: true });
  const merged = { ...cur, ...f };
  if (merged.mrp_paise != null && Number(merged.selling_price_paise) > Number(merged.mrp_paise)) throw new ClothingError(400, 'The selling price cannot be above the MRP');
  const keys = Object.keys(f);
  if (keys.length) await client.query(`UPDATE clothing_styles SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE style_id = $1`, [cur.style_id, ...keys.map((k) => f[k])]);
  const carry = ['category_id', 'brand_id', 'tax_rate', 'hsn_sac', 'description', 'image_url'].filter((k) => f[k] !== undefined);
  const pricing = b.apply_prices === true ? ['selling_price_paise', 'purchase_price_paise', 'mrp_paise'].filter((k) => f[k] !== undefined) : [];
  const sets = [...carry, ...pricing].map((k, i) => `${k} = $${i + 2}`);
  if (f.status) sets.push(`status = $${sets.length + 2}`);
  if (sets.length) {
    await client.query(`UPDATE products SET ${sets.join(', ')}, updated_at = now() WHERE product_id IN (SELECT product_id FROM clothing_variants WHERE style_id = $1)`,
      [cur.style_id, ...carry.map((k) => f[k]), ...pricing.map((k) => f[k]), ...(f.status ? [f.status] : [])]);
  }
  if (f.name && f.name !== cur.name) {
    await client.query(`UPDATE products p SET name = $2 || ' · ' || v.colour || ' · ' || v.size, updated_at = now() FROM clothing_variants v WHERE v.product_id = p.product_id AND v.style_id = $1`, [cur.style_id, f.name]);
  }
  return getStyle(client, tenant, cur.style_id);
};

/** Change one variant's own price, MRP or reorder level (the rest of it is the style's). */
export const updateVariant = async (client, ctx, productId, b) => {
  const { tenant } = ctx;
  const v = (await client.query(
    `SELECT p.* FROM clothing_variants v JOIN products p ON p.product_id = v.product_id WHERE v.product_id = $1 AND v.business_id = $2 FOR UPDATE OF p`, [Number(productId), tenant.businessId])).rows[0];
  if (!v) throw new ClothingError(404, 'Not found');
  const next = {
    selling_price_paise: b.selling_price !== undefined ? money(b.selling_price, 'Selling price', { required: true }) : Number(v.selling_price_paise),
    purchase_price_paise: b.purchase_price !== undefined ? money(b.purchase_price, 'Purchase cost', { required: true }) : Number(v.purchase_price_paise),
    mrp_paise: b.mrp !== undefined ? money(b.mrp, 'MRP') : (v.mrp_paise == null ? null : Number(v.mrp_paise)),
    min_stock: b.reorder_level !== undefined ? num(b.reorder_level, 'Reorder level', { min: 0, max: 1000000, required: true }) : Number(v.min_stock)
  };
  if (next.mrp_paise != null && next.selling_price_paise > next.mrp_paise) throw new ClothingError(400, 'The selling price cannot be above the MRP');
  /* The shop's own barcode (a sticker already on the stock): 4-48 characters, no spaces. The trigger moves product_barcodes along; another item holding it is a 409. */
  let barcode = v.barcode;
  if (b.barcode !== undefined) {
    barcode = String(b.barcode ?? '').trim();
    if (!/^[!-~]{4,48}$/.test(barcode)) throw new ClothingError(400, 'A barcode is 4 to 48 letters or digits, without spaces');
  }
  await client.query(`UPDATE products SET selling_price_paise = $2, purchase_price_paise = $3, mrp_paise = $4, min_stock = $5, barcode = $6, updated_at = now() WHERE product_id = $1`,
    [v.product_id, next.selling_price_paise, next.purchase_price_paise, next.mrp_paise, next.min_stock, barcode]);
  return withRupees({ product_id: v.product_id, ...next, barcode });
};

/**
 * What a supplier has delivered, grouped by style: pieces received, money spent (before GST), average cost a piece, orders, last delivery, and pieces per size.
 * Counts received stock only (RECEIVED, or the received part of PARTIAL), at the outlet(s) the viewer may see.
 */
export const supplierStyles = async (db, tenant, supplierId) => {
  const params = [tenant.businessId, Number(supplierId)];
  const scope = tenant.scopeBranchId == null ? '' : (params.push(tenant.scopeBranchId), ` AND po.branch_id = $${params.length}`);
  if (!(await db.query(`SELECT 1 FROM suppliers WHERE business_id = $1 AND supplier_id = $2`, params.slice(0, 2))).rowCount) throw new ClothingError(404, 'Not found');
  const { rows } = await db.query(
    `SELECT s.style_id, s.style_code, s.name, v.size, v.sort_order, po.po_id, po.po_date,
            COALESCE(i.received_quantity, CASE WHEN po.status = 'RECEIVED' THEN i.quantity ELSE 0 END) AS pieces, i.unit_cost_paise
       FROM purchase_orders po
       JOIN purchase_order_items i ON i.po_id = po.po_id
       JOIN clothing_variants v ON v.product_id = i.product_id AND v.business_id = po.business_id
       JOIN clothing_styles s ON s.style_id = v.style_id
      WHERE po.business_id = $1 AND po.supplier_id = $2 AND po.status IN ('RECEIVED','PARTIAL')${scope}`, params);
  const by = new Map();
  for (const r of rows) {
    const pieces = Number(r.pieces); if (!(pieces > 0)) continue;
    const e = by.get(r.style_id) || { style_id: r.style_id, style_code: r.style_code, name: r.name, pieces: 0, spent_paise: 0, orders: new Set(), last_date: null, sizes: new Map() };
    e.pieces += pieces; e.spent_paise += Math.round(pieces * Number(r.unit_cost_paise)); e.orders.add(r.po_id);
    if (!e.last_date || r.po_date > e.last_date) e.last_date = r.po_date;
    const z = e.sizes.get(r.size) || { size: r.size, sort: r.sort_order, pieces: 0 }; z.pieces += pieces; e.sizes.set(r.size, z);
    by.set(r.style_id, e);
  }
  return withRupees([...by.values()].map((e) => ({
    style_id: e.style_id, style_code: e.style_code, name: e.name, pieces: e.pieces, spent_paise: e.spent_paise, avg_cost_paise: Math.round(e.spent_paise / e.pieces),
    orders: e.orders.size, last_date: e.last_date, sizes: [...e.sizes.values()].sort((a, b) => a.sort - b.sort).map(({ size, pieces }) => ({ size, pieces }))
  })).sort((a, b) => b.spent_paise - a.spent_paise));
};
/**
 * What a customer tends to buy, worked out from their issued bills (nothing to keep up to date): the sizes and colours they take most, the styles they came back for, and when they last bought.
 * Pieces are counted as billed; returns are not taken off. Sizes are shown as written (M, 32, 6-7Y), most pieces first.
 */
export const customerPreferences = async (db, tenant, customerId) => {
  const params = [tenant.businessId, Number(customerId)];
  const scope = tenant.scopeBranchId == null ? '' : (params.push(tenant.scopeBranchId), ` AND inv.branch_id = $${params.length}`);
  if (!(await db.query(`SELECT 1 FROM customers WHERE business_id = $1 AND customer_id = $2`, params.slice(0, 2))).rowCount) throw new ClothingError(404, 'Not found');
  const { rows } = await db.query(
    `SELECT s.style_id, s.name AS style_name, v.size, v.colour, v.colour_hex, inv.invoice_id, inv.invoice_date, i.quantity
       FROM invoices inv JOIN invoice_items i ON i.invoice_id = inv.invoice_id
       JOIN clothing_variants v ON v.product_id = i.product_id AND v.business_id = inv.business_id JOIN clothing_styles s ON s.style_id = v.style_id
      WHERE inv.business_id = $1 AND inv.customer_id = $2 AND inv.status = 'ISSUED'${scope}`, params);
  const tally = (key, extra = () => ({})) => {
    const m = new Map();
    for (const r of rows) { const k = r[key]; const e = m.get(k) || { [key === 'style_name' ? 'name' : key]: k, pieces: 0, ...extra(r) }; e.pieces += Number(r.quantity); m.set(k, e); }
    return [...m.values()].sort((a, b) => b.pieces - a.pieces).slice(0, 4);
  };
  return {
    pieces: rows.reduce((t, r) => t + Number(r.quantity), 0), bills: new Set(rows.map((r) => r.invoice_id)).size,
    last_date: rows.reduce((d, r) => (!d || r.invoice_date > d ? r.invoice_date : d), null),
    sizes: tally('size'), colours: tally('colour', (r) => ({ hex: r.colour_hex })), styles: tally('style_name')
  };
};


/**
 * Clothing analytics from the shop's own bills and stock. `days` is the selling window (default 30); `dead_days` is how long without a sale makes stock "dead" (default 60).
 * Sold = pieces on ISSUED bills in the window (returns are not taken off); revenue and margin are before GST, margin = price less the cost recorded on the bill line.
 * Stock is what is on hand now (this outlet when scoped). Ageing is days since the variant last sold, or since it was made if it never has.
 */
export const analytics = async (db, tenant, q = {}) => {
  const days = Math.min(365, Math.max(1, Math.floor(Number(q.days)) || 30));
  const deadDays = Math.min(730, Math.max(7, Math.floor(Number(q.dead_days)) || 60));
  const sold = [tenant.businessId, days];
  const soldScope = tenant.scopeBranchId == null ? '' : (sold.push(tenant.scopeBranchId), ` AND inv.branch_id = $${sold.length}`);
  const sales = (await db.query(
    `SELECT i.product_id, SUM(i.quantity) AS pieces, SUM(i.line_total_paise - i.tax_amount_paise) AS revenue, SUM(i.quantity * COALESCE(i.unit_cost_paise, 0)) AS cost, COUNT(DISTINCT inv.invoice_id) AS bills
       FROM invoices inv JOIN invoice_items i ON i.invoice_id = inv.invoice_id JOIN clothing_variants v ON v.product_id = i.product_id AND v.business_id = inv.business_id
      WHERE inv.business_id = $1 AND inv.status = 'ISSUED' AND inv.invoice_date >= CURRENT_DATE - $2::int${soldScope} GROUP BY i.product_id`, sold)).rows;
  const byProduct = new Map(sales.map((r) => [r.product_id, r]));
  const bills = (await db.query(
    `SELECT COUNT(DISTINCT inv.invoice_id) AS n FROM invoices inv JOIN invoice_items i ON i.invoice_id = inv.invoice_id JOIN clothing_variants v ON v.product_id = i.product_id AND v.business_id = inv.business_id
      WHERE inv.business_id = $1 AND inv.status = 'ISSUED' AND inv.invoice_date >= CURRENT_DATE - $2::int${soldScope}`, sold)).rows[0].n;

  const params = [tenant.businessId];
  const stock = stockExpr(tenant, params);
  const lastScope = tenant.scopeBranchId == null ? '' : ` AND inv.branch_id = $${params.length}`;
  const variants = (await db.query(
    `SELECT v.product_id, v.colour, v.colour_hex, v.size, v.sort_order, s.style_id, s.style_code, s.name AS style_name, p.purchase_price_paise, ${stock} AS stock,
            (SELECT MAX(inv.invoice_date) FROM invoice_items i JOIN invoices inv ON inv.invoice_id = i.invoice_id WHERE i.product_id = v.product_id AND inv.status = 'ISSUED'${lastScope}) AS last_sold,
            GREATEST(0, CURRENT_DATE - p.created_at::date) AS made_days_ago
       FROM clothing_variants v JOIN clothing_styles s ON s.style_id = v.style_id JOIN products p ON p.product_id = v.product_id
      WHERE v.business_id = $1 AND s.status = 'ACTIVE'`, params)).rows;

  const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
  const group = (key, make) => { const m = new Map(); return { get: (k, extra) => { if (!m.has(k)) m.set(k, make(k, extra)); return m.get(k); }, list: () => [...m.values()] }; };
  const sizes = group('size', (k) => ({ size: k, pieces: 0, revenue_paise: 0, stock: 0 }));
  const colours = group('colour', (k, hex) => ({ colour: k, hex, pieces: 0, revenue_paise: 0, stock: 0 }));
  const styleMap = group('style', (k, v) => ({ style_id: k, style_code: v.style_code, name: v.style_name, pieces: 0, revenue_paise: 0, cost_paise: 0, stock: 0, stock_value_paise: 0, last_sold: null }));
  const buckets = [[0, 30, '0-30'], [31, 60, '31-60'], [61, 90, '61-90'], [91, Infinity, '91+']].map(([from, to, label]) => ({ label, from, to, pieces: 0, value_paise: 0 }));
  const dead = [];
  const totals = { pieces: 0, revenue_paise: 0, cost_paise: 0 };

  for (const v of variants) {
    const sale = byProduct.get(v.product_id);
    const pieces = Number(sale?.pieces || 0); const revenue = Number(sale?.revenue || 0); const cost = Number(sale?.cost || 0);
    const onHand = Math.max(0, Number(v.stock));
    const value = Math.round(onHand * Number(v.purchase_price_paise || 0));
    for (const e of [sizes.get(v.size), colours.get(v.colour, v.colour_hex), styleMap.get(v.style_id, v)]) { e.pieces += pieces; e.revenue_paise += revenue; e.stock += onHand; }
    const st = styleMap.get(v.style_id, v); st.cost_paise += cost; st.stock_value_paise += value;
    if (v.last_sold && (!st.last_sold || v.last_sold > st.last_sold)) st.last_sold = v.last_sold;
    totals.pieces += pieces; totals.revenue_paise += revenue; totals.cost_paise += cost;
    if (onHand > 0) {
      const age = v.last_sold ? Math.max(0, Math.round((today - new Date(new Date(v.last_sold).toISOString().slice(0, 10)).getTime()) / 86400000)) : Number(v.made_days_ago);
      const b = buckets.find((x) => age >= x.from && age <= x.to); b.pieces += onHand; b.value_paise += value;
      if (age >= deadDays) dead.push({ product_id: v.product_id, style_id: v.style_id, style_name: v.style_name, style_code: v.style_code, colour: v.colour, size: v.size, stock: onHand, value_paise: value, last_sold: v.last_sold, days: age, never_sold: !v.last_sold });
    }
  }
  const share = (list) => list.map((e) => ({ ...e, share_pct: totals.pieces ? Math.round((e.pieces / totals.pieces) * 1000) / 10 : 0, sell_through_pct: e.pieces + e.stock ? Math.round((e.pieces / (e.pieces + e.stock)) * 1000) / 10 : 0 })).sort((a, b) => b.pieces - a.pieces || b.stock - a.stock);
  const styleRows = share(styleMap.list()).map((e) => ({ ...e, margin_paise: e.revenue_paise - e.cost_paise, margin_pct: e.revenue_paise ? Math.round(((e.revenue_paise - e.cost_paise) / e.revenue_paise) * 1000) / 10 : null }));
  return withRupees({
    days, dead_days: deadDays, bills: Number(bills),
    totals: { ...totals, margin_paise: totals.revenue_paise - totals.cost_paise, margin_pct: totals.revenue_paise ? Math.round(((totals.revenue_paise - totals.cost_paise) / totals.revenue_paise) * 1000) / 10 : null,
              stock: variants.reduce((t, v) => t + Math.max(0, Number(v.stock)), 0), stock_value_paise: styleRows.reduce((t, s) => t + s.stock_value_paise, 0) },
    sizes: share(sizes.list()), colours: share(colours.list()), styles: styleRows,
    ageing: buckets.map(({ label, pieces, value_paise }) => ({ label, pieces, value_paise })),
    dead: dead.sort((a, b) => b.value_paise - a.value_paise).slice(0, 50), dead_total: { variants: dead.length, pieces: dead.reduce((t, d) => t + d.stock, 0), value_paise: dead.reduce((t, d) => t + d.value_paise, 0) }
  });
};

/**
 * Bulk import: one row per size/colour, rows with the same style (code, else name) become one style. Columns: style, colour, size, qty, selling_price, purchase_price, mrp, category,
 * brand, gender, hsn, gst. Rows are checked first and nothing is saved if any is wrong; `check` only reports.
 */
export const importRows = async (client, ctx, rows, { check = false } = {}) => {
  if (!Array.isArray(rows) || !rows.length) throw new ClothingError(400, 'There are no rows to import');
  if (rows.length > 2000) throw new ClothingError(400, 'Import up to 2,000 rows at a time');
  const { tenant } = ctx;
  const groups = new Map();
  const problems = [];
  rows.forEach((r, i) => {
    const line = i + 2;
    const name = String(r.style ?? r.name ?? '').trim();
    const colour = String(r.colour ?? r.color ?? '').trim();
    const size = String(r.size ?? '').trim();
    if (!name || !colour || !size) { problems.push({ line, message: 'Each row needs a style, a colour and a size' }); return; }
    const key = (String(r.style_code ?? '').trim() || name).toLowerCase();
    const g = groups.get(key) ?? { name, code: String(r.style_code ?? '').trim(), first: r, cells: [] };
    if (g.cells.some((c) => c.colour.toLowerCase() === colour.toLowerCase() && c.size.toLowerCase() === size.toLowerCase())) problems.push({ line, message: `${name} ${colour} ${size} appears twice` });
    g.cells.push({ colour, size, qty: r.qty ?? 0, selling_price: r.selling_price, purchase_price: r.purchase_price, mrp: r.mrp });
    groups.set(key, g);
  });
  const categoryByName = new Map((await client.query(`SELECT category_id, lower(name) AS n FROM categories WHERE business_id = $1`, [tenant.businessId])).rows.map((c) => [c.n, c.category_id]));
  const plans = [];
  for (const g of groups.values()) {
    const f = g.first;
    const category = f.category ? categoryByName.get(String(f.category).trim().toLowerCase()) : null;
    if (f.category && !category) problems.push({ line: 0, message: `${g.name}: the category "${f.category}" does not exist` });
    const colours = [...new Set(g.cells.map((c) => c.colour))];
    const sizes = [...new Set(g.cells.map((c) => c.size))];
    plans.push({ name: g.name, style_code: g.code || undefined, category_id: category ?? undefined, brand: f.brand, gender: f.gender, hsn_sac: f.hsn ?? f.hsn_sac, tax_rate: f.gst ?? f.tax_rate ?? 0,
      mrp: f.mrp, selling_price: f.selling_price ?? 0, purchase_price: f.purchase_price ?? 0, colours, sizes, stock: g.cells, only_listed: true });
  }
  if (!problems.length) {
    // a trial run inside a savepoint reports every style's own problems too (a wrong price, a clash), then undoes itself
    await client.query('SAVEPOINT import_check');
    try {
      for (const [i, p] of plans.entries()) {
        await client.query(`SAVEPOINT import_style_${i}`);   // one style failing must not poison the rest of the transaction
        try { await createStyle(client, ctx, p); } catch (error) {
          await client.query(`ROLLBACK TO SAVEPOINT import_style_${i}`);
          if (error?.status) problems.push({ line: 0, message: `${p.name}: ${error.message}` }); else throw error;
        }
      }
    } finally {
      if (problems.length || check) await client.query('ROLLBACK TO SAVEPOINT import_check');
      await client.query('RELEASE SAVEPOINT import_check');
    }
  }
  if (problems.length) return { ok: false, problems, styles: plans.length };
  return { ok: true, saved: !check, styles: plans.length, variants: plans.reduce((a, p) => a + p.stock.length, 0) };
};
