/*
 * What FlowXP hands to Meta for a bill: the template by name, the four values of the body, and the View Bill button with the link token. fetch is replaced, nothing leaves the machine.
 */
process.env.MESSAGING_PROVIDER = 'whatsapp_cloud';
process.env.WHATSAPP_TOKEN = 'test-token';
process.env.WHATSAPP_PHONE_ID = '555000111';
process.env.WHATSAPP_API_VERSION = 'v26.0';
const { default: test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { setupTestDb } = await import('./helpers/db.js');

const { skip, cleanup } = await setupTestDb();
const { deliver } = await import('../src/modules/messaging/provider.js');
const { render } = await import('../src/modules/messaging/templates.js');

test.after(cleanup);

const withFetch = async (reply, run) => {
  const real = global.fetch; const calls = [];
  global.fetch = async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: reply.ok !== false, status: reply.status || 200, json: async () => reply.json }; };
  try { await run(calls); } finally { global.fetch = real; }
};

test('a bill goes out as the approved template with the View Bill button', { skip }, async () => {
  const m = render('BILL', { name: 'Asha', business: 'Sharma Auto Parts', number: 'INV-0007', date: '22 Oct 2026', total: '₹1,203.00', due: '₹0', link: 'https://flowxp.in/bill/abc123', token: 'abc123' });
  await withFetch({ json: { messages: [{ id: 'wamid.SENT1' }] } }, async (calls) => {
    const r = await deliver({ channel: 'WHATSAPP', to: '9845011122', kind: 'BILL', text: m.text, template: m.template });
    assert.deepEqual([r.status, r.providerId], ['SENT', 'wamid.SENT1']);
    const { url, init, body } = calls[0];
    assert.equal(url, 'https://graph.facebook.com/v26.0/555000111/messages');
    assert.equal(init.headers.authorization, 'Bearer test-token');
    assert.equal(body.to, '919845011122'); assert.equal(body.type, 'template');
    assert.equal(body.template.name, 'flowxp_bill'); assert.equal(body.template.language.code, 'en');
    assert.deepEqual(body.template.components[0], { type: 'body', parameters: ['Asha', 'Sharma Auto Parts', 'INV-0007', '22 Oct 2026', '₹1,203.00', '₹0'].map((text) => ({ type: 'text', text })) });
    assert.deepEqual(body.template.components[1], { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'abc123' }] });
    assert.equal(body.template.components.length, 2);
  });
});

test('a template without a button sends only its body, and Meta\'s refusal is kept as the reason', { skip }, async () => {
  const m = render('WAITLIST_READY', { name: 'Asha', business: 'Cafe' });
  await withFetch({ json: { messages: [{ id: 'wamid.SENT2' }] } }, async (calls) => {
    await deliver({ channel: 'WHATSAPP', to: '9845011122', kind: 'WAITLIST_READY', text: m.text, template: m.template });
    assert.equal(calls[0].body.template.components.length, 1);
  });
  await withFetch({ ok: false, status: 400, json: { error: { message: 'Template name does not exist in the translation' } } }, async () => {
    await assert.rejects(() => deliver({ channel: 'WHATSAPP', to: '9845011122', kind: 'WAITLIST_READY', text: m.text, template: m.template }), /Template name does not exist/);
  });
});
