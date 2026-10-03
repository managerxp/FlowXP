/*
 * Outbound email.
 *
 * With SMTP_HOST unset the mailer logs to the console instead of sending. That
 * is the development default on purpose: a password-reset flow that cannot be
 * tested without a real mail account does not get tested, and the reset link
 * printed to the terminal is exactly what a developer needs.
 */
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import config from '../config/env.js';
import { getPlatformSetting } from './platformSettings.js';

/* The logo travels inside the email (cid:), not as a link to our site: a link to APP_ORIGIN is a broken image
   whenever that address isn't public (development) and is blocked by default in many mail apps. */
const LOGO_CID = 'flowxp-logo';
const logoAttachment = { filename: 'flowxp-logo.png', path: fileURLToPath(new URL('../../assets/email-logo.png', import.meta.url)), cid: LOGO_CID };
const withLogo = (html) => (html?.includes(`cid:${LOGO_CID}`) ? [logoAttachment] : undefined);

/* The admin's Settings → Email screen wins when it has been filled in; otherwise the
   .env values, so an install with nothing saved there behaves exactly as before.
   Resolved fresh per send (not cached) so a saved change takes effect immediately,
   and built into a transport per send since sending mail is not a hot path. */
const buildTransport = async () => {
  const saved = await getPlatformSetting('email').catch(() => null);
  const db = saved?.value;
  const host = db?.smtpHost || config.mail.host;
  if (!host) return null;
  const port = Number(db?.smtpPort || config.mail.port);
  const user = db?.smtpUser || config.mail.user;
  const pass = db?.smtpPass || config.mail.pass;
  return {
    from: db?.mailFrom || config.mail.from,
    transport: nodemailer.createTransport({ host, port, secure: port === 465, auth: user ? { user, pass } : undefined })
  };
};

/* Throws on failure, so a queued job can retry. sendMail below swallows errors
   because the request that triggered it must not fail; a job has no such request. */
export const deliverMail = async ({ to, subject, text, html }) => {
  const built = await buildTransport();
  if (!built) {
    console.log(`\n[mail:dev] to=${to}\n[mail:dev] subject=${subject}\n${text}\n`);
    return;
  }
  await built.transport.sendMail({ from: built.from, to, subject, text, html, attachments: withLogo(html) });
};

export const sendMail = async ({ to, subject, text, html, replyTo }) => {
  const built = await buildTransport();
  if (!built) {
    console.log(`\n[mail:dev] to=${to}\n[mail:dev] subject=${subject}\n${text}\n`);
    return;
  }
  try {
    await built.transport.sendMail({ from: built.from, to, subject, text, html, replyTo, attachments: withLogo(html) });
  } catch (error) {
    /* Never fail the request that triggered the email. A signup that 500s
       because the SMTP server hiccuped loses a customer over a retryable
       problem. */
    console.error('[mail] send failed:', error.message);
  }
};

/*
 * The one HTML layout every OTP email uses — a code is the whole message, so one card with a big,
 * letter-spaced number is the entire template. Table-based markup and inline styles only: email clients
 * don't run a stylesheet, and plenty still don't run flexbox/grid, so this is the one place in the codebase
 * a hex code belongs directly in markup rather than as a design token (see design.md) — there is no
 * build step between this file and the inbox to resolve a CSS variable. Colors are FlowXP's own
 * (index.css's --color-ink-900 / --color-brand-500 / --color-ink-500), copied in by hand for that reason.
 */
const otpEmailHtml = ({ name, code, lead, note }) => `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f8fafc;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#ffffff;border:1px solid #e3e8ef;border-radius:16px;overflow:hidden;">
        <tr><td style="padding:32px 32px 0;">
          <img src="cid:${LOGO_CID}" alt="FlowXP" height="28" style="display:block;height:28px;width:auto;" />
        </td></tr>
        <tr><td style="padding:28px 32px 0;">
          <p style="margin:0;font-size:15px;line-height:1.6;color:#22324d;">Hi ${name},</p>
          <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#22324d;">${lead}</p>
        </td></tr>
        <tr><td style="padding:24px 32px 0;" align="center">
          <div style="display:inline-block;padding:16px 28px;background:#eef3ff;border-radius:12px;font-size:32px;font-weight:700;letter-spacing:0.3em;color:#0054fa;font-variant-numeric:tabular-nums;">${code}</div>
        </td></tr>
        <tr><td style="padding:20px 32px 0;">
          <p style="margin:0;font-size:13px;line-height:1.6;color:#5a6b87;">${note || 'This code expires in 10 minutes.'} If you did not request this, you can safely ignore this email.</p>
        </td></tr>
        <tr><td style="padding:28px 32px 32px;border-top:1px solid #e3e8ef;margin-top:24px;">
          <p style="margin:24px 0 0;font-size:12px;color:#65758e;">FlowXP by ManagerXP</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body>
</html>`;

export const sendPasswordReset = (to, name, code) => sendMail({
  to,
  // The code lives in the body only — a subject line is what a lock-screen notification or an inbox list
  // shows without anyone opening the email, so it is the one place a one-time code must never sit.
  subject: 'Your FlowXP password reset code',
  text: [
    `Hi ${name},`,
    '',
    `Your FlowXP password reset code is: ${code}`,
    '',
    'It expires in 10 minutes. Enter it on the reset-password screen to choose a new password.',
    '',
    'If you did not ask for this, you can ignore this email — your password is unchanged.',
    '',
    'FlowXP by ManagerXP'
  ].join('\n'),
  html: otpEmailHtml({ name, code, lead: 'Use this code to set a new FlowXP password:' })
});

export const sendEmailOtp = (to, name, code) => sendMail({
  to,
  subject: 'Your FlowXP verification code',
  text: [
    `Hi ${name},`,
    '',
    `Your FlowXP verification code is: ${code}`,
    '',
    'It expires in 10 minutes. Enter it on the sign-in screen to finish setting up your account.',
    '',
    'If you did not try to sign in to FlowXP, you can ignore this email.',
    '',
    'FlowXP by ManagerXP'
  ].join('\n'),
  html: otpEmailHtml({ name, code, lead: 'Use this code to finish signing in to FlowXP:' })
});

/** Tells a person they were added to a business; `token` (new accounts only) lets them choose a password. */
export const sendStaffInvite = (to, name, businessName, token) => {
  const link = token ? `${config.appOrigin}/reset-password?token=${token}` : `${config.appOrigin}/login`;
  return sendMail({
    to,
    subject: `You've been added to ${businessName} on FlowXP`,
    text: [
      `Hi ${name},`,
      '',
      `You now have access to ${businessName} on FlowXP.`,
      token ? 'Set your password with this link (valid for 3 days):' : 'Sign in with your existing account:',
      link,
      '',
      'FlowXP by ManagerXP'
    ].join('\n')
  });
};
