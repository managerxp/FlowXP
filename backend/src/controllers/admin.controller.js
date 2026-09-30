/*
 * The super admin API — platform-wide, not tenant-scoped.
 *
 * Everything here answers questions a business owner's own token could never
 * ask: how many tenants exist, which ones are on which plan, what the whole
 * platform has billed. requireSuperAdmin (middleware/auth.js) gates every
 * route below the login itself.
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import pool from '../config/database.js';
import { signToken } from '../middleware/auth.js';
import { decryptSecret, lockedMinutes, recordLogin, verifyTotp } from '../modules/security.js';
import { subscriptionSummary } from '../modules/subscription.js';
import { recordAudit } from '../modules/events.js';
import { toRupees, toPaise } from '../utils/money.js';
import { normaliseEmail, BUSINESS_TYPES } from '../utils/validate.js';
import { createPaymentLink as cashfreeCreateLink, CashfreeError } from '../modules/payments/cashfree.js';
import { PLAN_FEATURES, PLAN_FEATURE_KEYS } from '../modules/planFeatures.js';
import config from '../config/env.js';

const BUSINESS_STATUSES = ['ACTIVE', 'SUSPENDED', 'CLOSED'];
const SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED'];

/* ==========================================================================
   POST /api/admin/login
   ========================================================================== */
/* a real hash, so an unknown address takes as long as a wrong password (see auth.controller.js) */
const ADMIN_DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

export const login = async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Enter your email and password' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT user_id, name, email, password_hash, is_super_admin, token_version, totp_enabled, totp_secret_enc, totp_last_step
       FROM users WHERE email = $1`,
      [normaliseEmail(email)]
    );
    const locked = await lockedMinutes(pool, normaliseEmail(email));
    if (locked) {
      await recordLogin(pool, { email: normaliseEmail(email), req, outcome: 'LOCKED' });
      return res.status(429).json({ success: false, message: `Too many failed attempts. Try again in ${locked} minute${locked === 1 ? '' : 's'}.` });
    }

    const user = rows[0];
    // Same constant-time-ish shape as the regular login: a wrong password and
    // a non-admin account must not be distinguishable by response timing.
    const ok = await bcrypt.compare(String(password), user?.password_hash || ADMIN_DUMMY_HASH);

    if (!user || !ok || !user.is_super_admin) {
      await recordLogin(pool, { userId: user?.user_id ?? null, email: normaliseEmail(email), req, outcome: user ? 'BAD_PASSWORD' : 'UNKNOWN_USER' });
      return res.status(401).json({ success: false, message: 'Email or password is incorrect' });
    }

    // the platform operator can protect the console with an authenticator app: the code comes with the password
    if (user.totp_enabled) {
      const step = req.body?.code ? verifyTotp(decryptSecret(user.totp_secret_enc), req.body.code, { lastStep: user.totp_last_step }) : null;
      if (step == null) {
        if (req.body?.code) await recordLogin(pool, { userId: user.user_id, email: user.email, req, outcome: 'TWO_FACTOR_FAILED' });
        return res.status(401).json({ success: false, requires_2fa: true, message: req.body?.code ? 'That code is not right.' : 'Enter the code from your authenticator app.' });
      }
      await pool.query('UPDATE users SET totp_last_step = $2 WHERE user_id = $1', [user.user_id, step]);
    }
    await recordLogin(pool, { userId: user.user_id, email: user.email, req, outcome: 'SUCCESS', method: user.totp_enabled ? '2FA' : 'PASSWORD' });

    pool.query(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = $1`, [user.user_id])
      .catch(() => {});

    res.json({
      success: true,
      data: {
        token: signToken(user),
        admin: { user_id: user.user_id, name: user.name, email: user.email }
      }
    });
  } catch (error) {
    console.error('[admin] login failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not sign you in' });
  }
};

/* ==========================================================================
   GET /api/admin/me
   ========================================================================== */
export const me = async (req, res) => {
  res.json({
    success: true,
    data: { user_id: req.auth.userId, name: req.auth.user.name, email: req.auth.email }
  });
};

/* ==========================================================================
   GET /api/admin/stats — the dashboard overview
   ========================================================================== */
