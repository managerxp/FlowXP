/*
 * Stock batches and the alerts built on them.
 *
 * The stock ledger (inventory_transactions / branch_stock) stays the single truth for HOW MUCH is on the shelf.
 * Batches only say WHEN it expires. How much of each batch is left is therefore derived, not stored: stock is
 * assumed to be used oldest-expiry first (first-expiry-first-out), so what is on the shelf now belongs to the
 * newest batches. That can never drift from the ledger — a sale, a cancellation, a wastage entry or a stock count
 * simply change the total and the split follows.
 */

/**
 * Split `stock` across batches, newest expiry first. Batches without an expiry date are treated as the newest
 * (they never expire, so they are the last to be used up). Returns batches with `remaining` added, oldest first.
 */
export const allocateRemaining = (batches, stock) => {
  const ordered = [...batches].sort((a, b) => {
    const ea = a.expiry_date ? String(a.expiry_date).slice(0, 10) : '9999-12-31';
    const eb = b.expiry_date ? String(b.expiry_date).slice(0, 10) : '9999-12-31';
    return ea === eb ? Number(a.batch_id) - Number(b.batch_id) : (ea < eb ? -1 : 1);
  });
  let left = Math.max(0, Number(stock));
  const out = ordered.map((b) => ({ ...b, remaining: 0 }));
  for (let i = out.length - 1; i >= 0; i--) {
    const take = Math.min(left, Number(out[i].qty_received));
    out[i].remaining = Math.round(take * 1000) / 1000;
    left -= take;
  }
  return out;
};

/** Batches (with remaining) for the outlets in scope. `branchId` null means every outlet. */
export const batchPositions = async (db, businessId, { branchId = null, productId = null, today }) => {
  const values = [businessId];
  let where = 'b.business_id = $1';
  if (branchId != null) { values.push(branchId); where += ` AND b.branch_id = $${values.length}`; }
  if (productId != null) { values.push(productId); where += ` AND b.product_id = $${values.length}`; }
  const batches = (await db.query(
    `SELECT b.batch_id, b.branch_id, b.product_id, p.name AS product, p.unit, b.batch_no, b.expiry_date, b.qty_received, b.unit_cost_paise, b.received_on, b.source, br.name AS branch
     FROM salon_stock_batches b JOIN products p ON p.product_id = b.product_id JOIN branches br ON br.branch_id = b.branch_id
     WHERE ${where} ORDER BY b.product_id, b.branch_id, b.expiry_date NULLS LAST, b.batch_id`, values)).rows;
  if (!batches.length) return [];
  const stock = new Map((await db.query(
    `SELECT branch_id, product_id, quantity FROM branch_stock WHERE product_id = ANY($1::int[])${branchId != null ? ' AND branch_id = $2' : ''}`,
    branchId != null ? [[...new Set(batches.map((b) => b.product_id))], branchId] : [[...new Set(batches.map((b) => b.product_id))]])).rows.map((r) => [`${r.branch_id}:${r.product_id}`, Number(r.quantity)]));
  const groups = new Map();
  for (const b of batches) {
    const key = `${b.branch_id}:${b.product_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  }
  const out = [];
  for (const [key, list] of groups) {
    for (const b of allocateRemaining(list, stock.get(key) ?? 0)) {
      const expiry = b.expiry_date ? String(b.expiry_date).slice(0, 10) : null;
      out.push({ ...b, expiry_date: expiry, days_to_expiry: expiry ? Math.round((Date.parse(expiry) - Date.parse(today)) / 86400000) : null });
    }
  }
  return out;
};
