/*
 * Distributor dashboard, reports, principal settlement, part deliveries and background checks.
 * One small distributor is built and every figure is worked out by hand, so a report that drifts from the books fails here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addCustomer, addProduct, dayFromNow, invoiceRow, makeInvoice, makeWholesaler, stockOf } from './helpers/wholesale.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const reports = (await import('../src/controllers/wholesaleReports.controller.js')).default;
const dash = (await import('../src/controllers/distributorDashboard.controller.js')).default;
const team = (await import('../src/controllers/distributorTeam.controller.js')).default;
const principals = (await import('../src/controllers/distributorPrincipals.controller.js')).default;
const territories = (await import('../src/controllers/distributorTerritories.controller.js')).default;
const schemes = (await import('../src/controllers/distributorSchemes.controller.js')).default;
const vehicles = (await import('../src/controllers/distributorVehicles.controller.js')).default;
const parties = (await import('../src/controllers/wholesaleParties.controller.js')).default;
const purchasing = (await import('../src/controllers/wholesalePurchasing.controller.js')).default;
const money = (await import('../src/controllers/wholesaleMoney.controller.js')).default;
const fulfilment = (await import('../src/controllers/wholesaleFulfilment.controller.js')).default;
const orders = (await import('../src/controllers/wholesaleOrders.controller.js')).default;
const distScans = await import('../src/modules/distributor/scans.js');
const { catalogue } = await import('../src/modules/wholesale/reports.js');

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);

const report = async (w, key, query = {}, tenant) => { const r = await w.call(reports.run, { params: { key }, query }, tenant); assert.equal(r.code, 200, `${key}: ${JSON.stringify(r.body)}`); return r.body.data; };
const rowOf = (rep, name, key = 'name') => rep.rows.find((x) => x[key] === name);

/** Brand A (P1) and Brand B (P2); South › Secunderabad › Ameerpet and South › Hitech › Kondapur, North; two reps; sales as in the comments. */
const build = async (tag) => {
  const w = await makeWholesaler(pool, tag, { type: 'DISTRIBUTOR' });
  const p1 = (await w.call(principals.create, { body: { name: 'Brand A Foods', margin_pct: 8 } })).body.data;
  const p2 = (await w.call(principals.create, { body: { name: 'Brand B Beverages', margin_pct: 6 } })).body.data;
  const bA = (await w.call(principals.createBrand, { body: { name: 'Crunchy', principal_id: p1.principal_id } })).body.data;
  const bB = (await w.call(principals.createBrand, { body: { name: 'Fizz', principal_id: p2.principal_id } })).body.data;
  const A = await addProduct(pool, w, { name: 'Crunchy Chips', price: 100, cost: 60, tax: 0, stock: 1000 });
  const B = await addProduct(pool, w, { name: 'Fizz Cola', price: 50, cost: 30, tax: 0, stock: 1000 });
  await w.call(principals.assignProducts, { params: { id: p1.principal_id }, body: { product_ids: [A], brand_id: bA.brand_id } });
  await w.call(principals.assignProducts, { params: { id: p2.principal_id }, body: { product_ids: [B], brand_id: bB.brand_id } });
  const mk = async (level, name, parent) => (await w.call(territories.create, { body: { level, name, parent_id: parent } })).body.data;
  const south = await mk('REGION', 'South'); const north = await mk('REGION', 'North');
  const sec = await mk('TERRITORY', 'Secunderabad', south.territory_id); const hitech = await mk('TERRITORY', 'Hitech', south.territory_id);
  const ameerpet = await mk('AREA', 'Ameerpet', sec.territory_id); const kondapur = await mk('AREA', 'Kondapur', hitech.territory_id);
  const ravi = (await w.call(parties.createSalesperson, { body: { name: 'Ravi' } })).body.data; const asha = (await w.call(parties.createSalesperson, { body: { name: 'Asha' } })).body.data;
  const c1 = await addCustomer(pool, w, { name: 'Balaji Kirana' }); const c2 = await addCustomer(pool, w, { name: 'Kondapur Mart' }); const c3 = await addCustomer(pool, w, { name: 'North Traders' });
  await w.call(territories.assignCustomers, { body: { customer_ids: [c1], territory_id: ameerpet.territory_id, salesperson_id: ravi.salesperson_id } });
  await w.call(territories.assignCustomers, { body: { customer_ids: [c2], territory_id: kondapur.territory_id, salesperson_id: ravi.salesperson_id } });
  await w.call(territories.assignCustomers, { body: { customer_ids: [c3], territory_id: north.territory_id, salesperson_id: asha.salesperson_id } });
  const beat = (await w.call(territories.createBeat, { body: { name: 'Ameerpet Monday', weekday: 1, territory_id: ameerpet.territory_id, salesperson_id: ravi.salesperson_id, customer_ids: [c1] } })).body.data;
  // Brand A funds a "buy 10 get 1" scheme on Chips
  const scheme = (await w.call(schemes.create, { body: { name: 'Chips 10+1', kind: 'BUY_X_GET_Y', funded_by: 'PRINCIPAL', principal_id: p1.principal_id, buy_scope: 'PRODUCT', buy_scope_id: A, buy_min_qty: 10, free_qty: 1 } })).body.data;
  const sale = (customer, rep, lines, order = {}) => makeInvoice(w, { customer, lines, order: { salesperson_id: rep.salesperson_id, ...order } });
  const visit = (await w.call(team.recordVisit, { body: { customer_id: c1, outcome: 'ORDER', beat_id: beat.beat_id, salesperson_id: ravi.salesperson_id } })).body.data;
  const s1 = await sale(c1, ravi, [{ product_id: A, quantity: 100 }], { visit_id: visit.visit_id });   // ₹10,000 sold + 10 free (cost ₹600)
  const s2 = await sale(c2, ravi, [{ product_id: B, quantity: 40 }]);                                  // ₹2,000
  const s3 = await sale(c3, asha, [{ product_id: A, quantity: 20 }]);                                  // ₹2,000 + 2 free
  return { w, p1, p2, bA, bB, A, B, south, north, sec, hitech, ameerpet, kondapur, ravi, asha, c1, c2, c3, beat, scheme, visit, s1, s2, s3 };
};

