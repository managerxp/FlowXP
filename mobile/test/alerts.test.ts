import test from 'node:test';
import assert from 'node:assert/strict';
import { choiceOf, nextStep, projectIdOf, screenFor } from '../src/lib/alerts.ts';

test('tapping an alert opens only a screen the app knows', () => {
  assert.equal(screenFor({ route: '/kitchen' }), '/kitchen');
  assert.equal(screenFor({ route: '/tables', category: 'orders' }), '/tables');
  assert.equal(screenFor({ route: '/appointments' }), '/appointments');
  for (const bad of [{ route: '/login' }, { route: 'https://evil.test' }, { route: '/../../etc' }, { route: 42 }, { route: ['/kitchen'] }, null, undefined, 'x', 7]) assert.equal(screenFor(bad), null, JSON.stringify(bad));
});

test('with no screen named, what the alert was about decides', () => {
  assert.equal(screenFor({ category: 'stock' }), '/stock');
  assert.equal(screenFor({ category: 'kitchen' }), '/kitchen');
  assert.equal(screenFor({ route: null, category: 'ready' }), '/tables');
  assert.equal(screenFor({ category: 'integrations' }), '/tables');
  assert.equal(screenFor({ category: 'bookings' }), '/appointments');
  assert.equal(screenFor({ category: 'sales' }), null);
  assert.equal(screenFor({ route: '/evil', category: 'stock' }), '/stock', 'an unknown screen falls back to the topic');
});

test('what was chosen is read back as it was kept', () => {
  assert.equal(choiceOf('1'), 'on'); assert.equal(choiceOf('0'), 'off');
  for (const v of [null, '', 'yes', 'true']) assert.equal(choiceOf(v), 'unasked');
});

test('on opening the app: keep registered, ask once, or leave alone', () => {
  assert.equal(nextStep('on', 'granted', true), 'register');
  assert.equal(nextStep('unasked', 'granted', false), 'register', 'permission given some other way: register');
  assert.equal(nextStep('off', 'granted', true), 'nothing', 'switched off in the app: never register again');
  assert.equal(nextStep('on', 'denied', true), 'nothing', 'blocked in the phone: do not pester');
  assert.equal(nextStep('unasked', 'undetermined', false), 'ask');
  assert.equal(nextStep('unasked', 'undetermined', true), 'nothing', 'asked once already');
  assert.equal(nextStep('off', 'undetermined', false), 'nothing');
});

test('no Expo project id means no alerts, not an error', () => {
  assert.equal(projectIdOf({ extra: { eas: { projectId: 'abc-123' } } }), 'abc-123');
  assert.equal(projectIdOf(null, { projectId: 'from-eas' }), 'from-eas');
  assert.equal(projectIdOf({}, null), null);
  assert.equal(projectIdOf({ extra: { eas: { projectId: '' } } }), null);
  assert.equal(projectIdOf({ extra: { eas: { projectId: 5 } } }), null);
});
