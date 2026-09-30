/*
 * Salon settings: defaults, validation and the lookups other salon modules use.
 *
 * Nothing the owner might reasonably want different is fixed in code: the values below are only what a
 * brand-new salon starts with, every one is editable in Salon settings, and every rule that reads them
 * (segments, commission base, tax mode, alert windows) reads the stored value.
 */
import { SalonError, bool, clock, int, money, num, oneOf, text } from './common.js';

export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'WALLET'];   // GIFT_CARD and CREDIT are not toggles: they follow the module and the balance
export const SLOT_MINUTES = [5, 10, 15, 20, 30, 60];

/* What the customer segments mean when the owner has not changed them. Amounts are paise. */
export const DEFAULT_SEGMENT_RULES = {
  new_days: 30,                       // a customer whose first visit was within this many days is "new"
  vip_spend_paise: 2000000,           // lifetime spend at or above this ...
  vip_visits: 12,                     // ... or this many visits makes a VIP
  high_spender_paise: 300000,         // average bill at or above this is a "high spender"
  frequent_visits_90d: 4,             // this many visits in 90 days is "frequent"
  inactive_days: [30, 60, 90]         // the "inactive" windows
};

export const DEFAULTS = {
  pan: null, registration_type: null, registration_no: null,
  working_days: [1, 2, 3, 4, 5, 6], open_time: '10:00', close_time: '20:00', slot_minutes: 15,
  min_advance_minutes: 0, max_advance_days: 90, buffer_minutes: 0,
  cancellation_policy: {}, no_show_policy: {},
  tax_inclusive: false, default_service_tax_rate: 0, default_product_tax_rate: 0, default_service_sac: null,
  commission_on_package_use: true, commission_base: 'NET',
  expiry_alert_days: 30, consumption_alert_factor: 2,
  segment_rules: {}, payment_methods: PAYMENT_METHODS, extra: {}
};

const hhmm = (t) => (t ? String(t).slice(0, 5) : t);

/** The stored settings with defaults filled in. Never returns null, so callers need no "not set up yet" branch. */
export const getSettings = async (db, businessId) => {
  const row = (await db.query(`SELECT * FROM salon_settings WHERE business_id = $1`, [businessId])).rows[0] || {};
  const merged = { ...DEFAULTS, ...row };
  return {
    ...merged,
    open_time: hhmm(merged.open_time), close_time: hhmm(merged.close_time),
    default_service_tax_rate: Number(merged.default_service_tax_rate), default_product_tax_rate: Number(merged.default_product_tax_rate),
    consumption_alert_factor: Number(merged.consumption_alert_factor),
    segment_rules: { ...DEFAULT_SEGMENT_RULES, ...(row.segment_rules || {}) }
  };
};

