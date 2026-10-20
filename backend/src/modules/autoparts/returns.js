/*
 * Returns. A customer return is an ordinary credit note (controllers/creditNotes.controller.js: GST reversal, refund or credit on account, exchange), and a parts shop adds to it:
 *   a REASON (wrong part, defective, not required, transit damage, fitment, warranty, other) and a DISPOSITION for what to do with the part:
 *     RESTOCK   back on the shelf as sellable stock (optionally into a chosen bin; otherwise it waits to be put away)
 *     DAMAGED   not sellable: written to the damaged log
 *     SUPPLIER  not sellable and the supplier owes us for it: damaged log plus an open supplier claim
 *     SCRAP     thrown away; recorded only
 * Only RESTOCK adds to sellable stock. Supplier claims track what the supplier owes; the money moves through the existing purchase debit notes.
 */
import { PartsError, int, num, oneOf, text, withRupees } from './common.js';
import { getLocation } from './locations.js';
import { putAway } from './bins.js';
import { logDamaged } from '../wholesale/stock.js';

export const REASONS = ['WRONG_PART', 'DEFECTIVE', 'NOT_REQUIRED', 'TRANSIT_DAMAGE', 'FITMENT', 'WARRANTY', 'OTHER'];
export const DISPOSITIONS = ['RESTOCK', 'DAMAGED', 'SUPPLIER', 'SCRAP'];
const q3 = (n) => Math.round(Number(n) * 1000) / 1000;

/** Read the reason, disposition and bin from a credit note request (a parts shop must give both). */
export const parseReturn = async (db, tenant, body) => {
  const reason = oneOf(body.return_reason, 'Return reason', REASONS, { required: true });
  const disposition = oneOf(body.disposition ?? (body.restock ? 'RESTOCK' : undefined), 'What happens to the part', DISPOSITIONS, { required: true });
  let binId = null;
  if (body.bin_id) {
    if (disposition !== 'RESTOCK') throw new PartsError(400, 'A bin is only for parts going back on the shelf');
    const l = await getLocation(db, tenant, body.bin_id);
    if (!l.is_active || !l.can_store) throw new PartsError(409, `${l.code} cannot hold stock`);
    binId = l.location_id;
  }
  return { reason, disposition, binId, supplierId: body.supplier_id ? int(body.supplier_id, 'Supplier', { min: 1 }) : null };
};

