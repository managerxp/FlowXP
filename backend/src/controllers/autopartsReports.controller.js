/*
 * Dashboards, reports and suggestions (all read-only). `?format=csv` on the list reports downloads a spreadsheet.
 */
import pool from '../config/database.js';
import { audit, int, ok, wrapAll } from '../modules/autoparts/common.js';
import * as intel from '../modules/autoparts/intelligence.js';

const cell = (v) => {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;      // a spreadsheet must not run what a part name says
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const send = (req, res, name, rows, data) => {
  if (req.query.format !== 'csv') return ok(res, data);
  const cols = rows.length ? Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object' || rows[0][k] === null) : [];
  audit(req, 'autoparts.report_exported', 'report', null, null, { report: name, rows: rows.length });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}.csv"`);
  return res.send([cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n'));
};
const b = (req) => req.query.branch_id;

export default wrapAll({
  overview: async (req, res) => ok(res, await intel.overview(pool, req.tenant, { branchId: b(req) })),
  movers: async (req, res) => {
    const d = await intel.movers(pool, req.tenant, { branchId: b(req), only: req.query.class ? String(req.query.class).toUpperCase() : null, limit: Math.min(Number(req.query.limit) || 100, 1000) });
    send(req, res, 'movers', d.parts, d);
  },
  ageing: async (req, res) => { const d = await intel.ageing(pool, req.tenant, { branchId: b(req) }); send(req, res, 'ageing', d.buckets, d); },
  reorder: async (req, res) => { const d = await intel.reorder(pool, req.tenant, { branchId: b(req) }); send(req, res, 'reorder', d.parts, d); },
  together: async (req, res) => ok(res, await intel.togetherWith(pool, req.tenant, int(req.params.id, 'Part', { min: 1, required: true }))),
  suppliers: async (req, res) => { const d = await intel.supplierScore(pool, req.tenant, { branchId: b(req) }); send(req, res, 'supplier-performance', d, d); },
  valuation: async (req, res) => { const d = await intel.valuation(pool, req.tenant, { branchId: b(req) }); send(req, res, 'valuation', d.categories, d); },
  occupancy: async (req, res) => ok(res, await intel.occupancy(pool, req.tenant, { branchId: b(req) })),
  ledger: async (req, res) => {
    const d = await intel.partLedger(pool, req.tenant, int(req.params.id, 'Part', { min: 1, required: true }));
    if (!d) return res.status(404).json({ success: false, message: 'Not found' });
    send(req, res, 'part-ledger', d.movements, d);
  }
});
