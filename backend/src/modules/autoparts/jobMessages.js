/*
 * Workshop updates sent to the customer by the messaging service (their own WhatsApp/SMS channel, see modules/messaging): the vehicle was received (when the job
 * card is opened), the estimate (when the counter sends it), the vehicle is ready (when the card is marked ready), and the next service is due (a daily scan).
 * The bill itself goes out as any other bill. Only on a plan with messaging; the live updates also need "Job card updates" switched on in Messaging.
 * Never throws into the caller: a message problem is not a job card problem. The hand-sent wa.me wording in jobcards.js (shareJob) is separate and unchanged.
 */
import pool from '../../config/database.js';
import { registerScan } from '../jobs.js';
import { send, getSettings } from '../messaging/index.js';
import { hasPlanFeature, effectiveFeatureFlags } from '../planFeatures.js';
import { getJob } from './jobcards.js';

const KIND = { received: 'JOB_RECEIVED', estimate: 'JOB_ESTIMATE', ready: 'JOB_READY' };
const rupees = (paise) => `₹${(Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(Number(paise) / 100) ? 0 : 2, maximumFractionDigits: 2 })}`;
const vehicleOf = (j) => [[j.make, j.model].filter(Boolean).join(' '), j.vehicle_reg].filter(Boolean).join(' ') || 'vehicle';

/**
 * Send one update for a job card. `manual` (the counter pressed send) skips the "Job card updates" switch, never the plan. Resolves to the stored message,
 * or { skipped } when nothing was sent (plan, switch, channel, no number).
 */
export const sendJobUpdate = async (tenant, jobId, event, { manual = false, createdBy = null } = {}) => {
  try {
    if (!KIND[event]) return { skipped: 'UNKNOWN_EVENT' };
    if (!hasPlanFeature(tenant, 'messaging')) return { skipped: 'PLAN' };
    if (!manual && (await getSettings(pool, tenant.businessId)).job_updates === false) return { skipped: 'SWITCHED_OFF' };
    const job = await getJob(pool, tenant, jobId);
    if (!job.customer_phone) return { skipped: 'NO_PHONE' };
    if (event === 'estimate' && !job.lines.length) return { skipped: 'NO_ESTIMATE' };
    const business = (await pool.query(`SELECT name FROM businesses WHERE business_id = $1`, [tenant.businessId])).rows[0];
    const values = {
      name: job.customer_name || 'there', business: business.name, vehicle: vehicleOf(job), job_no: job.job_no,
      ...(event === 'received' ? { when: job.promised_on || 'as soon as the work is done' } : {}),
      ...(event === 'estimate' ? { total: rupees(job.estimate.total_paise) } : {})
    };
    return await send(pool, { businessId: tenant.businessId, branchId: job.branch_id ?? null, customerId: job.customer_id, phone: job.customer_phone, kind: KIND[event], values, related: { type: 'job_card', id: job.job_id }, createdBy });
  } catch (error) {
    console.error(`[autoparts] job ${event} message failed:`, error.message);
    return { skipped: 'ERROR' };
  }
};

/* next-service reminders: three days ahead, once per vehicle visit, to shops whose plan has messaging and whose channel is on; at most every 30 minutes, between 9 am and 8 pm */
let last = 0;
export const runServiceDue = async ({ force = false } = {}) => {
  if (!force && Date.now() - last < 30 * 60 * 1000) return 0;
  last = Date.now();
  const hour = Number(new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }));
  if (!force && (hour < 9 || hour >= 20)) return 0;
  const shops = (await pool.query(
    `SELECT b.business_id, b.name, b.business_type, b.workshop_mode, COALESCE(pv.feature_flags, p.feature_flags, '{}'::jsonb) AS plan_flags, btf.feature_flags AS type_flags,
            COALESCE((SELECT jsonb_object_agg(feature_key, enabled) FROM business_feature_overrides o WHERE o.business_id = b.business_id AND (o.expires_at IS NULL OR o.expires_at > now())), '{}'::jsonb) AS overrides
       FROM businesses b LEFT JOIN plans p ON p.plan_code = b.plan_code LEFT JOIN plan_versions pv ON pv.plan_version_id = b.plan_version_id
       LEFT JOIN business_type_features btf ON btf.business_type = b.business_type AND btf.plan_code = b.plan_code
      WHERE b.status = 'ACTIVE' AND b.business_type = 'AUTO_PARTS' AND b.messaging_settings->>'channel' IN ('WHATSAPP','SMS')`)).rows;
  let sent = 0;
  for (const b of shops) {
    try {
      const flags = effectiveFeatureFlags([b.plan_flags, b.type_flags], b.overrides, b.business_type, b.workshop_mode);
      if (flags.messaging === false || (await getSettings(pool, b.business_id)).job_updates === false) continue;
      const rows = (await pool.query(
        `SELECT DISTINCT ON (upper(replace(j.vehicle_reg, ' ', ''))) j.job_id, j.branch_id, j.customer_id, j.make, j.model, j.vehicle_reg, j.next_service_on::text AS next_service_on, c.name, c.phone
           FROM job_cards j JOIN customers c ON c.customer_id = j.customer_id
          WHERE j.business_id = $1 AND j.status = 'BILLED' AND j.next_service_on BETWEEN CURRENT_DATE AND CURRENT_DATE + 3 AND c.phone IS NOT NULL
          ORDER BY upper(replace(j.vehicle_reg, ' ', '')), j.billed_at DESC`, [b.business_id])).rows;
      for (const r of rows) {
        if ((await pool.query(`SELECT 1 FROM messages WHERE business_id = $1 AND kind = 'SERVICE_DUE' AND related_type = 'job_card' AND related_id = $2 LIMIT 1`, [b.business_id, r.job_id])).rowCount) continue;
        const out = await send(pool, { businessId: b.business_id, branchId: r.branch_id, customerId: r.customer_id, phone: r.phone, kind: 'SERVICE_DUE',
          values: { name: r.name || 'there', business: b.name, vehicle: vehicleOf(r), date: r.next_service_on }, related: { type: 'job_card', id: r.job_id } });
        if (!out.skipped) sent += 1;
      }
    } catch (error) { console.error('[autoparts] service-due scan failed:', error.message); }
  }
  return sent;
};
registerScan(() => runServiceDue().catch((error) => console.error('[autoparts] service-due scan failed:', error.message)));
