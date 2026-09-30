/*
 * The one place FlowXP talks to an AI provider (Anthropic's Messages API).
 * Plain fetch — no SDK dependency for one endpoint.
 *
 * The rest of the AI code depends only on `complete()`'s shape, so a different
 * provider (or a test double, see setProvider) replaces this file's contents
 * without touching the assistant. Nothing is sent unless an API key is set.
 */
import config from '../../config/env.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const TIMEOUT_MS = 45000;

export class AIProviderError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'AIProviderError';
    this.status = status;
  }
}

/**
 * @param system    system prompt (string)
 * @param messages  [{ role: 'user'|'assistant', content: string | blocks[] }]
 * @param tools     [{ name, description, input_schema }]
 * @returns { content: blocks[], stopReason, usage: { input_tokens, output_tokens } }
 */
const anthropic = async ({ system, messages, tools, maxTokens, toolChoice }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': config.ai.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: config.ai.model, max_tokens: maxTokens ?? config.ai.maxTokens, system, messages, ...(tools?.length ? { tools } : {}), ...(toolChoice ? { tool_choice: toolChoice } : {}) })
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
  return { content: payload.content || [], stopReason: payload.stop_reason, usage: payload.usage || { input_tokens: 0, output_tokens: 0 } };
};

let provider = anthropic;

/** Tests (and any alternative provider) swap this out. */
export const setProvider = (fn) => { provider = fn ?? anthropic; };
export const isConfigured = () => provider !== anthropic || Boolean(config.ai.apiKey);
export const complete = (request) => provider(request);
