/*
 * Pharmacy goods receipt (GRN) — direct procurement only.
 *
 * Supplier -> GRN -> Inventory -> Payable, with no Purchase Order step anywhere a person can see: there is no
 * list/approve/send/cancel-PO route mounted for pharmacy (see routes/pharmacy.routes.js) and never will be. A
 * GRN still creates a `purchase_orders` row — the same hidden, already-RECEIVED bookkeeping row the wholesale
 * module's own "direct" GRN already creates — purely so payables, GST and the supplier ledger reuse FlowXP's one
 * tested pipeline instead of a second one. That row is written here and nowhere else is it read back for pharmacy.
 *
 * Batch/expiry/serial capture, FEFO-safe posting and damaged-goods handling all reuse the wholesale stock engine
 * (modules/pharmacy/stock.js, itself a thin pass-through to modules/wholesale/stock.js) — see migrations/
 * 0061_pharmacy_foundation.js for why that's safe to share rather than fork.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { computeLineTax, isInterState } from '../modules/tax.js';
import { nextPoNumber, paymentStatus } from './purchases.controller.js';
import { addToBatch, batchTracked, lockProducts, logDamaged, stockIn } from '../modules/pharmacy/stock.js';
import {
  PharmacyError, audit, getSettings, int, isoDate, money, nextNumber, num, ok, oneOf, page, paging, q3, text, today, withTransaction, wrapAll
} from '../modules/pharmacy/common.js';

const rupees = (v) => toRupees(Number(v || 0));

/* POST /api/pharmacy/grn
   { supplier_id, grn_date?, supplier_invoice_no?, supplier_invoice_date?, notes?,
     items: [{ product_id, received, damaged?, unit_cost, tax_rate?, batch_no?, mfg_date?, expiry_date?, serials?, notes? }],
     payment?: { method, amount, reference_number } }
   Goes to whichever outlet the request is already scoped to (req.tenant.branchId — always a concrete outlet;
   the route's requireOutlet refuses the request outright while a group user is viewing "All outlets", the same
   guard every other write route in the app uses, so there's nothing left for this controller to re-check). */
