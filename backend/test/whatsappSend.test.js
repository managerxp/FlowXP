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
  const m = render('BILL', { name: 'Asha', business: 'Sharma Auto Parts', total: '₹1,203.00', number: 'INV-0007', when: '22 Oct 2026, 3:45 pm', status: 'Paid in full', closing: 'We hope you enjoyed your meal.', link: 'https://flowxp.in/bill/abc123', token: 'abc123' });
  await withFetch({ json: { messages: [{ id: 'wamid.SENT1' }] } }, async (calls) => {
    const r = await deliver({ channel: 'WHATSAPP', to: '9845011122', kind: 'BILL', text: m.text, template: m.template });
    assert.deepEqual([r.status, r.providerId], ['SENT', 'wamid.SENT1']);
    const { url, init, body } = calls[0];
    assert.equal(url, 'https://graph.facebook.com/v26.0/555000111/messages');
    assert.equal(init.headers.authorization, 'Bearer test-token');
    assert.equal(body.to, '919845011122'); assert.equal(body.type, 'template');
    assert.equal(body.template.name, 'flowxp_bill'); assert.equal(body.template.language.code, 'en');
    assert.deepEqual(body.template.components[0], { type: 'body', parameters: ['Asha', 'Sharma Auto Parts', '₹1,203.00', 'INV-0007', '22 Oct 2026, 3:45 pm', 'Paid in full', 'We hope you enjoyed your meal.'].map((text) => ({ type: 'text', text })) });
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

test('a shop with a Google review link sends the bill with a second button; the others send the plain bill', { skip }, async () => {
  const { googleReviewPath } = await import('../src/modules/messaging/index.js');
  assert.equal(googleReviewPath('https://g.page/r/CabcDEF123-x/review'), 'CabcDEF123-x/review');
  assert.equal(googleReviewPath('https://g.page/r/CabcDEF123-x'), 'CabcDEF123-x/review');
  assert.equal(googleReviewPath('https://g.page/r/CabcDEF123-x/review?utm=1'), 'CabcDEF123-x/review');
  assert.equal(googleReviewPath('https://search.google.com/local/writereview?placeid=ChIJxx'), null, 'another kind of link is not used as the button');
  assert.equal(googleReviewPath(''), null); assert.equal(googleReviewPath(null), null);
  const m = render('BILL_REVIEW', { name: 'Asha', business: 'Cafe', total: '₹10', number: 'INV-1', when: '1 Jan 2027, 9:00 am', status: 'Paid in full', closing: 'Thanks.', link: 'https://flowxp.in/bill/tok', token: 'tok', review: 'CabcDEF123-x/review' });
  assert.equal(m.template.name, 'flowxp_bill_review');
  await withFetch({ json: { messages: [{ id: 'wamid.R1' }] } }, async (calls) => {
    await deliver({ channel: 'WHATSAPP', to: '9845011122', kind: 'BILL_REVIEW', text: m.text, template: m.template });
    const c = calls[0].body.template.components;
    assert.equal(c.length, 3);
    assert.deepEqual(c[1], { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'tok' }] });
    assert.deepEqual(c[2], { type: 'button', sub_type: 'url', index: '1', parameters: [{ type: 'text', text: 'CabcDEF123-x/review' }] });
  });
  assert.throws(() => render('BILL_REVIEW', { name: 'A', business: 'B', number: 'N', when: 'W', total: 'T', status: 'S', closing: 'C', link: 'l', token: 't' }), /needs review/);
});
