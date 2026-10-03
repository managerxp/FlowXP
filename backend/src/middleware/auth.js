/*
 * Authentication and tenant isolation.
 *
 * This is the most security-sensitive file in FlowXP, because every other
 * route trusts it. The rule it enforces:
 *
 *     A business_id arriving from the client is a CLAIM, never an instruction.
 *
 * Callers may put a business id in a header, a body or a query string, and
 * every one of those is checked against the requesting user's membership rows
 * before anything is read or written. Downstream code reads `req.tenant`,
 * which is derived here and cannot be influenced by the caller. A user who
 * asks for someone else's business gets the same answer as one who asks for a
 * business that does not exist — see the 404 note below.
 */
import jwt from 'jsonwebtoken';
import pool from '../config/database.js';
import config from '../config/env.js';
import { effectiveStatus, persistExpiryIfNeeded, subscriptionSummary } from '../modules/subscription.js';
import { hasPlanFeature, effectiveFeatureFlags } from '../modules/planFeatures.js';

/* ==========================================================================
   ROLES AND PERMISSIONS
   ========================================================================== */

/*
 * What each role may do, as a default. business_users.permissions can grant or
 * revoke individual entries per user, which is what "Owners must be able to
 * control permissions" means in practice.
 *
 * '*' is every permission. Only OWNER holds it, and only OWNER can change
 * other people's permissions — otherwise an ADMIN could promote themselves.
 */
export const ROLE_PERMISSIONS = {
  OWNER:   ['*'],
  ADMIN:   ['billing', 'products', 'inventory', 'barcode_reassign', 'product_quick_add', 'purchases', 'customers', 'suppliers',
            'payments', 'expenses', 'gst', 'reports', 'export', 'ai', 'settings', 'refunds',
            'appointments', 'staff_commission', 'sales_orders', 'sales_cancel', 'fulfilment', 'pricing', 'purchase_approve',
            'principals', 'territories', 'schemes', 'targets', 'vehicles', 'field_sales', 'collections', 'prescriptions', 'dispensing'],
  MANAGER: ['billing', 'products', 'inventory', 'barcode_reassign', 'product_quick_add', 'purchases', 'customers', 'suppliers',
            'payments', 'expenses', 'reports', 'ai', 'refunds', 'appointments', 'staff_commission',
            'sales_orders', 'sales_cancel', 'fulfilment', 'pricing', 'purchase_approve',
            'principals', 'territories', 'schemes', 'targets', 'vehicles', 'field_sales', 'collections', 'prescriptions', 'dispensing'],
  CASHIER: ['billing', 'customers', 'payments'],
  STAFF:   ['billing'],
  // Restaurant floor roles. WAITER can take and bill orders like STAFF; KITCHEN
  // sees and advances tickets only; INVENTORY_MANAGER runs stock and buying.
  WAITER:  ['billing'],
  KITCHEN: ['kitchen'],
  INVENTORY_MANAGER: ['inventory', 'barcode_reassign', 'purchases', 'suppliers'],
  // A rider sees and updates the delivery orders assigned to them — same
  // narrow scope as WAITER, since orders.controller.js already gates all of
  // this behind the 'billing' permission Orders itself uses.
  DELIVERY: ['billing', 'fulfilment'],
  // Salon floor roles. A receptionist books, bills and looks after clients; a stylist sees their own
  // appointments (the appointments screens narrow a STYLIST to the salon_staff row linked to their login);
  // an accountant works the money side — billing records, payments, expenses, reports and GST — and cannot
  // change the catalogue or the team.
  RECEPTIONIST: ['billing', 'customers', 'payments', 'appointments'],
  STYLIST: ['appointments'],
  ACCOUNTANT: ['billing', 'payments', 'expenses', 'gst', 'reports', 'export', 'refunds', 'collections'],
  // Wholesale roles. Sales people take and manage orders; warehouse people pick, pack, receive and count; the
  // purchase manager buys and approves; the accountant (above) owns money, GST and reports.
  SALES_MANAGER: ['billing', 'customers', 'payments', 'reports', 'refunds', 'sales_orders', 'sales_cancel', 'pricing', 'export', 'territories', 'schemes', 'targets', 'field_sales', 'collections'],
  SALES_EXECUTIVE: ['billing', 'customers', 'sales_orders', 'field_sales'],
  WAREHOUSE_MANAGER: ['inventory', 'purchases', 'fulfilment', 'suppliers', 'vehicles'],
  WAREHOUSE_STAFF: ['fulfilment'],
  PURCHASE_MANAGER: ['purchases', 'suppliers', 'inventory', 'purchase_approve', 'payments', 'reports', 'principals'],
  // Distributor roles. A field rep sells and collects for their own beat; a collection executive only collects; the
  // delivery manager runs the vans and the drivers' work; the distributor admin runs the business day to day.
  FIELD_SALES: ['customers', 'sales_orders', 'field_sales', 'collections'],
  COLLECTION_EXECUTIVE: ['customers', 'collections', 'field_sales'],
  DELIVERY_MANAGER: ['fulfilment', 'vehicles', 'inventory'],
  DISTRIBUTOR_ADMIN: ['billing', 'products', 'inventory', 'purchases', 'customers', 'suppliers', 'payments', 'expenses', 'gst', 'reports', 'export', 'ai', 'settings', 'refunds',
            'sales_orders', 'sales_cancel', 'fulfilment', 'pricing', 'purchase_approve', 'principals', 'territories', 'schemes', 'targets', 'vehicles', 'field_sales', 'collections'],
  // Pharmacy roles. A pharmacist sells, views stock and dispenses against a prescription, but does not approve
  // adjustments or edit the medicine master; sales staff is narrower still (no inventory at all — product lookups
  // for billing ride on 'billing' itself, same as CASHIER); a GRN manager receives goods and runs suppliers but
  // cannot approve adjustments or touch the catalogue; an auditor reads reports and the activity log only.
  PHARMACIST: ['billing', 'inventory', 'prescriptions', 'dispensing', 'customers'],
  SALES_STAFF: ['billing', 'customers'],
  GRN_MANAGER: ['purchases', 'inventory', 'suppliers'],
  AUDITOR: ['reports', 'export']
};

