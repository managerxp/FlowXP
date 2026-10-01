/*
 * Warehouse fulfilment: pick lists, packing, dispatch (delivery challan + tax invoice) and delivery tracking.
 *
 *   confirmed order (stock reserved)
 *     → pick list      what to take from which bin and batch (soonest expiry first)
 *     → picked         what the picker really took (short picks go back to the order as a back-order)
 *     → packed         packages with weights
 *     → dispatched     the delivery challan and the invoice are raised in one transaction; stock leaves the shelf,
 *                      batches are consumed, the reservation is released, the order's shipped quantities move
 *     → delivered / failed / returned, with proof of delivery
 *
 * The invoice is made by the shared billing engine (modules/billing.js), so GST, numbering, loyalty, payments and
 * every report treat it like any other invoice.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { hasPermission } from '../middleware/auth.js';
import { createInvoiceInTransaction, recordInvoiceCreated } from '../modules/billing.js';
import { release } from '../modules/wholesale/stock.js';
import { batchTracked, consumeBatches, lockProducts } from '../modules/wholesale/stock.js';
import { loadItems, refreshStatus } from '../modules/wholesale/orders.js';
import {
  WholesaleError, addDays, audit, getSettings, int, isoDate, like, nextNumber, num, ok, oneOf, page, paging, q3, text, today, withTransaction, wrapAll
} from '../modules/wholesale/common.js';
import { day, notify } from '../modules/wholesale/notify.js';

const rupees = (v) => toRupees(Number(v || 0));
const DAY_ONE = new Set(['PENDING', 'PICKING']);   // pick-list states in which the planned quantity is what the order is holding

/** What a pick item holds against its order line: the plan until it is picked, then what was really picked. */
const held = (list, pi) => (DAY_ONE.has(list.status) ? Number(pi.qty_base) : Number(pi.picked_base));

/* ── pick lists ───────────────────────────────────────────────────────────────────────────── */

const listShape = (l) => ({
  pick_id: l.pick_id, pick_number: l.pick_number, status: l.status, order_id: l.order_id, order_number: l.order_number, customer: l.customer_name, branch_id: l.branch_id, warehouse: l.warehouse_name,
  picker_user_id: l.picker_user_id, picker_name: l.picker_name, notes: l.notes, created_at: l.created_at, picked_at: l.picked_at, packed_at: l.packed_at, dispatched_at: l.dispatched_at,
  ...(l.item_count != null ? { items: Number(l.item_count), units: Number(l.units) } : {})
});

const loadList = async (db, businessId, id, { lock = false } = {}) => {
  if (!Number.isInteger(Number(id))) return null;
  return (await db.query(
    `SELECT l.*, o.order_number, o.customer_id, c.name AS customer_name, b.name AS warehouse_name
     FROM wholesale_pick_lists l JOIN wholesale_sales_orders o ON o.order_id = l.order_id JOIN customers c ON c.customer_id = o.customer_id JOIN branches b ON b.branch_id = l.branch_id
     WHERE l.business_id = $1 AND l.pick_id = $2 ${lock ? 'FOR UPDATE OF l' : ''}`, [businessId, id])).rows[0] || null;
};

const pickDetail = async (db, businessId, l) => {
  const items = (await db.query(
    `SELECT pi.*, p.name AS product_name, p.sku, p.unit AS base_unit, oi.unit_name, oi.unit_factor, loc.code AS location_code
     FROM wholesale_pick_items pi JOIN products p ON p.product_id = pi.product_id JOIN wholesale_sales_order_items oi ON oi.item_id = pi.order_item_id
     LEFT JOIN wholesale_locations loc ON loc.location_id = pi.location_id WHERE pi.pick_id = $1 ORDER BY loc.code NULLS LAST, p.name`, [l.pick_id])).rows;
  const batches = items.length ? (await db.query(
    `SELECT pb.pick_item_id, pb.batch_id, pb.qty_base, b.batch_no, b.expiry_date FROM wholesale_pick_item_batches pb JOIN wholesale_batches b ON b.batch_id = pb.batch_id WHERE pb.pick_item_id = ANY($1::int[]) ORDER BY b.expiry_date NULLS LAST`, [items.map((i) => i.pick_item_id)])).rows : [];
  const packages = (await db.query(
    `SELECT k.*, COALESCE(json_agg(json_build_object('pick_item_id', pk.pick_item_id, 'qty_base', pk.qty_base)) FILTER (WHERE pk.pick_item_id IS NOT NULL), '[]') AS items
     FROM wholesale_packages k LEFT JOIN wholesale_package_items pk ON pk.package_id = k.package_id WHERE k.pick_id = $1 GROUP BY k.package_id ORDER BY k.package_id`, [l.pick_id])).rows;
  return {
    ...listShape(l),
    items: items.map((i) => ({
      pick_item_id: i.pick_item_id, order_item_id: i.order_item_id, product_id: i.product_id, product: i.product_name, sku: i.sku, base_unit: i.base_unit, unit_name: i.unit_name, unit_factor: Number(i.unit_factor),
      location_id: i.location_id, location: i.location_code, qty_base: Number(i.qty_base), picked_base: Number(i.picked_base), serials: i.serials ? i.serials.split('\n') : [],
      batches: batches.filter((b) => b.pick_item_id === i.pick_item_id).map((b) => ({ batch_id: Number(b.batch_id), batch_no: b.batch_no, expiry_date: b.expiry_date, qty_base: Number(b.qty_base) }))
    })),
    packages: packages.map((k) => ({ package_id: k.package_id, package_no: k.package_no, weight_kg: k.weight_kg == null ? null : Number(k.weight_kg), length_cm: k.length_cm, width_cm: k.width_cm, height_cm: k.height_cm, notes: k.notes, items: k.items }))
  };
};

