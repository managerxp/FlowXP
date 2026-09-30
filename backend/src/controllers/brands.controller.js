/*
 * Virtual brands (owner's request, 2026-09-29) — one kitchen running several
 * storefronts ("Brand A — Biryani", "Brand B — Burgers"). A brand is a name
 * and an optional logo, tagged onto menu items and orders elsewhere
 * (products.controller.js, orders.controller.js); this file only manages the
 * catalog of brands themselves, the same small shape as categories.controller.js.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { checkName, firstError } from '../utils/validate.js';

const asBrand = (row) => ({ brand_id: row.brand_id, name: row.name, logo_url: row.logo_url, is_active: row.is_active });

/* GET /api/brands?status=active|all */
export const list = async (req, res) => {
  const values = [req.tenant.businessId];
  const activeOnly = req.query.status !== 'all';
  const { rows } = await pool.query(
    `SELECT * FROM brands WHERE business_id = $1 ${activeOnly ? 'AND is_active = TRUE' : ''} ORDER BY sort_order, name`,
    values
  );
  res.json({ success: true, data: rows.map(asBrand) });
};

/* POST /api/brands { name, logo_url? } */
export const create = async (req, res) => {
  const error = firstError([checkName(req.body?.name, 'Brand name')]);
  if (error) return res.status(400).json({ success: false, message: error });

  const { rows: sortRow } = await pool.query(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM brands WHERE business_id = $1`, [req.tenant.businessId]);
  const { rows } = await pool.query(
    `INSERT INTO brands (business_id, name, logo_url, sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.tenant.businessId, String(req.body.name).trim(), req.body.logo_url ? String(req.body.logo_url).trim() : null, sortRow[0].next]
  );
  recordAudit(req, { action: 'brand.created', resource_type: 'brand', resource_id: rows[0].brand_id });
  res.status(201).json({ success: true, data: asBrand(rows[0]) });
};

/* PATCH /api/brands/:id { name?, logo_url?, is_active? } */
export const update = async (req, res) => {
  const body = req.body || {};
  if ('name' in body) {
    const error = firstError([checkName(body.name, 'Brand name')]);
    if (error) return res.status(400).json({ success: false, message: error });
  }
  const updates = []; const values = [];
  for (const field of ['name', 'logo_url', 'is_active']) {
    if (!(field in body)) continue;
    values.push(field === 'name' ? String(body.name).trim() : field === 'logo_url' ? (body.logo_url ? String(body.logo_url).trim() : null) : Boolean(body.is_active));
    updates.push(`${field} = $${values.length}`);
  }
  if (!updates.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

  values.push(req.tenant.businessId, req.params.id);
  const { rows } = await pool.query(
    `UPDATE brands SET ${updates.join(', ')} WHERE business_id = $${values.length - 1} AND brand_id = $${values.length} RETURNING *`,
    values
  );
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  recordAudit(req, { action: 'brand.updated', resource_type: 'brand', resource_id: rows[0].brand_id, metadata: body });
  res.json({ success: true, data: asBrand(rows[0]) });
};
