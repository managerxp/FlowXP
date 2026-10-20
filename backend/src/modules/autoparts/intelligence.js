/*
 * Reports and suggestions for a parts shop. Everything here is READ-ONLY and rule based: each figure comes from the ledgers (branch_stock, invoices, receipts, bins) and each
 * suggestion carries the rule that produced it. Nothing here changes stock, prices or fitment.
 *
 *   overview        what is on hand, what it is worth, what is waiting (put-away, holds, claims), what is below its reorder level
 *   movers          FAST / MEDIUM / SLOW / DEAD by sales, with the rules in the answer
 *   ageing          stock value by days since it last arrived (the last receipt, not true layer ageing)
 *   reorder         what to buy: sales speed x (lead time + review + safety days), less on hand and on order, capped by the max stock
 *   togetherWith    parts bought on the same bill
 *   supplierScore   per supplier: damaged / rejected share, fill rate, lead time from the receipts
 *   valuation       value at cost and at selling price by category
 *   occupancy       how full the racks are
 *   partLedger      every movement of one part: ledger and bins
 */
import { getSettings } from './locations.js';

const num = (v) => Number(v ?? 0);
const q3 = (n) => Math.round(Number(n) * 1000) / 1000;

/** SQL fragment and params for "this business, this outlet or all of them". */
const scope = (tenant, column, params, branchId = null) => {
  const b = tenant.scopeBranchId ?? (branchId ? Number(branchId) : null);
  if (b != null) { params.push(b); return `${column} = $${params.length}`; }
  params.push(tenant.businessId);
  return `${column} IN (SELECT branch_id FROM branches WHERE business_id = $${params.length})`;
};

export const overview = async (db, tenant, { branchId = null } = {}) => {
  const params = [];
  const w = scope(tenant, 'bs.branch_id', params, branchId);
  const st = (await db.query(
    `SELECT COUNT(*) FILTER (WHERE bs.quantity > 0) AS parts_in_stock, COALESCE(SUM(GREATEST(bs.quantity, 0)), 0) AS units,
            COALESCE(SUM(GREATEST(bs.quantity, 0) * p.purchase_price_paise), 0) AS cost_paise, COALESCE(SUM(GREATEST(bs.quantity, 0) * p.selling_price_paise), 0) AS sell_paise,
            COUNT(*) FILTER (WHERE COALESCE(ap.reorder_level, NULLIF(p.min_stock, 0)) IS NOT NULL AND bs.quantity <= COALESCE(ap.reorder_level, p.min_stock)) AS below_reorder,
            COUNT(*) FILTER (WHERE bs.quantity <= 0) AS out_of_stock
     FROM branch_stock bs JOIN products p ON p.product_id = bs.product_id JOIN autoparts_parts ap ON ap.product_id = p.product_id WHERE ${w} AND p.status = 'ACTIVE'`, params)).rows[0];
  const p2 = [];
  const w2 = scope(tenant, 's.branch_id', p2, branchId);
  const un = (await db.query(
    `SELECT COALESCE(SUM(GREATEST(s.quantity, 0) - COALESCE(b.binned, 0)) FILTER (WHERE s.quantity > COALESCE(b.binned, 0)), 0) AS n
     FROM branch_stock s JOIN autoparts_parts ap ON ap.product_id = s.product_id
     LEFT JOIN (SELECT business_id, branch_id, product_id, SUM(qty) AS binned FROM bin_stock GROUP BY business_id, branch_id, product_id) b ON b.branch_id = s.branch_id AND b.product_id = s.product_id
     WHERE ${w2}`, p2)).rows[0];
  const p3 = [];
  const tasks = (await db.query(`SELECT COUNT(*) AS n FROM putaway_tasks t WHERE ${scope(tenant, 't.branch_id', p3, branchId)} AND t.status = 'OPEN'`, p3)).rows[0].n;
  const p4 = [];
  const holds = (await db.query(`SELECT COUNT(*) AS n, COALESCE(SUM(qty - qty_fulfilled), 0) AS units FROM part_reservations r WHERE ${scope(tenant, 'r.branch_id', p4, branchId)} AND r.status = 'OPEN'`, p4)).rows[0];
  const p5 = [];
  const claims = (await db.query(`SELECT COUNT(*) AS n FROM supplier_claims c WHERE ${scope(tenant, 'c.branch_id', p5, branchId)} AND c.status = 'OPEN'`, p5)).rows[0].n;
  const parts = Number((await db.query(`SELECT COUNT(*) AS n FROM autoparts_parts ap JOIN products p ON p.product_id = ap.product_id WHERE ap.business_id = $1 AND p.status = 'ACTIVE'`, [tenant.businessId])).rows[0].n);
  return {
    parts, parts_in_stock: num(st.parts_in_stock), units: q3(st.units), stock_cost_paise: num(st.cost_paise), stock_value_paise: num(st.sell_paise),
    below_reorder: num(st.below_reorder), out_of_stock: num(st.out_of_stock), unassigned_units: q3(un.n), open_putaway_tasks: num(tasks), open_holds: num(holds.n), held_units: q3(holds.units), open_claims: num(claims)
  };
};

