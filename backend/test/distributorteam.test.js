/*
 * Distributor sales team: targets and achievement, commission rules and statements, retailer visits (offline-safe),
 * the field rep's day, order rejection, and who can see what.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';
import { addCustomer, addProduct, makeInvoice, makeWholesaler } from './helpers/wholesale.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const team = (await import('../src/controllers/distributorTeam.controller.js')).default;
const territories = (await import('../src/controllers/distributorTerritories.controller.js')).default;
const parties = (await import('../src/controllers/wholesaleParties.controller.js')).default;
const orders = (await import('../src/controllers/wholesaleOrders.controller.js')).default;
const money = (await import('../src/controllers/wholesaleMoney.controller.js')).default;
const credit = (await import('../src/controllers/creditNotes.controller.js'));
const { periodBounds, progress } = await import('../src/modules/distributor/targets.js');

test.after(cleanup);
if (!skip) await runMigrations(pool);
const t = (name, fn) => test(name, { skip }, fn);

const today = async (w) => (await pool.query(`SELECT ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date)::text AS d`)).rows[0].d;
const rep = async (w, name, extra = {}) => (await w.call(parties.createSalesperson, { body: { name, ...extra } })).body.data;
const assignRep = (customerId, repId, territoryId = null) => pool.query(`UPDATE wholesale_customer_profiles SET salesperson_id = $2, territory_id = COALESCE($3, territory_id) WHERE customer_id = $1`, [customerId, repId, territoryId]);

t('periods: weeks start Monday, quarters are calendar, a year is the financial year', () => {
  assert.deepEqual(periodBounds('WEEKLY', '2026-10-01'), ['2026-09-28', '2026-10-04']);   // Thursday
  assert.deepEqual(periodBounds('MONTHLY', '2026-02-10'), ['2026-02-01', '2026-02-28']);
  assert.deepEqual(periodBounds('QUARTERLY', '2026-08-15'), ['2026-07-01', '2026-09-30']);
  assert.deepEqual(periodBounds('YEARLY', '2026-02-10'), ['2025-04-01', '2026-03-31']);
  assert.deepEqual(periodBounds('YEARLY', '2026-04-01'), ['2026-04-01', '2027-03-31']);
  assert.deepEqual(periodBounds('DAILY', '2026-10-01'), ['2026-10-01', '2026-10-01']);
  const p = progress({ target_amount: 1000, period_start: '2026-10-01', period_end: '2026-10-10' }, 250, '2026-10-05');
  assert.equal(p.achievement_pct, 25); assert.equal(p.remaining, 750); assert.equal(p.days_left, 6); assert.equal(p.required_per_day, 125); assert.equal(p.status, 'BEHIND');
  assert.equal(progress({ target_amount: 1000, period_start: '2026-10-01', period_end: '2026-10-10' }, 1000, '2026-10-05').status, 'ACHIEVED');
});

t('a salesperson’s target is measured from invoices, net of credit notes, and setting it twice changes it', async () => {
  const w = await makeWholesaler(pool, 'tg1', { type: 'DISTRIBUTOR' });
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, cost: 60, tax: 18, stock: 5000 });
  const ravi = await rep(w, 'Ravi'); const asha = await rep(w, 'Asha');
  const c1 = await addCustomer(pool, w, { name: 'R1' }); const c2 = await addCustomer(pool, w, { name: 'R2' });
  await assignRep(c1, ravi.salesperson_id); await assignRep(c2, asha.salesperson_id);
  const sale = await makeInvoice(w, { customer: c1, lines: [{ product_id: p, quantity: 400 }], order: { salesperson_id: ravi.salesperson_id } });   // ₹40,000 before GST
  await makeInvoice(w, { customer: c2, lines: [{ product_id: p, quantity: 100 }], order: { salesperson_id: asha.salesperson_id } });
  const set = await w.call(team.setTarget, { body: { scope_type: 'SALESPERSON', scope_id: ravi.salesperson_id, period_type: 'MONTHLY', target: 100000 } });
  assert.equal(set.code, 201, JSON.stringify(set.body));
  assert.equal(set.body.data.actual, 40000); assert.equal(set.body.data.achievement_pct, 40); assert.equal(set.body.data.remaining, 60000);
  assert.equal(set.body.data.scope_name, 'Ravi');
  // a return reduces the actual
  const inv = (await pool.query(`SELECT i.invoice_id, ii.item_id FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.invoice_id WHERE i.invoice_id = $1`, [sale.invoiceId])).rows[0];
  const cn = await w.call(credit.create, { params: { id: inv.invoice_id }, body: { items: [{ item_id: inv.item_id, quantity: 100 }], reason: 'Damaged' } });
  assert.ok([200, 201].includes(cn.code), JSON.stringify(cn.body));
  const after = (await w.call(team.listTargets, {})).body.data.find((x) => x.scope_name === 'Ravi');
  assert.equal(after.actual, 30000, 'a ₹10,000 return comes off');
  // setting it again replaces, it does not duplicate
  const again = await w.call(team.setTarget, { body: { scope_type: 'SALESPERSON', scope_id: ravi.salesperson_id, period_type: 'MONTHLY', target: 120000 } });
  assert.equal(again.code, 200); assert.equal(again.body.data.target, 120000);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM dist_targets WHERE business_id = $1`, [w.businessId])).rows[0].n), 1);
  // the audit log recorded the change with before and after
  const logged = (await pool.query(`SELECT metadata FROM audit_log WHERE business_id = $1 AND action = 'distributor.target_changed'`, [w.businessId])).rows[0];
  assert.deepEqual(logged.metadata.changes.target, { from: 10000000, to: 12000000 });
});

t('targets by brand, category, territory (with everything under it), customer, and the whole business', async () => {
  const w = await makeWholesaler(pool, 'tg2', { type: 'DISTRIBUTOR' });
  const brand = (await pool.query(`INSERT INTO brands (business_id, name) VALUES ($1,'Crunchy') RETURNING brand_id`, [w.businessId])).rows[0].brand_id;
  const p1 = await addProduct(pool, w, { name: 'Chips', price: 50, stock: 5000, tax: 0 }); const p2 = await addProduct(pool, w, { name: 'Soap', price: 20, stock: 5000, tax: 0 });
  await pool.query(`UPDATE products SET brand_id = $2 WHERE product_id = $1`, [p1, brand]);
  const region = (await w.call(territories.create, { body: { level: 'REGION', name: 'South' } })).body.data;
  const terr = (await w.call(territories.create, { body: { level: 'TERRITORY', name: 'Secunderabad', parent_id: region.territory_id } })).body.data;
  const area = (await w.call(territories.create, { body: { level: 'AREA', name: 'Ameerpet', parent_id: terr.territory_id } })).body.data;
  const c1 = await addCustomer(pool, w, { name: 'In area' }); const c2 = await addCustomer(pool, w, { name: 'Elsewhere' });
  await assignRep(c1, null, area.territory_id);
  await makeInvoice(w, { customer: c1, lines: [{ product_id: p1, quantity: 100 }, { product_id: p2, quantity: 50 }] });   // 5000 + 1000
  await makeInvoice(w, { customer: c2, lines: [{ product_id: p1, quantity: 10 }] });                                        // 500
  const set = async (scope_type, scope_id, extra = {}) => (await w.call(team.setTarget, { body: { scope_type, scope_id, period_type: 'MONTHLY', target: 100000, ...extra } })).body.data;
  assert.equal((await set('BRAND', brand)).actual, 5500);                                   // Chips only
  assert.equal((await set('TERRITORY', region.territory_id)).actual, 6000);                  // the region includes the area under it
  assert.equal((await set('TERRITORY', area.territory_id)).actual, 6000);
  assert.equal((await set('CUSTOMER', c2)).actual, 500);
  assert.equal((await set('PRODUCT', p2)).actual, 1000);
  assert.equal((await set('BUSINESS', null)).actual, 6500);
  const qty = await set('PRODUCT', p1, { metric: 'QTY', target: 500 });                       // a quantity target counts base units
  assert.equal(qty.actual, 110); assert.equal(qty.remaining, 390);
  assert.equal((await w.call(team.setTarget, { body: { scope_type: 'PRODUCT', scope_id: 999999, period_type: 'MONTHLY', target: 100 } })).code, 400);
  // a different tenant's ids are refused
  const other = await makeWholesaler(pool, 'tg2b', { type: 'DISTRIBUTOR' });
  assert.equal((await other.call(team.setTarget, { body: { scope_type: 'CUSTOMER', scope_id: c1, period_type: 'MONTHLY', target: 100 } })).code, 400);
});

t('bulk target upload is all-or-nothing and reports the bad rows', async () => {
  const w = await makeWholesaler(pool, 'tg3', { type: 'DISTRIBUTOR' });
  const a = await rep(w, 'Amit'); const b = await rep(w, 'Bela');
  const good = { period_type: 'MONTHLY', target: 50000 };
  const bad = await w.call(team.bulkTargets, { body: { targets: [{ ...good, scope_type: 'SALESPERSON', scope_id: a.salesperson_id }, { ...good, scope_type: 'SALESPERSON', scope_id: 424242 }, { ...good, scope_type: 'NOPE' }] } });
  assert.equal(bad.code, 400); assert.equal(bad.body.data.errors.length, 2); assert.equal(bad.body.data.errors[0].row, 2);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM dist_targets WHERE business_id = $1`, [w.businessId])).rows[0].n), 0, 'nothing saved');
  const ok = await w.call(team.bulkTargets, { body: { targets: [{ ...good, scope_type: 'SALESPERSON', scope_id: a.salesperson_id }, { ...good, scope_type: 'SALESPERSON', scope_id: b.salesperson_id }] } });
  assert.deepEqual(ok.body.data, { created: 2, changed: 0 });
  const again = await w.call(team.bulkTargets, { body: { targets: [{ ...good, scope_type: 'SALESPERSON', scope_id: a.salesperson_id, target: 60000 }] } });
  assert.deepEqual(again.body.data, { created: 0, changed: 1 });
});

t('commission: ₹10,00,000 of sales at 2% is ₹20,000; the most specific rule wins; each sale is paid once', async () => {
  const w = await makeWholesaler(pool, 'cm1', { type: 'DISTRIBUTOR' });
  const brand = (await pool.query(`INSERT INTO brands (business_id, name) VALUES ($1,'Premium') RETURNING brand_id`, [w.businessId])).rows[0].brand_id;
  const big = await addProduct(pool, w, { name: 'Bulk Rice', price: 1000, cost: 800, tax: 0, stock: 5000 });
  const prem = await addProduct(pool, w, { name: 'Premium Tea', price: 100, cost: 60, tax: 0, stock: 5000 });
  await pool.query(`UPDATE products SET brand_id = $2 WHERE product_id = $1`, [prem, brand]);
  const ravi = await rep(w, 'Ravi');
  const c = await addCustomer(pool, w, { name: 'Trader' }); await assignRep(c, ravi.salesperson_id);
  await makeInvoice(w, { customer: c, lines: [{ product_id: big, quantity: 1000 }], order: { salesperson_id: ravi.salesperson_id } });   // ₹10,00,000
  const all = await w.call(team.createRule, { body: { name: 'Everything 2%', basis: 'VALUE', rate_pct: 2 } });
  assert.equal(all.code, 201, JSON.stringify(all.body));
  let st = (await w.call(team.commissionStatement, {})).body.data;
  assert.equal(st.salespeople.find((x) => x.name === 'Ravi').commission, 20000);
  // a brand rule is more specific than "everything": premium sales earn 5%, the rest stay at 2%
  await w.call(team.createRule, { body: { name: 'Premium 5%', basis: 'VALUE', scope_type: 'BRAND', scope_id: brand, rate_pct: 5 } });
  await makeInvoice(w, { customer: c, lines: [{ product_id: prem, quantity: 200 }], order: { salesperson_id: ravi.salesperson_id } });          // ₹20,000
  st = (await w.call(team.commissionStatement, {})).body.data;
  const r = st.salespeople.find((x) => x.name === 'Ravi');
  assert.equal(r.commission, 20000 + 1000, '₹10,00,000 × 2% + ₹20,000 × 5%, not 2% as well');
  assert.equal(r.sales, 1020000); assert.equal(r.lines.length, 2);
  // a per-unit rule and a margin rule
  await w.call(team.createRule, { body: { name: 'Rice per kg', basis: 'QTY', scope_type: 'PRODUCT', scope_id: big, per_unit: 0.5, priority: 1 } });
  st = (await w.call(team.commissionStatement, {})).body.data;
  assert.equal(st.salespeople.find((x) => x.name === 'Ravi').commission, 1000 * 0.5 + 1000, 'rice now pays ₹0.50 a unit instead of 2%');
  // a rule for one salesperson beats the general one
  const asha = await rep(w, 'Asha');
  await w.call(team.createRule, { body: { name: 'Ravi special', basis: 'MARGIN', rate_pct: 10, salesperson_id: ravi.salesperson_id, scope_type: 'PRODUCT', scope_id: prem } });
  st = (await w.call(team.commissionStatement, {})).body.data;
  const margin = 200 * (100 - 60);
  assert.equal(st.salespeople.find((x) => x.name === 'Ravi').commission, 500 + margin * 0.1);
  assert.equal(st.salespeople.find((x) => x.name === 'Asha').commission, 0);
  void asha;
});

t('commission: a rule can need a minimum target achievement, the profile default is the fallback, returns come off', async () => {
  const w = await makeWholesaler(pool, 'cm2', { type: 'DISTRIBUTOR' });
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, cost: 70, tax: 0, stock: 5000 });
  const ravi = await rep(w, 'Ravi', { commission_pct: 1 });
  const c = await addCustomer(pool, w, { name: 'T' }); await assignRep(c, ravi.salesperson_id);
  const sale = await makeInvoice(w, { customer: c, lines: [{ product_id: p, quantity: 1000 }], order: { salesperson_id: ravi.salesperson_id } });   // ₹1,00,000
  // no rules: the salesperson's own 1% applies
  let st = (await w.call(team.commissionStatement, {})).body.data.salespeople[0];
  assert.equal(st.commission, 1000);
  // a bonus rule that needs 100% of target
  await w.call(team.createRule, { body: { name: 'Bonus 3%', basis: 'VALUE', rate_pct: 3, min_achievement_pct: 100 } });
  st = (await w.call(team.commissionStatement, {})).body.data.salespeople[0];
  assert.equal(st.commission, 1000, 'no target set: the bonus does not apply');
  await w.call(team.setTarget, { body: { scope_type: 'SALESPERSON', scope_id: ravi.salesperson_id, period_type: 'MONTHLY', target: 200000 } });
  st = (await w.call(team.commissionStatement, {})).body.data.salespeople[0];
  assert.equal(st.commission, 1000, '50% of target: still no bonus'); assert.equal(st.achievement_pct, 50);
  await w.call(team.setTarget, { body: { scope_type: 'SALESPERSON', scope_id: ravi.salesperson_id, period_type: 'MONTHLY', target: 100000 } });
  st = (await w.call(team.commissionStatement, {})).body.data.salespeople[0];
  assert.equal(st.commission, 3000, 'target reached: 3% on the lot'); assert.equal(st.achievement_pct, 100);
  // a return takes it back below target and the bonus goes with it
  const inv = (await pool.query(`SELECT i.invoice_id, ii.item_id FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.invoice_id WHERE i.invoice_id = $1`, [sale.invoiceId])).rows[0];
  await w.call(credit.create, { params: { id: inv.invoice_id }, body: { items: [{ item_id: inv.item_id, quantity: 100 }], reason: 'Returned' } });
  st = (await w.call(team.commissionStatement, {})).body.data.salespeople[0];
  assert.equal(st.sales, 90000); assert.equal(st.commission, 900, 'below target again: back to the 1% default on ₹90,000');
});

t('commission on collections pays on cash received, not on sales invoiced', async () => {
  const w = await makeWholesaler(pool, 'cm3', { type: 'DISTRIBUTOR' });
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, cost: 70, tax: 0, stock: 5000 });
  const ravi = await rep(w, 'Ravi', { commission_pct: 2, commission_on: 'COLLECTIONS' });
  const c = await addCustomer(pool, w, { name: 'T', terms: 30 }); await assignRep(c, ravi.salesperson_id);
  await makeInvoice(w, { customer: c, lines: [{ product_id: p, quantity: 1000 }], order: { salesperson_id: ravi.salesperson_id } });
  assert.equal((await w.call(team.commissionStatement, {})).body.data.salespeople[0].commission, 0, 'nothing collected yet');
  await w.call(money.create, { body: { customer_id: c, amount: 40000, method: 'CASH' } });
  assert.equal((await w.call(team.commissionStatement, {})).body.data.salespeople[0].commission, 800);
});

t('visits: recorded once even when replayed, linked to the order and the collection they produced', async () => {
  const w = await makeWholesaler(pool, 'vs1', { type: 'DISTRIBUTOR' });
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, stock: 5000, tax: 0 });
  const ravi = await rep(w, 'Ravi');
  const c = await addCustomer(pool, w, { name: 'Balaji Kirana' }); await assignRep(c, ravi.salesperson_id);
  const beat = (await w.call(territories.createBeat, { body: { name: 'Mon', weekday: 1, salesperson_id: ravi.salesperson_id, customer_ids: [c] } })).body.data;
  const body = { customer_id: c, outcome: 'ORDER', notes: 'Wants more soap', next_visit_date: '2026-10-12', beat_id: beat.beat_id, client_ref: 'dev-1-0001', lat: 17.4, lng: 78.4 };
  const v = await w.call(team.recordVisit, { body });
  assert.equal(v.code, 201, JSON.stringify(v.body));
  const replay = await w.call(team.recordVisit, { body });
  assert.equal(replay.code, 200); assert.equal(replay.body.data.visit_id, v.body.data.visit_id);
  assert.equal(Number((await pool.query(`SELECT COUNT(*) AS n FROM dist_visits WHERE business_id = $1`, [w.businessId])).rows[0].n), 1);
  assert.equal(v.body.data.lat, undefined, 'location is not kept unless the business switched it on');
  const vid = v.body.data.visit_id;
  const order = await w.call(orders.create, { body: { customer_id: c, visit_id: vid, lines: [{ product_id: p, quantity: 10 }], submit: true } });
  assert.equal(order.code, 201, JSON.stringify(order.body));
  assert.equal(order.body.data.visit_id, vid); assert.equal(order.body.data.beat_id, beat.beat_id); assert.equal(order.body.data.status, 'PENDING');
  const rc = await w.call(money.create, { body: { customer_id: c, amount: 250, method: 'CASH', visit_id: vid, allocate: 'NONE' } });
  assert.equal(rc.code, 201, JSON.stringify(rc.body));
  const shown = (await w.call(team.listVisits, {})).body.data[0];
  assert.equal(shown.order_value, 1000); assert.equal(shown.collection, 250);   // (the offline pair below comes after this check) assert.equal(shown.customer, 'Balaji Kirana'); assert.equal(shown.beat, 'Mon');
  // an order and a collection taken offline name the visit by the reference the device gave it
  const viaRef = await w.call(orders.create, { body: { customer_id: c, visit_ref: 'dev-1-0001', lines: [{ product_id: p, quantity: 2 }] } });
  assert.equal(viaRef.code, 201, JSON.stringify(viaRef.body)); assert.equal(viaRef.body.data.visit_id, vid);
  const rcRef = await w.call(money.create, { body: { customer_id: c, amount: 100, method: 'CASH', visit_ref: 'dev-1-0001', allocate: 'NONE' } });
  assert.equal(rcRef.code, 201); assert.equal(Number((await pool.query(`SELECT visit_id FROM wholesale_receipts WHERE receipt_id = $1`, [rcRef.body.data.receipt_id])).rows[0].visit_id), vid);
  // a visit to a different retailer cannot be attached to this order
  const c2 = await addCustomer(pool, w, { name: 'Other' });
  assert.equal((await w.call(orders.create, { body: { customer_id: c2, visit_id: vid, lines: [{ product_id: p, quantity: 1 }] } })).code, 400);
  // location is stored when the business turns it on
  await w.call(parties.updateSettings, { body: { visit_location: true } });
  const located = await w.call(team.recordVisit, { body: { customer_id: c, outcome: 'NO_ORDER', client_ref: 'dev-1-0002', lat: 17.4, lng: 78.4 } });
  assert.equal(located.body.data.lat, 17.4);
});

t('the field rep’s day: today’s beat in order, with outstanding, visit status and target progress', async () => {
  const w = await makeWholesaler(pool, 'fd1', { type: 'DISTRIBUTOR' });
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, stock: 5000, tax: 0 });
  const ravi = await rep(w, 'Ravi');
  const [a, b] = [await addCustomer(pool, w, { name: 'A', terms: 30, limit: 50000 }), await addCustomer(pool, w, { name: 'B' })];
  await assignRep(a, ravi.salesperson_id); await assignRep(b, ravi.salesperson_id);
  const day = new Date(`${await today(w)}T00:00:00Z`).getUTCDay();
  await w.call(territories.createBeat, { body: { name: 'Today beat', weekday: day, salesperson_id: ravi.salesperson_id, customer_ids: [b, a] } });
  await w.call(territories.createBeat, { body: { name: 'Another day', weekday: (day + 1) % 7, salesperson_id: ravi.salesperson_id, customer_ids: [] } });
  await makeInvoice(w, { customer: a, lines: [{ product_id: p, quantity: 100 }], order: { salesperson_id: ravi.salesperson_id } });   // A owes ₹10,000
  await w.call(team.setTarget, { body: { scope_type: 'SALESPERSON', scope_id: ravi.salesperson_id, period_type: 'MONTHLY', target: 50000 } });
  await w.call(team.recordVisit, { body: { customer_id: b, outcome: 'NO_ORDER', salesperson_id: ravi.salesperson_id } });
  const res = (await w.call(team.fieldToday, { query: { salesperson_id: String(ravi.salesperson_id) } })).body.data;
  assert.equal(res.beats.length, 1);
  assert.deepEqual(res.beats[0].customers.map((x) => x.name), ['B', 'A'], 'in beat order');
  const [rb, ra] = res.beats[0].customers;
  assert.equal(rb.visited, true); assert.equal(rb.visit_outcome, 'NO_ORDER'); assert.equal(ra.visited, false);
  assert.equal(ra.outstanding, 10000); assert.equal(ra.credit_limit, 50000);
  assert.equal(res.summary.planned, 2); assert.equal(res.summary.visited, 1);
  assert.equal(res.summary.month_target.target, 50000); assert.equal(res.summary.month_target.achievement_pct, 20);
  const snap = (await w.call(team.fieldCustomer, { params: { id: String(a) } })).body.data;
  assert.equal(snap.credit.outstanding, 10000); assert.equal(snap.credit.available, 40000); assert.equal(snap.open_invoices.length, 1); assert.equal(snap.orders.length, 1);
});

t('a field rep sees only their own retailers, beats, visits and targets; a manager sees everyone’s', async () => {
  const w = await makeWholesaler(pool, 'fs1', { type: 'DISTRIBUTOR' });
  const [uA, uB] = await Promise.all(['a', 'b'].map(async (x) => (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [`Rep ${x}`, `rep-${x}-${w.tag}@t.test`])).rows[0].user_id));
  for (const u of [uA, uB]) await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'FIELD_SALES','ACTIVE')`, [w.businessId, u]);
  const ra = await rep(w, 'Rep A', { user_id: uA, sales_role: 'FIELD_SALES' }); const rb = await rep(w, 'Rep B', { user_id: uB, sales_role: 'FIELD_SALES' });
  const [ca, cb] = [await addCustomer(pool, w, { name: 'A shop' }), await addCustomer(pool, w, { name: 'B shop' })];
  await assignRep(ca, ra.salesperson_id); await assignRep(cb, rb.salesperson_id);
  await w.call(territories.createBeat, { body: { name: 'A beat', weekday: 2, salesperson_id: ra.salesperson_id, customer_ids: [ca] } });
  await w.call(territories.createBeat, { body: { name: 'B beat', weekday: 3, salesperson_id: rb.salesperson_id, customer_ids: [cb] } });
  await w.call(team.setTarget, { body: { scope_type: 'SALESPERSON', scope_id: ra.salesperson_id, period_type: 'MONTHLY', target: 1000 } });
  await w.call(team.setTarget, { body: { scope_type: 'SALESPERSON', scope_id: rb.salesperson_id, period_type: 'MONTHLY', target: 2000 } });
  const asA = w.tenantFor('FIELD_SALES', { userId: uA, pinned: true });
  assert.deepEqual((await w.call(territories.listBeats, {}, asA)).body.data.map((b) => b.name), ['A beat']);
  assert.equal((await w.call(territories.getBeat, { params: { id: (await pool.query(`SELECT beat_id FROM dist_beats WHERE name = 'B beat' AND business_id = $1`, [w.businessId])).rows[0].beat_id } }, asA)).code, 404);
  assert.deepEqual((await w.call(team.listTargets, {}, asA)).body.data.map((x) => x.scope_name), ['Rep A']);
  assert.equal((await w.call(team.recordVisit, { body: { customer_id: cb, outcome: 'NO_ORDER' } }, asA)).code, 403, 'not on their beats');
  assert.equal((await w.call(team.recordVisit, { body: { customer_id: ca, outcome: 'NO_ORDER' } }, asA)).code, 201);
  assert.equal((await w.call(team.fieldCustomer, { params: { id: String(cb) } }, asA)).code, 404);
  assert.equal((await w.call(parties.getCustomer, { params: { id: String(cb) } }, asA)).code, 404, 'the customer list is scoped too');
  assert.equal((await w.call(money.create, { body: { customer_id: cb, amount: 10, method: 'CASH' } }, asA)).code, 403, 'cannot collect from a retailer that is not theirs');
  assert.equal((await w.call(team.listVisits, {})).body.data.length, 1, 'the owner sees every visit');
  // collections can be switched off for the field
  await w.call(parties.updateSettings, { body: { field_collections: false } });
  assert.equal((await w.call(money.create, { body: { customer_id: ca, amount: 10, method: 'CASH' } }, asA)).code, 403);
  assert.equal((await w.call(money.create, { body: { customer_id: ca, amount: 10, method: 'CASH' } })).code, 201, 'the office still can');
});

t('a submitted order can be rejected with a reason; a rejected order holds no stock and cannot be confirmed', async () => {
  const w = await makeWholesaler(pool, 'rj1', { type: 'DISTRIBUTOR' });
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, stock: 100, tax: 0 });
  const c = await addCustomer(pool, w, { name: 'T' });
  const o = (await w.call(orders.create, { body: { customer_id: c, lines: [{ product_id: p, quantity: 10 }], submit: true } })).body.data;
  assert.equal((await w.call(orders.reject, { params: { id: o.order_id }, body: {} })).code, 400, 'a reason is required');
  const rej = await w.call(orders.reject, { params: { id: o.order_id }, body: { reason: 'Over credit, clear dues first' } });
  assert.equal(rej.code, 200, JSON.stringify(rej.body)); assert.equal(rej.body.data.status, 'REJECTED'); assert.equal(rej.body.data.reject_reason, 'Over credit, clear dues first');
  assert.equal((await w.call(orders.confirm, { params: { id: o.order_id }, body: {} })).code, 409);
  assert.equal((await w.call(orders.reject, { params: { id: o.order_id }, body: { reason: 'again' } })).code, 409);
  assert.equal(Number((await pool.query(`SELECT COALESCE(SUM(reserved_qty),0) AS r FROM branch_stock WHERE product_id = $1`, [p])).rows[0].r), 0);
  assert.equal((await w.call(orders.reject, { params: { id: o.order_id }, body: { reason: 'x' } }, w.tenantFor('FIELD_SALES'))).code, 403);
});

t('credit: a manager can override a block only when the business allows it', async () => {
  const w = await makeWholesaler(pool, 'cr1', { type: 'DISTRIBUTOR' });
  const p = await addProduct(pool, w, { name: 'Soap', price: 100, stock: 1000, tax: 0 });
  const c = await addCustomer(pool, w, { name: 'Tight', limit: 500 });
  await w.call(parties.updateSettings, { body: { credit_policy: 'BLOCK' } });
  const o = (await w.call(orders.create, { body: { customer_id: c, lines: [{ product_id: p, quantity: 10 }] } })).body.data;     // ₹1,000 against a ₹500 limit
  const blocked = await w.call(orders.confirm, { params: { id: o.order_id }, body: {} });
  assert.equal(blocked.code, 409); assert.equal(blocked.body.code, 'CREDIT_BLOCK');
  await w.call(parties.updateSettings, { body: { credit_manager_override: false } });
  assert.equal((await w.call(orders.confirm, { params: { id: o.order_id }, body: { credit_override: true, reason: 'ok' } })).code, 409, 'override switched off');
  await w.call(parties.updateSettings, { body: { credit_manager_override: true } });
  assert.equal((await w.call(orders.confirm, { params: { id: o.order_id }, body: { credit_override: true, reason: 'regular customer' } })).code, 200);
});
