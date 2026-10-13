/*
 * Builds gaming lounges for the gaming tests and calls controllers the way the router would: a `req` with the tenant the auth middleware would
 * have derived, and a fake `res` that records the status and JSON body.
 */
import { fakeRes } from './gym.js';

export { fakeRes };
export { until } from './gym.js';

let seq = 0;

/** Rupees to paise, the way a person types it. */
export const rs = (n) => Math.round(n * 100);

/**
 * A lounge: owner, outlet(s), GST on, the business's timezone. `tenantFor(role, { branchId, pinned })` is the tenant for a person with that role at
 * an outlet; `allOutlets()` is an owner looking at every outlet.
 */
export const makeLounge = async (pool, label, { branches = 1, timezone = 'Asia/Kolkata', state = 'Karnataka', type = 'GAMING_CAFE' } = {}) => {
  seq += 1;
  const tag = `${label}${seq}`;
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [`Owner ${tag}`, `${tag}@lounge.test`])).rows[0];
  const biz = (await pool.query(
    `INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state, subscription_status, plan_code, round_off_enabled, timezone)
     VALUES ($1,$2,$3,TRUE,$4,'ACTIVE','GROWTH',FALSE,$5) RETURNING business_id`, [`Lounge ${tag}`, user.user_id, type, state, timezone])).rows[0];
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'OWNER','ACTIVE')`, [biz.business_id, user.user_id]);
  const branchIds = [];
  for (let i = 0; i < branches; i++) {
    branchIds.push((await pool.query(`INSERT INTO branches (business_id, name, is_primary, state) VALUES ($1,$2,$3,$4) RETURNING branch_id`, [biz.business_id, i === 0 ? 'Main' : `Branch ${i + 1}`, i === 0, state])).rows[0].branch_id);
  }
  const tenantFor = (role = 'OWNER', { branchId = branchIds[0], permissions = {}, pinned = false, planFeatures = {}, userId = user.user_id } = {}) => ({
    businessId: biz.business_id, businessType: type, role, permissions, branchId, scopeBranchId: branchId, viewAll: false, pinned, planFeatures, userId,
    multiOutlet: branchIds.length > 1, name: `Lounge ${tag}`
  });
  const allOutlets = (role = 'OWNER') => ({ ...tenantFor(role), scopeBranchId: null, viewAll: true });
  const lounge = { tag, userId: user.user_id, businessId: biz.business_id, branchId: branchIds[0], branchIds, tenantFor, allOutlets };
  lounge.req = (extra = {}, tenant = tenantFor()) => ({
    tenant, auth: { userId: tenant.userId ?? user.user_id, user: { name: `Owner ${tag}` } }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', get: () => undefined, ...extra
  });
  lounge.call = async (handler, extra, tenant) => { const res = fakeRes(); await handler(lensReq(lounge, extra, tenant), res); return res; };
  return lounge;
};

const lensReq = (lounge, extra, tenant) => lounge.req(extra, tenant);

/** A DISH on the menu (a drink, a snack), straight into the table. Price in rupees. */
export const addDish = async (pool, lounge, { name = 'Cold coffee', price = 120, tax = 5 } = {}) =>
  (await pool.query(
    `INSERT INTO products (business_id, name, unit, selling_price_paise, purchase_price_paise, tax_rate, track_inventory, kind) VALUES ($1,$2,'pc',$3,0,$4,FALSE,'DISH') RETURNING product_id`,
    [lounge.businessId, name, rs(price), tax])).rows[0].product_id;

export const iso = (ms) => new Date(ms).toISOString();

// Monday 12 October 2026, 10:00 in Kolkata
/* "Today" in the lounge's own calendar (Asia/Kolkata), at 10:00 local: invoices are dated by the real clock, so the sessions in these tests must fall on the real today. */
export const TODAY = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const T0 = Date.parse(`${TODAY}T04:30:00Z`);
export const at = (minutes, seconds = 0) => new Date(T0 + minutes * 60000 + seconds * 1000);