export const movers = async (db, tenant, { branchId = null, limit = 100, only = null } = {}) => {
  const settings = await getSettings(db, tenant.businessId);
  const params = [tenant.businessId];
  const b = tenant.scopeBranchId ?? (branchId ? Number(branchId) : null);
  let invScope = 'i.business_id = $1';
  let stockScope = 'bs.branch_id IN (SELECT branch_id FROM branches WHERE business_id = $1)';
  if (b != null) { params.push(b); invScope += ` AND i.branch_id = $2`; stockScope = 'bs.branch_id = $2'; }
  const rows = (await db.query(
    `WITH sold AS (
       SELECT ii.product_id, SUM(ii.quantity * COALESCE(ii.unit_factor, 1)) FILTER (WHERE i.invoice_date >= CURRENT_DATE - 30) AS q30,
              SUM(ii.quantity * COALESCE(ii.unit_factor, 1)) FILTER (WHERE i.invoice_date >= CURRENT_DATE - 90) AS q90, MAX(i.invoice_date) AS last_sale
       FROM invoice_items ii JOIN invoices i ON i.invoice_id = ii.invoice_id WHERE ${invScope} AND i.status = 'ISSUED' AND ii.product_id IS NOT NULL GROUP BY ii.product_id),
     held AS (SELECT bs.product_id, SUM(GREATEST(bs.quantity, 0)) AS qty FROM branch_stock bs WHERE ${stockScope} GROUP BY bs.product_id)
     SELECT p.product_id, p.name, p.sku, COALESCE(h.qty, 0) AS on_hand, p.purchase_price_paise, COALESCE(s.q30, 0) AS sold_30, COALESCE(s.q90, 0) AS sold_90, s.last_sale, p.created_at::date AS added,
            (CURRENT_DATE - COALESCE(s.last_sale, p.created_at::date)) AS idle_days
     FROM products p JOIN autoparts_parts ap ON ap.product_id = p.product_id LEFT JOIN sold s ON s.product_id = p.product_id LEFT JOIN held h ON h.product_id = p.product_id
     WHERE p.business_id = $1 AND p.status = 'ACTIVE'`, params)).rows;
  const sellers = rows.map((r) => num(r.sold_30)).filter((n) => n > 0).sort((a, c) => a - c);
  const fastCut = sellers.length ? sellers[Math.floor(sellers.length * 0.8)] : Infinity;
  const out = rows.map((r) => {
    const onHand = num(r.on_hand); const idle = num(r.idle_days);
    let cls = 'MEDIUM';
    if (onHand > 0 && idle >= settings.dead_days) cls = 'DEAD';
    else if (onHand > 0 && idle >= settings.slow_days) cls = 'SLOW';
    else if (num(r.sold_30) > 0 && num(r.sold_30) >= fastCut) cls = 'FAST';
    else if (onHand <= 0 && num(r.sold_90) === 0) cls = 'NONE';
    const perDay = num(r.sold_90) / 90;
    return { product_id: r.product_id, name: r.name, sku: r.sku, class: cls, on_hand: q3(onHand), sold_30: q3(r.sold_30), sold_90: q3(r.sold_90), last_sale: r.last_sale, idle_days: idle,
      days_of_cover: perDay > 0 ? Math.round(onHand / perDay) : null, stock_cost_paise: Math.round(onHand * num(r.purchase_price_paise)) };
  });
  const summary = {};
  for (const r of out) { summary[r.class] ??= { parts: 0, stock_cost_paise: 0 }; summary[r.class].parts += 1; summary[r.class].stock_cost_paise += r.stock_cost_paise; }
  const list = out.filter((r) => (only ? r.class === only : r.class !== 'NONE')).sort((a, c) => (only === 'FAST' ? c.sold_30 - a.sold_30 : c.stock_cost_paise - a.stock_cost_paise)).slice(0, limit);
  return { rules: { dead: `stock on hand and no sale for ${settings.dead_days} days or more`, slow: `stock on hand and no sale for ${settings.slow_days} days or more`, fast: 'in the top fifth by units sold in the last 30 days' }, summary, parts: list };
};

