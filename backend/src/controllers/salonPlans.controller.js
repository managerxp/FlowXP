/*
 * Membership plans, service packages, gift cards and offers: the salon's things-to-sell and how a client's copy
 * of each is managed afterwards. Selling one happens at the till (modules/salon/pos.js) so it is always an
 * invoice with tax and a payment; everything here is definition, inspection and the few manual corrections an
 * owner needs — each of which is audited with the value before and after.
 */
import pool from '../config/database.js';
import { businessToday } from '../utils/dates.js';
import { toRupees } from '../utils/money.js';
import {
  SalonError, audit, bool, diff, int, isoDate, like, money, num, ok, oneOf, page, paging, text, wrapAll
} from '../modules/salon/common.js';
import { cleanBenefits, issueGiftCard } from '../modules/salon/entitlements.js';
import { cleanOffer } from '../modules/salon/offers.js';
import { getSettings } from '../modules/salon/settings.js';

/* ── membership plans ─────────────────────────────────────────────────────────────────────── */

const planOut = (r) => ({
  plan_id: r.plan_id, name: r.name, description: r.description, price: toRupees(r.price_paise), tax_rate: Number(r.tax_rate), hsn_sac: r.hsn_sac,
  duration_days: r.duration_days, benefits: r.benefits, is_active: r.is_active, sort_order: r.sort_order,
  ...(r.members != null ? { active_members: Number(r.members) } : {})
});

const listPlans = async (req, res) => {
  const rows = (await pool.query(
    `SELECT p.*, (SELECT COUNT(*) FROM salon_customer_memberships m WHERE m.plan_id = p.plan_id AND m.status = 'ACTIVE') AS members
     FROM salon_membership_plans p WHERE p.business_id = $1 ORDER BY p.is_active DESC, p.sort_order, p.price_paise`, [req.tenant.businessId])).rows;
  ok(res, rows.map(planOut));
};

const planFields = async (req, body, { partial }) => {
  const settings = await getSettings(pool, req.tenant.businessId);
  const f = {};
  if (!partial || 'name' in body) f.name = text(body.name, 'Plan name', { max: 80, min: 2, required: true });
  if ('description' in body) f.description = text(body.description, 'Description', { max: 300 });
  if (!partial || 'price' in body) f.price_paise = money(body.price, 'Price', { required: true });
  if (!partial || 'tax_rate' in body) f.tax_rate = body.tax_rate == null || body.tax_rate === '' ? settings.default_service_tax_rate : num(body.tax_rate, 'Tax rate', { min: 0, max: 100 });
  if ('hsn_sac' in body) f.hsn_sac = text(body.hsn_sac, 'SAC code', { max: 16 });
  if (!partial || 'duration_days' in body) f.duration_days = int(body.duration_days, 'Duration', { min: 1, max: 3660, required: true });
  if ('benefits' in body) f.benefits = JSON.stringify(await cleanBenefits(pool, req.tenant.businessId, body.benefits));
  if ('is_active' in body) f.is_active = bool(body.is_active);
  if ('sort_order' in body) f.sort_order = int(body.sort_order, 'Order', { min: 0, max: 1000 }) ?? 0;
  return f;
};

const insertRow = async (table, businessId, f, returning) => {
  const keys = Object.keys(f);
  return (await pool.query(`INSERT INTO ${table} (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING ${returning}`, [businessId, ...keys.map((k) => f[k])])).rows[0];
};

const createPlan = async (req, res) => {
  const f = await planFields(req, req.body || {}, { partial: false });
  if (!('benefits' in f)) f.benefits = JSON.stringify(await cleanBenefits(pool, req.tenant.businessId, {}));
  const row = await insertRow('salon_membership_plans', req.tenant.businessId, f, '*');
  audit(req, 'salon.membership_plan_created', 'membership_plan', row.plan_id, null, { name: row.name, price: toRupees(row.price_paise) });
  ok(res, planOut(row), 201);
};

