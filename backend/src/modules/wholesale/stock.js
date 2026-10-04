/*
 * Wholesale stock: what is on the shelf, what is promised to open orders, and which batch it came from.
 *
 *   on hand    branch_stock.quantity            (the one ledger every FlowXP screen reads; moved only by moveStock)
 *   reserved   branch_stock.reserved_qty        (promised to confirmed orders, not yet shipped)
 *   available  on hand − reserved
 *   batches    wholesale_batches.qty_on_hand    (for batch / expiry tracked products: when it expires, FEFO)
 *
 * Reservation and release are single UPDATEs guarded in the WHERE clause, and every caller locks the product rows
 * first (in id order), so two people confirming orders for the last cartons can never both succeed.
 */
import { moveStock } from '../stock.js';
import { WholesaleError, q3 } from './common.js';

export const lockProducts = async (client, businessId, ids) => {
  const sorted = [...new Set(ids.map(Number))].sort((a, b) => a - b);
  if (!sorted.length) return new Map();
  const { rows } = await client.query(
    `SELECT product_id, name, unit, track_inventory, status, tax_rate, hsn_sac, purchase_price_paise, selling_price_paise, category_id
     FROM products WHERE business_id = $1 AND product_id = ANY($2::int[]) ORDER BY product_id FOR UPDATE`, [businessId, sorted]);
  return new Map(rows.map((r) => [r.product_id, r]));
};

/** Stock that has passed its expiry date and so cannot be sold: Map(product_id → qty) at one warehouse. */
export const expiredQty = async (db, branchId, productIds, onDate = null) => {
  const out = new Map();
  if (!productIds.length) return out;
  const { rows } = await db.query(
    `SELECT product_id, SUM(qty_on_hand) AS q FROM wholesale_batches
     WHERE branch_id = $1 AND product_id = ANY($2::int[]) AND qty_on_hand > 0 AND expiry_date < COALESCE($3::date, CURRENT_DATE) GROUP BY product_id`, [branchId, productIds, onDate]);
  for (const r of rows) out.set(r.product_id, Number(r.q));
  return out;
};

/** Map(product_id → { quantity, reserved, expired, available }) at one warehouse. Available = on hand − reserved − expired. */
export const availability = async (db, branchId, productIds) => {
  const out = new Map(productIds.map((id) => [Number(id), { quantity: 0, reserved: 0, expired: 0, available: 0 }]));
  if (!productIds.length) return out;
  const { rows } = await db.query(`SELECT product_id, quantity, reserved_qty FROM branch_stock WHERE branch_id = $1 AND product_id = ANY($2::int[])`, [branchId, productIds]);
  const expired = await expiredQty(db, branchId, productIds);
  for (const r of rows) {
    const q = Number(r.quantity); const res = Number(r.reserved_qty); const ex = expired.get(r.product_id) || 0;
    out.set(r.product_id, { quantity: q, reserved: res, expired: ex, available: Math.max(0, q3(q - res - ex)) });
  }
  return out;
};

/** Reserve up to `qty` base units. Returns how many were actually reserved (less than asked when stock is short). */
export const reserve = async (client, { branchId, productId, qty, allowPartial = true }) => {
  await client.query(`INSERT INTO branch_stock (branch_id, product_id, quantity) VALUES ($1,$2,0) ON CONFLICT DO NOTHING`, [branchId, productId]);
  const row = (await client.query(`SELECT quantity, reserved_qty FROM branch_stock WHERE branch_id = $1 AND product_id = $2 FOR UPDATE`, [branchId, productId])).rows[0];
  const expired = (await expiredQty(client, branchId, [productId])).get(productId) || 0;
  const free = Math.max(0, q3(Number(row.quantity) - Number(row.reserved_qty) - expired));
  const take = Math.min(free, q3(qty));
  if (take < qty - 1e-9 && !allowPartial) throw new WholesaleError(409, `Only ${free} available`);
  if (take > 0) await client.query(`UPDATE branch_stock SET reserved_qty = reserved_qty + $3 WHERE branch_id = $1 AND product_id = $2`, [branchId, productId, take]);
  return take;
};

export const release = async (client, { branchId, productId, qty }) => {
  if (!(qty > 0)) return;
  await client.query(`UPDATE branch_stock SET reserved_qty = GREATEST(0, reserved_qty - $3) WHERE branch_id = $1 AND product_id = $2`, [branchId, productId, q3(qty)]);
};

/* ── batches ──────────────────────────────────────────────────────────────────────────────── */

export const batchTracked = async (db, businessId, productIds) => {
  if (!productIds.length) return new Map();
  const { rows } = await db.query(`SELECT product_id, batch_tracking, expiry_tracking, serial_tracking FROM wholesale_item_details WHERE business_id = $1 AND product_id = ANY($2::int[])`, [businessId, productIds]);
  return new Map(rows.map((r) => [r.product_id, r]));
};