export const ageing = async (db, tenant, { branchId = null } = {}) => {
  const params = [];
  const w = scope(tenant, 'bs.branch_id', params, branchId);
  const rows = (await db.query(
    `SELECT p.product_id, p.name, p.sku, SUM(GREATEST(bs.quantity, 0)) AS qty, p.purchase_price_paise,
            (CURRENT_DATE - COALESCE((SELECT MAX(t.created_at)::date FROM inventory_transactions t WHERE t.product_id = p.product_id AND t.transaction_type = 'PURCHASE' AND t.quantity > 0), p.created_at::date)) AS days
     FROM branch_stock bs JOIN products p ON p.product_id = bs.product_id JOIN autoparts_parts ap ON ap.product_id = p.product_id
     WHERE ${w} AND bs.quantity > 0 AND p.status = 'ACTIVE' GROUP BY p.product_id`, params)).rows;
  const buckets = [['0-30', 0, 30], ['31-90', 31, 90], ['91-180', 91, 180], ['181-365', 181, 365], ['over 365', 366, 1e9]].map(([label, lo, hi]) => ({ label, lo, hi, parts: 0, units: 0, cost_paise: 0 }));
  for (const r of rows) {
    const bkt = buckets.find((x) => num(r.days) >= x.lo && num(r.days) <= x.hi);
    bkt.parts += 1; bkt.units = q3(bkt.units + num(r.qty)); bkt.cost_paise += Math.round(num(r.qty) * num(r.purchase_price_paise));
  }
  return { basis: 'days since the part last arrived on a receipt (or was added)', buckets: buckets.map(({ lo, hi, ...x }) => x) };
};

