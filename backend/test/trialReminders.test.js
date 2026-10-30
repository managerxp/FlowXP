import test from 'node:test';
import assert from 'node:assert/strict';
import { stageFor } from '../src/modules/trialReminders.js';

const now = new Date('2026-10-30T10:00:00Z');
const at = (days) => new Date(now.getTime() + days * 86400000);

test('trial reminders: once when 2 days are left, once when ended, never twice', () => {
  assert.equal(stageFor(at(5), 0, now), 0);
  assert.equal(stageFor(at(1.5), 0, now), 1);
  assert.equal(stageFor(at(1.5), 1, now), 0);
  assert.equal(stageFor(at(-0.1), 1, now), 2);
  assert.equal(stageFor(at(-3), 0, now), 2);
  assert.equal(stageFor(at(-3), 2, now), 0);
});
