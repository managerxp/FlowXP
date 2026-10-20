/*
 * Keeps stock in bins consistent with the stock ledger, whoever moved the stock.
 *
 * `moveStock` (modules/stock.js) is the only writer of branch_stock, and calls this after any movement that REMOVES stock. Parts held in bins are physically on shelves, so
 * a sale, a transfer out, a write-off, a supplier return or a count shortage all take from bins first, in pick sequence (the bin asked for, then the primary bin, then the
 * fullest), and only what bins cannot cover comes from the UNASSIGNED stock (received, not yet shelved). Reserved quantity is left alone while anything else can cover it.
 * Each take is written to bin_moves (kind AUTO), so the history says where it came from.
 *
 * The invariant is  sum(bin qty)  <=  branch_stock.quantity  (a negative branch quantity, which offline sales can cause, leaves bins empty). This function is why it holds
 * for every caller without any of them knowing bins exist. For a business with no bins it is one cheap indexed read.
 */
const q3 = (n) => Math.round(Number(n) * 1000) / 1000;

export const trimBins = async (client, { businessId, branchId, productId, delta, preferLocationId = null, refType = null, refId = null }) => {
  if (!(delta < 0)) return;
  const rows = (await client.query(
    `SELECT location_id, qty, reserved_qty FROM bin_stock WHERE branch_id = $1 AND product_id = $2 AND qty > 0
     ORDER BY (location_id = $3::int) DESC, is_primary DESC, qty DESC, location_id FOR UPDATE`, [branchId, productId, preferLocationId])).rows;
  if (!rows.length) return;
  let left = q3(-delta);
  const taken = [];
  const take = (r, amount) => { taken.push({ location_id: r.location_id, qty: q3(amount) }); r.qty = q3(Number(r.qty) - amount); left = q3(left - amount); };
  // first what is free on the shelves (not reserved), in pick sequence
  for (const r of rows) {
    if (left <= 0) break;
    const free = q3(Number(r.qty) - Number(r.reserved_qty));
    if (free > 0) take(r, Math.min(free, left));
  }
  // then the invariant: bins may not hold more than the ledger now says is in the outlet (reserved stock goes only if it must)
  const q = Number((await client.query(`SELECT quantity FROM branch_stock WHERE branch_id = $1 AND product_id = $2`, [branchId, productId])).rows[0]?.quantity ?? 0);
  const binned = rows.reduce((s, r) => s + Number(r.qty), 0);
  let excess = q3(binned - Math.max(q, 0));
  for (const r of rows) {
    if (excess <= 0) break;
    const amount = Math.min(Number(r.qty), excess);
    if (amount > 0) { take(r, amount); excess = q3(excess - amount); }
  }
  const by = new Map();
  for (const t of taken) by.set(t.location_id, q3((by.get(t.location_id) || 0) + t.qty));
  for (const [locationId, amount] of by) {
    // reserved can never exceed what is there
    await client.query(`UPDATE bin_stock SET qty = qty - $3, reserved_qty = LEAST(reserved_qty, qty - $3), updated_at = now() WHERE location_id = $1 AND product_id = $2`, [locationId, productId, amount]);
    await client.query(
      `INSERT INTO bin_moves (business_id, branch_id, product_id, from_location_id, to_location_id, qty, kind, ref_type, ref_id) VALUES ($1,$2,$3,$4,NULL,$5,'AUTO',$6,$7)`,
      [businessId, branchId, productId, locationId, amount, refType, refId]);
  }
};