export const reorder = async (db, tenant, { branchId = null } = {}) => {
  const settings = await getSettings(db, tenant.businessId);
  const b = tenant.scopeBranchId ?? (branchId ? Number(branchId) : null);
  const cover = settings.safety_days + settings.review_days;
  const params = [tenant.businessId];
  let invScope = ''; let stockScope = 'bs.branch_id IN (SELECT branch_id FROM branches WHERE business_id = $1)';
  if (b != null) { params.push(b); invScope = ` AND i.branch_id = $2`; stockScope = 'bs.branch_id = $2'; }
  const rows = (await db.query(
    `WITH sold AS (SELECT ii.product_id, SUM(ii.quantity * COALESCE(ii.unit_factor, 1)) AS q90 FROM invoice_items ii JOIN invoices i ON i.invoice_id = ii.invoice_id
                   WHERE i.business_id = $1 AND i.status = 'ISSUED' AND i.invoice_date >= CURRENT_DATE - 90${invScope} AND ii.product_id IS NOT NULL GROUP BY ii.product_id),
          have AS (SELECT bs.product_id, SUM(bs.quantity) AS qty FROM branch_stock bs WHERE ${stockScope} GROUP BY bs.product_id),
          ordered AS (SELECT oi.product_id, SUM(oi.quantity - COALESCE(oi.received_quantity, 0)) AS qty FROM purchase_order_items oi JOIN purchase_orders po ON po.po_id = oi.po_id
                      WHERE po.business_id = $1 AND po.status IN ('ORDERED','CONFIRMED','PARTIAL') AND oi.quantity > COALESCE(oi.received_quantity, 0) GROUP BY oi.product_id)
     SELECT p.product_id, p.name, p.sku, COALESCE(h.qty, 0) AS on_hand, COALESCE(o.qty, 0) AS on_order, COALESCE(s.q90, 0) AS sold_90, ap.reorder_level, p.min_stock, ap.max_stock, p.lead_time_days,
            ap.preferred_supplier_id, su.name AS supplier, p.purchase_price_paise
     FROM products p JOIN autoparts_parts ap ON ap.product_id = p.product_id LEFT JOIN have h ON h.product_id = p.product_id LEFT JOIN sold s ON s.product_id = p.product_id
     LEFT JOIN ordered o ON o.product_id = p.product_id LEFT JOIN suppliers su ON su.supplier_id = ap.preferred_supplier_id WHERE p.business_id = $1 AND p.status = 'ACTIVE'`, params)).rows;
  const out = [];
  for (const r of rows) {
    const onHand = num(r.on_hand); const onOrder = num(r.on_order); const perDay = num(r.sold_90) / 90;
    const level = r.reorder_level != null ? num(r.reorder_level) : (num(r.min_stock) > 0 ? num(r.min_stock) : null);
    const lead = Math.max(0, num(r.lead_time_days));
    let target = perDay * (lead + cover); let rule = null;
    if (perDay > 0) rule = `sells ${q3(perDay * 7)} a week; covers ${lead} days lead time + ${cover} days review and safety`;
    if (level != null && target < level) { target = level; rule = `keep at least the reorder level of ${level}`; }
    let need = Math.ceil(target - onHand - onOrder - 1e-9);
    if (level != null && onHand > level && perDay === 0) need = 0;
    if (!(need > 0)) continue;
    if (r.max_stock != null) need = Math.min(need, Math.max(0, Math.floor(num(r.max_stock) - onHand - onOrder)));
    if (!(need > 0)) continue;
    out.push({ product_id: r.product_id, name: r.name, sku: r.sku, on_hand: q3(onHand), on_order: q3(onOrder), sold_90: q3(r.sold_90), suggested_qty: need, supplier_id: r.preferred_supplier_id, supplier: r.supplier,
      est_cost_paise: Math.round(need * num(r.purchase_price_paise)), rule });
  }
  out.sort((a, c) => (a.supplier || '').localeCompare(c.supplier || '') || c.est_cost_paise - a.est_cost_paise);
  return { settings: { safety_days: settings.safety_days, review_days: settings.review_days }, note: 'A suggestion, not an order. Nothing is bought until you make a purchase order.', parts: out.slice(0, 500) };
};

