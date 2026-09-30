/*
 * Debit notes to suppliers: the formal document for goods sent back (RETURN) or a price overcharge (PRICE) on a
 * purchase order that has arrived.
 *
 * It reduces what we owe the supplier: first what is still unpaid on that order, and anything beyond that (the order
 * was already paid) is a credit the supplier owes us. Returns also take the stock back out of the outlet the order was
 * received at. Tax is reversed at the line's own rate, so the input tax on the purchase is reduced by exactly the
 * tax on what went back. A debit note is final: to correct one, raise another document rather than editing it.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { moveStock, stockAt } from '../modules/stock.js';
import { computeLineTax, isInterState, sumLines } from '../modules/tax.js';
import { branchFilter } from '../utils/scope.js';
import { toPaise, toQuantity, toRupees } from '../utils/money.js';
import { paymentStatus } from './purchases.controller.js';

class NoteError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });
const round3 = (n) => Math.round(n * 1000) / 1000;

const asNote = (r) => ({
  dn_id: r.dn_id, dn_number: r.dn_number, dn_date: r.dn_date, kind: r.kind, reason: r.reason,
  po_id: r.po_id, po_number: r.po_number, supplier_id: r.supplier_id, supplier_name: r.supplier_name ?? null,
  subtotal: toRupees(r.subtotal_paise), tax: toRupees(r.tax_paise), total: toRupees(r.total_paise),
  applied: toRupees(r.applied_paise), credit: toRupees(r.credit_paise), created_at: r.created_at
});

const nextDnNumber = async (client, businessId) => {
  const { rows } = await client.query(`SELECT debit_note_prefix, debit_note_next_number FROM businesses WHERE business_id = $1 FOR UPDATE`, [businessId]);
  await client.query(`UPDATE businesses SET debit_note_next_number = debit_note_next_number + 1 WHERE business_id = $1`, [businessId]);
  return `${rows[0].debit_note_prefix}-${String(rows[0].debit_note_next_number).padStart(4, '0')}`;
};

/** Received, already sent back, and so still returnable, per line of an order. */
const returnable = async (db, poId) => (await db.query(
  `SELECT i.item_id, i.product_id, i.description, i.received_quantity, i.unit_cost_paise, i.tax_rate,
          COALESCE((SELECT SUM(d.quantity) FROM debit_note_items d JOIN debit_notes n ON n.dn_id = d.dn_id WHERE d.po_item_id = i.item_id AND n.kind = 'RETURN'), 0) AS returned,
          p.track_inventory
   FROM purchase_order_items i LEFT JOIN products p ON p.product_id = i.product_id
   WHERE i.po_id = $1 AND COALESCE(i.received_quantity, 0) > 0 ORDER BY i.item_id`, [poId])).rows;

/* GET /api/purchases/:id/debit-notes/options — what can still be returned, per line */
export const options = async (req, res) => {
  const values = [req.tenant.businessId, req.params.id];
  const po = (await pool.query(`SELECT po_id, po_number, status FROM purchase_orders WHERE business_id = $1 AND po_id = $2${branchFilter(req.tenant, 'branch_id', values)}`, values)).rows[0];
  if (!po) return bad(res, 'Not found', 404);
  const rows = await returnable(pool, po.po_id);
  res.json({
    success: true,
    data: { po_number: po.po_number, status: po.status, items: rows.map((r) => ({
      item_id: r.item_id, description: r.description, received: Number(r.received_quantity), returned: Number(r.returned),
      returnable: round3(Number(r.received_quantity) - Number(r.returned)), unit_cost: toRupees(r.unit_cost_paise), tax_rate: Number(r.tax_rate), tracks_stock: Boolean(r.track_inventory)
    })) }
  });
};

/* POST /api/purchases/:id/debit-notes { kind: RETURN | PRICE, reason, items: [{ item_id, quantity, unit_cost? }] }
   RETURN: quantity sent back (at the price paid). PRICE: quantity affected and unit_cost = the overcharge per unit. */