export const getStats = async (_req, res) => {
  try {
    const [businesses, users, trialsSummary, trialsList, platformRevenue, revenueByMonth, pendingSummary, pendingList, invoices, mrr] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active,
          COUNT(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended,
          COUNT(*) FILTER (WHERE subscription_status = 'TRIAL')::int AS on_trial,
          COUNT(*) FILTER (WHERE subscription_status = 'ACTIVE')::int AS paying,
          COUNT(*) FILTER (WHERE subscription_status = 'EXPIRED')::int AS expired
        FROM businesses
      `),
      pool.query(`SELECT COUNT(*)::int AS total FROM users WHERE is_super_admin = FALSE`),
      // True count, never capped by the list's LIMIT below.
      pool.query(`
        SELECT COUNT(*)::int AS n FROM businesses
        WHERE subscription_status = 'TRIAL' AND trial_ends_at > CURRENT_TIMESTAMP
          AND trial_ends_at <= CURRENT_TIMESTAMP + INTERVAL '2 days'
      `),
      // A list, not just a count — an admin looking at this needs to know WHICH businesses to chase.
      pool.query(`
        SELECT business_id, name, trial_ends_at FROM businesses
        WHERE subscription_status = 'TRIAL' AND trial_ends_at > CURRENT_TIMESTAMP
          AND trial_ends_at <= CURRENT_TIMESTAMP + INTERVAL '2 days'
        ORDER BY trial_ends_at LIMIT 10
      `),
      // What FlowXP itself has actually been paid — subscription_orders (Cashfree), not the tenant
      // `payments` table (that's a restaurant's own customers paying the restaurant, a different thing
      // the old version of this query mistakenly summed instead).
      pool.query(`SELECT COALESCE(SUM(amount_paise), 0) AS total_paise, COUNT(*)::int AS n FROM subscription_orders WHERE status = 'PAID'`),
      pool.query(`
        SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month, COALESCE(SUM(amount_paise), 0) AS total_paise
        FROM subscription_orders WHERE status = 'PAID' AND paid_at >= date_trunc('month', CURRENT_TIMESTAMP) - INTERVAL '11 months'
        GROUP BY 1 ORDER BY 1
      `),
      // Payment links sent but not yet paid — true count/total, never capped by the list's LIMIT below.
      pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM(amount_paise), 0) AS total_paise FROM subscription_orders WHERE status = 'PENDING'`),
      // Oldest first — those are the most overdue to chase.
      pool.query(`
        SELECT so.order_id, so.business_id, b.name AS business_name, so.amount_paise, so.billing_cycle, so.created_at
        FROM subscription_orders so JOIN businesses b ON b.business_id = so.business_id
        WHERE so.status = 'PENDING' ORDER BY so.created_at LIMIT 10
      `),
      pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE status = 'ISSUED'`),
      // MRR: every ACTIVE business's pinned plan-version price (see migration 0038), yearly normalised
      // to a monthly figure. A business still on TRIAL contributes nothing — it isn't revenue yet.
      pool.query(`
        SELECT COALESCE(SUM(
          CASE WHEN b.billing_cycle = 'YEARLY' THEN COALESCE(pv.price_yearly_paise, p.price_yearly_paise) / 12.0
               ELSE COALESCE(pv.price_monthly_paise, p.price_monthly_paise) END
        ), 0) AS mrr_paise
        FROM businesses b
        JOIN plans p ON p.plan_code = b.plan_code
        LEFT JOIN plan_versions pv ON pv.plan_version_id = b.plan_version_id
        WHERE b.subscription_status = 'ACTIVE'
      `)
    ]);

    const b = businesses.rows[0];
    res.json({
      success: true,
      data: {
        businesses: {
          total: b.total,
          active: b.active,
          suspended: b.suspended,
          on_trial: b.on_trial,
          paying: b.paying,
          expired: b.expired,
          trials_ending_soon: trialsSummary.rows[0].n
        },
        users_total: users.rows[0].total,
        invoices_total: invoices.rows[0].n,
        revenue_collected: toRupees(platformRevenue.rows[0].total_paise),
        payments_collected: platformRevenue.rows[0].n,
        mrr: toRupees(mrr.rows[0].mrr_paise),
        revenue_by_month: revenueByMonth.rows.map((r) => ({ month: r.month, amount: toRupees(r.total_paise) })),
        trials_ending_soon_list: trialsList.rows.map((t) => ({ business_id: t.business_id, name: t.name, trial_ends_at: t.trial_ends_at })),
        pending_payments: {
          count: pendingSummary.rows[0].n,
          total_amount: toRupees(pendingSummary.rows[0].total_paise),
          list: pendingList.rows.map((r) => ({
            order_id: r.order_id, business_id: r.business_id, business_name: r.business_name,
            amount: toRupees(r.amount_paise), billing_cycle: r.billing_cycle, created_at: r.created_at
          }))
        }
      }
    });
  } catch (error) {
    console.error('[admin] stats failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load platform stats' });
  }
};

/* ==========================================================================
   GET /api/admin/businesses — every tenant, searchable
   ========================================================================== */
export const listBusinesses = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(req.query.page_size) || 25));
    const search = String(req.query.search || '').trim();
    const status = String(req.query.status || '').trim().toUpperCase();

    const where = [];
    const params = [];

    if (search) {
      params.push(`%${search}%`);
      where.push(`(b.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.name ILIKE $${params.length})`);
    }
    if (status && BUSINESS_STATUSES.includes(status)) {
      params.push(status);
      where.push(`b.status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS n
       FROM businesses b JOIN users u ON u.user_id = b.owner_user_id
       ${whereSql}`,
      params
    );

    params.push(pageSize, (page - 1) * pageSize);
    const { rows } = await pool.query(
      `SELECT b.business_id, b.name, b.business_type, b.status, b.subscription_status,
              b.plan_code, b.billing_cycle, b.trial_ends_at, b.next_billing_date,
              b.currency, b.created_at,
              u.user_id AS owner_user_id, u.name AS owner_name, u.email AS owner_email
       FROM businesses b
       JOIN users u ON u.user_id = b.owner_user_id
       ${whereSql}
       ORDER BY b.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({
      success: true,
      data: {
        businesses: rows.map((b) => ({
          business_id: b.business_id,
          name: b.name,
          business_type: b.business_type,
          status: b.status,
          currency: b.currency,
          created_at: b.created_at,
          owner: { user_id: b.owner_user_id, name: b.owner_name, email: b.owner_email },
          subscription: subscriptionSummary(b)
        })),
        page,
        page_size: pageSize,
        total: countResult.rows[0].n
      }
    });
  } catch (error) {
    console.error('[admin] list businesses failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load businesses' });
  }
};

