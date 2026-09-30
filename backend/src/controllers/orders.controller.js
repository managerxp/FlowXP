/*
 * Orders — the running tab in front of billing, and the Kitchen Order Ticket
 * that comes out of it.
 *
 * A KOT is not a parallel workflow: it is a snapshot of "the items added to
 * this order since the last ticket", so the kitchen sees what's new without
 * re-cooking what already went out. Sending one touches no stock and no
 * money — only bill() does that, and it does it through the exact same
 * modules/billing.js transaction a direct POS sale uses.
 *
 * Deliberately NOT checked here: product stock at order/item-add time. An
 * order is not yet a commitment against inventory — a kitchen can 86 an item
 * before it is ever billed — so the only stock check in this whole file is
 * the one billing.js already does, at the one moment it actually matters.
 */
import pool from '../config/database.js';
import { recordAudit, recordEvent } from '../modules/events.js';
import { toPaise, toRupees } from '../utils/money.js';
import { asInvoice, BillingError, createInvoiceInTransaction, recordInvoiceCreated } from '../modules/billing.js';
import { hasPermission } from '../middleware/auth.js';
import { TabError, takeItems, unbilledCount } from '../modules/tabs.js';
import { ModifierError, outletSettingsFor, resolveModifiers } from '../modules/menu.js';
import { branchFilter } from '../utils/scope.js';
import { comboBlocker, loadCombos } from '../modules/combos.js';
import { isEligibleWaiter } from '../modules/waiters.js';
import { eligibleRiders, isEligibleRider } from '../modules/riders.js';
import { resolveStation } from '../modules/stations.js';
import { getAdapter } from '../modules/delivery/registry.js';

const OPEN_STATUSES = ['PENDING_ACCEPT', 'OPEN', 'PREPARING', 'READY', 'SERVED'];

/* Exported: reused by publicOrdering.controller.js, which has no req/res of
   its own to run these through — a customer's browser has no session, so the
   whole "get a number, add items, send a KOT" core has to work from plain
   arguments, not from an authenticated request. */
export const nextNumber = async (client, businessId, prefixColumn, counterColumn) => {
  const { rows } = await client.query(
    `SELECT ${prefixColumn} AS prefix, ${counterColumn} AS n FROM businesses WHERE business_id = $1 FOR UPDATE`,
    [businessId]
  );
  await client.query(`UPDATE businesses SET ${counterColumn} = ${counterColumn} + 1 WHERE business_id = $1`, [businessId]);
  return `${rows[0].prefix}-${String(rows[0].n).padStart(4, '0')}`;
};

/* Thrown for a validation failure inside insertOrderItems — a plain Error
   would read as a 500 to whichever caller catches it; this carries the same
   400 addItems() has always returned for these cases. */
export class OrderItemsError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/** The exact per-line validation/insert addItems() has always done, factored
    out so the public ordering endpoint enforces the identical rules (an
    archived product can't be ordered there either, a custom line still needs
    its own price) rather than a second, driftable copy of them. */
