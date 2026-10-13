/*
 * Gaming reports and the dashboard. Permissions are decided in the router (gaming.routes.js).
 */
import pool from '../config/database.js';
import { localDate, ok, wrapAll } from '../modules/gaming/common.js';
import * as reports from '../modules/gaming/reports.js';

export default wrapAll({
  dashboard: async (req, res) => ok(res, await reports.dashboard(pool, req.tenant, await localDate(pool, req.tenant.businessId))),
  summary: async (req, res) => ok(res, await reports.summary(pool, req.tenant, req.query)),
  stations: async (req, res) => ok(res, await reports.byStation(pool, req.tenant, req.query)),
  heatmap: async (req, res) => ok(res, await reports.heatmap(pool, req.tenant, req.query)),
  days: async (req, res) => ok(res, await reports.byDay(pool, req.tenant, req.query)),
  games: async (req, res) => ok(res, await reports.topGames(pool, req.tenant, req.query))
});
