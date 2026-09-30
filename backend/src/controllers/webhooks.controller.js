/*
 * Inbound calls from outside the platform — no session, no tenant, verified
 * by a provider's own signature instead. Kept separate from routes/index.js's
 * signed-in routes for the same reason integrations.controller.js's delivery
 * webhook is separate: a caller here proves itself with a signature, not a
 * bearer token.
 */
import pool from '../config/database.js';
import { verifyWebhookSignature } from '../modules/payments/cashfree.js';
import { recordAudit } from '../modules/events.js';

const CYCLE_INTERVAL = { MONTHLY: '30 days', YEARLY: '365 days' };
const ADDON_LINK_PREFIX = 'flowxp-addon-'; // see admin.controller.js's createAddonLink — how a link is told apart from a plan subscription's

/* A paid add-on sets the same business_feature_overrides row an admin can set by hand
   (migration 0039) — permanent until removed, since a Cashfree link is one-time, not a
   recurring subscription (the same manual-renewal model the main subscription already uses). */
const activateAddon = async (req, linkId) => {
  const { rows } = await pool.query(
    `UPDATE addon_orders SET status = 'PAID', paid_at = CURRENT_TIMESTAMP
     WHERE link_id = $1 AND status = 'PENDING' RETURNING *`,
    [linkId]
  );
  if (!rows.length) return;
  const order = rows[0];

  const addon = (await pool.query(`SELECT name FROM addons WHERE addon_key = $1`, [order.addon_key])).rows[0];
  await pool.query(
    `INSERT INTO business_feature_overrides (business_id, feature_key, enabled, reason, created_by)
     VALUES ($1,$2,TRUE,$3,NULL)
     ON CONFLICT (business_id, feature_key) DO UPDATE SET enabled = TRUE, reason = $3, updated_at = CURRENT_TIMESTAMP`,
    [order.business_id, order.addon_key, `Paid add-on: ${addon?.name ?? order.addon_key}`]
  );

  recordAudit(req, {
    business_id: order.business_id,
    action: 'subscription.addon_activated',
    resource_type: 'addon_order',
    resource_id: order.order_id,
    metadata: { addon_key: order.addon_key, amount_paise: order.amount_paise, billing_cycle: order.billing_cycle }
  });
};

const activateSubscription = async (req, linkId) => {
  // Idempotent by construction: the UPDATE only fires from PENDING, so a duplicate delivery of the
  // same event (Cashfree retries on anything but a 2xx) finds zero rows the second time and does nothing further.
  const { rows } = await pool.query(
    `UPDATE subscription_orders SET status = 'PAID', paid_at = CURRENT_TIMESTAMP
     WHERE link_id = $1 AND status = 'PENDING' RETURNING *`,
    [linkId]
  );
  if (!rows.length) return;
  const order = rows[0];

  await pool.query(
    `UPDATE businesses SET
       subscription_status = 'ACTIVE',
       billing_cycle = $2,
       plan_code = COALESCE($3, plan_code),
       next_billing_date = CURRENT_TIMESTAMP + $4::interval,
       updated_at = CURRENT_TIMESTAMP
     WHERE business_id = $1`,
    [order.business_id, order.billing_cycle, order.plan_code, CYCLE_INTERVAL[order.billing_cycle]]
  );

  recordAudit(req, {
    business_id: order.business_id,
    action: 'subscription.payment_received',
    resource_type: 'subscription_order',
    resource_id: order.order_id,
    metadata: { amount_paise: order.amount_paise, billing_cycle: order.billing_cycle }
  });
};

/* ==========================================================================
   POST /api/webhooks/cashfree
   ========================================================================== */
export const cashfree = async (req, res) => {
  const signature = req.get('x-webhook-signature');
  const timestamp = req.get('x-webhook-timestamp');
  // req.rawBody is a Buffer set by server.js's express.json `verify` callback;
  // Cashfree signs the exact bytes it sent, not our re-serialisation of them.
  if (!(await verifyWebhookSignature(req.rawBody, timestamp, signature))) {
    return res.status(401).json({ success: false, message: 'Bad signature' });
  }

  const data = req.body?.data || {};
  const linkId = data.link_id ?? data.link?.link_id;
  const linkStatus = data.link_status ?? data.link?.link_status;
  if (!linkId) return res.json({ success: true }); // not a link event we act on — ack it so Cashfree stops retrying

  const isAddon = linkId.startsWith(ADDON_LINK_PREFIX);
  const table = isAddon ? 'addon_orders' : 'subscription_orders';

  if (linkStatus === 'EXPIRED') {
    // Otherwise a dead link sits in 'PENDING' forever and inflates the admin dashboard's
    // "awaiting payment" count with things nobody is ever going to pay.
    await pool.query(`UPDATE ${table} SET status = 'EXPIRED' WHERE link_id = $1 AND status = 'PENDING'`, [linkId]).catch(() => {});
    return res.json({ success: true });
  }

  if (linkStatus !== 'PAID') return res.json({ success: true });

  try {
    if (isAddon) await activateAddon(req, linkId);
    else await activateSubscription(req, linkId);
    res.json({ success: true });
  } catch (error) {
    console.error('[webhooks] cashfree handling failed:', error.message);
    // 500 so Cashfree retries — the alternative is a payment that came in and
    // never activated anything because of a transient DB hiccup on our side.
    res.status(500).json({ success: false });
  }
};
