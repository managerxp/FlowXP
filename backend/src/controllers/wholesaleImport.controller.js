/*
 * Bulk work: CSV import (the screen parses the file and posts the rows) and bulk edits.
 *
 * An import is checked row by row first (dry run: nothing is written) and applied only when every row is good, in one
 * transaction — a half-imported catalogue is worse than none. Errors name the spreadsheet row so they can be fixed in
 * the file. Products can arrive with their extra units (carton, box) and opening stock (with batch and expiry).
 */
import pool from '../config/database.js';
import { toPaise } from '../utils/money.js';
import { checkEmail, checkGstin, checkName } from '../utils/validate.js';
import { addToBatch, batchTracked, stockIn } from '../modules/wholesale/stock.js';
import {
  WholesaleError, audit, bool, getSettings, idList, int, isoDate, num, ok, oneOf, text, withTransaction, wrapAll
} from '../modules/wholesale/common.js';

const MAX_ROWS = 5000;
const CUSTOMER_TYPES = ['RETAILER', 'DEALER', 'DISTRIBUTOR', 'BUSINESS', 'CORPORATE', 'OTHER'];

const rowsOf = (body) => {
  const rows = Array.isArray(body?.rows) ? body.rows : null;
  if (!rows || !rows.length) throw new WholesaleError(400, 'The file has no rows');
  if (rows.length > MAX_ROWS) throw new WholesaleError(400, `Import up to ${MAX_ROWS.toLocaleString('en-IN')} rows at a time`);
  return rows;
};
const lower = (row) => Object.fromEntries(Object.entries(row || {}).map(([k, v]) => [String(k).trim().toLowerCase().replace(/[\s-]+/g, '_'), typeof v === 'string' ? v.trim() : v]));
const yes = (v) => ['yes', 'y', 'true', '1', 'x'].includes(String(v ?? '').trim().toLowerCase());
const blank = (v) => v == null || String(v).trim() === '';
const paise = (v, label) => { if (blank(v)) return null; const x = Number(String(v).replace(/[₹,]/g, '')); if (!Number.isFinite(x) || x < 0) throw new WholesaleError(400, `${label} is not an amount`); return Math.round(x * 100); };
const dec = (v, label, o = {}) => (blank(v) ? null : num(String(v).replace(/,/g, ''), label, o));

/** Run each row's `check`; collect errors with the spreadsheet row number (header is row 1). */
const checkAll = async (rows, fn) => {
  const errors = []; const ok_ = [];
  for (const [i, raw] of rows.entries()) {
    try { ok_.push(await fn(lower(raw), i)); } catch (error) {
      if (error instanceof WholesaleError || error.name === 'SalonError') errors.push({ row: i + 2, message: error.message });
      else throw error;
    }
  }
  return { errors, ok: ok_ };
};

const finish = (res, req, kind, rows, errors, apply, written) => {
  if (errors.length && apply) return res.status(422).json({ success: false, message: `${errors.length} row${errors.length === 1 ? ' has' : 's have'} a problem. Nothing was imported.`, data: { errors: errors.slice(0, 200), total_errors: errors.length } });
  if (apply) audit(req, `wholesale.import_${kind}`, kind, null, null, { rows: rows.length, ...written });
  ok(res, { applied: apply && !errors.length, rows: rows.length, errors: errors.slice(0, 200), total_errors: errors.length, ...(written || {}) });
};

/* ── products ───────────────────────────────────────────────────────────────────────────── */

/*
 * POST /import/products { rows, apply?: true, mode?: 'create' | 'upsert' }
 * columns: name*, sku, barcode, unit, category, brand, principal, pack_size, principal_price, hsn, tax_rate, purchase_price, wholesale_price, distributor_price, retailer_price, mrp, moq, reorder_level, max_stock,
 *          batch_tracking, expiry_tracking, unit_1_name, unit_1_factor, unit_2_name, unit_2_factor, opening_stock, warehouse, batch_no, expiry_date
 */
