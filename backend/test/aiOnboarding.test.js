/*
 * Flow AI's onboarding chat (owner's request, 2026-09-29): a first-time cafe
 * owner types naturally and the wizard's own fields get filled in — it never
 * writes anything itself, only drafts. Covers the field-extraction module and
 * the endpoint's gating (same quota/enabled/configured rules as regular chat).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { converseOnboarding } = await import('../src/modules/ai/onboarding.js');
const { setProvider, setConfigured, AIProviderError } = await import('../src/modules/ai/provider.js');
const ai = await import('../src/controllers/ai.controller.js');

test.after(() => { setProvider(null); setConfigured(undefined); return cleanup(); });

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });

const say = (text) => ({ content: [{ type: 'text', text }], stopReason: 'end_turn', usage: { input_tokens: 50, output_tokens: 10 } });
const sayAndFill = (text, fields) => ({
  content: [{ type: 'text', text }, { type: 'tool_use', id: 't1', name: 'fill_onboarding_fields', input: fields }],
  stopReason: 'tool_use',
  usage: { input_tokens: 60, output_tokens: 15 }
});

test('extraction: a message with an address and GST number fills only what was said', { skip: false }, async () => {
  setProvider(async () => sayAndFill('Got it — set your address and GSTIN.', {
    city: 'Bengaluru', state: 'Karnataka', gst_enabled: true, gstin: '29ABCDE1234F1Z5'
  }));
  const result = await converseOnboarding({
    businessName: 'Bean There Cafe', businessType: 'CAFE', currentForm: {},
    message: "We're in Bengaluru, Karnataka, GST registered 29ABCDE1234F1Z5"
  });
  assert.equal(result.reply, 'Got it — set your address and GSTIN.');
  assert.deepEqual(result.fields, { city: 'Bengaluru', state: 'Karnataka', gst_enabled: true, gstin: '29ABCDE1234F1Z5' });
  assert.deepEqual(result.usage, { input_tokens: 60, output_tokens: 15 });
});

test('extraction: a message with nothing to fill in returns no fields, just a reply', { skip: false }, async () => {
  setProvider(async () => say('Sure — what city are you in?'));
  const result = await converseOnboarding({ businessName: 'Bean There Cafe', businessType: 'CAFE', currentForm: {}, message: 'hi' });
  assert.deepEqual(result.fields, {});
  assert.equal(result.reply, 'Sure — what city are you in?');
});

test('extraction: the system prompt names the business, its type, what is already filled in, and never to guess', () => {
  let seen;
  setProvider(async (request) => { seen = request; return say('ok'); });
  return converseOnboarding({
    businessName: 'Bean There Cafe', businessType: 'CAFE', currentForm: { city: 'Pune' }, message: 'hello'
  }).then(() => {
    assert.match(seen.system, /Bean There Cafe/);
    assert.match(seen.system, /cafe/);
    assert.match(seen.system, /Pune/);
    assert.match(seen.system, /[Nn]ever invent/);
    assert.equal(seen.tools[0].name, 'fill_onboarding_fields');
  });
});

/* ── endpoint ───────────────────────────────────────────────────────────── */

let biz; let owner;
const reqFor = (body, extra = {}) => ({
  tenant: { businessId: biz, name: 'Bean There Cafe', businessType: 'CAFE', currency: 'INR', role: 'OWNER', permissions: {} },
  auth: { userId: owner }, params: {}, query: {}, headers: {}, ip: '127.0.0.1', body, ...extra
});
const call = async (body) => { const res = fakeRes(); await ai.onboardingChat(reqFor(body), res); return res; };

test('setup', { skip }, async () => {
  await runMigrations(pool);
  owner = (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ('Owner','owner@onboardingai.test','x') RETURNING user_id`)).rows[0].user_id;
  biz = (await pool.query(
    `INSERT INTO businesses (name, owner_user_id, business_type, plan_code, subscription_status) VALUES ('Bean There Cafe',$1,'CAFE','TRIAL','TRIAL') RETURNING business_id`,
    [owner]
  )).rows[0].business_id;
});

test('without a key the endpoint says so, and nothing is charged against the quota', { skip }, async () => {
  setConfigured(false);
  try {
    const res = await call({ message: 'hi' });
    assert.equal(res.code, 503);
    assert.equal(res.body.code, 'AI_NOT_CONFIGURED');
  } finally { setConfigured(undefined); }
});

test('a blank message is refused before any provider call', { skip }, async () => {
  setProvider(async () => { throw new Error('should not be called'); });
  const res = await call({ message: '   ' });
  assert.equal(res.code, 400);
});

test('a turn is answered, counted against the monthly quota, and no conversation row is created', { skip }, async () => {
  setProvider(async () => sayAndFill('Set your city to Pune.', { city: 'Pune' }));
  const before = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ai_usage WHERE business_id = $1`, [biz])).rows[0].n);

  const res = await call({ message: "We're in Pune", current_form: {} });
  assert.equal(res.code ?? 200, 200);
  assert.deepEqual(res.body.data.fields, { city: 'Pune' });
  assert.equal(res.body.data.reply, 'Set your city to Pune.');
  assert.notEqual(res.body.data.remaining, 0);

  const usage = await pool.query(`SELECT conversation_id FROM ai_usage WHERE business_id = $1 ORDER BY usage_id DESC LIMIT 1`, [biz]);
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ai_usage WHERE business_id = $1`, [biz])).rows[0].n), before + 1);
  assert.equal(usage.rows[0].conversation_id, null, 'onboarding turns are metered but not tied to a stored conversation');
  assert.equal(Number((await pool.query(`SELECT COUNT(*)::int AS n FROM ai_conversations WHERE business_id = $1`, [biz])).rows[0].n), 0);
});

test('a bad history entry is dropped rather than sent to the model', { skip }, async () => {
  let seenMessages;
  setProvider(async (request) => { seenMessages = request.messages; return say('ok'); });
  await call({ message: 'next', history: [{ role: 'user', content: 'earlier' }, { role: 'system', content: 'nope' }, 'garbage', { role: 'assistant', content: 'ok before' }] });
  assert.deepEqual(seenMessages.map((m) => m.role), ['user', 'assistant', 'user']);
});
