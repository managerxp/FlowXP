/*
 * Sales-order logic shared by the order, fulfilment and invoicing controllers:
 *
 *   buildLines      turn what a salesperson typed into priced, unit-converted order lines
 *   estimate        order totals (lines, GST, shipping, discount) — the same tax function the invoice uses
 *   reserveOrder    promise stock to an order (up to what is free); whatever is short stays a back-order
 *   releaseOrder    give back what an order still holds
 *   refreshStatus   derive the order's status from what has actually been picked, shipped and delivered
 *
 * Quantities on a line are in the line's selling unit; *_base columns are in the product's base unit (what stock
 * is kept in). Reserved / picked / shipped / cancelled are always base units.
 */
import { computeLineTax, isInterState } from '../tax.js';
import { hasPermission } from '../../middleware/auth.js';
import { priceLines } from './pricing.js';
import { loadUnits, unitFor, toBase } from './units.js';
import { lockProducts, release, reserve } from './stock.js';
import { WholesaleError, int, num, text, q3 } from './common.js';

export const OPEN_STATUSES = ['PENDING', 'CONFIRMED', 'PARTIALLY_FULFILLED', 'PACKED', 'DISPATCHED'];
export const ACTIVE_STATUSES = ['CONFIRMED', 'PARTIALLY_FULFILLED', 'PACKED'];   // stock is held for these

/**
 * Validate and price order lines.
 * input: [{ product_id, unit_name?, quantity, price?, discount_pct?, notes? }]
 * A price or discount typed by hand needs the 'pricing' permission; so does selling below a product's minimum order quantity.
 */
export const buildLines = async (db, { tenant, customerId, input, allowBelowMoq = false }) => {
  if (!Array.isArray(input) || !input.length) throw new WholesaleError(400, 'Add at least one product');
  if (input.length > 300) throw new WholesaleError(400, 'An order can have up to 300 lines');
  const privileged = hasPermission(tenant, 'pricing');
  const raw = input.map((l, i) => ({
    product_id: int(l.product_id, `Line ${i + 1} product`, { min: 1, required: true }),
    unit_name: l.unit_name ? String(l.unit_name).trim() : null,
    quantity: num(l.quantity, `Line ${i + 1} quantity`, { min: 0.001, max: 100000000, required: true }),
    price: l.price == null || l.price === '' ? null : num(l.price, `Line ${i + 1} price`, { min: 0 }),
    discount_pct: l.discount_pct == null || l.discount_pct === '' ? null : num(l.discount_pct, `Line ${i + 1} discount`, { min: 0, max: 100 }),
    notes: text(l.notes, 'Line note', { max: 200 })
  }));
  if ((raw.some((l) => l.price != null) || raw.some((l) => l.discount_pct)) && !privileged) throw new WholesaleError(403, 'You do not have permission to change prices or give discounts');
  const products = await lockProducts(db, tenant.businessId, raw.map((l) => l.product_id));
  for (const l of raw) {
    const p = products.get(l.product_id);
    if (!p) throw new WholesaleError(400, `Product ${l.product_id} was not found`);
    if (p.status !== 'ACTIVE') throw new WholesaleError(400, `${p.name} is archived`);
  }
  const units = await loadUnits(db, tenant.businessId, [...products.keys()]);
  const priced = await priceLines(db, { businessId: tenant.businessId, customerId, lines: raw });
  return raw.map((l, i) => {
    const p = products.get(l.product_id);
    const u = unitFor(units, l.product_id, l.unit_name, p.name);
    const rule = priced.get(i);
    if (rule.below_moq && !(allowBelowMoq && privileged)) {
      throw new WholesaleError(400, `${p.name}: the minimum order is ${rule.moq} ${p.unit}`);
    }
    return {
      line_no: i + 1, product_id: l.product_id, name: p.name, base_unit: p.unit, hsn_sac: p.hsn_sac, track_inventory: p.track_inventory,
      unit_name: u.name, unit_factor: u.factor, quantity: l.quantity, base_qty: toBase(l.quantity, u.factor),
      price_paise: l.price != null ? Math.round(l.price * 100) : rule.price_paise,
      price_source: l.price != null ? 'MANUAL' : rule.source, discount_pct: l.discount_pct ?? 0,
      tax_rate: Number(p.tax_rate), notes: l.notes, mrp_paise: rule.mrp_paise
    };
  });
};