export const hasPermission = (tenant, permission) => {
  if (!tenant) return false;
  const base = ROLE_PERMISSIONS[tenant.role] || [];
  if (base.includes('*')) return true;
  // Per-user override wins over the role default, in both directions.
  const override = tenant.permissions?.[permission];
  if (override === true) return true;
  if (override === false) return false;
  return base.includes(permission);
};

/* ==========================================================================
   TOKENS
   ========================================================================== */

/* `tv` is the user's session version: raising it (sign out everywhere, a password change or reset) ends every token
   issued before, without a denylist. Tokens from before this existed have no `tv` and count as version 0. */
export const signToken = (user) =>
  jwt.sign(
    { sub: user.user_id, email: user.email, tv: user.token_version ?? 0 },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn, algorithm: 'HS256' }
  );

/*
 * A short-lived token that proves one step of sign-in was completed and only the next is left. It is not a
 * session. `purpose` keeps a 2FA challenge from being replayed as an email-OTP challenge or vice versa —
 * each readChallenge() call names the one purpose it will accept.
 */
export const signChallenge = (user, { purpose = '2fa', expiresIn = '5m' } = {}) =>
  jwt.sign({ sub: user.user_id, purpose, tv: user.token_version ?? 0 }, config.jwtSecret, { expiresIn, algorithm: 'HS256' });

export const readChallenge = (token, purpose = '2fa') => {
  try {
    const p = jwt.verify(String(token ?? ''), config.jwtSecret, { algorithms: ['HS256'] });
    return p.purpose === purpose ? p : null;
  } catch { return null; }
};

/* ── The session cookie ──────────────────────────────────────────────────────
   The browser's session is a cookie the page's own JavaScript cannot read (httpOnly), so a script injected into
   the page could not steal it, as it could a token kept in localStorage. Secure in production (https only),
   SameSite=Lax (not sent on another site's form posts or background requests), and scoped to /api, the only
   place it is needed. The Authorization header still works too: the print agent, scripts and tests use it, and a
   browser signed in before the cookie existed is moved over on its next /auth/me. */
export const SESSION_COOKIE = 'flowxp_session';
const cookieOptions = () => ({ httpOnly: true, secure: config.isProduction, sameSite: 'lax', path: '/api' });

const cookieValue = (req, name) => {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
};

