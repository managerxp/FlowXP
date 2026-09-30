/*
 * Flow AI's onboarding helper — a chat panel beside the setup wizard
 * (frontend/src/app/Onboarding.jsx) that lets a first-time owner type
 * naturally ("I'm on MG Road, Bengaluru, GST registered 29ABCDE1234F1Z5")
 * instead of filling each field by hand.
 *
 * It never writes anything itself: it only drafts values into the wizard's
 * own fields for the owner to review and Save, the same trust boundary as
 * typing them in directly. One forced-optional tool call per turn extracts
 * whatever fields the message actually supports — the system prompt tells
 * it not to guess a GSTIN or invent an address, only use what was said.
 */
import { complete } from './provider.js';

const TOOL = {
  name: 'fill_onboarding_fields',
  description: 'Fill in any setup fields you can confidently work out from what the owner just said. Only include a field you are reasonably sure of; leave the rest out entirely rather than guessing.',
  input_schema: {
    type: 'object',
    properties: {
      address: { type: 'string', description: 'Street address' },
      city: { type: 'string' },
      state: { type: 'string', description: 'State or union territory (India) or region' },
      postal_code: { type: 'string' },
      country: { type: 'string' },
      phone: { type: 'string' },
      email: { type: 'string', description: 'Business contact email, for invoices' },
      gst_enabled: { type: 'boolean', description: 'Only true if they explicitly say they are GST-registered' },
      gstin: { type: 'string', description: '15-character Indian GSTIN' },
      currency: { type: 'string', enum: ['INR', 'USD', 'AED', 'GBP'] },
      financial_year_start_month: { type: 'integer', minimum: 1, maximum: 12 },
      invoice_prefix: { type: 'string', description: 'Short prefix for invoice numbers, e.g. INV' }
    },
    additionalProperties: false
  }
};

const textOf = (blocks) => blocks.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

const systemPrompt = ({ businessName, businessType, currentForm }) => `You are Flow AI, helping the owner of ${businessName} (a ${String(businessType || 'business').toLowerCase().replace('_', ' ')}) finish setting up FlowXP for the first time.

You are chatting next to a short setup wizard covering: address, logo, GST/tax, currency, invoice numbering.
Already filled in so far: ${JSON.stringify(currentForm)}.

Rules:
- When they tell you something usable, call fill_onboarding_fields with only the fields you are confident about from what they actually said. Never invent a GSTIN, address or phone number, and never turn GST on unless they say they are registered for it.
- You cannot upload a logo for them — if they mention one, tell them to use the upload button on the Logo step.
- Reply briefly (1-3 sentences): confirm what you just filled in (if anything) and ask a short follow-up for whatever's still missing, in the order address → tax → invoices.
- Stay only on this setup. If asked something unrelated, say the main Flow AI assistant can help with that once setup is finished.`;

/**
 * @param businessName, businessType, currentForm  context for the system prompt
 * @param message   the new user message
 * @param history   earlier turns this session, [{ role, content }] (kept client-side, not persisted)
 * @returns { reply, fields, usage: { input_tokens, output_tokens } }
 */
export const converseOnboarding = async ({ businessName, businessType, currentForm, message, history = [] }) => {
  const system = systemPrompt({ businessName, businessType, currentForm });
  const messages = [...history.map((m) => ({ role: m.role, content: m.content })), { role: 'user', content: message }];
  const reply = await complete({ system, messages, tools: [TOOL] });
  const call = reply.content.find((b) => b.type === 'tool_use' && b.name === TOOL.name);
  const text = textOf(reply.content);
  return {
    reply: text || (call ? 'Got it, updated your details — what else?' : 'Could you say a bit more about that?'),
    fields: call?.input || {},
    usage: reply.usage || { input_tokens: 0, output_tokens: 0 }
  };
};