/* ==========================================================================
   GET /api/admin/businesses/:id
   ========================================================================== */
export const getBusiness = async (req, res) => {
  try {
    const businessId = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT b.*, u.name AS owner_name, u.email AS owner_email, u.phone AS owner_phone
       FROM businesses b JOIN users u ON u.user_id = b.owner_user_id
       WHERE b.business_id = $1`,
      [businessId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    const business = rows[0];

    const [members, branches, invoices, revenue] = await Promise.all([
      pool.query(
        `SELECT bu.role, bu.status, u.user_id, u.name, u.email
         FROM business_users bu JOIN users u ON u.user_id = bu.user_id
         WHERE bu.business_id = $1 ORDER BY bu.role`,
        [businessId]
      ),
      pool.query(`SELECT branch_id, name, is_primary, status FROM branches WHERE business_id = $1`, [businessId]),
      pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1 AND status = 'ISSUED'`, [businessId]),
      pool.query(`SELECT COALESCE(SUM(amount_paise), 0) AS total_paise FROM payments WHERE business_id = $1`, [businessId])
    ]);

    res.json({
      success: true,
      data: {
        business_id: business.business_id,
        name: business.name,
        business_type: business.business_type,
        status: business.status,
        plan_code: business.plan_code,
        // the stored column, not subscription.status below (which is the derived, "has the trial
        // actually expired" value) — the admin plan editor needs the real one to edit it correctly
        subscription_status_raw: business.subscription_status,
        email: business.email,
        phone: business.phone,
        address: business.address,
        city: business.city,
        state: business.state,
        country: business.country,
        gstin: business.gstin,
        gst_enabled: business.gst_enabled,
        currency: business.currency,
        created_at: business.created_at,
        owner: { name: business.owner_name, email: business.owner_email, phone: business.owner_phone },
        subscription: subscriptionSummary(business),
        members: members.rows,
        branches: branches.rows,
        counts: { invoices: invoices.rows[0].n },
        revenue_collected: toRupees(revenue.rows[0].total_paise)
      }
    });
  } catch (error) {
    console.error('[admin] get business failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load this business' });
  }
};

/* ==========================================================================
   PATCH /api/admin/businesses/:id/status — suspend / reactivate / close
   ========================================================================== */
