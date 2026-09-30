/*
 * Bills on hold at the till (migration 0030). Kept per outlet, so any till at
 * the outlet can resume them and another outlet never sees them. A held bill
 * is only a draft of what the till had on screen: prices, stock, coupons and
 * points are all worked out again when it is resumed and charged.
 */
import pool from '../config/database.js';
import { toPaise, toRupees } from '../utils/money.js';

const MAX_HELD = 50;          // per outlet; an old forgotten pile is a mistake, not a feature
const MAX_LINES = 200;
const MAX_BYTES = 64 * 1024;

const asHeld = (row) => ({
  hold_id: row.hold_id,
  label: row.label,
  bill: row.bill,
  item_count: Number(row.item_count),
  estimate: toRupees(row.estimate_paise),
  created_at: row.created_at,
  held_by: row.held_by || null
});

/* Only the parts of a till's bill worth keeping, in a known shape. */
const cleanBill = (bill) => {
  const lines = Array.isArray(bill?.lines) ? bill.lines : [];
  if (!lines.length) return { problem: 'There is nothing on the bill to hold' };
  if (lines.length > MAX_LINES) return { problem: `A held bill can have at most ${MAX_LINES} lines` };
  const clean = {
    lines: lines.map((l) => ({
      product_id: l.product_id ? Number(l.product_id) : null,
      custom: Boolean(l.custom),
      name: String(l.name || '').slice(0, 200),
      unit: l.unit ? String(l.unit).slice(0, 20) : '',
      unit_price: Number(l.unit_price) || 0,
      quantity: Number(l.quantity) || 0,
      discount: Number(l.discount) || 0,
      tax_rate: Number(l.tax_rate) || 0,
      modifier_ids: Array.isArray(l.modifier_ids) ? l.modifier_ids.map(Number).filter(Number.isInteger) : [],
      sig: typeof l.sig === 'string' ? l.sig.slice(0, 200) : '',
      track_inventory: Boolean(l.track_inventory),
      current_stock: Number(l.current_stock) || 0
    })),
    customer_id: bill.customer_id ? Number(bill.customer_id) : null,
    customer_name: bill.customer_name ? String(bill.customer_name).slice(0, 120) : null,
    coupon_code: bill.coupon_code ? String(bill.coupon_code).slice(0, 40) : null,
    discount: Number(bill.discount) || 0,
    notes: bill.notes ? String(bill.notes).slice(0, 500) : null
  };
  if (Buffer.byteLength(JSON.stringify(clean)) > MAX_BYTES) return { problem: 'That bill is too large to hold' };
  return { clean };
};

/* ==========================================================================
   GET /api/held-bills — this outlet's held bills, oldest first
   ========================================================================== */
export const list = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT h.*, u.name AS held_by FROM held_bills h LEFT JOIN users u ON u.user_id = h.created_by
      WHERE h.business_id = $1 AND h.branch_id = $2 ORDER BY h.created_at, h.hold_id`,
    [req.tenant.businessId, req.tenant.branchId]
  );
  res.json({ success: true, data: rows.map(asHeld) });
};

/* ==========================================================================
   POST /api/held-bills { label?, bill: { lines, customer_id, ... }, estimate? }
   ========================================================================== */
export const hold = async (req, res) => {
  const body = req.body || {};
  const { clean, problem } = cleanBill(body.bill);
  if (problem) return res.status(400).json({ success: false, message: problem });

  // A customer on the bill must belong to this business.
  if (clean.customer_id) {
    const ok = (await pool.query(`SELECT 1 FROM customers WHERE customer_id = $1 AND business_id = $2`, [clean.customer_id, req.tenant.businessId])).rowCount;
    if (!ok) return res.status(404).json({ success: false, message: 'Customer not found' });
  }

  const count = (await pool.query(`SELECT COUNT(*)::int AS n FROM held_bills WHERE business_id = $1 AND branch_id = $2`, [req.tenant.businessId, req.tenant.branchId])).rows[0].n;
  if (count >= MAX_HELD) return res.status(409).json({ success: false, message: `${MAX_HELD} bills are already on hold here. Resume or discard some first.` });

  let estimatePaise = 0;
  try { estimatePaise = Math.max(0, toPaise(body.estimate ?? 0)); } catch { estimatePaise = 0; }
  const itemCount = clean.lines.reduce((s, l) => s + Math.max(0, l.quantity), 0);
  const label = body.label ? String(body.label).trim().slice(0, 80) || null : null;

  const { rows } = await pool.query(
    `INSERT INTO held_bills (business_id, branch_id, label, bill, item_count, estimate_paise, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.tenant.businessId, req.tenant.branchId, label, clean, itemCount, estimatePaise, req.auth.userId]
  );
  res.status(201).json({ success: true, data: asHeld(rows[0]) });
};

/* ==========================================================================
   DELETE /api/held-bills/:id — resumed (the till has it back) or discarded
   ========================================================================== */
export const remove = async (req, res) => {
  const { rows } = await pool.query(
    `DELETE FROM held_bills WHERE hold_id = $1 AND business_id = $2 AND branch_id = $3 RETURNING *`,
    [req.params.id, req.tenant.businessId, req.tenant.branchId]
  );
  if (!rows.length) return res.status(404).json({ success: false, message: 'That held bill is not here any more. Someone may have resumed it.' });
  res.json({ success: true, data: asHeld(rows[0]) });
};
