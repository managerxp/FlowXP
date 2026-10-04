/*
 * Distributor bulk imports: price lists and stock. Same contract as the wholesale importers — the screen parses the file
 * and posts the rows; every row is checked first (a dry run writes nothing), and the lot is applied in one transaction
 * only when every row is good, with errors naming the spreadsheet row.
 */
import pool from '../config/database.js';
import { loadUnits } from '../modules/wholesale/units.js';
import { addToBatch, batchTracked, lockProducts, stockIn } from '../modules/wholesale/stock.js';
import { WholesaleError, bool, isoDate, oneOf, ok, text, withTransaction, wrapAll, q3, audit } from '../modules/distributor/common.js';
import { blank, checkAll, dec, finish, paise, rowsOf } from './wholesaleImport.controller.js';

/** The product a row means: by SKU, else barcode, else exact name. */
const productLookup = async (businessId) => {
  const rows = (await pool.query(`SELECT product_id, name, unit, lower(sku) AS sku, barcode FROM products WHERE business_id = $1 AND status = 'ACTIVE' AND kind IN ('DISH','INGREDIENT','PACKAGING')`, [businessId])).rows;
  const bySku = new Map(rows.filter((r) => r.sku).map((r) => [r.sku, r])); const byBar = new Map(rows.filter((r) => r.barcode).map((r) => [r.barcode, r])); const byName = new Map(); const dup = new Set();
  for (const r of rows) { const k = r.name.toLowerCase(); if (byName.has(k)) dup.add(k); byName.set(k, r); }
  return (r) => {
    const sku = String(r.sku ?? '').trim().toLowerCase(); const bar = String(r.barcode ?? '').trim(); const name = String(r.product ?? r.name ?? '').trim().toLowerCase();
    const hit = (sku && bySku.get(sku)) || (bar && byBar.get(bar)) || (name && !dup.has(name) && byName.get(name));
    if (!hit) throw new WholesaleError(400, sku || bar || name ? `Product "${r.sku || r.barcode || r.product || r.name}" was not found${name && dup.has(name) ? ' (the name matches more than one product: use the SKU)' : ''}` : 'Give the product’s SKU, barcode or name');
    return hit;
  };
};

/*
 * POST /import/price-list { list_name, kind?, customer_type?, territory_id?, rows, replace?, apply? }
 * columns: sku | barcode | product, unit, min_qty, price (or discount_pct)
 * The list is created when no list has that name. A rule for the same product, unit and break is changed, not duplicated.
 */