/** Put a session token in the browser's cookie, for as long as the token itself is valid. */
export const setSessionCookie = (res, token) => {
  if (typeof res.cookie !== 'function' || !token) return;    // a test double with no cookie jar
  const exp = jwt.decode(token)?.exp;
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), ...(exp ? { maxAge: exp * 1000 - Date.now() } : {}) });
};

export const clearSessionCookie = (res) => {
  if (typeof res.clearCookie === 'function') res.clearCookie(SESSION_COOKIE, cookieOptions());
};

/* Which token came with the request, and how. The header wins, so a script with a token is never confused by a
   stale cookie from a browser session. */
const presented = (req) => {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return { token: header.slice(7).trim(), via: 'header' };
  const cookie = cookieValue(req, SESSION_COOKIE);
  return cookie ? { token: cookie, via: 'cookie' } : { token: null, via: null };
};

const readToken = (req) => {
  const { token, via } = presented(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    if (payload.purpose) return null;             // a half-finished sign-in (2FA challenge) is not a session
    req.authVia = via;
    return payload;
  } catch {
    // Expired, forged or malformed all mean the same thing here: no session.
    return null;
  }
};

/* Cross-site request forgery: a browser attaches a cookie on its own, so a change made with the cookie must also
   carry X-Requested-With: FlowXP, which lib/api.js always sends and which another site's page cannot add without
   passing CORS (refused by server.js for any origin not on the list). Reads (GET/HEAD/OPTIONS) change nothing. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const forged = (req) => req.authVia === 'cookie' && !SAFE_METHODS.has(req.method) && req.headers['x-requested-with'] !== 'FlowXP';

/* ==========================================================================
   MIDDLEWARE
   ========================================================================== */

/**
 * Require a signed-in user. Attaches req.auth and req.memberships.
 *
 * Does not choose a business — /api/me legitimately spans all of them, and
 * a user with two businesses needs to see both before picking one.
 */
