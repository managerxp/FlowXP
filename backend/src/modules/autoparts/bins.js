/*
 * Stock in bins: put-away (unassigned -> bin), bin to bin moves, the primary (pick) bin, pick suggestions, and the reconciliation that proves the invariant
 *     sum(bin qty) <= branch_stock.quantity     (the difference is UNASSIGNED: received, not yet shelved)
 * None of these change the outlet total; the ledger (moveStock) does. Every movement is one transaction under the branch_stock row lock and writes bin_moves.
 * A retry with the same source_key does nothing a second time.
 */
import { PartsError, num, text } from './common.js';
import { getLocation } from './locations.js';

const q3 = (n) => Math.round(Number(n) * 1000) / 1000;

const replay = async (db, businessId, key) => {
  if (!key) return null;
  const r = (await db.query(`SELECT * FROM bin_moves WHERE business_id = $1 AND source_key = $2`, [businessId, String(key).slice(0, 100)])).rows[0];
  return r ? { replayed: true, move_id: Number(r.move_id), qty: Number(r.qty) } : null;
};

const storing = async (db, tenant, locationId) => {
  const l = await getLocation(db, tenant, locationId, { lock: true });
  if (!l.is_active) throw new PartsError(409, `${l.code} is switched off`);
  if (!l.can_store) throw new PartsError(409, `${l.code} is not a place that holds stock. Choose a bin or shelf`);
  return l;
};

/** Lock the outlet's stock row for a part and say how much is on hand and how much is already on shelves. */
const lockPart = async (db, tenant, branchId, productId) => {
  // the product row first, then its stock row: the order billing and moveStock use, so the two cannot wait on each other
  const own = (await db.query(`SELECT 1 FROM products WHERE product_id = $1 AND business_id = $2 FOR NO KEY UPDATE`, [productId, tenant.businessId])).rowCount;
  if (!own) throw new PartsError(404, 'Not found');
  const bs = (await db.query(`SELECT quantity FROM branch_stock WHERE branch_id = $1 AND product_id = $2 FOR UPDATE`, [branchId, productId])).rows[0];
  const onHand = Number(bs?.quantity ?? 0);
  const binned = Number((await db.query(`SELECT COALESCE(SUM(qty), 0) AS n FROM bin_stock WHERE branch_id = $1 AND product_id = $2`, [branchId, productId])).rows[0].n);
  return { onHand, binned, unassigned: q3(Math.max(onHand, 0) - binned) };
};

const warn = async (db, loc, productId) => {
  if (loc.capacity_units == null) return [];
  const held = Number((await db.query(`SELECT COALESCE(SUM(qty), 0) AS n FROM bin_stock WHERE location_id = $1`, [loc.location_id])).rows[0].n);
  return held > Number(loc.capacity_units) ? [`${loc.code} now holds ${held}, over its limit of ${Number(loc.capacity_units)}`] : [];
};

