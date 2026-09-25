/*
 * Signup, login, and password recovery.
 *
 * Signup does the whole Priority-1 job in one transaction: create the person,
 * create their business, start the trial, make them OWNER, open a primary
 * branch. Either all of that exists or none of it does — a user row with no
 * business, or a business with no owner, is a support ticket that has to be
 * fixed by hand in psql.
 */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import pool from '../config/database.js';
import { signToken } from '../middleware/auth.js';
import { newTrialWindow, subscriptionSummary } from '../modules/subscription.js';
import { recordAudit, recordEvent } from '../modules/events.js';
import { sendPasswordReset } from '../modules/mailer.js';
import {
  checkBusinessType, checkEmail, checkName, checkPassword, checkPhone,
  firstError, normaliseEmail
} from '../utils/validate.js';

/* Cost 12: roughly 250ms per hash on current hardware. Slow enough to make
   offline cracking expensive, fast enough that login does not feel broken. */
const BCRYPT_ROUNDS = 12;
const RESET_TTL_MS = 60 * 60 * 1000;

const publicUser = (user) => ({
  user_id: user.user_id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  email_verified: user.email_verified
});

/* ==========================================================================
   POST /api/auth/signup
   ========================================================================== */
export const signup = async (req, res) => {
  const { name, email, phone, password, business_name, business_type } = req.body || {};

  const error = firstError([
    checkName(name, 'Your name'),
    checkEmail(email),
    checkPhone(phone),
    checkPassword(password),
    checkName(business_name, 'Business name'),
    checkBusinessType(business_type)
  ]);
  if (error) return res.status(400).json({ success: false, message: error });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const emailLower = normaliseEmail(email);
    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);

    let user;
    try {
      user = (await client.query(
        `INSERT INTO users (name, email, phone, password_hash)
         VALUES ($1,$2,$3,$4)
         RETURNING user_id, name, email, phone, email_verified`,
        [String(name).trim(), emailLower, phone ? String(phone).trim() : null, passwordHash]
      )).rows[0];
    } catch (dbError) {
      // 23505 = unique_violation on users.email.
      if (dbError.code === '23505') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          success: false,
          message: 'An account already exists with this email. Sign in instead.'
        });
      }
      throw dbError;
    }

    const trial = newTrialWindow();
    const business = (await client.query(
      `INSERT INTO businesses
         (name, business_type, owner_user_id, email, phone,
          subscription_status, plan_code, trial_started_at, trial_ends_at)
       VALUES ($1,$2,$3,$4,$5,'TRIAL','TRIAL',$6,$7)
       RETURNING *`,
      [
        String(business_name).trim(),
        String(business_type).toUpperCase(),
        user.user_id,
        emailLower,
        phone ? String(phone).trim() : null,
        trial.trial_started_at,
        trial.trial_ends_at
      ]
    )).rows[0];

    /* One branch, created up front. Billing then never has to ask "which
       location" for the ~95% of businesses that only ever have one. */
    const branch = (await client.query(
      `INSERT INTO branches (business_id, name, is_primary)
       VALUES ($1,'Main',TRUE) RETURNING branch_id`,
      [business.business_id]
    )).rows[0];

    await client.query(
      `INSERT INTO business_users (business_id, user_id, role, branch_id, status)
       VALUES ($1,$2,'OWNER',NULL,'ACTIVE')`,
      [business.business_id, user.user_id]
    );

    await client.query('COMMIT');

    recordEvent('signup', { userId: user.user_id, businessId: business.business_id });
    recordEvent('trial_started', {
      userId: user.user_id,
      businessId: business.business_id,
      properties: { trial_ends_at: trial.trial_ends_at }
    });
    recordEvent('business_created', {
      userId: user.user_id,
      businessId: business.business_id,
      properties: { business_type: business.business_type }
    });
    recordAudit(req, {
      business_id: business.business_id,
      user_id: user.user_id,
      action: 'business.created',
      resource_type: 'business',
      resource_id: business.business_id
    });

    res.status(201).json({
      success: true,
      data: {
        token: signToken(user),
        user: publicUser(user),
        business: {
          business_id: business.business_id,
          name: business.name,
          business_type: business.business_type,
          currency: business.currency,
          onboarding_step: business.onboarding_step,
          primary_branch_id: branch.branch_id,
          role: 'OWNER',
          subscription: subscriptionSummary(business)
        }
      }
    });
  } catch (dbError) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[auth] signup failed:', dbError.message);
    res.status(500).json({ success: false, message: 'Could not create your account' });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   POST /api/auth/login
   ========================================================================== */
