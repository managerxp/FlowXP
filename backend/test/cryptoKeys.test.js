import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../src/config/env.js';
import { decrypt, encrypt, needsReencrypt } from '../src/modules/crypto.js';

test('values written before ENCRYPTION_KEY existed still read once it is set, and new ones use it', () => {
  const saved = config.encryptionKey;
  try {
    config.encryptionKey = '';
    const old = encrypt('JBSWY3DP', 'flowxp-2fa');
    assert.ok(old.startsWith('v1:'));
    assert.equal(needsReencrypt(old), false);
    config.encryptionKey = 'a-separate-key-of-at-least-32-characters';
    assert.equal(decrypt(old, 'flowxp-2fa'), 'JBSWY3DP');
    assert.equal(needsReencrypt(old), true);
    const fresh = encrypt('JBSWY3DP', 'flowxp-2fa');
    assert.ok(fresh.startsWith('v2:'));
    assert.equal(decrypt(fresh, 'flowxp-2fa'), 'JBSWY3DP');
    assert.throws(() => decrypt(fresh, 'another-domain'));
    config.encryptionKey = '';
    assert.throws(() => decrypt(fresh, 'flowxp-2fa'), /ENCRYPTION_KEY/);
  } finally { config.encryptionKey = saved; }
});
