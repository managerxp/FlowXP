import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { withOrg } from '../src/db.ts';
import type { Db } from '../src/db.ts';
import { createPayment, issueDocument, saveDraft } from '../src/documents.ts';
import type { DocIn } from '../src/documents.ts';
import { createParty, seedTaxRates, updateParty } from '../src/masters.ts';
import { openFinancialYear } from '../src/periods.ts';
import { SendError, getSettings, listMessages, runReminders, saveSettings, sendMessage, setSender, toE164 } from '../src/whatsapp.ts';
import type { Outgoing } from '../src/whatsapp.ts';
import { newOrg, setup } from './helpers.ts';

process.env.FLOWBOOK_SECRET_KEY = randomBytes(32).toString('base64');
const { pool, skip, cleanup } = await setup();
test.after(() => { setSender(null); return cleanup(); });
const run = <T>(org: bigint, fn: (c: Db) => Promise<T>) => withOrg(pool, org, fn);

const shop = async () => {
  const org = await newOrg(pool, 'Sharma Traders');
  const ids = await run(org, async (c) => {
    await seedTaxRates(c, org);
    await openFinancialYear(c, org, 2027, 4, 't');
    return {
      ravi: await createParty(c, org, { kind: 'CUSTOMER', name: 'Ravi Stores', stateCode: '27', phone: '98765 43210' }, 't'),
      noPhone: await createParty(c, org, { kind: 'CUSTOMER', name: 'No Phone', stateCode: '27' }, 't')
    };
  });
  return { org, ...ids };
};
const inv = (partyId: bigint, date: string, dueDate: string): DocIn => ({ kind: 'INVOICE', partyId, date, dueDate, lines: [{ description: 'Tea', quantity: '2', unitPrice: '500', taxCode: 'GST18' }] });
const issue = (org: bigint, d: DocIn) => run(org, async (c) => { const id = await saveDraft(c, org, null, d, 't'); await issueDocument(c, org, d.kind, id, 't'); return id; });
const cloud = (org: bigint, extra = {}) => run(org, (c) => saveSettings(c, org, { mode: 'CLOUD', phoneNumberId: '1234567890', token: 'EAAB-test-token-not-real', ...extra }, 't'));
const outbox: Outgoing[] = [];

test('phone numbers become international digits, or nothing', () => {
  assert.deepEqual(['98765 43210', '+91 98765-43210', '098765 43210', '12345', ''].map(toE164), ['919876543210', '919876543210', '919876543210', null, null]);
});

test('LINK mode builds the message and a click-to-chat address, and skips parties it must not message', { skip }, async () => {
  const { org, ravi, noPhone } = await shop();
  const a = await issue(org, inv(ravi, '2026-06-10', '2026-07-10'));
  const r = await sendMessage(pool, org, 'INVOICE', { documentId: a }, { actor: 't' });
  assert.equal(r.status, 'OPENED');
  assert.match(r.text, /^Hello Ravi Stores, your invoice INV-26-27-000001 for ₹1,180\.00 is ready\. Due date: 10 Jul 2026\./);
  assert.equal(r.url, `https://wa.me/919876543210?text=${encodeURIComponent(r.text)}`);

  const b = await issue(org, inv(noPhone, '2026-06-10', '2026-07-10'));
  assert.equal((await sendMessage(pool, org, 'REMINDER', { documentId: b }, { actor: 't' })).error, 'No usable mobile number on the party');
  await run(org, (c) => updateParty(c, org, ravi, { whatsappOptOut: true }, 't'));
  assert.match((await sendMessage(pool, org, 'REMINDER', { documentId: a }, { actor: 't' })).error ?? '', /opted out/);
  assert.deepEqual((await run(org, (c) => listMessages(c, { limit: 10 }))).map((m) => m.status).reverse(), ['OPENED', 'SKIPPED', 'SKIPPED']);
});

