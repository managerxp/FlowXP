/*
 * Supplier bill import (supermarket / retail): read a photographed or PDF bill, match its lines to products, learn
 * from the person's corrections.
 *
 *   POST /api/retail/invoice-import/scan    read the bill and return a DRAFT: supplier, bill number and date, lines each with
 *                                           the product it matched (and how) or suggestions, and the checks below. Nothing
 *                                           is saved: the person reviews every line, and receiving stock is the normal
 *                                           Receive stock step (POST /api/purchases).
 *   GET  /api/retail/invoice-import/check   is this supplier's bill number already on a purchase?
 *   POST /api/retail/invoice-import/learn   after the stock is received, remember what the person matched: the bill's
 *                                           wording as an alias, the supplier's code, a barcode the product did not have yet
 *
 * Checks sent with a draft: `duplicate` (this supplier's bill number is already recorded) and `total_mismatch` (the lines
 * do not add up to the total printed on the bill, which usually means a line was misread or missed).
 * The photos / PDF are held in memory for the one request and never stored.
 */
import pool from '../config/database.js';
import config from '../config/env.js';
import { looksLikeBillFile } from '../middleware/upload.js';
import { recordAudit } from '../modules/events.js';
import { AIProviderError, isConfigured } from '../modules/ai/provider.js';
import { scanBill } from '../modules/ai/invoiceScan.js';
import { findDuplicateBill, matchLines, matchSupplier, norm } from '../modules/invoiceMatch.js';
import { allowance, enabled } from './ai.controller.js';

const MAX_FILES = 5;
const bad = (res, message, status = 400, code) => res.status(status).json({ success: false, message, ...(code && { code }) });
const rupees = (n) => Math.round(Number(n) * 100) / 100;

/** Do the lines add up to the printed total? Taxes are added when a line's amount is the pre-tax figure. */
export const totalCheck = (lines, printedTotal) => {
  if (printedTotal == null) return null;
  const withAmount = lines.filter((l) => l.amount != null || (l.quantity != null && l.rate != null));
  if (!withAmount.length) return null;
  const net = withAmount.reduce((s, l) => s + (l.amount != null ? l.amount : l.quantity * l.rate), 0);
  const gross = withAmount.reduce((s, l) => s + (l.amount != null ? l.amount : l.quantity * l.rate) * (l.tax_rate != null && l.amount == null ? 1 + l.tax_rate / 100 : 1), 0);
  // the printed total can be the sum as it stands, or with tax on top: close to either is fine (₹ a few for round-off)
  const near = Math.min(Math.abs(printedTotal - net), Math.abs(printedTotal - gross));
  return near <= Math.max(5, printedTotal * 0.02) ? null : { printed: rupees(printedTotal), lines: rupees(net) };
};

/* POST /api/retail/invoice-import/scan  (multipart, field "files": photos or one PDF) */
export const scan = async (req, res) => {
  const { businessId } = req.tenant;
  const files = Array.isArray(req.files) ? req.files : [];
  if (!files.length) return bad(res, 'Take or choose a photo of the supplier bill, or a PDF');
  if (files.length > MAX_FILES) return bad(res, `Use at most ${MAX_FILES} pages at a time`);
  if (files.some((f) => !looksLikeBillFile(f.buffer, f.mimetype))) return bad(res, 'Use JPEG, PNG or WebP photos, or a PDF');

  if (!isConfigured()) return bad(res, 'Reading a bill needs the AI service, which isn’t set up on this server yet. You can still receive stock by scanning.', 503, 'AI_NOT_CONFIGURED');
  if (!(await enabled(businessId))) return bad(res, 'Flow AI is switched off for this business. An owner can turn it on in the AI page.', 403, 'AI_DISABLED');
  const allow = await allowance(businessId);
  if (allow.remaining === 0) return bad(res, `You have used all ${allow.limit} AI requests on your plan this month.`, 402, 'AI_LIMIT');

  let bill;
  try {
    bill = await scanBill(files.map((f) => ({ mediaType: f.mimetype, data: f.buffer.toString('base64') })));
  } catch (error) {
    if (error instanceof AIProviderError) return bad(res, error.message, error.status === 429 ? 429 : 502, 'AI_UNAVAILABLE');
    throw error;
  }
  await pool.query(
    `INSERT INTO ai_usage (business_id, user_id, model, input_tokens, output_tokens) VALUES ($1,$2,$3,$4,$5)`,
    [businessId, req.auth.userId, bill.model || config.ai.model, bill.usage.input_tokens, bill.usage.output_tokens]
  );
  if (!bill.lines.length) return res.json({ success: true, data: { lines: [], notes: bill.notes || 'No item lines were found. Try a clearer, closer photo of the whole bill.', remaining: allow.remaining == null ? null : allow.remaining - 1 } });

  const supplier = await matchSupplier(pool, { businessId, name: bill.supplier_name });
  const matches = await matchLines(pool, { businessId, supplierId: supplier?.supplier_id ?? null, lines: bill.lines });
  const duplicate = await findDuplicateBill(pool, { businessId, supplierId: supplier?.supplier_id, invoiceNo: bill.invoice_no });

  res.json({
    success: true,
    data: {
      supplier: supplier ? { ...supplier } : null, supplier_name: bill.supplier_name, invoice_no: bill.invoice_no, invoice_date: bill.invoice_date, total: bill.total,
      lines: bill.lines.map((l, i) => ({ ...l, match: matches[i].match, suggestions: matches[i].suggestions })),
      duplicate_of: duplicate, total_mismatch: totalCheck(bill.lines, bill.total), notes: bill.notes,
      remaining: allow.remaining == null ? null : allow.remaining - 1
    }
  });
};

