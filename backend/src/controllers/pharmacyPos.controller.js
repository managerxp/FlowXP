/*
 * The pharmacy till's API: a live quote and the sale itself. The sale is modules/pharmacy/pos.js; this file
 * is the HTTP around it — same split as salonPos.controller.js / modules/salon/pos.js.
 */
import pool from '../config/database.js';
import { recordInvoiceCreated } from '../modules/billing.js';
import { createPharmacySale } from '../modules/pharmacy/pos.js';
import { audit, ok, wrapAll } from '../modules/pharmacy/common.js';

const run = async (req, res, dryRun) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await createPharmacySale(client, req.tenant, req.auth.userId, req.body || {}, { dryRun });
    if (dryRun) {
      await client.query('ROLLBACK');
      return ok(res, out);
    }
    await client.query('COMMIT');
    recordInvoiceCreated(req, out.invoice);
    audit(req, 'pharmacy.sale_completed', 'invoice', out.invoice.invoice_id, null, null, { total: out.invoice.total, lines: out.lines.length });
    ok(res, out, 201);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
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
