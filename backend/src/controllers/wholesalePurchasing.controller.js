/*
 * Wholesale purchasing: purchase orders in the supplier's units (cartons, boxes), approval, and goods receipt (GRN).
 *
 * The purchase order, its payments and debit notes are the existing FlowXP ones (purchase_orders and friends), so
 * payables, GST and the supplier ledger all keep working. A GRN is one delivery against an order (or a direct
 * purchase with no order): what arrived, what was damaged, what was accepted into stock — with batch, expiry and
 * serial numbers. Stock goes in through the shared stock ledger, damaged goods go to the damaged-stock log, and
 * customers waiting on a back-order are given the new stock the moment it lands.
 *
 * Payable is for what was ACCEPTED; damaged goods are not billed (the supplier replaces or credits them).
 */
import pool from '../config/database.js';
import { sendMail } from '../modules/mailer.js';
import { toRupees } from '../utils/money.js';
import { computeLineTax, isInterState, sumLines } from '../modules/tax.js';
import { nextPoNumber, paymentStatus } from './purchases.controller.js';
import { listPrices } from './supplierPrices.controller.js';
import { addToBatch, batchTracked, lockProducts, logDamaged, stockIn } from '../modules/wholesale/stock.js';
import { loadUnits, toBase, unitFor } from '../modules/wholesale/units.js';
import { allocateArrivals } from '../modules/wholesale/orders.js';
import {
  WholesaleError, addDays, audit, bool, getSettings, int, isoDate, like, nextNumber, num, ok, oneOf, page, paging, q3, text, today, withTransaction, wrapAll
} from '../modules/wholesale/common.js';
import { hasPermission } from '../middleware/auth.js';

const rupees = (v) => toRupees(Number(v || 0));
const PO_STATUSES = ['DRAFT', 'ORDERED', 'CONFIRMED', 'PARTIAL', 'RECEIVED', 'CANCELLED'];

/* ── purchase orders ──────────────────────────────────────────────────────────────────────── */

const poShape = (r) => ({
  po_id: r.po_id, po_number: r.po_number, po_date: r.po_date, status: r.status, supplier_id: r.supplier_id, supplier: r.supplier_name, branch_id: r.branch_id, warehouse: r.warehouse_name,
  subtotal: rupees(r.subtotal_paise), tax: rupees(r.tax_paise), total: rupees(r.total_paise), paid: rupees(r.amount_paid_paise), balance: rupees(r.balance_due_paise), debited: rupees(r.debited_paise),
  payment_status: r.payment_status, expected_date: r.expected_date, payment_terms_days: r.payment_terms_days, supplier_invoice_no: r.supplier_invoice_no, supplier_invoice_date: r.supplier_invoice_date,
  due_date: r.due_date, approved_at: r.approved_at, approved_by: r.approved_by_name ?? null, notes: r.notes, created_at: r.created_at, received_at: r.received_at
});

const PO_FROM = `FROM purchase_orders po LEFT JOIN suppliers s ON s.supplier_id = po.supplier_id LEFT JOIN branches b ON b.branch_id = po.branch_id LEFT JOIN users au ON au.user_id = po.approved_by`;
const PO_COLS = `po.*, s.name AS supplier_name, b.name AS warehouse_name, au.name AS approved_by_name`;

const loadPO = async (req, id, { db = pool, lock = false } = {}) => {
  if (!Number.isInteger(Number(id))) throw new WholesaleError(404, 'Not found');
  const values = [req.tenant.businessId, id]; let scope = '';
  if (req.tenant.pinned) { values.push(req.tenant.branchId); scope = ' AND po.branch_id = $3'; }
  const row = (await db.query(`SELECT ${PO_COLS} ${PO_FROM} WHERE po.business_id = $1 AND po.po_id = $2${scope} ${lock ? 'FOR UPDATE OF po' : ''}`, values)).rows[0];
  if (!row) throw new WholesaleError(404, 'Not found');
  return row;
};

const poItems = async (db, poId) => (await db.query(
  `SELECT i.*, p.sku, p.unit AS base_unit FROM purchase_order_items i LEFT JOIN products p ON p.product_id = i.product_id WHERE i.po_id = $1 ORDER BY i.item_id`, [poId])).rows;

const itemShape = (i) => {
  const ordered = Number(i.quantity); const got = i.received_quantity == null ? 0 : Number(i.received_quantity);
  return {
    item_id: i.item_id, product_id: i.product_id, description: i.description, sku: i.sku, unit_name: i.unit_name || i.base_unit, unit_factor: Number(i.unit_factor), base_unit: i.base_unit,
    ordered, received: got, outstanding: Math.max(0, q3(ordered - got)), unit_cost: rupees(i.unit_cost_paise), tax_rate: Number(i.tax_rate), tax: rupees(i.tax_amount_paise), line_total: rupees(i.line_total_paise)
  };
};

