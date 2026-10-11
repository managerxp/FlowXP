/*
 * Vans: the vehicle register, loading from the warehouse, selling from the van, taking unsold stock back, and the
 * end-of-day count. The stock rules are in modules/distributor/vehicles.js; a van sale goes through the normal billing
 * engine (flagged so the warehouse is not charged twice) and leaves an order behind it, so reports see it like any other
 * secondary sale.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { hasPermission } from '../middleware/auth.js';
import { createInvoiceInTransaction, recordInvoiceCreated } from '../modules/billing.js';
import { checkCredit } from '../modules/wholesale/credit.js';
import { buildLines, estimate } from '../modules/wholesale/orders.js';
import { loadUnits, toBase, unitFor } from '../modules/wholesale/units.js';
import { notify } from '../modules/wholesale/notify.js';
import { evaluateSchemes } from '../modules/distributor/schemes.js';
import { fieldContext } from '../modules/distributor/field.js';
import { consumeFromVehicle, loadVehicle, lockVehicle, reconcileVehicle, returnToWarehouse, takeFromVehicle, vehicleStock } from '../modules/distributor/vehicles.js';
import {
  WholesaleError, addDays, audit, bool, diff, getSettings, int, isoDate, like, money, nextNumber, num, ok, oneOf, page, paging, q3, text, today, withTransaction, wrapAll
} from '../modules/distributor/common.js';
import { myRep } from './distributorTeam.controller.js';

const rupees = (v) => toRupees(Number(v || 0));

const shape = (v) => ({
  vehicle_id: v.vehicle_id, vehicle_no: v.vehicle_no, branch_id: v.branch_id, warehouse: v.warehouse_name ?? null, driver_name: v.driver_name, driver_user_id: v.driver_user_id,
  salesperson_id: v.salesperson_id, salesperson: v.salesperson_name ?? null, route: v.route, capacity_kg: v.capacity_kg == null ? null : Number(v.capacity_kg), status: v.status, notes: v.notes,
  ...(v.items != null ? { items: Number(v.items), stock_value: rupees(v.stock_value) } : {})
});

const SELECT = `
  SELECT v.*, b.name AS warehouse_name, s.name AS salesperson_name,
         (SELECT COUNT(*) FROM dist_vehicle_stock x WHERE x.vehicle_id = v.vehicle_id AND x.qty_base > 0) AS items,
         COALESCE((SELECT SUM(x.qty_base * p.purchase_price_paise) FROM dist_vehicle_stock x JOIN products p ON p.product_id = x.product_id WHERE x.vehicle_id = v.vehicle_id), 0) AS stock_value
  FROM dist_vehicles v JOIN branches b ON b.branch_id = v.branch_id LEFT JOIN wholesale_salespeople s ON s.salesperson_id = v.salesperson_id`;

/** The vehicle if this person may use it: staff any; a field rep only the van assigned to them. */
const visibleVehicle = async (req, id, db = pool) => {
  const row = (await db.query(`${SELECT} WHERE v.business_id = $1 AND v.vehicle_id = $2`, [req.tenant.businessId, id])).rows[0];
  if (!row) throw new WholesaleError(404, 'Not found');
  if (req.tenant.pinned && row.branch_id !== req.tenant.branchId && !['FIELD_SALES', 'SALES_EXECUTIVE'].includes(req.tenant.role)) throw new WholesaleError(404, 'Not found');
  const mine = await myRep(req);
  if (mine != null && row.salesperson_id !== mine) throw new WholesaleError(404, 'Not found');
  return row;
};

