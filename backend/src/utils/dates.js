/*
 * "Today" for a business is today in the business's own timezone. A restaurant
 * in Bengaluru closing at 1 a.m. is still on the previous day's trading; a
 * server clock in UTC, or a browser's toISOString(), would say otherwise.
 * Everything that defaults a date range, and the date an invoice is stamped
 * with, comes from here so they can never disagree with each other.
 */
import pool from '../config/database.js';

const DAY = 86400000;

export const businessToday = async (businessId, db = pool) =>
  (await db.query(
    `SELECT ((CURRENT_TIMESTAMP AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata'))::date)::text AS d`,
    [businessId]
  )).rows[0].d;

export const addDaysISO = (date, n) => new Date(new Date(`${date}T00:00:00Z`).getTime() + n * DAY).toISOString().slice(0, 10);
