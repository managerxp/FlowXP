/*
 * Platform settings — payment gateway, email and messaging config moved from
 * .env-only to admin-editable (owner's request, 2026-09-29). Covers the
 * encrypt/mask/merge rules in modules/platformSettings.js, the validation in
 * controllers/settings.controller.js, and that modules/crypto.js's domain
 * separation actually holds (a secret encrypted for one setting can't be
 * decrypted as another).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDb } from './helpers/db.js';

const { pool, skip, cleanup } = await setupTestDb();
const { runMigrations } = await import('../src/config/migrate.js');
const settings = await import('../src/controllers/settings.controller.js');
const platformSettings = await import('../src/modules/platformSettings.js');
const cryptoModule = await import('../src/modules/crypto.js');

test.after(cleanup);

const fakeRes = () => ({ code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const req = (body = {}) => ({ body, auth: { userId: null } });

test('setup', { skip }, async () => { await runMigrations(pool); });

test('crypto.js domain separation: a secret encrypted for one domain fails to decrypt as another', { skip }, () => {
  const cipher = cryptoModule.encrypt('top-secret', 'flowxp-platform-setting:payment_gateway');
  assert.equal(cryptoModule.decrypt(cipher, 'flowxp-platform-setting:payment_gateway'), 'top-secret');
  assert.throws(() => cryptoModule.decrypt(cipher, 'flowxp-platform-setting:messaging'));
});

test('payment gateway: defaults, then save and mask the secret', { skip }, async () => {
  const before = fakeRes();
  await settings.getPaymentGateway(req(), before);
  assert.equal(before.body.data.cashfreeSecretKey, ''); // nothing saved yet

  const rejected = fakeRes();
  await settings.updatePaymentGateway(req({ provider: 'razorpay' }), rejected);
  assert.equal(rejected.code, 400); // no adapter for it yet — refused, not silently accepted

  const badEnv = fakeRes();
  await settings.updatePaymentGateway(req({ cashfreeEnv: 'STAGING' }), badEnv);
  assert.equal(badEnv.code, 400);

  const saved = fakeRes();
  await settings.updatePaymentGateway(req({ cashfreeAppId: 'app_123', cashfreeSecretKey: 'shh_real_secret', cashfreeEnv: 'PRODUCTION' }), saved);
  assert.equal(saved.code ?? 200, 200);
  assert.equal(saved.body.data.cashfreeAppId, 'app_123');
  assert.equal(saved.body.data.cashfreeSecretKey, '••••••••'); // masked in the response, never the real value

  // The real value round-trips underneath the mask.
  const raw = await platformSettings.getPlatformSetting('payment_gateway');
  assert.equal(raw.value.cashfreeSecretKey, 'shh_real_secret');
  assert.equal(raw.value.cashfreeEnv, 'PRODUCTION');

  // Saving again with the secret field blank (what the UI sends when it wasn't retyped) keeps the old one.
  await settings.updatePaymentGateway(req({ cashfreeAppId: 'app_456', cashfreeSecretKey: '' }), fakeRes());
  const after = await platformSettings.getPlatformSetting('payment_gateway');
  assert.equal(after.value.cashfreeAppId, 'app_456');
  assert.equal(after.value.cashfreeSecretKey, 'shh_real_secret');
});

test('email settings: save and mask smtpPass, blank keeps it', { skip }, async () => {
  await settings.updateEmailSettings(req({ smtpHost: 'smtp.test.com', smtpPort: 465, smtpUser: 'a@b.com', smtpPass: 'p@ss', mailFrom: 'FlowXP <a@b.com>' }), fakeRes());
  const masked = fakeRes();
  await settings.getEmailSettings(req(), masked);
  assert.equal(masked.body.data.smtpPass, '••••••••');
  assert.equal(masked.body.data.smtpHost, 'smtp.test.com');

  await settings.updateEmailSettings(req({ smtpHost: 'smtp2.test.com', smtpPass: '' }), fakeRes());
  const raw = await platformSettings.getPlatformSetting('email');
  assert.equal(raw.value.smtpHost, 'smtp2.test.com');
  assert.equal(raw.value.smtpPass, 'p@ss');
});

test('messaging settings: provider validation, save, mask both tokens', { skip }, async () => {
  const bad = fakeRes();
  await settings.updateMessagingSettings(req({ provider: 'carrier_pigeon' }), bad);
  assert.equal(bad.code, 400);

  await settings.updateMessagingSettings(req({
    provider: 'twilio', twilioSid: 'AC123', twilioToken: 'tok_secret', twilioFrom: '+15550001111', countryCode: '91'
  }), fakeRes());

  const masked = fakeRes();
  await settings.getMessagingSettings(req(), masked);
  assert.equal(masked.body.data.twilioToken, '••••••••');
  assert.equal(masked.body.data.twilioSid, 'AC123');

  const raw = await platformSettings.getPlatformSetting('messaging');
  assert.equal(raw.value.twilioToken, 'tok_secret');
});
