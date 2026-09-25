/*
 * Credit notes: the formal document that reduces an issued invoice.
 *
 * What one does, in a single transaction:
 *   - takes chosen quantities off chosen invoice lines, with the tax on them
 *     reversed exactly (the last unit of a line takes whatever remainder is left,
 *     so a line credited in pieces never drifts by a paisa)
 *   - takes its share of any invoice-level discount or coupon off the amount
 *   - settles: first against what the customer still owes on the invoice, then
 *     (if asked) as money paid back; anything left is simply a credit on the record
 *   - optionally returns tracked items to stock at the invoice's own outlet
 * Revenue and GST follow the credit note (reports and profitability read it);
 * a plain refund on its own only moves money.
 */
import pool from '../config/database.js';
import { reverseForCredit } from '../modules/points.js';
import { recordAudit } from '../modules/events.js';
import { moveStock } from '../modules/stock.js';
import { branchFilter } from '../utils/scope.js';
import { toQuantity, toRupees } from '../utils/money.js';

const METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'OTHER'];
const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });

class NoteError extends Error { constructor(status, message) { super(message); this.status = status; } }

export const asCreditNote = (r) => ({
  cn_id: r.cn_id, cn_number: r.cn_number, date: r.cn_date, invoice_id: r.invoice_id, invoice_number: r.invoice_number,
  customer_name: r.customer_name ?? null, reason: r.reason,
  subtotal: toRupees(r.subtotal_paise), cgst: toRupees(r.cgst_paise), sgst: toRupees(r.sgst_paise), igst: toRupees(r.igst_paise), tax: toRupees(r.tax_paise),
  discount_share: toRupees(r.discount_share_paise), total: toRupees(r.total_paise),
  settled_against_balance: toRupees(r.settled_balance_paise), refunded: toRupees(r.refunded_paise)
});

/** Proportional part of an amount for `qty` of `whole`, giving the exact remainder for the final piece. */
const share = (amount, qty, whole, remainingQty, alreadyCredited) =>
  Math.abs(qty - remainingQty) < 1e-9 ? Number(amount) - alreadyCredited : Math.round((Number(amount) * qty) / whole);

