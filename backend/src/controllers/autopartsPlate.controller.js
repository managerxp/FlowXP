/* POST /api/autoparts/jobcards/plate-scan  (multipart, field "image"): read the number plate in a photo. Returns { plate } or { plate: null }; nothing is saved. */
import pool from '../config/database.js';
import config from '../config/env.js';
import { looksLikeImage } from '../middleware/upload.js';
import { AIProviderError, isConfigured } from '../modules/ai/provider.js';
import { scanPlate } from '../modules/ai/plateScan.js';
import { allowance, enabled } from './ai.controller.js';

const bad = (res, message, status = 400, code) => res.status(status).json({ success: false, message, ...(code && { code }) });

const scan = async (req, res) => {
  const { businessId } = req.tenant;
  const f = req.file;
  if (!f) return bad(res, 'Take a photo of the number plate');
  if (!looksLikeImage(f.buffer, f.mimetype)) return bad(res, 'Use a JPEG, PNG or WebP photo');
  if (!isConfigured()) return bad(res, 'Reading a plate needs the AI service, which is not set up on this server yet. Type the number instead.', 503, 'AI_NOT_CONFIGURED');
  if (!(await enabled(businessId))) return bad(res, 'Flow AI is switched off for this business. An owner can turn it on in the AI page.', 403, 'AI_DISABLED');
  const allow = await allowance(businessId);
  if (allow.remaining === 0) return bad(res, `You have used all ${allow.limit} AI requests on your plan this month.`, 402, 'AI_LIMIT');
  let r;
  try { r = await scanPlate({ mediaType: f.mimetype, data: f.buffer.toString('base64') }); }
  catch (error) { if (error instanceof AIProviderError) return bad(res, error.message, error.status === 429 ? 429 : 502, 'AI_UNAVAILABLE'); throw error; }
  await pool.query(`INSERT INTO ai_usage (business_id, user_id, model, input_tokens, output_tokens) VALUES ($1,$2,$3,$4,$5)`,
    [businessId, req.auth.userId, r.model || config.ai.model, r.usage.input_tokens, r.usage.output_tokens]);
  res.json({ success: true, data: { plate: r.plate } });
};

export default { scan };