export const updateBusinessStatus = async (req, res) => {
  const businessId = Number(req.params.id);
  const status = String(req.body?.status || '').toUpperCase();

  if (!BUSINESS_STATUSES.includes(status)) {
    return res.status(400).json({ success: false, message: 'Status must be ACTIVE, SUSPENDED or CLOSED' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE businesses SET status = $1, updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $2 RETURNING business_id, name, status`,
      [status, businessId]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });

    recordAudit(req, {
      business_id: businessId,
      action: 'admin.business_status_changed',
      resource_type: 'business',
      resource_id: businessId,
      metadata: { status }
    });

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('[admin] update business status failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not update this business' });
  }
};

/* ==========================================================================
   PATCH /api/admin/businesses/:id/plan — assign a plan directly (a comped
   account, a sales-negotiated deal set up before Cashfree, or fixing a wrong
   signup) and change what kind of business this is. Separate from the
   Cashfree payment flow, which only ever moves a business to ACTIVE on a real
   payment; this is the manual override for everything else.
   ========================================================================== */
export const updateBusinessPlan = async (req, res) => {
  const businessId = Number(req.params.id);
  const { plan_code: planCode, subscription_status: subscriptionStatus, business_type: businessType } = req.body || {};

  const fields = [];
  const params = [];
  const set = (column, value) => { params.push(value); fields.push(`${column} = $${params.length}`); };

  if (planCode != null) {
    const code = String(planCode).toUpperCase();
    // A plan assignment always pins the CURRENT version — "new to this plan" behaves like a new
    // signup, not like grandfathering into whatever version happened to be live when the row was
    // last touched. Also doubles as the "does this plan exist" check.
    const current = await pool.query(`SELECT plan_version_id FROM plan_versions WHERE plan_code = $1 AND effective_to IS NULL`, [code]);
    if (!current.rows.length) return res.status(400).json({ success: false, message: 'Unknown plan' });
    set('plan_code', code);
    set('plan_version_id', current.rows[0].plan_version_id);
  }
  if (subscriptionStatus != null) {
    if (!SUBSCRIPTION_STATUSES.includes(String(subscriptionStatus).toUpperCase())) {
      return res.status(400).json({ success: false, message: 'Unknown subscription status' });
    }
    set('subscription_status', String(subscriptionStatus).toUpperCase());
  }
  if (businessType != null) {
    if (!BUSINESS_TYPES.includes(String(businessType).toUpperCase())) {
      return res.status(400).json({ success: false, message: 'Unknown business type' });
    }
    set('business_type', String(businessType).toUpperCase());
  }

  if (!fields.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

  try {
    params.push(businessId);
    const { rows } = await pool.query(
      `UPDATE businesses SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $${params.length}
       RETURNING business_id, name, plan_code, subscription_status, business_type`,
      params
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });

    recordAudit(req, {
      business_id: businessId,
      action: 'admin.business_plan_changed',
      resource_type: 'business',
      resource_id: businessId,
      metadata: req.body
    });

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('[admin] update business plan failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not update this business' });
  }
};

/* ==========================================================================
   SUBSCRIPTION HISTORY — reuses audit_log rather than a parallel events
   table: every subscription-relevant admin action already writes there
   (plan changes, plan version cuts, feature overrides, payment links,
   status changes, the Cashfree webhook's activation). This just reads it
   back for one business, chronologically, for the admin UI's History tab.
   ========================================================================== */
const SUBSCRIPTION_ACTIONS = [
  'admin.business_plan_changed', 'admin.business_status_changed', 'admin.plan_version_created',
  'admin.feature_override_set', 'admin.feature_override_removed',
  'admin.payment_link_created', 'subscription.payment_received',
  'admin.addon_link_created', 'subscription.addon_activated'
];

export const businessHistory = async (req, res) => {
  const businessId = Number(req.params.id);
  try {
    const { rows } = await pool.query(
      `SELECT a.audit_id, a.action, a.metadata, a.created_at, u.name AS actor_name
       FROM audit_log a LEFT JOIN users u ON u.user_id = a.user_id
       WHERE a.business_id = $1 AND a.action = ANY($2::text[])
       ORDER BY a.created_at DESC LIMIT 200`,
      [businessId, SUBSCRIPTION_ACTIONS]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('[admin] business history failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load this business’s history' });
  }
};

/* ==========================================================================
   BUSINESS FEATURE OVERRIDES — "Business X stays on Basic but also gets
   Advanced Reports until 31 Dec": a super admin's per-business exception,
   independent of plan or business type. Highest precedence in
   effectiveFeatureFlags() — see modules/planFeatures.js. One row per
   (business, feature); the CURRENT state is what gates access, the history
   of who changed it is the audit_log entry this writes.
   ========================================================================== */
export const listBusinessOverrides = async (req, res) => {
  const businessId = Number(req.params.id);
  try {
    const { rows } = await pool.query(
      `SELECT o.feature_key, o.enabled, o.reason, o.expires_at, o.created_at, u.name AS created_by_name
       FROM business_feature_overrides o LEFT JOIN users u ON u.user_id = o.created_by
       WHERE o.business_id = $1 ORDER BY o.created_at DESC`,
      [businessId]
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    console.error('[admin] list business overrides failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load overrides' });
  }
};

export const setBusinessOverride = async (req, res) => {
  const businessId = Number(req.params.id);
  const { feature_key: featureKey, enabled, reason, expires_at: expiresAt } = req.body || {};

  if (!PLAN_FEATURE_KEYS.includes(featureKey)) return res.status(400).json({ success: false, message: 'Unknown feature' });
  if (typeof enabled !== 'boolean') return res.status(400).json({ success: false, message: 'enabled must be true or false' });
  let expiry = null;
  if (expiresAt != null) {
    expiry = new Date(expiresAt);
    if (Number.isNaN(expiry.getTime())) return res.status(400).json({ success: false, message: 'Invalid expiry date' });
    if (expiry.getTime() <= Date.now()) return res.status(400).json({ success: false, message: 'Expiry must be in the future' });
  }

  try {
    const exists = await pool.query(`SELECT 1 FROM businesses WHERE business_id = $1`, [businessId]);
    if (!exists.rows.length) return res.status(404).json({ success: false, message: 'Not found' });

    const { rows } = await pool.query(
      `INSERT INTO business_feature_overrides (business_id, feature_key, enabled, reason, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (business_id, feature_key) DO UPDATE SET
         enabled = $3, reason = $4, expires_at = $5, created_by = $6, updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [businessId, featureKey, enabled, reason || null, expiry, req.auth?.userId ?? null]
    );

    recordAudit(req, {
      business_id: businessId,
      action: 'admin.feature_override_set',
      resource_type: 'business_feature_override',
      resource_id: featureKey,
      metadata: { feature_key: featureKey, enabled, reason: reason || null, expires_at: expiry }
    });

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('[admin] set business override failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not save this override' });
  }
};

export const removeBusinessOverride = async (req, res) => {
  const businessId = Number(req.params.id);
  const featureKey = req.params.feature;
  try {
    const { rows } = await pool.query(
      `DELETE FROM business_feature_overrides WHERE business_id = $1 AND feature_key = $2 RETURNING feature_key`,
      [businessId, featureKey]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'No override to remove' });

    recordAudit(req, {
      business_id: businessId,
      action: 'admin.feature_override_removed',
      resource_type: 'business_feature_override',
      resource_id: featureKey
    });

    res.json({ success: true });
  } catch (error) {
    console.error('[admin] remove business override failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not remove this override' });
  }
};

/* ==========================================================================
   PLANS — pricing as data, editable from here (see plans seed in database.js:
   every price starts at 0 until set)
   ========================================================================== */