const fields = async (req, b, partial) => {
  const f = {}; const has = (k) => !partial || k in b;
  if (has('vehicle_no')) f.vehicle_no = text(b.vehicle_no, 'Vehicle number', { max: 20, min: 4, required: true })?.toUpperCase();
  if (has('branch_id')) {
    f.branch_id = int(b.branch_id ?? req.tenant.branchId, 'Warehouse', { min: 1, required: true });
    if (!(await pool.query(`SELECT 1 FROM branches WHERE business_id = $1 AND branch_id = $2 AND status = 'ACTIVE'`, [req.tenant.businessId, f.branch_id])).rowCount) throw new WholesaleError(400, 'That warehouse was not found');
  }
  if ('driver_name' in b) f.driver_name = text(b.driver_name, 'Driver', { max: 120 });
  if ('driver_user_id' in b) {
    f.driver_user_id = int(b.driver_user_id, 'Driver login', { min: 1 });
    if (f.driver_user_id && !(await pool.query(`SELECT 1 FROM business_users WHERE business_id = $1 AND user_id = $2`, [req.tenant.businessId, f.driver_user_id])).rowCount) throw new WholesaleError(400, 'That login is not on your team');
  }
  if ('salesperson_id' in b) {
    f.salesperson_id = int(b.salesperson_id, 'Salesperson', { min: 1 });
    if (f.salesperson_id && !(await pool.query(`SELECT 1 FROM wholesale_salespeople WHERE business_id = $1 AND salesperson_id = $2`, [req.tenant.businessId, f.salesperson_id])).rowCount) throw new WholesaleError(400, 'That salesperson was not found');
  }
  if ('route' in b) f.route = text(b.route, 'Route', { max: 160 });
  if ('capacity_kg' in b) f.capacity_kg = num(b.capacity_kg, 'Capacity', { min: 1, max: 1000000 });
  if ('status' in b) f.status = oneOf(b.status, 'Status', ['ACTIVE', 'INACTIVE'], { required: true });
  if ('notes' in b) f.notes = text(b.notes, 'Notes', { max: 300 });
  return f;
};

