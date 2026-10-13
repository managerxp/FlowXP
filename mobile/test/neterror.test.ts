import test from 'node:test';
import assert from 'node:assert/strict';
import { isOfflineMessage, netStore, offlineFor, reportNetwork } from '../src/lib/net.ts';
import { CATEGORIES, flushReports, reportBody, reportProblem, submitReport, type ReportInput } from '../src/lib/bugreport.ts';

test('an answer of any kind is online, no answer is offline, and the moment it went offline is kept once', () => {
  reportNetwork(true);
  assert.equal(netStore.get().online, true);
  reportNetwork(false, 1000); reportNetwork(false, 5000);
  assert.deepEqual([netStore.get().online, netStore.get().since], [false, 1000]);
  reportNetwork(true);
  assert.deepEqual([netStore.get().online, netStore.get().since], [true, null]);
});

test('the words for a connection problem are recognised, a server answer is not', () => {
  assert.equal(isOfflineMessage("You're offline, or the server can't be reached. Check the connection and try again."), true);
  assert.equal(isOfflineMessage('No internet. Check your connection and try again.'), true);
  assert.equal(isOfflineMessage('Your password is not right.'), false);
  assert.equal(offlineFor(null), ''); assert.equal(offlineFor(0, 20000), 'just now'); assert.equal(offlineFor(0, 60000), '1 minute'); assert.equal(offlineFor(0, 7200000), '2 h 0 min');
});

test('a report needs a few words, an unknown kind becomes "something else", and the text is trimmed', () => {
  assert.match(reportProblem('short'), /few words/); assert.equal(reportProblem('The pay screen froze on cash.'), ''); assert.match(reportProblem('x'.repeat(2001)), /too long/);
  assert.deepEqual(reportBody({ category: 'NOPE', description: '  froze  ' }), { category: 'OTHER', description: 'froze' });
  assert.equal(CATEGORIES.length, 5);
});

test('with no signal a report waits (newest five) and goes out later, oldest first; a refusal is not kept', async () => {
  let stored: ReportInput[] = [];
  const queue = { read: async () => stored, write: async (r: ReportInput[]) => { stored = r; } };
  const offline = async () => { throw new TypeError('offline'); };
  const isNet = (e: unknown) => e instanceof TypeError;
  for (let i = 1; i <= 7; i++) assert.equal(await submitReport({ category: 'BROKE', description: `problem ${i} here ok` }, offline, queue, isNet), 'queued');
  assert.deepEqual(stored.map((r) => r.description), ['problem 3 here ok', 'problem 4 here ok', 'problem 5 here ok', 'problem 6 here ok', 'problem 7 here ok']);
  const got: string[] = [];
  let fail = 0;
  const flaky = async (b: ReportInput) => { if (got.length === 2 && fail++ === 0) throw new Error('down'); got.push(b.description); };
  assert.equal(await flushReports(flaky, queue), 2); assert.equal(stored.length, 3);
  assert.equal(await flushReports(flaky, queue), 3); assert.equal(stored.length, 0);
  await assert.rejects(submitReport({ category: 'BROKE', description: 'refused by the server' }, async () => { throw new Error('400'); }, queue, isNet), /400/);
  assert.equal(stored.length, 0);
  assert.equal(await submitReport({ category: 'BROKE', description: 'goes through fine' }, async () => {}, queue, isNet), 'sent');
});
