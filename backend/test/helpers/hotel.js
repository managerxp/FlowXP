/*
 * Builds a hotel for the hotel tests and calls controllers the way the router would: a `req` with the tenant the auth middleware would have
 * derived, and a fake `res` that records the status and JSON body.
 */
import { fakeRes } from './salon.js';

export { fakeRes };

let seq = 0;

export const makeHotel = async (pool, label, { gst = true, state = 'Karnataka' } = {}) => {
  seq += 1;
  const tag = `${label}${seq}`;
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [`Owner ${tag}`, `${tag}@hotel.test`])).rows[0];
  const biz = (await pool.query(
    `INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state, subscription_status, plan_code, round_off_enabled) VALUES ($1,$2,'HOTEL',$3,$4,'ACTIVE','GROWTH',FALSE) RETURNING business_id`,
    [`Hotel ${tag}`, user.user_id, gst, state])).rows[0];
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'OWNER','ACTIVE')`, [biz.business_id, user.user_id]);
  const branch = (await pool.query(`INSERT INTO branches (business_id, name, is_primary, state) VALUES ($1,'Main',TRUE,$2) RETURNING branch_id`, [biz.business_id, state])).rows[0];
  const tenantFor = (role = 'OWNER', { permissions = {}, userId = user.user_id } = {}) => ({
    businessId: biz.business_id, businessType: 'HOTEL', role, permissions, branchId: branch.branch_id, scopeBranchId: branch.branch_id, viewAll: false, pinned: false, planFeatures: {},
    userId, multiOutlet: false, name: `Hotel ${tag}`
  });
  const hotel = { tag, userId: user.user_id, businessId: biz.business_id, branchId: branch.branch_id, tenantFor };
  hotel.req = (extra = {}, tenant = tenantFor()) => ({
    tenant, auth: { userId: tenant.userId, user: { name: `Owner ${tag}` } }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', get: () => undefined, ...extra
  });
  hotel.call = async (handler, extra, tenant) => { const res = fakeRes(); await handler(hotel.req(extra, tenant), res); return res; };
  return hotel;
};
