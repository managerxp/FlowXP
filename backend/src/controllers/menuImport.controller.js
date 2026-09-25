/*
 * Menu import from photos: scan (read the photo, return a DRAFT) and confirm
 * (save exactly what the person approved). Nothing is written to the menu by
 * scan, and the photos themselves are never stored: they are held in memory for
 * the one request and sent to the AI service, then dropped.
 */
import pool from '../config/database.js';
import config from '../config/env.js';
import { recordAudit } from '../modules/events.js';
import { AIProviderError, isConfigured } from '../modules/ai/provider.js';
import { scanMenu } from '../modules/ai/menuScan.js';
import { toPaise, toRupees } from '../utils/money.js';
import { allowance, enabled } from './ai.controller.js';

const MAX_PHOTOS = 5;
const MAX_ITEMS = 300;
const MEDIA = ['image/jpeg', 'image/png', 'image/webp'];
const bad = (res, message, status = 400, code) => res.status(status).json({ success: false, message, ...(code && { code }) });

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/* POST /api/menu-import/scan  (multipart, field "images") */
export const scan = async (req, res) => {
  const { businessId } = req.tenant;
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) return bad(res, 'Take or choose a photo of the menu');
  if (files.length > MAX_PHOTOS) return bad(res, `Use at most ${MAX_PHOTOS} photos at a time`);
  if (files.some((f) => !MEDIA.includes(f.mimetype))) return bad(res, 'Photos must be JPEG, PNG or WebP');

  if (!isConfigured()) return bad(res, 'Reading a menu from a photo needs the AI service, which isn’t set up on this server yet. You can still add products by hand.', 503, 'AI_NOT_CONFIGURED');
  if (!(await enabled(businessId))) return bad(res, 'Flow AI is switched off for this business. An owner can turn it on in the AI page.', 403, 'AI_DISABLED');
  const allow = await allowance(businessId);
  if (allow.remaining === 0) return bad(res, `You have used all ${allow.limit} AI requests on your plan this month.`, 402, 'AI_LIMIT');

  let result;
  try {
    result = await scanMenu(files.map((f) => ({ mediaType: f.mimetype, data: f.buffer.toString('base64') })));
  } catch (error) {
    if (error instanceof AIProviderError) return bad(res, error.message, error.status === 429 ? 429 : 502, 'AI_UNAVAILABLE');
    throw error;
  }
  await pool.query(
    `INSERT INTO ai_usage (business_id, user_id, model, input_tokens, output_tokens) VALUES ($1,$2,$3,$4,$5)`,
    [businessId, req.auth.userId, config.ai.model, result.usage.input_tokens, result.usage.output_tokens]
  );

  // Flag what is already on the menu, so importing twice doesn't double everything.
  const existing = (await pool.query(
    `SELECT product_id, name, selling_price_paise FROM products WHERE business_id = $1 AND kind = 'DISH' AND status = 'ACTIVE'`, [businessId]
  )).rows;
  const byName = new Map(existing.map((p) => [norm(p.name), p]));
  const items = result.items.map((i) => {
    const dup = byName.get(norm(i.name));
    return { ...i, duplicate_of: dup ? { product_id: dup.product_id, name: dup.name, price: toRupees(dup.selling_price_paise) } : null };
  });
  const categories = (await pool.query(`SELECT name FROM categories WHERE business_id = $1 ORDER BY name`, [businessId])).rows.map((r) => r.name);
  const gst = (await pool.query(`SELECT gst_enabled FROM businesses WHERE business_id = $1`, [businessId])).rows[0]?.gst_enabled;

  res.json({
    success: true,
    data: { items, notes: result.notes, categories, gst_enabled: Boolean(gst), remaining: allow.remaining == null ? null : allow.remaining - 1 }
  });
};

/* POST /api/menu-import/confirm { items: [{ name, price, category?, description? }], tax_rate?, on_duplicate: 'skip' | 'update_price' } */
export const confirm = async (req, res) => {
  const { businessId } = req.tenant;
  const body = req.body || {};
  const list = Array.isArray(body.items) ? body.items : [];
  if (!list.length) return bad(res, 'Choose at least one item to add');
  if (list.length > MAX_ITEMS) return bad(res, `Add at most ${MAX_ITEMS} items at a time`);
  const onDuplicate = body.on_duplicate === 'update_price' ? 'update_price' : 'skip';
  const taxRate = Number(body.tax_rate ?? 0);
  if (!(taxRate >= 0 && taxRate <= 28)) return bad(res, 'GST rate must be between 0 and 28');

  // Validate everything first: one bad row rejects the batch with its row number, and nothing is half-saved.
  const clean = [];
  for (const [n, raw] of list.entries()) {
    const name = String(raw?.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name || name.length > 160) return bad(res, `Item ${n + 1}: enter a name (up to 160 characters)`);
    let pricePaise;
    try { pricePaise = toPaise(raw?.price); } catch { return bad(res, `${name}: enter a price`); }
    if (raw?.price === '' || raw?.price == null || !Number.isFinite(pricePaise) || pricePaise < 0 || pricePaise > 100000000) return bad(res, `${name}: enter a price between 0 and 10,00,000`);
    clean.push({
      name, pricePaise, category: String(raw?.category ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) || null,
      description: String(raw?.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 500) || null
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const categoryIds = new Map((await client.query(`SELECT category_id, name FROM categories WHERE business_id = $1`, [businessId])).rows.map((c) => [norm(c.name), c.category_id]));
    const products = new Map((await client.query(`SELECT product_id, name FROM products WHERE business_id = $1 AND kind = 'DISH' AND status = 'ACTIVE'`, [businessId])).rows.map((p) => [norm(p.name), p.product_id]));

    const result = { created: 0, updated: 0, skipped: 0, categories_created: 0 };
    const seenInBatch = new Set();
    for (const item of clean) {
      const key = norm(item.name);
      if (seenInBatch.has(key)) { result.skipped++; continue; }            // the same dish twice in one batch
      seenInBatch.add(key);

      if (products.has(key)) {
        if (onDuplicate === 'update_price') {
          await client.query(`UPDATE products SET selling_price_paise = $1, updated_at = CURRENT_TIMESTAMP WHERE product_id = $2 AND business_id = $3`, [item.pricePaise, products.get(key), businessId]);
          result.updated++;
        } else result.skipped++;
        continue;
      }
      let categoryId = null;
      if (item.category) {
        const ck = norm(item.category);
        if (!categoryIds.has(ck)) {
          const created = (await client.query(`INSERT INTO categories (business_id, name) VALUES ($1,$2) RETURNING category_id`, [businessId, item.category])).rows[0];
          categoryIds.set(ck, created.category_id); result.categories_created++;
        }
        categoryId = categoryIds.get(ck);
      }
      // A dish isn't stocked by itself (ingredients are, through its recipe), so it doesn't track inventory.
      await client.query(
        `INSERT INTO products (business_id, category_id, name, kind, unit, selling_price_paise, purchase_price_paise, tax_rate, track_inventory, current_stock, min_stock, description)
         VALUES ($1,$2,$3,'DISH','pc',$4,0,$5,FALSE,0,0,$6)`,
        [businessId, categoryId, item.name, item.pricePaise, taxRate, item.description]
      );
      result.created++;
    }
    await client.query('COMMIT');
    recordAudit(req, { action: 'menu.imported', resource_type: 'menu', metadata: { ...result } });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};
