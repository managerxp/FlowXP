/*
 * Demo shop: "Sharma Auto Parts", Bengaluru. A parts counter and a warehouse, about 40 parts for cars and bikes with OEM and alternate numbers, a small hand-entered vehicle
 * list (a DEMO list, not reference data: real fitment must come from the shop's own catalogue), racks and bins, stock received and shelved, garages on trade prices
 * and credit limits, a month of sales through the real invoice engine, a few returns, and a supplier claim.
 *
 *   npm run seed:autoparts        (re-running replaces the demo shop)
 *
 * Sign in: autoparts@flowxp.test / demo1234   (staff: parts-manager@, parts-store@ (storekeeper), parts-counter@ (parts counter), same password)
 */
import './no-production.js'; // loads .env, and stops here in production
import bcrypt from 'bcryptjs';
import pool, { initializeDatabase } from '../src/config/database.js';
import { createInvoiceInTransaction } from '../src/modules/billing.js';
import { inTx } from '../src/modules/autoparts/common.js';
import * as parts from '../src/modules/autoparts/parts.js';
import * as vehicles from '../src/modules/autoparts/vehicles.js';
import * as locations from '../src/modules/autoparts/locations.js';
import * as bins from '../src/modules/autoparts/bins.js';
import * as sales from '../src/modules/autoparts/sales.js';
import { stockIn } from '../src/modules/wholesale/stock.js';
import recv from '../src/controllers/autopartsReceiving.controller.js';

const PASSWORD = 'demo1234';
const mulberry32 = (seed) => () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rand = mulberry32(20261012);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const dayAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/* make, model, type, [variants: name, engine cc, fuel, from, to] */
const VEHICLES = [
  ['Maruti Suzuki', 'Swift', 'CAR', [['VXi', 1197, 'PETROL', 2018, 2023], ['ZDi', 1248, 'DIESEL', 2012, 2017]]],
  ['Maruti Suzuki', 'Alto 800', 'CAR', [['LXi', 796, 'PETROL', 2012, 2022]]],
  ['Maruti Suzuki', 'Baleno', 'CAR', [['Delta', 1197, 'PETROL', 2015, 2022]]],
  ['Hyundai', 'i20', 'CAR', [['Sportz', 1197, 'PETROL', 2014, 2020]]],
  ['Hyundai', 'Creta', 'CAR', [['SX', 1497, 'PETROL', 2015, 2019]]],
  ['Honda', 'City', 'CAR', [['VX', 1497, 'PETROL', 2014, 2019]]],
  ['Honda', 'Activa', 'SCOOTER', [['125', 124, 'PETROL', 2016, 2023]]],
  ['Bajaj', 'Pulsar 150', 'BIKE', [['Standard', 149, 'PETROL', 2012, 2023]]],
  ['TVS', 'Apache RTR 160', 'BIKE', [['Standard', 159, 'PETROL', 2015, 2023]]],
  ['Hero', 'Splendor Plus', 'BIKE', [['Standard', 97, 'PETROL', 2014, 2023]]]
];

