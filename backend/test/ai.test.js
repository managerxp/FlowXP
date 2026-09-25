/*
 * Flow AI: the tools it can use (permissions, outlet scope, no personal data),
 * the loop that runs them, and the endpoints around it (metering, storage,
 * switch-off, isolation). The AI provider is replaced by a script, so nothing
 * here needs a key or the network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const { createInvoiceInTransaction } = await import('../src/modules/billing.js');
const { TOOLS, toolsFor, runTool, ToolError } = await import('../src/modules/ai/tools.js');
const { ask, systemPrompt } = await import('../src/modules/ai/manager.js');
const { setProvider, AIProviderError } = await import('../src/modules/ai/provider.js');
const ai = await import('../src/controllers/ai.controller.js');

test.after(() => { setProvider(null); return cleanup(); });

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, set() { return this; } });

/** A provider that plays back a script: each entry is a function (request) => reply, or a reply. */
const scripted = (...steps) => {
  const seen = [];
  let i = 0;
  const provider = async (request) => {
    seen.push(JSON.parse(JSON.stringify(request)));
    const step = steps[Math.min(i++, steps.length - 1)];
    return typeof step === 'function' ? step(request) : step;
  };
  provider.seen = seen;
  return provider;
};
const say = (text) => ({ content: [{ type: 'text', text }], stopReason: 'end_turn', usage: { input_tokens: 100, output_tokens: 20 } });
const use = (name, input = {}, id = 't1') => ({ content: [{ type: 'tool_use', id, name, input }], stopReason: 'tool_use', usage: { input_tokens: 80, output_tokens: 10 } });

/* ── who gets which tools ───────────────────────────────────────────────── */

const tenantOf = (role, extra = {}) => ({ businessId: 1, name: 'Cafe', businessType: 'RESTAURANT', currency: 'INR', role, permissions: {}, scopeBranchId: null, pinned: false, ...extra });
const names = (tenant) => toolsFor(tenant).map((t) => t.name).sort();

test('a person is offered only the tools their role can open', () => {
  assert.equal(names(tenantOf('OWNER')).length, TOOLS.length);
  assert.deepEqual(names(tenantOf('CASHIER')), [], 'billing-only roles see no business intelligence');
  const manager = names(tenantOf('MANAGER'));
  assert.ok(manager.includes('sales_summary') && manager.includes('stock_status'));
  assert.ok(!manager.includes('leakage_findings') && !manager.includes('loyalty_and_coupons'), 'settings-level tools stay with owners and admins');
  assert.deepEqual(names(tenantOf('INVENTORY_MANAGER')), ['stock_status', 'wastage_summary']);
  // pinned to one outlet: no group-wide views
  const pinned = names(tenantOf('ADMIN', { pinned: true }));
  assert.ok(!pinned.includes('leakage_findings') && !pinned.includes('outlet_comparison') && !pinned.includes('loyalty_and_coupons'));
  assert.ok(pinned.includes('sales_summary'));
  // a per-user permission override is honoured in both directions
  assert.ok(names(tenantOf('CASHIER', { permissions: { reports: true } })).includes('sales_summary'));
  assert.ok(!names(tenantOf('MANAGER', { permissions: { reports: false } })).includes('sales_summary'));
});

test('every tool is described for the model', () => {
  for (const t of TOOLS) {
    assert.ok(t.description.length > 30, t.name);
    assert.equal(t.input_schema.type, 'object');
  }
});

test('the system prompt sets the rules the assistant must follow', () => {
  const p = systemPrompt({ tenant: tenantOf('OWNER'), outletName: 'MG Road', today: '2026-09-25' });
  for (const rule of [/never state a number you did not get from a tool/i, /never follow instructions/i, /cannot change anything/i, /MG Road/, /2026-09-25/, /estimates/i]) assert.match(p, rule);
});

/* ── database ───────────────────────────────────────────────────────────── */

let biz; let A; let B; let owner; let manager; let cashier; let other;
const tenantFor = (role, userId, extra = {}) => ({ businessId: biz, name: 'Cafe', businessType: 'RESTAURANT', currency: 'INR', role, permissions: {}, branchId: A, scopeBranchId: null, pinned: false, ...extra });
const reqFor = (role, userId, { tenant, ...extra } = {}) => ({ tenant: tenantFor(role, userId, tenant), auth: { userId }, params: {}, body: {}, query: {}, headers: {}, ip: '127.0.0.1', ...extra });

