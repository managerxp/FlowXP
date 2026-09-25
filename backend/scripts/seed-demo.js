/*
 * Demo restaurant: "FlowXP Demo Restaurant", with 60 days of realistic trading.
 *
 *   npm run seed:demo        (re-running replaces the demo restaurant)
 *
 * Every sale goes through the real billing engine, so stock consumption, cost
 * snapshots and GST are genuine rather than inserted numbers. The history is
 * deterministic (seeded RNG) and contains a few planted patterns the later
 * intelligence work is meant to find:
 *   - chicken's purchase price rising ~12% over the last month
 *   - one cashier (Ravi) giving unusually large discounts in the last 3 weeks
 *   - tomato wastage climbing in the last 14 days
 *   - weekend demand well above weekdays, dinner above lunch
 *
 * Three outlets (MG Road ~55% of sales, Indiranagar ~30%, Koramangala ~15%) with their own tables, stock,
 * cashiers and purchases; Indiranagar charges a little more for Chicken Biryani.
 *
 * Sign in: demo@flowxp.test / demo1234   (staff: demo-manager@ etc., same password)
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pool, { initializeDatabase } from '../src/config/database.js';
import { createInvoiceInTransaction } from '../src/modules/billing.js';
import * as purchases from '../src/controllers/purchases.controller.js';
import * as invoices from '../src/controllers/invoices.controller.js';
import { moveStock } from '../src/modules/stock.js';

const DAYS = 60;
const PASSWORD = 'demo1234';

/* ── deterministic randomness ─────────────────────────────────────────────── */
const mulberry32 = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const rand = mulberry32(20260924);
const between = (a, b) => a + rand() * (b - a);
const int = (a, b) => Math.floor(between(a, b + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const weighted = (entries) => {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, w] of entries) { r -= w; if (r <= 0) return value; }
  return entries[entries.length - 1][0];
};

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const rupees = (n) => Math.round(n * 100);

/* ── the menu ─────────────────────────────────────────────────────────────── */
// name, unit, cost ₹/unit, opening stock, reorder-at, supplier
const INGREDIENTS = [
  ['Basmati Rice', 'kg', 90, 120, 30, 'Royal Grains & Spices'],
  ['Chicken', 'kg', 220, 60, 20, 'Halal Meats Co'],
  ['Mutton', 'kg', 680, 25, 8, 'Halal Meats Co'],
  ['Paneer', 'kg', 320, 25, 8, 'Dairy Delight'],
  ['Onion', 'kg', 35, 80, 25, 'Fresh Farms Produce'],
  ['Tomato', 'kg', 30, 60, 20, 'Fresh Farms Produce'],
  ['Potato', 'kg', 25, 40, 10, 'Fresh Farms Produce'],
  ['Cooking Oil', 'litre', 140, 50, 15, 'Royal Grains & Spices'],
  ['Ghee', 'kg', 550, 12, 4, 'Dairy Delight'],
  ['Curd', 'kg', 60, 30, 10, 'Dairy Delight'],
  ['Spice Mix', 'kg', 400, 10, 3, 'Royal Grains & Spices'],
  ['Maida', 'kg', 40, 50, 15, 'Royal Grains & Spices'],
  ['Butter', 'kg', 480, 12, 4, 'Dairy Delight'],
  ['Cream', 'litre', 220, 12, 4, 'Dairy Delight'],
  ['Lentils', 'kg', 120, 30, 10, 'Royal Grains & Spices'],
  ['Cheese', 'kg', 420, 8, 3, 'Dairy Delight'],
  ['Eggs', 'pc', 7, 240, 60, 'Fresh Farms Produce'],
  ['Herbs', 'kg', 80, 8, 3, 'Fresh Farms Produce']
];
const PACKAGING = [['Takeaway Box', 'pc', 8, 600, 150, 'Royal Grains & Spices']];

