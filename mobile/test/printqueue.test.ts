import test from 'node:test';
import assert from 'node:assert/strict';
import { addJob, cleanJobs, KEEP_MS, MAX_FAILED, removeJob, type FailedJob } from '../src/lib/printQueue.ts';

const now = 1_000_000_000_000;
const receipt = (id: string, at = now): FailedJob => ({ id, kind: 'receipt', at, text: 'Bill 1', paper: '58' });

test('broken, day-old and unknown entries are dropped; newest first', () => {
  const list = cleanJobs([receipt('a', now - 10), receipt('b', now - KEEP_MS - 1), { id: 'c', kind: 'kot', at: now }, { id: 'd', kind: 'kot', at: now - 5, ref: 7 }, { id: 'e', kind: 'oops', at: now, ref: 1 }, null, 'x', { ...receipt('f'), paper: '99' }], now);
  assert.deepEqual(list.map((j) => j.id), ['d', 'a']);
  assert.deepEqual(cleanJobs('nope', now), []);
});

test('only the last ten are kept, and one orders ticket is kept once', () => {
  let list: FailedJob[] = [];
  for (let i = 0; i < 12; i++) list = addJob(list, receipt(`r${i}`, now + i), now + i);
  assert.equal(list.length, MAX_FAILED);
  assert.equal(list[0].id, 'r11');
  list = addJob(list, { id: 'k1', kind: 'kot', at: now + 20, ref: 5 }, now + 20);
  list = addJob(list, { id: 'k2', kind: 'kot', at: now + 21, ref: 5 }, now + 21);
  assert.deepEqual(list.filter((j) => j.kind === 'kot').map((j) => j.id), ['k2']);
  assert.equal(removeJob(list, 'k2').some((j) => j.id === 'k2'), false);
});
