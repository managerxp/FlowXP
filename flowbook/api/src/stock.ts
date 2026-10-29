import { audit } from './audit.ts';
import type { Db } from './db.ts';
import { LedgerError, post } from './ledger.ts';
import { paiseToString, roundDiv, toPaise } from './money.ts';

/* Stock. Goods marked "track stock" are counted in on bills and out on invoices, valued at weighted-average cost. Every change is a row in
   stock_moves (signed quantity and value, never edited), so the quantity and value of an item are just sums. A bill puts the price into Inventory; an
   invoice posts a second entry, Cost of goods sold against Inventory, so Inventory in the books equals the value of what is on hand. */

export type TrackedLine = { item_id: bigint; name: string; qty_milli: bigint; taxable_minor: bigint };
type Move = { itemId: bigint; qty: bigint; value: bigint; date: string; source: 'BILL' | 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'ADJUSTMENT' | 'VOID' | 'TRANSFER'; warehouseId?: bigint; documentId?: bigint; entryId?: bigint; memo?: string; costed?: boolean; reverses?: bigint; override?: { reason: string } };

export const toMilli = (text: string, what = 'quantity'): bigint => {
  const m = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(text.trim());
  const v = m ? BigInt(m[1] as string) * 1000n + BigInt(((m[2] ?? '') + '000').slice(0, 3)) : 0n;
  if (v <= 0n) throw new LedgerError('bad_quantity', `${text} is not a ${what} above zero (three decimals at most)`);
  return v;
};
export const milliToString = (q: bigint): string => `${q < 0n ? '-' : ''}${(q < 0n ? -q : q) / 1000n}.${String((q < 0n ? -q : q) % 1000n).padStart(3, '0')}`;

/** The warehouse used when none is named: the one marked default, made on first use for a business that has none. */
export const defaultWarehouse = async (c: Db, orgId: bigint): Promise<bigint> => {
  const w = (await c.query(`SELECT id FROM warehouses WHERE is_default`)).rows[0];
  if (w) return w.id as bigint;
  return (await c.query(`INSERT INTO warehouses (organization_id, name, is_default) VALUES ($1, 'Main', true) RETURNING id`, [orgId])).rows[0].id as bigint;
};

/** How much of an item sits in one warehouse (as at the end of a date when one is given). */
const qtyIn = async (c: Db, itemId: bigint, warehouseId: bigint, date?: string): Promise<{ qty: bigint; name: string; several: boolean }> => {
  const r = (await c.query(
    `SELECT COALESCE((SELECT SUM(qty_milli) FROM stock_moves WHERE item_id = $1 AND warehouse_id = $2 AND ($3::date IS NULL OR move_date <= $3::date)), 0)::bigint AS qty,
            (SELECT name FROM warehouses WHERE id = $2) AS name, (SELECT count(*) > 1 FROM warehouses WHERE active) AS several`, [itemId, warehouseId, date ?? null])).rows[0];
  return { qty: r.qty as bigint, name: r.name as string, several: r.several as boolean };
};

/** What is on hand (as it stood at the end of a date, when one is given), locking the item so two sales cannot both take the last unit. */
const lockOnHand = async (c: Db, itemId: bigint, date?: string) => {
  const item = (await c.query(`SELECT name, purchase_price_minor, track_stock FROM items WHERE id = $1 FOR UPDATE`, [itemId])).rows[0];
  if (!item) throw new LedgerError('not_found', 'no such item');
  const s = (await c.query(`SELECT COALESCE(SUM(qty_milli), 0)::bigint AS qty, COALESCE(SUM(value_minor), 0)::bigint AS value FROM stock_moves WHERE item_id = $1 AND ($2::date IS NULL OR move_date <= $2::date)`, [itemId, date ?? null])).rows[0];
  return { name: item.name as string, buyPrice: item.purchase_price_minor as bigint, tracked: item.track_stock as boolean, qty: s.qty as bigint, value: s.value as bigint };
};

/** The tracked goods on a document, one row per item (several lines of one item add up). */
export const trackedLines = async (c: Db, documentId: bigint): Promise<TrackedLine[]> => (await c.query(
  `SELECT l.item_id, i.name, SUM(l.quantity_milli)::bigint AS qty_milli, SUM(l.taxable_minor)::bigint AS taxable_minor
     FROM document_lines l JOIN items i ON i.id = l.item_id WHERE l.document_id = $1 AND i.track_stock GROUP BY l.item_id, i.name ORDER BY l.item_id`, [documentId])).rows;

