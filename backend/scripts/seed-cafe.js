/*
 * Demo café: "Brew & Bloom Café", two outlets, with 30 days of realistic trading.
 *
 *   npm run seed:cafe        (re-running replaces the demo café)
 *
 * A café's menu: coffee, tea, cold drinks, bakes, sandwiches and snacks, with Size / Milk / Sugar / Add-ons on the drinks
 * (oat and almond milk and the extra shot use up their own stock), recipes with the cup and lid counted as stock, three
 * stations, a visit card, two offers (a weekday happy hour and any 2 bakes for one price) and a morning and an evening rush.
 * Every sale goes through the real billing engine, so stock, cost and GST are genuine numbers.
 *
 * Sign in: cafe@flowxp.test / demo1234   (staff: cafe-manager@ and cafe-barista@, same password)
 */
import './no-production.js'; // loads .env, and stops here in production
import bcrypt from 'bcryptjs';
import pool, { initializeDatabase } from '../src/config/database.js';
import { createInvoiceInTransaction } from '../src/modules/billing.js';
import { moveStock } from '../src/modules/stock.js';
import { CAFE_GROUPS } from '../src/modules/defaultOptions.js';

const DAYS = 30;
const PASSWORD = 'demo1234';
const mulberry32 = (seed) => () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rand = mulberry32(20261007);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const weighted = (entries) => { const total = entries.reduce((s, [, w]) => s + w, 0); let r = rand() * total; for (const [v, w] of entries) { r -= w; if (r <= 0) return v; } return entries[entries.length - 1][0]; };
const rupees = (n) => Math.round(n * 100);

// name, unit, cost ₹/unit, opening stock, reorder-at, supplier
const INGREDIENTS = [
  ['Coffee Beans', 'kg', 1100, 40, 8, 'Bean & Leaf Traders'], ['Full Cream Milk', 'litre', 62, 120, 30, 'Dairy Fresh'], ['Oat Milk', 'litre', 210, 30, 8, 'Dairy Fresh'],
  ['Almond Milk', 'litre', 260, 20, 6, 'Dairy Fresh'], ['Whipping Cream', 'litre', 240, 15, 4, 'Dairy Fresh'], ['Butter', 'kg', 480, 12, 4, 'Dairy Fresh'], ['Cheese Slices', 'kg', 420, 8, 3, 'Dairy Fresh'],
  ['Eggs', 'pc', 7, 240, 60, 'Dairy Fresh'], ['Sugar', 'kg', 48, 40, 10, 'Crumb Bakery Supplies'], ['Chocolate Syrup', 'litre', 380, 10, 3, 'Bean & Leaf Traders'], ['Caramel Syrup', 'litre', 360, 10, 3, 'Bean & Leaf Traders'],
  ['Tea Leaves', 'kg', 520, 8, 2, 'Bean & Leaf Traders'], ['Flour', 'kg', 42, 50, 15, 'Crumb Bakery Supplies'], ['Bread Slices', 'pc', 4, 400, 100, 'Crumb Bakery Supplies'],
  ['Paneer', 'kg', 320, 12, 4, 'Dairy Fresh'], ['Chicken', 'kg', 220, 15, 5, 'Crumb Bakery Supplies'], ['Potato', 'kg', 25, 30, 8, 'Crumb Bakery Supplies'], ['Mango Pulp', 'kg', 180, 15, 4, 'Crumb Bakery Supplies'], ['Lemon', 'kg', 90, 10, 3, 'Crumb Bakery Supplies']
];
const PACKAGING = [
  ['Paper Cup 8oz', 'pc', 3.2, 3000, 600, 'PackRight'], ['Cup Lid', 'pc', 1.1, 3000, 600, 'PackRight'], ['Cup Sleeve', 'pc', 0.8, 2500, 500, 'PackRight'], ['Paper Bag', 'pc', 2.5, 1200, 300, 'PackRight']
];
const SUPPLIERS = ['Bean & Leaf Traders', 'Dairy Fresh', 'Crumb Bakery Supplies', 'PackRight'];

/* The option groups are the café defaults, with the stock each choice uses where it has some (ingredient, quantity per drink). */
const USES = { Oat: ['Oat Milk', 0.2], Almond: ['Almond Milk', 0.2], 'Extra shot': ['Coffee Beans', 0.009], 'Flavour syrup': ['Caramel Syrup', 0.02], 'Chocolate drizzle': ['Chocolate Syrup', 0.015], 'Whipped cream': ['Whipping Cream', 0.03] };

