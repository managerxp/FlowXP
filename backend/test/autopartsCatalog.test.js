/*
 * Auto parts catalogue: a part with its SKU and OEM number, many vehicles, fitment that is never assumed, search by barcode / SKU / any part number / words, alternates only
 * from verified fitment, duplicates, vehicle import, permissions and isolation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { fakeRes, makeShop, rs } from './helpers/autoparts.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const catalog = (await import('../src/controllers/autopartsCatalog.controller.js')).default;
const partsMod = await import('../src/modules/autoparts/parts.js');
const vehicles = await import('../src/modules/autoparts/vehicles.js');
const { inTx, partKey } = await import('../src/modules/autoparts/common.js');
const router = (await import('../src/routes/autoparts.routes.js')).default;
const { ROLE_PERMISSIONS } = await import('../src/middleware/auth.js');
const { industryDefaults } = await import('../src/modules/planFeatures.js');
const products = await import('../src/controllers/products.controller.js');

test.after(cleanup);

let S; let T; let tenant; let userId;
let swift; let swiftVxi; let alto; let honda;
const call = (handler, extra, t = tenant) => S.call(handler, extra, t);
const okBody = (res, code = 200) => { assert.equal(res.code, code, JSON.stringify(res.body)); assert.equal(res.body.success, true); return res.body.data; };
const tx = (fn) => inTx(fn);
const newPart = (body) => call(catalog.create, { body: { name: 'Front brake pad', selling_price: 800, purchase_price: 500, tax_rate: 18, hsn_sac: '87083000', ...body } });

test('setup', { skip }, async () => {
  await runMigrations(pool);
  S = await makeShop(pool, 'cat');
  T = await makeShop(pool, 'cat2');
  tenant = S.tenantFor();
  userId = S.userId;
  const mk = await tx((db) => vehicles.createMake(db, S.businessId, { name: 'Maruti Suzuki', vehicle_type: 'CAR' }));
  const hk = await tx((db) => vehicles.createMake(db, S.businessId, { name: 'Honda', vehicle_type: 'BIKE' }));
  swift = await tx((db) => vehicles.createModel(db, S.businessId, { make_id: mk.make_id, name: 'Swift' }));
  alto = await tx((db) => vehicles.createModel(db, S.businessId, { make_id: mk.make_id, name: 'Alto' }));
  honda = await tx((db) => vehicles.createModel(db, S.businessId, { make_id: hk.make_id, name: 'Activa' }));
  swiftVxi = await tx((db) => vehicles.createVariant(db, S.businessId, { model_id: swift.model_id, generation: '3rd gen', variant: 'VXi', engine_type: 'K12', engine_cc: 1197, fuel: 'PETROL', transmission: 'MANUAL', year_from: 2018, year_to: 2023 }));
});

test('a part is a product with a profile: SKU, OEM number, classification, specifications', { skip }, async () => {
  const made = okBody(await newPart({ sku: 'BP-SW-F', barcode: '8901234000011', oem_part_no: '55810-M68K00', mfr_part_no: 'GDB1234', classification: 'AFTERMARKET', vehicle_type: 'CAR', pack_qty: 1, reorder_level: 4, max_stock: 40, specs: { 'Pad material': 'Ceramic', Thickness: '15 mm' }, weight_g: 620, handling: 'Keep dry' }), 201);
  assert.equal(made.sku, 'BP-SW-F');
  assert.equal(made.oem_part_no, '55810-M68K00');
  assert.equal(made.classification, 'AFTERMARKET');
  assert.equal(made.specs.Thickness, '15 mm');
  assert.equal(made.has_profile, true);
  assert.deepEqual(made.numbers.map((n) => n.kind).sort(), ['MFR', 'OEM'], 'both numbers are searchable numbers');
  const product = (await pool.query(`SELECT kind, selling_price_paise, tax_rate FROM products WHERE product_id = $1`, [made.product_id])).rows[0];
  assert.equal(product.kind, 'DISH');
  assert.equal(Number(product.selling_price_paise), rs(800));
  // the ordinary product rules still apply: a SKU is unique, a price may not pass the MRP
  const dup = await newPart({ name: 'Another', sku: 'BP-SW-F' });
  assert.equal(dup.code, 409);
  const mrp = await newPart({ name: 'Over MRP', selling_price: 900, mrp: 800, sku: 'X-1' });
  assert.equal(mrp.code, 400);
  const bad = await newPart({ name: 'Bad class', classification: 'FAKE', sku: 'X-2' });
  assert.equal(bad.code, 400);
  // a profile can be changed later; the wholesale price may not pass the MRP
  const edited = okBody(await call(catalog.saveProfile, { params: { id: made.product_id }, body: { reorder_level: 6, wholesale_price: 700, handling: 'Keep dry. Fragile edge' } }));
  assert.equal(edited.reorder_level, 6);
  assert.equal(edited.wholesale_price, 700);
  await pool.query(`UPDATE products SET mrp_paise = $2 WHERE product_id = $1`, [made.product_id, rs(900)]);
  assert.equal((await call(catalog.saveProfile, { params: { id: made.product_id }, body: { wholesale_price: 950 } })).code, 400);
});

test('part numbers: typed with or without dashes and spaces, they find the same part; alternates, supplier numbers and replaced numbers are kept', { skip }, async () => {
  assert.equal(partKey('04465-0K 280'), '044650K280');
  const part = okBody(await newPart({ name: 'Rear brake shoe', sku: 'BS-R1', oem_part_no: '04465-0K280' }), 201);
  okBody(await call(catalog.numberAdd, { params: { id: part.product_id }, body: { number: 'BS 7001', kind: 'ALTERNATE' } }), 201);
  okBody(await call(catalog.numberAdd, { params: { id: part.product_id }, body: { number: 'OLD-9911', kind: 'REPLACES', note: 'supersedes the 2012 number' } }), 201);
  const again = okBody(await call(catalog.numberAdd, { params: { id: part.product_id }, body: { number: 'bs7001', kind: 'ALTERNATE' } }), 201);
  assert.equal(again.key, 'BS7001');
  assert.equal((await partsMod.numbersOf(pool, S.businessId, part.product_id)).length, 3, 'the same number is not stored twice');
  for (const q of ['04465-0K280', '044650k280', '04465 0K 280', 'bs-7001', 'OLD9911']) {
    const found = okBody(await call(catalog.lookup, { query: { q } }));
    assert.equal(found[0]?.product_id, part.product_id, q);
  }
  assert.equal(okBody(await call(catalog.lookup, { query: { q: '04465-0K280' } }))[0].matched_on, 'oem');
  assert.equal(okBody(await call(catalog.lookup, { query: { q: 'BS-R1' } }))[0].matched_on, 'sku');
  assert.equal(okBody(await call(catalog.lookup, { query: { q: 'rear brake' } }))[0].product_id, part.product_id, 'words');
  assert.deepEqual(okBody(await call(catalog.lookup, { query: { q: 'NOSUCH123' } })), []);
  assert.equal((await call(catalog.numberAdd, { params: { id: part.product_id }, body: { number: '---', kind: 'OEM' } })).code, 400);
  assert.equal((await call(catalog.numberAdd, { params: { id: part.product_id }, body: { number: 'X1', kind: 'GUESS' } })).code, 400);
  // the same number on another part is allowed (an alternate is often shared) and is said out loud
  const other = okBody(await newPart({ name: 'Rear brake shoe (other brand)', sku: 'BS-R2' }), 201);
  const shared = okBody(await call(catalog.numberAdd, { params: { id: other.product_id }, body: { number: 'BS-7001', kind: 'ALTERNATE' } }), 201);
  assert.equal(shared.also_on[0].product_id, part.product_id);
  // and the ordinary product search and scan lookup find a part by its numbers too
  const viaProducts = await call(products.lookup, { params: { code: '04465 0K280' } });
  assert.equal(viaProducts.code, 200, JSON.stringify(viaProducts.body));
  assert.equal(viaProducts.body.data[0].product_id, part.product_id);
  assert.equal(viaProducts.body.data[0].matched_on, 'part_number');
  const viaList = await call(products.list, { query: { search: 'OLD-9911' } });
  assert.equal(viaList.body.data[0].product_id, part.product_id);
});

test('barcode and the exact catalogue list: filters, stock, paging', { skip }, async () => {
  const byBarcode = okBody(await call(catalog.lookup, { query: { q: '8901234000011' } }));
  assert.equal(byBarcode[0].sku, 'BP-SW-F');
  assert.equal(byBarcode[0].matched_on, 'barcode');
  const res = await call(catalog.list, { query: { classification: 'AFTERMARKET', limit: '1' } });
  assert.equal(res.code, 200);
  assert.equal(res.body.data.length, 1);
  assert.ok(res.body.meta.total >= 2);
  const noProfile = await pool.query(`INSERT INTO products (business_id, name, sku, kind) VALUES ($1,'Loose item','LOOSE-1','DISH') RETURNING product_id`, [S.businessId]);
  const np = await call(catalog.list, { query: { no_profile: 'true' } });
  assert.deepEqual(np.body.data.map((r) => r.product_id), [noProfile.rows[0].product_id], 'a product without a part profile is easy to find');
  assert.equal((await call(catalog.list, { query: { vehicle_type: 'TRUCK' } })).body.data.length, 0);
  assert.equal((await call(catalog.list, { query: { vehicle_type: 'SPACESHIP' } })).code, 400);
});

test('fitment: a part fits many vehicles, nothing is assumed, unverified is flagged, NOT_FIT wins', { skip }, async () => {
  const pad = okBody(await call(catalog.lookup, { query: { q: 'BP-SW-F' } }))[0].product_id;
  const fit1 = okBody(await call(catalog.fitAdd, { params: { id: pad }, body: { model_id: swift.model_id, variant_id: swiftVxi.variant_id, year_from: 2018, year_to: 2023, source: 'supplier list' } }), 201);
  assert.equal(fit1.status, 'UNVERIFIED', 'new fitment is unverified until a person checks it');
  const fit2 = okBody(await call(catalog.fitAdd, { params: { id: pad }, body: { model_id: alto.model_id, year_from: 2015, status: 'VERIFIED', source: 'OEM catalogue 2024' } }), 201);
  assert.equal(fit2.status, 'VERIFIED');
  assert.ok(fit2.verified_at && fit2.verified_by, 'who verified it, and when, is kept');
  assert.equal((await call(catalog.fitAdd, { params: { id: pad }, body: { model_id: swift.model_id, variant_id: swiftVxi.variant_id, year_from: 2018, year_to: 2023 } })).code, 409);
  assert.equal((await call(catalog.fitAdd, { params: { id: pad }, body: { model_id: alto.model_id, variant_id: swiftVxi.variant_id } })).code, 400, 'a variant of another model');
  assert.equal((await call(catalog.fitAdd, { params: { id: pad }, body: { model_id: swift.model_id, year_from: 2020, year_to: 2019 } })).code, 400);

  const check = async (q) => okBody(await call(catalog.fitCheck, { params: { id: pad }, query: q }));
  assert.equal((await check({ model_id: swift.model_id, variant_id: swiftVxi.variant_id, year: 2020 })).status, 'UNVERIFIED');
  assert.match((await check({ model_id: swift.model_id, year: 2020 })).warning, /not been verified/);
  assert.equal((await check({ model_id: swift.model_id, year: 2010 })).status, 'UNKNOWN', 'outside the years: no fitment on record');
  assert.equal((await check({ model_id: alto.model_id, year: 2022 })).status, 'VERIFIED');
  assert.equal((await check({ model_id: honda.model_id })).status, 'UNKNOWN');
  assert.match((await check({ model_id: honda.model_id })).warning, /Do not assume/);

  okBody(await call(catalog.fitSet, { params: { id: fit1.fit_id }, body: { status: 'VERIFIED' } }));
  assert.equal((await check({ model_id: swift.model_id, variant_id: swiftVxi.variant_id, year: 2020 })).status, 'VERIFIED');
  const bad = okBody(await call(catalog.fitAdd, { params: { id: pad }, body: { model_id: swift.model_id, variant_id: swiftVxi.variant_id, year_from: 2019, year_to: 2019, status: 'NOT_FIT', note: 'different caliper this year' } }), 201);
  assert.equal((await check({ model_id: swift.model_id, variant_id: swiftVxi.variant_id, year: 2019 })).status, 'NOT_FIT', 'NOT_FIT beats VERIFIED for the same vehicle');
  assert.match((await check({ model_id: swift.model_id, variant_id: swiftVxi.variant_id, year: 2019 })).warning, /NOT fitting/);
  okBody(await call(catalog.fitRemove, { params: { id: bad.fit_id } }));
  assert.equal((await call(catalog.fitRemove, { params: { id: bad.fit_id } })).code, 404);
  assert.equal(okBody(await call(catalog.get, { params: { id: pad } })).fitment.length, 2);
});

test('finding parts by vehicle: only parts that fit, each labelled; NOT_FIT parts are left out and counted', { skip }, async () => {
  const pad = okBody(await call(catalog.lookup, { query: { q: 'BP-SW-F' } }))[0].product_id;
  const shoe = okBody(await call(catalog.lookup, { query: { q: 'BS-R1' } }))[0].product_id;
  const filter = okBody(await newPart({ name: 'Oil filter', sku: 'OF-1' }), 201).product_id;
  okBody(await call(catalog.fitAdd, { params: { id: shoe }, body: { model_id: swift.model_id, year_from: 2018, year_to: 2023 } }), 201);          // unverified
  okBody(await call(catalog.fitAdd, { params: { id: filter }, body: { model_id: swift.model_id, status: 'NOT_FIT', note: 'diesel only' } }), 201);
  const res = await call(catalog.byVehicle, { query: { model_id: String(swift.model_id), year: '2020' } });
  assert.equal(res.code, 200);
  const byId = new Map(res.body.data.map((r) => [r.product_id, r]));
  assert.equal(byId.get(pad).fitment, 'VERIFIED');
  assert.equal(byId.get(pad).warning, null);
  assert.equal(byId.get(shoe).fitment, 'UNVERIFIED');
  assert.match(byId.get(shoe).warning, /Check before selling/);
  assert.ok(!byId.has(filter), 'a part recorded as not fitting is not offered');
  assert.equal(res.body.meta.excluded_not_fit, 1);
  assert.equal((await call(catalog.byVehicle, { query: {} })).code, 400);
  // narrowing by year drops what is outside it
  const old = await call(catalog.byVehicle, { query: { model_id: String(swift.model_id), year: '2005' } });
  assert.equal(old.body.data.length, 0);
  // the part list can filter by vehicle too
  const list = await call(catalog.list, { query: { model_id: String(swift.model_id), year: '2020' } });
  assert.deepEqual(list.body.data.map((r) => r.product_id).sort(), [pad, shoe].sort());
});

test('alternates come only from verified fitment, and never past a NOT_FIT', { skip }, async () => {
  const pad = okBody(await call(catalog.lookup, { query: { q: 'BP-SW-F' } }))[0].product_id;
  const rival = okBody(await newPart({ name: 'Front brake pad (rival brand)', sku: 'BP-RIV', selling_price: 650 }), 201).product_id;
  const catId = (await pool.query(`INSERT INTO categories (business_id, name) VALUES ($1,'Brakes') RETURNING category_id`, [S.businessId])).rows[0].category_id;
  await pool.query(`UPDATE products SET category_id = $2 WHERE product_id = ANY($1::int[])`, [[pad, rival], catId]);
  okBody(await call(catalog.fitAdd, { params: { id: rival }, body: { model_id: alto.model_id, year_from: 2015, status: 'VERIFIED', source: 'OEM catalogue 2024' } }), 201);
  let alts = okBody(await call(catalog.alternates, { params: { id: pad }, query: { model_id: String(alto.model_id), year: '2021' } }));
  assert.deepEqual(alts.map((a) => a.product_id), [rival]);
  // an unverified rival is not offered
  const shaky = okBody(await newPart({ name: 'Front brake pad (unchecked)', sku: 'BP-UNC' }), 201).product_id;
  await pool.query(`UPDATE products SET category_id = $2 WHERE product_id = $1`, [shaky, catId]);
  okBody(await call(catalog.fitAdd, { params: { id: shaky }, body: { model_id: alto.model_id } }), 201);
  alts = okBody(await call(catalog.alternates, { params: { id: pad }, query: { model_id: String(alto.model_id) } }));
  assert.ok(!alts.some((a) => a.product_id === shaky));
  // a NOT_FIT on the rival for that model removes it
  okBody(await call(catalog.fitAdd, { params: { id: rival }, body: { model_id: alto.model_id, year_from: 1990, year_to: 2000, status: 'NOT_FIT' } }), 201);
  alts = okBody(await call(catalog.alternates, { params: { id: pad }, query: { model_id: String(alto.model_id) } }));
  assert.ok(!alts.some((a) => a.product_id === rival), 'recorded as not fitting this model');
});

test('copying fitment to a sister part makes unverified copies', { skip }, async () => {
  const pad = okBody(await call(catalog.lookup, { query: { q: 'BP-SW-F' } }))[0].product_id;
  const twin = okBody(await newPart({ name: 'Front brake pad (twin)', sku: 'BP-TWIN' }), 201).product_id;
  const out = okBody(await call(catalog.fitCopy, { params: { id: pad }, body: { to: [twin, twin, pad] } }));
  assert.equal(out.parts, 1);
  assert.ok(out.added >= 2);
  const fit = okBody(await call(catalog.get, { params: { id: twin } })).fitment;
  assert.ok(fit.every((f) => f.status === 'UNVERIFIED' && /copied from part/.test(f.source)), 'someone has to check each part');
  assert.equal((await call(catalog.fitCopy, { params: { id: pad }, body: { to: [] } })).code, 400);
  assert.equal((await call(catalog.fitCopy, { params: { id: pad }, body: { to: [99999999] } })).code, 404);
});

test('duplicate parts are found, not merged', { skip }, async () => {
  const a = okBody(await newPart({ name: 'Spark plug', sku: 'SP-A', oem_part_no: '90919-01253' }), 201).product_id;
  const b = okBody(await newPart({ name: 'Spark plug NGK', sku: 'SP-B', oem_part_no: '90919 01253' }), 201).product_id;
  const c = okBody(await newPart({ name: 'Air filter', sku: 'AF-A' }), 201).product_id;
  const d = okBody(await newPart({ name: 'air filter', sku: 'AF-B' }), 201).product_id;
  const dups = okBody(await call(catalog.duplicates, {}));
  const num = dups.find((x) => x.reason === 'SAME_NUMBER' && x.detail === '9091901253');
  assert.deepEqual(num.product_ids, [a, b]);
  const name = dups.find((x) => x.reason === 'SAME_NAME' && x.detail === 'air filter');
  assert.deepEqual(name.product_ids, [c, d]);
});

test('vehicles: import is all or nothing, repeats are skipped, nothing is made up', { skip }, async () => {
  const rows = [
    { vehicle_type: 'CAR', make: 'Hyundai', model: 'i20', generation: '2nd', variant: 'Sportz', engine_type: 'Kappa', engine_cc: '1197', fuel: 'PETROL', transmission: 'MANUAL', year_from: '2020', year_to: '2024' },
    { vehicle_type: 'CAR', make: 'Hyundai', model: 'i20', generation: '2nd', variant: 'Asta', fuel: 'DIESEL', year_from: '2020' },
    { vehicle_type: 'BIKE', make: 'Bajaj', model: 'Pulsar 150' }
  ];
  const check = okBody(await call(catalog.vehiclesImport, { body: { rows } }));
  assert.equal(check.ok, true);
  assert.equal(check.committed, false);
  assert.equal((await vehicles.tree(pool, S.businessId)).some((m) => m.name === 'Hyundai'), false, 'a check saves nothing');
  const bad = okBody(await call(catalog.vehiclesImport, { body: { commit: true, rows: [...rows, { make: 'Tata', model: 'Nexon', fuel: 'STEAM' }] } }));
  assert.equal(bad.ok, false);
  assert.equal(bad.problems[0].row, 5);
  assert.equal((await vehicles.tree(pool, S.businessId)).some((m) => m.name === 'Hyundai'), false, 'one bad row and nothing is saved');
  const done = okBody(await call(catalog.vehiclesImport, { body: { commit: true, rows } }));
  assert.deepEqual([done.makes, done.models, done.variants, done.skipped], [2, 2, 2, 0]);
  const again = okBody(await call(catalog.vehiclesImport, { body: { commit: true, rows } }));
  assert.deepEqual([again.makes, again.models, again.variants, again.skipped], [0, 0, 0, 2], 'a repeat adds nothing');
  const tree = await vehicles.tree(pool, S.businessId);
  assert.equal(tree.find((m) => m.name === 'Hyundai').models[0].variants.length, 2);
  assert.equal(tree.find((m) => m.name === 'Bajaj').vehicle_type, 'BIKE');
  assert.equal((await call(catalog.makeCreate, { body: { name: 'hyundai', vehicle_type: 'CAR' } })).code, 409);
  assert.equal((await call(catalog.vehiclesImport, { body: { rows: [] } })).code, 400);
});

test('one business never sees or changes another business\'s parts, numbers, vehicles or fitment', { skip }, async () => {
  const mine = okBody(await call(catalog.lookup, { query: { q: 'BP-SW-F' } }))[0].product_id;
  const theirs = T.tenantFor();
  assert.deepEqual(okBody(await T.call(catalog.lookup, { query: { q: 'BP-SW-F' } }, theirs)), []);
  assert.deepEqual(okBody(await T.call(catalog.lookup, { query: { q: '55810-M68K00' } }, theirs)), []);
  assert.equal((await T.call(catalog.get, { params: { id: mine } }, theirs)).code, 404);
  assert.equal((await T.call(catalog.saveProfile, { params: { id: mine }, body: { handling: 'x' } }, theirs)).code, 404);
  assert.equal((await T.call(catalog.numberAdd, { params: { id: mine }, body: { number: 'ZZ1' } }, theirs)).code, 404);
  assert.equal((await T.call(catalog.fitAdd, { params: { id: mine }, body: { model_id: swift.model_id } }, theirs)).code, 404);
  const fit = (await pool.query(`SELECT fit_id FROM part_fitment WHERE product_id = $1 LIMIT 1`, [mine])).rows[0].fit_id;
  assert.equal((await T.call(catalog.fitSet, { params: { id: fit }, body: { status: 'NOT_FIT' } }, theirs)).code, 404);
  assert.equal((await T.call(catalog.fitRemove, { params: { id: fit } }, theirs)).code, 404);
  assert.deepEqual(okBody(await T.call(catalog.vehicles, {}, theirs)), []);
  assert.equal((await T.call(catalog.modelCreate, { body: { make_id: 1, name: 'X' } }, theirs)).code, 404);
  assert.equal((await T.call(catalog.byVehicle, { query: { model_id: String(swift.model_id) } }, theirs)).body.data.length, 0);
  assert.equal(okBody(await T.call(catalog.list, { query: {} }, theirs)).length ?? 0, 0);
});

test('catalogue routes: permissions, plan switch, parts shops only', { skip }, async () => {
  const routes = router.stack.filter((l) => l.route).map((l) => ({ method: Object.keys(l.route.methods)[0].toUpperCase(), path: l.route.path, stack: l.route.stack.map((s) => s.handle) }));
  const gate = async (method, path, t) => {
    const route = routes.find((r) => r.method === method && r.path === path);
    assert.ok(route, `${method} ${path}`);
    for (const mw of route.stack.slice(2, -1)) {
      const res = fakeRes(); let passed = false;
      await mw({ tenant: t, method, headers: {}, body: {}, get: () => undefined, originalUrl: path }, res, () => { passed = true; });
      if (!passed) return res.code;
    }
    return 200;
  };
  for (const [method, path, want] of [
    ['GET', '/parts', { OWNER: 200, MANAGER: 200, PARTS_COUNTER: 200, STOREKEEPER: 200, CASHIER: 200, WAITER: 200, KITCHEN: 403 }],
    ['POST', '/parts', { OWNER: 200, MANAGER: 200, ADMIN: 200, PARTS_COUNTER: 403, STOREKEEPER: 403, CASHIER: 403 }],
    ['PUT', '/fitment/:id', { OWNER: 200, PARTS_COUNTER: 403, STOREKEEPER: 403 }],
    ['POST', '/vehicles/import', { OWNER: 200, PARTS_COUNTER: 403 }]
  ]) for (const [role, code] of Object.entries(want)) assert.equal(await gate(method, path, S.tenantFor(role)), code, `${role} ${method} ${path}`);
  assert.equal(await gate('POST', '/parts', S.tenantFor('CASHIER', { permissions: { parts_catalog: true } })), 200, 'a per-person grant');
  assert.equal(await gate('POST', '/parts', S.tenantFor('MANAGER', { permissions: { parts_catalog: false } })), 403, 'and a per-person refusal');
  assert.equal(await gate('GET', '/parts', S.tenantFor('OWNER', { planFeatures: { ap_catalog: false } })), 402);
  for (const type of ['RETAIL', 'SUPERMARKET', 'WHOLESALE', 'GYM', 'PHARMACY']) {
    const res = fakeRes(); let passed = false;
    routes[0].stack[2]({ tenant: { businessType: type } }, res, () => { passed = true; });
    assert.equal(passed, false, type);
    assert.equal(res.code, 404, type);
  }
  assert.ok(ROLE_PERMISSIONS.STOREKEEPER.includes('grn') && !ROLE_PERMISSIONS.STOREKEEPER.includes('price_change'));
  assert.equal(industryDefaults('AUTO_PARTS').ap_catalog, undefined, 'on for a parts shop');
  for (const type of ['RETAIL', 'SUPERMARKET', 'WHOLESALE', 'GYM', 'PHARMACY', 'RESTAURANT', 'SALON', 'GAMING_CAFE']) assert.equal(industryDefaults(type).ap_catalog, false, type);
});
