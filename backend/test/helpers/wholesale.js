/*
 * Builds wholesalers for the wholesale tests and calls controllers the way the router would (a `req` with the tenant
 * the auth middleware would have derived, and a fake `res` that records the status and JSON body).
 */
import { fakeRes } from './salon.js';

export { fakeRes };
let seq = 0;

export const makeWholesaler = async (pool, label, { gst = true, branches = 1, state = 'Telangana', type = 'WHOLESALE' } = {}) => {
  seq += 1;
  const tag = `${label}${seq}`;
  const user = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [`Owner ${tag}`, `${tag}@wholesale.test`])).rows[0];
  const biz = (await pool.query(
    `INSERT INTO businesses (name, owner_user_id, business_type, gst_enabled, state, subscription_status, plan_code) VALUES ($1,$2,$3,$4,$5,'ACTIVE','GROWTH') RETURNING business_id`,
    [`Wholesale ${tag}`, user.user_id, type, gst, state])).rows[0];
  await pool.query(`INSERT INTO business_users (business_id, user_id, role, status) VALUES ($1,$2,'OWNER','ACTIVE')`, [biz.business_id, user.user_id]);
  const branchIds = [];
  for (let i = 0; i < branches; i++) {
    branchIds.push((await pool.query(`INSERT INTO branches (business_id, name, is_primary, state) VALUES ($1,$2,$3,$4) RETURNING branch_id`, [biz.business_id, i === 0 ? 'Main warehouse' : `Warehouse ${i + 1}`, i === 0, state])).rows[0].branch_id);
  }
  const tenantFor = (role = 'OWNER', { branchId = branchIds[0], permissions = {}, planFeatures = {}, userId = user.user_id, pinned = false } = {}) => ({
    businessId: biz.business_id, businessType: type, role, permissions, branchId, scopeBranchId: branchId, viewAll: false, pinned, planFeatures, userId,
    multiOutlet: branchIds.length > 1, name: `Wholesale ${tag}`
  });
  const w = { tag, userId: user.user_id, businessId: biz.business_id, branchId: branchIds[0], branchIds, tenantFor };
  w.req = (extra = {}, tenant = tenantFor()) => ({
    tenant, user: { userId: tenant.userId ?? user.user_id }, auth: { userId: tenant.userId ?? user.user_id, user: { name: `Owner ${tag}` } },
    params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', get: () => undefined, ...extra
  });
  w.call = async (handler, extra, tenant) => { const res = fakeRes(); await handler(w.req(extra, tenant), res); return res; };
  return w;
};

/** A product with stock at the main warehouse. Prices are in rupees. */
export const addProduct = async (pool, w, { name, unit = 'pcs', price = 100, cost = 60, tax = 18, stock = 0, mrp = null, moq = 1, units = [], batch = false, expiry = false, branchId = w.branchId, min = 0 } = {}) => {
  const id = (await pool.query(
    `INSERT INTO products (business_id, name, unit, selling_price_paise, purchase_price_paise, tax_rate, track_inventory, current_stock, min_stock, kind)
     VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$8,'DISH') RETURNING product_id`, [w.businessId, name, unit, Math.round(price * 100), Math.round(cost * 100), tax, stock, min])).rows[0].product_id;
  await pool.query(`INSERT INTO wholesale_item_details (product_id, business_id, mrp_paise, wholesale_price_paise, moq, batch_tracking, expiry_tracking) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, w.businessId, mrp == null ? null : Math.round(mrp * 100), Math.round(price * 100), moq, batch || expiry, expiry]);
  for (const u of units) await pool.query(`INSERT INTO wholesale_product_units (business_id, product_id, unit_name, factor) VALUES ($1,$2,$3,$4)`, [w.businessId, id, u.name, u.factor]);
  if (stock) await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,$3)`, [branchId, id, stock]);
  return id;
};

