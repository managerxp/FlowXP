/*
 * Demo wholesaler: "Sunrise Distributors", with about 45 days of trading across two warehouses.
 *
 *   npm run seed:wholesale        (re-running replaces the demo wholesaler)
 *
 * Everything goes through the same controllers the screens use — orders are confirmed and reserved, picked, packed and
 * dispatched (which raises the invoice through the billing engine), goods are received against purchase orders with
 * batches and expiry, customers pay with receipts that are allocated to invoices — so stock, balances, ageing and
 * reports are genuine rather than inserted numbers. Dates are then moved back so ageing and trends have a shape.
 * The history is deterministic and plants a few things to look at: a customer over their credit limit, an overdue
 * pile, a batch about to expire and one already expired, a product that is out of stock with a back-order waiting,
 * damaged goods, a transfer in transit, and a failed delivery.
 *
 * Sign in: wholesale@flowxp.test / demo1234   (staff: wholesale-sales@, -warehouse@, -purchase@, -accounts@ ... same password)
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pool, { initializeDatabase } from '../src/config/database.js';
import catalog from '../src/controllers/wholesaleCatalog.controller.js';
import parties from '../src/controllers/wholesaleParties.controller.js';
import orders from '../src/controllers/wholesaleOrders.controller.js';
import fulfilment from '../src/controllers/wholesaleFulfilment.controller.js';
import inventory from '../src/controllers/wholesaleInventory.controller.js';
import purchasing from '../src/controllers/wholesalePurchasing.controller.js';
import money from '../src/controllers/wholesaleMoney.controller.js';
import returns from '../src/controllers/wholesaleReturns.controller.js';

const PASSWORD = 'demo1234';
const DAYS = 45;

const mulberry32 = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = mulberry32(20261001);
const int = (a, b) => Math.floor(a + rand() * (b - a + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const isoDaysAgo = (n) => { const d = new Date(Date.now() - n * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const isoAhead = (n) => isoDaysAgo(-n);

/* ── the catalogue ────────────────────────────────────────────────────────── */
// name, sku, category, unit, tax, cost, wholesale, mrp, units [[name, factor]], moq, reorder, tracking ('expiry' | 'batch' | null), supplier index, opening stock
const PRODUCTS = [
  ['Parle-G Biscuits 100g', 'BIS-PG100', 'Biscuits & Snacks', 'pcs', 18, 4.2, 5.0, 5, [['box', 12], ['carton', 288]], 24, 576, 'batch', 0, 4320],
  ['Good Day Cashew 75g', 'BIS-GD75', 'Biscuits & Snacks', 'pcs', 18, 9.5, 11.5, 12, [['box', 12], ['carton', 144]], 24, 288, 'batch', 0, 1440],
  ['Lays Classic 52g', 'SNK-LC52', 'Biscuits & Snacks', 'pcs', 12, 17.5, 20, 20, [['box', 24], ['carton', 96]], 24, 288, 'expiry', 0, 960],
  ['Kurkure Masala 90g', 'SNK-KM90', 'Biscuits & Snacks', 'pcs', 12, 17.5, 20, 20, [['box', 24], ['carton', 96]], 24, 192, 'expiry', 0, 720],
  ['Coca-Cola 600ml', 'BEV-CC600', 'Beverages', 'bottle', 28, 28, 33, 40, [['crate', 24]], 24, 240, 'expiry', 1, 1200],
  ['Frooti Mango 200ml', 'BEV-FM200', 'Beverages', 'pcs', 12, 8.8, 10.5, 12, [['box', 24], ['carton', 96]], 24, 288, 'expiry', 1, 1920],
  ['Bisleri Water 1L', 'BEV-BW1L', 'Beverages', 'bottle', 18, 10.5, 13, 20, [['case', 12]], 12, 360, null, 1, 2400],
  ['Red Label Tea 500g', 'STP-RL500', 'Staples', 'pack', 5, 190, 215, 240, [['carton', 20]], 5, 40, 'batch', 2, 260],
  ['Aashirvaad Atta 5kg', 'STP-AA5', 'Staples', 'bag', 5, 215, 240, 262, [['carton', 4]], 4, 60, null, 2, 400],
  ['Fortune Sunflower Oil 1L', 'STP-FO1', 'Staples', 'pouch', 5, 118, 128, 145, [['carton', 12]], 12, 120, 'batch', 2, 840],
  ['Tata Salt 1kg', 'STP-TS1', 'Staples', 'pack', 0, 22, 25, 28, [['carton', 25]], 25, 150, null, 2, 1000],
  ['India Gate Basmati 5kg', 'STP-IG5', 'Staples', 'bag', 5, 520, 565, 640, [['carton', 4]], 4, 40, null, 2, 120],
  ['Colgate Strong Teeth 200g', 'PC-CS200', 'Personal Care', 'pcs', 18, 78, 90, 105, [['box', 12], ['carton', 72]], 12, 144, 'batch', 3, 720],
  ['Dettol Soap 125g', 'PC-DS125', 'Personal Care', 'pcs', 18, 38, 45, 52, [['box', 12], ['carton', 144]], 12, 144, 'batch', 3, 864],
  ['Surf Excel 1kg', 'PC-SE1', 'Personal Care', 'pack', 18, 128, 142, 160, [['carton', 10]], 10, 60, null, 3, 300],
  ['Head & Shoulders 340ml', 'PC-HS340', 'Personal Care', 'bottle', 18, 215, 245, 285, [['carton', 6]], 6, 36, 'batch', 3, 180],
  ['Amul Butter 500g', 'DAI-AB500', 'Dairy & Chilled', 'pack', 12, 238, 255, 275, [['carton', 20]], 10, 40, 'expiry', 4, 120],
  ['Amul Cheese Slices 200g', 'DAI-AC200', 'Dairy & Chilled', 'pack', 12, 118, 128, 140, [['carton', 24]], 12, 48, 'expiry', 4, 168],
  ['Amul Taaza Milk 1L', 'DAI-AT1', 'Dairy & Chilled', 'pack', 5, 54, 58, 62, [['crate', 12]], 12, 120, 'expiry', 4, 360],
  ['Britannia Cake 55g', 'BIS-BC55', 'Biscuits & Snacks', 'pcs', 12, 8.4, 10, 10, [['box', 24]], 24, 192, 'expiry', 0, 0]   // out of stock on purpose
];
const SUPPLIERS = [
  ['Gokul Foods Distribution', '27AAPFG1234F1Z9', 'Pune', 'Maharashtra', 30], ['Cool Drinks Bottling Co', '36AABCC2345D1Z5', 'Hyderabad', 'Telangana', 21],
  ['Annapurna Staples Wholesale', '36AAACA3456E1Z2', 'Hyderabad', 'Telangana', 30], ['HomeCare Brands India', '29AAACH4567F1Z7', 'Bengaluru', 'Karnataka', 45], ['Amul Dairy Depot', '24AAACA5678G1Z1', 'Ahmedabad', 'Gujarat', 7]
];
const CUSTOMERS = [
  // name, type, city, state, terms, limit, discount, opening balance
  ['Sharma General Store', 'RETAILER', 'Hyderabad', 'Telangana', 15, 60000, 0, 0], ['Balaji Kirana', 'RETAILER', 'Hyderabad', 'Telangana', 15, 40000, 0, 0], ['Lakshmi Provision Stores', 'RETAILER', 'Secunderabad', 'Telangana', 15, 50000, 0, 12500],
  ['Mehta Super Mart', 'DEALER', 'Hyderabad', 'Telangana', 30, 250000, 2, 0], ['Rao & Sons Traders', 'DEALER', 'Warangal', 'Telangana', 30, 200000, 2, 0], ['City Fresh Retail', 'DEALER', 'Vijayawada', 'Andhra Pradesh', 30, 180000, 0, 0],
  ['Metro Cash & Carry Hub', 'DISTRIBUTOR', 'Hyderabad', 'Telangana', 45, 800000, 0, 0], ['Deccan Distributors', 'DISTRIBUTOR', 'Karimnagar', 'Telangana', 45, 600000, 0, 0], ['Southern Wholesale Mart', 'DISTRIBUTOR', 'Bengaluru', 'Karnataka', 45, 500000, 0, 0],
  ['Hotel Paradise Kitchens', 'BUSINESS', 'Hyderabad', 'Telangana', 30, 120000, 0, 0], ['Taj Banjara Procurement', 'CORPORATE', 'Hyderabad', 'Telangana', 45, 300000, 0, 0], ['Infosys Cafeteria Services', 'CORPORATE', 'Hyderabad', 'Telangana', 30, 200000, 0, 0],
  ['Ganesh Departmental', 'RETAILER', 'Nizamabad', 'Telangana', 15, 30000, 0, 0], ['Venkat Stores', 'RETAILER', 'Guntur', 'Andhra Pradesh', 15, 35000, 0, 0], ['Sri Sai Supermarket', 'DEALER', 'Hyderabad', 'Telangana', 30, 150000, 0, 0],
  ['Bangalore Bazaar', 'DEALER', 'Bengaluru', 'Karnataka', 30, 150000, 0, 0], ['Fresh Basket Retail', 'RETAILER', 'Hyderabad', 'Telangana', 15, 45000, 0, 0], ['Crescent Traders', 'RETAILER', 'Hyderabad', 'Telangana', 15, 20000, 0, 18000]
];

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

