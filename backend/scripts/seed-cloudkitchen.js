/*
 * Demo cloud kitchen: "Tandoor Box Cloud Kitchen", one kitchen, no dining room, delivery and takeaway only, with 21 days of trading.
 *
 *   npm run seed:cloudkitchen        (re-running replaces the demo cloud kitchen)
 *
 * A short menu in four categories, ten customers, and every bill goes through the real billing engine. Dishes are not stock-tracked (a cloud kitchen cooks to order).
 *
 * Sign in: cloudkitchen@flowxp.test / demo1234   (staff: cloudkitchen-manager@, cloudkitchen-kitchen@ and cloudkitchen-cashier@, same password)
 */
import './no-production.js'; // loads .env, and stops here in production
import bcrypt from 'bcryptjs';
import pool, { initializeDatabase } from '../src/config/database.js';
import { createInvoiceInTransaction } from '../src/modules/billing.js';

const DAYS = 21;
const PASSWORD = 'demo1234';
const mulberry32 = (seed) => () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rand = mulberry32(20261009);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const rupees = (n) => Math.round(n * 100);

// name, category, price ₹, popularity, GST %
const DISHES = [
  ['Butter Chicken Bowl', 'Bowls', 289, 12, 5], ['Paneer Tikka Bowl', 'Bowls', 249, 10, 5], ['Dal Makhani Bowl', 'Bowls', 219, 7, 5], ['Chicken Biryani', 'Bowls', 269, 14, 5], ['Veg Biryani', 'Bowls', 229, 7, 5],
  ['Chicken Tikka Roll', 'Rolls', 169, 11, 5], ['Paneer Kathi Roll', 'Rolls', 149, 9, 5], ['Egg Roll', 'Rolls', 119, 6, 5],
  ['Garlic Naan', 'Breads', 45, 10, 5], ['Butter Roti', 'Breads', 25, 8, 5], ['Laccha Paratha', 'Breads', 55, 5, 5],
  ['Gulab Jamun (2)', 'Desserts', 79, 7, 5], ['Phirni', 'Desserts', 89, 4, 5], ['Sweet Lassi', 'Desserts', 99, 5, 5], ['Masala Chaas', 'Desserts', 59, 6, 5]
];
const CUSTOMERS = [['Aarav Kulkarni', '9822001101'], ['Ritika Joshi', '9822001102'], ['Sameer Pathan', '9822001103'], ['Nisha Deshmukh', '9822001104'], ['Omkar Pawar', '9822001105'], ['Pooja Shinde', '9822001106'], ['Yash Gaikwad', '9822001107'], ['Tanvi Bhosale', '9822001108'], ['Rahul Naik', '9822001109'], ['Mrunal Kale', '9822001110']];

const dayAt = (daysAgo, hour, minute) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hour, minute, int(0, 59), 0); return d; };
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const weighted = (entries) => { const total = entries.reduce((s, [, w]) => s + w, 0); let r = rand() * total; for (const [v, w] of entries) { r -= w; if (r <= 0) return v; } return entries[entries.length - 1][0]; };
// lunch and dinner delivery peaks
const HOURS = [[12, 8], [13, 12], [14, 6], [15, 2], [19, 9], [20, 14], [21, 10], [22, 4]];