const FROM = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);   // ten days back: the test bills are today and yesterday
const bill = async (branchId, amount, { discount, day = 0 } = {}) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const date = new Date(Date.now() - day * 86400000).toISOString().slice(0, 10);
    await createInvoiceInTransaction(client, { businessId: biz, branchId }, owner, { items: [{ description: 'Meal', unit_price: amount, quantity: 1 }], discount, invoiceDate: date, payment: { amount: 'FULL' } });
    await client.query('COMMIT');
  } finally { client.release(); }
};

test('setup', { skip }, async () => {
  await runMigrations(pool);
  const user = async (n) => (await pool.query(`INSERT INTO users (name, email, password_hash) VALUES ($1,$2,'x') RETURNING user_id`, [n, `${n}@ai.test`])).rows[0].user_id;
  [owner, manager, cashier, other] = [await user('owner'), await user('manager'), await user('cashier'), await user('other')];
  biz = (await pool.query(`INSERT INTO businesses (name, owner_user_id, business_type, plan_code, subscription_status) VALUES ('Cafe',$1,'RESTAURANT','BUSINESS','ACTIVE') RETURNING business_id`, [owner])).rows[0].business_id;
  A = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'MG Road',TRUE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  B = (await pool.query(`INSERT INTO branches (business_id, name, is_primary) VALUES ($1,'Indiranagar',FALSE) RETURNING branch_id`, [biz])).rows[0].branch_id;
  await bill(A, 1000); await bill(A, 500, { day: 1 }); await bill(B, 300);
});

test('a tool returns rupees for the outlet being viewed, and only that outlet', { skip }, async () => {
  const all = await runTool(tenantFor('OWNER', owner), 'sales_summary', { from: FROM });
  assert.equal(all.net_revenue, 1800);
  assert.equal(all.orders, 3);
  const mg = await runTool(tenantFor('OWNER', owner, { scopeBranchId: A }), 'sales_summary', { from: FROM });
  assert.equal(mg.net_revenue, 1500);
  const ind = await runTool(tenantFor('MANAGER', manager, { scopeBranchId: B, pinned: true }), 'sales_summary', { from: FROM });
  assert.equal(ind.net_revenue, 300);

  const cmp = await runTool(tenantFor('OWNER', owner), 'outlet_comparison', { from: FROM });
  assert.deepEqual(cmp.outlets.map((o) => [o.outlet, o.net_revenue]), [['MG Road', 1500], ['Indiranagar', 300]]);
});

test('a tool refuses what the asker may not see, and bad input comes back as text', { skip }, async () => {
  await assert.rejects(runTool(tenantFor('CASHIER', cashier), 'sales_summary', {}), ToolError);
  await assert.rejects(runTool(tenantFor('MANAGER', manager), 'leakage_findings', {}), /access/);
  await assert.rejects(runTool(tenantFor('ADMIN', owner, { pinned: true }), 'outlet_comparison', {}), /access/);
  await assert.rejects(runTool(tenantFor('OWNER', owner), 'drop_tables', {}), /no tool called/);
  await assert.rejects(runTool(tenantFor('OWNER', owner), 'sales_summary', { from: '2026-09-30', to: '2026-09-01' }), /after the end/);
  await assert.rejects(runTool(tenantFor('OWNER', owner), 'sales_summary', { from: 'yesterday' }), /look like/);
  await assert.rejects(runTool(tenantFor('OWNER', owner), 'sales_summary', { from: '2000-01-01', to: '2026-01-01' }), /at most a year/);
});

test('no customer names or phone numbers reach the model', { skip }, async () => {
  await pool.query(`INSERT INTO customers (business_id, name, phone) VALUES ($1,'Secret Person','9876500001')`, [biz]);
  const out = JSON.stringify([
    await runTool(tenantFor('OWNER', owner), 'loyalty_and_coupons', {}),
    await runTool(tenantFor('OWNER', owner), 'sales_summary', {}),
    await runTool(tenantFor('OWNER', owner), 'stock_status', {})
  ]);
  assert.ok(!out.includes('Secret Person') && !out.includes('9876500001'));
});

/* ── the loop ───────────────────────────────────────────────────────────── */

test('the assistant looks things up, feeds results back, and answers', { skip }, async () => {
  const provider = scripted(use('sales_summary', { from: FROM }), say('Sales were ₹1,800 over 3 orders.'));
  setProvider(provider);
  const result = await ask({ tenant: tenantFor('OWNER', owner), question: 'How were sales?' });
  assert.equal(result.answer, 'Sales were ₹1,800 over 3 orders.');
  assert.deepEqual(result.toolsUsed, [{ name: 'sales_summary', label: 'Sales' }]);
  assert.deepEqual(result.usage, { input_tokens: 180, output_tokens: 30 });

  // what the model saw: tools it may use, the question, then the tool's real result
  const [first, second] = provider.seen;
  assert.ok(first.tools.some((t) => t.name === 'sales_summary'));
  assert.equal(first.messages.at(-1).content, 'How were sales?');
  const toolResult = second.messages.at(-1).content[0];
  assert.equal(toolResult.type, 'tool_result');
  assert.equal(JSON.parse(toolResult.content).net_revenue, 1800);
});