const updatePlan = async (req, res) => {
  const before = (await pool.query(`SELECT * FROM salon_membership_plans WHERE plan_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!before) throw new SalonError(404, 'Not found');
  const f = await planFields(req, req.body || {}, { partial: true });
  const keys = Object.keys(f);
  if (!keys.length) throw new SalonError(400, 'Nothing to update');
  const after = (await pool.query(`UPDATE salon_membership_plans SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE plan_id = $1 AND business_id = $2 RETURNING *`, [before.plan_id, req.tenant.businessId, ...keys.map((k) => f[k])])).rows[0];
  // members already on the plan keep the terms they bought (their copy is a snapshot)
  audit(req, 'salon.membership_plan_changed', 'membership_plan', before.plan_id, null, null, { changes: diff(planOut(before), planOut(after)) });
  ok(res, planOut(after));
};

/* ── client memberships ───────────────────────────────────────────────────────────────────── */

/* GET /api/salon/memberships?status=&q=&expiring_in=&limit=&offset= */
const listMemberships = async (req, res) => {
  const pg = paging(req.query);
  const today = await businessToday(req.tenant.businessId);
  const values = [req.tenant.businessId, today];
  let where = `m.business_id = $1 AND $2::date IS NOT NULL`;
  if (req.query.status) { values.push(oneOf(req.query.status, 'Status', ['ACTIVE', 'EXPIRED', 'CANCELLED'])); where += ` AND m.status = $${values.length}`; }
  if (req.query.expiring_in) { values.push(int(req.query.expiring_in, 'Days', { min: 1, max: 365 })); where += ` AND m.status = 'ACTIVE' AND m.expiry_date BETWEEN $2::date AND $2::date + $${values.length}::int`; }
  if (req.query.q) { values.push(like(String(req.query.q).slice(0, 80))); where += ` AND (c.name ILIKE $${values.length} OR c.phone ILIKE $${values.length})`; }
  const total = Number((await pool.query(`SELECT COUNT(*) AS n FROM salon_customer_memberships m JOIN customers c ON c.customer_id = m.customer_id WHERE ${where}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const { rows } = await pool.query(
    `SELECT m.membership_id, m.customer_id, c.name AS customer_name, c.phone, m.plan_name, m.start_date, m.expiry_date, m.status, m.price_paise, m.benefits, m.renewed_from,
            (SELECT COALESCE(SUM(u.quantity), 0) FROM salon_membership_usage u WHERE u.membership_id = m.membership_id AND u.kind = 'FREE_SERVICE' AND u.voided_at IS NULL) AS free_used,
            (SELECT COALESCE(SUM(u.discount_paise), 0) FROM salon_membership_usage u WHERE u.membership_id = m.membership_id AND u.kind = 'DISCOUNT' AND u.voided_at IS NULL) AS discount_given
     FROM salon_customer_memberships m JOIN customers c ON c.customer_id = m.customer_id WHERE ${where}
     ORDER BY m.expiry_date, m.membership_id LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  page(res, rows.map((r) => ({
    membership_id: r.membership_id, customer_id: r.customer_id, customer_name: r.customer_name, phone: r.phone, plan_name: r.plan_name, start_date: r.start_date, expiry_date: r.expiry_date,
    status: r.status, active: r.status === 'ACTIVE' && r.expiry_date >= today, price: toRupees(r.price_paise), benefits: r.benefits,
    days_left: r.status === 'ACTIVE' ? Math.round((Date.parse(r.expiry_date) - Date.parse(today)) / 86400000) : null,
    free_services_used: Number(r.free_used), discount_given: toRupees(r.discount_given)
  })), total, pg);
};

const membershipUsage = async (req, res) => {
  const m = (await pool.query(`SELECT membership_id, plan_name, benefits FROM salon_customer_memberships WHERE membership_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!m) throw new SalonError(404, 'Not found');
  const usage = (await pool.query(
    `SELECT u.usage_id, u.kind, u.quantity, u.discount_paise, u.created_at, u.voided_at, p.name AS service, i.invoice_number
     FROM salon_membership_usage u LEFT JOIN products p ON p.product_id = u.service_id LEFT JOIN invoices i ON i.invoice_id = u.invoice_id
     WHERE u.membership_id = $1 ORDER BY u.usage_id DESC LIMIT 100`, [m.membership_id])).rows;
  ok(res, { ...m, usage: usage.map((u) => ({ ...u, quantity: Number(u.quantity), discount: toRupees(u.discount_paise) })) });
};

const cancelMembership = async (req, res) => {
  const reason = text(req.body?.reason, 'Reason', { max: 200, required: true });
  const before = (await pool.query(`SELECT membership_id, status, plan_name FROM salon_customer_memberships WHERE membership_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!before) throw new SalonError(404, 'Not found');
  if (before.status !== 'ACTIVE') throw new SalonError(409, `This membership is already ${before.status.toLowerCase()}`);
  await pool.query(`UPDATE salon_customer_memberships SET status = 'CANCELLED' WHERE membership_id = $1`, [before.membership_id]);
  audit(req, 'salon.membership_cancelled', 'membership', before.membership_id, { status: 'ACTIVE' }, { status: 'CANCELLED' }, { reason, plan: before.plan_name });
  ok(res, { membership_id: before.membership_id, status: 'CANCELLED' });
};

/* ── packages ─────────────────────────────────────────────────────────────────────────────── */

const packageItems = async (db, businessId, list) => {
  if (!Array.isArray(list) || !list.length) throw new SalonError(400, 'A package needs at least one service');
  if (list.length > 30) throw new SalonError(400, 'A package can include at most 30 services');
  const items = list.map((i) => ({ service_id: int(i.service_id, 'Service', { min: 1, required: true }), quantity: int(i.quantity, 'Quantity', { min: 1, max: 500, required: true }) }));
  if (new Set(items.map((i) => i.service_id)).size !== items.length) throw new SalonError(400, 'A service is listed twice');
  const n = Number((await db.query(`SELECT COUNT(*) AS n FROM products WHERE business_id = $1 AND kind = 'SERVICE' AND product_id = ANY($2::int[])`, [businessId, items.map((i) => i.service_id)])).rows[0].n);
  if (n !== items.length) throw new SalonError(400, 'Packages are made of your own services');
  return items;
};

const loadPackage = async (db, businessId, id) => {
  const p = (await db.query(`SELECT * FROM salon_packages WHERE package_id = $1 AND business_id = $2`, [id, businessId])).rows[0];
  if (!p) return null;
  const items = (await db.query(`SELECT i.service_id, s.name, i.quantity, s.selling_price_paise FROM salon_package_items i JOIN products s ON s.product_id = i.service_id WHERE i.package_id = $1 ORDER BY s.name`, [id])).rows;
  const value = items.reduce((s, i) => s + Number(i.selling_price_paise) * i.quantity, 0);
  return {
    package_id: p.package_id, name: p.name, description: p.description, price: toRupees(p.price_paise), tax_rate: Number(p.tax_rate), hsn_sac: p.hsn_sac,
    validity_days: p.validity_days, is_active: p.is_active, services_value: toRupees(value), saving: toRupees(Math.max(0, value - Number(p.price_paise))),
    items: items.map((i) => ({ service_id: i.service_id, name: i.name, quantity: i.quantity }))
  };
};

const listPackages = async (req, res) => {
  const ids = (await pool.query(`SELECT package_id FROM salon_packages WHERE business_id = $1 ORDER BY is_active DESC, name`, [req.tenant.businessId])).rows;
  ok(res, (await Promise.all(ids.map((r) => loadPackage(pool, req.tenant.businessId, r.package_id)))));
};

const packageFields = async (req, body, { partial }) => {
  const settings = await getSettings(pool, req.tenant.businessId);
  const f = {};
  if (!partial || 'name' in body) f.name = text(body.name, 'Package name', { max: 80, min: 2, required: true });
  if ('description' in body) f.description = text(body.description, 'Description', { max: 300 });
  if (!partial || 'price' in body) f.price_paise = money(body.price, 'Price', { required: true });
  if (!partial || 'tax_rate' in body) f.tax_rate = body.tax_rate == null || body.tax_rate === '' ? settings.default_service_tax_rate : num(body.tax_rate, 'Tax rate', { min: 0, max: 100 });
  if ('hsn_sac' in body) f.hsn_sac = text(body.hsn_sac, 'SAC code', { max: 16 });
  if (!partial || 'validity_days' in body) f.validity_days = int(body.validity_days, 'Validity', { min: 1, max: 3660, required: true });
  if ('is_active' in body) f.is_active = bool(body.is_active);
  return f;
};

const createPackage = async (req, res) => {
  const body = req.body || {};
  const f = await packageFields(req, body, { partial: false });
  const items = await packageItems(pool, req.tenant.businessId, body.items);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const keys = Object.keys(f);
    const id = (await client.query(`INSERT INTO salon_packages (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING package_id`, [req.tenant.businessId, ...keys.map((k) => f[k])])).rows[0].package_id;
    for (const i of items) await client.query(`INSERT INTO salon_package_items (package_id, service_id, quantity) VALUES ($1,$2,$3)`, [id, i.service_id, i.quantity]);
    await client.query('COMMIT');
    audit(req, 'salon.package_created', 'package', id, null, { name: f.name, price: toRupees(f.price_paise), services: items.length });
    ok(res, await loadPackage(pool, req.tenant.businessId, id), 201);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const updatePackage = async (req, res) => {
  const body = req.body || {};
  const before = await loadPackage(pool, req.tenant.businessId, req.params.id);
  if (!before) throw new SalonError(404, 'Not found');
  const f = await packageFields(req, body, { partial: true });
  const items = 'items' in body ? await packageItems(pool, req.tenant.businessId, body.items) : null;
  if (!Object.keys(f).length && !items) throw new SalonError(400, 'Nothing to update');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const keys = Object.keys(f);
    if (keys.length) await client.query(`UPDATE salon_packages SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE package_id = $1 AND business_id = $2`, [before.package_id, req.tenant.businessId, ...keys.map((k) => f[k])]);
    if (items) {
      await client.query(`DELETE FROM salon_package_items WHERE package_id = $1`, [before.package_id]);
      for (const i of items) await client.query(`INSERT INTO salon_package_items (package_id, service_id, quantity) VALUES ($1,$2,$3)`, [before.package_id, i.service_id, i.quantity]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const after = await loadPackage(pool, req.tenant.businessId, before.package_id);
  audit(req, 'salon.package_changed', 'package', before.package_id, null, null, { changes: diff(before, after) });
  ok(res, after);
};

/* GET /api/salon/client-packages?status=&customer_id=&q= — packages clients hold, with what is left */
const listClientPackages = async (req, res) => {
  const pg = paging(req.query);
  const today = await businessToday(req.tenant.businessId);
  const values = [req.tenant.businessId, today];
  let where = `cp.business_id = $1`;
  if (req.query.status) { values.push(oneOf(req.query.status, 'Status', ['ACTIVE', 'EXPIRED', 'CANCELLED'])); where += ` AND cp.status = $${values.length}`; }
  if (req.query.customer_id) { values.push(Number(req.query.customer_id) || 0); where += ` AND cp.customer_id = $${values.length}`; }
  if (req.query.q) { values.push(like(String(req.query.q).slice(0, 80))); where += ` AND c.name ILIKE $${values.length}`; }
  const total = Number((await pool.query(`SELECT COUNT(*) AS n FROM salon_customer_packages cp JOIN customers c ON c.customer_id = cp.customer_id WHERE ${where}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const { rows } = await pool.query(
    `SELECT cp.cp_id, cp.customer_id, c.name AS customer_name, cp.name, cp.purchased_on, cp.expiry_date, cp.status, cp.price_paise,
            (SELECT json_agg(json_build_object('service_id', i.service_id, 'name', s.name, 'total', i.qty_total, 'used', i.qty_used, 'remaining', i.qty_total - i.qty_used) ORDER BY s.name)
             FROM salon_customer_package_items i JOIN products s ON s.product_id = i.service_id WHERE i.cp_id = cp.cp_id) AS items
     FROM salon_customer_packages cp JOIN customers c ON c.customer_id = cp.customer_id WHERE ${where} ORDER BY cp.expiry_date, cp.cp_id LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  page(res, rows.map((r) => ({ ...r, price: toRupees(r.price_paise), active: r.status === 'ACTIVE' && r.expiry_date >= today, items: r.items || [] })), total, pg);
};

/* PUT /api/salon/client-packages/:id { expiry_date?, status?, items?: [{ service_id, qty_total }] } — the owner's manual corrections, audited */
const adjustClientPackage = async (req, res) => {
  const b = req.body || {};
  const cp = (await pool.query(`SELECT * FROM salon_customer_packages WHERE cp_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!cp) throw new SalonError(404, 'Not found');
  const reason = text(b.reason, 'Reason', { max: 200, required: true });
  const before = { expiry_date: cp.expiry_date, status: cp.status, items: (await pool.query(`SELECT service_id, qty_total, qty_used FROM salon_customer_package_items WHERE cp_id = $1 ORDER BY service_id`, [cp.cp_id])).rows };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if ('expiry_date' in b) await client.query(`UPDATE salon_customer_packages SET expiry_date = $2, status = CASE WHEN status = 'EXPIRED' AND $2::date >= $3::date THEN 'ACTIVE' ELSE status END WHERE cp_id = $1`, [cp.cp_id, isoDate(b.expiry_date, 'Expiry', { required: true }), await businessToday(req.tenant.businessId)]);
    if ('status' in b) await client.query(`UPDATE salon_customer_packages SET status = $2 WHERE cp_id = $1`, [cp.cp_id, oneOf(b.status, 'Status', ['ACTIVE', 'CANCELLED'], { required: true })]);
    if (Array.isArray(b.items)) {
      for (const it of b.items) {
        const total = int(it.qty_total, 'Quantity', { min: 1, max: 500, required: true });
        const hit = (await client.query(`UPDATE salon_customer_package_items SET qty_total = $3 WHERE cp_id = $1 AND service_id = $2 AND qty_used <= $3 RETURNING 1`, [cp.cp_id, int(it.service_id, 'Service', { min: 1, required: true }), total])).rows[0];
        if (!hit) throw new SalonError(400, 'A service cannot be set below the visits already used');
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  const after = { expiry_date: (await pool.query(`SELECT expiry_date, status FROM salon_customer_packages WHERE cp_id = $1`, [cp.cp_id])).rows[0], items: (await pool.query(`SELECT service_id, qty_total, qty_used FROM salon_customer_package_items WHERE cp_id = $1 ORDER BY service_id`, [cp.cp_id])).rows };
  audit(req, 'salon.package_adjusted', 'customer_package', cp.cp_id, before, after, { reason });
  ok(res, { cp_id: cp.cp_id, ...after });
};

/* ── gift cards ───────────────────────────────────────────────────────────────────────────── */

const cardOut = (r, today) => ({
  card_id: r.card_id, code: r.code, initial: toRupees(r.initial_paise), balance: toRupees(r.balance_paise), used: toRupees(Number(r.initial_paise) - Number(r.balance_paise)),
  expires_on: r.expires_on, status: r.status, customer_id: r.customer_id, customer_name: r.customer_name ?? null, created_at: r.created_at,
  usable: r.status === 'ACTIVE' && Number(r.balance_paise) > 0 && (!r.expires_on || r.expires_on >= today), expired: Boolean(r.expires_on && r.expires_on < today)
});

/* GET /api/salon/gift-cards?status=&q= */
const listCards = async (req, res) => {
  const pg = paging(req.query);
  const today = await businessToday(req.tenant.businessId);
  const values = [req.tenant.businessId];
  let where = `g.business_id = $1`;
  if (req.query.status) { values.push(oneOf(req.query.status, 'Status', ['ACTIVE', 'CANCELLED'])); where += ` AND g.status = $${values.length}`; }
  if (req.query.q) { values.push(like(String(req.query.q).slice(0, 40))); where += ` AND (g.code ILIKE $${values.length} OR c.name ILIKE $${values.length})`; }
  const total = Number((await pool.query(`SELECT COUNT(*) AS n FROM salon_gift_cards g LEFT JOIN customers c ON c.customer_id = g.customer_id WHERE ${where}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const { rows } = await pool.query(`SELECT g.*, c.name AS customer_name FROM salon_gift_cards g LEFT JOIN customers c ON c.customer_id = g.customer_id WHERE ${where} ORDER BY g.card_id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  page(res, rows.map((r) => cardOut(r, today)), total, pg);
};

/* GET /api/salon/gift-cards/lookup?code= — balance check at the till */
const lookupCard = async (req, res) => {
  const today = await businessToday(req.tenant.businessId);
  const clean = String(req.query.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length < 4) throw new SalonError(400, 'Enter the gift card code');
  const row = (await pool.query(`SELECT g.*, c.name AS customer_name FROM salon_gift_cards g LEFT JOIN customers c ON c.customer_id = g.customer_id WHERE g.business_id = $1 AND regexp_replace(upper(g.code), '[^A-Z0-9]', '', 'g') = $2`, [req.tenant.businessId, clean])).rows[0];
  if (!row) throw new SalonError(404, 'That gift card code was not found');
  const txns = (await pool.query(`SELECT kind, amount_paise, balance_after_paise, created_at FROM salon_gift_card_txns WHERE card_id = $1 ORDER BY txn_id DESC LIMIT 20`, [row.card_id])).rows;
  ok(res, { ...cardOut(row, today), history: txns.map((t) => ({ kind: t.kind, amount: toRupees(t.amount_paise), balance_after: toRupees(t.balance_after_paise), at: t.created_at })) });
};

/* POST /api/salon/gift-cards { amount, customer_id?, expires_on?, note } — a complimentary card (sold ones are issued at the till) */
const issueComplimentary = async (req, res) => {
  const b = req.body || {};
  const amountPaise = money(b.amount, 'Amount', { min: 100, required: true });
  const note = text(b.note, 'Reason', { max: 200, required: true });
  const customerId = b.customer_id ? int(b.customer_id, 'Client', { min: 1 }) : null;
  if (customerId && !(await pool.query(`SELECT 1 FROM customers WHERE customer_id = $1 AND business_id = $2`, [customerId, req.tenant.businessId])).rows.length) throw new SalonError(400, 'Client not found');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const card = await issueGiftCard(client, { businessId: req.tenant.businessId, branchId: req.tenant.branchId, amountPaise, customerId, expiresOn: isoDate(b.expires_on, 'Expiry'), userId: req.auth.userId, note });
    await client.query('COMMIT');
    audit(req, 'salon.gift_card_issued_free', 'gift_card', card.card_id, null, { amount: toRupees(amountPaise) }, { reason: note });
    ok(res, { card_id: card.card_id, code: card.code, amount: toRupees(amountPaise) }, 201);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/* POST /api/salon/gift-cards/:id/adjust { amount, note } — add (+) or take off (-) balance; or /cancel */
const adjustCard = async (req, res) => {
  const delta = money(req.body?.amount, 'Amount', { min: -100000000000, required: true });
  const note = text(req.body?.note, 'Reason', { max: 200, required: true });
  if (delta === 0) throw new SalonError(400, 'Enter an amount to add or remove');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const card = (await client.query(`SELECT * FROM salon_gift_cards WHERE card_id = $1 AND business_id = $2 FOR UPDATE`, [req.params.id, req.tenant.businessId])).rows[0];
    if (!card) throw new SalonError(404, 'Not found');
    if (card.status !== 'ACTIVE') throw new SalonError(409, 'That gift card is cancelled');
    const after = Number(card.balance_paise) + delta;
    if (after < 0) throw new SalonError(409, `It only has ₹${toRupees(card.balance_paise)}`);
    await client.query(`UPDATE salon_gift_cards SET balance_paise = $2 WHERE card_id = $1`, [card.card_id, after]);
    await client.query(`INSERT INTO salon_gift_card_txns (card_id, business_id, kind, amount_paise, balance_after_paise, note, created_by) VALUES ($1,$2,'ADJUST',$3,$4,$5,$6)`, [card.card_id, card.business_id, delta, after, note, req.auth.userId]);
    await client.query('COMMIT');
    audit(req, 'salon.gift_card_adjusted', 'gift_card', card.card_id, { balance: toRupees(card.balance_paise) }, { balance: toRupees(after) }, { reason: note });
    ok(res, { card_id: card.card_id, balance: toRupees(after) });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const cancelCard = async (req, res) => {
  const note = text(req.body?.reason, 'Reason', { max: 200, required: true });
  const card = (await pool.query(`UPDATE salon_gift_cards SET status = 'CANCELLED' WHERE card_id = $1 AND business_id = $2 AND status = 'ACTIVE' RETURNING card_id, balance_paise`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!card) throw new SalonError(404, 'Not found, or already cancelled');
  audit(req, 'salon.gift_card_cancelled', 'gift_card', card.card_id, { balance: toRupees(card.balance_paise) }, { status: 'CANCELLED' }, { reason: note });
  ok(res, { card_id: card.card_id, status: 'CANCELLED' });
};

/* ── offers ───────────────────────────────────────────────────────────────────────────────── */

const offerOut = (o) => ({
  offer_id: o.offer_id, name: o.name, description: o.description, code: o.code, discount_type: o.discount_type, value: Number(o.value),
  max_discount: o.max_discount_paise == null ? null : toRupees(o.max_discount_paise), applies_to: o.applies_to, item_ids: o.item_ids, branch_ids: o.branch_ids,
  conditions: { ...o.conditions, ...(o.conditions?.min_bill_paise != null ? { min_bill: toRupees(o.conditions.min_bill_paise) } : {}) },
  starts_on: o.starts_on, ends_on: o.ends_on, usage_limit: o.usage_limit, per_customer_limit: o.per_customer_limit, auto_apply: o.auto_apply, is_active: o.is_active,
  redeemed: o.redeemed == null ? undefined : Number(o.redeemed)
});

const listOffers = async (req, res) => {
  const rows = (await pool.query(
    `SELECT o.*, (SELECT COUNT(*) FROM salon_offer_redemptions r WHERE r.offer_id = o.offer_id AND r.voided_at IS NULL) AS redeemed
     FROM salon_offers o WHERE o.business_id = $1 ORDER BY o.is_active DESC, o.offer_id DESC`, [req.tenant.businessId])).rows;
  ok(res, rows.map(offerOut));
};

const createOffer = async (req, res) => {
  const f = cleanOffer(req.body || {}, { partial: false });
  const dup = f.code && (await pool.query(`SELECT 1 FROM salon_offers WHERE business_id = $1 AND upper(code) = $2`, [req.tenant.businessId, f.code])).rows.length;
  if (dup) throw new SalonError(409, 'You already have an offer with that code');
  const row = await insertRow('salon_offers', req.tenant.businessId, f, '*');
  audit(req, 'salon.offer_created', 'offer', row.offer_id, null, { name: row.name, discount_type: row.discount_type, value: Number(row.value) });
  ok(res, offerOut(row), 201);
};

const updateOffer = async (req, res) => {
  const before = (await pool.query(`SELECT * FROM salon_offers WHERE offer_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!before) throw new SalonError(404, 'Not found');
  const f = cleanOffer(req.body || {}, { partial: true });
  const keys = Object.keys(f);
  if (!keys.length) throw new SalonError(400, 'Nothing to update');
  if (f.code && (await pool.query(`SELECT 1 FROM salon_offers WHERE business_id = $1 AND upper(code) = $2 AND offer_id <> $3`, [req.tenant.businessId, f.code, before.offer_id])).rows.length) throw new SalonError(409, 'You already have an offer with that code');
  const after = (await pool.query(`UPDATE salon_offers SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE offer_id = $1 AND business_id = $2 RETURNING *`, [before.offer_id, req.tenant.businessId, ...keys.map((k) => f[k])])).rows[0];
  audit(req, 'salon.offer_changed', 'offer', before.offer_id, null, null, { changes: diff(offerOut(before), offerOut(after)) });
  ok(res, offerOut(after));
};

export default wrapAll({
  listPlans, createPlan, updatePlan, listMemberships, membershipUsage, cancelMembership,
  listPackages, createPackage, updatePackage, listClientPackages, adjustClientPackage,
  listCards, lookupCard, issueComplimentary, adjustCard, cancelCard,
  listOffers, createOffer, updateOffer
});