export const putAway = async (db, tenant, userId, b) => {
  const productId = Number(b.product_id);
  const qty = q3(num(b.qty, 'Quantity', { min: 0.001, max: 100000000, required: true }));
  const key = b.source_key ? String(b.source_key) : null;
  const again = await replay(db, tenant.businessId, key);
  if (again) return again;
  const loc = await storing(db, tenant, b.location_id);
  const part = await lockPart(db, tenant, loc.branch_id, productId);
  if (qty > part.unassigned) throw new PartsError(409, `Only ${part.unassigned} of this part is waiting to be shelved at this outlet`);
  await db.query(
    `INSERT INTO bin_stock (location_id, product_id, business_id, branch_id, qty) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (location_id, product_id) DO UPDATE SET qty = bin_stock.qty + EXCLUDED.qty, updated_at = now()`, [loc.location_id, productId, tenant.businessId, loc.branch_id, qty]);
  const hasPrimary = (await db.query(`SELECT 1 FROM bin_stock WHERE branch_id = $1 AND product_id = $2 AND is_primary`, [loc.branch_id, productId])).rowCount;
  if (!hasPrimary) await db.query(`UPDATE bin_stock SET is_primary = TRUE WHERE location_id = $1 AND product_id = $2`, [loc.location_id, productId]);
  const mv = (await db.query(
    `INSERT INTO bin_moves (business_id, branch_id, product_id, from_location_id, to_location_id, qty, kind, ref_type, ref_id, source_key, note, user_id)
     VALUES ($1,$2,$3,NULL,$4,$5,'PUTAWAY',$6,$7,$8,$9,$10) RETURNING move_id`,
    [tenant.businessId, loc.branch_id, productId, loc.location_id, qty, b.ref_type ?? null, b.ref_id ?? null, key, text(b.note, 'Note', { max: 200 }), userId])).rows[0];
  // close put-away tasks for this part, oldest first
  let left = qty;
  const tasks = (await db.query(`SELECT task_id, qty, qty_done FROM putaway_tasks WHERE branch_id = $1 AND product_id = $2 AND status = 'OPEN' ORDER BY (task_id = $3::int) DESC, task_id FOR UPDATE`, [loc.branch_id, productId, b.task_id ? Number(b.task_id) : null])).rows;
  for (const t of tasks) {
    if (left <= 0) break;
    const use = Math.min(left, q3(Number(t.qty) - Number(t.qty_done)));
    left = q3(left - use);
    const done = q3(Number(t.qty_done) + use);
    await db.query(`UPDATE putaway_tasks SET qty_done = $2, status = CASE WHEN $2 >= qty THEN 'DONE' ELSE 'OPEN' END, done_at = CASE WHEN $2 >= qty THEN now() ELSE NULL END WHERE task_id = $1`, [t.task_id, done]);
  }
  return { replayed: false, move_id: Number(mv.move_id), location_id: loc.location_id, location_code: loc.code, qty, unassigned: q3(part.unassigned - qty), warnings: await warn(db, loc, productId) };
};

export const moveBetween = async (db, tenant, userId, b) => {
  const productId = Number(b.product_id);
  const qty = q3(num(b.qty, 'Quantity', { min: 0.001, max: 100000000, required: true }));
  const key = b.source_key ? String(b.source_key) : null;
  const again = await replay(db, tenant.businessId, key);
  if (again) return again;
  if (Number(b.from_location_id) === Number(b.to_location_id)) throw new PartsError(400, 'Choose a different bin to move to');
  // lock in id order so two opposite moves cannot deadlock
  const ids = [Number(b.from_location_id), Number(b.to_location_id)].sort((x, y) => x - y);
  const locs = new Map();
  for (const id of ids) locs.set(id, await storing(db, tenant, id));
  const from = locs.get(Number(b.from_location_id)); const to = locs.get(Number(b.to_location_id));
  if (from.branch_id !== to.branch_id) throw new PartsError(400, 'Bins in two outlets are moved with a transfer, not a bin move');
  await lockPart(db, tenant, from.branch_id, productId);
  const src = (await db.query(`SELECT qty, reserved_qty, is_primary FROM bin_stock WHERE location_id = $1 AND product_id = $2 FOR UPDATE`, [from.location_id, productId])).rows[0];
  const free = src ? q3(Number(src.qty) - Number(src.reserved_qty)) : 0;
  if (qty > free) throw new PartsError(409, `${from.code} has ${free} of this part free to move${src && Number(src.reserved_qty) > 0 ? ` (${Number(src.reserved_qty)} is reserved)` : ''}`);
  await db.query(`UPDATE bin_stock SET qty = qty - $3, updated_at = now() WHERE location_id = $1 AND product_id = $2`, [from.location_id, productId, qty]);
  await db.query(
    `INSERT INTO bin_stock (location_id, product_id, business_id, branch_id, qty) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (location_id, product_id) DO UPDATE SET qty = bin_stock.qty + EXCLUDED.qty, updated_at = now()`, [to.location_id, productId, tenant.businessId, to.branch_id, qty]);
  if (src.is_primary && q3(Number(src.qty) - qty) <= 0) {
    // the primary bin was emptied: the bin it went to becomes primary
    await db.query(`UPDATE bin_stock SET is_primary = FALSE WHERE location_id = $1 AND product_id = $2`, [from.location_id, productId]);
    await db.query(`UPDATE bin_stock SET is_primary = TRUE WHERE location_id = $1 AND product_id = $2`, [to.location_id, productId]);
  }
  await db.query(`DELETE FROM bin_stock WHERE location_id = $1 AND product_id = $2 AND qty = 0 AND damaged_qty = 0 AND NOT is_primary`, [from.location_id, productId]);
  const mv = (await db.query(
    `INSERT INTO bin_moves (business_id, branch_id, product_id, from_location_id, to_location_id, qty, kind, source_key, note, user_id)
     VALUES ($1,$2,$3,$4,$5,$6,'MOVE',$7,$8,$9) RETURNING move_id`,
    [tenant.businessId, from.branch_id, productId, from.location_id, to.location_id, qty, key, text(b.note, 'Note', { max: 200 }), userId])).rows[0];
  return { replayed: false, move_id: Number(mv.move_id), from: from.code, to: to.code, qty, warnings: await warn(db, to, productId) };
};