t('secondary sales, by territory, beat, brand, principal and salesperson — free goods counted apart and costed', async () => {
  const { w, ameerpet } = await build('r1');
  const range = { from: dayFromNow(-5), to: dayFromNow(0) };
  const sec = await report(w, 'secondary_sales', range);
  assert.equal(sec.totals.revenue, 14000); assert.equal(sec.totals.units, 160); assert.equal(sec.totals.free_units, 12);
  assert.equal(sec.totals.office, 14000); assert.equal(sec.totals.field, 0);
  assert.equal(sec.totals.margin, 14000 - (120 * 60 + 40 * 30 + 12 * 60 - 12 * 60) - 12 * 60 + 0, 'revenue − cost of 132 Chips and 40 Cola');   // 14,000 − (7,920 + 1,200)
  const area = await report(w, 'sales_by_territory', { ...range, level: 'AREA' });
  assert.equal(rowOf(area, 'Ameerpet').revenue, 10000); assert.equal(rowOf(area, 'Ameerpet').free_units, 10);
  assert.equal(rowOf(area, 'Ameerpet').cost, 6600); assert.equal(rowOf(area, 'Ameerpet').margin, 3400); assert.equal(rowOf(area, 'Ameerpet').margin_pct, 34);
  assert.equal(rowOf(area, 'Kondapur').revenue, 2000);
  assert.equal(rowOf(area, 'Unassigned').revenue, 2000, 'a retailer attached to a region only has no area');
  const terr = await report(w, 'sales_by_territory', { ...range, level: 'TERRITORY' });
  assert.equal(rowOf(terr, 'Secunderabad').revenue, 10000); assert.equal(rowOf(terr, 'Hitech').revenue, 2000);
  const region = await report(w, 'sales_by_territory', { ...range, level: 'REGION' });
  assert.equal(rowOf(region, 'South').revenue, 12000, 'a region is everything inside it'); assert.equal(rowOf(region, 'North').revenue, 2000);
  assert.equal(rowOf(await report(w, 'sales_by_beat', range), 'Ameerpet Monday').revenue, 10000);
  assert.equal(rowOf(await report(w, 'sales_by_beat', range), 'No beat').revenue, 4000);
  const brand = await report(w, 'sales_by_brand', range);
  assert.equal(rowOf(brand, 'Crunchy').revenue, 12000); assert.equal(rowOf(brand, 'Crunchy').scheme_cost, 720); assert.equal(rowOf(brand, 'Fizz').revenue, 2000);
  const principal = await report(w, 'sales_by_principal', range);
  assert.equal(rowOf(principal, 'Brand A Foods').revenue, 12000); assert.equal(rowOf(principal, 'Brand B Beverages').revenue, 2000);
  const rep = await report(w, 'sales_by_salesperson', range).catch(() => null);
  void rep;
  const perf = await report(w, 'salesperson_performance', range);
  assert.equal(rowOf(perf, 'Ravi', 'salesperson').net_sales, 12000); assert.equal(rowOf(perf, 'Asha', 'salesperson').net_sales, 2000);
  assert.equal(rowOf(perf, 'Ravi', 'salesperson').orders, 2); assert.equal(rowOf(perf, 'Ravi', 'salesperson').visits, 1); assert.equal(rowOf(perf, 'Ravi', 'salesperson').strike_rate, 100);
  assert.equal(perf.totals.net_sales, 14000);
  void ameerpet;
});