/** Add stock to a batch (creating it if new) and record the movement. Does NOT touch branch_stock: callers do that once. */
export const addToBatch = async (client, { businessId, branchId, productId, batchNo, mfgDate = null, expiryDate = null, qty, costPaise = null, source = 'GRN', refId = null, refType = 'GRN' }) => {
  const row = (await client.query(
    `INSERT INTO wholesale_batches (business_id, branch_id, product_id, batch_no, mfg_date, expiry_date, qty_on_hand, cost_paise, source, ref_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (branch_id, product_id, lower(batch_no)) DO UPDATE SET qty_on_hand = wholesale_batches.qty_on_hand + EXCLUDED.qty_on_hand,
       expiry_date = COALESCE(wholesale_batches.expiry_date, EXCLUDED.expiry_date), mfg_date = COALESCE(wholesale_batches.mfg_date, EXCLUDED.mfg_date),
       cost_paise = COALESCE(EXCLUDED.cost_paise, wholesale_batches.cost_paise)
     RETURNING batch_id`, [businessId, branchId, productId, String(batchNo).slice(0, 40), mfgDate, expiryDate, q3(qty), costPaise, source, refId])).rows[0];
  await client.query(`INSERT INTO wholesale_batch_moves (business_id, batch_id, qty, ref_type, ref_id) VALUES ($1,$2,$3,$4,$5)`, [businessId, row.batch_id, q3(qty), refType, refId]);
  return row.batch_id;
};

/**
 * Pick batches for `qty` base units, soonest expiry first (or oldest received first when FEFO is off), skipping
 * expired batches. Locks the rows it takes from. Returns { allocations: [{ batch_id, qty }], unbatched } where
 * `unbatched` is what no batch could cover (stock that was never given a batch).
 */
export const allocateBatches = async (client, { branchId, productId, qty, fefo = true, today }) => {
  const rows = (await client.query(
    `SELECT batch_id, qty_on_hand FROM wholesale_batches
     WHERE branch_id = $1 AND product_id = $2 AND qty_on_hand > 0 AND status = 'ACTIVE' AND (expiry_date IS NULL OR expiry_date >= $3::date)
     ORDER BY ${fefo ? 'expiry_date NULLS LAST,' : ''} received_on, batch_id FOR UPDATE`, [branchId, productId, today])).rows;
  let left = q3(qty); const allocations = [];
  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(left, Number(r.qty_on_hand));
    allocations.push({ batch_id: Number(r.batch_id), qty: q3(take) });
    left = q3(left - take);
  }
  return { allocations, unbatched: left };
};

/** Take quantities out of specific batches (they must hold enough) and record each movement. */
export const consumeBatches = async (client, { businessId, allocations, refType, refId }) => {
  for (const a of allocations) {
    const hit = await client.query(`UPDATE wholesale_batches SET qty_on_hand = qty_on_hand - $2 WHERE batch_id = $1 AND business_id = $3 AND qty_on_hand >= $2 RETURNING batch_id`, [a.batch_id, a.qty, businessId]);
    if (!hit.rowCount) throw new WholesaleError(409, 'A batch no longer has that much stock. Pick again.');
    await client.query(`INSERT INTO wholesale_batch_moves (business_id, batch_id, qty, ref_type, ref_id) VALUES ($1,$2,$3,$4,$5)`, [businessId, a.batch_id, -a.qty, refType, refId]);
  }
};

export const returnToBatch = async (client, { businessId, batchId, qty, refType, refId }) => {
  const hit = await client.query(`UPDATE wholesale_batches SET qty_on_hand = qty_on_hand + $2 WHERE batch_id = $1 AND business_id = $3 RETURNING batch_id`, [batchId, q3(qty), businessId]);
  if (!hit.rowCount) throw new WholesaleError(400, 'That batch is not yours');
  await client.query(`INSERT INTO wholesale_batch_moves (business_id, batch_id, qty, ref_type, ref_id) VALUES ($1,$2,$3,$4,$5)`, [businessId, batchId, q3(qty), refType, refId]);
};

/** Put stock on the shelf: the ledger (moveStock) plus the audit row, in one call. */
export const stockIn = async (client, { businessId, branchId, productId, qty, type = 'PURCHASE', refType, refId, notes = null, userId = null, reason = null }) => {
  await moveStock(client, { businessId, branchId, productId, delta: q3(qty) });
  await client.query(
    `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, reference_id, notes, created_by, reason_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [businessId, branchId, productId, type, q3(qty), refType, refId, notes, userId, reason]);
};

export const stockOut = async (client, { businessId, branchId, productId, qty, type = 'SALE', refType, refId, notes = null, userId = null, reason = null }) =>
  stockIn(client, { businessId, branchId, productId, qty: -qty, type, refType, refId, notes, userId, reason });

/** Record damaged goods coming in (+) or leaving (−: returned to the supplier, written off). Damaged stock is not in branch_stock. */
export const logDamaged = async (client, { businessId, branchId, productId, qty, source, refType = null, refId = null, note = null, userId = null }) => {
  if (!qty) return;
  await client.query(
    `INSERT INTO wholesale_damaged_log (business_id, branch_id, product_id, qty, source, ref_type, ref_id, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [businessId, branchId, productId, q3(qty), source, refType, refId, note, userId]);
};
