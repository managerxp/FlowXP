/*
 * Stock requests between outlets. An outlet that is running short asks another outlet to send stock; the sending
 * outlet fulfils it, in full or in parts, through the ordinary stock transfer (modules/transfers.js), or turns it
 * down with a reason. The requester can call off what has not been sent.
 *
 * Both outlets can see a request; a person pinned to an outlet can only act for their own side (send from the
 * outlet that was asked, cancel from the outlet that asked). Group users can act for either.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { notify } from '../modules/notifications.js';
import { TransferError, transferStock } from '../modules/transfers.js';
import { toQuantity } from '../utils/money.js';

const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });
const round3 = (n) => Math.round(n * 1000) / 1000;
const OPEN = ['PENDING', 'PARTIAL'];

/* Who may see it: either outlet; everything in the All-outlets view. */
const visible = (tenant, values, alias = 'r') => {
  if (tenant.scopeBranchId == null) return '';
  values.push(tenant.scopeBranchId);
  return ` AND (${alias}.from_branch_id = $${values.length} OR ${alias}.to_branch_id = $${values.length})`;
};

const load = async (client, req, { lock = false } = {}) => {
  const values = [req.tenant.businessId, req.params.id];
  return (await client.query(`SELECT * FROM transfer_requests r WHERE r.business_id = $1 AND r.request_id = $2${visible(req.tenant, values)}${lock ? ' FOR UPDATE' : ''}`, values)).rows[0];
};

const withItems = async (db, requests) => {
  if (!requests.length) return [];
  const items = (await db.query(
    `SELECT i.*, p.name, p.unit FROM transfer_request_items i JOIN products p ON p.product_id = i.product_id WHERE i.request_id = ANY($1::int[]) ORDER BY i.item_id`, [requests.map((r) => r.request_id)])).rows;
  return requests.map((r) => ({
    request_id: r.request_id, status: r.status, notes: r.notes, decision_note: r.decision_note, created_at: r.created_at, closed_at: r.closed_at,
    from_branch_id: r.from_branch_id, from_name: r.from_name, to_branch_id: r.to_branch_id, to_name: r.to_name,
    items: items.filter((i) => i.request_id === r.request_id).map((i) => ({
      item_id: i.item_id, product_id: i.product_id, name: i.name, unit: i.unit,
      requested: Number(i.requested_qty), sent: Number(i.sent_qty), remaining: round3(Number(i.requested_qty) - Number(i.sent_qty))
    }))
  }));
};

const SELECT = `SELECT r.*, f.name AS from_name, t.name AS to_name FROM transfer_requests r JOIN branches f ON f.branch_id = r.from_branch_id JOIN branches t ON t.branch_id = r.to_branch_id`;

/* GET /api/transfer-requests?box=incoming|outgoing&status= */
export const list = async (req, res) => {
  const values = [req.tenant.businessId];
  let extra = '';
  const scope = req.tenant.scopeBranchId;
  if (scope != null && req.query.box === 'incoming') { values.push(scope); extra += ` AND r.from_branch_id = $${values.length}`; }
  else if (scope != null && req.query.box === 'outgoing') { values.push(scope); extra += ` AND r.to_branch_id = $${values.length}`; }
  if (req.query.status === 'open') extra += ` AND r.status IN ('PENDING','PARTIAL')`;
  else if (req.query.status) { values.push(String(req.query.status).toUpperCase()); extra += ` AND r.status = $${values.length}`; }
  const { rows } = await pool.query(`${SELECT} WHERE r.business_id = $1${extra}${visible(req.tenant, values)} ORDER BY r.request_id DESC LIMIT 100`, values);
  res.json({ success: true, data: await withItems(pool, rows) });
};

/* GET /api/transfer-requests/:id */
export const get = async (req, res) => {
  const values = [req.tenant.businessId, req.params.id];
  const row = (await pool.query(`${SELECT} WHERE r.business_id = $1 AND r.request_id = $2${visible(req.tenant, values)}`, values)).rows[0];
  if (!row) return bad(res, 'Not found', 404);
  res.json({ success: true, data: (await withItems(pool, [row]))[0] });
};

