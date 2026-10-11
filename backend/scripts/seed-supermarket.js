/*
 * Demo supermarket: "Fresh Basket Supermarket", two stores in Pune, with 30 days of realistic trading.
 *
 *   npm run seed:supermarket        (re-running replaces the demo supermarket)
 *
 * About fifty grocery lines across dairy, bakery, staples, snacks, drinks, fruit and vegetables, household and personal care, each with a
 * brand, barcode, MRP, selling price, cost and the right GST rate. Dairy and bakery carry expiry dates, in batches that sell soonest-expiry
 * first. Loose fruit and vegetables are sold by the kilo. Three offers (3 milk packets for one price, buy 1 get 1 on bread, any 2 biscuits
 * for one price), one stock count already applied, and every sale goes through the real billing engine, so stock, cost and GST are genuine.
 *
 * Sign in: supermarket@flowxp.test / demo1234   (staff: supermarket-manager@, supermarket-cashier1@ and supermarket-cashier2@, same password)
 */
import './no-production.js'; // loads .env, and stops here in production
import bcrypt from 'bcryptjs';
import pool, { initializeDatabase } from '../src/config/database.js';
import { createInvoiceInTransaction } from '../src/modules/billing.js';
import { moveStock } from '../src/modules/stock.js';
import { addToBatch } from '../src/modules/wholesale/stock.js';
import { applyCount, createCount, recordCounts } from '../src/modules/retailStock.js';

const DAYS = 30;
const PASSWORD = 'demo1234';
const mulberry32 = (seed) => () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rand = mulberry32(20261011);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const weighted = (entries) => { const total = entries.reduce((s, [, w]) => s + w, 0); let r = rand() * total; for (const [v, w] of entries) { r -= w; if (r <= 0) return v; } return entries[entries.length - 1][0]; };
const rupees = (n) => Math.round(n * 100);

