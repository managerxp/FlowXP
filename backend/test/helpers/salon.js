/*
 * Builds salons for the salon tests and calls controllers the way the router would: a `req` with the tenant
 * the auth middleware would have derived, and a fake `res` that records the status and JSON body.
 */
export const fakeRes = () => ({ code: 200, body: null, headers: {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

let seq = 0;

/**
 * A salon: owner, outlet(s), GST switched on (or off), salon settings row with defaults.
 * `tenantFor(role)` gives a tenant for someone with that role at an outlet.
 */
export const makeSalon = async (pool, label, { gst = true, branches = 1, state = 'Telangana' } = {}) => {
  seq += 1;
  const tag = `${label}${seq}`;
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [`Owner ${tag}`, `${tag}@salon.test`])).rows[0];
  const biz = (await pool.query(
    `INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state, subscription_status, plan_code) VALUES ($1,$2,'SALON',$3,$4,'ACTIVE','GROWTH') RETURNING business_id`,
    [`Salon ${tag}`, user.user_id, gst, state])).rows[0];
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'OWNER','ACTIVE')`, [biz.business_id, user.user_id]);
  const branchIds = [];
  for (let i = 0; i < branches; i++) {
    branchIds.push((await pool.query(`INSERT INTO branches (business_id, name, is_primary, state) VALUES ($1,$2,$3,$4) RETURNING branch_id`, [biz.business_id, i === 0 ? 'Main' : `Branch ${i + 1}`, i === 0, state])).rows[0].branch_id);
  }
  await pool.query(`INSERT INTO salon_settings (business_id) VALUES ($1)`, [biz.business_id]);

  const tenantFor = (role = 'OWNER', { branchId = branchIds[0], permissions = {}, pinned = false, planFeatures = {}, userId = user.user_id } = {}) => ({
    businessId: biz.business_id, businessType: 'SALON', role, permissions, branchId, scopeBranchId: pinned ? branchId : branchId, viewAll: false, pinned, planFeatures, userId,
    multiOutlet: branchIds.length > 1, name: `Salon ${tag}`
  });
  const salon = { tag, userId: user.user_id, businessId: biz.business_id, branchId: branchIds[0], branchIds, tenantFor };
  salon.req = (extra = {}, tenant = tenantFor()) => ({
    tenant, auth: { userId: tenant.userId ?? user.user_id, user: { name: `Owner ${tag}` } }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', get: () => undefined, ...extra
  });
  salon.call = async (handler, extra, tenant) => { const res = fakeRes(); await handler(salon.req(extra, tenant), res); return res; };
  return salon;
};

/* ── catalogue fixtures ───────────────────────────────────────────────────── */

export const addService = async (pool, salon, { name, price = 500, tax = 18, duration = 30, category = null, commission = null } = {}) => {
  const id = (await pool.query(
    `INSERT INTO products (business_id, category_id, name, unit, selling_price_paise, tax_rate, track_inventory, kind) VALUES ($1,$2,$3,'visit',$4,$5,FALSE,'SERVICE') RETURNING product_id`,
    [salon.businessId, category, name, Math.round(price * 100), tax])).rows[0].product_id;
  await pool.query(`INSERT INTO salon_item_details (product_id, business_id, item_type, duration_min, commission_type, commission_value) VALUES ($1,$2,'SERVICE',$3,$4,$5)`,
    [id, salon.businessId, duration, commission?.type ?? null, commission?.value ?? null]);
  return id;
};

/** A stocked item: a retail product (kind DISH) or a consumable (kind INGREDIENT), with stock at the main outlet. */
export const addStock = async (pool, salon, { name, kind = 'DISH', price = 0, cost = 0, tax = 18, stock = 0, min = 0, unit = 'pc', branchId = salon.branchId } = {}) => {
  const id = (await pool.query(
    `INSERT INTO products (business_id, name, unit, selling_price_paise, purchase_price_paise, tax_rate, track_inventory, current_stock, min_stock, kind) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$8,$9) RETURNING product_id`,
    [salon.businessId, name, unit, Math.round(price * 100), Math.round(cost * 100), tax, stock, min, kind])).rows[0].product_id;
  if (stock) await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,$3)`, [branchId, id, stock]);
  return id;
};

export const addRecipe = async (pool, salon, serviceId, ingredientId, quantity, { variable = false } = {}) =>
  pool.query(`INSERT INTO recipe_items (business_id, dish_product_id, ingredient_product_id, quantity, is_variable) VALUES ($1,$2,$3,$4,$5)`, [salon.businessId, serviceId, ingredientId, quantity, variable]);

export const addStaff = async (pool, salon, { name, type = 'PERCENT', value = 0, productPct = 0, branchId = salon.branchId, hours = null, bookable = true } = {}) =>
  (await pool.query(
    `INSERT INTO salon_staff (business_id, branch_id, name, commission_type, commission_value, product_commission_pct, working_hours, is_bookable) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING staff_id`,
    [salon.businessId, branchId, name, type, value, productPct, hours ? JSON.stringify(hours) : null, bookable])).rows[0].staff_id;

export const addClient = async (pool, salon, name = 'Asha', phone = null) =>
  (await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,$2,$3) RETURNING customer_id`, [salon.businessId, name, phone])).rows[0].customer_id;

export const stockOf = async (pool, branchId, productId) =>
  Number((await pool.query(`SELECT COALESCE(quantity, 0) AS q FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [branchId, productId])).rows[0]?.q ?? 0);

/** Run the salon sale inside its own transaction, the way the controller does, and return the result. */
export const sell = async (pool, createSalonInvoice, salon, input, { tenant = salon.tenantFor(), dryRun = false } = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await createSalonInvoice(client, tenant, salon.userId, input, { dryRun });
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};