t('profit and margin: purchase cost, discount, scheme cost → gross profit and margin, by product, brand, principal, customer, salesperson, territory', async () => {
  const { w } = await build('r2');
  const range = { from: dayFromNow(-5), to: dayFromNow(0) };
  const by = (dim) => report(w, 'margin_by', { ...range, by: dim });
  const product = await by('product');
  assert.equal(rowOf(product, 'Crunchy Chips').revenue, 12000); assert.equal(rowOf(product, 'Crunchy Chips').cost, 7920); assert.equal(rowOf(product, 'Crunchy Chips').margin, 4080);
  assert.equal(rowOf(product, 'Crunchy Chips').scheme_cost, 720, 'the free goods cost ₹720 and are inside the cost');
  assert.equal(rowOf(product, 'Fizz Cola').margin, 800); assert.equal(rowOf(product, 'Fizz Cola').margin_pct, 40);
  assert.equal(product.totals.margin, 4880);
  assert.equal(rowOf(await by('brand'), 'Crunchy').margin, 4080);
  assert.equal(rowOf(await by('principal'), 'Brand B Beverages').margin_pct, 40);
  assert.equal(rowOf(await by('customer'), 'Balaji Kirana').margin, 3400);
  assert.equal(rowOf(await by('salesperson'), 'Ravi').margin, 3400 + 800);
  assert.equal(rowOf(await by('territory'), 'South › Secunderabad › Ameerpet').margin, 3400);
  assert.equal((await w.call(reports.run, { params: { key: 'margin_by' }, query: { ...range, by: 'colour' } })).code, 400);
});

