/*
 * Online table reservations: the page a restaurant or hotel puts on its website (/reserve/<address>).
 * No sign-in. The business is found by the address its owner chose, and nothing is open until they switch it on.
 *
 * The guest sees every time slot of the day marked free or booked for their party size, picks one, leaves a name and mobile
 * number, and gets a short code. A free slot means a table that seats the party is free for the whole stay; the booking
 * takes the smallest such table, under a lock, so two guests can never get the same table.
 * The owner's settings: opening hours, slot length, how long a guest stays, the largest party, how far ahead, and an
 * optional percentage offer that is shown on the page and kept on every booking made through it.
 */
import crypto from 'node:crypto';
import pool from '../config/database.js';
import { notify } from '../modules/notifications.js';
import { effectiveFeatureFlags, hasPlanFeature } from '../modules/planFeatures.js';
import { findCustomerByPhone, normalisePhone } from '../modules/phone.js';
import { afterReservation } from '../modules/messaging/index.js';

const fail = (res, status, message) => res.status(status).json({ success: false, message });
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NOTICE_MIN = 30;           // a slot starting sooner than this is no longer offered online
const MAX_OPEN_PER_PHONE = 3;

const resolve = async (slug) => {
  const { rows } = await pool.query(
    `SELECT b.business_id, b.name, b.status, b.timezone, b.business_type, b.phone AS business_phone, b.address, b.city, b.receipt_settings->>'logo_url' AS logo_url, s.*,
            COALESCE(p.feature_flags, '{}'::jsonb) AS plan_feature_flags, btf.feature_flags AS type_feature_flags,
            COALESCE(bfo.overrides, '{}'::jsonb) AS feature_overrides
     FROM reservation_settings s JOIN businesses b ON b.business_id = s.business_id
     LEFT JOIN plans p ON p.plan_code = b.plan_code
     LEFT JOIN business_type_features btf ON btf.business_type = b.business_type AND btf.plan_code = b.plan_code
     LEFT JOIN LATERAL (SELECT jsonb_object_agg(feature_key, enabled) AS overrides FROM business_feature_overrides
                        WHERE business_id = b.business_id AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)) bfo ON true
     WHERE lower(s.slug) = lower($1)`, [String(slug || '').slice(0, 40)]);
  const row = rows[0];
  if (!row || !row.enabled || row.status !== 'ACTIVE') return null;
  const flags = effectiveFeatureFlags([row.plan_feature_flags, row.type_feature_flags], row.feature_overrides, row.business_type);
  if (!hasPlanFeature({ planFeatures: flags }, 'reservations')) return null;
  return row;
};

const outletFor = async (businessId, wanted) => {
  const { rows } = await pool.query(`SELECT branch_id, name, city FROM branches WHERE business_id = $1 AND status = 'ACTIVE' ORDER BY is_primary DESC, branch_id`, [businessId]);
  return { outlets: rows, outlet: wanted ? rows.find((r) => r.branch_id === Number(wanted)) : rows[0] };
};

const guard = async (req, res) => {
  const biz = await resolve(req.params.slug);
  if (!biz) { fail(res, 404, 'Online reservations are not available here'); return null; }
  const { outlets, outlet } = await outletFor(biz.business_id, req.query.branch_id ?? req.body?.branch_id);
  if (!outlet) { fail(res, 404, 'That outlet is not available'); return null; }
  return { biz, outlets, outlet };
};

const offerOf = (biz) => (biz.offer_pct ? { pct: Number(biz.offer_pct), text: biz.offer_text || `${Number(biz.offer_pct)}% off when you reserve online` } : null);

