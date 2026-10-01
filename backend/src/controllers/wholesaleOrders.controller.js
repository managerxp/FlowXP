/*
 * Wholesale sales orders.
 *
 *   DRAFT → PENDING (submitted; may need a manager's approval) → CONFIRMED (credit checked, stock reserved)
 *   → PARTIALLY_FULFILLED / FULFILLED / PACKED / DISPATCHED / DELIVERED (derived from what was actually shipped)
 *   → or CANCELLED.
 *
 * Confirming reserves what is on the shelf; whatever is short stays a back-order and is reserved when stock arrives
 * (POST /orders/:id/reserve, or automatically when a goods receipt is posted).
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { hasPermission } from '../middleware/auth.js';
import { checkCredit, creditPosition } from '../modules/wholesale/credit.js';
import { availability, lockProducts } from '../modules/wholesale/stock.js';
import { describeBase, loadUnits } from '../modules/wholesale/units.js';
import {
  ACTIVE_STATUSES, OPEN_STATUSES, buildLines, estimate, loadItems, refreshStatus, releaseOrder, reserveOrder, stillNeeded
} from '../modules/wholesale/orders.js';
import {
  WholesaleError, addDays, audit, bool, diff, getSettings, int, isoDate, like, money, nextNumber, num, ok, oneOf, page, paging, q3, text, today, withTransaction, wrapAll
} from '../modules/wholesale/common.js';
import { notify } from '../modules/wholesale/notify.js';
import { mySalesperson } from './wholesaleParties.controller.js';

const rupees = (v) => toRupees(Number(v || 0));

const STATUSES = ['DRAFT', 'PENDING', 'CONFIRMED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'PACKED', 'DISPATCHED', 'DELIVERED', 'CANCELLED'];

const HEADER_SELECT = `
  SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, c.gstin AS customer_gstin, sp.name AS salesperson_name, b.name AS warehouse_name, u.name AS created_by_name
  FROM wholesale_sales_orders o JOIN customers c ON c.customer_id = o.customer_id LEFT JOIN wholesale_salespeople sp ON sp.salesperson_id = o.salesperson_id
  JOIN branches b ON b.branch_id = o.branch_id LEFT JOIN users u ON u.user_id = o.created_by`;

const headerShape = (o) => ({
  order_id: o.order_id, order_number: o.order_number, order_date: o.order_date, status: o.status, branch_id: o.branch_id, warehouse: o.warehouse_name,
  customer_id: o.customer_id, customer: o.customer_name, customer_phone: o.customer_phone, customer_gstin: o.customer_gstin,
  salesperson_id: o.salesperson_id, salesperson: o.salesperson_name, payment_terms_days: o.payment_terms_days, expected_delivery: o.expected_delivery,
  shipping_address: o.shipping_address, shipping_charge: rupees(o.shipping_charge_paise), shipping_tax_rate: Number(o.shipping_tax_rate), discount: rupees(o.discount_paise),
  subtotal: rupees(o.subtotal_paise), tax: rupees(o.tax_paise), total: rupees(o.total_paise), customer_po: o.customer_po, notes: o.notes, credit_note: o.credit_note,
  approval_needed: o.approval_needed, created_by: o.created_by_name, created_at: o.created_at, confirmed_at: o.confirmed_at, cancelled_at: o.cancelled_at, cancel_reason: o.cancel_reason
});

const itemShape = (it, name, avail, unitEntry) => {
  const open = q3(Number(it.base_qty) - Number(it.shipped_base) - Number(it.cancelled_base));
  return {
    item_id: it.item_id, line_no: it.line_no, product_id: it.product_id, product: name, sku: it.sku ?? null, unit_name: it.unit_name, unit_factor: Number(it.unit_factor),
    quantity: Number(it.quantity), base_qty: Number(it.base_qty), base_unit: it.base_unit, price: rupees(it.price_paise), price_source: it.price_source, discount_pct: Number(it.discount_pct),
    tax_rate: Number(it.tax_rate), notes: it.notes,
    reserved: Number(it.reserved_base), picked: Number(it.picked_base), shipped: Number(it.shipped_base), cancelled: Number(it.cancelled_base), open,
    backorder: Math.max(0, q3(open - Number(it.reserved_base))),
    ...(avail ? { available: avail.available, on_hand: avail.quantity } : {}),
    ...(unitEntry ? { open_text: describeBase(open, unitEntry) } : {})
  };
};

const loadOrder = async (db, businessId, id, { lock = false } = {}) => {
  if (!Number.isInteger(Number(id))) return null;
  const row = (await db.query(`${HEADER_SELECT} WHERE o.business_id = $1 AND o.order_id = $2 ${lock ? 'FOR UPDATE OF o' : ''}`, [businessId, id])).rows[0];
  return row || null;
};

/** The order if this person may see it: a sales executive sees only their own customers' orders. */
const visibleOrder = async (req, id, opts) => {
  const o = await loadOrder(opts?.db || pool, req.tenant.businessId, id, opts);
  if (!o) throw new WholesaleError(404, 'Not found');
  const mine = await mySalesperson(req);
  if (mine != null && o.salesperson_id !== mine && o.created_by !== req.auth.userId) throw new WholesaleError(404, 'Not found');
  return o;
};

