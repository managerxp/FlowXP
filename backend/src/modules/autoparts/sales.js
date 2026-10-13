/*
 * Selling parts: holding stock for a customer (reservations), trade price lists, customer classes and credit limits.
 *
 * Reservations. branch_stock.reserved_qty is the total held at an outlet (the same column wholesale uses) and bin_stock.reserved_qty is the part of it sitting in bins.
 * Available to sell = on hand - reserved. A customer's own open reservation counts as available to THEM, and is used up when they are billed (fulfilForSale).
 * Reserve and release lock the outlet's stock row, so two people cannot hold the last unit.
 *
 * Credit. A garage buys on account with the "pay later" part of a bill (never the CREDIT payment method, which marks a bill paid). Exposure is what the customer's issued
 * invoices still owe. Policy BLOCK refuses a bill that takes them over their limit (billing.js calls enforceCredit), WARN lets it through and says so (checkCredit, which the till
 * calls before billing), OFF ignores the limit. A limit of 0 means none.
 */
import { PartsError, bool, int, money, num, oneOf, text, withRupees } from './common.js';

const q3 = (n) => Math.round(Number(n) * 1000) / 1000;
export const CLASSES = ['RETAIL', 'WORKSHOP', 'GARAGE', 'FLEET', 'WHOLESALE'];

/* -- reservations ------------------------------------------------------ */

export const reservedMap = async (db, branchId, productIds, customerId = null) => {
  const out = new Map(productIds.map((id) => [Number(id), { reserved: 0, own: 0 }]));
  if (!productIds.length) return out;
  for (const r of (await db.query(`SELECT product_id, reserved_qty FROM branch_stock WHERE branch_id = $1 AND product_id = ANY($2::int[])`, [branchId, productIds])).rows) out.get(r.product_id).reserved = Number(r.reserved_qty);
  if (customerId) {
    for (const r of (await db.query(
      `SELECT product_id, SUM(qty - qty_fulfilled) AS n FROM part_reservations WHERE branch_id = $1 AND customer_id = $2 AND status = 'OPEN' AND product_id = ANY($3::int[]) GROUP BY product_id`, [branchId, customerId, productIds])).rows) out.get(r.product_id).own = Number(r.n);
  }
  return out;
};

const bump = async (db, branchId, productId, by) => {
  // bins hold part of the reservation: take (or give back) from bins, primary and fullest first
  const bins = (await db.query(`SELECT location_id, qty, reserved_qty FROM bin_stock WHERE branch_id = $1 AND product_id = $2 ORDER BY is_primary DESC, qty DESC, location_id FOR UPDATE`, [branchId, productId])).rows;
  let left = Math.abs(by);
  for (const b of bins) {
    if (left <= 0) break;
    const room = by > 0 ? q3(Number(b.qty) - Number(b.reserved_qty)) : Number(b.reserved_qty);
    const use = Math.min(room, left);
    if (use > 0) { await db.query(`UPDATE bin_stock SET reserved_qty = reserved_qty + $3 WHERE location_id = $1 AND product_id = $2`, [b.location_id, productId, by > 0 ? use : -use]); left = q3(left - use); }
  }
};

export const reserve = async (db, tenant, userId, b) => {
  const productId = int(b.product_id, 'Part', { min: 1, required: true });
  const qty = q3(num(b.qty, 'Quantity', { min: 0.001, max: 100000000, required: true }));
  const branchId = tenant.scopeBranchId ?? tenant.branchId;
  if (!(await db.query(`SELECT 1 FROM products WHERE product_id = $1 AND business_id = $2 FOR NO KEY UPDATE`, [productId, tenant.businessId])).rowCount) throw new PartsError(404, 'Not found');
  let customerId = null;
  if (b.customer_id) {
    customerId = int(b.customer_id, 'Customer', { min: 1 });
    if (!(await db.query(`SELECT 1 FROM customers WHERE customer_id = $1 AND business_id = $2`, [customerId, tenant.businessId])).rowCount) throw new PartsError(404, 'Not found');
  }
  await db.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,0) ON CONFLICT DO NOTHING`, [branchId, productId]);
  const row = (await db.query(`SELECT quantity, reserved_qty FROM branch_stock WHERE branch_id = $1 AND product_id = $2 FOR UPDATE`, [branchId, productId])).rows[0];
  const free = Math.max(0, q3(Number(row.quantity) - Number(row.reserved_qty)));
  if (qty > free) throw new PartsError(409, `Only ${free} of this part is free to hold (${Number(row.reserved_qty)} is already held)`);
  await db.query(`UPDATE branch_stock SET reserved_qty = reserved_qty + $3 WHERE branch_id = $1 AND product_id = $2`, [branchId, productId, qty]);
  await bump(db, branchId, productId, qty);
  const r = (await db.query(
    `INSERT INTO part_reservations (business_id, branch_id, product_id, customer_id, qty, expires_on, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [tenant.businessId, branchId, productId, customerId, qty, b.expires_on || null, text(b.note, 'Note', { max: 200 }), userId])).rows[0];
  return { ...r, qty: Number(r.qty), qty_fulfilled: Number(r.qty_fulfilled) };
};

