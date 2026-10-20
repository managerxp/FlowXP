/*
 * Builds auto parts shops for the parts tests and calls controllers the way the router would: a `req` with the tenant the auth middleware would have derived,
 * and a fake `res` that records the status and JSON body.
 */
import { fakeRes } from './gym.js';

export { fakeRes };
export { until } from './gym.js';

let seq = 0;
export const rs = (n) => Math.round(n * 100);

/** A parts shop: owner, outlet(s) (the first is the main outlet), GST on, GROWTH plan. */
export const makeShop = async (pool, label, { branches = 1, state = 'Karnataka', type = 'AUTO_PARTS' } = {}) => {
  seq += 1;
  const tag = `${label}${seq}`;
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [`Owner ${tag}`, `${tag}@parts.test`])).rows[0];
  const biz = (await pool.query(
    `INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state, subscription_status, plan_code, round_off_enabled)
     VALUES ($1,$2,$3,TRUE,$4,'ACTIVE','GROWTH',FALSE) RETURNING business_id`, [`Shop ${tag}`, user.user_id, type, state])).rows[0];
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'OWNER','ACTIVE')`, [biz.business_id, user.user_id]);
  const branchIds = [];
  for (let i = 0; i < branches; i++) {
    branchIds.push((await pool.query(`INSERT INTO branches (business_id, name, is_primary, state) VALUES ($1,$2,$3,$4) RETURNING branch_id`, [biz.business_id, i === 0 ? 'Main' : `Branch ${i + 1}`, i === 0, state])).rows[0].branch_id);
  }
  const tenantFor = (role = 'OWNER', { branchId = branchIds[0], permissions = {}, pinned = false, planFeatures = {}, userId = user.user_id } = {}) => ({
    businessId: biz.business_id, businessType: type, role, permissions, branchId, scopeBranchId: branchId, viewAll: false, pinned, planFeatures, userId,
    multiOutlet: branchIds.length > 1, name: `Shop ${tag}`
  });
  const allOutlets = (role = 'OWNER') => ({ ...tenantFor(role), scopeBranchId: null, viewAll: true });
  const shop = { tag, userId: user.user_id, businessId: biz.business_id, branchId: branchIds[0], branchIds, tenantFor, allOutlets };
  shop.req = (extra = {}, tenant = tenantFor()) => ({
    tenant, auth: { userId: tenant.userId ?? user.user_id, user: { name: `Owner ${tag}` } }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', get: () => undefined, ...extra
  });
  shop.call = async (handler, extra, tenant) => { const res = fakeRes(); await handler(shop.req(extra, tenant), res); return res; };
  return shop;
};

/** A part, straight into the tables (price in rupees, stock at the main outlet through the ledger). The controller path is tested separately. */
export const addPart = async (pool, shop, { name = 'Brake pad', sku = null, price = 500, cost = 300, tax = 18, stock = 0, branchId = shop.branchId, oem = null, mfr = null, category = null, minStock = 0 } = {}) => {
  seq += 1;
  const id = (await pool.query(
    `INSERT INTO products (business_id, name, sku, unit, selling_price_paise, purchase_price_paise, tax_rate, track_inventory, kind, min_stock, current_stock)
     VALUES ($1,$2,$3,'pc',$4,$5,$6,TRUE,'DISH',$7,$8) RETURNING product_id`, [shop.businessId, name, sku ?? `SKU-${seq}`, rs(price), rs(cost), tax, minStock, stock])).rows[0].product_id;
  if (stock) await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,$3)`, [branchId, id, stock]);
  await pool.query(`INSERT INTO autoparts_parts (product_id, business_id, oem_part_no, mfr_part_no) VALUES ($1,$2,$3,$4)`, [id, shop.businessId, oem, mfr]);
  for (const [n, kind] of [[oem, 'OEM'], [mfr, 'MFR']]) {
    if (n) await pool.query(`INSERT INTO autoparts_part_numbers (business_id, product_id, number, key, kind) VALUES ($1,$2,$3,$4,$5)`, [shop.businessId, id, n, n.toUpperCase().replace(/[^A-Z0-9]/g, ''), kind]);
  }
  void category;
  return id;
};
