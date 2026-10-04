/*
 * Vehicle (van) stock: load, sell, return, count.
 *
 * Everything here runs inside the caller's transaction and moves stock in matched pairs, so the warehouse ledger and
 * the vehicle ledger always agree:
 *
 *   load      warehouse −q (TRANSFER van_load, batches FEFO)        vehicle +q (per batch)
 *   sell      vehicle −q (per batch, FEFO)                           (the invoice is flagged stockHandledElsewhere)
 *   return    vehicle −q                                             warehouse +q (TRANSFER van_return, same batch)
 *   count     a shortage is returned then written off (net 0 on     a surplus is booked in then loaded (net 0 on the
 *             the warehouse, the loss is on the ledger)               warehouse, the find is on the ledger)
 */
import { WholesaleError, q3 } from '../wholesale/common.js';
import { allocateBatches, availability, batchTracked, consumeBatches, lockProducts, returnToBatch, stockIn, stockOut } from '../wholesale/stock.js';

const addRow = async (client, { businessId, vehicleId, productId, batchId, qty }) => {
  await client.query(
    `INSERT INTO dist_vehicle_stock (vehicle_id, business_id, product_id, batch_id, qty_base) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (vehicle_id, product_id, COALESCE(batch_id, 0)) DO UPDATE SET qty_base = dist_vehicle_stock.qty_base + EXCLUDED.qty_base`, [vehicleId, businessId, productId, batchId, q3(qty)]);
};

