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
import { readChallenge, signChallenge, signToken, setSessionCookie } from '../middleware/auth.js';
import { alertNewDevice, decryptSecret, lockedMinutes, recordLogin, recoveryCodesLeft, useRecoveryCode, verifyTotp } from '../modules/security.js';
import { newTrialWindow, subscriptionSummary } from '../modules/subscription.js';
import { effectivePermissions } from '../modules/permissions.js';
import { recordAudit, recordEvent } from '../modules/events.js';
import { sendEmailOtp, sendPasswordReset } from '../modules/mailer.js';
import { emailProblem } from '../utils/emailCheck.js';
import { addDefaultOptionGroups, FOOD_TYPES } from '../modules/defaultOptions.js';
import {
  checkBusinessType, checkEmail, checkName, checkPassword, checkPhone,
  firstError, normaliseEmail
} from '../utils/validate.js';

/* Cost 12: roughly 250ms per hash on current hardware. Slow enough to make
   offline cracking expensive, fast enough that login does not feel broken. */
const BCRYPT_ROUNDS = 12;
const RESET_TTL_MS = 10 * 60 * 1000;   // a typed code, not a clicked link — 10 minutes is plenty and matches the email's own wording
const OTP_TTL_MS = 10 * 60 * 1000;

/*
 * Email OTP verification — the first sign-in on a new account (whether it's finishing signup or a later login
 * attempt before the previous code was ever entered) is gated on a 6-digit code sent to the address on file.
 * Once verified, email_verified stays true and this never runs again for that account — not "every time",
 * only "the first time". The code is stored as a hash on the user's own row (modules/security.js's existing
 * lockout, keyed off login_events, covers brute-forcing it — no separate attempts counter needed).
 */
const issueEmailOtp = async (user) => {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const hash = crypto.createHash('sha256').update(code).digest('hex');
  await pool.query(
    `UPDATE users SET email_otp_hash = $2, email_otp_expires_at = $3 WHERE user_id = $1`,
    [user.user_id, hash, new Date(Date.now() + OTP_TTL_MS)]
  );
  // Not awaited: the code is already saved, so the person moves on to "enter the code" at once while the email
  // goes out in the background (sendMail retries and never throws; Resend code is there if it never arrives).
  sendEmailOtp(user.email, user.name, code).catch((error) => console.error("[auth] code email failed:", error.message));
};
const emailOtpChallenge = (user) => signChallenge(user, { purpose: 'email_otp', expiresIn: '10m' });

