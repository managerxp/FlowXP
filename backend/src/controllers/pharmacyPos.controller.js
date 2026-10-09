/*
 * The pharmacy till's API: a live quote and the sale itself. The sale is modules/pharmacy/pos.js; this file
 * is the HTTP around it — same split as salonPos.controller.js / modules/salon/pos.js.
 *
 * A sale the phone took with no connection arrives later with X-Offline-Sale: 1 and X-Sale-Date. It is recorded, not refused for stock
 * (the medicine is already handed over), and anything a person should look at (short stock, a price that changed, a batch that ran out)
 * comes back in `review` and is written on the bill and in the audit log. The sale's Idempotency-Key is kept on the invoice itself, so a
 * phone that was offline for days and replays still gets the same bill back after the 48-hour duplicate guard has forgotten the key.
 */
import { discountPolicy } from '../modules/approvals.js';
import pool from '../config/database.js';
import { recordInvoiceCreated } from '../modules/billing.js';
import { createPharmacySale } from '../modules/pharmacy/pos.js';
import { audit, ok, wrapAll } from '../modules/pharmacy/common.js';
import { toRupees } from '../utils/money.js';

const isOffline = (req) => req.get?.('X-Offline-Sale') === '1' || req.headers?.['x-offline-sale'] === '1';
const keyOf = (req) => req.get?.('Idempotency-Key') || req.headers?.['idempotency-key'] || null;

/* A sale already made under this key, answered as the original was. */
const replayOf = async (req) => {
  const key = keyOf(req);
  if (!key) return null;
  const row = (await pool.query(`SELECT * FROM invoices WHERE business_id = $1 AND client_key = $2`, [req.tenant.businessId, key])).rows[0];
  if (!row) return null;
  return {
    invoice: {
      invoice_id: row.invoice_id, invoice_number: row.invoice_number, invoice_date: row.invoice_date, subtotal: toRupees(row.subtotal_paise), discount: toRupees(row.discount_paise), tax: toRupees(row.tax_paise),
      total: toRupees(row.total_paise), amount_paid: toRupees(row.amount_paid_paise), balance_due: toRupees(row.balance_due_paise), payment_status: row.payment_status
    },
    lines: [], review: []
  };
};

const run = async (req, res, dryRun) => {
  if (!dryRun) {
    const earlier = await replayOf(req).catch(() => null);
    if (earlier) { res.set('Idempotent-Replay', 'true'); return ok(res, earlier, 201); }
  }
  const offline = !dryRun && isOffline(req);
  const input = { ...(req.body || {}), ...(offline ? { offline: true, saleDay: req.get?.('X-Sale-Date') || req.headers?.['x-sale-date'] } : {}), ...(dryRun ? {} : { discountPolicy: discountPolicy(req, req.body?.approval, { lines: true }), clientKey: keyOf(req) }) };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await createPharmacySale(client, req.tenant, req.auth.userId, input, { dryRun });
    if (dryRun) {
      await client.query('ROLLBACK');
      return ok(res, out);
    }
    await client.query('COMMIT');
    recordInvoiceCreated(req, out.invoice);
    audit(req, 'pharmacy.sale_completed', 'invoice', out.invoice.invoice_id, null, null, { total: out.invoice.total, lines: out.lines.length, ...(offline ? { offline: true, review: out.review } : {}) });
    ok(res, out, 201);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505' && String(error.constraint) === 'uq_invoices_client_key') {   // the same sale arrived twice at once
      const earlier = await replayOf(req).catch(() => null);
      if (earlier) { res.set('Idempotent-Replay', 'true'); return ok(res, earlier, 201); }
    }
    throw error;
  } finally {
    client.release();
  }
};

/* POST /api/pharmacy/pos/quote — the bill as it would be, nothing saved */
const quote = (req, res) => run(req, res, true);
/* POST /api/pharmacy/pos/invoices — take the sale (send an Idempotency-Key so a retry cannot bill twice) */
const create = (req, res) => run(req, res, false);

export default wrapAll({ quote, create });
