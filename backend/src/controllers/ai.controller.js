/*
 * Flow AI endpoints: ask a question, get the daily briefing, read past
 * conversations, and see how much of the plan's allowance is left.
 *
 * Every question is metered against the plan's monthly ai_queries, stored (so an
 * owner can see what was asked), and refused when the business has switched the
 * feature off or the server has no AI key. A failed provider call costs nothing.
 */
import pool from '../config/database.js';
import { recordAudit } from '../modules/events.js';
import { AIProviderError, isConfigured } from '../modules/ai/provider.js';
import { ask } from '../modules/ai/manager.js';
import { toolsFor } from '../modules/ai/tools.js';
import config from '../config/env.js';

const MAX_QUESTION = 1000;
const HISTORY_TURNS = 8;
const bad = (res, message, status = 400, code) => res.status(status).json({ success: false, message, ...(code && { code }) });

const BRIEFING = 'Give me my briefing. Compare yesterday with the same weekday last week, then tell me what needs my attention today: stock to order, anything running slow in the kitchen, anything unusual worth a look, and what to expect over the next few days. Keep it short.';

const SUGGESTIONS = [
  ['How did we do last week compared with the week before?', 'reports'],
  ['Which dishes make us the most money, and which the least?', 'reports'],
  ['What should I order tomorrow?', 'inventory'],
  ['What do you expect this weekend?', 'reports'],
  ['Is anything running slow in the kitchen?', 'reports'],
  ['Is there anything unusual I should look at?', 'settings']
];

/** How many questions this business has used this month, and its allowance (null = unlimited). */
export const allowance = async (businessId) => {
  const [limit, used] = await Promise.all([
    pool.query(`SELECT p.limits FROM businesses b JOIN plans p ON p.plan_code = b.plan_code WHERE b.business_id = $1`, [businessId]),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM ai_usage
       WHERE business_id = $1 AND created_at >= date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata')) AT TIME ZONE COALESCE((SELECT timezone FROM businesses WHERE business_id = $1), 'Asia/Kolkata')`,
      [businessId]
    )
  ]);
  const cap = limit.rows[0]?.limits?.ai_queries;
  const total = cap == null ? null : Number(cap);
  return { limit: total, used: used.rows[0].n, remaining: total == null ? null : Math.max(0, total - used.rows[0].n) };
};

export const enabled = async (businessId) => (await pool.query(`SELECT ai_enabled FROM businesses WHERE business_id = $1`, [businessId])).rows[0]?.ai_enabled !== false;

/* GET /api/ai/status */
export const status = async (req, res) => {
  const [allow, on] = await Promise.all([allowance(req.tenant.businessId), enabled(req.tenant.businessId)]);
  const available = new Set(toolsFor(req.tenant).map((t) => t.name));
  res.json({
    success: true,
    data: {
      configured: isConfigured(), enabled: on, model: isConfigured() ? config.ai.model : null, ...allow,
      can_ask: isConfigured() && on && (allow.remaining == null || allow.remaining > 0),
      suggestions: SUGGESTIONS.filter(([, permission]) => (permission === 'settings' ? available.has('leakage_findings') : true)).map(([q]) => q),
      tools: [...available]
    }
  });
};