export const setPrimary = async (db, tenant, productId, locationId) => {
  const loc = await storing(db, tenant, locationId);
  await lockPart(db, tenant, loc.branch_id, Number(productId));
  const row = (await db.query(`SELECT 1 FROM bin_stock WHERE location_id = $1 AND product_id = $2`, [loc.location_id, Number(productId)])).rowCount;
  if (!row) throw new PartsError(409, `This part is not in ${loc.code}. Put some there first`);
  await db.query(`UPDATE bin_stock SET is_primary = FALSE WHERE branch_id = $1 AND product_id = $2 AND is_primary`, [loc.branch_id, Number(productId)]);
  await db.query(`UPDATE bin_stock SET is_primary = TRUE WHERE location_id = $1 AND product_id = $2`, [loc.location_id, Number(productId)]);
  return { location_id: loc.location_id, location_code: loc.code };
};

/** Where one part is: each bin with its quantity (primary first, then by pick sequence) and what is unassigned. */
export const partLocations = async (db, tenant, productId, { branchId = null } = {}) => {
  const bid = tenant.scopeBranchId ?? (branchId ? Number(branchId) : tenant.branchId);
  const bins = (await db.query(
    `SELECT s.location_id, l.code, l.name, s.qty, s.damaged_qty, s.reserved_qty, s.is_primary FROM bin_stock s JOIN warehouse_locations l ON l.location_id = s.location_id
     WHERE s.business_id = $1 AND s.branch_id = $2 AND s.product_id = $3 AND (s.qty > 0 OR s.damaged_qty > 0 OR s.is_primary) ORDER BY s.is_primary DESC, s.qty DESC, l.code`,
    [tenant.businessId, bid, Number(productId)])).rows.map((r) => ({ ...r, qty: Number(r.qty), damaged_qty: Number(r.damaged_qty), reserved_qty: Number(r.reserved_qty), available: q3(Number(r.qty) - Number(r.reserved_qty)) }));
  const onHand = Number((await db.query(`SELECT quantity FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [bid, Number(productId)])).rows[0]?.quantity ?? 0);
  const binned = bins.reduce((s, r) => s + r.qty, 0);
  return { branch_id: bid, on_hand: onHand, binned: q3(binned), unassigned: q3(Math.max(onHand, 0) - binned), bins };
};

/** Pick list for a quantity: primary bin first, then the fullest, ordered by location code so the walk is short. */
export const pickPlan = async (db, tenant, productId, qty, { branchId = null } = {}) => {
  const loc = await partLocations(db, tenant, productId, { branchId });
  let left = q3(num(qty, 'Quantity', { min: 0.001, max: 100000000, required: true }));
  const lines = [];
  for (const b of loc.bins) { if (left <= 0) break; if (b.available > 0) { const take = Math.min(b.available, left); lines.push({ location_id: b.location_id, code: b.code, qty: q3(take) }); left = q3(left - take); } }
  lines.sort((a, b) => a.code.localeCompare(b.code));
  return { lines, short: left, unassigned_available: loc.unassigned };
};

export const reconcile = async (db, tenant, { branchId = null } = {}) => {
  const params = [tenant.businessId];
  let where = 'b.business_id = $1';
  const scope = tenant.scopeBranchId ?? (branchId ? Number(branchId) : null);
  if (scope != null) { params.push(scope); where += ` AND b.branch_id = $2`; }
  const rows = (await db.query(
    `WITH bins AS (SELECT business_id, branch_id, product_id, SUM(qty) AS binned FROM bin_stock GROUP BY business_id, branch_id, product_id)
     SELECT b.branch_id, b.product_id, p.name, p.sku, COALESCE(s.quantity, 0) AS on_hand, b.binned
     FROM bins b JOIN products p ON p.product_id = b.product_id LEFT JOIN branch_stock s ON s.branch_id = b.branch_id AND s.product_id = b.product_id
     WHERE ${where} AND b.binned > GREATEST(COALESCE(s.quantity, 0), 0) ORDER BY p.name LIMIT 500`, params)).rows;
  const total = (await db.query(
    `SELECT COUNT(*) AS parts, COALESCE(SUM(b.binned), 0) AS binned FROM (SELECT business_id, branch_id, product_id, SUM(qty) AS binned FROM bin_stock GROUP BY business_id, branch_id, product_id) b WHERE ${where}`, params)).rows[0];
  return { ok: rows.length === 0, parts_in_bins: Number(total.parts), units_in_bins: Number(total.binned), violations: rows.map((r) => ({ ...r, on_hand: Number(r.on_hand), binned: Number(r.binned), over_by: q3(Number(r.binned) - Math.max(Number(r.on_hand), 0)) })) };
};

/** Stock received but not shelved, per part (for the put-away screen). */
export const unassigned = async (db, tenant, { branchId = null } = {}) => {
  const params = [tenant.businessId];
  let where = 's.branch_id IN (SELECT branch_id FROM branches WHERE business_id = $1)';
  const scope = tenant.scopeBranchId ?? (branchId ? Number(branchId) : tenant.branchId);
  if (scope != null) { params.push(scope); where += ` AND s.branch_id = $2`; }
  const rows = (await db.query(
    `SELECT s.branch_id, s.product_id, p.name, p.sku, s.quantity AS on_hand, COALESCE(b.binned, 0) AS binned
     FROM branch_stock s JOIN products p ON p.product_id = s.product_id AND p.business_id = $1
     JOIN autoparts_parts ap ON ap.product_id = p.product_id
     LEFT JOIN (SELECT branch_id, product_id, SUM(qty) AS binned FROM bin_stock GROUP BY branch_id, product_id) b ON b.branch_id = s.branch_id AND b.product_id = s.product_id
     WHERE ${where} AND s.quantity > COALESCE(b.binned, 0) ORDER BY p.name LIMIT 500`, params)).rows;
  return rows.map((r) => ({ ...r, on_hand: Number(r.on_hand), binned: Number(r.binned), unassigned: q3(Number(r.on_hand) - Number(r.binned)) }));
};

export const openTasks = async (db, tenant) => (await db.query(
  `SELECT t.*, p.name, p.sku FROM putaway_tasks t JOIN products p ON p.product_id = t.product_id WHERE t.business_id = $1 AND t.status = 'OPEN'${tenant.scopeBranchId != null ? ' AND t.branch_id = $2' : ''} ORDER BY t.task_id LIMIT 500`,
  tenant.scopeBranchId != null ? [tenant.businessId, tenant.scopeBranchId] : [tenant.businessId])).rows.map((r) => ({ ...r, qty: Number(r.qty), qty_done: Number(r.qty_done) }));