/** Hours for one outlet: its own override where it has one, the business setting otherwise. */
export const branchHours = async (db, businessId, branchId) => {
  const s = await getSettings(db, businessId);
  const o = branchId ? (await db.query(`SELECT * FROM salon_branch_settings WHERE branch_id = $1 AND business_id = $2`, [branchId, businessId])).rows[0] : null;
  return {
    working_days: o?.working_days ?? s.working_days,
    open_time: hhmm(o?.open_time) || s.open_time,
    close_time: hhmm(o?.close_time) || s.close_time,
    slot_minutes: o?.slot_minutes ?? s.slot_minutes
  };
};

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const policy = (value, field, allowed) => {
  if (value == null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new SalonError(400, `${field} must be an object`);
  const out = {};
  for (const key of allowed) {
    if (!(key in value)) continue;
    if (key === 'text') out.text = text(value.text, `${field} text`, { max: 300 });
    else if (key === 'min_notice_hours') out.min_notice_hours = int(value[key], `${field}: notice hours`, { min: 0, max: 720 });
    else out[key] = num(value[key], `${field}: fee %`, { min: 0, max: 100 });
  }
  return out;
};

/**
 * Validate a settings update. Returns the columns to write (only those that were sent). Amount fields arrive
 * in rupees and are stored in paise.
 */
export const cleanSettings = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SalonError(400, 'Send the settings to change');
  const out = {};

  if ('pan' in body) {
    const v = text(body.pan, 'PAN', { max: 10 });
    if (v && !PAN.test(v.toUpperCase())) throw new SalonError(400, 'Enter a valid 10-character PAN, like ABCDE1234F');
    out.pan = v ? v.toUpperCase() : null;
  }
  if ('registration_type' in body) out.registration_type = text(body.registration_type, 'Registration type', { max: 40 });
  if ('registration_no' in body) out.registration_no = text(body.registration_no, 'Registration number', { max: 60 });

  if ('working_days' in body) {
    const days = Array.isArray(body.working_days) ? [...new Set(body.working_days.map(Number))].sort() : null;
    if (!days || !days.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw new SalonError(400, 'Choose the days you are open (1 = Monday to 7 = Sunday)');
    out.working_days = JSON.stringify(days);
  }
  if ('open_time' in body) out.open_time = clock(body.open_time, 'Opening time', { required: true });
  if ('close_time' in body) out.close_time = clock(body.close_time, 'Closing time', { required: true });
  if (out.open_time && out.close_time && out.open_time >= out.close_time) throw new SalonError(400, 'Closing time must be after opening time');
  if ('slot_minutes' in body) {
    const n = int(body.slot_minutes, 'Slot length', { required: true });
    if (!SLOT_MINUTES.includes(n)) throw new SalonError(400, `Slot length must be one of ${SLOT_MINUTES.join(', ')} minutes`);
    out.slot_minutes = n;
  }
  if ('min_advance_minutes' in body) out.min_advance_minutes = int(body.min_advance_minutes, 'Minimum notice', { min: 0, max: 10080, required: true });
  if ('max_advance_days' in body) out.max_advance_days = int(body.max_advance_days, 'Booking window', { min: 1, max: 730, required: true });
  if ('buffer_minutes' in body) out.buffer_minutes = int(body.buffer_minutes, 'Buffer', { min: 0, max: 120, required: true });
  if ('cancellation_policy' in body) out.cancellation_policy = JSON.stringify(policy(body.cancellation_policy, 'Cancellation policy', ['min_notice_hours', 'fee_pct', 'text']));
  if ('no_show_policy' in body) out.no_show_policy = JSON.stringify(policy(body.no_show_policy, 'No-show policy', ['fee_pct', 'text']));

  if ('tax_inclusive' in body) out.tax_inclusive = bool(body.tax_inclusive);
  if ('default_service_tax_rate' in body) out.default_service_tax_rate = num(body.default_service_tax_rate, 'Service tax rate', { min: 0, max: 100, required: true });
  if ('default_product_tax_rate' in body) out.default_product_tax_rate = num(body.default_product_tax_rate, 'Product tax rate', { min: 0, max: 100, required: true });
  if ('default_service_sac' in body) out.default_service_sac = text(body.default_service_sac, 'SAC code', { max: 16 });

  if ('commission_on_package_use' in body) out.commission_on_package_use = bool(body.commission_on_package_use);
  if ('commission_base' in body) out.commission_base = oneOf(body.commission_base, 'Commission base', ['NET', 'GROSS'], { required: true });

  if ('expiry_alert_days' in body) out.expiry_alert_days = int(body.expiry_alert_days, 'Expiry alert window', { min: 1, max: 365, required: true });
  if ('consumption_alert_factor' in body) out.consumption_alert_factor = num(body.consumption_alert_factor, 'Consumption alert factor', { min: 1.2, max: 20, required: true });

  if ('segment_rules' in body) {
    const r = body.segment_rules;
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new SalonError(400, 'Segment rules must be an object');
    const rules = {};
    if ('new_days' in r) rules.new_days = int(r.new_days, 'New-customer days', { min: 1, max: 365, required: true });
    if ('vip_spend' in r) rules.vip_spend_paise = money(r.vip_spend, 'VIP spend', { required: true });
    if ('vip_visits' in r) rules.vip_visits = int(r.vip_visits, 'VIP visits', { min: 1, max: 1000, required: true });
    if ('high_spender' in r) rules.high_spender_paise = money(r.high_spender, 'High-spender bill', { required: true });
    if ('frequent_visits_90d' in r) rules.frequent_visits_90d = int(r.frequent_visits_90d, 'Frequent visits', { min: 2, max: 90, required: true });
    if ('inactive_days' in r) {
      const d = Array.isArray(r.inactive_days) ? [...new Set(r.inactive_days.map(Number))].sort((a, b) => a - b) : null;
      if (!d || d.length < 1 || d.length > 3 || d.some((n) => !Number.isInteger(n) || n < 7 || n > 730)) throw new SalonError(400, 'Choose up to three inactive windows, in days (7 to 730)');
      rules.inactive_days = d;
    }
    out.segment_rules = JSON.stringify(rules);
  }

  if ('payment_methods' in body) {
    const m = Array.isArray(body.payment_methods) ? [...new Set(body.payment_methods.map((x) => String(x).toUpperCase()))] : null;
    if (!m || !m.length || m.some((x) => !PAYMENT_METHODS.includes(x))) throw new SalonError(400, `Choose payment methods from: ${PAYMENT_METHODS.join(', ')}`);
    out.payment_methods = JSON.stringify(m);
  }
  return out;
};

/** Stored segment rules (paise) -> the shape the API shows (rupees). */
export const segmentRulesForApi = (rules) => ({
  new_days: rules.new_days, vip_spend: rules.vip_spend_paise / 100, vip_visits: rules.vip_visits,
  high_spender: rules.high_spender_paise / 100, frequent_visits_90d: rules.frequent_visits_90d, inactive_days: rules.inactive_days
});

/** Write the validated columns, merging segment rules into what is stored rather than replacing them. */
export const saveSettings = async (db, businessId, columns) => {
  const cols = { ...columns };
  if (cols.segment_rules) {
    const current = (await db.query(`SELECT segment_rules FROM salon_settings WHERE business_id = $1`, [businessId])).rows[0]?.segment_rules || {};
    cols.segment_rules = JSON.stringify({ ...current, ...JSON.parse(cols.segment_rules) });
  }
  const keys = Object.keys(cols);
  if (!keys.length) return;
  const values = keys.map((k) => cols[k]);
  await db.query(
    `INSERT INTO salon_settings (business_id, ${keys.join(', ')}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (business_id) DO UPDATE SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = CURRENT_TIMESTAMP`,
    [businessId, ...values]
  );
};
