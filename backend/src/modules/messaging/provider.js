/*
 * The one place FlowXP talks to a messaging provider. Plain fetch, no SDK.
 *
 *   log            sends nothing; the message is recorded as SKIPPED (development, or "not set up yet")
 *   whatsapp_cloud Meta WhatsApp Cloud API. Business-initiated WhatsApp must use approved templates,
 *                  so it sends the template named in templates.js with the message's parameters.
 *   twilio         Twilio Messages API: SMS, or WhatsApp when the channel asks for it.
 *
 * Everything else depends only on deliver()'s shape, so setProvider() swaps in a test double.
 */
import config from '../../config/env.js';
import { getPlatformSetting } from '../platformSettings.js';

const TIMEOUT_MS = 20000;

export class MessageError extends Error {
  constructor(message) { super(message); this.name = 'MessageError'; }
}

/* The admin's Settings → Messaging screen wins when it has been filled in; otherwise
   the .env values, so an install with nothing saved there behaves exactly as before.
   Resolved fresh per call (not cached) — messages go out one at a time, not in a hot loop. */
const resolveConfig = async () => {
  const saved = await getPlatformSetting('messaging').catch(() => null);
  const db = saved?.value;
  return {
    provider: db?.provider || config.messaging.provider,
    whatsappToken: db?.whatsappToken || config.messaging.whatsappToken,
    whatsappPhoneId: db?.whatsappPhoneId || config.messaging.whatsappPhoneId,
    whatsappLanguage: db?.whatsappLanguage || config.messaging.whatsappLanguage,
    twilioSid: db?.twilioSid || config.messaging.twilioSid,
    twilioToken: db?.twilioToken || config.messaging.twilioToken,
    twilioFrom: db?.twilioFrom || config.messaging.twilioFrom,
    twilioWhatsappFrom: db?.twilioWhatsappFrom || config.messaging.twilioWhatsappFrom,
    countryCode: db?.countryCode || config.messaging.countryCode
  };
};

/** 10-digit Indian mobile (or any digits) to E.164 without the plus. */
export const toE164 = (phone, countryCode = config.messaging.countryCode) => {
  const digits = String(phone ?? '').replace(/\D/g, '');
  return digits.length === 10 ? `${countryCode}${digits}` : digits;
};

const post = async (url, { headers, body }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } catch (error) {
    throw new MessageError(error.name === 'AbortError' ? 'The messaging service took too long to answer' : 'Could not reach the messaging service');
  } finally {
    clearTimeout(timer);
  }
};

const whatsappCloud = async ({ channel, to, template }, cfg) => {
  if (channel !== 'WHATSAPP') return { status: 'SKIPPED', note: 'SMS is not available with this provider' };
  const { ok, data } = await post(`https://graph.facebook.com/v20.0/${cfg.whatsappPhoneId}/messages`, {
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.whatsappToken}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp', to: toE164(to, cfg.countryCode), type: 'template',
      template: {
        name: template.name, language: { code: cfg.whatsappLanguage },
        components: [{ type: 'body', parameters: template.params.map((text) => ({ type: 'text', text: String(text) })) }]
      }
    })
  });
  if (!ok) throw new MessageError(data?.error?.message || 'WhatsApp refused the message');
  return { status: 'SENT', providerId: data?.messages?.[0]?.id ?? null };
};

const twilio = async ({ channel, to, text }, cfg) => {
  const { twilioSid, twilioToken, twilioFrom, twilioWhatsappFrom } = cfg;
  const wa = channel === 'WHATSAPP';
  if (wa && !twilioWhatsappFrom) return { status: 'SKIPPED', note: 'No Twilio WhatsApp sender is set up' };
  const form = new URLSearchParams({
    To: `${wa ? 'whatsapp:' : ''}+${toE164(to, cfg.countryCode)}`,
    From: wa ? `whatsapp:${twilioWhatsappFrom}` : twilioFrom,
    Body: text
  });
  const { ok, data } = await post(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')}` },
    body: form.toString()
  });
  if (!ok) throw new MessageError(data?.message || 'Twilio refused the message');
  return { status: 'SENT', providerId: data?.sid ?? null };
};

const DRIVERS = {
  log: async () => ({ status: 'SKIPPED', note: 'No messaging provider is set up, so nothing was sent' }),
  whatsapp_cloud: whatsappCloud,
  twilio
};

let override = null;
/** Tests: replace the provider with `(message) => ({ status, providerId })`; null restores the real one. */
export const setProvider = (fn) => { override = fn; };

export const providerName = async () => (override ? 'test' : (await resolveConfig()).provider);
/** True when messages really go somewhere. */
export const isConnected = async () => Boolean(override) || (await resolveConfig()).provider !== 'log';
/** Which channels the provider can carry. */
export const channelsAvailable = async () => {
  if (override) return ['WHATSAPP', 'SMS'];
  const cfg = await resolveConfig();
  if (cfg.provider === 'whatsapp_cloud') return ['WHATSAPP'];
  if (cfg.provider === 'twilio') return cfg.twilioWhatsappFrom ? ['SMS', 'WHATSAPP'] : ['SMS'];
  return [];
};

/**
 * @param message { channel, to, kind, text, template: { name, params } }
 * @returns { status: 'SENT'|'SKIPPED', providerId?, note? }; throws MessageError when the provider refuses
 */
export const deliver = async (message) => {
  if (override) return override(message);
  const cfg = await resolveConfig();
  return (DRIVERS[cfg.provider] ?? DRIVERS.log)(message, cfg);
};
