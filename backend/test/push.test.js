import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMessage, sendMessages, validToken } from '../src/modules/push.js';
import { CATEGORIES } from '../src/modules/notifications.js';

test('only an address the app can have made is accepted', () => {
  assert.equal(validToken('ExponentPushToken[abc123_DEF-456xyz]'), true);
  assert.equal(validToken('ExpoPushToken[abc123_DEF-456xyz]'), true);
  for (const bad of ['', null, undefined, 'abc', 'ExponentPushToken[]', 'ExponentPushToken[short]', 'https://evil.test', 'ExponentPushToken[abc 123 456 789]']) assert.equal(validToken(bad), false, String(bad));
});

test('an urgent message rings, and an ordinary one is quiet; a long text is cut', () => {
  const urgent = buildMessage('ExponentPushToken[abcdefghij]', { title: 'T'.repeat(300), body: 'b'.repeat(500), data: { route: '/kitchen' }, urgent: true });
  assert.equal(urgent.channelId, 'alerts'); assert.equal(urgent.priority, 'high'); assert.equal(urgent.title.length, 100); assert.equal(urgent.body.length, 240); assert.deepEqual(urgent.data, { route: '/kitchen' });
  const quiet = buildMessage('ExponentPushToken[abcdefghij]', { title: 'Hi' });
  assert.equal(quiet.channelId, 'default'); assert.equal(quiet.priority, 'default'); assert.equal(quiet.body, undefined);
});

test('messages go in batches of 100, and a token Expo calls gone is reported', async () => {
  const messages = Array.from({ length: 230 }, (_, i) => ({ to: `ExponentPushToken[token${String(i).padStart(6, '0')}]` }));
  const sizes = [];
  const fetchImpl = async (_url, init) => {
    const batch = JSON.parse(init.body); sizes.push(batch.length);
    return { ok: true, json: async () => ({ data: batch.map((m) => (m.to.endsWith('000150]') ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' })) }) };
  };
  const dead = await sendMessages(messages, { fetchImpl });
  assert.deepEqual(sizes, [100, 100, 30]);
  assert.deepEqual(dead, ['ExponentPushToken[token000150]']);
});

test('a push service that is down or answers nonsense makes the job retry', async () => {
  await assert.rejects(() => sendMessages([{ to: 'x' }], { fetchImpl: async () => ({ ok: false, status: 503 }) }), /503/);
  await assert.rejects(() => sendMessages([{ to: 'x' }], { fetchImpl: async () => ({ ok: true, json: async () => ({ oops: 1 }) }) }), /could not read/);
});

test('every category says who may hear it and whether it goes to the phone', () => {
  for (const [name, spec] of Object.entries(CATEGORIES)) {
    assert.ok(name.length <= 20, `${name} fits the column`);
    assert.ok(spec.permission, `${name} has a permission`); assert.equal(typeof spec.push, 'boolean', `${name} has a push default`);
  }
  assert.deepEqual(CATEGORIES.orders.permission, ['billing', 'kitchen']);
});
