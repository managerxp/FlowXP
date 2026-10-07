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

/** The business's own clock right now: its calendar day, the weekday (0 = Sunday ... 6 = Saturday) and minutes since midnight. */
export const businessNow = async (businessId, db = pool) => {
  const r = (await db.query(
    `SELECT to_char(n, 'YYYY-MM-DD') AS d, EXTRACT(DOW FROM n)::int AS dow, (EXTRACT(HOUR FROM n) * 60 + EXTRACT(MINUTE FROM n))::int AS minutes
     FROM (SELECT CURRENT_TIMESTAMP AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata') AS n) t`, [businessId])).rows[0];
  return { date: r.d, dow: r.dow, minutes: r.minutes };
};
