/*
 * Demo distributor: layers the distributor module onto the "Sunrise Distributors" wholesaler (run `npm run seed:wholesale`
 * first, or use `npm run seed:distributor`, which does both).
 *
 *   npm run seed:distributor
 *
 * It turns on "Wholesale + Distributor", then builds the rest through the same controllers the screens use: principals
 * (linked to the existing suppliers) with brands and products, a region → territory → area tree with retailers placed
 * in it, two field reps with weekday beats, targets and commission rules, running schemes, two vans loaded from the
 * warehouse and selling to retailers over the last weeks (with part collections), a van count with a shortage, and
 * today's field day: visits, an order with a scheme applied, a collection, and a rejected order.
 *
 * Sign in: wholesale@flowxp.test / demo1234 (owner); field reps: wholesale-field1@ and wholesale-field2@flowxp.test;
 * wholesale-collect@ (collection executive) and wholesale-delivery@ (delivery manager), same password.
 */
import './no-production.js'; // loads .env, and stops here in production
import bcrypt from 'bcryptjs';
import pool, { initializeDatabase } from '../src/config/database.js';
import parties from '../src/controllers/wholesaleParties.controller.js';
import orders from '../src/controllers/wholesaleOrders.controller.js';
import money from '../src/controllers/wholesaleMoney.controller.js';
import principals from '../src/controllers/distributorPrincipals.controller.js';
import territories from '../src/controllers/distributorTerritories.controller.js';
import team from '../src/controllers/distributorTeam.controller.js';
import schemes from '../src/controllers/distributorSchemes.controller.js';
import vehicles from '../src/controllers/distributorVehicles.controller.js';