const importProducts = async (req, res) => {
  const rows = rowsOf(req.body); const apply = bool(req.body.apply); const upsert = req.body.mode === 'upsert';
  const businessId = req.tenant.businessId;
  const cats = new Map((await pool.query(`SELECT category_id, lower(name) AS n FROM categories WHERE business_id = $1 AND parent_id IS NULL`, [businessId])).rows.map((r) => [r.n, r.category_id]));
  const warehouses = new Map((await pool.query(`SELECT branch_id, lower(name) AS n FROM branches WHERE business_id = $1 AND status = 'ACTIVE'`, [businessId])).rows.map((r) => [r.n, r.branch_id]));
  const existing = new Map((await pool.query(`SELECT product_id, lower(sku) AS sku FROM products WHERE business_id = $1 AND sku IS NOT NULL`, [businessId])).rows.map((r) => [r.sku, r.product_id]));
  const taken = new Set((await pool.query(`SELECT barcode FROM products WHERE business_id = $1 AND barcode IS NOT NULL`, [businessId])).rows.map((r) => r.barcode));
  const principalsByName = new Map((await pool.query(`SELECT principal_id, lower(name) AS n FROM dist_principals WHERE business_id = $1`, [businessId])).rows.map((r) => [r.n, r.principal_id]));
  const seenSku = new Set(); const seenBar = new Set();
  const { errors, ok: items } = await checkAll(rows, async (r) => {
    const name = text(r.name, 'Name', { max: 160, min: 2, required: true });
    let principalId = null;
    if (!blank(r.principal)) { principalId = principalsByName.get(String(r.principal).trim().toLowerCase()); if (!principalId) throw new WholesaleError(400, `Principal "${r.principal}" was not found. Add it under Principals first.`); }
    const sku = text(r.sku, 'SKU', { max: 64 }); const barcode = text(r.barcode, 'Barcode', { max: 64 });
    if (sku) { if (seenSku.has(sku.toLowerCase())) throw new WholesaleError(400, `SKU ${sku} appears twice in the file`); seenSku.add(sku.toLowerCase()); }
    if (barcode) { if (seenBar.has(barcode)) throw new WholesaleError(400, `Barcode ${barcode} appears twice in the file`); seenBar.add(barcode); }
    const productId = sku ? existing.get(sku.toLowerCase()) : null;
    if (productId && !upsert) throw new WholesaleError(409, `SKU ${sku} already exists (choose "update existing" to change it)`);
    if (barcode && taken.has(barcode) && !productId) throw new WholesaleError(409, `Barcode ${barcode} is already used`);
    const unit = text(r.unit || 'pcs', 'Unit', { max: 24, required: true });
    const units = [];
    for (const k of [1, 2]) {
      if (blank(r[`unit_${k}_name`]) && blank(r[`unit_${k}_factor`])) continue;
      const un = text(r[`unit_${k}_name`], `Unit ${k} name`, { max: 24, required: true });
      const f = dec(r[`unit_${k}_factor`], `Unit ${k} factor`, { min: 0.0001, max: 10000000 });
      if (!f) throw new WholesaleError(400, `Unit ${k}: how many ${unit} in a ${un}?`);
      if ([unit.toLowerCase(), ...units.map((u) => u.unit_name.toLowerCase())].includes(un.toLowerCase())) throw new WholesaleError(400, `${un} is listed twice`);
      units.push({ unit_name: un, factor: f });
    }
    const category = text(r.category, 'Category', { max: 120 });
    const tax = dec(r.tax_rate, 'GST rate', { min: 0, max: 100 }) ?? 0;
    const stock = dec(r.opening_stock, 'Opening stock', { min: 0 });
    let warehouse = null;
    if (stock > 0) {
      warehouse = blank(r.warehouse) ? req.tenant.branchId : warehouses.get(String(r.warehouse).trim().toLowerCase());
      if (!warehouse) throw new WholesaleError(400, `Warehouse "${r.warehouse}" was not found`);
      if (req.tenant.pinned && warehouse !== req.tenant.branchId) throw new WholesaleError(403, 'You can only add stock to your own warehouse');
    }
    const expiry = isoDate(r.expiry_date, 'Expiry date');
    return {
      principalId, brand: text(r.brand, 'Brand', { max: 80 }), packSize: text(r.pack_size, 'Pack size', { max: 40 }), principalPrice: paise(r.principal_price, 'Principal price'),
      productId, name, sku, barcode, unit, units, category, hsn: text(r.hsn || r.hsn_sac, 'HSN', { max: 16 }), tax, cost: paise(r.purchase_price, 'Purchase price'),
      wholesale: paise(r.wholesale_price ?? r.selling_price, 'Wholesale price'), distributor: paise(r.distributor_price, 'Distributor price'), retailer: paise(r.retailer_price, 'Retailer price'), mrp: paise(r.mrp, 'MRP'),
      moq: dec(r.moq, 'MOQ', { min: 0.001 }) ?? 1, reorder: dec(r.reorder_level, 'Reorder level', { min: 0 }), max: dec(r.max_stock, 'Max stock', { min: 0 }),
      batch: yes(r.batch_tracking) || yes(r.expiry_tracking), expiryTracking: yes(r.expiry_tracking), stock, warehouse, batchNo: text(r.batch_no, 'Batch', { max: 40 }), expiry
    };
  });
  if (!apply || errors.length) return finish(res, req, 'products', rows, errors, apply, { to_create: items.filter((i) => !i.productId).length, to_update: items.filter((i) => i.productId).length });
  let created = 0; let updated = 0; let stocked = 0;
  await withTransaction(async (client) => {
    for (const it of items) {
      let categoryId = null;
      if (it.category) {
        categoryId = cats.get(it.category.toLowerCase());
        if (!categoryId) { categoryId = (await client.query(`INSERT INTO categories (business_id, name) VALUES ($1,$2) RETURNING category_id`, [businessId, it.category])).rows[0].category_id; cats.set(it.category.toLowerCase(), categoryId); }
      }
      let id = it.productId;
      const price = it.wholesale ?? 0;
      if (id) {
        const sets = ['name = $3', 'unit = $4', 'tax_rate = $5']; const vals = [id, businessId, it.name, it.unit, it.tax];
        const add = (col, v) => { if (v != null) { vals.push(v); sets.push(`${col} = $${vals.length}`); } };
        add('category_id', categoryId); add('hsn_sac', it.hsn); add('purchase_price_paise', it.cost); add('selling_price_paise', it.wholesale); add('barcode', it.barcode); add('min_stock', it.reorder);
        await client.query(`UPDATE products SET ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE product_id = $1 AND business_id = $2`, vals);
        updated++;
      } else {
        id = (await client.query(
          `INSERT INTO products (business_id, name, sku, barcode, unit, category_id, hsn_sac, tax_rate, purchase_price_paise, selling_price_paise, min_stock, kind, track_inventory)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'DISH',TRUE) RETURNING product_id`,
          [businessId, it.name, it.sku, it.barcode, it.unit, categoryId, it.hsn, it.tax, it.cost ?? 0, price, it.reorder ?? 0])).rows[0].product_id;
        created++;
      }
      await client.query(
        `INSERT INTO wholesale_item_details (product_id, business_id, mrp_paise, distributor_price_paise, wholesale_price_paise, retailer_price_paise, moq, max_stock, batch_tracking, expiry_tracking)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (product_id) DO UPDATE SET mrp_paise = COALESCE(EXCLUDED.mrp_paise, wholesale_item_details.mrp_paise), distributor_price_paise = COALESCE(EXCLUDED.distributor_price_paise, wholesale_item_details.distributor_price_paise),
           wholesale_price_paise = COALESCE(EXCLUDED.wholesale_price_paise, wholesale_item_details.wholesale_price_paise), retailer_price_paise = COALESCE(EXCLUDED.retailer_price_paise, wholesale_item_details.retailer_price_paise),
           moq = EXCLUDED.moq, max_stock = COALESCE(EXCLUDED.max_stock, wholesale_item_details.max_stock), batch_tracking = wholesale_item_details.batch_tracking OR EXCLUDED.batch_tracking, expiry_tracking = wholesale_item_details.expiry_tracking OR EXCLUDED.expiry_tracking, updated_at = CURRENT_TIMESTAMP`,
        [id, businessId, it.mrp, it.distributor, it.wholesale, it.retailer, it.moq, it.max, it.batch, it.expiryTracking]);
      if (it.brand) {
        let brandId = (await client.query(`SELECT brand_id FROM brands WHERE business_id = $1 AND lower(name) = lower($2)`, [businessId, it.brand])).rows[0]?.brand_id;
        if (!brandId) brandId = (await client.query(`INSERT INTO brands (business_id, name, principal_id, sort_order) VALUES ($1,$2,$3,(SELECT COALESCE(MAX(sort_order), 0) + 1 FROM brands WHERE business_id = $1)) RETURNING brand_id`, [businessId, it.brand, it.principalId])).rows[0].brand_id;
        else if (it.principalId) await client.query(`UPDATE brands SET principal_id = COALESCE(principal_id, $2) WHERE brand_id = $1`, [brandId, it.principalId]);
        await client.query(`UPDATE products SET brand_id = $2 WHERE product_id = $1`, [id, brandId]);
      }
      if (it.principalId || it.packSize || it.principalPrice != null) {
        await client.query(`UPDATE wholesale_item_details SET principal_id = COALESCE($2, principal_id), pack_size = COALESCE($3, pack_size), principal_price_paise = COALESCE($4, principal_price_paise) WHERE product_id = $1`, [id, it.principalId, it.packSize, it.principalPrice]);
      }
      for (const u of it.units) await client.query(`INSERT INTO wholesale_product_units (business_id, product_id, unit_name, factor) VALUES ($1,$2,$3,$4) ON CONFLICT (product_id, lower(unit_name)) DO UPDATE SET factor = EXCLUDED.factor`, [businessId, id, u.unit_name, u.factor]);
      if (it.stock > 0) {
        await client.query(`SELECT 1 FROM products WHERE product_id = $1 FOR UPDATE`, [id]);
        const tr = (await batchTracked(client, businessId, [id])).get(id) || {};
        if (tr.batch_tracking || tr.expiry_tracking) {
          if (!it.batchNo) throw new WholesaleError(400, `${it.name}: batch number is needed for opening stock`);
          await addToBatch(client, { businessId, branchId: it.warehouse, productId: id, batchNo: it.batchNo, expiryDate: it.expiry, qty: it.stock, costPaise: it.cost, source: 'OPENING', refType: 'opening' });
        }
        await stockIn(client, { businessId, branchId: it.warehouse, productId: id, qty: it.stock, type: 'OPENING', refType: 'import', notes: 'Opening stock (import)', userId: req.auth.userId });
        stocked++;
      }
    }
  });
  finish(res, req, 'products', rows, errors, apply, { created, updated, opening_stock_lines: stocked });
};