const main = async () => {
  await initializeDatabase();
  for (const { business_id } of (await pool.query(`SELECT business_id FROM businesses WHERE name = 'Tandoor Box Cloud Kitchen'`)).rows) await pool.query('DELETE FROM businesses WHERE business_id = $1', [business_id]);
  await pool.query(`DELETE FROM users WHERE email LIKE 'cloudkitchen%@flowxp.test'`);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const staff = {};
  for (const [key, email, name, role] of [['owner', 'cloudkitchen@flowxp.test', 'Vikram Sathe', 'OWNER'], ['manager', 'cloudkitchen-manager@flowxp.test', 'Anjali Rane', 'MANAGER'], ['kitchen', 'cloudkitchen-kitchen@flowxp.test', 'Ganesh More', 'KITCHEN'], ['cashier', 'cloudkitchen-cashier@flowxp.test', 'Sunita Jadhav', 'CASHIER']]) {
    staff[key] = { userId: (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ($1,$2,$3,TRUE) RETURNING user_id`, [name, email, hash])).rows[0].user_id, role };
  }
  const businessId = (await pool.query(
    `INSERT INTO businesses (name, business_type, owner_user_id, email, phone, address, city, state, gstin, gst_enabled, subscription_status, plan_code, billing_cycle, onboarding_step, upi_vpa)
     VALUES ('Tandoor Box Cloud Kitchen','CLOUD_KITCHEN',$1,'cloudkitchen@flowxp.test','9822000000','Plot 14, Baner Road','Pune','Maharashtra','27AABCT1234C1Z5',TRUE,'ACTIVE','ENTERPRISE','MONTHLY',10,'tandoorbox@okhdfcbank') RETURNING business_id`,
    [staff.owner.userId])).rows[0].business_id;
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, code, city, state, is_primary) VALUES ($1,'Baner Kitchen','BAN','Pune','Maharashtra',TRUE) RETURNING branch_id`, [businessId])).rows[0].branch_id;
  for (const s of Object.values(staff)) await pool.query(`INSERT INTO business_users (business_id, user_id, role) VALUES ($1,$2,$3)`, [businessId, s.userId, s.role]);
  const tenant = { businessId, branchId };

  const categoryIds = {};
  for (const name of ['Bowls', 'Rolls', 'Breads', 'Desserts']) categoryIds[name] = (await pool.query(`INSERT INTO categories (business_id, name) VALUES ($1,$2) RETURNING category_id`, [businessId, name])).rows[0].category_id;
  const dishes = [];
  for (const [name, category, price, popularity, tax] of DISHES) {
    const id = (await pool.query(
      `INSERT INTO products (business_id, category_id, name, kind, unit, selling_price_paise, purchase_price_paise, tax_rate, track_inventory, current_stock, min_stock)
       VALUES ($1,$2,$3,'DISH','pcs',$4,$5,$6,FALSE,0,0) RETURNING product_id`, [businessId, categoryIds[category], name, rupees(price), rupees(Math.round(price * 0.38)), tax])).rows[0].product_id;
    dishes.push({ id, popularity });
  }
  const customerIds = [];
  for (const [name, phone] of CUSTOMERS) customerIds.push((await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [businessId, name, phone])).rows[0].customer_id);

  let bills = 0;
  for (let daysAgo = DAYS; daysAgo >= 0; daysAgo--) {
    const dow = new Date(Date.now() - daysAgo * 86400000).getDay();
    const count = Math.round((dow === 0 || dow === 5 || dow === 6 ? 46 : 30) * (0.85 + rand() * 0.3) * (daysAgo === 0 ? 0.5 : 1));
    for (let n = 0; n < count; n++) {
      const hour = weighted(HOURS);
      if (daysAgo === 0 && hour > new Date().getHours()) continue;
      const at = dayAt(daysAgo, hour, int(0, 59));
      const items = []; const used = new Set();
      for (let l = weighted([[1, 5], [2, 8], [3, 5], [4, 2]]); l > 0; l--) {
        const dish = weighted(dishes.map((d) => [d, d.popularity]));
        if (used.has(dish.id)) continue;
        used.add(dish.id);
        items.push({ product_id: dish.id, quantity: weighted([[1, 8], [2, 3]]) });
      }
      const method = weighted([['UPI', 70], ['CARD', 15], ['CASH', 15]]);
      const client = await pool.connect();
      let invoice;
      try {
        await client.query('BEGIN');
        invoice = await createInvoiceInTransaction(client, tenant, staff.cashier.userId, { customerId: rand() < 0.5 ? pick(customerIds) : undefined, items, invoiceDate: isoDate(at), payment: { method, amount: 0 } });
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
      if (invoice.total > 0) {
        await pool.query(`INSERT INTO payments (business_id, branch_id, invoice_id, customer_id, payment_method, amount_paise, payment_date, created_by, created_at) SELECT business_id, branch_id, invoice_id, customer_id, $2, total_paise, $3::date, $4, $5 FROM invoices WHERE invoice_id = $1`, [invoice.invoice_id, method, isoDate(at), staff.cashier.userId, at]);
        await pool.query(`UPDATE invoices SET amount_paid_paise = total_paise, balance_due_paise = 0, payment_status = 'PAID' WHERE invoice_id = $1`, [invoice.invoice_id]);
      }
      await pool.query(`UPDATE invoices SET created_at = $2 WHERE invoice_id = $1`, [invoice.invoice_id, at]);
      bills++;
    }
  }
  console.log(`seeded Tandoor Box Cloud Kitchen: ${bills} bills over ${DAYS} days, ${dishes.length} dishes, 1 kitchen. Sign in: cloudkitchen@flowxp.test / ${PASSWORD}`);
  await pool.end();
};

main().catch((error) => { console.error(error); process.exit(1); });