/* Every slot of the day with how many tables are free for this party. One query; `at` is the slot start as a real instant. */
const daySlots = async (db, biz, outlet, date, party) => {
  const tz = biz.timezone || 'Asia/Kolkata';
  const toMin = (c) => Number(c.slice(0, 2)) * 60 + Number(c.slice(3, 5));
  const count = Math.max(0, Math.floor((toMin(biz.close_time) - toMin(biz.open_time)) / biz.slot_min));
  return (await db.query(
    `WITH slots AS (
        SELECT (($3::date + $4::time) + g * make_interval(mins => $5::int)) AT TIME ZONE $6 AS at FROM generate_series(0, $7::int) g)
     SELECT to_char(s.at AT TIME ZONE $6, 'HH24:MI') AS time, s.at,
            s.at < now() + make_interval(mins => ${NOTICE_MIN}) AS past,
            (SELECT COUNT(*)::int FROM dining_tables t
              WHERE t.business_id = $1 AND t.branch_id = $2 AND t.status <> 'CLOSED' AND (t.seats IS NULL OR t.seats >= $8)
                AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.table_id = t.table_id AND r.status IN ('BOOKED','SEATED')
                                  AND r.reserved_at < s.at + make_interval(mins => $9::int) AND r.reserved_at + make_interval(mins => r.duration_min) > s.at)
                AND NOT (EXISTS (SELECT 1 FROM orders o WHERE o.table_id = t.table_id AND o.status NOT IN ('BILLED','CANCELLED','MERGED')) AND s.at < now() + interval '60 minutes'))
            - (SELECT COUNT(*)::int FROM reservations r WHERE r.business_id = $1 AND r.branch_id = $2 AND r.table_id IS NULL AND r.status IN ('BOOKED','SEATED')
                 AND r.reserved_at < s.at + make_interval(mins => $9::int) AND r.reserved_at + make_interval(mins => r.duration_min) > s.at) AS free
       FROM slots s ORDER BY s.at`, [biz.business_id, outlet.branch_id, date, biz.open_time, biz.slot_min, tz, count, party, biz.stay_min])).rows
    .map((r) => ({ time: r.time, at: r.at, free: !r.past && r.free > 0, left: Math.max(0, r.free), past: r.past }));
};

const cleanDate = (biz, value) => {
  const date = String(value || '').slice(0, 10);
  if (!DAY.test(date)) return null;
  const tz = biz.timezone || 'Asia/Kolkata';
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
  const last = new Date(Date.now() + biz.max_advance_days * 86400000).toLocaleDateString('en-CA', { timeZone: tz });
  return date >= today && date <= last ? date : null;
};

/* GET /api/public/reserve/:slug */
export const info = async (req, res) => {
  const g = await guard(req, res); if (!g) return;
  const { biz, outlets, outlet } = g;
  const tables = Number((await pool.query(`SELECT COUNT(*) AS n FROM dining_tables WHERE business_id = $1 AND branch_id = $2 AND status <> 'CLOSED'`, [biz.business_id, outlet.branch_id])).rows[0].n);
  res.json({ success: true, data: {
    name: biz.name, logo_url: biz.logo_url, phone: biz.business_phone, address: [biz.address, biz.city].filter(Boolean).join(', ') || null, notice: biz.notice,
    timezone: biz.timezone || 'Asia/Kolkata', open_time: biz.open_time, close_time: biz.close_time, stay_min: biz.stay_min, max_party: biz.max_party, max_advance_days: biz.max_advance_days,
    offer: offerOf(biz), outlets: outlets.map((o) => ({ branch_id: o.branch_id, name: o.name, city: o.city })), outlet_id: outlet.branch_id, has_tables: tables > 0
  } });
};

/* GET /api/public/reserve/:slug/slots?date=YYYY-MM-DD&party=2 */
export const slots = async (req, res) => {
  const g = await guard(req, res); if (!g) return;
  const date = cleanDate(g.biz, req.query.date);
  if (!date) return fail(res, 400, 'Choose a day within the booking window');
  const party = Math.floor(Number(req.query.party) || 0);
  if (party < 1 || party > g.biz.max_party) return fail(res, 400, `We take reservations for 1 to ${g.biz.max_party} people online. Please call for a bigger group.`);
  const all = await daySlots(pool, g.biz, g.outlet, date, party);
  res.json({ success: true, data: { date, party, slots: all.map(({ time, free, left, past }) => ({ time, free, left: Math.min(left, 9), past })) } });
};

