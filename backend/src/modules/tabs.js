/*
 * Operations on a running tab: taking part of it (to bill separately or move to
 * another table), and the ordering rules the transfer/merge/split handlers
 * share. All of these run inside the caller's transaction.
 *
 * "Part of a line" is real: two portions of naan on one line can be paid for by
 * two guests. takeItems() splits the row so each side keeps its own quantity,
 * price, modifiers and kitchen trail.
 */
export class TabError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'TabError';
    this.status = status;
  }
}

export const OPEN_STATUSES = ['OPEN', 'PREPARING', 'READY', 'SERVED'];

/** How far along a tab is, so a merged tab takes the earlier stage. */
export const stageOf = (status) => OPEN_STATUSES.indexOf(status);
export const earlierStage = (a, b) => (stageOf(a) <= stageOf(b) ? a : b);

/** Lock orders in id order (so two staff merging the same pair can't deadlock) and return them by id. */
export const lockOrders = async (client, businessId, ids, scopeBranchId = null) => {
  const { rows } = await client.query(
    `SELECT * FROM orders WHERE business_id = $1 AND order_id = ANY($2::int[])${scopeBranchId != null ? ' AND branch_id = $3' : ''} ORDER BY order_id FOR UPDATE`,
    scopeBranchId != null ? [businessId, ids, scopeBranchId] : [businessId, ids]
  );
  return new Map(rows.map((r) => [r.order_id, r]));
};

/** Validate a selection: [{ order_item_id, quantity? }]. Returns a clean list, or throws. */
export const cleanSelection = (selections) => {
  if (!Array.isArray(selections) || !selections.length) throw new TabError(400, 'Choose at least one item');
  const seen = new Set();
  return selections.map((s) => {
    const id = Number(s.order_item_id);
    const quantity = s.quantity == null ? null : Number(s.quantity);
    if (!Number.isInteger(id) || id <= 0) throw new TabError(400, 'Unknown item');
    if (seen.has(id)) throw new TabError(400, 'An item is listed twice');
    if (quantity != null && !(quantity > 0)) throw new TabError(400, 'Quantity must be more than zero');
    seen.add(id);
    return { order_item_id: id, quantity };
  });
};

/**
 * Take the selected quantities out of an order's unbilled items, splitting a
 * row when only part of it is taken. Returns the ids of the rows that now hold
 * exactly what was selected.
 */
export const takeItems = async (client, orderId, selections) => {
  const clean = cleanSelection(selections);
  const { rows } = await client.query(
    `SELECT * FROM order_items WHERE order_id = $1 AND order_item_id = ANY($2::int[]) AND status <> 'CANCELLED' AND invoice_id IS NULL FOR UPDATE`,
    [orderId, clean.map((s) => s.order_item_id)]
  );
  if (rows.length !== clean.length) throw new TabError(400, 'Some of those items are not on this order any more, or are already billed or cancelled');

  const byId = new Map(rows.map((r) => [r.order_item_id, r]));
  const taken = [];
  for (const sel of clean) {
    const row = byId.get(sel.order_item_id);
    const have = Number(row.quantity);
    const want = sel.quantity ?? have;
    if (want > have) throw new TabError(400, `Only ${have} of ${row.description} on this order`);
    if (want === have) { taken.push(row.order_item_id); continue; }

    await client.query(`UPDATE order_items SET quantity = quantity - $1 WHERE order_item_id = $2`, [want, row.order_item_id]);
    const copy = await client.query(
      `INSERT INTO order_items (order_id, product_id, description, quantity, unit_price_paise, kitchen_notes, kot_id, status, modifiers, station_id, expected_minutes, sent_at, ready_at, served_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING order_item_id`,
      [orderId, row.product_id, row.description, want, row.unit_price_paise, row.kitchen_notes, row.kot_id, row.status, JSON.stringify(row.modifiers || []), row.station_id, row.expected_minutes, row.sent_at, row.ready_at, row.served_at]
    );
    taken.push(copy.rows[0].order_item_id);
  }
  return taken;
};

/** Items still to be paid for on an order. */
export const unbilledCount = async (client, orderId) =>
  Number((await client.query(`SELECT COUNT(*) AS n FROM order_items WHERE order_id = $1 AND status <> 'CANCELLED' AND invoice_id IS NULL`, [orderId])).rows[0].n);
