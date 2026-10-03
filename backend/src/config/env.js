/*
 * Configuration, read once and validated at boot.
 *
 * A missing JWT_SECRET is not a warning — a server that starts without one
 * signs tokens with `undefined` and every session it issues is forgeable.
 * Better to refuse to start than to run insecure and look healthy.
 */
import 'dotenv/config';

const required = ['DATABASE_URL', 'JWT_SECRET'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.error(
    `[config] refusing to start — missing required environment variables: ${missing.join(', ')}\n` +
    `[config] copy backend/.env.example to backend/.env and fill them in.`
  );
  process.exit(1);
}

/* In production a weak secret or a wrong origin is a security hole, not a warning. */
if (process.env.NODE_ENV === 'production') {
  const problems = [];
  if (process.env.JWT_SECRET.length < 32) problems.push('JWT_SECRET must be at least 32 characters');
  if (!(process.env.APP_ORIGIN || '').startsWith('https://')) problems.push('APP_ORIGIN must be the public https address of the app');
  if ((process.env.STORAGE_DRIVER || 'local').toLowerCase() === 's3') {
    for (const key of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) if (!process.env[key]) problems.push(`${key} is required when STORAGE_DRIVER=s3`);
  }
  const messaging = (process.env.MESSAGING_PROVIDER || 'log').toLowerCase();
  if (!['log', 'whatsapp_cloud', 'twilio'].includes(messaging)) problems.push('MESSAGING_PROVIDER must be log, whatsapp_cloud or twilio');
  if (messaging === 'whatsapp_cloud') for (const key of ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID']) if (!process.env[key]) problems.push(`${key} is required when MESSAGING_PROVIDER=whatsapp_cloud`);
  if (messaging === 'twilio') for (const key of ['TWILIO_SID', 'TWILIO_TOKEN', 'TWILIO_FROM']) if (!process.env[key]) problems.push(`${key} is required when MESSAGING_PROVIDER=twilio`);
  if (problems.length) {
    console.error(['[config] refusing to start in production:', ...problems.map((p) => ` - ${p}`)].join('\n'));
    process.exit(1);
  }
}

export const config = {
  port: Number(process.env.PORT || 5100),
  isProduction: process.env.NODE_ENV === 'production',
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  appOrigin: process.env.APP_ORIGIN || 'http://localhost:5173',
  trialDays: Number(process.env.TRIAL_DAYS || 7),
  /* Optional: if either is blank, ensureSuperAdmin() skips seeding rather than
     creating an admin account with no usable password. */
  superAdmin: {
    email: process.env.SUPER_ADMIN_EMAIL || '',
    password: process.env.SUPER_ADMIN_PASSWORD || ''
  },
  /* Flow AI — chat, onboarding, menu scanning and review replies all go through modules/ai/provider.js's
     single complete(), which dispatches to whichever provider AI_PROVIDER names. Each call picks a model
     *tier* ('default' | 'fast' | 'reasoning' — see each feature module's own complete() call for which it
     asks for and why); `apiKey`/`model` stay as "the active provider's default-tier pair" for anything
     that doesn't care which tier (isConfigured(), the /ai/status screen), while `models` is the full tier
     map provider.js actually picks from. Anthropic has no tiers configured here (nobody asked for that
     yet), so all three names resolve to its one AI_MODEL. With no key for the active provider, the
     assistant reports that it isn't set up; nothing is ever sent to a provider. */
  ai: (() => {
    const provider = (process.env.AI_PROVIDER || 'anthropic').toLowerCase();
    const anthropicModel = process.env.AI_MODEL || 'claude-sonnet-5';
    // GEMINI_DEFAULT_MODEL is the one every other tier falls back to, so setting only that still gives
    // all three tiers a real model; GEMINI_MODEL (the old single-model name) is one fallback step further
    // down, for an env file nobody has touched since before tiers existed.
    const geminiDefault = process.env.GEMINI_DEFAULT_MODEL || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    const byProvider = {
      anthropic: { apiKey: process.env.ANTHROPIC_API_KEY || '', models: { default: anthropicModel, fast: anthropicModel, reasoning: anthropicModel } },
      gemini: {
        apiKey: process.env.GEMINI_API_KEY || '',
        models: {
          default: geminiDefault,
          fast: process.env.GEMINI_FAST_MODEL || geminiDefault,
          reasoning: process.env.GEMINI_REASONING_MODEL || geminiDefault
        }
      }
    };
    const active = byProvider[provider] || byProvider.anthropic;
    return { provider, apiKey: active.apiKey, model: active.models.default, models: active.models, maxTokens: Number(process.env.AI_MAX_TOKENS || 1200) };
  })(),
  /* Uploaded files. 'local' = this server's disk; 's3' = any S3-compatible bucket (AWS S3, Cloudflare R2, Spaces, MinIO). */
  storage: {
    driver: (process.env.STORAGE_DRIVER || 'local').toLowerCase(),
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || 'auto',
    bucket: process.env.S3_BUCKET || '',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    publicUrl: process.env.S3_PUBLIC_URL || ''
  },
  /* Customer messages (bill, booking, offers). 'log' sends nothing: messages are only recorded as skipped.
     whatsapp_cloud = Meta WhatsApp Cloud API (approved templates); twilio = SMS (or WhatsApp) by Twilio. */
  messaging: {
    provider: (process.env.MESSAGING_PROVIDER || 'log').toLowerCase(),
    whatsappToken: process.env.WHATSAPP_TOKEN || '',
    whatsappPhoneId: process.env.WHATSAPP_PHONE_ID || '',
    whatsappLanguage: process.env.WHATSAPP_TEMPLATE_LANG || 'en',
    twilioSid: process.env.TWILIO_SID || '',
    twilioToken: process.env.TWILIO_TOKEN || '',
    twilioFrom: process.env.TWILIO_FROM || '',
    twilioWhatsappFrom: process.env.TWILIO_WHATSAPP_FROM || '',
    countryCode: process.env.MESSAGING_COUNTRY_CODE || '91'
  },
  // Extra browser origins allowed to call the API (comma separated), on top of APP_ORIGIN.
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  /* Cashfree Payment Links — custom-priced subscription payments (no keys = the
     admin gets a clear "not set up yet" error instead of a broken call). */
  cashfree: {
    appId: process.env.CASHFREE_APP_ID || '',
    secretKey: process.env.CASHFREE_SECRET_KEY || '',
    env: (process.env.CASHFREE_ENV || 'SANDBOX').toUpperCase() // SANDBOX | PRODUCTION
  },
  mail: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'FlowXP <flowxp.manager@gmail.com>'
  }
};

export default config;