/* name, category, price, cost, gst, classification, vehicle type, OEM no, mfr no, models it fits (verified), stock */
const PARTS = [
  ['Front brake pad set - Swift', 'Brakes', 1450, 920, 28, 'AFTERMARKET', 'CAR', '55810M68K00', 'GDB3322', ['Swift'], 24],
  ['Front brake pad set - Baleno', 'Brakes', 1520, 960, 28, 'AFTERMARKET', 'CAR', '55810M68K10', 'GDB3411', ['Baleno'], 18],
  ['Front brake pad set - i20', 'Brakes', 1580, 1000, 28, 'OEM', 'CAR', '58101C8A00', 'GDB3512', ['i20'], 12],
  ['Brake disc - Swift', 'Brakes', 2650, 1800, 28, 'AFTERMARKET', 'CAR', '5551168K00', 'DF4551', ['Swift'], 8],
  ['Brake shoe set - Alto 800', 'Brakes', 780, 480, 28, 'AFTERMARKET', 'CAR', '5320065J00', 'GS8240', ['Alto 800'], 20],
  ['Oil filter - Maruti 1.2', 'Filters', 280, 160, 28, 'AFTERMARKET', 'CAR', '1651061M00', 'W712/93', ['Swift', 'Baleno'], 60],
  ['Oil filter - Hyundai 1.2', 'Filters', 310, 180, 28, 'AFTERMARKET', 'CAR', '2630002503', 'W67/1', ['i20'], 30],
  ['Air filter - Swift', 'Filters', 420, 250, 28, 'AFTERMARKET', 'CAR', '1378068K00', 'C1349', ['Swift'], 25],
  ['Air filter - City', 'Filters', 560, 340, 28, 'AFTERMARKET', 'CAR', '17220RB0Z00', 'C2312', ['City'], 15],
  ['Cabin filter - Creta', 'Filters', 640, 380, 28, 'AFTERMARKET', 'CAR', '97133A5000', 'CU2326', ['Creta'], 10],
  ['Spark plug - Swift', 'Ignition', 320, 190, 28, 'AFTERMARKET', 'CAR', '09482-00583', 'BKR6E', ['Swift', 'Baleno', 'Alto 800'], 80],
  ['Spark plug - Activa', 'Ignition', 190, 110, 28, 'AFTERMARKET', 'SCOOTER', '31916-KWB-901', 'CPR8EA', ['Activa'], 90],
  ['Spark plug - Pulsar', 'Ignition', 170, 95, 28, 'AFTERMARKET', 'BIKE', 'DR8ES', 'DR8ES', ['Pulsar 150'], 70],
  ['Engine oil 5W30 3.5L', 'Oils', 1950, 1500, 18, 'AFTERMARKET', 'CAR', null, 'CASTROL-MAGNATEC-5W30', [], 36],
  ['Engine oil 10W30 900ml (bike)', 'Oils', 380, 285, 18, 'AFTERMARKET', 'BIKE', null, 'CASTROL-ACTIV-10W30', [], 120],
  ['Coolant 1L', 'Oils', 260, 170, 18, 'AFTERMARKET', 'CAR', null, 'PRESTONE-1L', [], 40],
  ['Wiper blade 22 in', 'Body', 360, 210, 28, 'AFTERMARKET', 'CAR', '3834075F00', 'BOSCH-AEROTWIN-22', ['Swift', 'Baleno'], 35],
  ['Headlamp bulb H4', 'Electrical', 220, 120, 28, 'AFTERMARKET', 'CAR', null, 'PHILIPS-H4-12342', [], 100],
  ['Headlamp assembly - Swift (RH)', 'Electrical', 4200, 3000, 28, 'AFTERMARKET', 'CAR', '3510068K10', 'DEPO-318-1101', ['Swift'], 3],
  ['Battery 12V 35Ah', 'Electrical', 3950, 3100, 28, 'AFTERMARKET', 'CAR', null, 'EXIDE-EPIQ-35', [], 14],
  ['Battery 12V 5Ah (bike)', 'Electrical', 1250, 920, 28, 'AFTERMARKET', 'BIKE', null, 'AMARON-5L-B', [], 22],
  ['Clutch plate set - Pulsar 150', 'Clutch', 690, 430, 28, 'AFTERMARKET', 'BIKE', '17010-CP', 'CP-PUL150', ['Pulsar 150'], 16],
  ['Clutch cable - Splendor', 'Clutch', 140, 80, 28, 'AFTERMARKET', 'BIKE', '22870-KWG', 'HERO-CC-SP', ['Splendor Plus'], 45],
  ['Chain sprocket kit - Apache 160', 'Drive', 1850, 1250, 28, 'AFTERMARKET', 'BIKE', null, 'RK-CK-APA160', ['Apache RTR 160'], 11],
  ['Drive belt - Activa 125', 'Drive', 980, 640, 28, 'AFTERMARKET', 'SCOOTER', '23100-K44', 'BANDO-ACT125', ['Activa'], 13],
  ['Shock absorber front - Alto 800', 'Suspension', 2300, 1500, 28, 'AFTERMARKET', 'CAR', '4161068K10', 'KYB-334449', ['Alto 800'], 6],
  ['Radiator hose - City', 'Cooling', 740, 450, 28, 'AFTERMARKET', 'CAR', '19501RB0Z00', 'GATES-RH-CITY', ['City'], 9],
  ['Water pump - Swift', 'Cooling', 1980, 1300, 28, 'AFTERMARKET', 'CAR', '1740076G00', 'GWP-SWF', ['Swift'], 7],
  ['Timing belt kit - i20', 'Engine', 3350, 2300, 28, 'AFTERMARKET', 'CAR', '2431226000', 'GATES-K015607', ['i20'], 5],
  ['Fuel filter - Creta', 'Filters', 520, 310, 28, 'AFTERMARKET', 'CAR', '319102E000', 'FF-CRETA', ['Creta'], 12]
];

