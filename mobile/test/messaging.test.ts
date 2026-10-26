/* Messaging on the phone: who may use it, the offer checks, the wording of the preview and the log, and the six-language coverage. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGING_TEXTS, TOGGLES, billSentText, campaignBody, canMessaging, canRemind, canSendBill, reminderSentText, canRetry, canSend, messageSub, messageTitle, messagesPath, previewText, progressText, resendText, statusLabel, type Message } from '../src/lib/messaging.ts';
import { HI } from '../src/lib/i18n.ts';
import { BN, KN, ML, TA, TE } from '../src/lib/i18n.more.ts';

test('only owners and admins use messaging', () => { assert.equal(canMessaging('OWNER'), true); assert.equal(canMessaging('ADMIN'), true); assert.equal(canMessaging('CASHIER'), false); assert.equal(canMessaging(undefined), false); });

test('the preview line says who will get the offer', () => {
  assert.equal(previewText(null), 'Counting…'); assert.equal(previewText({ count: 0, error: 'Choose who to send to' }), 'Choose who to send to');
  assert.equal(previewText({ count: 1, sample: ['Asha'] }), '1 customer will get it (Asha).');
  assert.equal(previewText({ count: 5, sample: ['Asha', 'Ravi'] }), '5 customers will get it (Asha, Ravi…).');
  assert.equal(previewText({ count: 2, sample: ['Asha', 'Ravi'] }), '2 customers will get it (Asha, Ravi).'); assert.equal(previewText({ count: 3 }), '3 customers will get it.');
});

test('an offer can be sent only with text, someone to send to, and no send in progress', () => {
  const ok = { count: 3 };
  assert.equal(canSend('Ten percent off dinner', ok, false), true); assert.equal(canSend('hi', ok, false), false, 'under five letters'); assert.equal(canSend('   shor   ', ok, false), false);
  assert.equal(canSend('Ten percent off dinner', null, false), false); assert.equal(canSend('Ten percent off dinner', { count: 0 }, false), false); assert.equal(canSend('Ten percent off dinner', { count: 2, error: 'x' }, false), false); assert.equal(canSend('Ten percent off dinner', ok, true), false);
  assert.deepEqual(campaignBody('LAPSED', 60, '  Come back  '), { segment: 'LAPSED', days: 60, text: 'Come back' });
  assert.equal(progressText({ sent: 4 }), 'Sent 4'); assert.equal(progressText({ sent: 4, failed: 1, skipped: 2 }), 'Sent 4 · failed 1 · skipped 2'); assert.equal(progressText({}), 'Sent 0');
});

test('the log: status words, which messages can be tried again, and the lines shown', () => {
  const m: Message = { message_id: 1, created_at: '2026-10-15T10:00:00Z', customer_name: null, phone: '9876543210', channel: 'WHATSAPP', body: 'Your bill', status: 'FAILED', error: 'No template' };
  assert.equal(statusLabel('SENT'), 'Sent'); assert.equal(statusLabel('QUEUED'), 'Queued'); assert.equal(canRetry(m), true); assert.equal(canRetry({ ...m, status: 'SKIPPED' }), true); assert.equal(canRetry({ ...m, status: 'SENT' }), false); assert.equal(canRetry({ ...m, status: 'QUEUED' }), false);
  assert.equal(messageTitle(m), '9876543210'); assert.equal(messageTitle({ ...m, customer_name: 'Asha' }), 'Asha');
  assert.equal(messageSub(m, '15 Oct, 3:30 pm'), '15 Oct, 3:30 pm · 9876543210 · WhatsApp · Your bill · No template'); assert.equal(messageSub({ ...m, channel: 'SMS', error: null }, 'now'), 'now · 9876543210 · SMS · Your bill');
  assert.equal(messagesPath(''), '/messaging/messages'); assert.equal(messagesPath('failed'), '/messaging/messages?status=failed'); assert.equal(resendText('SENT'), 'Sent'); assert.equal(resendText('FAILED'), 'Still failed');
  assert.deepEqual(TOGGLES.map((x) => x.key), ['bill_auto', 'reservation_updates', 'waitlist_updates', 'loyalty_nudge', 'job_updates']);
});

test('one tap to send the bill: who it can go to, and what the person is told', () => {
  assert.equal(canSendBill('9876543210'), true); assert.equal(canSendBill('+91 98765 43210'), true); assert.equal(canSendBill('12345'), false); assert.equal(canSendBill(null), false); assert.equal(canSendBill(''), false);
  assert.equal(billSentText({ status: 'SENT' }), 'Bill sent to the customer'); assert.match(billSentText({ status: 'SKIPPED' }), /no messaging service/); assert.equal(billSentText({ status: 'QUEUED' }), 'Bill is on its way to the customer');
  assert.equal(billSentText({ status: 'FAILED', error: 'Template missing' }), 'Could not send: Template missing'); assert.equal(billSentText({ status: 'FAILED' }), 'Could not send: try again');
});

test('a payment reminder: only for someone who owes and has a mobile; the result is told plainly', () => {
  assert.equal(canRemind('9876543210', 150), true); assert.equal(canRemind('9876543210', 0), false); assert.equal(canRemind(null, 150), false); assert.equal(canRemind('123', 150), false);
  assert.equal(reminderSentText({ status: 'SENT' }), 'Reminder sent to the customer'); assert.match(reminderSentText({ status: 'SKIPPED' }), /no messaging service/); assert.equal(reminderSentText({ status: 'FAILED', error: 'x' }), 'Could not send: x');
});

test('every text of the Messaging screens is translated into all six languages', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort().join(',');
  const dicts = { HI, ML, TA, BN, TE, KN } as Record<string, Record<string, string>>;
  const missing: string[] = [];
  for (const [name, dict] of Object.entries(dicts)) for (const k of new Set(MESSAGING_TEXTS)) { if (!(k in dict)) missing.push(`${name}: ${k}`); else assert.equal(names(dict[k]), names(k), `${name}: ${k}`); }
  assert.deepEqual(missing, []);
});