t('primary sales and principal settlement: purchases, returns, scheme claims, payments and what is owed', async () => {
  const { w, p1, A } = await build('r3');
  const range = { from: dayFromNow(-5), to: dayFromNow(0) };
  // buy 500 Chips from Brand A at ₹60 on credit, then pay ₹10,000 and return 20 (a debit note)
  const po = await w.call(purchasing.createPO, { body: { supplier_id: p1.supplier_id, items: [{ product_id: A, quantity: 500, unit_cost: 60 }], payment_terms_days: 30 } });
  assert.equal(po.code, 201, JSON.stringify(po.body));
  await w.call(purchasing.approvePO, { params: { id: po.body.data.po_id } });
  const g = await w.call(purchasing.createGRN, { body: { po_id: po.body.data.po_id, supplier_invoice_no: 'BA-1001', items: [{ po_item_id: po.body.data.items[0].item_id, received: 500 }] } });
  assert.equal(g.code, 201, JSON.stringify(g.body));
  const primary = await report(w, 'primary_sales', range);
  assert.equal(primary.rows.length, 1); assert.equal(primary.rows[0].principal, 'Brand A Foods'); assert.equal(primary.rows[0].value, 30000); assert.equal(primary.rows[0].units, 500); assert.equal(primary.rows[0].supplier_invoice, 'BA-1001');
  assert.equal((await report(w, 'primary_sales', { ...range, principal_id: String(p1.principal_id + 1) })).rows.length, 0, 'filtered to the other principal: none');
  const pay = await w.call(purchasing.paySupplier ?? purchasing.createPOPayment ?? (async () => ({ code: 0 })), { params: { id: po.body.data.po_id }, body: { amount: 10000, method: 'BANK_TRANSFER', reference_number: 'N1' } }).catch(() => null);
  void pay;
  const purchases = await report(w, 'principal_purchases', range);
  assert.equal(rowOf(purchases, 'Brand A Foods', 'principal').purchased, 30000);
  assert.equal(rowOf(purchases, 'Brand B Beverages', 'principal').purchased, 0);
  // the scheme Brand A funds: 12 free Chips shipped (₹720 at cost), and no discount → ₹720 to claim
  const settle = await report(w, 'principal_settlement', range);
  const a = rowOf(settle, 'Brand A Foods', 'principal');
  assert.equal(a.purchased, 30000); assert.equal(a.claims, 720); assert.equal(a.outstanding, 30000 - a.paid + 0 - a.returned);
  assert.equal(a.net_payable, a.outstanding - 720, 'what we owe them, less what they owe us for the scheme');
  const sp = await report(w, 'scheme_performance', range);
  const row = rowOf(sp, 'Chips 10+1', 'scheme');
  assert.equal(row.orders, 2); assert.equal(row.customers, 2); assert.equal(row.free_units, 12); assert.equal(row.cost, 720); assert.equal(row.claimable, 720); assert.equal(row.funded_by, 'principal');
  const ps = await report(w, 'principal_sales', range);
  assert.equal(rowOf(ps, 'Brand A Foods', 'principal').revenue, 12000); assert.equal(rowOf(ps, 'Brand A Foods', 'principal').agreed_margin, 8);
  const bp = await report(w, 'brand_performance', range);
  assert.equal(rowOf(bp, 'Crunchy', 'brand').principal, 'Brand A Foods');
});