/* ── customers and suppliers ────────────────────────────────────────────────────────────── */

const gstin = (v) => { if (blank(v)) return null; const e = checkGstin(v); if (e) throw new WholesaleError(400, e); return String(v).trim().toUpperCase(); };
const pan = (v) => { if (blank(v)) return null; if (!/^[A-Z]{5}\d{4}[A-Z]$/i.test(String(v).trim())) throw new WholesaleError(400, 'A PAN is 10 characters like ABCDE1234F'); return String(v).trim().toUpperCase(); };
const phoneKey = (v) => String(v ?? '').replace(/\D/g, '').slice(-10);

/*
 * POST /import/customers { rows, apply? }
 * columns: name*, phone, email, gstin, pan, type, contact_person, address, city, state, pincode, shipping_address, payment_terms_days, credit_limit, opening_balance, salesperson, price_list, discount_pct,
 *          territory (a region / territory / area by name), beat (an existing beat; the retailer goes to the end of its route)
 * A row matching an existing customer (same GSTIN, else same mobile number) updates that customer.
 */
const importCustomers = async (req, res) => {
  const rows = rowsOf(req.body); const apply = bool(req.body.apply); const businessId = req.tenant.businessId;
  const people = new Map((await pool.query(`SELECT salesperson_id, lower(name) AS n FROM wholesale_salespeople WHERE business_id = $1`, [businessId])).rows.map((r) => [r.n, r.salesperson_id]));
  const lists = new Map((await pool.query(`SELECT list_id, lower(name) AS n FROM wholesale_price_lists WHERE business_id = $1`, [businessId])).rows.map((r) => [r.n, r.list_id]));
  const nodes = (await pool.query(`SELECT territory_id, lower(name) AS n, level FROM dist_territories WHERE business_id = $1`, [businessId])).rows;
  const beats = new Map((await pool.query(`SELECT beat_id, lower(name) AS n, weekday FROM dist_beats WHERE business_id = $1`, [businessId])).rows.map((r) => [r.n, r]));
  const byGst = new Map(); const byPhone = new Map();
  for (const c of (await pool.query(`SELECT customer_id, gstin, phone FROM customers WHERE business_id = $1`, [businessId])).rows) { if (c.gstin) byGst.set(c.gstin.toUpperCase(), c.customer_id); if (phoneKey(c.phone).length === 10) byPhone.set(phoneKey(c.phone), c.customer_id); }
  const seen = new Set();
  const { errors, ok: items } = await checkAll(rows, async (r) => {
    const name = String(r.name ?? '').trim(); const e = checkName(name, 'Customer name'); if (e) throw new WholesaleError(400, e);
    if (!blank(r.email)) { const m = checkEmail(r.email); if (m) throw new WholesaleError(400, m); }
    const g = gstin(r.gstin); const phone = blank(r.phone) ? null : String(r.phone).trim();
    if (phone && !/^\+?\d[\d\s-]{6,18}$/.test(phone)) throw new WholesaleError(400, 'Enter a valid phone number');
    const key = g || (phone ? phoneKey(phone) : `name:${name.toLowerCase()}`);
    if (seen.has(key)) throw new WholesaleError(400, 'This customer appears twice in the file');
    seen.add(key);
    const customerId = (g && byGst.get(g)) || (phone && byPhone.get(phoneKey(phone))) || null;
    const type = blank(r.type) ? null : oneOf(r.type, 'Type', CUSTOMER_TYPES);
    let sp = null; if (!blank(r.salesperson)) { sp = people.get(String(r.salesperson).trim().toLowerCase()); if (!sp) throw new WholesaleError(400, `Salesperson "${r.salesperson}" was not found`); }
    let pl = null; if (!blank(r.price_list)) { pl = lists.get(String(r.price_list).trim().toLowerCase()); if (!pl) throw new WholesaleError(400, `Price list "${r.price_list}" was not found`); }
    const pin = text(r.pincode, 'Pincode', { max: 6 }); if (pin && !/^[1-9]\d{5}$/.test(pin)) throw new WholesaleError(400, 'A pincode is 6 digits');
    // a territory by name — "Ameerpet", or the whole path "South > Secunderabad > Ameerpet" (the last name counts); it has to be unambiguous
    let territoryId = null;
    if (!blank(r.territory)) {
      const last = String(r.territory).split(/[>/›]/).pop().trim().toLowerCase();
      const hit = nodes.filter((x) => x.n === last);
      if (!hit.length) throw new WholesaleError(400, `Territory "${r.territory}" was not found`);
      if (hit.length > 1) throw new WholesaleError(400, `"${r.territory}" matches more than one territory. Use a more specific name.`);
      territoryId = hit[0].territory_id;
    }
    let beat = null; if (!blank(r.beat)) { beat = beats.get(String(r.beat).trim().toLowerCase()); if (!beat) throw new WholesaleError(400, `Beat "${r.beat}" was not found`); }
    return {
      territoryId, beat,
      customerId, name, phone, email: blank(r.email) ? null : String(r.email).trim().toLowerCase(), gstin: g, pan: pan(r.pan), type, contact: text(r.contact_person, 'Contact', { max: 120 }), address: text(r.address, 'Address', { max: 400 }), city: text(r.city, 'City', { max: 80 }),
      state: text(r.state, 'State', { max: 80 }), pincode: pin, shipping: text(r.shipping_address, 'Shipping address', { max: 400 }), terms: dec(r.payment_terms_days, 'Payment terms', { min: 0, max: 365 }), limit: paise(r.credit_limit, 'Credit limit'),
      opening: blank(r.opening_balance) ? null : Math.round(Number(String(r.opening_balance).replace(/[₹,]/g, '')) * 100), sp, pl, discount: dec(r.discount_pct, 'Discount', { min: 0, max: 100 })
    };
  });
  if (!apply || errors.length) return finish(res, req, 'customers', rows, errors, apply, { to_create: items.filter((i) => !i.customerId).length, to_update: items.filter((i) => i.customerId).length });
  let created = 0; let updated = 0;
  await withTransaction(async (client) => {
    for (const it of items) {
      let id = it.customerId;
      if (id) {
        await client.query(`UPDATE customers SET name = $3, phone = COALESCE($4, phone), email = COALESCE($5, email), gstin = COALESCE($6, gstin), address = COALESCE($7, address), state = COALESCE($8, state), pincode = COALESCE($9, pincode), credit_limit_paise = COALESCE($10, credit_limit_paise) WHERE customer_id = $1 AND business_id = $2`,
          [id, businessId, it.name, it.phone, it.email, it.gstin, it.address, it.state, it.pincode, it.limit]);
        updated++;
      } else {
        id = (await client.query(`INSERT INTO customers (business_id, name, phone, email, gstin, address, state, pincode, credit_limit_paise) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING customer_id`, [businessId, it.name, it.phone, it.email, it.gstin, it.address, it.state, it.pincode, it.limit ?? 0])).rows[0].customer_id;
        created++;
      }
      await client.query(
        `INSERT INTO wholesale_customer_profiles (customer_id, business_id, customer_type, contact_person, pan, billing_address, shipping_address, city, payment_terms_days, salesperson_id, price_list_id, default_discount_pct, opening_balance_paise)
         VALUES ($1,$2,COALESCE($3,'RETAILER'),$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,0),COALESCE($13,0))
         ON CONFLICT (customer_id) DO UPDATE SET customer_type = COALESCE($3, wholesale_customer_profiles.customer_type), contact_person = COALESCE($4, wholesale_customer_profiles.contact_person), pan = COALESCE($5, wholesale_customer_profiles.pan),
           billing_address = COALESCE($6, wholesale_customer_profiles.billing_address), shipping_address = COALESCE($7, wholesale_customer_profiles.shipping_address), city = COALESCE($8, wholesale_customer_profiles.city),
           payment_terms_days = COALESCE($9, wholesale_customer_profiles.payment_terms_days), salesperson_id = COALESCE($10, wholesale_customer_profiles.salesperson_id), price_list_id = COALESCE($11, wholesale_customer_profiles.price_list_id),
           default_discount_pct = COALESCE($12, wholesale_customer_profiles.default_discount_pct), opening_balance_paise = COALESCE($13, wholesale_customer_profiles.opening_balance_paise), updated_at = CURRENT_TIMESTAMP`,
        [id, businessId, it.type, it.contact, it.pan, it.address, it.shipping, it.city, it.terms, it.sp, it.pl, it.discount, it.opening]);
      if (it.territoryId) await client.query(`UPDATE wholesale_customer_profiles SET territory_id = $2 WHERE customer_id = $1`, [id, it.territoryId]);
      if (it.beat) {
        // on the beat, at the end of its route — unless the retailer is already on a beat that runs the same day
        const clash = it.beat.weekday != null ? (await client.query(
          `SELECT b.name FROM dist_beat_customers bc JOIN dist_beats b ON b.beat_id = bc.beat_id WHERE bc.customer_id = $1 AND b.beat_id <> $2 AND b.status = 'ACTIVE' AND b.weekday = $3 LIMIT 1`, [id, it.beat.beat_id, it.beat.weekday])).rows[0] : null;
        if (clash) throw new WholesaleError(409, `${it.name} is already on ${clash.name}, which runs on the same day`);
        await client.query(`INSERT INTO dist_beat_customers (beat_id, customer_id, business_id, seq) VALUES ($1,$2,$3,(SELECT COALESCE(MAX(seq), 0) + 1 FROM dist_beat_customers WHERE beat_id = $1)) ON CONFLICT DO NOTHING`, [it.beat.beat_id, id, businessId]);
      }
    }
  });
  finish(res, req, 'customers', rows, errors, apply, { created, updated });
};

