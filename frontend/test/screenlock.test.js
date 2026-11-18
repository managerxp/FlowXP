/* The web screen lock: a PIN is checked against its hash, the screen locks after the idle time, a lock survives a reload, and turning it off unlocks. */
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const L = await import('../src/lib/screenLock.js');

test('screen lock: PIN, idle time, lock now, and off', async () => {
  assert.equal(L.shouldBeLocked(L.lockSettings(), L.lockState(), Date.now()), false, 'no PIN, no lock');
  assert.equal(await L.setLockPin('12', 5), false);
  assert.equal(await L.setLockPin('2580', 5), true);
  assert.ok(!JSON.stringify(L.lockSettings()).includes('2580'), 'the digits are never stored');
  const s = L.lockSettings(), st = L.lockState();
  assert.equal(L.shouldBeLocked(s, st, st.active + 5 * 60000 - 1), false);
  assert.equal(L.shouldBeLocked(s, st, st.active + 5 * 60000), true);
  L.lockNow(); assert.equal(L.shouldBeLocked(L.lockSettings(), L.lockState(), Date.now()), true, 'locked stays locked, even after a reload');
  assert.equal(await L.checkPin('0000'), false);
  assert.equal(await L.checkPin('2580'), true);
  assert.equal(L.shouldBeLocked(L.lockSettings(), L.lockState(), Date.now()), false);
  L.clearLock(); assert.equal(L.lockSettings(), null);
});