/* GET /purchase-orders?status=&supplier_id=&branch_id=&from=&to=&q=&unpaid=1 */
const listPOs = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const values = [req.tenant.businessId]; const where = ['po.business_id = $1'];
  if (req.query.status) {
    const wanted = String(req.query.status).split(',').map((x) => x.trim().toUpperCase());
    if (wanted.some((x) => !PO_STATUSES.includes(x))) throw new WholesaleError(400, 'Unknown status');
    values.push(wanted); where.push(`po.status = ANY($${values.length}::text[])`);
  }
  if (req.query.supplier_id) { values.push(Number(req.query.supplier_id) || 0); where.push(`po.supplier_id = $${values.length}`); }
  if (req.query.branch_id) { values.push(Number(req.query.branch_id) || 0); where.push(`po.branch_id = $${values.length}`); }
  else if (req.tenant.pinned) { values.push(req.tenant.branchId); where.push(`po.branch_id = $${values.length}`); }
  if (req.query.unpaid === '1') where.push(`po.balance_due_paise > 0 AND po.status IN ('PARTIAL','RECEIVED')`);
  const from = isoDate(req.query.from, 'From'); const to = isoDate(req.query.to, 'To');
  if (from) { values.push(from); where.push(`po.po_date >= $${values.length}`); }
  if (to) { values.push(to); where.push(`po.po_date <= $${values.length}`); }
  if (req.query.q) { values.push(like(String(req.query.q).slice(0, 80))); where.push(`(po.po_number ILIKE $${values.length} OR s.name ILIKE $${values.length} OR po.supplier_invoice_no ILIKE $${values.length})`); }
  const base = `${PO_FROM} WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(`SELECT ${PO_COLS} ${base} ORDER BY po.po_date DESC, po.po_id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  page(res, rows.map(poShape), total, pg);
};

const getPO = async (req, res) => {
  const po = await loadPO(req, req.params.id);
  const items = await poItems(pool, po.po_id);
  const grns = (await pool.query(`SELECT grn_id, grn_number, grn_date, supplier_invoice_no, total_cost_paise, status FROM wholesale_grns WHERE po_id = $1 ORDER BY grn_id`, [po.po_id])).rows;
  const payments = (await pool.query(`SELECT payment_id, payment_method, amount_paise, reference_number, payment_date, created_at FROM payments WHERE po_id = $1 ORDER BY payment_id`, [po.po_id])).rows;
  const notes = (await pool.query(`SELECT dn_id, dn_number, dn_date, kind, total_paise FROM debit_notes WHERE po_id = $1 ORDER BY dn_id`, [po.po_id])).rows;
  ok(res, {
    ...poShape(po), items: items.map(itemShape),
    grns: grns.map((g) => ({ ...g, total_cost: rupees(g.total_cost_paise) })),
    payments: payments.map((p) => ({ payment_id: p.payment_id, method: p.payment_method, amount: rupees(p.amount_paise), reference: p.reference_number, date: p.payment_date })),
    debit_notes: notes.map((n) => ({ dn_id: n.dn_id, dn_number: n.dn_number, date: n.dn_date, kind: n.kind, total: rupees(n.total_paise) }))
  });
};

const prepare = async (client, req, { supplierId, items, branchId }) => {
  if (!Array.isArray(items) || !items.length) throw new WholesaleError(400, 'Add at least one product');
  if (items.length > 300) throw new WholesaleError(400, 'An order can have up to 300 lines');
  const biz = (await client.query(`SELECT gst_enabled, state FROM businesses WHERE business_id = $1`, [req.tenant.businessId])).rows[0];
  const supplier = (await client.query(`SELECT s.supplier_id, s.name, w.state, w.payment_terms_days FROM suppliers s LEFT JOIN wholesale_supplier_profiles w ON w.supplier_id = s.supplier_id WHERE s.business_id = $1 AND s.supplier_id = $2`, [req.tenant.businessId, supplierId])).rows[0];
  if (!supplier) throw new WholesaleError(400, 'Choose a supplier from your list');
  const ids = items.map((i) => int(i.product_id, 'Product', { min: 1, required: true }));
  const products = await lockProducts(client, req.tenant.businessId, ids);
  const units = await loadUnits(client, req.tenant.businessId, ids);
  const listed = await listPrices(client, req.tenant.businessId, supplier.supplier_id, ids);
  const seen = new Set();
  const lines = items.map((raw, k) => {
    const p = products.get(ids[k]);
    if (!p) throw new WholesaleError(400, `Product ${ids[k]} was not found`);
    if (p.status !== 'ACTIVE') throw new WholesaleError(400, `${p.name} is archived`);
    const u = unitFor(units, p.product_id, raw.unit_name, p.name);
    const key = `${p.product_id}/${u.name}`;
    if (seen.has(key)) throw new WholesaleError(400, `${p.name} (${u.name}) is listed twice`); seen.add(key);
    const quantity = num(raw.quantity, `${p.name} quantity`, { min: 0.001, max: 100000000, required: true });
    const perBase = listed.get(p.product_id)?.price_paise ?? Number(p.purchase_price_paise);
    const unitCost = raw.unit_cost != null && raw.unit_cost !== '' ? Math.round(Number(raw.unit_cost) * 100) : Math.round(perBase * u.factor);
    if (!Number.isFinite(unitCost) || unitCost < 0) throw new WholesaleError(400, `${p.name}: the cost is not valid`);
    const taxRate = raw.tax_rate != null && raw.tax_rate !== '' ? num(raw.tax_rate, 'GST rate', { min: 0, max: 100 }) : Number(p.tax_rate);
    const tax = computeLineTax({ quantity, unitPricePaise: unitCost, taxRatePercent: taxRate, gstEnabled: biz.gst_enabled, interState: isInterState(biz.state, supplier.state) });
    return { product: p, unit: u, quantity, unitCost, taxRate, tax };
  });
  return { lines, supplier, biz };
};

