/*
 * Salon settings: the parts of a salon's profile that the general business settings do not cover
 * (PAN, registration, opening hours, booking rules, tax mode, commission and alert rules, segments), plus
 * per-outlet overrides. Name, address, GSTIN, logo, invoice prefix and receipt options stay where they
 * already are (PATCH /businesses/current, owner only) — one source of truth for each field.
 */
import pool from '../config/database.js';
import {
  SalonError, audit, clock, diff, int, oneOf, ok, text, wrapAll
} from '../modules/salon/common.js';
import {
  DEFAULT_SEGMENT_RULES, PAYMENT_METHODS, SLOT_MINUTES, cleanSettings, getSettings, saveSettings, segmentRulesForApi
} from '../modules/salon/settings.js';

const present = (s) => ({ ...s, segment_rules: segmentRulesForApi(s.segment_rules) });

/* GET /api/salon/settings */
const get = async (req, res) => {
  const settings = await getSettings(pool, req.tenant.businessId);
  const branches = (await pool.query(
    `SELECT b.branch_id, b.name, b.city, b.state, b.is_primary, b.invoice_prefix,
            o.working_days, o.open_time, o.close_time, o.slot_minutes, COALESCE(o.ownership, 'OWNED') AS ownership, o.franchisee_name
     FROM branches b LEFT JOIN salon_branch_settings o ON o.branch_id = b.branch_id
     WHERE b.business_id = $1 AND b.status = 'ACTIVE' ORDER BY b.is_primary DESC, b.branch_id`,
    [req.tenant.businessId]
  )).rows.map((b) => ({ ...b, open_time: b.open_time?.slice(0, 5) ?? null, close_time: b.close_time?.slice(0, 5) ?? null }));
  ok(res, {
    settings: present(settings), branches,
    choices: { payment_methods: PAYMENT_METHODS, slot_minutes: SLOT_MINUTES, segment_defaults: segmentRulesForApi(DEFAULT_SEGMENT_RULES) }
  });
};

/* PUT /api/salon/settings — only the fields sent are changed */
const update = async (req, res) => {
  const columns = cleanSettings(req.body);
  if (!Object.keys(columns).length) throw new SalonError(400, 'Nothing to update');
  const before = await getSettings(pool, req.tenant.businessId);
  if (columns.online_booking_enabled && !(columns.online_booking_slug ?? before.online_booking_slug)) throw new SalonError(400, 'Choose a booking address first');
  try { await saveSettings(pool, req.tenant.businessId, columns); } catch (error) {
    if (error.code === '23505') throw new SalonError(409, 'That booking address is taken. Try another.');
    throw error;
  }
  const after = await getSettings(pool, req.tenant.businessId);
  audit(req, 'salon.settings_changed', 'salon_settings', req.tenant.businessId, null, null, { changes: diff(before, after) });
  ok(res, present(after));
};

/* PUT /api/salon/branches/:id/settings — hours for one outlet (null clears the override) */
const updateBranch = async (req, res) => {
  const branchId = Number(req.params.id);
  const branch = (await pool.query(`SELECT branch_id FROM branches WHERE branch_id = $1 AND business_id = $2 AND status = 'ACTIVE'`, [branchId, req.tenant.businessId])).rows[0];
  if (!branch) throw new SalonError(404, 'Not found');
  // a pinned user may only touch their own outlet
  if (req.tenant.pinned && req.tenant.branchId !== branchId) throw new SalonError(403, 'You can only change your own outlet');

  const b = req.body || {};
  const cols = {};
  if ('working_days' in b) {
    if (b.working_days === null) cols.working_days = null;
    else {
      const days = Array.isArray(b.working_days) ? [...new Set(b.working_days.map(Number))].sort() : null;
      if (!days?.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw new SalonError(400, 'Choose the days this outlet is open');
      cols.working_days = JSON.stringify(days);
    }
  }
  if ('open_time' in b) cols.open_time = b.open_time === null ? null : clock(b.open_time, 'Opening time', { required: true });
  if ('close_time' in b) cols.close_time = b.close_time === null ? null : clock(b.close_time, 'Closing time', { required: true });
  if (cols.open_time && cols.close_time && cols.open_time >= cols.close_time) throw new SalonError(400, 'Closing time must be after opening time');
  if ('slot_minutes' in b) {
    cols.slot_minutes = b.slot_minutes === null ? null : int(b.slot_minutes, 'Slot length', { required: true });
    if (cols.slot_minutes != null && !SLOT_MINUTES.includes(cols.slot_minutes)) throw new SalonError(400, `Slot length must be one of ${SLOT_MINUTES.join(', ')} minutes`);
  }
  if ('ownership' in b) cols.ownership = oneOf(b.ownership, 'Ownership', ['OWNED', 'FRANCHISE'], { required: true });
  if ('franchisee_name' in b) cols.franchisee_name = text(b.franchisee_name, 'Franchisee name', { max: 120 });
  const keys = Object.keys(cols);
  if (!keys.length) throw new SalonError(400, 'Nothing to update');

  const before = (await pool.query(`SELECT * FROM salon_branch_settings WHERE branch_id = $1`, [branchId])).rows[0] || null;
  await pool.query(
    `INSERT INTO salon_branch_settings (branch_id, business_id, ${keys.join(', ')}) VALUES ($1, $2, ${keys.map((_, i) => `$${i + 3}`).join(', ')})
     ON CONFLICT (branch_id) DO UPDATE SET ${keys.map((k, i) => `${k} = $${i + 3}`).join(', ')}, updated_at = CURRENT_TIMESTAMP`,
    [branchId, req.tenant.businessId, ...keys.map((k) => cols[k])]
  );
  audit(req, 'salon.branch_settings_changed', 'branch', branchId, before && { open_time: before.open_time, close_time: before.close_time, working_days: before.working_days }, cols);
  ok(res, { branch_id: branchId, ...cols });
};

export default wrapAll({ get, update, updateBranch });