export const release = async (db, tenant, id, status = 'RELEASED') => {
  const r = (await db.query(`SELECT * FROM part_reservations WHERE reservation_id = $1 AND business_id = $2 FOR UPDATE`, [Number(id), tenant.businessId])).rows[0];
  if (!r || (tenant.scopeBranchId != null && r.branch_id !== tenant.scopeBranchId)) throw new PartsError(404, 'Not found');
  if (r.status !== 'OPEN') throw new PartsError(409, 'That hold is already closed');
  const open = q3(Number(r.qty) - Number(r.qty_fulfilled));
  await db.query(`SELECT 1 FROM products WHERE product_id = $1 FOR NO KEY UPDATE`, [r.product_id]);
  await db.query(`SELECT 1 FROM branch_stock WHERE branch_id = $1 AND product_id = $2 FOR UPDATE`, [r.branch_id, r.product_id]);
  await db.query(`UPDATE branch_stock SET reserved_qty = GREATEST(0, reserved_qty - $3) WHERE branch_id = $1 AND product_id = $2`, [r.branch_id, r.product_id, open]);
  await bump(db, r.branch_id, r.product_id, -open);
  await db.query(`UPDATE part_reservations SET status = $2, closed_at = now() WHERE reservation_id = $1`, [r.reservation_id, status]);
  return { reservation_id: r.reservation_id, status };
};

/** Close holds that have passed their date (called when listing, so nothing stays held forever). */
export const expireOld = async (db, tenant) => {
  const due = (await db.query(`SELECT reservation_id FROM part_reservations WHERE business_id = $1 AND status = 'OPEN' AND expires_on < CURRENT_DATE LIMIT 50`, [tenant.businessId])).rows;
  for (const d of due) await release(db, tenant, d.reservation_id, 'EXPIRED').catch(() => {});
};

export const listReservations = async (db, tenant, { status = 'OPEN', customerId = null } = {}) => {
  const params = [tenant.businessId, String(status).toUpperCase()];
  let where = 'r.business_id = $1 AND r.status = $2';
  if (tenant.scopeBranchId != null) { params.push(tenant.scopeBranchId); where += ` AND r.branch_id = $${params.length}`; }
  if (customerId) { params.push(Number(customerId)); where += ` AND r.customer_id = $${params.length}`; }
  return (await db.query(
    `SELECT r.*, p.name AS part, p.sku, c.name AS customer FROM part_reservations r JOIN products p ON p.product_id = r.product_id LEFT JOIN customers c ON c.customer_id = r.customer_id WHERE ${where} ORDER BY r.reservation_id DESC LIMIT 300`, params))
    .rows.map((r) => ({ ...r, qty: Number(r.qty), qty_fulfilled: Number(r.qty_fulfilled), open_qty: q3(Number(r.qty) - Number(r.qty_fulfilled)) }));
};

/** Used by billing, under the product row lock: the customer's own holds are used up first, oldest first. */
export const fulfilForSale = async (client, { branchId, customerId, productId, qty }) => {
  if (!customerId) return 0;
  const rows = (await client.query(
    `SELECT reservation_id, qty, qty_fulfilled FROM part_reservations WHERE branch_id = $1 AND customer_id = $2 AND product_id = $3 AND status = 'OPEN' ORDER BY reservation_id FOR UPDATE`, [branchId, customerId, productId])).rows;
  let left = q3(qty); let used = 0;
  for (const r of rows) {
    if (left <= 0) break;
    const open = q3(Number(r.qty) - Number(r.qty_fulfilled));
    const take = Math.min(open, left);
    const done = q3(Number(r.qty_fulfilled) + take);
    await client.query(`UPDATE part_reservations SET qty_fulfilled = $2, status = CASE WHEN $2 >= qty THEN 'FULFILLED' ELSE 'OPEN' END, closed_at = CASE WHEN $2 >= qty THEN now() ELSE NULL END WHERE reservation_id = $1`, [r.reservation_id, done]);
    left = q3(left - take); used = q3(used + take);
  }
  if (used > 0) {
    await client.query(`UPDATE branch_stock SET reserved_qty = GREATEST(0, reserved_qty - $3) WHERE branch_id = $1 AND product_id = $2`, [branchId, productId, used]);
    await bump(client, branchId, productId, -used);
  }
  return used;
};