// name, category, price ₹, popularity, GST %, recipe [[ingredient, qty/portion, waste %]], groups
const DISHES = [
  ['Paneer Tikka', 'Starters', 260, 8, 5, [['Paneer', .15, 4], ['Curd', .03, 0], ['Spice Mix', .01, 0], ['Onion', .05, 8]], ['Spice level']],
  ['Chicken 65', 'Starters', 280, 10, 5, [['Chicken', .18, 8], ['Cooking Oil', .04, 0], ['Spice Mix', .015, 0]], ['Spice level']],
  ['Veg Spring Roll', 'Starters', 180, 5, 5, [['Maida', .06, 3], ['Onion', .05, 8], ['Cooking Oil', .03, 0]], []],
  ['Egg Bhurji', 'Starters', 150, 4, 5, [['Eggs', 3, 0], ['Onion', .05, 8], ['Tomato', .04, 10]], ['Spice level']],
  ['Chicken Biryani', 'Mains', 320, 22, 5, [['Basmati Rice', .25, 0], ['Chicken', .18, 10], ['Cooking Oil', .025, 0], ['Spice Mix', .02, 0], ['Onion', .06, 8], ['Curd', .04, 0], ['Ghee', .01, 0]], ['Spice level', 'Extras']],
  ['Mutton Biryani', 'Mains', 420, 10, 5, [['Basmati Rice', .25, 0], ['Mutton', .2, 12], ['Cooking Oil', .025, 0], ['Spice Mix', .02, 0], ['Onion', .06, 8], ['Ghee', .012, 0]], ['Spice level', 'Extras']],
  ['Veg Biryani', 'Mains', 240, 7, 5, [['Basmati Rice', .25, 0], ['Potato', .06, 5], ['Onion', .06, 8], ['Cooking Oil', .025, 0], ['Spice Mix', .02, 0]], ['Spice level']],
  ['Butter Chicken', 'Mains', 340, 14, 5, [['Chicken', .2, 10], ['Butter', .03, 0], ['Cream', .04, 0], ['Tomato', .1, 10], ['Spice Mix', .015, 0]], ['Spice level', 'Extras']],
  ['Paneer Butter Masala', 'Mains', 290, 11, 5, [['Paneer', .16, 4], ['Butter', .025, 0], ['Cream', .04, 0], ['Tomato', .1, 10]], ['Spice level', 'Extras']],
  ['Kadai Paneer', 'Mains', 280, 6, 5, [['Paneer', .16, 4], ['Onion', .06, 8], ['Tomato', .08, 10], ['Spice Mix', .015, 0]], ['Spice level']],
  ['Chicken Curry', 'Mains', 300, 9, 5, [['Chicken', .2, 10], ['Onion', .08, 8], ['Tomato', .08, 10], ['Cooking Oil', .03, 0], ['Spice Mix', .02, 0]], ['Spice level', 'Extras']],
  ['Dal Tadka', 'Mains', 180, 9, 5, [['Lentils', .08, 0], ['Onion', .04, 8], ['Tomato', .05, 10], ['Ghee', .01, 0]], ['Spice level']],
  ['Dal Makhani', 'Mains', 220, 8, 5, [['Lentils', .09, 0], ['Butter', .02, 0], ['Cream', .03, 0], ['Tomato', .05, 10]], ['Spice level']],
  ['Egg Curry', 'Mains', 200, 4, 5, [['Eggs', 2, 0], ['Onion', .07, 8], ['Tomato', .07, 10], ['Spice Mix', .015, 0]], ['Spice level']],
  ['Butter Naan', 'Breads', 60, 26, 5, [['Maida', .1, 3], ['Butter', .01, 0]], []],
  ['Garlic Naan', 'Breads', 70, 15, 5, [['Maida', .1, 3], ['Butter', .012, 0], ['Herbs', .005, 0]], []],
  ['Tandoori Roti', 'Breads', 30, 12, 5, [['Maida', .07, 3]], []],
  ['Plain Rice', 'Breads', 120, 8, 5, [['Basmati Rice', .2, 0]], []],
  ['Gulab Jamun', 'Desserts', 90, 6, 5, [['Maida', .03, 0], ['Ghee', .01, 0], ['Curd', .03, 0]], []],
  ['Kheer', 'Desserts', 110, 4, 5, [['Basmati Rice', .03, 0], ['Cream', .05, 0]], []],
  ['Sweet Lassi', 'Beverages', 90, 9, 5, [['Curd', .15, 0]], []]
];
// name, category, price ₹, cost ₹, stock, popularity — bought and sold as-is
const PACKAGED = [
  ['Cola 300ml', 'Beverages', 50, 20, 240, 14, 18],
  ['Bottled Water', 'Beverages', 30, 10, 300, 12, 0]
];

const GROUPS = [
  { name: 'Spice level', variant: true, options: [['Mild', 0], ['Medium', 0], ['Hot', 0]] },
  { name: 'Extras', variant: false, min: 0, max: 2, options: [['Extra chicken', 60, 'Chicken', .08], ['Extra cheese', 40, 'Cheese', .03], ['Fried egg', 20, 'Eggs', 1], ['Extra butter', 15, 'Butter', .01]] }
];