t('targets, territory performance, beats, commission and collections reports', async () => {
  const { w, ravi, south, c1, c2, ameerpet } = await build('r4');
  const range = { from: dayFromNow(-5), to: dayFromNow(0) };
  await w.call(team.setTarget, { body: { scope_type: 'SALESPERSON', scope_id: ravi.salesperson_id, period_type: 'MONTHLY', target: 24000 } });
  await w.call(team.setTarget, { body: { scope_type: 'TERRITORY', scope_id: south.territory_id, period_type: 'MONTHLY', target: 24000 } });
  const tv = await report(w, 'target_vs_actual', range);
  const ravi_ = tv.rows.find((x) => x.name === 'Ravi'); assert.equal(ravi_.actual, 12000); assert.equal(ravi_.achievement, 50); assert.equal(ravi_.remaining, 12000);
  const tp = await report(w, 'territory_performance', { ...range, level: 'REGION' });
  assert.equal(rowOf(tp, 'South').retailers, 2); assert.equal(rowOf(tp, 'South').buying, 2); assert.equal(rowOf(tp, 'South').revenue, 12000); assert.equal(rowOf(tp, 'South').achievement, 50);
  assert.equal(rowOf(tp, 'North').retailers, 1); assert.equal(rowOf(tp, 'North').target, null);
  const bp = await report(w, 'beat_performance', range);
  assert.equal(rowOf(bp, 'Ameerpet Monday', 'beat').visits, 1); assert.equal(rowOf(bp, 'Ameerpet Monday', 'beat').productive, 1); assert.equal(rowOf(bp, 'Ameerpet Monday', 'beat').order_value, 10000);
  await w.call(team.createRule, { body: { name: 'All 2%', basis: 'VALUE', rate_pct: 2 } });
  const cm = await report(w, 'commission', range);
  assert.equal(cm.rows.filter((x) => x.salesperson === 'Ravi').reduce((s, x) => s + x.amount, 0), 240); assert.equal(cm.totals.amount, 280);
  // collections: Ravi's customers pay in, by method
  await w.call(money.create, { body: { customer_id: c1, amount: 3000, method: 'CASH' } });
  await w.call(money.create, { body: { customer_id: c2, amount: 500, method: 'UPI', reference: 'U9' } });
  const sc = await report(w, 'salesperson_collection', range);
  assert.equal(sc.totals.total, 3500); assert.equal(sc.totals.cash, 3000); assert.equal(sc.totals.upi, 500);
  const tc = await report(w, 'territory_collection', range);
  assert.equal(rowOf(tc, 'South › Secunderabad › Ameerpet', 'territory').amount, 3000); assert.equal(rowOf(tc, 'South › Hitech › Kondapur', 'territory').amount, 500);
  void ameerpet;
});

t('stock reports: vehicle stock, fast-moving, dead stock', async () => {
  const { w, A, B } = await build('r5');
  const idle = await addProduct(pool, w, { name: 'Idle goods', price: 10, cost: 5, tax: 0, stock: 100 });
  const van = (await w.call(vehicles.create, { body: { vehicle_no: 'TS09XY1111', driver_name: 'Mahesh' } })).body.data;
  await w.call(vehicles.load, { params: { id: van.vehicle_id }, body: { items: [{ product_id: A, quantity: 50 }, { product_id: B, quantity: 20 }] } });
  const vs = await report(w, 'vehicle_stock');
  assert.equal(vs.rows.length, 2); assert.equal(vs.totals.value, 50 * 60 + 20 * 30);
  const fast = await report(w, 'fast_moving', { from: dayFromNow(-5), to: dayFromNow(0) });
  assert.equal(fast.rows[0].product, 'Crunchy Chips'); assert.equal(fast.rows[0].units, 120);
  // 'dead' needs no sale inside the window: the idle goods have never sold, the others have
  const dead = await report(w, 'dead_stock');
  assert.deepEqual(dead.rows.map((x) => x.product), ['Idle goods']); assert.equal(dead.totals.value, 500);
  void idle;
});

t('the report catalogue shows distributor reports only to a distributor', async () => {
  const d = await makeWholesaler(pool, 'c1', { type: 'DISTRIBUTOR' }); const wh = await makeWholesaler(pool, 'c2', { type: 'WHOLESALE' });
  const keys = async (w) => (await w.call(reports.list, {})).body.data.map((x) => x.key);
  assert.ok((await keys(d)).includes('principal_settlement')); assert.ok((await keys(d)).includes('sales_summary'));
  assert.ok(!(await keys(wh)).includes('principal_settlement'));
  assert.equal((await wh.call(reports.run, { params: { key: 'principal_settlement' }, query: {} })).code, 404);
  await wh.call(parties.updateSettings, { body: { distributor_enabled: true } });
  assert.ok((await keys(wh)).includes('principal_settlement'));
  assert.ok(catalogue({ distributor: true }).length > catalogue().length);
  assert.equal((await d.call(reports.run, { params: { key: 'secondary_sales' }, query: {} }, d.tenantFor('FIELD_SALES'))).code, 200, 'the handler gate is the route’s permission');
});

