import { audit } from './audit.ts';
import type { Db } from './db.ts';
import { LedgerError, post } from './ledger.ts';
import { paiseToString, roundDiv, toPaise } from './money.ts';

/* Stock. Goods marked "track stock" are counted in on bills and out on invoices, valued at weighted-average cost. Every change is a row in
   stock_moves (signed quantity and value, never edited), so the quantity and value of an item are just sums. A bill puts the price into Inventory; an
   invoice posts a second entry, Cost of goods sold against Inventory, so Inventory in the books equals the value of what is on hand. */

export type TrackedLine = { item_id: bigint; name: string; qty_milli: bigint; taxable_minor: bigint };
type Move = { itemId: bigint; qty: bigint; value: bigint; date: string; source: 'BILL' | 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'ADJUSTMENT' | 'VOID'; documentId?: bigint; entryId?: bigint; memo?: string; costed?: boolean; reverses?: bigint; override?: { reason: string } };

export const toMilli = (text: string, what = 'quantity'): bigint => {
  const m = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(text.trim());
  const v = m ? BigInt(m[1] as string) * 1000n + BigInt(((m[2] ?? '') + '000').slice(0, 3)) : 0n;
  if (v <= 0n) throw new LedgerError('bad_quantity', `${text} is not a ${what} above zero (three decimals at most)`);
  return v;
};
export const milliToString = (q: bigint): string => `${q < 0n ? '-' : ''}${(q < 0n ? -q : q) / 1000n}.${String((q < 0n ? -q : q) % 1000n).padStart(3, '0')}`;

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
export const costOut = async (c: Db, itemId: bigint, qty: bigint, date?: string): Promise<bigint> => {
  const s = await lockOnHand(c, itemId, date);
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
    `SELECT m.id, m.move_date::text AS date, m.qty_milli, m.value_minor, m.costed, m.reverses_move_id, i.name FROM stock_moves m JOIN items i ON i.id = m.item_id WHERE m.item_id = $1 ORDER BY m.move_date, m.id`, [itemId])).rows;
  let q = 0n; let v = 0n;
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

export const record = async (c: Db, orgId: bigint, actor: string, m: Move): Promise<void> => {
  const later = (await c.query(`SELECT 1 FROM stock_moves WHERE item_id = $1 AND move_date > $2::date LIMIT 1`, [m.itemId, m.date])).rowCount;
  await c.query(`INSERT INTO stock_moves (organization_id, item_id, move_date, qty_milli, value_minor, source_type, document_id, journal_entry_id, memo, created_by, costed, reverses_move_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [orgId, m.itemId, m.date, m.qty, m.value, m.source, m.documentId ?? null, m.entryId ?? null, m.memo ?? null, actor, m.costed ?? false, m.reverses ?? null]);
  if (later) await recost(c, orgId, m.itemId, actor, m.override);
};

/** Cost of goods sold (Dr COGS, Cr Inventory) beside an invoice, or the reverse beside a credit note. */
export const costEntry = (c: Db, orgId: bigint, d: { date: string; number: string; kind: 'INVOICE' | 'CREDIT_NOTE'; value: bigint; actor: string; override?: { reason: string } }) => post(c, orgId, {
  date: d.date, sourceType: d.kind === 'INVOICE' ? 'invoice_cogs' : 'credit_note_cogs', sourceId: d.number, kind: 'COGS', memo: `Cost of goods ${d.number}`, actor: d.actor, override: d.override,
  lines: [{ account: d.kind === 'INVOICE' ? 'COGS' : 'INVENTORY', side: 'D', amount: d.value }, { account: d.kind === 'INVOICE' ? 'INVENTORY' : 'COGS', side: 'C', amount: d.value }]
});

/** Undo a voided document's stock moves with opposite moves of the same value. A purchase cannot be undone once some of it has been sold. */
export const undoMoves = async (c: Db, orgId: bigint, documentId: bigint, date: string, actor: string, override?: { reason: string }): Promise<bigint> => {
  let worth = 0n;
  const moves = (await c.query(`SELECT id, item_id, qty_milli, value_minor FROM stock_moves WHERE document_id = $1 AND source_type <> 'VOID' ORDER BY id`, [documentId])).rows;
  for (const m of moves) {
    const s = await lockOnHand(c, m.item_id as bigint);
    if (m.qty_milli > 0n && s.qty < m.qty_milli) throw new LedgerError('insufficient_stock', `some of the ${s.name} from this document has been sold or used; only ${milliToString(s.qty)} is left`);
    await record(c, orgId, actor, { itemId: m.item_id, qty: -(m.qty_milli as bigint), value: -(m.value_minor as bigint), date, source: 'VOID', documentId, memo: 'Document voided', reverses: m.id, override });
    worth += m.value_minor as bigint;
  }
  return worth;   // the moves' value as it stands now; it differs from the cost entry posted with the document if the document was recosted
};

export type AdjustIn = { itemId: bigint; date: string; direction: 'IN' | 'OUT'; quantity: string; unitCost?: string; counterAccount: string | bigint; reason: string };
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
  } else value = await costOut(c, a.itemId, qty, a.date);
  const posted = value > 0n ? await post(c, orgId, {
    date: a.date, sourceType: 'stock_adjustment', sourceId: `${a.itemId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, kind: 'STOCK', memo: `Stock ${a.direction === 'IN' ? 'in' : 'out'}: ${s.name} (${a.reason.trim().slice(0, 100)})`, actor, override,
    lines: [{ account: 'INVENTORY', side: a.direction === 'IN' ? 'D' : 'C', amount: value }, { account: a.counterAccount, side: a.direction === 'IN' ? 'C' : 'D', amount: value }]
  }) : null;
  await record(c, orgId, actor, { itemId: a.itemId, qty: a.direction === 'IN' ? qty : -qty, value: a.direction === 'IN' ? value : -value, date: a.date, source: 'ADJUSTMENT', entryId: posted?.entryId, memo: a.reason.trim().slice(0, 200), costed: a.direction === 'OUT', override });
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
export const stockSummary = async (c: Db) => (await c.query(
  `SELECT i.id, i.sku, i.name, i.unit, i.reorder_level_milli,
          COALESCE(SUM(m.qty_milli), 0)::bigint AS qty_milli, COALESCE(SUM(m.value_minor), 0)::bigint AS value_minor,
          (i.reorder_level_milli > 0 AND COALESCE(SUM(m.qty_milli), 0) <= i.reorder_level_milli) AS low
     FROM items i LEFT JOIN stock_moves m ON m.item_id = i.id WHERE i.track_stock AND i.active GROUP BY i.id ORDER BY i.name`)).rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name, unit: r.unit, quantity: milliToString(r.qty_milli), reorder_level: milliToString(r.reorder_level_milli), value_minor: r.value_minor, low: r.low }));   // quantities as text: the wire format would read a bare bigint as rupees

export const stockLedger = async (c: Db, itemId: bigint, limit: number) => (await c.query(
  `SELECT id, move_date::text AS date, qty_milli, value_minor, source_type, document_id, memo FROM stock_moves WHERE item_id = $1 ORDER BY id DESC LIMIT $2`, [itemId, limit])).rows.map((r) => ({ id: r.id, date: r.date, quantity: milliToString(r.qty_milli), value_minor: r.value_minor, source_type: r.source_type, document_id: r.document_id, memo: r.memo }));
