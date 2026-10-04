/*
 * The /contact form's one endpoint: a visitor's message, emailed straight to the FlowXP inbox. No
 * database row — there is nothing here anyone needs to look up later, only a message that needs reading
 * once. `replyTo` is the sender's own address, so replying from the inbox goes straight back to them.
 */
import { sendMail } from '../modules/mailer.js';
import { checkEmail, checkName, firstError } from '../utils/validate.js';

const CONTACT_EMAIL = 'flowxp.manager@gmail.com';   // the same address ContactPage.jsx shows directly
const MAX_SUBJECT = 150;
const MAX_MESSAGE = 4000;

const checkText = (value, field, max) => {
  const v = String(value ?? '').trim();
  if (!v) return `Enter a ${field.toLowerCase()}`;
  if (v.length > max) return `${field} is too long`;
  return null;
};

const escapeHtml = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const send = async (req, res) => {
  const { name, email, subject, message } = req.body || {};
  const error = firstError([
    checkName(name, 'Name'),
    checkEmail(email),
    checkText(subject, 'Subject', MAX_SUBJECT),
    checkText(message, 'Message', MAX_MESSAGE)
  ]);
  if (error) return res.status(400).json({ success: false, message: error });

  const n = String(name).trim(); const e = String(email).trim(); const s = String(subject).trim(); const m = String(message).trim();
  await sendMail({
    to: CONTACT_EMAIL,
    replyTo: e,
    subject: `[Contact form] ${s}`,
    text: [`From: ${n} <${e}>`, '', m].join('\n'),
    html: `<!doctype html><html><body style="margin:0;padding:32px 16px;background:#f8fafc;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border:1px solid #e3e8ef;border-radius:16px;overflow:hidden;">
          <tr><td style="padding:28px 32px 0;">
            <p style="margin:0;font-size:13px;color:#65758e;">New message from the FlowXP contact form</p>
            <p style="margin:8px 0 0;font-size:15px;color:#011531;"><strong>${escapeHtml(n)}</strong> &lt;${escapeHtml(e)}&gt;</p>
            <p style="margin:4px 0 0;font-size:15px;color:#22324d;">${escapeHtml(s)}</p>
          </td></tr>
          <tr><td style="padding:20px 32px 32px;">
            <p style="margin:0;padding:16px;background:#f3f6fa;border-radius:12px;font-size:14px;line-height:1.6;color:#22324d;white-space:pre-wrap;">${escapeHtml(m)}</p>
          </td></tr>
        </table>
      </td></tr></table>
    </body></html>`
  });

  res.json({ success: true });
};