export const togetherWith = async (db, tenant, productId, { days = 180, min = 2, limit = 10 } = {}) => (await db.query(
  `SELECT p.product_id, p.name, p.sku, COUNT(DISTINCT b.invoice_id)::int AS bills
   FROM invoice_items a JOIN invoice_items b ON b.invoice_id = a.invoice_id AND b.product_id <> a.product_id JOIN invoices i ON i.invoice_id = a.invoice_id
   JOIN products p ON p.product_id = b.product_id AND p.status = 'ACTIVE'
   WHERE i.business_id = $1 AND i.status = 'ISSUED' AND a.product_id = $2 AND i.invoice_date >= CURRENT_DATE - $3::int${tenant.scopeBranchId != null ? ' AND i.branch_id = $6' : ''}
   GROUP BY p.product_id HAVING COUNT(DISTINCT b.invoice_id) >= $4 ORDER BY bills DESC, p.name LIMIT $5`,
  tenant.scopeBranchId != null ? [tenant.businessId, Number(productId), days, min, limit, tenant.scopeBranchId] : [tenant.businessId, Number(productId), days, min, limit])).rows;

export const supplierScore = async (db, tenant, { branchId = null } = {}) => {
  const params = [];
  const w = scope(tenant, 'g.branch_id', params, branchId);
  const rows = (await db.query(
    `SELECT s.supplier_id, s.name, COUNT(DISTINCT g.grn_id)::int AS receipts, SUM(i.received_base) AS received, SUM(i.accepted_base) AS accepted, SUM(i.damaged_base) AS damaged, SUM(i.rejected_base) AS rejected,
            SUM(i.ordered_base) FILTER (WHERE i.ordered_base IS NOT NULL) AS ordered, SUM(i.accepted_base) FILTER (WHERE i.ordered_base IS NOT NULL) AS accepted_on_orders,
            AVG(g.grn_date - po.po_date) FILTER (WHERE po.source IS DISTINCT FROM 'MANUAL' AND po.po_date IS NOT NULL) AS lead_days,
            COALESCE((SELECT COUNT(*) FROM supplier_claims c WHERE c.supplier_id = s.supplier_id AND c.status = 'OPEN'), 0)::int AS open_claims
     FROM wholesale_grns g JOIN wholesale_grn_items i ON i.grn_id = g.grn_id JOIN suppliers s ON s.supplier_id = g.supplier_id LEFT JOIN purchase_orders po ON po.po_id = g.po_id
     WHERE ${w} AND g.status = 'POSTED' GROUP BY s.supplier_id ORDER BY s.name`, params)).rows;
  const pct = (a, c) => (num(c) > 0 ? Math.round(num(a) / num(c) * 1000) / 10 : null);
  return rows.map((r) => ({ supplier_id: r.supplier_id, supplier: r.name, receipts: r.receipts, received: q3(r.received), accepted: q3(r.accepted), damaged: q3(r.damaged), rejected: q3(r.rejected),
    damaged_pct: pct(r.damaged, r.received), rejected_pct: pct(r.rejected, r.received), fill_rate_pct: pct(r.accepted_on_orders, r.ordered), lead_days: r.lead_days == null ? null : Math.round(num(r.lead_days) * 10) / 10, open_claims: r.open_claims }));
};

export const valuation = async (db, tenant, { branchId = null } = {}) => {
  const params = [];
  const w = scope(tenant, 'bs.branch_id', params, branchId);
  const rows = (await db.query(
    `SELECT COALESCE(c.name, 'No category') AS category, COUNT(DISTINCT p.product_id)::int AS parts, SUM(GREATEST(bs.quantity, 0)) AS units,
            SUM(GREATEST(bs.quantity, 0) * p.purchase_price_paise) AS cost_paise, SUM(GREATEST(bs.quantity, 0) * p.selling_price_paise) AS sell_paise
     FROM branch_stock bs JOIN products p ON p.product_id = bs.product_id JOIN autoparts_parts ap ON ap.product_id = p.product_id LEFT JOIN categories c ON c.category_id = p.category_id
     WHERE ${w} AND p.status = 'ACTIVE' GROUP BY c.name ORDER BY cost_paise DESC NULLS LAST`, params)).rows;
  const list = rows.map((r) => ({ category: r.category, parts: r.parts, units: q3(r.units), cost_paise: num(r.cost_paise), sell_paise: num(r.sell_paise) }));
  return { categories: list, total_cost_paise: list.reduce((s, r) => s + r.cost_paise, 0), total_sell_paise: list.reduce((s, r) => s + r.sell_paise, 0) };
};