const createGRN = async (req, res) => {
  const b = req.body || {};
  const list = Array.isArray(b.items) ? b.items : [];
  if (!list.length || list.length > 300) throw new PharmacyError(400, 'Add between 1 and 300 lines');
  const settings = await getSettings(pool, req.tenant.businessId);
  const out = await withTransaction(async (client) => {
    const supplierId = int(b.supplier_id, 'Supplier', { min: 1, required: true });
    const branchId = req.tenant.branchId;
    const supplier = (await client.query(`SELECT s.supplier_id, s.name, w.state FROM suppliers s LEFT JOIN wholesale_supplier_profiles w ON w.supplier_id = s.supplier_id WHERE s.business_id = $1 AND s.supplier_id = $2`, [req.tenant.businessId, supplierId])).rows[0];
    if (!supplier) throw new PharmacyError(400, 'Choose a supplier from your list');
    const invoiceNo = text(b.supplier_invoice_no, 'Supplier invoice number', { max: 40 });
    if (invoiceNo) {
      const dup = (await client.query(`SELECT po_number FROM purchase_orders WHERE business_id = $1 AND supplier_id = $2 AND lower(supplier_invoice_no) = lower($3) LIMIT 1`, [req.tenant.businessId, supplierId, invoiceNo])).rows[0];
      if (dup) throw new PharmacyError(409, `Invoice ${invoiceNo} from ${supplier.name} was already booked`);
    }
    const biz = (await client.query(`SELECT gst_enabled, state FROM businesses WHERE business_id = $1`, [req.tenant.businessId])).rows[0];
    const date = isoDate(b.grn_date, 'Receipt date') || await today(client, req.tenant.businessId);

    const ids = list.map((x) => int(x.product_id, 'Product', { min: 1, required: true }));
    const products = await lockProducts(client, req.tenant.businessId, ids);
    const tracked = await batchTracked(client, req.tenant.businessId, ids);

    const grnNumber = await nextNumber(client, req.tenant.businessId, 'GRN', settings.grn_prefix);
    const grn = (await client.query(
      `INSERT INTO wholesale_grns (business_id, branch_id, supplier_id, grn_number, grn_date, supplier_invoice_no, supplier_invoice_date, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.tenant.businessId, branchId, supplierId, grnNumber, date, invoiceNo, isoDate(b.supplier_invoice_date, 'Supplier invoice date'), text(b.notes, 'Notes', { max: 300 }), req.auth.userId])).rows[0];

    const lineRows = []; let costTotal = 0;
    for (const [k, x] of list.entries()) {
      const p = products.get(ids[k]);
      if (!p) throw new PharmacyError(400, `Product ${ids[k]} was not found`);
      const received = num(x.received, `${p.name} received`, { min: 0, max: 100000000, required: true });
      const damaged = num(x.damaged ?? 0, `${p.name} damaged`, { min: 0, max: received });
      const accepted = q3(received - damaged);
      if (received <= 0) continue;
      const unitCost = money(x.unit_cost, `${p.name} cost`, { required: true });
      const taxRate = x.tax_rate != null && x.tax_rate !== '' ? num(x.tax_rate, 'GST rate', { min: 0, max: 100 }) : Number(p.tax_rate);
      const tr = tracked.get(p.product_id) || {};
      const batchNo = text(x.batch_no, 'Batch number', { max: 40 }); const expiry = isoDate(x.expiry_date, 'Expiry date'); const mfg = isoDate(x.mfg_date, 'Manufacturing date');
      if (accepted > 0 && (tr.batch_tracking || tr.expiry_tracking) && !batchNo) throw new PharmacyError(400, `${p.name} is batch-tracked: enter the batch number`);
      if (accepted > 0 && tr.expiry_tracking && !expiry) throw new PharmacyError(400, `${p.name} expires: enter the expiry date`);
      if (expiry && mfg && expiry < mfg) throw new PharmacyError(400, `${p.name}: the expiry date is before the manufacturing date`);
      if (expiry && accepted > 0 && expiry < date) throw new PharmacyError(400, `${p.name}: this batch is already expired`);
      let serials = null;
      if (accepted > 0 && tr.serial_tracking) {
        const sn = [...new Set((x.serials || []).map((s) => String(s).trim()).filter(Boolean))];
        if (!Number.isInteger(accepted) || sn.length !== accepted) throw new PharmacyError(400, `${p.name}: enter ${accepted} serial number${accepted === 1 ? '' : 's'}`);
        serials = sn;
      }
      lineRows.push({ x, p, received, damaged, accepted, unitCost, taxRate, batchNo, expiry, mfg, serials });
    }
    if (!lineRows.length || !lineRows.some((l) => l.accepted > 0 || l.damaged > 0)) throw new PharmacyError(400, 'Nothing was received');

    // a direct GRN gets its own (already received) purchase order so payables and GST work the same tested way —
    // never surfaced: no pharmacy route lists, reads or approves a purchase_orders row (see routes/pharmacy.routes.js)
    const po = (await client.query(
      `INSERT INTO purchase_orders (business_id, branch_id, supplier_id, po_number, po_date, subtotal_paise, tax_paise, total_paise, balance_due_paise, payment_status, status, created_by)
       VALUES ($1,$2,$3,$4,$5,0,0,0,0,'UNPAID','RECEIVED',$6) RETURNING *`,
      [req.tenant.businessId, branchId, supplierId, await nextPoNumber(client, req.tenant.businessId), date, req.auth.userId])).rows[0];

    for (const l of [...lineRows].sort((a, c) => a.p.product_id - c.p.product_id)) {
      const tax = computeLineTax({ quantity: l.accepted, unitPricePaise: l.unitCost, taxRatePercent: l.taxRate, gstEnabled: biz.gst_enabled, interState: isInterState(biz.state, supplier.state) });
      costTotal += tax.line_total_paise;
      await client.query(
        `INSERT INTO purchase_order_items (po_id, product_id, description, quantity, unit_cost_paise, tax_rate, tax_amount_paise, line_total_paise, received_quantity)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$4)`, [po.po_id, l.p.product_id, l.p.name, l.accepted, l.unitCost, l.taxRate, tax.tax_paise, tax.line_total_paise]);
      if (l.accepted > 0) {
        await stockIn(client, { businessId: req.tenant.businessId, branchId, productId: l.p.product_id, qty: l.accepted, type: 'PURCHASE', refType: 'grn', refId: grn.grn_id, notes: `${grnNumber}${l.x.notes ? ` · ${l.x.notes}` : ''}`, userId: req.auth.userId });
        const tr = tracked.get(l.p.product_id) || {};
        if (tr.batch_tracking || tr.expiry_tracking) await addToBatch(client, { businessId: req.tenant.businessId, branchId, productId: l.p.product_id, batchNo: l.batchNo, mfgDate: l.mfg, expiryDate: l.expiry, qty: l.accepted, costPaise: l.unitCost, source: 'GRN', refId: grn.grn_id, refType: 'grn' });
        for (const sn of l.serials || []) {
          try { await client.query(`INSERT INTO wholesale_serials (business_id, product_id, branch_id, serial_no, ref_type, ref_id) VALUES ($1,$2,$3,$4,'grn',$5)`, [req.tenant.businessId, l.p.product_id, branchId, sn, grn.grn_id]); }
          catch (error) { if (error.code === '23505') throw new PharmacyError(409, `Serial ${sn} already exists`); throw error; }
        }
        await client.query(`UPDATE products SET purchase_price_paise = $2, updated_at = CURRENT_TIMESTAMP WHERE product_id = $1`, [l.p.product_id, l.unitCost]);
      }
      if (l.damaged > 0) await logDamaged(client, { businessId: req.tenant.businessId, branchId, productId: l.p.product_id, qty: l.damaged, source: 'GRN', refType: 'grn', refId: grn.grn_id, note: `Damaged on receipt ${grnNumber}`, userId: req.auth.userId });
      await client.query(
        `INSERT INTO wholesale_grn_items (grn_id, product_id, unit_name, unit_factor, received_base, damaged_base, accepted_base, cost_paise_per_base, tax_rate, batch_no, mfg_date, expiry_date, serials, notes)
         VALUES ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [grn.grn_id, l.p.product_id, l.p.unit, l.received, l.damaged, l.accepted, l.unitCost, l.taxRate, l.batchNo, l.mfg, l.expiry, l.serials ? l.serials.join('\n') : null, text(l.x.notes, 'Notes', { max: 200 })]);
    }

    const totals = (await client.query(`SELECT COALESCE(SUM(line_total_paise - tax_amount_paise), 0) AS sub, COALESCE(SUM(tax_amount_paise), 0) AS tax, COALESCE(SUM(line_total_paise), 0) AS total FROM purchase_order_items WHERE po_id = $1`, [po.po_id])).rows[0];
    const total = Number(totals.total);
    let paid = 0;
    if (b.payment?.amount != null && b.payment.amount !== '') { paid = Math.round(Number(b.payment.amount) * 100); if (!(paid > 0)) throw new PharmacyError(400, 'Payment amount must be above zero'); }
    const balance = Math.max(0, total - paid);
    await client.query(
      `UPDATE purchase_orders SET subtotal_paise = $2, tax_paise = $3, total_paise = $4, amount_paid_paise = $5, balance_due_paise = $6, payment_status = $7, received_at = CURRENT_TIMESTAMP WHERE po_id = $1`,
      [po.po_id, Number(totals.sub), Number(totals.tax), total, paid, balance, paymentStatus(total, paid)]);
    if (paid > 0) {
      const method = oneOf(b.payment.method, 'Payment method', ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'], { fallback: 'CASH' });
      await client.query(`INSERT INTO payments (business_id, branch_id, po_id, supplier_id, payment_method, amount_paise, reference_number, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [req.tenant.businessId, branchId, po.po_id, supplierId, method, paid, text(b.payment.reference_number, 'Reference', { max: 80 }), req.auth.userId]);
    }
    await client.query(`UPDATE wholesale_grns SET po_id = $2, total_cost_paise = $3 WHERE grn_id = $1`, [grn.grn_id, po.po_id, costTotal]);
    return { grn_id: grn.grn_id, grnNumber, po_id: po.po_id };
  });
  audit(req, 'pharmacy.grn_posted', 'grn', out.grn_id, null, { number: out.grnNumber });
  ok(res, await grnDetail(req, out.grn_id), 201);
};

/* GET /api/pharmacy/grn — list (never the hidden purchase_orders row this writes) */
const listGRNs = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const values = [req.tenant.businessId]; const where = [`g.business_id = $1`];
  if (req.tenant.pinned) { values.push(req.tenant.branchId); where.push(`g.branch_id = $${values.length}`); }
  if (req.query.supplier_id) { values.push(Number(req.query.supplier_id)); where.push(`g.supplier_id = $${values.length}`); }
  const base = `FROM wholesale_grns g LEFT JOIN suppliers s ON s.supplier_id = g.supplier_id LEFT JOIN branches b ON b.branch_id = g.branch_id WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(`SELECT g.grn_id, g.grn_number, g.grn_date, g.supplier_invoice_no, g.status, g.total_cost_paise, s.name AS supplier, b.name AS branch ${base} ORDER BY g.grn_id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  page(res, rows.map((r) => ({ grn_id: r.grn_id, grn_number: r.grn_number, grn_date: r.grn_date, supplier_invoice_no: r.supplier_invoice_no, status: r.status, total: rupees(r.total_cost_paise), supplier: r.supplier, branch: r.branch })), total, pg);
};

const grnDetail = async (req, id) => {
  const grn = (await pool.query(`SELECT g.*, s.name AS supplier, b.name AS branch FROM wholesale_grns g LEFT JOIN suppliers s ON s.supplier_id = g.supplier_id LEFT JOIN branches b ON b.branch_id = g.branch_id WHERE g.grn_id = $1 AND g.business_id = $2`, [id, req.tenant.businessId])).rows[0];
  if (!grn) throw new PharmacyError(404, 'Not found');
  const items = (await pool.query(`SELECT i.*, p.name AS product_name FROM wholesale_grn_items i LEFT JOIN products p ON p.product_id = i.product_id WHERE i.grn_id = $1 ORDER BY i.grn_item_id`, [id])).rows;
  return {
    grn_id: grn.grn_id, grn_number: grn.grn_number, grn_date: grn.grn_date, status: grn.status, supplier: grn.supplier, branch: grn.branch,
    supplier_invoice_no: grn.supplier_invoice_no, supplier_invoice_date: grn.supplier_invoice_date, notes: grn.notes, total: rupees(grn.total_cost_paise),
    items: items.map((i) => ({
      product_id: i.product_id, product: i.product_name, unit_name: i.unit_name, received: Number(i.received_base), damaged: Number(i.damaged_base), accepted: Number(i.accepted_base),
      cost: rupees(i.cost_paise_per_base), tax_rate: Number(i.tax_rate), batch_no: i.batch_no, mfg_date: i.mfg_date, expiry_date: i.expiry_date, serials: i.serials ? i.serials.split('\n') : null
    }))
  };
};

const getGRN = async (req, res) => ok(res, await grnDetail(req, req.params.id));

export default wrapAll({ createGRN, listGRNs, getGRN });