export const addCustomer = async (pool, w, { name = 'Sharma Traders', type = 'RETAILER', limit = 0, terms = null, state = 'Telangana', gstin = null, opening = 0, discount = 0 } = {}) => {
  const id = (await pool.query(`INSERT INTO customers (business_id, name, state, gstin, credit_limit_paise) VALUES ($1,$2,$3,$4,$5) RETURNING customer_id`, [w.businessId, name, state, gstin, Math.round(limit * 100)])).rows[0].customer_id;
  await pool.query(`INSERT INTO wholesale_customer_profiles (customer_id, business_id, customer_type, payment_terms_days, opening_balance_paise, default_discount_pct) VALUES ($1,$2,$3,$4,$5,$6)`, [id, w.businessId, type, terms, Math.round(opening * 100), discount]);
  return id;
};

export const addSupplier = async (pool, w, name = 'Acme Mills') => {
  const id = (await pool.query(`INSERT INTO suppliers (business_id, name) VALUES ($1,$2) RETURNING supplier_id`, [w.businessId, name])).rows[0].supplier_id;
  await pool.query(`INSERT INTO wholesale_supplier_profiles (supplier_id, business_id) VALUES ($1,$2)`, [id, w.businessId]);
  return id;
};

export const stockOf = async (pool, branchId, productId) => {
  const r = (await pool.query(`SELECT COALESCE(quantity, 0) AS q, COALESCE(reserved_qty, 0) AS r FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [branchId, productId])).rows[0];
  return { on_hand: Number(r?.q ?? 0), reserved: Number(r?.r ?? 0) };
};

/** Put a batch of a product on the shelf (the stock ledger and the batch table together). */
export const addBatch = async (pool, w, productId, { batchNo, qty, expiry = null, cost = 50, branchId = w.branchId } = {}) => {
  await pool.query(`INSERT INTO wholesale_batches (business_id, branch_id, product_id, batch_no, expiry_date, qty_on_hand, cost_paise) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [w.businessId, branchId, productId, batchNo, expiry, qty, Math.round(cost * 100)]);
  await pool.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,$3) ON CONFLICT (branch_id, product_id) DO UPDATE SET quantity = branch_stock.quantity + EXCLUDED.quantity`, [branchId, productId, qty]);
  await pool.query(`UPDATE products SET current_stock = current_stock + $2 WHERE product_id = $1`, [productId, qty]);
};

export const dayFromNow = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/**
 * A finished sale the way the product does it: order → confirm → pick → pack → dispatch. Returns { orderId, invoiceId, invoiceTotal (₹), deliveryId }.
 * `lines` are order lines; `dispatch` are dispatch options (payment, kind ...). Needs the controllers' env (call after setupTestDb).
 */
export const makeInvoice = async (w, { customer, lines, dispatch = {}, order = {} }) => {
  const { default: orders } = await import('../../src/controllers/wholesaleOrders.controller.js');
  const { default: ful } = await import('../../src/controllers/wholesaleFulfilment.controller.js');
  const made = await w.call(orders.create, { body: { customer_id: customer, lines, ...order } });
  if (made.code !== 201) throw new Error(`order: ${JSON.stringify(made.body)}`);
  const id = made.body.data.order_id;
  const c = await w.call(orders.confirm, { params: { id }, body: { credit_override: true, reason: 'test' } });
  if (c.code !== 200) throw new Error(`confirm: ${JSON.stringify(c.body)}`);
  const pl = await w.call(ful.createPick, { params: { id }, body: {} });
  if (pl.code !== 201) throw new Error(`pick: ${JSON.stringify(pl.body)}`);
  const pid = pl.body.data.pick_id;
  await w.call(ful.recordPick, { params: { id: pid }, body: { all: true } });
  await w.call(ful.pack, { params: { id: pid }, body: {} });
  const d = await w.call(ful.dispatch, { params: { id: pid }, body: dispatch });
  if (d.code !== 201) throw new Error(`dispatch: ${JSON.stringify(d.body)}`);
  return { orderId: id, invoiceId: d.body.data.invoice_id, invoiceTotal: d.body.data.invoice_total, deliveryId: d.body.data.delivery_id };
};

export const invoiceRow = async (pool, invoiceId) => (await pool.query(`SELECT total_paise, amount_paid_paise, balance_due_paise, payment_status, status FROM invoices WHERE invoice_id = $1`, [invoiceId])).rows[0];
