/*
 * Demo shop: "Vastra Fashions", Bengaluru. A clothing store with about 16 styles (men's, women's, kids', ethnic, footwear) in real size and colour grids, opening stock, a few
 * customers, and a month of sales through the real invoice engine (M and L and black and blue sell most, so the size and colour figures have something to say).
 *
 *   npm run seed:clothing        (re-running replaces the demo shop)
 *
 * Sign in: clothing@flowxp.test / demo1234   (staff: clothing-manager@ (manager), clothing-cashier@ (cashier), same password)
 */
import './no-production.js'; // loads .env, and stops here in production
import bcrypt from 'bcryptjs';
import pool, { initializeDatabase } from '../src/config/database.js';
import { createInvoiceInTransaction } from '../src/modules/billing.js';
import { inTx } from '../src/modules/clothing/common.js';
import * as styles from '../src/modules/clothing/styles.js';

const PASSWORD = 'demo1234';
const mulberry32 = (seed) => () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rand = mulberry32(20261103);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const dayAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

const LETTER = ['S', 'M', 'L', 'XL', 'XXL'];
const WAIST = ['28', '30', '32', '34', '36'];
const KIDS = ['2-3Y', '4-5Y', '6-7Y', '8-9Y'];
const SHOES = ['6', '7', '8', '9', '10'];
/* name, category, subcategory (a child of the category), gender, brand, fabric, fit, hsn, gst, mrp, price, cost, colours, sizes */
const STYLES = [
  ["Men's Cotton Round-Neck T-Shirt", "Men's Wear", 'T-Shirts', 'MEN', 'Urban Roots', 'Cotton', 'Regular', '6109', 5, 799, 599, 320, ['Black', 'White', 'Navy', 'Grey'], LETTER],
  ["Men's Oversized Graphic Tee", "Men's Wear", 'T-Shirts', 'MEN', 'Urban Roots', 'Cotton', 'Oversized', '6109', 5, 999, 749, 410, ['Black', 'Olive', 'Beige'], LETTER],
  ["Men's Slim-Fit Formal Shirt", "Men's Wear", 'Shirts', 'MEN', 'Raymond Studio', 'Cotton blend', 'Slim', '6205', 12, 1799, 1399, 760, ['White', 'Sky Blue', 'Grey'], ['38', '40', '42', '44']],
  ["Men's Stretch Slim Jeans", "Men's Wear", 'Jeans', 'MEN', 'Denimco', 'Denim', 'Slim', '6203', 12, 2199, 1699, 900, ['Blue', 'Black', 'Grey'], WAIST],
  ["Men's Chino Trousers", "Men's Wear", 'Trousers', 'MEN', 'Denimco', 'Cotton twill', 'Regular', '6203', 12, 1999, 1499, 780, ['Beige', 'Navy', 'Olive'], WAIST],
  ["Women's Printed Kurti", "Women's Wear", 'Kurtis', 'WOMEN', 'Jaipur Loom', 'Rayon', 'Straight', '6104', 5, 899, 699, 360, ['Maroon', 'Green', 'Pink', 'Yellow'], ['S', 'M', 'L', 'XL']],
  ["Women's High-Rise Skinny Jeans", "Women's Wear", 'Jeans', 'WOMEN', 'Denimco', 'Stretch denim', 'Skinny', '6204', 12, 2099, 1599, 850, ['Blue', 'Black'], ['26', '28', '30', '32', '34']],
  ["Women's Floral Midi Dress", "Women's Wear", 'Dresses', 'WOMEN', 'Aaira', 'Georgette', 'A-line', '6204', 12, 2499, 1899, 980, ['Red', 'Navy', 'Pink'], ['XS', 'S', 'M', 'L']],
  ["Women's Cotton Leggings", "Women's Wear", 'Leggings', 'WOMEN', 'Jaipur Loom', 'Cotton lycra', 'Slim', '6104', 5, 499, 399, 190, ['Black', 'White', 'Grey', 'Maroon'], ['S', 'M', 'L', 'XL']],
  ["Boys' Printed T-Shirt", "Kids' Wear", 'Boys', 'BOYS', 'Little Steps', 'Cotton', 'Regular', '6109', 5, 499, 349, 180, ['Blue', 'Red', 'Green'], KIDS],
  ["Girls' Frock", "Kids' Wear", 'Girls', 'GIRLS', 'Little Steps', 'Cotton', 'A-line', '6111', 5, 899, 649, 330, ['Pink', 'Yellow', 'Sky Blue'], KIDS],
  ["Men's Cotton Kurta", 'Ethnic Wear', 'Kurtas', 'MEN', 'Jaipur Loom', 'Cotton', 'Regular', '6105', 5, 1299, 999, 520, ['White', 'Maroon', 'Navy'], LETTER],
  ["Women's Silk Saree", 'Ethnic Wear', 'Sarees', 'WOMEN', 'Kanchi Weaves', 'Art silk', 'Free size', '5007', 5, 3499, 2799, 1700, ['Red', 'Green', 'Purple'], ['Free Size']],
  ["Men's Cotton Briefs (pack of 3)", 'Innerwear', 'Briefs', 'MEN', 'ComfortFit', 'Cotton', 'Regular', '6107', 5, 549, 449, 230, ['Black', 'Grey'], ['S', 'M', 'L', 'XL']],
  ["Men's Canvas Sneakers", 'Footwear', 'Casual', 'MEN', 'Stride', 'Canvas', 'Regular', '6404', 12, 1799, 1399, 720, ['White', 'Black', 'Navy'], SHOES],
  ["Men's Leather Belt", 'Accessories', 'Belts', 'MEN', 'Stride', 'Leather', 'Free size', '4203', 12, 899, 699, 330, ['Black', 'Brown'], ['Free Size']]
];

