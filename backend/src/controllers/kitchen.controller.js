/*
 * The kitchen: live tickets by station, moving items through the pass, station
 * and routing setup, and how the kitchen has been performing.
 *
 * Tickets are read with one query and grouped per order; the display filters by
 * station on the client so a single poll serves every screen in the kitchen.
 */
import pool from '../config/database.js';
import { componentLabels, loadCombos } from '../modules/combos.js';
import { recordAudit } from '../modules/events.js';
import { minutesSince, performance, urgency } from '../modules/kitchen.js';
import { addDaysISO, businessToday } from '../utils/dates.js';
import { branchFilter } from '../utils/scope.js';

const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });
const CANCEL_VISIBLE_MINUTES = 15;

/* GET /api/kitchen/tickets */
export const tickets = async (req, res) => {
  const id = req.tenant.businessId;
  const values = [id, String(CANCEL_VISIBLE_MINUTES)];
  const scope = branchFilter(req.tenant, 'o.branch_id', values);
  const [rows, stations] = await Promise.all([
    pool.query(
      `SELECT oi.order_item_id, oi.order_id, oi.product_id, oi.description, oi.quantity, oi.kitchen_notes, oi.modifiers, oi.status, oi.station_id,
              oi.expected_minutes, oi.sent_at, oi.ready_at, oi.served_at, oi.cancelled_at,
              o.order_number, o.order_type, o.platform, t.name AS table_name, k.priority, k.kot_number
       FROM order_items oi
       JOIN orders o ON o.order_id = oi.order_id
       LEFT JOIN dining_tables t ON t.table_id = o.table_id
       LEFT JOIN kot_tickets k ON k.kot_id = oi.kot_id
       WHERE o.business_id = $1 AND oi.sent_at IS NOT NULL${scope}
         AND (o.status IN ('OPEN','PREPARING','READY','SERVED') OR (o.status = 'BILLED' AND oi.status IN ('PREPARING','READY') AND oi.sent_at > now() - interval '6 hours'))
         AND (oi.status IN ('PREPARING','READY')
              OR (oi.status = 'SERVED' AND oi.served_at > now() - interval '2 hours')
              OR (oi.status = 'CANCELLED' AND oi.cancelled_at > now() - ($2 || ' minutes')::interval))
       ORDER BY (k.priority = 'RUSH') DESC, oi.sent_at, oi.order_item_id`,
      values
    ),
    pool.query(`SELECT station_id, name FROM kitchen_stations WHERE business_id = $1 AND is_active ORDER BY sort_order, station_id`, [id])
  ]);

  const combos = await loadCombos(pool, id, [...new Set(rows.rows.map((r) => r.product_id).filter(Boolean))]);
  const byOrder = new Map();
  for (const r of rows.rows) {
    if (!byOrder.has(r.order_id)) {
      byOrder.set(r.order_id, { order_id: r.order_id, order_number: r.order_number, order_type: r.order_type, platform: r.platform, table_name: r.table_name, priority: r.priority || 'NORMAL', sent_at: r.sent_at, items: [] });
    }
    const making = r.status === 'PREPARING';
    const elapsed = making ? minutesSince(r.sent_at) : null;
    byOrder.get(r.order_id).items.push({
      order_item_id: r.order_item_id, description: r.description, combo: componentLabels(combos.get(r.product_id)), quantity: Number(r.quantity), modifiers: r.modifiers || [], kitchen_notes: r.kitchen_notes,
      status: r.status, station_id: r.station_id, expected_minutes: r.expected_minutes, sent_at: r.sent_at,
      elapsed_minutes: elapsed, urgency: making ? urgency(elapsed, r.expected_minutes) : null,
      prep_minutes: r.ready_at ? Math.round((new Date(r.ready_at) - new Date(r.sent_at)) / 60000) : null,
      cancelled: r.status === 'CANCELLED'
    });
    if (r.priority === 'RUSH') byOrder.get(r.order_id).priority = 'RUSH';
  }
  const list = [...byOrder.values()];

  const counts = (stationId) => {
    const items = list.flatMap((t) => t.items).filter((i) => i.status === 'PREPARING' && (stationId === 'all' || (stationId === null ? i.station_id == null : i.station_id === stationId)));
    return { making: items.length, late: items.filter((i) => i.urgency === 'late').length };
  };
  res.json({
    success: true,
    data: {
      stations: [
        { station_id: 'all', name: 'All', ...counts('all') },
        ...stations.rows.map((s) => ({ station_id: s.station_id, name: s.name, ...counts(s.station_id) })),
        ...(list.some((t) => t.items.some((i) => i.station_id == null)) && stations.rows.length ? [{ station_id: null, name: 'Unassigned', ...counts(null) }] : [])
      ],
      tickets: list
    }
  });
};