const writePOLines = async (client, poId, lines) => {
  await client.query(`DELETE FROM purchase_order_items WHERE po_id = $1`, [poId]);
  for (const l of lines) {
    await client.query(
      `INSERT INTO purchase_order_items (po_id, product_id, description, quantity, unit_cost_paise, tax_rate, tax_amount_paise, line_total_paise, unit_name, unit_factor)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [poId, l.product.product_id, l.product.name, l.quantity, l.unitCost, l.taxRate, l.tax.tax_paise, l.tax.line_total_paise, l.unit.name, l.unit.factor]);
  }
};

const warehouseFor = async (req, requested) => {
  const id = requested ? Number(requested) : req.tenant.branchId;
  if (req.tenant.pinned && id !== req.tenant.branchId) throw new WholesaleError(403, 'You can only buy into your own warehouse');
  if (!(await pool.query(`SELECT 1 FROM branches WHERE branch_id = $1 AND business_id = $2 AND status = 'ACTIVE'`, [id, req.tenant.businessId])).rowCount) throw new WholesaleError(400, 'That warehouse was not found');
  return id;
};

/* POST /purchase-orders { supplier_id, branch_id?, items: [{ product_id, unit_name?, quantity, unit_cost?, tax_rate? }], expected_date?, payment_terms_days?, notes? } */
const createPO = async (req, res) => {
  const b = req.body || {};
  const supplierId = int(b.supplier_id, 'Supplier', { min: 1, required: true });
  const branchId = await warehouseFor(req, b.branch_id);
  const id = await withTransaction(async (client) => {
    const { lines, supplier } = await prepare(client, req, { supplierId, items: b.items, branchId });
    const totals = sumLines(lines.map((l) => l.tax));
    const settings = await getSettings(client, req.tenant.businessId);
    const terms = 'payment_terms_days' in b ? int(b.payment_terms_days, 'Payment terms', { min: 0, max: 365 }) : (supplier.payment_terms_days ?? settings.default_payment_terms_days);
    const po = (await client.query(
      `INSERT INTO purchase_orders (business_id, branch_id, supplier_id, po_number, po_date, subtotal_paise, tax_paise, total_paise, balance_due_paise, payment_status, status, source, expected_date, notes, created_by, payment_terms_days)
       VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6,$7,$7,'UNPAID','DRAFT','MANUAL',$8,$9,$10,$11) RETURNING po_id`,
      [req.tenant.businessId, branchId, supplierId, await nextPoNumber(client, req.tenant.businessId), totals.subtotal_paise, totals.tax_paise, totals.total_paise, isoDate(b.expected_date, 'Expected date'), text(b.notes, 'Notes', { max: 1000 }), req.auth.userId, terms])).rows[0];
    await writePOLines(client, po.po_id, lines);
    return po.po_id;
  });
  audit(req, 'wholesale.purchase_order_created', 'purchase_order', id, null, { supplier_id: supplierId });
  ok(res, await (async () => { const po = await loadPO(req, id); return { ...poShape(po), items: (await poItems(pool, id)).map(itemShape) }; })(), 201);
};

/* PUT /purchase-orders/:id — a draft only (an ordered PO is a promise to the supplier; cancel and re-raise it) */
const updatePO = async (req, res) => {
  const b = req.body || {};
  await withTransaction(async (client) => {
    const po = await loadPO(req, req.params.id, { db: client, lock: true });
    if (po.status !== 'DRAFT') throw new WholesaleError(409, 'Only a draft order can be edited');
    const f = {};
    if ('expected_date' in b) f.expected_date = isoDate(b.expected_date, 'Expected date');
    if ('notes' in b) f.notes = text(b.notes, 'Notes', { max: 1000 });
    if ('payment_terms_days' in b) f.payment_terms_days = int(b.payment_terms_days, 'Payment terms', { min: 0, max: 365 });
    if ('supplier_id' in b) f.supplier_id = int(b.supplier_id, 'Supplier', { min: 1, required: true });
    if (Array.isArray(b.items)) {
      const { lines } = await prepare(client, req, { supplierId: f.supplier_id ?? po.supplier_id, items: b.items, branchId: po.branch_id });
      const totals = sumLines(lines.map((l) => l.tax));
      await writePOLines(client, po.po_id, lines);
      Object.assign(f, { subtotal_paise: totals.subtotal_paise, tax_paise: totals.tax_paise, total_paise: totals.total_paise, balance_due_paise: totals.total_paise });
    }
    const keys = Object.keys(f); if (!keys.length) throw new WholesaleError(400, 'Nothing to update');
    await client.query(`UPDATE purchase_orders SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE po_id = $1`, [po.po_id, ...keys.map((k) => f[k])]);
  });
  audit(req, 'wholesale.purchase_order_updated', 'purchase_order', Number(req.params.id));
  const po = await loadPO(req, req.params.id);
  ok(res, { ...poShape(po), items: (await poItems(pool, po.po_id)).map(itemShape) });
};

/* POST /purchase-orders/:id/approve — a purchase manager signs the order off; it becomes ORDERED */
const approvePO = async (req, res) => {
  await withTransaction(async (client) => {
    const po = await loadPO(req, req.params.id, { db: client, lock: true });
    if (po.status !== 'DRAFT') throw new WholesaleError(409, po.status === 'CANCELLED' ? 'This order was cancelled' : 'This order has already been approved');
    if (!po.supplier_id) throw new WholesaleError(400, 'Choose a supplier first');
    await client.query(`UPDATE purchase_orders SET status = 'ORDERED', approved_by = $2, approved_at = CURRENT_TIMESTAMP, ordered_at = COALESCE(ordered_at, CURRENT_TIMESTAMP) WHERE po_id = $1`, [po.po_id, req.auth.userId]);
  });
  audit(req, 'wholesale.purchase_order_approved', 'purchase_order', Number(req.params.id));
  ok(res, poShape(await loadPO(req, req.params.id)));
};

/* POST /purchase-orders/:id/send { email?: boolean } — the message for the supplier, in their units */
const sendPO = async (req, res) => {
  const po = await loadPO(req, req.params.id);
  if (!['ORDERED', 'CONFIRMED', 'PARTIAL'].includes(po.status)) throw new WholesaleError(409, 'Approve the order before sending it');
  const supplier = (await pool.query(`SELECT name, phone, email FROM suppliers WHERE supplier_id = $1`, [po.supplier_id])).rows[0];
  const items = await poItems(pool, po.po_id);
  const biz = (await pool.query(`SELECT name FROM businesses WHERE business_id = $1`, [req.tenant.businessId])).rows[0];
  const message = [`Order ${po.po_number} from ${biz.name}${po.warehouse_name ? ` (${po.warehouse_name})` : ''}`, '',
    ...items.map((i) => `• ${Number(i.quantity)} ${i.unit_name || i.base_unit || ''} ${i.description}`.replace(/\s+/g, ' ')), '',
    po.expected_date ? `Please deliver by ${String(po.expected_date).slice(0, 10)}.` : null, po.notes ? `Note: ${po.notes}` : null, 'Thank you!'].filter((l) => l !== null).join('\n');
  let emailed = false;
  if (req.body?.email !== false && supplier?.email) { await sendMail({ to: supplier.email, subject: `Purchase order ${po.po_number}`, text: message }); emailed = true; }
  const digits = String(supplier?.phone ?? '').replace(/\D/g, '');
  audit(req, 'wholesale.purchase_order_sent', 'purchase_order', po.po_id, null, { emailed });
  ok(res, { po_number: po.po_number, message, emailed, whatsapp_url: digits.length >= 10 ? `https://wa.me/91${digits.slice(-10)}?text=${encodeURIComponent(message)}` : null });
};

const cancelPO = async (req, res) => {
  const reason = text(req.body?.reason, 'Reason', { max: 200 });
  await withTransaction(async (client) => {
    const po = await loadPO(req, req.params.id, { db: client, lock: true });
    if (!['DRAFT', 'ORDERED', 'CONFIRMED'].includes(po.status)) throw new WholesaleError(409, po.status === 'CANCELLED' ? 'This order is already cancelled' : 'Goods have arrived on this order. Return them, or close it as short.');
    await client.query(`UPDATE purchase_orders SET status = 'CANCELLED', notes = COALESCE(notes || E'\\n', '') || $2 WHERE po_id = $1`, [po.po_id, reason ? `Cancelled: ${reason}` : 'Cancelled']);
  });
  audit(req, 'wholesale.purchase_order_cancelled', 'purchase_order', Number(req.params.id), null, { reason });
  ok(res, poShape(await loadPO(req, req.params.id)));
};

const closeShort = async (req, res) => {
  await withTransaction(async (client) => {
    const po = await loadPO(req, req.params.id, { db: client, lock: true });
    if (po.status !== 'PARTIAL') throw new WholesaleError(409, 'Only a part-delivered order can be closed short');
    await client.query(`UPDATE purchase_orders SET status = 'RECEIVED' WHERE po_id = $1`, [po.po_id]);
  });
  audit(req, 'wholesale.purchase_order_closed_short', 'purchase_order', Number(req.params.id));
  ok(res, poShape(await loadPO(req, req.params.id)));
};

/* ── goods receipt ────────────────────────────────────────────────────────────────────────── */

const grnShape = (g) => ({
  grn_id: g.grn_id, grn_number: g.grn_number, grn_date: g.grn_date, status: g.status, po_id: g.po_id, po_number: g.po_number, supplier_id: g.supplier_id, supplier: g.supplier_name, branch_id: g.branch_id, warehouse: g.warehouse_name,
  supplier_invoice_no: g.supplier_invoice_no, supplier_invoice_date: g.supplier_invoice_date, total_cost: rupees(g.total_cost_paise), notes: g.notes, created_at: g.created_at
});
const GRN_FROM = `FROM wholesale_grns g LEFT JOIN purchase_orders po ON po.po_id = g.po_id LEFT JOIN suppliers s ON s.supplier_id = g.supplier_id JOIN branches b ON b.branch_id = g.branch_id`;
const GRN_COLS = `g.*, po.po_number, s.name AS supplier_name, b.name AS warehouse_name`;

const listGRNs = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const values = [req.tenant.businessId]; const where = ['g.business_id = $1'];
  if (req.query.po_id) { values.push(Number(req.query.po_id) || 0); where.push(`g.po_id = $${values.length}`); }
  if (req.query.supplier_id) { values.push(Number(req.query.supplier_id) || 0); where.push(`g.supplier_id = $${values.length}`); }
  if (req.tenant.pinned) { values.push(req.tenant.branchId); where.push(`g.branch_id = $${values.length}`); }
  const from = isoDate(req.query.from, 'From'); const to = isoDate(req.query.to, 'To');
  if (from) { values.push(from); where.push(`g.grn_date >= $${values.length}`); }
  if (to) { values.push(to); where.push(`g.grn_date <= $${values.length}`); }
  if (req.query.q) { values.push(like(String(req.query.q).slice(0, 80))); where.push(`(g.grn_number ILIKE $${values.length} OR s.name ILIKE $${values.length} OR g.supplier_invoice_no ILIKE $${values.length})`); }
  const base = `${GRN_FROM} WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(`SELECT ${GRN_COLS} ${base} ORDER BY g.grn_id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  page(res, rows.map(grnShape), total, pg);
};

