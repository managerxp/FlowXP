/*
 * POST /api/public/assistant { message, history? } -> { success, data: { reply } }
 * The website's "Ask FlowXP" chat (modules/ai/siteAssistant.js). Public, so the route carries its own rate limit
 * (routes/index.js); no account, no business data, nothing stored.
 */
import { AIProviderError } from '../modules/ai/provider.js';
import { AssistantInputError, answer, available, cleanInput } from '../modules/ai/siteAssistant.js';

export const ask = async (req, res) => {
  if (!available()) return res.status(503).json({ success: false, message: 'The assistant is resting right now. You can reach the team on the Contact page.' });
  let input;
  try {
    input = cleanInput(req.body);
  } catch (error) {
    if (error instanceof AssistantInputError) return res.status(400).json({ success: false, message: error.message });
    throw error;
  }
  try {
    const data = await answer(input);
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof AIProviderError) return res.status(error.status === 429 ? 429 : 502).json({ success: false, message: error.message });
    console.error('[assistant] failed:', error.message);
    res.status(500).json({ success: false, message: 'Could not answer that. Please try again.' });
  }
};