const PASSWORD = 'demo1234';
const isoDaysAgo = (n) => { const d = new Date(Date.now() - n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isoAhead = (n) => isoDaysAgo(-n);
const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

const main = async () => {
  await initializeDatabase();
  const owner = (await pool.query(`SELECT u.user_id, b.business_id FROM users u JOIN businesses b ON b.owner_user_id = u.user_id WHERE u.email = 'wholesale@flowxp.test' AND b.name = 'Sunrise Distributors'`)).rows[0];
  if (!owner) throw new Error('The demo wholesaler is not there yet. Run `npm run seed:wholesale` first (or `npm run seed:distributor`, which does both).');
  const businessId = owner.business_id;
  if ((await pool.query(`SELECT 1 FROM dist_principals WHERE business_id = $1`, [businessId])).rowCount) {
    console.log('The distributor demo is already in place. Re-run `npm run seed:wholesale` to start again.');
    await pool.end(); return;
  }
  const wh = (await pool.query(`SELECT branch_id FROM branches WHERE business_id = $1 ORDER BY is_primary DESC, branch_id`, [businessId])).rows.map((r) => r.branch_id);

  /* ── people ── */
  const hash = await bcrypt.hash(PASSWORD, 10);
  const staff = { owner: { userId: owner.user_id, role: 'OWNER', name: 'Rajesh Agarwal' } };
  for (const [key, email, name, role] of [
    ['field1', 'wholesale-field1@flowxp.test', 'Arjun Naidu', 'FIELD_SALES'], ['field2', 'wholesale-field2@flowxp.test', 'Sana Fatima', 'FIELD_SALES'],
    ['collect', 'wholesale-collect@flowxp.test', 'Prakash Verma', 'COLLECTION_EXECUTIVE'], ['delivery', 'wholesale-delivery@flowxp.test', 'Mahesh Yadav', 'DELIVERY_MANAGER']
  ]) {
    const u = (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ($1,$2,$3,TRUE) RETURNING user_id`, [name, email, hash])).rows[0];
    await pool.query(`INSERT INTO business_users (business_id, user_id, role, branch_id) VALUES ($1,$2,$3,$4)`, [businessId, u.user_id, role, role === 'FIELD_SALES' ? wh[0] : null]);
    staff[key] = { userId: u.user_id, role, name };
  }
  const tenantFor = (who, branchId = wh[0]) => ({ businessId, businessType: 'WHOLESALE', role: staff[who].role, permissions: {}, branchId, scopeBranchId: branchId, viewAll: false, pinned: false, planFeatures: {}, userId: staff[who].userId, multiOutlet: true, name: 'Sunrise Distributors' });
  const call = async (handler, { who = 'owner', branchId = wh[0], body = {}, params = {}, query = {} } = {}) => {
    const res = fakeRes();
    await handler({ tenant: tenantFor(who, branchId), auth: { userId: staff[who].userId }, user: { userId: staff[who].userId }, params, body, query, headers: {}, ip: '127.0.0.1', get: () => undefined }, res);
    if (res.code >= 400) throw new Error(`${handler.name || 'handler'} ${res.code}: ${res.body?.message}`);
    return res.body?.data ?? res.body;
  };
  const tryCall = async (...a) => { try { return await call(...a); } catch (e) { return { error: e.message }; } };

  await call(parties.updateSettings, { body: { distributor_enabled: true, scheme_stacking: 'BEST', visit_location: true, field_collections: true } });

  /* ── territories, and the retailers placed in them ── */
  const node = async (level, name, parent) => (await call(territories.create, { body: { level, name, parent_id: parent?.territory_id } }));
  const tree = {};
  const tg = await node('REGION', 'Telangana');
  const hydTerr = await node('TERRITORY', 'Hyderabad & Secunderabad', tg); const dist = await node('TERRITORY', 'Districts', tg);
  tree.Hyderabad = await node('AREA', 'Hyderabad', hydTerr); tree.Secunderabad = await node('AREA', 'Secunderabad', hydTerr);
  for (const c of ['Warangal', 'Karimnagar', 'Nizamabad']) tree[c] = await node('AREA', c, dist);
  const ap = await node('REGION', 'Andhra Pradesh'); const coast = await node('TERRITORY', 'Coastal Andhra', ap);
  for (const c of ['Vijayawada', 'Guntur']) tree[c] = await node('AREA', c, coast);
  const ka = await node('REGION', 'Karnataka'); const blr = await node('TERRITORY', 'Bengaluru', ka); tree.Bengaluru = await node('AREA', 'Bengaluru', blr);
  const customers = (await pool.query(`SELECT c.customer_id, c.name, w.city, w.customer_type FROM customers c JOIN wholesale_customer_profiles w ON w.customer_id = c.customer_id WHERE c.business_id = $1 AND c.status = 'ACTIVE' ORDER BY c.customer_id`, [businessId])).rows;
  const byCity = new Map();
  for (const c of customers) { const a = tree[c.city]; if (a) { if (!byCity.has(c.city)) byCity.set(c.city, []); byCity.get(c.city).push(c.customer_id); } }
  for (const [city, ids] of byCity) await call(territories.assignCustomers, { body: { customer_ids: ids, territory_id: tree[city].territory_id } });
  console.log(`  ${Object.keys(tree).length} areas, ${[...byCity.values()].flat().length} retailers placed`);

  /* ── principals (the existing suppliers), their brands and products ── */
  const suppliers = (await pool.query(`SELECT supplier_id, name, gstin, phone FROM suppliers WHERE business_id = $1 ORDER BY supplier_id`, [businessId])).rows;
  const prin = [];
  for (const [i, s] of suppliers.entries()) {
    prin.push(await call(principals.create, { body: { name: s.name.replace(/ (Distribution|Wholesale|Bottling Co|Depot)$/, ''), company_name: s.name, supplier_id: s.supplier_id, gstin: s.gstin, margin_pct: [6.5, 5, 4, 8, 3.5][i % 5], payment_terms_days: [30, 21, 30, 45, 15][i % 5], credit_limit: 1500000, agreement_start: isoDaysAgo(120), agreement_end: i === 1 ? isoAhead(18) : isoAhead(240), territory_note: 'Telangana and Andhra Pradesh' } }));
  }
  const products = (await pool.query(`SELECT p.product_id, p.name, p.sku, p.supplier_id, p.purchase_price_paise, c.name AS category, COALESCE(d.moq, 1) AS moq FROM products p LEFT JOIN categories c ON c.category_id = p.category_id LEFT JOIN wholesale_item_details d ON d.product_id = p.product_id WHERE p.business_id = $1 AND p.status = 'ACTIVE' ORDER BY p.product_id`, [businessId])).rows;
  for (const [i, s] of suppliers.entries()) {
    const mine = products.filter((p) => p.supplier_id === s.supplier_id);
    const brandNames = [...new Set(mine.map((p) => p.name.split(' ')[0]))];
    for (const bn of brandNames) {
      const brand = await call(principals.createBrand, { body: { name: bn, principal_id: prin[i].principal_id } });
      await call(principals.assignProducts, { params: { id: prin[i].principal_id }, body: { product_ids: mine.filter((p) => p.name.startsWith(`${bn} `)).map((p) => p.product_id), brand_id: brand.brand_id } });
    }
    if (!mine.length) await tryCall(principals.assignProducts, { params: { id: prin[i].principal_id }, body: { product_ids: [] } });
  }
  await pool.query(`UPDATE wholesale_item_details d SET principal_price_paise = ROUND(p.purchase_price_paise * 0.97) FROM products p WHERE p.product_id = d.product_id AND p.business_id = $1 AND d.principal_id IS NOT NULL`, [businessId]);

  /* ── the sales team and their beats ── */
  const mkRep = (name, who, role, territory, extra = {}) => call(parties.createSalesperson, { body: { name, user_id: who ? staff[who].userId : undefined, sales_role: role, territory_id: territory.territory_id, commission_pct: 0, commission_on: 'SALES', phone: `98480${String(Math.abs(name.length * 7919)).padStart(5, '0').slice(0, 5)}`, ...extra } });
  const existingReps = (await pool.query(`SELECT salesperson_id, name FROM wholesale_salespeople WHERE business_id = $1 ORDER BY salesperson_id`, [businessId])).rows;
  const manager = existingReps[0];
  const r1 = await mkRep('Arjun Naidu', 'field1', 'FIELD_SALES', tree.Hyderabad, { manager_id: manager?.salesperson_id, employee_id: 'FS-101' });
  const r2 = await mkRep('Sana Fatima', 'field2', 'FIELD_SALES', tree.Secunderabad, { manager_id: manager?.salesperson_id, employee_id: 'FS-102' });
  const rc = await mkRep('Prakash Verma', 'collect', 'COLLECTION_EXECUTIVE', hydTerr, { employee_id: 'CE-201' });
  // field reps own the retailers in their areas
  await pool.query(`UPDATE wholesale_customer_profiles SET salesperson_id = $2 WHERE customer_id = ANY($1::int[])`, [byCity.get('Hyderabad') || [], r1.salesperson_id]);
  await pool.query(`UPDATE wholesale_customer_profiles SET salesperson_id = $2 WHERE customer_id = ANY($1::int[])`, [byCity.get('Secunderabad') || [], r2.salesperson_id]);
  const beatPlan = async (rep, ids, tag) => {
    const days = [1, 2, 3, 4, 5, 6]; const groups = days.map(() => []);
    ids.forEach((id, i) => groups[i % days.length].push(id));
    let n = 0;
    for (const [i, g] of groups.entries()) if (g.length) { const b = await tryCall(territories.createBeat, { body: { name: `${tag} · ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]}`, weekday: days[i], salesperson_id: rep.salesperson_id, customer_ids: g } }); if (!b.error) n++; }
    return n;
  };
  const hyd = (byCity.get('Hyderabad') || []); const sec = [...(byCity.get('Secunderabad') || []), ...(byCity.get('Warangal') || [])];
  const nb = (await beatPlan(r1, hyd, 'Hyderabad')) + (await beatPlan(r2, sec, 'North'));
  console.log(`  ${nb} beats for 2 field reps`);

  /* ── targets and commission ── */
  const setT = (scope_type, scope_id, target, extra = {}) => tryCall(team.setTarget, { body: { scope_type, scope_id, period_type: 'MONTHLY', target, metric: 'VALUE', ...extra } });
  await setT('BUSINESS', null, 1500000);
  for (const [r, amt] of [[r1, 450000], [r2, 300000], [existingReps[0], 400000], [existingReps[1], 350000]].filter(([r]) => r)) await setT('SALESPERSON', r.salesperson_id, amt);
  await setT('TERRITORY', hydTerr.territory_id, 600000); await setT('TERRITORY', dist.territory_id, 300000);
  await tryCall(team.createRule, { body: { name: 'Everything 1%', basis: 'VALUE', rate_pct: 1 } });
  const bev = (await pool.query(`SELECT category_id FROM categories WHERE business_id = $1 AND name = 'Beverages'`, [businessId])).rows[0];
  if (bev) await tryCall(team.createRule, { body: { name: 'Beverages 2%', basis: 'VALUE', scope_type: 'CATEGORY', scope_id: bev.category_id, rate_pct: 2, priority: 1 } });
  await tryCall(team.createRule, { body: { name: 'Bonus above target', basis: 'VALUE', rate_pct: 0.5, min_achievement_pct: 100 } });

  /* ── schemes ── */
  const find = (sku) => products.find((p) => p.sku === sku);
  const pg = find('BIS-PG100'); const gd = find('BIS-GD75'); const cc = find('BEV-CC600'); const atta = find('STP-AA5');
  const mk = async (body) => { const r = await tryCall(schemes.create, { body: { starts_on: isoDaysAgo(10), ends_on: isoAhead(20), ...body } }); if (r.error) console.log(`  (scheme "${body.name}" skipped: ${r.error})`); return r; };
  const parle = prin.find((p) => /Gokul/.test(p.name)) || prin[0];
  await mk({ name: 'Parle-G: buy 10 boxes, get 1 free', kind: 'BUY_X_GET_Y', funded_by: 'PRINCIPAL', principal_id: parle.principal_id, buy_scope: 'PRODUCT', buy_scope_id: pg.product_id, buy_unit_name: 'box', buy_min_qty: 10, free_qty: 1, free_unit_name: 'box', repeat: true, max_free_qty: 10 });
  await mk({ name: 'Good Day: 5% off 20 boxes or more', kind: 'QTY_DISCOUNT', buy_scope: 'PRODUCT', buy_scope_id: gd.product_id, buy_unit_name: 'box', buy_min_qty: 20, discount_pct: 5 });
  if (bev) await mk({ name: 'Festive beverages: 3% off 120 bottles or more', kind: 'QTY_DISCOUNT', buy_scope: 'CATEGORY', buy_scope_id: bev.category_id, buy_min_qty: 120, discount_pct: 3, stackable: true, ends_on: isoAhead(5) });
  await mk({ name: '₹500 off orders over ₹25,000', kind: 'VALUE_DISCOUNT', buy_scope: 'ALL', min_value: 25000, discount: 500, customer_types: ['RETAILER', 'DEALER'] });
  await mk({ name: 'Atta cartons: buy 5, get 1 kg salt free', kind: 'BUY_X_GET_Y', buy_scope: 'PRODUCT', buy_scope_id: atta.product_id, buy_unit_name: 'carton', buy_min_qty: 5, free_product_id: find('STP-TS1').product_id, free_qty: 10, repeat: false, starts_on: isoDaysAgo(40), ends_on: isoDaysAgo(8) });

  /* ── vans: loaded, selling over three weeks, one counted ── */
  const vA = await call(vehicles.create, { body: { vehicle_no: 'TS09UB1234', driver_name: 'Mahesh Yadav', driver_user_id: staff.delivery.userId, salesperson_id: r1.salesperson_id, route: 'Ameerpet – SR Nagar – Kukatpally', capacity_kg: 1500, branch_id: wh[0] } });
  const vB = await call(vehicles.create, { body: { vehicle_no: 'TS08UC5678', driver_name: 'Ismail Khan', salesperson_id: r2.salesperson_id, route: 'Secunderabad – Malkajgiri – Uppal', capacity_kg: 1000, branch_id: wh[0] } });
  const stocked = products.filter((p) => ['BIS-PG100', 'BIS-GD75', 'SNK-LC52', 'BEV-FM200', 'BEV-BW1L', 'STP-TS1', 'PC-DS125', 'PC-CS200'].includes(p.sku));
  const rep = { [vA.vehicle_id]: byCity.get('Hyderabad') || [], [vB.vehicle_id]: byCity.get('Secunderabad') || [] };
  const sells = { [vA.vehicle_id]: r1, [vB.vehicle_id]: r2 };
  let vanSales = 0; let vanCollected = 0;
  for (const [vi, v] of [vA, vB].entries()) {
    const carried = [];
    for (const p of stocked) for (const q of [200, 120, 60, 24]) if (!(await tryCall(vehicles.load, { params: { id: v.vehicle_id }, body: { items: [{ product_id: p.product_id, quantity: q }] } })).error) { carried.push(p); break; }
    const retailers = rep[v.vehicle_id]; if (!retailers.length) continue;
    for (let day = 18; day >= 1; day -= 2) {
      const cust = retailers[(day + vi) % retailers.length];
      const lines = carried.filter((_, k) => (k + day) % 2 === 0).slice(0, 3).map((p) => ({ product_id: p.product_id, quantity: Math.max(Number(p.moq), 6 + ((day + vi) % 4) * 6) }));
      if (!lines.length) continue;
      const sale = await tryCall(vehicles.sell, { who: vi ? 'field2' : 'field1', params: { id: v.vehicle_id }, body: { customer_id: cust, lines, invoice_kind: 'TAX', payment_terms_days: 15, ...(day % 4 === 0 ? { payment: { amount: 0 } } : {}) } });
      if (sale.error) { if (!globalThis.__shown) { console.log(`  (van sale: ${sale.error})`); globalThis.__shown = 1; } continue; }
      vanSales++;
      const date = isoDaysAgo(day);
      await pool.query(`UPDATE invoices SET invoice_date = $2::date, created_at = ($2::date)::timestamptz WHERE invoice_id = $1`, [sale.invoice_id, date]);
      await pool.query(`UPDATE wholesale_invoice_meta SET due_date = $2::date + 15 WHERE invoice_id = $1`, [sale.invoice_id, date]);
      await pool.query(`UPDATE wholesale_sales_orders SET order_date = $2::date, created_at = ($2::date)::timestamptz WHERE order_id = $1`, [sale.order_id, date]);
      if (day % 3 !== 0) { // most retailers pay: part now, the rest left to collect
        const part = Math.round(Number(sale.total || sale.invoice_total || 0) * (day % 2 ? 0.6 : 1));
        if (part > 0) {
          const r = await tryCall(money.create, { who: 'collect', body: { customer_id: cust, amount: part, method: day % 2 ? 'UPI' : 'CASH', reference: day % 2 ? `UPI${100000 + day * 37}` : undefined } });
          if (!r.error) { vanCollected++; await pool.query(`UPDATE wholesale_receipts SET receipt_date = $2::date, created_at = ($2::date)::timestamptz WHERE receipt_id = $1`, [r.receipt_id, date]); }
        }
      }
    }
  }
  // end of day: van A is counted and finds a small shortage
  const stockA = (await call(vehicles.get, { params: { id: vA.vehicle_id } })).stock;
  if (stockA.length) await call(vehicles.reconcile, { params: { id: vA.vehicle_id }, body: { counts: stockA.map((s, i) => ({ stock_id: s.stock_id, counted: i === 0 ? Math.max(0, Number(s.qty_base ?? s.quantity ?? s.qty) - 3) : Number(s.qty_base ?? s.quantity ?? s.qty) })), return_to_warehouse: false, note: 'Evening count' } }).catch((e) => console.log(`  (van count skipped: ${e.message})`));
  console.log(`  2 vans, ${vanSales} van sales, ${vanCollected} collections`);

  /* ── today's field day ── */
  const visitDay = async (who, rep, beatName, doOrder) => {
    const today = await call(team.fieldToday, { who, query: {} }).catch(() => null);
    const stops = today?.beats?.flatMap((b) => b.customers.map((c) => ({ ...c, beat_id: b.beat_id }))) || [];
    const fallback = stops.length ? stops : (rep === r1 ? hyd : sec).slice(0, 4).map((id) => ({ customer_id: id }));
    let made = 0;
    for (const [i, stop] of fallback.slice(0, 5).entries()) {
      const ref = `seed-${who}-${i}`;
      const outcome = i === 0 && doOrder ? 'ORDER' : i === 1 ? 'COLLECTION' : i === 2 ? 'NOT_AVAILABLE' : 'NO_ORDER';
      const v = await tryCall(team.recordVisit, { who, body: { customer_id: stop.customer_id, beat_id: stop.beat_id, client_ref: ref, outcome, notes: outcome === 'NOT_AVAILABLE' ? 'Owner away, come back after 4' : undefined, lat: 17.4375 + i * 0.002, lng: 78.4483 + i * 0.002 } });
      if (v.error) continue;
      made++;
      if (outcome === 'ORDER') await tryCall(orders.create, { who, body: { customer_id: stop.customer_id, visit_ref: ref, submit: true, source: 'FIELD', lines: [{ product_id: pg.product_id, unit_name: 'box', quantity: 12 }, { product_id: gd.product_id, unit_name: 'box', quantity: 6 }] } });
      if (outcome === 'COLLECTION') await tryCall(money.create, { who, body: { customer_id: stop.customer_id, amount: 2500, method: 'CASH', visit_ref: ref } });
    }
    return made;
  };
  const day1 = await visitDay('field1', r1, 'Hyderabad', true); const day2 = await visitDay('field2', r2, 'North', false);
  // an order the sales manager turns down
  const pending = await tryCall(orders.create, { body: { customer_id: (byCity.get('Nizamabad') || hyd)[0], submit: true, lines: [{ product_id: atta.product_id, unit_name: 'carton', quantity: 40 }] } });
  if (!pending.error) await tryCall(orders.reject, { params: { id: pending.order_id }, body: { reason: 'Customer is over their credit limit' } });
  console.log(`  ${day1 + day2} visits today`);

  const totals = (await pool.query(`SELECT (SELECT COUNT(*) FROM dist_principals WHERE business_id = $1) AS principals, (SELECT COUNT(*) FROM dist_territories WHERE business_id = $1) AS territories, (SELECT COUNT(*) FROM dist_beats WHERE business_id = $1) AS beats,
    (SELECT COUNT(*) FROM dist_schemes WHERE business_id = $1) AS schemes, (SELECT COUNT(*) FROM dist_vehicles WHERE business_id = $1) AS vans, (SELECT COUNT(*) FROM dist_visits WHERE business_id = $1) AS visits`, [businessId])).rows[0];
  console.log(`\nDistributor demo ready: ${totals.principals} principals, ${totals.territories} territories, ${totals.beats} beats, ${totals.schemes} schemes, ${totals.vans} vans, ${totals.visits} visits.`);
  console.log('Sign in: wholesale@flowxp.test / demo1234 (owner) — field reps wholesale-field1@ / wholesale-field2@, collection executive wholesale-collect@, delivery manager wholesale-delivery@ (@flowxp.test, same password)');
  await pool.end();
};

main().catch(async (error) => { console.error(error); await pool.end().catch(() => {}); process.exit(1); });
