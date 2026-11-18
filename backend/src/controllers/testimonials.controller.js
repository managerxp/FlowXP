/*
 * Client reviews for the home page. The Super Admin writes each one, uploads the person's photo and the company's logo,
 * and publishes it; the public list (GET /api/testimonials) returns only the published ones, in the order set here.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { EXT_BY_MIME, putFile, removeFile } from '../modules/storage.js';
import { looksLikeImage } from '../middleware/upload.js';

const KINDS = { photo: 'photo_url', logo: 'logo_url' };
const asRow = (r) => ({ testimonial_id: r.testimonial_id, name: r.name, role: r.role, company: r.company, quote: r.quote, rating: r.rating, photo_url: r.photo_url, logo_url: r.logo_url, is_published: r.is_published, sort_order: r.sort_order });
const text = (v, max) => String(v ?? '').trim().slice(0, max);

/* The words and the star rating, checked once for a new review and for an edit. Returns { error } or the clean fields. */
const clean = (b, partial) => {
  const out = {};
  if (!partial || 'name' in b) { out.name = text(b.name, 120); if (!out.name) return { error: 'Write the client’s name' }; }
  if (!partial || 'quote' in b) { out.quote = text(b.quote, 600); if (!out.quote) return { error: 'Write the review' }; }
  if ('role' in b || !partial) out.role = text(b.role, 120) || null;
  if ('company' in b || !partial) out.company = text(b.company, 160) || null;
  if ('rating' in b || !partial) { const n = Number(b.rating ?? 5); if (!Number.isInteger(n) || n < 1 || n > 5) return { error: 'The rating is 1 to 5 stars' }; out.rating = n; }
  if ('is_published' in b) out.is_published = b.is_published === true;
  if ('sort_order' in b) { const n = Number(b.sort_order); if (!Number.isInteger(n)) return { error: 'The order is a whole number' }; out.sort_order = n; }
  return out;
};

/* GET /api/testimonials — what the home page shows */
export const publicList = async (_req, res) => {
  const { rows } = await pool.query(`SELECT * FROM testimonials WHERE is_published ORDER BY sort_order, testimonial_id`);
  res.set('Cache-Control', 'public, max-age=300').json({ success: true, data: rows.map(asRow) });
};

/* GET /api/admin/testimonials */
export const list = async (_req, res) => {
  const { rows } = await pool.query(`SELECT * FROM testimonials ORDER BY sort_order, testimonial_id`);
  res.json({ success: true, data: rows.map(asRow) });
};

/* POST /api/admin/testimonials */
export const create = async (req, res) => {
  const v = clean(req.body || {}, false);
  if (v.error) return res.status(400).json({ success: false, message: v.error });
  const next = (await pool.query(`SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM testimonials`)).rows[0].n;
  const { rows } = await pool.query(
    `INSERT INTO testimonials (name, role, company, quote, rating, is_published, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [v.name, v.role, v.company, v.quote, v.rating, v.is_published === true, v.sort_order ?? next]);
  recordAudit(req, { action: 'admin.testimonial_created', resource_type: 'testimonial', resource_id: rows[0].testimonial_id });
  res.status(201).json({ success: true, data: asRow(rows[0]) });
};

/* PATCH /api/admin/testimonials/:id */
export const update = async (req, res) => {
  const v = clean(req.body || {}, true);
  if (v.error) return res.status(400).json({ success: false, message: v.error });
  const keys = Object.keys(v);
  if (!keys.length) return res.status(400).json({ success: false, message: 'Nothing to change' });
  const { rows } = await pool.query(
    `UPDATE testimonials SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE testimonial_id = $1 RETURNING *`,
    [Number(req.params.id), ...keys.map((k) => v[k])]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  recordAudit(req, { action: 'admin.testimonial_updated', resource_type: 'testimonial', resource_id: rows[0].testimonial_id });
  res.json({ success: true, data: asRow(rows[0]) });
};

/* DELETE /api/admin/testimonials/:id — the review and both pictures */
export const remove = async (req, res) => {
  const { rows } = await pool.query(`DELETE FROM testimonials WHERE testimonial_id = $1 RETURNING photo_url, logo_url, testimonial_id`, [Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  for (const u of [rows[0].photo_url, rows[0].logo_url]) if (u) await removeFile(u);
  recordAudit(req, { action: 'admin.testimonial_deleted', resource_type: 'testimonial', resource_id: rows[0].testimonial_id });
  res.json({ success: true });
};

/* POST /api/admin/testimonials/:id/image/:kind (kind: photo | logo), multipart field "image" */
export const uploadImage = async (req, res) => {
  const column = KINDS[req.params.kind];
  if (!column) return res.status(400).json({ success: false, message: 'Upload a photo or a logo' });
  if (!req.file) return res.status(400).json({ success: false, message: 'Choose an image to upload' });
  if (!looksLikeImage(req.file.buffer, req.file.mimetype)) return res.status(400).json({ success: false, message: 'That file is not a valid JPEG, PNG or WebP image' });
  const id = Number(req.params.id);
  const old = (await pool.query(`SELECT ${column} AS url FROM testimonials WHERE testimonial_id = $1`, [id])).rows;
  if (!old.length) return res.status(404).json({ success: false, message: 'Not found' });
  let url;
  try { url = await putFile({ key: `testimonials/${id}/${req.params.kind}-${Date.now()}${EXT_BY_MIME[req.file.mimetype]}`, buffer: req.file.buffer, contentType: req.file.mimetype }); }
  catch (error) { console.error('[testimonials] upload failed:', error.message); return res.status(502).json({ success: false, message: 'Could not save the picture. Try again in a moment.' }); }
  const { rows } = await pool.query(`UPDATE testimonials SET ${column} = $2, updated_at = CURRENT_TIMESTAMP WHERE testimonial_id = $1 RETURNING *`, [id, url]);
  if (old[0].url) await removeFile(old[0].url);
  recordAudit(req, { action: 'admin.testimonial_image', resource_type: 'testimonial', resource_id: id, metadata: { kind: req.params.kind } });
  res.json({ success: true, data: asRow(rows[0]) });
};

/* DELETE /api/admin/testimonials/:id/image/:kind */
export const removeImage = async (req, res) => {
  const column = KINDS[req.params.kind];
  if (!column) return res.status(400).json({ success: false, message: 'Remove the photo or the logo' });
  const id = Number(req.params.id);
  const old = (await pool.query(`SELECT ${column} AS url FROM testimonials WHERE testimonial_id = $1`, [id])).rows;
  if (!old.length) return res.status(404).json({ success: false, message: 'Not found' });
  const { rows } = await pool.query(`UPDATE testimonials SET ${column} = NULL, updated_at = CURRENT_TIMESTAMP WHERE testimonial_id = $1 RETURNING *`, [id]);
  if (old[0].url) await removeFile(old[0].url);
  res.json({ success: true, data: asRow(rows[0]) });
};