// station -> [dish, minutes]: where each dish is cooked and how long it should take.
const STATIONS = {
  'Tandoor': [['Paneer Tikka', 12], ['Butter Naan', 6], ['Garlic Naan', 7], ['Tandoori Roti', 5]],
  'Curry & Rice': [['Chicken Biryani', 18], ['Mutton Biryani', 22], ['Veg Biryani', 16], ['Butter Chicken', 14], ['Paneer Butter Masala', 12], ['Kadai Paneer', 12], ['Chicken Curry', 14], ['Dal Tadka', 10], ['Dal Makhani', 12], ['Egg Curry', 10], ['Plain Rice', 8]],
  'Fry & Starters': [['Chicken 65', 12], ['Veg Spring Roll', 10], ['Egg Bhurji', 8]],
  'Bar & Dessert': [['Sweet Lassi', 3], ['Gulab Jamun', 3], ['Kheer', 3], ['Cola 300ml', 1], ['Bottled Water', 1]]
};

const SUPPLIERS = ['Fresh Farms Produce', 'Halal Meats Co', 'Royal Grains & Spices', 'Dairy Delight'];

const CUSTOMERS = [
  'Aarav Nair', 'Meera Iyer', 'Rohan Gupta', 'Kavya Reddy', 'Vikram Singh', 'Ananya Das', 'Karthik Menon', 'Ishita Bose', 'Sanjay Patil', 'Neha Kapoor',
  'Arun Pillai', 'Divya Joshi', 'Manish Agarwal', 'Pooja Shetty', 'Rahul Verma', 'Sneha Kulkarni', 'Amit Chawla', 'Tanvi Desai', 'Farhan Sheikh', 'Lakshmi Rao',
  'Gaurav Malhotra', 'Riya Banerjee', 'Suresh Kumar', 'Nisha Thomas', 'Deepak Jain', 'Swati Mishra', 'Harish Bhat', 'Anjali Sharma', 'Yusuf Khan', 'Prerna Saxena',
  'Naveen Gowda', 'Shruti Hegde', 'Abhishek Roy', 'Madhuri Nambiar', 'Imran Qureshi', 'Jyoti Pandey', 'Sameer Ghosh', 'Kritika Anand', 'Varun Mehra', 'Bhavna Solanki'
];

