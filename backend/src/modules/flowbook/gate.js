/*
 * Who may use the FlowBook assistant, decided the way FlowXP decides for its own AI: the plan must include `flowbook_ai` (plan,
 * business type and per-business switches, see planFeatures.js), an owner must not have switched AI off for the business, and the
 * plan's monthly ai_queries must not be used up. Each answered question is one row in ai_usage, so FlowBook questions and Flow AI
 * questions share one allowance. FlowBook books that are not linked to a FlowXP business cannot be gated or counted, so they get nothing.
 */
import pool from '../../config/database.js';
import { allowance, enabled } from '../../controllers/ai.controller.js';
import { effectiveFeatureFlags, hasPlanFeature } from '../planFeatures.js';
import config from '../../config/env.js';

export const FEATURE = 'flowbook_ai';

const planOf = async (businessId) => (await pool.query(
  `SELECT b.business_type, b.workshop_mode,
          COALESCE(pv.feature_flags, p.feature_flags, '{}'::jsonb) AS feature_flags,
          COALESCE(btf.feature_flags, '{}'::jsonb) AS business_type_feature_flags,
          COALESCE(bfo.overrides, '{}'::jsonb) AS feature_overrides
     FROM businesses b
     LEFT JOIN plans p ON p.plan_code = b.plan_code
     LEFT JOIN plan_versions pv ON pv.plan_version_id = b.plan_version_id
     LEFT JOIN business_type_features btf ON btf.business_type = b.business_type AND btf.plan_code = b.plan_code
     LEFT JOIN LATERAL (SELECT jsonb_object_agg(feature_key, enabled) AS overrides FROM business_feature_overrides
                         WHERE business_id = b.business_id AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)) bfo ON true
    WHERE b.business_id = $1 AND b.status <> 'CLOSED'`, [businessId])).rows[0];

const idOf = (flowxpBusinessId) => (/^\d{1,9}$/.test(String(flowxpBusinessId ?? '')) ? Number(flowxpBusinessId) : null);

export const gate = async (flowxpBusinessId) => {
  const id = idOf(flowxpBusinessId);
  const b = id ? await planOf(id) : null;
  if (!b) return { ok: false, status: 403, message: 'The assistant works for businesses opened from FlowXP. Open FlowBook from your FlowXP account to use it.' };
  const planFeatures = effectiveFeatureFlags([b.feature_flags, b.business_type_feature_flags], b.feature_overrides, b.business_type, b.workshop_mode);
  if (!hasPlanFeature({ planFeatures }, FEATURE)) return { ok: false, status: 402, message: 'The assistant is not part of your current plan. You can upgrade your plan in FlowXP to get it.' };
  if (!(await enabled(id))) return { ok: false, status: 403, message: 'AI is switched off for this business. An owner can turn it on in FlowXP.' };
  const allow = await allowance(id);
  if (allow.remaining === 0) return { ok: false, status: 402, message: `You have used all ${allow.limit} AI questions on your plan this month. They start again next month, or you can upgrade your plan.` };
  return { ok: true, remaining: allow.remaining };
};

export const record = async (flowxpBusinessId, used) => {
  const id = idOf(flowxpBusinessId);
  if (!id) return;
  await pool.query(
    `INSERT INTO ai_usage (business_id, user_id, conversation_id, model, input_tokens, output_tokens) VALUES ($1, NULL, NULL, $2, $3, $4)`,
    [id, used.model || config.ai.model, used.input_tokens, used.output_tokens]);
};

/** The FlowBook features the super admin has switched off for this business (keys like flowbook_bank), for FlowBook to refuse and hide. Looked at again every few seconds. */
const cache = new Map();
export const featuresOff = async (flowxpBusinessId) => {
  const id = idOf(flowxpBusinessId);
  if (!id) return [];
  const hit = cache.get(id);
  if (hit && hit.until > Date.now()) return hit.off;
  const b = await planOf(id);
  const flags = b ? effectiveFeatureFlags([b.feature_flags, b.business_type_feature_flags], b.feature_overrides, b.business_type, b.workshop_mode) : {};
  const off = Object.keys(flags).filter((k) => flags[k] === false && k.startsWith('flowbook_') && k !== FEATURE);
  cache.set(id, { off, until: Date.now() + 5000 });
  return off;
};