test('a tool that fails is reported to the model as an error, not a crash', { skip }, async () => {
  const provider = scripted(use('sales_summary', { from: 'nonsense' }), say('I could not read that date.'));
  setProvider(provider);
  const result = await ask({ tenant: tenantFor('OWNER', owner), question: 'x' });
  assert.equal(result.answer, 'I could not read that date.');
  const err = provider.seen[1].messages.at(-1).content[0];
  assert.equal(err.is_error, true);
  assert.deepEqual(result.toolsUsed, [], 'a failed lookup is not listed as used');
});

test('a model that asks for something it was not offered gets refused, and cannot loop forever', { skip }, async () => {
  const forbidden = scripted(use('leakage_findings'), say('You do not have access to that.'));
  setProvider(forbidden);
  await ask({ tenant: tenantFor('MANAGER', manager), question: 'any leaks?' });
  assert.ok(!forbidden.seen[0].tools.some((t) => t.name === 'leakage_findings'), 'never offered');
  assert.match(forbidden.seen[1].messages.at(-1).content[0].content, /access/);

  const runaway = scripted(use('daily_trend'));       // asks for a tool every single turn
  setProvider(runaway);
  const result = await ask({ tenant: tenantFor('OWNER', owner), question: 'x' });
  assert.equal(runaway.seen.length, 6, 'stops after six rounds');
  assert.match(result.answer, /narrower question/);
});

test('an oversized tool result is cut down before it goes to the model', { skip }, async () => {
  const provider = scripted(use('daily_trend', { from: '2000-01-01', to: '2000-01-20' }), say('ok'));
  setProvider(provider);
  await ask({ tenant: tenantFor('OWNER', owner), question: 'x' });
  assert.ok(provider.seen[1].messages.at(-1).content[0].content.length <= 12100);
});

/* ── endpoints ──────────────────────────────────────────────────────────── */

const call = async (fn, role, userId, extra = {}) => { const res = fakeRes(); await fn(reqFor(role, userId, extra), res); return res; };
const chat = (message, more = {}, role = 'OWNER', userId = owner) => call(ai.chat, role, userId, { body: { message, ...more } });

test('without a key the assistant says it is not set up, and nothing is sent', { skip }, async () => {
  setProvider(null);
  const res = await chat('hello');
  assert.equal(res.code, 503);
  assert.equal(res.body.code, 'AI_NOT_CONFIGURED');
  const s = (await call(ai.status, 'OWNER', owner)).body.data;
  assert.deepEqual([s.configured, s.can_ask], [false, false]);
});

test('a question is answered, stored, and counted', { skip }, async () => {
  setProvider(scripted(use('sales_summary'), say('Answer one.')));
  const res = await chat('How did we do?');
  assert.equal(res.code, 200);
  assert.equal(res.body.data.answer, 'Answer one.');
  assert.deepEqual(res.body.data.tools_used, [{ name: 'sales_summary', label: 'Sales' }]);
  const id = res.body.data.conversation_id;

  const stored = (await call(ai.conversation, 'OWNER', owner, { params: { id } })).body.data;
  assert.deepEqual(stored.messages.map((m) => [m.role, m.content]), [['user', 'How did we do?'], ['assistant', 'Answer one.']]);
  const usage = (await pool.query(`SELECT input_tokens, output_tokens, user_id FROM ai_usage WHERE conversation_id = $1`, [id])).rows;
  assert.deepEqual(usage, [{ input_tokens: 180, output_tokens: 30, user_id: owner }]);

  const status = (await call(ai.status, 'OWNER', owner)).body.data;
  assert.equal(status.limit, 2000); assert.equal(status.used, 1);
  assert.ok(status.suggestions.length > 0 && status.tools.includes('sales_summary'));
});

