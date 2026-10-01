/*
 * Returns, both ways.
 *
 *   Sales return      the customer sends goods back → a CREDIT NOTE on the invoice (the shared credit-note engine:
 *                     tax reversed exactly, balance reduced, optional refund) and, line by line, what happens to the
 *                     goods: back on the shelf (into the batch they came from), held as damaged / expired, or not
 *                     physically returned.
 *   Purchase return   goods go back to the supplier → a DEBIT NOTE on the purchase order (reduces what we owe) and the
 *                     stock leaves the warehouse (and its batch).
 *
 * Each return is recorded in wholesale_returns with the reason, so returns can be reported by reason and product.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { issueCreditNote } from './creditNotes.controller.js';
import { issueDebitNote } from './debitNotes.controller.js';
import { allocateBatches, availability, batchTracked, consumeBatches, lockProducts, logDamaged, returnToBatch, stockIn } from '../modules/wholesale/stock.js';
import {
  WholesaleError, audit, int, isoDate, like, nextNumber, num, ok, oneOf, page, paging, q3, text, today, withTransaction, wrapAll
} from '../modules/wholesale/common.js';

const rupees = (v) => toRupees(Number(v || 0));
const REASONS = ['DAMAGED', 'WRONG_PRODUCT', 'EXCESS_QUANTITY', 'EXPIRED', 'CUSTOMER_REJECTION', 'QUALITY', 'OTHER'];
const DISPOSITIONS = ['RESTOCK', 'DAMAGED', 'EXPIRED', 'NONE'];

const shape = (r) => ({
  return_id: r.return_id, return_number: r.return_number, kind: r.kind, reason: r.reason, notes: r.notes, created_at: r.created_at, branch_id: r.branch_id, warehouse: r.warehouse_name,
  invoice_id: r.invoice_id, invoice_number: r.invoice_number, cn_id: r.cn_id, cn_number: r.cn_number, cn_total: r.cn_total == null ? null : rupees(r.cn_total),
  po_id: r.po_id, po_number: r.po_number, dn_id: r.dn_id, dn_number: r.dn_number, dn_total: r.dn_total == null ? null : rupees(r.dn_total),
  customer_id: r.customer_id, customer: r.customer_name, supplier_id: r.supplier_id, supplier: r.supplier_name
});

const FROM = `
  FROM wholesale_returns r JOIN branches b ON b.branch_id = r.branch_id LEFT JOIN invoices i ON i.invoice_id = r.invoice_id LEFT JOIN credit_notes cn ON cn.cn_id = r.cn_id
  LEFT JOIN purchase_orders po ON po.po_id = r.po_id LEFT JOIN debit_notes dn ON dn.dn_id = r.dn_id LEFT JOIN customers c ON c.customer_id = r.customer_id LEFT JOIN suppliers s ON s.supplier_id = r.supplier_id`;
const COLS = `r.*, b.name AS warehouse_name, i.invoice_number, cn.cn_number, cn.total_paise AS cn_total, po.po_number, dn.dn_number, dn.total_paise AS dn_total, c.name AS customer_name, s.name AS supplier_name`;

/* GET /returns?kind=SALE|PURCHASE&reason=&customer_id=&supplier_id=&from=&to=&q= */
const list = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const values = [req.tenant.businessId]; const where = ['r.business_id = $1'];
  if (req.query.kind) { values.push(oneOf(req.query.kind, 'Kind', ['SALE', 'PURCHASE'])); where.push(`r.kind = $${values.length}`); }
  if (req.query.reason) { values.push(oneOf(req.query.reason, 'Reason', REASONS)); where.push(`r.reason = $${values.length}`); }
  if (req.query.customer_id) { values.push(Number(req.query.customer_id) || 0); where.push(`r.customer_id = $${values.length}`); }
  if (req.query.supplier_id) { values.push(Number(req.query.supplier_id) || 0); where.push(`r.supplier_id = $${values.length}`); }
  if (req.tenant.pinned) { values.push(req.tenant.branchId); where.push(`r.branch_id = $${values.length}`); }
  const from = isoDate(req.query.from, 'From'); const to = isoDate(req.query.to, 'To');
  if (from) { values.push(from); where.push(`r.created_at >= $${values.length}::date`); }
  if (to) { values.push(to); where.push(`r.created_at < ($${values.length}::date + 1)`); }
  if (req.query.q) { values.push(like(String(req.query.q).slice(0, 80))); where.push(`(r.return_number ILIKE $${values.length} OR c.name ILIKE $${values.length} OR s.name ILIKE $${values.length} OR i.invoice_number ILIKE $${values.length})`); }
  const base = `${FROM} WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(`SELECT ${COLS} ${base} ORDER BY r.return_id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  page(res, rows.map(shape), total, pg);
};

