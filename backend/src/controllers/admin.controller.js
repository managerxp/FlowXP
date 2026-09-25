/*
 * The super admin API — platform-wide, not tenant-scoped.
 *
 * Everything here answers questions a business owner's own token could never
 * ask: how many tenants exist, which ones are on which plan, what the whole
 * platform has billed. requireSuperAdmin (middleware/auth.js) gates every
 * route below the login itself.
 */
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import { signToken } from '../middleware/auth.js';
import { subscriptionSummary } from '../modules/subscription.js';
import { recordAudit } from '../modules/events.js';
import { toRupees } from '../utils/money.js';
import { normaliseEmail } from '../utils/validate.js';

const BUSINESS_STATUSES = ['ACTIVE', 'SUSPENDED', 'CLOSED'];

/* ==========================================================================
   POST /api/admin/login
   ========================================================================== */
export const login = async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Enter your email and password' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT user_id, name, email, password_hash, is_super_admin
       FROM users WHERE email = $1`,
      [normaliseEmail(email)]
    );

    const user = rows[0];
    // Same constant-time-ish shape as the regular login: a wrong password and
    // a non-admin account must not be distinguishable by response timing.
    const hash = user?.password_hash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const ok = await bcrypt.compare(String(password), hash);

    if (!user || !ok || !user.is_super_admin) {
      return res.status(401).json({ success: false, message: 'Email or password is incorrect' });
    }

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
    const [businesses, users, trials, revenue, invoices] = await Promise.all([
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
      pool.query(`
        SELECT COUNT(*)::int AS n FROM businesses
        WHERE subscription_status = 'TRIAL' AND trial_ends_at > CURRENT_TIMESTAMP
          AND trial_ends_at <= CURRENT_TIMESTAMP + INTERVAL '2 days'
      `),
      // What the platform has actually collected — every payment ever recorded,
      // across every tenant. Not MRR (no recurring-billing provider is wired up
      // yet — see modules/subscription.js), just cash collected to date.
      pool.query(`SELECT COALESCE(SUM(amount_paise), 0) AS total_paise FROM payments`),
      pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE status = 'ISSUED'`)
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
          trials_ending_soon: trials.rows[0].n
        },
        users_total: users.rows[0].total,
        invoices_total: invoices.rows[0].n,
        revenue_collected: toRupees(revenue.rows[0].total_paise)
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

export const updatePlan = async (req, res) => {
  const planCode = String(req.params.code || '').toUpperCase();
  const { name, description, price_monthly, price_yearly, is_public, is_active } = req.body || {};

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

  if (!fields.length) {
    return res.status(400).json({ success: false, message: 'Nothing to update' });
  }

  try {
    params.push(planCode);
    const { rows } = await pool.query(
      `UPDATE plans SET ${fields.join(', ')} WHERE plan_code = $${params.length} RETURNING *`,
      params
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Plan not found' });

    recordAudit(req, {
      action: 'admin.plan_updated',
      resource_type: 'plan',
      resource_id: planCode,
      metadata: req.body
    });

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    console.error('[admin] update plan failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not update this plan' });
  }
};