/* POST /import/suppliers { rows, apply? } — columns: name*, phone, email, gstin, pan, contact_person, address, city, state, pincode, payment_terms_days, opening_balance, bank_details */
const importSuppliers = async (req, res) => {
  const rows = rowsOf(req.body); const apply = bool(req.body.apply); const businessId = req.tenant.businessId;
  const byGst = new Map(); const byName = new Map();
  for (const s of (await pool.query(`SELECT supplier_id, gstin, lower(name) AS n FROM suppliers WHERE business_id = $1`, [businessId])).rows) { if (s.gstin) byGst.set(s.gstin.toUpperCase(), s.supplier_id); byName.set(s.n, s.supplier_id); }
  const seen = new Set();
  const { errors, ok: items } = await checkAll(rows, async (r) => {
    const name = String(r.name ?? '').trim(); const e = checkName(name, 'Supplier name'); if (e) throw new WholesaleError(400, e);
    if (!blank(r.email)) { const m = checkEmail(r.email); if (m) throw new WholesaleError(400, m); }
    const g = gstin(r.gstin); const key = g || name.toLowerCase();
    if (seen.has(key)) throw new WholesaleError(400, 'This supplier appears twice in the file'); seen.add(key);
    const pin = text(r.pincode, 'Pincode', { max: 6 }); if (pin && !/^[1-9]\d{5}$/.test(pin)) throw new WholesaleError(400, 'A pincode is 6 digits');
    return { supplierId: (g && byGst.get(g)) || byName.get(name.toLowerCase()) || null, name, phone: text(r.phone, 'Phone', { max: 32 }), email: blank(r.email) ? null : String(r.email).trim().toLowerCase(), gstin: g, address: text(r.address, 'Address', { max: 400 }),
      contact: text(r.contact_person, 'Contact', { max: 120 }), pan: pan(r.pan), city: text(r.city, 'City', { max: 80 }), state: text(r.state, 'State', { max: 80 }), pincode: pin, terms: dec(r.payment_terms_days, 'Payment terms', { min: 0, max: 365 }),
      opening: blank(r.opening_balance) ? null : Math.round(Number(String(r.opening_balance).replace(/[₹,]/g, '')) * 100), bank: text(r.bank_details, 'Bank details', { max: 300 }) };
  });
  if (!apply || errors.length) return finish(res, req, 'suppliers', rows, errors, apply, { to_create: items.filter((i) => !i.supplierId).length, to_update: items.filter((i) => i.supplierId).length });
  let created = 0; let updated = 0;
  await withTransaction(async (client) => {
    for (const it of items) {
      let id = it.supplierId;
      if (id) { await client.query(`UPDATE suppliers SET name = $3, phone = COALESCE($4, phone), email = COALESCE($5, email), gstin = COALESCE($6, gstin), address = COALESCE($7, address) WHERE supplier_id = $1 AND business_id = $2`, [id, businessId, it.name, it.phone, it.email, it.gstin, it.address]); updated++; }
      else { id = (await client.query(`INSERT INTO suppliers (business_id, name, phone, email, gstin, address) VALUES ($1,$2,$3,$4,$5,$6) RETURNING supplier_id`, [businessId, it.name, it.phone, it.email, it.gstin, it.address])).rows[0].supplier_id; created++; }
      await client.query(
        `INSERT INTO wholesale_supplier_profiles (supplier_id, business_id, contact_person, pan, city, state, pincode, payment_terms_days, opening_balance_paise, bank_details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,0),$10)
         ON CONFLICT (supplier_id) DO UPDATE SET contact_person = COALESCE($3, wholesale_supplier_profiles.contact_person), pan = COALESCE($4, wholesale_supplier_profiles.pan), city = COALESCE($5, wholesale_supplier_profiles.city), state = COALESCE($6, wholesale_supplier_profiles.state),
           pincode = COALESCE($7, wholesale_supplier_profiles.pincode), payment_terms_days = COALESCE($8, wholesale_supplier_profiles.payment_terms_days), opening_balance_paise = COALESCE($9, wholesale_supplier_profiles.opening_balance_paise), bank_details = COALESCE($10, wholesale_supplier_profiles.bank_details), updated_at = CURRENT_TIMESTAMP`,
        [id, businessId, it.contact, it.pan, it.city, it.state, it.pincode, it.terms, it.opening, it.bank]);
    }
  });
  finish(res, req, 'suppliers', rows, errors, apply, { created, updated });
};

