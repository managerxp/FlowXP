/*
 * Purchase orders before the goods arrive: draft, edit, send to the supplier,
 * receive (what actually came, at what price), or cancel; and draft orders
 * straight from the stock forecast.
 *
 * Nothing here moves stock or money until an order is RECEIVED. Receiving is the
 * same effect as recording a purchase directly (purchases.controller.js create):
 * stock goes in at the order's outlet through moveStock, the ledger gets a
 * PURCHASE row, the product's cost follows the price paid.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { sendMail } from '../modules/mailer.js';
import { buildInventoryForecast } from '../modules/forecast.js';
import { moveStock } from '../modules/stock.js';
import { computeLineTax, isInterState, sumLines } from '../modules/tax.js';
import { branchFilter } from '../utils/scope.js';
import { addDaysISO, businessToday } from '../utils/dates.js';
import { toPaise, toQuantity, toRupees } from '../utils/money.js';
import { asPO, nextPoNumber, paymentStatus } from './purchases.controller.js';
import { listPrices } from './supplierPrices.controller.js';

const OPEN = ['DRAFT', 'ORDERED'];

class OrderError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (res, error) => {
  if (error instanceof OrderError) return res.status(error.status).json({ success: false, message: error.message });
  if (error.message?.includes('positive number') || error.message?.includes('must be a number')) return res.status(400).json({ success: false, message: error.message });
  throw error;
};

/** Validate order lines against this business's products and work out tax. */
const prepareLines = async (client, businessId, business, rawItems, supplierId = null) => {
  if (!Array.isArray(rawItems) || !rawItems.length) throw new OrderError(400, 'Add at least one item');
  const ids = [...new Set(rawItems.filter((i) => i.product_id).map((i) => Number(i.product_id)))];
  const products = new Map();
  if (ids.length) {
    const { rows } = await client.query(`SELECT product_id, name, track_inventory FROM products WHERE business_id = $1 AND product_id = ANY($2::int[])`, [businessId, ids]);
    for (const p of rows) products.set(p.product_id, p);
  }
  // a line with no price takes the supplier's listed price, else the product's last purchase price
  const listed = supplierId ? await listPrices(client, businessId, supplierId, ids) : new Map();
  const lastPaid = new Map((ids.length ? (await client.query(`SELECT product_id, purchase_price_paise FROM products WHERE business_id = $1 AND product_id = ANY($2::int[])`, [businessId, ids])).rows : []).map((r) => [r.product_id, Number(r.purchase_price_paise)]));
  return rawItems.map((raw) => {
    const quantity = toQuantity(raw.quantity);
    let description; let product = null;
    if (raw.product_id) {
      product = products.get(Number(raw.product_id));
      if (!product) throw new OrderError(400, `Product ${raw.product_id} not found`);
      description = raw.description || product.name;
    } else {
      if (!raw.description) throw new OrderError(400, 'A custom line needs a description');
      description = String(raw.description).trim();
    }
    const noPrice = raw.unit_cost == null || raw.unit_cost === '';
    const unitCostPaise = noPrice && product ? (listed.get(product.product_id)?.price_paise ?? lastPaid.get(product.product_id) ?? 0) : toPaise(raw.unit_cost ?? 0);
    const taxRate = Number(raw.tax_rate) || 0;
    const tax = computeLineTax({ quantity, unitPricePaise: unitCostPaise, taxRatePercent: taxRate, gstEnabled: business.gst_enabled, interState: isInterState(business.state, null) });
    return { product_id: product?.product_id ?? null, description, quantity, unitCostPaise, taxRate, ...tax };
  });
};

