/*
 * Clothing catalogue: a style with its size/colour variants made in one go, SKU and in-store barcode per variant, opening stock through the ledger, adding colours and sizes later,
 * editing a style (identity follows, prices only on request), the size x colour grid, search, CSV import (all or nothing), selling and taking back a variant through the ordinary
 * till, plan gating, permissions and isolation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { makeShop } from './helpers/autoparts.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const ctl = (await import('../src/controllers/clothing.controller.js')).default;
const styles = await import('../src/modules/clothing/styles.js');
const { eanCheck, colourCode, sizeCode, inTx, clothingOnly } = await import('../src/modules/clothing/common.js');
const { findByCode } = await import('../src/modules/productIdentity.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const notes = await import('../src/controllers/creditNotes.controller.js');
const { ROLE_PERMISSIONS } = await import('../src/middleware/auth.js');
const { industryDefaults, effectiveFeatureFlags } = await import('../src/modules/planFeatures.js');
const router = (await import('../src/routes/clothing.routes.js')).default;

test.after(cleanup);

let S; let T; let tenant; let tee;
const call = (handler, extra, t = tenant) => S.call(handler, extra, t);
const okBody = (res, code = 200) => { assert.equal(res.code, code, JSON.stringify(res.body)); assert.equal(res.body.success, true); return res.body.data; };
const rejected = async (p) => { try { await p; } catch (error) { return error; } return null; };
const ctx = () => ({ tenant, userId: S.userId });
const make = (body) => inTx((c) => styles.createStyle(c, ctx(), body));
const onHand = async (id, branch = S.branchId) => Number((await pool.query(`SELECT quantity FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [branch, id])).rows[0]?.quantity ?? 0);
const TEE = {
  name: "Men's Cotton T-Shirt", gender: 'MEN', fabric: 'Cotton', fit: 'Regular', hsn_sac: '6109', tax_rate: 5, mrp: 799, selling_price: 599, purchase_price: 320, reorder_level: 3,
  colours: ['Black', 'White', { name: 'Blue' }], sizes: ['S', 'M', 'L', 'XL'],
  stock: [{ colour: 'Black', size: 'M', qty: 15 }, { colour: 'Black', size: 'L', qty: 20 }, { colour: 'White', size: 'M', qty: 12 }, { colour: 'Blue', size: 'S', qty: 6, selling_price: 549 }]
};

test('pure helpers: size and colour codes, EAN-13 check digit', { skip }, () => {
  assert.equal(sizeCode('Free Size'), 'FREESIZE');
  assert.equal(sizeCode('2-3Y'), '2-3Y');
  assert.equal(colourCode('Navy Blue'), 'NAV');
  assert.equal(colourCode('Navy', new Set(['NAV'])), 'NA2', 'a clash within one style gets a digit');
  assert.equal(eanCheck('400638133393'), 1, 'the published EAN-13 4006381333931');
});

test('setup', { skip }, async () => {
  await runMigrations(pool);
  S = await makeShop(pool, 'clo', { branches: 2, type: 'CLOTHING' });
  T = await makeShop(pool, 'clo2', { type: 'CLOTHING' });
  tenant = S.tenantFor();
});

test('plan gating: only a clothing shop has the catalogue switched on, and the router refuses other business types', { skip }, () => {
  assert.equal(industryDefaults('CLOTHING').cl_catalog, undefined);
  for (const type of ['RETAIL', 'SUPERMARKET', 'RESTAURANT', 'AUTO_PARTS', 'SALON', 'WHOLESALE']) assert.equal(industryDefaults(type).cl_catalog, false, type);
  assert.equal(effectiveFeatureFlags([{}, {}], {}, 'CLOTHING').cl_catalog, undefined);
  assert.equal(effectiveFeatureFlags([{}, {}], {}, 'RETAIL').cl_catalog, false);
  let status = 0; let nexted = false;
  clothingOnly({ tenant: { businessType: 'RETAIL' } }, { status(c) { status = c; return { json() {} }; } }, () => { nexted = true; });
  assert.deepEqual([status, nexted], [404, false]);
  clothingOnly({ tenant: { businessType: 'CLOTHING' } }, {}, () => { nexted = true; });
  assert.equal(nexted, true);
  assert.ok(router.stack.length > 5);
});

test('first run: the usual clothing categories are made once, with subcategories', { skip }, async () => {
  assert.equal(okBody(await call(ctl.meta)).needs_setup, true);
  const first = okBody(await call(ctl.setup)).categories_made;
  assert.ok(first >= 8);
  assert.equal(okBody(await call(ctl.setup)).categories_made, 0, 'running it again adds nothing');
  const top = (await pool.query(`SELECT name FROM categories WHERE business_id = $1 AND parent_id IS NULL ORDER BY name`, [S.businessId])).rows.map((r) => r.name);
  assert.deepEqual(top, ['Accessories', 'Ethnic Wear', 'Footwear', 'Innerwear', "Kids' Wear", "Men's Wear", 'Western Wear', "Women's Wear"]);
  const m = okBody(await call(ctl.meta));
  assert.equal(m.needs_setup, false);
  assert.deepEqual(m.size_sets.map((s) => s.name).slice(0, 5), ['Letter sizes', 'Waist (inches)', 'Kids (years)', 'Shoes (UK)', 'Free size']);
  assert.ok(m.colours.some((c) => c.name === 'Black'));
  assert.equal(m.categories.length, top.length + m.categories.filter((c) => c.parent_id).length, 'the category tree comes with the meta');
  assert.ok(m.categories.some((c) => c.name === 'T-Shirts' && c.parent_id));
});

test('a style with 3 colours and 4 sizes makes 12 variants, each its own product with a SKU, a valid barcode and the right stock', { skip }, async () => {
  const cat = (await pool.query(`SELECT category_id FROM categories WHERE business_id = $1 AND name = 'T-Shirts'`, [S.businessId])).rows[0].category_id;
  const out = okBody(await call(ctl.create, { body: { ...TEE, category_id: cat } }), 201);
  tee = out.style_id;
  assert.equal(out.variants.length, 12);
  assert.match(out.style_code, /^ST\d{5}$/);
  const v = (colour, size) => out.style.variants.find((x) => x.colour === colour && x.size === size);
  assert.equal(v('Black', 'M').sku, `${out.style_code}-BLA-M`);
  assert.equal(out.style.stock, 53);
  for (const x of out.variants) {
    assert.match(x.barcode, /^2\d{12}$/);
    assert.equal(Number(x.barcode[12]), eanCheck(x.barcode.slice(0, 12)), `check digit of ${x.barcode}`);
  }
  assert.equal(new Set(out.variants.map((x) => x.barcode)).size, 12);
  assert.equal(new Set(out.variants.map((x) => x.sku)).size, 12);

  const p = (await pool.query(`SELECT * FROM products WHERE product_id = $1`, [v('Black', 'M').product_id])).rows[0];
  assert.deepEqual([p.name, p.unit, p.kind, p.track_inventory, Number(p.tax_rate), p.hsn_sac, Number(p.selling_price_paise), Number(p.purchase_price_paise), Number(p.mrp_paise), Number(p.min_stock), p.category_id],
    ["Men's Cotton T-Shirt · Black · M", 'pc', 'DISH', true, 5, '6109', 59900, 32000, 79900, 3, cat]);
  assert.equal(Number(v('Blue', 'S').selling_price_paise), 54900, 'a cell can carry its own price');
  assert.equal(await onHand(v('Black', 'L').product_id), 20);
  assert.equal(await onHand(v('Black', 'XL').product_id), 0);
  assert.equal(Number((await pool.query(`SELECT current_stock FROM products WHERE product_id = $1`, [v('Black', 'L').product_id])).rows[0].current_stock), 20, 'the business total follows');
  const led = (await pool.query(`SELECT transaction_type, quantity, reference_type FROM inventory_transactions WHERE product_id = $1`, [v('White', 'M').product_id])).rows;
  assert.deepEqual(led.map((r) => [r.transaction_type, Number(r.quantity), r.reference_type]), [['OPENING', 12, 'clothing']]);
  assert.equal(Number((await pool.query(`SELECT count(*) FROM inventory_transactions WHERE product_id = $1`, [v('Black', 'XL').product_id])).rows[0].count), 0, 'no stock, no ledger row');
});

test('scanning a variant barcode or typing its SKU finds exactly that size and colour (the till uses the same lookup)', { skip }, async () => {
  const s = okBody(await call(ctl.get, { params: { id: String(tee) } }));
  const white = s.variants.find((x) => x.colour === 'White' && x.size === 'M');
  const byBarcode = await findByCode(pool, S.businessId, white.barcode);
  assert.deepEqual(byBarcode.map((r) => [r.product_id, r.matched_on]), [[white.product_id, 'barcode']]);
  assert.equal(byBarcode[0].name, "Men's Cotton T-Shirt · White · M");
  assert.equal((await findByCode(pool, S.businessId, white.sku.toLowerCase()))[0].product_id, white.product_id);
  assert.deepEqual(await findByCode(pool, T.businessId, white.barcode), [], 'another shop cannot find it');
  const rows = (await pool.query(`SELECT barcode FROM product_barcodes WHERE product_id = $1`, [white.product_id])).rows;
  assert.deepEqual(rows.map((r) => r.barcode), [white.barcode]);
});

test('the size x colour grid shows stock and price per cell, for the outlet being viewed', { skip }, async () => {
  const s = okBody(await call(ctl.get, { params: { id: String(tee) } }));
  assert.deepEqual(s.matrix.colours.map((c) => c.name), ['Black', 'White', 'Blue']);
  assert.deepEqual(s.matrix.sizes, ['S', 'M', 'L', 'XL']);
  assert.equal(s.matrix.grid.Black.L.stock, 20);
  assert.equal(s.matrix.grid.Blue.S.selling_price, 549);
  assert.equal(s.matrix.grid.Black.XL.low, true, 'zero stock is at or below the reorder level');
  assert.equal(s.matrix.grid.Black.L.low, false);
  const other = S.tenantFor('OWNER', { branchId: S.branchIds[1] });
  assert.equal(okBody(await call(ctl.get, { params: { id: String(tee) } }, other)).stock, 0, 'the second outlet has none of it');
  assert.equal(okBody(await call(ctl.get, { params: { id: String(tee) } }, S.allOutlets())).stock, 53, 'all outlets add up');
});

test('what a person can get wrong is refused before anything is saved', { skip }, async () => {
  const before = Number((await pool.query(`SELECT count(*) FROM products WHERE business_id = $1`, [S.businessId])).rows[0].count);
  const bad = async (patch, text) => { const e = await rejected(make({ ...TEE, name: 'Bad', ...patch })); assert.ok(e, text); assert.equal(e.status, text === 'dup' ? 409 : 400, `${text}: ${e.message}`); return e; };
  await bad({ selling_price: 900 }, 'selling above MRP');
  await bad({ colours: [] }, 'no colours');
  await bad({ sizes: [] }, 'no sizes');
  await bad({ name: '' }, 'no name');
  await bad({ gender: 'ALIEN' }, 'bad gender');
  await bad({ style_code: 'a b' }, 'bad code');
  await bad({ stock: [{ colour: 'Pink', size: 'M', qty: 2 }] }, 'stock for a colour not picked');
  await bad({ stock: [{ colour: 'Black', size: 'M', qty: -1 }] }, 'negative');
  await bad({ category_id: 999999 }, 'foreign category');
  await bad({ sizes: Array.from({ length: 21 }, (_, i) => `S${i}`) }, 'too many sizes');
  await bad({ colours: Array.from({ length: 30 }, (_, i) => `C${i}`), sizes: Array.from({ length: 11 }, (_, i) => `Z${i}`) }, 'over the variant limit');
  await make({ ...TEE, name: 'Coded', style_code: 'tee-1', stock: [] });
  await bad({ style_code: 'TEE-1' }, 'dup');
  assert.equal(Number((await pool.query(`SELECT count(*) FROM clothing_styles WHERE business_id = $1`, [S.businessId])).rows[0].count), 2, 'a refused style leaves nothing behind');
  assert.equal(Number((await pool.query(`SELECT count(*) FROM products WHERE business_id = $1`, [S.businessId])).rows[0].count), before + 12);
  const noOutlet = await rejected(inTx((c) => styles.createStyle(c, { tenant: { ...tenant, branchId: null }, userId: S.userId }, { ...TEE, name: 'No outlet', style_code: 'NOOUT' })));
  assert.equal(noOutlet.status, 400);
  assert.match(noOutlet.message, /outlet/);
});

test('adding a colour and a size later makes only the missing variants and leaves existing SKUs and stock alone', { skip }, async () => {
  const before = okBody(await call(ctl.get, { params: { id: String(tee) } }));
  const out = okBody(await call(ctl.addVariants, { params: { id: String(tee) }, body: { colours: ['Black', 'Navy'], sizes: ['S', 'M', 'L', 'XL', 'XXL'], stock: [{ colour: 'Navy', size: 'XXL', qty: 4 }] } }), 201);
  assert.equal(out.variants.length, 5 + 1, 'Navy x 5 sizes, plus Black XXL');
  const after = out.style;
  assert.equal(after.variants.length, 18);
  assert.equal(after.variants.find((v) => v.colour === 'Black' && v.size === 'M').sku, before.variants.find((v) => v.colour === 'Black' && v.size === 'M').sku);
  assert.equal(after.matrix.grid.Black.L.stock, 20);
  assert.equal(after.matrix.grid.Navy.XXL.stock, 4);
  assert.deepEqual(after.matrix.sizes, ['S', 'M', 'L', 'XL', 'XXL']);
  const again = okBody(await call(ctl.addVariants, { params: { id: String(tee) }, body: { colours: ['Black'], sizes: ['M'] } }), 201);
  assert.equal(again.variants.length, 0, 'nothing new to make');
});

test('editing a style: identity follows to every variant, prices only when asked; one variant can have its own price', { skip }, async () => {
  const renamed = okBody(await call(ctl.update, { params: { id: String(tee) }, body: { name: 'Classic Cotton Tee', tax_rate: 12, hsn_sac: '610910', fabric: 'Combed cotton', selling_price: 649 } }));
  assert.equal(renamed.fabric, 'Combed cotton');
  assert.ok(renamed.variants.every((v) => v.sku));
  const prods = (await pool.query(`SELECT p.name, p.tax_rate, p.hsn_sac, p.selling_price_paise, v.colour, v.size FROM clothing_variants v JOIN products p ON p.product_id = v.product_id WHERE v.style_id = $1`, [tee])).rows;
  assert.ok(prods.every((p) => p.name === `Classic Cotton Tee · ${p.colour} · ${p.size}` && Number(p.tax_rate) === 12 && p.hsn_sac === '610910'));
  assert.ok(prods.every((p) => [59900, 54900].includes(Number(p.selling_price_paise))), 'prices untouched without apply_prices');
  okBody(await call(ctl.update, { params: { id: String(tee) }, body: { selling_price: 649, apply_prices: true } }));
  assert.equal((await pool.query(`SELECT count(*) FROM clothing_variants v JOIN products p ON p.product_id = v.product_id WHERE v.style_id = $1 AND p.selling_price_paise = 64900`, [tee])).rows[0].count, '18');
  const e = await rejected(inTx((c) => styles.updateStyle(c, ctx(), tee, { mrp: 500 })));
  assert.match(e.message, /MRP/, 'a style MRP below its selling price is refused');

  const white = renamed.variants.find((v) => v.colour === 'White' && v.size === 'L');
  const one = okBody(await call(ctl.updateVariant, { params: { id: String(white.product_id) }, body: { selling_price: 599, reorder_level: 8, mrp: 799 } }));
  assert.deepEqual([one.selling_price, one.min_stock], [599, 8]);
  assert.equal((await rejected(inTx((c) => styles.updateVariant(c, ctx(), white.product_id, { selling_price: 900 })))).status, 400, 'selling above MRP');

  /* the shop's own barcode: kept as typed, found by the till's barcode table, and never shared with another item */
  const mine = okBody(await call(ctl.updateVariant, { params: { id: String(white.product_id) }, body: { barcode: 'MYTAG-0001' } }));
  assert.equal(mine.barcode, 'MYTAG-0001');
  assert.equal((await pool.query(`SELECT product_id FROM product_barcodes WHERE barcode = 'MYTAG-0001'`)).rows[0].product_id, white.product_id);
  assert.equal((await pool.query(`SELECT count(*) FROM product_barcodes WHERE product_id = $1`, [white.product_id])).rows[0].count, '1', 'the old in-store code is replaced');
  const other = renamed.variants.find((v) => v.product_id !== white.product_id);
  assert.equal((await rejected(inTx((c) => styles.updateVariant(c, ctx(), other.product_id, { barcode: 'MYTAG-0001' })))).code, '23505', 'a barcode is never on two items');
  assert.equal((await rejected(inTx((c) => styles.updateVariant(c, ctx(), other.product_id, { barcode: 'a b' })))).status, 400, 'no spaces');
});