const HOT = [['Coffee Beans', 0.018, 2], ['Full Cream Milk', 0.18, 3], ['Paper Cup 8oz', 1, 0], ['Cup Lid', 1, 0], ['Cup Sleeve', 1, 0]];
const COLD = [['Coffee Beans', 0.018, 2], ['Full Cream Milk', 0.16, 3], ['Sugar', 0.015, 0], ['Paper Cup 8oz', 1, 0], ['Cup Lid', 1, 0]];
const GROUPS_DRINK = ['Size', 'Milk', 'Sugar', 'Add-ons'];
// name, category, price ₹, popularity, GST %, recipe, option groups
const DISHES = [
  ['Espresso', 'Coffee', 90, 6, 5, [['Coffee Beans', 0.018, 2], ['Paper Cup 8oz', 1, 0]], ['Size', 'Sugar', 'Add-ons']],
  ['Americano', 'Coffee', 120, 8, 5, [['Coffee Beans', 0.018, 2], ['Paper Cup 8oz', 1, 0], ['Cup Lid', 1, 0]], ['Size', 'Sugar', 'Add-ons']],
  ['Cappuccino', 'Coffee', 150, 14, 5, HOT, GROUPS_DRINK], ['Café Latte', 'Coffee', 160, 15, 5, HOT, GROUPS_DRINK], ['Flat White', 'Coffee', 170, 7, 5, HOT, GROUPS_DRINK],
  ['Mocha', 'Coffee', 180, 7, 5, [...HOT, ['Chocolate Syrup', 0.025, 0]], GROUPS_DRINK], ['Caramel Macchiato', 'Coffee', 190, 6, 5, [...HOT, ['Caramel Syrup', 0.025, 0]], GROUPS_DRINK],
  ['Filter Coffee', 'Coffee', 80, 9, 5, [['Coffee Beans', 0.015, 2], ['Full Cream Milk', 0.12, 3], ['Sugar', 0.01, 0], ['Paper Cup 8oz', 1, 0]], ['Size', 'Sugar']],
  ['Masala Chai', 'Tea', 70, 12, 5, [['Tea Leaves', 0.006, 1], ['Full Cream Milk', 0.15, 3], ['Sugar', 0.012, 0], ['Paper Cup 8oz', 1, 0]], ['Size', 'Sugar']],
  ['Green Tea', 'Tea', 90, 4, 5, [['Tea Leaves', 0.005, 1], ['Paper Cup 8oz', 1, 0]], ['Size', 'Sugar']],
  ['Iced Latte', 'Cold Drinks', 180, 9, 5, COLD, GROUPS_DRINK], ['Cold Coffee', 'Cold Drinks', 170, 11, 5, COLD, GROUPS_DRINK], ['Cold Brew', 'Cold Drinks', 170, 6, 5, [['Coffee Beans', 0.025, 2], ['Paper Cup 8oz', 1, 0], ['Cup Lid', 1, 0]], ['Size', 'Sugar', 'Add-ons']],
  ['Mocha Frappe', 'Cold Drinks', 200, 7, 5, [...COLD, ['Chocolate Syrup', 0.03, 0], ['Whipping Cream', 0.03, 0]], GROUPS_DRINK], ['Fresh Lemonade', 'Cold Drinks', 100, 6, 5, [['Lemon', 0.06, 5], ['Sugar', 0.03, 0], ['Paper Cup 8oz', 1, 0]], ['Size', 'Sugar']],
  ['Mango Smoothie', 'Cold Drinks', 160, 5, 5, [['Mango Pulp', 0.15, 3], ['Full Cream Milk', 0.12, 3], ['Paper Cup 8oz', 1, 0]], ['Size']],
  ['Butter Croissant', 'Bakes', 110, 12, 5, [['Flour', 0.08, 2], ['Butter', 0.03, 2]], []], ['Chocolate Muffin', 'Bakes', 100, 8, 5, [['Flour', 0.07, 2], ['Eggs', 1, 0], ['Chocolate Syrup', 0.015, 0]], []],
  ['Blueberry Muffin', 'Bakes', 110, 6, 5, [['Flour', 0.07, 2], ['Eggs', 1, 0], ['Sugar', 0.02, 0]], []], ['Banana Bread Slice', 'Bakes', 90, 5, 5, [['Flour', 0.06, 2], ['Eggs', 1, 0], ['Butter', 0.02, 0]], []],
  ['Fudgy Brownie', 'Bakes', 120, 9, 5, [['Flour', 0.05, 2], ['Chocolate Syrup', 0.03, 0], ['Butter', 0.03, 0], ['Eggs', 1, 0]], []], ['Cheesecake Slice', 'Bakes', 180, 6, 5, [['Cheese Slices', 0.04, 1], ['Whipping Cream', 0.05, 1], ['Flour', 0.03, 1]], []],
  ['Veg Grilled Sandwich', 'Sandwiches', 150, 9, 5, [['Bread Slices', 2, 0], ['Cheese Slices', 0.03, 1], ['Butter', 0.01, 0], ['Potato', 0.05, 5]], []],
  ['Paneer Tikka Sandwich', 'Sandwiches', 180, 7, 5, [['Bread Slices', 2, 0], ['Paneer', 0.07, 3], ['Butter', 0.01, 0]], []], ['Chicken Club Sandwich', 'Sandwiches', 220, 7, 5, [['Bread Slices', 3, 0], ['Chicken', 0.09, 4], ['Cheese Slices', 0.02, 1], ['Eggs', 1, 0]], []],
  ['Egg Sandwich', 'Sandwiches', 140, 5, 5, [['Bread Slices', 2, 0], ['Eggs', 2, 0], ['Butter', 0.01, 0]], []],
  ['Garlic Bread', 'Snacks', 130, 7, 5, [['Bread Slices', 3, 0], ['Butter', 0.02, 0], ['Cheese Slices', 0.02, 1]], []], ['French Fries', 'Snacks', 130, 8, 5, [['Potato', 0.2, 8]], []]
];
const STATIONS = {
  'Coffee Bar': [['Espresso', 2], ['Americano', 3], ['Cappuccino', 4], ['Café Latte', 4], ['Flat White', 4], ['Mocha', 5], ['Caramel Macchiato', 5], ['Filter Coffee', 3], ['Masala Chai', 4], ['Green Tea', 3]],
  'Cold Bar': [['Iced Latte', 4], ['Cold Coffee', 4], ['Cold Brew', 2], ['Mocha Frappe', 6], ['Fresh Lemonade', 3], ['Mango Smoothie', 5]],
  'Bakery & Kitchen': [['Butter Croissant', 3], ['Chocolate Muffin', 2], ['Blueberry Muffin', 2], ['Banana Bread Slice', 2], ['Fudgy Brownie', 2], ['Cheesecake Slice', 2], ['Veg Grilled Sandwich', 8], ['Paneer Tikka Sandwich', 9], ['Chicken Club Sandwich', 10], ['Egg Sandwich', 7], ['Garlic Bread', 7], ['French Fries', 8]]
};
const CUSTOMERS = ['Aanya Kapoor', 'Rohit Menon', 'Ishaan Bhat', 'Tara Nair', 'Kabir Shah', 'Diya Reddy', 'Neil Fernandes', 'Sara Qureshi', 'Arjun Das', 'Mehak Gill', 'Vihaan Rao', 'Zara Ali', 'Dev Malhotra', 'Pia Sen', 'Rhea Joshi', 'Aryan Pillai', 'Myra Iyer', 'Kian Dsouza', 'Anvi Shetty', 'Yash Gowda'];

