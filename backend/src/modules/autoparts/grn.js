/*
 * Receiving parts. The posting itself is the wholesale GRN (controllers/wholesalePurchasing.controller.js: purchase order or direct purchase, tax, payables, damaged log,
 * supplier invoice duplicate check), called as it is. This module adds what a parts shop needs around it:
 *   received = accepted + damaged + rejected     only ACCEPTED enters sellable stock; damaged goes to the damaged log; rejected is recorded and goes back
 *   bins: a line may name the bin it goes to (put away on the spot); otherwise a put-away task is opened and the stock is "unassigned" until someone shelves it
 *   cancel: reverses a direct purchase receipt, only while all its stock is still there and nothing has been paid
 */
import { PartsError, num } from './common.js';
import { getLocation } from './locations.js';
import { putAway } from './bins.js';
import { stockOut, logDamaged } from '../wholesale/stock.js';

const q3 = (n) => Math.round(Number(n) * 1000) / 1000;

/** Check the lines and turn `rejected` into the accepted quantity the wholesale GRN expects. Returns the body to post and the chosen bins by line. */
export const prepare = async (db, tenant, body) => {
  const items = Array.isArray(body.items) ? body.items : [];
  const bins = [];
  const lines = [];
  for (const x of items) {
    const received = num(x.received, 'Received', { min: 0, max: 100000000, required: true });
    if (received <= 0) continue;
    const damaged = num(x.damaged ?? 0, 'Damaged', { min: 0, max: received });
    const rejected = num(x.rejected ?? 0, 'Rejected', { min: 0, max: received });
    if (damaged + rejected > received + 1e-9) throw new PartsError(400, 'Damaged and rejected together cannot be more than what arrived');
    let binId = null;
    if (x.bin_id) {
      const l = await getLocation(db, tenant, x.bin_id);
      if (!l.is_active || !l.can_store) throw new PartsError(409, `${l.code} cannot hold stock`);
      binId = l.location_id;
    }
    bins.push({ binId, rejected });
    const { bin_id: _b, rejected: _r, location_id: _l, ...rest } = x;
    lines.push({ ...rest, received, damaged, accepted: q3(received - damaged - rejected) });
  }
  return { body: { ...body, items: lines }, bins };
};

/** After the receipt is posted: record rejected quantities, put away the lines that named a bin, open put-away tasks for the rest. */
export const settle = async (db, tenant, userId, grnId, bins) => {
  const g = (await db.query(`SELECT branch_id FROM wholesale_grns WHERE grn_id = $1 AND business_id = $2`, [grnId, tenant.businessId])).rows[0];
  const rows = (await db.query(`SELECT grn_item_id, product_id, accepted_base FROM wholesale_grn_items WHERE grn_id = $1 ORDER BY grn_item_id`, [grnId])).rows;
  const tasks = []; const warnings = [];
  for (const [i, r] of rows.entries()) {
    const pick = bins[i] || {};
    await db.query(`UPDATE wholesale_grn_items SET rejected_base = $2, bin_location_id = $3 WHERE grn_item_id = $1`, [r.grn_item_id, q3(pick.rejected || 0), pick.binId ?? null]);
    const qty = Number(r.accepted_base);
    if (!(qty > 0)) continue;
    if (pick.binId) {
      const out = await putAway(db, tenant, userId, { product_id: r.product_id, location_id: pick.binId, qty, source_key: `grn:${grnId}:${r.grn_item_id}`, ref_type: 'grn', ref_id: grnId });
      if (out.warnings?.length) warnings.push(...out.warnings);
    } else {
      const t = (await db.query(
        `INSERT INTO putaway_tasks (business_id, branch_id, product_id, qty, source, source_id) VALUES ($1,$2,$3,$4,'GRN',$5) RETURNING task_id`, [tenant.businessId, g.branch_id, r.product_id, qty, grnId])).rows[0];
      tasks.push(t.task_id);
    }
  }
  return { tasks, warnings };
};

export const enrich = async (db, grnId) => {
  const rows = (await db.query(
    `SELECT i.grn_item_id, i.rejected_base, i.bin_location_id, l.code AS bin_code FROM wholesale_grn_items i LEFT JOIN warehouse_locations l ON l.location_id = i.bin_location_id WHERE i.grn_id = $1`, [grnId])).rows;
  return new Map(rows.map((r) => [r.grn_item_id, { rejected: Number(r.rejected_base), bin_id: r.bin_location_id, bin_code: r.bin_code }]));
};

/** Reverse a direct-purchase receipt. */
export const cancel = async (db, tenant, userId, grnId, reason) => {
  const g = (await db.query(`SELECT * FROM wholesale_grns WHERE grn_id = $1 AND business_id = $2 FOR UPDATE`, [Number(grnId), tenant.businessId])).rows[0];
  if (!g || (tenant.scopeBranchId != null && g.branch_id !== tenant.scopeBranchId)) throw new PartsError(404, 'Not found');
  if (g.status === 'CANCELLED') throw new PartsError(409, 'This receipt is already cancelled');
  const po = g.po_id ? (await db.query(`SELECT * FROM purchase_orders WHERE po_id = $1 FOR UPDATE`, [g.po_id])).rows[0] : null;
  const direct = po && /^Direct purchase/.test(po.notes || '');
  if (!direct) throw new PartsError(409, 'A receipt against a purchase order is reversed with a supplier return (debit note), so the order and its money stay right');
  const siblings = Number((await db.query(`SELECT COUNT(*) AS n FROM wholesale_grns WHERE po_id = $1 AND status = 'POSTED'`, [po.po_id])).rows[0].n);
  if (Number(po.amount_paid_paise) > 0 || Number(po.debited_paise) > 0 || siblings > 1) throw new PartsError(409, 'Money has been paid or a debit note raised on this purchase. Reverse those first');
  const items = (await db.query(`SELECT * FROM wholesale_grn_items WHERE grn_id = $1 ORDER BY product_id FOR UPDATE`, [g.grn_id])).rows;
  for (const i of items) {
    const accepted = Number(i.accepted_base);
    if (accepted > 0) {
      const have = Number((await db.query(`SELECT quantity FROM branch_stock WHERE branch_id = $1 AND product_id = $2 FOR UPDATE`, [g.branch_id, i.product_id])).rows[0]?.quantity ?? 0);
      if (have < accepted - 1e-9) throw new PartsError(409, `Part ${i.product_id}: ${accepted} came in but only ${have} is left, so this receipt cannot be reversed. Some was sold or moved`);
      await stockOut(db, { businessId: tenant.businessId, branchId: g.branch_id, productId: i.product_id, qty: accepted, type: 'ADJUSTMENT', refType: 'grn_cancel', refId: g.grn_id, notes: `Cancelled ${g.grn_number}`, userId });
    }
    if (Number(i.damaged_base) > 0) await logDamaged(db, { businessId: tenant.businessId, branchId: g.branch_id, productId: i.product_id, qty: -Number(i.damaged_base), source: 'GRN', refType: 'grn_cancel', refId: g.grn_id, note: `Cancelled ${g.grn_number}`, userId });
  }
  await db.query(`UPDATE putaway_tasks SET status = 'CANCELLED' WHERE source = 'GRN' AND source_id = $1 AND status = 'OPEN'`, [g.grn_id]);
  await db.query(`UPDATE wholesale_grns SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3 WHERE grn_id = $1`, [g.grn_id, userId, reason]);
  await db.query(`UPDATE purchase_orders SET status = 'CANCELLED', balance_due_paise = 0 WHERE po_id = $1`, [po.po_id]);
  return { grn_id: g.grn_id, status: 'CANCELLED' };
};