/** Money for an order: each line's GST (CGST+SGST or IGST by place of supply), shipping, and an order-level discount. */
export const estimate = async (db, { businessId, branchId, customerId, lines, shippingPaise = 0, shippingTaxRate = 0, discountPaise = 0 }) => {
  const biz = (await db.query(`SELECT gst_enabled, state FROM businesses WHERE business_id = $1`, [businessId])).rows[0];
  const outlet = (await db.query(`SELECT state FROM branches WHERE branch_id = $1 AND business_id = $2`, [branchId, businessId])).rows[0];
  const customer = customerId ? (await db.query(`SELECT state FROM customers WHERE customer_id = $1 AND business_id = $2`, [customerId, businessId])).rows[0] : null;
  const interState = isInterState(outlet?.state || biz.state, customer?.state);
  let subtotal = 0; let tax = 0; let total = 0;
  const priced = lines.map((l) => {
    const gross = Math.round(l.quantity * l.price_paise);
    const lineDiscount = Math.round(gross * Number(l.discount_pct || 0) / 100);
    const t = computeLineTax({ quantity: l.quantity, unitPricePaise: l.price_paise, discountPaise: lineDiscount, taxRatePercent: l.tax_rate, gstEnabled: biz.gst_enabled, interState });
    subtotal += t.taxable_paise; tax += t.tax_paise; total += t.line_total_paise;
    return { ...l, discount_paise: lineDiscount, taxable_paise: t.taxable_paise, tax_paise: t.tax_paise, line_total_paise: t.line_total_paise };
  });
  if (shippingPaise > 0) {
    const t = computeLineTax({ quantity: 1, unitPricePaise: shippingPaise, discountPaise: 0, taxRatePercent: shippingTaxRate, gstEnabled: biz.gst_enabled, interState });
    subtotal += t.taxable_paise; tax += t.tax_paise; total += t.line_total_paise;
  }
  if (discountPaise > total) throw new WholesaleError(400, 'The discount is more than the order');
  return { lines: priced, subtotal_paise: subtotal, tax_paise: tax, total_paise: total - discountPaise, discount_paise: discountPaise, gst_enabled: biz.gst_enabled, inter_state: interState };
};

/* ── reservation ──────────────────────────────────────────────────────────────────────────── */

/** What an order line still needs from the shelf (base units): ordered − shipped − cancelled − already reserved. */
export const stillNeeded = (it) => Math.max(0, q3(Number(it.base_qty) - Number(it.shipped_base) - Number(it.cancelled_base) - Number(it.reserved_base)));

/**
 * Reserve stock for an order's lines, in product-id order (the lock order everyone uses). Returns the lines that are
 * still short: [{ item_id, product_id, short }]. The caller holds the transaction.
 */
export const reserveOrder = async (client, order, items) => {
  const short = [];
  const sorted = [...items].sort((a, b) => a.product_id - b.product_id || a.item_id - b.item_id);
  for (const it of sorted) {
    const need = stillNeeded(it);
    if (need <= 0) continue;
    const got = await reserve(client, { branchId: order.branch_id, productId: it.product_id, qty: need, allowPartial: true });
    if (got > 0) await client.query(`UPDATE wholesale_sales_order_items SET reserved_base = reserved_base + $2 WHERE item_id = $1`, [it.item_id, got]);
    it.reserved_base = q3(Number(it.reserved_base) + got);
    if (got < need - 1e-9) short.push({ item_id: it.item_id, product_id: it.product_id, short: q3(need - got) });
  }
  return short;
};

/** Give back everything the order still holds (cancel, edit, close). */
export const releaseOrder = async (client, order, items) => {
  const sorted = [...items].sort((a, b) => a.product_id - b.product_id || a.item_id - b.item_id);
  for (const it of sorted) {
    const held = Number(it.reserved_base);
    if (held <= 0) continue;
    await release(client, { branchId: order.branch_id, productId: it.product_id, qty: held });
    await client.query(`UPDATE wholesale_sales_order_items SET reserved_base = 0 WHERE item_id = $1`, [it.item_id]);
    it.reserved_base = 0;
  }
};

export const loadItems = async (db, orderId, { lock = false } = {}) =>
  (await db.query(`SELECT * FROM wholesale_sales_order_items WHERE order_id = $1 ORDER BY line_no ${lock ? 'FOR UPDATE' : ''}`, [orderId])).rows;

