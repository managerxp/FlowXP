/*
 * Builds gyms for the gym tests and calls controllers the way the router would: a `req` with the tenant the auth middleware would have derived,
 * and a fake `res` that records the status and JSON body.
 */
export const fakeRes = () => ({
  code: 200, body: null, headers: {}, text: null, cookies: {},
  status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set(k, v) { if (typeof k === 'string') this.headers[k] = v; return this; }, send(t) { this.text = t; return this; },
  cookie(name, value, options) { this.cookies[name] = { value, options }; return this; }, clearCookie(name) { delete this.cookies[name]; this.cleared = name; return this; }
});

let seq = 0;

/**
 * A gym: owner, outlet(s), GST on, the business's timezone, gym settings with defaults.
 * `tenantFor(role, { branchId, pinned, permissions })` is the tenant for a person with that role at an outlet.
 */
export const makeGym = async (pool, label, { branches = 1, timezone = 'Asia/Kolkata', state = 'Karnataka', settings = {} } = {}) => {
  seq += 1;
  const tag = `${label}${seq}`;
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [`Owner ${tag}`, `${tag}@gym.test`])).rows[0];
  const biz = (await pool.query(
    `INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state, subscription_status, plan_code, round_off_enabled, timezone)
     VALUES ($1,$2,'GYM',TRUE,$3,'ACTIVE','GROWTH',FALSE,$4) RETURNING business_id`, [`Gym ${tag}`, user.user_id, state, timezone])).rows[0];
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'OWNER','ACTIVE')`, [biz.business_id, user.user_id]);
  const branchIds = [];
  for (let i = 0; i < branches; i++) {
    branchIds.push((await pool.query(`INSERT INTO branches (business_id, name, is_primary, state) VALUES ($1,$2,$3,$4) RETURNING branch_id`, [biz.business_id, i === 0 ? 'Main' : `Branch ${i + 1}`, i === 0, state])).rows[0].branch_id);
  }
  await pool.query(`INSERT INTO gym_settings (business_id) VALUES ($1)`, [biz.business_id]);
  const keys = Object.keys(settings);
  if (keys.length) await pool.query(`UPDATE gym_settings SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE business_id = $1`, [biz.business_id, ...keys.map((k) => settings[k])]);

  const tenantFor = (role = 'OWNER', { branchId = branchIds[0], permissions = {}, pinned = false, planFeatures = {}, userId = user.user_id } = {}) => ({
    businessId: biz.business_id, businessType: 'GYM', role, permissions, branchId, scopeBranchId: pinned ? branchId : branchId, viewAll: false, pinned, planFeatures, userId,
    multiOutlet: branchIds.length > 1, name: `Gym ${tag}`
  });
  // an owner viewing every outlet has no outlet scope
  const allOutlets = (role = 'OWNER') => ({ ...tenantFor(role), scopeBranchId: null, viewAll: true });
  const gym = { tag, userId: user.user_id, businessId: biz.business_id, branchId: branchIds[0], branchIds, tenantFor, allOutlets };
  gym.req = (extra = {}, tenant = tenantFor()) => ({
    tenant, auth: { userId: tenant.userId ?? user.user_id, user: { name: `Owner ${tag}` } }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', get: () => undefined, ...extra
  });
  gym.call = async (handler, extra, tenant) => { const res = fakeRes(); await handler(gym.req(extra, tenant), res); return res; };
  return gym;
};

/** A plan, straight into the table (the controller path is tested separately). Prices are rupees. */
export const addPlan = async (pool, gym, over = {}) => {
  const p = { name: 'Monthly', duration: 30, price: 1000, tax: 18, policy: 'FULL_REQUIRED', payLater: 0, grace: null, branches: null, window: null, freeze: true, maxFreeze: 30, members: 1, ...over };
  return (await pool.query(
    `INSERT INTO gym_plans (business_id, name, duration_days, price_paise, tax_rate, payment_policy, pay_later_days, grace_days, allowed_branch_ids, time_window, freeze_allowed, max_freeze_days, max_members, audience)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING plan_id`,
    [gym.businessId, p.name, p.duration, Math.round(p.price * 100), p.tax, p.policy, p.payLater, p.grace, p.branches, p.window ? JSON.stringify(p.window) : null, p.freeze, p.maxFreeze, p.members, p.members > 1 ? 'FAMILY' : 'STANDARD'])).rows[0].plan_id;
};

/** A member, straight into the tables. */
export const addMember = async (pool, gym, { name = 'Asha', phone = null, status = 'ACTIVE', branchId = gym.branchId, head = null } = {}) => {
  const customer = (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [gym.businessId, name, phone])).rows[0].customer_id;
  const code = `T-${String(++seq).padStart(5, '0')}`;
  return (await pool.query(
    `INSERT INTO gym_members (business_id, customer_id, branch_id, member_code, status, head_member_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING member_id`,
    [gym.businessId, customer, branchId, code, status, head])).rows[0].member_id;
};

/** A membership, straight into the table, without an invoice (COMPED), unless an invoice id is given. Dates are YYYY-MM-DD. */
export const addMembership = async (pool, gym, memberId, { start, end, planName = 'Test plan', status = 'ACTIVE', invoiceId = null, policy = 'FULL_REQUIRED', payLaterUntil = null, branches = null, window = null, grace = null, members = 1, basis = null, price = 1000 } = {}) =>
  (await pool.query(
    `INSERT INTO gym_memberships (business_id, member_id, branch_id, plan_name, start_date, end_date, status, price_paise, allowed_branch_ids, time_window, grace_days, payment_policy, pay_later_until, max_members, payment_basis, invoice_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING membership_id`,
    [gym.businessId, memberId, gym.branchId, planName, start, end, status, Math.round(price * 100), branches, window ? JSON.stringify(window) : null, grace, policy, payLaterUntil, members, basis || (invoiceId ? 'INVOICE' : 'COMPED'), invoiceId])).rows[0].membership_id;

/** The gym's local day-after-N from a base, as YYYY-MM-DD. */
export const day = (base, n = 0) => new Date(new Date(`${base}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

export const until = async (fn, { tries = 60, wait = 50 } = {}) => {
  for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, wait)); }
  return null;
};
