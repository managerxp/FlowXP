/*
 * Outbound email.
 *
 * With SMTP_HOST unset the mailer logs to the console instead of sending. That
 * is the development default on purpose: a password-reset flow that cannot be
 * tested without a real mail account does not get tested, and the reset link
 * printed to the terminal is exactly what a developer needs.
 */
import nodemailer from 'nodemailer';
import config from '../config/env.js';
import { getPlatformSetting } from './platformSettings.js';

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
  await built.transport.sendMail({ from: built.from, to, subject, text, html });
};

export const sendMail = async ({ to, subject, text, html }) => {
  const built = await buildTransport();
  if (!built) {
    console.log(`\n[mail:dev] to=${to}\n[mail:dev] subject=${subject}\n${text}\n`);
    return;
  }
  try {
    await built.transport.sendMail({ from: built.from, to, subject, text, html });
  } catch (error) {
    /* Never fail the request that triggered the email. A signup that 500s
       because the SMTP server hiccuped loses a customer over a retryable
       problem. */
    console.error('[mail] send failed:', error.message);
  }
};

export const sendPasswordReset = (to, name, token) => {
  const link = `${config.appOrigin}/reset-password?token=${token}`;
  return sendMail({
    to,
    subject: 'Reset your FlowXP password',
    text: [
      `Hi ${name},`,
      '',
      'Use this link to set a new FlowXP password. It expires in one hour.',
      link,
      '',
      'If you did not ask for this, you can ignore this email — your password is unchanged.',
      '',
      'FlowXP by ManagerXP'
    ].join('\n')
  });
};

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
