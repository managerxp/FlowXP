/*
 * Moving a running tab around the floor: transfer it to another table, merge
 * two tabs into one, or split some of its items off onto another table.
 * (Splitting the *bill* is orders.controller.js's bill(), which takes a list
 * of items.) None of these touch money or stock — that only happens at billing.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { getOrCreateOpenOrderForTable } from './orders.controller.js';
import { OPEN_STATUSES, TabError, earlierStage, lockOrders, takeItems } from '../modules/tabs.js';

const fail = (res, error) => {
  if (error instanceof TabError) return res.status(error.status).json({ success: false, message: error.message });
  throw error;
};

const summary = async (client, businessId, orderId) =>
  (await client.query(
    `SELECT o.order_id, o.order_number, o.status, o.table_id, t.name AS table_name,
            (SELECT COUNT(*)::int FROM order_items WHERE order_id = o.order_id AND status <> 'CANCELLED') AS item_count
     FROM orders o LEFT JOIN dining_tables t ON t.table_id = o.table_id WHERE o.order_id = $1 AND o.business_id = $2`,
    [orderId, businessId]
  )).rows[0];

const requireOpen = (order, what = 'This order') => {
  if (!order) throw new TabError(404, 'Not found');
  if (!OPEN_STATUSES.includes(order.status)) throw new TabError(400, `${what} is already billed, merged or cancelled`);
};

/* POST /api/orders/:id/transfer { table_id } — the guests moved to another table */
export const transfer = async (req, res) => {
  const tableId = Number(req.body?.table_id);
  if (!Number.isInteger(tableId) || tableId <= 0) return res.status(400).json({ success: false, message: 'Choose a table' });
  const businessId = req.tenant.businessId;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = (await lockOrders(client, businessId, [Number(req.params.id)], req.tenant.scopeBranchId)).get(Number(req.params.id));
    requireOpen(order);
    if (!order.table_id) throw new TabError(400, 'Only a dine-in order sits at a table');
    if (order.table_id === tableId) throw new TabError(400, 'The order is already at that table');

    const table = (await client.query(`SELECT table_id, name, status FROM dining_tables WHERE table_id = $1 AND business_id = $2 AND branch_id = $3`, [tableId, businessId, order.branch_id])).rows[0];
    if (!table) throw new TabError(400, 'Table not found');
    if (table.status !== 'FREE') throw new TabError(400, `${table.name} is ${table.status.toLowerCase()}`);

    try {
      await client.query(`UPDATE orders SET table_id = $1, updated_at = CURRENT_TIMESTAMP WHERE order_id = $2`, [tableId, order.order_id]);
    } catch (dbError) {
      if (dbError.code === '23505') throw new TabError(409, `${table.name} already has an open order — merge the two instead`);
      throw dbError;
    }
    await client.query('COMMIT');
    recordAudit(req, { action: 'order.transferred', resource_type: 'order', resource_id: order.order_id, metadata: { from_table_id: order.table_id, to_table_id: tableId } });
    res.json({ success: true, data: await summary(pool, businessId, order.order_id) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, error);
  } finally {
    client.release();
  }
};

/* POST /api/orders/:id/merge { from_order_id } — fold another tab into this one */
export const merge = async (req, res) => {
  const targetId = Number(req.params.id);
  const sourceId = Number(req.body?.from_order_id);
  if (!Number.isInteger(sourceId) || sourceId <= 0) return res.status(400).json({ success: false, message: 'Choose the order to merge in' });
  if (sourceId === targetId) return res.status(400).json({ success: false, message: 'An order cannot be merged into itself' });
  const businessId = req.tenant.businessId;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await lockOrders(client, businessId, [targetId, sourceId], req.tenant.scopeBranchId);
    const target = locked.get(targetId); const source = locked.get(sourceId);
    requireOpen(target, 'The order you are keeping');
    requireOpen(source, 'The order you are merging in');
    if (target.branch_id !== source.branch_id) throw new TabError(400, 'Orders from different outlets can’t be merged');
    if (target.order_type !== 'DINE_IN' || source.order_type !== 'DINE_IN') throw new TabError(400, 'Only dine-in orders can be merged');

    await client.query(`UPDATE order_items SET order_id = $1 WHERE order_id = $2`, [targetId, sourceId]);
    await client.query(`UPDATE kot_tickets SET order_id = $1 WHERE order_id = $2`, [targetId, sourceId]);

    const notes = [target.notes, source.notes].filter(Boolean).filter((n, i, all) => all.indexOf(n) === i).join(' · ') || null;
    await client.query(
      `UPDATE orders SET status = $2, customer_id = COALESCE(customer_id, $3), notes = $4, updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`,
      [targetId, earlierStage(target.status, source.status), source.customer_id, notes]
    );
    await client.query(`UPDATE orders SET status = 'MERGED', merged_into_order_id = $2, updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`, [sourceId, targetId]);

    await client.query('COMMIT');
    recordAudit(req, { action: 'order.merged', resource_type: 'order', resource_id: targetId, metadata: { merged_order_id: sourceId, from_table_id: source.table_id } });
    res.json({ success: true, data: await summary(pool, businessId, targetId) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, error);
  } finally {
    client.release();
  }
};

