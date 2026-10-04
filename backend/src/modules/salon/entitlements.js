/*
 * What a client holds and spends: memberships, service packages and gift cards.
 *
 * Each is sold as a line on an invoice and is a SNAPSHOT of the plan at that moment (editing a plan later never
 * changes what someone already paid for). Using one writes a usage row against the invoice; cancelling the
 * invoice voids that row, so a balance is always "what was granted minus non-voided usage" and can be
 * recomputed from the rows.
 */
import crypto from 'node:crypto';
import { SalonError } from './common.js';

/* ── memberships ──────────────────────────────────────────────────────────────────────────── */

/** Validate a plan's benefits. Service ids must be this business's services. */
export const cleanBenefits = async (db, businessId, input) => {
  const b = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const out = {};
  if ('discount_pct' in b) {
    const n = Number(b.discount_pct);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new SalonError(400, 'The membership discount must be from 0 to 100 percent');
    out.discount_pct = n;
  }
  const applies = Array.isArray(b.discount_applies_to) ? b.discount_applies_to.map((x) => String(x).toUpperCase()) : ['SERVICE'];
  if (applies.some((x) => !['SERVICE', 'PRODUCT'].includes(x)) || !applies.length) throw new SalonError(400, 'The discount can apply to services and / or products');
  out.discount_applies_to = [...new Set(applies)];
  if (Array.isArray(b.free_services) && b.free_services.length) {
    if (b.free_services.length > 30) throw new SalonError(400, 'Too many free services');
    const list = b.free_services.map((f) => ({ service_id: Number(f.service_id), qty: Number(f.qty) }));
    if (list.some((f) => !Number.isInteger(f.service_id) || !Number.isInteger(f.qty) || f.qty < 1 || f.qty > 500)) throw new SalonError(400, 'Each free service needs a service and a quantity of 1 or more');
    if (new Set(list.map((f) => f.service_id)).size !== list.length) throw new SalonError(400, 'A free service is listed twice');
    const n = Number((await db.query(`SELECT COUNT(*) AS n FROM products WHERE business_id = $1 AND kind = 'SERVICE' AND product_id = ANY($2::int[])`, [businessId, list.map((f) => f.service_id)])).rows[0].n);
    if (n !== list.length) throw new SalonError(400, 'Free services must be from your own service list');
    out.free_services = list;
  }
  if ('priority_booking' in b) out.priority_booking = b.priority_booking === true;
  if ('points_multiplier' in b) {
    const n = Number(b.points_multiplier);
    if (!Number.isFinite(n) || n < 1 || n > 10) throw new SalonError(400, 'The extra points multiplier must be from 1 to 10');
    out.points_multiplier = n;
  }
  if (Array.isArray(b.perks)) {
    if (b.perks.length > 10) throw new SalonError(400, 'Up to ten perks');
    out.perks = b.perks.map((p) => String(p).trim().slice(0, 80)).filter(Boolean);
  }
  return out;
};

