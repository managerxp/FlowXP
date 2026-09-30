/*
 * Salon clients (CRM): the list with segments, the till lookup, the full profile and the timeline.
 *
 * A client is a `customers` row — the same record billing, loyalty and messaging already use — plus
 * salon_customer_profiles for what a salon knows (birthday, allergies, preferences, favourite stylist). Client
 * records are shared across a business's outlets on purpose (a membership, a package or points earned in one
 * outlet is usable in another); visits and sales stay per outlet. Every query is scoped to the business.
 *
 * A stylist (only 'appointments') can read a client's profile and notes and add notes, but never sees money.
 */
import pool from '../config/database.js';
import { hasPermission } from '../middleware/auth.js';
import { businessToday } from '../utils/dates.js';
import { getPoints, standing } from '../modules/points.js';
import { normalisePhone } from '../modules/loyalty.js';
import { toRupees } from '../utils/money.js';
import { checkEmail } from '../utils/validate.js';
import {
  SalonError, audit, isoDate, int, like, ok, oneOf, page, paging, phone, text, wrapAll
} from '../modules/salon/common.js';
import { getSettings } from '../modules/salon/settings.js';
import { expiringPoints } from '../modules/salon/loyalty.js';
import { SEGMENTS, labelsFor, parseSegment, segmentCondition } from '../modules/salon/segments.js';

const showMoney = (tenant) => tenant.role !== 'STYLIST' && (hasPermission(tenant, 'billing') || hasPermission(tenant, 'customers') || hasPermission(tenant, 'reports'));

const PHONE10 = `RIGHT(regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g'), 10)`;

const BASE = `
  FROM customers c
  JOIN salon_customer_stats st ON st.customer_id = c.customer_id AND st.business_id = c.business_id
  LEFT JOIN salon_customer_profiles p ON p.customer_id = c.customer_id`;

const row = (r, rules, today, money) => ({
  customer_id: r.customer_id, name: r.name, phone: r.phone, email: r.email,
  gender: r.gender, dob: r.dob, anniversary: r.anniversary, allergies: r.allergies, favorite_staff_id: r.favorite_staff_id,
  visits: Number(r.visits), first_visit: r.first_visit, last_visit: r.last_visit,
  ...(money ? { total_spent: toRupees(r.spend_paise), outstanding: toRupees(r.outstanding_paise) } : {}),
  points: Number(r.points ?? 0),
  membership: r.membership_name || null,
  labels: labelsFor({ ...r, has_membership: Boolean(r.membership_name) }, rules, today),
  marketing_opt_out: Boolean(r.marketing_opt_out), status: r.status
});

const LIST_COLUMNS = `
  c.customer_id, c.name, c.phone, c.email, c.status, c.marketing_opt_out, p.gender, p.dob, p.anniversary, p.allergies, p.favorite_staff_id,
  st.visits, st.spend_paise, st.first_visit, st.last_visit,
  COALESCE((SELECT SUM(i.balance_due_paise) FROM invoices i WHERE i.customer_id = c.customer_id AND i.status = 'ISSUED'), 0) AS outstanding_paise,
  COALESCE((SELECT SUM(l.points) FROM points_ledger l WHERE l.customer_id = c.customer_id AND l.business_id = c.business_id AND l.voided_at IS NULL), 0) AS points,
  (SELECT m.plan_name FROM salon_customer_memberships m WHERE m.customer_id = c.customer_id AND m.status = 'ACTIVE' AND m.expiry_date >= $2::date ORDER BY m.expiry_date DESC LIMIT 1) AS membership_name`;

const SORTS = {
  name: 'c.name', recent: 'st.last_visit DESC NULLS LAST, c.name', spend: 'st.spend_paise DESC, c.name', visits: 'st.visits DESC, c.name',
  newest: 'c.created_at DESC'
};