/* POST /api/orders/:id/split { items: [{ order_item_id, quantity? }], table_id | to_order_id } — some of the party moves */
export const split = async (req, res) => {
  const sourceId = Number(req.params.id);
  const businessId = req.tenant.businessId;
  const { items, table_id: tableId, to_order_id: toOrderId } = req.body || {};
  if (!tableId && !toOrderId) return res.status(400).json({ success: false, message: 'Choose where the items should go' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ids = [sourceId, ...(toOrderId ? [Number(toOrderId)] : [])];
    const locked = await lockOrders(client, businessId, ids, req.tenant.scopeBranchId);
    const source = locked.get(sourceId);
    requireOpen(source);
    if (source.order_type !== 'DINE_IN') throw new TabError(400, 'Only a dine-in order can be split between tables');

    let target;
    if (toOrderId) {
      target = locked.get(Number(toOrderId));
      requireOpen(target, 'The other order');
      if (target.branch_id !== source.branch_id) throw new TabError(400, 'The other order is at a different outlet');
      if (target.order_type !== 'DINE_IN') throw new TabError(400, 'The other order is not a dine-in order');
    } else {
      const table = (await client.query(`SELECT table_id, name, status FROM dining_tables WHERE table_id = $1 AND business_id = $2 AND branch_id = $3`, [Number(tableId), businessId, source.branch_id])).rows[0];
      if (!table) throw new TabError(400, 'Table not found');
      if (table.table_id === source.table_id) throw new TabError(400, 'Choose a different table');
      const running = (await client.query(`SELECT 1 FROM orders WHERE table_id = $1 AND status NOT IN ('BILLED','CANCELLED','MERGED')`, [table.table_id])).rows.length > 0;
      if (!running && table.status !== 'FREE') throw new TabError(400, `${table.name} is ${table.status.toLowerCase()}`);
      target = await getOrCreateOpenOrderForTable(client, { businessId, branchId: source.branch_id, tableId: table.table_id, createdBy: req.auth.userId });
    }
    if (target.order_id === sourceId) throw new TabError(400, 'Choose a different order');

    const moving = await takeItems(client, sourceId, items);
    await client.query(`UPDATE order_items SET order_id = $1 WHERE order_item_id = ANY($2::int[])`, [target.order_id, moving]);
    // Items already in the kitchen mean the new tab is in progress, not "open".
    await client.query(
      `UPDATE orders SET status = 'PREPARING', updated_at = CURRENT_TIMESTAMP
       WHERE order_id = $1 AND status = 'OPEN' AND EXISTS (SELECT 1 FROM order_items WHERE order_item_id = ANY($2::int[]) AND status <> 'PENDING')`,
      [target.order_id, moving]
    );
    await client.query(`UPDATE orders SET updated_at = CURRENT_TIMESTAMP WHERE order_id = $1`, [sourceId]);

    await client.query('COMMIT');
    recordAudit(req, { action: 'order.split', resource_type: 'order', resource_id: sourceId, metadata: { to_order_id: target.order_id, items: moving.length } });
    res.json({ success: true, data: { source: await summary(pool, businessId, sourceId), target: await summary(pool, businessId, target.order_id), moved: moving.length } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return fail(res, error);
  } finally {
    client.release();
  }
};
