/*
 * Gemini model trouble must not take Flow AI down: a model name Google does not know, a model this plan has no quota
 * for (limit 0), or an overloaded model (503) makes the provider try the next model (the default, then the fast
 * one), while an ordinary rate limit is just "busy". fetch is a stand-in; nothing here needs a key or the network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AI_PROVIDER = 'gemini';
process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_DEFAULT_MODEL = 'good-default';
process.env.GEMINI_REASONING_MODEL = 'typo-pro';
process.env.GEMINI_FAST_MODEL = 'good-fast';

const provider = await import('../src/modules/ai/provider.js');
const realFetch = globalThis.fetch;
const realTimeout = globalThis.setTimeout;
test.after(() => { globalThis.fetch = realFetch; globalThis.setTimeout = realTimeout; });
// the 503 pauses (1.2s, 2.4s) would make these tests slow: shorten every timer to 1ms
globalThis.setTimeout = (fn, ms, ...a) => realTimeout(fn, Math.min(ms, 1), ...a);

const ok = { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'hello' }] } }], usageMetadata: {} }) };
const err = (status, message) => ({ ok: false, status, json: async () => ({ error: { status: 'X', message } }) });
const modelOf = (url) => String(url).match(/models\/([^:]+):/)?.[1];
const ask = (tier = 'reasoning') => provider.complete({ system: 's', messages: [{ role: 'user', content: 'hi' }], tier });
const script = (byModel) => { const asked = []; globalThis.fetch = async (url) => { const m = modelOf(url); asked.push(m); return byModel[m] || ok; }; return asked; };

test('an unknown model name falls back to the default model, and the answer still arrives', async () => {
  const asked = script({ 'typo-pro': err(404, 'models/typo-pro is not found') });
  const reply = await ask();
  assert.deepEqual(asked, ['typo-pro', 'good-default']);
  assert.equal(reply.content[0].text, 'hello');
  assert.equal(reply.model, 'good-default');
});

test('a model with no quota on this plan (limit 0) falls back, but an ordinary rate limit does not', async () => {
  let asked = script({ 'typo-pro': err(429, 'Quota exceeded ... limit: 0, model: typo-pro') });
  assert.equal((await ask()).model, 'good-default');
  assert.deepEqual(asked, ['typo-pro', 'good-default']);

  asked = script({ 'typo-pro': err(429, 'Quota exceeded ... limit: 20, model: typo-pro. Please retry in 18h7m1.9s.') });
  assert.equal((await ask()).model, 'good-default', 'a spent daily cap falls back too');

  asked = script({ 'typo-pro': err(429, 'Quota exceeded ... limit: 15, model: typo-pro. Please retry in 21s.') });
  await assert.rejects(ask(), /busy/);
  assert.deepEqual(asked, ['typo-pro']);   // a real rate limit is just "busy": no switching models
});

test('an overloaded model (503) is tried three times, then the next model answers', async () => {
  const asked = script({ 'typo-pro': err(503, 'This model is currently experiencing high demand.') });
  const reply = await ask();
  assert.deepEqual(asked, ['typo-pro', 'typo-pro', 'typo-pro', 'good-default']);
  assert.equal(reply.model, 'good-default');
});

test('when the default is overloaded too, the fast model is the last resort; if all fail it is "busy"', async () => {
  let asked = script({ 'typo-pro': err(503, 'high demand'), 'good-default': err(503, 'high demand') });
  assert.equal((await ask()).model, 'good-fast');
  assert.deepEqual(asked.filter((m, i) => i === 0 || m !== asked[i - 1]), ['typo-pro', 'good-default', 'good-fast']);

  script({ 'typo-pro': err(503, 'x'), 'good-default': err(503, 'x'), 'good-fast': err(503, 'x') });
  await assert.rejects(ask(), /busy/);
});

test('a known model is used as asked, with no fallback', async () => {
  const asked = script({});
  await ask('fast');
  assert.deepEqual(asked, ['good-fast']);
});

test('other errors (a bad request) fail at once with the usual message, without trying other models', async () => {
  const asked = script({ 'typo-pro': err(400, 'bad request') });
  await assert.rejects(ask(), /could not answer/);
  assert.deepEqual(asked, ['typo-pro']);
});
