/*
 * Printers screen API (modules/printers.js): the business's printers and, for the outlet being worked in, where each slip goes.
 *   GET /printers                 the printers of this outlet (and shared ones) + this outlet's routing
 *   POST /printers  PATCH /printers/:id  DELETE /printers/:id
 *   PUT /printers/routing         { receipt, takeaway, drawer, kot, stations: { <station_id>: <printer_id> } } for this outlet
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { cleanPrinter, cleanRouting, routedIds } from '../modules/printers.js';

const fail = (res, status, message) => res.status(status).json({ success: false, message });

/** The printers an outlet can use (its own and the shared ones) and its routing. Also used by the print jobs. */
export const loadFor = async (db, businessId, branchId) => {
  const printers = (await db.query(
    `SELECT printer_id, branch_id, name, connection, address, paper_width, is_active FROM printers
     WHERE business_id = $1 AND (branch_id IS NULL OR branch_id = $2) ORDER BY name`, [businessId, branchId])).rows;
  const routing = (await db.query(`SELECT print_routing FROM branches WHERE business_id = $1 AND branch_id = $2`, [businessId, branchId])).rows[0]?.print_routing || {};
  return { printers, routing };
};

export const list = async (req, res) => {
  res.json({ success: true, data: await loadFor(pool, req.tenant.businessId, req.tenant.branchId) });
};

export const create = async (req, res) => {
  const { printer, error } = cleanPrinter(req.body);
  if (error) return fail(res, 400, error);
  try {
    const { rows } = await pool.query(
      `INSERT INTO printers (business_id, branch_id, name, connection, address, paper_width) VALUES ($1,$2,$3,$4,$5,$6) RETURNING printer_id`,
      [req.tenant.businessId, req.body.all_outlets === true ? null : req.tenant.branchId, printer.name, printer.connection, printer.address, printer.paper_width]);
    recordAudit(req, { action: 'printer.created', resource_type: 'printer', resource_id: rows[0].printer_id, metadata: { name: printer.name, connection: printer.connection } });
    res.status(201).json({ success: true, data: { printer_id: rows[0].printer_id } });
  } catch (e) {
    if (e.code === '23505') return fail(res, 409, 'You already have a printer with that name');
    throw e;
  }
};

export const update = async (req, res) => {
  const { printer, error } = cleanPrinter(req.body, { partial: true });
  if (error) return fail(res, 400, error);
  const sets = []; const values = [req.tenant.businessId, req.params.id];
  for (const [key, value] of Object.entries(printer)) { values.push(value); sets.push(`${key} = $${values.length}`); }
  if (!sets.length) return fail(res, 400, 'Nothing to change');
  try {
    const { rowCount } = await pool.query(`UPDATE printers SET ${sets.join(', ')} WHERE business_id = $1 AND printer_id = $2`, values);
    if (!rowCount) return fail(res, 404, 'Not found');
  } catch (e) {
    if (e.code === '23505') return fail(res, 409, 'You already have a printer with that name');
    throw e;
  }
  recordAudit(req, { action: 'printer.updated', resource_type: 'printer', resource_id: Number(req.params.id), metadata: printer });
  res.json({ success: true });
};

export const remove = async (req, res) => {
  const { rowCount } = await pool.query(`DELETE FROM printers WHERE business_id = $1 AND printer_id = $2`, [req.tenant.businessId, req.params.id]);
  if (!rowCount) return fail(res, 404, 'Not found');
  recordAudit(req, { action: 'printer.deleted', resource_type: 'printer', resource_id: Number(req.params.id) });
  res.json({ success: true });   // a routing that still names it simply finds no printer and falls back (modules/printers.js pickPrinter)
};

export const saveRouting = async (req, res) => {
  const { routing, error } = cleanRouting(req.body);
  if (error) return fail(res, 400, error);
  const ids = [...new Set(routedIds(routing))];
  if (ids.length) {
    const have = (await pool.query(
      `SELECT printer_id FROM printers WHERE business_id = $1 AND printer_id = ANY($2::int[]) AND (branch_id IS NULL OR branch_id = $3)`, [req.tenant.businessId, ids, req.tenant.branchId])).rows.length;
    if (have !== ids.length) return fail(res, 400, 'One of the printers you chose is not available at this outlet');
  }
  const stations = Object.keys(routing.stations).map(Number);
  if (stations.length) {
    const ok = (await pool.query(`SELECT station_id FROM kitchen_stations WHERE business_id = $1 AND station_id = ANY($2::int[])`, [req.tenant.businessId, stations])).rows.length;
    if (ok !== stations.length) return fail(res, 400, 'One of the kitchen stations was not found');
  }
  await pool.query(`UPDATE branches SET print_routing = $3::jsonb WHERE business_id = $1 AND branch_id = $2`, [req.tenant.businessId, req.tenant.branchId, JSON.stringify(routing)]);
  recordAudit(req, { action: 'printer.routing_saved', resource_type: 'branch', resource_id: req.tenant.branchId, metadata: routing });
  res.json({ success: true });
};