/* -- price lists and customer profiles ------------------------------------- */

export const savePriceList = async (db, businessId, id, b) => {
  const name = text(b.name, 'Name', { max: 60, required: true });
  const pct = b.discount_pct === undefined ? 0 : num(b.discount_pct, 'Discount', { min: 0, max: 100 });
  try {
    if (id) {
      const r = await db.query(`UPDATE autoparts_price_lists SET name = $3, discount_pct = $4, is_active = COALESCE($5, is_active) WHERE price_list_id = $1 AND business_id = $2 RETURNING *`, [Number(id), businessId, name, pct, b.is_active === undefined ? null : bool(b.is_active)]);
      if (!r.rowCount) throw new PartsError(404, 'Not found');
      return r.rows[0];
    }
    return (await db.query(`INSERT INTO autoparts_price_lists (business_id, name, discount_pct) VALUES ($1,$2,$3) RETURNING *`, [businessId, name, pct])).rows[0];
  } catch (error) {
    if (error.code === '23505') throw new PartsError(409, 'A price list with that name already exists');
    throw error;
  }
};

export const setListPrice = async (db, businessId, listId, productId, price) => {
  if (!(await db.query(`SELECT 1 FROM autoparts_price_lists WHERE price_list_id = $1 AND business_id = $2`, [Number(listId), businessId])).rowCount) throw new PartsError(404, 'Not found');
  if (!(await db.query(`SELECT 1 FROM products WHERE product_id = $1 AND business_id = $2`, [Number(productId), businessId])).rowCount) throw new PartsError(404, 'Not found');
  if (price === null || price === '' || price === undefined) { await db.query(`DELETE FROM autoparts_price_list_items WHERE price_list_id = $1 AND product_id = $2`, [Number(listId), Number(productId)]); return { removed: true }; }
  const paise = money(price, 'Price', { min: 0, required: true });
  await db.query(`INSERT INTO autoparts_price_list_items (price_list_id, product_id, price_paise) VALUES ($1,$2,$3) ON CONFLICT (price_list_id, product_id) DO UPDATE SET price_paise = EXCLUDED.price_paise`, [Number(listId), Number(productId), paise]);
  return withRupees({ price_list_id: Number(listId), product_id: Number(productId), price_paise: paise });
};

export const listPriceLists = async (db, businessId) => (await db.query(
  `SELECT l.*, (SELECT COUNT(*) FROM autoparts_price_list_items i WHERE i.price_list_id = l.price_list_id)::int AS items,
          (SELECT COUNT(*) FROM autoparts_customer_profiles p WHERE p.price_list_id = l.price_list_id)::int AS customers
   FROM autoparts_price_lists l WHERE l.business_id = $1 ORDER BY l.name`, [businessId])).rows.map((r) => ({ ...r, discount_pct: Number(r.discount_pct) }));

export const getProfile = async (db, businessId, customerId) => {
  const c = (await db.query(`SELECT customer_id, name, phone FROM customers WHERE customer_id = $1 AND business_id = $2`, [Number(customerId), businessId])).rows[0];
  if (!c) throw new PartsError(404, 'Not found');
  const p = (await db.query(`SELECT p.*, l.name AS price_list FROM autoparts_customer_profiles p LEFT JOIN autoparts_price_lists l ON l.price_list_id = p.price_list_id WHERE p.customer_id = $1`, [c.customer_id])).rows[0]
    || { customer_class: 'RETAIL', price_list_id: null, credit_limit_paise: 0, credit_policy: 'WARN', terms_days: 0, notes: null };
  const owes = await exposure(db, businessId, c.customer_id);
  return withRupees({ ...c, ...p, owes_paise: owes, available_paise: Number(p.credit_limit_paise) > 0 ? Number(p.credit_limit_paise) - owes : null });
};