/** Run one question end to end. Shared by chat and briefing. */
const converse = async (req, res, { question, conversationId, title }) => {
  const { businessId } = req.tenant;
  if (!isConfigured()) return bad(res, 'Flow AI isn’t set up on this server yet. Ask whoever runs FlowXP to add the AI key.', 503, 'AI_NOT_CONFIGURED');
  if (!(await enabled(businessId))) return bad(res, 'Flow AI is switched off for this business. An owner can turn it on in the AI page.', 403, 'AI_DISABLED');
  const allow = await allowance(businessId);
  if (allow.remaining === 0) return bad(res, `You have used all ${allow.limit} AI questions on your plan this month. They reset next month, or you can upgrade.`, 402, 'AI_LIMIT');

  // Continue one of this person's own conversations, or start a new one.
  let conversation = null; let history = [];
  if (conversationId) {
    conversation = (await pool.query(`SELECT conversation_id FROM ai_conversations WHERE conversation_id = $1 AND business_id = $2 AND user_id = $3`, [conversationId, businessId, req.auth.userId])).rows[0];
    if (!conversation) return bad(res, 'Conversation not found', 404);
    history = (await pool.query(`SELECT role, content FROM ai_messages WHERE conversation_id = $1 ORDER BY message_id DESC LIMIT $2`, [conversationId, HISTORY_TURNS])).rows.reverse();
    // The API needs the first turn to be the user's.
    while (history.length && history[0].role !== 'user') history.shift();
  }

  let result;
  try {
    result = await ask({ tenant: req.tenant, question, history });
  } catch (error) {
    if (error instanceof AIProviderError) return bad(res, error.message, error.status === 429 ? 429 : 502, 'AI_UNAVAILABLE');
    throw error;
  }

  if (!conversation) {
    conversation = (await pool.query(`INSERT INTO ai_conversations (business_id, user_id, title) VALUES ($1,$2,$3) RETURNING conversation_id`, [businessId, req.auth.userId, (title || question).slice(0, 120)])).rows[0];
  }
  await pool.query(`INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1,'user',$2)`, [conversation.conversation_id, question]);
  await pool.query(`INSERT INTO ai_messages (conversation_id, role, content, tools) VALUES ($1,'assistant',$2,$3)`, [conversation.conversation_id, result.answer, JSON.stringify(result.toolsUsed)]);
  await pool.query(`UPDATE ai_conversations SET updated_at = CURRENT_TIMESTAMP WHERE conversation_id = $1`, [conversation.conversation_id]);
  await pool.query(
    `INSERT INTO ai_usage (business_id, user_id, conversation_id, model, input_tokens, output_tokens) VALUES ($1,$2,$3,$4,$5,$6)`,
    [businessId, req.auth.userId, conversation.conversation_id, config.ai.model, result.usage.input_tokens, result.usage.output_tokens]
  );
  recordAudit(req, { action: 'ai.asked', resource_type: 'ai_conversation', resource_id: conversation.conversation_id, metadata: { tools: result.toolsUsed.map((t) => t.name) } });

  res.json({
    success: true,
    data: {
      conversation_id: conversation.conversation_id, answer: result.answer, tools_used: result.toolsUsed,
      remaining: allow.remaining == null ? null : allow.remaining - 1
    }
  });
};

/* POST /api/ai/chat { message, conversation_id? } */
export const chat = async (req, res) => {
  const message = String(req.body?.message ?? '').trim();
  if (!message) return bad(res, 'Type a question');
  if (message.length > MAX_QUESTION) return bad(res, `Keep the question under ${MAX_QUESTION} characters`);
  return converse(req, res, { question: message, conversationId: req.body?.conversation_id ? Number(req.body.conversation_id) : null });
};

/* POST /api/ai/briefing */
export const briefing = async (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  return converse(req, res, { question: BRIEFING, title: `Briefing ${today}` });
};

/* GET /api/ai/conversations — the caller's own, newest first */
export const conversations = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT conversation_id, title, updated_at FROM ai_conversations WHERE business_id = $1 AND user_id = $2 ORDER BY updated_at DESC LIMIT 30`,
    [req.tenant.businessId, req.auth.userId]
  );
  res.json({ success: true, data: rows });
};

/* GET /api/ai/conversations/:id */
export const conversation = async (req, res) => {
  const own = (await pool.query(`SELECT conversation_id, title FROM ai_conversations WHERE conversation_id = $1 AND business_id = $2 AND user_id = $3`, [req.params.id, req.tenant.businessId, req.auth.userId])).rows[0];
  if (!own) return bad(res, 'Not found', 404);
  const { rows } = await pool.query(`SELECT role, content, tools, created_at FROM ai_messages WHERE conversation_id = $1 ORDER BY message_id`, [req.params.id]);
  res.json({ success: true, data: { ...own, messages: rows } });
};

/* PUT /api/ai/settings { enabled } — owner only */
export const setEnabled = async (req, res) => {
  const on = req.body?.enabled === true;
  await pool.query(`UPDATE businesses SET ai_enabled = $2 WHERE business_id = $1`, [req.tenant.businessId, on]);
  recordAudit(req, { action: on ? 'ai.enabled' : 'ai.disabled', resource_type: 'business', resource_id: req.tenant.businessId });
  res.json({ success: true, data: { enabled: on } });
};
