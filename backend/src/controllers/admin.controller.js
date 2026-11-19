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
import { deleteBusinessForever, removeBusinessFiles } from '../modules/deleteBusiness.js';
import pool from '../config/database.js';
import { signToken } from '../middleware/auth.js';
import { decryptSecret, lockedMinutes, recordLogin, recoveryCodesLeft, useRecoveryCode, verifyTotp } from '../modules/security.js';
import { subscriptionSummary } from '../modules/subscription.js';
import { recordAudit } from '../modules/events.js';
import { toRupees, toPaise } from '../utils/money.js';
import { normaliseEmail, BUSINESS_TYPES } from '../utils/validate.js';
import { createPaymentLink as cashfreeCreateLink, CashfreeError } from '../modules/payments/cashfree.js';
import { effectiveFeatureFlags, industryDefaults, INDUSTRY_OFF, PLAN_FEATURES, PLAN_FEATURE_KEYS, FEATURE_GROUPS, featureGroup } from '../modules/planFeatures.js';
import config from '../config/env.js';
import { outletAllowance } from './outlets.controller.js';
import { isStaffUser, permissionsOf, roleOf } from '../modules/adminRoles.js';
import { issueEmailOtp } from './auth.controller.js';
import { deviceHash, tryPin, wrong as wrongPin } from './pinLogin.controller.js';

const BUSINESS_STATUSES = ['ACTIVE', 'SUSPENDED', 'CLOSED'];
const SUBSCRIPTION_STATUSES = ['TRIAL', 'ACTIVE', 'EXPIRED', 'CANCELLED', 'SUSPENDED'];

/* ==========================================================================
   POST /api/admin/login
   ========================================================================== */
/* a real hash, so an unknown address takes as long as a wrong password (see auth.controller.js) */
const ADMIN_DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), 12);

const CODE_GAP_MS = 30 * 1000;
const CODE_TTL_MS = 10 * 60 * 1000;
/* A staff member by the email or the phone number they type: the phone is matched on its last ten digits, so +91 and spaces do not matter */
export const staffByIdentifier = async (identifier) => {
  const text = String(identifier || '').trim();
  const cols = 'user_id, name, email, is_super_admin, admin_role, admin_disabled, token_version, totp_enabled, email_otp_hash, email_otp_expires_at';
  if (text.includes('@')) return (await pool.query(`SELECT ${cols} FROM users WHERE email = $1`, [normaliseEmail(text)])).rows[0];
  const digits = text.replace(/\D/g, '').slice(-10);
  if (digits.length < 10) return undefined;
  return (await pool.query(`SELECT ${cols} FROM users WHERE is_super_admin AND admin_role IS NOT NULL AND admin_role <> 'OWNER' AND right(regexp_replace(COALESCE(phone, ''), '\\D', '', 'g'), 10) = $1 LIMIT 1`, [digits])).rows[0];
};
const adminPayload = (user) => ({
  token: signToken(user, { expiresIn: '8h' }),
  admin: { user_id: user.user_id, name: user.name, email: user.email, role: roleOf(user), permissions: permissionsOf(user), totp_enabled: Boolean(user.totp_enabled), two_factor_required: false }
});

/* POST /api/admin/login/code { identifier }: a staff member asks for a sign-in code (first time on a computer, or a forgotten PIN). It goes to their email. The answer is the same whoever asks, so it never says who has a sign-in. */
export const staffCode = async (req, res) => {
  const identifier = String(req.body?.identifier ?? req.body?.email ?? '').trim();
  if (!identifier) return res.status(400).json({ success: false, message: 'Enter your email or phone number.' });
  try {
    const user = await staffByIdentifier(identifier);
    const locked = user ? await lockedMinutes(pool, user.email) : 0;
    const justSent = user?.email_otp_expires_at && Date.now() - (new Date(user.email_otp_expires_at).getTime() - CODE_TTL_MS) < CODE_GAP_MS;
    if (user && isStaffUser(user) && !user.admin_disabled && !locked && !justSent) await issueEmailOtp(user);
  } catch (error) { console.error('[admin] staff code failed:', error.message); }
  res.json({ success: true, message: 'If that email has a staff sign-in, a code is on its way. It lasts 10 minutes.' });
};

