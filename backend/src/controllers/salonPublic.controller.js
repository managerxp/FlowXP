/*
 * Online booking for clients — the salon's public page. No session: the salon is identified by the address (slug)
 * its owner chose in Salon settings, and nothing is available until they switch it on.
 *
 * It does not reimplement booking. Availability and the booking itself are the staff screens' own handlers
 * (salonAppointments.controller.js), called for the salon's outlet as an ordinary front-desk user without a login,
 * so every rule — opening hours, who does what, leave, buffers, notice, and never double-booking a person — is
 * the same. What this adds is the public edge: what may be shown, spam limits, and a reply that reveals nothing
 * about anyone but the person booking.
 */
import pool from '../config/database.js';
import { toRupees } from '../utils/money.js';
import { effectiveFeatureFlags, hasPlanFeature } from '../modules/planFeatures.js';
import { getSettings } from '../modules/salon/settings.js';
import { SalonError, isoDate, phone as cleanPhone, text } from '../modules/salon/common.js';
import appointments from './salonAppointments.controller.js';

const fail = (res, status, message) => res.status(status).json({ success: false, message });

const resolve = async (slug) => {
  const { rows } = await pool.query(
    `SELECT b.business_id, b.name, b.status, b.timezone, b.business_type, b.phone, b.address, b.city, b.receipt_settings->>'logo_url' AS logo_url,
            s.online_booking_enabled, s.online_booking_notice,
            COALESCE(p.feature_flags, '{}'::jsonb) AS plan_feature_flags, btf.feature_flags AS type_feature_flags,
            COALESCE(bfo.overrides, '{}'::jsonb) AS feature_overrides
     FROM salon_settings s JOIN businesses b ON b.business_id = s.business_id
     LEFT JOIN plans p ON p.plan_code = b.plan_code
     LEFT JOIN business_type_features btf ON btf.business_type = b.business_type AND btf.plan_code = b.plan_code
     LEFT JOIN LATERAL (SELECT jsonb_object_agg(feature_key, enabled) AS overrides FROM business_feature_overrides
                        WHERE business_id = b.business_id AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)) bfo ON true
     WHERE lower(s.online_booking_slug) = lower($1)`, [String(slug || '').slice(0, 40)]);
  const row = rows[0];
  if (!row || !row.online_booking_enabled || row.status !== 'ACTIVE' || row.business_type !== 'SALON') return null;
  const flags = effectiveFeatureFlags([row.plan_feature_flags, row.type_feature_flags], row.feature_overrides);
  if (!hasPlanFeature({ planFeatures: flags }, 'salon_appointments')) return null;
  return { ...row, flags };
};

const outletFor = async (businessId, wanted) => {
  const { rows } = await pool.query(
    `SELECT branch_id, name, city FROM branches WHERE business_id = $1 AND status = 'ACTIVE' ORDER BY is_primary DESC, branch_id`, [businessId]);
  const chosen = wanted ? rows.find((r) => r.branch_id === Number(wanted)) : rows[0];
  return { outlets: rows, outlet: chosen || null };
};

/* The staff handlers expect a signed-in front-desk user; this is the same shape, without a person. */
const asFrontDesk = (biz, outlet, extra) => ({
  tenant: { businessId: biz.business_id, branchId: outlet.branch_id, scopeBranchId: outlet.branch_id, role: 'RECEPTIONIST', permissions: {}, planFeatures: biz.flags, businessType: 'SALON', pinned: false, viewAll: false },
  auth: { userId: null, user: { name: 'Online booking' } }, params: {}, body: {}, query: {}, headers: {}, ip: '', get: () => undefined, ...extra
});

const capture = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

const guard = async (req, res) => {
  const biz = await resolve(req.params.slug);
  if (!biz) { fail(res, 404, 'Online booking is not available here'); return null; }
  const { outlets, outlet } = await outletFor(biz.business_id, req.query.branch_id ?? req.body?.branch_id);
  if (!outlet) { fail(res, 404, 'That outlet is not available'); return null; }
  return { biz, outlets, outlet };
};