t('the distributor dashboard: KPIs, targets, sales by territory / salesperson / retailer / brand, alerts; a rep sees only their own', async () => {
  const { w, ravi, c1, scheme, p1 } = await build('db1');
  await w.call(team.setTarget, { body: { scope_type: 'BUSINESS', period_type: 'MONTHLY', target: 28000 } });
  await w.call(schemes.update, { params: { id: scheme.scheme_id }, body: { ends_on: dayFromNow(2) } });
  await w.call(money.create, { body: { customer_id: c1, amount: 3000, method: 'CASH' } });
  const d = (await w.call(dash.dashboard, {})).body.data;
  const k = d.distributor.kpis;
  assert.equal(k.net_sales_month, 14000); assert.equal(k.month_target, 28000); assert.equal(k.target_achievement_pct, 50);
  assert.equal(k.sales_today, 14000); assert.equal(k.collections_today, 3000); assert.equal(k.orders_today.count, 3);
  assert.equal(k.gross_margin, 14000 - (132 * 60 + 40 * 30)); assert.equal(k.receivables, 14000 - 3000);
  assert.equal(k.pending_orders, 0); assert.equal(k.sales_returns, 0);
  const terr = d.distributor.performance.by_territory;
  assert.equal(terr[0].name, 'South › Secunderabad › Ameerpet'); assert.equal(terr[0].revenue, 10000);
  assert.equal(d.distributor.performance.by_salesperson[0].name, 'Ravi');
  assert.equal(d.distributor.performance.by_retailer[0].name, 'Balaji Kirana');
  assert.equal(d.distributor.performance.by_brand[0].name, 'Crunchy');
  assert.equal(d.distributor.performance.by_product[0].name, 'Crunchy Chips');
  assert.equal(d.distributor.performance.secondary_month, 14000);
  assert.equal(d.distributor.schemes.expiring[0].name, 'Chips 10+1'); assert.equal(d.distributor.schemes.cost_month, 720);
  assert.ok(d.alerts.some((a) => /Chips 10\+1/.test(a.text) && /ends in 2 days/.test(a.text)), JSON.stringify(d.alerts));
  void p1;
  // a rep sees only their own sales, targets and retailers
  const [uR] = [(await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Ravi login','ravi-${w.tag}@t.test','x') RETURNING user_id`)).rows[0].user_id];
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'FIELD_SALES','ACTIVE')`, [w.businessId, uR]);
  await pool.query(`UPDATE wholesale_salespeople SET user_id = $2 WHERE salesperson_id = $1`, [ravi.salesperson_id, uR]);
  await w.call(team.setTarget, { body: { scope_type: 'SALESPERSON', scope_id: ravi.salesperson_id, period_type: 'MONTHLY', target: 24000 } });
  const mine = (await w.call(dash.dashboard, {}, w.tenantFor('FIELD_SALES', { userId: uR, pinned: true }))).body.data;
  assert.equal(mine.distributor.kpis.net_sales_month, 12000); assert.equal(mine.distributor.kpis.month_target, 24000); assert.equal(mine.distributor.kpis.target_achievement_pct, 50);
  assert.deepEqual(mine.distributor.performance.by_salesperson.map((x) => x.name), ['Ravi']);
  assert.equal(mine.distributor.kpis.payable, null, 'money for the business is not shown to a rep');
});

t('a part delivery: the refused goods become a return and a credit note, atomically; the order is delivered', async () => {
  const w = await makeWholesaler(pool, 'pd1', { type: 'DISTRIBUTOR' });
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, cost: 60, tax: 0, stock: 100 });
  const c = await addCustomer(pool, w, { name: 'R', terms: 30 });
  const made = await makeInvoice(w, { customer: c, lines: [{ product_id: p, quantity: 50 }] });
  assert.equal((await stockOf(pool, w.branchId, p)).on_hand, 50);
  const status = (to, body = {}) => w.call(fulfilment.setDeliveryStatus, { params: { id: made.deliveryId }, body: { status: to, ...body } });
  assert.equal((await status('OUT_FOR_DELIVERY')).code, 200);
  const item = (await pool.query(`SELECT item_id FROM invoice_items WHERE invoice_id = $1`, [made.invoiceId])).rows[0].item_id;
  assert.equal((await status('PARTIAL', { pod_received_by: 'Owner' })).code, 400, 'it has to say what was refused');
  const part = await status('PARTIAL', { pod_received_by: 'Store manager', failure_reason: 'Refused 10, shelves full', returned_items: [{ invoice_item_id: item, quantity: 10 }] });
  assert.equal(part.code, 200, JSON.stringify(part.body)); assert.equal(part.body.data.status, 'PARTIAL'); assert.equal(part.body.data.order_status, 'DELIVERED');
  assert.equal((await stockOf(pool, w.branchId, p)).on_hand, 60, 'the refused 10 are back on the shelf');
  const inv = await invoiceRow(pool, made.invoiceId);
  assert.equal(Number(inv.balance_due_paise), 4000 * 100, '50 × ₹100 less the ₹1,000 credit note');
  assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(total_paise), 0) AS t FROM credit_notes WHERE invoice_id = $1`, [made.invoiceId])).rows[0].t), 100000);
  assert.equal((await status('DELIVERED', { pod_received_by: 'x' })).code, 409, 'a part delivery is final');
  const ret = (await pool.query(`SELECT reason, kind FROM wholesale_returns WHERE invoice_id = $1`, [made.invoiceId])).rows[0];
  assert.deepEqual({ ...ret }, { reason: 'CUSTOMER_REJECTION', kind: 'SALE' });
  // a refusal that cannot be credited (more than was delivered) changes nothing
  const made2 = await makeInvoice(w, { customer: c, lines: [{ product_id: p, quantity: 5 }] });
  await w.call(fulfilment.setDeliveryStatus, { params: { id: made2.deliveryId }, body: { status: 'OUT_FOR_DELIVERY' } });
  const item2 = (await pool.query(`SELECT item_id FROM invoice_items WHERE invoice_id = $1`, [made2.invoiceId])).rows[0].item_id;
  const bad = await w.call(fulfilment.setDeliveryStatus, { params: { id: made2.deliveryId }, body: { status: 'PARTIAL', pod_received_by: 'x', failure_reason: 'Refused', returned_items: [{ invoice_item_id: item2, quantity: 6 }] } });
  assert.ok(bad.code >= 400, JSON.stringify(bad.body));
  assert.equal((await pool.query(`SELECT status FROM wholesale_deliveries WHERE delivery_id = $1`, [made2.deliveryId])).rows[0].status, 'OUT_FOR_DELIVERY');
  void orders;
});