export const listPlans = async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM plans ORDER BY sort_order`);
    res.json({
      success: true,
      data: rows.map((p) => ({
        ...p,
        price_monthly: toRupees(p.price_monthly_paise),
        price_yearly: toRupees(p.price_yearly_paise)
      }))
    });
  } catch (error) {
    console.error('[admin] list plans failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load plans' });
  }
};

/** Feature toggles, straight from the admin page: { loyalty: true, ai: false, ... }, unknown keys or non-boolean values refused. */
export const planFeatureCatalog = (_req, res) => {
  res.json({ success: true, data: PLAN_FEATURES.map(([key, label, description]) => ({ key, label, description })) });
};

export const updatePlan = async (req, res) => {
  const planCode = String(req.params.code || '').toUpperCase();
  const { name, description, price_monthly, price_yearly, is_public, is_active, feature_flags: featureFlags } = req.body || {};

  const fields = [];
  const params = [];
  const set = (column, value) => {
    params.push(value);
    fields.push(`${column} = $${params.length}`);
  };

  if (name != null) set('name', String(name).trim());
  if (description != null) set('description', String(description));
  if (price_monthly != null) set('price_monthly_paise', Math.round(Number(price_monthly) * 100));
  if (price_yearly != null) set('price_yearly_paise', Math.round(Number(price_yearly) * 100));
  if (is_public != null) set('is_public', Boolean(is_public));
  if (is_active != null) set('is_active', Boolean(is_active));

  if (featureFlags != null) {
    if (typeof featureFlags !== 'object' || Array.isArray(featureFlags)) {
      return res.status(400).json({ success: false, message: 'feature_flags must be an object' });
    }
    for (const [key, value] of Object.entries(featureFlags)) {
      if (!PLAN_FEATURE_KEYS.includes(key)) return res.status(400).json({ success: false, message: `Unknown feature: ${key}` });
      if (typeof value !== 'boolean') return res.status(400).json({ success: false, message: `${key} must be true or false` });
    }
    // Merge, not replace: toggling one feature must not silently reset every other one already set on this plan.
    params.push(JSON.stringify(featureFlags));
    fields.push(`feature_flags = COALESCE(feature_flags, '{}'::jsonb) || $${params.length}::jsonb`);
  }

  if (!fields.length) {
    return res.status(400).json({ success: false, message: 'Nothing to update' });
  }

  // Billing-relevant fields cut a new plan version so a business already pinned to the old one
  // (every existing business, and anyone who joined before this change) keeps what they had —
  // name/description/is_public/is_active are catalog metadata, not something a customer is
  // "grandfathered" into, so they update `plans` directly with no version.
  const versionRelevant = price_monthly != null || price_yearly != null || featureFlags != null;

  const client = versionRelevant ? await pool.connect() : pool;
  try {
    if (versionRelevant) await client.query('BEGIN');

    params.push(planCode);
    const { rows } = await client.query(
      `UPDATE plans SET ${fields.join(', ')} WHERE plan_code = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) {
      if (versionRelevant) await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Plan not found' });
    }
    const plan = rows[0];

    if (versionRelevant) {
      const live = (await client.query(
        `SELECT plan_version_id, version_number FROM plan_versions WHERE plan_code = $1 AND effective_to IS NULL FOR UPDATE`,
        [planCode]
      )).rows[0];
      const nextVersion = (live?.version_number ?? 0) + 1;
      if (live) await client.query(`UPDATE plan_versions SET effective_to = CURRENT_TIMESTAMP WHERE plan_version_id = $1`, [live.plan_version_id]);
      await client.query(
        `INSERT INTO plan_versions (plan_code, version_number, price_monthly_paise, price_yearly_paise, limits, feature_flags, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [planCode, nextVersion, plan.price_monthly_paise, plan.price_yearly_paise, plan.limits, plan.feature_flags, req.auth?.userId ?? null]
      );
      await client.query('COMMIT');

      recordAudit(req, {
        action: 'admin.plan_version_created',
        resource_type: 'plan',
        resource_id: planCode,
        metadata: { version: nextVersion, price_monthly: toRupees(plan.price_monthly_paise), price_yearly: toRupees(plan.price_yearly_paise), feature_flags: plan.feature_flags }
      });
    }

    recordAudit(req, {
      action: 'admin.plan_updated',
      resource_type: 'plan',
      resource_id: planCode,
      metadata: req.body
    });

    res.json({ success: true, data: plan });
  } catch (error) {
    if (versionRelevant) await client.query('ROLLBACK').catch(() => {});
    console.error('[admin] update plan failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not update this plan' });
  } finally {
    if (versionRelevant) client.release();
  }
};

/* ==========================================================================
   PLAN VERSIONS — read-only history, so an admin (or a support ticket) can
   see "what did Professional cost on March 1st", not just today's price.
   ========================================================================== */
export const listPlanVersions = async (req, res) => {
  const planCode = String(req.params.code || '').toUpperCase();
  try {
    const { rows } = await pool.query(
      `SELECT plan_version_id, version_number, price_monthly_paise, price_yearly_paise, limits, feature_flags,
              effective_from, effective_to, created_by, created_at
       FROM plan_versions WHERE plan_code = $1 ORDER BY version_number DESC`,
      [planCode]
    );
    res.json({
      success: true,
      data: rows.map((v) => ({ ...v, price_monthly: toRupees(v.price_monthly_paise), price_yearly: toRupees(v.price_yearly_paise) }))
    });
  } catch (error) {
    console.error('[admin] list plan versions failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load plan history' });
  }
};

/* ==========================================================================
   BUSINESS-TYPE FEATURES — the second gate (owner's request, 2026-09-28,
   made plan-aware 2026-09-29): not just "did they pay for this" but "does
   this apply to a Salon at all, on this plan" — one switch per (business
   type, plan) pair, same shape and rules as plan feature_flags; see
   effectiveFeatureFlags(), which combines both into what a request actually
   gets. No row needs to exist for a (type, plan) pair — one not yet
   configured just has every feature on, same "missing = on" rule as always.
   ========================================================================== */
export const listBusinessTypeFeatures = async (_req, res) => {
  try {
    const plans = (await pool.query(`SELECT plan_code, name FROM plans WHERE is_public ORDER BY sort_order`)).rows;
    const { rows } = await pool.query(`SELECT business_type, plan_code, feature_flags FROM business_type_features`);
    const byKey = new Map(rows.map((r) => [`${r.business_type}:${r.plan_code}`, r.feature_flags]));
    const data = [];
    for (const type of BUSINESS_TYPES) {
      for (const plan of plans) {
        data.push({ business_type: type, plan_code: plan.plan_code, plan_name: plan.name, feature_flags: byKey.get(`${type}:${plan.plan_code}`) || {} });
      }
    }
    res.json({ success: true, data });
  } catch (error) {
    console.error('[admin] list business-type features failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load business types' });
  }
};

export const updateBusinessTypeFeature = async (req, res) => {
  const type = String(req.params.type || '').toUpperCase();
  const planCode = String(req.params.plan || '').toUpperCase();
  if (!BUSINESS_TYPES.includes(type)) return res.status(400).json({ success: false, message: 'Unknown business type' });

  const { feature_flags: featureFlags } = req.body || {};
  if (featureFlags == null || typeof featureFlags !== 'object' || Array.isArray(featureFlags)) {
    return res.status(400).json({ success: false, message: 'feature_flags must be an object' });
  }
  for (const [key, value] of Object.entries(featureFlags)) {
    if (!PLAN_FEATURE_KEYS.includes(key)) return res.status(400).json({ success: false, message: `Unknown feature: ${key}` });
    if (typeof value !== 'boolean') return res.status(400).json({ success: false, message: `${key} must be true or false` });
  }

  try {
    // Any real plan, not just the 3 public ones the admin UI shows by default — same "the data
    // stays flexible, the default view is just filtered" rule AdminPlans.jsx's hidden-plans toggle uses.
    const plan = await pool.query(`SELECT 1 FROM plans WHERE plan_code = $1`, [planCode]);
    if (!plan.rows.length) return res.status(400).json({ success: false, message: 'Unknown plan' });

    const { rows } = await pool.query(
      `INSERT INTO business_type_features (business_type, plan_code, feature_flags)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (business_type, plan_code) DO UPDATE SET feature_flags = COALESCE(business_type_features.feature_flags, '{}'::jsonb) || $3::jsonb
       RETURNING *`,
      [type, planCode, JSON.stringify(featureFlags)]
    );

    recordAudit(req, {
      action: 'admin.business_type_feature_updated',
      resource_type: 'business_type_features',
      resource_id: `${type}:${planCode}`,
      metadata: featureFlags
    });

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('[admin] update business-type feature failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not update this business type' });
  }
};

/* ==========================================================================
   PAYMENT LINKS — custom price per business (Option B: no fixed public
   plan price; the admin sets one and sends a Cashfree hosted link for it)
   ========================================================================== */
const asOrder = (o) => ({
  order_id: o.order_id,
  amount: toRupees(o.amount_paise),
  billing_cycle: o.billing_cycle,
  plan_code: o.plan_code,
  payment_link_url: o.payment_link_url,
  status: o.status,
  created_at: o.created_at,
  paid_at: o.paid_at
});

export const listPaymentLinks = async (req, res) => {
  try {
    const businessId = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT * FROM subscription_orders WHERE business_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [businessId]
    );
    res.json({ success: true, data: rows.map(asOrder) });
  } catch (error) {
    console.error('[admin] list payment links failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load payment links' });
  }
};

export const createPaymentLink = async (req, res) => {
  const businessId = Number(req.params.id);
  const { amount, billing_cycle: billingCycle, plan_code: planCode } = req.body || {};

  if (!['MONTHLY', 'YEARLY'].includes(billingCycle)) {
    return res.status(400).json({ success: false, message: 'Billing cycle must be MONTHLY or YEARLY' });
  }
  let amountPaise;
  try {
    amountPaise = toPaise(amount);
    if (amountPaise <= 0) throw new Error();
  } catch {
    return res.status(400).json({ success: false, message: 'Enter a price greater than zero' });
  }

  try {
    const { rows: businessRows } = await pool.query(
      `SELECT b.business_id, b.name, u.name AS owner_name, u.email AS owner_email, u.phone AS owner_phone
       FROM businesses b JOIN users u ON u.user_id = b.owner_user_id WHERE b.business_id = $1`,
      [businessId]
    );
    const business = businessRows[0];
    if (!business) return res.status(404).json({ success: false, message: 'Not found' });

    const { rows: orderRows } = await pool.query(
      `INSERT INTO subscription_orders (business_id, amount_paise, billing_cycle, plan_code, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [businessId, amountPaise, billingCycle, planCode || null, req.auth.userId]
    );
    const order = orderRows[0];
    const linkId = `flowxp-${order.order_id}`;

    let link;
    try {
      link = await cashfreeCreateLink({
        linkId,
        amount: toRupees(amountPaise),
        purpose: `FlowXP subscription — ${business.name}`,
        customerName: business.owner_name,
        customerEmail: business.owner_email,
        customerPhone: business.owner_phone,
        returnUrl: `${config.appOrigin}/app/settings/subscription`,
        notifyUrl: `${config.appOrigin}/api/webhooks/cashfree`
      });
    } catch (error) {
      // The row stays PENDING with no link rather than being deleted: the admin
      // can see the attempt failed and why, and retry without losing the price
      // they already typed in.
      const message = error instanceof CashfreeError ? error.message : 'Could not reach Cashfree';
      return res.status(502).json({ success: false, message });
    }

    const { rows: updated } = await pool.query(
      `UPDATE subscription_orders SET link_id = $1, payment_link_url = $2 WHERE order_id = $3 RETURNING *`,
      [linkId, link.linkUrl, order.order_id]
    );

    recordAudit(req, {
      business_id: businessId,
      action: 'admin.payment_link_created',
      resource_type: 'subscription_order',
      resource_id: order.order_id,
      metadata: { amount: toRupees(amountPaise), billing_cycle: billingCycle }
    });

    res.json({ success: true, data: asOrder(updated[0]) });
  } catch (error) {
    console.error('[admin] create payment link failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not create the payment link' });
  }
};