const CATEGORIES = ['Dairy', 'Bakery', 'Staples', 'Snacks', 'Drinks', 'Fruit & Veg', 'Household', 'Personal Care'];
const PREFIX = { Dairy: 'DAIR', Bakery: 'BAKE', Staples: 'STAP', Snacks: 'SNAC', Drinks: 'DRIN', 'Fruit & Veg': 'VEGE', Household: 'HOUS', 'Personal Care': 'PERS' };
// name, category, brand, unit, MRP ₹, selling ₹, cost ₹, GST %, popularity, shelf life in days (null = no expiry tracking), opening stock
const ITEMS = [
  ['Amul Taaza Milk 1L', 'Dairy', 'Amul', 'pc', 56, 54, 49, 0, 16, 4, 140], ['Amul Gold Milk 500ml', 'Dairy', 'Amul', 'pc', 36, 35, 31.5, 0, 9, 4, 90], ['Nandini Milk 500ml', 'Dairy', 'Nandini', 'pc', 27, 25, 22.5, 0, 8, 4, 90],
  ['Amul Butter 100g', 'Dairy', 'Amul', 'pc', 58, 58, 51, 12, 8, 120, 80], ['Amul Cheese Slices 200g', 'Dairy', 'Amul', 'pc', 140, 135, 118, 12, 4, 150, 40], ['Mother Dairy Curd 400g', 'Dairy', 'Mother Dairy', 'pc', 40, 38, 33, 0, 9, 9, 70],
  ['Epigamia Greek Yogurt 90g', 'Dairy', 'Epigamia', 'pc', 45, 42, 35, 12, 3, 25, 36], ['Amul Paneer 200g', 'Dairy', 'Amul', 'pc', 95, 90, 78, 0, 5, 12, 40],
  ['Britannia Bread 400g', 'Bakery', 'Britannia', 'pc', 45, 45, 38, 0, 14, 4, 90], ['Harvest Gold Brown Bread 400g', 'Bakery', 'Harvest Gold', 'pc', 55, 52, 44, 0, 6, 4, 50], ['Britannia Pav 8 pcs', 'Bakery', 'Britannia', 'pc', 30, 28, 23, 0, 6, 3, 50], ['Modern Burger Buns 4 pcs', 'Bakery', 'Modern', 'pc', 40, 38, 31, 0, 3, 4, 30],
  ['Aashirvaad Atta 5kg', 'Staples', 'Aashirvaad', 'pc', 295, 279, 252, 0, 7, null, 60], ['Tata Salt 1kg', 'Staples', 'Tata', 'pc', 28, 27, 22, 0, 8, null, 90], ['Fortune Sunflower Oil 1L', 'Staples', 'Fortune', 'pc', 165, 152, 138, 5, 8, null, 70],
  ['India Gate Basmati Rice 1kg', 'Staples', 'India Gate', 'pc', 135, 125, 108, 5, 6, null, 60], ['Toor Dal 1kg', 'Staples', 'Tata Sampann', 'pc', 190, 172, 150, 0, 5, null, 50], ['Sugar 1kg', 'Staples', 'Madhur', 'pc', 52, 48, 42, 0, 9, null, 90],
  ['Tata Tea Gold 250g', 'Staples', 'Tata', 'pc', 155, 142, 124, 5, 5, null, 50], ['Nescafe Classic 50g', 'Staples', 'Nescafe', 'pc', 175, 165, 140, 12, 3, null, 30], ['MDH Garam Masala 100g', 'Staples', 'MDH', 'pc', 88, 82, 68, 5, 3, null, 40],
  ['Parle-G Biscuits 200g', 'Snacks', 'Parle', 'pc', 22, 20, 16.5, 18, 14, null, 150], ['Britannia Good Day Cashew 200g', 'Snacks', 'Britannia', 'pc', 40, 38, 31, 18, 7, null, 80], ['Oreo Biscuits 120g', 'Snacks', 'Cadbury', 'pc', 40, 38, 31, 18, 7, null, 70],
  ["Lay's Classic Salted 52g", 'Snacks', "Lay's", 'pc', 20, 20, 15.5, 12, 12, null, 130], ['Kurkure Masala Munch 90g', 'Snacks', 'Kurkure', 'pc', 20, 20, 15.5, 12, 10, null, 110], ['Maggi 2-Minute Noodles 280g', 'Snacks', 'Maggi', 'pc', 62, 58, 48, 12, 10, 240, 100],
  ['Dairy Milk Silk 60g', 'Snacks', 'Cadbury', 'pc', 80, 76, 62, 18, 5, 200, 60], ['Haldiram Bhujia 200g', 'Snacks', 'Haldiram', 'pc', 60, 56, 44, 12, 5, 150, 60],
  ['Coca-Cola 750ml', 'Drinks', 'Coca-Cola', 'pc', 40, 38, 30, 28, 9, null, 90], ['Thums Up 750ml', 'Drinks', 'Coca-Cola', 'pc', 40, 38, 30, 28, 7, null, 80], ['Real Fruit Juice Mango 1L', 'Drinks', 'Real', 'pc', 115, 105, 86, 12, 4, 270, 45],
  ['Bisleri Water 1L', 'Drinks', 'Bisleri', 'pc', 20, 20, 14, 18, 14, null, 200], ['Red Bull 250ml', 'Drinks', 'Red Bull', 'pc', 125, 120, 98, 28, 2, null, 30],
  ['Onions (kg)', 'Fruit & Veg', null, 'kg', 40, 40, 28, 0, 12, null, 180], ['Tomatoes (kg)', 'Fruit & Veg', null, 'kg', 35, 35, 24, 0, 10, null, 120], ['Potatoes (kg)', 'Fruit & Veg', null, 'kg', 32, 32, 22, 0, 10, null, 160],
  ['Bananas (kg)', 'Fruit & Veg', null, 'kg', 60, 58, 42, 0, 8, null, 90], ['Apples Shimla (kg)', 'Fruit & Veg', null, 'kg', 180, 170, 138, 0, 4, null, 50], ['Coriander Bunch', 'Fruit & Veg', null, 'pc', 15, 15, 9, 0, 6, null, 60],
  ['Surf Excel Matic 1kg', 'Household', 'Surf Excel', 'pc', 245, 228, 190, 18, 4, null, 40], ['Vim Dishwash Gel 500ml', 'Household', 'Vim', 'pc', 105, 98, 78, 18, 4, null, 40], ['Harpic Toilet Cleaner 500ml', 'Household', 'Harpic', 'pc', 98, 92, 74, 18, 3, null, 36],
  ['Colgate Strong Teeth 200g', 'Personal Care', 'Colgate', 'pc', 118, 110, 90, 18, 6, null, 60], ['Dove Soap 3 x 100g', 'Personal Care', 'Dove', 'pc', 255, 235, 195, 18, 4, null, 40], ['Head & Shoulders Shampoo 340ml', 'Personal Care', 'Head & Shoulders', 'pc', 365, 335, 275, 18, 3, null, 30],
  ['Dettol Handwash 200ml', 'Personal Care', 'Dettol', 'pc', 99, 92, 74, 18, 3, null, 36], ['Whisper Ultra 15 pads', 'Personal Care', 'Whisper', 'pc', 180, 172, 140, 12, 3, null, 30]
];
const THIN = new Set(['Amul Taaza Milk 1L', 'Amul Gold Milk 500ml', 'Nandini Milk 500ml', 'Aashirvaad Atta 5kg', 'Sugar 1kg', 'Bisleri Water 1L', 'Tata Salt 1kg', 'Britannia Bread 400g']);
const CUSTOMERS = ['Meenal Kulkarni', 'Prasad Joshi', 'Sneha Deshpande', 'Omkar Patil', 'Rutuja Gokhale', 'Amit Bhosale', 'Kavita Naik', 'Sandeep Pawar', 'Pooja Shinde', 'Nikhil Kadam', 'Vaishali More', 'Rahul Jagtap', 'Anjali Thakur', 'Yash Chavan', 'Swati Apte', 'Harshad Bapat', 'Mrunal Phadke', 'Tejas Salvi', 'Neha Wagh', 'Suresh Gaikwad', 'Priyanka Rane', 'Girish Kelkar', 'Madhuri Oak', 'Vikrant Sathe'];