/* POST /api/invoices/:id/credit-notes { items: [{ item_id, quantity }], reason, restock?, refund?: { method } } */
export const create = async (req, res) => {
  const body = req.body || {};
  const reason = String(body.reason ?? '').trim();
  if (!reason) return bad(res, 'Say why you are issuing a credit note');
  if (!Array.isArray(body.items) || !body.items.length) return bad(res, 'Choose at least one item');
  const method = body.refund?.method ? String(body.refund.method).toUpperCase() : null;
  if (method && !METHODS.includes(method)) return bad(res, 'Unknown refund method');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const scope = [req.tenant.businessId, req.params.id];
    const invoice = (await client.query(
      `SELECT * FROM invoices WHERE business_id = $1 AND invoice_id = $2${branchFilter(req.tenant, 'branch_id', scope)} FOR UPDATE`, scope
    )).rows[0];
    if (!invoice) throw new NoteError(404, 'Not found');
    if (invoice.status !== 'ISSUED') throw new NoteError(409, 'A cancelled invoice can’t have a credit note');

    const lines = (await client.query(
      `SELECT ii.*, p.track_inventory,
              COALESCE((SELECT SUM(c.quantity) FROM credit_note_items c WHERE c.invoice_item_id = ii.item_id), 0) AS credited_qty,
              COALESCE((SELECT SUM(c.tax_amount_paise) FROM credit_note_items c WHERE c.invoice_item_id = ii.item_id), 0) AS credited_tax,
              COALESCE((SELECT SUM(c.line_total_paise) FROM credit_note_items c WHERE c.invoice_item_id = ii.item_id), 0) AS credited_total
       FROM invoice_items ii LEFT JOIN products p ON p.product_id = ii.product_id
       WHERE ii.invoice_id = $1 ORDER BY ii.item_id`, [invoice.invoice_id]
    )).rows;
    const byId = new Map(lines.map((l) => [l.item_id, l]));

    const picked = []; const seen = new Set();
    for (const raw of body.items) {
      const line = byId.get(Number(raw.item_id));
      if (!line) throw new NoteError(400, 'One of those items isn’t on this invoice');
      if (seen.has(line.item_id)) throw new NoteError(400, `${line.description} is listed twice`);
      seen.add(line.item_id);
      const qty = toQuantity(raw.quantity);
      const remaining = Math.round((Number(line.quantity) - Number(line.credited_qty)) * 1000) / 1000;
      if (qty > remaining + 1e-9) throw new NoteError(400, `${line.description}: only ${remaining} left to credit`);
      const whole = Number(line.quantity);
      const tax = share(line.tax_amount_paise, qty, whole, remaining, Number(line.credited_tax));
      const total = share(line.line_total_paise, qty, whole, remaining, Number(line.credited_total));
      picked.push({ line, qty, tax, total });
    }

    const linesTotal = picked.reduce((s, p) => s + p.total, 0);
    const taxTotal = picked.reduce((s, p) => s + p.tax, 0);
    const invoiceLinesSum = lines.reduce((s, l) => s + Number(l.line_total_paise), 0);
    const priorShare = Number((await client.query(`SELECT COALESCE(SUM(discount_share_paise),0) AS s FROM credit_notes WHERE invoice_id = $1`, [invoice.invoice_id])).rows[0].s);
    const invoiceDiscount = Number(invoice.discount_paise);
    const creditedAllLines = lines.every((l) => {
      const p = picked.find((x) => x.line.item_id === l.item_id);
      return Math.abs(Number(l.quantity) - Number(l.credited_qty) - (p?.qty ?? 0)) < 1e-9;
    });
    // The last note that completes the invoice takes the exact remainder of the discount.
    const discountShare = invoiceDiscount === 0 || invoiceLinesSum === 0 ? 0
      : creditedAllLines ? invoiceDiscount - priorShare
        : Math.min(invoiceDiscount - priorShare, Math.round((invoiceDiscount * linesTotal) / invoiceLinesSum));
    const total = linesTotal - discountShare;
    if (total <= 0) throw new NoteError(400, 'That credit note would be for nothing');

    // CGST/SGST/IGST follow how the invoice itself was taxed.
    const igst = Number(invoice.igst_paise) > 0 ? taxTotal : 0;
    const cgst = igst ? 0 : Math.floor(taxTotal / 2);
    const sgst = igst ? 0 : taxTotal - cgst;
    const taxable = linesTotal - taxTotal;

    // Settle: what the customer still owes first, then (if asked) money back.
    const fromBalance = Math.min(total, Number(invoice.balance_due_paise));
    const leftover = total - fromBalance;
    const refundable = Math.max(0, Number(invoice.amount_paid_paise) - Number(invoice.refunded_paise));
    const refund = method ? Math.min(leftover, refundable) : 0;

    const numbering = (await client.query(`SELECT credit_note_prefix, credit_note_next_number FROM businesses WHERE business_id = $1 FOR UPDATE`, [req.tenant.businessId])).rows[0];
    await client.query(`UPDATE businesses SET credit_note_next_number = credit_note_next_number + 1 WHERE business_id = $1`, [req.tenant.businessId]);
    const cnNumber = `${numbering.credit_note_prefix}-${String(numbering.credit_note_next_number).padStart(4, '0')}`;

    const note = (await client.query(
      `INSERT INTO credit_notes (business_id, branch_id, invoice_id, cn_number, reason, subtotal_paise, cgst_paise, sgst_paise, igst_paise, tax_paise,
                                 discount_share_paise, total_paise, settled_balance_paise, refunded_paise, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [req.tenant.businessId, invoice.branch_id, invoice.invoice_id, cnNumber, reason, taxable, cgst, sgst, igst, taxTotal, discountShare, total, fromBalance, refund, req.auth.userId]
    )).rows[0];

    for (const p of picked) {
      const restock = Boolean(body.restock) && p.line.track_inventory && p.line.product_id;
      await client.query(
        `INSERT INTO credit_note_items (cn_id, invoice_item_id, product_id, description, quantity, tax_rate, tax_amount_paise, line_total_paise, restocked)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [note.cn_id, p.line.item_id, p.line.product_id, p.line.description, p.qty, p.line.tax_rate, p.tax, p.total, Boolean(restock)]
      );
      if (restock) {
        await client.query(`SELECT 1 FROM products WHERE product_id = $1 FOR UPDATE`, [p.line.product_id]);
        await moveStock(client, { businessId: req.tenant.businessId, branchId: invoice.branch_id, productId: p.line.product_id, delta: p.qty });
        await client.query(
          `INSERT INTO inventory_transactions (business_id, branch_id, product_id, transaction_type, quantity, reference_type, reference_id, notes, created_by)
           VALUES ($1,$2,$3,'RETURN',$4,'credit_note',$5,$6,$7)`,
          [req.tenant.businessId, invoice.branch_id, p.line.product_id, p.qty, note.cn_id, cnNumber, req.auth.userId]
        );
      }
    }

    if (refund > 0) {
      await client.query(
        `INSERT INTO refunds (business_id, invoice_id, amount_paise, method, reason, created_by, credit_note_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [req.tenant.businessId, invoice.invoice_id, refund, method, `${cnNumber}: ${reason}`, req.auth.userId, note.cn_id]
      );
    }
    const newBalance = Number(invoice.balance_due_paise) - fromBalance;
    await client.query(
      `UPDATE invoices SET credited_paise = credited_paise + $2::bigint, balance_due_paise = $3::bigint, refunded_paise = refunded_paise + $4::bigint, cn_refunded_paise = cn_refunded_paise + $4::bigint,
              payment_status = CASE WHEN $3::bigint = 0 AND $5::bigint > 0 THEN 'PAID' ELSE payment_status END
       WHERE invoice_id = $1`,
      [invoice.invoice_id, total, newBalance, refund, fromBalance]
    );

    // the customer gives back a share of the points that bill earned
    await reverseForCredit(client, { businessId: req.tenant.businessId, invoiceId: invoice.invoice_id, creditedTotalPaise: Number(invoice.credited_paise) + total, createdBy: req.auth.userId });

    await client.query('COMMIT');
    recordAudit(req, { action: 'credit_note.issued', resource_type: 'credit_note', resource_id: note.cn_id, metadata: { total: toRupees(total), invoice_id: invoice.invoice_id, refunded: toRupees(refund), restocked: Boolean(body.restock) } });
    res.status(201).json({ success: true, data: { ...asCreditNote({ ...note, invoice_number: invoice.invoice_number }), unrefunded: toRupees(leftover - refund) } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof NoteError) return bad(res, error.message, error.status);
    if (error.message?.includes('positive number') || error.message?.includes('must be a number')) return bad(res, error.message);
    throw error;
  } finally {
    client.release();
  }
};

/* GET /api/credit-notes?from=&to= */
export const list = async (req, res) => {
  const values = [req.tenant.businessId];
  let where = 'c.business_id = $1';
  if (req.query.from) { values.push(req.query.from); where += ` AND c.cn_date >= $${values.length}`; }
  if (req.query.to) { values.push(req.query.to); where += ` AND c.cn_date <= $${values.length}`; }
  where += branchFilter(req.tenant, 'c.branch_id', values);
  const { rows } = await pool.query(
    `SELECT c.*, i.invoice_number, cu.name AS customer_name FROM credit_notes c JOIN invoices i ON i.invoice_id = c.invoice_id
     LEFT JOIN customers cu ON cu.customer_id = i.customer_id WHERE ${where} ORDER BY c.cn_id DESC LIMIT 200`, values
  );
  res.json({ success: true, data: rows.map(asCreditNote) });
};

/* GET /api/credit-notes/:id — with its lines, for printing */
export const get = async (req, res) => {
  const values = [req.tenant.businessId, req.params.id];
  const note = (await pool.query(
    `SELECT c.*, i.invoice_number, i.invoice_date, cu.name AS customer_name, cu.gstin AS customer_gstin, br.name AS outlet_name, br.address AS outlet_address, br.gstin AS outlet_gstin
     FROM credit_notes c JOIN invoices i ON i.invoice_id = c.invoice_id LEFT JOIN customers cu ON cu.customer_id = i.customer_id LEFT JOIN branches br ON br.branch_id = c.branch_id
     WHERE c.business_id = $1 AND c.cn_id = $2${branchFilter(req.tenant, 'c.branch_id', values)}`, values
  )).rows[0];
  if (!note) return bad(res, 'Not found', 404);
  const items = (await pool.query(`SELECT description, quantity, tax_rate, tax_amount_paise, line_total_paise, restocked FROM credit_note_items WHERE cn_id = $1 ORDER BY cn_item_id`, [note.cn_id])).rows;
  res.json({
    success: true,
    data: {
      ...asCreditNote(note), invoice_date: note.invoice_date, customer_gstin: note.customer_gstin,
      outlet: note.outlet_name ? { name: note.outlet_name, address: note.outlet_address, gstin: note.outlet_gstin } : null,
      items: items.map((i) => ({ description: i.description, quantity: Number(i.quantity), tax_rate: Number(i.tax_rate), tax: toRupees(i.tax_amount_paise), total: toRupees(i.line_total_paise), restocked: i.restocked }))
    }
  });
};

/* GET /api/invoices/:id/credit-notes/options — what can still be credited on each line */
export const options = async (req, res) => {
  const values = [req.tenant.businessId, req.params.id];
  const invoice = (await pool.query(`SELECT invoice_id, status, amount_paid_paise, refunded_paise, balance_due_paise FROM invoices WHERE business_id = $1 AND invoice_id = $2${branchFilter(req.tenant, 'branch_id', values)}`, values)).rows[0];
  if (!invoice) return bad(res, 'Not found', 404);
  const { rows } = await pool.query(
    `SELECT ii.item_id, ii.description, ii.quantity, ii.line_total_paise, ii.tax_rate, p.track_inventory,
            ii.quantity - COALESCE((SELECT SUM(c.quantity) FROM credit_note_items c WHERE c.invoice_item_id = ii.item_id), 0) AS remaining
     FROM invoice_items ii LEFT JOIN products p ON p.product_id = ii.product_id WHERE ii.invoice_id = $1 ORDER BY ii.item_id`, [invoice.invoice_id]
  );
  res.json({
    success: true,
    data: {
      can_issue: invoice.status === 'ISSUED',
      balance_due: toRupees(invoice.balance_due_paise), refundable: toRupees(Math.max(0, Number(invoice.amount_paid_paise) - Number(invoice.refunded_paise))),
      items: rows.map((r) => ({ item_id: r.item_id, description: r.description, quantity: Number(r.quantity), remaining: Number(r.remaining), unit_total: toRupees(Math.round(Number(r.line_total_paise) / Number(r.quantity))), tax_rate: Number(r.tax_rate), tracks_stock: Boolean(r.track_inventory) }))
    }
  });
};
