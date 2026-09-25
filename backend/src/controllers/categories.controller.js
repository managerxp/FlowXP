/*
 * Product categories. Deliberately the smallest controller in the codebase —
 * a name and a business_id — because that is all a category is.
 */
import pool from '../config/database.js';
import { checkName, firstError } from '../utils/validate.js';

export const list = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT category_id, name FROM categories WHERE business_id = $1 ORDER BY name`,
    [req.tenant.businessId]
  );
  res.json({ success: true, data: rows });
};

export const create = async (req, res) => {
  const error = firstError([checkName(req.body?.name, 'Category name')]);
  if (error) return res.status(400).json({ success: false, message: error });

  const { rows } = await pool.query(
    `INSERT INTO categories (business_id, name) VALUES ($1,$2) RETURNING category_id, name`,
    [req.tenant.businessId, String(req.body.name).trim()]
  );
  res.status(201).json({ success: true, data: rows[0] });
};

export const remove = async (req, res) => {
  /* Products keep their category_id via ON DELETE SET NULL, so removing a
     category un-categorises its products rather than orphaning or blocking
     the delete — the product itself was never "about" its category. */
  const { rowCount } = await pool.query(
    `DELETE FROM categories WHERE category_id = $1 AND business_id = $2`,
    [req.params.id, req.tenant.businessId]
  );
  if (!rowCount) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true });
};
