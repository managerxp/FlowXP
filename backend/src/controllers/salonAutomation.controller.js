/*
 * Automation settings and segment campaigns. The sending itself is modules/salon/automation.js; messages leave
 * through FlowXP's messaging (whatever channel the business has set up there), so nothing here knows which
 * provider is in use.
 */
import pool from '../config/database.js';
import { getSettings as messagingSettings } from '../modules/messaging/index.js';
import { AUTOMATIONS, campaignAudience, cleanAutomation, getAutomations, runForBusiness, saveAutomation, sendCampaign } from '../modules/salon/automation.js';
import { SalonError, audit, ok, text, wrapAll } from '../modules/salon/common.js';

/* GET /api/salon/automations */
const list = async (req, res) => {
  const messaging = await messagingSettings(pool, req.tenant.businessId);
  ok(res, { channel: messaging.channel, channel_on: messaging.channel !== 'OFF', automations: await getAutomations(pool, req.tenant.businessId) });
};

/* PUT /api/salon/automations/:key { is_enabled?, config? } */
const update = async (req, res) => {
  const key = String(req.params.key).toUpperCase();
  if (!AUTOMATIONS[key]) throw new SalonError(404, 'Not found');
  const patch = cleanAutomation(key, req.body || {});
  if (!Object.keys(patch).length) throw new SalonError(400, 'Nothing to update');
  const before = (await getAutomations(pool, req.tenant.businessId)).find((a) => a.key === key);
  const after = await saveAutomation(pool, req.tenant.businessId, key, patch);
  audit(req, 'salon.automation_changed', 'salon_automation', key, { is_enabled: before.is_enabled, config: before.config }, { is_enabled: after.is_enabled, config: after.config });
  ok(res, after);
};

/* POST /api/salon/automations/run — run them now (they also run every few minutes by themselves) */
const runNow = async (req, res) => ok(res, await runForBusiness(pool, req.tenant.businessId));

/* GET /api/salon/campaigns/audience?segment= — how many would receive it */
const audience = async (req, res) => {
  const rows = await campaignAudience(pool, req.tenant.businessId, req.query.segment);
  ok(res, { count: rows.length, sample: rows.slice(0, 5).map((r) => r.name) });
};

/* POST /api/salon/campaigns { segment, offer } — a promotional message to a segment; one campaign an hour */
const campaign = async (req, res) => {
  const offer = text(req.body?.offer, 'Message', { max: 300, min: 5, required: true });
  const recent = (await pool.query(`SELECT 1 FROM messages WHERE business_id = $1 AND kind = 'OFFER' AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 hour' LIMIT 1`, [req.tenant.businessId])).rows.length;
  if (recent) throw new SalonError(429, 'A campaign went out in the last hour. Wait a little before sending another.');
  const result = await sendCampaign(pool, { businessId: req.tenant.businessId, segment: req.body?.segment, offer, userId: req.auth.userId });
  audit(req, 'salon.campaign_sent', 'campaign', result.batch, null, null, { segment: req.body?.segment, recipients: result.recipients });
  ok(res, result, 201);
};

export default wrapAll({ list, update, runNow, audience, campaign });