/** Cost of taking qty out at today's average. Refuses to go below zero. */
export const costOut = async (c: Db, itemId: bigint, qty: bigint, date?: string, warehouseId?: bigint): Promise<bigint> => {
  const s = await lockOnHand(c, itemId, date);
  if (warehouseId) {
    const w = await qtyIn(c, itemId, warehouseId, date);
    if (qty > w.qty) throw new LedgerError('insufficient_stock', `only ${milliToString(w.qty)} of ${s.name} in ${w.several ? w.name : 'stock'}${date ? ` on ${date}` : ''}, need ${milliToString(qty)}`);
  }
  if (qty > s.qty) throw new LedgerError('insufficient_stock', `only ${milliToString(s.qty)} of ${s.name} in stock${date ? ` on ${date}` : ''}, need ${milliToString(qty)}`);
  return qty === s.qty ? s.value : roundDiv(s.value * qty, s.qty);
};

/** Cost of bringing qty back in (a sale returned): today's average, or the item's buying price when nothing is in stock. */
export const costIn = async (c: Db, itemId: bigint, qty: bigint, date?: string): Promise<bigint> => {
  const s = await lockOnHand(c, itemId, date);
  return s.qty > 0n && s.value > 0n ? roundDiv(s.value * qty, s.qty) : roundDiv(s.buyPrice * qty, 1000n);
};

/**
 * Work every movement of an item out again in date order. Moves valued at the average take the average as it stood that day; a purchase entered
 * for an earlier date therefore changes the cost of the sales after it. Each change is posted for the date of the movement it corrects
 * (Inventory against Cost of goods sold), so the books and the stock value stay equal. Refuses if the stock would have gone below zero on some day.
 */
