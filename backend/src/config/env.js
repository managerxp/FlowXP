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
  /* Flow AI. With no key the assistant reports that it isn't set up; nothing is ever sent to a provider. */
  ai: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.AI_MODEL || 'claude-sonnet-5',
    maxTokens: Number(process.env.AI_MAX_TOKENS || 1200)
  },
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
  // Extra browser origins allowed to call the API (comma separated), on top of APP_ORIGIN.
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  mail: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || 'FlowXP <no-reply@flowxp.managerxp.com>'
  }
};

export default config;