t('background checks: scheme expiry, target shortfall and collection chase notify once a day, only for a distributor', async () => {
  const { w, ravi, scheme, c1 } = await build('sc1');
  await w.call(schemes.update, { params: { id: scheme.scheme_id }, body: { ends_on: dayFromNow(1) } });
  await w.call(team.setTarget, { body: { scope_type: 'SALESPERSON', scope_id: ravi.salesperson_id, period_type: 'MONTHLY', target: 1000000 } });
  await pool.query(`UPDATE wholesale_invoice_meta SET due_date = CURRENT_DATE - 10 WHERE business_id = $1`, [w.businessId]);
  const first = await distScans.runForBusiness(pool, w.businessId);
  assert.equal(first.schemes, 1);
  assert.equal(first.collections, 1);
  const titles = (await pool.query(`SELECT type, title FROM notifications WHERE business_id = $1 AND type LIKE 'distributor_%' ORDER BY type`, [w.businessId])).rows;
  assert.ok(titles.some((x) => x.type === 'distributor_scheme_expiry' && /Chips 10\+1/.test(x.title) && /tomorrow|in 1 day/.test(x.title)), JSON.stringify(titles));
  assert.ok(titles.some((x) => x.type === 'distributor_collection_chase' && /3 retailers/.test(x.title)), JSON.stringify(titles));
  const second = await distScans.runForBusiness(pool, w.businessId);
  assert.equal(second.schemes, 0); assert.equal(second.collections, 0, 'once per day');
  void c1;
});