export const recost = async (c: Db, orgId: bigint, itemId: bigint, actor: string, override?: { reason: string }): Promise<number> => {
  const moves = (await c.query(
    `SELECT m.id, m.move_date::text AS date, m.qty_milli, m.value_minor, m.costed, m.reverses_move_id, m.warehouse_id, i.name FROM stock_moves m JOIN items i ON i.id = m.item_id WHERE m.item_id = $1 ORDER BY m.move_date, m.id`, [itemId])).rows;
  let q = 0n; let v = 0n;
  const inWh = new Map<bigint, bigint>();
  const now = new Map<bigint, bigint>();
  const stored = new Map<bigint, bigint>(moves.map((m) => [m.id as bigint, m.value_minor as bigint]));
  const changes: { id: bigint; date: string; delta: bigint }[] = [];
  for (const m of moves) {
    const qty = m.qty_milli as bigint;
    let val = m.value_minor as bigint;
    if (m.reverses_move_id) val = -(now.get(m.reverses_move_id as bigint) ?? stored.get(m.reverses_move_id as bigint) ?? 0n);
    else if (m.costed && qty < 0n) val = -(-qty === q ? v : q > 0n ? roundDiv(v * -qty, q) : 0n);
    else if (m.costed && q > 0n && v > 0n) val = roundDiv(v * qty, q);
    if (q + qty < 0n) throw new LedgerError('insufficient_stock', `only ${milliToString(q)} of ${m.name} would have been in stock on ${m.date}`);
    const wh = (inWh.get(m.warehouse_id as bigint) ?? 0n) + qty;
    if (wh < 0n) throw new LedgerError('insufficient_stock', `only ${milliToString(wh - qty)} of ${m.name} would have been in that warehouse on ${m.date}`);
    inWh.set(m.warehouse_id as bigint, wh);
    q += qty; v += val; now.set(m.id as bigint, val);
    if (val !== m.value_minor) changes.push({ id: m.id as bigint, date: m.date as string, delta: val - (m.value_minor as bigint) });
  }
  const byDate = new Map<string, bigint>();
  for (const ch of changes) {
    await c.query(`UPDATE stock_moves SET value_minor = $2 WHERE id = $1`, [ch.id, now.get(ch.id)]);
    byDate.set(ch.date, (byDate.get(ch.date) ?? 0n) + ch.delta);
  }
  for (const [date, net] of byDate) {
    if (net === 0n) continue;
    const up = net > 0n; const amount = up ? net : -net;   // stock worth more: Dr Inventory, Cr Cost of goods sold
    await post(c, orgId, { date, sourceType: 'stock_recost', sourceId: `${itemId}-${date}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind: 'COGS', memo: 'Cost corrected after an earlier stock movement was entered', actor, override,
      lines: [{ account: 'INVENTORY', side: up ? 'D' : 'C', amount }, { account: 'COGS', side: up ? 'C' : 'D', amount }] });
  }
  if (changes.length) await audit(c, orgId, { actor, action: 'stock.recosted', entityType: 'item', entityId: itemId, detail: { moves: changes.length } });
  return changes.length;
};

export const record = async (c: Db, orgId: bigint, actor: string, m: Move): Promise<bigint> => {
  const later = (await c.query(`SELECT 1 FROM stock_moves WHERE item_id = $1 AND move_date > $2::date LIMIT 1`, [m.itemId, m.date])).rowCount;
  const id = (await c.query(`INSERT INTO stock_moves (organization_id, item_id, move_date, qty_milli, value_minor, source_type, document_id, journal_entry_id, memo, created_by, costed, reverses_move_id, warehouse_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
    [orgId, m.itemId, m.date, m.qty, m.value, m.source, m.documentId ?? null, m.entryId ?? null, m.memo ?? null, actor, m.costed ?? false, m.reverses ?? null, m.warehouseId ?? await defaultWarehouse(c, orgId)])).rows[0].id as bigint;
  if (later) await recost(c, orgId, m.itemId, actor, m.override);
  return id;
};

/** Cost of goods sold (Dr COGS, Cr Inventory) beside an invoice, or the reverse beside a credit note. */
export const costEntry = (c: Db, orgId: bigint, d: { date: string; number: string; kind: 'INVOICE' | 'CREDIT_NOTE'; value: bigint; actor: string; override?: { reason: string } }) => post(c, orgId, {
  date: d.date, sourceType: d.kind === 'INVOICE' ? 'invoice_cogs' : 'credit_note_cogs', sourceId: d.number, kind: 'COGS', memo: `Cost of goods ${d.number}`, actor: d.actor, override: d.override,
  lines: [{ account: d.kind === 'INVOICE' ? 'COGS' : 'INVENTORY', side: 'D', amount: d.value }, { account: d.kind === 'INVOICE' ? 'INVENTORY' : 'COGS', side: 'C', amount: d.value }]
});

/** Undo a voided document's stock moves with opposite moves of the same value. A purchase cannot be undone once some of it has been sold. */
export const undoMoves = async (c: Db, orgId: bigint, documentId: bigint, date: string, actor: string, override?: { reason: string }): Promise<bigint> => {
  let worth = 0n;
  const moves = (await c.query(`SELECT id, item_id, qty_milli, value_minor, warehouse_id FROM stock_moves WHERE document_id = $1 AND source_type <> 'VOID' ORDER BY id`, [documentId])).rows;
  for (const m of moves) {
    const s = await lockOnHand(c, m.item_id as bigint);
    const w = await qtyIn(c, m.item_id as bigint, m.warehouse_id as bigint);
    if (m.qty_milli > 0n && (s.qty < m.qty_milli || w.qty < m.qty_milli)) throw new LedgerError('insufficient_stock', `some of the ${s.name} from this document has been sold, moved or used; only ${milliToString(w.qty < s.qty ? w.qty : s.qty)} is left`);
    await record(c, orgId, actor, { itemId: m.item_id, qty: -(m.qty_milli as bigint), value: -(m.value_minor as bigint), date, source: 'VOID', documentId, memo: 'Document voided', reverses: m.id, override, warehouseId: m.warehouse_id });
    worth += m.value_minor as bigint;
  }
  return worth;   // the moves' value as it stands now; it differs from the cost entry posted with the document if the document was recosted
};

export type AdjustIn = { warehouseId?: bigint; itemId: bigint; date: string; direction: 'IN' | 'OUT'; quantity: string; unitCost?: string; counterAccount: string | bigint; reason: string };
/** Opening stock, a count that came out different, damage or loss. The other side of the entry is the account you choose. */
export const adjust = async (c: Db, orgId: bigint, a: AdjustIn, actor: string, override?: { reason: string }) => {
  const qty = toMilli(a.quantity);
  if (['INVENTORY', '1200'].includes(String(a.counterAccount))) throw new LedgerError('same_account', 'choose the account on the other side, not Inventory itself');
  if (!a.reason.trim()) throw new LedgerError('reason_required', 'say why the stock changed');
  const s = await lockOnHand(c, a.itemId);
  if (!s.tracked) throw new LedgerError('not_tracked', `${s.name} is not set to track stock`);
  let value: bigint;
  if (a.direction === 'IN') {
    if (a.unitCost === undefined) throw new LedgerError('cost_required', 'say what each unit cost');
    value = roundDiv(toPaise(a.unitCost) * qty, 1000n);
  } else value = await costOut(c, a.itemId, qty, a.date, a.warehouseId ?? await defaultWarehouse(c, orgId));
  const posted = value > 0n ? await post(c, orgId, {
    date: a.date, sourceType: 'stock_adjustment', sourceId: `${a.itemId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind: 'STOCK', memo: `Stock ${a.direction === 'IN' ? 'in' : 'out'}: ${s.name} (${a.reason.trim().slice(0, 100)})`, actor, override,
    lines: [{ account: 'INVENTORY', side: a.direction === 'IN' ? 'D' : 'C', amount: value }, { account: a.counterAccount, side: a.direction === 'IN' ? 'C' : 'D', amount: value }]
  }) : null;
  await record(c, orgId, actor, { itemId: a.itemId, qty: a.direction === 'IN' ? qty : -qty, value: a.direction === 'IN' ? value : -value, date: a.date, source: 'ADJUSTMENT', entryId: posted?.entryId, memo: a.reason.trim().slice(0, 200), costed: a.direction === 'OUT', override, warehouseId: a.warehouseId });
  await audit(c, orgId, { actor, action: 'stock.adjusted', entityType: 'item', entityId: a.itemId, detail: { direction: a.direction, quantity: milliToString(qty), value: paiseToString(value) } });
  return { entryNo: posted?.entryNo ?? null, value };
};

export const setTracking = async (c: Db, orgId: bigint, itemId: bigint, o: { trackStock?: boolean; reorderLevel?: string }, actor: string): Promise<void> => {
  const s = await lockOnHand(c, itemId);
  const item = (await c.query(`SELECT kind FROM items WHERE id = $1`, [itemId])).rows[0];
  if (o.trackStock && item.kind !== 'GOODS') throw new LedgerError('not_goods', 'only goods can be counted in stock, not services');
  if (o.trackStock === false && (await c.query(`SELECT 1 FROM stock_moves WHERE item_id = $1 LIMIT 1`, [itemId])).rowCount) throw new LedgerError('has_moves', `${s.name} already has stock history, so it cannot stop being tracked`);
  const level = o.reorderLevel === undefined ? null : /^0+(\.0+)?$/.test(o.reorderLevel.trim()) ? 0n : toMilli(o.reorderLevel, 'level');
  await c.query(`UPDATE items SET track_stock = COALESCE($2, track_stock), reorder_level_milli = COALESCE($3, reorder_level_milli) WHERE id = $1`, [itemId, o.trackStock ?? null, level]);
  await audit(c, orgId, { actor, action: 'item.stock_tracking', entityType: 'item', entityId: itemId, detail: { trackStock: o.trackStock ?? null } });
};

/** Quantity, value and average cost of every tracked item, and whether it is at or under its reorder level. */
export const stockSummary = async (c: Db, warehouseId?: bigint) => (await c.query(
  `SELECT i.id, i.sku, i.name, i.unit, i.reorder_level_milli,
          COALESCE(SUM(m.qty_milli), 0)::bigint AS qty_milli, COALESCE(SUM(m.value_minor), 0)::bigint AS value_minor,
          (i.reorder_level_milli > 0 AND COALESCE(SUM(m.qty_milli), 0) <= i.reorder_level_milli) AS low
     FROM items i LEFT JOIN stock_moves m ON m.item_id = i.id AND ($1::bigint IS NULL OR m.warehouse_id = $1) WHERE i.track_stock AND i.active GROUP BY i.id ORDER BY i.name`, [warehouseId ?? null])).rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name, unit: r.unit, quantity: milliToString(r.qty_milli), reorder_level: milliToString(r.reorder_level_milli), value_minor: r.value_minor, low: r.low }));   // quantities as text: the wire format would read a bare bigint as rupees

export const stockLedger = async (c: Db, itemId: bigint, limit: number) => (await c.query(
  `SELECT id, move_date::text AS date, qty_milli, value_minor, source_type, document_id, memo FROM stock_moves WHERE item_id = $1 ORDER BY id DESC LIMIT $2`, [itemId, limit])).rows.map((r) => ({ id: r.id, date: r.date, quantity: milliToString(r.qty_milli), value_minor: r.value_minor, source_type: r.source_type, document_id: r.document_id, memo: r.memo }));

/* ---- warehouses */

export const listWarehouses = async (c: Db, orgId: bigint) => {
  await defaultWarehouse(c, orgId);
  return (await c.query(
    `SELECT w.id, w.name, w.is_default, w.active, COALESCE(SUM(m.qty_milli), 0)::bigint AS qty_milli FROM warehouses w LEFT JOIN stock_moves m ON m.warehouse_id = w.id GROUP BY w.id ORDER BY w.is_default DESC, w.name`)).rows
    .map((w) => ({ id: w.id, name: w.name, is_default: w.is_default, active: w.active, quantity: milliToString(w.qty_milli) }));
};

export const addWarehouse = async (c: Db, orgId: bigint, name: string, actor: string): Promise<bigint> => {
  await defaultWarehouse(c, orgId);
  const id = (await c.query(`INSERT INTO warehouses (organization_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id`, [orgId, name.trim()])).rows[0]?.id as bigint | undefined;
  if (!id) throw new LedgerError('warehouse_exists', `there is already a warehouse called ${name.trim()}`);
  await audit(c, orgId, { actor, action: 'warehouse.added', entityType: 'warehouse', entityId: id, detail: { name: name.trim() } });
  return id;
};

export const updateWarehouse = async (c: Db, orgId: bigint, id: bigint, o: { name?: string; active?: boolean; makeDefault?: boolean }, actor: string): Promise<void> => {
  const w = (await c.query(`SELECT is_default FROM warehouses WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  if (!w) throw new LedgerError('not_found', 'no such warehouse');
  if (o.active === false) {
    if (w.is_default) throw new LedgerError('is_default', 'the default warehouse cannot be switched off; make another one the default first');
    const left = (await c.query(`SELECT COALESCE(SUM(qty_milli), 0)::bigint AS q FROM stock_moves WHERE warehouse_id = $1`, [id])).rows[0].q as bigint;
    if (left !== 0n) throw new LedgerError('has_stock', `it still holds ${milliToString(left)} in stock; move that out first`);
  }
  if (o.makeDefault) { await c.query(`UPDATE warehouses SET is_default = false WHERE is_default`); }
  try {
    await c.query(`UPDATE warehouses SET name = COALESCE($2, name), active = COALESCE($3, active), is_default = CASE WHEN $4 THEN true ELSE is_default END WHERE id = $1`, [id, o.name?.trim() || null, o.active ?? null, Boolean(o.makeDefault)]);
  } catch (e) { if ((e as { code?: string }).code === '23505') throw new LedgerError('warehouse_exists', 'there is already a warehouse with that name'); throw e; }
  await audit(c, orgId, { actor, action: 'warehouse.updated', entityType: 'warehouse', entityId: id, detail: o });
};

/** Move stock between warehouses at today's average cost: an out and an in of equal value, no journal. */
export const transferStock = async (c: Db, orgId: bigint, t: { itemId: bigint; from: bigint; to: bigint; quantity: string; date: string; memo?: string }, actor: string, override?: { reason: string }) => {
  if (t.from === t.to) throw new LedgerError('same_warehouse', 'choose two different warehouses');
  const qty = toMilli(t.quantity);
  const s = await lockOnHand(c, t.itemId);
  if (!s.tracked) throw new LedgerError('not_tracked', `${s.name} is not set to track stock`);
  for (const w of [t.from, t.to]) if (!(await c.query(`SELECT 1 FROM warehouses WHERE id = $1 AND active`, [w])).rowCount) throw new LedgerError('bad_warehouse', 'choose warehouses that are in use');
  const value = await costOut(c, t.itemId, qty, t.date, t.from);
  const memo = (t.memo?.trim() || 'Transfer').slice(0, 200);
  const out = await record(c, orgId, actor, { itemId: t.itemId, qty: -qty, value: -value, date: t.date, source: 'TRANSFER', memo, costed: true, warehouseId: t.from, override });
  await record(c, orgId, actor, { itemId: t.itemId, qty, value, date: t.date, source: 'TRANSFER', memo, reverses: out, warehouseId: t.to, override });
  await audit(c, orgId, { actor, action: 'stock.transferred', entityType: 'item', entityId: t.itemId, detail: { quantity: milliToString(qty), from: String(t.from), to: String(t.to) } });
  return { value };
};

/** Quantity of each tracked item in each warehouse that holds some. */
export const stockByWarehouse = async (c: Db) => (await c.query(
  `SELECT m.item_id, i.name, m.warehouse_id, w.name AS warehouse, SUM(m.qty_milli)::bigint AS qty_milli FROM stock_moves m JOIN items i ON i.id = m.item_id JOIN warehouses w ON w.id = m.warehouse_id
    GROUP BY m.item_id, i.name, m.warehouse_id, w.name HAVING SUM(m.qty_milli) <> 0 ORDER BY i.name, w.name`)).rows
  .map((r) => ({ item_id: r.item_id, name: r.name, warehouse_id: r.warehouse_id, warehouse: r.warehouse, quantity: milliToString(r.qty_milli) }));