const list = async (req, res) => {
  const values = [req.tenant.businessId]; const where = ['v.business_id = $1'];
  const status = String(req.query.status || 'ACTIVE').toUpperCase();
  if (status !== 'ALL') { values.push(status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'); where.push(`v.status = $${values.length}`); }
  if (req.tenant.pinned) { values.push(req.tenant.branchId); where.push(`v.branch_id = $${values.length}`); }
  const mine = await myRep(req);
  if (mine != null) { values.push(mine); where.push(`v.salesperson_id = $${values.length}`); }
  if (req.query.q) { values.push(like(String(req.query.q).trim().slice(0, 40))); where.push(`(v.vehicle_no ILIKE $${values.length} OR v.driver_name ILIKE $${values.length})`); }
  ok(res, (await pool.query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY v.status, v.vehicle_no`, values)).rows.map(shape));
};

const create = async (req, res) => {
  const f = await fields(req, req.body || {}, false);
  let row;
  try {
    const keys = Object.keys(f);
    row = (await pool.query(`INSERT INTO dist_vehicles (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING vehicle_id`, [req.tenant.businessId, ...keys.map((k) => f[k])])).rows[0];
  } catch (e) { if (e.code === '23505') throw new WholesaleError(409, 'You already have a vehicle with that number'); throw e; }
  audit(req, 'distributor.vehicle_created', 'vehicle', row.vehicle_id, null, f);
  ok(res, shape((await pool.query(`${SELECT} WHERE v.vehicle_id = $1`, [row.vehicle_id])).rows[0]), 201);
};

const update = async (req, res) => {
  const before = await visibleVehicle(req, req.params.id);
  const f = await fields(req, req.body || {}, true); const keys = Object.keys(f);
  if (!keys.length) throw new WholesaleError(400, 'Nothing to update');
  if (f.branch_id && f.branch_id !== before.branch_id && Number(before.items) > 0) throw new WholesaleError(409, 'Take the stock off the van before changing its home warehouse');
  try { await pool.query(`UPDATE dist_vehicles SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE business_id = $1 AND vehicle_id = $2`, [req.tenant.businessId, before.vehicle_id, ...keys.map((k) => f[k])]); }
  catch (e) { if (e.code === '23505') throw new WholesaleError(409, 'You already have a vehicle with that number'); throw e; }
  const after = (await pool.query(`${SELECT} WHERE v.vehicle_id = $1`, [before.vehicle_id])).rows[0];
  audit(req, 'distributor.vehicle_updated', 'vehicle', before.vehicle_id, null, null, { changes: diff(shape(before), shape(after)) });
  ok(res, shape(after));
};

const stockShape = (r, units) => ({
  stock_id: r.stock_id, product_id: r.product_id, product: r.name, sku: r.sku, unit: r.unit, batch_id: r.batch_id, batch_no: r.batch_no, expiry_date: r.expiry_date, qty: Number(r.qty_base),
  value: rupees(Math.round(Number(r.qty_base) * Number(r.purchase_price_paise || 0))), ...(units ? { units: units.get(r.product_id) } : {})
});

const get = async (req, res) => {
  const v = await visibleVehicle(req, req.params.id);
  const stock = await vehicleStock(pool, v.vehicle_id);
  const moves = (await pool.query(
    `SELECT m.move_id, m.kind, m.qty_base, m.ref_type, m.ref_id, m.note, m.created_at, p.name AS product, b.batch_no FROM dist_vehicle_moves m JOIN products p ON p.product_id = m.product_id LEFT JOIN wholesale_batches b ON b.batch_id = m.batch_id
     WHERE m.vehicle_id = $1 ORDER BY m.move_id DESC LIMIT 30`, [v.vehicle_id])).rows;
  const recon = (await pool.query(`SELECT recon_id, created_at, shortage_paise, surplus_paise, returned, note FROM dist_vehicle_reconciliations WHERE vehicle_id = $1 ORDER BY recon_id DESC LIMIT 5`, [v.vehicle_id])).rows;
  const unitMap = new Map(); const um = await loadUnits(pool, req.tenant.businessId, [...new Set(stock.map((s) => s.product_id))]);
  for (const [id, e] of um) unitMap.set(id, [...e.units.values()].map((u) => ({ unit_name: u.name, factor: u.factor })));
  const sold = (await pool.query(`SELECT COALESCE(SUM(total_paise), 0) AS total, COUNT(*) AS n FROM wholesale_sales_orders WHERE vehicle_id = $1 AND order_date = (SELECT (CURRENT_TIMESTAMP AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $2), 'Asia/Kolkata'))::date) AND status <> 'CANCELLED'`, [v.vehicle_id, req.tenant.businessId])).rows[0];
  ok(res, {
    ...shape(v), stock: stock.map((r) => stockShape(r, unitMap)),
    today: { sales: Number(sold.n), value: rupees(sold.total) },
    moves: moves.map((m) => ({ move_id: m.move_id, kind: m.kind, qty: Number(m.qty_base), product: m.product, batch_no: m.batch_no, ref_type: m.ref_type, ref_id: m.ref_id, note: m.note, at: m.created_at })),
    reconciliations: recon.map((r) => ({ recon_id: r.recon_id, at: r.created_at, shortage: rupees(r.shortage_paise), surplus: rupees(r.surplus_paise), returned: r.returned, note: r.note }))
  });
};

/** Turn [{ product_id, unit_name?, quantity }] into base-unit quantities, in the units the product is sold in. */
const baseItems = async (req, input, label) => {
  if (!Array.isArray(input) || !input.length) throw new WholesaleError(400, `Choose what to ${label}`);
  if (input.length > 300) throw new WholesaleError(400, 'That is too many lines at once');
  const ids = [...new Set(input.map((i) => int(i.product_id, 'Product', { min: 1, required: true })))];
  const units = await loadUnits(pool, req.tenant.businessId, ids);
  const names = new Map((await pool.query(`SELECT product_id, name FROM products WHERE business_id = $1 AND product_id = ANY($2::int[])`, [req.tenant.businessId, ids])).rows.map((r) => [r.product_id, r.name]));
  if (names.size !== ids.length) throw new WholesaleError(400, 'One of those products was not found');
  return input.map((i) => {
    const pid = Number(i.product_id);
    const u = unitFor(units, pid, i.unit_name || null, names.get(pid));
    return { product_id: pid, qty: toBase(num(i.quantity, 'Quantity', { min: 0.001, max: 100000000, required: true }), u.factor) };
  });
};

/* POST /vehicles/:id/load { items: [{ product_id, unit_name?, quantity }] } */
const load = async (req, res) => {
  const v0 = await visibleVehicle(req, req.params.id);
  if (v0.status !== 'ACTIVE') throw new WholesaleError(409, 'This vehicle is switched off');
  const items = await baseItems(req, req.body?.items, 'load');
  await withTransaction(async (client) => {
    const v = await lockVehicle(client, req.tenant.businessId, v0.vehicle_id);
    await loadVehicle(client, { businessId: req.tenant.businessId, vehicle: v, items, userId: req.auth.userId, today: await today(client, req.tenant.businessId) });
  });
  audit(req, 'distributor.vehicle_loaded', 'vehicle', v0.vehicle_id, null, null, { vehicle: v0.vehicle_no, lines: items.length });
  await get(req, res);
};

/* POST /vehicles/:id/return { all?: true, items?: [{ stock_id, quantity (base) }] } — unsold stock back to the warehouse */
const giveBack = async (req, res) => {
  const v0 = await visibleVehicle(req, req.params.id);
  const b = req.body || {};
  await withTransaction(async (client) => {
    const v = await lockVehicle(client, req.tenant.businessId, v0.vehicle_id);
    let rows;
    if (bool(b.all)) rows = (await vehicleStock(client, v.vehicle_id)).map((s) => ({ stock_id: s.stock_id, qty: Number(s.qty_base) }));
    else {
      if (!Array.isArray(b.items) || !b.items.length) throw new WholesaleError(400, 'Choose what to take off the van');
      rows = b.items.map((i) => ({ stock_id: int(i.stock_id, 'Stock line', { min: 1, required: true }), qty: num(i.quantity, 'Quantity', { min: 0.001, required: true }) }));
    }
    if (!rows.length) throw new WholesaleError(409, 'There is nothing on this van');
    await returnToWarehouse(client, { businessId: req.tenant.businessId, vehicle: v, rows, userId: req.auth.userId, note: text(b.note, 'Note', { max: 200 }) });
  });
  audit(req, 'distributor.vehicle_unloaded', 'vehicle', v0.vehicle_id, null, null, { vehicle: v0.vehicle_no });
  await get(req, res);
};

/* POST /vehicles/:id/reconcile { counts: [{ stock_id, counted }], return_to_warehouse?: true, note? } */
const reconcile = async (req, res) => {
  const v0 = await visibleVehicle(req, req.params.id);
  const b = req.body || {};
  const counts = (Array.isArray(b.counts) ? b.counts : []).map((c) => ({ stock_id: int(c.stock_id, 'Stock line', { min: 1, required: true }), counted: num(c.counted, 'Counted', { min: 0, required: true }) }));
  const result = await withTransaction(async (client) => {
    const v = await lockVehicle(client, req.tenant.businessId, v0.vehicle_id);
    return reconcileVehicle(client, { businessId: req.tenant.businessId, vehicle: v, counts, returnAll: bool(b.return_to_warehouse), userId: req.auth.userId, note: text(b.note, 'Note', { max: 300 }) });
  });
  audit(req, 'distributor.vehicle_reconciled', 'vehicle', v0.vehicle_id, null, null, { vehicle: v0.vehicle_no, shortage: rupees(result.shortage_paise), surplus: rupees(result.surplus_paise), returned: bool(b.return_to_warehouse) });
  ok(res, {
    recon_id: result.recon_id, shortage: rupees(result.shortage_paise), surplus: rupees(result.surplus_paise), returned: bool(b.return_to_warehouse),
    lines: result.lines.map((l) => ({ product: l.product, batch_no: l.batch_no, unit: l.unit, system: l.system, counted: l.counted, variance: l.variance, value: rupees(l.value_paise) }))
  });
};

const keyOf = (req) => req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'] || null;
const isOffline = (req) => req.get?.('X-Offline-Sale') === '1' || req.headers?.['x-offline-sale'] === '1';
/* The day a van sale was made, as the phone says it: believed within the last 7 days (and not later than tomorrow); otherwise the phone's clock is wrong and it is dated today. */
const offlineDay = (req, todayDate) => {
  const day = req.get?.('X-Sale-Date') || req.headers?.['x-sale-date'];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day ?? ''))) return todayDate;
  const age = (Date.parse(todayDate) - Date.parse(day)) / 86400000;
  return age >= -1 && age <= 7 ? day : todayDate;
};
/* A van sale already made under this key, answered as the original was (the key is kept on the order, so a rep offline for days still gets the same bill back). */
const earlierSale = async (req) => {
  const key = keyOf(req);
  if (!key) return null;
  const row = (await pool.query(
    `SELECT o.order_id, o.order_number, i.invoice_id, i.invoice_number, i.total_paise FROM wholesale_sales_orders o
     LEFT JOIN wholesale_invoice_meta m ON m.order_id = o.order_id LEFT JOIN invoices i ON i.invoice_id = m.invoice_id
     WHERE o.business_id = $1 AND o.client_key = $2`, [req.tenant.businessId, key])).rows[0];
  return row ? { order_id: row.order_id, order_number: row.order_number, invoice_id: row.invoice_id, invoice_number: row.invoice_number, invoice_total: toRupees(row.total_paise), warnings: [], review: [] } : null;
};

/* POST /vehicles/:id/sell { customer_id, lines: [{ product_id, unit_name?, quantity }], payment?: { amount, method, reference_number }, invoice_kind?, payment_terms_days?, discount?, notes?, visit_id?, beat_id?, credit_override? } */
const sell = async (req, res) => {
  const b = req.body || {};
  const earlier = await earlierSale(req).catch(() => null);
  if (earlier) { res.set('Idempotent-Replay', 'true'); return ok(res, earlier, 201); }
  const offline = isOffline(req);
  const v0 = await visibleVehicle(req, req.params.id);
  if (v0.status !== 'ACTIVE') throw new WholesaleError(409, 'This vehicle is switched off');
  const customerId = int(b.customer_id, 'Customer', { min: 1, required: true });
  const customer = (await pool.query(`SELECT c.customer_id, c.name, c.status, w.salesperson_id, w.payment_terms_days FROM customers c LEFT JOIN wholesale_customer_profiles w ON w.customer_id = c.customer_id WHERE c.business_id = $1 AND c.customer_id = $2`, [req.tenant.businessId, customerId])).rows[0];
  if (!customer) throw new WholesaleError(400, 'Choose a customer from your list');
  if (customer.status !== 'ACTIVE') throw new WholesaleError(400, `${customer.name} is archived`);
  const settings = await getSettings(pool, req.tenant.businessId);
  const kind = oneOf(b.invoice_kind, 'Invoice type', ['TAX', 'CASH', 'CREDIT'], { fallback: 'TAX' });
  const manualDiscount = money(b.discount ?? 0, 'Discount') ?? 0;
  const field = await fieldContext(req, b, customer);
  const input = (Array.isArray(b.lines) ? b.lines : []).filter((l) => !l?.is_free);

  const out = await withTransaction(async (client) => {
    const vehicle = await lockVehicle(client, req.tenant.businessId, v0.vehicle_id);
    const todayDate = await today(client, req.tenant.businessId);
    const date = offline ? offlineDay(req, todayDate) : todayDate;
    const review = [];
    const built = await buildLines(client, { tenant: req.tenant, customerId, input, allowBelowMoq: false });
    const sch = await evaluateSchemes(client, { businessId: req.tenant.businessId, customerId, lines: built, on: date, stacking: settings.scheme_stacking });
    const lines = [...sch.lines, ...sch.free.map((f, k) => ({ ...f, line_no: sch.lines.length + k + 1 }))];
    const est = await estimate(client, { businessId: req.tenant.businessId, branchId: vehicle.branch_id, customerId, lines, shippingPaise: 0, shippingTaxRate: 0, discountPaise: manualDiscount + sch.order_discount_paise });

    // the goods come off the van, soonest expiry first, free goods included
    const need = new Map();
    for (const l of lines) need.set(l.product_id, q3((need.get(l.product_id) || 0) + Number(l.base_qty)));
    const taken = new Map();
    for (const [productId, qty] of [...need].sort((a, c) => a[0] - c[0])) {
      const name = lines.find((l) => l.product_id === productId).name;
      const t = await takeFromVehicle(client, { vehicleId: vehicle.vehicle_id, productId, qty, today: date, productName: name, allowShort: offline });
      if (t.short > 0) review.push(`${name}: ${t.short} more sold than the van held`);
      taken.set(productId, t);
    }

    const pay = b.payment && b.payment.amount != null ? b.payment : null;
    const paidPaise = pay ? (String(pay.amount).toUpperCase() === 'FULL' ? est.total_paise : Math.round(Number(pay.amount) * 100)) : 0;
    const credit = await checkCredit(client, { businessId: req.tenant.businessId, customerId, amountPaise: Math.max(0, est.total_paise - paidPaise), settings });
    if (offline && credit.level === 'BLOCK') review.push(`over their credit limit: ${credit.reasons.join('. ')}`);
    if (credit.level === 'BLOCK' && !offline && !(bool(b.credit_override) && hasPermission(req.tenant, 'sales_cancel') && settings.credit_manager_override !== false)) {
      throw new WholesaleError(409, `Credit limit: ${credit.reasons.join('. ')}`, { code: 'CREDIT_BLOCK', data: { reasons: credit.reasons } });
    }
    const terms = b.payment_terms_days != null ? int(b.payment_terms_days, 'Payment terms', { min: 0, max: 365 }) : (customer.payment_terms_days ?? settings.default_payment_terms_days);
    const rep = vehicle.salesperson_id ?? customer.salesperson_id ?? null;

    // what the rep showed the shop is compared with the server's price; money may already have been taken, so a difference either way is written down
    if (offline && b.expected_total != null && Math.abs(Math.round(Number(b.expected_total) * 100) - est.total_paise) > 100) review.push(`the phone showed ₹${b.expected_total}, the server priced it at ₹${rupees(est.total_paise)}`);
    const offlineNote = offline ? `Taken offline${review.length ? `. Check: ${review.join('; ')}` : ''}` : null;
    const orderNotes = [text(b.notes, 'Notes', { max: 1000 }), offlineNote].filter(Boolean).join(' | ') || null;
    const number = await nextNumber(client, req.tenant.businessId, 'SO', settings.order_prefix);
    const order = (await client.query(
      `INSERT INTO wholesale_sales_orders (business_id, branch_id, order_number, order_date, customer_id, salesperson_id, status, payment_terms_days, subtotal_paise, tax_paise, total_paise, discount_paise, scheme_discount_paise,
         notes, created_by, confirmed_by, confirmed_at, source, vehicle_id, territory_id, beat_id, visit_id, client_key)
       VALUES ($1,$2,$3,$4,$5,$6,'DELIVERED',$7,$8,$9,$10,$11,$12,$13,$14,$14,CURRENT_TIMESTAMP,'VAN',$15,$16,$17,$18,$19) RETURNING *`,
      [req.tenant.businessId, vehicle.branch_id, number, date, customerId, rep, terms, est.subtotal_paise, est.tax_paise, est.total_paise, manualDiscount + sch.order_discount_paise, sch.order_discount_paise,
        orderNotes, req.auth.userId, vehicle.vehicle_id, field.territory_id, field.beat_id, field.visit_id, keyOf(req)])).rows[0];
    for (const l of est.lines) {
      await client.query(
        `INSERT INTO wholesale_sales_order_items (order_id, business_id, line_no, product_id, unit_name, unit_factor, quantity, base_qty, price_paise, price_source, discount_pct, tax_rate, notes, is_free, scheme_id, picked_base, shipped_base)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$8,$8)`,
        [order.order_id, order.business_id, l.line_no, l.product_id, l.unit_name, l.unit_factor, l.quantity, l.base_qty, l.price_paise, l.price_source, l.discount_pct, l.tax_rate, l.notes, Boolean(l.is_free), l.scheme_id ?? null]);
    }
    for (const a of sch.applications) {
      await client.query(`INSERT INTO dist_scheme_applications (business_id, order_id, scheme_id, free_product_id, free_base, discount_paise, cost_paise) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [order.business_id, order.order_id, a.scheme_id, a.free_product_id, a.free_base, a.discount_paise, a.cost_paise]);
    }

    const invoice = await createInvoiceInTransaction(client, { ...req.tenant, branchId: vehicle.branch_id }, req.auth.userId, {
      customerId, invoiceDate: date, notes: `Van sale ${number} · ${vehicle.vehicle_no}${offlineNote ? ` | ${offlineNote}` : ''}`, allowNegativeStock: true, stockHandledElsewhere: true, clientKey: keyOf(req),
      discount: toRupees(manualDiscount + sch.order_discount_paise),
      items: est.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity, unit_name: l.unit_name, unit_factor: l.unit_factor, unit_price: Math.round(l.price_paise) / 100, discount: toRupees(l.discount_paise) })),
      ...(pay ? { payment: pay } : {})
    });
    await client.query(
      `INSERT INTO wholesale_invoice_meta (invoice_id, business_id, order_id, salesperson_id, kind, payment_terms_days, due_date) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [invoice.invoice_id, req.tenant.businessId, order.order_id, rep, kind, terms, addDays(date, terms)]);
    for (const [productId, t] of taken) await consumeFromVehicle(client, { businessId: req.tenant.businessId, vehicleId: vehicle.vehicle_id, productId, taken: t, refId: invoice.invoice_id, userId: req.auth.userId });
    return { invoice, order, vehicle, credit, review };
  });
  recordInvoiceCreated(req, out.invoice);
  audit(req, 'distributor.van_sale', 'invoice', out.invoice.invoice_id, null, { vehicle: out.vehicle.vehicle_no, order: out.order.order_number, invoice: out.invoice.invoice_number, total: out.invoice.total, ...(offline ? { offline: true, review: out.review } : {}) });
  notify(req, 'invoice_issued', { customerId, invoiceId: out.invoice.invoice_id, values: { number: out.invoice.invoice_number, total: Math.round(out.invoice.total * 100), due: addDays(String(out.order.order_date).slice(0, 10), Number(out.order.payment_terms_days)) } });
  ok(res, { order_id: out.order.order_id, order_number: out.order.order_number, invoice_id: out.invoice.invoice_id, invoice_number: out.invoice.invoice_number, invoice_total: out.invoice.total, warnings: out.credit.level === 'WARN' ? out.credit.reasons : [], review: out.review }, 201);
};

/* GET /vehicles/stock — what every van is carrying, by product (the vehicle-stock report) */
const stockAll = async (req, res) => {
  const values = [req.tenant.businessId]; let scope = '';
  if (req.tenant.pinned) { values.push(req.tenant.branchId); scope = ` AND v.branch_id = $2`; }
  const rows = (await pool.query(
    `SELECT v.vehicle_id, v.vehicle_no, p.product_id, p.name AS product, p.unit, SUM(s.qty_base) AS qty, SUM(s.qty_base * p.purchase_price_paise) AS value
     FROM dist_vehicle_stock s JOIN dist_vehicles v ON v.vehicle_id = s.vehicle_id JOIN products p ON p.product_id = s.product_id
     WHERE s.business_id = $1 AND s.qty_base > 0 ${scope} GROUP BY v.vehicle_id, v.vehicle_no, p.product_id, p.name, p.unit ORDER BY v.vehicle_no, lower(p.name)`, values)).rows;
  ok(res, rows.map((r) => ({ vehicle_id: r.vehicle_id, vehicle_no: r.vehicle_no, product_id: r.product_id, product: r.product, unit: r.unit, qty: Number(r.qty), value: rupees(r.value) })));
};

export default wrapAll({ list, create, update, get, load, giveBack, reconcile, sell, stockAll });
