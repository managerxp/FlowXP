/*
 * Distributor bulk operations: product / retailer imports with principal, brand, territory and beat; price-list import;
 * stock import (add and stock-take); bulk target upload and bulk assignment live with their own tests.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addProduct, dayFromNow, makeWholesaler, stockOf } from './helpers/wholesale.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const wsImport = (await import('../src/controllers/wholesaleImport.controller.js')).default;
const dImport = (await import('../src/controllers/distributorImport.controller.js')).default;
const principals = (await import('../src/controllers/distributorPrincipals.controller.js')).default;
const territories = (await import('../src/controllers/distributorTerritories.controller.js')).default;
const catalog = (await import('../src/controllers/wholesaleCatalog.controller.js')).default;
const { priceOne } = await import('../src/modules/wholesale/pricing.js');

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);
const dist = (tag) => makeWholesaler(pool, tag, { type: 'DISTRIBUTOR' });

t('products import with principal, brand, pack size and principal price; an unknown principal is an error row', async () => {
  const w = await dist('i1');
  const pr = (await w.call(principals.create, { body: { name: 'Brand A Foods' } })).body.data;
  const rows = [
    { name: 'Crunchy Chips 50g', sku: 'CH50', unit: 'pcs', brand: 'Crunchy', principal: 'Brand A Foods', pack_size: '12 x 50g', principal_price: '55', mrp: '100', wholesale_price: '78', unit_1_name: 'carton', unit_1_factor: '24', tax_rate: '12' },
    { name: 'Crunchy Chips 100g', sku: 'CH100', unit: 'pcs', brand: 'Crunchy', principal: 'Brand A Foods', wholesale_price: '140' }
  ];
  const bad = await w.call(wsImport.importProducts, { body: { rows: [...rows, { name: 'Orphan', sku: 'OR1', principal: 'Nobody' }], apply: true } });
  assert.equal(bad.code, 422); assert.equal(bad.body.data.errors[0].row, 4); assert.match(bad.body.data.errors[0].message, /Principal "Nobody" was not found/);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM products WHERE business_id = $1`, [w.businessId])).rows[0].n), 0, 'nothing imported');
  const good = await w.call(wsImport.importProducts, { body: { rows, apply: true } });
  assert.equal(good.code, 200, JSON.stringify(good.body)); assert.equal(good.body.data.created, 2);
  const list = (await w.call(catalog.list, { query: { principal_id: String(pr.principal_id) } })).body.data;
  assert.equal(list.length, 2); assert.equal(list[0].brand, 'Crunchy'); assert.equal(list[0].principal, 'Brand A Foods');
  const chips = list.find((x) => x.sku === 'CH50'); assert.equal(chips.principal_price, 55); assert.equal(chips.pack_size, '12 x 50g'); assert.equal(chips.mrp, 100);
  const brand = (await pool.query(`SELECT principal_id FROM brands WHERE business_id = $1 AND name = 'Crunchy'`, [w.businessId])).rows;
  assert.equal(brand.length, 1, 'one brand, however many products'); assert.equal(brand[0].principal_id, pr.principal_id);
});

t('retailer import places retailers in a territory and on a beat; ambiguous or unknown places are errors', async () => {
  const w = await dist('i2');
  const mk = async (level, name, parent) => (await w.call(territories.create, { body: { level, name, parent_id: parent } })).body.data;
  const south = await mk('REGION', 'South'); const sec = await mk('TERRITORY', 'Secunderabad', south.territory_id); const area = await mk('AREA', 'Ameerpet', sec.territory_id);
  const north = await mk('REGION', 'North'); const sec2 = await mk('TERRITORY', 'Hitech', north.territory_id); await mk('AREA', 'Ameerpet', sec2.territory_id);   // a second Ameerpet
  const beat = (await w.call(territories.createBeat, { body: { name: 'Monday A', weekday: 1 } })).body.data;
  const rows = [{ name: 'Balaji Kirana', phone: '9876500001', territory: 'South > Secunderabad', beat: 'Monday A' }, { name: 'Lakshmi Stores', phone: '9876500002', territory: 'Secunderabad' }];
  assert.equal((await w.call(wsImport.importCustomers, { body: { rows: [{ name: 'X', phone: '9876500003', territory: 'Ameerpet' }], apply: true } })).code, 422, 'two areas called Ameerpet: ambiguous');
  assert.equal((await w.call(wsImport.importCustomers, { body: { rows: [{ name: 'X', phone: '9876500003', territory: 'Nowhere' }], apply: true } })).code, 422);
  assert.equal((await w.call(wsImport.importCustomers, { body: { rows: [{ name: 'X', phone: '9876500003', beat: 'Missing beat' }], apply: true } })).code, 422);
  const r = await w.call(wsImport.importCustomers, { body: { rows, apply: true } });
  assert.equal(r.code, 200, JSON.stringify(r.body)); assert.equal(r.body.data.created, 2);
  const placed = (await pool.query(`SELECT c.name, w.territory_id FROM customers c JOIN wholesale_customer_profiles w ON w.customer_id = c.customer_id WHERE c.business_id = $1 ORDER BY c.name`, [w.businessId])).rows;
  assert.deepEqual(placed.map((x) => x.territory_id), [sec.territory_id, sec.territory_id]);
  const onBeat = (await w.call(territories.getBeat, { params: { id: beat.beat_id } })).body.data;
  assert.deepEqual(onBeat.customers.map((c) => c.name), ['Balaji Kirana']);
  void area;
  // the same retailer on a second beat the same day is refused
  const beat2 = (await w.call(territories.createBeat, { body: { name: 'Monday B', weekday: 1 } })).body.data;
  void beat2;
  const clash = await w.call(wsImport.importCustomers, { body: { rows: [{ name: 'Balaji Kirana', phone: '9876500001', beat: 'Monday B' }], apply: true } });
  assert.equal(clash.code, 409, JSON.stringify(clash.body));
});

t('price-list import creates the list, upserts rules by product / unit / break, and a dry run writes nothing', async () => {
  const w = await dist('i3');
  const p = await addProduct(pool, w, { name: 'Detergent', price: 78, cost: 60, tax: 0, stock: 100, units: [{ name: 'carton', factor: 24 }] });
  await pool.query(`UPDATE products SET sku = 'DET1' WHERE product_id = $1`, [p]);
  const body = { list_name: 'Dealer prices', customer_type: 'DEALER', rows: [{ sku: 'DET1', price: '74' }, { sku: 'DET1', unit: 'carton', min_qty: '5', price: '1700' }, { sku: 'DET1', min_qty: '500', discount_pct: '10' }] };
  const dry = await w.call(dImport.importPriceList, { body });
  assert.equal(dry.code, 200); assert.equal(dry.body.data.applied, false); assert.equal(dry.body.data.creates_list, true); assert.equal(dry.body.data.rules, 3);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM wholesale_price_lists WHERE business_id = $1`, [w.businessId])).rows[0].n), 0);
  const bad = await w.call(dImport.importPriceList, { body: { ...body, rows: [...body.rows, { sku: 'NOPE', price: '1' }, { sku: 'DET1', unit: 'pallet', price: '1' }, { sku: 'DET1', price: '1', discount_pct: '5' }], apply: true } });
  assert.equal(bad.code, 422); assert.equal(bad.body.data.errors.length, 3);
  const made = await w.call(dImport.importPriceList, { body: { ...body, apply: true } });
  assert.equal(made.code, 200, JSON.stringify(made.body)); assert.equal(made.body.data.created, 3);
  const dealer = (await pool.query(`INSERT INTO customers (business_id, name) VALUES ($1,'Dealer') RETURNING customer_id`, [w.businessId])).rows[0].customer_id;
  await pool.query(`INSERT INTO wholesale_customer_profiles (customer_id, business_id, customer_type) VALUES ($1,$2,'DEALER')`, [dealer, w.businessId]);
  const price = async (qty, unit) => (await priceOne(pool, { businessId: w.businessId, customerId: dealer, line: { product_id: p, quantity: qty, unit_name: unit } })).price_paise / 100;
  assert.equal(await price(1), 74); assert.equal(await price(5, 'carton'), 1700);
  // importing again changes the rule, it does not duplicate it
  const again = await w.call(dImport.importPriceList, { body: { list_name: 'dealer PRICES', rows: [{ sku: 'DET1', price: '72' }], apply: true } });
  assert.deepEqual([again.body.data.created, again.body.data.changed], [0, 1]);
  assert.equal(await price(1), 72);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM wholesale_price_list_items`)).rows[0].n) >= 3, true);
});

t('stock import: add puts stock on the shelf (with batches); set is a stock take that books the difference', async () => {
  const w = await dist('i4');
  const plain = await addProduct(pool, w, { name: 'Soap', price: 10, cost: 5, tax: 0, stock: 40, units: [{ name: 'carton', factor: 12 }] });
  const milk = await addProduct(pool, w, { name: 'Milk', price: 10, cost: 5, tax: 0, expiry: true });
  await pool.query(`UPDATE products SET sku = 'SOAP' WHERE product_id = $1`, [plain]); await pool.query(`UPDATE products SET sku = 'MILK' WHERE product_id = $1`, [milk]);
  const bad = await w.call(dImport.importStock, { body: { rows: [{ sku: 'MILK', quantity: '10' }, { sku: 'SOAP', quantity: '5', unit: 'pallet' }], apply: true } });
  assert.equal(bad.code, 422); assert.match(bad.body.data.errors[0].message, /batch-tracked/); assert.match(bad.body.data.errors[1].message, /not counted in pallet/);
  const add = await w.call(dImport.importStock, { body: { rows: [{ sku: 'SOAP', quantity: '2', unit: 'carton' }, { sku: 'MILK', quantity: '30', batch_no: 'M1', expiry_date: dayFromNow(20), cost: '5' }], apply: true } });
  assert.equal(add.code, 200, JSON.stringify(add.body));
  assert.equal((await stockOf(pool, w.branchId, plain)).on_hand, 64); assert.equal((await stockOf(pool, w.branchId, milk)).on_hand, 30);
  assert.equal(Number((await pool.query(`SELECT qty_on_hand FROM wholesale_batches WHERE business_id = $1 AND batch_no = 'M1'`, [w.businessId])).rows[0].qty_on_hand), 30);
  // a stock take: the shelf counted 60 soaps, not 64
  const take = await w.call(dImport.importStock, { body: { mode: 'set', rows: [{ sku: 'SOAP', quantity: '60' }], apply: true } });
  assert.equal(take.code, 200); assert.equal((await stockOf(pool, w.branchId, plain)).on_hand, 60);
  const adj = (await pool.query(`SELECT transaction_type, quantity FROM inventory_transactions WHERE product_id = $1 ORDER BY txn_id DESC LIMIT 1`, [plain])).rows[0];
  assert.deepEqual({ ...adj, quantity: Number(adj.quantity) }, { transaction_type: 'ADJUSTMENT', quantity: -4 });
  assert.equal((await w.call(dImport.importStock, { body: { rows: [{ sku: 'SOAP', quantity: '1' }, { sku: 'SOAP', quantity: '2' }], apply: true } })).code, 422, 'the same line twice');
  // another tenant’s products are not visible to the import
  const other = await dist('i5');
  assert.equal((await other.call(dImport.importStock, { body: { rows: [{ sku: 'SOAP', quantity: '5' }], apply: true } })).code, 422);
});
