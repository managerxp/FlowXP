/*
 * Audit trail and product analytics.
 *
 * Both writes are deliberately unawaited and never throw. Losing an audit line
 * is bad; refusing to create an invoice because the audit line failed is
 * worse, and an analytics failure blocking a signup would be absurd.
 */
import pool from '../config/database.js';

const clientIp = (req) =>
  req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
  req.socket?.remoteAddress ||
  null;

/**
 * Record a business-meaningful change: invoice created, permission changed,
 * settings edited. Answers "who did this, and when".
 */
export const recordAudit = (req, entry) => {
  pool.query(
    `INSERT INTO audit_log
       (business_id, user_id, action, resource_type, resource_id, metadata, ip_address, branch_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      entry.business_id ?? req.tenant?.businessId ?? null,
      entry.user_id ?? req.auth?.userId ?? null,
      entry.action,
      entry.resource_type || null,
      entry.resource_id != null ? String(entry.resource_id) : null,
      JSON.stringify(entry.metadata || {}),
      clientIp(req),
      // the outlet the person was working in; null for business-level actions and "all outlets" views
      entry.branch_id ?? req.tenant?.scopeBranchId ?? null
    ]
  ).catch((error) => console.error('[audit] write failed:', error.message));
};

/**
 * Record an activation-funnel event: signup, trial_started, first_invoice.
 * Answers "how many people who sign up reach a first invoice".
 */
export const recordEvent = (event, { userId = null, businessId = null, properties = {} } = {}) => {
  pool.query(
    `INSERT INTO analytics_events (event, user_id, business_id, properties)
     VALUES ($1,$2,$3,$4)`,
    [event, userId, businessId, JSON.stringify(properties)]
  ).catch((error) => console.error('[analytics] write failed:', error.message));
};