/* POST /api/transfer-requests { from_branch_id, items: [{ product_id, quantity }], notes? } — asked by the outlet being worked in */
export const create = async (req, res) => {
  const from = Number(req.body?.from_branch_id);
  const to = req.tenant.branchId;
  if (!from || from === to) return bad(res, 'Choose another outlet to ask');
  const items = req.body?.items;
  if (!Array.isArray(items) || !items.length) return bad(res, 'Choose at least one item');
  if (new Set(items.map((i) => Number(i.product_id))).size !== items.length) return bad(res, 'An item is listed twice');
  let quantities;
  try { quantities = items.map((i) => toQuantity(i.quantity)); } catch { return bad(res, 'Every quantity must be above zero'); }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const outlet = (await client.query(`SELECT branch_id, name FROM branches WHERE branch_id = $1 AND business_id = $2 AND status = 'ACTIVE'`, [from, req.tenant.businessId])).rows[0];
    if (!outlet) { await client.query('ROLLBACK'); return bad(res, 'Choose one of your outlets', 404); }
    const found = (await client.query(`SELECT product_id, name, track_inventory FROM products WHERE business_id = $1 AND product_id = ANY($2::int[]) AND status = 'ACTIVE'`, [req.tenant.businessId, items.map((i) => Number(i.product_id))])).rows;
    if (found.length !== items.length) { await client.query('ROLLBACK'); return bad(res, 'One of those items was not found', 404); }
    const untracked = found.find((p) => !p.track_inventory);
    if (untracked) { await client.query('ROLLBACK'); return bad(res, `${untracked.name} does not track stock, so it can’t be transferred`); }

    const request = (await client.query(
      `INSERT INTO transfer_requests (business_id, from_branch_id, to_branch_id, notes, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.tenant.businessId, from, to, req.body?.notes ? String(req.body.notes).trim().slice(0, 300) : null, req.auth.userId]
    )).rows[0];
    for (const [n, i] of items.entries()) {
      await client.query(`INSERT INTO transfer_request_items (request_id, product_id, requested_qty) VALUES ($1,$2,$3)`, [request.request_id, Number(i.product_id), quantities[n]]);
    }
    await client.query('COMMIT');
    recordAudit(req, { action: 'transfer_request.created', resource_type: 'transfer_request', resource_id: request.request_id, metadata: { from, to, items: items.length }, branch_id: to });
    const toName = (await pool.query(`SELECT name FROM branches WHERE branch_id = $1`, [to])).rows[0]?.name;
    notify(req.tenant.businessId, { category: 'stock', type: 'transfer_request', severity: 'informational', title: `${toName} is asking for stock`, body: `${items.length} item${items.length === 1 ? '' : 's'} requested from ${outlet.name}.`, link: '/app/stock-requests', dedupeKey: `tr:${request.request_id}`, branchId: from }).catch(() => {});
    const row = (await pool.query(`${SELECT} WHERE r.request_id = $1`, [request.request_id])).rows[0];
    res.status(201).json({ success: true, data: (await withItems(pool, [row]))[0] });
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
};

/* A pinned person acts only for their own outlet's side. */
const mayAct = (tenant, outletId) => !tenant.pinned || tenant.branchId === outletId;

/* POST /api/transfer-requests/:id/fulfil { items: [{ item_id, quantity }] } — send what is asked, or part of it */
export const fulfil = async (req, res) => {
  const list = req.body?.items;
  if (!Array.isArray(list) || !list.length) return bad(res, 'Say how much you are sending');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await load(client, req, { lock: true });
    if (!r) { await client.query('ROLLBACK'); return bad(res, 'Not found', 404); }
    if (!OPEN.includes(r.status)) { await client.query('ROLLBACK'); return bad(res, `This request is ${r.status.toLowerCase()}`, 409); }
    if (!mayAct(req.tenant, r.from_branch_id)) { await client.query('ROLLBACK'); return bad(res, 'Only the outlet that was asked can send this stock', 403); }

    const lines = (await client.query(`SELECT i.*, p.name FROM transfer_request_items i JOIN products p ON p.product_id = i.product_id WHERE i.request_id = $1 ORDER BY i.item_id FOR UPDATE OF i`, [r.request_id])).rows;
    const sendNow = [];
    for (const x of list) {
      const line = lines.find((l) => l.item_id === Number(x.item_id));
      if (!line) throw new TransferError(400, 'One of those lines isn’t on this request');
      const qty = toQuantity(x.quantity);
      const left = round3(Number(line.requested_qty) - Number(line.sent_qty));
      if (qty > left) throw new TransferError(409, left > 0 ? `Only ${left} of ${line.name} is still asked for` : `${line.name} has already been sent in full`);
      sendNow.push({ line, qty });
    }
    // products locked in id order, the same order billing and receiving use
    for (const s of sendNow.sort((a, b) => a.line.product_id - b.line.product_id)) {
      await transferStock(client, { businessId: req.tenant.businessId, from: r.from_branch_id, to: r.to_branch_id, productId: s.line.product_id, quantity: s.qty, notes: `Stock request #${r.request_id}`, userId: req.auth.userId });
      await client.query(`UPDATE transfer_request_items SET sent_qty = sent_qty + $2 WHERE item_id = $1`, [s.line.item_id, s.qty]);
    }
    const left = (await client.query(`SELECT COUNT(*)::int AS n FROM transfer_request_items WHERE request_id = $1 AND sent_qty < requested_qty`, [r.request_id])).rows[0].n;
    const status = left === 0 ? 'FULFILLED' : 'PARTIAL';
    await client.query(`UPDATE transfer_requests SET status = $2::varchar, closed_at = CASE WHEN $2::varchar = 'FULFILLED' THEN CURRENT_TIMESTAMP END WHERE request_id = $1`, [r.request_id, status]);
    await client.query('COMMIT');
    recordAudit(req, { action: 'transfer_request.fulfilled', resource_type: 'transfer_request', resource_id: r.request_id, metadata: { status, items: sendNow.length }, branch_id: r.from_branch_id });
    notify(req.tenant.businessId, { category: 'stock', type: 'transfer_sent', severity: 'informational', title: status === 'FULFILLED' ? 'Your stock request has been sent' : 'Part of your stock request has been sent', link: '/app/stock-requests', dedupeKey: `trs:${r.request_id}:${status}:${sendNow.length}`, branchId: r.to_branch_id }).catch(() => {});
    const row = (await pool.query(`${SELECT} WHERE r.request_id = $1`, [r.request_id])).rows[0];
    res.json({ success: true, data: (await withItems(pool, [row]))[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof TransferError) return bad(res, error.message, error.status);
    if (error.message?.includes('positive number') || error.message?.includes('must be a number')) return bad(res, error.message);
    throw error;
  } finally { client.release(); }
};

/* POST /api/transfer-requests/:id/reject { reason } — the asked outlet turns it down */
export const reject = async (req, res) => {
  const reason = String(req.body?.reason ?? '').trim().slice(0, 300);
  if (!reason) return bad(res, 'Say why, so the other outlet knows');
  const r = await load(pool, req);
  if (!r) return bad(res, 'Not found', 404);
  if (r.status !== 'PENDING') return bad(res, r.status === 'PARTIAL' ? 'Part of this has already been sent' : `This request is ${r.status.toLowerCase()}`, 409);
  if (!mayAct(req.tenant, r.from_branch_id)) return bad(res, 'Only the outlet that was asked can turn this down', 403);
  await pool.query(`UPDATE transfer_requests SET status = 'REJECTED', decision_note = $2, closed_at = CURRENT_TIMESTAMP WHERE request_id = $1`, [r.request_id, reason]);
  recordAudit(req, { action: 'transfer_request.rejected', resource_type: 'transfer_request', resource_id: r.request_id, metadata: { reason }, branch_id: r.from_branch_id });
  notify(req.tenant.businessId, { category: 'stock', type: 'transfer_rejected', severity: 'informational', title: 'Your stock request was turned down', body: reason, link: '/app/stock-requests', dedupeKey: `trr:${r.request_id}`, branchId: r.to_branch_id }).catch(() => {});
  res.json({ success: true });
};

/* POST /api/transfer-requests/:id/cancel — the asking outlet calls off what has not been sent */
export const cancel = async (req, res) => {
  const r = await load(pool, req);
  if (!r) return bad(res, 'Not found', 404);
  if (!OPEN.includes(r.status)) return bad(res, `This request is ${r.status.toLowerCase()}`, 409);
  if (!mayAct(req.tenant, r.to_branch_id)) return bad(res, 'Only the outlet that asked can call this off', 403);
  // nothing sent: cancelled; something sent: closed with what arrived
  await pool.query(`UPDATE transfer_requests SET status = CASE WHEN $2 = 'PARTIAL' THEN 'CLOSED' ELSE 'CANCELLED' END, closed_at = CURRENT_TIMESTAMP WHERE request_id = $1`, [r.request_id, r.status]);
  recordAudit(req, { action: 'transfer_request.cancelled', resource_type: 'transfer_request', resource_id: r.request_id, branch_id: r.to_branch_id });
  res.json({ success: true });
};