export const create = async (req, res) => {
  const body = req.body || {};
  const kind = body.kind === 'PRICE' ? 'PRICE' : body.kind === 'RETURN' ? 'RETURN' : null;
  if (!kind) return bad(res, 'Choose whether this is goods sent back or a price correction');
  const reason = String(body.reason ?? '').trim().slice(0, 300);
  if (!reason) return bad(res, 'Say why (the supplier will read it)');
  if (!Array.isArray(body.items) || !body.items.length) return bad(res, 'Choose at least one line');
  if (new Set(body.items.map((i) => Number(i.item_id))).size !== body.items.length) return bad(res, 'A line is listed twice');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const values = [req.tenant.businessId, req.params.id];
    const po = (await client.query(`SELECT * FROM purchase_orders WHERE business_id = $1 AND po_id = $2${branchFilter(req.tenant, 'branch_id', values)} FOR UPDATE`, values)).rows[0];
    if (!po) throw new NoteError(404, 'Not found');
    if (!['RECEIVED', 'PARTIAL'].includes(po.status)) throw new NoteError(409, 'Only an order that has arrived can have a debit note');
    const business = (await client.query(`SELECT gst_enabled, state FROM businesses WHERE business_id = $1`, [req.tenant.businessId])).rows[0];

    const lines = new Map((await returnable(client, po.po_id)).map((r) => [r.item_id, r]));
    const prepared = body.items.map((raw) => {
      const line = lines.get(Number(raw.item_id));
      if (!line) throw new NoteError(400, 'One of those lines isn’t on this order');
      const quantity = toQuantity(raw.quantity);
      const received = Number(line.received_quantity);
      let unit;
      if (kind === 'RETURN') {
        const left = round3(received - Number(line.returned));
        if (quantity > left) throw new NoteError(409, left > 0 ? `Only ${left} of ${line.description} can still be returned` : `${line.description} has already been returned in full`);
        unit = Number(line.unit_cost_paise);
      } else {
        if (quantity > received) throw new NoteError(409, `Only ${received} of ${line.description} arrived`);
        unit = toPaise(raw.unit_cost);
        if (!(unit > 0)) throw new NoteError(400, `Enter the overcharge per unit for ${line.description}`);
        if (unit > Number(line.unit_cost_paise)) throw new NoteError(409, `The overcharge can’t be more than the price paid for ${line.description}`);
      }
      const tax = computeLineTax({ quantity, unitPricePaise: unit, taxRatePercent: Number(line.tax_rate), gstEnabled: business.gst_enabled, interState: isInterState(business.state, null) });
      return { line, quantity, unit, tax };
    });

    const totals = sumLines(prepared.map((p) => p.tax));
    const dnNumber = await nextDnNumber(client, req.tenant.businessId);
    const note = (await client.query(
      `INSERT INTO debit_notes (business_id, branch_id, supplier_id, po_id, dn_number, kind, reason, subtotal_paise, tax_paise, total_paise, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.tenant.businessId, po.branch_id, po.supplier_id, po.po_id, dnNumber, kind, reason, totals.subtotal_paise, totals.tax_paise, totals.total_paise, req.auth.userId]
    )).rows[0];

    for (const p of [...prepared].sort((a, b) => (a.line.product_id ?? 0) - (b.line.product_id ?? 0))) {
      await client.query(
        `INSERT INTO debit_note_items (dn_id, po_item_id, product_id, description, quantity, unit_cost_paise, tax_rate, tax_amount_paise, line_total_paise)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [note.dn_id, p.line.item_id, p.line.product_id, p.line.description, p.quantity, p.unit, p.line.tax_rate, p.tax.tax_paise, p.tax.line_total_paise]
      );
      if (kind === 'RETURN' && p.line.product_id && p.line.track_inventory) {
        await client.query(`SELECT 1 FROM products WHERE product_id = $1 FOR UPDATE`, [p.line.product_id]);
        const have = (await stockAt(client, po.branch_id, [p.line.product_id])).get(p.line.product_id);
        if (have < p.quantity) throw new NoteError(409, `Only ${have} of ${p.line.description} is in stock here, so that much can’t go back`);
        await moveStock(client, { businessId: req.tenant.businessId, branchId: po.branch_id, productId: p.line.product_id, delta: -p.quantity });
        await client.query(
          `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, reference_id, notes, created_by)
           VALUES ($1,$2,$3,'PURCHASE_RETURN',$4,'debit_note',$5,$6,$7)`,
          [req.tenant.businessId, po.branch_id, p.line.product_id, -p.quantity, note.dn_id, dnNumber, req.auth.userId]
        );
      }
    }

    // what we owe falls first; whatever the order had already been paid beyond that becomes the supplier's credit to us
    const total = Number(totals.total_paise);
    const newDebited = Number(po.debited_paise) + total;
    const newBalance = Math.max(0, Number(po.total_paise) - newDebited - Number(po.amount_paid_paise));
    const applied = Math.max(0, Number(po.balance_due_paise) - newBalance);
    const credit = total - applied;
    await client.query(`UPDATE debit_notes SET applied_paise = $2, credit_paise = $3 WHERE dn_id = $1`, [note.dn_id, applied, credit]);
    await client.query(
      `UPDATE purchase_orders SET debited_paise = $2, balance_due_paise = $3, payment_status = $4 WHERE po_id = $1`,
      [po.po_id, newDebited, newBalance, newBalance === 0 ? 'PAID' : paymentStatus(Number(po.total_paise) - newDebited, Number(po.amount_paid_paise))]   // settled by the note counts as settled
    );
    await client.query('COMMIT');

    recordAudit(req, { action: 'debit_note.issued', resource_type: 'debit_note', resource_id: note.dn_id, metadata: { total: toRupees(total), kind, po_id: po.po_id, credit: toRupees(credit) } });
    res.status(201).json({ success: true, data: { ...asNote({ ...note, applied_paise: applied, credit_paise: credit, po_number: po.po_number }) } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof NoteError) return bad(res, error.message, error.status);
    if (error.message?.includes('positive number') || error.message?.includes('must be a number')) return bad(res, error.message);
    throw error;
  } finally { client.release(); }
};

