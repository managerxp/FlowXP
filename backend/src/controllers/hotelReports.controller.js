/*
 * Hotel report endpoints, mounted at /api/hotel/reports (see hotel.routes.js). Dates are the hotel's business dates.
 * Every figure is before GST unless it says otherwise. See modules/hotel/reports.js for the definitions.
 */
import pool from '../config/database.js';
import { HotelError, addDaysISO, getProperty, isoDate, money, ok, withRupees, wrapAll } from '../modules/hotel/common.js';
import * as r from '../modules/hotel/reports.js';

const out = (res, data) => ok(res, withRupees(data));

/** from..to from the query, defaulting to the month so far (up to the hotel's date). */
const range = async (req) => {
  const property = await getProperty(pool, req.tenant);
  const to = isoDate(req.query.to, 'To') || property.business_date;
  const from = isoDate(req.query.from, 'From') || `${to.slice(0, 8)}01`;
  if (to < from) throw new HotelError(400, 'The end date cannot be before the start');
  return { from, to, property };
};

export default wrapAll({
  flash: async (req, res) => out(res, await r.managersFlash(pool, req.tenant, isoDate(req.query.date, 'Date'))),

  occupancy: async (req, res) => { const { from, to } = await range(req); out(res, await r.occupancyRevenue(pool, req.tenant, from, to)); },
  departments: async (req, res) => { const { from, to } = await range(req); out(res, await r.revenueByDepartment(pool, req.tenant, from, to)); },
  collections: async (req, res) => { const { from, to } = await range(req); out(res, await r.collections(pool, req.tenant, from, to)); },
  lost: async (req, res) => { const { from, to } = await range(req); out(res, await r.noShowsAndCancellations(pool, req.tenant, from, to)); },
  sources: async (req, res) => { const { from, to } = await range(req); out(res, await r.sourceOfBusiness(pool, req.tenant, from, to)); },

  forecast: async (req, res) => {
    const property = await getProperty(pool, req.tenant);
    const from = isoDate(req.query.from, 'From') || property.business_date;
    const to = isoDate(req.query.to, 'To') || addDaysISO(from, 29);
    out(res, await r.forecast(pool, req.tenant, from, to));
  },

  arrivals: async (req, res) => { const p = await getProperty(pool, req.tenant); out(res, { date: isoDate(req.query.date, 'Date') || p.business_date, rows: await r.arrivals(pool, req.tenant, isoDate(req.query.date, 'Date') || p.business_date) }); },
  departures: async (req, res) => { const p = await getProperty(pool, req.tenant); out(res, { date: isoDate(req.query.date, 'Date') || p.business_date, rows: await r.departures(pool, req.tenant, isoDate(req.query.date, 'Date') || p.business_date) }); },
  inHouse: async (req, res) => out(res, { rows: await r.inHouse(pool, req.tenant) }),
  highBalance: async (req, res) => out(res, { rows: await r.highBalance(pool, req.tenant, req.query.min ? money(req.query.min, 'The amount') : 0) })
});