/* POST /api/admin/login/verify { identifier, code }: the code that was emailed signs a staff member in, once */
export const staffVerify = async (req, res) => {
  const identifier = String(req.body?.identifier ?? req.body?.email ?? '').trim();
  const given = String(req.body?.code ?? '').replace(/\s/g, '');
  if (!identifier || !given) return res.status(400).json({ success: false, message: 'Enter your email or phone number, and the code.' });
  try {
    const user = await staffByIdentifier(identifier);
    const email = user?.email || normaliseEmail(identifier);
    const locked = await lockedMinutes(pool, email);
    if (locked) {
      await recordLogin(pool, { email, req, outcome: 'LOCKED' });
      return res.status(429).json({ success: false, message: `Too many wrong codes. Try again in ${locked} minute${locked === 1 ? '' : 's'}.` });
    }
    const hash = crypto.createHash('sha256').update(given).digest('hex');
    const valid = user && isStaffUser(user) && !user.admin_disabled && user.email_otp_hash === hash && user.email_otp_expires_at && new Date(user.email_otp_expires_at) > new Date();
    if (!valid) {
      await recordLogin(pool, { userId: user?.user_id ?? null, email, req, outcome: user ? 'EMAIL_OTP_FAILED' : 'UNKNOWN_USER' });
      return res.status(401).json({ success: false, message: 'That code is not right, or it has expired. Ask for a new one.' });
    }
    await pool.query('UPDATE users SET email_otp_hash = NULL, email_otp_expires_at = NULL, email_verified = TRUE, last_login_at = CURRENT_TIMESTAMP WHERE user_id = $1', [user.user_id]);
    await recordLogin(pool, { userId: user.user_id, email: user.email, req, outcome: 'SUCCESS', method: 'EMAIL_OTP' });
    res.json({ success: true, data: adminPayload(user) });
  } catch (error) {
    console.error('[admin] staff verify failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not sign you in' });
  }
};

/* POST /api/admin/login/pin { identifier, pin }: after the first code, a staff member signs in on that computer with a PIN. The PIN is kept for this browser only (pinLogin.controller.js:
   a device cookie plus the PIN), five wrong ones end it and the emailed code is needed again, and any change to their access (role, off, signed out) ends it too. */
export const staffPin = async (req, res) => {
  const identifier = String(req.body?.identifier ?? '').trim();
  const device = deviceHash(req);
  const again = 'Use a code: choose "Email me a code".';
  try {
    const user = await staffByIdentifier(identifier);
    const locked = user ? await lockedMinutes(pool, user.email) : 0;
    if (locked) return res.status(429).json({ success: false, message: `Too many wrong tries. Try again in ${locked} minute${locked === 1 ? '' : 's'}.` });
    const result = user && device && isStaffUser(user) && !user.admin_disabled ? await tryPin(req, device, user.user_id, req.body?.pin) : null;
    if (result === null) {
      await recordLogin(pool, { userId: user?.user_id ?? null, email: user?.email || normaliseEmail(identifier), req, outcome: user ? 'BAD_PIN' : 'UNKNOWN_USER' });
      return res.status(401).json({ success: false, message: `There is no PIN for that on this computer. ${again}` });
    }
    if (result !== true) {
      await recordLogin(pool, { userId: user.user_id, email: user.email, req, outcome: 'BAD_PIN' });
      return res.status(401).json({ success: false, message: result > 0 ? wrongPin(result) : `Too many wrong PINs. ${again}`, data: { tries_left: result } });
    }
    await recordLogin(pool, { userId: user.user_id, email: user.email, req, outcome: 'SUCCESS', method: 'PIN' });
    pool.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = $1', [user.user_id]).catch(() => {});
    res.json({ success: true, data: adminPayload(user) });
  } catch (error) {
    console.error('[admin] staff pin failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not sign you in' });
  }
};