const codeOf = () => Array.from(crypto.randomBytes(6), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

/* POST /api/public/reserve/:slug/book { name, phone, party, date, time, notes?, branch_id? } */
export const book = async (req, res) => {
  const g = await guard(req, res); if (!g) return;
  const { biz, outlet } = g;
  const b = req.body || {};
  if (b.website) return res.status(201).json({ success: true, data: { received: true } });   // a hidden field only a bot fills in
  const name = String(b.name ?? '').trim().slice(0, 120);
  if (name.length < 2) return fail(res, 400, 'Enter your name');
  const phone = normalisePhone(b.phone);
  if (!phone) return fail(res, 400, 'Enter a 10-digit mobile number');
  const party = Math.floor(Number(b.party));
  if (!(party >= 1 && party <= biz.max_party)) return fail(res, 400, `We take reservations for 1 to ${biz.max_party} people online. Please call for a bigger group.`);
  const date = cleanDate(biz, b.date);
  if (!date) return fail(res, 400, 'Choose a day within the booking window');
  if (!HHMM.test(String(b.time || ''))) return fail(res, 400, 'Choose a time');

  const last10 = String(phone).replace(/\D/g, '').slice(-10);
  const open = Number((await pool.query(
    `SELECT COUNT(*) AS n FROM reservations WHERE business_id = $1 AND source = 'ONLINE' AND status = 'BOOKED' AND reserved_at > now()
        AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $2`, [biz.business_id, last10])).rows[0].n);
  if (open >= MAX_OPEN_PER_PHONE) return fail(res, 429, `You already have ${open} upcoming online reservations. Please call to add more.`);

  const customer = await findCustomerByPhone(pool, biz.business_id, phone);
  const offer = offerOf(biz);
  const client = await pool.connect();
  let row = null;
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`reserve:${biz.business_id}:${outlet.branch_id}`]);
    const slot = (await daySlots(client, biz, outlet, date, party)).find((s) => s.time === b.time);
    if (!slot) { await client.query('ROLLBACK'); return fail(res, 400, 'That time is not on offer. Choose one from the list.'); }
    if (!slot.free) { await client.query('ROLLBACK'); return fail(res, 409, 'Sorry, that time was just taken. Please choose another.'); }
    const table = (await client.query(
      `SELECT t.table_id FROM dining_tables t
        WHERE t.business_id = $1 AND t.branch_id = $2 AND t.status <> 'CLOSED' AND (t.seats IS NULL OR t.seats >= $3)
          AND NOT EXISTS (SELECT 1 FROM reservations r WHERE r.table_id = t.table_id AND r.status IN ('BOOKED','SEATED')
                            AND r.reserved_at < $4::timestamptz + make_interval(mins => $5::int) AND r.reserved_at + make_interval(mins => r.duration_min) > $4::timestamptz)
        ORDER BY t.seats NULLS LAST, t.table_id LIMIT 1`, [biz.business_id, outlet.branch_id, party, slot.at, biz.stay_min])).rows[0];
    row = (await client.query(
      `INSERT INTO reservations (business_id, branch_id, table_id, customer_id, guest_name, phone, party_size, reserved_at, duration_min, notes, source, offer_pct, offer_text, code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ONLINE',$11,$12,$13) RETURNING *`,
      [biz.business_id, outlet.branch_id, table?.table_id ?? null, customer?.customer_id ?? null, name, phone, party, slot.at, biz.stay_min,
        b.notes ? String(b.notes).slice(0, 300) : null, offer?.pct ?? null, offer?.text ?? null, codeOf()])).rows[0];
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }

  afterReservation(row, 'created');
  notify(biz.business_id, { category: 'bookings', type: 'online_reservation', title: 'New online reservation', body: `${name} · table for ${party} · ${date} ${b.time}`, branchId: outlet.branch_id })
    .catch((e) => console.error('[push] reservation alert failed:', e.message));
  res.status(201).json({ success: true, data: { code: row.code, name, party, date, time: b.time, reserved_at: row.reserved_at, offer, outlet: outlet.name } });
};

