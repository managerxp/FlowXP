/*
 * Demo salon: "Glow Salon & Spa", with 45 days of realistic trading.
 *
 *   npm run seed:salon        (re-running replaces the demo salon)
 *
 * Bills go through the real salon billing engine (GST, stock use from service recipes, commission, loyalty,
 * memberships and packages), so every number on the screens is genuine; only the timestamps are back-dated.
 * Sign in: salon@flowxp.test / demo1234   (staff: salon-reception@flowxp.test, same password)
 */
import './no-production.js'; // loads .env, and stops here in production
import bcrypt from 'bcryptjs';
import pool, { initializeDatabase } from '../src/config/database.js';
import { createSalonInvoice } from '../src/modules/salon/pos.js';
import { fromLocal, localParts } from '../src/modules/salon/schedule.js';
import plansApi from '../src/controllers/salonPlans.controller.js';
import inventory from '../src/controllers/salonInventory.controller.js';
import { businessToday } from '../src/utils/dates.js';

const DAYS = 45;
const TZ = 'Asia/Kolkata';
const PASSWORD = 'demo1234';

const mulberry32 = (seed) => () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rand = mulberry32(20261003);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const weighted = (entries) => { const total = entries.reduce((s, [, w]) => s + w, 0); let r = rand() * total; for (const [v, w] of entries) { r -= w; if (r <= 0) return v; } return entries.at(-1)[0]; };
const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const isoDaysAgo = (n) => localParts(new Date(Date.now() - n * 86400000), TZ).date;

const SERVICES = [
  // name, category, price, minutes
  ['Haircut & Style', 'Hair', 600, 45], ['Kids Haircut', 'Hair', 350, 30], ['Beard Trim & Shape', 'Hair', 250, 20], ['Hair Colour (Global)', 'Hair', 2800, 120],
  ['Highlights', 'Hair', 3500, 150], ['Keratin Smoothing', 'Hair', 6500, 180], ['Hair Spa', 'Hair', 1400, 60], ['Blow Dry', 'Hair', 450, 30],
  ['Classic Facial', 'Skin', 1200, 60], ['Gold Glow Facial', 'Skin', 2200, 75], ['D-Tan Cleanup', 'Skin', 900, 40], ['Threading (Eyebrows)', 'Skin', 80, 10],
  ['Manicure', 'Nails', 650, 40], ['Pedicure', 'Nails', 850, 50], ['Gel Nail Extensions', 'Nails', 2400, 90],
  ['Swedish Massage (60 min)', 'Spa', 2500, 60], ['Head & Shoulder Massage', 'Spa', 800, 30], ['Bridal Makeup', 'Spa', 14000, 180]
];
const STAFF = [
  ['Meena Iyer', 'HAIR_STYLIST', 35, 5], ['Rahul Dsouza', 'BARBER', 30, 5], ['Sana Khan', 'BEAUTICIAN', 40, 8], ['Divya Menon', 'MAKEUP_ARTIST', 40, 5], ['Arjun Rao', 'THERAPIST', 35, 5]
];
const RETAIL = [
  // name, price, cost, stock, min, expiry days from today (null = none)
  ['Argan Shampoo 250ml', 650, 380, 90, 6, 420], ['Argan Conditioner 250ml', 700, 410, 70, 6, 420], ['Hair Serum 100ml', 850, 470, 40, 6, 300],
  ['Keratin Mask 200g', 1200, 700, 36, 5, 150], ['Sunscreen SPF 50', 560, 300, 50, 5, 60], ['Face Wash Gel 150ml', 420, 230, 45, 6, 25], ['Nail Polish (assorted)', 220, 110, 120, 10, null]
];
const CONSUMABLES = [
  ['Hair Colour Tube', 'g', 3.2, 6500, 600, 200], ['Developer 6%', 'ml', 0.9, 20000, 1500, 365], ['Facial Cream (pro)', 'g', 2.1, 4500, 400, 45], ['Massage Oil', 'ml', 0.8, 9000, 800, 500], ['Keratin Solution', 'ml', 4.5, 3000, 800, 120]
];
const CLIENTS = [
  'Aarti Nair', 'Priya Krishnan', 'Sneha Reddy', 'Kavya Shetty', 'Ananya Rao', 'Ishita Sharma', 'Meghna Das', 'Pooja Kulkarni', 'Neha Gupta', 'Riya Banerjee', 'Shruti Hegde', 'Tanvi Desai',
  'Divya Joshi', 'Lakshmi Pillai', 'Anjali Menon', 'Swati Mishra', 'Nisha Thomas', 'Rohan Mehta', 'Vikram Singh', 'Karthik Menon', 'Arun Pillai', 'Sameer Ghosh', 'Farhan Sheikh', 'Aditya Verma',
  'Bhavna Solanki', 'Madhuri Nambiar', 'Jyoti Pandey', 'Kritika Anand', 'Prerna Saxena', 'Sanya Malhotra'
];