const importPriceList = async (req, res) => {
  const rows = rowsOf(req.body); const apply = bool(req.body.apply); const businessId = req.tenant.businessId;
  const listName = text(req.body.list_name, 'Price list name', { max: 80, min: 2, required: true });
  const find = await productLookup(businessId);
  const units = await loadUnits(pool, businessId, (await pool.query(`SELECT product_id FROM products WHERE business_id = $1`, [businessId])).rows.map((r) => r.product_id));
  const seen = new Set();
  const { errors, ok: items } = await checkAll(rows, async (r) => {
    const p = find(r);
    const unitName = blank(r.unit) ? null : String(r.unit).trim();
    if (unitName && !units.get(p.product_id)?.units.has(unitName.toLowerCase())) throw new WholesaleError(400, `${p.name} is not sold in ${unitName}`);
    const price = paise(r.price, 'Price'); const discount = dec(r.discount_pct, 'Discount', { min: 0.001, max: 100 });
    if ((price == null) === (discount == null)) throw new WholesaleError(400, 'Give a price or a discount %, not both and not neither');
    const minQty = dec(r.min_qty, 'Minimum quantity', { min: 0.001 }) ?? 1;
    const key = `${p.product_id}|${(unitName || '').toLowerCase()}|${minQty}`;
    if (seen.has(key)) throw new WholesaleError(400, 'That product, unit and quantity break appears twice in the file');
    seen.add(key);
    return { productId: p.product_id, unitName: unitName ? units.get(p.product_id).units.get(unitName.toLowerCase()).name : null, minQty, price, discount };
  });
  const existing = (await pool.query(`SELECT list_id FROM wholesale_price_lists WHERE business_id = $1 AND lower(name) = lower($2)`, [businessId, listName])).rows[0];
  if (!apply || errors.length) return finish(res, req, 'price_list', rows, errors, apply, { list: listName, creates_list: !existing, rules: items.length });
  let created = 0; let changed = 0; let listId;
  await withTransaction(async (client) => {
    if (existing) listId = existing.list_id;
    else {
      const territoryId = req.body.territory_id ? Number(req.body.territory_id) : null;
      if (territoryId && !(await client.query(`SELECT 1 FROM dist_territories WHERE business_id = $1 AND territory_id = $2`, [businessId, territoryId])).rowCount) throw new WholesaleError(400, 'That territory was not found');
      listId = (await client.query(
        `INSERT INTO wholesale_price_lists (business_id, name, kind, customer_type, territory_id) VALUES ($1,$2,$3,$4,$5) RETURNING list_id`,
        [businessId, listName, oneOf(req.body.kind, 'Kind', ['STANDARD', 'PROMOTION'], { fallback: 'STANDARD' }), req.body.customer_type ? oneOf(req.body.customer_type, 'Customer type', ['RETAILER', 'DEALER', 'DISTRIBUTOR', 'BUSINESS', 'CORPORATE', 'OTHER']) : null, territoryId])).rows[0].list_id;
    }
    if (bool(req.body.replace)) await client.query(`DELETE FROM wholesale_price_list_items WHERE list_id = $1`, [listId]);
    for (const it of items) {
      const gone = await client.query(`DELETE FROM wholesale_price_list_items WHERE list_id = $1 AND product_id = $2 AND unit_name IS NOT DISTINCT FROM $3 AND min_qty = $4`, [listId, it.productId, it.unitName, it.minQty]);
      await client.query(`INSERT INTO wholesale_price_list_items (list_id, business_id, product_id, unit_name, min_qty, price_paise, discount_pct) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [listId, businessId, it.productId, it.unitName, it.minQty, it.price, it.discount]);
      gone.rowCount ? changed++ : created++;
    }
  });
  finish(res, req, 'price_list', rows, errors, apply, { list: listName, list_id: listId, created, changed });
};

/*
 * POST /import/stock { mode: 'add' | 'set', rows, apply? }
 * columns: sku | barcode | product, warehouse, quantity, unit, batch_no, mfg_date, expiry_date, cost
 *   add  puts that much more on the shelf (opening stock, or a count of new goods)
 *   set  makes the shelf hold exactly that (a stock take): the difference is booked as an adjustment
 * A batch- or expiry-tracked product needs a batch number (and an expiry date where it is expiry-tracked).
 */
const importStock = async (req, res) => {
  const rows = rowsOf(req.body); const apply = bool(req.body.apply); const businessId = req.tenant.businessId;
  const mode = oneOf(req.body.mode, 'Mode', ['ADD', 'SET'], { fallback: 'ADD' });
  const find = await productLookup(businessId);
  const warehouses = new Map((await pool.query(`SELECT branch_id, lower(name) AS n FROM branches WHERE business_id = $1 AND status = 'ACTIVE'`, [businessId])).rows.map((r) => [r.n, r.branch_id]));
  const ids = (await pool.query(`SELECT product_id FROM products WHERE business_id = $1`, [businessId])).rows.map((r) => r.product_id);
  const units = await loadUnits(pool, businessId, ids); const tracking = await batchTracked(pool, businessId, ids);
  const seen = new Set();
  const { errors, ok: items } = await checkAll(rows, async (r) => {
    const p = find(r);
    const branch = blank(r.warehouse) ? req.tenant.branchId : warehouses.get(String(r.warehouse).trim().toLowerCase());
    if (!branch) throw new WholesaleError(400, `Warehouse "${r.warehouse}" was not found`);
    if (req.tenant.pinned && branch !== req.tenant.branchId) throw new WholesaleError(403, 'You can only change stock in your own warehouse');
    let qty = dec(r.quantity, 'Quantity', { min: mode === 'SET' ? 0 : 0.001 });
    if (qty == null) throw new WholesaleError(400, 'Enter the quantity');
    if (!blank(r.unit)) {
      const u = units.get(p.product_id)?.units.get(String(r.unit).trim().toLowerCase());
      if (!u) throw new WholesaleError(400, `${p.name} is not counted in ${r.unit}`);
      qty = q3(qty * u.factor);
    }
    const tr = tracking.get(p.product_id) || {};
    const batchNo = text(r.batch_no, 'Batch', { max: 40 }); const expiry = isoDate(r.expiry_date, 'Expiry date'); const mfg = isoDate(r.mfg_date, 'Manufacturing date');
    if ((tr.batch_tracking || tr.expiry_tracking) && !batchNo) throw new WholesaleError(400, `${p.name} is batch-tracked: give a batch number`);
    if (tr.expiry_tracking && !expiry) throw new WholesaleError(400, `${p.name} expires: give an expiry date`);
    if (mode === 'SET' && batchNo) throw new WholesaleError(400, 'A stock take sets the whole quantity of a product; leave the batch out and use "add" for batches');
    const key = `${p.product_id}|${branch}|${(batchNo || '').toLowerCase()}`;
    if (seen.has(key)) throw new WholesaleError(400, 'That product and warehouse (and batch) appears twice in the file');
    seen.add(key);
    return { product: p, branch, qty, batchNo, expiry, mfg, cost: paise(r.cost, 'Cost') };
  });
  if (!apply || errors.length) return finish(res, req, 'stock', rows, errors, apply, { mode: mode.toLowerCase(), lines: items.length });
  let moved = 0;
  await withTransaction(async (client) => {
    await lockProducts(client, businessId, [...new Set(items.map((i) => i.product.product_id))].sort((a, b) => a - b));
    for (const it of items) {
      let delta = it.qty;
      if (mode === 'SET') {
        const cur = Number((await client.query(`SELECT COALESCE(quantity, 0) AS q FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [it.branch, it.product.product_id])).rows[0]?.q ?? 0);
        delta = q3(it.qty - cur);
        if (!delta) continue;
      }
      if (it.batchNo && delta > 0) await addToBatch(client, { businessId, branchId: it.branch, productId: it.product.product_id, batchNo: it.batchNo, mfgDate: it.mfg, expiryDate: it.expiry, qty: delta, costPaise: it.cost, source: 'OPENING', refType: 'opening' });
      await stockIn(client, { businessId, branchId: it.branch, productId: it.product.product_id, qty: delta, type: mode === 'SET' ? 'ADJUSTMENT' : 'OPENING', refType: 'import', notes: mode === 'SET' ? 'Stock take (import)' : 'Stock added (import)', userId: req.auth.userId });
      moved++;
    }
  });
  audit(req, 'distributor.stock_import', 'stock', null, null, { mode, lines: items.length, changed: moved });
  finish(res, req, 'stock', rows, errors, apply, { mode: mode.toLowerCase(), lines: items.length, changed: moved });
};

export default wrapAll({ importPriceList, importStock });
void ok;
