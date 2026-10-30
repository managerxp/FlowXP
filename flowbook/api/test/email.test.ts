import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { issueDocument, saveDraft } from '../src/documents.ts';
import { getEmailSettings, listEmails, saveEmailSettings, sendDocument, setMailer, useHostMail } from '../src/email.ts';
import type { Mail } from '../src/email.ts';
import { createParty, seedTaxRates } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
import { newOrg, setup } from './helpers.ts';

process.env.FLOWBOOK_SECRET_KEY = randomBytes(32).toString('base64');
const { pool, skip, cleanup } = await setup();
test.after(() => { setMailer(null); useHostMail(null); return cleanup(); });
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);

test('a document goes out through the mailer and is logged', { skip }, async () => {
  const sent: Mail[] = []; let fail = false;
  setMailer(() => ({ send: async (m) => { if (fail) throw new Error('550 mailbox full\r\nsecond line'); sent.push(m); return { id: '<x@y>' }; }, verify: async () => { if (fail) throw new Error('auth failed'); } }));
  const org = await newOrg(pool);
  const { cust, nomail, inv } = await run(org, async (c) => {
    await openFinancialYear(c, org, 2027, 4, 't'); await seedTaxRates(c, org);
    const cust = await createParty(c, org, { kind: 'CUSTOMER', name: 'Ravi <b>', stateCode: '27', email: 'ravi@example.com' }, 't');
    const nomail = await createParty(c, org, { kind: 'CUSTOMER', name: 'Sita', stateCode: '27' }, 't');
    const mk = async (party: bigint) => { const x = await saveDraft(c, org, null, { kind: 'INVOICE', partyId: party, date: '2026-06-01', lines: [{ description: 'Paper', quantity: '2', unitPrice: '500', taxCode: 'GST18' }] }, 't'); await issueDocument(c, org, 'INVOICE', x, 't'); return x; };
    return { cust, nomail: await mk(nomail), inv: await mk(cust) };
  });
  void cust;

  const env = process.env;
  delete env.FLOWBOOK_SMTP_HOST;
  await assert.rejects(run(org, (c) => sendDocument(c, org, { documentId: inv }, {}, 't')), /not available on this server/);
  Object.assign(env, { FLOWBOOK_SMTP_HOST: 'smtp.example.com', FLOWBOOK_SMTP_FROM: 'noreply@flowxp.example' });
  assert.equal((await run(org, (c) => getEmailSettings(c))).available, true);
  await assert.rejects(run(org, (c) => sendDocument(c, org, { documentId: inv }, {}, 't')), /switched off/);
  await assert.rejects(run(org, (c) => saveEmailSettings(c, org, { replyTo: 'nope' }, 't')), /not an email address/);
  await run(org, (c) => saveEmailSettings(c, org, { enabled: true, replyTo: 'shop@example.com', bccSelf: true }, 't'));

  const out = await run(org, (c) => sendDocument(c, org, { documentId: inv }, { message: 'Thanks!' }, 't'));
  assert.equal(out.status, 'SENT');
  assert.equal(sent[0]?.to, 'ravi@example.com');
  assert.match(sent[0]!.subject, /^Invoice \S+ from /);
  assert.ok(sent[0]!.html.includes('Ravi &lt;b&gt;'), 'party name is escaped in the body');
  assert.ok(sent[0]!.html.includes('1,180.00'), 'total with 18% GST');
  assert.ok(!/[\r\n]/.test(sent[0]!.from), 'no header injection through the sender name');

  await assert.rejects(run(org, (c) => sendDocument(c, org, { documentId: nomail }, {}, 't')), /no email address/);
  await assert.rejects(run(org, (c) => sendDocument(c, org, { documentId: inv }, { to: 'a@b.com, c@d.com' }, 't')), /not an email address/);
  assert.equal((await run(org, (c) => sendDocument(c, org, { documentId: nomail }, { to: 'sita@example.com' }, 't'))).status, 'SENT');

  fail = true;
  const bad = await run(org, (c) => sendDocument(c, org, { documentId: inv }, {}, 't'));
  assert.equal(bad.status, 'FAILED');
  assert.equal(bad.error, '550 mailbox full second line');
  assert.deepEqual((await run(org, (c) => listEmails(c, { documentId: inv, limit: 10 }))).map((m) => m.status), ['FAILED', 'SENT']);

  // another business sees none of it
  const other = await newOrg(pool);
  assert.equal((await run(other, (c) => getEmailSettings(c))).enabled, false);
  assert.equal((await run(other, (c) => listEmails(c, { limit: 10 }))).length, 0);
});

test('inside FlowXP the mail goes through the FlowXP mailbox, shown as business via FlowBook', { skip }, async () => {
  const sent: Mail[] = []; let configured = false;
  useHostMail({ configured: async () => configured, send: async (m) => { sent.push(m); } });
  const org = await newOrg(pool);
  const inv = await run(org, async (c) => {
    await openFinancialYear(c, org, 2027, 4, 't'); await seedTaxRates(c, org);
    const p = await createParty(c, org, { kind: 'CUSTOMER', name: 'Ravi', stateCode: '27', email: 'ravi@example.com' }, 't');
    const x = await saveDraft(c, org, null, { kind: 'INVOICE', partyId: p, date: '2026-06-01', lines: [{ description: 'Paper', quantity: '1', unitPrice: '100', taxCode: 'GST18' }] }, 't');
    await issueDocument(c, org, 'INVOICE', x, 't'); await saveEmailSettings(c, org, { enabled: true }, 't'); return x;
  });
  assert.equal((await run(org, (c) => getEmailSettings(c))).available, false);
  await assert.rejects(run(org, (c) => sendDocument(c, org, { documentId: inv }, {}, 't')), /not available on this server/);
  configured = true;
  assert.equal((await run(org, (c) => sendDocument(c, org, { documentId: inv }, {}, 't'))).status, 'SENT');
  assert.match(sent[0]!.from, / via FlowBook$/);
});
