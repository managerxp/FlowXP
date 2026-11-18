/*
 * The business's named GST rates: list (made from defaults the first time), add, rename / change, switch off.
 * Changing a rate's number moves every product that uses it, so the till and the next bills follow; past bills keep what they were billed at.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { asRate, cleanRate, listRates } from '../modules/taxRates.js';

const fail = (res, status, message) => res.status(status).json({ success: false, message });

export const list = async (req, res) => {
  const rows = await listRates(pool, req.tenant.businessId);
  res.json({ success: true, data: req.query.all === 'true' ? rows : rows.filter((r) => r.is_active) });
};

export const create = async (req, res) => {
  const [clean, error] = cleanRate(req.body);
  if (error) return fail(res, 400, error);
  await listRates(pool, req.tenant.businessId);   // the defaults come first, so a new rate goes after them
  try {
    const { rows } = await pool.query(
      `INSERT INTO tax_rates (business_id, name, rate, kind, sort_order)
       VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(sort_order),0)+1 FROM tax_rates WHERE business_id = $1)) RETURNING *`,
      [req.tenant.businessId, clean.name, clean.rate, clean.kind]);
    recordAudit(req, { action: 'tax_rate.created', resource_type: 'tax_rate', resource_id: rows[0].tax_rate_id, metadata: clean });
    res.status(201).json({ success: true, data: asRate(rows[0]) });
  } catch (e) {
    if (e.code === '23505') return fail(res, 409, 'You already have a rate with that name');
    throw e;
  }
};

export const update = async (req, res) => {
  const id = Number(req.params.id);
  const before = (await pool.query(`SELECT * FROM tax_rates WHERE tax_rate_id = $1 AND business_id = $2`, [id, req.tenant.businessId])).rows[0];
  if (!before) return fail(res, 404, 'Not found');
  const [clean, error] = cleanRate({ name: req.body?.name ?? before.name, rate: req.body?.rate ?? before.rate, kind: req.body?.kind ?? before.kind });
  if (error) return fail(res, 400, error);
  const active = typeof req.body?.is_active === 'boolean' ? req.body.is_active : before.is_active;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`UPDATE tax_rates SET name = $3, rate = $4, kind = $5, is_active = $6 WHERE tax_rate_id = $1 AND business_id = $2 RETURNING *`,
      [id, req.tenant.businessId, clean.name, clean.rate, clean.kind, active]);
    // the products on this rate follow its new number
    if (Number(before.rate) !== clean.rate) await client.query(`UPDATE products SET tax_rate = $3 WHERE business_id = $1 AND tax_rate_id = $2`, [req.tenant.businessId, id, clean.rate]);
    await client.query('COMMIT');
    recordAudit(req, { action: 'tax_rate.updated', resource_type: 'tax_rate', resource_id: id, metadata: { before: asRate(before), after: asRate(rows[0]) } });
    res.json({ success: true, data: asRate(rows[0]) });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return fail(res, 409, 'You already have a rate with that name');
    throw e;
  } finally { client.release(); }
};