const dayAt = (daysAgo, hour, minute) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hour, minute, int(0, 59), 0); return d; };
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inDays = (n) => isoDate(new Date(Date.now() + n * 86400000));

const main = async () => {
  await initializeDatabase();
  for (const { business_id } of (await pool.query(`SELECT business_id FROM businesses WHERE business_type IN ('SUPERMARKET','RETAIL') AND owner_user_id IN (SELECT user_id FROM users WHERE email = 'supermarket@flowxp.test')`)).rows) await pool.query('DELETE FROM businesses WHERE business_id = $1', [business_id]);
  await pool.query(`DELETE FROM users WHERE email LIKE 'supermarket%@flowxp.test'`);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const staff = {};
  for (const [key, email, name, role] of [['owner', 'supermarket@flowxp.test', 'Meera Kapoor', 'OWNER'], ['manager', 'supermarket-manager@flowxp.test', 'Sanjay Kulkarni', 'MANAGER'], ['cashier1', 'supermarket-cashier1@flowxp.test', 'Rekha Pawar', 'CASHIER'], ['cashier2', 'supermarket-cashier2@flowxp.test', 'Imran Shaikh', 'CASHIER']]) {
    staff[key] = { userId: (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ($1,$2,$3,TRUE) RETURNING user_id`, [name, email, hash])).rows[0].user_id, role };
  }
  const businessId = (await pool.query(
    `INSERT INTO businesses (name, business_type, owner_user_id, email, phone, address, city, state, gstin, gst_enabled, subscription_status, plan_code, billing_cycle, onboarding_step, upi_vpa)
     VALUES ('Fresh Basket Supermarket','SUPERMARKET',$1,'supermarket@flowxp.test','9822011111','Shop 4, Baner Road','Pune','Maharashtra','27AABCF4321D1Z9',TRUE,'ACTIVE','ENTERPRISE','MONTHLY',10,'freshbasket@okicici') RETURNING business_id`,
    [staff.owner.userId])).rows[0].business_id;
  const outlets = [];
  for (const [name, code, primary, share] of [['Baner', 'BAN', true, 0.6], ['Kothrud', 'KOT', false, 0.4]]) {
    const id = (await pool.query(`INSERT INTO branches (business_id, name, code, city, state, is_primary) VALUES ($1,$2,$3,'Pune','Maharashtra',$4) RETURNING branch_id`, [businessId, name, code, primary])).rows[0].branch_id;
    outlets.push({ id, name, share, tenant: { businessId, branchId: id } });
  }
  const pinned = { cashier1: outlets[0].id, cashier2: outlets[1].id };
  for (const [key, s] of Object.entries(staff)) await pool.query(`INSERT INTO business_users (business_id, user_id, role, branch_id) VALUES ($1,$2,$3,$4)`, [businessId, s.userId, s.role, pinned[key] ?? null]);
  await pool.query(`INSERT INTO retail_settings (business_id, auto_sku, require_barcode) VALUES ($1,TRUE,FALSE) ON CONFLICT (business_id) DO NOTHING`, [businessId]);

  const categoryIds = {};
  for (const name of CATEGORIES) categoryIds[name] = (await pool.query(`INSERT INTO categories (business_id, name) VALUES ($1,$2) RETURNING category_id`, [businessId, name])).rows[0].category_id;
  const brandIds = {};
  for (const name of new Set(ITEMS.map((i) => i[2]).filter(Boolean))) brandIds[name] = (await pool.query(`INSERT INTO brands (business_id, name) VALUES ($1,$2) RETURNING brand_id`, [businessId, name])).rows[0].brand_id;
  const supplierIds = [];
  for (const name of ['Pune Dairy Distributors', 'Shree Gajanan Traders', 'Metro Wholesale Mart']) supplierIds.push((await pool.query(`INSERT INTO suppliers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING supplier_id`, [businessId, name, `98${int(10000000, 99999999)}`])).rows[0].supplier_id);

  const openingAt = dayAt(DAYS + 1, 8, 0);
  const counters = {};
  const products = [];
  for (const [i, [name, category, brand, unit, mrp, price, cost0, tax, popularity, shelf, stock]] of ITEMS.entries()) {
    // everyday essentials keep their thin margins; the rest earn 26 to 34%
    const cost = THIN.has(name) ? cost0 : Math.round(price * (0.66 + (i % 5) * 0.02) * 2) / 2;
    counters[category] = (counters[category] || 0) + 1;
    const sku = `${PREFIX[category]}-${String(counters[category]).padStart(5, '0')}`;
    const loose = category === 'Fruit & Veg' && unit === 'kg';
    const supplier = category === 'Dairy' || category === 'Bakery' ? supplierIds[0] : category === 'Fruit & Veg' ? supplierIds[1] : supplierIds[2];
    const id = (await pool.query(
      `INSERT INTO products (business_id, category_id, supplier_id, brand_id, name, kind, unit, sku, barcode, selling_price_paise, purchase_price_paise, mrp_paise, tax_rate, hsn_sac, track_inventory, track_expiry, current_stock, min_stock)
       VALUES ($1,$2,$3,$4,$5,'DISH',$6,$7,$8,$9,$10,$11,$12,$13,TRUE,$14,0,$15) RETURNING product_id`,
      [businessId, categoryIds[category], supplier, brand ? brandIds[brand] : null, name, unit, sku, loose || unit === 'kg' ? null : `8901${String(100000000 + i * 7919).slice(0, 9)}`, rupees(price), rupees(cost), rupees(mrp), tax, String(1000 + i * 11).slice(0, 4), shelf != null, Math.max(4, Math.round(stock * 0.25))])).rows[0].product_id;
    const parts = outlets.map((o) => Math.round(stock * o.share));
    for (const [oi, o] of outlets.entries()) {
      await moveStock(pool, { businessId, branchId: o.id, productId: id, delta: parts[oi] });
      await pool.query(`INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, created_by, created_at) VALUES ($1,$2,$3,'OPENING',$4,'manual',$5,$6)`, [businessId, o.id, id, parts[oi], staff.owner.userId, openingAt]);
      if (shelf != null) {
        // two or three batches, the oldest soonest to expire; fresh dairy and bread are short-dated, packed food runs to months
        const cuts = shelf <= 12 ? [Math.max(1, Math.round(shelf * 0.3)), Math.round(shelf * 0.65), shelf] : [Math.round(shelf * 0.25), Math.round(shelf * 0.6), shelf];
        const split = [0.35, 0.4, 0.25].map((f) => Math.round(parts[oi] * f)); split[2] = parts[oi] - split[0] - split[1];
        for (const [bi, days] of cuts.entries()) if (split[bi] > 0) await addToBatch(pool, { businessId, branchId: o.id, productId: id, batchNo: `B${isoDate(new Date(Date.now() + days * 86400000)).replaceAll('-', '').slice(2)}`, expiryDate: inDays(days), qty: split[bi], costPaise: rupees(cost), source: 'GRN' });
      }
    }
    products.push({ id, name, category, popularity, unit, loose, price, stock, shelf, cost, i });
  }

  const customerIds = [];
  for (const name of CUSTOMERS) customerIds.push((await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [businessId, name, `9${int(600000000, 999999999)}`])).rows[0].customer_id);

  // three offers the till applies by itself
  const by = (name) => products.find((p) => p.name === name).id;
  await pool.query(`INSERT INTO promotions (business_id, name, kind, product_id, bundle_qty, bundle_price_paise, created_by) VALUES ($1,'Amul Taaza Milk: 3 for ₹150','BUNDLE_PRICE',$2,3,$3,$4)`, [businessId, by('Amul Taaza Milk 1L'), rupees(150), staff.owner.userId]);
  await pool.query(`INSERT INTO promotions (business_id, name, kind, product_id, buy_qty, get_qty, created_by) VALUES ($1,'Britannia Bread: buy 1 get 1 free','BUY_X_GET_Y',$2,1,1,$3)`, [businessId, by('Britannia Bread 400g'), staff.owner.userId]);
  const mix = (await pool.query(`INSERT INTO promotions (business_id, name, kind, bundle_qty, bundle_price_paise, created_by) VALUES ($1,'Any 2 biscuits for ₹70','MIX_BUNDLE',2,$2,$3) RETURNING promo_id`, [businessId, rupees(70), staff.owner.userId])).rows[0].promo_id;
  for (const n of ['Parle-G Biscuits 200g', 'Britannia Good Day Cashew 200g', 'Oreo Biscuits 120g']) await pool.query(`INSERT INTO promotion_products (promo_id, product_id) VALUES ($1,$2)`, [mix, by(n)]);

  // the days: busy mornings and evenings, weekends busier, month-start bigger baskets
  const HOURS = [[8, 6], [9, 9], [10, 8], [11, 6], [12, 5], [13, 4], [14, 3], [15, 4], [16, 6], [17, 9], [18, 12], [19, 11], [20, 7], [21, 3]];
  let bills = 0;
  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo--) {
    const dow = new Date(Date.now() - daysAgo * 86400000).getDay();
    const base = dow === 0 || dow === 6 ? 95 : 65;
    const count = Math.round(base * (0.85 + rand() * 0.3) * (daysAgo === 0 ? 0.5 : 1));
    for (let n = 0; n < count; n++) {
      const hour = weighted(HOURS);
      if (daysAgo === 0 && hour > new Date().getHours()) continue;
      const at = dayAt(daysAgo, hour, int(0, 59));
      const outlet = rand() < outlets[0].share ? outlets[0] : outlets[1];
      const seller = outlet === outlets[0] ? staff.cashier1.userId : staff.cashier2.userId;
      const items = []; const used = new Set();
      for (let l = weighted([[2, 5], [3, 6], [4, 5], [6, 3], [8, 1]]); l > 0; l--) {
        const p = weighted(products.map((x) => [x, x.popularity]));
        if (used.has(p.id)) continue;
        used.add(p.id);
        items.push({ product_id: p.id, quantity: p.loose ? weighted([[0.5, 4], [1, 5], [1.5, 2], [2, 2]]) : weighted([[1, 9], [2, 4], [3, 1]]) });
      }
      if (!items.length) continue;
      const method = weighted([['UPI', 52], ['CASH', 28], ['CARD', 20]]);
      const client = await pool.connect();
      let invoice;
      try {
        await client.query('BEGIN');
        invoice = await createInvoiceInTransaction(client, outlet.tenant, seller, {
          customerId: rand() < 0.35 ? pick(customerIds) : undefined, items, invoiceDate: isoDate(at), applyPromotions: true, allowNegativeStock: true, payment: { method, amount: 0 }
        });
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
      if (invoice.total > 0) {
        await pool.query(`INSERT INTO payments (business_id, branch_id, invoice_id, customer_id, payment_method, amount_paise, payment_date, created_by, created_at) SELECT business_id, branch_id, invoice_id, customer_id, $2, total_paise, $3::date, $4, $5 FROM invoices WHERE invoice_id = $1`, [invoice.invoice_id, method, isoDate(at), seller, at]);
        await pool.query(`UPDATE invoices SET amount_paid_paise = total_paise, balance_due_paise = 0, payment_status = 'PAID' WHERE invoice_id = $1`, [invoice.invoice_id]);
      }
      await pool.query(`UPDATE invoices SET created_at = $2 WHERE invoice_id = $1`, [invoice.invoice_id, at]);
      await pool.query(`UPDATE inventory_transactions SET created_at = $2 WHERE reference_type = 'invoice' AND reference_id = $1`, [invoice.invoice_id, at]);
      bills++;
    }
  }

  // yesterday's deliveries bring every shelf back to a normal level (a milk line is out and one drink is running low, so the stock screens have something to show),
  // each in fresh batches: short-dated dairy and bread, months for packed food
  await pool.query(`DELETE FROM wholesale_batch_moves WHERE business_id = $1`, [businessId]);
  await pool.query(`DELETE FROM wholesale_batches WHERE business_id = $1`, [businessId]);
  const restockAt = dayAt(1, 17, 30);
  for (const p of products) {
    for (const o of outlets) {
      const target = p.name === 'Nandini Milk 500ml' ? 0 : p.name === 'Red Bull 250ml' ? 4 : Math.round(p.stock * o.share * (0.45 + rand() * 0.5));
      const now = Number((await pool.query(`SELECT COALESCE(quantity, 0) AS q FROM branch_stock WHERE product_id = $1 AND branch_id = $2`, [p.id, o.id])).rows[0]?.q ?? 0);
      const delta = Math.round((target - now) * 1000) / 1000;
      if (delta !== 0) {
        await moveStock(pool, { businessId, branchId: o.id, productId: p.id, delta });
        await pool.query(`INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, created_by, created_at) VALUES ($1,$2,$3,$4,$5,'manual',$6,$7)`, [businessId, o.id, p.id, delta > 0 ? 'PURCHASE' : 'ADJUSTMENT', delta, staff.manager.userId, restockAt]);
      }
      if (p.shelf != null && target > 0) {
        const cuts = p.shelf <= 12 ? [Math.max(1, Math.round(p.shelf * 0.3)), Math.round(p.shelf * 0.65), p.shelf] : [Math.round(p.shelf * 0.25), Math.round(p.shelf * 0.6), p.shelf];
        const split = [0.35, 0.4, 0.25].map((f) => Math.round(target * f)); split[2] = target - split[0] - split[1];
        for (const [bi, days] of cuts.entries()) if (split[bi] > 0) await addToBatch(pool, { businessId, branchId: o.id, productId: p.id, batchNo: `B${isoDate(new Date(Date.now() + days * 86400000)).replaceAll('-', '').slice(2)}`, expiryDate: inDays(days), qty: split[bi], costPaise: rupees(p.cost), source: 'GRN' });
      }
    }
  }

  // one shelf count, already applied: the dairy shelf was two packets short on a few lines
  const tenant = outlets[0].tenant;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const count = await createCount(client, { tenant, userId: staff.manager.userId, name: 'Dairy shelf, last Sunday', categoryId: categoryIds.Dairy });
    const dairy = (await client.query(`SELECT p.product_id, COALESCE(bs.quantity, 0) AS qty FROM products p LEFT JOIN branch_stock bs ON bs.product_id = p.product_id AND bs.branch_id = $2 WHERE p.business_id = $1 AND p.category_id = $3 ORDER BY p.name`, [businessId, tenant.branchId, categoryIds.Dairy])).rows;
    await recordCounts(client, { tenant, userId: staff.manager.userId, countId: count.count_id, entries: dairy.map((d, i) => ({ product_id: d.product_id, counted: Math.max(0, Number(d.qty) - (i % 3 === 1 ? 2 : i % 5 === 2 ? 1 : 0)) })) });
    await applyCount(client, { tenant, userId: staff.manager.userId, countId: count.count_id });
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); console.log('stock count skipped:', error.message); } finally { client.release(); }

  console.log(`seeded Fresh Basket Supermarket: ${bills} bills over ${DAYS} days, ${products.length} products, 2 stores. Sign in: supermarket@flowxp.test / ${PASSWORD}`);
  await pool.end();
};

main().catch((error) => { console.error(error); process.exit(1); });