const pickBranch = async (req, requested) => {
  if (!requested && req.tenant.viewAll) throw new WholesaleError(400, 'Choose a warehouse first', { code: 'OUTLET_REQUIRED' });
  const id = requested ? Number(requested) : req.tenant.branchId;
  if (!Number.isInteger(id)) throw new WholesaleError(400, 'Choose a warehouse');
  if (req.tenant.pinned && id !== req.tenant.branchId) throw new WholesaleError(403, 'You can only use your own warehouse');
  const row = (await pool.query(`SELECT branch_id FROM branches WHERE branch_id = $1 AND business_id = $2 AND status = 'ACTIVE'`, [id, req.tenant.businessId])).rows[0];
  if (!row) throw new WholesaleError(400, 'That warehouse was not found');
  return id;
};

/* ── list ─────────────────────────────────────────────────────────────────────────────────── */

/* GET /orders?status=&customer_id=&salesperson_id=&branch_id=&from=&to=&q=&open=1&limit=&offset= */
const list = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const values = [req.tenant.businessId]; const where = ['o.business_id = $1'];
  if (req.query.status) {
    const wanted = String(req.query.status).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (wanted.some((s) => !STATUSES.includes(s))) throw new WholesaleError(400, 'Unknown status');
    values.push(wanted); where.push(`o.status = ANY($${values.length}::text[])`);
  }
  if (req.query.open === '1') { values.push(OPEN_STATUSES); where.push(`o.status = ANY($${values.length}::text[])`); }
  if (req.query.customer_id) { values.push(Number(req.query.customer_id) || 0); where.push(`o.customer_id = $${values.length}`); }
  if (req.query.salesperson_id) { values.push(Number(req.query.salesperson_id) || 0); where.push(`o.salesperson_id = $${values.length}`); }
  if (req.query.branch_id) { values.push(Number(req.query.branch_id) || 0); where.push(`o.branch_id = $${values.length}`); }
  else if (req.tenant.pinned) { values.push(req.tenant.branchId); where.push(`o.branch_id = $${values.length}`); }
  const from = isoDate(req.query.from, 'From'); const to = isoDate(req.query.to, 'To');
  if (from) { values.push(from); where.push(`o.order_date >= $${values.length}`); }
  if (to) { values.push(to); where.push(`o.order_date <= $${values.length}`); }
  if (req.query.q) { values.push(like(String(req.query.q).trim().slice(0, 80))); where.push(`(o.order_number ILIKE $${values.length} OR c.name ILIKE $${values.length} OR o.customer_po ILIKE $${values.length})`); }
  const mine = await mySalesperson(req);
  if (mine != null) { values.push(mine, req.auth.userId); where.push(`(o.salesperson_id = $${values.length - 1} OR o.created_by = $${values.length})`); }
  const base = `FROM wholesale_sales_orders o JOIN customers c ON c.customer_id = o.customer_id LEFT JOIN wholesale_salespeople sp ON sp.salesperson_id = o.salesperson_id JOIN branches b ON b.branch_id = o.branch_id WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(
    `SELECT o.*, c.name AS customer_name, c.phone AS customer_phone, c.gstin AS customer_gstin, sp.name AS salesperson_name, b.name AS warehouse_name,
            (SELECT COALESCE(SUM(base_qty - shipped_base - cancelled_base), 0) FROM wholesale_sales_order_items i WHERE i.order_id = o.order_id) AS open_base,
            (SELECT COUNT(*) FROM wholesale_sales_order_items i WHERE i.order_id = o.order_id) AS lines
     ${base} ORDER BY o.order_date DESC, o.order_id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  page(res, rows.map((o) => ({ ...headerShape(o), lines: Number(o.lines), open_base: Number(o.open_base) })), total, pg);
};

