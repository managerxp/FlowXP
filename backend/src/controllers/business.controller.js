/*
 * The business itself: creating additional ones, and the onboarding wizard.
 *
 * Onboarding is a PATCH per step rather than one big form. The brief's target
 * is signup to first invoice in under five minutes, and the way to hit that is
 * to let someone answer three questions, start billing, and fill in the GST
 * details on Thursday. Every field below is therefore optional at the schema
 * level — the wizard asks for them, it does not withhold the product.
 */
import { cleanGstSettings, withGstDefaults } from '../modules/gstOptions.js';
import { cleanInvoicePrint, withDefaults } from '../modules/invoicePrint.js';
import { backupZip } from '../modules/backup.js';
import { RestoreError, restoreInto, unzip } from '../modules/restore.js';
import { businessToday } from '../utils/dates.js';
import pool from '../config/database.js';
import { EXT_BY_MIME, putFile, removeFile } from '../modules/storage.js';
import { looksLikeImage } from '../middleware/upload.js';
import { subscriptionSummary, newTrialWindow } from '../modules/subscription.js';
import { recordAudit, recordEvent } from '../modules/events.js';
import { toRupees } from '../utils/money.js';
import { hasPermission } from '../middleware/auth.js';
import { cleanLocale } from '../utils/locales.js';
import {
  checkBusinessType, checkSignupType, checkEmail, checkGstin, checkName, checkPhone, checkUpiVpa, firstError
} from '../utils/validate.js';

const ONBOARDING_DONE = 10;

/* ==========================================================================
   POST /api/businesses — an additional business for an existing user
   ========================================================================== */