export const saveProfile = async (db, businessId, customerId, b) => {
  const c = (await db.query(`SELECT 1 FROM customers WHERE customer_id = $1 AND business_id = $2`, [Number(customerId), businessId])).rowCount;
  if (!c) throw new PartsError(404, 'Not found');
  let listId = null;
  if (b.price_list_id) {
    listId = int(b.price_list_id, 'Price list', { min: 1 });
    if (!(await db.query(`SELECT 1 FROM autoparts_price_lists WHERE price_list_id = $1 AND business_id = $2`, [listId, businessId])).rowCount) throw new PartsError(404, 'Not found');
  }
  await db.query(
    `INSERT INTO autoparts_customer_profiles (customer_id, business_id, customer_class, price_list_id, credit_limit_paise, credit_policy, terms_days, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (customer_id) DO UPDATE SET customer_class = EXCLUDED.customer_class, price_list_id = EXCLUDED.price_list_id, credit_limit_paise = EXCLUDED.credit_limit_paise,
       credit_policy = EXCLUDED.credit_policy, terms_days = EXCLUDED.terms_days, notes = EXCLUDED.notes, updated_at = now()`,
    [Number(customerId), businessId, oneOf(b.customer_class, 'Class', CLASSES, { fallback: 'RETAIL' }), listId, money(b.credit_limit ?? 0, 'Credit limit', { min: 0 }),
      oneOf(b.credit_policy, 'Credit policy', ['OFF', 'WARN', 'BLOCK'], { fallback: 'WARN' }), int(b.terms_days ?? 0, 'Terms', { min: 0, max: 365 }), text(b.notes, 'Notes', { max: 300 })]);
  return getProfile(db, businessId, customerId);
};

/** The trade price of each part for this customer, where their price list has one: Map(product_id -> paise). Parts the list does not cover are absent. */
export const tradePrices = async (db, businessId, customerId, productIds) => {
  const out = new Map();
  if (!customerId || !productIds.length) return out;
  const prof = (await db.query(
    `SELECT l.price_list_id, l.discount_pct FROM autoparts_customer_profiles p JOIN autoparts_price_lists l ON l.price_list_id = p.price_list_id AND l.is_active WHERE p.customer_id = $1 AND p.business_id = $2`, [customerId, businessId])).rows[0];
  if (!prof) return out;
  const fixed = new Map((await db.query(`SELECT product_id, price_paise FROM autoparts_price_list_items WHERE price_list_id = $1 AND product_id = ANY($2::int[])`, [prof.price_list_id, productIds])).rows.map((r) => [r.product_id, Number(r.price_paise)]));
  const pct = Number(prof.discount_pct);
  for (const r of (await db.query(`SELECT product_id, selling_price_paise FROM products WHERE business_id = $1 AND product_id = ANY($2::int[])`, [businessId, productIds])).rows) {
    if (fixed.has(r.product_id)) out.set(r.product_id, fixed.get(r.product_id));
    else if (pct > 0) out.set(r.product_id, Math.round(Number(r.selling_price_paise) * (100 - pct) / 100));
  }
  return out;
};

/* -- credit ------------------------------------------------------------ */

export const exposure = async (db, businessId, customerId) => Number((await db.query(
  `SELECT COALESCE(SUM(balance_due_paise), 0) AS n FROM invoices WHERE business_id = $1 AND customer_id = $2 AND status = 'ISSUED' AND balance_due_paise > 0`, [businessId, customerId])).rows[0].n);

/** { level: OK | WARN | BLOCK, reasons, limit, owes, available } for taking `amountPaise` more on account. */
export const checkCredit = async (db, businessId, customerId, amountPaise) => {
  const p = (await db.query(`SELECT credit_limit_paise, credit_policy FROM autoparts_customer_profiles WHERE customer_id = $1 AND business_id = $2`, [customerId, businessId])).rows[0];
  const owes = await exposure(db, businessId, customerId);
  if (!p || p.credit_policy === 'OFF' || !(Number(p.credit_limit_paise) > 0)) return { level: 'OK', reasons: [], limit: p ? Number(p.credit_limit_paise) : 0, owes, available: null };
  const limit = Number(p.credit_limit_paise);
  const over = owes + amountPaise - limit;
  if (over <= 0) return { level: 'OK', reasons: [], limit, owes, available: limit - owes - amountPaise };
  return { level: p.credit_policy === 'BLOCK' ? 'BLOCK' : 'WARN', reasons: [`This takes them ${Math.round(over / 100)} rupees over their credit limit of ${Math.round(limit / 100)}`], limit, owes, available: limit - owes };
};