/* ==========================================================================
   ADD-ONS — paid extras sold per business (owner's request, 2026-09-29):
   Reservations, Table QR, Loyalty, Zomato/Swiggy, Flow AI, each with its own
   price and its own Cashfree link. Paying one sets the SAME
   business_feature_overrides row (migration 0039) an admin can already set
   by hand — a paid add-on is that override with a receipt behind it, not a
   second entitlement system. The webhook (webhooks.controller.js) tells an
   add-on order from a subscription order by the `flowxp-addon-` link prefix.
   ========================================================================== */
export const listAddons = async (_req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM addons ORDER BY sort_order`);
    res.json({ success: true, data: rows.map((a) => ({ ...a, price_monthly: toRupees(a.price_monthly_paise), price_yearly: toRupees(a.price_yearly_paise) })) });
  } catch (error) {
    console.error('[admin] list addons failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load add-ons' });
  }
};

/* A new add-on's key is free text, not required to be one of PLAN_FEATURE_KEYS — one that isn't
   just has no functional effect when paid (no feature to switch on), so a "sell it before it's
   built" or purely informational add-on (e.g. "Onboarding help") is still a legitimate use. */
const validBusinessTypes = (value) => {
  if (value == null) return { businessTypes: null, error: null };
  if (!Array.isArray(value)) return { error: 'business_types must be an array' };
  for (const t of value) if (!BUSINESS_TYPES.includes(t)) return { error: `Unknown business type: ${t}` };
  return { businessTypes: value.length ? value : null };
};

export const createAddon = async (req, res) => {
  const { addon_key: addonKey, name, description, price_monthly, price_yearly, business_types: businessTypes } = req.body || {};

  const key = String(addonKey || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!key) return res.status(400).json({ success: false, message: 'Give the add-on a key (letters, numbers, underscores)' });
  if (!name?.trim()) return res.status(400).json({ success: false, message: 'Give the add-on a name' });

  const { businessTypes: types, error: typesError } = validBusinessTypes(businessTypes);
  if (typesError) return res.status(400).json({ success: false, message: typesError });

  try {
    const { rows: sortRow } = await pool.query(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM addons`);
    const { rows } = await pool.query(
      `INSERT INTO addons (addon_key, name, description, price_monthly_paise, price_yearly_paise, business_types, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [key, String(name).trim(), description || null, toPaise(price_monthly || 0), toPaise(price_yearly || 0), types, sortRow[0].next]
    );
    recordAudit(req, { action: 'admin.addon_created', resource_type: 'addon', resource_id: key, metadata: req.body });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ success: false, message: 'That add-on key is already in use' });
    console.error('[admin] create addon failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not create this add-on' });
  }
};

export const updateAddon = async (req, res) => {
  const addonKey = String(req.params.key || '');
  const { name, description, price_monthly, price_yearly, is_active, business_types: businessTypes } = req.body || {};

  const fields = [];
  const params = [];
  const set = (column, value) => { params.push(value); fields.push(`${column} = $${params.length}`); };

  if (name != null) set('name', String(name).trim());
  if (description != null) set('description', String(description));
  if (price_monthly != null) set('price_monthly_paise', toPaise(price_monthly));
  if (price_yearly != null) set('price_yearly_paise', toPaise(price_yearly));
  if (is_active != null) set('is_active', Boolean(is_active));
  if (businessTypes !== undefined) {
    const { businessTypes: types, error: typesError } = validBusinessTypes(businessTypes);
    if (typesError) return res.status(400).json({ success: false, message: typesError });
    set('business_types', types);
  }
  if (!fields.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

  try {
    params.push(addonKey);
    const { rows } = await pool.query(`UPDATE addons SET ${fields.join(', ')} WHERE addon_key = $${params.length} RETURNING *`, params);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Add-on not found' });

    recordAudit(req, { action: 'admin.addon_updated', resource_type: 'addon', resource_id: addonKey, metadata: req.body });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('[admin] update addon failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not update this add-on' });
  }
};

export const deleteAddon = async (req, res) => {
  const addonKey = String(req.params.key || '');
  try {
    const sold = await pool.query(`SELECT 1 FROM addon_orders WHERE addon_key = $1 LIMIT 1`, [addonKey]);
    if (sold.rows.length) {
      return res.status(409).json({ success: false, message: 'This add-on has already been sold at least once — deactivate it instead of deleting it, so past orders keep their record.' });
    }
    const { rows } = await pool.query(`DELETE FROM addons WHERE addon_key = $1 RETURNING addon_key`, [addonKey]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Add-on not found' });

    recordAudit(req, { action: 'admin.addon_deleted', resource_type: 'addon', resource_id: addonKey });
    res.json({ success: true });
  } catch (error) {
    console.error('[admin] delete addon failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not delete this add-on' });
  }
};

const asAddonOrder = (o) => ({
  order_id: o.order_id,
  addon_key: o.addon_key,
  amount: toRupees(o.amount_paise),
  billing_cycle: o.billing_cycle,
  payment_link_url: o.payment_link_url,
  status: o.status,
  created_at: o.created_at,
  paid_at: o.paid_at
});

export const listAddonLinks = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM addon_orders WHERE business_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [Number(req.params.id)]
    );
    res.json({ success: true, data: rows.map(asAddonOrder) });
  } catch (error) {
    console.error('[admin] list addon links failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load add-on links' });
  }
};

export const createAddonLink = async (req, res) => {
  const businessId = Number(req.params.id);
  const { addon_key: addonKey, billing_cycle: billingCycle, amount } = req.body || {};

  if (!['MONTHLY', 'YEARLY'].includes(billingCycle)) {
    return res.status(400).json({ success: false, message: 'Billing cycle must be MONTHLY or YEARLY' });
  }

  try {
    const { rows: addonRows } = await pool.query(`SELECT * FROM addons WHERE addon_key = $1 AND is_active = TRUE`, [addonKey]);
    const addon = addonRows[0];
    if (!addon) return res.status(400).json({ success: false, message: 'Unknown or inactive add-on' });

    // Defaults to the catalog price; an admin may still type a different one for a negotiated deal,
    // same "custom price, not a fixed self-serve one" reasoning as the main subscription link.
    let amountPaise = billingCycle === 'YEARLY' ? addon.price_yearly_paise : addon.price_monthly_paise;
    if (amount != null) {
      try { amountPaise = toPaise(amount); } catch { return res.status(400).json({ success: false, message: 'Enter a valid price' }); }
    }
    if (!(amountPaise > 0)) return res.status(400).json({ success: false, message: 'This add-on has no price set yet — set one on the Add-ons page first, or enter one here' });

    const { rows: businessRows } = await pool.query(
      `SELECT b.business_id, b.name, u.name AS owner_name, u.email AS owner_email, u.phone AS owner_phone
       FROM businesses b JOIN users u ON u.user_id = b.owner_user_id WHERE b.business_id = $1`,
      [businessId]
    );
    const business = businessRows[0];
    if (!business) return res.status(404).json({ success: false, message: 'Not found' });

    const { rows: orderRows } = await pool.query(
      `INSERT INTO addon_orders (business_id, addon_key, amount_paise, billing_cycle, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [businessId, addonKey, amountPaise, billingCycle, req.auth?.userId ?? null]
    );
    const order = orderRows[0];
    const linkId = `flowxp-addon-${order.order_id}`;

    let link;
    try {
      link = await cashfreeCreateLink({
        linkId,
        amount: toRupees(amountPaise),
        purpose: `FlowXP add-on: ${addon.name} — ${business.name}`,
        customerName: business.owner_name,
        customerEmail: business.owner_email,
        customerPhone: business.owner_phone,
        returnUrl: `${config.appOrigin}/app/settings/subscription`,
        notifyUrl: `${config.appOrigin}/api/webhooks/cashfree`
      });
    } catch (error) {
      const message = error instanceof CashfreeError ? error.message : 'Could not reach Cashfree';
      return res.status(502).json({ success: false, message });
    }

    const { rows: updated } = await pool.query(
      `UPDATE addon_orders SET link_id = $1, payment_link_url = $2 WHERE order_id = $3 RETURNING *`,
      [linkId, link.linkUrl, order.order_id]
    );

    recordAudit(req, {
      business_id: businessId,
      action: 'admin.addon_link_created',
      resource_type: 'addon_order',
      resource_id: order.order_id,
      metadata: { addon_key: addonKey, amount: toRupees(amountPaise), billing_cycle: billingCycle }
    });

    res.json({ success: true, data: asAddonOrder(updated[0]) });
  } catch (error) {
    console.error('[admin] create addon link failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not create the add-on link' });
  }
};