const dayAt = (daysAgo, hour, minute) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hour, minute, int(0, 59), 0); return d; };
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const main = async () => {
  await initializeDatabase();
  for (const { business_id } of (await pool.query(`SELECT business_id FROM businesses WHERE name = 'Brew & Bloom Café'`)).rows) await pool.query('DELETE FROM businesses WHERE business_id = $1', [business_id]);
  await pool.query(`DELETE FROM users WHERE email LIKE 'cafe%@flowxp.test'`);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const staff = {};
  for (const [key, email, name, role] of [['owner', 'cafe@flowxp.test', 'Zoya Khan', 'OWNER'], ['manager', 'cafe-manager@flowxp.test', 'Kunal Rao', 'MANAGER'], ['barista', 'cafe-barista@flowxp.test', 'Maya Thomas', 'CASHIER'], ['barista2', 'cafe-barista2@flowxp.test', 'Sahil Verma', 'CASHIER']]) {
    staff[key] = { userId: (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ($1,$2,$3,TRUE) RETURNING user_id`, [name, email, hash])).rows[0].user_id, role };
  }
  const businessId = (await pool.query(
    `INSERT INTO businesses (name, business_type, owner_user_id, email, phone, address, city, state, gstin, gst_enabled, subscription_status, plan_code, billing_cycle, onboarding_step, upi_vpa)
     VALUES ('Brew & Bloom Café','CAFE',$1,'cafe@flowxp.test','9876511111','24 Church Street','Bengaluru','Karnataka','29AABCB1234C1Z7',TRUE,'ACTIVE','ENTERPRISE','MONTHLY',10,'brewbloom@okhdfcbank') RETURNING business_id`,
    [staff.owner.userId])).rows[0].business_id;
  const outlets = [];
  for (const [name, code, primary, share] of [['Indiranagar', 'IND', true, 0.62], ['Koramangala', 'KOR', false, 0.38]]) {
    const id = (await pool.query(`INSERT INTO branches (business_id, name, code, city, state, is_primary) VALUES ($1,$2,$3,'Bengaluru','Karnataka',$4) RETURNING branch_id`, [businessId, name, code, primary])).rows[0].branch_id;
    outlets.push({ id, name, share, tenant: { businessId, branchId: id } });
  }
  const pinned = { barista: outlets[0].id, barista2: outlets[1].id };
  for (const [key, s] of Object.entries(staff)) await pool.query(`INSERT INTO business_users (business_id, user_id, role, branch_id) VALUES ($1,$2,$3,$4)`, [businessId, s.userId, s.role, pinned[key] ?? null]);
  await pool.query(`INSERT INTO cost_settings (business_id, payment_fee_pct, platform_commission_pct, packaging_per_order_paise) VALUES ($1,$2,$3,$4)`, [businessId, JSON.stringify({ CARD: 1.9 }), JSON.stringify({}), 0]);

  const supplierIds = {};
  for (const name of SUPPLIERS) supplierIds[name] = (await pool.query(`INSERT INTO suppliers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING supplier_id`, [businessId, name, `98${int(10000000, 99999999)}`])).rows[0].supplier_id;
  const categoryIds = {};
  for (const name of ['Coffee', 'Tea', 'Cold Drinks', 'Bakes', 'Sandwiches', 'Snacks']) categoryIds[name] = (await pool.query(`INSERT INTO categories (business_id, name) VALUES ($1,$2) RETURNING category_id`, [businessId, name])).rows[0].category_id;

  const openingAt = dayAt(DAYS + 1, 8, 0);
  const splitStock = (total) => { const parts = outlets.map((o) => Math.round(total * o.share * 1000) / 1000); parts[parts.length - 1] = Math.round((total - parts.slice(0, -1).reduce((a, b) => a + b, 0)) * 1000) / 1000; return parts; };
  const addProduct = async ({ name, kind, category, price, cost, unit, stock, min, tax, supplier, track }) => {
    const { rows } = await pool.query(
      `INSERT INTO products (business_id, category_id, supplier_id, name, kind, unit, selling_price_paise, purchase_price_paise, tax_rate, track_inventory, current_stock, min_stock)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11) RETURNING product_id`,
      [businessId, category ? categoryIds[category] : null, supplier ? supplierIds[supplier] : null, name, kind, unit || 'pc', rupees(price || 0), rupees(cost || 0), tax || 0, track, min || 0]);
    if (track && stock > 0) {
      const parts = splitStock(stock);
      for (const [i, o] of outlets.entries()) {
        await moveStock(pool, { businessId, branchId: o.id, productId: rows[0].product_id, delta: parts[i] });
        await pool.query(`INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, created_by, created_at) VALUES ($1,$2,$3,'OPENING',$4,'manual',$5,$6)`, [businessId, o.id, rows[0].product_id, parts[i], staff.owner.userId, openingAt]);
      }
    }
    return rows[0].product_id;
  };
  const ing = {};
  for (const [name, unit, cost, stock, min, supplier] of INGREDIENTS) ing[name] = { id: await addProduct({ name, kind: 'INGREDIENT', unit, cost, stock, min, supplier, track: true }) };
  for (const [name, unit, cost, stock, min, supplier] of PACKAGING) ing[name] = { id: await addProduct({ name, kind: 'PACKAGING', unit, cost, stock, min, supplier, track: true }) };

  const groupIds = {}; const optionIds = {};
  for (const [gi, g] of CAFE_GROUPS.entries()) {
    groupIds[g.name] = (await pool.query(`INSERT INTO modifier_groups (business_id, name, is_variant, min_select, max_select, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING group_id`, [businessId, g.name, g.variant, g.variant ? 1 : g.min, g.variant ? 1 : g.max, gi])).rows[0].group_id;
    optionIds[g.name] = {};
    let order = 0;
    for (const [name, price] of g.options) {
      const use = USES[name];
      optionIds[g.name][name] = (await pool.query(
        `INSERT INTO modifiers (group_id, business_id, name, price_delta_paise, ingredient_product_id, ingredient_qty, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING modifier_id`,
        [groupIds[g.name], businessId, name, rupees(price), use ? ing[use[0]].id : null, use ? use[1] : null, order++])).rows[0].modifier_id;
    }
  }

  const dishes = [];
  for (const [name, category, price, popularity, tax, recipe, groups] of DISHES) {
    const id = await addProduct({ name, kind: 'DISH', category, price, tax, track: false });
    for (const [ingredient, qty, waste] of recipe) await pool.query(`INSERT INTO recipe_items (business_id, dish_product_id, ingredient_product_id, quantity, wastage_pct) VALUES ($1,$2,$3,$4,$5)`, [businessId, id, ing[ingredient].id, qty, waste]);
    for (const g of groups) await pool.query(`INSERT INTO product_modifier_groups (product_id, group_id) VALUES ($1,$2)`, [id, groupIds[g]]);
    dishes.push({ id, name, category, popularity, groups, price });
  }
  await pool.query(`UPDATE products SET food_type = CASE WHEN name ~* '(chicken)' THEN 'NON_VEG' WHEN name ~* '(egg|brownie|muffin|cheesecake|banana bread|croissant)' THEN 'EGG' ELSE 'VEG' END WHERE business_id = $1 AND kind = 'DISH'`, [businessId]);

  let so = 0;
  for (const [stationName, list] of Object.entries(STATIONS)) {
    const stationId = (await pool.query(`INSERT INTO kitchen_stations (business_id, name, sort_order) VALUES ($1,$2,$3) RETURNING station_id`, [businessId, stationName, ++so])).rows[0].station_id;
    for (const [dishName, minutes] of list) await pool.query(`UPDATE products SET station_id = $1, prep_minutes = $2 WHERE business_id = $3 AND name = $4`, [stationId, minutes, businessId, dishName]);
  }
  for (const [outletId, count] of [[outlets[0].id, 6], [outlets[1].id, 4]]) {
    const names = Array.from({ length: count }, (_, i) => [`T${i + 1}`, 'Indoor', i < 3 ? 2 : 4]);
    if (outletId === outlets[0].id) names.push(['P1', 'Patio', 4], ['P2', 'Patio', 4]);
    for (const [name, zone, seats] of names) await pool.query(`INSERT INTO dining_tables (business_id, branch_id, name, zone, seats, qr_token) VALUES ($1,$2,$3,$4,$5,$6)`, [businessId, outletId, name, zone, seats, [...Array(40)].map(() => Math.floor(rand() * 16).toString(16)).join('')]);
  }

  const customerIds = [];
  for (const name of CUSTOMERS) customerIds.push((await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [businessId, name, `9${int(600000000, 999999999)}`])).rows[0].customer_id);

  // the visit card: every 7th visit a free filter coffee; and two offers
  const filter = dishes.find((d) => d.name === 'Filter Coffee');
  await pool.query(`INSERT INTO loyalty_programs (business_id, is_enabled, visits_required, reward_product_id, reward_quantity, min_bill_paise) VALUES ($1,TRUE,7,$2,1,10000)`, [businessId, filter.id]);
  await pool.query(`INSERT INTO promotions (business_id, name, kind, category_id, percent, days_of_week, start_time, end_time, created_by) VALUES ($1,'Weekday happy hour: 20% off cold drinks','PERCENT_OFF',$2,20,ARRAY[1,2,3,4,5]::smallint[],'15:00','18:00',$3)`, [businessId, categoryIds['Cold Drinks'], staff.owner.userId]);
  const bakes = dishes.filter((d) => d.category === 'Bakes' && d.name !== 'Cheesecake Slice');
  const mix = (await pool.query(`INSERT INTO promotions (business_id, name, kind, bundle_qty, bundle_price_paise, created_by) VALUES ($1,'Any 2 bakes for ₹180','MIX_BUNDLE',2,$2,$3) RETURNING promo_id`, [businessId, rupees(180), staff.owner.userId])).rows[0].promo_id;
  for (const b of bakes) await pool.query(`INSERT INTO promotion_products (promo_id, product_id) VALUES ($1,$2)`, [mix, b.id]);

  // the days: a morning rush (8-10:30) and an evening one (4-8), weekends busier
  const HOURS = [[8, 7], [9, 10], [10, 6], [11, 4], [12, 5], [13, 6], [14, 4], [15, 6], [16, 9], [17, 10], [18, 9], [19, 6], [20, 3]];
  const sizeIds = optionIds.Size; const milkIds = optionIds.Milk; const sugarIds = optionIds.Sugar; const addIds = optionIds['Add-ons'];
  const makeOptions = (dish) => {
    const ids = [];
    if (dish.groups.includes('Size')) ids.push(sizeIds[weighted([['Small', 25], ['Regular', 55], ['Large', 20]])]);
    if (dish.groups.includes('Milk')) ids.push(milkIds[weighted([['Full cream', 50], ['Toned', 12], ['Oat', 24], ['Almond', 9], ['Soy', 5]])]);
    if (dish.groups.includes('Sugar')) ids.push(sugarIds[weighted([['Regular', 55], ['Less sugar', 30], ['No sugar', 15]])]);
    if (dish.groups.includes('Add-ons') && rand() < 0.16) ids.push(addIds[pick(Object.keys(addIds))]);
    return ids;
  };
  let bills = 0;
  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo--) {
    const dow = new Date(Date.now() - daysAgo * 86400000).getDay();
    const base = dow === 0 || dow === 6 ? 120 : 80;
    const count = Math.round(base * (0.85 + rand() * 0.3) * (daysAgo === 0 ? 0.45 : 1));
    for (let n = 0; n < count; n++) {
      const hour = weighted(HOURS);
      if (daysAgo === 0 && hour > new Date().getHours()) continue;
      const at = dayAt(daysAgo, hour, int(0, 59));
      const outlet = rand() < outlets[0].share ? outlets[0] : outlets[1];
      const seller = outlet === outlets[0] ? staff.barista.userId : staff.barista2.userId;
      const items = []; const used = new Set();
      for (let l = weighted([[1, 6], [2, 8], [3, 3], [4, 1]]); l > 0; l--) {
        const dish = weighted(dishes.map((d) => [d, d.popularity * (hour < 12 && d.category === 'Bakes' ? 1.3 : 1) * (hour >= 15 && d.category === 'Cold Drinks' ? 1.4 : 1)]));
        if (used.has(dish.id)) continue;
        used.add(dish.id);
        const options = makeOptions(dish);
        items.push({ product_id: dish.id, quantity: weighted([[1, 9], [2, 2]]), modifier_ids: options.length ? options : undefined });
      }
      if (!items.length) continue;
      const method = weighted([['UPI', 55], ['CASH', 22], ['CARD', 23]]);
      const client = await pool.connect();
      let invoice;
      try {
        await client.query('BEGIN');
        invoice = await createInvoiceInTransaction(client, outlet.tenant, seller, {
          customerId: rand() < 0.42 ? pick(customerIds) : undefined, items, invoiceDate: isoDate(at), applyPromotions: true, allowNegativeStock: true, payment: { method, amount: 0 }
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
  console.log(`seeded Brew & Bloom Café: ${bills} bills over ${DAYS} days, ${dishes.length} menu items, 2 outlets. Sign in: cafe@flowxp.test / ${PASSWORD}`);
  await pool.end();
};

main().catch((error) => { console.error(error); process.exit(1); });