const grnDetail = async (req, id) => {
  const values = [req.tenant.businessId, id]; let scope = '';
  if (req.tenant.pinned) { values.push(req.tenant.branchId); scope = ' AND g.branch_id = $3'; }
  const g = Number.isInteger(Number(id)) ? (await pool.query(`SELECT ${GRN_COLS} ${GRN_FROM} WHERE g.business_id = $1 AND g.grn_id = $2${scope}`, values)).rows[0] : null;
  if (!g) throw new WholesaleError(404, 'Not found');
  const items = (await pool.query(
    `SELECT i.*, p.name AS product, p.sku, p.unit AS base_unit, l.code AS location FROM wholesale_grn_items i JOIN products p ON p.product_id = i.product_id LEFT JOIN wholesale_locations l ON l.location_id = i.location_id WHERE i.grn_id = $1 ORDER BY i.grn_item_id`, [g.grn_id])).rows;
  return {
    ...grnShape(g),
    items: items.map((i) => ({
      grn_item_id: i.grn_item_id, product_id: i.product_id, product: i.product, sku: i.sku, unit_name: i.unit_name, unit_factor: Number(i.unit_factor), base_unit: i.base_unit,
      ordered: i.ordered_base == null ? null : q3(Number(i.ordered_base) / Number(i.unit_factor)), received: q3(Number(i.received_base) / Number(i.unit_factor)), damaged: q3(Number(i.damaged_base) / Number(i.unit_factor)), accepted: q3(Number(i.accepted_base) / Number(i.unit_factor)),
      received_base: Number(i.received_base), damaged_base: Number(i.damaged_base), accepted_base: Number(i.accepted_base),
      unit_cost: rupees(Math.round(Number(i.cost_paise_per_base) * Number(i.unit_factor))), batch_no: i.batch_no, mfg_date: i.mfg_date, expiry_date: i.expiry_date, location: i.location, serials: i.serials ? i.serials.split('\n') : [], notes: i.notes
    }))
  };
};

