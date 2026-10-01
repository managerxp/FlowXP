/*
 * Targets and how much of each has been achieved.
 *
 * A target is a number to reach in a period for one scope: a salesperson, a territory (and everything under it), a
 * brand, a category, a product, a customer, or the whole business. The actual is read from the sales facts for that
 * scope and period, so it moves the moment an invoice is issued or a credit note is raised.
 *
 * Weeks run Monday to Sunday; months and quarters are calendar; a year is the Indian financial year (1 Apr – 31 Mar).
 */
import { FACTS, scopePredicate } from './facts.js';
import { territoryScope } from './common.js';

const iso = (d) => d.toISOString().slice(0, 10);
const utc = (s) => new Date(`${s}T00:00:00Z`);
const addDays = (s, n) => iso(new Date(utc(s).getTime() + n * 86400000));

/** [start, end] of the period of `type` that contains `date` (YYYY-MM-DD). */
export const periodBounds = (type, date) => {
  const d = utc(date); const y = d.getUTCFullYear(); const m = d.getUTCMonth();
  if (type === 'DAILY') return [date, date];
  if (type === 'WEEKLY') { const dow = (d.getUTCDay() + 6) % 7; const start = addDays(date, -dow); return [start, addDays(start, 6)]; }
  if (type === 'MONTHLY') return [iso(new Date(Date.UTC(y, m, 1))), iso(new Date(Date.UTC(y, m + 1, 0)))];
  if (type === 'QUARTERLY') { const q = Math.floor(m / 3) * 3; return [iso(new Date(Date.UTC(y, q, 1))), iso(new Date(Date.UTC(y, q + 3, 0)))]; }
  const fy = m >= 3 ? y : y - 1;   // YEARLY: financial year
  return [`${fy}-04-01`, `${fy + 1}-03-31`];
};

/** Actual sales for a scope and period: { actual (paise or base units), revenue, units, cost }. */
export const actualFor = async (db, { businessId, scopeType, scopeId, metric = 'VALUE', from, to }) => {
  const values = [businessId, from, to];
  let predicate = 'TRUE';
  if (scopeType !== 'BUSINESS') {
    values.push(scopeType === 'TERRITORY' ? await territoryScope(db, businessId, scopeId) : scopeId);
    predicate = scopePredicate(scopeType, `$${values.length}`);
  }
  const row = (await db.query(
    `SELECT COALESCE(SUM(f.revenue), 0) AS revenue, COALESCE(SUM(f.units) FILTER (WHERE f.paid), 0) AS units, COALESCE(SUM(f.cost), 0) AS cost
     FROM ${FACTS} WHERE f.business_id = $1 AND f.invoice_date >= $2::date AND f.invoice_date <= $3::date AND ${predicate}`, values)).rows[0];
  return { actual: metric === 'QTY' ? Number(row.units) : Number(row.revenue), revenue: Number(row.revenue), units: Number(row.units), cost: Number(row.cost) };
};

/** Progress of one target: how far, how much is left, and what has to be sold per remaining day to get there. */
export const progress = (target, actual, on) => {
  const goal = Number(target.target_amount);
  const start = String(target.period_start).slice(0, 10); const end = String(target.period_end).slice(0, 10);
  const remaining = Math.max(0, goal - actual);
  const daysTotal = Math.round((utc(end) - utc(start)) / 86400000) + 1;
  const elapsed = on < start ? 0 : Math.min(daysTotal, Math.round((utc(on) - utc(start)) / 86400000) + 1);
  const daysLeft = on > end ? 0 : on < start ? daysTotal : Math.round((utc(end) - utc(on)) / 86400000) + 1;   // today still counts
  const achievement = goal > 0 ? Math.round((actual / goal) * 1000) / 10 : 0;
  const expected = daysTotal > 0 ? (goal * elapsed) / daysTotal : 0;
  const status = actual >= goal ? 'ACHIEVED' : on > end ? 'MISSED' : on < start ? 'UPCOMING' : actual >= expected * 0.9 ? 'ON_TRACK' : 'BEHIND';
  return {
    target: goal, actual, achievement_pct: achievement, remaining, days_total: daysTotal, days_left: daysLeft,
    required_per_day: daysLeft > 0 ? Math.ceil(remaining / daysLeft) : remaining, status
  };
};