const insertLines = async (client, poId, lines) => {
  for (const line of lines) {
    await client.query(
      `INSERT INTO purchase_order_items (po_id, product_id, description, quantity, unit_cost_paise, tax_rate, tax_amount_paise, line_total_paise)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [poId, line.product_id, line.description, line.quantity, line.unitCostPaise, line.taxRate, line.tax_paise, line.line_total_paise]
    );
  }
};

const businessOf = async (client, id) => (await client.query(`SELECT gst_enabled, state, name FROM businesses WHERE business_id = $1`, [id])).rows[0];

const checkSupplier = async (client, businessId, supplierId) => {
  if (!supplierId) return null;
  const s = (await client.query(`SELECT supplier_id, name, phone, email FROM suppliers WHERE supplier_id = $1 AND business_id = $2`, [supplierId, businessId])).rows[0];
  if (!s) throw new OrderError(400, 'Supplier not found');
  return s;
};

const validDate = (v) => (v == null || v === '' ? null : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : (() => { throw new OrderError(400, 'Expected date must be a date'); })());

/** Create an open (DRAFT) order. Shared by the endpoint and the forecast. */
const createOpenOrder = async (client, { tenant, userId, supplierId, items, notes, expectedDate, source = 'MANUAL', businessId = tenant.businessId }) => {
  const business = await businessOf(client, businessId);
  const supplier = await checkSupplier(client, businessId, supplierId);
  const lines = await prepareLines(client, businessId, business, items, supplier?.supplier_id ?? null);
  const totals = sumLines(lines);
  const poNumber = await nextPoNumber(client, businessId);
  const po = (await client.query(
    `INSERT INTO purchase_orders (business_id, branch_id, supplier_id, po_number, po_date, subtotal_paise, tax_paise, total_paise, balance_due_paise,
                                  payment_status, status, source, expected_date, notes, created_by)
     VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6,$7,$7,'UNPAID','DRAFT',$8,$9,$10,$11) RETURNING *`,
    [businessId, tenant.branchId, supplier?.supplier_id ?? null, poNumber, totals.subtotal_paise, totals.tax_paise, totals.total_paise, source, expectedDate, notes || null, userId]
  )).rows[0];
  await insertLines(client, po.po_id, lines);
  return { ...po, supplier_name: supplier?.name ?? null };
};

/* POST /api/purchases/orders { supplier_id?, items, notes?, expected_date? } — a draft, nothing ordered yet */
export const createDraft = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const po = await createOpenOrder(client, {
      tenant: req.tenant, userId: req.auth.userId, supplierId: req.body?.supplier_id, items: req.body?.items,
      notes: req.body?.notes, expectedDate: validDate(req.body?.expected_date), source: req.body?.source === 'FORECAST' ? 'FORECAST' : 'MANUAL'
    });
    await client.query('COMMIT');
    recordAudit(req, { action: 'purchase_order.drafted', resource_type: 'purchase_order', resource_id: po.po_id, metadata: { total: toRupees(po.total_paise), source: po.source } });
    res.status(201).json({ success: true, data: asPO(po) });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); return fail(res, error); } finally { client.release(); }
};

/* POST /api/purchases/orders/from-forecast — one draft per supplier for everything the forecast says to buy */
export const fromForecast = async (req, res) => {
  const { businessId, branchId } = req.tenant;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const forecast = await buildInventoryForecast(businessId, client, branchId);

    // What is already on an open order at this outlet counts towards the need, so pressing this twice doesn't order twice.
    const onOrder = new Map((await client.query(
      `SELECT i.product_id, SUM(i.quantity - COALESCE(i.received_quantity, 0)) AS qty FROM purchase_order_items i JOIN purchase_orders po ON po.po_id = i.po_id
       WHERE po.business_id = $1 AND po.branch_id = $2 AND po.status = ANY($3::text[]) AND i.product_id IS NOT NULL GROUP BY i.product_id`,
      [businessId, branchId, [...OPEN, 'PARTIAL']]
    )).rows.map((r) => [r.product_id, Number(r.qty)]));

    const created = []; const skipped = [];
    for (const group of forecast.by_supplier) {
      const items = [];
      for (const i of group.items) {
        const need = Math.round((i.quantity - (onOrder.get(i.product_id) || 0)) * 1000) / 1000;
        if (need > 0) items.push({ product_id: i.product_id, quantity: need, unit_cost: i.unit_cost });
        else skipped.push(i.name);
      }
      if (!items.length) continue;
      created.push(await createOpenOrder(client, { tenant: req.tenant, userId: req.auth.userId, supplierId: group.supplier_id, items, source: 'FORECAST', expectedDate: null }));
    }
    await client.query('COMMIT');
    for (const po of created) recordAudit(req, { action: 'purchase_order.drafted', resource_type: 'purchase_order', resource_id: po.po_id, metadata: { source: 'FORECAST', total: toRupees(po.total_paise) } });
    res.status(201).json({ success: true, data: { orders: created.map(asPO), already_on_order: [...new Set(skipped)] } });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); return fail(res, error); } finally { client.release(); }
};

/** Lock an open order in this outlet scope. Throws OrderError for missing / not open. */
const lockOpen = async (client, req, { allow = OPEN } = {}) => {
  const values = [req.tenant.businessId, req.params.id];
  const po = (await client.query(
    `SELECT * FROM purchase_orders WHERE business_id = $1 AND po_id = $2${branchFilter(req.tenant, 'branch_id', values)} FOR UPDATE`, values
  )).rows[0];
  if (!po) throw new OrderError(404, 'Not found');
  if (!allow.includes(po.status)) throw new OrderError(409, po.status === 'RECEIVED' ? 'This order has already been received' : po.status === 'CANCELLED' ? 'This order was cancelled' : po.status === 'PARTIAL' ? 'Part of this order has arrived. Receive the rest, or close it as short.' : 'This order can’t be changed now');
  return po;
};

/* PUT /api/purchases/:id — edit an open order */
export const update = async (req, res) => {
  const body = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const po = await lockOpen(client, req);
    const business = await businessOf(client, req.tenant.businessId);
    const supplier = 'supplier_id' in body ? await checkSupplier(client, req.tenant.businessId, body.supplier_id) : null;
    let totals = { subtotal_paise: po.subtotal_paise, tax_paise: po.tax_paise, total_paise: po.total_paise };
    if ('items' in body) {
      const lines = await prepareLines(client, req.tenant.businessId, business, body.items, 'supplier_id' in body ? (supplier?.supplier_id ?? null) : po.supplier_id);
      totals = sumLines(lines);
      await client.query(`DELETE FROM purchase_order_items WHERE po_id = $1`, [po.po_id]);
      await insertLines(client, po.po_id, lines);
    }
    const { rows } = await client.query(
      `UPDATE purchase_orders SET supplier_id = $2, notes = $3, expected_date = $4, subtotal_paise = $5, tax_paise = $6, total_paise = $7, balance_due_paise = $7
       WHERE po_id = $1 RETURNING *`,
      [po.po_id, 'supplier_id' in body ? (supplier?.supplier_id ?? null) : po.supplier_id, 'notes' in body ? (body.notes || null) : po.notes,
        'expected_date' in body ? validDate(body.expected_date) : po.expected_date, totals.subtotal_paise, totals.tax_paise, totals.total_paise]
    );
    await client.query('COMMIT');
    recordAudit(req, { action: 'purchase_order.updated', resource_type: 'purchase_order', resource_id: po.po_id });
    res.json({ success: true, data: asPO({ ...rows[0], supplier_name: null }) });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); return fail(res, error); } finally { client.release(); }
};

const whatsappNumber = (phone) => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? `91${digits.slice(-10)}` : null;
};

/* POST /api/purchases/:id/send { email?: boolean } — mark it ordered and produce the message for the supplier */
export const send = async (req, res) => {
  const client = await pool.connect();
  let message; let supplier; let po; let emailed = false;
  try {
    await client.query('BEGIN');
    po = await lockOpen(client, req);
    if (!po.supplier_id) throw new OrderError(400, 'Choose a supplier before sending the order');
    supplier = (await client.query(`SELECT name, phone, email FROM suppliers WHERE supplier_id = $1`, [po.supplier_id])).rows[0];
    const items = (await client.query(`SELECT i.description, i.quantity, p.unit FROM purchase_order_items i LEFT JOIN products p ON p.product_id = i.product_id WHERE i.po_id = $1 ORDER BY i.item_id`, [po.po_id])).rows;
    if (!items.length) throw new OrderError(400, 'The order has no items');
    const [business, outlet, today] = await Promise.all([
      businessOf(client, req.tenant.businessId),
      client.query(`SELECT name FROM branches WHERE branch_id = $1`, [po.branch_id]),
      businessToday(req.tenant.businessId, client)
    ]);
    // Expected on the day the slowest item's lead time allows, unless the owner set one.
    let expected = po.expected_date ? String(po.expected_date).slice(0, 10) : null;
    if (!expected) {
      const lead = (await client.query(`SELECT COALESCE(MAX(p.lead_time_days), 1) AS d FROM purchase_order_items i JOIN products p ON p.product_id = i.product_id WHERE i.po_id = $1`, [po.po_id])).rows[0].d;
      expected = addDaysISO(today, Number(lead));
    }
    await client.query(`UPDATE purchase_orders SET status = 'ORDERED', ordered_at = COALESCE(ordered_at, CURRENT_TIMESTAMP), expected_date = $2 WHERE po_id = $1`, [po.po_id, expected]);
    message = [
      `Order ${po.po_number} from ${business.name}${outlet.rows[0]?.name ? ` (${outlet.rows[0].name})` : ''}`,
      '', ...items.map((i) => `• ${Number(i.quantity)}${i.unit ? ` ${i.unit}` : ''} ${i.description}`),
      '', `Please deliver by ${expected}.`, po.notes ? `Note: ${po.notes}` : null, 'Thank you!'
    ].filter((l) => l !== null).join('\n');
    await client.query('COMMIT');
    po = { ...po, expected_date: expected };
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); return fail(res, error); } finally { client.release(); }

  if (req.body?.email !== false && supplier.email) {
    await sendMail({ to: supplier.email, subject: `Purchase order ${po.po_number}`, text: message });
    emailed = true;
  }
  recordAudit(req, { action: 'purchase_order.sent', resource_type: 'purchase_order', resource_id: po.po_id, metadata: { emailed } });
  const wa = whatsappNumber(supplier.phone);
  res.json({ success: true, data: { po_number: po.po_number, expected_date: po.expected_date, message, emailed, supplier_email: supplier.email, whatsapp_url: wa ? `https://wa.me/${wa}?text=${encodeURIComponent(message)}` : null } });
};

/* POST /api/purchases/:id/cancel */
export const cancel = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const po = await lockOpen(client, req);
    await client.query(`UPDATE purchase_orders SET status = 'CANCELLED' WHERE po_id = $1`, [po.po_id]);
    await client.query('COMMIT');
    recordAudit(req, { action: 'purchase_order.cancelled', resource_type: 'purchase_order', resource_id: po.po_id });
    res.json({ success: true });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); return fail(res, error); } finally { client.release(); }
};