const main = async () => {
  await initializeDatabase();
  for (const { business_id } of (await pool.query(`SELECT business_id FROM businesses WHERE name = 'Glow Salon & Spa'`)).rows) {
    // some rows point at products without a cascade: when the delete is refused, clear what the error names and retry
    for (let attempt = 0; attempt < 12; attempt++) {
      try { await pool.query('DELETE FROM businesses WHERE business_id = $1', [business_id]); break; } catch (error) {
        if (error.code !== '23503' || !error.constraint) throw error;
        const fk = (await pool.query(`SELECT c.conrelid::regclass::text AS tbl, a.attname AS col FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1] WHERE c.conname = $1`, [error.constraint])).rows[0];
        await pool.query(`DELETE FROM ${fk.tbl} WHERE ${fk.col} IN (SELECT product_id FROM products WHERE business_id = $1)`, [business_id]);
      }
    }
  }
  await pool.query(`DELETE FROM users WHERE email IN ('salon@flowxp.test','salon-shots@flowxp.test') OR email LIKE 'salon-reception@%'`);

  const hash = await bcrypt.hash(PASSWORD, 10);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ('Neha Kapoor','salon@flowxp.test',$1,TRUE) RETURNING user_id`, [hash])).rows[0].user_id;
  const reception = (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ('Tara Joseph','salon-reception@flowxp.test',$1,TRUE) RETURNING user_id`, [hash])).rows[0].user_id;
  const biz = (await pool.query(
    `INSERT INTO businesses (name, business_type, owner_user_id, email, phone, address, city, state, gstin, gst_enabled, subscription_status, plan_code, billing_cycle, onboarding_step, upi_vpa)
     VALUES ('Glow Salon & Spa','SALON',$1,'salon@flowxp.test','9876512345','24 Indiranagar 100 Feet Road','Bengaluru','Karnataka','29AABCG1234F1Z5',TRUE,'ACTIVE','ENTERPRISE','MONTHLY',10,'glowsalon@okhdfcbank') RETURNING business_id`, [owner])).rows[0].business_id;
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, code, city, state, is_primary) VALUES ($1,'Indiranagar','IND','Bengaluru','Karnataka',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'OWNER','ACTIVE'), ($1,$3,'RECEPTIONIST','ACTIVE')`, [biz, owner, reception]);
  await pool.query(`INSERT INTO salon_settings (business_id, default_service_tax_rate, default_product_tax_rate, default_service_sac) VALUES ($1,18,18,'999721')`, [biz]);
  const tenant = { businessId: biz, businessType: 'SALON', role: 'OWNER', permissions: {}, branchId, scopeBranchId: branchId, viewAll: false, pinned: false, planFeatures: {}, userId: owner, multiOutlet: false, name: 'Glow Salon & Spa' };
  const req = (body = {}, extra = {}) => ({ tenant, auth: { userId: owner, user: { name: 'Neha Kapoor' } }, params: {}, body, query: {}, headers: {}, ip: '127.0.0.1', get: () => undefined, ...extra });
  const call = async (handler, body, extra) => { const res = fakeRes(); await handler(req(body, extra), res); return res; };

  /* catalogue */
  const cats = {};
  for (const name of ['Hair', 'Skin', 'Nails', 'Spa']) cats[name] = (await pool.query(`INSERT INTO categories (business_id, name) VALUES ($1,$2) RETURNING category_id`, [biz, name])).rows[0].category_id;
  const services = {};
  for (const [name, cat, price, minutes] of SERVICES) {
    const id = (await pool.query(`INSERT INTO products (business_id, category_id, name, unit, selling_price_paise, tax_rate, track_inventory, kind) VALUES ($1,$2,$3,'visit',$4,18,FALSE,'SERVICE') RETURNING product_id`, [biz, cats[cat], name, price * 100])).rows[0].product_id;
    await pool.query(`INSERT INTO salon_item_details (product_id, business_id, item_type, duration_min) VALUES ($1,$2,'SERVICE',$3)`, [id, biz, minutes]);
    services[name] = { id, price, minutes, cat };
  }
  const staff = [];
  for (const [name, role, pct, productPct] of STAFF) {
    staff.push((await pool.query(
      `INSERT INTO salon_staff (business_id, branch_id, name, staff_role, commission_type, commission_value, product_commission_pct, is_bookable, joined_on) VALUES ($1,$2,$3,$4,'PERCENT',$5,$6,TRUE,CURRENT_DATE - 400) RETURNING staff_id`,
      [biz, branchId, name, role, pct, productPct])).rows[0].staff_id);
  }
  const skills = { Hair: [0, 1], Skin: [2], Nails: [2], Spa: [4, 3] };

  const addStock = async (name, kind, price, cost, stock, min, unit = 'pc') => {
    const id = (await pool.query(`INSERT INTO products (business_id, name, unit, selling_price_paise, purchase_price_paise, tax_rate, track_inventory, current_stock, min_stock, kind) VALUES ($1,$2,$3,$4,$5,18,TRUE,0,$6,$7) RETURNING product_id`,
      [biz, name, unit, Math.round(price * 100), Math.round(cost * 100), min, kind])).rows[0].product_id;
    return id;
  };
  const stockIn = async (productId, quantity, cost, expiryDays, batch) => {
    const r = fakeRes();
    await inventory.stockIn(req({ product_id: productId, quantity, unit_cost: cost, reason: 'OPENING', ...(batch ? { batch_no: batch } : {}), ...(expiryDays != null ? { expiry_date: isoDaysAgo(-expiryDays) } : {}) }), r);
    if (r.code >= 400) console.warn('stock in failed', r.body?.message);
  };
  const retail = {};
  for (const [name, price, cost, stock, min, expiry] of RETAIL) { const id = await addStock(name, 'DISH', price, cost, stock, min); await stockIn(id, stock, cost, expiry, `L${int(1000, 9999)}`); retail[name] = { id, price }; }
  const cons = {};
  for (const [name, unit, cost, stock, min, expiry] of CONSUMABLES) { const id = await addStock(name, 'INGREDIENT', 0, cost, stock, min, unit); await stockIn(id, stock, cost, expiry, `C${int(1000, 9999)}`); cons[name] = id; }
  // services use up consumables
  const recipe = (service, ingredient, qty, variable = false) => pool.query(`INSERT INTO recipe_items (business_id, dish_product_id, ingredient_product_id, quantity, is_variable) VALUES ($1,$2,$3,$4,$5)`, [biz, services[service].id, cons[ingredient], qty, variable]);
  await recipe('Hair Colour (Global)', 'Hair Colour Tube', 60, true); await recipe('Hair Colour (Global)', 'Developer 6%', 90, true); await recipe('Highlights', 'Hair Colour Tube', 40, true);
  await recipe('Classic Facial', 'Facial Cream (pro)', 25); await recipe('Gold Glow Facial', 'Facial Cream (pro)', 35); await recipe('Swedish Massage (60 min)', 'Massage Oil', 40); await recipe('Keratin Smoothing', 'Keratin Solution', 120, true);

  /* clients */
  const clients = [];
  for (const [i, name] of CLIENTS.entries()) clients.push((await pool.query(`INSERT INTO customers (business_id, name, phone, email) VALUES ($1,$2,$3,$4) RETURNING customer_id`, [biz, name, `98${int(10000000, 99999999)}`, i % 3 === 0 ? `${name.split(' ')[0].toLowerCase()}@example.com` : null])).rows[0].customer_id);

  /* memberships and packages */
  const planBody = { name: 'Glow Gold Membership', price: 4999, tax_rate: 18, duration_days: 365, benefits: { discount_pct: 15 } };
  const plan = await call(plansApi.createPlan, planBody);
  const plan2 = await call(plansApi.createPlan, { name: 'Glow Silver', price: 1999, tax_rate: 18, duration_days: 180, benefits: { discount_pct: 8 } });
  const pack = await call(plansApi.createPackage, { name: 'Facial Care x5', price: 5500, tax_rate: 18, validity_days: 180, items: [{ service_id: services['Classic Facial'].id, quantity: 5 }] });
  const pack2 = await call(plansApi.createPackage, { name: 'Pamper Pass (Hair Spa x3)', price: 3600, tax_rate: 18, validity_days: 120, items: [{ service_id: services['Hair Spa'].id, quantity: 3 }] });
  for (const r of [plan, plan2, pack, pack2]) if (r.code >= 400) console.warn('plan/package failed:', r.body?.message);
  const offers = [
    { name: 'First visit: 20% off services', discount_type: 'PERCENT', value: 20, applies_to: 'SERVICES', auto_apply: true, conditions: { first_visit: true } },
    { name: 'Facial Fridays: 10% off', code: 'GLOW10', discount_type: 'PERCENT', value: 10, applies_to: 'SERVICES', item_ids: [services['Classic Facial'].id, services['Gold Glow Facial'].id] },
    { name: 'Birthday treat: ₹300 off', discount_type: 'FIXED', value: 300, applies_to: 'ALL', conditions: { birthday: true, window_days: 7 }, auto_apply: true }
  ];
  for (const body of offers) { const r = await call(plansApi.createOffer, body); if (r.code >= 400) console.warn('offer failed:', r.body?.message); }

  /* bills */
  const sale = async (input) => {
    const c = await pool.connect();
    try { await c.query('BEGIN'); const out = await createSalonInvoice(c, tenant, owner, input, {}); await c.query('COMMIT'); return out; }
    catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e; } finally { c.release(); }
  };
  const backdate = async (invoiceId, daysAgo, hour) => {
    const date = isoDaysAgo(daysAgo);
    const at = fromLocal(date, hour * 60 + int(0, 59), TZ).toISOString();
    await pool.query(`UPDATE invoices SET invoice_date = $2::date, created_at = $3::timestamptz WHERE invoice_id = $1`, [invoiceId, date, at]);
    await pool.query(`UPDATE payments SET payment_date = $2::date, created_at = $3::timestamptz WHERE invoice_id = $1`, [invoiceId, date, at]);
    await pool.query(`UPDATE inventory_transactions SET created_at = $2::timestamptz WHERE reference_type = 'invoice' AND reference_id = $1`, [invoiceId, at]);
    await pool.query(`UPDATE salon_commissions SET earned_on = $2::date, created_at = $3::timestamptz WHERE invoice_id = $1`, [invoiceId, date, at]);
  };
  const stylistFor = (cat) => staff[pick(skills[cat])];
  const popular = Object.entries(services).map(([name, s]) => [name, s.price < 1000 ? 5 : s.price < 3000 ? 3 : 1]);

  // sell the memberships and packages early in the period, to different clients
  const sold = [[plan, 0], [plan, 1], [plan2, 2], [pack, 3], [pack, 4], [pack2, 5]];
  for (const [item, who] of sold) {
    if (item.code >= 400) continue;
    const d = item.body.data;
    const entry = d.plan_id ? { type: 'MEMBERSHIP', plan_id: d.plan_id } : { type: 'PACKAGE', package_id: d.package_id };
    try { const out = await sale({ customer_id: clients[who], items: [entry], payments: [{ method: 'UPI', amount: 'REST' }] }); await backdate(out.invoice.invoice_id, 30 - who, 12); }
    catch (e) { console.warn('could not sell', entry.type, e.message); }
  }

  let bills = 0;
  for (let ago = DAYS; ago >= 0; ago--) {
    const dow = localParts(new Date(Date.now() - ago * 86400000), TZ).isoDay;
    if (dow === 7) continue;                                          // closed on Sundays
    const count = ago === 0 ? int(5, 7) : dow >= 5 ? int(11, 16) : int(6, 10);
    for (let i = 0; i < count; i++) {
      const items = []; const n = weighted([[1, 5], [2, 4], [3, 1]]);
      for (let k = 0; k < n; k++) {
        const name = weighted(popular); const s = services[name];
        if (items.some((x) => x.service_id === s.id)) continue;
        items.push({ type: 'SERVICE', service_id: s.id, staff_id: stylistFor(s.cat) });
      }
      if (rand() < 0.22) { const p = pick(Object.values(retail)); items.push({ type: 'PRODUCT', product_id: p.id, quantity: 1, staff_id: staff[0] }); }
      const method = weighted([['UPI', 5], ['CARD', 3], ['CASH', 2]]);
      const client = rand() < 0.7 ? pick(clients) : null;
      try {
        const out = await sale({ ...(client ? { customer_id: client } : {}), items, payments: [{ method, amount: 'REST' }] });
        await backdate(out.invoice.invoice_id, ago, ago === 0 ? int(10, 11) : int(10, 19)); bills += 1;
      } catch (e) { if (!/Not enough stock/.test(e.message)) console.warn('bill skipped:', e.message); }
    }
  }
  // a couple of lines near their reorder level, so the alerts have something to say
  await pool.query(`UPDATE products SET min_stock = current_stock + 4 WHERE business_id = $1 AND name IN ('Hair Serum 100ml', 'Argan Conditioner 250ml')`, [biz]);
  // commission: approve the older weeks and pay one stylist's older ones, so the screen shows every state
  await pool.query(`UPDATE salon_commissions SET status = 'APPROVED', approved_by = $2, approved_at = created_at WHERE business_id = $1 AND earned_on < CURRENT_DATE - 14`, [biz, owner]);

  /* appointments: today around the clock, and the coming days */
  const nowParts = localParts(new Date(), TZ);
  const appt = async (dayOffset, hhmm, client, svcName, staffId, status = 'BOOKED', source = 'PHONE', guest = null) => {
    const s = services[svcName];
    const date = localParts(new Date(Date.now() + dayOffset * 86400000), TZ).date;
    const [h, m] = hhmm.split(':').map(Number);
    const start = fromLocal(date, h * 60 + m, TZ); const end = new Date(start.getTime() + s.minutes * 60000);
    const id = (await pool.query(
      `INSERT INTO salon_appointments (business_id, branch_id, customer_id, guest_name, start_at, end_at, status, source, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING appointment_id`,
      [biz, branchId, client ?? null, client ? null : guest, start.toISOString(), end.toISOString(), status, source, owner])).rows[0].appointment_id;
    await pool.query(`INSERT INTO salon_appointment_services (appointment_id, business_id, branch_id, service_id, staff_id, start_at, end_at, price_paise) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, biz, branchId, s.id, staffId, start.toISOString(), end.toISOString(), s.price * 100]);
    return id;
  };
  const [meena, rahul, sana, divya, arjun] = staff;
  const todays = [
    ['10:00', 0, 'Haircut & Style', meena, 'COMPLETED'], ['10:00', 1, 'Beard Trim & Shape', rahul, 'COMPLETED'], ['10:30', 2, 'Classic Facial', sana, 'COMPLETED'],
    ['11:00', 3, 'Hair Colour (Global)', meena, 'IN_SERVICE'], ['11:15', 4, 'Manicure', sana, 'IN_SERVICE'], ['11:30', 5, 'Head & Shoulder Massage', arjun, 'CHECKED_IN'],
    ['12:30', 6, 'Blow Dry', rahul, 'CONFIRMED'], ['13:00', 7, 'Gold Glow Facial', sana, 'CONFIRMED'], ['14:00', 8, 'Highlights', meena, 'BOOKED'], ['14:30', 9, 'Pedicure', sana, 'BOOKED'],
    ['15:00', 10, 'Swedish Massage (60 min)', arjun, 'CONFIRMED'], ['16:00', 11, 'Kids Haircut', rahul, 'BOOKED'], ['16:30', 12, 'Bridal Makeup', divya, 'CONFIRMED'], ['17:30', 13, 'Hair Spa', meena, 'BOOKED'],
    ['18:00', 14, 'Gel Nail Extensions', sana, 'BOOKED'], ['18:30', 15, 'Beard Trim & Shape', rahul, 'BOOKED']
  ];
  for (const [t, who, svc, st, status] of todays) await appt(0, t, clients[who], svc, st, status, who % 4 === 0 ? 'ONLINE' : 'PHONE');
  await appt(0, '12:00', null, 'Haircut & Style', rahul, 'BOOKED', 'WALK_IN', 'Walk-in guest');
  for (const [d, t, who, svc, st] of [[1, '10:30', 16, 'Haircut & Style', meena], [1, '11:00', 17, 'Beard Trim & Shape', rahul], [1, '12:00', 18, 'Classic Facial', sana], [1, '15:00', 19, 'Keratin Smoothing', meena],
    [2, '10:00', 20, 'Manicure', sana], [2, '13:00', 21, 'Swedish Massage (60 min)', arjun], [3, '11:00', 22, 'Bridal Makeup', divya], [3, '16:00', 23, 'Hair Colour (Global)', meena]]) await appt(d, t, clients[who], svc, st, 'BOOKED', d === 1 ? 'ONLINE' : 'PHONE');

  // attendance for today
  for (const s of staff) await pool.query(`INSERT INTO salon_attendance (business_id, branch_id, staff_id, work_date, status) VALUES ($1,$2,$3,CURRENT_DATE,'PRESENT') ON CONFLICT DO NOTHING`, [biz, branchId, s]).catch(() => {});

  console.log(`Glow Salon & Spa: ${SERVICES.length} services, ${STAFF.length} stylists, ${CLIENTS.length} clients, ${bills} bills over ${DAYS} days.\nSign in: salon@flowxp.test / ${PASSWORD}`);
  await pool.end();
};

main().catch((e) => { console.error(e); process.exit(1); });