/** Pick quantities from batches, soonest expiry first, leaving out what other open pick lists have already been promised. */
const proposeBatches = async (client, { branchId, productId, qty, fefo, onDate }) => {
  const rows = (await client.query(
    `SELECT b.batch_id, b.qty_on_hand - COALESCE((
         SELECT SUM(pb.qty_base) FROM wholesale_pick_item_batches pb JOIN wholesale_pick_items pi ON pi.pick_item_id = pb.pick_item_id JOIN wholesale_pick_lists pl ON pl.pick_id = pi.pick_id
         WHERE pb.batch_id = b.batch_id AND pl.status NOT IN ('DISPATCHED','CANCELLED')), 0) AS free
     FROM wholesale_batches b WHERE b.branch_id = $1 AND b.product_id = $2 AND b.qty_on_hand > 0 AND (b.expiry_date IS NULL OR b.expiry_date >= $3::date)
     ORDER BY ${fefo ? 'b.expiry_date NULLS LAST,' : ''} b.received_on, b.batch_id FOR UPDATE OF b`, [branchId, productId, onDate])).rows;
  let left = q3(qty); const out = [];
  for (const r of rows) {
    const free = Number(r.free);
    if (left <= 0 || free <= 0) continue;
    const take = Math.min(left, free);
    out.push({ batch_id: Number(r.batch_id), qty: q3(take) }); left = q3(left - take);
  }
  return { allocations: out, unbatched: left };
};