/* GET /api/public/salon/:slug — what the page shows */
export const info = async (req, res) => {
  const g = await guard(req, res); if (!g) return;
  const { biz, outlets, outlet } = g;
  const settings = await getSettings(pool, biz.business_id);
  const services = (await pool.query(
    `SELECT p.product_id, p.name, p.description, c.name AS category, COALESCE(pbs.price_paise, p.selling_price_paise) AS price_paise, COALESCE(d.duration_min, 30) AS duration_min,
            COALESCE(d.gender, 'ANY') AS gender
     FROM products p LEFT JOIN salon_item_details d ON d.product_id = p.product_id LEFT JOIN categories c ON c.category_id = p.category_id
     LEFT JOIN product_branch_settings pbs ON pbs.product_id = p.product_id AND pbs.branch_id = $2
     WHERE p.business_id = $1 AND p.kind = 'SERVICE' AND p.status = 'ACTIVE' AND COALESCE(pbs.is_available, TRUE) ORDER BY c.name NULLS LAST, p.name`, [biz.business_id, outlet.branch_id])).rows;
  const staff = (await pool.query(
    `SELECT s.staff_id, s.name, s.staff_role, COALESCE((SELECT json_agg(x.product_id) FROM salon_staff_services x WHERE x.staff_id = s.staff_id), '[]'::json) AS service_ids
     FROM salon_staff s WHERE s.business_id = $1 AND s.branch_id = $2 AND s.status = 'ACTIVE' AND s.is_bookable ORDER BY s.name`, [biz.business_id, outlet.branch_id])).rows;
  res.json({ success: true, data: {
    name: biz.name, logo_url: biz.logo_url, phone: biz.phone, address: [biz.address, biz.city].filter(Boolean).join(', ') || null, notice: biz.online_booking_notice,
    timezone: biz.timezone || 'Asia/Kolkata', max_advance_days: settings.max_advance_days, cancellation_policy: settings.cancellation_policy?.text || null,
    outlets: outlets.map((o) => ({ branch_id: o.branch_id, name: o.name, city: o.city })), outlet_id: outlet.branch_id,
    services: services.map((s) => ({ service_id: s.product_id, name: s.name, description: s.description, category: s.category, price: toRupees(s.price_paise), duration_min: s.duration_min, gender: s.gender })),
    staff: staff.map((s) => ({ staff_id: s.staff_id, name: s.name, role: s.staff_role, service_ids: s.service_ids }))
  } });
};

/* GET /api/public/salon/:slug/availability?date=&service_ids=1,2&staff_id=&branch_id= */
export const availability = async (req, res) => {
  const g = await guard(req, res); if (!g) return;
  const out = capture();
  await appointments.availability(asFrontDesk(g.biz, g.outlet, { query: { date: req.query.date, service_ids: req.query.service_ids, staff_id: req.query.staff_id } }), out);
  res.status(out.code).json(out.body);
};

const MAX_OPEN_PER_PHONE = 3;

/* POST /api/public/salon/:slug/appointments { name, phone, start_at, services: [{ service_id, staff_id? }], notes?, branch_id? } */
export const book = async (req, res) => {
  const g = await guard(req, res); if (!g) return;
  const b = req.body || {};
  if (b.website) return res.status(201).json({ success: true, data: { received: true } });   // a hidden field only a bot fills in
  let name; let ph;
  try {
    name = text(b.name, 'Your name', { max: 120, min: 2, required: true });
    ph = cleanPhone(b.phone, 'Mobile number');
    if (!ph) throw new SalonError(400, 'Enter your mobile number');
    if (String(ph).replace(/\D/g, '').length < 10) throw new SalonError(400, 'Enter a 10-digit mobile number');
    isoDate(String(b.start_at || '').slice(0, 10), 'Date', { required: true });
  } catch (error) { if (error.name === 'SalonError') return fail(res, error.status, error.message); throw error; }

  const last10 = String(ph).replace(/\D/g, '').slice(-10);
  const open = Number((await pool.query(
    `SELECT COUNT(*) AS n FROM salon_appointments a LEFT JOIN customers c ON c.customer_id = a.customer_id
     WHERE a.business_id = $1 AND a.source = 'ONLINE' AND a.status IN ('BOOKED','CONFIRMED') AND a.start_at > now()
       AND RIGHT(regexp_replace(COALESCE(a.guest_phone, c.phone, ''), '\\D', '', 'g'), 10) = $2`, [g.biz.business_id, last10])).rows[0].n);
  if (open >= MAX_OPEN_PER_PHONE) return fail(res, 429, `You already have ${open} upcoming online bookings. Please call the salon to add more.`);

  const out = capture();
  await appointments.create(asFrontDesk(g.biz, g.outlet, {
    body: { guest_name: name, guest_phone: ph, start_at: b.start_at, source: 'ONLINE', notes: text(b.notes, 'Notes', { max: 300 }) || undefined,
      services: (Array.isArray(b.services) ? b.services : []).slice(0, 6).map((s) => ({ service_id: s.service_id, ...(s.staff_id ? { staff_id: s.staff_id } : {}) })) }
  }), out);
  if (out.code >= 400) return res.status(out.code).json(out.body);
  const a = out.body.data;
  // only what the person who booked needs: never the name or details of a client the number happened to match
  res.status(201).json({ success: true, data: {
    appointment_id: a.appointment_id, status: a.status, start_at: a.start_at, end_at: a.end_at, total: a.total,
    services: a.services.map((s) => ({ name: s.name, staff_name: s.staff_name, start_at: s.start_at, duration_min: s.duration_min }))
  } });
};