/* POST /api/purchases/:id/receive { items?: [{ item_id, received_quantity, unit_cost? }], payment?, backorder? }
   What arrived (in this delivery) is added to what came before. A line not mentioned is taken as delivered in full
   (whatever is still owed). `backorder: true` says the rest is still coming: the order stays open as PARTIAL and what
   is still owed is the back-order; otherwise the order is closed and anything short is written off. */
export const receive = async (req, res) => {
  const body = req.body || {};
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const po = await lockOpen(client, req, { allow: [...OPEN, 'PARTIAL'] });
    const business = await businessOf(client, req.tenant.businessId);
    const lines = (await client.query(
      `SELECT i.*, p.track_inventory FROM purchase_order_items i LEFT JOIN products p ON p.product_id = i.product_id WHERE i.po_id = $1 ORDER BY i.item_id FOR UPDATE OF i`, [po.po_id]
    )).rows;
    const given = new Map((Array.isArray(body.items) ? body.items : []).map((x) => [Number(x.item_id), x]));
    for (const id of given.keys()) if (!lines.some((l) => l.item_id === id)) throw new OrderError(400, 'One of those lines isn’t on this order');

    const supplierList = po.supplier_id ? await listPrices(client, req.tenant.businessId, po.supplier_id, lines.map((l) => l.product_id).filter(Boolean)) : new Map();
    const received = lines.map((l) => {
      const before = l.received_quantity == null ? 0 : Number(l.received_quantity);
      const g = given.get(l.item_id);
      const now = g?.received_quantity != null ? Number(g.received_quantity) : Math.max(0, Number(l.quantity) - before);
      if (!Number.isFinite(now) || now < 0) throw new OrderError(400, 'Received quantity can’t be negative');
      const cost = g?.unit_cost != null ? toPaise(g.unit_cost) : Number(l.unit_cost_paise);
      if (cost < 0) throw new OrderError(400, 'Cost can’t be negative');
      const tax = computeLineTax({ quantity: now, unitPricePaise: cost, taxRatePercent: Number(l.tax_rate), gstEnabled: business.gst_enabled, interState: isInterState(business.state, null) });
      return { line: l, before, now, cost, tax };
    });
    if (!received.some((r) => r.now > 0)) throw new OrderError(400, 'Nothing was received. Cancel the order instead.');

    let paid = 0;
    if (body.payment?.amount != null) { paid = toPaise(body.payment.amount); if (paid < 0) throw new OrderError(400, 'Payment amount cannot be negative'); }

    // Products are locked in id order, the same order billing uses, so a delivery and a sale can't deadlock.
    for (const r of [...received].sort((a, b) => (a.line.product_id ?? 0) - (b.line.product_id ?? 0))) {
      // value so far: a line never received holds only its ordered figures, which don't count
      const prevValue = r.line.received_quantity == null ? 0 : Number(r.line.line_total_paise);
      const prevTax = r.line.received_quantity == null ? 0 : Number(r.line.tax_amount_paise);
      await client.query(
        `UPDATE purchase_order_items SET received_quantity = $2, unit_cost_paise = $3, tax_amount_paise = $4, line_total_paise = $5 WHERE item_id = $1`,
        [r.line.item_id, r.before + r.now, r.cost, prevTax + r.tax.tax_paise, prevValue + r.tax.line_total_paise]
      );
      if (r.line.product_id && r.now > 0) {
        await client.query(`UPDATE products SET purchase_price_paise = $1 WHERE product_id = $2 AND business_id = $3`, [r.cost, r.line.product_id, req.tenant.businessId]);
        if (r.line.track_inventory) {
          await client.query(`SELECT 1 FROM products WHERE product_id = $1 FOR UPDATE`, [r.line.product_id]);
          await moveStock(client, { businessId: req.tenant.businessId, branchId: po.branch_id, productId: r.line.product_id, delta: r.now });
          await client.query(
            `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, reference_id, created_by)
             VALUES ($1,$2,$3,'PURCHASE',$4,'purchase_order',$5,$6)`,
            [req.tenant.businessId, po.branch_id, r.line.product_id, r.now, po.po_id, req.auth.userId]
          );
        }
      }
    }

    const owed = received.filter((r) => r.before + r.now < Number(r.line.quantity));
    const partial = body.backorder === true && owed.length > 0;
    const totals = (await client.query(
      `SELECT COALESCE(SUM(line_total_paise - tax_amount_paise), 0) AS sub, COALESCE(SUM(tax_amount_paise), 0) AS tax, COALESCE(SUM(line_total_paise), 0) AS total
       FROM purchase_order_items WHERE po_id = $1 AND received_quantity IS NOT NULL`, [po.po_id])).rows[0];
    const total = Number(totals.total);
    const amountPaid = Number(po.amount_paid_paise) + paid;
    const balance = Math.max(0, total - Number(po.debited_paise) - amountPaid);
    const { rows } = await client.query(
      `UPDATE purchase_orders SET status = $8, received_at = CURRENT_TIMESTAMP, po_date = COALESCE(CASE WHEN status = 'PARTIAL' THEN po_date END, CURRENT_DATE),
              subtotal_paise = $2, tax_paise = $3, total_paise = $4, amount_paid_paise = $5, balance_due_paise = $6, payment_status = $7
       WHERE po_id = $1 RETURNING *`,
      [po.po_id, Number(totals.sub), Number(totals.tax), total, amountPaid, balance, paymentStatus(total - Number(po.debited_paise), amountPaid), partial ? 'PARTIAL' : 'RECEIVED']
    );
    if (paid > 0) {
      await client.query(
        `INSERT INTO payments (business_id, branch_id, po_id, supplier_id, payment_method, amount_paise, reference_number, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.tenant.businessId, po.branch_id, po.po_id, po.supplier_id, body.payment.method || 'CASH', paid, body.payment.reference_number || null, req.auth.userId]
      );
    }
    await client.query('COMMIT');

    const short = owed.map((r) => r.line.description);
    // a delivery billed above the supplier's agreed price
    const priceAlerts = received.filter((r) => r.now > 0 && supplierList.has(r.line.product_id) && r.cost > supplierList.get(r.line.product_id).price_paise)
      .map((r) => ({ item_id: r.line.item_id, description: r.line.description, list_price: toRupees(supplierList.get(r.line.product_id).price_paise), charged: toRupees(r.cost), extra_per_unit: toRupees(r.cost - supplierList.get(r.line.product_id).price_paise), quantity: r.now }));
    recordAudit(req, { action: partial ? 'purchase_order.part_received' : 'purchase_order.received', resource_type: 'purchase_order', resource_id: po.po_id, metadata: { total: toRupees(total), short, price_alerts: priceAlerts.length } });
    res.json({ success: true, data: { ...asPO({ ...rows[0], supplier_name: null }), short_delivered: short, back_order: partial ? owed.map((r) => ({ description: r.line.description, outstanding: Math.round((Number(r.line.quantity) - r.before - r.now) * 1000) / 1000 })) : [], price_alerts: priceAlerts } });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); return fail(res, error); } finally { client.release(); }
};

/* POST /api/purchases/:id/close-short — the rest of a part-delivered order is not coming: close it as received */
export const closeShort = async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const po = await lockOpen(client, req, { allow: ['PARTIAL'] });
    await client.query(`UPDATE purchase_orders SET status = 'RECEIVED' WHERE po_id = $1`, [po.po_id]);
    await client.query('COMMIT');
    recordAudit(req, { action: 'purchase_order.closed_short', resource_type: 'purchase_order', resource_id: po.po_id });
    res.json({ success: true });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); return fail(res, error); } finally { client.release(); }
};

/* GET /api/purchases/backorders — orders that arrived in part, with what is still owed */
export const backorders = async (req, res) => {
  const values = [req.tenant.businessId];
  const { rows } = await pool.query(
    `SELECT po.po_id, po.po_number, po.expected_date, po.branch_id, s.name AS supplier_name, i.description, i.quantity, COALESCE(i.received_quantity, 0) AS received
     FROM purchase_orders po JOIN purchase_order_items i ON i.po_id = po.po_id LEFT JOIN suppliers s ON s.supplier_id = po.supplier_id
     WHERE po.business_id = $1 AND po.status = 'PARTIAL' AND i.quantity > COALESCE(i.received_quantity, 0)${branchFilter(req.tenant, 'po.branch_id', values)}
     ORDER BY po.po_id, i.item_id`, values);
  const byOrder = new Map();
  for (const r of rows) {
    if (!byOrder.has(r.po_id)) byOrder.set(r.po_id, { po_id: r.po_id, po_number: r.po_number, supplier_name: r.supplier_name, expected_date: r.expected_date ? String(r.expected_date).slice(0, 10) : null, outstanding: [] });
    byOrder.get(r.po_id).outstanding.push({ description: r.description, ordered: Number(r.quantity), received: Number(r.received), owed: Math.round((Number(r.quantity) - Number(r.received)) * 1000) / 1000 });
  }
  res.json({ success: true, data: [...byOrder.values()] });
};
