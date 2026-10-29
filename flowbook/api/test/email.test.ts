import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { issueDocument, saveDraft } from '../src/documents.ts';
import { getEmailSettings, listEmails, saveEmailSettings, sendDocument, setMailer, testConnection } from '../src/email.ts';
import type { Mail } from '../src/email.ts';
import { createParty, seedTaxRates } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
import { newOrg, setup } from './helpers.ts';

process.env.FLOWBOOK_SECRET_KEY = randomBytes(32).toString('base64');
const { pool, skip, cleanup } = await setup();
test.after(() => { setMailer(null); return cleanup(); });
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);

test('settings keep the password sealed, refuse private hosts, and a document goes out through the mailer and is logged', { skip }, async () => {
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

  await assert.rejects(run(org, (c) => sendDocument(c, org, { documentId: inv }, {}, 't')), /not set up/);
  await assert.rejects(run(org, (c) => saveEmailSettings(c, org, { enabled: true, host: 'localhost', fromEmail: 'a@b.com' }, 't')), /public address/);
  await assert.rejects(run(org, (c) => saveEmailSettings(c, org, { enabled: true, host: '192.168.1.5', fromEmail: 'a@b.com' }, 't')), /public address/);
  await assert.rejects(run(org, (c) => saveEmailSettings(c, org, { enabled: true, host: 'smtp.example.com' }, 't')), /sent from/);
  await run(org, (c) => saveEmailSettings(c, org, { enabled: true, host: 'smtp.example.com', port: 465, secure: true, username: 'me', password: 'hunter2hunter2', fromName: 'Shop\r\nBcc: x@evil.com', fromEmail: 'shop@example.com' }, 't'));
  const s = await run(org, (c) => getEmailSettings(c));
  assert.equal(s.hasPassword, true);
  assert.ok(!JSON.stringify(s).includes('hunter2'), 'the password is never returned');
  assert.ok(!(await pool.query(`SELECT password_enc FROM email_settings WHERE organization_id = $1`, [org])).rows[0].password_enc.includes('hunter2'), 'and not stored in the clear');
  // saving again without a password keeps it
  await run(org, (c) => saveEmailSettings(c, org, { fromName: 'Shop' }, 't'));
  assert.equal((await run(org, (c) => getEmailSettings(c))).hasPassword, true);

  assert.deepEqual(await run(org, (c) => testConnection(c)), { ok: true });
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
  assert.deepEqual(await run(org, (c) => testConnection(c)), { ok: false, error: 'auth failed' });

  // another business sees none of it
  const other = await newOrg(pool);
  assert.equal((await run(other, (c) => getEmailSettings(c))).enabled, false);
  assert.equal((await run(other, (c) => listEmails(c, { limit: 10 }))).length, 0);
});