/* ── bulk edits ─────────────────────────────────────────────────────────────────────────── */

/* POST /products/bulk { ids, action: ARCHIVE | RESTORE | SET_CATEGORY | SET_TAX | SET_MOQ | SET_REORDER, value? } */
const bulkProducts = async (req, res) => {
  const ids = idList(req.body?.ids, 'Products', { max: 2000 });
  if (!ids.length) throw new WholesaleError(400, 'Choose some products');
  const action = oneOf(req.body?.action, 'Action', ['ARCHIVE', 'RESTORE', 'SET_CATEGORY', 'SET_TAX', 'SET_MOQ', 'SET_REORDER'], { required: true });
  const v = req.body?.value; const businessId = req.tenant.businessId; let count = 0;
  await withTransaction(async (client) => {
    if (action === 'ARCHIVE' || action === 'RESTORE') count = (await client.query(`UPDATE products SET status = $3, updated_at = CURRENT_TIMESTAMP WHERE business_id = $1 AND product_id = ANY($2::int[])`, [businessId, ids, action === 'ARCHIVE' ? 'ARCHIVED' : 'ACTIVE'])).rowCount;
    else if (action === 'SET_CATEGORY') {
      const cat = int(v, 'Category', { min: 1, required: true });
      if (!(await client.query(`SELECT 1 FROM categories WHERE category_id = $1 AND business_id = $2`, [cat, businessId])).rowCount) throw new WholesaleError(400, 'Choose a category from your list');
      count = (await client.query(`UPDATE products SET category_id = $3, updated_at = CURRENT_TIMESTAMP WHERE business_id = $1 AND product_id = ANY($2::int[])`, [businessId, ids, cat])).rowCount;
    } else if (action === 'SET_TAX') count = (await client.query(`UPDATE products SET tax_rate = $3, updated_at = CURRENT_TIMESTAMP WHERE business_id = $1 AND product_id = ANY($2::int[])`, [businessId, ids, num(v, 'GST rate', { min: 0, max: 100, required: true })])).rowCount;
    else if (action === 'SET_REORDER') count = (await client.query(`UPDATE products SET min_stock = $3, updated_at = CURRENT_TIMESTAMP WHERE business_id = $1 AND product_id = ANY($2::int[])`, [businessId, ids, num(v, 'Reorder level', { min: 0, required: true })])).rowCount;
    else {
      const moq = num(v, 'Minimum order quantity', { min: 0.001, required: true });
      const own = (await client.query(`SELECT product_id FROM products WHERE business_id = $1 AND product_id = ANY($2::int[])`, [businessId, ids])).rows;
      for (const p of own) await client.query(`INSERT INTO wholesale_item_details (product_id, business_id, moq) VALUES ($1,$2,$3) ON CONFLICT (product_id) DO UPDATE SET moq = EXCLUDED.moq, updated_at = CURRENT_TIMESTAMP`, [p.product_id, businessId, moq]);
      count = own.length;
    }
  });
  audit(req, 'wholesale.products_bulk', 'product', null, null, { action, products: count, value: v ?? null });
  ok(res, { updated: count });
};

