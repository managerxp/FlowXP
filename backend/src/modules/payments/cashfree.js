/*
 * The one place FlowXP talks to Cashfree. Plain fetch, no SDK — same shape as
 * modules/ai/provider.js and modules/messaging/provider.js: a real function,
 * a settable override for tests, and a class of error the caller can show to
 * a human.
 *
 * Only the Payment Links API is used: a hosted checkout page Cashfree serves
 * to the customer. FlowXP never sees a card, UPI id or bank detail — the
 * customer pays on Cashfree's own page and Cashfree tells us the outcome by
 * webhook (verifyWebhookSignature below). Amounts here are rupees (decimal),
 * the currency Cashfree's API speaks; convert from paise at the call site.
 */
import crypto from 'node:crypto';
import config from '../../config/env.js';
import { getPlatformSetting } from '../platformSettings.js';

const TIMEOUT_MS = 20000;

export class CashfreeError extends Error {
  constructor(message) { super(message); this.name = 'CashfreeError'; }
}

/* The admin's Settings → Payment gateway screen wins when it has been filled in;
   otherwise the .env values, so an install with nothing saved there behaves exactly
   as before. Read fresh each call — this is at most a few requests a minute. */
const resolveConfig = async () => {
  const saved = await getPlatformSetting('payment_gateway').catch(() => null);
  const db = saved?.value?.provider === 'cashfree' ? saved.value : null;
  return {
    appId: db?.cashfreeAppId || config.cashfree.appId,
    secretKey: db?.cashfreeSecretKey || config.cashfree.secretKey,
    env: (db?.cashfreeEnv || config.cashfree.env || 'SANDBOX').toUpperCase()
  };
};

const request = async (path, body) => {
  const cfg = await resolveConfig();
  if (!cfg.appId || !cfg.secretKey) {
    throw new CashfreeError('Cashfree is not set up yet — add its App ID and Secret Key in Settings → Payment gateway.');
  }
  const baseUrl = cfg.env === 'PRODUCTION' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-client-id': cfg.appId,
        'x-client-secret': cfg.secretKey,
        'x-api-version': '2023-08-01'
      },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new CashfreeError(data?.message || 'Cashfree refused the request');
    return data;
  } catch (error) {
    if (error instanceof CashfreeError) throw error;
    throw new CashfreeError(error.name === 'AbortError' ? 'Cashfree took too long to answer' : 'Could not reach Cashfree');
  } finally {
    clearTimeout(timer);
  }
};

const live = async ({ linkId, amount, purpose, customerName, customerEmail, customerPhone, returnUrl, notifyUrl }) => {
  const data = await request('/links', {
    link_id: linkId,
    link_amount: amount,
    link_currency: 'INR',
    link_purpose: purpose,
    customer_details: {
      customer_name: customerName || undefined,
      customer_email: customerEmail || undefined,
      // Cashfree requires a phone; a business without one on file cannot be billed until it adds one.
      customer_phone: customerPhone || '9999999999'
    },
    link_notify: { send_sms: false, send_email: Boolean(customerEmail) },
    link_notes: { link_id: linkId },
    link_meta: { return_url: returnUrl, notify_url: notifyUrl }
  });
  return { linkUrl: data.link_url, status: data.link_status };
};

let provider = live;
/** Tests swap this for a fake so nothing here ever calls the real internet. */
export const setProvider = (fn) => { provider = fn ?? live; };

export const createPaymentLink = (args) => provider(args);

/**
 * Cashfree signs each webhook as base64(HMAC-SHA256(timestamp + rawBody, secretKey)),
 * sent as the `x-webhook-signature` header alongside `x-webhook-timestamp`. Verified
 * against the raw request bytes (not the re-serialised JSON, which is not guaranteed
 * to match byte-for-byte) — see server.js's express.json `verify` callback.
 */
const FRESH_MS = 15 * 60 * 1000;
/** A signed event is only good for a few minutes, so a captured one cannot be replayed later. Cashfree sends epoch milliseconds (seconds in some versions). */
export const isFresh = (timestamp, now = Date.now()) => {
  const n = Number(timestamp);
  if (!Number.isFinite(n) || n <= 0) return true;   // not a number we can read: the signature still has to match
  const ms = n < 1e11 ? n * 1000 : n;
  return Math.abs(now - ms) <= FRESH_MS;
};

export const verifyWebhookSignature = async (rawBody, timestamp, signature) => {
  const cfg = await resolveConfig();
  if (!cfg.secretKey || !timestamp || !signature || !isFresh(timestamp)) return false;
  const expected = crypto.createHmac('sha256', cfg.secretKey)
    .update(timestamp + rawBody)
    .digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