/* A real hash of a random password, so an unknown address costs the same time as a wrong password. (A malformed
   string would make bcrypt return at once, and the difference in timing would tell an attacker which addresses exist.) */
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

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
  const { name, email, phone, password, business_name, business_type, accepted_terms: acceptedTerms } = req.body || {};

  const error = firstError([
    checkName(name, 'Your name'),
    checkEmail(email),
    checkPhone(phone),
    checkPassword(password),
    checkName(business_name, 'Business name'),
    checkBusinessType(business_type),
    // Checked here too, not only by the signup form's disabled button — a
    // direct API call must not be able to create an account without it.
    acceptedTerms ? null : 'You must agree to the Terms and Privacy Policy to create an account'
  ]);
  if (error) return res.status(400).json({ success: false, message: error });

  // Before an account exists and before any code is sent: an address nobody can receive mail at (a typo like
  // gmial.com or gmail.con, a domain that does not exist) is refused here, with what to fix.
  const emailError = await emailProblem(email);
  if (emailError) return res.status(400).json({ success: false, message: emailError, code: 'EMAIL_UNDELIVERABLE' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const emailLower = normaliseEmail(email);
    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);

    let user;
    try {
      user = (await client.query(
        `INSERT INTO users (name, email, phone, password_hash, terms_accepted_at)
         VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)
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
          subscription_status, plan_code, plan_version_id, trial_started_at, trial_ends_at)
       VALUES ($1,$2,$3,$4,$5,'TRIAL','TRIAL',
               (SELECT plan_version_id FROM plan_versions WHERE plan_code = 'TRIAL' AND effective_to IS NULL),
               $6,$7)
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
    await client.query(
      `INSERT INTO branches (business_id, name, is_primary)
       VALUES ($1,'Main',TRUE)`,
      [business.business_id]
    );

    if (FOOD_TYPES.includes(business.business_type)) await addDefaultOptionGroups(client, business.business_id, business.business_type);

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

    // First sign-in on a brand new account is always unverified — send the code before handing out a session.
    await issueEmailOtp(user);
    res.status(201).json({
      success: true,
      data: { requires_email_otp: true, challenge: emailOtpChallenge(user) }
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
/* What a signed-in session looks like to the app: the token, the person and their businesses. */
const sessionPayload = async (user) => {
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
  return {
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
  };
};

const LOCKED = (minutes) => `Too many failed attempts on this account. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}, or reset your password.`;

/** A finished sign-in: remember it, warn about a new device, hand back the session. */
const finishLogin = async (req, res, user, method) => {
  const { newDevice } = await recordLogin(pool, { userId: user.user_id, email: user.email, req, outcome: 'SUCCESS', method });
  if (newDevice) alertNewDevice(user, req);
  pool.query(`UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = $1`, [user.user_id]).catch(() => {});
  const session = await sessionPayload(user);
  setSessionCookie(res, session.token);
  res.json({ success: true, data: { ...session, new_device: newDevice } });
};

/* ==========================================================================
   POST /api/auth/login

   Password first. With two-step verification on, a correct password only earns
   a short-lived challenge; the session comes from POST /auth/login/2fa.
   Five failures in a row on one address lock it for a quarter of an hour, so a
   guessing attack has to be spread over many addresses and many IPs.
   ========================================================================== */
export const login = async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Enter your email and password' });
  }

  try {
    const address = normaliseEmail(email);
    const locked = await lockedMinutes(pool, address);
    if (locked) {
      await recordLogin(pool, { email: address, req, outcome: 'LOCKED' });
      return res.status(429).json({ success: false, message: LOCKED(locked) });
    }

    const { rows } = await pool.query(
      `SELECT user_id, name, email, phone, password_hash, email_verified, is_super_admin, token_version, totp_enabled
       FROM users WHERE email = $1`,
      [address]
    );

    const user = rows[0];
    const ok = await bcrypt.compare(String(password), user?.password_hash || DUMMY_HASH);

    if (!user || !ok) {
      await recordLogin(pool, { userId: user?.user_id ?? null, email: address, req, outcome: user ? 'BAD_PASSWORD' : 'UNKNOWN_USER' });
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

    // Finishing a first sign-in that never got past the email code: send a fresh one rather than assume the
    // old email is still sitting in their inbox. Checked before 2FA — an account can't have set 2FA up
    // without already having signed in once, so the two gates never both apply in practice.
    if (!user.email_verified) {
      await issueEmailOtp(user);
      return res.json({ success: true, data: { requires_email_otp: true, challenge: emailOtpChallenge(user) } });
    }
    if (user.totp_enabled) {
      return res.json({ success: true, data: { requires_2fa: true, challenge: signChallenge(user) } });
    }
    await finishLogin(req, res, user, 'PASSWORD');
  } catch (error) {
    console.error('[auth] login failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not sign you in' });
  }
};

/* ==========================================================================
   POST /api/auth/login/2fa { challenge, code | recovery_code }
   ========================================================================== */
export const loginTwoFactor = async (req, res) => {
  const { challenge, code, recovery_code: recovery } = req.body || {};
  const claim = readChallenge(challenge);
  if (!claim) return res.status(401).json({ success: false, message: 'That sign-in took too long. Enter your password again.' });

  try {
    const user = (await pool.query(
      `SELECT user_id, name, email, phone, email_verified, is_super_admin, token_version, totp_enabled, totp_secret_enc, totp_last_step FROM users WHERE user_id = $1`, [claim.sub])).rows[0];
    // a password change or sign-out-everywhere since the password step voids the challenge
    if (!user || !user.totp_enabled || user.token_version !== (claim.tv ?? 0)) return res.status(401).json({ success: false, message: 'That sign-in took too long. Enter your password again.' });

    const locked = await lockedMinutes(pool, user.email);
    if (locked) {
      await recordLogin(pool, { userId: user.user_id, email: user.email, req, outcome: 'LOCKED' });
      return res.status(429).json({ success: false, message: LOCKED(locked) });
    }

    let method = null;
    if (recovery) {
      if (await useRecoveryCode(pool, user.user_id, recovery)) method = 'RECOVERY';
    } else {
      const step = verifyTotp(decryptSecret(user.totp_secret_enc), code, { lastStep: user.totp_last_step });
      // remember the step, so this same code can't be used a second time
      if (step != null && (await pool.query(`UPDATE users SET totp_last_step = $2 WHERE user_id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)`, [user.user_id, step])).rowCount === 1) method = '2FA';
    }
    if (!method) {
      await recordLogin(pool, { userId: user.user_id, email: user.email, req, outcome: 'TWO_FACTOR_FAILED' });
      return res.status(401).json({ success: false, message: recovery ? 'That recovery code is not valid, or was already used.' : 'That code is not right. Codes change every 30 seconds.' });
    }
    if (method === 'RECOVERY') recordAudit(req, { user_id: user.user_id, action: 'user.recovery_code_used', resource_type: 'user', resource_id: user.user_id, metadata: { left: await recoveryCodesLeft(pool, user.user_id) } });
    await finishLogin(req, res, user, method);
  } catch (error) {
    console.error('[auth] 2fa login failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not sign you in' });
  }
};

/* ==========================================================================
   POST /api/auth/verify-email { challenge, code }

   Finishes whichever step issued the challenge (signup or a login on an unverified account) with the same
   session shape login() hands back — the frontend's existing "sign in succeeded" handling covers both.
   ========================================================================== */
export const verifyEmailOtp = async (req, res) => {
  const { challenge, code } = req.body || {};
  const claim = readChallenge(challenge, 'email_otp');
  if (!claim) return res.status(401).json({ success: false, message: 'That took too long. Sign in again.' });

  try {
    const user = (await pool.query(
      `SELECT user_id, name, email, phone, email_verified, is_super_admin, token_version, totp_enabled, email_otp_hash, email_otp_expires_at
       FROM users WHERE user_id = $1`, [claim.sub])).rows[0];
    // a password change or sign-out-everywhere since the code was sent voids the challenge
    if (!user || user.token_version !== (claim.tv ?? 0)) return res.status(401).json({ success: false, message: 'That took too long. Sign in again.' });

    const locked = await lockedMinutes(pool, user.email);
    if (locked) {
      await recordLogin(pool, { userId: user.user_id, email: user.email, req, outcome: 'LOCKED' });
      return res.status(429).json({ success: false, message: LOCKED(locked) });
    }

    const given = String(code ?? '').replace(/\s/g, '');
    const expired = !user.email_otp_expires_at || new Date(user.email_otp_expires_at) <= new Date();
    const hash = given ? crypto.createHash('sha256').update(given).digest('hex') : null;
    const valid = !expired && user.email_otp_hash && hash === user.email_otp_hash;

    if (!valid) {
      await recordLogin(pool, { userId: user.user_id, email: user.email, req, outcome: 'EMAIL_OTP_FAILED' });
      return res.status(401).json({ success: false, message: expired ? 'That code has expired. Request a new one.' : 'That code is not right.' });
    }

    await pool.query(`UPDATE users SET email_verified = TRUE, email_otp_hash = NULL, email_otp_expires_at = NULL WHERE user_id = $1`, [user.user_id]);
    user.email_verified = true;   // so the session payload below reflects it immediately, not the pre-update read
    recordAudit(req, { user_id: user.user_id, action: 'user.email_verified', resource_type: 'user', resource_id: user.user_id });
    await finishLogin(req, res, user, 'EMAIL_OTP');
  } catch (error) {
    console.error('[auth] verify-email failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not verify your email' });
  }
};

/* ==========================================================================
   POST /api/auth/resend-email-otp { challenge }
   ========================================================================== */
export const resendEmailOtp = async (req, res) => {
  const claim = readChallenge(req.body?.challenge, 'email_otp');
  if (!claim) return res.status(401).json({ success: false, message: 'That took too long. Sign in again.' });

  try {
    const user = (await pool.query(`SELECT user_id, name, email, token_version FROM users WHERE user_id = $1`, [claim.sub])).rows[0];
    if (!user || user.token_version !== (claim.tv ?? 0)) return res.status(401).json({ success: false, message: 'That took too long. Sign in again.' });

    const locked = await lockedMinutes(pool, user.email);
    if (locked) return res.status(429).json({ success: false, message: LOCKED(locked) });

    await issueEmailOtp(user);
    // a fresh challenge too: the new code lives 10 minutes, and the page's session should not die before it
    res.json({ success: true, message: 'A new code is on its way.', data: { challenge: emailOtpChallenge(user) } });
  } catch (error) {
    console.error('[auth] resend-email-otp failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not send a new code' });
  }
};

/* ==========================================================================
   GET /api/auth/me
   ========================================================================== */
export const me = async (req, res) => {
  // a fresh cookie on every app start: the session slides forward while it is in use (same token_version, so
  // sign-out-everywhere still ends it), and a browser that sent the old Authorization header gets its cookie here
  const refreshed = signToken(req.auth.user);
  setSessionCookie(res, refreshed);
  // Outlets per business, so the app can offer an outlet switcher. A pinned user sees only their own.
  const outlets = (await pool.query(
    `SELECT business_id, branch_id, name, is_primary FROM branches WHERE status = 'ACTIVE' AND business_id = ANY($1::int[]) ORDER BY is_primary DESC, branch_id`,
    [req.memberships.map((m) => m.business_id)]
  )).rows;
  res.json({
    success: true,
    data: {
      // the mobile app signs in with a Bearer token (no cookie jar) and slides it forward here; a browser never gets the token in
      // a response its scripts can read, which is the point of the httpOnly cookie
      ...(req.authVia === 'header' ? { token: refreshed } : {}),
      user: { ...publicUser(req.auth.user), two_factor_enabled: Boolean(req.auth.user.totp_enabled) },
      businesses: req.memberships.map((m) => ({
        business_id: m.business_id,
        name: m.name,
        business_type: m.business_type,
        currency: m.currency,
        onboarding_step: m.onboarding_step,
        gst_enabled: m.gst_enabled,
        // a distributor, or a wholesaler who switched the distributor features on: the app shows the Distributor menu
        distributor_enabled: Boolean(m.distributor_enabled),
        upi_vpa: m.upi_vpa || null,   // the till shows a UPI QR for this ID
        two_factor_required: Boolean(m.require_2fa_admins) && ['OWNER', 'ADMIN'].includes(m.role),
        role: m.role,
        // this person's own permission overrides, so the app can show a sidebar
        // and screens that match what they can actually do, not just their role
        permissions: m.permissions || {},
        // what this person can actually do (role defaults with their overrides applied): the mobile app shows only that
        effective_permissions: effectivePermissions(m.role, m.permissions || {}),
        // what a till must know to ask for a manager's PIN when one is needed
        approval: { needed: effectivePermissions(m.role, m.permissions || {}).approvals !== true, discount_cap_pct: Number(m.discount_cap_pct ?? 100), cancel_needs_approval: m.cancel_needs_approval !== false },
        branch_id: m.branch_id,
        outlets: outlets.filter((o) => o.business_id === m.business_id && (m.branch_id == null || o.branch_id === m.branch_id))
          .map((o) => ({ branch_id: o.branch_id, name: o.name, is_primary: o.is_primary })),
        subscription: subscriptionSummary(m)
      }))
    }
  });
};

/* ==========================================================================
   POST /api/auth/forgot-password { email }

   Emails a 6-digit code rather than a link — entered on the same screen that asked for it, no separate page
   to land on. Still the one genuine-looking reply regardless of whether the address has an account.
   ========================================================================== */
export const forgotPassword = async (req, res) => {
  const email = normaliseEmail(req.body?.email);

  /* The same answer whether or not the address is registered. Any difference
     here — status code, message, timing — turns this endpoint into a way to
     test which of a leaked email list has FlowXP accounts. */
  const genericReply = () => res.json({
    success: true,
    message: 'If that email has an account, a code is on its way.'
  });

  if (checkEmail(email)) return genericReply();

  try {
    const { rows } = await pool.query(
      `SELECT user_id, name, email FROM users WHERE email = $1`, [email]
    );
    if (!rows.length) return genericReply();

    const user = rows[0];
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');

    /* Invalidate outstanding codes first. Without this, a reset requested by
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
      [codeHash, user.user_id, new Date(Date.now() + RESET_TTL_MS)]
    );

    sendPasswordReset(user.email, user.name, code).catch((error) => console.error("[auth] reset email failed:", error.message));   // in the background, as for sign-up codes
    genericReply();
  } catch (error) {
    console.error('[auth] forgot-password failed:', error.message);
    genericReply();
  }
};

/* ==========================================================================
   POST /api/auth/reset-password { email, code, password }

   The code, not a token from a link, so `email` is needed to know whose lockout counter and whose pending
   code to check against — the same login_events-based lockout as a wrong login password or wrong 2FA/email
   code (see modules/security.js's lockedMinutes) protects a 6-digit code from being guessable in practice.
   ========================================================================== */
export const resetPassword = async (req, res) => {
  const email = normaliseEmail(req.body?.email);
  const code = String(req.body?.code ?? '').replace(/\s/g, '');
  const { password } = req.body || {};
  const error = checkPassword(password);
  if (error) return res.status(400).json({ success: false, message: error });
  if (checkEmail(email)) return res.status(400).json({ success: false, message: 'Enter the email you requested the code with' });
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ success: false, message: 'Enter the 6-digit code' });

  try {
    const user = (await pool.query(`SELECT user_id FROM users WHERE email = $1`, [email])).rows[0];
    // the same wrong answer whether the address or the code is what's wrong — nothing here should confirm an address exists
    const wrong = () => res.status(400).json({ success: false, message: 'That code is not right, or has expired. Request a new one.' });
    if (!user) return wrong();

    const locked = await lockedMinutes(pool, email);
    if (locked) return res.status(429).json({ success: false, message: LOCKED(locked) });

    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const { rows } = await pool.query(
      `SELECT token_hash FROM password_resets
       WHERE user_id = $1 AND token_hash = $2 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
      [user.user_id, codeHash]
    );
    if (!rows.length) {
      await recordLogin(pool, { userId: user.user_id, email, req, outcome: 'PASSWORD_RESET_FAILED' });
      return wrong();
    }

    const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
    await pool.query(
      `UPDATE users SET password_hash = $1, token_version = token_version + 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
      [passwordHash, user.user_id]
    );
    await pool.query(
      `UPDATE password_resets SET used_at = CURRENT_TIMESTAMP WHERE token_hash = $1`,
      [rows[0].token_hash]
    );

    recordAudit(req, { user_id: user.user_id, action: 'user.password_reset', resource_type: 'user', resource_id: user.user_id });
    res.json({ success: true, message: 'Password updated. Sign in with your new password.' });
  } catch (dbError) {
    console.error('[auth] reset-password failed:', dbError.message);
    res.status(500).json({ success: false, message: 'Could not reset your password' });
  }
};
