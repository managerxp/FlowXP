/*
 * Wholesale warehouses and inventory: warehouses (outlets) and their bins, stock levels with reserved / available /
 * expired / damaged / in-transit, batches and expiry, stock adjustments, and warehouse-to-warehouse transfers with an
 * in-transit stage.
 *
 * On hand lives in branch_stock (the one ledger every FlowXP screen reads, moved only by moveStock). Reserved is what
 * confirmed orders hold. Expired stock is on hand but cannot be sold or reserved. Damaged goods are not in
 * branch_stock — they sit in a signed log until returned to the supplier or written off.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { stockAlertCounts } from '../modules/wholesale/alerts.js';
import {
  addToBatch, allocateBatches, availability, batchTracked, consumeBatches, expiredQty, lockProducts, logDamaged, returnToBatch, stockIn, stockOut
} from '../modules/wholesale/stock.js';
import { loadUnits, toBase, unitFor } from '../modules/wholesale/units.js';
import {
  WholesaleError, addDays, audit, bool, getSettings, int, isoDate, like, nextNumber, num, ok, oneOf, page, paging, phone, q3, text, today, withTransaction, wrapAll
} from '../modules/wholesale/common.js';

const rupees = (v) => toRupees(Number(v || 0));

/** The warehouses this person may look at, optionally narrowed to one. */
const scopeBranches = async (req, requested = null) => {
  const { rows } = await pool.query(`SELECT branch_id FROM branches WHERE business_id = $1 AND status = 'ACTIVE' ORDER BY branch_id`, [req.tenant.businessId]);
  let ids = rows.map((r) => r.branch_id);
  if (req.tenant.pinned) ids = ids.filter((id) => id === req.tenant.branchId);
  if (requested) {
    const id = Number(requested);
    if (!ids.includes(id)) throw new WholesaleError(404, 'Warehouse not found');
    return [id];
  }
  return ids;
};

const ownBranch = async (req, id) => {
  if (id == null || id === '') throw new WholesaleError(400, 'Choose a warehouse first', { code: 'OUTLET_REQUIRED' });
  const ids = await scopeBranches(req, id);
  return ids[0];
};

/* ═══ warehouses and bins ═════════════════════════════════════════════════════════════════════ */

const listWarehouses = async (req, res) => {
  const ids = await scopeBranches(req);
  const rows = (await pool.query(
    `SELECT b.branch_id, b.name, b.code, b.address, b.city, b.state, b.pincode, b.gstin, b.is_primary, w.manager_name, w.manager_user_id, w.phone, COALESCE(w.is_dispatch, TRUE) AS is_dispatch, w.notes,
            COALESCE(s.skus, 0) AS skus, COALESCE(s.units, 0) AS units, COALESCE(s.reserved, 0) AS reserved, COALESCE(s.value, 0) AS value,
            (SELECT COUNT(*) FROM wholesale_locations l WHERE l.branch_id = b.branch_id AND l.status = 'ACTIVE') AS locations,
            COALESCE((SELECT SUM(ti.qty_base - ti.received_base - ti.damaged_base) FROM wholesale_transfer_items ti JOIN wholesale_transfers t ON t.transfer_id = ti.transfer_id WHERE t.to_branch_id = b.branch_id AND t.status = 'IN_TRANSIT'), 0) AS incoming
     FROM branches b LEFT JOIN wholesale_warehouses w ON w.branch_id = b.branch_id
     LEFT JOIN (SELECT bs.branch_id, COUNT(*) FILTER (WHERE bs.quantity > 0) AS skus, SUM(bs.quantity) AS units, SUM(bs.reserved_qty) AS reserved, SUM(bs.quantity * p.purchase_price_paise) AS value
                FROM branch_stock bs JOIN products p ON p.product_id = bs.product_id GROUP BY bs.branch_id) s ON s.branch_id = b.branch_id
     WHERE b.business_id = $1 AND b.branch_id = ANY($2::int[]) ORDER BY b.is_primary DESC, b.name`, [req.tenant.businessId, ids])).rows;
  ok(res, rows.map((r) => ({ ...r, skus: Number(r.skus), units: Number(r.units), reserved: Number(r.reserved), value: rupees(r.value), locations: Number(r.locations), incoming: Number(r.incoming) })));
};

const updateWarehouse = async (req, res) => {
  const id = await ownBranch(req, req.params.id);
  const b = req.body || {};
  const f = {};
  if ('manager_name' in b) f.manager_name = text(b.manager_name, 'Manager', { max: 120 });
  if ('manager_user_id' in b) f.manager_user_id = int(b.manager_user_id, 'Manager login', { min: 1 });
  if ('phone' in b) { phone(b.phone); f.phone = text(b.phone, 'Phone', { max: 32 }); }
  if ('is_dispatch' in b) f.is_dispatch = bool(b.is_dispatch);
  if ('notes' in b) f.notes = text(b.notes, 'Notes', { max: 300 });
  if (f.manager_user_id && !(await pool.query(`SELECT 1 FROM business_users WHERE business_id = $1 AND user_id = $2`, [req.tenant.businessId, f.manager_user_id])).rowCount) throw new WholesaleError(400, 'That login is not on your team');
  const keys = Object.keys(f); if (!keys.length) throw new WholesaleError(400, 'Nothing to update');
  await pool.query(
    `INSERT INTO wholesale_warehouses (branch_id, business_id, ${keys.join(', ')}) VALUES ($1,$2,${keys.map((_, i) => `$${i + 3}`).join(',')}) ON CONFLICT (branch_id) DO UPDATE SET ${keys.map((k) => `${k} = EXCLUDED.${k}`).join(', ')}`,
    [id, req.tenant.businessId, ...keys.map((k) => f[k])]);
  audit(req, 'wholesale.warehouse_updated', 'warehouse', id, null, f);
  ok(res, { branch_id: id, ...f });
};

const listLocations = async (req, res) => {
  const id = await ownBranch(req, req.params.id);
  const rows = (await pool.query(
    `SELECT l.location_id, l.code, l.description, l.status, (SELECT COUNT(*) FROM wholesale_bin_assignments a WHERE a.location_id = l.location_id) AS products
     FROM wholesale_locations l WHERE l.branch_id = $1 ORDER BY l.code`, [id])).rows;
  ok(res, rows.map((r) => ({ ...r, products: Number(r.products) })));
};