/* ── status ───────────────────────────────────────────────────────────────────────────────── */

/**
 * Derive the status of a confirmed (or later) order from the facts and store it. Draft, pending and cancelled orders
 * are left alone. Returns the new status.
 *
 *   nothing shipped              CONFIRMED  (PACKED once a pick list is packed and waiting for the van)
 *   some shipped, some open      PARTIALLY_FULFILLED
 *   everything shipped/closed    FULFILLED → DISPATCHED while a delivery is on the road → DELIVERED when all have arrived
 */
export const refreshStatus = async (client, orderId) => {
  const order = (await client.query(`SELECT order_id, status FROM wholesale_sales_orders WHERE order_id = $1 FOR UPDATE`, [orderId])).rows[0];
  if (!order || ['DRAFT', 'PENDING', 'CANCELLED', 'REJECTED'].includes(order.status)) return order?.status ?? null;
  const t = (await client.query(
    `SELECT COALESCE(SUM(shipped_base), 0) AS shipped, COALESCE(SUM(base_qty - shipped_base - cancelled_base), 0) AS open FROM wholesale_sales_order_items WHERE order_id = $1`, [orderId])).rows[0];
  const shipped = Number(t.shipped); const open = Number(t.open);
  const d = (await client.query(
    `SELECT COUNT(*) FILTER (WHERE status IN ('PENDING','ASSIGNED','OUT_FOR_DELIVERY')) AS moving, COUNT(*) FILTER (WHERE status = 'OUT_FOR_DELIVERY') AS out_now,
            COUNT(*) FILTER (WHERE status IN ('DELIVERED','PARTIAL')) AS delivered, COUNT(*) FILTER (WHERE status NOT IN ('FAILED','RETURNED')) AS live,
            COUNT(*) FILTER (WHERE dispatch_date IS NOT NULL AND status NOT IN ('FAILED','RETURNED')) AS dispatched
     FROM wholesale_deliveries WHERE order_id = $1`, [orderId])).rows[0];
  let status;
  if (shipped <= 1e-9) {
    const packed = Number((await client.query(`SELECT COUNT(*) AS n FROM wholesale_pick_lists WHERE order_id = $1 AND status = 'PACKED'`, [orderId])).rows[0].n);
    status = packed ? 'PACKED' : 'CONFIRMED';
  } else if (open > 1e-9) status = 'PARTIALLY_FULFILLED';
  else if (Number(d.live) > 0 && Number(d.delivered) === Number(d.live)) status = 'DELIVERED';
  else if (Number(d.dispatched) > 0) status = 'DISPATCHED';
  else status = 'FULFILLED';
  if (status !== order.status) await client.query(`UPDATE wholesale_sales_orders SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`, [orderId, status]);
  return status;
};

/**
 * Goods have arrived at a warehouse: hand them to the customers waiting on a back-order, oldest order first.
 * The caller holds the product locks. Rows another request is working on are skipped (they can press "reserve"
 * again) rather than waited for, so a delivery never deadlocks with someone confirming an order.
 * Returns [{ order_id, order_number, reserved }].
 */
export const allocateArrivals = async (client, { businessId, branchId, productIds }) => {
  if (!productIds.length) return [];
  const rows = (await client.query(
    `SELECT i.*, o.order_number FROM wholesale_sales_order_items i JOIN wholesale_sales_orders o ON o.order_id = i.order_id
     WHERE o.business_id = $1 AND o.branch_id = $2 AND o.status = ANY($3::text[]) AND i.product_id = ANY($4::int[])
       AND i.base_qty - i.shipped_base - i.cancelled_base - i.reserved_base > 0.0005
     ORDER BY o.order_date, o.order_id, i.item_id FOR UPDATE OF i SKIP LOCKED`, [businessId, branchId, ACTIVE_STATUSES, productIds])).rows;
  const touched = new Map();
  for (const it of rows) {
    const before = Number(it.reserved_base);
    await reserveOrder(client, { branch_id: branchId }, [it]);
    const got = q3(Number(it.reserved_base) - before);
    if (got > 0) touched.set(it.order_id, { order_id: it.order_id, order_number: it.order_number, reserved: q3((touched.get(it.order_id)?.reserved || 0) + got) });
  }
  return [...touched.values()];
};
