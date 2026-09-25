/*
 * The business itself: creating additional ones, and the onboarding wizard.
 *
 * Onboarding is a PATCH per step rather than one big form. The brief's target
 * is signup to first invoice in under five minutes, and the way to hit that is
 * to let someone answer three questions, start billing, and fill in the GST
 * details on Thursday. Every field below is therefore optional at the schema
 * level — the wizard asks for them, it does not withhold the product.
 */
import pool from '../config/database.js';
import { subscriptionSummary, newTrialWindow } from '../modules/subscription.js';
import { recordAudit, recordEvent } from '../modules/events.js';
import {
  checkBusinessType, checkEmail, checkGstin, checkName, checkPhone, checkUpiVpa, firstError
} from '../utils/validate.js';

const ONBOARDING_DONE = 10;

/* ==========================================================================
   POST /api/businesses — an additional business for an existing user
   ========================================================================== */
export const createBusiness = async (req, res) => {
  const { name, business_type } = req.body || {};
  const error = firstError([checkName(name, 'Business name'), checkBusinessType(business_type)]);
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
        receipt_settings: { ...RECEIPT_DEFAULTS, ...(b.receipt_settings || {}) },
        role: req.tenant.role,
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
  timezone:                   () => null,
  financial_year_start_month: (v) =>
    Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 12
      ? null : 'Choose a financial year start month',
  round_off_enabled:          () => null,
  invoice_prefix:             (v) =>
    String(v ?? '').trim().length <= 12 ? null : 'Invoice prefix is too long',
  upi_vpa:                    checkUpiVpa
};

/* Receipt printing preferences: every key checked, unknown keys dropped. */
export const RECEIPT_DEFAULTS = { paper_width: 80, footer: 'Thank you! Visit again.', show_gstin: true, show_upi_qr: true, show_loyalty: true };
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
  for (const key of ['show_gstin', 'show_upi_qr', 'show_loyalty']) if (key in input) out[key] = input[key] === true;
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

  for (const [field, validator] of Object.entries(EDITABLE)) {
    if (!(field in body)) continue;
    const error = validator(body[field]);
    if (error) return res.status(400).json({ success: false, message: error });
    values.push(field === 'gstin' && body[field] ? String(body[field]).trim().toUpperCase() : body[field]);
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
      `SELECT b.*, p.name AS plan_name, p.description AS plan_description,
              p.price_monthly_paise, p.price_yearly_paise, p.limits, p.features
       FROM businesses b
       LEFT JOIN plans p ON p.plan_code = b.plan_code
       WHERE b.business_id = $1`,
      [req.tenant.businessId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });

    const b = rows[0];
    res.json({
      success: true,
      data: {
        ...subscriptionSummary(b),
        plan: {
          code: b.plan_code,
          name: b.plan_name,
          description: b.plan_description,
          price_monthly_paise: b.price_monthly_paise,
          price_yearly_paise: b.price_yearly_paise,
          limits: b.limits,
          features: b.features
        }
      }
    });
  } catch (error) {
    console.error('[business] subscription read failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load your subscription' });
  }
};