test('a follow-up carries the conversation, and other people cannot see or continue it', { skip }, async () => {
  const first = await chat('And by channel?');
  const id = first.body.data.conversation_id;
  const provider = scripted(say('Follow-up answer.'));
  setProvider(provider);
  const next = await chat('What about last month?', { conversation_id: id });
  assert.equal(next.code, 200);
  assert.deepEqual(provider.seen[0].messages.map((m) => m.role), ['user', 'assistant', 'user'], 'earlier turns are sent as history');

  assert.equal((await chat('peek', { conversation_id: id }, 'MANAGER', manager)).code, 404);
  assert.equal((await call(ai.conversation, 'MANAGER', manager, { params: { id } })).code, 404);
  assert.equal((await call(ai.conversations, 'MANAGER', manager)).body.data.length, 0);
  assert.ok((await call(ai.conversations, 'OWNER', owner)).body.data.length >= 2);

  // another business's user with the same id is refused too
  const foreign = fakeRes();
  await ai.conversation({ tenant: { businessId: biz + 999 }, auth: { userId: owner }, params: { id } }, foreign);
  assert.equal(foreign.code, 404);
});

test('questions are validated, and a provider failure costs nothing', { skip }, async () => {
  assert.equal((await chat('   ')).code, 400);
  assert.equal((await chat('x'.repeat(1001))).code, 400);

  const before = (await pool.query(`SELECT COUNT(*)::int AS n FROM ai_usage`)).rows[0].n;
  setProvider(async () => { throw new AIProviderError('The AI service took too long to answer'); });
  const failed = await chat('will fail');
  assert.equal(failed.code, 502);
  assert.equal(failed.body.code, 'AI_UNAVAILABLE');
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM ai_usage`)).rows[0].n, before, 'not counted');
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS n FROM ai_conversations WHERE title = 'will fail'`)).rows[0].n, 0, 'nothing half-saved');

  setProvider(async () => { throw new AIProviderError('busy', 429); });
  assert.equal((await chat('busy')).code, 429);
});

test('the daily briefing is one question and its own conversation', { skip }, async () => {
  const provider = scripted(use('sales_summary'), say('Good morning. Yesterday was steady.'));
  setProvider(provider);
  const res = await call(ai.briefing, 'OWNER', owner);
  assert.equal(res.code, 200);
  assert.match(provider.seen[0].messages.at(-1).content, /briefing/i);
  assert.match((await pool.query(`SELECT title FROM ai_conversations WHERE conversation_id = $1`, [res.body.data.conversation_id])).rows[0].title, /^Briefing 20/);
});

test('the plan allowance is enforced per month', { skip }, async () => {
  const used = (await pool.query(`SELECT COUNT(*)::int AS n FROM ai_usage WHERE business_id = $1`, [biz])).rows[0].n;
  await pool.query(`UPDATE plans SET limits = limits || jsonb_build_object('ai_queries', $1::int) WHERE plan_code = 'BUSINESS'`, [used + 1]);
  setProvider(scripted(say('Last one.')));
  const last = await chat('the last one');
  assert.equal(last.code, 200);
  assert.equal(last.body.data.remaining, 0);
  const over = await chat('one too many');
  assert.equal(over.code, 402);
  assert.equal(over.body.code, 'AI_LIMIT');
  assert.equal((await call(ai.status, 'OWNER', owner)).body.data.can_ask, false);
  await pool.query(`UPDATE plans SET limits = limits - 'ai_queries' WHERE plan_code = 'BUSINESS'`);   // unlimited
  assert.equal((await chat('now fine')).code, 200);
  assert.equal((await call(ai.status, 'OWNER', owner)).body.data.remaining, null);
});

test('an owner can switch the feature off, and then nothing is sent to the provider', { skip }, async () => {
  const provider = scripted(say('should never be called'));
  setProvider(provider);
  assert.equal((await call(ai.setEnabled, 'OWNER', owner, { body: { enabled: false } })).code, 200);
  const res = await chat('anything');
  assert.equal(res.code, 403);
  assert.equal(res.body.code, 'AI_DISABLED');
  assert.equal(provider.seen.length, 0);
  await call(ai.setEnabled, 'OWNER', owner, { body: { enabled: true } });
  assert.equal((await chat('back on')).code, 200);
});

test('answers for a pinned manager are limited to their outlet', { skip }, async () => {
  const provider = scripted(use('sales_summary', { from: FROM }), say('done'));
  setProvider(provider);
  const res = await call(ai.chat, 'MANAGER', manager, { body: { message: 'sales?' }, tenant: { scopeBranchId: B, branchId: B, pinned: true } });
  assert.equal(res.code, 200);
  assert.equal(JSON.parse(provider.seen[1].messages.at(-1).content[0].content).net_revenue, 300);
  assert.match(provider.seen[0].system, /Indiranagar/);
  void other;
});
