/*
 * Aggregator settlement reconciliation (owner's request, 2026-09-29) — see
 * modules/settlements.js for the actual math. This file is the import
 * (paste/upload the statement a platform already gives you), the list with
 * each line's computed status, and the "orders we billed on this platform
 * with no matching statement line at all" check — the single most valuable
 * one, since it catches money that should have been paid and simply wasn't.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { toPaise, toRupees } from '../utils/money.js';
import { reconcile, STATUS } from '../modules/settlements.js';
import { PLATFORMS } from '../modules/delivery/registry.js';

const bad = (res, message, status = 400) => res.status(status).json({ success: false, message });

const asLine = (row) => ({
  line_id: row.line_id, external_order_id: row.external_order_id, settlement_date: row.settlement_date,
  gross_amount: toRupees(row.gross_amount_paise), commission: toRupees(row.commission_paise),
  payment_charges: toRupees(row.payment_charges_paise), delivery_charges: toRupees(row.delivery_charges_paise),
  tax: toRupees(row.tax_paise), other_deductions: toRupees(row.other_deductions_paise), net_settled: toRupees(row.net_settled_paise),
  order_id: row.order_id, order_number: row.order_number, invoiced: row.invoice_total_paise != null,
  ...(() => {
    const r = reconcile(row, row.invoice_total_paise);
    return {
      status: row.order_id == null ? STATUS.ORDER_NOT_FOUND : r.status,
      expected_settlement: toRupees(r.expected_settlement_paise),
      arithmetic_diff: toRupees(r.arithmetic_diff_paise),
      value_diff: r.value_diff_paise == null ? null : toRupees(r.value_diff_paise)
    };
  })()
});

/* ==========================================================================
   POST /api/settlements/import { platform, rows: [{ external_order_id, settlement_date?, gross_amount, commission?, payment_charges?, delivery_charges?, tax?, other_deductions?, net_settled }] }
   ========================================================================== */
export const importStatement = async (req, res) => {
  const platform = String(req.body?.platform || '').toUpperCase();
  if (!PLATFORMS.includes(platform)) return bad(res, 'Unknown platform');
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows || !rows.length) return bad(res, 'Nothing to import');
  if (rows.length > 2000) return bad(res, 'Import at most 2000 rows at a time');

  for (const row of rows) {
    if (!row.external_order_id) return bad(res, 'Every row needs the platform’s own order id');
    if (row.gross_amount == null || Number.isNaN(Number(row.gross_amount))) return bad(res, `Row ${row.external_order_id}: gross amount must be a number`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const imp = (await client.query(
      `INSERT INTO settlement_imports (business_id, platform, row_count, imported_by) VALUES ($1,$2,$3,$4) RETURNING import_id`,
      [req.tenant.businessId, platform, rows.length, req.auth.userId]
    )).rows[0];

    for (const row of rows) {
      const order = (await client.query(
        `SELECT order_id FROM orders WHERE business_id = $1 AND platform = $2 AND external_order_id = $3`,
        [req.tenant.businessId, platform, String(row.external_order_id).trim()]
      )).rows[0];
      await client.query(
        `INSERT INTO settlement_lines
           (import_id, business_id, platform, external_order_id, settlement_date, gross_amount_paise, commission_paise,
            payment_charges_paise, delivery_charges_paise, tax_paise, other_deductions_paise, net_settled_paise, order_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          imp.import_id, req.tenant.businessId, platform, String(row.external_order_id).trim(), row.settlement_date || null,
          toPaise(row.gross_amount || 0), toPaise(row.commission || 0), toPaise(row.payment_charges || 0),
          toPaise(row.delivery_charges || 0), toPaise(row.tax || 0), toPaise(row.other_deductions || 0),
          toPaise(row.net_settled ?? row.gross_amount ?? 0), order?.order_id ?? null
        ]
      );
    }
    await client.query('COMMIT');
    recordAudit(req, { action: 'settlements.imported', resource_type: 'settlement_import', resource_id: imp.import_id, metadata: { platform, rows: rows.length } });
    res.status(201).json({ success: true, data: { import_id: imp.import_id, rows: rows.length } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[settlements] import failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not import this statement' });
  } finally {
    client.release();
  }
};

/* GET /api/settlements?platform=&from=&to=&status= */
export const list = async (req, res) => {
  const values = [req.tenant.businessId];
  const clauses = [];
  if (req.query.platform) { values.push(String(req.query.platform).toUpperCase()); clauses.push(`sl.platform = $${values.length}`); }
  if (req.query.from) { values.push(req.query.from); clauses.push(`sl.settlement_date >= $${values.length}::date`); }
  if (req.query.to) { values.push(req.query.to); clauses.push(`sl.settlement_date < ($${values.length}::date + 1)`); }

  const { rows } = await pool.query(
    `SELECT sl.*, o.order_number, i.total_paise AS invoice_total_paise
     FROM settlement_lines sl
     LEFT JOIN orders o ON o.order_id = sl.order_id
     LEFT JOIN invoices i ON i.invoice_id = o.invoice_id
     WHERE sl.business_id = $1 ${clauses.map((c) => `AND ${c}`).join(' ')}
     ORDER BY sl.created_at DESC LIMIT 500`,
    values
  );
  const lines = rows.map(asLine);
  res.json({
    success: true,
    data: {
      lines,
      summary: {
        count: lines.length,
        matched: lines.filter((l) => l.status === STATUS.MATCHED).length,
        flagged: lines.filter((l) => l.status !== STATUS.MATCHED).length,
        net_settled_total: lines.reduce((sum, l) => sum + l.net_settled, 0)
      }
    }
  });
};

/* GET /api/settlements/missing?platform=&from=&to= — billed orders on this platform with no settlement line at all */
export const missing = async (req, res) => {
  const values = [req.tenant.businessId];
  const clauses = [];
  if (req.query.platform) { values.push(String(req.query.platform).toUpperCase()); clauses.push(`o.platform = $${values.length}`); }
  if (req.query.from) { values.push(req.query.from); clauses.push(`o.created_at >= $${values.length}::date`); }
  if (req.query.to) { values.push(req.query.to); clauses.push(`o.created_at < ($${values.length}::date + 1)`); }

  const { rows } = await pool.query(
    `SELECT o.order_id, o.order_number, o.platform, o.external_order_id, o.external_order_number, o.created_at, i.total_paise
     FROM orders o
     JOIN invoices i ON i.invoice_id = o.invoice_id
     WHERE o.business_id = $1 AND o.platform IS NOT NULL ${clauses.map((c) => `AND ${c}`).join(' ')}
       AND NOT EXISTS (SELECT 1 FROM settlement_lines sl WHERE sl.order_id = o.order_id)
     ORDER BY o.created_at DESC LIMIT 500`,
    values
  );
  res.json({
    success: true,
    data: {
      orders: rows.map((r) => ({ order_id: r.order_id, order_number: r.order_number, platform: r.platform, external_order_id: r.external_order_id, external_order_number: r.external_order_number, created_at: r.created_at, total: toRupees(r.total_paise) })),
      total_owed: toRupees(rows.reduce((sum, r) => sum + Number(r.total_paise), 0))
    }
  });
};