/* GET /api/salon/clients?q=&segment=&sort=&limit=&offset= — paginated and filtered in the database */
const list = async (req, res) => {
  const pg = paging(req.query, { max: 100, fallback: 25 });
  const today = await businessToday(req.tenant.businessId);
  const settings = await getSettings(pool, req.tenant.businessId);
  const rules = settings.segment_rules;
  const values = [req.tenant.businessId, today];
  const where = [`c.business_id = $1`, `$2::date IS NOT NULL`];
  const status = String(req.query.status || 'ACTIVE').toUpperCase();
  if (status !== 'ALL') { values.push(status === 'ARCHIVED' ? 'ARCHIVED' : 'ACTIVE'); where.push(`c.status = $${values.length}`); }
  if (req.query.q) {
    const q = String(req.query.q).slice(0, 80).trim();
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 4) { values.push(`%${digits}%`); where.push(`(regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') LIKE $${values.length} OR c.name ILIKE $${values.length + 1})`); values.push(like(q)); }
    else { values.push(like(q)); where.push(`c.name ILIKE $${values.length}`); }
  }
  if (req.query.segment) {
    const seg = parseSegment(req.query.segment, rules);
    if (!seg) throw new SalonError(400, 'Unknown segment');
    where.push(segmentCondition(seg, rules, today, values));
  }
  if (req.query.branch_id) { values.push(Number(req.query.branch_id) || 0); where.push(`p.home_branch_id = $${values.length}`); }
  if (req.query.birthday_month) { values.push(int(req.query.birthday_month, 'Month', { min: 1, max: 12 })); where.push(`EXTRACT(MONTH FROM p.dob) = $${values.length}`); }
  const order = SORTS[String(req.query.sort || 'name')] || SORTS.name;

  const total = Number((await pool.query(`SELECT COUNT(*) AS n ${BASE} WHERE ${where.join(' AND ')}`, values)).rows[0].n);
  values.push(pg.limit, pg.offset);
  const { rows } = await pool.query(`SELECT ${LIST_COLUMNS} ${BASE} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
  page(res, rows.map((r) => row(r, rules, today, showMoney(req.tenant))), total, pg);
};

/* GET /api/salon/clients/segments — how many clients are in each segment */
const segments = async (req, res) => {
  const today = await businessToday(req.tenant.businessId);
  const rules = (await getSettings(pool, req.tenant.businessId)).segment_rules;
  const defs = [...Object.keys(SEGMENTS).filter((k) => k !== 'INACTIVE').map((k) => ({ key: k, seg: { key: k } })),
    ...rules.inactive_days.map((d) => ({ key: `INACTIVE_${d}`, seg: { key: 'INACTIVE', days: d } }))];
  const out = [];
  for (const d of defs) {
    const values = [req.tenant.businessId];
    const cond = segmentCondition(d.seg, rules, today, values);
    const n = Number((await pool.query(`SELECT COUNT(*) AS n FROM customers c JOIN salon_customer_stats st ON st.customer_id = c.customer_id WHERE c.business_id = $1 AND c.status = 'ACTIVE' AND ${cond}`, values)).rows[0].n);
    out.push({ key: d.key, label: d.seg.days ? `Inactive ${d.seg.days}+ days` : SEGMENTS[d.key], count: n });
  }
  const all = Number((await pool.query(`SELECT COUNT(*) AS n FROM customers WHERE business_id = $1 AND status = 'ACTIVE'`, [req.tenant.businessId])).rows[0].n);
  ok(res, { total: all, segments: out });
};

/* GET /api/salon/clients/lookup?q= — a handful of matches for the till, fast: phone digits or the start of a name */
const lookup = async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  if (q.length < 2) return ok(res, []);
  const today = await businessToday(req.tenant.businessId);
  const digits = q.replace(/\D/g, '');
  const values = [req.tenant.businessId, today];
  let cond;
  if (digits.length >= 3 && digits.length === q.replace(/[\s+-]/g, '').length) { values.push(`%${digits}`); cond = `regexp_replace(COALESCE(c.phone, ''), '\\D', '', 'g') LIKE $3`; }
  else { values.push(like(q)); cond = `c.name ILIKE $3`; }
  const { rows } = await pool.query(
    `SELECT c.customer_id, c.name, c.phone, p.allergies, p.favorite_staff_id, st.visits, st.last_visit,
            COALESCE((SELECT SUM(l.points) FROM points_ledger l WHERE l.customer_id = c.customer_id AND l.voided_at IS NULL), 0) AS points,
            (SELECT m.plan_name FROM salon_customer_memberships m WHERE m.customer_id = c.customer_id AND m.status = 'ACTIVE' AND m.expiry_date >= $2::date ORDER BY m.expiry_date DESC LIMIT 1) AS membership
     ${BASE} WHERE c.business_id = $1 AND c.status = 'ACTIVE' AND ${cond} ORDER BY st.last_visit DESC NULLS LAST, c.name LIMIT 12`, values);
  ok(res, rows.map((r) => ({ customer_id: r.customer_id, name: r.name, phone: r.phone, allergies: r.allergies, favorite_staff_id: r.favorite_staff_id, visits: Number(r.visits), last_visit: r.last_visit, points: Number(r.points), membership: r.membership })));
};

const notesOf = async (customerId, businessId, limit = 30) => (await pool.query(
  `SELECT n.note_id, n.body, n.created_at, u.name AS author FROM salon_customer_notes n LEFT JOIN users u ON u.user_id = n.author_user_id
   WHERE n.customer_id = $1 AND n.business_id = $2 ORDER BY n.created_at DESC LIMIT $3`, [customerId, businessId, limit])).rows;

/* GET /api/salon/clients/:id */
const view = async (req, id) => {
  const today = await businessToday(req.tenant.businessId);
  const settings = await getSettings(pool, req.tenant.businessId);
  const money = showMoney(req.tenant);
  const r = (await pool.query(
    `SELECT ${LIST_COLUMNS}, c.address, c.state, c.gstin, c.created_at, p.preferences, p.home_branch_id, fs.name AS favorite_staff_name
     ${BASE} LEFT JOIN salon_staff fs ON fs.staff_id = p.favorite_staff_id WHERE c.business_id = $1 AND c.customer_id = $3`, [req.tenant.businessId, today, id])).rows[0];
  if (!r) throw new SalonError(404, 'Not found');
  const base = row(r, settings.segment_rules, today, money);

  const memberships = (await pool.query(
    `SELECT membership_id, plan_name, start_date, expiry_date, status, benefits FROM salon_customer_memberships WHERE customer_id = $1 ORDER BY expiry_date DESC LIMIT 10`, [r.customer_id])).rows
    .map((m) => ({ ...m, active: m.status === 'ACTIVE' && String(m.expiry_date).slice(0, 10) >= today }));
  const packages = (await pool.query(
    `SELECT cp.cp_id, cp.name, cp.expiry_date, cp.status,
            (SELECT json_agg(json_build_object('service_id', i.service_id, 'name', p.name, 'total', i.qty_total, 'used', i.qty_used, 'remaining', i.qty_total - i.qty_used) ORDER BY p.name)
             FROM salon_customer_package_items i JOIN products p ON p.product_id = i.service_id WHERE i.cp_id = cp.cp_id) AS items
     FROM salon_customer_packages cp WHERE cp.customer_id = $1 AND cp.status <> 'CANCELLED' ORDER BY cp.expiry_date DESC LIMIT 20`, [r.customer_id])).rows
    .map((p) => ({ ...p, active: p.status === 'ACTIVE' && String(p.expiry_date).slice(0, 10) >= today }));
  const giftCards = money ? (await pool.query(
    `SELECT card_id, code, balance_paise, initial_paise, expires_on, status FROM salon_gift_cards WHERE customer_id = $1 AND business_id = $2 ORDER BY card_id DESC LIMIT 10`, [r.customer_id, req.tenant.businessId])).rows
    .map((g) => ({ card_id: g.card_id, code: g.code, balance: toRupees(g.balance_paise), initial: toRupees(g.initial_paise), expires_on: g.expires_on, status: g.status })) : [];

  let loyalty = null;
  const cfg = await getPoints(pool, req.tenant.businessId);
  if (cfg) {
    const st = await standing(pool, req.tenant.businessId, r.customer_id, cfg);
    const agg = (await pool.query(
      `SELECT COALESCE(SUM(points) FILTER (WHERE kind = 'EARN'), 0)::int AS earned, COALESCE(-SUM(points) FILTER (WHERE kind = 'REDEEM'), 0)::int AS redeemed,
              COALESCE(-SUM(points) FILTER (WHERE kind = 'EXPIRE'), 0)::int AS expired
       FROM points_ledger WHERE business_id = $1 AND customer_id = $2 AND voided_at IS NULL`, [req.tenant.businessId, r.customer_id])).rows[0];
    let expiring = 0;
    if (cfg.program.expiry_days) {
      expiring = await expiringPoints(pool, req.tenant.businessId, r.customer_id, cfg.program.expiry_days, 30);
    }
    loyalty = { available: st.balance, lifetime: st.lifetime, redeemed: agg.redeemed, expired: agg.expired, expiring_soon: expiring, tier: st.tier?.name ?? null, next_tier: st.next_tier };
  }

  return {
    ...base, address: r.address, state: r.state, gstin: r.gstin, created_at: r.created_at, preferences: r.preferences, home_branch_id: r.home_branch_id,
    favorite_staff_name: r.favorite_staff_name, memberships, packages, gift_cards: giftCards, loyalty, notes: await notesOf(r.customer_id, req.tenant.businessId)
  };
};

const get = async (req, res) => ok(res, await view(req, req.params.id));


/* ── create / update ──────────────────────────────────────────────────────────────────────── */

const profileFields = async (req, body) => {
  const f = {};
  if ('dob' in body) f.dob = isoDate(body.dob, 'Date of birth');
  if ('anniversary' in body) f.anniversary = isoDate(body.anniversary, 'Anniversary');
  if ('gender' in body) f.gender = body.gender ? oneOf(body.gender, 'Gender', ['FEMALE', 'MALE', 'OTHER']) : null;
  if ('preferences' in body) f.preferences = text(body.preferences, 'Preferences', { max: 1000 });
  if ('allergies' in body) f.allergies = text(body.allergies, 'Allergies', { max: 1000 });
  if ('favorite_staff_id' in body) {
    const id = int(body.favorite_staff_id, 'Favourite stylist', { min: 1 });
    if (id != null && !(await pool.query(`SELECT 1 FROM salon_staff WHERE staff_id = $1 AND business_id = $2`, [id, req.tenant.businessId])).rows.length) throw new SalonError(400, 'Choose a stylist from your team');
    f.favorite_staff_id = id;
  }
  if ('home_branch_id' in body) {
    const id = int(body.home_branch_id, 'Home outlet', { min: 1 });
    if (id != null && !(await pool.query(`SELECT 1 FROM branches WHERE branch_id = $1 AND business_id = $2`, [id, req.tenant.businessId])).rows.length) throw new SalonError(400, 'Choose one of your outlets');
    f.home_branch_id = id;
  }
  return f;
};

const coreFields = (body, { partial }) => {
  const f = {};
  if (!partial || 'name' in body) f.name = text(body.name, 'Name', { max: 160, min: 2, required: true });
  if ('phone' in body) f.phone = phone(body.phone);
  if ('email' in body) {
    const e = text(body.email, 'Email', { max: 160 });
    if (e && checkEmail(e)) throw new SalonError(400, 'Enter a valid email address');
    f.email = e ? e.toLowerCase() : null;
  }
  if ('address' in body) f.address = text(body.address, 'Address', { max: 500 });
  if ('marketing_opt_out' in body) f.marketing_opt_out = body.marketing_opt_out === true;
  return f;
};

/* A salon finds clients by mobile number, so a second client with the same number is refused (with who has it). */
const assertPhoneFree = async (db, businessId, phoneValue, exceptId = null) => {
  const n = normalisePhone(phoneValue);
  if (!n) return;
  const dup = (await db.query(
    `SELECT customer_id, name FROM customers c WHERE business_id = $1 AND status = 'ACTIVE' AND ${PHONE10} = $2 AND ($3::int IS NULL OR customer_id <> $3) LIMIT 1`,
    [businessId, n, exceptId])).rows[0];
  if (dup) { const e = new SalonError(409, `${dup.name} already has that mobile number`); e.existing_customer_id = dup.customer_id; throw e; }
};

const upsertProfile = async (db, businessId, id, f) => {
  const keys = Object.keys(f);
  if (!keys.length) return;
  await db.query(
    `INSERT INTO salon_customer_profiles (customer_id, business_id, ${keys.join(', ')}) VALUES ($1,$2,${keys.map((_, i) => `$${i + 3}`).join(',')})
     ON CONFLICT (customer_id) DO UPDATE SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = CURRENT_TIMESTAMP`,
    [id, businessId, ...keys.map((k) => f[k])]);
};

/* POST /api/salon/clients */
const create = async (req, res) => {
  const body = req.body || {};
  const core = coreFields(body, { partial: false });
  const prof = await profileFields(req, body);
  await assertPhoneFree(pool, req.tenant.businessId, core.phone);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const keys = Object.keys(core);
    const id = (await client.query(`INSERT INTO customers (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING customer_id`, [req.tenant.businessId, ...keys.map((k) => core[k])])).rows[0].customer_id;
    await upsertProfile(client, req.tenant.businessId, id, { home_branch_id: req.tenant.branchId, ...prof });
    await client.query('COMMIT');
    audit(req, 'salon.client_created', 'customer', id, null, { name: core.name });
    ok(res, await view(req, id), 201);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

/* PUT /api/salon/clients/:id */
const update = async (req, res) => {
  const body = req.body || {};
  const existing = (await pool.query(`SELECT customer_id, name, phone, email FROM customers WHERE customer_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!existing) throw new SalonError(404, 'Not found');
  const core = coreFields(body, { partial: true });
  const prof = await profileFields(req, body);
  if ('status' in body) core.status = oneOf(body.status, 'Status', ['ACTIVE', 'ARCHIVED'], { required: true });
  if (core.phone) await assertPhoneFree(pool, req.tenant.businessId, core.phone, existing.customer_id);
  if (!Object.keys(core).length && !Object.keys(prof).length) throw new SalonError(400, 'Nothing to update');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const keys = Object.keys(core);
    if (keys.length) await client.query(`UPDATE customers SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')} WHERE customer_id = $1 AND business_id = $2`, [existing.customer_id, req.tenant.businessId, ...keys.map((k) => core[k])]);
    await upsertProfile(client, req.tenant.businessId, existing.customer_id, prof);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  audit(req, 'salon.client_updated', 'customer', existing.customer_id, null, null, { fields: [...Object.keys(core), ...Object.keys(prof)] });
  ok(res, await view(req, existing.customer_id));
};