/* GET /api/kitchen/kots/:id — one ticket laid out for printing: its lines grouped by station, one slip per station */
export const printableKot = async (req, res) => {
  const values = [req.params.id, req.tenant.businessId];
  const scope = branchFilter(req.tenant, 'o.branch_id', values);
  const kot = (await pool.query(
    `SELECT k.kot_id, k.kot_number, k.priority, k.created_at, o.order_id, o.order_number, o.order_type, o.platform, o.notes AS order_notes,
            t.name AS table_name, br.name AS outlet_name, c.name AS customer_name
     FROM kot_tickets k JOIN orders o ON o.order_id = k.order_id
     LEFT JOIN dining_tables t ON t.table_id = o.table_id LEFT JOIN branches br ON br.branch_id = o.branch_id LEFT JOIN customers c ON c.customer_id = o.customer_id
     WHERE k.kot_id = $1 AND k.business_id = $2${scope}`, values
  )).rows[0];
  if (!kot) return bad(res, 'Not found', 404);

  const items = (await pool.query(
    `SELECT oi.product_id, oi.description, oi.quantity, oi.modifiers, oi.kitchen_notes, oi.station_id, COALESCE(s.name, 'Kitchen') AS station_name, COALESCE(s.sort_order, 999) AS sort
     FROM order_items oi LEFT JOIN kitchen_stations s ON s.station_id = oi.station_id
     WHERE oi.kot_id = $1 AND oi.status <> 'CANCELLED' ORDER BY COALESCE(s.sort_order, 999), oi.order_item_id`, [kot.kot_id]
  )).rows;

  const combos = await loadCombos(pool, req.tenant.businessId, [...new Set(items.map((i) => i.product_id).filter(Boolean))]);
  const stations = [];
  for (const i of items) {
    let group = stations.find((s) => s.station_id === (i.station_id ?? null));
    if (!group) { group = { station_id: i.station_id ?? null, name: i.station_name, items: [] }; stations.push(group); }
    group.items.push({ description: i.description, combo: componentLabels(combos.get(i.product_id)), quantity: Number(i.quantity), modifiers: (i.modifiers || []).map((m) => m.name), kitchen_notes: i.kitchen_notes });
  }
  res.json({
    success: true,
    data: {
      kot_id: kot.kot_id, kot_number: kot.kot_number, priority: kot.priority, created_at: kot.created_at,
      order_number: kot.order_number, order_type: kot.order_type, platform: kot.platform, table_name: kot.table_name,
      outlet: kot.outlet_name, customer: kot.customer_name, order_notes: kot.order_notes, stations
    }
  });
};

/* POST /api/kitchen/advance { item_ids, status } — move lines through the pass */
export const advance = async (req, res) => {
  const { item_ids: ids, status } = req.body || {};
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every((n) => Number.isInteger(Number(n)))) return bad(res, 'Choose the items to update');
  if (!['PREPARING', 'READY', 'SERVED'].includes(status)) return bad(res, 'Status must be PREPARING, READY or SERVED');

  const values = [ids.map(Number), status, req.tenant.businessId];
  const scope = branchFilter(req.tenant, 'branch_id', values);
  const { rows } = await pool.query(
    `UPDATE order_items oi SET status = $2::varchar,
            ready_at = CASE WHEN $2::varchar IN ('READY','SERVED') THEN COALESCE(oi.ready_at, CURRENT_TIMESTAMP) ELSE NULL END,
            served_at = CASE WHEN $2::varchar = 'SERVED' THEN COALESCE(oi.served_at, CURRENT_TIMESTAMP) ELSE NULL END
     WHERE oi.order_item_id = ANY($1::int[]) AND oi.status IN ('PREPARING','READY','SERVED') AND oi.sent_at IS NOT NULL
       AND oi.order_id IN (SELECT order_id FROM orders WHERE business_id = $3${scope})
     RETURNING oi.order_item_id, oi.order_id`,
    values
  );
  if (!rows.length) return bad(res, 'Nothing to update', 404);
  res.json({ success: true, data: { updated: rows.length } });
};

/* POST /api/kitchen/orders/:id/rush — the guest is asking again */
export const rush = async (req, res) => {
  const values = [req.params.id, req.tenant.businessId];
  const scope = branchFilter(req.tenant, 'branch_id', values);
  const { rowCount } = await pool.query(
    `UPDATE kot_tickets SET priority = 'RUSH'
     WHERE order_id = $1 AND business_id = $2 AND kot_id IN (SELECT kot_id FROM order_items WHERE order_id = $1 AND status = 'PREPARING')
       AND order_id IN (SELECT order_id FROM orders WHERE business_id = $2${scope})`,
    values
  );
  if (!rowCount) return bad(res, 'Nothing in the kitchen for that order to rush', 404);
  recordAudit(req, { action: 'kitchen.rush', resource_type: 'order', resource_id: req.params.id });
  res.json({ success: true });
};

/* ── stations and routing ─────────────────────────────────────────────────── */