/* GET /api/debit-notes?supplier_id= */
export const list = async (req, res) => {
  const values = [req.tenant.businessId];
  let extra = '';
  if (req.query.supplier_id) { values.push(Number(req.query.supplier_id)); extra = ` AND n.supplier_id = $${values.length}`; }
  const { rows } = await pool.query(
    `SELECT n.*, po.po_number, s.name AS supplier_name FROM debit_notes n JOIN purchase_orders po ON po.po_id = n.po_id LEFT JOIN suppliers s ON s.supplier_id = n.supplier_id
     WHERE n.business_id = $1${extra}${branchFilter(req.tenant, 'n.branch_id', values)} ORDER BY n.dn_id DESC LIMIT 200`, values);
  res.json({ success: true, data: rows.map(asNote) });
};

/* GET /api/debit-notes/:id */
export const get = async (req, res) => {
  const values = [req.tenant.businessId, req.params.id];
  const n = (await pool.query(
    `SELECT n.*, po.po_number, s.name AS supplier_name FROM debit_notes n JOIN purchase_orders po ON po.po_id = n.po_id LEFT JOIN suppliers s ON s.supplier_id = n.supplier_id
     WHERE n.business_id = $1 AND n.dn_id = $2${branchFilter(req.tenant, 'n.branch_id', values)}`, values)).rows[0];
  if (!n) return bad(res, 'Not found', 404);
  const items = (await pool.query(`SELECT * FROM debit_note_items WHERE dn_id = $1 ORDER BY dn_item_id`, [n.dn_id])).rows;
  res.json({ success: true, data: { ...asNote(n), items: items.map((i) => ({ description: i.description, quantity: Number(i.quantity), unit_cost: toRupees(i.unit_cost_paise), tax_rate: Number(i.tax_rate), tax: toRupees(i.tax_amount_paise), total: toRupees(i.line_total_paise) })) } });
};