export const createBusiness = async (req, res) => {
  const { name, business_type } = req.body || {};
  const error = firstError([checkName(name, 'Business name'), checkSignupType(business_type)]);
  if (error) return res.status(400).json({ success: false, message: error });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    /* A second business gets its own trial window. That is a deliberate
       product choice, not an oversight: someone opening a second shop is
       evaluating FlowXP for it separately, and billing them from day one for
       a workspace with no data in it is how you lose the expansion. */
    const trial = newTrialWindow();
    const business = (await client.query(
      `INSERT INTO businesses
         (name, business_type, owner_user_id, subscription_status, plan_code,
          trial_started_at, trial_ends_at)
       VALUES ($1,$2,$3,'TRIAL','TRIAL',$4,$5)
       RETURNING *`,
      [
        String(name).trim(),
        String(business_type).toUpperCase(),
        req.auth.userId,
        trial.trial_started_at,
        trial.trial_ends_at
      ]
    )).rows[0];

    await client.query(
      `INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Main',TRUE)`,
      [business.business_id]
    );
    await client.query(
      `INSERT INTO business_users (business_id, user_id, role, status)
       VALUES ($1,$2,'OWNER','ACTIVE')`,
      [business.business_id, req.auth.userId]
    );

    await client.query('COMMIT');

    recordEvent('business_created', {
      userId: req.auth.userId,
      businessId: business.business_id,
      properties: { business_type: business.business_type, additional: true }
    });
    recordAudit(req, {
      business_id: business.business_id,
      action: 'business.created',
      resource_type: 'business',
      resource_id: business.business_id
    });

    res.status(201).json({
      success: true,
      data: {
        business_id: business.business_id,
        name: business.name,
        business_type: business.business_type,
        currency: business.currency,
        onboarding_step: business.onboarding_step,
        role: 'OWNER',
        subscription: subscriptionSummary(business)
      }
    });
  } catch (dbError) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[business] create failed:', dbError.message);
    res.status(500).json({ success: false, message: 'Could not create the business' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   GET /api/businesses/current
   ========================================================================== */
export const getCurrent = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM businesses WHERE business_id = $1`, [req.tenant.businessId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });

    const b = rows[0];
    const branches = (await pool.query(
      `SELECT branch_id, name, address, phone, is_primary
       FROM branches WHERE business_id = $1 AND status = 'ACTIVE' ORDER BY branch_id`,
      [b.business_id]
    )).rows;

    res.json({
      success: true,
      data: {
        business_id: b.business_id,
        name: b.name,
        business_type: b.business_type,
        email: b.email,
        phone: b.phone,
        address: b.address,
        city: b.city,
        state: b.state,
        country: b.country,
        postal_code: b.postal_code,
        gstin: b.gstin,
        gst_enabled: b.gst_enabled,
        upi_vpa: b.upi_vpa,
        currency: b.currency,
        timezone: b.timezone,
        financial_year_start_month: b.financial_year_start_month,
        invoice_prefix: b.invoice_prefix,
        invoice_next_number: b.invoice_next_number,
        round_off_enabled: b.round_off_enabled,
        onboarding_step: b.onboarding_step,
        gst_settings: withGstDefaults(b.gst_settings),
        receipt_settings: { ...RECEIPT_DEFAULTS, ...(b.receipt_settings || {}), invoice_print: withDefaults(b.receipt_settings?.invoice_print) },
        role: req.tenant.role,
        // this person's own permission overrides (not the full role table — the
        // frontend only needs to know its own access, to keep the sidebar and
        // per-role screens honest about what this person can actually do)
        permissions: req.tenant.permissions || {},
        branches,
        subscription: subscriptionSummary(b)
      }
    });
  } catch (error) {
    console.error('[business] read failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load the business' });
  }
};

/* ==========================================================================
   PATCH /api/businesses/current — settings and onboarding steps

   One endpoint for both. The wizard and the settings page are the same edits
   presented differently, and giving them separate routes would mean writing
   the same validation twice and letting the two drift.
   ========================================================================== */

/* An allowlist, not `Object.keys(req.body)`. Without it a caller could PATCH
   subscription_status or owner_user_id and grant themselves a paid plan. */
const EDITABLE = {
  name:                       (v) => checkName(v, 'Business name'),
  business_type:              checkBusinessType,
  email:                      (v) => (v ? checkEmail(v) : null),
  phone:                      checkPhone,
  address:                    () => null,
  city:                       () => null,
  state:                      () => null,
  country:                    () => null,
  postal_code:                () => null,
  gstin:                      checkGstin,
  gst_enabled:                () => null,
  currency:                   () => null,
  default_language:           (v) => (v === null || v === '' || cleanLocale(v) ? null : 'Choose one of the supported languages'),
  timezone:                   () => null,
  financial_year_start_month: (v) =>
    Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 12
      ? null : 'Choose a financial year start month',
  round_off_enabled:          () => null,
  invoice_prefix:             (v) =>
    String(v ?? '').trim().length <= 12 ? null : 'Invoice prefix is too long',
  upi_vpa:                    checkUpiVpa,
  google_review_link:         (v) => (!v || (String(v).trim().length <= 300 && /^https:\/\//.test(String(v).trim()))
    ? null : 'Paste the https:// link from "Share" on your Google Business listing')
};

/* Receipt printing preferences: every key checked, unknown keys dropped. */
export const RECEIPT_DEFAULTS = { paper_width: 80, footer: 'Thank you! Visit again.', show_gstin: true, show_upi_qr: true, show_loyalty: true, show_logo: true, logo_url: null, auto_cut: true, copies: 1, extra_lines: 3 };
export const cleanReceiptSettings = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Receipt settings must be an object' };
  const out = {};
  if ('paper_width' in input) {
    if (![58, 80].includes(Number(input.paper_width))) return { error: 'Paper width must be 58 or 80 mm' };
    out.paper_width = Number(input.paper_width);
  }
  if ('footer' in input) {
    const footer = String(input.footer ?? '').trim();
    if (footer.length > 200) return { error: 'The footer is too long (200 characters at most)' };
    out.footer = footer;
  }
  for (const key of ['show_gstin', 'show_upi_qr', 'show_loyalty', 'show_logo', 'auto_cut']) if (key in input) out[key] = input[key] === true;
  const whole = (key, lo, hi, what) => {
    if (!(key in input)) return null;
    const n = Number(input[key]);
    if (!Number.isInteger(n) || n < lo || n > hi) return `${what} must be a whole number from ${lo} to ${hi}`;
    out[key] = n; return null;
  };
  /* What a tax invoice prints: PAN, bank details and terms. Optional; an empty value clears it. */
  const text = (key, max, what, pattern) => {
    if (!(key in input)) return null;
    const v = String(input[key] ?? '').trim();
    if (v.length > max) return `${what} is too long (${max} characters at most)`;
    if (v && pattern && !pattern.test(v.toUpperCase())) return `${what} is not valid`;
    out[key] = pattern ? v.toUpperCase() : v; return null;
  };
  const badText = text('pan', 10, 'PAN', /^[A-Z]{5}[0-9]{4}[A-Z]$/) || text('bank_name', 80, 'Bank name') || text('bank_account', 24, 'Account number', /^[0-9A-Z -]{4,24}$/)
    || text('bank_ifsc', 11, 'IFSC code', /^[A-Z]{4}0[A-Z0-9]{6}$/) || text('bank_branch', 80, 'Bank branch') || text('accountant_email', 160, 'The accountant email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/) || text('terms', 1000, 'The terms and conditions');
  if (badText) return { error: badText };
  const bad = whole('copies', 1, 5, 'Copies') || whole('extra_lines', 0, 10, 'Blank lines');
  if (bad) return { error: bad };
  if ('invoice_print' in input) {
    const printed = cleanInvoicePrint(input.invoice_print);
    if (printed.error) return { error: printed.error };
    out.invoice_print = printed.settings;
  }
  return { settings: out };
};

export const updateCurrent = async (req, res) => {
  const body = req.body || {};
  const updates = [];
  const values = [];

  if ('receipt_settings' in body) {
    const { settings, error } = cleanReceiptSettings(body.receipt_settings);
    if (error) return res.status(400).json({ success: false, message: error });
    // merged into what is stored, so saving one option never resets the others
    values.push(JSON.stringify(settings));
    updates.push(`receipt_settings = receipt_settings || $${values.length}::jsonb`);
  }

  if ('gst_settings' in body) {
    const { settings, error } = cleanGstSettings(body.gst_settings);
    if (error) return res.status(400).json({ success: false, message: error });
    values.push(JSON.stringify(settings));
    updates.push(`gst_settings = gst_settings || $${values.length}::jsonb`);   // merged, so saving one option never resets the others
  }

  for (const [field, validator] of Object.entries(EDITABLE)) {
    if (!(field in body)) continue;
    const error = validator(body[field]);
    if (error) return res.status(400).json({ success: false, message: error });
    values.push(field === 'gstin' && body[field] ? String(body[field]).trim().toUpperCase() : field === 'default_language' ? cleanLocale(body[field]) : body[field]);
    updates.push(`${field} = $${values.length}`);
  }

  /* Advancing the wizard is a separate concern from editing a field: the
     settings page sends fields with no step, the wizard sends both. Monotonic
     — going back to re-read step 3 must not reopen the wizard. */
  if (body.onboarding_step != null) {
    const step = Number(body.onboarding_step);
    if (!Number.isInteger(step) || step < 0 || step > ONBOARDING_DONE) {
      return res.status(400).json({ success: false, message: 'Invalid onboarding step' });
    }
    values.push(step);
    updates.push(`onboarding_step = GREATEST(onboarding_step, $${values.length})`);
  }

  if (!updates.length) {
    return res.status(400).json({ success: false, message: 'Nothing to update' });
  }

  try {
    values.push(req.tenant.businessId);
    const { rows } = await pool.query(
      `UPDATE businesses SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $${values.length}
       RETURNING *`,
      values
    );

    const b = rows[0];
    recordAudit(req, {
      action: 'business.updated',
      resource_type: 'business',
      resource_id: b.business_id,
      metadata: { fields: Object.keys(body) }
    });
    if (b.onboarding_step >= ONBOARDING_DONE) {
      recordEvent('onboarding_complete', {
        userId: req.auth.userId, businessId: b.business_id
      });
    }

    res.json({
      success: true,
      data: {
        business_id: b.business_id,
        name: b.name,
        business_type: b.business_type,
        gst_enabled: b.gst_enabled,
        currency: b.currency,
        onboarding_step: b.onboarding_step,
        subscription: subscriptionSummary(b)
      }
    });
  } catch (error) {
    console.error('[business] update failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not save your changes' });
  }
};

/* ==========================================================================
   GET /api/businesses/current/subscription
   ========================================================================== */
export const getSubscription = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*, p.name AS plan_name, p.description AS plan_description, p.features,
              -- the PINNED version's price/limits/features, not the plan's current (possibly
              -- since-changed) ones — see migration 0038's grandfathering comment
              COALESCE(pv.price_monthly_paise, p.price_monthly_paise) AS price_monthly_paise,
              COALESCE(pv.price_yearly_paise, p.price_yearly_paise) AS price_yearly_paise,
              COALESCE(pv.limits, p.limits) AS limits,
              COALESCE(pv.feature_flags, p.feature_flags) AS feature_flags,
              btf.feature_flags AS business_type_feature_flags,
              COALESCE(bfo.overrides, '{}'::jsonb) AS feature_overrides
       FROM businesses b
       LEFT JOIN plans p ON p.plan_code = b.plan_code
       LEFT JOIN plan_versions pv ON pv.plan_version_id = b.plan_version_id
       LEFT JOIN business_type_features btf ON btf.business_type = b.business_type AND btf.plan_code = b.plan_code
       LEFT JOIN LATERAL (
         SELECT jsonb_object_agg(feature_key, enabled) AS overrides FROM business_feature_overrides
         WHERE business_id = b.business_id AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       ) bfo ON true
       WHERE b.business_id = $1`,
      [req.tenant.businessId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });

    const b = rows[0];
    const owns = hasPermission(req.tenant, 'settings');   // what the business pays is for whoever runs it, not its waiters
    // A payment link the admin generated for this business, waiting to be paid —
    // custom-priced (Option B), so this is the only place a price appears at all.
    const pending = (await pool.query(
      `SELECT amount_paise, billing_cycle, payment_link_url FROM subscription_orders
       WHERE business_id = $1 AND status = 'PENDING' AND payment_link_url IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
      [req.tenant.businessId]
    )).rows[0];

    res.json({
      success: true,
      data: {
        ...subscriptionSummary(b),
        plan: {
          code: b.plan_code,
          name: b.plan_name,
          description: b.plan_description,
          price_monthly_paise: owns ? b.price_monthly_paise : null,
          price_yearly_paise: owns ? b.price_yearly_paise : null,
          limits: b.limits,
          features: b.features
        },
        pending_payment: pending && owns ? {
          amount: toRupees(pending.amount_paise),
          billing_cycle: pending.billing_cycle,
          payment_link_url: pending.payment_link_url
        } : null
      }
    });
  } catch (error) {
    console.error('[business] subscription read failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load your subscription' });
  }
};

/* POST /api/businesses/current/logo — the picture printed at the top of browser receipts */
export const uploadLogo = async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Choose an image to upload' });
  if (!looksLikeImage(req.file.buffer, req.file.mimetype)) return res.status(400).json({ success: false, message: 'That file is not a valid JPEG, PNG or WebP image' });
  const old = (await pool.query('SELECT receipt_settings FROM businesses WHERE business_id = $1', [req.tenant.businessId])).rows[0]?.receipt_settings?.logo_url;
  let url;
  try {
    url = await putFile({ key: `logos/${req.tenant.businessId}/logo-${Date.now()}${EXT_BY_MIME[req.file.mimetype]}`, buffer: req.file.buffer, contentType: req.file.mimetype });
  } catch (error) {
    console.error('[business] logo upload failed:', error.message);
    return res.status(502).json({ success: false, message: 'Could not save the logo. Try again in a moment.' });
  }
  await pool.query('UPDATE businesses SET receipt_settings = receipt_settings || $1::jsonb, updated_at = CURRENT_TIMESTAMP WHERE business_id = $2', [JSON.stringify({ logo_url: url }), req.tenant.businessId]);
  if (old) removeFile(old, req.tenant.businessId);
  recordAudit(req, { action: 'business.logo_uploaded', resource_type: 'business', resource_id: req.tenant.businessId });
  res.json({ success: true, data: { logo_url: url } });
};

/* DELETE /api/businesses/current/logo */
export const removeLogo = async (req, res) => {
  const old = (await pool.query('SELECT receipt_settings FROM businesses WHERE business_id = $1', [req.tenant.businessId])).rows[0]?.receipt_settings?.logo_url;
  await pool.query("UPDATE businesses SET receipt_settings = receipt_settings - 'logo_url', updated_at = CURRENT_TIMESTAMP WHERE business_id = $1", [req.tenant.businessId]);
  if (old) removeFile(old, req.tenant.businessId);
  res.json({ success: true, data: { logo_url: null } });
};

/* POST /api/businesses/current/restore  (the backup ZIP as the request body; ?confirm=1 to do it, otherwise a preview that changes nothing)
   Adds what the backup has and this business does not, and leaves everything that is here alone (see modules/restore.js). The preview and the real run are the same code; the
   preview rolls back. Owner only. */
export const restoreBackup = async (req, res) => {
  const body = req.body;
  if (!Buffer.isBuffer(body) || !body.length) return res.status(400).json({ success: false, message: 'Choose the backup ZIP file to restore from' });
  const confirm = req.query.confirm === '1' || req.query.confirm === 'true';
  const client = await pool.connect();
  try {
    const files = unzip(body);
    await client.query('BEGIN');
    const report = await restoreInto(client, req.tenant.businessId, files);
    if (confirm) {
      await client.query('COMMIT');
      recordAudit(req, { action: 'business.backup_restored', resource_type: 'business', resource_id: req.tenant.businessId, metadata: { bytes: body.length, source: report.source, totals: report.totals } });
    } else await client.query('ROLLBACK');
    res.json({ success: true, data: { applied: confirm, ...report } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error instanceof RestoreError) return res.status(error.status).json({ success: false, message: error.message });
    throw error;
  } finally { client.release(); }
};

/* GET /api/businesses/current/backup: every record of this business as a ZIP of CSV files (the owner's own copy; see modules/backup.js) */
export const downloadBackup = async (req, res) => {
  const bytes = await backupZip(req.tenant.businessId);
  recordAudit(req, { action: 'business.backup_downloaded', resource_type: 'business', resource_id: req.tenant.businessId, metadata: { bytes: bytes.length } });
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition', `attachment; filename="flowxp-backup-${await businessToday(req.tenant.businessId)}.zip"`);
  res.send(bytes);
};