const main = async () => {
  await initializeDatabase();
  for (const { business_id } of (await pool.query(`SELECT business_id FROM businesses WHERE name = 'Sharma Auto Parts'`)).rows) await pool.query('DELETE FROM businesses WHERE business_id = $1', [business_id]);
  await pool.query(`DELETE FROM users WHERE email LIKE 'autoparts@flowxp.test' OR email LIKE 'parts-%@flowxp.test'`);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const staff = {};
  for (const [key, email, name, role] of [['owner', 'autoparts@flowxp.test', 'Suresh Sharma', 'OWNER'], ['manager', 'parts-manager@flowxp.test', 'Anita Rao', 'MANAGER'], ['store', 'parts-store@flowxp.test', 'Manjunath K', 'STOREKEEPER'], ['counter', 'parts-counter@flowxp.test', 'Imran Pasha', 'PARTS_COUNTER']]) {
    staff[key] = { userId: (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ($1,$2,$3,TRUE) RETURNING user_id`, [name, email, hash])).rows[0].user_id, role };
  }
  const businessId = (await pool.query(
    `INSERT INTO businesses (name, business_type, owner_user_id, email, phone, address, city, state, gstin, gst_enabled, subscription_status, plan_code, billing_cycle, onboarding_step, round_off_enabled)
     VALUES ('Sharma Auto Parts','AUTO_PARTS',$1,'autoparts@flowxp.test','9845000000','12, Avenue Road','Bengaluru','Karnataka','29AABCS1234F1Z5',TRUE,'ACTIVE','ENTERPRISE','MONTHLY',10,FALSE) RETURNING business_id`,
    [staff.owner.userId])).rows[0].business_id;
  const store = (await pool.query(`INSERT INTO branches (business_id, name, is_primary, city, state) VALUES ($1,'Avenue Road store',TRUE,'Bengaluru','Karnataka') RETURNING branch_id`, [businessId])).rows[0].branch_id;
  await pool.query(`INSERT INTO branches (business_id, name, is_primary, city, state) VALUES ($1,'Peenya warehouse',FALSE,'Bengaluru','Karnataka')`, [businessId]);
  for (const [key, { userId, role }] of Object.entries(staff)) await pool.query(`INSERT INTO business_users (business_id, user_id, role, status, branch_id) VALUES ($1,$2,$3,'ACTIVE',$4)`, [businessId, userId, role, key === 'counter' ? store : null]);
  const tenant = { businessId, branchId: store, scopeBranchId: store, userId: staff.manager.userId, role: 'MANAGER', permissions: {}, businessType: 'AUTO_PARTS', planFeatures: {} };
  const uid = staff.manager.userId;

  // vehicles (a demo list), then parts
  const models = new Map(); const makes = new Map();
  for (const [make, model, type, variants] of VEHICLES) {
    const mkKey = `${make}|${type}`;
    if (!makes.has(mkKey)) makes.set(mkKey, await inTx((db) => vehicles.createMake(db, businessId, { name: make, vehicle_type: type })));
    const mk = makes.get(mkKey);
    const md = await inTx((db) => vehicles.createModel(db, businessId, { make_id: mk.make_id, name: model }));
    models.set(model, md.model_id);
    for (const [variant, cc, fuel, from, to] of variants) await inTx((db) => vehicles.createVariant(db, businessId, { model_id: md.model_id, variant, engine_cc: cc, fuel, year_from: from, year_to: to }));
  }
  const suppliers = [];
  for (const name of ['Bosch Distributors', 'Gabriel Auto Spares', 'Castrol Dealer Bengaluru']) suppliers.push((await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,$2) RETURNING supplier_id`, [businessId, name])).rows[0].supplier_id);

  const ids = [];
  for (const [name, category, price, cost, gst, classification, vtype, oem, mfr, fits, stock] of PARTS) {
    const cat = (await pool.query(`SELECT category_id FROM categories WHERE business_id = $1 AND name = $2`, [businessId, category])).rows[0]
      || (await pool.query(`INSERT INTO categories (business_id, name) VALUES ($1,$2) RETURNING category_id`, [businessId, category])).rows[0];
    const pid = (await pool.query(
      `INSERT INTO products (business_id, category_id, name, sku, unit, selling_price_paise, purchase_price_paise, tax_rate, hsn_sac, track_inventory, kind, min_stock)
       VALUES ($1,$2,$3,$4,'pc',$5,$6,$7,'87083000',TRUE,'DISH',$8) RETURNING product_id`, [businessId, cat.category_id, name, `AP-${String(ids.length + 1).padStart(4, '0')}`, price * 100, cost * 100, gst, Math.max(2, Math.round(stock / 5))])).rows[0].product_id;
    await inTx(async (db) => {
      await parts.saveProfile(db, businessId, pid, uid, { classification, vehicle_type: vtype, oem_part_no: oem, mfr_part_no: mfr, preferred_supplier_id: pick(suppliers), reorder_level: Math.max(2, Math.round(stock / 4)), max_stock: stock * 2 });
      for (const m of fits) await vehicles.addFit(db, businessId, pid, uid, { model_id: models.get(m), status: rand() < 0.7 ? 'VERIFIED' : 'UNVERIFIED', source: 'demo data, check before relying on it' });
      await stockIn(db, { businessId, branchId: store, productId: pid, qty: stock, type: 'PURCHASE', refType: 'seed', refId: pid, notes: 'Opening stock', userId: uid });
    });
    ids.push({ id: pid, price, stock });
  }

  // racks: Peenya-style layout in the store: WH > zone A/B > racks > bins
  const wh = await inTx((db) => locations.createLocation(db, tenant, uid, { segment: 'WH', name: 'Main store' }));
  const bin = [];
  for (const z of ['A', 'B']) {
    const zone = await inTx((db) => locations.createLocation(db, tenant, uid, { parent_id: wh.location_id, segment: z }));
    for (let r = 1; r <= 3; r++) {
      const rack = await inTx((db) => locations.createLocation(db, tenant, uid, { parent_id: zone.location_id, segment: `R${String(r).padStart(2, '0')}`, loc_type: 'RACK' }));
      const made = await inTx((db) => locations.createMany(db, tenant, uid, { parent_id: rack.location_id, prefix: 'B', count: 4, loc_type: 'BIN', capacity_units: 60 }));
      bin.push(...made);
    }
  }
  // shelve about four fifths of the stock; the rest waits for a bin, as a real week's deliveries do
  for (const [i, p] of ids.entries()) {
    if (i % 5 === 4) continue;
    const target = bin[i % bin.length];
    await inTx((db) => bins.putAway(db, tenant, uid, { product_id: p.id, location_id: target.location_id, qty: p.stock, source_key: `seed-${p.id}` }));
  }

  // garages on trade prices and credit
  const list = await inTx((db) => sales.savePriceList(db, businessId, null, { name: 'Garage', discount_pct: 12 }));
  const customers = [];
  for (const [name, phone, cls, limit] of [['Ravi Motors', '9880011111', 'GARAGE', 50000], ['Speed Auto Works', '9880022222', 'WORKSHOP', 30000], ['City Cabs Fleet', '9880033333', 'FLEET', 100000], ['Walk-in customer', '9880044444', 'RETAIL', 0]]) {
    const c = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [businessId, name, phone])).rows[0].customer_id;
    if (cls !== 'RETAIL') await inTx((db) => sales.saveProfile(db, businessId, c, { customer_class: cls, price_list_id: list.price_list_id, credit_limit: limit, credit_policy: 'BLOCK', terms_days: 30 }));
    customers.push({ id: c, cls });
  }

  // a month of sales through the real invoice engine
  const sellerTenant = { ...tenant, userId: staff.counter.userId };
  let bills = 0;
  for (let d = 30; d >= 1; d--) {
    for (let k = 0; k < int(3, 7); k++) {
      const c = pick(customers);
      const items = Array.from({ length: int(1, 3) }, () => pick(ids.filter((p) => p.stock > 6))).map((p) => ({ product_id: p.id, quantity: int(1, 3) }));
      const onAccount = c.cls !== 'RETAIL' && rand() < 0.5;
      try {
        await inTx((db) => createInvoiceInTransaction(db, { businessId, branchId: store, businessType: 'AUTO_PARTS' }, staff.counter.userId, { customerId: c.id, items, invoiceDate: dayAgo(d), payment: onAccount ? undefined : { amount: 'FULL', method: pick(['CASH', 'UPI', 'CARD']) } }));
        bills += 1;
      } catch (e) { if (!/Not enough stock|credit|limit/i.test(e.message)) throw e; }
    }
  }
  void sellerTenant;
  // a delivery booked through the real receiving flow: one line shelved on the spot, one damaged in transit, one part rejected at the door, one waiting for a bin
  const post = async (body) => {
    const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await recv.create({ tenant, auth: { userId: uid }, body, params: {}, query: {}, headers: {}, get: () => undefined, ip: '127.0.0.1' }, res);
    if (res.code !== 201) throw new Error(`receipt failed: ${JSON.stringify(res.body)}`);
  };
  await post({ supplier_id: suppliers[0], supplier_invoice_no: 'BD/2291', grn_date: dayAgo(2), items: [
    { product_id: ids[0].id, received: 24, damaged: 2, rejected: 0, unit_cost: 920, bin_id: bin[0].location_id },
    { product_id: ids[3].id, received: 10, damaged: 1, rejected: 1, unit_cost: 1800 },
    { product_id: ids[10].id, received: 40, unit_cost: 190, bin_id: bin[5].location_id }] });
  await inTx((db) => sales.reserve(db, tenant, uid, { product_id: ids[0].id, qty: 2, customer_id: customers[0].id, note: 'Collect Saturday' }));
  await inTx((db) => import('../src/modules/autoparts/returns.js').then((r) => r.createClaim(db, tenant, uid, { product_id: ids[3].id, supplier_id: suppliers[0], qty: 2, reason: 'DAMAGED', amount: 3600, note: 'Cracked in the box' })));
  console.log(`Sharma Auto Parts ready: ${ids.length} parts, ${bin.length} bins, ${bills} bills.\nSign in as autoparts@flowxp.test / ${PASSWORD}`);
  await pool.end();
};

main().catch((e) => { console.error(e); process.exit(1); });
