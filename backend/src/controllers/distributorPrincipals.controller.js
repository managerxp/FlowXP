/*
 * Principals and brands: the manufacturers a distributor represents.
 *
 * A principal is a dist_principals row linked to an ordinary suppliers row — so purchase orders, goods receipts,
 * payables, supplier ledgers and debit notes all work for a principal exactly as they do for any supplier, and nothing
 * here duplicates them. What the principal adds is the agreement (dates, margin, terms) and the products and
 * brands that belong to it.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { checkEmail, checkGstin } from '../utils/validate.js';
import { WholesaleError, audit, diff, int, isoDate, like, money, num, ok, oneOf, page, paging, phone, text, today, withTransaction, wrapAll } from '../modules/distributor/common.js';
import { supplierBalances } from '../modules/wholesale/ledger.js';

const rupees = (v) => toRupees(Number(v || 0));

const agreementState = (r, on) => {
  if (!r.agreement_end && !r.agreement_start) return 'NONE';
  const end = r.agreement_end ? String(r.agreement_end).slice(0, 10) : null;
  if (end && end < on) return 'EXPIRED';
  if (r.agreement_start && String(r.agreement_start).slice(0, 10) > on) return 'UPCOMING';
  if (end && end <= new Date(Date.parse(`${on}T00:00:00Z`) + 30 * 86400000).toISOString().slice(0, 10)) return 'EXPIRING';
  return 'ACTIVE';
};

const shape = (r, on) => ({
  principal_id: r.principal_id, supplier_id: r.supplier_id, name: r.name, company_name: r.company_name, contact_person: r.contact_person, phone: r.phone, email: r.email,
  gstin: r.gstin, pan: r.pan, address: r.address, territory_note: r.territory_note, agreement_start: r.agreement_start, agreement_end: r.agreement_end,
  agreement_status: agreementState(r, on), margin_pct: Number(r.margin_pct), payment_terms_days: r.payment_terms_days, credit_limit: rupees(r.credit_limit_paise),
  status: r.status, notes: r.notes, created_at: r.created_at,
  ...(r.products != null ? { products: Number(r.products) } : {}), ...(r.brands != null ? { brands: Number(r.brands) } : {})
});

const pan = (v) => {
  const s = text(v, 'PAN', { max: 10 });
  if (s && !/^[A-Z]{5}\d{4}[A-Z]$/i.test(s)) throw new WholesaleError(400, 'A PAN is 10 characters like ABCDE1234F');
  return s ? s.toUpperCase() : null;
};

const fields = (b, partial) => {
  const f = {}; const has = (k) => !partial || k in b;
  if (has('name')) f.name = text(b.name, 'Principal name', { max: 120, min: 2, required: true });
  if ('company_name' in b) f.company_name = text(b.company_name, 'Company name', { max: 160 });
  if ('contact_person' in b) f.contact_person = text(b.contact_person, 'Contact person', { max: 120 });
  if ('phone' in b) { phone(b.phone); f.phone = text(b.phone, 'Phone', { max: 32 }); }
  if ('email' in b) { if (b.email) { const e = checkEmail(b.email); if (e) throw new WholesaleError(400, e); } f.email = b.email ? String(b.email).trim().toLowerCase() : null; }
  if ('gstin' in b) { const e = checkGstin(b.gstin); if (e) throw new WholesaleError(400, e); f.gstin = b.gstin ? String(b.gstin).trim().toUpperCase() : null; }
  if ('pan' in b) f.pan = pan(b.pan);
  if ('address' in b) f.address = text(b.address, 'Address', { max: 400 });
  if ('territory_note' in b) f.territory_note = text(b.territory_note, 'Territory', { max: 200 });
  if ('agreement_start' in b) f.agreement_start = isoDate(b.agreement_start, 'Agreement start');
  if ('agreement_end' in b) f.agreement_end = isoDate(b.agreement_end, 'Agreement end');
  if (f.agreement_start && f.agreement_end && f.agreement_end < f.agreement_start) throw new WholesaleError(400, 'The agreement cannot end before it starts');
  if ('margin_pct' in b) f.margin_pct = num(b.margin_pct, 'Margin', { min: 0, max: 100 }) ?? 0;
  if ('payment_terms_days' in b) f.payment_terms_days = int(b.payment_terms_days, 'Payment terms', { min: 0, max: 365 });
  if ('credit_limit' in b) f.credit_limit_paise = money(b.credit_limit, 'Credit limit') ?? 0;
  if ('status' in b) f.status = oneOf(b.status, 'Status', ['ACTIVE', 'INACTIVE'], { required: true });
  if ('notes' in b) f.notes = text(b.notes, 'Notes', { max: 1000 });
  return f;
};

const load = async (db, businessId, id) => (await db.query(`SELECT * FROM dist_principals WHERE business_id = $1 AND principal_id = $2`, [businessId, id])).rows[0];

/* GET /principals?q=&status=&limit=&offset= */
const list = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const values = [req.tenant.businessId]; const where = ['p.business_id = $1'];
  const status = String(req.query.status || 'ACTIVE').toUpperCase();
  if (status !== 'ALL') { values.push(status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'); where.push(`p.status = $${values.length}`); }
  if (req.query.q) { values.push(like(String(req.query.q).trim().slice(0, 80))); where.push(`(p.name ILIKE $${values.length} OR p.company_name ILIKE $${values.length} OR p.gstin ILIKE $${values.length})`); }
  const base = `FROM dist_principals p WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(
    `SELECT p.*, (SELECT COUNT(*) FROM wholesale_item_details d WHERE d.principal_id = p.principal_id) AS products,
            (SELECT COUNT(*) FROM brands b WHERE b.principal_id = p.principal_id) AS brands
     ${base} ORDER BY lower(p.name) LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  const on = await today(pool, req.tenant.businessId);
  const owed = await supplierBalances(pool, { businessId: req.tenant.businessId, supplierIds: rows.map((r) => r.supplier_id).filter(Boolean) });
  page(res, rows.map((r) => ({ ...shape(r, on), payable: rupees(owed.get(r.supplier_id)?.outstanding ?? 0) })), total, pg);
};

/* GET /principals/:id — the agreement, brands, and the money between us */
const get = async (req, res) => {
  const row = await load(pool, req.tenant.businessId, req.params.id);
  if (!row) throw new WholesaleError(404, 'Not found');
  const on = await today(pool, req.tenant.businessId);
  const brands = (await pool.query(
    `SELECT b.brand_id, b.name, b.is_active, (SELECT COUNT(*) FROM products p WHERE p.brand_id = b.brand_id) AS products FROM brands b WHERE b.business_id = $1 AND b.principal_id = $2 ORDER BY lower(b.name)`,
    [req.tenant.businessId, row.principal_id])).rows;
  const money_ = row.supplier_id ? (await supplierBalances(pool, { businessId: req.tenant.businessId, supplierIds: [row.supplier_id] })).get(row.supplier_id) : null;
  const products = Number((await pool.query(`SELECT COUNT(*) AS n FROM wholesale_item_details WHERE business_id = $1 AND principal_id = $2`, [req.tenant.businessId, row.principal_id])).rows[0].n);
  ok(res, {
    ...shape(row, on), products,
    brands: brands.map((b) => ({ brand_id: b.brand_id, name: b.name, is_active: b.is_active, products: Number(b.products) })),
    account: money_ ? { purchased: rupees(money_.bought), returned: rupees(money_.debited), paid: rupees(money_.paid), adjustments: rupees(money_.adjustments), opening: rupees(money_.opening), outstanding: rupees(money_.outstanding) } : null
  });
};

/* POST /principals — also creates (or links) the supplier row the purchasing screens use */
const create = async (req, res) => {
  const b = req.body || {}; const f = fields(b, false);
  const id = await withTransaction(async (client) => {
    let supplierId = b.supplier_id ? Number(b.supplier_id) : null;
    if (supplierId) {
      if (!(await client.query(`SELECT 1 FROM suppliers WHERE business_id = $1 AND supplier_id = $2`, [req.tenant.businessId, supplierId])).rowCount) throw new WholesaleError(400, 'That supplier was not found');
      if ((await client.query(`SELECT 1 FROM dist_principals WHERE business_id = $1 AND supplier_id = $2`, [req.tenant.businessId, supplierId])).rowCount) throw new WholesaleError(409, 'That supplier is already a principal');
    } else {
      supplierId = (await client.query(
        `INSERT INTO suppliers (business_id, name, phone, email, address, gstin) VALUES ($1,$2,$3,$4,$5,$6) RETURNING supplier_id`,
        [req.tenant.businessId, f.company_name || f.name, f.phone ?? null, f.email ?? null, f.address ?? null, f.gstin ?? null])).rows[0].supplier_id;
      await client.query(`INSERT INTO wholesale_supplier_profiles (supplier_id, business_id, contact_person, pan, payment_terms_days) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (supplier_id) DO NOTHING`,
        [supplierId, req.tenant.businessId, f.contact_person ?? null, f.pan ?? null, f.payment_terms_days ?? null]);
    }
    const keys = Object.keys(f);
    try {
      return (await client.query(`INSERT INTO dist_principals (business_id, supplier_id, ${keys.join(', ')}) VALUES ($1, $2, ${keys.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING principal_id`,
        [req.tenant.businessId, supplierId, ...keys.map((k) => f[k])])).rows[0].principal_id;
    } catch (e) { if (e.code === '23505') throw new WholesaleError(409, 'You already have a principal with that name'); throw e; }
  });
  audit(req, 'distributor.principal_created', 'principal', id, null, f);
  const on = await today(pool, req.tenant.businessId);
  ok(res, shape(await load(pool, req.tenant.businessId, id), on), 201);
};

const update = async (req, res) => {
  const before = await load(pool, req.tenant.businessId, req.params.id);
  if (!before) throw new WholesaleError(404, 'Not found');
  const f = fields(req.body || {}, true); const keys = Object.keys(f);
  if (!keys.length) throw new WholesaleError(400, 'Nothing to update');
  await withTransaction(async (client) => {
    try { await client.query(`UPDATE dist_principals SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE business_id = $1 AND principal_id = $2`, [req.tenant.businessId, before.principal_id, ...keys.map((k) => f[k])]); }
    catch (e) { if (e.code === '23505') throw new WholesaleError(409, 'You already have a principal with that name'); throw e; }
    // the supplier row behind it keeps the same contact details, so purchase orders and the ledger always agree
    if (before.supplier_id) {
      const s = {}; for (const k of ['phone', 'email', 'address', 'gstin']) if (k in f) s[k] = f[k];
      if ('company_name' in f || 'name' in f) s.name = f.company_name ?? f.name ?? before.company_name ?? before.name;
      const sk = Object.keys(s);
      if (sk.length) await client.query(`UPDATE suppliers SET ${sk.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE business_id = $1 AND supplier_id = $2`, [req.tenant.businessId, before.supplier_id, ...sk.map((k) => s[k])]);
      const p = {}; if ('contact_person' in f) p.contact_person = f.contact_person; if ('pan' in f) p.pan = f.pan; if ('payment_terms_days' in f) p.payment_terms_days = f.payment_terms_days;
      const pk = Object.keys(p);
      if (pk.length) await client.query(`UPDATE wholesale_supplier_profiles SET ${pk.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE supplier_id = $1`, [before.supplier_id, ...pk.map((k) => p[k])]);
    }
  });
  const after = await load(pool, req.tenant.businessId, before.principal_id);
  const on = await today(pool, req.tenant.businessId);
  audit(req, 'distributor.principal_updated', 'principal', before.principal_id, null, null, { changes: diff(shape(before, on), shape(after, on)) });
  ok(res, shape(after, on));
};

/* GET /principals/:id/products?limit=&offset= — the products tagged to this principal */
const principalProducts = async (req, res) => {
  const row = await load(pool, req.tenant.businessId, req.params.id);
  if (!row) throw new WholesaleError(404, 'Not found');
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const total = Number((await pool.query(`SELECT COUNT(*) AS n FROM wholesale_item_details WHERE business_id = $1 AND principal_id = $2`, [req.tenant.businessId, row.principal_id])).rows[0].n);
  const rows = (await pool.query(
    `SELECT p.product_id, p.name, p.sku, p.unit, p.status, b.name AS brand, d.mrp_paise, d.principal_price_paise, p.purchase_price_paise, d.distributor_price_paise, d.wholesale_price_paise,
            COALESCE((SELECT SUM(bs.quantity) FROM branch_stock bs WHERE bs.product_id = p.product_id), 0) AS on_hand
     FROM wholesale_item_details d JOIN products p ON p.product_id = d.product_id LEFT JOIN brands b ON b.brand_id = p.brand_id
     WHERE d.business_id = $1 AND d.principal_id = $2 ORDER BY lower(p.name) LIMIT $3 OFFSET $4`, [req.tenant.businessId, row.principal_id, pg.limit, pg.offset])).rows;
  page(res, rows.map((r) => ({ product_id: r.product_id, name: r.name, sku: r.sku, unit: r.unit, status: r.status, brand: r.brand, mrp: rupees(r.mrp_paise), principal_price: r.principal_price_paise == null ? null : rupees(r.principal_price_paise),
    purchase_price: rupees(r.purchase_price_paise), distributor_price: r.distributor_price_paise == null ? null : rupees(r.distributor_price_paise), on_hand: Number(r.on_hand) })), total, pg);
};

/* POST /principals/:id/assign-products { product_ids: [], brand_id? } — tag many products to a principal (and a brand) at once */
const assignProducts = async (req, res) => {
  const row = await load(pool, req.tenant.businessId, req.params.id);
  if (!row) throw new WholesaleError(404, 'Not found');
  const ids = [...new Set((Array.isArray(req.body?.product_ids) ? req.body.product_ids : []).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) throw new WholesaleError(400, 'Choose at least one product');
  if (ids.length > 2000) throw new WholesaleError(400, 'Assign up to 2,000 products at a time');
  const brandId = req.body?.brand_id ? Number(req.body.brand_id) : null;
  if (brandId && !(await pool.query(`SELECT 1 FROM brands WHERE business_id = $1 AND brand_id = $2`, [req.tenant.businessId, brandId])).rowCount) throw new WholesaleError(400, 'That brand was not found');
  const done = await withTransaction(async (client) => {
    const own = (await client.query(`SELECT product_id FROM products WHERE business_id = $1 AND product_id = ANY($2::int[])`, [req.tenant.businessId, ids])).rows.map((r) => r.product_id);
    await client.query(
      `INSERT INTO wholesale_item_details (product_id, business_id, principal_id) SELECT x, $1, $2 FROM unnest($3::int[]) x
       ON CONFLICT (product_id) DO UPDATE SET principal_id = EXCLUDED.principal_id, updated_at = CURRENT_TIMESTAMP`, [req.tenant.businessId, row.principal_id, own]);
    if (brandId) await client.query(`UPDATE products SET brand_id = $3 WHERE business_id = $1 AND product_id = ANY($2::int[])`, [req.tenant.businessId, own, brandId]);
    return own.length;
  });
  audit(req, 'distributor.principal_products_assigned', 'principal', row.principal_id, null, null, { count: done, brand_id: brandId });
  ok(res, { assigned: done });
};

/* ── brands ───────────────────────────────────────────────────────────────── */
const listBrands = async (req, res) => {
  const values = [req.tenant.businessId]; const where = ['b.business_id = $1'];
  if (req.query.principal_id) { values.push(Number(req.query.principal_id) || 0); where.push(`b.principal_id = $${values.length}`); }
  if (req.query.status !== 'all') where.push('b.is_active');
  const rows = (await pool.query(
    `SELECT b.brand_id, b.name, b.is_active, b.principal_id, pr.name AS principal, (SELECT COUNT(*) FROM products p WHERE p.brand_id = b.brand_id) AS products
     FROM brands b LEFT JOIN dist_principals pr ON pr.principal_id = b.principal_id WHERE ${where.join(' AND ')} ORDER BY lower(b.name)`, values)).rows;
  ok(res, rows.map((r) => ({ brand_id: r.brand_id, name: r.name, is_active: r.is_active, principal_id: r.principal_id, principal: r.principal, products: Number(r.products) })));
};

const brandPrincipal = async (req, id) => {
  if (id == null) return null;
  if (!(await pool.query(`SELECT 1 FROM dist_principals WHERE business_id = $1 AND principal_id = $2`, [req.tenant.businessId, id])).rowCount) throw new WholesaleError(400, 'That principal was not found');
  return id;
};

const createBrand = async (req, res) => {
  const name = text(req.body?.name, 'Brand name', { max: 80, min: 2, required: true });
  const principalId = await brandPrincipal(req, int(req.body?.principal_id, 'Principal', { min: 1 }));
  if ((await pool.query(`SELECT 1 FROM brands WHERE business_id = $1 AND lower(name) = lower($2)`, [req.tenant.businessId, name])).rowCount) throw new WholesaleError(409, 'You already have a brand with that name');
  const row = (await pool.query(
    `INSERT INTO brands (business_id, name, principal_id, sort_order) VALUES ($1,$2,$3,(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM brands WHERE business_id = $1)) RETURNING *`, [req.tenant.businessId, name, principalId])).rows[0];
  audit(req, 'distributor.brand_created', 'brand', row.brand_id, null, { name, principal_id: principalId });
  ok(res, { brand_id: row.brand_id, name: row.name, is_active: row.is_active, principal_id: row.principal_id }, 201);
};

const updateBrand = async (req, res) => {
  const b = req.body || {};
  const before = (await pool.query(`SELECT * FROM brands WHERE business_id = $1 AND brand_id = $2`, [req.tenant.businessId, req.params.id])).rows[0];
  if (!before) throw new WholesaleError(404, 'Not found');
  const f = {};
  if ('name' in b) f.name = text(b.name, 'Brand name', { max: 80, min: 2, required: true });
  if ('principal_id' in b) f.principal_id = await brandPrincipal(req, int(b.principal_id, 'Principal', { min: 1 }));
  if ('is_active' in b) f.is_active = b.is_active === true || b.is_active === 'true';
  const keys = Object.keys(f); if (!keys.length) throw new WholesaleError(400, 'Nothing to update');
  const after = (await pool.query(`UPDATE brands SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE business_id = $1 AND brand_id = $2 RETURNING *`, [req.tenant.businessId, before.brand_id, ...keys.map((k) => f[k])])).rows[0];
  audit(req, 'distributor.brand_updated', 'brand', before.brand_id, null, null, { changes: diff(before, after) });
  ok(res, { brand_id: after.brand_id, name: after.name, is_active: after.is_active, principal_id: after.principal_id });
};

export default wrapAll({ list, get, create, update, principalProducts, assignProducts, listBrands, createBrand, updateBrand });
