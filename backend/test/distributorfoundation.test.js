/*
 * Distributor foundation: the Wholesale + Distributor switch, principals (and the supplier behind each), brands,
 * territories (Region → Territory → Area), beats, bulk assignment, and tenant isolation of all of it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addCustomer, addProduct, makeWholesaler } from './helpers/wholesale.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const principals = (await import('../src/controllers/distributorPrincipals.controller.js')).default;
const territories = (await import('../src/controllers/distributorTerritories.controller.js')).default;
const parties = (await import('../src/controllers/wholesaleParties.controller.js')).default;
const catalog = (await import('../src/controllers/wholesaleCatalog.controller.js')).default;
const { distributorOn } = await import('../src/modules/distributor/common.js');
const { hasPermission } = await import('../src/middleware/auth.js');

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);

const gate = async (tenant) => { let out = 'blocked'; await distributorOn({ tenant }, { status: () => ({ json: () => {} }) }, () => { out = 'open'; }); return out; };
const mk = async (w, kind, body) => (await w.call(territories.create, { body: { level: kind, ...body } })).body.data;

t('distributor features are on for a DISTRIBUTOR, and off for a WHOLESALE business until switched on', async () => {
  const d = await makeWholesaler(pool, 'd1', { type: 'DISTRIBUTOR' });
  const wh = await makeWholesaler(pool, 'd2', { type: 'WHOLESALE' });
  assert.equal(await gate(d.tenantFor()), 'open');
  assert.equal(await gate(wh.tenantFor()), 'blocked');
  const on = await wh.call(parties.updateSettings, { body: { distributor_enabled: true, scheme_stacking: 'ALL' } });
  assert.equal(on.code, 200, JSON.stringify(on.body));
  assert.equal(on.body.data.distributor_enabled, true);
  assert.equal(await gate(wh.tenantFor()), 'open');
  // a distributor cannot switch itself off
  const off = await d.call(parties.updateSettings, { body: { distributor_enabled: false } });
  assert.equal(off.body.data.distributor_enabled, true);
  assert.equal(off.body.data.distributor_locked, true);
  const other = await makeWholesaler(pool, 'd3', { type: 'RETAIL' }).catch(() => null);
  if (other) assert.equal(await gate(other.tenantFor()), 'blocked');
});

t('a principal brings its own supplier, so purchasing and payables work unchanged', async () => {
  const w = await makeWholesaler(pool, 'p1', { type: 'DISTRIBUTOR' });
  const res = await w.call(principals.create, { body: { name: 'Brand A', company_name: 'Brand A Foods Pvt Ltd', gstin: '36AAACB1001F1Z2', margin_pct: 6.5, payment_terms_days: 21, credit_limit: 500000, agreement_start: '2026-01-01', agreement_end: '2027-12-31', contact_person: 'Anil' } });
  assert.equal(res.code, 201, JSON.stringify(res.body));
  const p = res.body.data;
  assert.ok(p.supplier_id, 'a supplier row is created');
  assert.equal(p.margin_pct, 6.5);
  assert.equal(p.credit_limit, 500000);
  const sup = (await pool.query(`SELECT s.name, s.gstin, sp.payment_terms_days, sp.contact_person FROM suppliers s JOIN wholesale_supplier_profiles sp ON sp.supplier_id = s.supplier_id WHERE s.supplier_id = $1`, [p.supplier_id])).rows[0];
  assert.deepEqual({ ...sup }, { name: 'Brand A Foods Pvt Ltd', gstin: '36AAACB1001F1Z2', payment_terms_days: 21, contact_person: 'Anil' });
  // editing the principal keeps the supplier's contact details in step
  await w.call(principals.update, { params: { id: p.principal_id }, body: { phone: '9876543210', payment_terms_days: 30 } });
  const sup2 = (await pool.query(`SELECT s.phone, sp.payment_terms_days FROM suppliers s JOIN wholesale_supplier_profiles sp ON sp.supplier_id = s.supplier_id WHERE s.supplier_id = $1`, [p.supplier_id])).rows[0];
  assert.equal(sup2.phone, '9876543210'); assert.equal(sup2.payment_terms_days, 30);
  // a principal can also wrap a supplier you already buy from, once
  const existing = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1, 'Old Supplier') RETURNING supplier_id`, [w.businessId])).rows[0].supplier_id;
  const wrap = await w.call(principals.create, { body: { name: 'Brand B', supplier_id: existing } });
  assert.equal(wrap.code, 201); assert.equal(wrap.body.data.supplier_id, existing);
  assert.equal((await w.call(principals.create, { body: { name: 'Brand C', supplier_id: existing } })).code, 409);
  assert.equal((await w.call(principals.create, { body: { name: 'brand a' } })).code, 409, 'names are unique ignoring case');
  assert.equal((await w.call(principals.create, { body: { name: 'Bad', agreement_start: '2027-01-01', agreement_end: '2026-01-01' } })).code, 400);
});

t('products and brands attach to a principal; the product list can be filtered by it', async () => {
  const w = await makeWholesaler(pool, 'p2', { type: 'DISTRIBUTOR' });
  const a = (await w.call(principals.create, { body: { name: 'Brand A' } })).body.data;
  const b = (await w.call(principals.create, { body: { name: 'Brand B' } })).body.data;
  const brand = (await w.call(principals.createBrand, { body: { name: 'Crunchy', principal_id: a.principal_id } })).body.data;
  const p1 = await addProduct(pool, w, { name: 'Crunchy Chips', price: 20 });
  const p2 = await addProduct(pool, w, { name: 'Other Biscuit', price: 10 });
  const assign = await w.call(principals.assignProducts, { params: { id: a.principal_id }, body: { product_ids: [p1], brand_id: brand.brand_id } });
  assert.equal(assign.body.data.assigned, 1);
  await w.call(principals.assignProducts, { params: { id: b.principal_id }, body: { product_ids: [p2] } });
  const listed = await w.call(catalog.list, { query: { principal_id: String(a.principal_id) } });
  assert.deepEqual(listed.body.data.map((x) => x.name), ['Crunchy Chips']);
  assert.equal(listed.body.data[0].principal, 'Brand A');
  assert.equal(listed.body.data[0].brand, 'Crunchy');
  const detail = await w.call(principals.get, { params: { id: a.principal_id } });
  assert.equal(detail.body.data.products, 1);
  assert.equal(detail.body.data.brands[0].name, 'Crunchy');
  // the pack price and principal price live on the product
  const upd = await w.call(catalog.update, { params: { id: p1 }, body: { principal_id: b.principal_id, principal_price: 55.5, pack_size: '12 x 20g' } });
  assert.equal(upd.code, 200, JSON.stringify(upd.body));
  assert.equal(upd.body.data.principal_price, 55.5); assert.equal(upd.body.data.pack_size, '12 x 20g'); assert.equal(upd.body.data.principal, 'Brand B');
});

t('territories form Region → Territory → Area, only in that order, and roll retailers up', async () => {
  const w = await makeWholesaler(pool, 't1', { type: 'DISTRIBUTOR' });
  const region = await mk(w, 'REGION', { name: 'Hyderabad Region' });
  const bad = await w.call(territories.create, { body: { level: 'AREA', name: 'Ameerpet', parent_id: region.territory_id } });
  assert.equal(bad.code, 400, 'an area goes under a territory, not a region');
  const terr = await mk(w, 'TERRITORY', { name: 'Secunderabad', parent_id: region.territory_id });
  const area = await mk(w, 'AREA', { name: 'Ameerpet', parent_id: terr.territory_id });
  assert.equal((await w.call(territories.create, { body: { level: 'AREA', name: 'ameerpet', parent_id: terr.territory_id } })).code, 409);
  const c1 = await addCustomer(pool, w, { name: 'R1' }); const c2 = await addCustomer(pool, w, { name: 'R2' });
  const assigned = await w.call(territories.assignCustomers, { body: { customer_ids: [c1, c2], territory_id: area.territory_id } });
  assert.equal(assigned.body.data.assigned, 2);
  const tree = (await w.call(territories.list, {})).body.data;
  const by = Object.fromEntries(tree.map((n) => [n.name, n]));
  assert.equal(by.Ameerpet.customers, 2); assert.equal(by.Secunderabad.customers, 2); assert.equal(by['Hyderabad Region'].customers, 2);
  // the customer record shows where the retailer sits
  const cust = (await w.call(parties.getCustomer, { params: { id: c1 } })).body.data;
  assert.equal(cust.territory_id, area.territory_id); assert.equal(cust.territory, 'Ameerpet');
  // a populated node cannot be deleted
  assert.equal((await w.call(territories.remove, { params: { id: String(terr.territory_id) } })).code, 409);
  assert.equal((await w.call(territories.remove, { params: { id: String(region.territory_id) } })).code, 409);
});

t('bulk assignment sets a salesperson and a territory on many retailers at once, and clears with null', async () => {
  const w = await makeWholesaler(pool, 't2', { type: 'DISTRIBUTOR' });
  const region = await mk(w, 'REGION', { name: 'North' });
  const sp = (await w.call(parties.createSalesperson, { body: { name: 'Ravi', sales_role: 'FIELD_SALES', employee_id: 'E-17', territory_id: region.territory_id } })).body.data;
  assert.equal(sp.sales_role, 'FIELD_SALES'); assert.equal(sp.employee_id, 'E-17');
  const ids = []; for (let i = 0; i < 5; i++) ids.push(await addCustomer(pool, w, { name: `Retailer ${i}` }));
  const r = await w.call(territories.assignCustomers, { body: { customer_ids: ids, territory_id: region.territory_id, salesperson_id: sp.salesperson_id } });
  assert.equal(r.body.data.assigned, 5);
  const n = (await pool.query(`SELECT COUNT(*) AS n FROM wholesale_customer_profiles WHERE business_id = $1 AND salesperson_id = $2 AND territory_id = $3`, [w.businessId, sp.salesperson_id, region.territory_id])).rows[0].n;
  assert.equal(Number(n), 5);
  await w.call(territories.assignCustomers, { body: { customer_ids: ids, salesperson_id: null } });
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM wholesale_customer_profiles WHERE business_id = $1 AND salesperson_id IS NOT NULL`, [w.businessId])).rows[0].n), 0);
  assert.equal((await w.call(territories.assignCustomers, { body: { customer_ids: ids } })).code, 400);
});

t('a beat is an ordered day route; reordering works; a retailer is on one beat per weekday', async () => {
  const w = await makeWholesaler(pool, 'b1', { type: 'DISTRIBUTOR' });
  const sp = (await w.call(parties.createSalesperson, { body: { name: 'Ravi' } })).body.data;
  const [a, b, c] = [await addCustomer(pool, w, { name: 'A' }), await addCustomer(pool, w, { name: 'B' }), await addCustomer(pool, w, { name: 'C' })];
  const mon = await w.call(territories.createBeat, { body: { name: 'Monday - Ameerpet', weekday: 1, salesperson_id: sp.salesperson_id, customer_ids: [a, b, c] } });
  assert.equal(mon.code, 201, JSON.stringify(mon.body));
  assert.equal(mon.body.data.customers, 3); assert.equal(mon.body.data.weekday_name, 'Monday');
  let beat = (await w.call(territories.getBeat, { params: { id: mon.body.data.beat_id } })).body.data;
  assert.deepEqual(beat.customers.map((x) => x.name), ['A', 'B', 'C']);
  await w.call(territories.updateBeat, { params: { id: beat.beat_id }, body: { customer_ids: [c, a, b] } });
  beat = (await w.call(territories.getBeat, { params: { id: beat.beat_id } })).body.data;
  assert.deepEqual(beat.customers.map((x) => x.name), ['C', 'A', 'B']);
  // the same retailer on another beat the same day is refused; a different day is fine
  const clash = await w.call(territories.createBeat, { body: { name: 'Monday - Extra', weekday: 1, customer_ids: [a] } });
  assert.equal(clash.code, 409); assert.match(clash.body.message, /already on Monday - Ameerpet/);
  const tue = await w.call(territories.createBeat, { body: { name: 'Tuesday - Ameerpet', weekday: 2, customer_ids: [a] } });
  assert.equal(tue.code, 201);
  // moving a beat to a day where a retailer is already booked is refused too
  assert.equal((await w.call(territories.updateBeat, { params: { id: tue.body.data.beat_id }, body: { weekday: 1 } })).code, 409);
  // listing filters by weekday
  const monday = (await w.call(territories.listBeats, { query: { weekday: '1' } })).body.data;
  assert.deepEqual(monday.map((x) => x.name), ['Monday - Ameerpet']);
});

t('tenant isolation: another business cannot see, touch or assign into your principals, territories and beats', async () => {
  const a = await makeWholesaler(pool, 'i1', { type: 'DISTRIBUTOR' });
  const b = await makeWholesaler(pool, 'i2', { type: 'DISTRIBUTOR' });
  const pr = (await a.call(principals.create, { body: { name: 'Secret Brand' } })).body.data;
  const region = await mk(a, 'REGION', { name: 'Secret Region' });
  const beat = (await a.call(territories.createBeat, { body: { name: 'Secret Beat' } })).body.data;
  const cust = await addCustomer(pool, b, { name: 'B customer' });
  assert.equal((await b.call(principals.get, { params: { id: pr.principal_id } })).code, 404);
  assert.equal((await b.call(principals.update, { params: { id: pr.principal_id }, body: { name: 'x' } })).code, 404);
  assert.equal((await b.call(principals.list, {})).body.data.length, 0);
  assert.equal((await b.call(territories.list, {})).body.data.length, 0);
  assert.equal((await b.call(territories.getBeat, { params: { id: beat.beat_id } })).code, 404);
  assert.equal((await b.call(territories.updateBeat, { params: { id: beat.beat_id }, body: { name: 'hacked' } })).code, 404);
  assert.equal((await b.call(territories.assignCustomers, { body: { customer_ids: [cust], territory_id: region.territory_id } })).code, 400, 'cannot assign into another tenant’s territory');
  assert.equal((await b.call(territories.createBeat, { body: { name: 'B beat', territory_id: region.territory_id } })).code, 400);
  const pb = await addProduct(pool, b, { name: 'B product' });
  assert.equal((await b.call(catalog.update, { params: { id: pb }, body: { principal_id: pr.principal_id } })).code, 400, 'cannot tag a product to another tenant’s principal');
});

t('the new roles carry the right permissions', async () => {
  const T = (role, permissions = {}) => ({ role, permissions });
  assert.ok(hasPermission(T('FIELD_SALES'), 'field_sales'));
  assert.ok(hasPermission(T('FIELD_SALES'), 'collections'));
  assert.ok(!hasPermission(T('FIELD_SALES'), 'pricing'));
  assert.ok(!hasPermission(T('FIELD_SALES'), 'reports'));
  assert.ok(hasPermission(T('COLLECTION_EXECUTIVE'), 'collections'));
  assert.ok(!hasPermission(T('COLLECTION_EXECUTIVE'), 'sales_orders'));
  assert.ok(hasPermission(T('DELIVERY_MANAGER'), 'vehicles'));
  assert.ok(hasPermission(T('SALES_MANAGER'), 'targets') && hasPermission(T('SALES_MANAGER'), 'schemes'));
  assert.ok(!hasPermission(T('SALES_MANAGER'), 'principals'));
  assert.ok(hasPermission(T('PURCHASE_MANAGER'), 'principals'));
  assert.ok(hasPermission(T('DISTRIBUTOR_ADMIN'), 'settings') && hasPermission(T('DISTRIBUTOR_ADMIN'), 'territories'));
  assert.ok(hasPermission(T('FIELD_SALES', { pricing: true }), 'pricing'), 'an owner can grant one more thing');
  assert.ok(!hasPermission(T('SALES_MANAGER', { targets: false }), 'targets'), 'and take one away');
});