/* ── the owner's side: GET / PUT /api/reservations/online-settings ───────────────────────────── */
const DEFAULTS = { enabled: false, slug: null, notice: null, open_time: '12:00', close_time: '22:30', slot_min: 30, stay_min: 90, max_party: 10, max_advance_days: 30, offer_pct: null, offer_text: null };
const present = (r) => ({ ...DEFAULTS, ...(r || {}), offer_pct: r?.offer_pct == null ? null : Number(r.offer_pct) });

export const getSettings = async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM reservation_settings WHERE business_id = $1`, [req.tenant.businessId]);
  res.json({ success: true, data: present(rows[0]) });
};

export const saveSettings = async (req, res) => {
  const b = req.body || {};
  const out = {};
  const int = (v, label, min, max) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number from ${min} to ${max}`); return n; };
  try {
    if ('enabled' in b) out.enabled = b.enabled === true;
    if ('slug' in b) {
      const v = String(b.slug ?? '').trim().toLowerCase();
      if (v && !/^[a-z0-9][a-z0-9-]{2,39}$/.test(v)) throw new Error('The address can use letters, numbers and dashes (3 to 40 characters)');
      out.slug = v || null;
    }
    if ('notice' in b) out.notice = String(b.notice ?? '').trim().slice(0, 300) || null;
    for (const k of ['open_time', 'close_time']) if (k in b) { if (!HHMM.test(String(b[k]))) throw new Error('Enter times like 12:30'); out[k] = b[k]; }
    if ('slot_min' in b) out.slot_min = int(b.slot_min, 'Slot length', 15, 240);
    if ('stay_min' in b) out.stay_min = int(b.stay_min, 'Time at the table', 15, 480);
    if ('max_party' in b) out.max_party = int(b.max_party, 'Largest party', 1, 100);
    if ('max_advance_days' in b) out.max_advance_days = int(b.max_advance_days, 'Days ahead', 1, 365);
    if ('offer_pct' in b) {
      if (b.offer_pct === null || b.offer_pct === '') out.offer_pct = null;
      else { const n = Number(b.offer_pct); if (!(n > 0 && n <= 100)) throw new Error('The offer must be a percentage from 1 to 100'); out.offer_pct = n; }
    }
    if ('offer_text' in b) out.offer_text = String(b.offer_text ?? '').trim().slice(0, 120) || null;
  } catch (error) { return fail(res, 400, error.message); }
  if (!Object.keys(out).length) return fail(res, 400, 'Nothing to update');
  const { rows: before } = await pool.query(`SELECT * FROM reservation_settings WHERE business_id = $1`, [req.tenant.businessId]);
  const next = { ...DEFAULTS, ...(before[0] || {}), ...out };
  if (next.close_time <= next.open_time) return fail(res, 400, 'Closing time must be after opening time');
  if (out.enabled && !next.slug) return fail(res, 400, 'Choose a reservation address first');
  const keys = Object.keys(out);
  try {
    await pool.query(
      `INSERT INTO reservation_settings (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
       ON CONFLICT (business_id) DO UPDATE SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now()`, [req.tenant.businessId, ...keys.map((k) => out[k])]);
  } catch (error) {
    if (error.code === '23505') return fail(res, 409, 'That address is taken. Try another.');
    throw error;
  }
  const { rows } = await pool.query(`SELECT * FROM reservation_settings WHERE business_id = $1`, [req.tenant.businessId]);
  res.json({ success: true, data: present(rows[0]) });
};