/* ── notes and timeline ───────────────────────────────────────────────────────────────────── */

/* POST /api/salon/clients/:id/notes { body } — a private note, kept with who wrote it; never edited in place */
const addNote = async (req, res) => {
  const body = text(req.body?.body, 'Note', { max: 2000, required: true });
  const c = (await pool.query(`SELECT customer_id FROM customers WHERE customer_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!c) throw new SalonError(404, 'Not found');
  const n = (await pool.query(`INSERT INTO salon_customer_notes (business_id, customer_id, author_user_id, body) VALUES ($1,$2,$3,$4) RETURNING note_id, body, created_at`, [req.tenant.businessId, c.customer_id, req.auth.userId, body])).rows[0];
  audit(req, 'salon.client_note_added', 'customer', c.customer_id, null, null, { note_id: n.note_id });
  ok(res, { ...n, author: req.auth.user.name }, 201);
};

/* GET /api/salon/clients/:id/timeline?limit=&offset= — everything that happened, newest first */
const timeline = async (req, res) => {
  const pg = paging(req.query, { max: 100, fallback: 30 });
  const c = (await pool.query(`SELECT customer_id FROM customers WHERE customer_id = $1 AND business_id = $2`, [req.params.id, req.tenant.businessId])).rows[0];
  if (!c) throw new SalonError(404, 'Not found');
  const money = showMoney(req.tenant);
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT a.start_at AS at, 'appointment' AS type, a.appointment_id AS ref_id, a.status AS detail, NULL::bigint AS amount,
              (SELECT string_agg(p.name, ', ' ORDER BY l.start_at) FROM salon_appointment_services l JOIN products p ON p.product_id = l.service_id WHERE l.appointment_id = a.appointment_id) AS summary
       FROM salon_appointments a WHERE a.business_id = $1 AND a.customer_id = $2
       UNION ALL
       SELECT i.created_at, 'invoice', i.invoice_id, i.status, i.total_paise,
              i.invoice_number || ' — ' || COALESCE((SELECT string_agg(ii.description, ', ' ORDER BY ii.item_id) FROM invoice_items ii WHERE ii.invoice_id = i.invoice_id), '')
       FROM invoices i WHERE i.business_id = $1 AND i.customer_id = $2
       UNION ALL
       SELECT p.created_at, 'payment', p.payment_id, p.payment_method, p.amount_paise, NULL
       FROM payments p WHERE p.business_id = $1 AND p.customer_id = $2
       UNION ALL
       SELECT l.created_at, 'points', l.entry_id, l.kind, l.points::bigint, l.note
       FROM points_ledger l WHERE l.business_id = $1 AND l.customer_id = $2 AND l.voided_at IS NULL
       UNION ALL
       SELECT m.created_at, 'membership', m.membership_id, m.status, m.price_paise, m.plan_name || ' until ' || m.expiry_date::text
       FROM salon_customer_memberships m WHERE m.business_id = $1 AND m.customer_id = $2
       UNION ALL
       SELECT cp.created_at, 'package', cp.cp_id, cp.status, cp.price_paise, cp.name
       FROM salon_customer_packages cp WHERE cp.business_id = $1 AND cp.customer_id = $2
       UNION ALL
       SELECT n.created_at, 'note', n.note_id, NULL, NULL, n.body
       FROM salon_customer_notes n WHERE n.business_id = $1 AND n.customer_id = $2
     ) t ORDER BY at DESC LIMIT $3 OFFSET $4`,
    [req.tenant.businessId, c.customer_id, pg.limit, pg.offset]);
  ok(res, rows.map((r) => ({
    at: r.at, type: r.type, ref_id: r.ref_id, detail: r.detail, summary: r.summary,
    amount: r.amount == null ? null : (r.type === 'points' ? Number(r.amount) : (money ? toRupees(r.amount) : null))
  })));
};

export default wrapAll({ list, segments, lookup, get, create, update, addNote, timeline });