/** After the credit note's lines are written (and RESTOCK lines are back in the ledger). */
export const recordReturns = async (client, { tenant, userId, note, invoice, picked, ret }) => {
  for (const p of picked) {
    if (!p.line.product_id) continue;
    const productId = p.line.product_id;
    const qty = q3(p.qty * Number(p.line.unit_factor || 1));
    let claimId = null;
    if (ret.disposition === 'DAMAGED' || ret.disposition === 'SUPPLIER') {
      await logDamaged(client, { businessId: tenant.businessId, branchId: invoice.branch_id, productId, qty, source: 'RETURN', refType: 'credit_note', refId: note.cn_id, note: `Returned: ${ret.reason}`, userId });
    }
    if (ret.disposition === 'SUPPLIER') {
      const sup = ret.supplierId ?? (await client.query(`SELECT preferred_supplier_id FROM autoparts_parts WHERE product_id = $1`, [productId])).rows[0]?.preferred_supplier_id ?? null;
      claimId = (await client.query(
        `INSERT INTO supplier_claims (business_id, branch_id, supplier_id, product_id, qty, source, source_id, reason, created_by) VALUES ($1,$2,$3,$4,$5,'RETURN',$6,$7,$8) RETURNING claim_id`,
        [tenant.businessId, invoice.branch_id, sup, productId, qty, note.cn_id, ret.reason === 'WARRANTY' ? 'WARRANTY' : ret.reason === 'WRONG_PART' ? 'WRONG_PART' : 'DAMAGED', userId])).rows[0].claim_id;
    }
    if (ret.disposition === 'RESTOCK' && !p.line.track_inventory) { /* nothing was counted in stock, so nothing comes back */ } else if (ret.disposition === 'RESTOCK' && ret.binId) {
      await putAway(client, tenant, userId, { product_id: productId, location_id: ret.binId, qty, source_key: `return:${note.cn_id}:${p.line.item_id}`, ref_type: 'credit_note', ref_id: note.cn_id });
    } else if (ret.disposition === 'RESTOCK') {
      await client.query(`INSERT INTO putaway_tasks (business_id, branch_id, product_id, qty, source, source_id) VALUES ($1,$2,$3,$4,'RETURN',$5)`, [tenant.businessId, invoice.branch_id, productId, qty, note.cn_id]);
    }
    await client.query(
      `INSERT INTO part_returns (business_id, branch_id, cn_id, invoice_id, product_id, qty, reason, disposition, location_id, claim_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [tenant.businessId, invoice.branch_id, note.cn_id, invoice.invoice_id, productId, qty, ret.reason, ret.disposition, ret.binId, claimId, userId]);
  }
};

/* -- supplier claims -------------------------------------------------------- */

export const createClaim = async (db, tenant, userId, b) => {
  const productId = int(b.product_id, 'Part', { min: 1, required: true });
  if (!(await db.query(`SELECT 1 FROM products WHERE product_id = $1 AND business_id = $2`, [productId, tenant.businessId])).rowCount) throw new PartsError(404, 'Not found');
  const branchId = tenant.scopeBranchId ?? tenant.branchId;
  let supplierId = null;
  if (b.supplier_id) {
    supplierId = int(b.supplier_id, 'Supplier', { min: 1 });
    if (!(await db.query(`SELECT 1 FROM suppliers WHERE supplier_id = $1 AND business_id = $2`, [supplierId, tenant.businessId])).rowCount) throw new PartsError(404, 'Not found');
  }
  const r = (await db.query(
    `INSERT INTO supplier_claims (business_id, branch_id, supplier_id, product_id, qty, source, source_id, reason, amount_paise, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [tenant.businessId, branchId, supplierId, productId, num(b.qty, 'Quantity', { min: 0.001, max: 1000000, required: true }), b.grn_id ? 'GRN' : 'MANUAL', b.grn_id ? int(b.grn_id, 'Receipt', { min: 1 }) : null,
      oneOf(b.reason, 'Reason', ['DAMAGED', 'REJECTED', 'WARRANTY', 'WRONG_PART', 'SHORT'], { fallback: 'DAMAGED' }), Math.round(Number(b.amount || 0) * 100), text(b.note, 'Note', { max: 300 }), userId])).rows[0];
  return withRupees({ ...r, qty: Number(r.qty) });
};

export const listClaims = async (db, tenant, { status = 'OPEN' } = {}) => {
  const params = [tenant.businessId, String(status).toUpperCase()];
  let where = 'c.business_id = $1 AND c.status = $2';
  if (tenant.scopeBranchId != null) { params.push(tenant.scopeBranchId); where += ` AND c.branch_id = $3`; }
  return (await db.query(
    `SELECT c.*, p.name AS part, p.sku, s.name AS supplier FROM supplier_claims c JOIN products p ON p.product_id = c.product_id LEFT JOIN suppliers s ON s.supplier_id = c.supplier_id
     WHERE ${where} ORDER BY c.claim_id DESC LIMIT 300`, params)).rows.map((r) => withRupees({ ...r, qty: Number(r.qty) }));
};

export const resolveClaim = async (db, tenant, id, b) => {
  const status = oneOf(b.status, 'Outcome', ['CREDITED', 'REPLACED', 'DECLINED', 'WRITTEN_OFF'], { required: true });
  const r = (await db.query(`SELECT * FROM supplier_claims WHERE claim_id = $1 AND business_id = $2 FOR UPDATE`, [Number(id), tenant.businessId])).rows[0];
  if (!r || (tenant.scopeBranchId != null && r.branch_id !== tenant.scopeBranchId)) throw new PartsError(404, 'Not found');
  if (r.status !== 'OPEN') throw new PartsError(409, 'That claim is already closed');
  const amount = b.amount === undefined ? Number(r.amount_paise) : Math.round(Number(b.amount) * 100);
  if (!Number.isFinite(amount) || amount < 0) throw new PartsError(400, 'The amount is not valid');
  await db.query(`UPDATE supplier_claims SET status = $2, amount_paise = $3, resolved_at = now(), resolution_note = $4 WHERE claim_id = $1`, [r.claim_id, status, amount, text(b.note, 'Note', { max: 300 })]);
  return { claim_id: r.claim_id, status };
};

export const returnsLog = async (db, tenant, { from = null, to = null } = {}) => {
  const params = [tenant.businessId];
  let where = 'r.business_id = $1';
  if (tenant.scopeBranchId != null) { params.push(tenant.scopeBranchId); where += ` AND r.branch_id = $${params.length}`; }
  if (from) { params.push(from); where += ` AND r.created_at >= $${params.length}::date`; }
  if (to) { params.push(to); where += ` AND r.created_at < ($${params.length}::date + 1)`; }
  return (await db.query(
    `SELECT r.*, p.name AS part, p.sku, cn.cn_number FROM part_returns r JOIN products p ON p.product_id = r.product_id LEFT JOIN credit_notes cn ON cn.cn_id = r.cn_id WHERE ${where} ORDER BY r.return_id DESC LIMIT 500`, params))
    .rows.map((r) => ({ ...r, qty: Number(r.qty) }));
};