/* ── one order ────────────────────────────────────────────────────────────────────────────── */

const fullOrder = async (db, businessId, o) => {
  const items = (await db.query(
    `SELECT i.*, p.name AS product_name, p.sku, p.unit AS base_unit FROM wholesale_sales_order_items i JOIN products p ON p.product_id = i.product_id WHERE i.order_id = $1 ORDER BY i.line_no`, [o.order_id])).rows;
  const avail = await availability(db, o.branch_id, items.map((i) => i.product_id));
  const units = await loadUnits(db, businessId, items.map((i) => i.product_id));
  const shipments = (await db.query(
    `SELECT d.delivery_id, d.challan_number, d.status, d.dispatch_date, d.delivered_at, d.invoice_id, i.invoice_number, i.total_paise, i.balance_due_paise, d.driver_name, d.vehicle_no
     FROM wholesale_deliveries d LEFT JOIN invoices i ON i.invoice_id = d.invoice_id WHERE d.order_id = $1 ORDER BY d.delivery_id`, [o.order_id])).rows;
  const picks = (await db.query(`SELECT pick_id, pick_number, status, picker_name, created_at FROM wholesale_pick_lists WHERE order_id = $1 ORDER BY pick_id`, [o.order_id])).rows;
  const credit = ['DRAFT', 'PENDING'].includes(o.status) ? await checkCredit(db, { businessId, customerId: o.customer_id, amountPaise: Number(o.total_paise), excludeOrderId: o.order_id }) : null;
  return {
    ...headerShape(o),
    items: items.map((it) => itemShape(it, it.product_name, avail.get(it.product_id), units.get(it.product_id))).map((x, k) => ({ ...x, sku: items[k].sku })),
    shipments: shipments.map((d) => ({ delivery_id: d.delivery_id, challan_number: d.challan_number, status: d.status, dispatch_date: d.dispatch_date, delivered_at: d.delivered_at, driver_name: d.driver_name, vehicle_no: d.vehicle_no, invoice_id: d.invoice_id, invoice_number: d.invoice_number, invoice_total: d.total_paise == null ? null : rupees(d.total_paise), invoice_balance: d.balance_due_paise == null ? null : rupees(d.balance_due_paise) })),
    pick_lists: picks,
    credit: credit && { level: credit.level, reasons: credit.reasons, limit: rupees(credit.position?.limit), outstanding: rupees(credit.position?.outstanding), available: credit.position?.available == null ? null : rupees(credit.position.available) }
  };
};

const get = async (req, res) => {
  const o = await visibleOrder(req, req.params.id);
  ok(res, await fullOrder(pool, req.tenant.businessId, o));
};

/* ── create / edit ────────────────────────────────────────────────────────────────────────── */