test('supplier ledger by style: received pieces, spend and sizes per style; open orders and other shops do not count', { skip }, async () => {
  const sup = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1, 'Surat Textiles') RETURNING supplier_id`, [S.businessId])).rows[0].supplier_id;
  const sizes = await pool.query(`SELECT v.product_id, v.size FROM clothing_variants v WHERE v.style_id = $1 AND v.colour = 'Black' AND v.size IN ('M','L') ORDER BY v.sort_order`, [tee]);
  const po = async (status, date, lines) => {
    const id = (await pool.query(`INSERT INTO purchase_orders (business_id, branch_id, supplier_id, po_number, po_date, status, total_paise) VALUES ($1, $2, $3, $4, $5, $6, 0) RETURNING po_id`,
      [S.businessId, S.branchId, sup, `LED-${status}-${date}`, date, status])).rows[0].po_id;
    for (const [pid, q, cost] of lines) await pool.query(`INSERT INTO purchase_order_items (po_id, product_id, description, quantity, received_quantity, unit_cost_paise, line_total_paise) VALUES ($1, $2, 'x', $3, $3, $4, $5)`, [id, pid, q, cost, q * cost]);
  };
  const [m, l] = sizes.rows.map((r) => r.product_id);
  await po('RECEIVED', '2026-10-01', [[m, 10, 30000], [l, 5, 30000]]);
  await po('RECEIVED', '2026-10-20', [[m, 10, 33000]]);
  await po('ORDERED', '2026-10-25', [[l, 50, 30000]]);
  const out = okBody(await call(ctl.supplierStyles, { params: { id: String(sup) } }));
  assert.equal(out.length, 1);
  assert.deepEqual([out[0].pieces, out[0].orders, out[0].spent_paise, out[0].avg_cost_paise], [25, 2, 780000, 31200]);
  assert.deepEqual(out[0].sizes, [{ size: 'M', pieces: 20 }, { size: 'L', pieces: 5 }]);
  assert.equal(out[0].last_date.toISOString?.().slice(0, 10) ?? String(out[0].last_date).slice(0, 10), '2026-10-20');
  assert.equal((await call(ctl.supplierStyles, { params: { id: String(sup) } }, T.tenantFor())).code, 404, 'another shop cannot read it');
});

test('listing and searching styles: by name, code, SKU and barcode; stock and sold-out count; filters', { skip }, async () => {
  const list = async (q, t = tenant) => okBody(await call(ctl.list, { query: q }, t));
  const all = await list({});
  assert.equal(all.length, 2);
  const tee1 = all.find((s) => s.style_id === tee);
  assert.deepEqual([tee1.variants, tee1.stock, tee1.colours.sort()], [18, 57, ['Black', 'Blue', 'Navy', 'White']]);
  assert.equal(tee1.price_from, 599, 'the lowest variant price');
  assert.equal(tee1.sold_out, 18 - 5, 'variants with no stock');
  assert.equal(tee1.product_ids.length, 18, 'the till needs the variant ids to show how many of a style are on the bill');
  assert.equal((await list({ search: 'classic' })).length, 1);
  assert.equal((await list({ search: 'tee-1' })).length, 1, 'by style code, any case');
  const v = okBody(await call(ctl.get, { params: { id: String(tee) } })).variants[0];
  assert.equal((await list({ search: v.barcode }))[0].style_id, tee, 'by a variant barcode');
  assert.equal((await list({ search: v.sku }))[0].style_id, tee, 'by a variant SKU');
  assert.equal((await list({ search: '50%' })).length, 0, 'wildcards are not wildcards');
  assert.equal((await list({ gender: 'women' })).length, 0);
  assert.equal((await list({ status: 'archived' })).length, 0);
  assert.equal((await list({}, T.tenantFor())).length, 0, 'another shop sees none of it');
});

test('archiving a style archives its variants, and bringing it back restores them', { skip }, async () => {
  const coded = (await pool.query(`SELECT style_id FROM clothing_styles WHERE business_id = $1 AND style_code = 'TEE-1'`, [S.businessId])).rows[0].style_id;
  okBody(await call(ctl.update, { params: { id: String(coded) }, body: { status: 'ARCHIVED' } }));
  assert.equal((await pool.query(`SELECT count(*) FROM clothing_variants v JOIN products p ON p.product_id = v.product_id WHERE v.style_id = $1 AND p.status = 'ARCHIVED'`, [coded])).rows[0].count, '12');
  assert.equal(okBody(await call(ctl.list, { query: {} })).length, 1);
  assert.equal(okBody(await call(ctl.list, { query: { status: 'archived' } })).length, 1);
  assert.equal((await rejected(inTx((c) => styles.addVariants(c, ctx(), coded, { colours: ['Red'], sizes: ['S'] })))).status, 409, 'cannot add to an archived style');
  okBody(await call(ctl.update, { params: { id: String(coded) }, body: { status: 'ACTIVE' } }));
  assert.equal(okBody(await call(ctl.list, { query: {} })).length, 2);
});

test('a variant sells and comes back through the ordinary till: only that size and colour moves, GST is on the variant', { skip }, async () => {
  const s = okBody(await call(ctl.get, { params: { id: String(tee) } }));
  const black = s.variants.find((v) => v.colour === 'Black' && v.size === 'M');
  const blackL = s.variants.find((v) => v.colour === 'Black' && v.size === 'L');
  const inv = await inTx((db) => createInvoiceInTransaction(db, { businessId: S.businessId, branchId: S.branchId, businessType: 'CLOTHING' }, S.userId,
    { items: [{ product_id: black.product_id, quantity: 2 }], payment: { amount: 'FULL', method: 'CASH' } }));
  assert.equal(await onHand(black.product_id), 13);
  assert.equal(await onHand(blackL.product_id), 20, 'the other size is untouched');
  const line = (await pool.query(`SELECT * FROM invoice_items WHERE invoice_id = $1`, [inv.invoice_id])).rows[0];
  assert.equal(Number(line.tax_rate), 12);
  assert.equal(line.product_id, black.product_id);
  assert.match((await pool.query(`SELECT name FROM products WHERE product_id = $1`, [line.product_id])).rows[0].name, /Classic Cotton Tee · Black · M/);
  const giveBack = async (body) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await notes.create({ tenant, auth: { userId: S.userId }, params: { id: String(inv.invoice_id) }, body: { items: [{ item_id: line.item_id, quantity: 1 }], ...body }, query: {}, headers: {}, ip: '127.0.0.1', get: () => undefined }, res);
    assert.equal(res.code, 201, JSON.stringify(res.body));
  };
  await giveBack({ reason: 'Wrong size', restock: true });
  assert.equal(await onHand(black.product_id), 14, 'a returned item in good condition is back on the shelf');
  await giveBack({ reason: 'Torn at the seam' });
  assert.equal(await onHand(black.product_id), 14, 'a damaged return does not add sellable stock');
  const total = Number((await pool.query(`SELECT current_stock FROM products WHERE product_id = $1`, [black.product_id])).rows[0].current_stock);
  assert.equal(total, 14, 'branch stock and the business total agree');
});

test('import: rows group into styles, a trial run saves nothing, and one bad row stops the whole import', { skip }, async () => {
  const rows = [
    { style: 'Slim Jeans', colour: 'Indigo', size: '30', qty: 5, selling_price: 1299, purchase_price: 700, mrp: 1799, gender: 'men', hsn: '6203', gst: 12, brand: 'Denimco' },
    { style: 'Slim Jeans', colour: 'Indigo', size: '32', qty: 8, selling_price: 1299, purchase_price: 700, mrp: 1799 },
    { style: 'Slim Jeans', colour: 'Black', size: '32', qty: 3, selling_price: 1299 },
    { style: 'Kurti', colour: 'Red', size: 'M', qty: 4, selling_price: 499, gst: 5 }
  ];
  const count = async () => Number((await pool.query(`SELECT count(*) FROM clothing_styles WHERE business_id = $1`, [S.businessId])).rows[0].count);
  const base = await count();
  const trial = okBody(await call(ctl.importRows, { body: { rows, check: true } }));
  assert.deepEqual([trial.ok, trial.saved, trial.styles, trial.variants], [true, false, 2, 4]);
  assert.equal(await count(), base, 'a trial run saves nothing');
  const bad = await call(ctl.importRows, { body: { rows: [...rows, { style: 'Kurti', colour: 'Red', size: 'M', qty: 1 }, { style: '', colour: 'Red', size: 'M' }, { style: 'Cheap', colour: 'Red', size: 'M', selling_price: 900, mrp: 500 }] } });
  assert.equal(bad.code, 400);
  assert.ok(bad.body.data.problems.length >= 2);
  assert.equal(await count(), base, 'one bad row stops everything');
  const done = okBody(await call(ctl.importRows, { body: { rows } }));
  assert.deepEqual([done.saved, done.styles, done.variants], [true, 2, 4]);
  assert.equal(await count(), base + 2);
  const jeans = okBody(await call(ctl.list, { query: { search: 'slim jeans' } }))[0];
  assert.deepEqual([jeans.variants, jeans.stock, jeans.gender, jeans.hsn_sac, Number(jeans.tax_rate)], [3, 16, 'MEN', '6203', 12]);
  assert.equal((await rejected(inTx((c) => styles.importRows(c, ctx(), [])))).status, 400);
  assert.equal(jeans.brand_name, 'Denimco', 'a brand typed by name is made, and found again next time');
  const again = okBody(await call(ctl.create, { body: { ...TEE, name: 'Another', style_code: 'ANO-1', brand: 'denimco', stock: [] } }), 201);
  assert.equal(again.style.brand_name, 'Denimco');
  assert.equal(Number((await pool.query(`SELECT count(*) FROM brands WHERE business_id = $1`, [S.businessId])).rows[0].count), 1);
});

test('custom size sets are saved per shop; the built-in names are protected', { skip }, async () => {
  const set = okBody(await call(ctl.saveSizeSet, { body: { name: 'Bra sizes', sizes: ['32B', '34B', '36B', '34B'] } }), 201);
  assert.deepEqual(set.sizes, ['32B', '34B', '36B'], 'duplicates dropped');
  assert.ok(okBody(await call(ctl.sizeSets)).some((s) => s.name === 'Bra sizes' && s.custom));
  assert.ok(!okBody(await call(ctl.sizeSets, {}, T.tenantFor())).some((s) => s.name === 'Bra sizes'), 'another shop does not see it');
  assert.equal((await rejected(styles.saveSizeSet(pool, S.businessId, { name: 'Free size', sizes: ['X'] }))).status, 409);
});

test('isolation and permissions: another shop gets 404, a cashier cannot change the catalogue', { skip }, async () => {
  const theirs = T.tenantFor();
  assert.equal((await call(ctl.get, { params: { id: String(tee) } }, theirs)).code, 404);
  assert.equal((await call(ctl.update, { params: { id: String(tee) }, body: { name: 'Hacked' } }, theirs)).code, 404);
  assert.equal((await call(ctl.addVariants, { params: { id: String(tee) }, body: { colours: ['Red'], sizes: ['S'] } }, theirs)).code, 404);
  const variant = (await pool.query(`SELECT product_id FROM clothing_variants WHERE style_id = $1 LIMIT 1`, [tee])).rows[0].product_id;
  assert.equal((await call(ctl.updateVariant, { params: { id: String(variant) }, body: { selling_price: 1 } }, theirs)).code, 404);
  assert.equal((await pool.query(`SELECT name FROM clothing_styles WHERE style_id = $1`, [tee])).rows[0].name, 'Classic Cotton Tee');
  assert.ok(!ROLE_PERMISSIONS.CASHIER.includes('products'), 'a cashier does not hold the products permission the routes need');
  assert.ok(ROLE_PERMISSIONS.CASHIER.includes('billing'), 'but can read the catalogue to sell');
  assert.ok(ROLE_PERMISSIONS.MANAGER.includes('products'));
  const wrote = router.stack.filter((l) => l.route && !l.route.methods.get).map((l) => l.route.path);
  assert.ok(wrote.includes('/styles') && wrote.includes('/styles/import') && wrote.includes('/variants/:id'));
});

test('customer preferences: sizes, colours and styles come from the customer\'s own bills', { skip }, async () => {
  const cust = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1, 'Ananya', '9880000001') RETURNING customer_id`, [S.businessId])).rows[0].customer_id;
  const none = okBody(await call(ctl.customerPreferences, { params: { id: String(cust) } }));
  assert.deepEqual([none.pieces, none.bills, none.sizes], [0, 0, []], 'a new customer has no preferences yet');
  const s = (await styles.getStyle(pool, tenant, tee));
  const pick = (colour, size) => s.variants.find((v) => v.colour === colour && v.size === size).product_id;
  const sell = (items) => inTx((db) => createInvoiceInTransaction(db, { businessId: S.businessId, branchId: S.branchId, businessType: 'CLOTHING' }, S.userId, { customerId: cust, items, payment: { amount: 'FULL', method: 'CASH' } }));
  await sell([{ product_id: pick('Black', 'M'), quantity: 2 }, { product_id: pick('Black', 'L'), quantity: 1 }]);
  await sell([{ product_id: pick('Black', 'M'), quantity: 1 }, { product_id: pick('White', 'M'), quantity: 1 }]);
  const p = okBody(await call(ctl.customerPreferences, { params: { id: String(cust) } }));
  assert.deepEqual([p.pieces, p.bills], [5, 2]);
  assert.deepEqual(p.sizes.map((x) => [x.size, x.pieces]), [['M', 4], ['L', 1]]);
  assert.deepEqual(p.colours.map((x) => [x.colour, x.pieces]), [['Black', 4], ['White', 1]]);
  assert.equal(p.styles[0].pieces, 5);
  assert.equal((await call(ctl.customerPreferences, { params: { id: String(cust) } }, T.tenantFor())).code, 404, 'another shop cannot read it');
});