/* the shop's best sellers: these sizes and colours sell more often */
const WEIGHT_SIZE = { M: 4, L: 4, '32': 4, '34': 3, S: 2, XL: 2, '8': 3, '4-5Y': 3 };
const WEIGHT_COLOUR = { Black: 4, Blue: 3, Navy: 3, White: 3 };
const weighted = (variants) => {
  const bag = variants.flatMap((v) => Array(Math.max(1, (WEIGHT_SIZE[v.size] ?? 1) * (WEIGHT_COLOUR[v.colour] ?? 1))).fill(v));
  return pick(bag);
};

const main = async () => {
  await initializeDatabase();
  for (const { business_id } of (await pool.query(`SELECT business_id FROM businesses WHERE name = 'Vastra Fashions'`)).rows) await pool.query('DELETE FROM businesses WHERE business_id = $1', [business_id]);
  await pool.query(`DELETE FROM users WHERE email = 'clothing@flowxp.test' OR email LIKE 'clothing-%@flowxp.test'`);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const staff = {};
  for (const [key, email, name, role] of [['owner', 'clothing@flowxp.test', 'Kavya Reddy', 'OWNER'], ['manager', 'clothing-manager@flowxp.test', 'Imran Khan', 'MANAGER'], ['cashier', 'clothing-cashier@flowxp.test', 'Divya S', 'CASHIER']]) {
    staff[key] = { userId: (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ($1,$2,$3,TRUE) RETURNING user_id`, [name, email, hash])).rows[0].user_id, role };
  }
  const businessId = (await pool.query(
    `INSERT INTO businesses (name, business_type, owner_user_id, email, phone, address, city, state, gstin, gst_enabled, subscription_status, plan_code, billing_cycle, onboarding_step, round_off_enabled)
     VALUES ('Vastra Fashions','CLOTHING',$1,'clothing@flowxp.test','9845011111','88, Commercial Street','Bengaluru','Karnataka','29AABCV5678K1Z2',TRUE,'ACTIVE','ENTERPRISE','MONTHLY',10,FALSE) RETURNING business_id`,
    [staff.owner.userId])).rows[0].business_id;
  const store = (await pool.query(`INSERT INTO branches (business_id, name, is_primary, city, state) VALUES ($1,'Commercial Street',TRUE,'Bengaluru','Karnataka') RETURNING branch_id`, [businessId])).rows[0].branch_id;
  for (const [, { userId, role }] of Object.entries(staff)) await pool.query(`INSERT INTO business_users (business_id, user_id, role, status, branch_id) VALUES ($1,$2,$3,'ACTIVE',NULL)`, [businessId, userId, role]);
  const tenant = { businessId, branchId: store, scopeBranchId: store, userId: staff.manager.userId, role: 'MANAGER', permissions: {}, businessType: 'CLOTHING', planFeatures: {} };

  await styles.ensureCategories(pool, businessId);
  const sub = async (parent, name) => (await pool.query(
    `SELECT c.category_id FROM categories c JOIN categories p ON p.category_id = c.parent_id WHERE c.business_id = $1 AND p.name = $2 AND c.name = $3`, [businessId, parent, name])).rows[0]?.category_id
    ?? (await pool.query(`SELECT category_id FROM categories WHERE business_id = $1 AND name = $2`, [businessId, parent])).rows[0].category_id;

  let variantCount = 0;
  const all = [];
  for (const [name, category, subcat, gender, brand, fabric, fit, hsn, gst, mrp, price, cost, colours, sizes] of STYLES) {
    const stock = colours.flatMap((c) => sizes.map((s) => ({ colour: c, size: s, qty: rand() < 0.12 ? 0 : int(2, (WEIGHT_SIZE[s] ?? 1) * 5 + 4) })));
    const categoryId = await sub(category, subcat);
    const made = await inTx((db) => styles.createStyle(db, { tenant, userId: staff.manager.userId }, {
      name, category_id: categoryId, brand, gender, fabric, fit, hsn_sac: hsn, tax_rate: gst, mrp, selling_price: price, purchase_price: cost, reorder_level: 3, colours, sizes, stock, season: 'All season'
    }));
    variantCount += made.variants.length;
    all.push(...made.variants.map((v) => ({ product_id: v.product_id, colour: v.colour, size: v.size })));
  }

  const customers = [];
  for (const [name, phone] of [['Ananya Rao', '9880011111'], ['Rohit Nair', '9880022222'], ['Meera Iyer', '9880033333'], ['Walk-in customer', '9880044444']]) {
    customers.push((await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [businessId, name, phone])).rows[0].customer_id);
  }

  let bills = 0;
  for (let d = 30; d >= 0; d--) {
    for (let k = 0; k < int(4, 9); k++) {
      const items = [];
      const seen = new Set();
      for (let i = 0; i < int(1, 3); i++) { const v = weighted(all); if (!seen.has(v.product_id)) { seen.add(v.product_id); items.push({ product_id: v.product_id, quantity: int(1, 2) }); } }
      try {
        await inTx((db) => createInvoiceInTransaction(db, { businessId, branchId: store, businessType: 'CLOTHING' }, staff.cashier.userId, {
          customerId: rand() < 0.4 ? pick(customers) : null, items, invoiceDate: dayAgo(d), payment: { amount: 'FULL', method: pick(['CASH', 'UPI', 'UPI', 'CARD']) } }));
        bills += 1;
      } catch (e) { if (!/Not enough stock|insufficient|stock/i.test(e.message)) throw e; }
    }
  }
  /* Two suppliers who have delivered, so a supplier's "Styles bought" has something to show: the first half of the styles from one, the rest from the other, in two deliveries each. */
  const sups = [];
  for (const [name, phone] of [['Tiruppur Knits', '9845011111'], ['Jaipur Loom Traders', '9845022222']]) {
    sups.push((await pool.query(`INSERT INTO suppliers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING supplier_id`, [businessId, name, phone])).rows[0].supplier_id);
  }
  const bought = (await pool.query(
    `SELECT v.style_id, v.product_id, p.purchase_price_paise FROM clothing_variants v JOIN products p ON p.product_id = v.product_id WHERE v.business_id = $1 ORDER BY v.style_id, v.sort_order`, [businessId])).rows;
  const styleIds = [...new Set(bought.map((r) => r.style_id))];
  const half = Math.ceil(styleIds.length / 2);
  let n = 0;
  for (const [si, supplier] of sups.entries()) {
    for (const ago of [40, 12]) {
      const lines = bought.filter((r) => (si === 0 ? styleIds.indexOf(r.style_id) < half : styleIds.indexOf(r.style_id) >= half) && rand() < 0.7).map((r) => ({ ...r, qty: int(3, 12) }));
      const total = lines.reduce((t, l) => t + l.qty * Number(l.purchase_price_paise), 0);
      const po = (await pool.query(
        `INSERT INTO purchase_orders (business_id, branch_id, supplier_id, po_number, po_date, status, total_paise, balance_due_paise, payment_status) VALUES ($1,$2,$3,$4,$5,'RECEIVED',$6,0,'PAID') RETURNING po_id`,
        [businessId, store, supplier, `PO-DEMO-${++n}`, dayAgo(ago), total])).rows[0].po_id;
      for (const l of lines) await pool.query(`INSERT INTO purchase_order_items (po_id, product_id, description, quantity, received_quantity, unit_cost_paise, line_total_paise) VALUES ($1,$2,'Delivery',$3,$3,$4,$5)`, [po, l.product_id, l.qty, l.purchase_price_paise, l.qty * Number(l.purchase_price_paise)]);
    }
  }

  console.log(`Vastra Fashions ready: ${STYLES.length} styles, ${variantCount} variants, ${bills} bills.\nSign in as clothing@flowxp.test / ${PASSWORD}`);
  await pool.end();
};

main().catch((e) => { console.error(e); process.exit(1); });