export const requireAuth = async (req, res, next) => {
  const payload = readToken(req);
  if (!payload?.sub) {
    return res.status(401).json({ success: false, message: 'Sign in to continue' });
  }
  if (forged(req)) {
    return res.status(403).json({ success: false, message: 'This request did not come from the FlowXP app.' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT u.user_id, u.name, u.email, u.phone, u.email_verified, u.is_super_admin, u.token_version, u.totp_enabled
       FROM users u WHERE u.user_id = $1`,
      [payload.sub]
    );
    // gone, or the sessions were ended (sign out everywhere, password change or reset)
    if (!rows.length || (payload.tv ?? 0) !== rows[0].token_version) {
      return res.status(401).json({ success: false, message: 'Sign in to continue' });
    }

    req.auth = {
      userId: rows[0].user_id,
      email: rows[0].email,
      user: rows[0],
      isSuperAdmin: rows[0].is_super_admin
    };
    req.memberships = (await pool.query(
      `SELECT bu.business_id, bu.role, bu.branch_id, bu.permissions,
              b.name, b.business_type, b.status AS business_status,
              b.subscription_status, b.plan_code, b.billing_cycle,
              b.trial_started_at, b.trial_ends_at, b.next_billing_date,
              b.currency, b.onboarding_step, b.gst_enabled, b.require_2fa_admins, b.upi_vpa,
              -- feature_flags come from the business's PINNED plan version, not the plan's current
              -- (possibly since-changed) values — see modules/planFeatures.js and migration 0038.
              COALESCE(pv.feature_flags, p.feature_flags, '{}'::jsonb) AS feature_flags,
              COALESCE(btf.feature_flags, '{}'::jsonb) AS business_type_feature_flags,
              COALESCE(bfo.overrides, '{}'::jsonb) AS feature_overrides,
              (b.business_type = 'DISTRIBUTOR' OR COALESCE(wss.distributor_enabled, FALSE)) AS distributor_enabled
       FROM business_users bu
       JOIN businesses b ON b.business_id = bu.business_id
       LEFT JOIN wholesale_settings wss ON wss.business_id = b.business_id
       LEFT JOIN plans p ON p.plan_code = b.plan_code
       LEFT JOIN plan_versions pv ON pv.plan_version_id = b.plan_version_id
       LEFT JOIN business_type_features btf ON btf.business_type = b.business_type AND btf.plan_code = b.plan_code
       LEFT JOIN LATERAL (
         SELECT jsonb_object_agg(feature_key, enabled) AS overrides FROM business_feature_overrides
         WHERE business_id = b.business_id AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       ) bfo ON true
       WHERE bu.user_id = $1 AND bu.status = 'ACTIVE' AND b.status <> 'CLOSED'
       ORDER BY bu.business_id`,
      [rows[0].user_id]
    )).rows;

    next();
  } catch (error) {
    console.error('[auth] session lookup failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not verify your session' });
  }
};

/**
 * Resolve and authorise the business for this request.
 *
 * Reads the claim from anywhere the client might put it, then ignores all of
 * it unless the user is actually a member.
 */
export const withBusiness = (options = {}) => async (req, res, next) => {
  if (!req.auth) {
    return res.status(401).json({ success: false, message: 'Sign in to continue' });
  }

  const claimed =
    req.headers['x-business-id'] ||
    req.body?.business_id ||
    req.query?.business_id ||
    req.params?.businessId;

  let membership = null;

  if (claimed != null && String(claimed).trim() !== '') {
    const id = Number(claimed);
    membership = req.memberships.find((m) => m.business_id === id) || null;
    if (!membership) {
      /* Deliberately identical to "no such business". Answering 403 here would
         confirm that the id is real but belongs to someone else, which turns
         a guessing game into an enumeration attack. */
      return res.status(404).json({ success: false, message: 'Not found' });
    }
  } else if (req.memberships.length === 1) {
    membership = req.memberships[0];           // the common case: one business
  } else if (req.memberships.length === 0) {
    return res.status(409).json({
      success: false,
      code: 'NO_BUSINESS',
      message: 'Create your business to continue'
    });
  } else {
    return res.status(400).json({
      success: false,
      code: 'BUSINESS_REQUIRED',
      message: 'Choose which business this applies to',
      data: { businesses: req.memberships.map((m) => ({ id: m.business_id, name: m.name })) }
    });
  }

  if (membership.business_status === 'SUSPENDED') {
    return res.status(403).json({
      success: false,
      message: 'This account is suspended. Contact FlowXP support.'
    });
  }

  /* The owner can require two-step verification for owners and admins. Until they set it up, everything except the
     account/security screens (which don't come through here) is closed to them. */
  if (membership.require_2fa_admins && ['OWNER', 'ADMIN'].includes(membership.role) && !req.auth.user.totp_enabled) {
    return res.status(403).json({ success: false, code: 'TWO_FACTOR_REQUIRED', message: 'Set up two-step verification to continue. Your business requires it for owners and admins.' });
  }

  const status = effectiveStatus(membership);
  persistExpiryIfNeeded({ ...membership }, status);

  /*
   * Which outlet is this request for? Same rule as the business: X-Branch-Id is
   * a claim. A user pinned to one outlet always gets that outlet, whatever they
   * send. A group user (branch_id NULL) may name any active outlet of this
   * business, or 'all' to read across them. Writes use `branchId` (a concrete
   * outlet); reads filter by `scopeBranchId` (null = every outlet).
   */
  const outlets = (await pool.query(
    `SELECT branch_id, is_primary FROM branches WHERE business_id = $1 AND status = 'ACTIVE' ORDER BY is_primary DESC, branch_id`,
    [membership.business_id]
  )).rows;
  const primaryId = outlets[0]?.branch_id ?? null;
  const known = (id) => outlets.some((o) => o.branch_id === id);
  const claimedBranch = String(req.headers['x-branch-id'] ?? '').trim().toLowerCase();

  let branchId = primaryId; let scopeBranchId = null; let viewAll = false;
  const pinned = membership.branch_id != null;
  if (pinned) {
    if (!known(membership.branch_id)) {
      return res.status(403).json({ success: false, message: 'Your outlet is closed. Ask the owner to move you to another one.' });
    }
    branchId = scopeBranchId = membership.branch_id;
  } else if (claimedBranch === 'all') {
    viewAll = true;
  } else if (claimedBranch !== '') {
    const id = Number(claimedBranch);
    if (!Number.isInteger(id) || !known(id)) return res.status(404).json({ success: false, message: 'Not found' });
    branchId = scopeBranchId = id;
  }

  req.tenant = {
    businessId: membership.business_id,
    name: membership.name,
    businessType: membership.business_type,
    currency: membership.currency,
    gstEnabled: membership.gst_enabled,
    onboardingStep: membership.onboarding_step,
    role: membership.role,
    permissions: membership.permissions || {},
    /* branchId: the outlet new records belong to (always a real outlet).
       scopeBranchId: the outlet reads are limited to; null = every outlet, which
       only a group user can have. pinned: this user belongs to one outlet. */
    branchId,
    scopeBranchId,
    viewAll,
    pinned,
    multiOutlet: outlets.length > 1,
    subscription: subscriptionSummary(membership),
    // whole-business feature gates — the plan AND the business type combined (either can turn
    // a feature off), checked by requirePlanFeature() below; separate from `permissions`, which is per-user
    planFeatures: effectiveFeatureFlags([membership.feature_flags, membership.business_type_feature_flags], membership.feature_overrides)
  };

  /*
   * Trial expiry gates writing, not reading.
   *
   * `requireActive: true` marks the routes that create or change data. An
   * expired business keeps full read access to everything it built during the
   * trial, which is both what the brief asks for ("do not delete business
   * data") and the only version that converts: an owner who can still see
   * their sales history has a reason to upgrade.
   */
  if (options.requireActive && !req.tenant.subscription.can_write) {
    return res.status(402).json({
      success: false,
      code: 'TRIAL_ENDED',
      message: 'Your FlowXP trial has ended. Upgrade to keep billing.',
      data: req.tenant.subscription
    });
  }

  next();
};

/** Gate a route on a named permission. */
export const requirePermission = (permission) => (req, res, next) => {
  if (!hasPermission(req.tenant, permission)) {
    return res.status(403).json({
      success: false,
      message: 'You do not have access to this'
    });
  }
  next();
};

/**
 * Gate a route on a whole-business feature (unlike requirePermission, which is per-user).
 * `req.tenant.planFeatures` is already the plan AND business-type flags combined — see
 * effectiveFeatureFlags() — so this one check covers "not on this plan" and "not for this
 * kind of business" alike; the message stays generic since either can be the real reason.
 */
export const requirePlanFeature = (feature) => (req, res, next) => {
  if (!hasPlanFeature(req.tenant, feature)) {
    return res.status(402).json({
      success: false,
      code: 'FEATURE_NOT_IN_PLAN',
      message: 'This feature is not available for your business. Contact FlowXP support if you think this is wrong.',
      data: { feature }
    });
  }
  next();
};

/*
 * Gate on any one of several permissions.
 *
 * Exists for the reads that billing itself depends on: building a cart means
 * searching products and looking up a customer, so a CASHIER — who holds
 * 'billing' but not 'products' or 'customers' — must still be able to read
 * both. Writes to products/customers stay behind requirePermission('products')
 * / ('customers') alone; only the read side needs the wider door.
 */
export const requireAnyPermission = (...permissions) => (req, res, next) => {
  if (!permissions.some((p) => hasPermission(req.tenant, p))) {
    return res.status(403).json({
      success: false,
      message: 'You do not have access to this'
    });
  }
  next();
};

/** Writes need a concrete outlet: refuse them while a group user is viewing "All outlets". */
export const requireOutlet = (req, res, next) => {
  if (req.tenant?.viewAll) {
    return res.status(400).json({ success: false, code: 'OUTLET_REQUIRED', message: 'Choose an outlet first — this can’t be done for all outlets at once.' });
  }
  next();
};

/** Reads that only make sense across the whole business (leakage): not for a user pinned to one outlet. */
export const requireGroupUser = (req, res, next) => {
  if (req.tenant?.pinned) {
    return res.status(403).json({ success: false, message: 'This view covers every outlet, so it is limited to owners and group managers.' });
  }
  next();
};

/** Owner-only: billing, permissions, deleting the business. */
export const requireOwner = (req, res, next) => {
  if (req.tenant?.role !== 'OWNER') {
    return res.status(403).json({
      success: false,
      message: 'Only the business owner can do this'
    });
  }
  next();
};

/*
 * Platform-operator gate for /api/admin/*.
 *
 * Deliberately separate from withBusiness()/requireOwner(): a super admin
 * manages every tenant, not one, and most admin routes have no business_id
 * claim to resolve at all. Mount after requireAuth, same as requirePermission.
 */
export const requireSuperAdmin = (req, res, next) => {
  if (!req.auth?.isSuperAdmin) {
    return res.status(403).json({ success: false, message: 'Super admin access required' });
  }
  next();
};