export const occupancy = async (db, tenant, { branchId = null } = {}) => {
  const params = [];
  const w = scope(tenant, 'l.branch_id', params, branchId);
  const rows = (await db.query(
    `SELECT l.location_id, l.code, l.capacity_units, COALESCE(SUM(s.qty), 0) AS qty, COUNT(s.product_id) FILTER (WHERE s.qty > 0) AS parts
     FROM warehouse_locations l LEFT JOIN bin_stock s ON s.location_id = l.location_id WHERE ${w} AND l.can_store AND l.is_active GROUP BY l.location_id ORDER BY l.code`, params)).rows;
  const occupied = rows.filter((r) => num(r.qty) > 0);
  const withCap = rows.filter((r) => r.capacity_units != null && num(r.capacity_units) > 0);
  return {
    storing_locations: rows.length, occupied: occupied.length, empty: rows.length - occupied.length,
    over_capacity: withCap.filter((r) => num(r.qty) > num(r.capacity_units)).map((r) => ({ code: r.code, qty: q3(r.qty), capacity: num(r.capacity_units) })),
    fill_pct: withCap.length ? Math.round(withCap.reduce((s, r) => s + Math.min(num(r.qty), num(r.capacity_units)), 0) / withCap.reduce((s, r) => s + num(r.capacity_units), 0) * 1000) / 10 : null,
    fullest: [...withCap].sort((a, c) => num(c.qty) / num(c.capacity_units) - num(a.qty) / num(a.capacity_units)).slice(0, 10).map((r) => ({ code: r.code, qty: q3(r.qty), capacity: num(r.capacity_units), pct: Math.round(num(r.qty) / num(r.capacity_units) * 1000) / 10 })),
    empty_locations: rows.filter((r) => num(r.qty) === 0).slice(0, 30).map((r) => r.code)
  };
};

export const partLedger = async (db, tenant, productId, { limit = 200 } = {}) => {
  const own = (await db.query(`SELECT name, sku FROM products WHERE product_id = $1 AND business_id = $2`, [Number(productId), tenant.businessId])).rows[0];
  if (!own) return null;
  const sc = tenant.scopeBranchId != null ? ' AND branch_id = $3' : '';
  const p = tenant.scopeBranchId != null ? [Number(productId), tenant.businessId, tenant.scopeBranchId] : [Number(productId), tenant.businessId];
  const stock = (await db.query(`SELECT created_at AS at, transaction_type AS kind, quantity AS qty, reference_type AS ref_type, reference_id AS ref_id, notes AS note, 'STOCK' AS ledger FROM inventory_transactions WHERE product_id = $1 AND business_id = $2${sc} ORDER BY created_at DESC LIMIT ${Number(limit) | 0}`, p)).rows;
  const moves = (await db.query(
    `SELECT m.created_at AS at, m.kind, m.qty, m.ref_type, m.ref_id, m.note, 'BIN' AS ledger, f.code AS from_code, t.code AS to_code FROM bin_moves m LEFT JOIN warehouse_locations f ON f.location_id = m.from_location_id LEFT JOIN warehouse_locations t ON t.location_id = m.to_location_id
     WHERE m.product_id = $1 AND m.business_id = $2${sc.replace('branch_id', 'm.branch_id')} ORDER BY m.created_at DESC LIMIT ${Number(limit) | 0}`, p)).rows;
  return { part: own, movements: [...stock, ...moves].map((r) => ({ ...r, qty: Number(r.qty) })).sort((a, c) => new Date(c.at) - new Date(a.at)).slice(0, limit) };
};