const main = async () => {
  await initializeDatabase();
  const previous = await pool.query(`SELECT business_id FROM businesses WHERE name = 'Sunrise Distributors'`);
  for (const { business_id } of previous.rows) {
    // Wholesale documents reference products, batches and branches without cascading, so clear them leaf-first.
    const mine = '(SELECT product_id FROM products WHERE business_id = $1)';
    for (const sql of [
      `DELETE FROM wholesale_pick_item_batches WHERE pick_item_id IN (SELECT pick_item_id FROM wholesale_pick_items WHERE product_id IN ${mine})`,
      `DELETE FROM wholesale_pick_items WHERE product_id IN ${mine}`,
      `DELETE FROM wholesale_return_items WHERE product_id IN ${mine}`,
      `DELETE FROM wholesale_transfer_batches WHERE item_id IN (SELECT item_id FROM wholesale_transfer_items WHERE product_id IN ${mine})`,
      `DELETE FROM wholesale_transfer_items WHERE product_id IN ${mine}`,
      `DELETE FROM wholesale_grn_items WHERE product_id IN ${mine}`,
      `DELETE FROM wholesale_sales_order_items WHERE product_id IN ${mine}`
    ]) await pool.query(sql, [business_id]);
    await pool.query('DELETE FROM businesses WHERE business_id = $1', [business_id]);
  }
  await pool.query(`DELETE FROM users WHERE email LIKE 'wholesale%@flowxp.test'`);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const staff = {};
  for (const [key, email, name, role] of [
    ['owner', 'wholesale@flowxp.test', 'Rajesh Agarwal', 'OWNER'], ['sales', 'wholesale-sales@flowxp.test', 'Suresh Reddy', 'SALES_MANAGER'], ['exec', 'wholesale-exec@flowxp.test', 'Kiran Babu', 'SALES_EXECUTIVE'],
    ['warehouse', 'wholesale-warehouse@flowxp.test', 'Imran Shaikh', 'WAREHOUSE_MANAGER'], ['picker', 'wholesale-picker@flowxp.test', 'Ramesh Goud', 'WAREHOUSE_STAFF'], ['purchase', 'wholesale-purchase@flowxp.test', 'Anita Joshi', 'PURCHASE_MANAGER'],
    ['accounts', 'wholesale-accounts@flowxp.test', 'Vinod Kulkarni', 'ACCOUNTANT'], ['driver', 'wholesale-driver@flowxp.test', 'Mahesh Yadav', 'DELIVERY']
  ]) {
    const { rows } = await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ($1,$2,$3,TRUE) RETURNING user_id`, [name, email, hash]);
    staff[key] = { userId: rows[0].user_id, role, name };
  }
  const biz = (await pool.query(
    `INSERT INTO businesses (name, business_type, owner_user_id, email, phone, address, city, state, gstin, gst_enabled, subscription_status, plan_code, billing_cycle, onboarding_step)
     VALUES ('Sunrise Distributors','WHOLESALE',$1,'wholesale@flowxp.test','9848000000','Plot 18, Industrial Estate, Balanagar','Hyderabad','Telangana','36AAACS1234Q1ZQ',TRUE,'ACTIVE','ENTERPRISE','MONTHLY',10) RETURNING business_id`, [staff.owner.userId])).rows[0];
  const businessId = biz.business_id;
  const wh = [];
  for (const [name, code, city, primary] of [['Main Warehouse, Balanagar', 'MAIN', 'Hyderabad', true], ['Secunderabad Depot', 'SEC', 'Secunderabad', false]]) {
    wh.push((await pool.query(`INSERT INTO branches (business_id, name, code, city, state, is_primary) VALUES ($1,$2,$3,$4,'Telangana',$5) RETURNING branch_id`, [businessId, name, code, city, primary])).rows[0].branch_id);
  }
  const pinned = { picker: wh[0], exec: wh[0], driver: wh[0] };
  for (const [key, s] of Object.entries(staff)) await pool.query(`INSERT INTO business_users (business_id, user_id, role, branch_id) VALUES ($1,$2,$3,$4)`, [businessId, s.userId, s.role, pinned[key] ?? null]);

  const tenantFor = (who = 'owner', branchId = wh[0]) => ({ businessId, businessType: 'WHOLESALE', role: staff[who].role, permissions: {}, branchId, scopeBranchId: branchId, viewAll: false, pinned: false, planFeatures: {}, userId: staff[who].userId, multiOutlet: true, name: 'Sunrise Distributors' });
  const call = async (handler, { who = 'owner', branchId = wh[0], body = {}, params = {}, query = {} } = {}) => {
    const res = fakeRes();
    const tenant = tenantFor(who, branchId);
    await handler({ tenant, auth: { userId: staff[who].userId }, user: { userId: staff[who].userId }, params, body, query, headers: {}, ip: '127.0.0.1', get: () => undefined }, res);
    if (res.code >= 400) throw new Error(`${handler.name || 'handler'} ${res.code}: ${res.body?.message}`);
    return res.body?.data ?? res.body;
  };
  const tryCall = async (...a) => { try { return await call(...a); } catch (e) { return { error: e.message }; } };

  await call(parties.updateSettings, { body: { credit_policy: 'BLOCK', default_payment_terms_days: 30, order_approval_over: 400000, expiry_alert_days: [30, 60, 90], overdue_grace_days: 3, order_prefix: 'SO' } });

  // bins
  for (const [i, w] of wh.entries()) {
    for (const code of ['A-01', 'A-02', 'A-03', 'B-01', 'B-02', 'C-01', 'C-02', 'COLD-1']) await call(inventory.createLocation, { params: { id: w }, body: { code: i === 0 ? code : `S-${code}` } });
    await call(inventory.updateWarehouse, { params: { id: w }, body: { manager_name: i === 0 ? 'Imran Shaikh' : 'Naresh Kumar', phone: i === 0 ? '9848000001' : '9848000002' } });
  }

  // salespeople
  const people = {};
  for (const [key, name, terr, pct, user] of [['north', 'Suresh Reddy', 'Hyderabad North', 0.8, 'sales'], ['south', 'Kiran Babu', 'Hyderabad South & Secunderabad', 1, 'exec'], ['districts', 'Naveen Goud', 'Districts', 1.2, null]]) {
    people[key] = (await call(parties.createSalesperson, { body: { name, territory: terr, commission_pct: pct, commission_on: 'SALES', phone: `98480${int(10000, 99999)}`, user_id: user ? staff[user].userId : undefined } })).salesperson_id;
  }

  // suppliers
  const supplierIds = [];
  for (const [name, gstin, city, state, terms] of SUPPLIERS) {
    supplierIds.push((await call(parties.createSupplier, { who: 'purchase', body: { name, gstin, city, state, payment_terms_days: terms, phone: `98${int(10000000, 99999999)}`, email: `sales@${name.split(' ')[0].toLowerCase()}.example`, contact_person: pick(['Mr Patel', 'Ms Desai', 'Mr Iyer', 'Ms Khan']) } })).supplier_id);
  }

  // categories + products
  const cats = {};
  for (const name of ['Biscuits & Snacks', 'Beverages', 'Staples', 'Personal Care', 'Dairy & Chilled']) cats[name] = (await call(catalog.createCategory, { body: { name } })).category_id;
  const prod = [];
  for (const [name, sku, cat, unit, tax, cost, price, mrp, units, moq, reorder, tracking, sup] of PRODUCTS) {
    const made = await call(catalog.create, { body: { name, sku, barcode: `890${String(prod.length + 1).padStart(10, '0')}`, unit, category_id: cats[cat], hsn_sac: '1905', tax_rate: tax, purchase_price: cost, wholesale_price: price, distributor_price: Math.round(price * 0.96 * 100) / 100, retailer_price: Math.round(price * 1.04 * 100) / 100, mrp,
      moq, reorder_level: reorder, max_stock: reorder * 8, batch_tracking: Boolean(tracking), expiry_tracking: tracking === 'expiry', manufacturer: SUPPLIERS[sup][0].split(' ')[0], units: units.map(([n, f]) => ({ unit_name: n, factor: f })), supplier_id: supplierIds[sup], sale_unit: units[0]?.[0], purchase_unit: units.at(-1)?.[0] } });
    prod.push({ id: made.product_id, name, unit, cost, price, tax, units: Object.fromEntries(units), tracking, sup, moq, opening: PRODUCTS[prod.length][13], cat });
  }
  for (const [i, p] of prod.entries()) await tryCall(inventory.assignBin, { params: { id: p.id }, body: { branch_id: wh[0], location_id: (await pool.query(`SELECT location_id FROM wholesale_locations WHERE branch_id = $1 ORDER BY code OFFSET $2 LIMIT 1`, [wh[0], i % 8])).rows[0].location_id } });

  // price lists
  const rate = await call(catalog.createList, { body: { name: 'Distributor Rate Card', kind: 'STANDARD', customer_type: 'DISTRIBUTOR' } });
  await call(catalog.setItems, { params: { id: rate.list_id }, body: { items: prod.slice(0, 12).flatMap((p) => [{ product_id: p.id, price: Math.round(p.price * 0.94 * 100) / 100 }, ...(Object.keys(p.units).length ? [{ product_id: p.id, unit_name: Object.keys(p.units).at(-1), min_qty: 5, price: Math.round(p.price * 0.92 * p.units[Object.keys(p.units).at(-1)] * 100) / 100 }] : [])]) } });
  const gold = await call(catalog.createList, { body: { name: 'Dealer Gold', kind: 'STANDARD' } });
  await call(catalog.setItems, { params: { id: gold.list_id }, body: { items: [{ category_id: cats['Staples'], discount_pct: 2 }, { category_id: cats['Personal Care'], discount_pct: 3 }] } });
  const festive = await call(catalog.createList, { body: { name: 'Festive Beverages Offer', kind: 'PROMOTION', starts_on: isoDaysAgo(5), ends_on: isoAhead(20) } });
  await call(catalog.setItems, { params: { id: festive.list_id }, body: { items: [{ category_id: cats.Beverages, discount_pct: 5 }] } });

  // customers
  const cust = [];
  for (const [i, [name, type, city, state, terms, limit, disc, opening]] of CUSTOMERS.entries()) {
    const c = await call(parties.createCustomer, { who: 'sales', body: { name, customer_type: type, city, state, payment_terms_days: terms, credit_limit: limit, default_discount_pct: disc, opening_balance: opening, phone: `9${int(100000000, 999999999)}`,
      gstin: i % 3 === 0 ? undefined : `${state === 'Telangana' ? '36' : state === 'Karnataka' ? '29' : '37'}AAAC${String.fromCharCode(65 + i)}${1000 + i}F1Z${i % 9 + 1}`, billing_address: `${int(1, 99)}-${int(1, 20)}, ${pick(['Main Road', 'Market Street', 'Station Road', 'Gandhi Chowk'])}, ${city}`,
      salesperson_id: city.includes('Hyderabad') ? people[i % 2 ? 'north' : 'south'] : people.districts, price_list_id: type === 'DEALER' && i % 2 ? gold.list_id : undefined, contact_person: pick(['Mr Sharma', 'Mrs Rao', 'Mr Khan', 'Mr Naidu', 'Ms Fernandes']) } });
    cust.push({ id: c.customer_id, type, terms, limit, state });
  }
  await call(catalog.setCustomerPrices, { params: { id: cust[3].id }, body: { items: [{ product_id: prod[0].id, unit_name: 'carton', price: 1380 }, { product_id: prod[4].id, price: 30.5 }] } });

  /* ── stock comes in: purchase orders with batches, some partly received, some with damage ── */
  const receive = async (daysAgo, supplierIdx, items, { branch = wh[0], payNow = false, partial = false } = {}) => {
    const po = await call(purchasing.createPO, { who: 'purchase', branchId: branch, body: { supplier_id: supplierIds[supplierIdx], branch_id: branch, items: items.map((it) => ({ product_id: it.p.id, unit_name: it.unit, quantity: it.qty })) } });
    await call(purchasing.approvePO, { who: 'purchase', params: { id: po.po_id } });
    const lines = po.items.map((i, k) => {
      const it = items[k];
      const factor = it.p.units[it.unit] || 1;
      return { po_item_id: i.item_id, received: partial && k === 0 ? Math.max(1, Math.floor(it.qty * 0.6)) : it.qty, damaged: rand() < 0.12 ? 1 : 0,
        batch_no: it.p.tracking ? `${it.p.name.slice(0, 2).toUpperCase()}${isoDaysAgo(daysAgo).slice(5).replace('-', '')}${k}` : undefined,
        mfg_date: it.p.tracking ? isoDaysAgo(daysAgo + 20) : undefined, expiry_date: it.p.tracking === 'expiry' ? isoAhead(it.expiryIn ?? int(90, 200)) : undefined, unit_cost: Math.round(it.p.cost * factor * 100) / 100 };
    });
    const g = await call(purchasing.createGRN, { who: 'warehouse', branchId: branch, body: { po_id: po.po_id, supplier_invoice_no: `INV/${daysAgo}/${supplierIdx}${int(10, 99)}`, supplier_invoice_date: isoDaysAgo(daysAgo), grn_date: isoDaysAgo(daysAgo), items: lines } });
    await pool.query(`UPDATE purchase_orders SET po_date = $2::date, created_at = ($2::date)::timestamptz, due_date = $2::date + COALESCE(payment_terms_days, 30), received_at = ($2::date)::timestamptz WHERE po_id = $1`, [po.po_id, isoDaysAgo(daysAgo)]);
    await pool.query(`UPDATE wholesale_grns SET created_at = ($2::date)::timestamptz WHERE grn_id = $1`, [g.grn_id, isoDaysAgo(daysAgo)]);
    if (payNow) {
      const detail = await call(purchasing.getPO, { params: { id: po.po_id } });
      await tryCall(async (req, res) => (await import('../src/controllers/purchases.controller.js')).addPayment(req, res), { who: 'purchase', params: { id: po.po_id }, body: { amount: Math.round(detail.balance * 0.7), method: 'BANK_TRANSFER', reference_number: `NEFT${int(100000, 999999)}` } });
    }
    return po;
  };
  // stock in two big waves, expiry-tracked goods with short and long dates
  for (const supplierIdx of [0, 1, 2, 3, 4]) {
    const items = prod.filter((p) => p.sup === supplierIdx && p.opening > 0).map((p) => {
      const unit = Object.keys(p.units).at(-1) || p.unit; const factor = p.units[unit] || 1;
      return { p, unit, qty: Math.max(1, Math.round(p.opening / factor)), expiryIn: undefined };
    });
    if (items.length) await receive(40 - supplierIdx * 2, supplierIdx, items, { payNow: supplierIdx % 2 === 0 });
  }
  // a short-dated and an already-expired batch of milk and butter, a part-delivered order
  const milk = prod.find((p) => p.name.includes('Taaza')); const butter = prod.find((p) => p.name.includes('Butter')); const lays = prod.find((p) => p.name.includes('Lays'));
  await receive(12, 4, [{ p: milk, unit: 'crate', qty: 5, expiryIn: 9 }, { p: butter, unit: 'carton', qty: 2, expiryIn: 24 }]);
  await receive(25, 0, [{ p: lays, unit: 'carton', qty: 3, expiryIn: -3 }]).catch(() => null);   // refused: already expired — the system will not take it in
  await call(inventory.adjust, { who: 'warehouse', body: { branch_id: wh[0], product_id: prod.find((p) => p.name.includes('Kurkure')).id, mode: 'ADD', quantity: 24, batch_no: 'OLD-EXP', expiry_date: isoDaysAgo(2), reason: 'Found in old stock' } }).catch(() => null);
  await receive(3, 3, [{ p: prod.find((p) => p.name.includes('Colgate')), unit: 'carton', qty: 4 }, { p: prod.find((p) => p.name.includes('Surf')), unit: 'carton', qty: 6 }], { partial: true });
  // a stocked-up Secunderabad depot via a transfer, and one left in transit
  const move = await call(inventory.createTransfer, { who: 'warehouse', body: { from_branch_id: wh[0], to_branch_id: wh[1], dispatch: true, vehicle_no: 'TS09UA4455', items: prod.slice(4, 12).map((p) => ({ product_id: p.id, quantity: Math.min(60, Math.floor(p.opening / (p.units[Object.keys(p.units).at(-1)] || 1) / 3)) || 2, unit_name: Object.keys(p.units).at(-1) || undefined })) } });
  await call(inventory.receiveTransfer, { who: 'warehouse', branchId: wh[1], params: { id: move.transfer_id }, body: {} });
  await call(inventory.createTransfer, { who: 'warehouse', body: { from_branch_id: wh[0], to_branch_id: wh[1], dispatch: true, vehicle_no: 'TS09UA4455', items: [{ product_id: prod[0].id, quantity: 4, unit_name: 'carton' }] } });
  await call(inventory.adjust, { who: 'warehouse', body: { branch_id: wh[0], product_id: prod[6].id, mode: 'DAMAGE', quantity: 18, reason: 'Pallet collapsed in the godown' } });

  /* ── 45 days of orders ── */
  const dispatchOne = async (c, items, ageDays, opts = {}) => {
    let started = null;
    try { return await dispatchInner(c, items, ageDays, opts, (id) => { started = id; }); } catch (e) {
      // a failed attempt must not leave a confirmed order holding stock
      if (started) await tryCall(orders.cancel, { who: 'sales', params: { id: started }, body: { reason: 'Seed attempt failed' } });
      throw e;
    }
  };
  const dispatchInner = async (c, items, ageDays, { driver = true, deliver = true, payFraction = null, branch = wh[0], who = 'sales' } = {}, onOrder = () => {}) => {
    const o = await call(orders.create, { who, branchId: branch, body: { customer_id: c.id, branch_id: branch, order_date: isoDaysAgo(ageDays), lines: items.map((i) => ({ product_id: i.p.id, unit_name: i.unit, quantity: i.qty })), shipping_charge: rand() < 0.3 ? 150 : 0, shipping_tax_rate: 18, expected_delivery: isoDaysAgo(ageDays - 2) } });
    onOrder(o.order_id);
    await call(orders.confirm, { who: 'sales', params: { id: o.order_id }, body: { credit_override: true, reason: 'Seed data' } });
    const pl = await call(fulfilment.createPick, { who: 'warehouse', branchId: branch, params: { id: o.order_id }, body: {} });
    await call(fulfilment.startPick, { who: 'picker', branchId: branch, params: { id: pl.pick_id } });
    await call(fulfilment.recordPick, { who: 'picker', branchId: branch, params: { id: pl.pick_id }, body: { all: true } });
    await call(fulfilment.pack, { who: 'picker', branchId: branch, params: { id: pl.pick_id }, body: { packages: [{ weight_kg: int(8, 60), items: pl.items.map((i) => ({ pick_item_id: i.pick_item_id, qty_base: i.qty_base })) }] } });
    const d = await call(fulfilment.dispatch, { who: 'warehouse', branchId: branch, params: { id: pl.pick_id }, body: driver ? { driver_name: 'Mahesh Yadav', driver_user_id: staff.driver.userId, vehicle_no: pick(['TS09UB1234', 'TS07UC5521', 'TS10UA9087']), invoice_kind: c.terms === 0 ? 'CASH' : 'TAX' } : {} });
    // move the whole transaction back in time so ageing and trends have a shape
    const date = isoDaysAgo(ageDays);
    await pool.query(`UPDATE wholesale_sales_orders SET created_at = ($2::date)::timestamptz, confirmed_at = ($2::date)::timestamptz WHERE order_id = $1`, [o.order_id, date]);
    await pool.query(`UPDATE invoices SET invoice_date = $2::date, created_at = ($2::date)::timestamptz WHERE invoice_id = $1`, [d.invoice_id, date]);
    await pool.query(`UPDATE wholesale_invoice_meta SET due_date = $2::date + payment_terms_days WHERE invoice_id = $1`, [d.invoice_id, date]);
    await pool.query(`UPDATE wholesale_deliveries SET dispatch_date = $2 WHERE delivery_id = $1`, [d.delivery_id, date]);
    await pool.query(`UPDATE inventory_transactions SET created_at = ($2::date)::timestamptz WHERE reference_type = 'invoice' AND reference_id = $1`, [d.invoice_id, date]);
    if (deliver) {
      await call(fulfilment.setDeliveryStatus, { who: 'driver', params: { id: d.delivery_id }, body: { status: 'OUT_FOR_DELIVERY' } });
      await call(fulfilment.setDeliveryStatus, { who: 'driver', params: { id: d.delivery_id }, body: { status: 'DELIVERED', pod_received_by: pick(['Store manager', 'Owner', 'Godown keeper']), pod_note: 'Received in good condition' } });
    }
    return { ...d, orderId: o.order_id, ageDays, total: Number(d.invoice_total), customer: c };
  };

  const sold = [];
  // heavier orders for distributors, smaller for retailers; the volume grows a little towards today
  for (let age = DAYS; age >= 4; age--) {
    const today = age <= 4;
    const count = int(1, age > 25 ? 2 : 3);
    for (let n = 0; n < count; n++) {
      const c = pick(cust); const big = ['DISTRIBUTOR', 'CORPORATE', 'DEALER'].includes(c.type);
      const lines = []; const used = new Set();
      for (let k = 0; k < int(2, big ? 6 : 4); k++) {
        const p = pick(prod.filter((x) => x.opening > 0));
        if (used.has(p.id)) continue; used.add(p.id);
        const units = Object.keys(p.units);
        const unit = big && units.length ? units.at(-1) : (units.length && rand() < 0.4 ? units[0] : p.unit);
        const factor = p.units[unit] || 1;
        const wanted = Math.max(1, Math.round((p.units[unit] ? 1 : 12) * int(1, big ? 6 : 3) * (unit === p.unit ? int(1, 4) : 1)));
        lines.push({ p, unit, qty: Math.max(wanted, Math.ceil((p.moq || 1) / factor)) });   // never below the minimum order
      }
      try { sold.push(await dispatchOne(c, lines, age, { branch: rand() < 0.25 ? wh[1] : wh[0] })); } catch (e) { if (!/available|reserved|Only|stock|short|batch|expired/i.test(e.message)) throw e; }
    }
  }
  console.log(`  ${sold.length} orders dispatched`);

  /* ── customers pay: most pay on time, a few late, some never ── */
  const byCustomer = new Map();
  for (const s of sold) { if (!byCustomer.has(s.customer.id)) byCustomer.set(s.customer.id, []); byCustomer.get(s.customer.id).push(s); }
  let receipts = 0;
  for (const [customerId, list] of byCustomer) {
    const c = cust.find((x) => x.id === customerId);
    const deadbeat = c === cust[17] || c === cust[2] || c === cust[12];
    const sorted = list.sort((a, b) => b.ageDays - a.ageDays);
    for (const s of sorted) {
      const due = s.ageDays - c.terms;                   // days since it fell due (negative: not yet due)
      const willPay = deadbeat ? rand() < 0.15 : due > 0 ? rand() < 0.88 : rand() < 0.25;
      if (!willPay) continue;
      const payAge = Math.max(0, s.ageDays - c.terms - int(-5, 12));
      const part = rand() < 0.2 ? 0.5 : 1;
      const amount = Math.round(s.total * part);
      if (amount <= 0) continue;
      const method = pick(['UPI', 'BANK_TRANSFER', 'CHEQUE', 'CASH']);
      try {
        const r = await call(money.create, { who: 'accounts', body: { customer_id: customerId, amount, method, reference: method === 'CASH' ? undefined : `${method.slice(0, 3)}${int(100000, 999999)}`, bank: method === 'CHEQUE' ? 'HDFC Bank' : undefined, receipt_date: isoDaysAgo(payAge), allocations: [{ invoice_id: s.invoice_id, amount }] } });
        await pool.query(`UPDATE payments SET payment_date = $2::date, created_at = ($2::date)::timestamptz WHERE receipt_id = $1`, [r.receipt_id, isoDaysAgo(payAge)]);
        await pool.query(`UPDATE wholesale_receipts SET created_at = ($2::date)::timestamptz WHERE receipt_id = $1`, [r.receipt_id, isoDaysAgo(payAge)]);
        receipts++;
      } catch { /* an amount above the balance after earlier part-payments: skip */ }
    }
  }
  // one advance payment, one bounced cheque
  const adv = await call(money.create, { who: 'accounts', body: { customer_id: cust[7].id, amount: 75000, method: 'BANK_TRANSFER', reference: 'RTGS884411', allocate: 'NONE', notes: 'Advance against the festive stock' } });
  const bounce = await call(money.create, { who: 'accounts', body: { customer_id: cust[4].id, amount: 12000, method: 'CHEQUE', reference: '557891', bank: 'SBI' } });
  await call(money.reverse, { who: 'accounts', params: { id: bounce.receipt_id }, body: { reason: 'Cheque bounced: insufficient funds' } });
  console.log(`  ${receipts + 2} receipts`);

  /* ── returns ── */
  const recent = sold.filter((s) => s.ageDays < 30 && s.ageDays > 5).slice(0, 6);
  for (const [i, s] of recent.entries()) {
    if (i > 2) break;
    const opts = await call(returns.returnableLines, { params: { id: s.invoice_id } });
    const line = opts.items.find((x) => x.returnable > 0);
    if (!line) continue;
    await tryCall(returns.salesReturn, { who: 'sales', body: { invoice_id: s.invoice_id, reason: i === 0 ? 'DAMAGED' : i === 1 ? 'WRONG_PRODUCT' : 'EXCESS_QUANTITY', items: [{ invoice_item_id: line.item_id, quantity: Math.max(1, Math.min(line.returnable, 1)), disposition: i === 0 ? 'DAMAGED' : 'RESTOCK', batch_id: line.batches[0]?.batch_id }] } });
  }
  const pos = (await call(purchasing.listPOs, { who: 'purchase', query: { status: 'RECEIVED', limit: '5' } }));
  if (pos[0]) { const d = await call(purchasing.getPO, { who: 'purchase', params: { id: pos[0].po_id } }); await tryCall(returns.purchaseReturn, { who: 'purchase', body: { po_id: pos[0].po_id, reason: 'QUALITY', notes: 'Packets torn on delivery', items: [{ po_item_id: d.items[0].item_id, quantity: 1 }] } }); }

  /* ── the live floor today: things in every stage ── */
  const cheap = (n) => prod.filter((p) => p.opening > 0)[n];
  // history ends here: whatever is still waiting on a back-order is written off so it does not hold today's stock
  const stale = (await pool.query(`SELECT o.order_id, EXISTS (SELECT 1 FROM wholesale_sales_order_items i WHERE i.order_id = o.order_id AND i.shipped_base > 0) AS shipped
      FROM wholesale_sales_orders o WHERE o.business_id = $1 AND o.status IN ('CONFIRMED', 'PARTIALLY_FULFILLED', 'BACKORDERED', 'RESERVED')`, [businessId])).rows;
  for (const r of stale) await tryCall(r.shipped ? orders.close : orders.cancel, { who: 'sales', params: { id: r.order_id }, body: { reason: 'Customer no longer needed the balance' } });
  // the floor needs goods to pick: a fresh delivery of everything the live orders use
  await receive(1, 0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => { const p = cheap(n); const unit = Object.keys(p.units).at(-1) || p.unit; return { p, unit, qty: Math.max(8, Math.ceil(120 / (p.units[unit] || 1))) }; }));
  const live = [cust[0], cust[3], cust[6], cust[9], cust[10], cust[11], cust[14]];
  // out for delivery
  await dispatchOne(live[0], [{ p: cheap(2), unit: Object.keys(cheap(2).units).at(-1), qty: 1 }, { p: cheap(5), unit: Object.keys(cheap(5).units)[0], qty: 2 }], 0, { deliver: false });
  const out = await dispatchOne(live[1], [{ p: cheap(1), unit: Object.keys(cheap(1).units).at(-1), qty: 2 }], 0, { deliver: false });
  await call(fulfilment.setDeliveryStatus, { who: 'driver', params: { id: out.delivery_id }, body: { status: 'OUT_FOR_DELIVERY' } });
  // a failed delivery
  const failed = await dispatchOne(live[2], [{ p: cheap(7), unit: Object.keys(cheap(7).units).at(-1), qty: 1 }], 1, { deliver: false });
  await call(fulfilment.setDeliveryStatus, { who: 'driver', params: { id: failed.delivery_id }, body: { status: 'OUT_FOR_DELIVERY' } });
  await call(fulfilment.setDeliveryStatus, { who: 'driver', params: { id: failed.delivery_id }, body: { status: 'FAILED', failure_reason: 'Shop was closed, customer not reachable' } });
  // packed and waiting for a van; being picked; to pick; confirmed with a back-order; pending approval; draft
  const mk = async (c, items, extra = {}) => call(orders.create, { who: 'sales', body: { customer_id: c.id, lines: items.map((i) => ({ product_id: i.p.id, unit_name: i.unit, quantity: i.qty })), ...extra } });
  const packed = await mk(live[3], [{ p: cheap(8), unit: Object.keys(cheap(8).units)[0], qty: 3 }]);
  await call(orders.confirm, { who: 'sales', params: { id: packed.order_id }, body: { credit_override: true, reason: 'Seed' } });
  const pp = await call(fulfilment.createPick, { who: 'warehouse', params: { id: packed.order_id }, body: {} });
  await call(fulfilment.recordPick, { who: 'picker', params: { id: pp.pick_id }, body: { all: true } }); await call(fulfilment.pack, { who: 'picker', params: { id: pp.pick_id }, body: {} });
  const picking = await mk(live[4], [{ p: cheap(3), unit: Object.keys(cheap(3).units)[0], qty: 2 }]);
  await call(orders.confirm, { who: 'sales', params: { id: picking.order_id }, body: { credit_override: true, reason: 'Seed' } });
  const pk = await call(fulfilment.createPick, { who: 'warehouse', params: { id: picking.order_id }, body: {} }); await call(fulfilment.startPick, { who: 'picker', params: { id: pk.pick_id } });
  const topick = await mk(live[5], [{ p: cheap(9), unit: Object.keys(cheap(9).units)[0], qty: 2 }, { p: cheap(10), unit: Object.keys(cheap(10).units)[0], qty: 1 }]);
  await call(orders.confirm, { who: 'sales', params: { id: topick.order_id }, body: { credit_override: true, reason: 'Seed' } });
  const backordered = await mk(live[6], [{ p: prod[19], unit: 'box', qty: 10 }, { p: cheap(0), unit: 'carton', qty: 2 }]);   // Britannia Cake is out of stock
  await call(orders.confirm, { who: 'sales', params: { id: backordered.order_id }, body: { credit_override: true, reason: 'Seed' } });
  await mk(cust[7], [{ p: cheap(0), unit: 'carton', qty: 60 }, { p: cheap(4), unit: 'crate', qty: 40 }], { submit: true });      // over the approval limit
  await mk(cust[1], [{ p: cheap(6), unit: 'case', qty: 5 }]);                                                                        // a draft

  // the planted credit problem: Crescent Traders is far over a ₹20,000 limit
  await pool.query(`UPDATE wholesale_customer_profiles SET opening_balance_paise = 3400000 WHERE customer_id = $1`, [cust[17].id]);

  const totals = (await pool.query(`SELECT (SELECT COUNT(*) FROM invoices WHERE business_id = $1) AS invoices, (SELECT COUNT(*) FROM wholesale_sales_orders WHERE business_id = $1) AS orders, (SELECT COUNT(*) FROM products WHERE business_id = $1) AS products,
    (SELECT COUNT(*) FROM customers WHERE business_id = $1) AS customers`, [businessId])).rows[0];
  console.log(`\nDemo wholesaler ready: ${totals.products} products, ${totals.customers} customers, ${totals.orders} orders, ${totals.invoices} invoices.`);
  console.log('Sign in: wholesale@flowxp.test / demo1234  (wholesale-sales@, -exec@, -warehouse@, -picker@, -purchase@, -accounts@, -driver@ use the same password)');
  await pool.end();
};

main().catch(async (error) => { console.error(error); await pool.end().catch(() => {}); process.exit(1); });
