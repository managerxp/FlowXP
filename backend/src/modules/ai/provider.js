/*
 * The one place FlowXP talks to an AI provider — Anthropic's Messages API or Google's Gemini API,
 * picked by AI_PROVIDER (config/env.js). Plain fetch for both — no SDK dependency.
 *
 * The rest of the AI code (manager.js, tools.js, onboarding.js, menuScan.js, reviewReply.js) depends only
 * on complete()'s Anthropic-shaped request/response contract — messages with role 'user'|'assistant' and
 * string-or-block content, tools as { name, description, input_schema }, replies as
 * { content: blocks[], stopReason, usage }. anthropic() below speaks that shape natively; gemini() below
 * translates it to and from Gemini's actual wire format (toGeminiBody / fromGeminiResponse, exported for
 * testing), so neither the assistant loop nor a test double (see setProvider) ever needs to know which
 * provider is live. Nothing is sent unless the active provider's API key is set.
 */
import config from '../../config/env.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 45000;

export class AIProviderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'AIProviderError';
    this.status = status;
  }
}

/** Which actual model name a tier resolves to for the active provider. Unknown/omitted tier = 'default'. */
const modelFor = (tier) => config.ai.models[tier] || config.ai.model;

/**
 * @param system    system prompt (string)
 * @param messages  [{ role: 'user'|'assistant', content: string | blocks[] }]
 * @param tools     [{ name, description, input_schema }]
 * @param tier      'default' | 'fast' | 'reasoning' — which named model to use (config/env.js); default 'default'
 * @returns { content: blocks[], stopReason, usage: { input_tokens, output_tokens }, model }
 */
const anthropic = async ({ system, messages, tools, maxTokens, toolChoice, tier }) => {
  const model = modelFor(tier);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': config.ai.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens ?? config.ai.maxTokens, system, messages, ...(tools?.length ? { tools } : {}), ...(toolChoice ? { tool_choice: toolChoice } : {}) })
    });
  } catch (error) {
    throw new AIProviderError(error.name === 'AbortError' ? 'The AI service took too long to answer' : 'Could not reach the AI service');
  } finally {
    clearTimeout(timer);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('[ai] provider error', response.status, payload?.error?.type, payload?.error?.message);
    throw new AIProviderError(response.status === 429 ? 'The AI service is busy right now. Try again in a moment.' : 'The AI service could not answer that', response.status === 429 ? 429 : 502);
  }
  return { content: payload.content || [], stopReason: payload.stop_reason, usage: payload.usage || { input_tokens: 0, output_tokens: 0 }, model };
};

/* ── Gemini: translate the same Anthropic-shaped request/response to and from Gemini's wire format ──────── */