const createLocation = async (req, res) => {
  const id = await ownBranch(req, req.params.id);
  const code = text(req.body?.code, 'Location code', { max: 24, required: true });
  try {
    const row = (await pool.query(`INSERT INTO wholesale_locations (business_id, branch_id, code, description) VALUES ($1,$2,$3,$4) RETURNING location_id, code, description, status`, [req.tenant.businessId, id, code.toUpperCase(), text(req.body?.description, 'Description', { max: 120 })])).rows[0];
    audit(req, 'wholesale.location_created', 'location', row.location_id, null, row);
    ok(res, row, 201);
  } catch (error) { if (error.code === '23505') throw new WholesaleError(409, 'That location code already exists in this warehouse'); throw error; }
};

const updateLocation = async (req, res) => {
  const loc = (await pool.query(`SELECT * FROM wholesale_locations WHERE location_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!loc) throw new WholesaleError(404, 'Not found');
  await ownBranch(req, loc.branch_id);
  const f = {};
  if ('code' in (req.body || {})) f.code = text(req.body.code, 'Location code', { max: 24, required: true }).toUpperCase();
  if ('description' in (req.body || {})) f.description = text(req.body.description, 'Description', { max: 120 });
  if ('status' in (req.body || {})) f.status = oneOf(req.body.status, 'Status', ['ACTIVE', 'INACTIVE'], { required: true });
  const keys = Object.keys(f); if (!keys.length) throw new WholesaleError(400, 'Nothing to update');
  try {
    const row = (await pool.query(`UPDATE wholesale_locations SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE location_id = $1 RETURNING location_id, code, description, status`, [loc.location_id, ...keys.map((k) => f[k])])).rows[0];
    audit(req, 'wholesale.location_updated', 'location', loc.location_id, null, f);
    ok(res, row);
  } catch (error) { if (error.code === '23505') throw new WholesaleError(409, 'That location code already exists in this warehouse'); throw error; }
};

/* PUT /products/:id/bin { branch_id, location_id } — the default bin of a product in a warehouse (null clears it) */
const assignBin = async (req, res) => {
  const branchId = await ownBranch(req, req.body?.branch_id);
  const productId = int(req.params.id, 'Product', { min: 1, required: true });
  if (!(await pool.query(`SELECT 1 FROM products WHERE product_id = $1 AND business_id = $2`, [productId, req.tenant.businessId])).rowCount) throw new WholesaleError(404, 'Not found');
  const locationId = int(req.body?.location_id, 'Location', { min: 1 });
  if (locationId == null) { await pool.query(`DELETE FROM wholesale_bin_assignments WHERE branch_id = $1 AND product_id = $2`, [branchId, productId]); return ok(res, { cleared: true }); }
  if (!(await pool.query(`SELECT 1 FROM wholesale_locations WHERE location_id = $1 AND branch_id = $2 AND business_id = $3`, [locationId, branchId, req.tenant.businessId])).rowCount) throw new WholesaleError(400, 'That location is not in this warehouse');
  await pool.query(`INSERT INTO wholesale_bin_assignments (branch_id, product_id, location_id) VALUES ($1,$2,$3) ON CONFLICT (branch_id, product_id) DO UPDATE SET location_id = EXCLUDED.location_id`, [branchId, productId, locationId]);
  ok(res, { branch_id: branchId, product_id: productId, location_id: locationId });
};

/* ═══ stock levels ════════════════════════════════════════════════════════════════════════════ */

/* GET /inventory?branch_id=&q=&category_id=&state=low|out|over|expiring|expired|damaged&limit=&offset= */
const levels = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const branches = await scopeBranches(req, req.query.branch_id);
  const settings = await getSettings(pool, req.tenant.businessId);
  const horizon = settings.expiry_alert_days.at(-1) ?? 90;
  const values = [req.tenant.businessId, branches, horizon];
  const where = [`p.business_id = $1`, `p.status = 'ACTIVE'`, `p.track_inventory`, `p.kind IN ('DISH','INGREDIENT','PACKAGING')`];
  if (req.query.category_id) { values.push(Number(req.query.category_id) || 0); where.push(`(p.category_id = $${values.length} OR d.subcategory_id = $${values.length})`); }
  if (req.query.q) { values.push(like(String(req.query.q).trim().slice(0, 80))); where.push(`(p.name ILIKE $${values.length} OR p.sku ILIKE $${values.length} OR p.barcode ILIKE $${values.length})`); }
  const state = String(req.query.state || '');
  const having = {
    low: `x.available <= p.min_stock AND p.min_stock > 0`, out: `x.on_hand <= 0`, over: `d.max_stock IS NOT NULL AND x.on_hand > d.max_stock`,
    expiring: `x.expiring > 0`, expired: `x.expired > 0`, damaged: `x.damaged > 0`
  }[state];
  const base = `
    FROM products p LEFT JOIN wholesale_item_details d ON d.product_id = p.product_id
    CROSS JOIN LATERAL (
      SELECT COALESCE((SELECT SUM(quantity) FROM branch_stock WHERE product_id = p.product_id AND branch_id = ANY($2::int[])), 0) AS on_hand,
             COALESCE((SELECT SUM(reserved_qty) FROM branch_stock WHERE product_id = p.product_id AND branch_id = ANY($2::int[])), 0) AS reserved,
             COALESCE((SELECT SUM(qty_on_hand) FROM wholesale_batches WHERE product_id = p.product_id AND branch_id = ANY($2::int[]) AND qty_on_hand > 0 AND expiry_date < CURRENT_DATE), 0) AS expired,
             COALESCE((SELECT SUM(qty_on_hand) FROM wholesale_batches WHERE product_id = p.product_id AND branch_id = ANY($2::int[]) AND qty_on_hand > 0 AND expiry_date >= CURRENT_DATE AND expiry_date <= CURRENT_DATE + $3::int), 0) AS expiring,
             COALESCE((SELECT SUM(qty) FROM wholesale_damaged_log WHERE product_id = p.product_id AND branch_id = ANY($2::int[])), 0) AS damaged,
             COALESCE((SELECT SUM(ti.qty_base - ti.received_base - ti.damaged_base) FROM wholesale_transfer_items ti JOIN wholesale_transfers t ON t.transfer_id = ti.transfer_id
                        WHERE ti.product_id = p.product_id AND t.to_branch_id = ANY($2::int[]) AND t.status = 'IN_TRANSIT'), 0) AS in_transit
    ) s
    CROSS JOIN LATERAL (SELECT s.on_hand, s.reserved, s.expired, s.expiring, s.damaged, s.in_transit, GREATEST(0, s.on_hand - s.reserved - s.expired) AS available) x
    WHERE ${where.join(' AND ')} ${having ? `AND ${having}` : ''}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(
    `SELECT p.product_id, p.name, p.sku, p.unit, p.min_stock, p.purchase_price_paise, d.max_stock, COALESCE(d.batch_tracking, FALSE) AS batch_tracking, COALESCE(d.expiry_tracking, FALSE) AS expiry_tracking,
            x.on_hand, x.reserved, x.expired, x.expiring, x.damaged, x.in_transit, x.available
     ${base} ORDER BY p.name LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  const sums = (await pool.query(`SELECT COALESCE(SUM(x.on_hand * p.purchase_price_paise), 0) AS value ${base}`, values.slice(0, -2))).rows[0];
  res.json({
    success: true,
    data: rows.map((r) => ({
      product_id: r.product_id, name: r.name, sku: r.sku, unit: r.unit, on_hand: Number(r.on_hand), reserved: Number(r.reserved), available: Number(r.available), expired: Number(r.expired), expiring: Number(r.expiring),
      damaged: Number(r.damaged), in_transit: Number(r.in_transit), reorder_level: Number(r.min_stock), max_stock: r.max_stock == null ? null : Number(r.max_stock), batch_tracking: r.batch_tracking, expiry_tracking: r.expiry_tracking,
      value: rupees(Number(r.on_hand) * Number(r.purchase_price_paise)), state: Number(r.on_hand) <= 0 ? 'OUT' : (Number(r.min_stock) > 0 && Number(r.available) <= Number(r.min_stock)) ? 'LOW' : (r.max_stock != null && Number(r.on_hand) > Number(r.max_stock)) ? 'OVER' : 'OK'
    })),
    meta: { total, limit: pg.limit, offset: pg.offset, stock_value: rupees(sums.value), expiry_horizon_days: horizon }
  });
};

/* GET /inventory/product/:id — per-warehouse stock, batches, bins and recent movements for one product */
const productStock = async (req, res) => {
  const id = int(req.params.id, 'Product', { min: 1, required: true });
  const p = (await pool.query(`SELECT p.product_id, p.name, p.sku, p.unit, p.min_stock, d.max_stock, COALESCE(d.batch_tracking, FALSE) AS batch_tracking, COALESCE(d.expiry_tracking, FALSE) AS expiry_tracking, COALESCE(d.serial_tracking, FALSE) AS serial_tracking
    FROM products p LEFT JOIN wholesale_item_details d ON d.product_id = p.product_id WHERE p.product_id = $1 AND p.business_id = $2`, [id, req.tenant.businessId])).rows[0];
  if (!p) throw new WholesaleError(404, 'Not found');
  const branches = await scopeBranches(req);
  const stock = await Promise.all(branches.map(async (b) => {
    const a = (await availability(pool, b, [id])).get(id);
    const name = (await pool.query(`SELECT name FROM branches WHERE branch_id = $1`, [b])).rows[0].name;
    const damaged = Number((await pool.query(`SELECT COALESCE(SUM(qty), 0) AS q FROM wholesale_damaged_log WHERE branch_id = $1 AND product_id = $2`, [b, id])).rows[0].q);
    const bin = (await pool.query(`SELECT l.location_id, l.code FROM wholesale_bin_assignments a JOIN wholesale_locations l ON l.location_id = a.location_id WHERE a.branch_id = $1 AND a.product_id = $2`, [b, id])).rows[0];
    return { branch_id: b, warehouse: name, ...a, damaged, bin: bin?.code ?? null, location_id: bin?.location_id ?? null };
  }));
  const batches = (await pool.query(
    `SELECT batch_id, branch_id, batch_no, mfg_date, expiry_date, qty_on_hand, cost_paise, received_on, source, (expiry_date - CURRENT_DATE) AS days_left
     FROM wholesale_batches WHERE product_id = $1 AND branch_id = ANY($2::int[]) AND qty_on_hand > 0 ORDER BY expiry_date NULLS LAST, batch_id`, [id, branches])).rows;
  const moves = (await pool.query(
    `SELECT t.txn_id, t.branch_id, t.transaction_type, t.quantity, t.reference_type, t.reference_id, t.notes, t.reason_code, t.created_at, u.name AS by
     FROM inventory_transactions t LEFT JOIN users u ON u.user_id = t.created_by WHERE t.product_id = $1 AND t.business_id = $2 AND t.branch_id = ANY($3::int[]) ORDER BY t.txn_id DESC LIMIT 30`, [id, req.tenant.businessId, branches])).rows;
  const units = await loadUnits(pool, req.tenant.businessId, [id]);
  ok(res, {
    product: { ...p, min_stock: Number(p.min_stock), max_stock: p.max_stock == null ? null : Number(p.max_stock), units: [...units.get(id).units.values()].map((u) => ({ unit_name: u.name, factor: u.factor })) },
    warehouses: stock,
    batches: batches.map((b) => ({ ...b, batch_id: Number(b.batch_id), qty_on_hand: Number(b.qty_on_hand), cost: b.cost_paise == null ? null : rupees(b.cost_paise), days_left: b.days_left == null ? null : Number(b.days_left) })),
    movements: moves.map((m) => ({ ...m, quantity: Number(m.quantity) }))
  });
};

/* GET /inventory/movements?product_id=&branch_id=&type=&from=&to= — the stock ledger */
const movements = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const branches = await scopeBranches(req, req.query.branch_id);
  const values = [req.tenant.businessId, branches]; const where = ['t.business_id = $1', 't.branch_id = ANY($2::int[])'];
  if (req.query.product_id) { values.push(Number(req.query.product_id) || 0); where.push(`t.product_id = $${values.length}`); }
  if (req.query.type) { values.push(String(req.query.type).toUpperCase()); where.push(`t.transaction_type = $${values.length}`); }
  const from = isoDate(req.query.from, 'From'); const to = isoDate(req.query.to, 'To');
  if (from) { values.push(from); where.push(`t.created_at >= $${values.length}::date`); }
  if (to) { values.push(to); where.push(`t.created_at < ($${values.length}::date + 1)`); }
  const base = `FROM inventory_transactions t JOIN products p ON p.product_id = t.product_id JOIN branches b ON b.branch_id = t.branch_id LEFT JOIN users u ON u.user_id = t.created_by WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(`SELECT t.txn_id, t.created_at, t.transaction_type, t.quantity, t.reference_type, t.reference_id, t.notes, t.reason_code, p.name AS product, p.unit, b.name AS warehouse, u.name AS by ${base} ORDER BY t.txn_id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  page(res, rows.map((r) => ({ ...r, quantity: Number(r.quantity) })), total, pg);
};

/* ═══ batches and expiry ══════════════════════════════════════════════════════════════════════ */

/* GET /inventory/batches?branch_id=&product_id=&state=expired|expiring|ok&q= */
const batches = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const branches = await scopeBranches(req, req.query.branch_id);
  const settings = await getSettings(pool, req.tenant.businessId);
  const values = [req.tenant.businessId, branches, settings.expiry_alert_days.at(-1) ?? 90];
  // $3 (the alert window) is always sent, so it is always referenced: Postgres refuses a call that supplies a parameter the query never uses
  const where = ['b.business_id = $1', 'b.branch_id = ANY($2::int[])', '$3::int > 0'];
  if (req.query.all !== '1') where.push('b.qty_on_hand > 0');
  if (req.query.product_id) { values.push(Number(req.query.product_id) || 0); where.push(`b.product_id = $${values.length}`); }
  if (req.query.q) { values.push(like(String(req.query.q).slice(0, 80))); where.push(`(b.batch_no ILIKE $${values.length} OR p.name ILIKE $${values.length})`); }
  const state = String(req.query.state || '');
  if (state === 'expired') where.push('b.expiry_date < CURRENT_DATE');
  if (state === 'expiring') where.push('b.expiry_date >= CURRENT_DATE AND b.expiry_date <= CURRENT_DATE + $3::int');
  if (state === 'ok') where.push('(b.expiry_date IS NULL OR b.expiry_date > CURRENT_DATE + $3::int)');
  const base = `FROM wholesale_batches b JOIN products p ON p.product_id = b.product_id JOIN branches br ON br.branch_id = b.branch_id WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(
    `SELECT b.batch_id, b.branch_id, br.name AS warehouse, b.product_id, p.name AS product, p.sku, p.unit, b.batch_no, b.mfg_date, b.expiry_date, b.qty_on_hand, b.cost_paise, b.received_on, (b.expiry_date - CURRENT_DATE) AS days_left
     ${base} ORDER BY b.expiry_date NULLS LAST, b.batch_id LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  page(res, rows.map((r) => ({ ...r, batch_id: Number(r.batch_id), qty_on_hand: Number(r.qty_on_hand), cost: r.cost_paise == null ? null : rupees(r.cost_paise), value: r.cost_paise == null ? null : rupees(Number(r.qty_on_hand) * Number(r.cost_paise)), days_left: r.days_left == null ? null : Number(r.days_left),
    state: r.expiry_date == null ? 'NO_EXPIRY' : Number(r.days_left) < 0 ? 'EXPIRED' : Number(r.days_left) <= (settings.expiry_alert_days.at(-1) ?? 90) ? 'EXPIRING' : 'OK' })), total, pg);
};

/* GET /inventory/expiry — expired and soon-to-expire stock in the business's alert windows (30 / 60 / 90 days by default) */
const expiry = async (req, res) => {
  const branches = await scopeBranches(req, req.query.branch_id);
  const settings = await getSettings(pool, req.tenant.businessId);
  const days = settings.expiry_alert_days;
  const rows = (await pool.query(
    `SELECT b.batch_id, b.branch_id, br.name AS warehouse, p.product_id, p.name AS product, b.batch_no, b.expiry_date, b.qty_on_hand, b.cost_paise, (b.expiry_date - CURRENT_DATE) AS days_left
     FROM wholesale_batches b JOIN products p ON p.product_id = b.product_id JOIN branches br ON br.branch_id = b.branch_id
     WHERE b.business_id = $1 AND b.branch_id = ANY($2::int[]) AND b.qty_on_hand > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= CURRENT_DATE + $3::int ORDER BY b.expiry_date LIMIT 1000`,
    [req.tenant.businessId, branches, days.at(-1) ?? 90])).rows;
  const windows = [{ key: 'expired', label: 'Expired', from: -Infinity, to: -1 }, ...days.map((d, i) => ({ key: `d${d}`, label: `Within ${d} days`, from: i === 0 ? 0 : days[i - 1] + 1, to: d }))];
  const out = windows.map((w) => {
    const items = rows.filter((r) => Number(r.days_left) >= w.from && Number(r.days_left) <= w.to);
    return {
      key: w.key, label: w.label, batches: items.length, units: items.reduce((s, r) => s + Number(r.qty_on_hand), 0), value: rupees(items.reduce((s, r) => s + Number(r.qty_on_hand) * Number(r.cost_paise || 0), 0)),
      items: items.map((r) => ({ batch_id: Number(r.batch_id), warehouse: r.warehouse, product_id: r.product_id, product: r.product, batch_no: r.batch_no, expiry_date: r.expiry_date, qty_on_hand: Number(r.qty_on_hand), days_left: Number(r.days_left) }))
    };
  });
  ok(res, { windows: out, alert_days: days });
};

/* GET /inventory/alerts — the counts behind the dashboard's stock alerts */
const alerts = async (req, res) => ok(res, await stockAlertCounts(pool, { businessId: req.tenant.businessId, branchIds: await scopeBranches(req, req.query.branch_id) }));

/* ═══ adjustments ═════════════════════════════════════════════════════════════════════════════ */

const MODES = ['OPENING', 'ADD', 'REMOVE', 'COUNT', 'DAMAGE', 'EXPIRED'];

/*
 * POST /inventory/adjust
 * { branch_id, product_id, mode: OPENING|ADD|REMOVE|COUNT|DAMAGE|EXPIRED, quantity, unit_name?, batch_no?, mfg_date?, expiry_date?, cost?, serials?, reason }
 *   COUNT: quantity is what you counted; stock moves by the difference (not for batch-tracked goods: count a batch with ADD / REMOVE)
 *   DAMAGE: stock leaves the shelf and is held as damaged goods; EXPIRED / REMOVE: stock leaves
 */
const adjust = async (req, res) => {
  const b = req.body || {};
  const branchId = await ownBranch(req, b.branch_id ?? (req.tenant.viewAll ? null : req.tenant.branchId));
  const productId = int(b.product_id, 'Product', { min: 1, required: true });
  const mode = oneOf(b.mode, 'Adjustment type', MODES, { required: true });
  const reason = text(b.reason, 'Reason', { max: 200, required: mode !== 'OPENING', min: 3 }) || 'Opening stock';
  const result = await withTransaction(async (client) => {
    const product = (await lockProducts(client, req.tenant.businessId, [productId])).get(productId);
    if (!product) throw new WholesaleError(404, 'Product not found');
    if (!product.track_inventory) throw new WholesaleError(400, `${product.name} does not track stock`);
    const units = await loadUnits(client, req.tenant.businessId, [productId]);
    const u = unitFor(units, productId, b.unit_name, product.name);
    const qty = q3(num(b.quantity, 'Quantity', { min: mode === 'COUNT' ? 0 : 0.001, max: 100000000, required: true }) * u.factor);
    const tracked = (await batchTracked(client, req.tenant.businessId, [productId])).get(productId) || {};
    const isBatch = Boolean(tracked.batch_tracking || tracked.expiry_tracking);
    const a = (await availability(client, branchId, [productId])).get(productId);
    const batchNo = text(b.batch_no, 'Batch number', { max: 40 });
    const onDate = await today(client, req.tenant.businessId);
    let delta;
    if (mode === 'COUNT') {
      if (isBatch) throw new WholesaleError(400, `${product.name} is batch-tracked. Correct a batch with Add or Remove instead.`);
      delta = q3(qty - a.quantity);
      if (delta < 0 && a.quantity + delta < a.reserved - 1e-9) throw new WholesaleError(409, `${a.reserved} ${product.unit} is reserved for open orders, so the count cannot be lower than that`);
      if (delta === 0) return { delta: 0, product, on_hand: a.quantity };
    } else delta = ['ADD', 'OPENING'].includes(mode) ? qty : -qty;

    if (delta < 0) {
      const take = -delta;
      if (mode !== 'EXPIRED' && take > a.available + 1e-9) throw new WholesaleError(409, `Only ${a.available} ${product.unit} of ${product.name} is free to remove (${a.reserved} is reserved${a.expired ? `, ${a.expired} is expired` : ''})`);
      if (take > a.quantity + 1e-9) throw new WholesaleError(409, `Only ${a.quantity} ${product.unit} on hand`);
      if (isBatch) {
        let allocations;
        if (batchNo) {
          const row = (await client.query(`SELECT batch_id, qty_on_hand FROM wholesale_batches WHERE branch_id = $1 AND product_id = $2 AND lower(batch_no) = lower($3) FOR UPDATE`, [branchId, productId, batchNo])).rows[0];
          if (!row || Number(row.qty_on_hand) < take - 1e-9) throw new WholesaleError(409, `Batch ${batchNo} does not have that much`);
          allocations = [{ batch_id: Number(row.batch_id), qty: take }];
        } else {
          const r = mode === 'EXPIRED'
            ? await (async () => {
              const rows = (await client.query(`SELECT batch_id, qty_on_hand FROM wholesale_batches WHERE branch_id = $1 AND product_id = $2 AND qty_on_hand > 0 AND expiry_date < $3::date ORDER BY expiry_date FOR UPDATE`, [branchId, productId, onDate])).rows;
              let left = take; const al = [];
              for (const x of rows) { if (left <= 0) break; const t = Math.min(left, Number(x.qty_on_hand)); al.push({ batch_id: Number(x.batch_id), qty: q3(t) }); left = q3(left - t); }
              return { allocations: al, unbatched: left };
            })()
            : await allocateBatches(client, { branchId, productId, qty: take, fefo: true, today: onDate });
          if (r.unbatched > 1e-9) throw new WholesaleError(409, mode === 'EXPIRED' ? 'There is not that much expired stock in batches. Name the batch.' : 'Not enough batch stock. Name the batch.');
          allocations = r.allocations;
        }
        await consumeBatches(client, { businessId: req.tenant.businessId, allocations, refType: 'adjustment', refId: productId });
      }
      if (tracked.serial_tracking) {
        const list = (b.serials || []).map((x) => String(x).trim()).filter(Boolean);
        if (list.length !== take) throw new WholesaleError(400, `Enter the ${take} serial number${take === 1 ? '' : 's'} being removed`);
        const hit = await client.query(`UPDATE wholesale_serials SET status = $5 WHERE business_id = $1 AND product_id = $2 AND branch_id = $3 AND status = 'IN_STOCK' AND lower(serial_no) = ANY($4::text[])`, [req.tenant.businessId, productId, branchId, list.map((x) => x.toLowerCase()), mode === 'DAMAGE' ? 'DAMAGED' : 'SOLD']);
        if (hit.rowCount !== list.length) throw new WholesaleError(409, 'One of those serial numbers is not in stock here');
      }
      await stockOut(client, { businessId: req.tenant.businessId, branchId, productId, qty: take, type: mode === 'DAMAGE' || mode === 'EXPIRED' ? 'WASTAGE' : 'ADJUSTMENT', refType: 'adjustment', notes: reason, userId: req.auth.userId, reason: mode === 'DAMAGE' ? 'DAMAGED' : mode === 'EXPIRED' ? 'EXPIRED' : 'OTHER' });
      if (mode === 'DAMAGE') await logDamaged(client, { businessId: req.tenant.businessId, branchId, productId, qty: take, source: 'ADJUST', refType: 'adjustment', note: reason, userId: req.auth.userId });
    } else {
      if (isBatch) {
        if (!batchNo) throw new WholesaleError(400, `${product.name} is batch-tracked: enter the batch number`);
        const expiryDate = isoDate(b.expiry_date, 'Expiry date');
        if (tracked.expiry_tracking && !expiryDate) throw new WholesaleError(400, `${product.name} expires: enter the expiry date`);
        await addToBatch(client, { businessId: req.tenant.businessId, branchId, productId, batchNo, mfgDate: isoDate(b.mfg_date, 'Manufacturing date'), expiryDate, qty: delta, costPaise: b.cost != null && b.cost !== '' ? Math.round(Number(b.cost) * 100) : null, source: mode === 'OPENING' ? 'OPENING' : 'ADJUST', refType: 'adjustment', refId: productId });
      }
      if (tracked.serial_tracking) {
        const list = [...new Set((b.serials || []).map((x) => String(x).trim()).filter(Boolean))];
        if (list.length !== delta) throw new WholesaleError(400, `Enter ${delta} serial number${delta === 1 ? '' : 's'}`);
        for (const sn of list) {
          try { await client.query(`INSERT INTO wholesale_serials (business_id, product_id, branch_id, serial_no) VALUES ($1,$2,$3,$4)`, [req.tenant.businessId, productId, branchId, sn]); }
          catch (error) { if (error.code === '23505') throw new WholesaleError(409, `Serial ${sn} already exists`); throw error; }
        }
      }
      await stockIn(client, { businessId: req.tenant.businessId, branchId, productId, qty: delta, type: mode === 'OPENING' ? 'OPENING' : 'ADJUSTMENT', refType: 'adjustment', notes: reason, userId: req.auth.userId });
    }
    return { delta, product, on_hand: q3(a.quantity + delta) };
  });
  audit(req, 'wholesale.stock_adjusted', 'product', productId, null, null, { product: result.product.name, mode, change: result.delta, reason, branch_id: branchId });
  ok(res, { product_id: productId, change: result.delta, on_hand: result.on_hand });
};

/* POST /inventory/write-off-damaged { branch_id, product_id, quantity, note } — damaged goods thrown away */
const writeOffDamaged = async (req, res) => {
  const b = req.body || {};
  const branchId = await ownBranch(req, b.branch_id ?? (req.tenant.viewAll ? null : req.tenant.branchId));
  const productId = int(b.product_id, 'Product', { min: 1, required: true });
  const qty = num(b.quantity, 'Quantity', { min: 0.001, required: true });
  await withTransaction(async (client) => {
    await lockProducts(client, req.tenant.businessId, [productId]);
    const have = Number((await client.query(`SELECT COALESCE(SUM(qty), 0) AS q FROM wholesale_damaged_log WHERE branch_id = $1 AND product_id = $2`, [branchId, productId])).rows[0].q);
    if (qty > have + 1e-9) throw new WholesaleError(409, `Only ${have} damaged units are held`);
    await logDamaged(client, { businessId: req.tenant.businessId, branchId, productId, qty: -qty, source: 'WRITE_OFF', note: text(b.note, 'Note', { max: 200 }) || 'Written off', userId: req.auth.userId });
  });
  audit(req, 'wholesale.damaged_written_off', 'product', productId, null, null, { quantity: qty, branch_id: branchId });
  ok(res, { written_off: qty });
};

/* GET /inventory/damaged — damaged goods held, by warehouse and product */
const damaged = async (req, res) => {
  const branches = await scopeBranches(req, req.query.branch_id);
  const rows = (await pool.query(
    `SELECT l.branch_id, b.name AS warehouse, l.product_id, p.name AS product, p.unit, SUM(l.qty) AS qty, SUM(l.qty) * p.purchase_price_paise AS value
     FROM wholesale_damaged_log l JOIN products p ON p.product_id = l.product_id JOIN branches b ON b.branch_id = l.branch_id
     WHERE l.business_id = $1 AND l.branch_id = ANY($2::int[]) GROUP BY l.branch_id, b.name, l.product_id, p.name, p.unit, p.purchase_price_paise HAVING SUM(l.qty) > 0 ORDER BY p.name`, [req.tenant.businessId, branches])).rows;
  ok(res, rows.map((r) => ({ ...r, qty: Number(r.qty), value: rupees(r.value) })));
};

/* ═══ transfers ═══════════════════════════════════════════════════════════════════════════════ */

const transferShape = (t) => ({
  transfer_id: t.transfer_id, transfer_number: t.transfer_number, status: t.status, from_branch_id: t.from_branch_id, from_warehouse: t.from_name, to_branch_id: t.to_branch_id, to_warehouse: t.to_name,
  notes: t.notes, vehicle_no: t.vehicle_no, created_at: t.created_at, dispatched_at: t.dispatched_at, received_at: t.received_at, ...(t.lines != null ? { lines: Number(t.lines), units: Number(t.units) } : {})
});

const TRANSFER_FROM = `FROM wholesale_transfers t JOIN branches f ON f.branch_id = t.from_branch_id JOIN branches b2 ON b2.branch_id = t.to_branch_id`;

const loadTransfer = async (req, id, { db = pool, lock = false } = {}) => {
  if (!Number.isInteger(Number(id))) throw new WholesaleError(404, 'Not found');
  const t = (await db.query(`SELECT t.*, f.name AS from_name, b2.name AS to_name ${TRANSFER_FROM} WHERE t.business_id = $1 AND t.transfer_id = $2 ${lock ? 'FOR UPDATE OF t' : ''}`, [req.tenant.businessId, id])).rows[0];
  if (!t) throw new WholesaleError(404, 'Not found');
  if (req.tenant.pinned && ![t.from_branch_id, t.to_branch_id].includes(req.tenant.branchId)) throw new WholesaleError(404, 'Not found');
  return t;
};

const transferDetail = async (db, t) => {
  const items = (await db.query(
    `SELECT i.*, p.name AS product, p.unit, p.sku FROM wholesale_transfer_items i JOIN products p ON p.product_id = i.product_id WHERE i.transfer_id = $1 ORDER BY i.item_id`, [t.transfer_id])).rows;
  const batches = items.length ? (await db.query(`SELECT * FROM wholesale_transfer_batches WHERE item_id = ANY($1::int[]) ORDER BY expiry_date NULLS LAST`, [items.map((i) => i.item_id)])).rows : [];
  return {
    ...transferShape(t),
    items: items.map((i) => ({ item_id: i.item_id, product_id: i.product_id, product: i.product, sku: i.sku, unit: i.unit, qty_base: Number(i.qty_base), received_base: Number(i.received_base), damaged_base: Number(i.damaged_base), short_base: t.status === 'RECEIVED' ? q3(Number(i.qty_base) - Number(i.received_base) - Number(i.damaged_base)) : 0,
      batches: batches.filter((b) => b.item_id === i.item_id).map((b) => ({ batch_no: b.batch_no, mfg_date: b.mfg_date, expiry_date: b.expiry_date, qty_base: Number(b.qty_base) })) }))
  };
};

const listTransfers = async (req, res) => {
  const pg = paging(req.query, { max: 200, fallback: 50 });
  const values = [req.tenant.businessId]; const where = ['t.business_id = $1'];
  if (req.query.status) { values.push(String(req.query.status).split(',').map((s) => s.trim().toUpperCase())); where.push(`t.status = ANY($${values.length}::text[])`); }
  if (req.tenant.pinned) { values.push(req.tenant.branchId); where.push(`(t.from_branch_id = $${values.length} OR t.to_branch_id = $${values.length})`); }
  const base = `${TRANSFER_FROM} WHERE ${where.join(' AND ')}`;
  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${base}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const rows = (await pool.query(`SELECT t.*, f.name AS from_name, b2.name AS to_name, (SELECT COUNT(*) FROM wholesale_transfer_items i WHERE i.transfer_id = t.transfer_id) AS lines, (SELECT COALESCE(SUM(qty_base), 0) FROM wholesale_transfer_items i WHERE i.transfer_id = t.transfer_id) AS units ${base} ORDER BY t.transfer_id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values)).rows;
  page(res, rows.map(transferShape), total, pg);
};

const getTransfer = async (req, res) => ok(res, await transferDetail(pool, await loadTransfer(req, req.params.id)));

/* POST /transfers { from_branch_id, to_branch_id, items: [{ product_id, quantity, unit_name? }], notes?, vehicle_no?, dispatch?: true } */
const createTransfer = async (req, res) => {
  const b = req.body || {};
  const from = await ownBranch(req, int(b.from_branch_id, 'From warehouse', { min: 1, required: true }));
  const to = int(b.to_branch_id, 'To warehouse', { min: 1, required: true });
  if (from === to) throw new WholesaleError(400, 'Choose two different warehouses');
  if (!(await pool.query(`SELECT 1 FROM branches WHERE branch_id = $1 AND business_id = $2 AND status = 'ACTIVE'`, [to, req.tenant.businessId])).rowCount) throw new WholesaleError(400, 'The destination warehouse was not found');
  const list = Array.isArray(b.items) ? b.items : [];
  if (!list.length || list.length > 200) throw new WholesaleError(400, 'Add between 1 and 200 products');
  const id = await withTransaction(async (client) => {
    const ids = list.map((i) => int(i.product_id, 'Product', { min: 1, required: true }));
    const products = await lockProducts(client, req.tenant.businessId, ids);
    const units = await loadUnits(client, req.tenant.businessId, ids);
    const number = await nextNumber(client, req.tenant.businessId, 'TR', 'TR');
    const t = (await client.query(`INSERT INTO wholesale_transfers (business_id, from_branch_id, to_branch_id, transfer_number, notes, vehicle_no, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING transfer_id`,
      [req.tenant.businessId, from, to, number, text(b.notes, 'Notes', { max: 300 }), text(b.vehicle_no, 'Vehicle number', { max: 20 })?.toUpperCase() ?? null, req.auth.userId])).rows[0];
    const seen = new Set();
    for (const [k, i] of list.entries()) {
      const p = products.get(ids[k]); if (!p) throw new WholesaleError(400, `Product ${ids[k]} was not found`);
      if (seen.has(p.product_id)) throw new WholesaleError(400, `${p.name} is listed twice`); seen.add(p.product_id);
      const u = unitFor(units, p.product_id, i.unit_name, p.name);
      await client.query(`INSERT INTO wholesale_transfer_items (transfer_id, product_id, qty_base) VALUES ($1,$2,$3)`, [t.transfer_id, p.product_id, toBase(num(i.quantity, 'Quantity', { min: 0.001, required: true }), u.factor)]);
    }
    return t.transfer_id;
  });
  audit(req, 'wholesale.transfer_created', 'transfer', id, null, { from, to, lines: list.length });
  if (bool(b.dispatch)) return dispatchTransfer({ ...req, params: { id } }, res);
  ok(res, await transferDetail(pool, await loadTransfer(req, id)), 201);
};

/* POST /transfers/:id/dispatch — stock leaves the source warehouse and is in transit until the other side receives it */
const dispatchTransfer = async (req, res) => {
  const settings = await getSettings(pool, req.tenant.businessId);
  await withTransaction(async (client) => {
    const t = await loadTransfer(req, req.params.id, { db: client, lock: true });
    if (t.status !== 'DRAFT') throw new WholesaleError(409, `This transfer is already ${t.status.toLowerCase().replace('_', ' ')}`);
    if (req.tenant.pinned && t.from_branch_id !== req.tenant.branchId) throw new WholesaleError(403, 'Only the sending warehouse can dispatch');
    const items = (await client.query(`SELECT i.*, p.name FROM wholesale_transfer_items i JOIN products p ON p.product_id = i.product_id WHERE i.transfer_id = $1 ORDER BY i.product_id FOR UPDATE OF i`, [t.transfer_id])).rows;
    await lockProducts(client, req.tenant.businessId, items.map((i) => i.product_id));
    const tracked = await batchTracked(client, req.tenant.businessId, items.map((i) => i.product_id));
    const avail = await availability(client, t.from_branch_id, items.map((i) => i.product_id));
    const onDate = await today(client, req.tenant.businessId);
    for (const i of items) {
      const qty = Number(i.qty_base);
      if (qty > avail.get(i.product_id).available + 1e-9) throw new WholesaleError(409, `${i.name}: only ${avail.get(i.product_id).available} is available to send (the rest is reserved or expired)`);
      const tr = tracked.get(i.product_id);
      if (tr?.batch_tracking || tr?.expiry_tracking) {
        const { allocations, unbatched } = await allocateBatches(client, { branchId: t.from_branch_id, productId: i.product_id, qty, fefo: settings.fefo, today: onDate });
        if (unbatched > 1e-9) throw new WholesaleError(409, `${i.name}: not enough stock in batches`);
        const meta = new Map((await client.query(`SELECT batch_id, batch_no, mfg_date, expiry_date, cost_paise FROM wholesale_batches WHERE batch_id = ANY($1::bigint[])`, [allocations.map((a) => a.batch_id)])).rows.map((r) => [Number(r.batch_id), r]));
        await consumeBatches(client, { businessId: req.tenant.businessId, allocations, refType: 'transfer', refId: t.transfer_id });
        for (const a of allocations) { const m = meta.get(a.batch_id); await client.query(`INSERT INTO wholesale_transfer_batches (item_id, batch_no, mfg_date, expiry_date, cost_paise, qty_base) VALUES ($1,$2,$3,$4,$5,$6)`, [i.item_id, m.batch_no, m.mfg_date, m.expiry_date, m.cost_paise, a.qty]); }
      }
      await stockOut(client, { businessId: req.tenant.businessId, branchId: t.from_branch_id, productId: i.product_id, qty, type: 'TRANSFER', refType: 'transfer', refId: t.transfer_id, notes: `Transfer ${t.transfer_number} to warehouse ${t.to_branch_id}`, userId: req.auth.userId });
    }
    await client.query(`UPDATE wholesale_transfers SET status = 'IN_TRANSIT', dispatched_at = CURRENT_TIMESTAMP WHERE transfer_id = $1`, [t.transfer_id]);
  });
  audit(req, 'wholesale.transfer_dispatched', 'transfer', Number(req.params.id));
  ok(res, await transferDetail(pool, await loadTransfer(req, req.params.id)));
};

/* POST /transfers/:id/receive { items?: [{ item_id, received_base, damaged_base? }] } — default: everything arrived in good condition */
const receiveTransfer = async (req, res) => {
  const b = req.body || {};
  await withTransaction(async (client) => {
    const t = await loadTransfer(req, req.params.id, { db: client, lock: true });
    if (t.status !== 'IN_TRANSIT') throw new WholesaleError(409, t.status === 'RECEIVED' ? 'This transfer has already been received' : 'This transfer is not in transit');
    if (req.tenant.pinned && t.to_branch_id !== req.tenant.branchId) throw new WholesaleError(403, 'Only the receiving warehouse can receive it');
    const items = (await client.query(`SELECT * FROM wholesale_transfer_items WHERE transfer_id = $1 ORDER BY product_id FOR UPDATE`, [t.transfer_id])).rows;
    await lockProducts(client, req.tenant.businessId, items.map((i) => i.product_id));
    const given = new Map((Array.isArray(b.items) ? b.items : []).map((x) => [Number(x.item_id), x]));
    for (const i of items) {
      const x = given.get(i.item_id);
      const qty = Number(i.qty_base);
      const dmg = x ? num(x.damaged_base ?? 0, 'Damaged quantity', { min: 0 }) : 0;
      const got = x ? num(x.received_base ?? Math.max(0, qty - dmg), 'Received quantity', { min: 0 }) : qty;
      if (got + dmg > qty + 1e-9) throw new WholesaleError(400, 'You cannot receive more than was sent');
      let left = got;
      const bats = (await client.query(`SELECT * FROM wholesale_transfer_batches WHERE item_id = $1 ORDER BY expiry_date NULLS LAST, batch_no`, [i.item_id])).rows;
      for (const bt of bats) {
        if (left <= 0) break;
        const take = Math.min(left, Number(bt.qty_base)); left = q3(left - take);
        await addToBatch(client, { businessId: req.tenant.businessId, branchId: t.to_branch_id, productId: i.product_id, batchNo: bt.batch_no, mfgDate: bt.mfg_date, expiryDate: bt.expiry_date, qty: take, costPaise: bt.cost_paise, source: 'TRANSFER', refId: t.transfer_id, refType: 'transfer' });
      }
      if (got > 0) await stockIn(client, { businessId: req.tenant.businessId, branchId: t.to_branch_id, productId: i.product_id, qty: got, type: 'TRANSFER', refType: 'transfer', refId: t.transfer_id, notes: `Transfer ${t.transfer_number} from warehouse ${t.from_branch_id}`, userId: req.auth.userId });
      if (dmg > 0) await logDamaged(client, { businessId: req.tenant.businessId, branchId: t.to_branch_id, productId: i.product_id, qty: dmg, source: 'TRANSFER', refType: 'transfer', refId: t.transfer_id, note: 'Damaged in transit', userId: req.auth.userId });
      await client.query(`UPDATE wholesale_transfer_items SET received_base = $2, damaged_base = $3 WHERE item_id = $1`, [i.item_id, got, dmg]);
    }
    await client.query(`UPDATE wholesale_transfers SET status = 'RECEIVED', received_at = CURRENT_TIMESTAMP WHERE transfer_id = $1`, [t.transfer_id]);
  });
  audit(req, 'wholesale.transfer_received', 'transfer', Number(req.params.id));
  ok(res, await transferDetail(pool, await loadTransfer(req, req.params.id)));
};

/* POST /transfers/:id/cancel — a draft is dropped; one in transit comes back to the sending warehouse */
const cancelTransfer = async (req, res) => {
  await withTransaction(async (client) => {
    const t = await loadTransfer(req, req.params.id, { db: client, lock: true });
    if (!['DRAFT', 'IN_TRANSIT'].includes(t.status)) throw new WholesaleError(409, `A ${t.status.toLowerCase()} transfer cannot be cancelled`);
    if (t.status === 'IN_TRANSIT') {
      const items = (await client.query(`SELECT * FROM wholesale_transfer_items WHERE transfer_id = $1 ORDER BY product_id FOR UPDATE`, [t.transfer_id])).rows;
      await lockProducts(client, req.tenant.businessId, items.map((i) => i.product_id));
      for (const i of items) {
        const bats = (await client.query(`SELECT * FROM wholesale_transfer_batches WHERE item_id = $1`, [i.item_id])).rows;
        for (const bt of bats) await addToBatch(client, { businessId: req.tenant.businessId, branchId: t.from_branch_id, productId: i.product_id, batchNo: bt.batch_no, mfgDate: bt.mfg_date, expiryDate: bt.expiry_date, qty: Number(bt.qty_base), costPaise: bt.cost_paise, source: 'TRANSFER', refId: t.transfer_id, refType: 'transfer' });
        await stockIn(client, { businessId: req.tenant.businessId, branchId: t.from_branch_id, productId: i.product_id, qty: Number(i.qty_base), type: 'TRANSFER', refType: 'transfer', refId: t.transfer_id, notes: `Transfer ${t.transfer_number} cancelled`, userId: req.auth.userId });
      }
    }
    await client.query(`UPDATE wholesale_transfers SET status = 'CANCELLED' WHERE transfer_id = $1`, [t.transfer_id]);
  });
  audit(req, 'wholesale.transfer_cancelled', 'transfer', Number(req.params.id));
  ok(res, await transferDetail(pool, await loadTransfer(req, req.params.id)));
};

export default wrapAll({
  listWarehouses, updateWarehouse, listLocations, createLocation, updateLocation, assignBin,
  levels, productStock, movements, batches, expiry, alerts, adjust, writeOffDamaged, damaged,
  listTransfers, getTransfer, createTransfer, dispatchTransfer, receiveTransfer, cancelTransfer
});
export { scopeBranches };
