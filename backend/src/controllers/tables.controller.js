/*
 * Dining tables. Occupancy is derived from whether a table has a running
 * order — see uq_orders_open_table in schema.orders.js — never stored as its
 * own flag, so a table can't drift out of sync with the order that actually
 * says whether it's busy.
 */
import crypto from 'node:crypto';
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { branchFilter } from '../utils/scope.js';
import { eligibleWaiters, isEligibleWaiter } from '../modules/waiters.js';

const asTable = (row) => ({
  table_id: row.table_id,
  branch_id: row.branch_id,
  name: row.name,
  zone: row.zone,
  seats: row.seats,
  status: row.status,
  // NULL open_order_id means free regardless of `status` — a RESERVED table
  // with no order yet is still "not occupied" in the sense that matters for
  // billing.
  open_order_id: row.open_order_id,
  open_order_number: row.open_order_number,
  qr_token: row.qr_token,
  waiter_user_id: row.waiter_user_id ?? null,
  waiter_name: row.waiter_name ?? null,
  // the next booking on this table within the hour, so the floor can hold it back
  next_reservation: row.next_res_at ? { reserved_at: row.next_res_at, guest_name: row.next_res_guest, party_size: row.next_res_party } : null
});

/* ==========================================================================
   GET /api/tables
   ========================================================================== */
export const list = async (req, res) => {
  const values = [req.tenant.businessId];
  const scope = branchFilter(req.tenant, 't.branch_id', values);
  const { rows } = await pool.query(
    `SELECT t.*, o.order_id AS open_order_id, o.order_number AS open_order_number,
            w.name AS waiter_name, nr.reserved_at AS next_res_at, nr.guest_name AS next_res_guest, nr.party_size AS next_res_party
     FROM dining_tables t
     LEFT JOIN users w ON w.user_id = t.waiter_user_id
     LEFT JOIN LATERAL (
       SELECT r.reserved_at, r.guest_name, r.party_size FROM reservations r
       WHERE r.table_id = t.table_id AND r.status = 'BOOKED'
         AND r.reserved_at < CURRENT_TIMESTAMP + INTERVAL '60 minutes'
         AND r.reserved_at + make_interval(mins => r.duration_min) > CURRENT_TIMESTAMP
       ORDER BY r.reserved_at LIMIT 1) nr ON TRUE
     LEFT JOIN orders o ON o.table_id = t.table_id AND o.status NOT IN ('BILLED','CANCELLED','MERGED')
     WHERE t.business_id = $1 AND t.status <> 'CLOSED'${scope}
     ORDER BY t.zone NULLS FIRST, t.name`,
    values
  );
  res.json({ success: true, data: rows.map(asTable) });
};

/* ==========================================================================
   POST /api/tables
   ========================================================================== */
export const create = async (req, res) => {
  const { name, zone, seats } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ success: false, message: 'Enter a table name or number' });

  const { rows } = await pool.query(
    `INSERT INTO dining_tables (business_id, branch_id, name, zone, seats, qr_token) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.tenant.businessId, req.tenant.branchId, String(name).trim(), zone || null, seats || null, crypto.randomBytes(20).toString('hex')]
  );
  res.status(201).json({ success: true, data: asTable(rows[0]) });
};

/* ==========================================================================
   PATCH /api/tables/:id
   ========================================================================== */
export const update = async (req, res) => {
  const body = req.body || {};
  const fields = [];
  const values = [];

  if (body.name != null) { values.push(String(body.name).trim()); fields.push(`name = $${values.length}`); }
  if (body.zone !== undefined) { values.push(body.zone); fields.push(`zone = $${values.length}`); }
  if (body.seats !== undefined) { values.push(body.seats); fields.push(`seats = $${values.length}`); }
  if (body.status) {
    if (!['FREE', 'RESERVED', 'CLEANING', 'CLOSED'].includes(body.status)) {
      return res.status(400).json({ success: false, message: 'Invalid table status' });
    }
    values.push(body.status); fields.push(`status = $${values.length}`);
  }
  if (body.waiter_user_id !== undefined) {
    const waiterId = body.waiter_user_id ? Number(body.waiter_user_id) : null;
    const own = (await pool.query(`SELECT branch_id FROM dining_tables WHERE table_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
    if (waiterId && own && !(await isEligibleWaiter(pool, req.tenant.businessId, own.branch_id, waiterId))) {
      return res.status(400).json({ success: false, message: 'Choose a waiter who works at this outlet' });
    }
    values.push(waiterId); fields.push(`waiter_user_id = $${values.length}`);
  }
  if (!fields.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

  values.push(req.params.id, req.tenant.businessId);
  const scope = branchFilter(req.tenant, 'branch_id', values);
  const { rows } = await pool.query(
    `UPDATE dining_tables SET ${fields.join(', ')} WHERE table_id = $${values.length - (scope ? 2 : 1)} AND business_id = $${values.length - (scope ? 1 : 0)}${scope} RETURNING *`,
    values
  );
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  recordAudit(req, { action: 'table.updated', resource_type: 'table', resource_id: req.params.id, metadata: body });
  if (rows[0].waiter_user_id) rows[0].waiter_name = (await pool.query(`SELECT name FROM users WHERE user_id = $1`, [rows[0].waiter_user_id])).rows[0]?.name;
  res.json({ success: true, data: asTable(rows[0]) });
};

/* GET /api/tables/waiters — the team members a table can be assigned to at the active outlet */
export const waiters = async (req, res) => {
  res.json({ success: true, data: await eligibleWaiters(pool, req.tenant.businessId, req.tenant.branchId) });
};