test('the token is kept encrypted and never read back; CLOUD sends the approved template with its values', { skip }, async () => {
  const { org, ravi } = await shop();
  await assert.rejects(run(org, (c) => saveSettings(c, org, { mode: 'CLOUD' }, 't')), /phone number ID and access token/);
  await cloud(org);
  const stored = (await pool.query(`SELECT token_enc FROM whatsapp_settings WHERE organization_id = $1`, [org])).rows[0].token_enc as string;
  assert.ok(!stored.includes('EAAB'), 'not plain text');
  const shown = await run(org, (c) => getSettings(c));
  assert.equal(shown.hasToken, true);
  assert.ok(!JSON.stringify(shown).includes('EAAB'));

  setSender(async (m) => { outbox.push(m); return { ref: 'wamid.1' }; });
  const a = await issue(org, inv(ravi, '2026-06-10', '2026-07-10'));
  const out = await sendMessage(pool, org, 'INVOICE', { documentId: a }, { actor: 't' });
  assert.equal(out.status, 'SENT');
  const m = outbox.at(-1) as Outgoing;
  assert.deepEqual([m.to, m.template, m.token, m.params], ['919876543210', 'flowbook_invoice', 'EAAB-test-token-not-real', ['Ravi Stores', 'INV-26-27-000001', '1,180.00', '10 Jul 2026', 'Sharma Traders']]);

  const pay = await run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: ravi, date: '2026-06-20', mode: 'UPI', amount: 50000n, allocations: [{ documentId: a, amount: 50000n }], idempotencyKey: 'wa-pay-0001' }, 't'));
  const receipt = await run(org, async (c) => (await c.query(`SELECT id FROM payments WHERE number = $1`, [pay.number])).rows[0].id as bigint);
  await sendMessage(pool, org, 'RECEIPT', { paymentId: receipt }, { actor: 't' });
  assert.deepEqual([(outbox.at(-1) as Outgoing).template, (outbox.at(-1) as Outgoing).params.slice(1, 3)], ['flowbook_payment_received', ['500.00', '20 Jun 2026']]);

  setSender(async () => { throw new SendError('Template not approved'); });
  const failed = await sendMessage(pool, org, 'REMINDER', { documentId: a }, { actor: 't' });
  assert.deepEqual([failed.status, failed.error], ['FAILED', 'Template not approved']);
  assert.equal((await run(org, (c) => listMessages(c, { documentId: a, limit: 1 })))[0]?.status, 'FAILED');
});

test('automatic reminders go out once per invoice and offset, only for unpaid invoices, only when turned on', { skip }, async () => {
  const { org, ravi } = await shop();
  setSender(async (m) => { outbox.push(m); return { ref: 'wamid.2' }; });
  const a = await issue(org, inv(ravi, '2026-06-10', '2026-07-10'));
  await cloud(org, { reminderOffsets: [-3, 0] });
  const before = outbox.length;
  assert.deepEqual(await runReminders(pool, '2026-07-07'), { sent: 0, failed: 0, skipped: 0 }, 'off until switched on');
  await cloud(org, { autoReminders: true });
  assert.equal((await runReminders(pool, '2026-07-06')).sent, 0, 'too early');
  assert.equal((await runReminders(pool, '2026-07-07')).sent, 1, 'three days before the due date');
  assert.equal((await runReminders(pool, '2026-07-07')).sent, 0, 'not twice');
  assert.equal((await runReminders(pool, '2026-07-10')).sent, 1, 'on the due date');
  assert.equal(outbox.length - before, 2);
  assert.equal((outbox.at(-1) as Outgoing).template, 'flowbook_payment_reminder');

  await run(org, (c) => createPayment(c, org, { direction: 'IN', partyId: ravi, date: '2026-07-11', mode: 'CASH', amount: 118000n, allocations: [{ documentId: a, amount: 118000n }], idempotencyKey: 'wa-pay-0002' }, 't'));
  await run(org, (c) => saveSettings(c, org, { reminderOffsets: [-3, 0, 1] }, 't'));
  assert.equal((await runReminders(pool, '2026-07-11')).sent, 0, 'a paid invoice gets nothing');
});
