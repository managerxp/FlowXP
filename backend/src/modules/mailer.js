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

const transport = config.mail.host
  ? nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined
    })
  : null;

/* Throws on failure, so a queued job can retry. sendMail below swallows errors
   because the request that triggered it must not fail; a job has no such request. */
export const deliverMail = async ({ to, subject, text, html }) => {
  if (!transport) {
    console.log(`\n[mail:dev] to=${to}\n[mail:dev] subject=${subject}\n${text}\n`);
    return;
  }
  await transport.sendMail({ from: config.mail.from, to, subject, text, html });
};

export const sendMail = async ({ to, subject, text, html }) => {
  if (!transport) {
    console.log(`\n[mail:dev] to=${to}\n[mail:dev] subject=${subject}\n${text}\n`);
    return;
  }
  try {
    await transport.sendMail({ from: config.mail.from, to, subject, text, html });
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