/* ── helpers ──────────────────────────────────────────────────────────────── */
const dayAt = (daysAgo, hour, minute) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, int(0, 59), 0);
  return d;
};
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const main = async () => {
  await initializeDatabase();

  // Replace a previous demo run.
  const previous = await pool.query(`SELECT business_id FROM businesses WHERE name = 'FlowXP Demo Restaurant'`);
  for (const { business_id } of previous.rows) await pool.query('DELETE FROM businesses WHERE business_id = $1', [business_id]);
  await pool.query(`DELETE FROM users WHERE email LIKE 'demo%@flowxp.test'`);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const staff = {};
  for (const [key, email, name, role] of [
    ['owner', 'demo@flowxp.test', 'Priya Sharma', 'OWNER'],
    ['manager', 'demo-manager@flowxp.test', 'Arjun Mehta', 'MANAGER'],
    ['cashier', 'demo-cashier@flowxp.test', 'Ravi Kumar', 'CASHIER'],
    ['waiter', 'demo-waiter@flowxp.test', 'Sneha Pillai', 'WAITER'],
    ['kitchen', 'demo-kitchen@flowxp.test', 'Imran Ali', 'KITCHEN'],
    ['cashier2', 'demo-cashier-indiranagar@flowxp.test', 'Karan Bhat', 'CASHIER'],
    ['cashier3', 'demo-cashier-koramangala@flowxp.test', 'Nisha Rao', 'CASHIER'],
    ['inventory', 'demo-inventory@flowxp.test', 'Deepa Nair', 'INVENTORY_MANAGER']
  ]) {
    const { rows } = await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ($1,$2,$3,TRUE) RETURNING user_id`, [name, email, hash]);
    staff[key] = { userId: rows[0].user_id, role };
  }

  const biz = (await pool.query(
    `INSERT INTO businesses (name, business_type, owner_user_id, email, phone, address, city, state, gstin, gst_enabled,
                             subscription_status, plan_code, billing_cycle, onboarding_step, upi_vpa)
     VALUES ('FlowXP Demo Restaurant','RESTAURANT',$1,'demo@flowxp.test','9876500000','12 MG Road','Bengaluru','Karnataka','29ABCDE1234F1Z5',TRUE,
             'ACTIVE','BUSINESS','MONTHLY',10,'demorestaurant@okhdfcbank')
     RETURNING business_id`,
    [staff.owner.userId]
  )).rows[0];
  const businessId = biz.business_id;
  // Three outlets. Volume shares add to 1; stock, tables and staff are per outlet.
  const outlets = [];
  for (const [name, code, city, primary, share] of [['MG Road', 'MGR', 'Bengaluru', true, 0.55], ['Indiranagar', 'IND', 'Bengaluru', false, 0.3], ['Koramangala', 'KOR', 'Bengaluru', false, 0.15]]) {
    const id = (await pool.query(
      `INSERT INTO branches (business_id, name, code, city, state, is_primary) VALUES ($1,$2,$3,$4,'Karnataka',$5) RETURNING branch_id`, [businessId, name, code, city, primary])).rows[0].branch_id;
    outlets.push({ id, name, share, tenant: { businessId, branchId: id } });
  }
  const [mg, ind, kor] = outlets;
  const branchId = mg.id;
  // Owner, manager and stock manager cover the group; floor staff belong to one outlet.
  const pinned = { cashier: mg.id, waiter: mg.id, kitchen: mg.id, cashier2: ind.id, cashier3: kor.id };
  for (const [key, s] of Object.entries(staff)) {
    await pool.query(`INSERT INTO business_users (business_id, user_id, role, branch_id) VALUES ($1,$2,$3,$4)`, [businessId, s.userId, s.role, pinned[key] ?? null]);
  }
  const tenant = mg.tenant;
  // Stock is split across outlets in proportion to volume; the last outlet takes the remainder so the total is exact.
  const splitStock = (total) => {
    const parts = outlets.map((o) => Math.round(total * o.share * 1000) / 1000);
    parts[parts.length - 1] = Math.round((total - parts.slice(0, -1).reduce((a, b) => a + b, 0)) * 1000) / 1000;
    return parts;
  };

  // Illustrative assumptions for the demo only — a real restaurant enters its own in Profit → Cost assumptions.
  await pool.query(
    `INSERT INTO cost_settings (business_id, payment_fee_pct, platform_commission_pct, packaging_per_order_paise) VALUES ($1,$2,$3,$4)`,
    [businessId, JSON.stringify({ CARD: 1.9 }), JSON.stringify({ ZOMATO: 22, SWIGGY: 20, ONDC: 8, MAGICPIN: 15 }), 1200]
  );

  const supplierIds = {};
  for (const name of SUPPLIERS) {
    supplierIds[name] = (await pool.query(`INSERT INTO suppliers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING supplier_id`, [businessId, name, `98${int(10000000, 99999999)}`])).rows[0].supplier_id;
  }

  const categoryIds = {};
  for (const name of ['Starters', 'Mains', 'Breads', 'Desserts', 'Beverages']) {
    categoryIds[name] = (await pool.query(`INSERT INTO categories (business_id, name) VALUES ($1,$2) RETURNING category_id`, [businessId, name])).rows[0].category_id;
  }

  // Products. Opening stock goes through the ledger like everything else, dated before the history starts.
  const openingAt = dayAt(DAYS + 1, 9, 0);
  const addProduct = async ({ name, kind, category, price, cost, unit, stock, min, tax, supplier, track }) => {
    const { rows } = await pool.query(
      `INSERT INTO products (business_id, category_id, supplier_id, name, kind, unit, selling_price_paise, purchase_price_paise, tax_rate,
                             track_inventory, current_stock, min_stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING product_id`,
      [businessId, category ? categoryIds[category] : null, supplier ? supplierIds[supplier] : null, name, kind, unit || 'pc',
        rupees(price || 0), rupees(cost || 0), tax || 0, track, 0, min || 0]
    );
    if (track && stock > 0) {
      const parts = splitStock(stock);
      for (const [i, o] of outlets.entries()) {
        await moveStock(pool, { businessId, branchId: o.id, productId: rows[0].product_id, delta: parts[i] });
        await pool.query(
          `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, created_by, created_at)
           VALUES ($1,$2,$3,'OPENING',$4,'manual',$5,$6)`,
          [businessId, o.id, rows[0].product_id, parts[i], staff.owner.userId, openingAt]
        );
      }
    }
    return rows[0].product_id;
  };

  const ing = {};   // name -> { id, base cost ₹, target stock, supplier }
  for (const [name, unit, cost, stock, min, supplier] of INGREDIENTS) {
    ing[name] = { id: await addProduct({ name, kind: 'INGREDIENT', unit, cost, stock, min, supplier, track: true }), cost, target: stock, supplier };
  }
  for (const [name, unit, cost, stock, min, supplier] of PACKAGING) {
    ing[name] = { id: await addProduct({ name, kind: 'PACKAGING', unit, cost, stock, min, supplier, track: true }), cost, target: stock, supplier };
  }

  const groupIds = {}; const optionIds = {};
  for (const g of GROUPS) {
    groupIds[g.name] = (await pool.query(
      `INSERT INTO modifier_groups (business_id, name, is_variant, min_select, max_select) VALUES ($1,$2,$3,$4,$5) RETURNING group_id`,
      [businessId, g.name, g.variant, g.variant ? 1 : g.min, g.variant ? 1 : g.max]
    )).rows[0].group_id;
    optionIds[g.name] = [];
    let order = 0;
    for (const [name, price, ingredient, qty] of g.options) {
      const id = (await pool.query(
        `INSERT INTO modifiers (group_id, business_id, name, price_delta_paise, ingredient_product_id, ingredient_qty, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING modifier_id`,
        [groupIds[g.name], businessId, name, rupees(price), ingredient ? ing[ingredient].id : null, qty || null, order++]
      )).rows[0].modifier_id;
      optionIds[g.name].push(id);
    }
  }

  const dishes = [];
  for (const [name, category, price, popularity, tax, recipe, groups] of DISHES) {
    const id = await addProduct({ name, kind: 'DISH', category, price, tax, track: false });
    for (const [ingredient, qty, waste] of recipe) {
      await pool.query(`INSERT INTO recipe_items (business_id, dish_product_id, ingredient_product_id, quantity, wastage_pct) VALUES ($1,$2,$3,$4,$5)`, [businessId, id, ing[ingredient].id, qty, waste]);
    }
    for (const g of groups) await pool.query(`INSERT INTO product_modifier_groups (product_id, group_id) VALUES ($1,$2)`, [id, groupIds[g]]);
    dishes.push({ id, name, popularity, groups });
  }
  for (const [name, category, price, cost, stock, popularity, tax] of PACKAGED) {
    const id = await addProduct({ name, kind: 'DISH', category, price, cost, stock, min: 40, tax, track: true, supplier: 'Dairy Delight' });
    ing[name] = { id, cost, target: stock, supplier: 'Dairy Delight' };
    dishes.push({ id, name, popularity, groups: [], packaged: true, cost, stock });
  }

  // Kitchen stations and routing.
  const dishInfo = new Map();
  let stationOrder = 0;
  for (const [stationName, list] of Object.entries(STATIONS)) {
    const stationId = (await pool.query(`INSERT INTO kitchen_stations (business_id, name, sort_order) VALUES ($1,$2,$3) RETURNING station_id`, [businessId, stationName, ++stationOrder])).rows[0].station_id;
    for (const [dishName, minutes] of list) {
      const dish = dishes.find((d) => d.name === dishName);
      await pool.query(`UPDATE products SET station_id = $1, prep_minutes = $2 WHERE product_id = $3`, [stationId, minutes, dish.id]);
      dishInfo.set(dish.id, { stationId, minutes, name: dishName });
    }
  }

  const tables = [];
  const layout = new Map([[mg.id, 8], [ind.id, 6], [kor.id, 4]]);
  for (const [outletId, count] of layout) {
    const names = [];
    for (let i = 1; i <= count; i++) names.push(['T' + i, 'Indoor', i <= 4 ? 4 : 6]);
    if (outletId === mg.id) names.push(['P1', 'Patio', 4], ['P2', 'Patio', 4]);
    for (const [name, zone, seats] of names) {
      tables.push(name);
      await pool.query(`INSERT INTO dining_tables (business_id, branch_id, name, zone, seats, qr_token) VALUES ($1,$2,$3,$4,$5,$6)`, [businessId, outletId, name, zone, seats, [...Array(40)].map(() => Math.floor(rand() * 16).toString(16)).join('')]);
    }
  }

  // Indiranagar is the premium outlet: Chicken Biryani costs a little more there.
  const biryani = dishes.find((d) => d.name === 'Chicken Biryani');
  if (biryani) await pool.query(`INSERT INTO product_branch_settings (product_id, branch_id, price_paise) SELECT product_id, $2, ROUND(selling_price_paise * 1.1) FROM products WHERE product_id = $1`, [biryani.id, ind.id]);

  // Loyalty: the seventh visit earns a free Gulab Jamun (customers are identified by mobile number); two offer codes.
  const jamun = dishes.find((d) => d.name === 'Gulab Jamun');
  await pool.query(`INSERT INTO loyalty_programs (business_id, is_enabled, visits_required, reward_product_id, reward_quantity, min_bill_paise) VALUES ($1,TRUE,7,$2,1,15000)`, [businessId, jamun.id]);
  await pool.query(
    `INSERT INTO coupons (business_id, code, description, kind, value, min_bill_paise, max_discount_paise, max_uses_per_customer) VALUES ($1,'WELCOME10','First visit: 10% off','PERCENT',10,20000,10000,1)`, [businessId]);
  await pool.query(`INSERT INTO coupons (business_id, code, description, kind, value, min_bill_paise) VALUES ($1,'FLAT50','₹50 off bills over ₹400','FLAT',5000,40000)`, [businessId]);

  const customerIds = [];
  for (const name of CUSTOMERS) {
    customerIds.push((await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [businessId, name, `9${int(100000000, 999999999)}`])).rows[0].customer_id);
  }
  // Regulars: the first ten customers account for far more visits.
  const customerPick = () => weighted(customerIds.map((id, i) => [id, i < 10 ? 6 : 1]));

  const req = (userId, extra = {}) => ({ tenant, auth: { userId }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra });
  const stockOf = async (id, outletId) => Number((await pool.query(outletId ? 'SELECT COALESCE((SELECT quantity FROM branch_stock WHERE product_id = $1 AND branch_id = $2), 0) AS s' : 'SELECT current_stock AS s FROM products WHERE product_id = $1', outletId ? [id, outletId] : [id])).rows[0].s);
  const pickOutlet = () => weighted(outlets.map((o) => [o, o.share]));

  /* ── the trading days, oldest first ────────────────────────────────────── */
  const WEEKDAY_BASE = [46, 24, 26, 27, 30, 42, 52];   // Sun..Sat
  const sellersAt = new Map([
    [mg.id, [[staff.cashier.userId, 5], [staff.waiter.userId, 3], [staff.manager.userId, 2], [staff.owner.userId, 1]]],
    [ind.id, [[staff.cashier2.userId, 6], [staff.manager.userId, 1]]],
    [kor.id, [[staff.cashier3.userId, 6], [staff.manager.userId, 1]]]
  ]);
  let invoiceCount = 0; let cancelled = 0; let refunded = 0; let purchaseCount = 0;

  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo--) {
    const date = dayAt(daysAgo, 12, 0);
    const dayIndex = DAYS - daysAgo;

    // Restock every third day (and on day 0 of the history), topping each ingredient back up to target.
    if (dayIndex % 3 === 0 && daysAgo > 0) {
      for (const outlet of outlets) {
      const bySupplier = new Map();
      for (const [name, item] of Object.entries(ing)) {
        const stock = await stockOf(item.id, outlet.id);
        const target = item.target * outlet.share;
        if (stock < target * 0.55) {
          // Planted: chicken creeps up ~12% over the last 30 days; everything else wobbles by ±2%.
          const drift = name === 'Chicken' ? 1 + 0.12 * Math.max(0, (dayIndex - (DAYS - 30)) / 30) : 1 + between(-0.02, 0.02);
          const qty = Math.max(1, Math.ceil(target - stock));
          if (!bySupplier.has(item.supplier)) bySupplier.set(item.supplier, []);
          bySupplier.get(item.supplier).push({ product_id: item.id, quantity: qty, unit_cost: Math.round(item.cost * drift * 100) / 100 });
        }
      }
      for (const [supplier, items] of bySupplier) {
        const total = items.reduce((s, i) => s + i.quantity * i.unit_cost, 0);
        const res = fakeRes();
        await purchases.create(req(staff.inventory.userId, {
          tenant: outlet.tenant,
          body: { supplier_id: supplierIds[supplier], items, po_date: isoDate(date), payment: rand() < 0.7 ? { amount: Math.round(total * 1.05), method: 'BANK_TRANSFER' } : undefined }
        }), res);
        if (res.code !== 201) throw new Error(`purchase failed: ${JSON.stringify(res.body)}`);
        purchaseCount++;
        await pool.query(`UPDATE inventory_transactions SET created_at = $1 WHERE reference_type = 'purchase_order' AND reference_id = $2`, [dayAt(daysAgo, 8, int(0, 40)), res.body.data.po_id]);
        await pool.query(`UPDATE purchase_orders SET created_at = $1 WHERE po_id = $2`, [dayAt(daysAgo, 8, int(0, 40)), res.body.data.po_id]);
      }
      }
    }

    // Sales.
    const growth = 1 + dayIndex / 240;
    const count = Math.round(WEEKDAY_BASE[date.getDay()] * growth * between(0.88, 1.12));
    for (let n = 0; n < count; n++) {
      const hour = weighted([[12, 6], [13, 11], [14, 6], [15, 1], [18, 3], [19, 12], [20, 16], [21, 12], [22, 4], [11, 1]]);
      const at = dayAt(daysAgo, hour, int(0, 59));
      const outlet = pickOutlet();
      const seller = weighted(sellersAt.get(outlet.id));

      const lineCount = weighted([[1, 3], [2, 9], [3, 8], [4, 4], [5, 1]]);
      const items = []; const used = new Set();
      for (let l = 0; l < lineCount; l++) {
        const dish = weighted(dishes.map((d) => [d, d.popularity]));
        if (used.has(dish.id)) continue;
        used.add(dish.id);
        const quantity = weighted([[1, 8], [2, 3], [3, 1]]);
        const modifierIds = [];
        if (dish.groups.includes('Spice level')) modifierIds.push(weighted(optionIds['Spice level'].map((id, i) => [id, [3, 5, 2][i]])));
        if (dish.groups.includes('Extras') && rand() < 0.22) modifierIds.push(pick(optionIds.Extras));
        if (dish.packaged && await stockOf(dish.id, outlet.id) < quantity) continue;
        items.push({ product_id: dish.id, quantity, modifier_ids: modifierIds.length ? modifierIds : undefined });
      }
      if (!items.length) continue;

      // Discount behaviour. Planted: in the last 21 days Ravi gives large discounts on a fifth of his bills.
      let discount = 0;
      const rough = items.length * 300;
      if (seller === staff.cashier.userId && daysAgo <= 21 && rand() < 0.2) discount = Math.round(rough * between(0.12, 0.25));
      else if (rand() < 0.05) discount = pick([20, 30, 50]);

      // Where the sale came from. Delivery-platform payouts arrive as OTHER, not at the till.
      const channel = weighted([['POS', 66], ['DELIVERY', 22], ['TAKEAWAY', 12]]);
      const platform = channel === 'DELIVERY' ? weighted([['ZOMATO', 45], ['SWIGGY', 40], ['ONDC', 5], ['MAGICPIN', 10]]) : null;
      const method = channel === 'DELIVERY' ? 'OTHER' : weighted([['UPI', 45], ['CASH', 30], ['CARD', 25]]);
      const client = await pool.connect();
      let invoice;
      try {
        await client.query('BEGIN');
        invoice = await createInvoiceInTransaction(client, outlet.tenant, seller, {
          customerId: rand() < 0.45 ? customerPick() : undefined,
          items, discount: discount || undefined, invoiceDate: isoDate(at),
          payment: { method, amount: 0 }   // filled below once the total is known
        });
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }

      // Payment is recorded for the full total (createInvoice was given 0 so we can pay the exact figure).
      if (invoice.total > 0) {
        await pool.query(
          `INSERT INTO payments (business_id, branch_id, invoice_id, customer_id, payment_method, amount_paise, payment_date, created_by, created_at)
           SELECT business_id, branch_id, invoice_id, customer_id, $2, total_paise, $3::date, $4, $5 FROM invoices WHERE invoice_id = $1`,
          [invoice.invoice_id, method, isoDate(at), seller, at]
        );
        await pool.query(`UPDATE invoices SET amount_paid_paise = total_paise, balance_due_paise = 0, payment_status = 'PAID' WHERE invoice_id = $1`, [invoice.invoice_id]);
      }
      await pool.query(`UPDATE invoices SET created_at = $2 WHERE invoice_id = $1`, [invoice.invoice_id, at]);
      await pool.query(`UPDATE inventory_transactions SET created_at = $2 WHERE reference_type = 'invoice' AND reference_id = $1`, [invoice.invoice_id, at]);
      if (channel !== 'POS') {
        const placed = await pool.query(
          `INSERT INTO orders (business_id, branch_id, order_number, order_type, platform, external_order_id, status, invoice_id, created_by, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,'BILLED',$7,$8,$9) RETURNING order_id`,
          [businessId, outlet.id, `${platform ? platform.slice(0, 3) : 'TKW'}-${invoice.invoice_id}`, channel, platform, platform ? `${platform}-${invoice.invoice_id}` : null, invoice.invoice_id, seller, at]
        );
        await pool.query(`UPDATE invoices SET order_id = $1 WHERE invoice_id = $2`, [placed.rows[0].order_id, invoice.invoice_id]);
      }
      invoiceCount++;

      // About a third of counter sales went through the kitchen: give them an order with real send/ready times.
      // Planted: Chicken Biryani takes ~45% longer in the last two weeks; the 7-9 pm rush runs a little slow everywhere.
      if (channel === 'POS' && rand() < 0.35) {
        const order = await pool.query(
          `INSERT INTO orders (business_id, branch_id, order_number, order_type, status, invoice_id, created_by, created_at)
           VALUES ($1,$2,$3,'DINE_IN','BILLED',$4,$5,$6) RETURNING order_id`,
          [businessId, outlet.id, `K-${invoice.invoice_id}`, invoice.invoice_id, seller, at]
        );
        await pool.query(`UPDATE invoices SET order_id = $1 WHERE invoice_id = $2`, [order.rows[0].order_id, invoice.invoice_id]);
        const lines = (await pool.query(`SELECT product_id, description, quantity, unit_price_paise, modifiers FROM invoice_items WHERE invoice_id = $1 AND product_id IS NOT NULL`, [invoice.invoice_id])).rows;
        for (const line of lines) {
          const info = dishInfo.get(line.product_id);
          if (!info) continue;
          let factor = 0.85 + rand() * 0.35;
          if (hour >= 19 && hour <= 21) factor *= 1.12;
          if (info.name === 'Chicken Biryani' && daysAgo <= 14) factor *= 1.45;
          const prep = Math.max(1, Math.round(info.minutes * factor));
          const sentAt = new Date(at.getTime() - (prep + int(4, 12)) * 60000);
          const readyAt = new Date(sentAt.getTime() + prep * 60000);
          await pool.query(
            `INSERT INTO order_items (order_id, product_id, description, quantity, unit_price_paise, modifiers, status, station_id, expected_minutes, sent_at, ready_at, served_at, invoice_id, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,'SERVED',$7,$8,$9,$10,$11,$12,$9)`,
            [order.rows[0].order_id, line.product_id, line.description, line.quantity, line.unit_price_paise, JSON.stringify(line.modifiers || []),
              info.stationId, info.minutes, sentAt, readyAt, new Date(readyAt.getTime() + 3 * 60000), invoice.invoice_id]
          );
        }
      }

      // A few cancellations and small refunds, so those reports have something to show.
      if (rand() < 0.02) { await invoices.cancel(req(staff.manager.userId, { tenant: outlet.tenant, params: { id: invoice.invoice_id } }), fakeRes()); cancelled++; }
      else if (rand() < 0.012 && invoice.total > 100) {
        const res = fakeRes();
        await invoices.refund(req(staff.manager.userId, { tenant: outlet.tenant, params: { id: invoice.invoice_id }, body: { amount: Math.round(invoice.total * 0.3), method, reason: pick(['Cold food', 'Wrong item served', 'Long wait']) } }), res);
        if (res.code === 201) refunded++;
      }
    }

    // Wastage: a little most days. Planted: tomato waste climbs in the last 14 days.
    if (dayIndex % 2 === 0) {
      const events = [['Tomato', daysAgo <= 14 ? between(1.6, 2.6) : between(0.3, 0.8), 'SPOILAGE'], ['Onion', between(0.3, 0.9), 'PREPARATION'], [pick(['Chicken', 'Curd', 'Herbs', 'Cream']), between(0.2, 0.7), pick(['EXPIRED', 'OVERPRODUCTION', 'SPOILAGE'])]];
      for (const [name, qty, reason] of events) {
        const q = Math.round(qty * 1000) / 1000;
        const at = pickOutlet();
        await moveStock(pool, { businessId, branchId: at.id, productId: ing[name].id, delta: -q });
        await pool.query(
          `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, reason_code, created_by, created_at)
           VALUES ($1,$2,$3,'WASTAGE',$4,'manual',$5,$6,$7)`,
          [businessId, at.id, ing[name].id, -q, reason, staff.inventory.userId, dayAt(daysAgo, 22, 30)]
        );
      }
    }

    // Expenses.
    const dom = date.getDate();
    // Each outlet carries a share of the group's costs (rent and salaries scale with its size).
    const expense = async (category, amount, description) => {
      for (const o of outlets) {
        await pool.query(
          `INSERT INTO expenses (business_id, branch_id, category, amount_paise, payment_method, expense_date, description, created_by, created_at)
           VALUES ($1,$2,$3,$4,'BANK_TRANSFER',$5,$6,$7,$8)`,
          [businessId, o.id, category, rupees(amount * o.share), isoDate(date), description, staff.owner.userId, dayAt(daysAgo, 10, 0)]
        );
      }
    };
    if (dom === 1) { await expense('Rent', 60000, 'Monthly rent'); await expense('Salary', 185000, 'Staff salaries'); }
    if (dom === 12) await expense('Utilities', int(16000, 21000), 'Electricity and water');
    if (dom === 20) await expense('Utilities', int(8000, 10000), 'Gas cylinders');
    if (date.getDay() === 1) await expense('Marketing', int(2000, 3500), 'Local ads and delivery-app promotion');
  }

  console.log(`
Demo restaurant ready: FlowXP Demo Restaurant (business ${businessId})
  ${invoiceCount} invoices over ${DAYS} days (${cancelled} cancelled, ${refunded} partly refunded), ${purchaseCount} purchases
  ${outlets.length} outlets (${outlets.map((o) => o.name).join(', ')}), ${dishes.length} menu items, ${INGREDIENTS.length + PACKAGING.length} ingredients/packaging, ${tables.length} tables, ${CUSTOMERS.length} customers

  Owner    demo@flowxp.test / ${PASSWORD}
  Staff    demo-manager@ · demo-cashier@ (MG Road) · demo-cashier-indiranagar@ · demo-cashier-koramangala@ · demo-waiter@ · demo-kitchen@ · demo-inventory@  (flowxp.test, same password)
`);
  await pool.end();
};

main().catch(async (error) => {
  console.error('[seed-demo] failed:', error);
  await pool.end().catch(() => {});
  process.exit(1);
});