const GEMINI_URL = (model) => `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

/** One Anthropic content block (or a bare string) → Gemini `parts`. `idToName` resolves a tool_result's
    tool_use_id back to the function name Gemini expects, built once per request from the tool_use blocks
    already in the message history (see toGeminiContents). */
const toGeminiParts = (content, idToName) => {
  if (typeof content === 'string') return [{ text: content }];
  // Gemini 3 models sign what they decided to do (thoughtSignature) and refuse the next round of a tool conversation
  // unless the signature comes back on the same part. fromGeminiResponse keeps it on the block as thought_signature.
  const signed = (part, b) => (b.thought_signature ? { ...part, thoughtSignature: b.thought_signature } : part);
  return (content || []).map((b) => {
    if (b.type === 'image') return { inlineData: { mimeType: b.source.media_type, data: b.source.data } };
    if (b.type === 'tool_use') return signed({ functionCall: { name: b.name, args: b.input || {} } }, b);
    if (b.type === 'tool_result') return { functionResponse: { name: idToName.get(b.tool_use_id) || b.tool_use_id, response: b.is_error ? { error: b.content } : { result: b.content } } };
    return signed({ text: b.text || '' }, b);
  });
};

export const toGeminiContents = (messages) => {
  const idToName = new Map();
  for (const m of messages) for (const b of Array.isArray(m.content) ? m.content : []) if (b.type === 'tool_use') idToName.set(b.id, b.name);
  // Gemini has no 'assistant' role — the model's own turns are 'model'.
  return messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: toGeminiParts(m.content, idToName) }));
};

/** Anthropic's { type: 'tool' | 'any' | 'auto' | 'none', name? } → Gemini's functionCallingConfig. */
const toGeminiToolConfig = (toolChoice) => {
  if (toolChoice?.type === 'tool') return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [toolChoice.name] } };
  if (toolChoice?.type === 'any') return { functionCallingConfig: { mode: 'ANY' } };
  if (toolChoice?.type === 'none') return { functionCallingConfig: { mode: 'NONE' } };
  return { functionCallingConfig: { mode: 'AUTO' } };
};

/** Gemini's function `parameters` are a restricted OpenAPI subset, not full JSON Schema: no
    `additionalProperties` (every tool in tools.js sets it via their shared schema() helper — an unknown
    field there is a hard 400, not a warning), and no `type: [X, 'null']` union (menuScan.js's TOOL uses
    this for every optional field) — Gemini wants one `type` plus a separate `nullable: true`. Applied
    recursively so a schema nested under `properties`/`items` is sanitised too, without every tool in
    tools.js/onboarding.js/menuScan.js needing to know Gemini has opinions about its own JSON Schema. */
export const toGeminiSchema = (schema) => {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema === null || typeof schema !== 'object') return schema;
  const { additionalProperties, type, properties, items, ...rest } = schema;
  const out = { ...rest };
  if (properties) out.properties = Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, toGeminiSchema(v)]));
  if (items) out.items = toGeminiSchema(items);
  if (Array.isArray(type)) {
    out.type = type.find((t) => t !== 'null') || 'string';
    if (type.includes('null')) out.nullable = true;
  } else if (type) {
    out.type = type;
  }
  return out;
};

/** @param request the same { system, messages, tools, maxTokens, toolChoice } complete() always takes. */
export const toGeminiBody = ({ system, messages, tools, maxTokens, toolChoice }) => ({
  systemInstruction: { parts: [{ text: system }] },
  contents: toGeminiContents(messages),
  ...(tools?.length ? { tools: [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.input_schema) })) }] } : {}),
  ...(toolChoice ? { toolConfig: toGeminiToolConfig(toolChoice) } : {}),
  generationConfig: { maxOutputTokens: maxTokens ?? config.ai.maxTokens },
  // Google's own filter, switched on explicitly: newer models default to off. A blocked prompt comes back with no candidate.
  safetySettings: ['HARASSMENT', 'HATE_SPEECH', 'SEXUALLY_EXPLICIT', 'DANGEROUS_CONTENT'].map((c) => ({ category: `HARM_CATEGORY_${c}`, threshold: 'BLOCK_MEDIUM_AND_ABOVE' }))
});

/** Gemini's { candidates, usageMetadata } → the same { content, stopReason, usage } shape anthropic() returns.
    Gemini has no "tool_use" stop reason of its own — a reply that called a function is recognised by the
    functionCall part being present, same as manager.js already checks via block type, not finishReason. */
export const fromGeminiResponse = (payload) => {
  const parts = payload.candidates?.[0]?.content?.parts || [];
  let n = 0;
  const content = parts.map((p) => {
    const signature = p.thoughtSignature ? { thought_signature: p.thoughtSignature } : {};
    return p.functionCall
      ? { type: 'tool_use', id: `call_${n++}_${p.functionCall.name}`, name: p.functionCall.name, input: p.functionCall.args || {}, ...signature }
      : { type: 'text', text: p.text || '', ...signature };
  });
  return {
    content,
    stopReason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
    usage: { input_tokens: payload.usageMetadata?.promptTokenCount || 0, output_tokens: payload.usageMetadata?.candidatesTokenCount || 0 }
  };
};

/* One model, up to three tries: Google answers 503 "high demand" in short spikes (the newest models most often), so a
   moment later usually gets through. Returns the payload, or { unusable } when this model should be skipped. */
const askGemini = async (model, body) => {
  let response; let payload;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      response = await fetch(GEMINI_URL(model), {
        method: 'POST',
        signal: controller.signal,
        // The key goes in a header, not the URL's query string, so it never ends up in a server access log.
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.ai.apiKey },
        body
      });
    } catch (error) {
      throw new AIProviderError(error.name === 'AbortError' ? 'The AI service took too long to answer' : 'Could not reach the AI service');
    } finally {
      clearTimeout(timer);
    }
    payload = await response.json().catch(() => ({}));
    if (response.status !== 503 || attempt === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
  }
  if (response.ok) return { payload };
  const message = payload?.error?.message || '';
  // Reasons to try another model instead of failing: Google does not know this name (a typo, or a retired model),
  // this plan has no quota for it at all ("limit: 0", e.g. a Pro model on the free tier), or it is overloaded (503).
  const unknown = response.status === 404;
  // a daily cap that is spent ("retry in 18h7m") is the same story for that model: another model has its own allowance
  const noQuota = response.status === 429 && (/limit: 0(?![0-9])/.test(message) || /retry in \d+h/i.test(message));
  const overloaded = response.status === 503;
  if (unknown || noQuota || overloaded) {
    return { unusable: unknown ? 'is not known to Gemini' : noQuota ? 'has no quota left (limit 0 or its daily cap is spent)' : 'is overloaded right now', status: response.status };
  }
  console.error('[ai] provider error', response.status, payload?.error?.status, message);
  const busy = response.status === 429;
  throw new AIProviderError(busy ? 'The AI service is busy right now. Try again in a moment.' : 'The AI service could not answer that', busy ? 429 : 502);
};

const gemini = async (request) => {
  const body = JSON.stringify(toGeminiBody(request));
  // The model this call asked for, then the default, then the fast one: a bad name or an overloaded model must not
  // take the whole assistant down. The log says which model was skipped and why.
  const candidates = [...new Set([modelFor(request.tier), config.ai.models.default, config.ai.models.fast])];
  let last;
  for (const model of candidates) {
    const result = await askGemini(model, body);
    if (result.unusable) {
      last = { model, ...result };
      console.error(`[ai] model "${model}" ${result.unusable}${model === candidates[candidates.length - 1] ? '' : '; trying the next one'}. Check GEMINI_*_MODEL in .env.`);
      continue;
    }
    // No candidate at all (e.g. the prompt was blocked for safety) is Gemini's version of a failed reply.
    if (!result.payload.candidates?.length) throw new AIProviderError('The AI service could not answer that', 502);
    return { ...fromGeminiResponse(result.payload), model };
  }
  const busy = last?.status === 503 || last?.status === 429;
  throw new AIProviderError(busy ? 'The AI service is busy right now. Try again in a moment.' : 'The AI service could not answer that', busy ? 429 : 502);
};

/* ── dispatch ─────────────────────────────────────────────────────────────────────────────────────────── */

const PROVIDERS = { anthropic, gemini };
const defaultProvider = PROVIDERS[config.ai.provider] || anthropic;
let provider = defaultProvider;
let configuredOverride; // undefined = decide from the real key/provider; set by tests that need the
                         // "no key" path deliberately, independent of whether this environment's own
                         // .env happens to carry a real one (it does, outside tests — see config/env.js).

/** Tests (and any alternative provider) swap this out. */
export const setProvider = (fn) => { provider = fn ?? defaultProvider; };
/** Tests force the "configured"/"not configured" gate regardless of the real env key. Reset with undefined. */
export const setConfigured = (value) => { configuredOverride = value; };
export const isConfigured = () => configuredOverride ?? (provider !== defaultProvider || Boolean(config.ai.apiKey));
export const complete = (request) => provider(request);