const headerFields = async (req, b, customerRow, settings) => {
  const profile = (await pool.query(`SELECT payment_terms_days, shipping_address, billing_address, salesperson_id FROM wholesale_customer_profiles WHERE customer_id = $1`, [customerRow.customer_id])).rows[0] || {};
  const salespersonId = 'salesperson_id' in b ? int(b.salesperson_id, 'Salesperson', { min: 1 }) : (profile.salesperson_id ?? null);
  if (salespersonId && !(await pool.query(`SELECT 1 FROM wholesale_salespeople WHERE business_id = $1 AND salesperson_id = $2`, [req.tenant.businessId, salespersonId])).rowCount) throw new WholesaleError(400, 'That salesperson does not exist');
  const orderDate = isoDate(b.order_date, 'Order date') || await today(pool, req.tenant.businessId);
  return {
    order_date: orderDate, salesperson_id: salespersonId,
    payment_terms_days: 'payment_terms_days' in b ? int(b.payment_terms_days, 'Payment terms', { min: 0, max: 365, required: true }) : (profile.payment_terms_days ?? settings.default_payment_terms_days),
    expected_delivery: isoDate(b.expected_delivery, 'Expected delivery'),
    shipping_address: 'shipping_address' in b ? text(b.shipping_address, 'Shipping address', { max: 400 }) : (profile.shipping_address || profile.billing_address || customerRow.address || null),
    shipping_charge_paise: money(b.shipping_charge ?? 0, 'Shipping charge') ?? 0,
    shipping_tax_rate: num(b.shipping_tax_rate ?? 0, 'Shipping GST rate', { min: 0, max: 100 }) ?? 0,
    discount_paise: money(b.discount ?? 0, 'Discount') ?? 0,
    customer_po: text(b.customer_po, 'Customer PO number', { max: 40 }), notes: text(b.notes, 'Notes', { max: 1000 })
  };
};

const getCustomer = async (req, customerId) => {
  const row = (await pool.query(`SELECT customer_id, name, state, address, status FROM customers WHERE business_id = $1 AND customer_id = $2`, [req.tenant.businessId, customerId])).rows[0];
  if (!row) throw new WholesaleError(400, 'Choose a customer from your list');
  if (row.status !== 'ACTIVE') throw new WholesaleError(400, `${row.name} is archived`);
  const mine = await mySalesperson(req);
  if (mine != null) {
    const own = (await pool.query(`SELECT 1 FROM wholesale_customer_profiles WHERE customer_id = $1 AND salesperson_id = $2`, [customerId, mine])).rowCount;
    if (!own) throw new WholesaleError(403, 'That customer is not assigned to you');
  }
  return row;
};

