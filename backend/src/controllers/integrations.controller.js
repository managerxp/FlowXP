/*
 * Delivery platform integrations: Zomato, Swiggy, ONDC, Magicpin.
 *
 * Every platform-specific detail lives behind modules/delivery/registry.js's
 * adapters — this file only does the parts common to all four: storing
 * per-business config, receiving a webhook and turning it into an order via
 * the same Orders pipeline a dine-in table uses, and letting a business
 * trigger a menu sync or a test order without waiting for real traffic.
 *
 * ── Why a delivery order still becomes an `order`, not straight to invoice ──
 * A delivery platform's own app is where the customer actually pays (or pays
 * cash on delivery) — FlowXP's job is the kitchen ticket and, once the
 * business decides to reconcile it, the invoice for their own books. Routing
 * it through the same orders table KOT already uses means the kitchen sees a
 * Zomato order exactly the way it sees a dine-in one.
 */
import crypto from 'node:crypto';
import pool from '../config/database.js';
import { recordAudit, recordEvent } from '../modules/events.js';
import { getAdapter, PLATFORMS } from '../modules/delivery/registry.js';
import { notify } from '../modules/notifications.js';
import { integrationAlert } from '../modules/scans.js';
import { insertOrderItems, nextNumber } from './orders.controller.js';
import { hasPlanFeature } from '../modules/planFeatures.js';

const asIntegration = (row) => ({
  platform: row.platform,
  is_enabled: row.is_enabled,
  connected: Boolean(row.credentials && Object.keys(row.credentials).length),
  webhook_path: `/api/integrations/${row.platform.toLowerCase()}/webhook/${row.webhook_token}`,
  last_synced_at: row.last_synced_at
});

/* ==========================================================================
   GET /api/integrations — every platform, configured or not
   ========================================================================== */
