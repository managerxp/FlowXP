/*
 * Flow AI drafts a reply to one piece of customer feedback — a plain
 * `complete()` call, no tools, same shape as modules/ai/onboarding.js.
 * It only drafts; the owner reviews, edits if they like, and sends it
 * themselves (reviews.controller.js's sendReply), the same trust boundary as
 * every other AI-drafts-a-thing feature in this app.
 */
import { complete } from './provider.js';

const textOf = (blocks) => blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

const systemPrompt = ({ businessName, rating }) => `You are Flow AI, drafting a short reply from ${businessName} to a customer who left ${rating} out of 5 stars after a visit.

Rules:
- 2-4 sentences, warm and specific to what they actually said — never generic filler.
- ${rating >= 4 ? 'Thank them warmly and invite them back.' : 'Apologise sincerely for what went wrong, without excuses, and say the owner will look into it personally.'}
- Never invent a promise, discount, refund or compensation — the owner decides that, not you.
- Sign off as "${businessName}", nothing else. No hashtags, no emoji, no links.
- Output only the reply text itself, nothing before or after it.`;

/**
 * @returns { reply, usage: { input_tokens, output_tokens } }
 */
export const draftReviewReply = async ({ businessName, rating, comment }) => {
  const message = comment?.trim() ? `The customer wrote: "${comment.trim()}"` : 'The customer left a rating with no written comment.';
  const reply = await complete({
    system: systemPrompt({ businessName, rating }),
    messages: [{ role: 'user', content: message }],
    maxTokens: 300
  });
  return { reply: textOf(reply.content) || 'Thank you for your feedback.', usage: reply.usage || { input_tokens: 0, output_tokens: 0 } };
};