const move = (client, { businessId, vehicleId, productId, batchId = null, qty, kind, refType = null, refId = null, note = null, userId = null }) =>
  client.query(
    `INSERT INTO dist_vehicle_moves (business_id, vehicle_id, product_id, batch_id, qty_base, kind, ref_type, ref_id, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [businessId, vehicleId, productId, batchId, q3(qty), kind, refType, refId, note, userId]);

/** Lock the vehicle row (serialises load / sell / count on one van). */
export const lockVehicle = async (client, businessId, id) => {
  const v = (await client.query(`SELECT * FROM dist_vehicles WHERE business_id = $1 AND vehicle_id = $2 FOR UPDATE`, [businessId, id])).rows[0];
  if (!v) throw new WholesaleError(404, 'Not found');
  return v;
};

/** Put base-unit quantities on the van from its home warehouse. items: [{ product_id, qty (base) }] */
export const loadVehicle = async (client, { businessId, vehicle, items, userId, today }) => {
  const ids = [...new Set(items.map((i) => i.product_id))].sort((a, b) => a - b);
  const products = await lockProducts(client, businessId, ids);
  const avail = await availability(client, vehicle.branch_id, ids);
  const tracked = await batchTracked(client, businessId, ids);
  const need = new Map();
  for (const i of items) need.set(i.product_id, q3((need.get(i.product_id) || 0) + i.qty));
  for (const [productId, qty] of need) {
    const p = products.get(productId);
    if (!p) throw new WholesaleError(400, `Product ${productId} was not found`);
    if (!p.track_inventory) throw new WholesaleError(400, `${p.name} is not a stocked product`);
    const a = avail.get(productId);
    if (qty > a.available + 1e-9) throw new WholesaleError(409, `Only ${a.available} ${p.unit} of ${p.name} is free to load (${a.reserved} is reserved for orders${a.expired ? `, ${a.expired} has expired` : ''})`);
  }
  for (const [productId, qty] of need) {
    let batched = 0;
    if (tracked.get(productId)?.batch_tracking) {
      const { allocations } = await allocateBatches(client, { branchId: vehicle.branch_id, productId, qty, today });
      await consumeBatches(client, { businessId, allocations, refType: 'van_load', refId: vehicle.vehicle_id });
      for (const a of allocations) {
        await addRow(client, { businessId, vehicleId: vehicle.vehicle_id, productId, batchId: a.batch_id, qty: a.qty });
        await move(client, { businessId, vehicleId: vehicle.vehicle_id, productId, batchId: a.batch_id, qty: a.qty, kind: 'LOAD', refType: 'warehouse', refId: vehicle.branch_id, userId });
        batched = q3(batched + a.qty);
      }
    }
    const rest = q3(qty - batched);   // stock that was never given a batch
    if (rest > 0) {
      await addRow(client, { businessId, vehicleId: vehicle.vehicle_id, productId, batchId: null, qty: rest });
      await move(client, { businessId, vehicleId: vehicle.vehicle_id, productId, qty: rest, kind: 'LOAD', refType: 'warehouse', refId: vehicle.branch_id, userId });
    }
    await stockOut(client, { businessId, branchId: vehicle.branch_id, productId, qty, type: 'TRANSFER', refType: 'van_load', refId: vehicle.vehicle_id, notes: `Loaded on ${vehicle.vehicle_no}`, userId });
  }
};

/** Take `qty` base units of a product off the van, soonest expiry first, skipping expired batches. Returns [{ stock_id, batch_id, qty }]. */
export const takeFromVehicle = async (client, { vehicleId, productId, qty, today, productName = 'that product' }) => {
  const rows = (await client.query(
    `SELECT s.stock_id, s.batch_id, s.qty_base FROM dist_vehicle_stock s LEFT JOIN wholesale_batches b ON b.batch_id = s.batch_id
     WHERE s.vehicle_id = $1 AND s.product_id = $2 AND s.qty_base > 0 AND (b.expiry_date IS NULL OR b.expiry_date >= $3::date)
     ORDER BY b.expiry_date NULLS LAST, s.stock_id FOR UPDATE OF s`, [vehicleId, productId, today])).rows;
  let left = q3(qty); const taken = [];
  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(left, Number(r.qty_base));
    taken.push({ stock_id: r.stock_id, batch_id: r.batch_id, qty: q3(take) });
    left = q3(left - take);
  }
  if (left > 1e-9) throw new WholesaleError(409, `Only ${q3(qty - left)} of ${productName} is on this van`);
  return taken;
};

/** Record that `taken` left the van in a sale. */
export const consumeFromVehicle = async (client, { businessId, vehicleId, productId, taken, refId, userId }) => {
  for (const t of taken) {
    await client.query(`UPDATE dist_vehicle_stock SET qty_base = qty_base - $2 WHERE stock_id = $1`, [t.stock_id, t.qty]);
    await move(client, { businessId, vehicleId, productId, batchId: t.batch_id, qty: -t.qty, kind: 'SALE', refType: 'invoice', refId, userId });
  }
};

/** Everything on the van: [{ stock_id, product_id, name, unit, batch_id, batch_no, expiry_date, qty_base, cost_paise }] */
export const vehicleStock = async (db, vehicleId) => (await db.query(
  `SELECT s.stock_id, s.product_id, p.name, p.sku, p.unit, p.purchase_price_paise, s.batch_id, b.batch_no, b.expiry_date, s.qty_base
   FROM dist_vehicle_stock s JOIN products p ON p.product_id = s.product_id LEFT JOIN wholesale_batches b ON b.batch_id = s.batch_id
   WHERE s.vehicle_id = $1 AND s.qty_base > 0 ORDER BY lower(p.name), b.expiry_date NULLS LAST, s.stock_id`, [vehicleId])).rows;

/** Send stock from the van back to the home warehouse (same batch it came from). rows: [{ stock_id, qty }] */
export const returnToWarehouse = async (client, { businessId, vehicle, rows, userId, note = null }) => {
  for (const r of rows) {
    if (!(r.qty > 0)) continue;
    const s = (await client.query(`SELECT * FROM dist_vehicle_stock WHERE stock_id = $1 AND vehicle_id = $2 FOR UPDATE`, [r.stock_id, vehicle.vehicle_id])).rows[0];
    if (!s || Number(s.qty_base) < r.qty - 1e-9) throw new WholesaleError(409, 'The van does not hold that much');
    await client.query(`UPDATE dist_vehicle_stock SET qty_base = qty_base - $2 WHERE stock_id = $1`, [s.stock_id, q3(r.qty)]);
    await move(client, { businessId, vehicleId: vehicle.vehicle_id, productId: s.product_id, batchId: s.batch_id, qty: -r.qty, kind: 'RETURN', refType: 'warehouse', refId: vehicle.branch_id, note, userId });
    if (s.batch_id) await returnToBatch(client, { businessId, batchId: s.batch_id, qty: r.qty, refType: 'van_return', refId: vehicle.vehicle_id });
    await stockIn(client, { businessId, branchId: vehicle.branch_id, productId: s.product_id, qty: r.qty, type: 'TRANSFER', refType: 'van_return', refId: vehicle.vehicle_id, notes: `Returned from ${vehicle.vehicle_no}`, userId });
  }
};

/**
 * End-of-day count. counts: [{ stock_id, counted }] — one for every row on the van. A shortage is booked as a loss and
 * a surplus as a find (each a matched pair on the warehouse ledger); then, if asked, what is left goes back.
 * Returns { lines, shortage_paise, surplus_paise }.
 */
export const reconcileVehicle = async (client, { businessId, vehicle, counts, returnAll, userId, note }) => {
  const rows = await vehicleStock(client, vehicle.vehicle_id);
  const byId = new Map(rows.map((r) => [r.stock_id, r]));
  const given = new Map(counts.map((c) => [c.stock_id, c.counted]));
  const unknown = counts.filter((c) => !byId.has(c.stock_id));
  if (unknown.length) throw new WholesaleError(400, 'One of the counted items is not on this van');
  const missing = rows.filter((r) => !given.has(r.stock_id));
  if (missing.length) throw new WholesaleError(400, `Count every item on the van. Not counted: ${missing.slice(0, 3).map((m) => m.name).join(', ')}${missing.length > 3 ? '…' : ''}`);
  const lines = []; let shortage = 0; let surplus = 0;
  for (const r of rows) {
    const system = Number(r.qty_base); const counted = q3(given.get(r.stock_id));
    if (!(counted >= 0)) throw new WholesaleError(400, 'A count cannot be negative');
    const variance = q3(counted - system);
    const cost = Number(r.purchase_price_paise || 0);
    lines.push({ stock_id: r.stock_id, product_id: r.product_id, product: r.name, unit: r.unit, batch_no: r.batch_no, system, counted, variance, value_paise: Math.round(Math.abs(variance) * cost) });
    if (variance < 0) {
      const lost = -variance; shortage += Math.round(lost * cost);
      await client.query(`UPDATE dist_vehicle_stock SET qty_base = qty_base - $2 WHERE stock_id = $1`, [r.stock_id, lost]);
      await move(client, { businessId, vehicleId: vehicle.vehicle_id, productId: r.product_id, batchId: r.batch_id, qty: -lost, kind: 'COUNT_ADJUST', refType: 'count', note: 'Shortage at count', userId });
      await stockIn(client, { businessId, branchId: vehicle.branch_id, productId: r.product_id, qty: lost, type: 'TRANSFER', refType: 'van_return', refId: vehicle.vehicle_id, notes: `Shortage on ${vehicle.vehicle_no}: back, then written off`, userId });
      await stockOut(client, { businessId, branchId: vehicle.branch_id, productId: r.product_id, qty: lost, type: 'WASTAGE', refType: 'van_count', refId: vehicle.vehicle_id, notes: `Van shortage ${vehicle.vehicle_no}`, userId, reason: 'OTHER' });
    } else if (variance > 0) {
      surplus += Math.round(variance * cost);
      await client.query(`UPDATE dist_vehicle_stock SET qty_base = qty_base + $2 WHERE stock_id = $1`, [r.stock_id, variance]);
      await move(client, { businessId, vehicleId: vehicle.vehicle_id, productId: r.product_id, batchId: r.batch_id, qty: variance, kind: 'COUNT_ADJUST', refType: 'count', note: 'Surplus at count', userId });
      await stockIn(client, { businessId, branchId: vehicle.branch_id, productId: r.product_id, qty: variance, type: 'ADJUSTMENT', refType: 'van_count', refId: vehicle.vehicle_id, notes: `Van surplus ${vehicle.vehicle_no}`, userId });
      await stockOut(client, { businessId, branchId: vehicle.branch_id, productId: r.product_id, qty: variance, type: 'TRANSFER', refType: 'van_load', refId: vehicle.vehicle_id, notes: `Surplus put on ${vehicle.vehicle_no}`, userId });
    }
  }
  if (returnAll) {
    const left = await vehicleStock(client, vehicle.vehicle_id);
    await returnToWarehouse(client, { businessId, vehicle, rows: left.map((l) => ({ stock_id: l.stock_id, qty: Number(l.qty_base) })), userId, note: 'End of day return' });
  }
  const rec = (await client.query(
    `INSERT INTO dist_vehicle_reconciliations (business_id, vehicle_id, lines, shortage_paise, surplus_paise, returned, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING recon_id, created_at`,
    [businessId, vehicle.vehicle_id, JSON.stringify(lines), shortage, surplus, Boolean(returnAll), note, userId])).rows[0];
  return { recon_id: rec.recon_id, created_at: rec.created_at, lines, shortage_paise: shortage, surplus_paise: surplus };
};