const getGRN = async (req, res) => ok(res, await grnDetail(req, req.params.id));

/*
 * POST /grns
 * { po_id?, supplier_id?, branch_id?, grn_date?, supplier_invoice_no?, supplier_invoice_date?, notes?, close_po?: true, allow_excess?: true,
 *   payment?: { amount, method, reference_number },
 *   items: [{ po_item_id?, product_id, unit_name?, received, damaged?, accepted?, unit_cost?, batch_no?, mfg_date?, expiry_date?, location_id?, serials?: [..], notes? }] }
 */
const createGRN = async (req, res) => {
  const b = req.body || {};
  const list = Array.isArray(b.items) ? b.items : [];
  if (!list.length || list.length > 300) throw new WholesaleError(400, 'Add between 1 and 300 lines');
  const settings = await getSettings(pool, req.tenant.businessId);
  const out = await withTransaction(async (client) => {
    let po = b.po_id ? await loadPO(req, int(b.po_id, 'Order', { min: 1 }), { db: client, lock: true }) : null;
    if (po && !['ORDERED', 'CONFIRMED', 'PARTIAL', 'DRAFT'].includes(po.status)) throw new WholesaleError(409, po.status === 'RECEIVED' ? 'This order has already been received in full' : 'This order was cancelled');
    if (po && po.status === 'DRAFT' && !hasPermission(req.tenant, 'purchase_approve')) throw new WholesaleError(409, 'This order has not been approved yet');
    const supplierId = po ? po.supplier_id : int(b.supplier_id, 'Supplier', { min: 1, required: true });
    const branchId = po ? po.branch_id : await warehouseFor(req, b.branch_id);
    if (req.tenant.pinned && branchId !== req.tenant.branchId) throw new WholesaleError(403, 'Receive into your own warehouse');
    const supplier = (await client.query(`SELECT s.supplier_id, s.name, w.state, w.payment_terms_days FROM suppliers s LEFT JOIN wholesale_supplier_profiles w ON w.supplier_id = s.supplier_id WHERE s.business_id = $1 AND s.supplier_id = $2`, [req.tenant.businessId, supplierId])).rows[0];
    if (!supplier) throw new WholesaleError(400, 'Choose a supplier from your list');
    const invoiceNo = text(b.supplier_invoice_no, 'Supplier invoice number', { max: 40 });
    if (invoiceNo) {
      const dup = (await client.query(`SELECT po_number FROM purchase_orders WHERE business_id = $1 AND supplier_id = $2 AND lower(supplier_invoice_no) = lower($3) AND ($4::int IS NULL OR po_id <> $4) LIMIT 1`, [req.tenant.businessId, supplierId, invoiceNo, po?.po_id ?? null])).rows[0];
      if (dup) throw new WholesaleError(409, `Invoice ${invoiceNo} from ${supplier.name} was already booked on ${dup.po_number}`);
    }
    const poLines = po ? (await client.query(`SELECT * FROM purchase_order_items WHERE po_id = $1 ORDER BY item_id FOR UPDATE`, [po.po_id])).rows : [];
    const biz = (await client.query(`SELECT gst_enabled, state FROM businesses WHERE business_id = $1`, [req.tenant.businessId])).rows[0];
    const ids = list.map((x) => int(x.product_id ?? poLines.find((l) => l.item_id === Number(x.po_item_id))?.product_id, 'Product', { min: 1, required: true }));
    const products = await lockProducts(client, req.tenant.businessId, ids);
    const units = await loadUnits(client, req.tenant.businessId, ids);
    const tracked = await batchTracked(client, req.tenant.businessId, ids);
    const date = isoDate(b.grn_date, 'Receipt date') || await today(client, req.tenant.businessId);

    const grnNumber = await nextNumber(client, req.tenant.businessId, 'GRN', 'GRN');
    const grn = (await client.query(
      `INSERT INTO wholesale_grns (business_id, branch_id, po_id, supplier_id, grn_number, grn_date, supplier_invoice_no, supplier_invoice_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.tenant.businessId, branchId, po?.po_id ?? null, supplierId, grnNumber, date, invoiceNo, isoDate(b.supplier_invoice_date, 'Supplier invoice date'), text(b.notes, 'Notes', { max: 300 }), req.auth.userId])).rows[0];

    // a direct purchase gets its own (already received) purchase order so payables and GST work the same way
    const direct = !po;
    const lineRows = []; let costTotal = 0;
    const seenPO = new Set();
    for (const [k, x] of list.entries()) {
      const p = products.get(ids[k]);
      if (!p) throw new WholesaleError(400, `Product ${ids[k]} was not found`);
      const poLine = x.po_item_id ? poLines.find((l) => l.item_id === Number(x.po_item_id)) : null;
      if (x.po_item_id && !poLine) throw new WholesaleError(400, `${p.name} is not on that order`);
      if (poLine && seenPO.has(poLine.item_id)) throw new WholesaleError(400, `${p.name} is listed twice`);
      if (poLine) seenPO.add(poLine.item_id);
      const u = poLine ? { name: poLine.unit_name || p.unit, factor: Number(poLine.unit_factor) } : unitFor(units, p.product_id, x.unit_name, p.name);
      const received = num(x.received, `${p.name} received`, { min: 0, max: 100000000, required: true });
      const damaged = num(x.damaged ?? 0, `${p.name} damaged`, { min: 0, max: received });
      const accepted = x.accepted != null && x.accepted !== '' ? num(x.accepted, `${p.name} accepted`, { min: 0, max: received - damaged }) : q3(received - damaged);
      if (received <= 0) continue;
      if (poLine && !bool(b.allow_excess)) {
        const outstanding = Number(poLine.quantity) - Number(poLine.received_quantity ?? 0);
        if (accepted > outstanding + 1e-9) throw new WholesaleError(409, `${p.name}: only ${q3(outstanding)} ${u.name} is still due on this order. Tick "accept extra" to take more.`);
      }
      const unitCost = x.unit_cost != null && x.unit_cost !== '' ? Math.round(Number(x.unit_cost) * 100) : (poLine ? Number(poLine.unit_cost_paise) : Math.round(Number(p.purchase_price_paise) * u.factor));
      if (!Number.isFinite(unitCost) || unitCost < 0) throw new WholesaleError(400, `${p.name}: the cost is not valid`);
      const taxRate = x.tax_rate != null && x.tax_rate !== '' ? num(x.tax_rate, 'GST rate', { min: 0, max: 100 }) : (poLine ? Number(poLine.tax_rate) : Number(p.tax_rate));
      const baseAccepted = toBase(accepted, u.factor); const baseDamaged = toBase(damaged, u.factor); const baseReceived = toBase(received, u.factor);
      const costPerBase = unitCost / u.factor;
      const tr = tracked.get(p.product_id) || {};
      const batchNo = text(x.batch_no, 'Batch number', { max: 40 }); const expiry = isoDate(x.expiry_date, 'Expiry date'); const mfg = isoDate(x.mfg_date, 'Manufacturing date');
      if (accepted > 0 && (tr.batch_tracking || tr.expiry_tracking) && !batchNo) throw new WholesaleError(400, `${p.name} is batch-tracked: enter the batch number`);
      if (accepted > 0 && tr.expiry_tracking && !expiry) throw new WholesaleError(400, `${p.name} expires: enter the expiry date`);
      if (expiry && mfg && expiry < mfg) throw new WholesaleError(400, `${p.name}: the expiry date is before the manufacturing date`);
      if (expiry && accepted > 0 && expiry < date) throw new WholesaleError(400, `${p.name}: this batch is already expired`);
      let serials = null;
      if (accepted > 0 && tr.serial_tracking) {
        const sn = [...new Set((x.serials || []).map((s) => String(s).trim()).filter(Boolean))];
        if (!Number.isInteger(baseAccepted) || sn.length !== baseAccepted) throw new WholesaleError(400, `${p.name}: enter ${baseAccepted} serial number${baseAccepted === 1 ? '' : 's'}`);
        serials = sn;
      }
      const locationId = int(x.location_id, 'Location', { min: 1 });
      if (locationId && !(await client.query(`SELECT 1 FROM wholesale_locations WHERE location_id = $1 AND branch_id = $2 AND business_id = $3`, [locationId, branchId, req.tenant.businessId])).rowCount) throw new WholesaleError(400, 'That location is not in this warehouse');
      lineRows.push({ x, p, poLine, u, received, damaged, accepted, unitCost, taxRate, baseAccepted, baseDamaged, baseReceived, costPerBase, batchNo, expiry, mfg, serials, locationId });
    }
    if (!lineRows.length) throw new WholesaleError(400, 'Nothing was received');
    if (!lineRows.some((l) => l.accepted > 0 || l.damaged > 0)) throw new WholesaleError(400, 'Nothing was received');

    const supplierState = supplier.state;
    if (direct) {
      po = (await client.query(
        `INSERT INTO purchase_orders (business_id, branch_id, supplier_id, po_number, po_date, subtotal_paise, tax_paise, total_paise, balance_due_paise, payment_status, status, source, notes, created_by, received_at, approved_by, approved_at)
         VALUES ($1,$2,$3,$4,$5,0,0,0,0,'UNPAID','RECEIVED','MANUAL',$6,$7,CURRENT_TIMESTAMP,$7,CURRENT_TIMESTAMP) RETURNING *`,
        [req.tenant.businessId, branchId, supplierId, await nextPoNumber(client, req.tenant.businessId), date, `Direct purchase (${grnNumber})`, req.auth.userId])).rows[0];
      for (const l of lineRows) {
        const row = (await client.query(
          `INSERT INTO purchase_order_items (po_id, product_id, description, quantity, unit_cost_paise, tax_rate, tax_amount_paise, line_total_paise, unit_name, unit_factor, received_quantity)
           VALUES ($1,$2,$3,$4,$5,$6,0,0,$7,$8,0) RETURNING item_id`, [po.po_id, l.p.product_id, l.p.name, l.accepted, l.unitCost, l.taxRate, l.u.name, l.u.factor])).rows[0];
        l.poLine = { item_id: row.item_id, quantity: l.accepted, received_quantity: 0, line_total_paise: 0, tax_amount_paise: 0 };
      }
    }

    // stock in, batches, serials, damaged goods, the order's received quantities
    for (const l of [...lineRows].sort((a, c) => a.p.product_id - c.p.product_id)) {
      const tax = computeLineTax({ quantity: l.accepted, unitPricePaise: l.unitCost, taxRatePercent: l.taxRate, gstEnabled: biz.gst_enabled, interState: isInterState(biz.state, supplierState) });
      costTotal += tax.line_total_paise;
      if (l.accepted > 0) {
        await stockIn(client, { businessId: req.tenant.businessId, branchId, productId: l.p.product_id, qty: l.baseAccepted, type: 'PURCHASE', refType: 'grn', refId: grn.grn_id, notes: `${grnNumber}${invoiceNo ? ` · ${invoiceNo}` : ''}`, userId: req.auth.userId });
        const tr = tracked.get(l.p.product_id) || {};
        if (tr.batch_tracking || tr.expiry_tracking) await addToBatch(client, { businessId: req.tenant.businessId, branchId, productId: l.p.product_id, batchNo: l.batchNo, mfgDate: l.mfg, expiryDate: l.expiry, qty: l.baseAccepted, costPaise: Math.round(l.costPerBase), source: 'GRN', refId: grn.grn_id, refType: 'grn' });
        for (const sn of l.serials || []) {
          try { await client.query(`INSERT INTO wholesale_serials (business_id, product_id, branch_id, serial_no, ref_type, ref_id) VALUES ($1,$2,$3,$4,'grn',$5)`, [req.tenant.businessId, l.p.product_id, branchId, sn, grn.grn_id]); }
          catch (error) { if (error.code === '23505') throw new WholesaleError(409, `Serial ${sn} already exists`); throw error; }
        }
        await client.query(`UPDATE products SET purchase_price_paise = $2, updated_at = CURRENT_TIMESTAMP WHERE product_id = $1`, [l.p.product_id, Math.round(l.costPerBase)]);
        if (l.locationId) await client.query(`INSERT INTO wholesale_bin_assignments (branch_id, product_id, location_id) VALUES ($1,$2,$3) ON CONFLICT (branch_id, product_id) DO NOTHING`, [branchId, l.p.product_id, l.locationId]);
      }
      if (l.baseDamaged > 0) await logDamaged(client, { businessId: req.tenant.businessId, branchId, productId: l.p.product_id, qty: l.baseDamaged, source: 'GRN', refType: 'grn', refId: grn.grn_id, note: `Damaged on receipt ${grnNumber}`, userId: req.auth.userId });
      await client.query(
        `INSERT INTO wholesale_grn_items (grn_id, po_item_id, product_id, unit_name, unit_factor, ordered_base, received_base, damaged_base, accepted_base, cost_paise_per_base, tax_rate, batch_no, mfg_date, expiry_date, location_id, serials, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [grn.grn_id, l.poLine?.item_id ?? null, l.p.product_id, l.u.name, l.u.factor, l.poLine ? toBase(l.poLine.quantity, l.u.factor) : null, l.baseReceived, l.baseDamaged, l.baseAccepted, l.costPerBase, l.taxRate, l.batchNo, l.mfg, l.expiry, l.locationId, l.serials ? l.serials.join('\n') : null, text(l.x.notes, 'Notes', { max: 200 })]);
      if (l.poLine) {
        const prevValue = l.poLine.received_quantity == null ? 0 : Number(l.poLine.line_total_paise);
        const prevTax = l.poLine.received_quantity == null ? 0 : Number(l.poLine.tax_amount_paise);
        await client.query(`UPDATE purchase_order_items SET received_quantity = COALESCE(received_quantity, 0) + $2, unit_cost_paise = $3, tax_rate = $4, tax_amount_paise = $5, line_total_paise = $6 WHERE item_id = $1`,
          [l.poLine.item_id, l.accepted, l.unitCost, l.taxRate, prevTax + tax.tax_paise, prevValue + tax.line_total_paise]);
      }
    }

    // the order's money and status
    const items = (await client.query(`SELECT quantity, received_quantity FROM purchase_order_items WHERE po_id = $1`, [po.po_id])).rows;
    const stillOwed = items.some((i) => Number(i.received_quantity ?? 0) < Number(i.quantity) - 1e-9);
    const totals = (await client.query(
      `SELECT COALESCE(SUM(line_total_paise - tax_amount_paise), 0) AS sub, COALESCE(SUM(tax_amount_paise), 0) AS tax, COALESCE(SUM(line_total_paise), 0) AS total FROM purchase_order_items WHERE po_id = $1 AND received_quantity IS NOT NULL`, [po.po_id])).rows[0];
    const total = Number(totals.total);
    let paid = 0;
    if (b.payment?.amount != null && b.payment.amount !== '') { paid = Math.round(Number(b.payment.amount) * 100); if (!(paid > 0)) throw new WholesaleError(400, 'Payment amount must be above zero'); }
    const amountPaid = Number(po.amount_paid_paise) + paid;
    const balance = Math.max(0, total - Number(po.debited_paise) - amountPaid);
    const invoiceDate = isoDate(b.supplier_invoice_date, 'Supplier invoice date') || date;
    const terms = po.payment_terms_days ?? supplier.payment_terms_days ?? settings.default_payment_terms_days;
    const closed = !stillOwed || bool(b.close_po);
    await client.query(
      `UPDATE purchase_orders SET status = $2, received_at = CURRENT_TIMESTAMP, subtotal_paise = $3, tax_paise = $4, total_paise = $5, amount_paid_paise = $6, balance_due_paise = $7, payment_status = $8,
              supplier_invoice_no = COALESCE($9, supplier_invoice_no), supplier_invoice_date = COALESCE($10::date, supplier_invoice_date), payment_terms_days = COALESCE(payment_terms_days, $11),
              due_date = COALESCE($10::date, supplier_invoice_date, $12::date) + COALESCE(payment_terms_days, $11)::int, po_date = CASE WHEN status IN ('DRAFT','ORDERED','CONFIRMED') THEN $12::date ELSE po_date END
       WHERE po_id = $1`,
      [po.po_id, closed ? 'RECEIVED' : 'PARTIAL', Number(totals.sub), Number(totals.tax), total, amountPaid, balance, paymentStatus(total - Number(po.debited_paise), amountPaid), invoiceNo, b.supplier_invoice_date ? invoiceDate : null, terms, date]);
    if (paid > 0) {
      const method = oneOf(b.payment.method, 'Payment method', ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'], { fallback: 'CASH' });
      await client.query(`INSERT INTO payments (business_id, branch_id, po_id, supplier_id, payment_method, amount_paise, reference_number, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [req.tenant.businessId, branchId, po.po_id, supplierId, method, paid, text(b.payment.reference_number, 'Reference', { max: 80 }), req.auth.userId]);
    }
    await client.query(`UPDATE wholesale_grns SET po_id = $2, total_cost_paise = $3 WHERE grn_id = $1`, [grn.grn_id, po.po_id, costTotal]);
    // customers waiting on these goods get them now, oldest order first
    const reservedFor = await allocateArrivals(client, { businessId: req.tenant.businessId, branchId, productIds: lineRows.filter((l) => l.accepted > 0).map((l) => l.p.product_id) });
    return { grn_id: grn.grn_id, po_id: po.po_id, grnNumber, reservedFor, partial: !closed };
  });
  audit(req, 'wholesale.grn_posted', 'grn', out.grn_id, null, { number: out.grnNumber, po_id: out.po_id, back_orders_filled: out.reservedFor.length });
  const detail = await grnDetail(req, out.grn_id);
  ok(res, { ...detail, order_status: out.partial ? 'PARTIAL' : 'RECEIVED', back_orders_filled: out.reservedFor }, 201);
};

/* GET /purchase-orders/pending — what is due to arrive: open orders and their outstanding lines */
const dueIn = async (req, res) => {
  const values = [req.tenant.businessId]; let scope = '';
  if (req.tenant.pinned) { values.push(req.tenant.branchId); scope = ' AND po.branch_id = $2'; }
  const rows = (await pool.query(
    `SELECT po.po_id, po.po_number, po.status, po.expected_date, s.name AS supplier, b.name AS warehouse, COUNT(*) AS lines,
            SUM(i.quantity - COALESCE(i.received_quantity, 0)) AS units
     FROM purchase_orders po JOIN purchase_order_items i ON i.po_id = po.po_id LEFT JOIN suppliers s ON s.supplier_id = po.supplier_id LEFT JOIN branches b ON b.branch_id = po.branch_id
     WHERE po.business_id = $1 AND po.status IN ('ORDERED','CONFIRMED','PARTIAL') AND i.quantity > COALESCE(i.received_quantity, 0)${scope}
     GROUP BY po.po_id, s.name, b.name ORDER BY po.expected_date NULLS LAST, po.po_id`, values)).rows;
  ok(res, rows.map((r) => ({ ...r, lines: Number(r.lines), units: Number(r.units) })));
};

export default wrapAll({ listPOs, getPO, createPO, updatePO, approvePO, sendPO, cancelPO, closeShort, dueIn, listGRNs, getGRN, createGRN });