export const list = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM delivery_integrations WHERE business_id = $1`, [req.tenant.businessId]
  );
  const byPlatform = new Map(rows.map((r) => [r.platform, r]));

  res.json({
    success: true,
    data: PLATFORMS.map((platform) => {
      const row = byPlatform.get(platform);
      return row
        ? asIntegration(row)
        : { platform, is_enabled: false, connected: false, webhook_path: null, last_synced_at: null };
    })
  });
};

/* ==========================================================================
   PATCH /api/integrations/:platform — connect / update / enable / disable
   ========================================================================== */
export const update = async (req, res) => {
  const platform = req.params.platform.toUpperCase();
  if (!PLATFORMS.includes(platform)) return res.status(404).json({ success: false, message: 'Unknown platform' });

  const body = req.body || {};
  const webhookToken = crypto.randomBytes(20).toString('hex');

  const { rows } = await pool.query(
    `INSERT INTO delivery_integrations (business_id, platform, is_enabled, webhook_token, credentials)
     VALUES ($1,$2,COALESCE($3,FALSE),$4,COALESCE($5,'{}'::jsonb))
     ON CONFLICT (business_id, platform) DO UPDATE SET
       is_enabled = COALESCE($3, delivery_integrations.is_enabled),
       credentials = COALESCE($5, delivery_integrations.credentials)
     RETURNING *`,
    [req.tenant.businessId, platform, body.is_enabled, webhookToken, body.credentials ? JSON.stringify(body.credentials) : null]
  );

  recordAudit(req, { action: 'integration.updated', resource_type: 'delivery_integration', resource_id: platform, metadata: { is_enabled: body.is_enabled } });
  res.json({ success: true, data: asIntegration(rows[0]) });
};

/* ==========================================================================
   POST /api/integrations/:platform/sync-menu — push the active catalogue
   ========================================================================== */
export const syncMenu = async (req, res) => {
  const platform = req.params.platform.toUpperCase();
  if (!PLATFORMS.includes(platform)) return res.status(404).json({ success: false, message: 'Unknown platform' });

  const integration = (await pool.query(
    `SELECT * FROM delivery_integrations WHERE business_id = $1 AND platform = $2`,
    [req.tenant.businessId, platform]
  )).rows[0];
  if (!integration?.is_enabled) return res.status(400).json({ success: false, message: `Connect ${platform} first` });

  const products = (await pool.query(
    `SELECT product_id, name, selling_price_paise, tax_rate FROM products WHERE business_id = $1 AND status = 'ACTIVE'`,
    [req.tenant.businessId]
  )).rows;

  const adapter = getAdapter(platform);
  const result = await adapter.pushMenu(products);

  await pool.query(`UPDATE delivery_integrations SET last_synced_at = CURRENT_TIMESTAMP WHERE integration_id = $1`, [integration.integration_id]);
  recordAudit(req, { action: 'integration.menu_synced', resource_type: 'delivery_integration', resource_id: platform, metadata: { count: products.length } });
  res.json({ success: true, data: result });
};

/*
 * The shared path a delivery order arrives through, whether from a real
 * webhook or the simulate-order test helper below. Creates the order as
 * PENDING_ACCEPT with its items unsent — nothing reaches the kitchen, and
 * no KOT exists, until someone at the counter accepts it (orders.controller.js
 * acceptDelivery()). A platform order used to skip straight to the kitchen;
 * that let the kitchen start cooking something the business might want to
 * reject (closing, out of stock, too busy) and gave nobody a moment to say no.
 */
const ingestOrder = async (client, businessId, branchId, platform, normalized) => {
  // A platform webhook names no outlet, so its orders go to the main outlet (per-outlet integrations: not built yet).
  branchId ??= (await client.query(`SELECT branch_id FROM branches WHERE business_id = $1 AND status = 'ACTIVE' ORDER BY is_primary DESC, branch_id LIMIT 1`, [businessId])).rows[0]?.branch_id ?? null;
  const orderNumber = await nextNumber(client, businessId, 'order_prefix', 'order_next_number');

  const order = (await client.query(
    `INSERT INTO orders (business_id, branch_id, order_number, order_type, platform, external_order_id, external_order_number, notes, guest_name, guest_phone, status)
     VALUES ($1,$2,$3,'DELIVERY',$4,$5,$6,$7,$8,$9,'PENDING_ACCEPT') RETURNING *`,
    [businessId, branchId, orderNumber, platform, normalized.external_order_id, normalized.external_order_number, normalized.notes, normalized.customer_name || null, normalized.customer_phone || null]
  )).rows[0];

  await insertOrderItems(client, businessId, order.order_id, normalized.items.map((i) => ({ description: i.description, unit_price: i.unit_price, quantity: i.quantity })));
  return order;
};

/* ==========================================================================
   POST /api/integrations/:platform/webhook/:token — PUBLIC, no session

   Authenticated by the unguessable token in the URL, not a JWT — a delivery
   platform's server has no FlowXP session to send. verifySignature() is
   where a real integration would additionally check the platform's own
   signing scheme; every adapter here mocks it to `true` (see the adapter
   files for why each one can't be verified for real yet).
   ========================================================================== */
export const webhook = async (req, res) => {
  const platform = req.params.platform.toUpperCase();
  if (!PLATFORMS.includes(platform)) return res.status(404).json({ success: false, message: 'Unknown platform' });

  const integration = (await pool.query(
    `SELECT di.*, COALESCE(p.feature_flags, '{}'::jsonb) AS feature_flags
     FROM delivery_integrations di
     JOIN businesses b ON b.business_id = di.business_id
     LEFT JOIN plans p ON p.plan_code = b.plan_code
     WHERE di.webhook_token = $1 AND di.platform = $2`,
    [req.params.token, platform]
  )).rows[0];
  if (!integration) return res.status(404).json({ success: false, message: 'Not found' });

  const alertFailure = (detail) => notify(integration.business_id, integrationAlert(platform, detail)).catch((e) => console.error('[integrations] alert failed:', e.message));
  const logResult = async (status, detail, orderId = null) => {
    if (status === 'REJECTED' || status === 'ERROR') alertFailure(detail);
    await pool.query(
      `INSERT INTO delivery_webhook_log (business_id, platform, order_id, status, detail, payload) VALUES ($1,$2,$3,$4,$5,$6)`,
      [integration.business_id, platform, orderId, status, detail, JSON.stringify(req.body || {})]
    ).catch((e) => console.error('[integrations] webhook log failed:', e.message));
  };

  if (!integration.is_enabled) { await logResult('REJECTED', 'Integration disabled'); return res.status(403).json({ success: false }); }
  if (!hasPlanFeature({ planFeatures: integration.feature_flags }, 'integrations')) {
    await logResult('REJECTED', 'Not included in plan');
    return res.status(403).json({ success: false });
  }

  const adapter = getAdapter(platform);
  if (!adapter.verifySignature(req, integration.credentials)) {
    await logResult('REJECTED', 'Signature check failed');
    return res.status(401).json({ success: false });
  }

  let normalized;
  try {
    normalized = adapter.parseWebhookOrder(req.body);
  } catch (error) {
    await logResult('REJECTED', error.message);
    return res.status(400).json({ success: false, message: error.message });
  }

  /* Platforms re-deliver webhooks on a timeout. The same external order id
     is the same order — acknowledge it rather than create a second one. */
  const existingOrder = async () => normalized.external_order_id && (await pool.query(
    `SELECT order_id, order_number FROM orders WHERE business_id = $1 AND platform = $2 AND external_order_id = $3`,
    [integration.business_id, platform, normalized.external_order_id]
  )).rows[0];
  const duplicate = await existingOrder();
  if (duplicate) {
    await logResult('RECEIVED', 'Duplicate delivery ignored', duplicate.order_id);
    return res.status(200).json({ success: true, order_number: duplicate.order_number, duplicate: true });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await ingestOrder(client, integration.business_id, null, platform, normalized);
    await client.query('COMMIT');

    await logResult('RECEIVED', null, order.order_id);
    recordEvent('delivery_order_received', { businessId: integration.business_id, properties: { platform } });
    res.status(201).json({ success: true, order_number: order.order_number });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') {
      // Two identical deliveries raced past the check above; uq_orders_external stopped the second.
      const raced = await existingOrder();
      if (raced) return res.status(200).json({ success: true, order_number: raced.order_number, duplicate: true });
    }
    console.error('[integrations] webhook ingest failed:', error.message);
    await logResult('ERROR', error.message);
    res.status(500).json({ success: false });
  } finally {
    client.release();
  }
};

/* ==========================================================================
   POST /api/integrations/:platform/simulate-order — authenticated test aid

   Generates a realistic fake incoming order via the adapter and runs it
   through the identical ingest path a real webhook uses, so the whole
   pipeline — order awaiting acceptance, accept, KOT, kitchen display — can be
   exercised with no partner account. Gated behind `settings` like the rest of
   this controller.
   ========================================================================== */
export const simulateOrder = async (req, res) => {
  const platform = req.params.platform.toUpperCase();
  if (!PLATFORMS.includes(platform)) return res.status(404).json({ success: false, message: 'Unknown platform' });

  const adapter = getAdapter(platform);
  const payload = adapter.generateSamplePayload();
  const normalized = adapter.parseWebhookOrder(payload);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await ingestOrder(client, req.tenant.businessId, req.tenant.branchId, platform, normalized);
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: { order_id: order.order_id, order_number: order.order_number, sample_payload: payload } });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[integrations] simulateOrder failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not simulate an order' });
  } finally {
    client.release();
  }
};