export const listStations = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT s.station_id, s.name, s.sort_order, s.is_active, (SELECT COUNT(*)::int FROM products p WHERE p.station_id = s.station_id AND p.status = 'ACTIVE') AS dishes
     FROM kitchen_stations s WHERE s.business_id = $1 AND s.is_active ORDER BY s.sort_order, s.station_id`, [req.tenant.businessId]);
  res.json({ success: true, data: rows });
};

const cleanName = (name) => String(name || '').trim().slice(0, 60);

export const createStation = async (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return bad(res, 'Name the station');
  try {
    const { rows } = await pool.query(
      `INSERT INTO kitchen_stations (business_id, name, sort_order) VALUES ($1,$2,(SELECT COALESCE(MAX(sort_order),0)+1 FROM kitchen_stations WHERE business_id = $1)) RETURNING station_id, name`,
      [req.tenant.businessId, name]
    );
    recordAudit(req, { action: 'kitchen.station_created', resource_type: 'kitchen_station', resource_id: rows[0].station_id, metadata: { name } });
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    if (error.code === '23505') return bad(res, 'You already have a station with that name', 409);
    throw error;
  }
};

export const updateStation = async (req, res) => {
  const name = req.body?.name != null ? cleanName(req.body.name) : null;
  if (req.body?.name != null && !name) return bad(res, 'Name the station');
  try {
    const { rowCount } = await pool.query(
      `UPDATE kitchen_stations SET name = COALESCE($3, name), is_active = COALESCE($4, is_active) WHERE station_id = $1 AND business_id = $2`,
      [req.params.id, req.tenant.businessId, name, typeof req.body?.is_active === 'boolean' ? req.body.is_active : null]
    );
    if (!rowCount) return bad(res, 'Not found', 404);
    recordAudit(req, { action: 'kitchen.station_updated', resource_type: 'kitchen_station', resource_id: req.params.id, metadata: req.body });
    res.json({ success: true });
  } catch (error) {
    if (error.code === '23505') return bad(res, 'You already have a station with that name', 409);
    throw error;
  }
};

/* GET /api/kitchen/routing — every dish with where it is cooked and how long it takes */
export const getRouting = async (req, res) => {
  const [dishes, settings] = await Promise.all([
    pool.query(
      `SELECT p.product_id, p.name, c.name AS category, p.station_id, p.prep_minutes
       FROM products p LEFT JOIN categories c ON c.category_id = p.category_id
       WHERE p.business_id = $1 AND p.kind = 'DISH' AND p.status = 'ACTIVE' ORDER BY c.name NULLS LAST, p.name`, [req.tenant.businessId]),
    pool.query(`SELECT kitchen_default_prep_minutes AS default_prep_minutes FROM businesses WHERE business_id = $1`, [req.tenant.businessId])
  ]);
  res.json({ success: true, data: { default_prep_minutes: settings.rows[0].default_prep_minutes, dishes: dishes.rows } });
};

/* PUT /api/kitchen/routing { default_prep_minutes?, dishes: [{ product_id, station_id, prep_minutes }] } */
export const putRouting = async (req, res) => {
  const { dishes, default_prep_minutes: defaultMinutes } = req.body || {};
  if (defaultMinutes != null && !(Number.isInteger(Number(defaultMinutes)) && defaultMinutes >= 1 && defaultMinutes <= 240)) return bad(res, 'The default time must be 1 to 240 minutes');
  if (dishes != null && !Array.isArray(dishes)) return bad(res, 'dishes must be a list');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stationIds = new Set((await client.query(`SELECT station_id FROM kitchen_stations WHERE business_id = $1 AND is_active`, [req.tenant.businessId])).rows.map((r) => r.station_id));
    for (const d of dishes || []) {
      const station = d.station_id == null || d.station_id === '' ? null : Number(d.station_id);
      const minutes = d.prep_minutes == null || d.prep_minutes === '' ? null : Number(d.prep_minutes);
      if (station != null && !stationIds.has(station)) { await client.query('ROLLBACK'); return bad(res, 'A station was not found'); }
      if (minutes != null && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 240)) { await client.query('ROLLBACK'); return bad(res, 'Preparation time must be 1 to 240 minutes'); }
      const { rowCount } = await client.query(`UPDATE products SET station_id = $3, prep_minutes = $4 WHERE product_id = $1 AND business_id = $2`, [d.product_id, req.tenant.businessId, station, minutes]);
      if (!rowCount) { await client.query('ROLLBACK'); return bad(res, 'A dish was not found', 404); }
    }
    if (defaultMinutes != null) await client.query(`UPDATE businesses SET kitchen_default_prep_minutes = $2 WHERE business_id = $1`, [req.tenant.businessId, defaultMinutes]);
    await client.query('COMMIT');
    recordAudit(req, { action: 'kitchen.routing_updated', resource_type: 'kitchen', metadata: { dishes: dishes?.length || 0, default_prep_minutes: defaultMinutes ?? undefined } });
    res.json({ success: true });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/* ── performance ──────────────────────────────────────────────────────────── */

/* GET /api/kitchen/performance?from=&to= */
export const performanceReport = async (req, res) => {
  const id = req.tenant.businessId;
  const to = req.query.to || await businessToday(id);
  const from = req.query.from || addDaysISO(to, -13);
  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  if (!(days >= 3 && days <= 90)) return bad(res, 'Choose a range of 3 to 90 days');

  const data = await performance(id, from, to, addDaysISO(from, -days), addDaysISO(from, -1), pool, req.tenant.scopeBranchId ?? null);
  res.json({ success: true, data: { period: { from, to, days }, ...data } });
};
