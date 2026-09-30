/*
 * Customer feedback captured on the public bill page (migration 0045):
 * list it, have Flow AI draft a reply, send it. Drafting reuses the same AI
 * gates and quota as the rest of Flow AI (one system, one quota) but is a
 * single `complete()` call (modules/ai/reviewReply.js), not the tool-use
 * loop — there is nothing to look up, just one piece of feedback to answer.
 */
import pool from '../config/database.js';
import { branchFilter } from '../utils/scope.js';
import { recordAudit } from '../modules/events.js';
import { send } from '../modules/messaging/index.js';
import { draftReviewReply } from '../modules/ai/reviewReply.js';
import { AIProviderError, isConfigured } from '../modules/ai/provider.js';
import { allowance, enabled as aiEnabled } from './ai.controller.js';
import config from '../config/env.js';

const bad = (res, message, status = 400, code) => res.status(status).json({ success: false, message, ...(code && { code }) });

/* GET /api/reviews?rating=&from=&to=&limit= */
export const list = async (req, res) => {
  const { businessId } = req.tenant;
  const values = [businessId];
  const clauses = [];
  if (req.query.rating) { values.push(Number(req.query.rating)); clauses.push(`f.rating = $${values.length}`); }
  if (req.query.from) { values.push(req.query.from); clauses.push(`f.created_at >= $${values.length}::date`); }
  if (req.query.to) { values.push(req.query.to); clauses.push(`f.created_at < ($${values.length}::date + 1)`); }
  const limit = Math.min(200, Number(req.query.limit) || 100);

  const { rows } = await pool.query(
    `SELECT f.feedback_id, f.rating, f.comment, f.reply_text, f.reply_sent_at, f.created_at,
            i.invoice_number, c.name AS customer_name
     FROM customer_feedback f
     JOIN invoices i ON i.invoice_id = f.invoice_id
     LEFT JOIN customers c ON c.customer_id = f.customer_id
     WHERE f.business_id = $1${branchFilter(req.tenant, 'f.branch_id', values)}${clauses.length ? ` AND ${clauses.join(' AND ')}` : ''}
     ORDER BY f.created_at DESC LIMIT ${limit}`,
    values
  );
  res.json({ success: true, data: rows });
};

/** Shared by draftReply/sendReply: this business's own feedback row, outlet-scoped. */
const ownFeedback = async (req, feedbackId) => {
  const values = [req.tenant.businessId, feedbackId];
  const { rows } = await pool.query(
    `SELECT f.*, i.customer_id AS invoice_customer_id, c.name AS customer_name, c.phone AS customer_phone, b.name AS business_name
     FROM customer_feedback f
     JOIN invoices i ON i.invoice_id = f.invoice_id
     JOIN businesses b ON b.business_id = f.business_id
     LEFT JOIN customers c ON c.customer_id = f.customer_id
     WHERE f.business_id = $1 AND f.feedback_id = $2${branchFilter(req.tenant, 'f.branch_id', values)}`,
    values
  );
  return rows[0] || null;
};

/* POST /api/reviews/:id/draft-reply — drafts only, does not send */
export const draftReply = async (req, res) => {
  const feedback = await ownFeedback(req, Number(req.params.id));
  if (!feedback) return bad(res, 'Not found', 404);

  const { businessId } = req.tenant;
  if (!isConfigured()) return bad(res, 'Flow AI isn’t set up on this server yet.', 503, 'AI_NOT_CONFIGURED');
  if (!(await aiEnabled(businessId))) return bad(res, 'Flow AI is switched off for this business.', 403, 'AI_DISABLED');
  const allow = await allowance(businessId);
  if (allow.remaining === 0) return bad(res, `You have used all ${allow.limit} AI questions on your plan this month. They reset next month, or you can upgrade.`, 402, 'AI_LIMIT');

  let result;
  try {
    result = await draftReviewReply({ businessName: feedback.business_name, rating: feedback.rating, comment: feedback.comment });
  } catch (error) {
    if (error instanceof AIProviderError) return bad(res, error.message, error.status === 429 ? 429 : 502, 'AI_UNAVAILABLE');
    throw error;
  }

  await pool.query(
    `INSERT INTO ai_usage (business_id, user_id, conversation_id, model, input_tokens, output_tokens) VALUES ($1,$2,NULL,$3,$4,$5)`,
    [businessId, req.auth.userId, config.ai.model, result.usage.input_tokens, result.usage.output_tokens]
  );

  res.json({ success: true, data: { reply: result.reply, remaining: allow.remaining == null ? null : allow.remaining - 1 } });
};

/* POST /api/reviews/:id/reply { text } — sends it to the customer and records it */
export const sendReply = async (req, res) => {
  const feedback = await ownFeedback(req, Number(req.params.id));
  if (!feedback) return bad(res, 'Not found', 404);

  const text = String(req.body?.text ?? '').trim();
  if (!text) return bad(res, 'Write a reply first');
  if (text.length > 1000) return bad(res, 'Keep the reply under 1000 characters');
  if (!feedback.customer_phone) return bad(res, 'This customer has no mobile number on file to reply to');

  const result = await send(pool, {
    businessId: req.tenant.businessId, branchId: feedback.branch_id, customerId: feedback.invoice_customer_id,
    phone: feedback.customer_phone, kind: 'REVIEW_REPLY', createdBy: req.auth.userId,
    values: { name: feedback.customer_name || 'there', business: feedback.business_name, reply: text },
    related: { type: 'customer_feedback', id: feedback.feedback_id }
  });
  if (result.skipped) {
    return bad(res, result.skipped === 'OFF' ? 'Messaging is off for this business — turn it on in Messaging settings first.' : 'Could not send: no valid mobile number', 400);
  }

  await pool.query(`UPDATE customer_feedback SET reply_text = $1, reply_sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE feedback_id = $2`, [text, feedback.feedback_id]);
  recordAudit(req, { action: 'reviews.reply_sent', resource_type: 'customer_feedback', resource_id: feedback.feedback_id, metadata: { rating: feedback.rating } });

  res.json({ success: true, data: { status: result.status } });
};
