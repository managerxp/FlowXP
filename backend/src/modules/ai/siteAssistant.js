/*
 * "Ask FlowXP": the chat on the public website, for visitors deciding whether FlowXP fits their business. Answered
 * by the AI provider configured for the whole app (AI_PROVIDER, Gemini today) through provider.js, so the API key
 * stays on the server; the browser only ever calls POST /api/public/assistant.
 *
 * What it may say comes from frontend/public/llms.txt, the same plain-text summary of the product the site
 * publishes for AI assistants, so the chat, the site and that file cannot drift apart: change the product's
 * description there and the chat follows. It has no tools and sees no business data; it is a sales and help desk,
 * not Flow AI (which lives inside the app and reads a signed-in business's own records).
 *
 * Limits, because this endpoint is public and every call costs money: the route is rate-limited per visitor
 * (routes/index.js), a message is at most MAX_MESSAGE characters, only the last MAX_TURNS turns are sent, and the
 * reply is capped at MAX_REPLY_TOKENS. Anything malformed is a 400 before the provider is called.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { complete, isConfigured } from './provider.js';

export const MAX_MESSAGE = 600;
export const MAX_TURNS = 8;
const MAX_REPLY_TOKENS = 500;

/* Read once at start-up. If the file is missing (an unusual deploy), the assistant still runs on a short summary. */
const FALLBACK = 'FlowXP is billing, POS, inventory and GST software for Indian businesses, made by ManagerXP, with a 7-day free trial and no card needed. See https://flowxp.in for details.';
const loadKnowledge = () => {
  try {
    return readFileSync(fileURLToPath(new URL('../../../../frontend/public/llms.txt', import.meta.url)), 'utf8').trim();
  } catch {
    return FALLBACK;
  }
};
const KNOWLEDGE = loadKnowledge();

export const systemPrompt = () => `You are "Ask FlowXP", the assistant on the FlowXP website (https://flowxp.in). You help business owners in India understand whether FlowXP fits their business and how it works.

Everything you know about FlowXP is in the reference below. Rules:
- Answer only from the reference. If it does not say, say you are not sure and suggest the Contact page (https://flowxp.in/contact). Never invent a feature, integration, price, discount, customer, statistic or date.
- Prices: plans are on the Pricing page (https://flowxp.in/pricing). Do not quote amounts.
- Be brief and plain: 2 to 5 short sentences, or a short list with "- " bullets. No headings, no tables, no bold, no emoji.
- When it helps, end with one relevant link from the reference (a full https://flowxp.in address).
- Reply in the language the visitor writes in.
- If asked about something unrelated to FlowXP or running a shop, restaurant, salon, pharmacy or distribution business with it, politely say you can only help with FlowXP.
- Never ask for or repeat passwords, card numbers, OTPs or other personal details. For account problems, point to support on the Contact page.
- To try it, the visitor can start the free trial at https://flowxp.in/signup.

Reference:
"""
${KNOWLEDGE}
"""`;

export class AssistantInputError extends Error {}

/** Checks and trims what the browser sent: { message, history: [{ role: 'user'|'assistant', text }] }. */
export const cleanInput = (body) => {
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message) throw new AssistantInputError('Type a question first.');
  if (message.length > MAX_MESSAGE) throw new AssistantInputError(`Keep it under ${MAX_MESSAGE} characters.`);
  const raw = Array.isArray(body?.history) ? body.history : [];
  const history = raw
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string' && m.text.trim())
    .slice(-MAX_TURNS * 2)
    .map((m) => ({ role: m.role, content: m.text.trim().slice(0, MAX_MESSAGE * 2) }));
  // the provider wants turns to alternate and to start with the visitor
  const turns = [];
  for (const m of history) {
    if (!turns.length && m.role !== 'user') continue;
    if (turns.length && turns[turns.length - 1].role === m.role) turns[turns.length - 1] = m;
    else turns.push(m);
  }
  if (turns.length && turns[turns.length - 1].role === 'user') turns.pop();
  return { message, turns };
};

const textOf = (blocks) => (blocks || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

export const available = () => isConfigured();

/** @returns { reply } */
export const answer = async ({ message, turns }) => {
  const reply = await complete({
    system: systemPrompt(),
    messages: [...turns, { role: 'user', content: message }],
    maxTokens: MAX_REPLY_TOKENS,
    tier: 'fast'
  });
  return { reply: textOf(reply.content) || 'Sorry, I could not answer that. You can ask the team on https://flowxp.in/contact.' };
};