const writeItems = async (client, order, lines) => {
  await client.query(`DELETE FROM wholesale_sales_order_items WHERE order_id = $1`, [order.order_id]);
  for (const l of lines) {
    await client.query(
      `INSERT INTO wholesale_sales_order_items (order_id, business_id, line_no, product_id, unit_name, unit_factor, quantity, base_qty, price_paise, price_source, discount_pct, tax_rate, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [order.order_id, order.business_id, l.line_no, l.product_id, l.unit_name, l.unit_factor, l.quantity, l.base_qty, l.price_paise, l.price_source, l.discount_pct, l.tax_rate, l.notes]);
  }
};

const needsApproval = (req, settings, totalPaise) =>
  settings.order_approval_over_paise != null && totalPaise > Number(settings.order_approval_over_paise) && !hasPermission(req.tenant, 'sales_cancel');

/* POST /orders/preview — price + totals + credit position, nothing saved */
const preview = async (req, res) => {
  const b = req.body || {};
  const customer = await getCustomer(req, int(b.customer_id, 'Customer', { min: 1, required: true }));
  const branchId = await pickBranch(req, b.branch_id);
  const settings = await getSettings(pool, req.tenant.businessId);
  const h = await headerFields(req, b, customer, settings);
  const client = await pool.connect();
  try {
    const lines = await buildLines(client, { tenant: req.tenant, customerId: customer.customer_id, input: b.lines, allowBelowMoq: bool(b.allow_below_moq) });
    const est = await estimate(client, { businessId: req.tenant.businessId, branchId, customerId: customer.customer_id, lines, shippingPaise: h.shipping_charge_paise, shippingTaxRate: h.shipping_tax_rate, discountPaise: h.discount_paise });
    const avail = await availability(client, branchId, lines.map((l) => l.product_id));
    const credit = await checkCredit(client, { businessId: req.tenant.businessId, customerId: customer.customer_id, amountPaise: est.total_paise, settings });
    ok(res, {
      lines: est.lines.map((l) => ({ line_no: l.line_no, product_id: l.product_id, product: l.name, unit_name: l.unit_name, quantity: l.quantity, base_qty: l.base_qty, price: rupees(l.price_paise), price_source: l.price_source, discount_pct: l.discount_pct, tax_rate: l.tax_rate, line_total: rupees(l.line_total_paise), available: avail.get(l.product_id).available, short: Math.max(0, q3(l.base_qty - avail.get(l.product_id).available)) })),
      subtotal: rupees(est.subtotal_paise), tax: rupees(est.tax_paise), total: rupees(est.total_paise), inter_state: est.inter_state,
      approval_needed: needsApproval(req, settings, est.total_paise),
      credit: { level: credit.level, reasons: credit.reasons, limit: rupees(credit.position?.limit), outstanding: rupees(credit.position?.outstanding), available: credit.position?.available == null ? null : rupees(credit.position.available) }
    });
  } finally { client.release(); }
};

const saveLines = async (client, req, order, b, customer, settings) => {
  const lines = await buildLines(client, { tenant: req.tenant, customerId: customer.customer_id, input: b.lines, allowBelowMoq: bool(b.allow_below_moq) });
  const est = await estimate(client, { businessId: order.business_id, branchId: order.branch_id, customerId: customer.customer_id, lines, shippingPaise: Number(order.shipping_charge_paise), shippingTaxRate: Number(order.shipping_tax_rate), discountPaise: Number(order.discount_paise) });
  await writeItems(client, order, lines);
  const approval = needsApproval(req, settings, est.total_paise);
  await client.query(`UPDATE wholesale_sales_orders SET subtotal_paise = $2, tax_paise = $3, total_paise = $4, approval_needed = $5, updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`,
    [order.order_id, est.subtotal_paise, est.tax_paise, est.total_paise, approval]);
  return { lines, est, approval };
};

/* POST /orders { customer_id, lines, submit?: true, ...header } */
const create = async (req, res) => {
  const b = req.body || {};
  const customer = await getCustomer(req, int(b.customer_id, 'Customer', { min: 1, required: true }));
  const branchId = await pickBranch(req, b.branch_id);
  const settings = await getSettings(pool, req.tenant.businessId);
  const h = await headerFields(req, b, customer, settings);
  const orderId = await withTransaction(async (client) => {
    const number = await nextNumber(client, req.tenant.businessId, 'SO', settings.order_prefix);
    const cols = { ...h, branch_id: branchId, customer_id: customer.customer_id, order_number: number, status: bool(b.submit) ? 'PENDING' : 'DRAFT', created_by: req.auth.userId };
    const keys = Object.keys(cols);
    const row = (await client.query(`INSERT INTO wholesale_sales_orders (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`, [req.tenant.businessId, ...keys.map((k) => cols[k])])).rows[0];
    await saveLines(client, req, row, b, customer, settings);
    return row.order_id;
  });
  const o = await loadOrder(pool, req.tenant.businessId, orderId);
  audit(req, 'wholesale.order_created', 'sales_order', orderId, null, { number: o.order_number, customer: o.customer_name, total: rupees(o.total_paise), status: o.status });
  ok(res, await fullOrder(pool, req.tenant.businessId, o), 201);
};

/* PUT /orders/:id — a draft or pending order freely; a confirmed one only while nothing has been picked or shipped */
const update = async (req, res) => {
  const b = req.body || {};
  const before = await visibleOrder(req, req.params.id);
  if (!['DRAFT', 'PENDING', ...ACTIVE_STATUSES].includes(before.status)) throw new WholesaleError(409, `A ${before.status.toLowerCase().replace('_', ' ')} order can no longer be edited`);
  const settings = await getSettings(pool, req.tenant.businessId);
  const customer = await getCustomer(req, before.customer_id);
  const h = await headerFields(req, { ...Object.fromEntries(Object.entries({
    order_date: before.order_date, payment_terms_days: before.payment_terms_days, expected_delivery: before.expected_delivery, shipping_address: before.shipping_address,
    shipping_charge: rupees(before.shipping_charge_paise), shipping_tax_rate: before.shipping_tax_rate, discount: rupees(before.discount_paise), customer_po: before.customer_po, notes: before.notes, salesperson_id: before.salesperson_id
  }).map(([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 10) : v])), ...b }, customer, settings);
  await withTransaction(async (client) => {
    const order = await loadOrder(client, req.tenant.businessId, before.order_id, { lock: true });
    if (ACTIVE_STATUSES.includes(order.status)) {
      const t = (await client.query(`SELECT COALESCE(SUM(shipped_base + picked_base), 0) AS done FROM wholesale_sales_order_items WHERE order_id = $1`, [order.order_id])).rows[0];
      const picks = Number((await client.query(`SELECT COUNT(*) AS n FROM wholesale_pick_lists WHERE order_id = $1 AND status <> 'CANCELLED'`, [order.order_id])).rows[0].n);
      if (Number(t.done) > 0 || picks > 0) throw new WholesaleError(409, 'This order is already being picked or shipped. Cancel the pick list first, or close what is left and make a new order.');
      await lockProducts(client, req.tenant.businessId, (await loadItems(client, order.order_id)).map((i) => i.product_id));
      await releaseOrder(client, order, await loadItems(client, order.order_id, { lock: true }));
    }
    const keys = Object.keys(h);
    await client.query(`UPDATE wholesale_sales_orders SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`, [order.order_id, ...keys.map((k) => h[k])]);
    const fresh = await loadOrder(client, req.tenant.businessId, order.order_id);
    if (Array.isArray(b.lines)) await saveLines(client, req, fresh, b, customer, settings);
    else {
      // header-only edit: totals change when shipping or the discount did
      const items = (await loadItems(client, order.order_id)).map((i) => ({ quantity: Number(i.quantity), price_paise: Number(i.price_paise), discount_pct: Number(i.discount_pct), tax_rate: Number(i.tax_rate) }));
      const est = await estimate(client, { businessId: order.business_id, branchId: order.branch_id, customerId: order.customer_id, lines: items, shippingPaise: h.shipping_charge_paise, shippingTaxRate: h.shipping_tax_rate, discountPaise: h.discount_paise });
      await client.query(`UPDATE wholesale_sales_orders SET subtotal_paise = $2, tax_paise = $3, total_paise = $4, approval_needed = $5 WHERE order_id = $1`, [order.order_id, est.subtotal_paise, est.tax_paise, est.total_paise, needsApproval(req, settings, est.total_paise)]);
    }
    if (ACTIVE_STATUSES.includes(order.status) && settings.reserve_on_confirm) {
      const items = await loadItems(client, order.order_id, { lock: true });
      await lockProducts(client, req.tenant.businessId, items.map((i) => i.product_id));
      await reserveOrder(client, fresh, items);
    }
  });
  const after = await loadOrder(pool, req.tenant.businessId, before.order_id);
  audit(req, 'wholesale.order_updated', 'sales_order', before.order_id, null, null, { number: before.order_number, changes: diff({ total: rupees(before.total_paise), status: before.status }, { total: rupees(after.total_paise), status: after.status }) });
  ok(res, await fullOrder(pool, req.tenant.businessId, after));
};

/* ── workflow ─────────────────────────────────────────────────────────────────────────────── */

const submit = async (req, res) => {
  const o = await visibleOrder(req, req.params.id);
  if (o.status !== 'DRAFT') throw new WholesaleError(409, 'Only a draft can be submitted');
  await pool.query(`UPDATE wholesale_sales_orders SET status = 'PENDING', updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`, [o.order_id]);
  audit(req, 'wholesale.order_submitted', 'sales_order', o.order_id, null, null, { number: o.order_number });
  ok(res, await fullOrder(pool, req.tenant.businessId, await loadOrder(pool, req.tenant.businessId, o.order_id)));
};

/* POST /orders/:id/confirm { credit_override?: true, reason? } */
const confirm = async (req, res) => {
  const b = req.body || {};
  const o = await visibleOrder(req, req.params.id);
  if (!['DRAFT', 'PENDING'].includes(o.status)) throw new WholesaleError(409, o.status === 'CANCELLED' ? 'This order was cancelled' : 'This order is already confirmed');
  if (o.approval_needed && !hasPermission(req.tenant, 'sales_cancel')) throw new WholesaleError(403, 'This order is over the approval limit. A sales manager has to confirm it.');
  const settings = await getSettings(pool, req.tenant.businessId);
  const credit = await checkCredit(pool, { businessId: req.tenant.businessId, customerId: o.customer_id, amountPaise: Number(o.total_paise), excludeOrderId: o.order_id, settings });
  let creditNote = null;
  if (credit.level === 'BLOCK') {
    if (!(bool(b.credit_override) && hasPermission(req.tenant, 'sales_cancel'))) {
      throw new WholesaleError(409, `Credit limit: ${credit.reasons.join('. ')}`, { code: 'CREDIT_BLOCK', data: { reasons: credit.reasons } });
    }
    creditNote = `Override by ${req.auth.userId}: ${text(b.reason, 'Reason', { max: 120 }) || 'no reason given'} (${credit.reasons.join('; ')})`.slice(0, 200);
  } else if (credit.level === 'WARN') creditNote = `Warning: ${credit.reasons.join('; ')}`.slice(0, 200);
  const result = await withTransaction(async (client) => {
    const order = await loadOrder(client, req.tenant.businessId, o.order_id, { lock: true });
    if (!['DRAFT', 'PENDING'].includes(order.status)) throw new WholesaleError(409, 'This order has already been handled');
    const items = await loadItems(client, order.order_id, { lock: true });
    let short = [];
    if (settings.reserve_on_confirm) {
      await lockProducts(client, req.tenant.businessId, items.map((i) => i.product_id));
      short = await reserveOrder(client, order, items);
    }
    await client.query(`UPDATE wholesale_sales_orders SET status = 'CONFIRMED', confirmed_by = $2, confirmed_at = CURRENT_TIMESTAMP, credit_note = $3, approval_needed = FALSE, updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`, [order.order_id, req.auth.userId, creditNote]);
    return short;
  });
  audit(req, 'wholesale.order_confirmed', 'sales_order', o.order_id, null, null, { number: o.order_number, total: rupees(o.total_paise), credit: credit.level, backordered_lines: result.length });
  notify(req, 'order_confirmed', { customerId: o.customer_id, values: { order: o.order_number, total: Number(o.total_paise) } });
  const out = await fullOrder(pool, req.tenant.businessId, await loadOrder(pool, req.tenant.businessId, o.order_id));
  ok(res, { ...out, warnings: credit.level === 'WARN' ? credit.reasons : [], backordered: result });
};

/* POST /orders/:id/reserve — try again to reserve what a back-order is waiting for (stock has arrived) */
const reserveAgain = async (req, res) => {
  const o = await visibleOrder(req, req.params.id);
  if (!ACTIVE_STATUSES.includes(o.status)) throw new WholesaleError(409, 'Only a confirmed order holds stock');
  const short = await withTransaction(async (client) => {
    const order = await loadOrder(client, req.tenant.businessId, o.order_id, { lock: true });
    const items = await loadItems(client, order.order_id, { lock: true });
    await lockProducts(client, req.tenant.businessId, items.map((i) => i.product_id));
    return reserveOrder(client, order, items);
  });
  ok(res, { ...(await fullOrder(pool, req.tenant.businessId, await loadOrder(pool, req.tenant.businessId, o.order_id))), backordered: short });
};

/** Cancel pick lists and give back stock — shared by cancel and close. Called inside a transaction. */
const stopFulfilment = async (client, order) => {
  await client.query(`UPDATE wholesale_pick_lists SET status = 'CANCELLED' WHERE order_id = $1 AND status NOT IN ('DISPATCHED','CANCELLED')`, [order.order_id]);
  await client.query(`UPDATE wholesale_sales_order_items SET picked_base = shipped_base WHERE order_id = $1`, [order.order_id]);
};

/* POST /orders/:id/cancel { reason } — before anything has shipped */
const cancel = async (req, res) => {
  const o = await visibleOrder(req, req.params.id);
  if (o.status === 'CANCELLED') throw new WholesaleError(409, 'This order is already cancelled');
  if (!['DRAFT', 'PENDING'].includes(o.status) && !hasPermission(req.tenant, 'sales_cancel')) throw new WholesaleError(403, 'You do not have permission to cancel a confirmed order');
  const reason = text(req.body?.reason, 'Reason', { max: 200, required: !['DRAFT'].includes(o.status), min: 3 });
  await withTransaction(async (client) => {
    const order = await loadOrder(client, req.tenant.businessId, o.order_id, { lock: true });
    if (!['DRAFT', 'PENDING', ...ACTIVE_STATUSES].includes(order.status)) throw new WholesaleError(409, `A ${order.status.toLowerCase().replace('_', ' ')} order cannot be cancelled. Return the goods instead.`);
    const items = await loadItems(client, order.order_id, { lock: true });
    if (items.some((i) => Number(i.shipped_base) > 0)) throw new WholesaleError(409, 'Part of this order has already shipped. Close what is left instead, or return the goods.');
    await lockProducts(client, req.tenant.businessId, items.map((i) => i.product_id));
    await releaseOrder(client, order, items);
    await stopFulfilment(client, order);
    await client.query(`UPDATE wholesale_sales_orders SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP, cancel_reason = $2, updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`, [order.order_id, reason]);
  });
  audit(req, 'wholesale.order_cancelled', 'sales_order', o.order_id, null, null, { number: o.order_number, reason, was: o.status });
  ok(res, await fullOrder(pool, req.tenant.businessId, await loadOrder(pool, req.tenant.businessId, o.order_id)));
};

/* POST /orders/:id/close { reason } — stop waiting for the rest of a partly-shipped order (back-order cancelled) */
const closeOrder = async (req, res) => {
  const o = await visibleOrder(req, req.params.id);
  if (!hasPermission(req.tenant, 'sales_cancel')) throw new WholesaleError(403, 'You do not have permission to close an order');
  const reason = text(req.body?.reason, 'Reason', { max: 200, required: true, min: 3 });
  await withTransaction(async (client) => {
    const order = await loadOrder(client, req.tenant.businessId, o.order_id, { lock: true });
    if (!['PARTIALLY_FULFILLED', 'CONFIRMED', 'PACKED'].includes(order.status)) throw new WholesaleError(409, 'There is nothing left to close on this order');
    const items = await loadItems(client, order.order_id, { lock: true });
    if (!items.some((i) => Number(i.shipped_base) > 0)) throw new WholesaleError(409, 'Nothing has shipped yet. Cancel the order instead.');
    await lockProducts(client, req.tenant.businessId, items.map((i) => i.product_id));
    await releaseOrder(client, order, items);
    await stopFulfilment(client, order);
    await client.query(`UPDATE wholesale_sales_order_items SET cancelled_base = base_qty - shipped_base WHERE order_id = $1`, [order.order_id]);
    await client.query(`UPDATE wholesale_sales_orders SET notes = COALESCE(notes || E'\\n', '') || $2 WHERE order_id = $1`, [order.order_id, `Closed short: ${reason}`]);
    await refreshStatus(client, order.order_id);
  });
  audit(req, 'wholesale.order_closed', 'sales_order', o.order_id, null, null, { number: o.order_number, reason });
  ok(res, await fullOrder(pool, req.tenant.businessId, await loadOrder(pool, req.tenant.businessId, o.order_id)));
};

/* GET /backorders — lines promised to customers that stock does not yet cover */
const backorders = async (req, res) => {
  const values = [req.tenant.businessId, ACTIVE_STATUSES]; let scope = '';
  if (req.tenant.pinned) { values.push(req.tenant.branchId); scope = ` AND o.branch_id = $3`; }
  const rows = (await pool.query(
    `SELECT o.order_id, o.order_number, o.order_date, o.branch_id, c.name AS customer, p.product_id, p.name AS product, p.unit,
            (i.base_qty - i.shipped_base - i.cancelled_base - i.reserved_base) AS short,
            COALESCE(bs.quantity - bs.reserved_qty, 0) AS available
     FROM wholesale_sales_order_items i JOIN wholesale_sales_orders o ON o.order_id = i.order_id JOIN customers c ON c.customer_id = o.customer_id JOIN products p ON p.product_id = i.product_id
     LEFT JOIN branch_stock bs ON bs.branch_id = o.branch_id AND bs.product_id = i.product_id
     WHERE o.business_id = $1 AND o.status = ANY($2::text[]) AND i.base_qty - i.shipped_base - i.cancelled_base - i.reserved_base > 0.0005 ${scope}
     ORDER BY o.order_date, o.order_id LIMIT 500`, values)).rows;
  ok(res, rows.map((r) => ({ ...r, short: Number(r.short), available: Number(r.available) })));
};

export default wrapAll({ list, get, preview, create, update, submit, confirm, reserve: reserveAgain, cancel, close: closeOrder, backorders });
export { loadOrder, fullOrder };