const get = async (req, res) => {
  const row = Number.isInteger(Number(req.params.id)) ? (await pool.query(`SELECT ${COLS} ${FROM} WHERE r.business_id = $1 AND r.return_id = $2`, [req.tenant.businessId, req.params.id])).rows[0] : null;
  if (!row || (req.tenant.pinned && row.branch_id !== req.tenant.branchId)) throw new WholesaleError(404, 'Not found');
  const items = (await pool.query(
    `SELECT ri.*, p.name AS product, p.unit, b.batch_no FROM wholesale_return_items ri JOIN products p ON p.product_id = ri.product_id LEFT JOIN wholesale_batches b ON b.batch_id = ri.batch_id WHERE ri.return_id = $1 ORDER BY ri.return_item_id`, [row.return_id])).rows;
  ok(res, { ...shape(row), items: items.map((i) => ({ product_id: i.product_id, product: i.product, quantity: Number(i.quantity), unit_name: i.unit_name, base_qty: Number(i.base_qty), base_unit: i.unit, disposition: i.disposition, batch_no: i.batch_no })) });
};

/* GET /invoices/:id/returnable — what of an invoice can still be sent back */
const returnableLines = async (req, res) => {
  const inv = (await pool.query(`SELECT invoice_id, invoice_number, customer_id, branch_id, status, balance_due_paise FROM invoices WHERE business_id = $1 AND invoice_id = $2`, [req.tenant.businessId, req.params.id])).rows[0];
  if (!inv || (req.tenant.pinned && inv.branch_id !== req.tenant.branchId)) throw new WholesaleError(404, 'Not found');
  const rows = (await pool.query(
    `SELECT ii.item_id, ii.product_id, ii.description, ii.quantity, ii.unit_name, ii.unit_factor, ii.unit_price_paise, ii.tax_rate,
            COALESCE((SELECT SUM(c.quantity) FROM credit_note_items c WHERE c.invoice_item_id = ii.item_id), 0) AS credited, p.track_inventory
     FROM invoice_items ii LEFT JOIN products p ON p.product_id = ii.product_id WHERE ii.invoice_id = $1 AND ii.product_id IS NOT NULL ORDER BY ii.item_id`, [inv.invoice_id])).rows;
  const batches = (await pool.query(
    `SELECT m.batch_id, b.batch_no, b.product_id, b.expiry_date, -SUM(m.qty) AS qty FROM wholesale_batch_moves m JOIN wholesale_batches b ON b.batch_id = m.batch_id
     WHERE m.ref_type = 'invoice' AND m.ref_id = $1 GROUP BY m.batch_id, b.batch_no, b.product_id, b.expiry_date`, [inv.invoice_id])).rows;
  ok(res, {
    invoice_id: inv.invoice_id, invoice_number: inv.invoice_number, status: inv.status, balance_due: rupees(inv.balance_due_paise),
    items: rows.map((r) => ({
      item_id: r.item_id, product_id: r.product_id, description: r.description, unit_name: r.unit_name, quantity: Number(r.quantity), credited: Number(r.credited), returnable: q3(Number(r.quantity) - Number(r.credited)),
      unit_price: rupees(r.unit_price_paise), tax_rate: Number(r.tax_rate), tracks_stock: Boolean(r.track_inventory),
      batches: batches.filter((b) => b.product_id === r.product_id).map((b) => ({ batch_id: Number(b.batch_id), batch_no: b.batch_no, expiry_date: b.expiry_date, qty_base: Number(b.qty) }))
    }))
  });
};

/**
 * The whole of a sales return inside the caller's transaction: the credit note, the stock (restocked into its batch,
 * or logged as damaged), and the return record. Used by the Returns screen and by a part-delivered delivery, so a
 * refusal at the door and a return later are the same, atomic thing.
 */