export const login = async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Enter your email and password' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT user_id, name, email, phone, password_hash, email_verified, is_super_admin
       FROM users WHERE email = $1`,
      [normaliseEmail(email)]
    );

    const user = rows[0];
    /* Hash against a dummy when the user does not exist, so a missing account
       and a wrong password take the same time. Skipping this leaks which
       addresses are registered to anyone with a stopwatch. */
    const hash = user?.password_hash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const ok = await bcrypt.compare(String(password), hash);

    if (!user || !ok) {
      return res.status(401).json({ success: false, message: 'Email or password is incorrect' });
    }

    /* A super admin owns no business — this endpoint would sign them in fine
       (right password) and then hand the frontend an empty businesses array,
       which reads as "logged in but nothing works": no dashboard data, bounced
       to onboarding with no business to create. That confusion is the bug
       report this guards against — the platform console at /superadmin/login
       is the only front door for this account. */
    if (user.is_super_admin) {
      return res.status(401).json({
        success: false,
        message: 'This account signs in at /superadmin, not here'
      });
    }

    pool.query(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = $1`, [user.user_id])
      .catch(() => {});

    const businesses = (await pool.query(
      `SELECT bu.role, b.business_id, b.name, b.business_type, b.currency, b.onboarding_step,
              b.subscription_status, b.plan_code, b.billing_cycle,
              b.trial_started_at, b.trial_ends_at, b.next_billing_date
       FROM business_users bu
       JOIN businesses b ON b.business_id = bu.business_id
       WHERE bu.user_id = $1 AND bu.status = 'ACTIVE' AND b.status <> 'CLOSED'
       ORDER BY b.business_id`,
      [user.user_id]
    )).rows;

    res.json({
      success: true,
      data: {
        token: signToken(user),
        user: publicUser(user),
        businesses: businesses.map((b) => ({
          business_id: b.business_id,
          name: b.name,
          business_type: b.business_type,
          currency: b.currency,
          onboarding_step: b.onboarding_step,
          role: b.role,
          subscription: subscriptionSummary(b)
        }))
      }
    });
  } catch (error) {
    console.error('[auth] login failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not sign you in' });
  }
};

/* ==========================================================================
   GET /api/auth/me
   ========================================================================== */
export const me = async (req, res) => {
  // Outlets per business, so the app can offer an outlet switcher. A pinned user sees only their own.
  const outlets = (await pool.query(
    `SELECT business_id, branch_id, name, is_primary FROM branches WHERE status = 'ACTIVE' AND business_id = ANY($1::int[]) ORDER BY is_primary DESC, branch_id`,
    [req.memberships.map((m) => m.business_id)]
  )).rows;
  res.json({
    success: true,
    data: {
      user: publicUser(req.auth.user),
      businesses: req.memberships.map((m) => ({
        business_id: m.business_id,
        name: m.name,
        business_type: m.business_type,
        currency: m.currency,
        onboarding_step: m.onboarding_step,
        gst_enabled: m.gst_enabled,
        role: m.role,
        branch_id: m.branch_id,
        outlets: outlets.filter((o) => o.business_id === m.business_id && (m.branch_id == null || o.branch_id === m.branch_id))
          .map((o) => ({ branch_id: o.branch_id, name: o.name, is_primary: o.is_primary })),
        subscription: subscriptionSummary(m)
      }))
    }
  });
};

/* ==========================================================================
   POST /api/auth/forgot-password
   ========================================================================== */
export const forgotPassword = async (req, res) => {
  const email = normaliseEmail(req.body?.email);

  /* The same answer whether or not the address is registered. Any difference
     here — status code, message, timing — turns this endpoint into a way to
     test which of a leaked email list has FlowXP accounts. */
  const genericReply = () => res.json({
    success: true,
    message: 'If that email has an account, a reset link is on its way.'
  });

  if (checkEmail(email)) return genericReply();

  try {
    const { rows } = await pool.query(
      `SELECT user_id, name, email FROM users WHERE email = $1`, [email]
    );
    if (!rows.length) return genericReply();

    const user = rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    /* Invalidate outstanding links first. Without this, a reset requested by
       someone who has taken over the mailbox stays valid alongside the real
       owner's. */
    await pool.query(
      `UPDATE password_resets SET used_at = CURRENT_TIMESTAMP
       WHERE user_id = $1 AND used_at IS NULL`,
      [user.user_id]
    );
    await pool.query(
      `INSERT INTO password_resets (token_hash, user_id, expires_at)
       VALUES ($1,$2,$3)`,
      [tokenHash, user.user_id, new Date(Date.now() + RESET_TTL_MS)]
    );

    await sendPasswordReset(user.email, user.name, token);
    genericReply();
  } catch (error) {
    console.error('[auth] forgot-password failed:', error.message);
    genericReply();
  }
};

/* ==========================================================================
   POST /api/auth/reset-password
   ========================================================================== */
export const resetPassword = async (req, res) => {
  const { token, password } = req.body || {};
  const error = checkPassword(password);
  if (error) return res.status(400).json({ success: false, message: error });
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ success: false, message: 'This reset link is not valid' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows } = await pool.query(
      `SELECT user_id FROM password_resets
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
      [tokenHash]
    );
    if (!rows.length) {
      return res.status(400).json({
        success: false,
        message: 'This reset link has expired. Request a new one.'
      });
    }

    const userId = rows[0].user_id;
    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);

    await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
      [passwordHash, userId]
    );
    await pool.query(
      `UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE token_hash = $1`,
      [tokenHash]
    );

    recordAudit(req, { user_id: userId, action: 'user.password_reset', resource_type: 'user', resource_id: userId });
    res.json({ success: true, message: 'Password updated. Sign in with your new password.' });
  } catch (dbError) {
    console.error('[auth] reset-password failed:', dbError.message);
    res.status(500).json({ success: false, message: 'Could not reset your password' });
  }
};