export const insertOrderItems = async (client, businessId, orderId, rawItems) => {
  const inserted = [];
  const defaultMinutes = (await client.query(`SELECT kitchen_default_prep_minutes AS m FROM businesses WHERE business_id = $1`, [businessId])).rows[0]?.m ?? 15;
  // The order's own outlet decides price and availability, whoever is adding the item.
  const orderBranch = (await client.query(`SELECT branch_id FROM orders WHERE order_id = $1`, [orderId])).rows[0]?.branch_id;
  const outletSettings = await outletSettingsFor(client, orderBranch, [...new Set(rawItems.filter((r) => r.product_id).map((r) => Number(r.product_id)))]);
  for (const raw of rawItems) {
    const quantity = Number(raw.quantity) || 1;
    let description, unitPricePaise, productId = null, modifiers = [], stationId = null, expectedMinutes = defaultMinutes;

    if (raw.product_id) {
      const product = (await client.query(
        `SELECT product_id, name, selling_price_paise, status, station_id, prep_minutes FROM products WHERE product_id = $1 AND business_id = $2`,
        [raw.product_id, businessId]
      )).rows[0];
      if (!product) throw new OrderItemsError(`Product ${raw.product_id} not found`);
      if (product.status !== 'ACTIVE') throw new OrderItemsError(`${product.name} is archived`);
      const here = outletSettings.get(product.product_id);
      if (here && here.is_available === false) throw new OrderItemsError(`${product.name} is not available at this outlet`);
      const parts = (await loadCombos(client, businessId, [product.product_id])).get(product.product_id);
      if (parts) {
        const blocked = await comboBlocker(client, orderBranch, product.name, parts);
        if (blocked) throw new OrderItemsError(blocked);
      }
      productId = product.product_id;
      stationId = await resolveStation(client, businessId, orderBranch, product.station_id);
      expectedMinutes = product.prep_minutes ?? defaultMinutes;
      description = raw.description || product.name;
      unitPricePaise = raw.unit_price != null ? toPaise(raw.unit_price) : (here?.price_paise ?? product.selling_price_paise);
      try {
        const picked = await resolveModifiers(client, businessId, productId, raw.modifier_ids);
        modifiers = picked.snapshot;
        unitPricePaise = Number(unitPricePaise) + picked.deltaPaise;
      } catch (error) {
        if (error instanceof ModifierError) throw new OrderItemsError(error.message);
        throw error;
      }
    } else {
      if (!raw.description || raw.unit_price == null) {
        throw new OrderItemsError('A custom item needs a description and a price');
      }
      description = String(raw.description).trim();
      unitPricePaise = toPaise(raw.unit_price);
    }

    const row = (await client.query(
      `INSERT INTO order_items (order_id, product_id, description, quantity, unit_price_paise, kitchen_notes, modifiers, station_id, expected_minutes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [orderId, productId, description, quantity, unitPricePaise, raw.kitchen_notes || null, JSON.stringify(modifiers), stationId, expectedMinutes]
    )).rows[0];
    inserted.push(row);
  }
  return inserted;
};

/** The core of sendKot(): group every still-PENDING item into a new ticket.
    Returns null when there is nothing pending (sendKot()'s HTTP handler turns
    that into a 400; a caller that just added items itself never hits null). */
export const sendKotCore = async (client, { businessId, orderId, createdBy = null, priority = 'NORMAL' }) => {
  const pending = (await client.query(
    `SELECT * FROM order_items WHERE order_id = $1 AND status = 'PENDING' FOR UPDATE`,
    [orderId]
  )).rows;
  if (!pending.length) return null;

  // Every business's KOT numbers just read "KOT-0001" — there is no
  // per-business prefix column for it the way invoices/orders/POs have, so
  // nextNumber() gets a literal SQL string constant instead of a column name.
  const kotNumber = await nextNumber(client, businessId, "'KOT'", 'kot_next_number');

  const kot = (await client.query(
    `INSERT INTO kot_tickets (business_id, order_id, kot_number, created_by, priority) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [businessId, orderId, kotNumber, createdBy, priority === 'RUSH' ? 'RUSH' : 'NORMAL']
  )).rows[0];

  const ids = pending.map((i) => i.order_item_id);
  await client.query(
    `UPDATE order_items SET kot_id = $1, status = 'PREPARING', sent_at = CURRENT_TIMESTAMP WHERE order_item_id = ANY($2::int[])`,
    [kot.kot_id, ids]
  );
  await client.query(
    `UPDATE orders SET status = 'PREPARING', updated_at = CURRENT_TIMESTAMP WHERE order_id = $1 AND status = 'OPEN'`,
    [orderId]
  );

  return { kot, items: pending };
};

/** The table's current running order, or a freshly opened one — used by the
    public QR endpoint, where a second round of ordering from the same table
    must land on the SAME tab, not collide with it. This is deliberately not
    what create()'s HTTP handler does below: create() is the staff action
    "start a new tab", and correctly 409s if one is already open; a customer
    scanning the table's QR code mid-meal is not making that mistake. */
export const getOrCreateOpenOrderForTable = async (client, { businessId, branchId, tableId, customerId = null, notes = null, createdBy = null }) => {
  const existing = (await client.query(
    `SELECT * FROM orders WHERE table_id = $1 AND business_id = $2 AND status NOT IN ('BILLED','CANCELLED','MERGED') FOR UPDATE`,
    [tableId, businessId]
  )).rows[0];
  if (existing) return existing;

  const orderNumber = await nextNumber(client, businessId, 'order_prefix', 'order_next_number');
  return (await client.query(
    `INSERT INTO orders (business_id, branch_id, order_number, order_type, table_id, customer_id, notes, created_by, waiter_user_id)
     VALUES ($1,$2,$3,'DINE_IN',$4,$5,$6,$7,(SELECT waiter_user_id FROM dining_tables WHERE table_id = $4)) RETURNING *`,
    [businessId, branchId, orderNumber, tableId, customerId, notes, createdBy]
  )).rows[0];
};

const asOrderItem = (row) => ({
  order_item_id: row.order_item_id,
  product_id: row.product_id,
  description: row.description,
  modifiers: row.modifiers || [],
  quantity: Number(row.quantity),
  unit_price: toRupees(row.unit_price_paise),
  line_total: toRupees(Math.round(Number(row.quantity) * row.unit_price_paise)),
  // the GST the bill will add (the product's rate, as billing uses); only on the order detail
  ...(row.tax_rate !== undefined ? { tax_rate: Number(row.tax_rate || 0) } : {}),
  kitchen_notes: row.kitchen_notes,
  kot_id: row.kot_id,
  status: row.status,
  invoice_id: row.invoice_id,
  billed: row.invoice_id != null
});

const asOrder = (row) => ({
  order_id: row.order_id,
  order_number: row.order_number,
  order_type: row.order_type,
  table_id: row.table_id,
  table_name: row.table_name,
  customer_id: row.customer_id,
  // a saved customer's name if one is attached, else the diner's name as the delivery platform gave it
  customer_name: row.customer_name ?? row.guest_name ?? null,
  platform: row.platform,
  external_order_id: row.external_order_id,
  external_order_number: row.external_order_number,
  waiter_user_id: row.waiter_user_id ?? null,
  waiter_name: row.waiter_name ?? null,
  brand_id: row.brand_id ?? null,
  brand_name: row.brand_name ?? null,
  rider_user_id: row.rider_user_id ?? null,
  rider_name: row.rider_name ?? null,
  picked_up_at: row.picked_up_at ?? null,
  out_for_delivery_at: row.out_for_delivery_at ?? null,
  delivered_at: row.delivered_at ?? null,
  status: row.status,
  notes: row.notes,
  rejection_reason: row.rejection_reason ?? null,
  invoice_id: row.invoice_id,
  merged_into_order_id: row.merged_into_order_id,
  created_at: row.created_at,
  updated_at: row.updated_at,
  // only on the list: what is still to bill, and where the kitchen is with it
  ...(row.open_lines != null ? { summary: summaryOf(row) } : {})
});

export const summaryOf = (row) => ({
  items: Number(row.open_qty),
  lines: row.open_lines,
  estimate: toRupees(row.open_paise),
  not_sent: row.not_sent,
  cooking: row.cooking,
  ready: row.ready
});

/* ==========================================================================
   POST /api/orders — open a new tab
   ========================================================================== */
export const create = async (req, res) => {
  const body = req.body || {};
  const orderType = body.order_type || 'DINE_IN';
  if (!['DINE_IN', 'TAKEAWAY', 'DELIVERY'].includes(orderType)) {
    return res.status(400).json({ success: false, message: 'Invalid order type' });
  }
  if (orderType === 'DINE_IN' && !body.table_id) {
    return res.status(400).json({ success: false, message: 'Choose a table for a dine-in order' });
  }
  if (body.brand_id && !(await pool.query(`SELECT 1 FROM brands WHERE brand_id = $1 AND business_id = $2`, [body.brand_id, req.tenant.businessId])).rows.length) {
    return res.status(400).json({ success: false, message: 'Brand not found' });
  }

  let tableWaiter = null;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (body.table_id) {
      const table = (await client.query(
        `SELECT table_id, status, waiter_user_id FROM dining_tables WHERE table_id = $1 AND business_id = $2 AND branch_id = $3`,
        [body.table_id, req.tenant.businessId, req.tenant.branchId]
      )).rows[0];
      if (!table) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'Table not found' }); }
      if (table.status !== 'FREE') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: `Table is ${table.status.toLowerCase()}` }); }
      tableWaiter = table.waiter_user_id;
    }

    // Who serves it: the one picked, else the table's regular waiter, else the waiter who opened it.
    let waiterId = body.waiter_user_id ? Number(body.waiter_user_id) : (tableWaiter ?? (req.tenant.role === 'WAITER' ? req.auth.userId : null));
    if (body.waiter_user_id && !(await isEligibleWaiter(client, req.tenant.businessId, req.tenant.branchId, waiterId))) {
      await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'Choose a waiter who works at this outlet' });
    }

    const orderNumber = await nextNumber(client, req.tenant.businessId, 'order_prefix', 'order_next_number');

    let order;
    try {
      order = (await client.query(
        `INSERT INTO orders (business_id, branch_id, order_number, order_type, table_id, customer_id, notes, created_by, waiter_user_id, brand_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [req.tenant.businessId, req.tenant.branchId, orderNumber, orderType, body.table_id || null,
         body.customer_id || null, body.notes || null, req.auth.userId, waiterId, body.brand_id || null]
      )).rows[0];
    } catch (dbError) {
      // 23505 on uq_orders_open_table: someone else opened this table a moment ago.
      if (dbError.code === '23505') { await client.query('ROLLBACK'); return res.status(409).json({ success: false, message: 'This table already has an open order' }); }
      throw dbError;
    }

    await client.query('COMMIT');
    recordAudit(req, { action: 'order.opened', resource_type: 'order', resource_id: order.order_id, metadata: { order_type: orderType } });
    res.status(201).json({ success: true, data: asOrder(order) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[orders] create failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not open the order' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   GET /api/orders
   ========================================================================== */
export const list = async (req, res) => {
  const { status, table_id, order_type, open_only, waiter } = req.query;
  const clauses = [];
  const values = [req.tenant.businessId];

  if (status) { values.push(status); clauses.push(`o.status = $${values.length}`); }
  else if (open_only === 'true') { values.push(OPEN_STATUSES); clauses.push(`o.status = ANY($${values.length}::text[])`); }
  if (table_id) { values.push(table_id); clauses.push(`o.table_id = $${values.length}`); }
  if (order_type) { values.push(order_type); clauses.push(`o.order_type = $${values.length}`); }
  if (waiter) { values.push(waiter === 'me' ? req.auth.userId : Number(waiter) || 0); clauses.push(`o.waiter_user_id = $${values.length}`); }
  const scope = branchFilter(req.tenant, 'o.branch_id', values);

  const { rows } = await pool.query(
    `SELECT o.*, t.name AS table_name, c.name AS customer_name, w.name AS waiter_name, br.name AS brand_name, rd.name AS rider_name, s.*
     FROM orders o
     LEFT JOIN users w ON w.user_id = o.waiter_user_id
     LEFT JOIN users rd ON rd.user_id = o.rider_user_id
     LEFT JOIN dining_tables t ON t.table_id = o.table_id
     LEFT JOIN customers c ON c.customer_id = o.customer_id
     LEFT JOIN brands br ON br.brand_id = o.brand_id
     LEFT JOIN LATERAL (
       SELECT COUNT(*) FILTER (WHERE oi.status <> 'CANCELLED' AND oi.invoice_id IS NULL)::int AS open_lines,
              COALESCE(SUM(oi.quantity) FILTER (WHERE oi.status <> 'CANCELLED' AND oi.invoice_id IS NULL), 0) AS open_qty,
              COALESCE(SUM(ROUND(oi.quantity * oi.unit_price_paise * (1 + CASE WHEN b.gst_enabled THEN COALESCE(p.tax_rate, 0) / 100.0 ELSE 0 END))) FILTER (WHERE oi.status <> 'CANCELLED' AND oi.invoice_id IS NULL), 0) AS open_paise,
              COUNT(*) FILTER (WHERE oi.status = 'PENDING')::int AS not_sent,
              COUNT(*) FILTER (WHERE oi.status = 'PREPARING')::int AS cooking,
              COUNT(*) FILTER (WHERE oi.status = 'READY')::int AS ready
         FROM order_items oi LEFT JOIN products p ON p.product_id = oi.product_id
         JOIN businesses b ON b.business_id = o.business_id
         WHERE oi.order_id = o.order_id) s ON TRUE
     WHERE o.business_id = $1 ${clauses.map((c) => `AND ${c}`).join(' ')}${scope}
     ORDER BY o.created_at DESC LIMIT 200`,
    values
  );
  res.json({ success: true, data: rows.map(asOrder) });
};

/* ==========================================================================
   GET /api/orders/:id
   ========================================================================== */
export const get = async (req, res) => {
  const scopeValues = [req.tenant.businessId, req.params.id];
  const scope = branchFilter(req.tenant, 'o.branch_id', scopeValues);
  const { rows } = await pool.query(
    `SELECT o.*, t.name AS table_name, c.name AS customer_name, w.name AS waiter_name, br.name AS brand_name, rd.name AS rider_name
     FROM orders o
     LEFT JOIN users w ON w.user_id = o.waiter_user_id
     LEFT JOIN users rd ON rd.user_id = o.rider_user_id
     LEFT JOIN dining_tables t ON t.table_id = o.table_id
     LEFT JOIN customers c ON c.customer_id = o.customer_id
     LEFT JOIN brands br ON br.brand_id = o.brand_id
     WHERE o.business_id = $1 AND o.order_id = $2${scope}`,
    scopeValues
  );
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });

  const items = (await pool.query(
    `SELECT oi.*, p.tax_rate FROM order_items oi LEFT JOIN products p ON p.product_id = oi.product_id
     WHERE oi.order_id = $1 ORDER BY oi.order_item_id`, [req.params.id]
  )).rows;

  const kots = (await pool.query(
    `SELECT kot_id, kot_number, created_at FROM kot_tickets WHERE order_id = $1 ORDER BY kot_id`, [req.params.id]
  )).rows;

  res.json({ success: true, data: { ...asOrder(rows[0]), items: items.map(asOrderItem), kots } });
};

/* ==========================================================================
   POST /api/orders/:id/items — add one or more items to a running order
   ========================================================================== */
export const addItems = async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ success: false, message: 'Add at least one item' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const scope = [req.params.id, req.tenant.businessId];
    const order = (await client.query(
      `SELECT order_id, status FROM orders WHERE order_id = $1 AND business_id = $2${branchFilter(req.tenant, 'branch_id', scope)} FOR UPDATE`,
      scope
    )).rows[0];
    if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found' }); }
    if (!OPEN_STATUSES.includes(order.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'This order is already billed or cancelled' });
    }

    let inserted;
    try {
      inserted = await insertOrderItems(client, req.tenant.businessId, order.order_id, items);
    } catch (itemError) {
      await client.query('ROLLBACK');
      if (itemError instanceof OrderItemsError) {
        return res.status(itemError.status).json({ success: false, message: itemError.message });
      }
      throw itemError;
    }

    await client.query(`UPDATE orders SET updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`, [order.order_id]);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: inserted.map(asOrderItem) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.message?.includes('positive number') || error.message?.includes('must be a number')) {
      return res.status(400).json({ success: false, message: error.message });
    }
    console.error('[orders] addItems failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not add items' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   PATCH /api/orders/:id/items/:itemId — fix a quantity/note, or cancel a line
   ========================================================================== */
export const updateItem = async (req, res) => {
  const body = req.body || {};
  // A kitchen-only role advances ticket status; changing quantities, notes or
  // cancelling a line is a front-of-house decision.
  if (!hasPermission(req.tenant, 'billing') && (body.quantity != null || body.kitchen_notes !== undefined || !['PREPARING', 'READY', 'SERVED'].includes(body.status))) {
    return res.status(403).json({ success: false, message: 'The kitchen can only update ticket status' });
  }
  const fields = [];
  const values = [];

  // A billed line is on someone's invoice: its quantity and existence are no longer the floor's to change.
  const editsBill = body.quantity != null || body.status === 'CANCELLED';
  if (body.quantity != null) {
    const q = Number(body.quantity);
    if (!Number.isFinite(q) || q <= 0 || q > 9999) return res.status(400).json({ success: false, message: 'Quantity must be a number above zero' });
    values.push(q); fields.push(`quantity = $${values.length}`);
  }
  if (body.kitchen_notes !== undefined) { values.push(body.kitchen_notes); fields.push(`kitchen_notes = $${values.length}`); }
  if (body.status) {
    if (!['PENDING', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'].includes(body.status)) {
      return res.status(400).json({ success: false, message: 'Invalid item status' });
    }
    values.push(body.status); fields.push(`status = $${values.length}::varchar`);
    const n = values.length;
    fields.push(`ready_at = CASE WHEN $${n}::varchar IN ('READY','SERVED') THEN COALESCE(ready_at, CURRENT_TIMESTAMP) WHEN $${n}::varchar IN ('PENDING','PREPARING') THEN NULL ELSE ready_at END`);
    fields.push(`served_at = CASE WHEN $${n}::varchar = 'SERVED' THEN COALESCE(served_at, CURRENT_TIMESTAMP) ELSE NULL END`);
    fields.push(`cancelled_at = CASE WHEN $${n}::varchar = 'CANCELLED' THEN CURRENT_TIMESTAMP ELSE NULL END`);
  }
  if (!fields.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

  values.push(req.params.itemId, req.params.id, req.tenant.businessId);
  // number the three before the outlet filter adds its own parameter (it used to shift them, so at
  // an outlet the line was never found: quantity changes and cancelling a line both failed)
  const [itemAt, orderAt, businessAt] = [values.length - 2, values.length - 1, values.length];
  const scope = branchFilter(req.tenant, 'branch_id', values);
  const { rows } = await pool.query(
    `UPDATE order_items SET ${fields.join(', ')}
     WHERE order_item_id = $${itemAt} AND order_id = $${orderAt}${editsBill ? ' AND invoice_id IS NULL' : ''}
       AND order_id IN (SELECT order_id FROM orders WHERE business_id = $${businessAt}${scope})
     RETURNING *`,
    values
  );
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: asOrderItem(rows[0]) });
};

/* ==========================================================================
   POST /api/orders/:id/kot — send everything PENDING to the kitchen

   Groups only the items added since the last ticket, so a second round at
   the same table doesn't reprint the first round's items.
   ========================================================================== */
export const sendKot = async (req, res) => {
  const kotScope = [req.params.id, req.tenant.businessId];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const order = (await client.query(
      `SELECT o.*, t.name AS table_name FROM orders o LEFT JOIN dining_tables t ON t.table_id = o.table_id
       WHERE o.order_id = $1 AND o.business_id = $2${branchFilter(req.tenant, 'o.branch_id', kotScope)} FOR UPDATE OF o`,
      kotScope
    )).rows[0];
    if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found' }); }
    if (!OPEN_STATUSES.includes(order.status)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'This order is already billed or cancelled' });
    }

    const sent = await sendKotCore(client, { businessId: req.tenant.businessId, orderId: order.order_id, createdBy: req.auth.userId, priority: req.body?.priority === 'RUSH' ? 'RUSH' : 'NORMAL' });
    if (!sent) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'Nothing new to send to the kitchen' }); }
    const { kot, items: pending } = sent;

    await client.query('COMMIT');
    recordAudit(req, { action: 'order.kot_sent', resource_type: 'order', resource_id: order.order_id, metadata: { kot_number: kot.kot_number, items: pending.length } });

    res.status(201).json({
      success: true,
      data: {
        kot_id: kot.kot_id,
        kot_number: kot.kot_number,
        order_number: order.order_number,
        order_type: order.order_type,
        table_name: order.table_name,
        created_at: kot.created_at,
        items: pending.map((i) => ({ description: i.description, quantity: Number(i.quantity), kitchen_notes: i.kitchen_notes }))
      }
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[orders] sendKot failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not send to the kitchen' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   GET /api/orders/pending-deliveries — every platform order waiting on a
   decision, with its full item list, for the pop-up that rings until someone
   accepts or rejects (IncomingDeliveryAlert.jsx). A plain GET /orders row has
   no items; this exists so that pop-up can show what was actually ordered
   without a request per order.
   ========================================================================== */
export const pendingDeliveries = async (req, res) => {
  const values = [req.tenant.businessId];
  const scope = branchFilter(req.tenant, 'o.branch_id', values);
  const orders = (await pool.query(
    `SELECT o.order_id, o.order_number, o.platform, o.external_order_number, o.notes, o.created_at,
            COALESCE(c.name, o.guest_name) AS customer_name, COALESCE(c.phone, o.guest_phone) AS customer_phone
     FROM orders o LEFT JOIN customers c ON c.customer_id = o.customer_id
     WHERE o.business_id = $1 AND o.status = 'PENDING_ACCEPT'${scope}
     ORDER BY o.created_at`,
    values
  )).rows;
  if (!orders.length) return res.json({ success: true, data: [] });

  const items = (await pool.query(
    `SELECT order_id, order_item_id, description, quantity, unit_price_paise FROM order_items
     WHERE order_id = ANY($1::int[]) AND status <> 'CANCELLED' ORDER BY order_item_id`,
    [orders.map((o) => o.order_id)]
  )).rows;

  res.json({
    success: true,
    data: orders.map((o) => ({
      order_id: o.order_id, order_number: o.order_number, platform: o.platform, external_order_number: o.external_order_number, notes: o.notes,
      created_at: o.created_at, customer_name: o.customer_name, customer_phone: o.customer_phone,
      items: items.filter((i) => i.order_id === o.order_id).map((i) => ({
        order_item_id: i.order_item_id, description: i.description, quantity: Number(i.quantity), unit_price: toRupees(i.unit_price_paise)
      }))
    }))
  });
};

/* ==========================================================================
   POST /api/orders/:id/accept — a delivery-platform order: send it to the
   kitchen. Until this, nothing about it exists in the kitchen at all.
   ========================================================================== */
export const acceptDelivery = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const scope = [req.params.id, req.tenant.businessId];
    const order = (await client.query(
      `SELECT * FROM orders WHERE order_id = $1 AND business_id = $2 AND status = 'PENDING_ACCEPT'${branchFilter(req.tenant, 'branch_id', scope)} FOR UPDATE`,
      scope
    )).rows[0];
    if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found, or already accepted or rejected' }); }

    const sent = await sendKotCore(client, { businessId: req.tenant.businessId, orderId: order.order_id, createdBy: req.auth.userId, priority: 'NORMAL' });
    if (!sent) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'This order has no items to send' }); }
    await client.query(`UPDATE orders SET status = 'PREPARING', updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`, [order.order_id]);

    await client.query('COMMIT');
    recordAudit(req, { action: 'order.delivery_accepted', resource_type: 'order', resource_id: order.order_id, metadata: { platform: order.platform, kot_number: sent.kot.kot_number } });
    recordEvent('delivery_order_accepted', { userId: req.auth.userId, businessId: req.tenant.businessId, properties: { platform: order.platform } });
    if (order.platform) getAdapter(order.platform).pushOrderStatus(order, 'ACCEPTED').catch(() => {});

    res.json({ success: true, data: { order_id: order.order_id, order_number: order.order_number, kot_number: sent.kot.kot_number } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[orders] acceptDelivery failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not accept the order' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   POST /api/orders/:id/reject { reason } — a delivery-platform order the
   kitchen never saw: too busy, out of stock, closing. Never touches the
   kitchen or stock, unlike cancelling an order already in progress.
   ========================================================================== */
export const rejectDelivery = async (req, res) => {
  const reason = String(req.body?.reason || '').trim().slice(0, 300) || null;
  const values = [req.params.id, req.tenant.businessId, reason];
  const reasonAt = values.length;
  const scope = branchFilter(req.tenant, 'branch_id', values);
  const { rows } = await pool.query(
    `UPDATE orders SET status = 'CANCELLED', rejection_reason = $${reasonAt}, updated_at = CURRENT_TIMESTAMP
     WHERE order_id = $1 AND business_id = $2 AND status = 'PENDING_ACCEPT'${scope}
     RETURNING *`,
    values
  );
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found, or already accepted or rejected' });
  await pool.query(`UPDATE order_items SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP WHERE order_id = $1`, [rows[0].order_id]);
  recordAudit(req, { action: 'order.delivery_rejected', resource_type: 'order', resource_id: rows[0].order_id, metadata: { platform: rows[0].platform, reason } });
  if (rows[0].platform) getAdapter(rows[0].platform).pushOrderStatus(rows[0], 'REJECTED').catch(() => {});
  res.json({ success: true });
};

/* ==========================================================================
   PATCH /api/orders/:id/status — whole-order status (READY, SERVED)
   ========================================================================== */
export const updateStatus = async (req, res) => {
  const status = req.body?.status;
  if (!OPEN_STATUSES.includes(status)) return res.status(400).json({ success: false, message: 'Invalid status' });

  const values = [status, req.params.id, req.tenant.businessId];
  const { rows } = await pool.query(
    `UPDATE orders SET status = $1, updated_at = CURRENT_TIMESTAMP
     WHERE order_id = $2 AND business_id = $3 AND status NOT IN ('BILLED','CANCELLED','MERGED')${branchFilter(req.tenant, 'branch_id', values)}
     RETURNING *`,
    values
  );
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found, or already closed' });
  res.json({ success: true, data: asOrder(rows[0]) });
};

/* ==========================================================================
   POST /api/orders/:id/cancel — close the tab with no bill
   ========================================================================== */
export const cancelOrder = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const scope = [req.params.id, req.tenant.businessId];
    const order = (await client.query(
      `SELECT order_id FROM orders WHERE order_id = $1 AND business_id = $2 AND status NOT IN ('BILLED','CANCELLED','MERGED')${branchFilter(req.tenant, 'branch_id', scope)} FOR UPDATE`,
      scope
    )).rows[0];
    if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found, or already closed' }); }

    await client.query(`UPDATE order_items SET status = 'CANCELLED', cancelled_at = CURRENT_TIMESTAMP WHERE order_id = $1 AND invoice_id IS NULL AND status NOT IN ('SERVED','CANCELLED')`, [order.order_id]);
    // If part of the tab was already billed, cancelling the rest closes it as billed, not cancelled.
    const last = (await client.query(`SELECT invoice_id FROM order_items WHERE order_id = $1 AND invoice_id IS NOT NULL ORDER BY invoice_id DESC LIMIT 1`, [order.order_id])).rows[0];
    await client.query(
      `UPDATE orders SET status = $2, invoice_id = COALESCE($3, invoice_id), updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`,
      [order.order_id, last ? 'BILLED' : 'CANCELLED', last?.invoice_id ?? null]
    );
    await client.query('COMMIT');
    recordAudit(req, { action: 'order.cancelled', resource_type: 'order', resource_id: req.params.id, metadata: { partly_billed: Boolean(last) } });
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/* ==========================================================================
   POST /api/orders/:id/bill — convert the tab into an invoice

   The one place orders and the billing engine meet: every item still on the
   order (not already cancelled) becomes an invoice line through the exact
   same modules/billing.js transaction a direct POS sale uses.
   ========================================================================== */
export const bill = async (req, res) => {
  const body = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const scope = [req.params.id, req.tenant.businessId];
    const order = (await client.query(
      `SELECT * FROM orders WHERE order_id = $1 AND business_id = $2${branchFilter(req.tenant, 'branch_id', scope)} FOR UPDATE`,
      scope
    )).rows[0];
    if (!order) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found' }); }
    if (order.status === 'BILLED') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'Already billed' }); }
    if (order.status === 'CANCELLED') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'This order was cancelled' }); }
    if (order.status === 'MERGED') { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'This order was merged into another' }); }

    /* Everything still unpaid, or — to split the bill — just the items the caller
       picked (with a quantity, for part of a line). A billed item is never billed twice. */
    let itemIds;
    if (Array.isArray(body.items)) itemIds = await takeItems(client, order.order_id, body.items);
    const items = (await client.query(
      `SELECT order_item_id, product_id, description, quantity, unit_price_paise, modifiers FROM order_items
       WHERE order_id = $1 AND status <> 'CANCELLED' AND invoice_id IS NULL ${itemIds ? 'AND order_item_id = ANY($2::int[])' : ''} ORDER BY order_item_id`,
      itemIds ? [order.order_id, itemIds] : [order.order_id]
    )).rows;
    if (!items.length) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'This order has no items left to bill' }); }

    // The sale, its stock and its payment belong to the order's outlet, not to whichever outlet the biller is viewing.
    const invoice = await createInvoiceInTransaction(client, { ...req.tenant, branchId: order.branch_id ?? req.tenant.branchId }, req.auth.userId, {
      customerId: order.customer_id,
      orderId: order.order_id,
      items: items.map((i) => ({
        product_id: i.product_id,
        description: i.description,
        // Always the price captured when the item was added to the order,
        // never the live catalogue price. A customer's KOT and their bill
        // must agree — if the catalogue price changed between the two, the
        // order is what they were actually served against, not today's price.
        unit_price: Number(i.unit_price_paise) / 100,
        modifiers: i.modifiers || [],
        quantity: Number(i.quantity)
        // ponytail: a custom (non-catalogue) order line has no tax_rate of
        // its own on order_items, so it bills at 0% GST — fine for the usual
        // case (a catalogue item's rate always comes from the product), add
        // a tax_rate column here if ad hoc taxed items on an order turn out
        // to matter.
      })),
      discount: body.discount,
      couponCode: body.coupon_code,
      redeemPoints: body.redeem_points,
      notes: body.notes || order.notes,
      payment: body.payment,
      payments: body.payments
    });

    await client.query(`UPDATE order_items SET invoice_id = $1 WHERE order_item_id = ANY($2::int[])`, [invoice.invoice_id, items.map((i) => i.order_item_id)]);
    const remaining = await unbilledCount(client, order.order_id);
    // The tab closes when its last item is billed; until then it stays open for the next guest.
    await client.query(
      `UPDATE orders SET status = CASE WHEN $3 = 0 THEN 'BILLED' ELSE status END, invoice_id = $1, updated_at = CURRENT_TIMESTAMP WHERE order_id = $2`,
      [invoice.invoice_id, order.order_id, remaining]
    );

    await client.query('COMMIT');
    recordInvoiceCreated(req, invoice);
    recordAudit(req, { action: 'order.billed', resource_type: 'order', resource_id: order.order_id, metadata: { invoice_id: invoice.invoice_id, partial: Boolean(itemIds), remaining } });
    recordEvent('order_billed', { userId: req.auth.userId, businessId: req.tenant.businessId, properties: { order_type: order.order_type } });

    res.status(201).json({ success: true, data: { ...invoice, order_closed: remaining === 0, remaining_items: remaining } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof BillingError || error instanceof TabError) return res.status(error.status).json({ success: false, message: error.message });
    console.error('[orders] bill failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not bill the order' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   PATCH /api/orders/:id/customer { customer_id | null } — who this tab is for

   Attaching a customer (found by mobile number at the till) is what lets
   billing add the visit to their loyalty card and check per-customer coupons.
   ========================================================================== */
export const setCustomer = async (req, res) => {
  const customerId = req.body?.customer_id ? Number(req.body.customer_id) : null;
  if (customerId) {
    const known = await pool.query(`SELECT 1 FROM customers WHERE customer_id = $1 AND business_id = $2`, [customerId, req.tenant.businessId]);
    if (!known.rows.length) return res.status(400).json({ success: false, message: 'Customer not found' });
  }
  const values = [customerId, req.params.id, req.tenant.businessId];
  const { rows } = await pool.query(
    `UPDATE orders SET customer_id = $1, updated_at = CURRENT_TIMESTAMP
     WHERE order_id = $2 AND business_id = $3 AND status NOT IN ('BILLED','CANCELLED','MERGED')${branchFilter(req.tenant, 'branch_id', values)} RETURNING order_id`,
    values
  );
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found, or already closed' });
  res.json({ success: true });
};

/* ==========================================================================
   PATCH /api/orders/:id/waiter  { waiter_user_id | null } — hand a table to another waiter
   ========================================================================== */
export const setWaiter = async (req, res) => {
  const waiterId = req.body?.waiter_user_id ? Number(req.body.waiter_user_id) : null;
  const scope = [req.params.id, req.tenant.businessId];
  const order = (await pool.query(
    `SELECT order_id, branch_id, status FROM orders WHERE order_id = $1 AND business_id = $2${branchFilter(req.tenant, 'branch_id', scope)}`, scope
  )).rows[0];
  if (!order) return res.status(404).json({ success: false, message: 'Not found' });
  if (['BILLED', 'CANCELLED', 'MERGED'].includes(order.status)) return res.status(409).json({ success: false, message: 'This order is closed' });
  if (waiterId && !(await isEligibleWaiter(pool, req.tenant.businessId, order.branch_id, waiterId))) {
    return res.status(400).json({ success: false, message: 'Choose a waiter who works at this outlet' });
  }
  await pool.query(`UPDATE orders SET waiter_user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE order_id = $2`, [waiterId, order.order_id]);
  recordAudit(req, { action: 'order.waiter_set', resource_type: 'order', resource_id: order.order_id, metadata: { waiter_user_id: waiterId } });
  return get({ ...req, params: { id: order.order_id } }, res);
};

/* ==========================================================================
   PATCH /api/orders/:id/brand  { brand_id | null } — tag which virtual brand this order is for
   ========================================================================== */
export const setBrand = async (req, res) => {
  const brandId = req.body?.brand_id ? Number(req.body.brand_id) : null;
  const scope = [req.params.id, req.tenant.businessId];
  const order = (await pool.query(
    `SELECT order_id, status FROM orders WHERE order_id = $1 AND business_id = $2${branchFilter(req.tenant, 'branch_id', scope)}`, scope
  )).rows[0];
  if (!order) return res.status(404).json({ success: false, message: 'Not found' });
  if (['BILLED', 'CANCELLED', 'MERGED'].includes(order.status)) return res.status(409).json({ success: false, message: 'This order is closed' });
  if (brandId && !(await pool.query(`SELECT 1 FROM brands WHERE brand_id = $1 AND business_id = $2`, [brandId, req.tenant.businessId])).rows.length) {
    return res.status(400).json({ success: false, message: 'Brand not found' });
  }
  await pool.query(`UPDATE orders SET brand_id = $1, updated_at = CURRENT_TIMESTAMP WHERE order_id = $2`, [brandId, order.order_id]);
  recordAudit(req, { action: 'order.brand_set', resource_type: 'order', resource_id: order.order_id, metadata: { brand_id: brandId } });
  return get({ ...req, params: { id: order.order_id } }, res);
};

/* GET /api/orders/riders — who can be assigned to a delivery order at this outlet */
export const listRiders = async (req, res) => {
  res.json({ success: true, data: await eligibleRiders(pool, req.tenant.businessId, req.tenant.branchId) });
};

/* ==========================================================================
   PATCH /api/orders/:id/rider  { rider_user_id | null } — assign or change who delivers this order
   ========================================================================== */
export const setRider = async (req, res) => {
  const riderId = req.body?.rider_user_id ? Number(req.body.rider_user_id) : null;
  const scope = [req.params.id, req.tenant.businessId];
  const order = (await pool.query(
    `SELECT order_id, branch_id, order_type, status FROM orders WHERE order_id = $1 AND business_id = $2${branchFilter(req.tenant, 'branch_id', scope)}`, scope
  )).rows[0];
  if (!order) return res.status(404).json({ success: false, message: 'Not found' });
  if (order.order_type !== 'DELIVERY') return res.status(400).json({ success: false, message: 'Only delivery orders have a rider' });
  if (['BILLED', 'CANCELLED', 'MERGED'].includes(order.status)) return res.status(409).json({ success: false, message: 'This order is closed' });
  if (riderId && !(await isEligibleRider(pool, req.tenant.businessId, order.branch_id, riderId))) {
    return res.status(400).json({ success: false, message: 'Choose someone who works at this outlet' });
  }
  await pool.query(`UPDATE orders SET rider_user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE order_id = $2`, [riderId, order.order_id]);
  recordAudit(req, { action: 'order.rider_set', resource_type: 'order', resource_id: order.order_id, metadata: { rider_user_id: riderId } });
  return get({ ...req, params: { id: order.order_id } }, res);
};

/* ==========================================================================
   POST /api/orders/:id/delivery-status  { status: PICKED_UP | OUT_FOR_DELIVERY | DELIVERED }
   Each step needs a rider assigned and the step before it already done — the
   same lifecycle order.controller.js's own README-style comment for the spec
   asked for (READY -> ASSIGNED -> PICKED_UP -> OUT_FOR_DELIVERY -> DELIVERED),
   just as nullable timestamps rather than a parallel status enum.
   ========================================================================== */
const DELIVERY_STEPS = ['PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const DELIVERY_COLUMN = { PICKED_UP: 'picked_up_at', OUT_FOR_DELIVERY: 'out_for_delivery_at', DELIVERED: 'delivered_at' };

export const setDeliveryStatus = async (req, res) => {
  const status = String(req.body?.status || '').toUpperCase();
  const stepIndex = DELIVERY_STEPS.indexOf(status);
  if (stepIndex === -1) return res.status(400).json({ success: false, message: 'Status must be PICKED_UP, OUT_FOR_DELIVERY or DELIVERED' });

  const scope = [req.params.id, req.tenant.businessId];
  const order = (await pool.query(
    `SELECT order_id, order_type, rider_user_id, picked_up_at, out_for_delivery_at, delivered_at
     FROM orders WHERE order_id = $1 AND business_id = $2${branchFilter(req.tenant, 'branch_id', scope)}`, scope
  )).rows[0];
  if (!order) return res.status(404).json({ success: false, message: 'Not found' });
  if (order.order_type !== 'DELIVERY') return res.status(400).json({ success: false, message: 'Only delivery orders have a delivery status' });
  if (!order.rider_user_id) return res.status(400).json({ success: false, message: 'Assign a rider first' });

  const priorDone = stepIndex === 0 || order[DELIVERY_COLUMN[DELIVERY_STEPS[stepIndex - 1]]];
  if (!priorDone) return res.status(409).json({ success: false, message: `Mark it ${DELIVERY_STEPS[stepIndex - 1].toLowerCase().replace(/_/g, ' ')} first` });

  const column = DELIVERY_COLUMN[status];
  await pool.query(`UPDATE orders SET ${column} = COALESCE(${column}, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`, [order.order_id]);
  recordAudit(req, { action: 'order.delivery_status', resource_type: 'order', resource_id: order.order_id, metadata: { status } });
  return get({ ...req, params: { id: order.order_id } }, res);
};
