/*
 * Manager approval for the two things a till operator could otherwise do alone and quietly: cancelling a bill and giving a large manual discount.
 *
 * Who needs it: anyone who does not hold the `approvals` right (owners, admins and managers do). Who can give it: any such person in this business, by
 * entering their own PIN at the till. The PIN is a 4 to 8 digit number kept hashed; a PIN has few possibilities, so five wrong tries by one person lock them
 * for fifteen minutes (counted in approval_attempts, which a rolled-back bill cannot erase), and every approval is written to the audit log with who asked and who allowed.
 *
 * The cap applies only to a discount a person typed in (the counter, a table's bill, the salon till's bill discount). Offers, coupons, points, memberships and
 * price lists are rules the owner set up, so they are never held back by it.
 */
import bcrypt from 'bcryptjs';
import pool from '../config/database.js';
import { hasPermission } from '../middleware/auth.js';
import { effectivePermissions } from './permissions.js';
import { recordAudit } from './events.js';
import { BillingError } from './billing.js';

export const LOCK_AFTER = 5;
export const LOCK_MINUTES = 15;
export const PIN_PATTERN = /^\d{4,8}$/;

export class ApprovalError extends BillingError {
  constructor(status, message, code, data = {}) {
    super(status, message);
    this.code = code;
    this.data = data;
  }
}

/** Does this person need a manager's say-so? Everyone without the approvals right. */
export const needsApproval = (tenant) => !hasPermission(tenant, 'approvals');

export const pinProblem = (pin) => (PIN_PATTERN.test(String(pin ?? '')) ? '' : 'A PIN is 4 to 8 digits');
export const hashPin = (pin) => bcrypt.hash(String(pin), 10);

/** Minutes left on a lock, or 0. */
export const lockedFor = async (db, userId, now = Date.now()) => {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS fails, MAX(created_at) AS last FROM approval_attempts
     WHERE user_id = $1 AND ok = FALSE AND created_at > GREATEST(
       CURRENT_TIMESTAMP - make_interval(mins => $2::int),
       COALESCE((SELECT MAX(created_at) FROM approval_attempts WHERE user_id = $1 AND ok = TRUE), '-infinity'))`,
    [userId, LOCK_MINUTES]);
  if (rows[0].fails < LOCK_AFTER) return 0;
  return Math.max(1, Math.ceil((new Date(rows[0].last).getTime() + LOCK_MINUTES * 60000 - now) / 60000));
};

/** The people in this business who may approve and have set a PIN. A person pinned to one outlet can only approve at that outlet. */
export const approvers = async (db, tenant) => {
  const { rows } = await db.query(
    `SELECT u.user_id, u.name, u.approval_pin_hash, bu.role, bu.permissions
     FROM business_users bu JOIN users u ON u.user_id = bu.user_id
     WHERE bu.business_id = $1 AND bu.status = 'ACTIVE' AND u.approval_pin_hash IS NOT NULL AND (bu.branch_id IS NULL OR bu.branch_id = $2)`,
    [tenant.businessId, tenant.branchId ?? null]);
  return rows.filter((r) => effectivePermissions(r.role, r.permissions || {}).approvals === true);
};

/** Check a PIN against this business's approvers. Returns who approved; throws a refusal a till can show. */
export const verifyPin = async (db, tenant, requesterId, pin) => {
  const wait = await lockedFor(db, requesterId);
  if (wait) throw new ApprovalError(429, `Too many wrong PINs. Try again in ${wait} minute${wait === 1 ? '' : 's'}.`, 'APPROVAL_LOCKED');
  if (pinProblem(pin)) throw new ApprovalError(403, 'Enter the manager\'s PIN (4 to 8 digits).', 'APPROVAL_WRONG');
  for (const a of await approvers(db, tenant)) {
    if (await bcrypt.compare(String(pin), a.approval_pin_hash)) {
      await db.query(`INSERT INTO approval_attempts (business_id, user_id, ok) VALUES ($1,$2,TRUE)`, [tenant.businessId, requesterId]);
      return { user_id: a.user_id, name: a.name };
    }
  }
  await db.query(`INSERT INTO approval_attempts (business_id, user_id, ok) VALUES ($1,$2,FALSE)`, [tenant.businessId, requesterId]);
  throw new ApprovalError(403, 'That PIN is not right.', 'APPROVAL_WRONG');
};

/**
 * Allow an action only with a manager's PIN. `approval` is what the till sent ({ pin }). With none, the refusal says what is needed (code APPROVAL_REQUIRED) so
 * the till can ask. With one, it is checked and the approval is recorded. Uses the pool, not the bill's transaction, so a wrong PIN is still counted when the bill rolls back.
 */
export const ensureApproved = async (req, approval, { kind, message, detail = {} }) => {
  if (!approval?.pin) throw new ApprovalError(403, message, 'APPROVAL_REQUIRED', { kind, ...detail });
  const who = await verifyPin(pool, req.tenant, req.auth.userId, approval.pin);
  recordAudit(req, { action: 'approval.granted', resource_type: 'business', resource_id: req.tenant.businessId, metadata: { kind, approver_user_id: who.user_id, approver: who.name, ...detail } });
  return who;
};

/** A discount as a share of what it comes off, in percent (0 when there is nothing to take it off). */
export const discountPct = (discountPaise, grossPaise) => (grossPaise > 0 ? (discountPaise * 100) / grossPaise : 0);

const pctText = (pct) => `${Math.round(pct * 10) / 10}%`;

/**
 * What billing asks before it accepts a typed-in discount: `check({ discountPaise, grossPaise })` is called once with everything typed in on the bill
 * (every line's discount plus the bill discount) against everything being sold. Over the cap, staff need an approval; managers do not.
 * `lines: false` for a till whose line discounts are worked out by the system (the salon's), where only the bill discount is typed.
 */
export const discountPolicy = (req, approval, { lines = true } = {}) => ({
  lines,
  check: async ({ discountPaise, grossPaise }) => {
    const cap = Number(req.tenant.discountCapPct ?? 100);
    const pct = discountPct(discountPaise, grossPaise);
    if (discountPaise <= 0 || pct <= cap + 1e-9 || !needsApproval(req.tenant)) return;
    await ensureApproved(req, approval, {
      kind: 'DISCOUNT', message: `This discount is ${pctText(pct)} of the bill. Discounts above ${pctText(cap)} need a manager's PIN.`,
      detail: { discount_pct: Math.round(pct * 100) / 100, cap_pct: cap }
    });
  }
});
