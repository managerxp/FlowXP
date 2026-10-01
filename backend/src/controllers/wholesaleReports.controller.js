/*
 * /api/wholesale/reports — the report catalogue and each report. The period defaults to this month; stock and
 * balance reports are "as of now" (or "as of" the To date for ageing).
 */
import pool from '../config/database.js';
import { catalogue, runReport } from '../modules/wholesale/reports.js';
import { WholesaleError, addDays, audit, getSettings, isoDate, ok, today, wrapAll } from '../modules/wholesale/common.js';
import { scopeBranches } from './wholesaleInventory.controller.js';

const list = async (req, res) => ok(res, catalogue());

const run = async (req, res) => {
  const date = await today(pool, req.tenant.businessId);
  const from = isoDate(req.query.from, 'From') || `${date.slice(0, 8)}01`;
  const to = isoDate(req.query.to, 'To') || date;
  if (from > to) throw new WholesaleError(400, 'The From date is after the To date');
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) > 800 * 86400000) throw new WholesaleError(400, 'Choose a period of up to about two years');
  const settings = await getSettings(pool, req.tenant.businessId);
  const branchIds = await scopeBranches(req, req.query.branch_id);
  const report = await runReport(req.params.key, { db: pool, businessId: req.tenant.businessId, branchIds, from, to, query: req.query, settings });
  if (req.query.export === '1') audit(req, 'wholesale.report_exported', 'report', null, null, { report: req.params.key, from, to });
  ok(res, report);
};

export default wrapAll({ list, run });
export { addDays };