/* GET /api/retail/invoice-import/check?supplier_id=&invoice_no= */
export const check = async (req, res) => {
  const duplicate = await findDuplicateBill(pool, { businessId: req.tenant.businessId, supplierId: Number(req.query.supplier_id) || null, invoiceNo: String(req.query.invoice_no || '').trim() });
  res.json({ success: true, data: { duplicate_of: duplicate } });
};

/* POST /api/retail/invoice-import/learn { supplier_id?, pairs: [{ product_id, description, barcode?, supplier_code? }] } */
export const learn = async (req, res) => {
  const { businessId } = req.tenant;
  const supplierId = Number(req.body?.supplier_id) || null;
  const pairs = (Array.isArray(req.body?.pairs) ? req.body.pairs : []).slice(0, 400);
  if (!pairs.length) return res.json({ success: true, data: { aliases: 0, codes: 0, barcodes: 0 } });

  const client = await pool.connect();
  const done = { aliases: 0, codes: 0, barcodes: 0 };
  try {
    await client.query('BEGIN');
    if (supplierId && !(await client.query(`SELECT 1 FROM suppliers WHERE supplier_id = $1 AND business_id = $2`, [supplierId, businessId])).rows.length) {
      await client.query('ROLLBACK'); return bad(res, 'Supplier not found');
    }
    const mine = new Map((await client.query(`SELECT product_id, name FROM products WHERE business_id = $1 AND product_id = ANY($2::int[])`, [businessId, pairs.map((p) => Number(p.product_id) || 0)])).rows.map((p) => [p.product_id, p.name]));
    for (const p of pairs) {
      const productId = Number(p.product_id);
      if (!mine.has(productId)) continue;                                         // not this business's product: ignore, never write
      const description = String(p.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
      const key = norm(description).slice(0, 160);
      if (key && key !== norm(mine.get(productId))) {
        const r = await client.query(
          `INSERT INTO product_aliases (business_id, product_id, alias, alias_key, source, created_by) VALUES ($1,$2,$3,$4,'SUPPLIER',$5) ON CONFLICT (product_id, alias_key) DO NOTHING`,
          [businessId, productId, description, key, req.auth.userId]);
        done.aliases += r.rowCount;
      }
      const code = String(p.supplier_code ?? '').trim().slice(0, 64);
      if (code) {
        // a code names one product: a correction moves it to the product the person picked
        await client.query(`DELETE FROM product_supplier_codes WHERE business_id = $1 AND COALESCE(supplier_id, 0) = $2 AND lower(code) = lower($3) AND product_id <> $4`, [businessId, supplierId || 0, code, productId]);
        const r = await client.query(
          `INSERT INTO product_supplier_codes (business_id, product_id, supplier_id, code, created_by) SELECT $1::int,$2::int,$3::int,$4::varchar,$5::int
           WHERE NOT EXISTS (SELECT 1 FROM product_supplier_codes WHERE business_id = $1::int AND COALESCE(supplier_id, 0) = $6::int AND lower(code) = lower($4::varchar))`,
          [businessId, productId, supplierId, code, req.auth.userId, supplierId || 0]);
        done.codes += r.rowCount;
      }
      const barcode = String(p.barcode ?? '').replace(/\D/g, '');
      if (barcode.length >= 8 && barcode.length <= 14) {
        // only a barcode nobody has yet: one that belongs to another product is never moved by a bill
        const r = await client.query(
          `INSERT INTO product_barcodes (business_id, product_id, barcode, created_by) SELECT $1::int,$2::int,$3::varchar,$4::int
           WHERE NOT EXISTS (SELECT 1 FROM product_barcodes WHERE business_id = $1::int AND lower(barcode) = lower($3::varchar))`,
          [businessId, productId, barcode, req.auth.userId]);
        done.barcodes += r.rowCount;
      }
    }
    await client.query('COMMIT');
    recordAudit(req, { action: 'retail.invoice_import_learned', resource_type: 'supplier', resource_id: supplierId, metadata: done });
    res.json({ success: true, data: done });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[invoice-import] learn failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not save what was matched' });
  } finally { client.release(); }
};