/** The client's current membership (latest expiry among active, unexpired ones). */
export const activeMembership = async (db, businessId, customerId, today, { lock = false } = {}) => (await db.query(
  `SELECT * FROM salon_customer_memberships WHERE business_id = $1 AND customer_id = $2 AND status = 'ACTIVE' AND expiry_date >= $3::date
   ORDER BY expiry_date DESC, membership_id DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [businessId, customerId, today])).rows[0] || null;

/** Free services still to use on a membership: Map(service_id -> remaining). */
export const freeServiceBalance = async (db, membership) => {
  const granted = membership.benefits?.free_services || [];
  if (!granted.length) return new Map();
  const used = new Map((await db.query(
    `SELECT service_id, COALESCE(SUM(quantity), 0)::int AS n FROM salon_membership_usage
     WHERE membership_id = $1 AND kind = 'FREE_SERVICE' AND voided_at IS NULL GROUP BY service_id`, [membership.membership_id])).rows.map((r) => [r.service_id, r.n]));
  return new Map(granted.map((g) => [g.service_id, Math.max(0, g.qty - (used.get(g.service_id) || 0))]));
};

/**
 * Start a membership for a client. Buying the same plan while one is running renews it: the new term begins the
 * day after the current one ends, so nothing already paid for is lost.
 */
export const sellMembership = async (db, { businessId, branchId, customerId, plan, invoiceId, today, userId }) => {
  const current = (await db.query(
    `SELECT membership_id, expiry_date FROM salon_customer_memberships WHERE business_id = $1 AND customer_id = $2 AND plan_id = $3 AND status = 'ACTIVE' AND expiry_date >= $4::date
     ORDER BY expiry_date DESC LIMIT 1 FOR UPDATE`, [businessId, customerId, plan.plan_id, today])).rows[0];
  const row = (await db.query(
    `INSERT INTO salon_customer_memberships (business_id, branch_id, customer_id, plan_id, plan_name, start_date, expiry_date, price_paise, benefits, invoice_id, renewed_from, created_by)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6::date + 1, $7::date), COALESCE($6::date + 1, $7::date) + ($8::int - 1), $9,$10,$11,$12,$13)
     RETURNING membership_id, start_date, expiry_date`,
    [businessId, branchId, customerId, plan.plan_id, plan.name, current?.expiry_date ?? null, today, plan.duration_days, plan.price_paise, JSON.stringify(plan.benefits || {}), invoiceId, current?.membership_id ?? null, userId]
  )).rows[0];
  return { ...row, renewed: Boolean(current) };
};

/** Mark memberships whose last day has passed. Returns how many changed. */
export const expireMemberships = async (db, businessId, today) =>
  (await db.query(`UPDATE salon_customer_memberships SET status = 'EXPIRED' WHERE business_id = $1 AND status = 'ACTIVE' AND expiry_date < $2::date`, [businessId, today])).rowCount;

/* ── packages ─────────────────────────────────────────────────────────────────────────────── */

export const sellPackage = async (db, { businessId, branchId, customerId, pkg, items, invoiceId, today, userId }) => {
  const row = (await db.query(
    `INSERT INTO salon_customer_packages (business_id, branch_id, customer_id, package_id, name, purchased_on, expiry_date, price_paise, invoice_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::date,$6::date + ($7::int - 1),$8,$9,$10) RETURNING cp_id, expiry_date`,
    [businessId, branchId, customerId, pkg.package_id, pkg.name, today, pkg.validity_days, pkg.price_paise, invoiceId, userId])).rows[0];
  for (const it of items) {
    await db.query(`INSERT INTO salon_customer_package_items (cp_id, service_id, qty_total) VALUES ($1,$2,$3)`, [row.cp_id, it.service_id, it.quantity]);
  }
  return row;
};

/**
 * Use one visit of a service from a client's package. Atomic: the row is only bumped if a visit is left, so two
 * tills cannot both spend the last one. Returns the package's name for the invoice line.
 */
export const usePackage = async (db, { businessId, customerId, cpId, serviceId, invoiceId, today }) => {
  const cp = (await db.query(
    `SELECT cp_id, name, status, expiry_date FROM salon_customer_packages WHERE cp_id = $1 AND business_id = $2 AND customer_id = $3 FOR UPDATE`, [cpId, businessId, customerId])).rows[0];
  if (!cp) throw new SalonError(404, 'That package is not on this client\'s account');
  if (cp.status !== 'ACTIVE') throw new SalonError(409, `${cp.name} is ${cp.status.toLowerCase()}`);
  if (String(cp.expiry_date).slice(0, 10) < today) throw new SalonError(409, `${cp.name} expired on ${String(cp.expiry_date).slice(0, 10)}`);
  const hit = (await db.query(
    `UPDATE salon_customer_package_items SET qty_used = qty_used + 1 WHERE cp_id = $1 AND service_id = $2 AND qty_used < qty_total RETURNING qty_total - qty_used AS remaining`, [cpId, serviceId])).rows[0];
  if (!hit) throw new SalonError(409, `${cp.name} has no visits left for that service`);
  await db.query(`INSERT INTO salon_package_usage (cp_id, business_id, service_id, invoice_id, quantity) VALUES ($1,$2,$3,$4,1)`, [cpId, businessId, serviceId, invoiceId]);
  return { name: cp.name, remaining: Number(hit.remaining) };
};

export const expirePackages = async (db, businessId, today) =>
  (await db.query(`UPDATE salon_customer_packages SET status = 'EXPIRED' WHERE business_id = $1 AND status = 'ACTIVE' AND expiry_date < $2::date`, [businessId, today])).rowCount;

/* ── gift cards ───────────────────────────────────────────────────────────────────────────── */

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no 0/O or 1/I: a code is read out over the phone

export const newCode = () => {
  const bytes = crypto.randomBytes(10);
  return `GC-${[...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('').replace(/(.{5})(.{5})/, '$1-$2')}`;
};

export const issueGiftCard = async (db, { businessId, branchId, amountPaise, customerId = null, expiresOn = null, invoiceId = null, userId = null, note = null }) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const row = (await db.query(
      `INSERT INTO salon_gift_cards (business_id, branch_id, code, initial_paise, balance_paise, expires_on, customer_id, invoice_id, note, created_by)
       VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING card_id, code`,
      [businessId, branchId, code, amountPaise, expiresOn, customerId, invoiceId, note, userId])).rows[0];
    if (row) {
      await db.query(`INSERT INTO salon_gift_card_txns (card_id, business_id, kind, amount_paise, balance_after_paise, invoice_id, created_by) VALUES ($1,$2,'ISSUE',$3,$3,$4,$5)`, [row.card_id, businessId, amountPaise, invoiceId, userId]);
      return row;
    }
  }
  throw new Error('Could not generate a unique gift card code');
};

/** Lock a card by the code a person reads out (case and dashes ignored) and check it can be spent on `today`. */
export const lockUsableCard = async (db, businessId, code, today) => {
  const clean = String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const card = (await db.query(
    `SELECT * FROM salon_gift_cards WHERE business_id = $1 AND regexp_replace(upper(code), '[^A-Z0-9]', '', 'g') = $2 FOR UPDATE`, [businessId, clean])).rows[0];
  if (!card) throw new SalonError(404, 'That gift card code was not found');
  if (card.status !== 'ACTIVE') throw new SalonError(409, 'That gift card has been cancelled');
  if (card.expires_on && String(card.expires_on).slice(0, 10) < today) throw new SalonError(409, `That gift card expired on ${String(card.expires_on).slice(0, 10)}`);
  if (Number(card.balance_paise) <= 0) throw new SalonError(409, 'That gift card has no balance left');
  return card;
};

export const redeemGiftCard = async (db, { card, amountPaise, invoiceId, userId }) => {
  if (amountPaise > Number(card.balance_paise)) throw new SalonError(409, `That gift card only has ₹${Number(card.balance_paise) / 100} left`);
  const after = Number(card.balance_paise) - amountPaise;
  await db.query(`UPDATE salon_gift_cards SET balance_paise = $2 WHERE card_id = $1`, [card.card_id, after]);
  await db.query(`INSERT INTO salon_gift_card_txns (card_id, business_id, kind, amount_paise, balance_after_paise, invoice_id, created_by) VALUES ($1,$2,'REDEEM',$3,$4,$5,$6)`, [card.card_id, card.business_id, -amountPaise, after, invoiceId, userId]);
  card.balance_paise = after;
};
