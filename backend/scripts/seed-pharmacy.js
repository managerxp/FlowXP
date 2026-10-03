/*
 * Demo pharmacy: "City Care Pharmacy", with 45 days of realistic trading.
 *
 *   npm run seed:pharmacy        (re-running replaces the demo pharmacy)
 *
 * Stock arrives through goods receipts (batch and expiry captured), and every sale goes through the real pharmacy till
 * (FEFO batch picking, GST, stock), so the screens show genuine numbers. Planted on purpose: batches expiring this
 * month, one already expired, one quarantined and one recalled, prescription-only medicines, and serial-tracked devices.
 * Sign in: pharmacy@flowxp.test / demo1234   (staff: pharmacy-pharmacist@flowxp.test, same password)
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pool, { initializeDatabase } from '../src/config/database.js';
import { createPharmacySale } from '../src/modules/pharmacy/pos.js';
import grnApi from '../src/controllers/pharmacyGrn.controller.js';
import { localParts } from '../src/modules/salon/schedule.js';

const DAYS = 45;
const TZ = 'Asia/Kolkata';
const PASSWORD = 'demo1234';
const mulberry32 = (seed) => () => { let t = (seed += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const rand = mulberry32(20261004);
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const weighted = (entries) => { const total = entries.reduce((s, [, w]) => s + w, 0); let r = rand() * total; for (const [v, w] of entries) { r -= w; if (r <= 0) return v; } return entries.at(-1)[0]; };
const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });
const dayOffset = (n) => localParts(new Date(Date.now() + n * 86400000), TZ).date;

const CATS = ['Pain & Fever', 'Antibiotics', 'Diabetes', 'Heart & BP', 'Stomach', 'Vitamins', 'Cough & Cold', 'First Aid', 'Devices', 'Baby & Personal Care'];
// name, category, type, maker, mrp, cost, gst, strength, form, schedule, salt, rx, popularity
const MEDS = [
  ['Dolo 650 Tablet (15)', 'Pain & Fever', 'MEDICINE', 'Micro Labs', 33.5, 26, 12, '650 mg', 'Tablet', null, 'Paracetamol 650 mg', false, 9],
  ['Crocin Advance 500 (15)', 'Pain & Fever', 'MEDICINE', 'GSK', 20, 15.5, 12, '500 mg', 'Tablet', null, 'Paracetamol 500 mg', false, 6],
  ['Azithral 500 (5)', 'Antibiotics', 'MEDICINE', 'Alembic', 119.5, 92, 12, '500 mg', 'Tablet', 'H', 'Azithromycin 500 mg', true, 3],
  ['Augmentin 625 Duo (10)', 'Antibiotics', 'MEDICINE', 'GSK', 223, 172, 12, '625 mg', 'Tablet', 'H', 'Amoxicillin 500 mg + Clavulanic Acid 125 mg', true, 3],
  ['Clavam 625 (10)', 'Antibiotics', 'MEDICINE', 'Alkem', 205, 158, 12, '625 mg', 'Tablet', 'H', 'Amoxicillin + Clavulanic Acid', true, 2],
  ['Glycomet 500 SR (20)', 'Diabetes', 'MEDICINE', 'USV', 38, 29, 12, '500 mg', 'Tablet SR', 'H', 'Metformin 500 mg', true, 5],
  ['Atorva 10 (15)', 'Heart & BP', 'MEDICINE', 'Zydus', 95, 73, 12, '10 mg', 'Tablet', 'H', 'Atorvastatin 10 mg', true, 4],
  ['Telma 40 (15)', 'Heart & BP', 'MEDICINE', 'Glenmark', 190, 146, 12, '40 mg', 'Tablet', 'H', 'Telmisartan 40 mg', true, 4],
  ['Pan 40 (15)', 'Stomach', 'MEDICINE', 'Alkem', 155, 119, 12, '40 mg', 'Tablet', 'H', 'Pantoprazole 40 mg', true, 5],
  ['Okacet Cetirizine 10 (10)', 'Cough & Cold', 'MEDICINE', 'Cipla', 22, 16.5, 12, '10 mg', 'Tablet', null, 'Cetirizine 10 mg', false, 5],
  ['Benadryl Cough Syrup 100ml', 'Cough & Cold', 'MEDICINE', 'J&J', 118, 90, 12, '100 ml', 'Syrup', null, 'Diphenhydramine + Ammonium Chloride', false, 3],
  ['Shelcal 500 (15)', 'Vitamins', 'WELLNESS', 'Torrent', 118, 90, 12, '500 mg', 'Tablet', null, 'Calcium 500 mg + Vitamin D3', false, 4],
  ['Becosules Capsules (20)', 'Vitamins', 'WELLNESS', 'Pfizer', 45, 34, 12, null, 'Capsule', null, 'B-Complex with Vitamin C', false, 4],
  ['Electral ORS Powder (21g)', 'Stomach', 'MEDICINE', 'FDC', 21, 15.5, 5, '21 g', 'Powder', null, 'Oral Rehydration Salts', false, 5],
  ['Volini Pain Relief Gel 30g', 'Pain & Fever', 'MEDICINE', 'Sun Pharma', 99, 76, 12, '30 g', 'Gel', null, 'Diclofenac + Menthol', false, 3],
  ['Betadine Ointment 20g', 'First Aid', 'MEDICINE', 'Win-Medicare', 135, 104, 12, '5% w/w', 'Ointment', null, 'Povidone Iodine', false, 2]
];
const CONSUMABLES = [
  ['3-Ply Surgical Masks (50)', 'First Aid', 'CONSUMABLE', 'Healthgard', 150, 90, 12, true, 3], ['Hand Sanitizer 100ml', 'First Aid', 'PERSONAL_CARE', 'Dettol', 65, 46, 18, true, 3],
  ['Crepe Bandage 6cm', 'First Aid', 'CONSUMABLE', 'Jupiter', 55, 36, 12, false, 2], ['Cotton Roll 100g', 'First Aid', 'CONSUMABLE', 'Pure Care', 45, 30, 12, false, 2],
  ['Nitrile Gloves (50)', 'First Aid', 'CONSUMABLE', 'Safeguard', 480, 340, 12, true, 1]
];
const DEVICES = [
  ['Digital Thermometer', 'Devices', 'DEVICE', 'Dr Morepen', 249, 165, 12, 12, 2], ['BP Monitor HEM-7120', 'Devices', 'DEVICE', 'Omron', 1990, 1520, 12, 24, 1],
  ['Glucometer Active (kit)', 'Devices', 'DEVICE', 'Accu-Chek', 1150, 890, 12, 12, 1], ['Pulse Oximeter', 'Devices', 'DEVICE', 'Dr Trust', 1199, 820, 12, 12, 1]
];
const CUSTOMERS = ['Ramesh Kumar', 'Sunita Devi', 'Mohammed Irfan', 'Lakshmi Narayan', 'Geeta Sharma', 'Venkat Rao', 'Padma Reddy', 'Suresh Babu', 'Fatima Begum', 'Anil Gupta', 'Rekha Joshi', 'Satish Naidu',
  'Kamala Iyer', 'Prakash Jain', 'Salma Khan', 'Raju Yadav', 'Usha Rani', 'Harish Goud', 'Meera Pillai', 'Vijay Kumar'];

const main = async () => {
  await initializeDatabase();
  for (const { business_id } of (await pool.query(`SELECT business_id FROM businesses WHERE name = 'City Care Pharmacy'`)).rows) {
    // goods-receipt lines point at products with no cascade, so they go first
    await pool.query(`DELETE FROM wholesale_grn_items WHERE product_id IN (SELECT product_id FROM products WHERE business_id = $1)`, [business_id]);
    await pool.query('DELETE FROM businesses WHERE business_id = $1', [business_id]);
  }
  await pool.query(`DELETE FROM users WHERE email IN ('pharmacy@flowxp.test','pharmacy-ui@flowxp.test','pharmacy-pharmacist@flowxp.test')`);
  const hash = await bcrypt.hash(PASSWORD, 10);
  const owner = (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ('Rohit Verma','pharmacy@flowxp.test',$1,TRUE) RETURNING user_id`, [hash])).rows[0].user_id;
  const pharmacist = (await pool.query(`INSERT INTO users (name, email, password_hash, email_verified) VALUES ('Anita Rao','pharmacy-pharmacist@flowxp.test',$1,TRUE) RETURNING user_id`, [hash])).rows[0].user_id;
  const biz = (await pool.query(
    `INSERT INTO businesses (name, business_type, owner_user_id, email, phone, address, city, state, gstin, gst_enabled, subscription_status, plan_code, billing_cycle, onboarding_step)
     VALUES ('City Care Pharmacy','PHARMACY',$1,'pharmacy@flowxp.test','9876543210','Shop 4, Banjara Hills Road No. 12','Hyderabad','Telangana','36AABCC1234F1Z5',TRUE,'ACTIVE','ENTERPRISE','MONTHLY',10) RETURNING business_id`, [owner])).rows[0].business_id;
  const branchId = (await pool.query(`INSERT INTO branches (business_id, name, code, city, state, is_primary) VALUES ($1,'Banjara Hills','BH','Hyderabad','Telangana',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'OWNER','ACTIVE'), ($1,$3,'CASHIER','ACTIVE')`, [biz, owner, pharmacist]);
  const tenant = { businessId: biz, businessType: 'PHARMACY', role: 'OWNER', permissions: {}, branchId, scopeBranchId: branchId, viewAll: false, pinned: false, userId: owner, multiOutlet: false, name: 'City Care Pharmacy' };
  const req = (body = {}) => ({ tenant, auth: { userId: owner, user: { name: 'Rohit Verma' } }, params: {}, body, query: {}, headers: {}, ip: '127.0.0.1', get: () => undefined });
  const call = async (handler, body) => { const res = fakeRes(); await handler(req(body), res); return res; };

  const supplierIds = [];
  for (const name of ['MedPlus Distributors', 'Apollo Pharma Wholesale', 'Sri Venkateswara Agencies', 'Hyderabad Surgicals']) supplierIds.push((await pool.query(`INSERT INTO suppliers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING supplier_id`, [biz, name, `98${int(10000000, 99999999)}`])).rows[0].supplier_id);
  const cat = {};
  for (const name of CATS) cat[name] = (await pool.query(`INSERT INTO categories (business_id, name) VALUES ($1,$2) RETURNING category_id`, [biz, name])).rows[0].category_id;

  const add = async (p) => {
    const id = (await pool.query(
      `INSERT INTO products (business_id, category_id, supplier_id, name, unit, selling_price_paise, purchase_price_paise, tax_rate, track_inventory, current_stock, min_stock, hsn_sac)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,0,$9,$10) RETURNING product_id`,
      [biz, cat[p.cat], pick(supplierIds), p.name, p.unit || 'pcs', Math.round(p.mrp * 100), Math.round(p.cost * 100), p.gst, p.min || 20, p.hsn || '3004'])).rows[0].product_id;
    await pool.query(
      `INSERT INTO pharmacy_item_details (product_id, business_id, product_type, manufacturer, mrp_paise, batch_tracking, expiry_tracking, serial_tracking, prescription_required, fefo_required,
                                          warranty_applicable, warranty_months, schedule_class, salt_composition, strength, dosage_form)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [id, biz, p.type, p.maker, Math.round(p.mrp * 100), Boolean(p.batch), Boolean(p.expiry), Boolean(p.serial), Boolean(p.rx), Boolean(p.expiry), Boolean(p.warranty), p.warranty || null, p.schedule || null, p.salt || null, p.strength || null, p.form || null]);
    return id;
  };
  const products = [];
  for (const [name, c, type, maker, mrp, cost, gst, strength, form, schedule, salt, rx, pop] of MEDS) products.push({ id: await add({ name, cat: c, type, maker, mrp, cost, gst, strength, form, schedule, salt, rx, batch: true, expiry: true }), name, mrp, cost, pop, kind: 'med' });
  for (const [name, c, type, maker, mrp, cost, gst, expiry, pop] of CONSUMABLES) products.push({ id: await add({ name, cat: c, type, maker, mrp, cost, gst, batch: expiry, expiry, hsn: '3005' }), name, mrp, cost, pop, kind: 'cons', expiry });
  for (const [name, c, type, maker, mrp, cost, gst, warranty, pop] of DEVICES) products.push({ id: await add({ name, cat: c, type, maker, mrp, cost, gst, serial: true, warranty, hsn: '9018', min: 4 }), name, mrp, cost, pop, kind: 'device' });

  /* goods receipts: two or three deliveries per product, the earliest batch the nearest to expiry */
  const batchPlan = (kind) => (kind === 'med' ? [[int(9, 26), 140], [int(90, 200), 260], [int(380, 700), 260]] : [[int(150, 400), 220], [int(500, 800), 220]]);
  for (const p of products) {
    if (p.kind === 'device') {
      const r = await call(grnApi.createGRN, { supplier_id: pick(supplierIds), grn_date: dayOffset(-50), items: [{ product_id: p.id, received: 14, unit_cost: p.cost, serials: Array.from({ length: 14 }, (_, i) => `${p.name.slice(0, 3).toUpperCase()}${int(100000, 999999)}${i}`) }] });
      if (r.code >= 400) console.warn('device GRN failed:', p.name, r.body?.message);
      continue;
    }
    if (p.kind === 'cons' && !p.expiry) {
      const r = await call(grnApi.createGRN, { supplier_id: pick(supplierIds), grn_date: dayOffset(-50), items: [{ product_id: p.id, received: 300, unit_cost: p.cost }] });
      if (r.code >= 400) console.warn('GRN failed:', p.name, r.body?.message);
      continue;
    }
    const [first, ...later] = batchPlan(p.kind);
    for (const [i, [expiryDays, qty]] of [first, ...later].entries()) {
      const r = await call(grnApi.createGRN, { supplier_id: pick(supplierIds), grn_date: dayOffset(-(55 - i * 12)), items: [{ product_id: p.id, received: Math.round(qty * (0.4 + p.pop / 10)), unit_cost: p.cost, batch_no: `${p.name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()}${int(2400, 2699)}${String.fromCharCode(65 + i)}`, expiry_date: dayOffset(expiryDays) }] });
      if (r.code >= 400) console.warn('GRN failed:', p.name, r.body?.message);
    }
  }

  /* Planted after the sales history (back-dated sales would otherwise have sold them while they were still valid): batches
     expiring this month, one already expired, one quarantined, one recalled (stock the till must never sell), and the
     week's fresh deliveries. */
  const plant = async () => {
    const planted = [
      ['Dolo 650 Tablet (15)', 'DOLO2307X', -9, 'ACTIVE', 60], ['Shelcal 500 (15)', 'SHEL2306X', -20, 'ACTIVE', 35],
      ['Pan 40 (15)', 'PAN2311Q', 150, 'QUARANTINED', 40], ['Augmentin 625 Duo (10)', 'AUG2308R', 220, 'RECALLED', 30],
      ['Okacet Cetirizine 10 (10)', 'OKA2610B', 9, 'ACTIVE', 45], ['Dolo 650 Tablet (15)', 'DOLO2611B', 12, 'ACTIVE', 80], ['Electral ORS Powder (21g)', 'ORS2612B', 16, 'ACTIVE', 40],
      ['Pan 40 (15)', 'PAN2613C', 21, 'ACTIVE', 50], ['Benadryl Cough Syrup 100ml', 'BEN2614C', 27, 'ACTIVE', 30], ['Becosules Capsules (20)', 'BEC2615C', 38, 'ACTIVE', 60]
    ];
    for (const [name, batchNo, days, status, qty] of planted) {
      const p = products.find((x) => x.name === name);
      await pool.query(`INSERT INTO wholesale_batches (business_id, branch_id, product_id, batch_no, expiry_date, qty_on_hand, cost_paise, status, source) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'OPENING')`, [biz, branchId, p.id, batchNo, dayOffset(days), qty, Math.round(p.cost * 100), status]);
      await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,$3) ON CONFLICT (branch_id, product_id) DO UPDATE SET quantity = branch_stock.quantity + EXCLUDED.quantity`, [branchId, p.id, qty]);
      await pool.query(`UPDATE products SET current_stock = current_stock + $2 WHERE product_id = $1`, [p.id, qty]);
    }
    // this week's deliveries
    for (const [i, name] of ['Azithral 500 (5)', 'Glycomet 500 SR (20)', 'Telma 40 (15)', 'Crocin Advance 500 (15)'].entries()) {
      const p = products.find((x) => x.name === name);
      const r = await call(grnApi.createGRN, { supplier_id: supplierIds[i % supplierIds.length], grn_date: dayOffset(-i), items: [{ product_id: p.id, received: 120 + i * 40, unit_cost: p.cost, batch_no: `NEW${2700 + i}`, expiry_date: dayOffset(540 + i * 30) }] });
      if (r.code >= 400) console.warn('restock GRN failed:', name, r.body?.message);
    }
  };

  /* customers and sales */
  const customers = [];
  for (const name of CUSTOMERS) customers.push((await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [biz, name, `98${int(10000000, 99999999)}`])).rows[0].customer_id);
  const sellable = products.filter((p) => p.kind !== 'device');
  const devices = products.filter((p) => p.kind === 'device');
  const sell = async (input, daysAgo, hour) => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const out = await createPharmacySale(c, tenant, owner, input, {});
      const id = out.invoice?.invoice_id ?? out.invoice_id;
      const date = dayOffset(-daysAgo); const at = new Date(Date.now() - daysAgo * 86400000); at.setHours(hour, int(0, 59), 0, 0);
      await c.query(`UPDATE invoices SET invoice_date = $2::date, created_at = $3 WHERE invoice_id = $1`, [id, date, at.toISOString()]);
      await c.query(`UPDATE payments SET payment_date = $2::date, created_at = $3 WHERE invoice_id = $1`, [id, date, at.toISOString()]);
      await c.query(`UPDATE inventory_transactions SET created_at = $2 WHERE reference_type = 'invoice' AND reference_id = $1`, [id, at.toISOString()]);
      await c.query('COMMIT');
      return true;
    } catch (e) { await c.query('ROLLBACK').catch(() => {}); if (!/Not enough|expired|short/i.test(e.message)) console.warn('sale skipped:', e.message); return false; } finally { c.release(); }
  };
  let bills = 0;
  for (let ago = DAYS; ago >= 0; ago--) {
    const count = int(14, 26);
    for (let i = 0; i < count; i++) {
      const items = [];
      for (let k = weighted([[1, 4], [2, 4], [3, 2]]); k > 0; k--) {
        const p = weighted(sellable.map((x) => [x, x.pop]));
        if (items.some((x) => x.product_id === p.id)) continue;
        items.push({ product_id: p.id, quantity: p.kind === 'cons' ? 1 : int(1, 3) });
      }
      if (rand() < 0.03) items.push({ product_id: pick(devices).id, quantity: 1 });
      const method = weighted([['UPI', 5], ['CASH', 4], ['CARD', 2]]);
      if (await sell({ items, payment: { amount: 'FULL', method }, ...(rand() < 0.45 ? { customerId: pick(customers) } : {}), invoiceDate: dayOffset(-ago) }, ago, int(9, 21))) bills += 1;
    }
  }
  await plant();
  // a few products near their reorder level, one out of stock, so the dashboard has something to say
  await pool.query(`UPDATE products SET min_stock = current_stock + 15 WHERE business_id = $1 AND name IN ('Telma 40 (15)', 'Becosules Capsules (20)', 'Betadine Ointment 20g', 'Crepe Bandage 6cm')`, [biz]);

  console.log(`City Care Pharmacy: ${products.length} products, ${bills} bills over ${DAYS} days.\nSign in: pharmacy@flowxp.test / ${PASSWORD}`);
  await pool.end();
};

main().catch((e) => { console.error(e); process.exit(1); });
