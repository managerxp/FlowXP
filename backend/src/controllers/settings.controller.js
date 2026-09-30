/*
 * Platform config the admin can change without a deploy (owner's request,
 * 2026-09-29): which payment gateway is live and its keys, and which
 * email/SMS/WhatsApp provider is live and its credentials. Backed by
 * modules/platformSettings.js — a DB row wins over the matching .env value,
 * so an install with nothing saved here behaves exactly as before.
 *
 * Every GET here returns secrets masked; a saved secret is never sent back
 * to the browser. A PUT only touches the fields it's given, so leaving a
 * secret field blank in the form keeps the one already saved (see
 * setPlatformSetting's merge rule).
 */
import { getPlatformSettingMasked, setPlatformSetting } from '../modules/platformSettings.js';
import { recordAudit } from '../modules/events.js';

// Selectable today; a provider not in this list has no adapter yet; picking it would
// silently do nothing, so it's refused rather than pretended to work.
const PAYMENT_PROVIDERS = ['cashfree'];
const MESSAGING_PROVIDERS = ['log', 'whatsapp_cloud', 'twilio'];

const bad = (res, message) => res.status(400).json({ success: false, message });

const auditSettingsChange = (req, key, patch, secretFields) => {
  const metadata = { ...patch };
  for (const f of secretFields) if (metadata[f]) metadata[f] = '(changed)'; // never write a real secret into the audit log
  recordAudit(req, { action: 'admin.settings_updated', resource_type: 'platform_setting', resource_id: key, metadata });
};

/* ==========================================================================
   GET/PUT /api/admin/settings/payment-gateway
   ========================================================================== */
export const getPaymentGateway = async (req, res) => {
  const setting = await getPlatformSettingMasked('payment_gateway');
  res.json({
    success: true,
    data: setting?.value || { provider: 'cashfree', cashfreeAppId: '', cashfreeSecretKey: '', cashfreeEnv: 'SANDBOX' },
    availableProviders: PAYMENT_PROVIDERS
  });
};

export const updatePaymentGateway = async (req, res) => {
  const { provider, cashfreeAppId, cashfreeSecretKey, cashfreeEnv } = req.body || {};
  if (provider !== undefined && !PAYMENT_PROVIDERS.includes(provider)) {
    return bad(res, `${provider} isn't wired up yet — only Cashfree works today.`);
  }
  if (cashfreeEnv !== undefined && !['SANDBOX', 'PRODUCTION'].includes(cashfreeEnv)) {
    return bad(res, 'Environment must be SANDBOX or PRODUCTION');
  }
  const patch = {};
  if (provider !== undefined) patch.provider = provider;
  if (cashfreeAppId !== undefined) patch.cashfreeAppId = String(cashfreeAppId).trim();
  if (cashfreeSecretKey !== undefined) patch.cashfreeSecretKey = String(cashfreeSecretKey).trim();
  if (cashfreeEnv !== undefined) patch.cashfreeEnv = cashfreeEnv;

  const updated = await setPlatformSetting('payment_gateway', patch, req.auth.userId);
  auditSettingsChange(req, 'payment_gateway', patch, ['cashfreeSecretKey']);
  res.json({ success: true, data: updated.value });
};

/* ==========================================================================
   GET/PUT /api/admin/settings/email
   ========================================================================== */
export const getEmailSettings = async (req, res) => {
  const setting = await getPlatformSettingMasked('email');
  res.json({ success: true, data: setting?.value || { smtpHost: '', smtpPort: 587, smtpUser: '', smtpPass: '', mailFrom: '' } });
};

export const updateEmailSettings = async (req, res) => {
  const { smtpHost, smtpPort, smtpUser, smtpPass, mailFrom } = req.body || {};
  const patch = {};
  if (smtpHost !== undefined) patch.smtpHost = String(smtpHost).trim();
  if (smtpPort !== undefined) patch.smtpPort = Number(smtpPort) || 587;
  if (smtpUser !== undefined) patch.smtpUser = String(smtpUser).trim();
  if (smtpPass !== undefined) patch.smtpPass = String(smtpPass).trim();
  if (mailFrom !== undefined) patch.mailFrom = String(mailFrom).trim();

  const updated = await setPlatformSetting('email', patch, req.auth.userId);
  auditSettingsChange(req, 'email', patch, ['smtpPass']);
  res.json({ success: true, data: updated.value });
};

/* ==========================================================================
   GET/PUT /api/admin/settings/messaging
   ========================================================================== */
export const getMessagingSettings = async (req, res) => {
  const setting = await getPlatformSettingMasked('messaging');
  res.json({
    success: true,
    data: setting?.value || {
      provider: 'log', whatsappToken: '', whatsappPhoneId: '', whatsappLanguage: 'en',
      twilioSid: '', twilioToken: '', twilioFrom: '', twilioWhatsappFrom: '', countryCode: '91'
    },
    availableProviders: MESSAGING_PROVIDERS
  });
};

export const updateMessagingSettings = async (req, res) => {
  const body = req.body || {};
  if (body.provider !== undefined && !MESSAGING_PROVIDERS.includes(body.provider)) {
    return bad(res, 'Provider must be log, whatsapp_cloud or twilio');
  }
  const fields = ['provider', 'whatsappToken', 'whatsappPhoneId', 'whatsappLanguage', 'twilioSid', 'twilioToken', 'twilioFrom', 'twilioWhatsappFrom', 'countryCode'];
  const patch = {};
  for (const f of fields) if (body[f] !== undefined) patch[f] = String(body[f]).trim();

  const updated = await setPlatformSetting('messaging', patch, req.auth.userId);
  auditSettingsChange(req, 'messaging', patch, ['whatsappToken', 'twilioToken']);
  res.json({ success: true, data: updated.value });
};