export const login = async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Enter your email and password' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT user_id, name, email, password_hash, is_super_admin, admin_role, admin_disabled, token_version, totp_enabled, totp_secret_enc, totp_last_step
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

    if (!user || !ok || !user.is_super_admin || user.admin_disabled || isStaffUser(user)) {
      await recordLogin(pool, { userId: user?.user_id ?? null, email: normaliseEmail(email), req, outcome: user ? 'BAD_PASSWORD' : 'UNKNOWN_USER' });
      return res.status(401).json({ success: false, message: 'Email or password is incorrect' });
    }

    // the platform operator can protect the console with an authenticator app: the code comes with the password
    if (user.totp_enabled) {
      const recovery = req.body?.recovery_code;
      const step = req.body?.code ? verifyTotp(decryptSecret(user.totp_secret_enc), req.body.code, { lastStep: user.totp_last_step }) : null;
      if (recovery) {
        // a single-use code from the set made when 2FA was turned on, for a lost or broken phone
        if (!(await useRecoveryCode(pool, user.user_id, recovery))) {
          await recordLogin(pool, { userId: user.user_id, email: user.email, req, outcome: 'TWO_FACTOR_FAILED' });
          return res.status(401).json({ success: false, requires_2fa: true, message: 'That recovery code is not valid, or was already used.' });
        }
        recordAudit(req, { user_id: user.user_id, action: 'user.recovery_code_used', resource_type: 'user', resource_id: user.user_id, metadata: { left: await recoveryCodesLeft(pool, user.user_id), console: 'admin' } });
      } else if (step == null) {
        if (req.body?.code) await recordLogin(pool, { userId: user.user_id, email: user.email, req, outcome: 'TWO_FACTOR_FAILED' });
        return res.status(401).json({ success: false, requires_2fa: true, message: req.body?.code ? 'That code is not right.' : 'Enter the code from your authenticator app.' });
      } else {
        await pool.query('UPDATE users SET totp_last_step = $2 WHERE user_id = $1', [user.user_id, step]);
      }
    }
    await recordLogin(pool, { userId: user.user_id, email: user.email, req, outcome: 'SUCCESS', method: user.totp_enabled ? '2FA' : 'PASSWORD' });

    pool.query(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = $1`, [user.user_id])
      .catch(() => {});

    res.json({
      success: true,
      data: {
        // the platform console is the most powerful sign-in there is: a working day, not a week
        token: signToken(user, { expiresIn: '8h' }),
        admin: { user_id: user.user_id, name: user.name, email: user.email, role: roleOf(user), permissions: permissionsOf(user), totp_enabled: Boolean(user.totp_enabled), two_factor_required: config.adminRequire2fa && !isStaffUser(user) }
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
    data: { user_id: req.auth.userId, name: req.auth.user.name, email: req.auth.email, role: roleOf(req.auth.user), permissions: permissionsOf(req.auth.user), totp_enabled: Boolean(req.auth.user.totp_enabled), two_factor_required: config.adminRequire2fa && !isStaffUser(req.auth.user) }
  });
};

/* ==========================================================================
   GET /api/admin/stats — the dashboard overview
   ========================================================================== */
/* Everything FlowXP has been paid, whichever way it came: a subscription link, an add-on link (paid online or marked paid by hand) and an invoice from the Documents
   screen marked paid. Each row is when it was paid and how much, so the totals, the month and the year all add up from the same list. */
const RECEIPTS = `(
  SELECT paid_at, amount_paise FROM subscription_orders WHERE status = 'PAID' AND paid_at IS NOT NULL
  UNION ALL SELECT paid_at, amount_paise FROM addon_orders WHERE status = 'PAID' AND paid_at IS NOT NULL
  UNION ALL SELECT paid_at, COALESCE((totals->>'total_paise')::bigint, 0) FROM admin_documents WHERE kind = 'INVOICE' AND status = 'PAID' AND paid_at IS NOT NULL
) r`;

export const getStats = async (req, res) => {
  try {
    const seeRevenue = permissionsOf(req.auth?.user).includes('revenue');
    const [businesses, users, trialsSummary, trialsList, platformRevenue, revenueByMonth, pendingSummary, pendingList, invoices, mrr, revenuePeriods] = await Promise.all([
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
      pool.query(`SELECT COALESCE(SUM(amount_paise), 0) AS total_paise, COUNT(*)::int AS n FROM ${RECEIPTS}`),
      pool.query(`
        SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month, COALESCE(SUM(amount_paise), 0) AS total_paise
        FROM ${RECEIPTS} WHERE paid_at >= date_trunc('month', CURRENT_TIMESTAMP) - INTERVAL '11 months'
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
      `),
      pool.query(`
        SELECT
          COALESCE(SUM(amount_paise) FILTER (WHERE paid_at >= date_trunc('month', CURRENT_TIMESTAMP)), 0) AS this_month,
          COALESCE(SUM(amount_paise) FILTER (WHERE paid_at >= date_trunc('month', CURRENT_TIMESTAMP) - INTERVAL '1 month' AND paid_at < date_trunc('month', CURRENT_TIMESTAMP)), 0) AS last_month,
          COALESCE(SUM(amount_paise) FILTER (WHERE paid_at >= date_trunc('year', CURRENT_TIMESTAMP)), 0) AS this_year,
          COALESCE(SUM(amount_paise) FILTER (WHERE paid_at >= date_trunc('year', CURRENT_TIMESTAMP) - INTERVAL '1 year' AND paid_at < date_trunc('year', CURRENT_TIMESTAMP)), 0) AS last_year
        FROM ${RECEIPTS}
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
        ...(seeRevenue && {
          revenue_collected: toRupees(platformRevenue.rows[0].total_paise),
          payments_collected: platformRevenue.rows[0].n,
          mrr: toRupees(mrr.rows[0].mrr_paise),
          revenue_by_month: revenueByMonth.rows.map((r) => ({ month: r.month, amount: toRupees(r.total_paise) })),
          revenue_periods: {
            this_month: toRupees(revenuePeriods.rows[0].this_month), last_month: toRupees(revenuePeriods.rows[0].last_month),
            this_year: toRupees(revenuePeriods.rows[0].this_year), last_year: toRupees(revenuePeriods.rows[0].last_year)
          }
        }),
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
/* "Needs attention" views for the client list: each is a condition on the businesses row (alias b). */
const ATTENTION = {
  trial_ending: `b.subscription_status = 'TRIAL' AND b.trial_ends_at BETWEEN CURRENT_TIMESTAMP AND CURRENT_TIMESTAMP + INTERVAL '7 days'`,
  expired: `(b.subscription_status = 'EXPIRED' OR (b.subscription_status = 'TRIAL' AND b.trial_ends_at < CURRENT_TIMESTAMP))`,
  low_credit: `b.subscription_status = 'ACTIVE' AND b.wallet_paise < 2000`,
  unpaid: `EXISTS (SELECT 1 FROM admin_documents d WHERE d.business_id = b.business_id AND d.kind = 'INVOICE' AND d.status = 'SENT')`,
  followup_due: `b.follow_up_on IS NOT NULL AND b.follow_up_on <= CURRENT_DATE`,
  quiet: `b.created_at < CURRENT_TIMESTAMP - INTERVAL '14 days' AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.business_id = b.business_id AND i.created_at > CURRENT_TIMESTAMP - INTERVAL '14 days')`
};

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
    const type = String(req.query.type || '').trim().toUpperCase();
    if (type && BUSINESS_TYPES.includes(type)) { params.push(type); where.push(`b.business_type = $${params.length}`); }
    const sub = String(req.query.subscription_status || '').trim().toUpperCase();
    if (sub && SUBSCRIPTION_STATUSES.includes(sub)) { params.push(sub); where.push(`b.subscription_status = $${params.length}`); }
    const tag = String(req.query.tag || '').trim().toLowerCase();
    if (tag) { params.push(tag); where.push(`$${params.length} = ANY(b.admin_tags)`); }
    const attn = ATTENTION[String(req.query.attention || '')];
    if (attn) where.push(attn);
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
              b.plan_code, b.billing_cycle, b.trial_started_at, b.trial_ends_at, b.next_billing_date, b.subscription_started_at,
              b.currency, b.created_at, b.wallet_paise, b.admin_tags, b.follow_up_on::text AS follow_up_on, b.follow_up_note,
              u.user_id AS owner_user_id, u.name AS owner_name, u.email AS owner_email, COALESCE(b.phone, u.phone) AS contact_phone,
              (SELECT COUNT(*)::int FROM messages m WHERE m.business_id = b.business_id AND m.channel = 'WHATSAPP' AND m.status = 'SENT' AND m.created_at > CURRENT_TIMESTAMP - INTERVAL '30 days') AS wa_sent_30d,
              (SELECT MAX(i.created_at) FROM invoices i WHERE i.business_id = b.business_id) AS last_bill_at,
              (SELECT COALESCE(SUM((d.totals->>'total_paise')::bigint), 0) FROM admin_documents d WHERE d.business_id = b.business_id AND d.kind = 'INVOICE' AND d.status = 'SENT') AS unpaid_paise
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
          phone: b.contact_phone,
          wallet_paise: Number(b.wallet_paise),
          tags: b.admin_tags || [],
          follow_up_on: b.follow_up_on,
          follow_up_note: b.follow_up_note,
          wa_sent_30d: b.wa_sent_30d,
          last_bill_at: b.last_bill_at,
          unpaid_paise: Number(b.unpaid_paise),
          subscription: subscriptionSummary(b)
        })),
        attention: Object.fromEntries(await Promise.all(Object.entries(ATTENTION).map(async ([k, cond]) => [k, (await pool.query(`SELECT COUNT(*)::int AS n FROM businesses b WHERE b.status <> 'CLOSED' AND ${cond}`)).rows[0].n]))),
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