/* POST /orders/:id/pick-lists { picker_user_id?, picker_name?, notes?, items?: [{ order_item_id, qty_base }] } */
const createPick = async (req, res) => {
  const b = req.body || {};
  const settings = await getSettings(pool, req.tenant.businessId);
  const pickId = await withTransaction(async (client) => {
    const order = (await client.query(`SELECT * FROM wholesale_sales_orders WHERE business_id = $1 AND order_id = $2 FOR UPDATE`, [req.tenant.businessId, req.params.id])).rows[0];
    if (!order) throw new WholesaleError(404, 'Not found');
    if (req.tenant.pinned && order.branch_id !== req.tenant.branchId) throw new WholesaleError(404, 'Not found');
    if (!['CONFIRMED', 'PARTIALLY_FULFILLED', 'PACKED'].includes(order.status)) throw new WholesaleError(409, 'Confirm the order before picking it');
    const items = await loadItems(client, order.order_id, { lock: true });
    await lockProducts(client, req.tenant.businessId, items.map((i) => i.product_id));
    const asked = Array.isArray(b.items) ? new Map(b.items.map((x) => [Number(x.order_item_id), num(x.qty_base, 'Quantity', { min: 0 })])) : null;
    const tracked = await batchTracked(client, req.tenant.businessId, items.map((i) => i.product_id));
    const onDate = await today(client, req.tenant.businessId);
    const plan = [];
    for (const it of items) {
      const pickable = q3(Number(it.reserved_base) - (Number(it.picked_base) - Number(it.shipped_base)));
      if (pickable <= 1e-9) continue;
      const want = asked ? Math.min(pickable, asked.get(it.item_id) ?? 0) : pickable;
      if (want > 1e-9) plan.push({ it, qty: q3(want) });
    }
    if (!plan.length) throw new WholesaleError(409, 'Nothing is reserved to pick yet. Reserve stock first, or wait for the goods receipt.');
    const number = await nextNumber(client, req.tenant.businessId, 'PK', 'PK');
    const list = (await client.query(
      `INSERT INTO wholesale_pick_lists (business_id, branch_id, order_id, pick_number, picker_user_id, picker_name, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.tenant.businessId, order.branch_id, order.order_id, number, int(b.picker_user_id, 'Picker', { min: 1 }), text(b.picker_name, 'Picker', { max: 120 }), text(b.notes, 'Notes', { max: 300 }), req.auth.userId])).rows[0];
    for (const { it, qty } of plan) {
      const bin = (await client.query(`SELECT location_id FROM wholesale_bin_assignments WHERE branch_id = $1 AND product_id = $2`, [order.branch_id, it.product_id])).rows[0];
      const pi = (await client.query(`INSERT INTO wholesale_pick_items (pick_id, order_item_id, product_id, location_id, qty_base) VALUES ($1,$2,$3,$4,$5) RETURNING pick_item_id`, [list.pick_id, it.item_id, it.product_id, bin?.location_id ?? null, qty])).rows[0];
      const t = tracked.get(it.product_id);
      if (t?.batch_tracking || t?.expiry_tracking) {
        const { allocations, unbatched } = await proposeBatches(client, { branchId: order.branch_id, productId: it.product_id, qty, fefo: settings.fefo, onDate });
        if (unbatched > 1e-9) throw new WholesaleError(409, `${(await client.query(`SELECT name FROM products WHERE product_id = $1`, [it.product_id])).rows[0].name}: only ${q3(qty - unbatched)} in sellable batches. Receive stock with a batch number, or adjust stock into a batch first.`);
        for (const a of allocations) await client.query(`INSERT INTO wholesale_pick_item_batches (pick_item_id, batch_id, qty_base) VALUES ($1,$2,$3)`, [pi.pick_item_id, a.batch_id, a.qty]);
      }
      await client.query(`UPDATE wholesale_sales_order_items SET picked_base = picked_base + $2 WHERE item_id = $1`, [it.item_id, qty]);
    }
    return list.pick_id;
  });
  const l = await loadList(pool, req.tenant.businessId, pickId);
  audit(req, 'wholesale.pick_list_created', 'pick_list', pickId, null, { number: l.pick_number, order: l.order_number });
  ok(res, await pickDetail(pool, req.tenant.businessId, l), 201);
};

/* GET /pick-lists?status=&order_id=&mine=1 */
const listPicks = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const values = [req.tenant.businessId]; const where = ['l.business_id = $1'];
  if (req.query.status) { values.push(String(req.query.status).split(',').map((s) => s.trim().toUpperCase())); where.push(`l.status = ANY($${values.length}::text[])`); }
  else if (req.query.all !== '1') where.push(`l.status NOT IN ('DISPATCHED','CANCELLED')`);
  if (req.query.order_id) { values.push(Number(req.query.order_id) || 0); where.push(`l.order_id = $${values.length}`); }
  if (req.query.mine === '1') { values.push(req.auth.userId); where.push(`l.picker_user_id = $${values.length}`); }
  if (req.tenant.pinned) { values.push(req.tenant.branchId); where.push(`l.branch_id = $${values.length}`); }
  if (req.query.q) { values.push(like(String(req.query.q).slice(0, 80))); where.push(`(l.pick_number ILIKE $${values.length} OR o.order_number ILIKE $${values.length} OR c.name ILIKE $${values.length})`); }
  const base = `FROM wholesale_pick_lists l JOIN wholesale_sales_orders o ON o.order_id = l.order_id JOIN customers c ON c.customer_id = o.customer_id JOIN branches b ON b.branch_id = l.branch_id WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(
    `SELECT l.*, o.order_number, c.name AS customer_name, b.name AS warehouse_name,
            (SELECT COUNT(*) FROM wholesale_pick_items pi WHERE pi.pick_id = l.pick_id) AS item_count, (SELECT COALESCE(SUM(qty_base), 0) FROM wholesale_pick_items pi WHERE pi.pick_id = l.pick_id) AS units
     ${base} ORDER BY l.pick_id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  page(res, rows.map(listShape), total, pg);
};

const visiblePick = async (req, id, opts) => {
  const l = await loadList(opts?.db || pool, req.tenant.businessId, id, opts);
  if (!l || (req.tenant.pinned && l.branch_id !== req.tenant.branchId)) throw new WholesaleError(404, 'Not found');
  return l;
};

const getPick = async (req, res) => ok(res, await pickDetail(pool, req.tenant.businessId, await visiblePick(req, req.params.id)));

const startPick = async (req, res) => {
  const l = await visiblePick(req, req.params.id);
  if (l.status !== 'PENDING') throw new WholesaleError(409, 'This pick list has already been started');
  await pool.query(`UPDATE wholesale_pick_lists SET status = 'PICKING', picker_user_id = COALESCE($2, picker_user_id, $3), picker_name = COALESCE($4, picker_name) WHERE pick_id = $1`,
    [l.pick_id, int(req.body?.picker_user_id, 'Picker', { min: 1 }), req.auth.userId, text(req.body?.picker_name, 'Picker', { max: 120 })]);
  audit(req, 'wholesale.pick_started', 'pick_list', l.pick_id, null, { number: l.pick_number });
  ok(res, await pickDetail(pool, req.tenant.businessId, await loadList(pool, req.tenant.businessId, l.pick_id)));
};

/** Serial numbers typed for a pick item: one per unit, all in stock here. */
const checkSerials = async (client, { businessId, branchId, productId, serials, qty }) => {
  const list = [...new Set((serials || []).map((s) => String(s).trim()).filter(Boolean))];
  if (list.length !== qty) throw new WholesaleError(400, `Enter ${qty} serial number${qty === 1 ? '' : 's'} (got ${list.length})`);
  const rows = (await client.query(`SELECT serial_no FROM wholesale_serials WHERE business_id = $1 AND product_id = $2 AND branch_id = $3 AND status = 'IN_STOCK' AND lower(serial_no) = ANY($4::text[])`, [businessId, productId, branchId, list.map((s) => s.toLowerCase())])).rows;
  if (rows.length !== list.length) throw new WholesaleError(400, 'One of those serial numbers is not in stock at this warehouse');
  return list;
};

/* POST /pick-lists/:id/pick { all?: true, items?: [{ pick_item_id, picked_base, serials?, batches?: [{ batch_id, qty_base }] }] } */
const recordPick = async (req, res) => {
  const b = req.body || {};
  await withTransaction(async (client) => {
    const l = await visiblePick(req, req.params.id, { db: client, lock: true });
    if (!['PENDING', 'PICKING'].includes(l.status)) throw new WholesaleError(409, 'This pick list is already picked');
    const items = (await client.query(`SELECT * FROM wholesale_pick_items WHERE pick_id = $1 ORDER BY pick_item_id FOR UPDATE`, [l.pick_id])).rows;
    const asked = new Map((Array.isArray(b.items) ? b.items : []).map((x) => [Number(x.pick_item_id), x]));
    if (!b.all && !asked.size) throw new WholesaleError(400, 'Say what was picked');
    await lockProducts(client, req.tenant.businessId, items.map((i) => i.product_id));
    const tracked = await batchTracked(client, req.tenant.businessId, items.map((i) => i.product_id));
    let total = 0;
    for (const pi of items) {
      const x = asked.get(pi.pick_item_id);
      const picked = b.all && !x ? Number(pi.qty_base) : num(x?.picked_base ?? 0, 'Picked quantity', { min: 0, max: Number(pi.qty_base) });
      if (picked > Number(pi.qty_base) + 1e-9) throw new WholesaleError(400, 'You cannot pick more than the list asks for');
      let serials = null;
      if (tracked.get(pi.product_id)?.serial_tracking && picked > 0) {
        if (!Number.isInteger(picked)) throw new WholesaleError(400, 'Serial-tracked goods are picked in whole units');
        serials = (await checkSerials(client, { businessId: req.tenant.businessId, branchId: l.branch_id, productId: pi.product_id, serials: x?.serials, qty: picked })).join('\n');
      }
      if (picked < Number(pi.qty_base) - 1e-9) {
        // short pick: the difference is free to be picked again; trim the batch plan from the back
        await client.query(`UPDATE wholesale_sales_order_items SET picked_base = GREATEST(0, picked_base - $2) WHERE item_id = $1`, [pi.order_item_id, q3(Number(pi.qty_base) - picked)]);
      }
      const bat = (await client.query(`SELECT * FROM wholesale_pick_item_batches WHERE pick_item_id = $1 ORDER BY batch_id DESC`, [pi.pick_item_id])).rows;
      if (Array.isArray(x?.batches) && x.batches.length) {
        const sum = q3(x.batches.reduce((s, y) => s + Number(y.qty_base), 0));
        if (Math.abs(sum - picked) > 1e-9) throw new WholesaleError(400, 'The batch quantities must add up to what was picked');
        const owned = (await client.query(`SELECT batch_id FROM wholesale_batches WHERE business_id = $1 AND branch_id = $2 AND product_id = $3 AND batch_id = ANY($4::bigint[])`, [req.tenant.businessId, l.branch_id, pi.product_id, x.batches.map((y) => Number(y.batch_id))])).rows;
        if (owned.length !== new Set(x.batches.map((y) => Number(y.batch_id))).size) throw new WholesaleError(400, 'One of those batches is not at this warehouse');
        await client.query(`DELETE FROM wholesale_pick_item_batches WHERE pick_item_id = $1`, [pi.pick_item_id]);
        for (const y of x.batches) await client.query(`INSERT INTO wholesale_pick_item_batches (pick_item_id, batch_id, qty_base) VALUES ($1,$2,$3) ON CONFLICT (pick_item_id, batch_id) DO UPDATE SET qty_base = wholesale_pick_item_batches.qty_base + EXCLUDED.qty_base`, [pi.pick_item_id, Number(y.batch_id), q3(Number(y.qty_base))]);
      } else if (bat.length && picked < Number(pi.qty_base) - 1e-9) {
        let cut = q3(Number(pi.qty_base) - picked);
        for (const r of bat) {
          if (cut <= 0) break;
          const take = Math.min(cut, Number(r.qty_base)); cut = q3(cut - take);
          if (take >= Number(r.qty_base) - 1e-9) await client.query(`DELETE FROM wholesale_pick_item_batches WHERE pick_item_id = $1 AND batch_id = $2`, [pi.pick_item_id, r.batch_id]);
          else await client.query(`UPDATE wholesale_pick_item_batches SET qty_base = qty_base - $3 WHERE pick_item_id = $1 AND batch_id = $2`, [pi.pick_item_id, r.batch_id, take]);
        }
      }
      await client.query(`UPDATE wholesale_pick_items SET picked_base = $2, serials = $3 WHERE pick_item_id = $1`, [pi.pick_item_id, picked, serials]);
      total += picked;
    }
    if (total <= 0) throw new WholesaleError(409, 'Nothing was picked. Cancel the pick list instead.');
    await client.query(`UPDATE wholesale_pick_lists SET status = 'PICKED', picked_at = CURRENT_TIMESTAMP, picker_user_id = COALESCE(picker_user_id, $2) WHERE pick_id = $1`, [l.pick_id, req.auth.userId]);
  });
  audit(req, 'wholesale.pick_completed', 'pick_list', Number(req.params.id));
  ok(res, await pickDetail(pool, req.tenant.businessId, await loadList(pool, req.tenant.businessId, req.params.id)));
};

/* POST /pick-lists/:id/pack { packages?: [{ package_no?, weight_kg?, length_cm?, width_cm?, height_cm?, notes?, items: [{ pick_item_id, qty_base }] }] } */
const pack = async (req, res) => {
  const b = req.body || {};
  await withTransaction(async (client) => {
    const l = await visiblePick(req, req.params.id, { db: client, lock: true });
    if (!['PICKED', 'PACKING', 'PACKED'].includes(l.status)) throw new WholesaleError(409, 'Pick the goods before packing them');
    const items = (await client.query(`SELECT pick_item_id, picked_base FROM wholesale_pick_items WHERE pick_id = $1 AND picked_base > 0`, [l.pick_id])).rows;
    let packages = Array.isArray(b.packages) && b.packages.length ? b.packages : [{ items: items.map((i) => ({ pick_item_id: i.pick_item_id, qty_base: Number(i.picked_base) })) }];
    if (packages.length > 100) throw new WholesaleError(400, 'That is too many packages');
    const packed = new Map(items.map((i) => [i.pick_item_id, 0]));
    for (const k of packages) for (const x of k.items || []) {
      if (!packed.has(Number(x.pick_item_id))) throw new WholesaleError(400, 'A package holds something that was not picked');
      packed.set(Number(x.pick_item_id), q3(packed.get(Number(x.pick_item_id)) + num(x.qty_base, 'Package quantity', { min: 0.001, required: true })));
    }
    for (const i of items) if (Math.abs(packed.get(i.pick_item_id) - Number(i.picked_base)) > 1e-9) throw new WholesaleError(400, 'Every picked item has to be placed in a package, in full');
    await client.query(`DELETE FROM wholesale_packages WHERE pick_id = $1`, [l.pick_id]);
    let n = 0;
    for (const k of packages) {
      n += 1;
      const row = (await client.query(
        `INSERT INTO wholesale_packages (business_id, pick_id, package_no, weight_kg, length_cm, width_cm, height_cm, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING package_id`,
        [req.tenant.businessId, l.pick_id, text(k.package_no, 'Package number', { max: 40 }) || `${l.pick_number}/${n}`, num(k.weight_kg, 'Weight', { min: 0, max: 100000 }), num(k.length_cm, 'Length', { min: 0 }), num(k.width_cm, 'Width', { min: 0 }), num(k.height_cm, 'Height', { min: 0 }), text(k.notes, 'Notes', { max: 200 })])).rows[0];
      for (const x of k.items || []) await client.query(`INSERT INTO wholesale_package_items (package_id, pick_item_id, qty_base) VALUES ($1,$2,$3) ON CONFLICT (package_id, pick_item_id) DO UPDATE SET qty_base = wholesale_package_items.qty_base + EXCLUDED.qty_base`, [row.package_id, Number(x.pick_item_id), q3(Number(x.qty_base))]);
    }
    await client.query(`UPDATE wholesale_pick_lists SET status = 'PACKED', packed_at = CURRENT_TIMESTAMP WHERE pick_id = $1`, [l.pick_id]);
    await refreshStatus(client, l.order_id);
  });
  audit(req, 'wholesale.packed', 'pick_list', Number(req.params.id));
  ok(res, await pickDetail(pool, req.tenant.businessId, await loadList(pool, req.tenant.businessId, req.params.id)));
};

/* POST /pick-lists/:id/cancel */
const cancelPick = async (req, res) => {
  await withTransaction(async (client) => {
    const l = await visiblePick(req, req.params.id, { db: client, lock: true });
    if (['DISPATCHED', 'CANCELLED'].includes(l.status)) throw new WholesaleError(409, `This pick list is already ${l.status.toLowerCase()}`);
    const items = (await client.query(`SELECT * FROM wholesale_pick_items WHERE pick_id = $1`, [l.pick_id])).rows;
    for (const pi of items) await client.query(`UPDATE wholesale_sales_order_items SET picked_base = GREATEST(shipped_base, picked_base - $2) WHERE item_id = $1`, [pi.order_item_id, held(l, pi)]);
    await client.query(`UPDATE wholesale_pick_lists SET status = 'CANCELLED' WHERE pick_id = $1`, [l.pick_id]);
    await refreshStatus(client, l.order_id);
  });
  audit(req, 'wholesale.pick_cancelled', 'pick_list', Number(req.params.id));
  ok(res, await pickDetail(pool, req.tenant.businessId, await loadList(pool, req.tenant.businessId, req.params.id)));
};

/* ── dispatch: challan + invoice ──────────────────────────────────────────────────────────── */

/*
 * POST /pick-lists/:id/dispatch
 * { driver_name?, driver_phone?, driver_user_id?, vehicle_no?, delivery_address?, expected_date?, notes?,
 *   invoice_kind?: 'TAX'|'CASH'|'CREDIT', payment?: { amount, method, reference_number }, payment_terms_days? }
 */
const dispatch = async (req, res) => {
  const b = req.body || {};
  const kind = oneOf(b.invoice_kind, 'Invoice type', ['TAX', 'CASH', 'CREDIT'], { fallback: 'TAX' });
  const out = await withTransaction(async (client) => {
    const l = await visiblePick(req, req.params.id, { db: client, lock: true });
    if (!['PICKED', 'PACKING', 'PACKED'].includes(l.status)) throw new WholesaleError(409, l.status === 'DISPATCHED' ? 'This pick list has already been dispatched' : 'Pick and pack the goods before dispatching them');
    const order = (await client.query(`SELECT * FROM wholesale_sales_orders WHERE order_id = $1 FOR UPDATE`, [l.order_id])).rows[0];
    if (!['CONFIRMED', 'PARTIALLY_FULFILLED', 'PACKED'].includes(order.status)) throw new WholesaleError(409, 'This order can no longer be shipped');
    const picks = (await client.query(
      `SELECT pi.*, oi.unit_name, oi.unit_factor, oi.price_paise, oi.discount_pct, oi.tax_rate, oi.quantity AS ordered_qty, oi.base_qty AS ordered_base, p.name, p.unit AS base_unit
       FROM wholesale_pick_items pi JOIN wholesale_sales_order_items oi ON oi.item_id = pi.order_item_id JOIN products p ON p.product_id = pi.product_id
       WHERE pi.pick_id = $1 AND pi.picked_base > 0 ORDER BY oi.line_no FOR UPDATE OF pi, oi`, [l.pick_id])).rows;
    if (!picks.length) throw new WholesaleError(409, 'There is nothing in this pick list to ship');
    await lockProducts(client, req.tenant.businessId, picks.map((p) => p.product_id));

    const isOnlyOrNot = (await client.query(`SELECT COUNT(*) AS n FROM wholesale_invoice_meta WHERE order_id = $1`, [order.order_id])).rows[0];
    const firstShipment = Number(isOnlyOrNot.n) === 0;
    const items = []; let shipGross = 0;
    for (const p of picks) {
      const factor = Number(p.unit_factor); const base = Number(p.picked_base);
      const whole = Math.abs(base / factor - Math.round(base / factor)) < 1e-9 || Number.isInteger(Number((base / factor).toFixed(3)));
      const qty = whole ? q3(base / factor) : base;
      const unitPricePaise = whole ? Number(p.price_paise) : Number(p.price_paise) / factor;
      const gross = Math.round(qty * unitPricePaise);
      shipGross += gross;
      items.push({
        product_id: p.product_id, quantity: qty, unit_name: whole ? p.unit_name : p.base_unit, unit_factor: whole ? factor : 1,
        unit_price: Math.round(unitPricePaise * 100) / 10000, discount: toRupees(Math.round(gross * Number(p.discount_pct) / 100))
      });
    }
    if (firstShipment && Number(order.shipping_charge_paise) > 0) items.push({ description: 'Shipping / freight', quantity: 1, unit_price: toRupees(order.shipping_charge_paise), tax_rate: Number(order.shipping_tax_rate) });
    // the order-level discount follows the goods: pro rata to what ships, the last shipment takes the remainder
    const orderGross = Number((await client.query(`SELECT COALESCE(SUM(ROUND(quantity * price_paise)), 0) AS g FROM wholesale_sales_order_items WHERE order_id = $1`, [order.order_id])).rows[0].g);
    const openAfter = Number((await client.query(`SELECT COALESCE(SUM(base_qty - shipped_base - cancelled_base), 0) AS o FROM wholesale_sales_order_items WHERE order_id = $1`, [order.order_id])).rows[0].o) - picks.reduce((s, p) => s + Number(p.picked_base), 0);
    let discountPaise = 0;
    if (Number(order.discount_paise) > 0 && orderGross > 0) {
      const earlier = Number((await client.query(`SELECT COALESCE(SUM(i.discount_paise), 0) AS d FROM invoices i JOIN wholesale_invoice_meta m ON m.invoice_id = i.invoice_id WHERE m.order_id = $1`, [order.order_id])).rows[0].d);
      discountPaise = openAfter <= 1e-9 ? Math.max(0, Number(order.discount_paise) - earlier) : Math.min(Number(order.discount_paise) - earlier, Math.round(Number(order.discount_paise) * shipGross / orderGross));
    }
    const settings = await getSettings(client, req.tenant.businessId);
    const date = await today(client, req.tenant.businessId);
    const terms = b.payment_terms_days != null ? int(b.payment_terms_days, 'Payment terms', { min: 0, max: 365 }) : Number(order.payment_terms_days);
    const tenant = { ...req.tenant, branchId: order.branch_id };
    const invoice = await createInvoiceInTransaction(client, tenant, req.auth.userId, {
      customerId: order.customer_id, items, discount: toRupees(discountPaise), notes: `Order ${order.order_number}${order.customer_po ? ` · PO ${order.customer_po}` : ''}`,
      invoiceDate: date, allowNegativeStock: true, ...(b.payment?.amount != null ? { payment: b.payment } : {})
    });

    // batches leave, serials are sold, the reservation is released, the order line records what shipped
    for (const p of picks) {
      const bat = (await client.query(`SELECT batch_id, qty_base FROM wholesale_pick_item_batches WHERE pick_item_id = $1`, [p.pick_item_id])).rows;
      if (bat.length) await consumeBatches(client, { businessId: req.tenant.businessId, allocations: bat.map((x) => ({ batch_id: Number(x.batch_id), qty: Number(x.qty_base) })), refType: 'invoice', refId: invoice.invoice_id });
      if (p.serials) await client.query(`UPDATE wholesale_serials SET status = 'SOLD', ref_type = 'invoice', ref_id = $4 WHERE business_id = $1 AND product_id = $2 AND lower(serial_no) = ANY($3::text[])`, [req.tenant.businessId, p.product_id, p.serials.split('\n').map((s) => s.toLowerCase()), invoice.invoice_id]);
      const sent = Number(p.picked_base);
      await release(client, { branchId: order.branch_id, productId: p.product_id, qty: sent });
      await client.query(`UPDATE wholesale_sales_order_items SET shipped_base = shipped_base + $2, reserved_base = GREATEST(0, reserved_base - $2) WHERE item_id = $1`, [p.order_item_id, sent]);
    }
    const challan = await nextNumber(client, req.tenant.businessId, 'CH', 'CH');
    const driverUser = int(b.driver_user_id, 'Driver', { min: 1 });
    const delivery = (await client.query(
      `INSERT INTO wholesale_deliveries (business_id, branch_id, order_id, pick_id, invoice_id, challan_number, status, driver_name, driver_phone, driver_user_id, vehicle_no, delivery_address,
                                        dispatch_date, expected_date, packages_count, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,(SELECT COUNT(*) FROM wholesale_packages WHERE pick_id = $4),$15,$16) RETURNING *`,
      [req.tenant.businessId, order.branch_id, order.order_id, l.pick_id, invoice.invoice_id, challan, (b.driver_name || driverUser) ? 'ASSIGNED' : 'PENDING', text(b.driver_name, 'Driver', { max: 120 }), text(b.driver_phone, 'Driver phone', { max: 32 }), driverUser,
        text(b.vehicle_no, 'Vehicle number', { max: 20 })?.toUpperCase() ?? null, text(b.delivery_address, 'Delivery address', { max: 400 }) || order.shipping_address, date, isoDate(b.expected_date, 'Expected date') || order.expected_delivery, text(b.notes, 'Notes', { max: 300 }), req.auth.userId])).rows[0];
    await client.query(
      `INSERT INTO wholesale_invoice_meta (invoice_id, business_id, order_id, delivery_id, salesperson_id, kind, payment_terms_days, due_date, shipping_charge_paise, shipping_address, customer_po)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [invoice.invoice_id, req.tenant.businessId, order.order_id, delivery.delivery_id, order.salesperson_id, kind, terms, addDays(date, terms), firstShipment ? order.shipping_charge_paise : 0, delivery.delivery_address, order.customer_po]);
    await client.query(`UPDATE wholesale_pick_lists SET status = 'DISPATCHED', dispatched_at = CURRENT_TIMESTAMP WHERE pick_id = $1`, [l.pick_id]);
    const status = await refreshStatus(client, order.order_id);
    return { invoice, delivery, order, status, settings };
  });
  recordInvoiceCreated(req, out.invoice);
  audit(req, 'wholesale.dispatched', 'delivery', out.delivery.delivery_id, null, { challan: out.delivery.challan_number, order: out.order.order_number, invoice: out.invoice.invoice_number, total: out.invoice.total });
  notify(req, 'order_dispatched', { customerId: out.order.customer_id, invoiceId: out.invoice.invoice_id, values: { order: out.order.order_number, invoice: out.invoice.invoice_number, vehicle: out.delivery.vehicle_no || '' } });
  notify(req, 'invoice_issued', { customerId: out.order.customer_id, invoiceId: out.invoice.invoice_id, values: { number: out.invoice.invoice_number, total: Math.round(out.invoice.total * 100), due: day(addDays(out.delivery.dispatch_date instanceof Date ? out.delivery.dispatch_date.toISOString().slice(0, 10) : String(out.delivery.dispatch_date).slice(0, 10), Number(out.order.payment_terms_days))) } });
  ok(res, { delivery_id: out.delivery.delivery_id, challan_number: out.delivery.challan_number, invoice_id: out.invoice.invoice_id, invoice_number: out.invoice.invoice_number, invoice_total: out.invoice.total, order_status: out.status }, 201);
};

/* ── deliveries ───────────────────────────────────────────────────────────────────────────── */

const DELIVERY_STATUSES = ['PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURNED'];
const NEXT = { PENDING: ['ASSIGNED', 'OUT_FOR_DELIVERY'], ASSIGNED: ['OUT_FOR_DELIVERY', 'FAILED'], OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'], FAILED: ['OUT_FOR_DELIVERY', 'RETURNED'], DELIVERED: [], RETURNED: [] };

const deliveryShape = (d) => ({
  delivery_id: d.delivery_id, challan_number: d.challan_number, status: d.status, order_id: d.order_id, order_number: d.order_number, customer_id: d.customer_id, customer: d.customer_name,
  invoice_id: d.invoice_id, invoice_number: d.invoice_number, invoice_total: d.invoice_total == null ? null : rupees(d.invoice_total), driver_name: d.driver_name, driver_phone: d.driver_phone, driver_user_id: d.driver_user_id,
  vehicle_no: d.vehicle_no, delivery_address: d.delivery_address, dispatch_date: d.dispatch_date, expected_date: d.expected_date, delivered_at: d.delivered_at, packages_count: d.packages_count,
  notes: d.notes, pod_received_by: d.pod_received_by, pod_note: d.pod_note, has_pod_image: Boolean(d.pod_image_url), failure_reason: d.failure_reason, branch_id: d.branch_id, warehouse: d.warehouse_name
});

const DELIVERY_FROM = `
  FROM wholesale_deliveries d JOIN wholesale_sales_orders o ON o.order_id = d.order_id JOIN customers c ON c.customer_id = o.customer_id JOIN branches b ON b.branch_id = d.branch_id
  LEFT JOIN invoices i ON i.invoice_id = d.invoice_id`;
const DELIVERY_COLS = `d.*, o.order_number, o.customer_id, c.name AS customer_name, b.name AS warehouse_name, i.invoice_number, i.total_paise AS invoice_total`;

/** A delivery person sees only the runs assigned to them. */
const driverScope = (req, values, where) => {
  if (req.tenant.role === 'DELIVERY') { values.push(req.auth.userId); where.push(`d.driver_user_id = $${values.length}`); }
};

/* GET /deliveries?status=&from=&to=&driver_user_id=&q= */
const listDeliveries = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const values = [req.tenant.businessId]; const where = ['d.business_id = $1'];
  if (req.query.status) {
    const wanted = String(req.query.status).split(',').map((s) => s.trim().toUpperCase());
    if (wanted.some((s) => !DELIVERY_STATUSES.includes(s))) throw new WholesaleError(400, 'Unknown status');
    values.push(wanted); where.push(`d.status = ANY($${values.length}::text[])`);
  } else if (req.query.open === '1') where.push(`d.status IN ('PENDING','ASSIGNED','OUT_FOR_DELIVERY','FAILED')`);
  const from = isoDate(req.query.from, 'From'); const to = isoDate(req.query.to, 'To');
  if (from) { values.push(from); where.push(`d.dispatch_date >= $${values.length}`); }
  if (to) { values.push(to); where.push(`d.dispatch_date <= $${values.length}`); }
  if (req.query.driver_user_id) { values.push(Number(req.query.driver_user_id) || 0); where.push(`d.driver_user_id = $${values.length}`); }
  if (req.query.q) { values.push(like(String(req.query.q).slice(0, 80))); where.push(`(d.challan_number ILIKE $${values.length} OR o.order_number ILIKE $${values.length} OR c.name ILIKE $${values.length} OR d.vehicle_no ILIKE $${values.length})`); }
  if (req.tenant.pinned) { values.push(req.tenant.branchId); where.push(`d.branch_id = $${values.length}`); }
  driverScope(req, values, where);
  const base = `${DELIVERY_FROM} WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(`SELECT ${DELIVERY_COLS} ${base} ORDER BY d.delivery_id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  page(res, rows.map(deliveryShape), total, pg);
};

const loadDelivery = async (req, id, { db = pool, lock = false } = {}) => {
  if (!Number.isInteger(Number(id))) throw new WholesaleError(404, 'Not found');
  const values = [req.tenant.businessId, id]; const where = ['d.business_id = $1', 'd.delivery_id = $2'];
  if (req.tenant.pinned) { values.push(req.tenant.branchId); where.push(`d.branch_id = $${values.length}`); }
  driverScope(req, values, where);
  const d = (await db.query(`SELECT ${DELIVERY_COLS} ${DELIVERY_FROM} WHERE ${where.join(' AND ')} ${lock ? 'FOR UPDATE OF d' : ''}`, values)).rows[0];
  if (!d) throw new WholesaleError(404, 'Not found');
  return d;
};

const getDelivery = async (req, res) => {
  const d = await loadDelivery(req, req.params.id);
  ok(res, { ...deliveryShape(d), pod_image_url: d.pod_image_url || null });
};

/* PUT /deliveries/:id — driver, vehicle, address, dates (before it is delivered) */
const updateDelivery = async (req, res) => {
  const b = req.body || {};
  const d = await loadDelivery(req, req.params.id);
  if (['DELIVERED', 'RETURNED'].includes(d.status)) throw new WholesaleError(409, `A ${d.status.toLowerCase()} delivery cannot be changed`);
  const f = {};
  if ('driver_name' in b) f.driver_name = text(b.driver_name, 'Driver', { max: 120 });
  if ('driver_phone' in b) f.driver_phone = text(b.driver_phone, 'Driver phone', { max: 32 });
  if ('driver_user_id' in b) f.driver_user_id = int(b.driver_user_id, 'Driver', { min: 1 });
  if ('vehicle_no' in b) f.vehicle_no = text(b.vehicle_no, 'Vehicle number', { max: 20 })?.toUpperCase() ?? null;
  if ('delivery_address' in b) f.delivery_address = text(b.delivery_address, 'Address', { max: 400 });
  if ('expected_date' in b) f.expected_date = isoDate(b.expected_date, 'Expected date');
  if ('notes' in b) f.notes = text(b.notes, 'Notes', { max: 300 });
  if (f.driver_user_id && !(await pool.query(`SELECT 1 FROM business_users WHERE business_id = $1 AND user_id = $2 AND status = 'ACTIVE'`, [req.tenant.businessId, f.driver_user_id])).rowCount) throw new WholesaleError(400, 'That driver is not on your team');
  const keys = Object.keys(f); if (!keys.length) throw new WholesaleError(400, 'Nothing to update');
  if (d.status === 'PENDING' && (f.driver_name || f.driver_user_id)) { f.status = 'ASSIGNED'; keys.push('status'); }
  await pool.query(`UPDATE wholesale_deliveries SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE delivery_id = $1`, [d.delivery_id, ...keys.map((k) => f[k])]);
  audit(req, 'wholesale.delivery_updated', 'delivery', d.delivery_id, null, null, { challan: d.challan_number, changes: f });
  ok(res, deliveryShape(await loadDelivery(req, d.delivery_id)));
};

/* POST /deliveries/:id/status { status, pod_received_by?, pod_note?, pod_image_url?, failure_reason? } */
const setDeliveryStatus = async (req, res) => {
  const b = req.body || {};
  const to = oneOf(b.status, 'Status', DELIVERY_STATUSES, { required: true });
  const result = await withTransaction(async (client) => {
    const d = await loadDelivery(req, req.params.id, { db: client, lock: true });
    if (!NEXT[d.status].includes(to)) throw new WholesaleError(409, `A ${d.status.toLowerCase().replace(/_/g, ' ')} delivery cannot become ${to.toLowerCase().replace(/_/g, ' ')}`);
    const f = { status: to };
    if (to === 'DELIVERED') {
      f.delivered_at = new Date();
      f.pod_received_by = text(b.pod_received_by, 'Received by', { max: 120, required: true });
      f.pod_note = text(b.pod_note, 'Note', { max: 300 });
      const img = text(b.pod_image_url, 'Photo', { max: 2000000 });
      if (img && !/^(https:\/\/|data:image\/(png|jpe?g|webp);base64,)/i.test(img)) throw new WholesaleError(400, 'The proof photo has to be an image');
      f.pod_image_url = img;
    }
    if (to === 'FAILED') f.failure_reason = text(b.failure_reason, 'Reason', { max: 200, required: true, min: 3 });
    if (to === 'RETURNED') f.failure_reason = text(b.failure_reason, 'Reason', { max: 200, required: true, min: 3 }) || d.failure_reason;
    const keys = Object.keys(f);
    await client.query(`UPDATE wholesale_deliveries SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE delivery_id = $1`, [d.delivery_id, ...keys.map((k) => f[k])]);
    const status = await refreshStatus(client, d.order_id);
    return { d, status };
  });
  audit(req, 'wholesale.delivery_status', 'delivery', result.d.delivery_id, { status: result.d.status }, { status: to }, { challan: result.d.challan_number });
  ok(res, { ...deliveryShape(await loadDelivery(req, result.d.delivery_id)), order_status: result.status, ...(to === 'RETURNED' ? { hint: 'Record a sales return against the invoice to take the goods back into stock and credit the customer.' } : {}) });
};

/* GET /deliveries/:id/challan — everything the printed delivery challan shows */
const challan = async (req, res) => {
  const d = await loadDelivery(req, req.params.id);
  const business = (await pool.query(`SELECT b.name, b.gstin, b.address, b.phone, b.state FROM businesses b WHERE b.business_id = $1`, [req.tenant.businessId])).rows[0];
  const warehouse = (await pool.query(`SELECT name, address, city, state, gstin, phone FROM branches WHERE branch_id = $1`, [d.branch_id])).rows[0];
  const customer = (await pool.query(`SELECT c.name, c.phone, c.gstin, c.address, c.state FROM customers c JOIN wholesale_sales_orders o ON o.customer_id = c.customer_id WHERE o.order_id = $1`, [d.order_id])).rows[0];
  const lines = d.invoice_id ? (await pool.query(
    `SELECT ii.description, ii.quantity, ii.unit_name, ii.unit_factor, p.hsn_sac,
            (SELECT string_agg(b.batch_no || COALESCE(' (exp ' || to_char(b.expiry_date, 'DD Mon YYYY') || ')', ''), ', ') FROM wholesale_batch_moves m JOIN wholesale_batches b ON b.batch_id = m.batch_id
              WHERE m.ref_type = 'invoice' AND m.ref_id = ii.invoice_id AND b.product_id = ii.product_id) AS batches
     FROM invoice_items ii LEFT JOIN products p ON p.product_id = ii.product_id WHERE ii.invoice_id = $1 AND ii.product_id IS NOT NULL ORDER BY ii.item_id`, [d.invoice_id])).rows : [];
  const packages = d.pick_id ? (await pool.query(`SELECT package_no, weight_kg FROM wholesale_packages WHERE pick_id = $1 ORDER BY package_id`, [d.pick_id])).rows : [];
  ok(res, {
    challan_number: d.challan_number, date: d.dispatch_date, order_number: d.order_number, invoice_number: d.invoice_number, business, warehouse, customer, delivery_address: d.delivery_address,
    driver_name: d.driver_name, driver_phone: d.driver_phone, vehicle_no: d.vehicle_no, status: d.status,
    lines: lines.map((x) => ({ description: x.description, quantity: Number(x.quantity), unit: x.unit_name, hsn_sac: x.hsn_sac, batches: x.batches })),
    packages: packages.map((k) => ({ package_no: k.package_no, weight_kg: k.weight_kg == null ? null : Number(k.weight_kg) })), total_weight_kg: packages.reduce((s, k) => s + Number(k.weight_kg || 0), 0)
  });
};

/* GET /fulfilment/summary — the warehouse board's counts */
const summary = async (req, res) => {
  const values = [req.tenant.businessId]; let scope = '';
  if (req.tenant.pinned) { values.push(req.tenant.branchId); scope = ' AND branch_id = $2'; }
  const toPick = Number((await pool.query(
    `SELECT COUNT(*) AS n FROM wholesale_sales_orders o WHERE o.business_id = $1 AND o.status IN ('CONFIRMED','PARTIALLY_FULFILLED') ${scope.replace('branch_id', 'o.branch_id')}
       AND EXISTS (SELECT 1 FROM wholesale_sales_order_items i WHERE i.order_id = o.order_id AND i.reserved_base - (i.picked_base - i.shipped_base) > 0.0005)`, values)).rows[0].n);
  const lists = (await pool.query(`SELECT status, COUNT(*) AS n FROM wholesale_pick_lists WHERE business_id = $1 AND status NOT IN ('DISPATCHED','CANCELLED') ${scope} GROUP BY status`, values)).rows;
  const deliveries = (await pool.query(`SELECT status, COUNT(*) AS n FROM wholesale_deliveries WHERE business_id = $1 AND status IN ('PENDING','ASSIGNED','OUT_FOR_DELIVERY','FAILED') ${scope} GROUP BY status`, values)).rows;
  ok(res, { orders_to_pick: toPick, pick_lists: Object.fromEntries(lists.map((r) => [r.status, Number(r.n)])), deliveries: Object.fromEntries(deliveries.map((r) => [r.status, Number(r.n)])) });
};

export default wrapAll({ createPick, listPicks, getPick, startPick, recordPick, pack, cancelPick, dispatch, listDeliveries, getDelivery, updateDelivery, setDeliveryStatus, challan, summary });
