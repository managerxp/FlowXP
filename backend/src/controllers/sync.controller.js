/*
 * What changed since a phone last looked (MOBILE.md, phase 0).
 *
 *   GET /api/sync/head                     where the log is now. A phone that downloads the whole catalogue (pos-catalog) asks
 *                                          for this FIRST, then downloads, then asks for changes since that number, so anything
 *                                          that changed during the download is simply applied again (applying a row twice is harmless).
 *   GET /api/sync/changes?since=N&limit=   everything after N for this business and outlet, as the CURRENT row of each thing that
 *                                          changed ({entity, op: 'upsert'|'delete', id, row}). Several changes to one thing
 *                                          arrive once. { next, has_more }: ask again with since=next while has_more.
 *                                          409 RESYNC when N is older than the log is kept (30 days) or newer than the log
 *                                          has ever reached (a restored database): download the catalogue again.
 *
 * The server stays the authority: this is a copy for finding products and showing hints (stock is a hint, never trusted).
 * An outlet's own price and stock changes reach only that outlet's phones.
 */
import pool from '../config/database.js';
import { posRowsByIds } from './products.controller.js';

const KEEP_DAYS = 30;

const head = async (businessId) => {
  const { rows } = await pool.query(
    `SELECT GREATEST((SELECT floor_seq FROM sync_state), COALESCE((SELECT MAX(seq) FROM sync_log WHERE business_id = $1), 0)) AS head`, [businessId]);
  return Number(rows[0].head);
};

const prune = () => pool.query(
  `WITH d AS (DELETE FROM sync_log WHERE changed_at < CURRENT_TIMESTAMP - make_interval(days => ${KEEP_DAYS}) RETURNING seq)
   UPDATE sync_state SET floor_seq = GREATEST(floor_seq, (SELECT MAX(seq) FROM d)) WHERE EXISTS (SELECT 1 FROM d)`
).catch((error) => console.error('[sync] prune failed:', error.message));

export const getHead = async (req, res) => {
  res.json({ success: true, data: { head: await head(req.tenant.businessId) } });
};

export const changes = async (req, res) => {
  const since = Math.trunc(Number(req.query.since));
  if (!Number.isFinite(since) || since < 0) return res.status(400).json({ success: false, message: 'since must be 0 or more' });
  const limit = Math.min(Math.max(Math.trunc(Number(req.query.limit)) || 500, 1), 2000);
  const { businessId, branchId } = req.tenant;

  const [{ rows: [state] }, current] = await Promise.all([pool.query(`SELECT floor_seq FROM sync_state`), head(businessId)]);
  if (since < Number(state.floor_seq) || since > current) {
    return res.status(409).json({ success: false, code: 'RESYNC', message: 'Download the catalogue again.', data: { head: current } });
  }

  const raw = (await pool.query(
    `SELECT seq, entity, entity_id FROM sync_log
     WHERE business_id = $1 AND seq > $2 AND (branch_id IS NULL OR branch_id = $3) ORDER BY seq LIMIT $4`,
    [businessId, since, branchId, limit]
  )).rows;
  const hasMore = raw.length === limit;

  // the last mention of each thing wins; Map keeps the order of first insertion, so re-insert to move it to the end
  const last = new Map();
  for (const r of raw) { const k = `${r.entity}:${r.entity_id}`; last.delete(k); last.set(k, { entity: r.entity, id: Number(r.entity_id) }); }
  const idsOf = (entity) => [...last.values()].filter((c) => c.entity === entity).map((c) => c.id);

  const products = new Map((await posRowsByIds(req.tenant, idsOf('product'))).map((p) => [p.product_id, p]));
  const categories = new Map(idsOf('category').length ? (await pool.query(
    `SELECT category_id, name FROM categories WHERE business_id = $1 AND category_id = ANY($2::int[])`, [businessId, idsOf('category')])).rows.map((r) => [r.category_id, r]) : []);
  const customers = new Map(idsOf('customer').length ? (await pool.query(
    `SELECT customer_id, name, phone, email, gstin FROM customers WHERE business_id = $1 AND status = 'ACTIVE' AND customer_id = ANY($2::int[])`,
    [businessId, idsOf('customer')])).rows.map((r) => [r.customer_id, r]) : []);
  const rowOf = { product: products, category: categories, customer: customers };

  const out = [...last.values()].map(({ entity, id }) => {
    const row = rowOf[entity].get(id);
    return row ? { entity, op: 'upsert', id, row } : { entity, op: 'delete', id };
  });

  prune();
  // a finished catch-up moves the phone to "now", so a quiet business does not look stale when the log is pruned for others
  const next = hasMore ? Number(raw[raw.length - 1].seq) : Math.max(current, raw.length ? Number(raw[raw.length - 1].seq) : since);
  res.json({ success: true, data: { changes: out, next, has_more: hasMore } });
};