export const processSalesReturn = async (client, req, { invoiceId, reason, notes, list, b = {} }) => {
  const inv = (await client.query(`SELECT invoice_id, invoice_number, customer_id, branch_id FROM invoices WHERE business_id = $1 AND invoice_id = $2`, [req.tenant.businessId, invoiceId])).rows[0];
  if (!inv || (req.tenant.pinned && inv.branch_id !== req.tenant.branchId)) throw new WholesaleError(404, 'Invoice not found');
  const lines = new Map((await client.query(`SELECT ii.item_id, ii.product_id, ii.unit_name, ii.unit_factor, ii.description, p.track_inventory FROM invoice_items ii LEFT JOIN products p ON p.product_id = ii.product_id WHERE ii.invoice_id = $1`, [invoiceId])).rows.map((r) => [r.item_id, r]));
  const prepared = list.map((x) => {
    const line = lines.get(Number(x.invoice_item_id));
    if (!line || !line.product_id) throw new WholesaleError(400, 'One of those items is not on this invoice');
    const quantity = num(x.quantity, `${line.description} quantity`, { min: 0.001, required: true });
    const disposition = oneOf(x.disposition, 'What happens to the goods', DISPOSITIONS, { fallback: reason === 'DAMAGED' ? 'DAMAGED' : reason === 'EXPIRED' ? 'EXPIRED' : 'RESTOCK' });
    return { line, quantity, disposition, base: q3(quantity * Number(line.unit_factor || 1)), batchId: x.batch_id ? Number(x.batch_id) : null };
  });
  await lockProducts(client, req.tenant.businessId, prepared.map((p) => p.line.product_id));
  // the credit note itself: tax, balance, refund (the shared engine; stock is handled below, line by line)
  const cn = await issueCreditNote(client, {
    tenant: req.tenant, auth: req.auth, params: { id: invoiceId },
    body: { items: prepared.map((p) => ({ item_id: p.line.item_id, quantity: p.quantity })), reason: `${reason.replace(/_/g, ' ').toLowerCase()}${notes ? `: ${notes}` : ''}`, restock: false, refund: b.refund?.method ? { method: b.refund.method } : undefined }
  });
  const tracked = await batchTracked(client, req.tenant.businessId, prepared.map((p) => p.line.product_id));
  const number = await nextNumber(client, req.tenant.businessId, 'RT', 'RT');
  const ret = (await client.query(
    `INSERT INTO wholesale_returns (business_id, branch_id, kind, return_number, invoice_id, cn_id, customer_id, reason, notes, created_by) VALUES ($1,$2,'SALE',$3,$4,$5,$6,$7,$8,$9) RETURNING return_id`,
    [req.tenant.businessId, cn.invoice.branch_id, number, invoiceId, cn.note.cn_id, inv.customer_id, reason, notes, req.auth.userId])).rows[0];
  for (const p of prepared) {
    const pid = p.line.product_id; let batchId = p.batchId;
    if (p.disposition === 'RESTOCK' && p.line.track_inventory) {
      const tr = tracked.get(pid);
      if (tr?.batch_tracking || tr?.expiry_tracking) {
        if (!batchId) {
          // the batch the goods came out of, when the invoice took them from exactly one
          const used = (await client.query(`SELECT m.batch_id FROM wholesale_batch_moves m JOIN wholesale_batches bt ON bt.batch_id = m.batch_id WHERE m.ref_type = 'invoice' AND m.ref_id = $1 AND bt.product_id = $2 GROUP BY m.batch_id`, [invoiceId, pid])).rows;
          if (used.length === 1) batchId = Number(used[0].batch_id);
          else throw new WholesaleError(400, `${p.line.description} is batch-tracked: say which batch the goods belong to`);
        }
        const owned = (await client.query(`SELECT 1 FROM wholesale_batches WHERE batch_id = $1 AND business_id = $2 AND branch_id = $3 AND product_id = $4`, [batchId, req.tenant.businessId, cn.invoice.branch_id, pid])).rowCount;
        if (!owned) throw new WholesaleError(400, 'That batch is not at the invoice’s warehouse');
        await returnToBatch(client, { businessId: req.tenant.businessId, batchId, qty: p.base, refType: 'credit_note', refId: cn.note.cn_id });
      }
      await stockIn(client, { businessId: req.tenant.businessId, branchId: cn.invoice.branch_id, productId: pid, qty: p.base, type: 'RETURN', refType: 'credit_note', refId: cn.note.cn_id, notes: cn.note.cn_number, userId: req.auth.userId });
    } else if (['DAMAGED', 'EXPIRED'].includes(p.disposition) && p.line.track_inventory) {
      await logDamaged(client, { businessId: req.tenant.businessId, branchId: cn.invoice.branch_id, productId: pid, qty: p.base, source: 'RETURN', refType: 'credit_note', refId: cn.note.cn_id, note: `${p.disposition === 'EXPIRED' ? 'Expired' : 'Damaged'} return ${number}`, userId: req.auth.userId });
    }
    await client.query(`INSERT INTO wholesale_return_items (return_id, product_id, invoice_item_id, quantity, unit_name, base_qty, batch_id, disposition, reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [ret.return_id, pid, p.line.item_id, p.quantity, p.line.unit_name, p.base, batchId, p.disposition, reason]);
  }
  return { return_id: ret.return_id, number, cn, inv };
};

/*
 * POST /returns/sales
 * { invoice_id, reason, notes?, items: [{ invoice_item_id, quantity, disposition?, batch_id? }], refund?: { method } }
 *   quantity is in the invoice line's own unit (cartons for a carton line).
 */
const salesReturn = async (req, res) => {
  const b = req.body || {};
  const invoiceId = int(b.invoice_id, 'Invoice', { min: 1, required: true });
  const reason = oneOf(b.reason, 'Reason', REASONS, { required: true });
  const notes = text(b.notes, 'Notes', { max: 300 });
  const list = Array.isArray(b.items) ? b.items : [];
  if (!list.length || list.length > 200) throw new WholesaleError(400, 'Choose what is being returned');
  const out = await withTransaction((client) => processSalesReturn(client, req, { invoiceId, reason, notes, list, b }));
  audit(req, 'wholesale.sales_return', 'return', out.return_id, null, { number: out.number, invoice: out.inv.invoice_number, credit_note: out.cn.note.cn_number, total: rupees(out.cn.total), refunded: rupees(out.cn.refund), reason });
  req.params = { id: out.return_id };
  const row = (await pool.query(`SELECT ${COLS} ${FROM} WHERE r.return_id = $1`, [out.return_id])).rows[0];
  ok(res, { ...shape(row), credit_note_total: rupees(out.cn.total), refunded: rupees(out.cn.refund), unrefunded: rupees(out.cn.leftover - out.cn.refund) }, 201);
};

/*
 * POST /returns/purchase
 * { po_id, reason, notes?, items: [{ po_item_id, quantity, batch_id? }] }       quantity in the purchase order's unit
 */
const purchaseReturn = async (req, res) => {
  const b = req.body || {};
  const poId = int(b.po_id, 'Order', { min: 1, required: true });
  const reason = oneOf(b.reason, 'Reason', REASONS, { required: true });
  const notes = text(b.notes, 'Notes', { max: 300 });
  const list = Array.isArray(b.items) ? b.items : [];
  if (!list.length || list.length > 200) throw new WholesaleError(400, 'Choose what is being sent back');
  const out = await withTransaction(async (client) => {
    const po = (await client.query(`SELECT po_id, po_number, branch_id, supplier_id FROM purchase_orders WHERE business_id = $1 AND po_id = $2`, [req.tenant.businessId, poId])).rows[0];
    if (!po || (req.tenant.pinned && po.branch_id !== req.tenant.branchId)) throw new WholesaleError(404, 'Order not found');
    const lines = new Map((await client.query(`SELECT i.item_id, i.product_id, i.description, i.unit_factor, i.unit_name FROM purchase_order_items i WHERE i.po_id = $1`, [poId])).rows.map((r) => [r.item_id, r]));
    const prepared = list.map((x) => {
      const line = lines.get(Number(x.po_item_id));
      if (!line || !line.product_id) throw new WholesaleError(400, 'One of those lines is not on this order');
      const quantity = num(x.quantity, `${line.description} quantity`, { min: 0.001, required: true });
      return { line, quantity, base: q3(quantity * Number(line.unit_factor)), batchId: x.batch_id ? Number(x.batch_id) : null };
    });
    await lockProducts(client, req.tenant.businessId, prepared.map((p) => p.line.product_id));
    const avail = await availability(client, po.branch_id, prepared.map((p) => p.line.product_id));
    const tracked = await batchTracked(client, req.tenant.businessId, prepared.map((p) => p.line.product_id));
    const onDate = await today(client, req.tenant.businessId);
    for (const p of prepared) {
      const a = avail.get(p.line.product_id);
      if (p.base > a.quantity - a.reserved + 1e-9 && !(tracked.get(p.line.product_id)?.expiry_tracking && p.base <= a.quantity - a.reserved + a.expired + 1e-9)) {
        throw new WholesaleError(409, `${p.line.description}: only ${q3(a.quantity - a.reserved)} is free to send back (the rest is reserved for customers)`);
      }
    }
    // the debit note: reduces what we owe and takes the stock out (the shared debit-note engine)
    const dn = await issueDebitNote(client, {
      tenant: req.tenant, auth: req.auth, params: { id: poId },
      body: { kind: 'RETURN', reason: `${reason.replace(/_/g, ' ').toLowerCase()}${notes ? `: ${notes}` : ''}`, items: prepared.map((p) => ({ item_id: p.line.item_id, quantity: p.quantity })) }
    });
    for (const p of prepared) {
      const tr = tracked.get(p.line.product_id);
      if (tr?.batch_tracking || tr?.expiry_tracking) {
        let allocations;
        if (p.batchId) {
          const row = (await client.query(`SELECT batch_id, qty_on_hand FROM wholesale_batches WHERE batch_id = $1 AND business_id = $2 AND branch_id = $3 AND product_id = $4 FOR UPDATE`, [p.batchId, req.tenant.businessId, po.branch_id, p.line.product_id])).rows[0];
          if (!row || Number(row.qty_on_hand) < p.base - 1e-9) throw new WholesaleError(409, 'That batch does not have enough to send back');
          allocations = [{ batch_id: Number(row.batch_id), qty: p.base }];
        } else {
          // oldest stock goes back first, expired batches included
          const rows = (await client.query(`SELECT batch_id, qty_on_hand FROM wholesale_batches WHERE branch_id = $1 AND product_id = $2 AND qty_on_hand > 0 ORDER BY expiry_date NULLS LAST, batch_id FOR UPDATE`, [po.branch_id, p.line.product_id])).rows;
          let left = p.base; allocations = [];
          for (const r of rows) { if (left <= 0) break; const t = Math.min(left, Number(r.qty_on_hand)); allocations.push({ batch_id: Number(r.batch_id), qty: q3(t) }); left = q3(left - t); }
          if (left > 1e-9) throw new WholesaleError(409, `${p.line.description}: not enough stock in batches. Name the batch.`);
        }
        await consumeBatches(client, { businessId: req.tenant.businessId, allocations, refType: 'debit_note', refId: dn.note.dn_id });
      }
    }
    const number = await nextNumber(client, req.tenant.businessId, 'RT', 'RT');
    const ret = (await client.query(
      `INSERT INTO wholesale_returns (business_id, branch_id, kind, return_number, po_id, dn_id, supplier_id, reason, notes, created_by) VALUES ($1,$2,'PURCHASE',$3,$4,$5,$6,$7,$8,$9) RETURNING return_id`,
      [req.tenant.businessId, po.branch_id, number, poId, dn.note.dn_id, po.supplier_id, reason, notes, req.auth.userId])).rows[0];
    for (const p of prepared) await client.query(`INSERT INTO wholesale_return_items (return_id, product_id, quantity, unit_name, base_qty, batch_id, disposition, reason) VALUES ($1,$2,$3,$4,$5,$6,'NONE',$7)`, [ret.return_id, p.line.product_id, p.quantity, p.line.unit_name, p.base, p.batchId, reason]);
    return { return_id: ret.return_id, number, dn, po };
  });
  audit(req, 'wholesale.purchase_return', 'return', out.return_id, null, { number: out.number, po: out.po.po_number, debit_note: out.dn.note.dn_number, total: rupees(out.dn.total), reason });
  const row = (await pool.query(`SELECT ${COLS} ${FROM} WHERE r.return_id = $1`, [out.return_id])).rows[0];
  ok(res, { ...shape(row), debit_note_total: rupees(out.dn.total), credit_with_supplier: rupees(out.dn.credit) }, 201);
};

export default wrapAll({ list, get, returnableLines, salesReturn, purchaseReturn });