/* POST /customers/bulk { ids, action: ASSIGN_SALESPERSON | SET_PRICE_LIST | SET_TERMS | SET_TYPE | ARCHIVE | RESTORE, value? } */
const bulkCustomers = async (req, res) => {
  const ids = idList(req.body?.ids, 'Customers', { max: 2000 });
  if (!ids.length) throw new WholesaleError(400, 'Choose some customers');
  const action = oneOf(req.body?.action, 'Action', ['ASSIGN_SALESPERSON', 'SET_PRICE_LIST', 'SET_TERMS', 'SET_TYPE', 'ARCHIVE', 'RESTORE'], { required: true });
  const v = req.body?.value; const businessId = req.tenant.businessId; let count = 0;
  await withTransaction(async (client) => {
    const own = (await client.query(`SELECT customer_id FROM customers WHERE business_id = $1 AND customer_id = ANY($2::int[])`, [businessId, ids])).rows.map((r) => r.customer_id);
    count = own.length;
    if (action === 'ARCHIVE' || action === 'RESTORE') { await client.query(`UPDATE customers SET status = $3 WHERE business_id = $1 AND customer_id = ANY($2::int[])`, [businessId, own, action === 'ARCHIVE' ? 'ARCHIVED' : 'ACTIVE']); return; }
    let col; let val;
    if (action === 'ASSIGN_SALESPERSON') { col = 'salesperson_id'; val = v === null || v === '' ? null : int(v, 'Salesperson', { min: 1 }); if (val && !(await client.query(`SELECT 1 FROM wholesale_salespeople WHERE business_id = $1 AND salesperson_id = $2`, [businessId, val])).rowCount) throw new WholesaleError(400, 'Choose a salesperson from your list'); }
    else if (action === 'SET_PRICE_LIST') { col = 'price_list_id'; val = v === null || v === '' ? null : int(v, 'Price list', { min: 1 }); if (val && !(await client.query(`SELECT 1 FROM wholesale_price_lists WHERE business_id = $1 AND list_id = $2`, [businessId, val])).rowCount) throw new WholesaleError(400, 'Choose a price list from your list'); }
    else if (action === 'SET_TERMS') { col = 'payment_terms_days'; val = int(v, 'Payment terms', { min: 0, max: 365, required: true }); }
    else { col = 'customer_type'; val = oneOf(v, 'Type', CUSTOMER_TYPES, { required: true }); }
    for (const id of own) await client.query(`INSERT INTO wholesale_customer_profiles (customer_id, business_id, ${col}) VALUES ($1,$2,$3) ON CONFLICT (customer_id) DO UPDATE SET ${col} = EXCLUDED.${col}, updated_at = CURRENT_TIMESTAMP`, [id, businessId, val]);
  });
  audit(req, 'wholesale.customers_bulk', 'customer', null, null, { action, customers: count, value: v ?? null });
  ok(res, { updated: count });
};

export { rowsOf, lower, checkAll, finish, blank, paise, dec, yes };
export default wrapAll({ importProducts, importCustomers, importSuppliers, bulkProducts, bulkCustomers });
