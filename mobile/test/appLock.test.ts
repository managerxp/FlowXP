import test from 'node:test';
import assert from 'node:assert/strict';
import { GRACE_MS, clearPin, loadLock, lockStore, setBio, setPin, shouldLock, tryUnlock, unlockByBio, validPin, type SecretStore } from '../src/lib/appLock.ts';

const memory = (initial: string | null = null): SecretStore => {
  let v = initial;
  return { get: async () => v, set: async (x) => { v = x; }, clear: async () => { v = null; } };
};

test('a PIN is exactly four digits', () => {
  assert.equal(validPin('1234'), true);
  for (const bad of ['123', '12345', 'abcd', '12 4', '']) assert.equal(validPin(bad), false);
});

test('coming back locks only with a PIN and after the grace time', () => {
  assert.equal(shouldLock(false, 0, GRACE_MS * 10), false);
  assert.equal(shouldLock(true, null, 1000), false);
  assert.equal(shouldLock(true, 1000, 1000 + GRACE_MS - 1), false);
  assert.equal(shouldLock(true, 1000, 1000 + GRACE_MS), true);
});

test('the app starts locked when a PIN is saved, unlocks on the right PIN, and turning it off clears it', async () => {
  const s = memory('4321');
  await loadLock(s);
  assert.equal(lockStore.get().locked, true);
  assert.equal(tryUnlock('0000'), false);
  assert.equal(lockStore.get().locked, true);
  assert.equal(tryUnlock('4321'), true);
  assert.equal(lockStore.get().locked, false);
  assert.equal(await setPin(s, '12'), false);
  assert.equal(await setPin(s, '9999'), true);
  assert.equal(await s.get(), '9999');
  await clearPin(s);
  assert.equal(await s.get(), null);
  assert.equal(lockStore.get().pin, null);
  await loadLock(memory(null));
  assert.equal(lockStore.get().locked, false);
});

test('fingerprint / face: only with a PIN, remembered on the phone, opens the lock, and goes with the PIN', async () => {
  const pin = memory(); const bio = memory();
  await loadLock(pin, bio);
  await setBio(bio, true); assert.equal(lockStore.get().bio, false, 'no PIN, no fingerprint');
  await setPin(pin, '4321'); await setBio(bio, true); assert.equal(await bio.get(), '1');
  await loadLock(pin, bio); assert.equal(lockStore.get().locked, true); assert.equal(lockStore.get().bio, true);
  assert.equal(unlockByBio(), true); assert.equal(lockStore.get().locked, false);
  await clearPin(pin, bio); assert.equal(await bio.get(), null); assert.equal(lockStore.get().bio, false);
  lockStore.set({ locked: true }); assert.equal(unlockByBio(), false, 'switched off, it opens nothing');
  lockStore.set({ locked: false });
});
