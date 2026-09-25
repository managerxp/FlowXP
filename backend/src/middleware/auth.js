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
  ADMIN:   ['billing', 'products', 'inventory', 'purchases', 'customers', 'suppliers',
            'payments', 'expenses', 'gst', 'reports', 'export', 'ai', 'settings', 'refunds'],
  MANAGER: ['billing', 'products', 'inventory', 'purchases', 'customers', 'suppliers',
            'payments', 'expenses', 'reports', 'ai', 'refunds'],
  CASHIER: ['billing', 'customers', 'payments'],
  STAFF:   ['billing'],
  // Restaurant floor roles. WAITER can take and bill orders like STAFF; KITCHEN
  // sees and advances tickets only; INVENTORY_MANAGER runs stock and buying.
  WAITER:  ['billing'],
  KITCHEN: ['kitchen'],
  INVENTORY_MANAGER: ['inventory', 'purchases', 'suppliers']
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

export const signToken = (user) =>
  jwt.sign(
    { sub: user.user_id, email: user.email },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );

const readToken = (req) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(header.slice(7).trim(), config.jwtSecret);
  } catch {
    // Expired, forged or malformed all mean the same thing here: no session.
    return null;
  }
};

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

  try {
    const { rows } = await pool.query(
      `SELECT u.user_id, u.name, u.email, u.phone, u.email_verified, u.is_super_admin
       FROM users u WHERE u.user_id = $1`,
      [payload.sub]
    );
    if (!rows.length) {
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
              b.currency, b.onboarding_step, b.gst_enabled
       FROM business_users bu
       JOIN businesses b ON b.business_id = bu.business_id
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
    subscription: subscriptionSummary(membership)
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