/* PATCH /api/admin/businesses/:id/crm { tags?, follow_up_on?, follow_up_note? }: the owner's own notes on a client */
export const updateClientCrm = async (req, res) => {
  const id = Number(req.params.id); const b = req.body || {};
  const sets = []; const params = [id];
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags)) return res.status(400).json({ success: false, message: 'Tags must be a list.' });
    const tags = [...new Set(b.tags.map((t) => String(t).trim().toLowerCase().slice(0, 24)).filter(Boolean))].slice(0, 10);
    params.push(tags); sets.push(`admin_tags = $${params.length}`);
  }
  if (b.follow_up_on !== undefined) {
    const v = b.follow_up_on ? String(b.follow_up_on).slice(0, 10) : null;
    if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))) return res.status(400).json({ success: false, message: 'That follow-up date is not a date.' });
    params.push(v); sets.push(`follow_up_on = $${params.length}`);
  }
  if (b.follow_up_note !== undefined) { params.push(String(b.follow_up_note || '').trim().slice(0, 200) || null); sets.push(`follow_up_note = $${params.length}`); }
  if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to change.' });
  const row = (await pool.query(`UPDATE businesses SET ${sets.join(', ')} WHERE business_id = $1 RETURNING admin_tags, follow_up_on::text AS follow_up_on, follow_up_note`, params)).rows[0];
  if (!row) return res.status(404).json({ success: false, message: 'Business not found' });
  recordAudit(req, { business_id: id, action: 'admin.client_notes_changed', resource_type: 'business', resource_id: id, metadata: {} });
  res.json({ success: true, data: { tags: row.admin_tags, follow_up_on: row.follow_up_on, follow_up_note: row.follow_up_note } });
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

    const [members, branches, invoices, revenue, wholesaleMode] = await Promise.all([
      pool.query(
        `SELECT bu.role, bu.status, u.user_id, u.name, u.email
         FROM business_users bu JOIN users u ON u.user_id = bu.user_id
         WHERE bu.business_id = $1 ORDER BY bu.role`,
        [businessId]
      ),
      pool.query(`SELECT branch_id, name, is_primary, status FROM branches WHERE business_id = $1`, [businessId]),
      pool.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE business_id = $1 AND status = 'ISSUED'`, [businessId]),
      pool.query(`SELECT COALESCE(SUM(amount_paise), 0) AS total_paise FROM payments WHERE business_id = $1`, [businessId]),
      pool.query(`SELECT distributor_enabled FROM wholesale_settings WHERE business_id = $1`, [businessId])
    ]);

    res.json({
      success: true,
      data: {
        business_id: business.business_id,
        name: business.name,
        tags: business.admin_tags || [],
        follow_up_on: business.follow_up_on ? new Date(business.follow_up_on).toLocaleDateString('en-CA') : null,
        follow_up_note: business.follow_up_note || '',
        business_type: business.business_type,
        distributor_enabled: business.business_type === 'DISTRIBUTOR' || Boolean(wholesaleMode.rows[0]?.distributor_enabled),
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
   DELETE /api/admin/businesses/:id { confirm_name, delete_users? } — erase a business and everything in it from the database, for good.
   The name must be typed exactly, so a slip of the finger cannot do it. People who belonged to this shop alone are erased too (unless delete_users is false),
   so they can sign up again and get a new free trial.
   ========================================================================== */
export const deleteBusiness = async (req, res) => {
  const businessId = Number(req.params.id);
  if (!Number.isInteger(businessId)) return res.status(404).json({ success: false, message: 'Not found' });
  const client = await pool.connect();
  let done;
  try {
    await client.query('BEGIN');
    const name = (await client.query(`SELECT name FROM businesses WHERE business_id = $1`, [businessId])).rows[0]?.name;
    if (!name) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found' }); }
    if (String(req.body?.confirm_name ?? '').trim().toLowerCase() !== name.trim().toLowerCase()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Type the exact business name to delete it' });
    }
    done = await deleteBusinessForever(client, businessId, { deleteUsers: req.body?.delete_users !== false });
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[admin] delete business failed:', error.message);
    return res.status(500).json({ success: false, message: 'Could not delete this business' });
  } finally { client.release(); }
  removeBusinessFiles(businessId, done.files).catch(() => {});
  recordAudit(req, { business_id: null, action: 'admin.business_deleted', resource_type: 'business', resource_id: businessId, metadata: { name: done.name, users_deleted: done.users_deleted } });
  res.json({ success: true, data: { name: done.name, users_deleted: done.users_deleted } });
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
  const { plan_code: planCode, subscription_status: subscriptionStatus, business_type: businessType, distributor_enabled: distributorEnabled } = req.body || {};

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
  // Starting a paid period by hand: how long it runs (months), or exact start and end dates. Without this the business shows no start and end date.
  if (String(subscriptionStatus || '').toUpperCase() === 'ACTIVE') {
    const { months, start_date: startDate, end_date: endDate } = req.body;
    const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(Date.parse(v)) ? String(v) : null);
    if ((startDate && !day(startDate)) || (endDate && !day(endDate))) return res.status(400).json({ success: false, message: 'Dates must look like 2026-01-31' });
    const m = months == null ? null : Number(months);
    if (m != null && (!Number.isInteger(m) || m < 1 || m > 60)) return res.status(400).json({ success: false, message: 'Choose 1 to 60 months' });
    const start = day(startDate);
    const end = day(endDate);
    if (start && end && end <= start) return res.status(400).json({ success: false, message: 'The end date must be after the start date' });
    if (m || end) {
      params.push(start); fields.push(`subscription_started_at = COALESCE($${params.length}::date, CURRENT_TIMESTAMP)`);
      if (end) { params.push(end); fields.push(`next_billing_date = $${params.length}::date`); }
      else { params.push(start); params.push(m); fields.push(`next_billing_date = COALESCE($${params.length - 1}::date, CURRENT_TIMESTAMP) + ($${params.length} || ' months')::interval`); }
    }
  }
  if (businessType != null) {
    if (!BUSINESS_TYPES.includes(String(businessType).toUpperCase())) {
      return res.status(400).json({ success: false, message: 'Unknown business type' });
    }
    set('business_type', String(businessType).toUpperCase());
  }

  // Wholesale and distribution is one business type; this switch says whether the distributor tools (field sales, beats, schemes, vans) are on.
  if (distributorEnabled != null && typeof distributorEnabled !== 'boolean') return res.status(400).json({ success: false, message: 'distributor_enabled must be true or false' });

  if (!fields.length && distributorEnabled == null) return res.status(400).json({ success: false, message: 'Nothing to update' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = (await client.query(`SELECT b.business_type, COALESCE(ws.distributor_enabled, FALSE) AS distributor_enabled FROM businesses b LEFT JOIN wholesale_settings ws ON ws.business_id = b.business_id WHERE b.business_id = $1 FOR UPDATE OF b`, [businessId])).rows[0];
    if (!before) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, message: 'Not found' }); }
    const finalType = businessType != null ? String(businessType).toUpperCase() : before.business_type;
    if (distributorEnabled != null && !['WHOLESALE', 'DISTRIBUTOR'].includes(finalType)) { await client.query('ROLLBACK'); return res.status(400).json({ success: false, message: 'The distributor tools belong to wholesale and distribution businesses' }); }
    // Moving a DISTRIBUTOR business to WHOLESALE must not quietly drop its distributor tools: they become an explicit setting unless told otherwise.
    const keepDistributor = distributorEnabled ?? (before.business_type === 'DISTRIBUTOR' && finalType === 'WHOLESALE' ? true : null);
    let row = { business_id: businessId };
    if (fields.length) {
      params.push(businessId);
      const { rows } = await client.query(
        `UPDATE businesses SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
         WHERE business_id = $${params.length}
         RETURNING business_id, name, plan_code, subscription_status, business_type`,
        params
      );
      row = rows[0];
    }
    if (keepDistributor != null) {
      await client.query(`INSERT INTO wholesale_settings (business_id, distributor_enabled) VALUES ($1, $2) ON CONFLICT (business_id) DO UPDATE SET distributor_enabled = EXCLUDED.distributor_enabled`, [businessId, keepDistributor]);
    }
    await client.query('COMMIT');
    const rows = [{ ...row, ...(keepDistributor != null ? { distributor_enabled: keepDistributor } : {}) }];

    recordAudit(req, {
      business_id: businessId,
      action: 'admin.business_plan_changed',
      resource_type: 'business',
      resource_id: businessId,
      metadata: req.body
    });

    res.json({ success: true, data: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[admin] update business plan failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not update this business' });
  } finally {
    client.release();
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
  'admin.addon_link_created', 'subscription.addon_activated', 'admin.trial_extended'
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

/* Every feature this business could have, as one list for the Super Admin: what its plan and industry give it, what an override changed, and the add-on that sells it. */
export const businessFeatures = async (req, res) => {
  const businessId = Number(req.params.id);
  try {
    const b = (await pool.query(
      `SELECT b.business_type, b.workshop_mode, COALESCE(pv.feature_flags, p.feature_flags, '{}'::jsonb) AS plan_flags, COALESCE(btf.feature_flags, '{}'::jsonb) AS type_flags
       FROM businesses b LEFT JOIN plans p ON p.plan_code = b.plan_code LEFT JOIN plan_versions pv ON pv.plan_version_id = b.plan_version_id
       LEFT JOIN business_type_features btf ON btf.business_type = b.business_type AND btf.plan_code = b.plan_code
       WHERE b.business_id = $1`, [businessId])).rows[0];
    if (!b) return res.status(404).json({ success: false, message: 'Not found' });
    const overrides = Object.fromEntries((await pool.query(
      `SELECT feature_key, enabled FROM business_feature_overrides WHERE business_id = $1 AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)`, [businessId])).rows.map((o) => [o.feature_key, o.enabled]));
    const addons = Object.fromEntries((await pool.query(`SELECT addon_key, name, price_yearly_paise FROM addons WHERE is_active`)).rows.map((a) => [a.addon_key, a]));
    const sources = [b.plan_flags, b.type_flags];
    const inPlan = effectiveFeatureFlags(sources, {}, b.business_type, b.workshop_mode);
    const now = effectiveFeatureFlags(sources, overrides, b.business_type, b.workshop_mode);
    const offForIndustry = industryDefaults(b.business_type);
    const groups = Object.fromEntries(FEATURE_GROUPS);
    const data = PLAN_FEATURES
      // an industry's own off-list (a salon has no kitchen display) stays hidden unless somebody switched it on for this business
      .filter(([key]) => !(offForIndustry[key] === false && b.type_flags?.[key] !== true && overrides[key] !== true))
      .map(([key, label, description]) => ({
        key, label, description, group: featureGroup(key), group_label: groups[featureGroup(key)],
        included: inPlan[key] !== false, enabled: now[key] !== false, override: key in overrides ? overrides[key] : null,
        addon: addons[key] ? { addon_key: key, name: addons[key].name, price_yearly: toRupees(addons[key].price_yearly_paise) } : null
      }));
    res.json({ success: true, data });
  } catch (error) {
    console.error('[admin] business features failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not load the features' });
  }
};

/* Outlets are counted, not switched: the plan's number, this business's own number (override), outlets bought, and how many are open. */
const outletsView = async (businessId) => ({
  ...(await outletAllowance(businessId)),
  used: Number((await pool.query(`SELECT COUNT(*) AS n FROM branches WHERE business_id = $1 AND status = 'ACTIVE'`, [businessId])).rows[0].n)
});

export const businessOutlets = async (req, res) => {
  const businessId = Number(req.params.id);
  const exists = await pool.query(`SELECT 1 FROM businesses WHERE business_id = $1`, [businessId]);
  if (!exists.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
  res.json({ success: true, data: await outletsView(businessId) });
};

/* PUT /businesses/:id/outlets { outlet_limit: number | null, extra_outlets?: number } — null puts it back on the plan's number */
export const setBusinessOutlets = async (req, res) => {
  const businessId = Number(req.params.id);
  const { outlet_limit: limit, extra_outlets: extra } = req.body || {};
  if (limit !== null && !(Number.isInteger(limit) && limit >= 1 && limit <= 1000)) return res.status(400).json({ success: false, message: 'Outlets must be a whole number from 1, or blank for the plan’s number' });
  if (extra !== undefined && !(Number.isInteger(extra) && extra >= 0 && extra <= 1000)) return res.status(400).json({ success: false, message: 'Bought outlets must be a whole number, 0 or more' });
  const { rowCount } = await pool.query(
    `UPDATE businesses SET outlet_limit = $2, extra_outlets = COALESCE($3, extra_outlets) WHERE business_id = $1`, [businessId, limit, extra ?? null]);
  if (!rowCount) return res.status(404).json({ success: false, message: 'Not found' });
  recordAudit(req, { business_id: businessId, action: 'admin.outlet_limit_set', resource_type: 'business', resource_id: businessId, metadata: { outlet_limit: limit, extra_outlets: extra } });
  res.json({ success: true, data: await outletsView(businessId) });
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
  const groups = Object.fromEntries(FEATURE_GROUPS);
  res.json({ success: true, data: PLAN_FEATURES.map(([key, label, description]) => ({ key, label, description, group: featureGroup(key), group_label: groups[featureGroup(key)] })) });
};

export const updatePlan = async (req, res) => {
  const planCode = String(req.params.code || '').toUpperCase();
  const { name, description, price_monthly, price_yearly, is_public, is_active, feature_flags: featureFlags, limits, features } = req.body || {};

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

  // limits: users, outlets, AI questions a month; null or blank means unlimited
  if (limits != null) {
    if (typeof limits !== 'object' || Array.isArray(limits)) return res.status(400).json({ success: false, message: 'limits must be an object' });
    const clean = {};
    for (const key of ['users', 'outlets', 'ai_queries']) {
      if (!(key in limits)) continue;
      const v = limits[key];
      if (v === null || v === '') { clean[key] = null; continue; }
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 1000000) return res.status(400).json({ success: false, message: `${key.replace('_', ' ')} must be a whole number, or blank for unlimited` });
      clean[key] = n;
    }
    params.push(JSON.stringify(clean));
    fields.push(`limits = COALESCE(limits, '{}'::jsonb) || $${params.length}::jsonb`);
  }
  // features: the bullet list the pricing page shows
  if (features != null) {
    if (!Array.isArray(features) || features.length > 12 || features.some((f) => typeof f !== 'string' || !f.trim() || f.length > 120)) return res.status(400).json({ success: false, message: 'Give up to 12 short lines' });
    set('features', JSON.stringify(features.map((f) => f.trim())));
  }

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
  const versionRelevant = price_monthly != null || price_yearly != null || featureFlags != null || limits != null;

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
        data.push({ business_type: type, plan_code: plan.plan_code, plan_name: plan.name, industry_off: INDUSTRY_OFF[type] || [], feature_flags: { ...industryDefaults(type), ...(byKey.get(`${type}:${plan.plan_code}`) || {}) } });
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
  paid_at: o.paid_at,
  paid_method: o.paid_method ?? null,
  receipt_sent_at: o.receipt_sent_at ?? null
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
        emailLink: req.body?.email_link === true,
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
  quantity: o.quantity ?? 1,
  amount: toRupees(o.amount_paise),
  billing_cycle: o.billing_cycle,
  payment_link_url: o.payment_link_url,
  status: o.status,
  created_at: o.created_at,
  paid_at: o.paid_at,
  paid_method: o.paid_method ?? null,
  receipt_sent_at: o.receipt_sent_at ?? null
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
  // only Extra outlet is sold by the piece; every other add-on is one switch
  const quantity = addonKey === 'extra_outlet' ? Number(req.body?.quantity ?? 1) : 1;

  if (!['MONTHLY', 'YEARLY'].includes(billingCycle)) {
    return res.status(400).json({ success: false, message: 'Billing cycle must be MONTHLY or YEARLY' });
  }
  if (!(Number.isInteger(quantity) && quantity >= 1 && quantity <= 50)) return res.status(400).json({ success: false, message: 'Number of outlets must be from 1 to 50' });

  try {
    const { rows: addonRows } = await pool.query(`SELECT * FROM addons WHERE addon_key = $1 AND is_active = TRUE`, [addonKey]);
    const addon = addonRows[0];
    if (!addon) return res.status(400).json({ success: false, message: 'Unknown or inactive add-on' });

    // Defaults to the catalog price; an admin may still type a different one for a negotiated deal,
    // same "custom price, not a fixed self-serve one" reasoning as the main subscription link.
    let amountPaise = (billingCycle === 'YEARLY' ? addon.price_yearly_paise : addon.price_monthly_paise) * quantity;
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
      `INSERT INTO addon_orders (business_id, addon_key, amount_paise, billing_cycle, created_by, quantity)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [businessId, addonKey, amountPaise, billingCycle, req.auth?.userId ?? null, quantity]
    );
    const order = orderRows[0];
    const linkId = `flowxp-addon-${order.order_id}`;

    let link;
    try {
      link = await cashfreeCreateLink({
        linkId,
        amount: toRupees(amountPaise),
        purpose: `FlowXP add-on: ${addon.name}${quantity > 1 ? ` x${quantity}` : ''} — ${business.name}`,
        customerName: business.owner_name,
        customerEmail: business.owner_email,
        customerPhone: business.owner_phone,
        emailLink: req.body?.email_link === true,
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
      metadata: { addon_key: addonKey, quantity, amount: toRupees(amountPaise), billing_cycle: billingCycle }
    });

    res.json({ success: true, data: asAddonOrder(updated[0]) });
  } catch (error) {
    console.error('[admin] create addon link failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not create the add-on link' });
  }
};
