import nodemailer from 'nodemailer';
import { audit } from './audit.ts';
import type { Db } from './db.ts';
import { getDocument } from './documents.ts';
import type { DocKind } from './documents.ts';
import { LedgerError } from './ledger.ts';
import { paiseToString } from './money.ts';

/* Documents by email. Mail goes out through the platform's own mailbox (FLOWBOOK_SMTP_* in the server environment), shown as "<business> via FlowBook";
   replies go to the business. The document is in the body of the message as a plain table, not an attached PDF. Not tested against a real mail server. */

export type SmtpConfig = { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string };
export type Mail = { from: string; to: string; bcc?: string; replyTo?: string; subject: string; html: string; text: string };
export type Mailer = { send: (m: Mail) => Promise<{ id?: string }> };
const realMailer = (s: SmtpConfig): Mailer => {
  const t = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: s.user ? { user: s.user, pass: s.pass ?? '' } : undefined, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 });
  return { send: async (m) => ({ id: (await t.sendMail(m)).messageId }) };
};
let makeMailer: (s: SmtpConfig) => Mailer = realMailer;
/** Tests swap in a mailer that sends nothing. */
export const setMailer = (f: ((s: SmtpConfig) => Mailer) | null): void => { makeMailer = f ?? realMailer; };
const platform = (): SmtpConfig | null => {
  const e = process.env;
  return e.FLOWBOOK_SMTP_HOST && e.FLOWBOOK_SMTP_FROM ? { host: e.FLOWBOOK_SMTP_HOST, port: Number(e.FLOWBOOK_SMTP_PORT) || 587, secure: e.FLOWBOOK_SMTP_SECURE === 'true', user: e.FLOWBOOK_SMTP_USER || undefined, pass: e.FLOWBOOK_SMTP_PASS, from: e.FLOWBOOK_SMTP_FROM } : null;
};

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]{2,}$/;
const oneLine = (s: string): string => s.replace(/[\r\n]+/g, ' ').trim();
const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
const inr = (paise: bigint | string): string => Number(typeof paise === 'string' ? paise : paiseToString(paise)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const showDate = (iso: string): string => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

type Row = { enabled: boolean; reply_to: string | null; bcc_self: boolean };
const load = async (c: Db): Promise<Row | undefined> => (await c.query(`SELECT enabled, reply_to, bcc_self FROM email_settings`)).rows[0] as Row | undefined;

export const getEmailSettings = async (c: Db) => {
  const s = await load(c);
  return { available: platform() !== null, enabled: s?.enabled ?? false, replyTo: s?.reply_to ?? '', bccSelf: s?.bcc_self ?? false };
};

export type EmailSettingsIn = { enabled?: boolean; replyTo?: string; bccSelf?: boolean };
export const saveEmailSettings = async (c: Db, orgId: bigint, b: EmailSettingsIn, actor: string): Promise<void> => {
  const cur = await load(c);
  if (b.replyTo && !EMAIL.test(b.replyTo.trim())) throw new LedgerError('bad_email', `${b.replyTo} is not an email address`);
  const next = { enabled: b.enabled ?? cur?.enabled ?? false, reply_to: b.replyTo === undefined ? cur?.reply_to ?? null : b.replyTo.trim() || null, bcc_self: b.bccSelf ?? cur?.bcc_self ?? false };
  await c.query(
    `INSERT INTO email_settings (organization_id, enabled, reply_to, bcc_self, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (organization_id) DO UPDATE SET enabled = $2, reply_to = $3, bcc_self = $4, updated_at = now()`, [orgId, next.enabled, next.reply_to, next.bcc_self]);
  await audit(c, orgId, { actor, action: 'email.settings_saved', entityType: 'organization', entityId: orgId, detail: { enabled: next.enabled } });
};

const ready = (s: Row | undefined, biz: Biz): { cfg: SmtpConfig; from: string; replyTo?: string; bcc?: string } => {
  const cfg = platform();
  if (!cfg) throw new LedgerError('email_off', 'email is not available on this server yet (the platform mailbox is not set up)');
  if (!s?.enabled) throw new LedgerError('email_off', 'email is switched off for this business (Settings > Email)');
  const name = oneLine(biz.legal_name || biz.name).replace(/["<>]/g, '');
  const replyTo = s.reply_to ?? (biz.email && EMAIL.test(biz.email) ? biz.email : undefined);
  return { cfg, from: `"${name} via FlowBook" <${cfg.from}>`, replyTo, bcc: s.bcc_self ? replyTo : undefined };
};

const LABEL: Partial<Record<DocKind, string>> = { INVOICE: 'Invoice', CREDIT_NOTE: 'Credit note', QUOTE: 'Quote', SALES_ORDER: 'Sales order', PURCHASE_ORDER: 'Purchase order', DEBIT_NOTE: 'Debit note' };

type Biz = { name: string; legal_name: string | null; gstin: string | null; address_line: string | null; city: string | null; pincode: string | null; phone: string | null; email: string | null; bank_name: string | null; bank_account: string | null; bank_ifsc: string | null; upi_id: string | null; terms: string | null };
const bizHtml = (b: Biz): string => `<strong style="font-size:16px">${esc(b.legal_name || b.name)}</strong>${[[b.address_line, b.city, b.pincode].filter(Boolean).join(', '), [b.phone, b.email].filter(Boolean).join(' · '), b.gstin && `GSTIN: ${b.gstin}`].filter(Boolean).map((l) => `<br>${esc(l)}`).join('')}`;
const shell = (b: Biz, title: string, note: string | undefined, body: string): string =>
  `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;max-width:640px">${note ? `<p style="white-space:pre-line">${esc(note)}</p>` : ''}<div style="border-top:3px solid #1a56db;padding-top:8px">${bizHtml(b)}</div><h2 style="margin:16px 0 8px;color:#1a56db">${esc(title)}</h2>${body}</div>`;
const cell = 'padding:4px 6px;border-bottom:1px solid #ddd';

export const documentHtml = (b: Biz, label: string, d: Awaited<ReturnType<typeof getDocument>> & object, partyName: string, note?: string): string => {
  const rows = d.lines.map((l: Record<string, unknown>) => `<tr><td style="${cell}">${esc(l.description)}</td><td style="${cell};text-align:right">${esc(l.quantity)}</td><td style="${cell};text-align:right">${inr(l.unit_price_minor as bigint)}</td><td style="${cell};text-align:right">${inr((l.taxable_minor as bigint) + (l.tax_minor as bigint))}</td></tr>`).join('');
  const tax = d.inter_state ? `<tr><td>IGST</td><td align="right">${inr(d.tax_minor)}</td></tr>` : `<tr><td>CGST</td><td align="right">${inr(d.tax_minor / 2n)}</td></tr><tr><td>SGST</td><td align="right">${inr(d.tax_minor - d.tax_minor / 2n)}</td></tr>`;
  const pay = [b.bank_name, b.bank_account && `A/c ${b.bank_account}`, b.bank_ifsc && `IFSC ${b.bank_ifsc}`, b.upi_id && `UPI ${b.upi_id}`].filter(Boolean).join(' · ');
  return shell(b, `${label} ${d.number}`, note, `<p>To: <strong>${esc(partyName)}</strong><br>Date: ${showDate(d.issue_date)}${d.due_date ? `<br>${esc(d.kind === 'QUOTE' ? 'Valid until' : d.kind === 'SALES_ORDER' || d.kind === 'PURCHASE_ORDER' ? 'Expected by' : 'Due')}: ${showDate(d.due_date)}` : ''}</p>
    <table style="width:100%;border-collapse:collapse"><tr style="background:#f0f4ff"><th align="left" style="${cell}">Item</th><th align="right" style="${cell}">Qty</th><th align="right" style="${cell}">Price</th><th align="right" style="${cell}">Amount (with GST)</th></tr>${rows}</table>
    <table style="margin:8px 0 0 auto;min-width:220px"><tr><td>Subtotal</td><td align="right">${inr(d.subtotal_minor)}</td></tr>${tax}${d.tcs_minor > 0n ? `<tr><td>TCS</td><td align="right">${inr(d.tcs_minor)}</td></tr>` : ''}${d.round_off_minor !== 0n ? `<tr><td>Round off</td><td align="right">${inr(d.round_off_minor)}</td></tr>` : ''}<tr><td><strong>Total</strong></td><td align="right"><strong>₹${inr(d.total_minor)}</strong></td></tr></table>
    ${pay ? `<p style="font-size:12px"><strong>Pay to</strong> ${esc(pay)}</p>` : ''}${b.terms ? `<p style="font-size:12px"><strong>Terms</strong> ${esc(b.terms)}</p>` : ''}`);
};

const finish = async (c: Db, orgId: bigint, o: { mailer: Mailer; mail: Mail; partyId: bigint; documentId?: bigint; paymentId?: bigint; actor: string }) => {
  let status: 'SENT' | 'FAILED' = 'SENT'; let error: string | null = null; let ref: string | null = null;
  try { ref = (await o.mailer.send(o.mail)).id ?? null; } catch (e) { status = 'FAILED'; error = oneLine(e instanceof Error ? e.message : String(e)).slice(0, 300); }
  await c.query(`INSERT INTO email_messages (organization_id, party_id, document_id, payment_id, to_email, subject, status, error, provider_ref, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [orgId, o.partyId, o.documentId ?? null, o.paymentId ?? null, o.mail.to, o.mail.subject, status, error, ref, o.actor]);
  await audit(c, orgId, { actor: o.actor, action: status === 'SENT' ? 'email.sent' : 'email.failed', entityType: o.documentId ? 'document' : 'payment', entityId: (o.documentId ?? o.paymentId) as bigint, detail: { to: o.mail.to } });
  return { status, error };
};

const recipient = (to: string | undefined, partyEmail: string | null): string => {
  const addr = (to ?? partyEmail ?? '').trim();
  if (!addr) throw new LedgerError('no_email', 'this party has no email address; type one to send to');
  if (!EMAIL.test(addr)) throw new LedgerError('bad_email', `${addr} is not an email address`);
  return addr;
};
const BIZ = `SELECT name, legal_name, gstin, address_line, city, pincode, phone, email, bank_name, bank_account, bank_ifsc, upi_id, terms FROM organizations WHERE id = $1`;

export const sendDocument = async (c: Db, orgId: bigint, ref: { documentId?: bigint; paymentId?: bigint }, o: { to?: string; message?: string }, actor: string) => {
  const biz = (await c.query(BIZ, [orgId])).rows[0] as Biz;
  const { cfg, from, replyTo, bcc } = ready(await load(c), biz);
  const note = o.message?.trim().slice(0, 1000) || undefined;
  const bizName = biz.legal_name || biz.name;
  let mail: Mail; let partyId: bigint;
  if (ref.documentId) {
    const head = (await c.query(`SELECT d.kind, d.status, p.id AS party_id, p.name, p.email FROM documents d JOIN parties p ON p.id = d.party_id WHERE d.id = $1`, [ref.documentId])).rows[0];
    if (!head) throw new LedgerError('not_found', 'no such document');
    const label = LABEL[head.kind as DocKind];
    if (!label) throw new LedgerError('not_sendable', 'a purchase bill is one you received; there is nothing to send');
    if (head.status !== 'ISSUED') throw new LedgerError('not_sendable', 'only an issued document can be sent');
    const d = (await getDocument(c, head.kind as DocKind, ref.documentId))!;
    const to = recipient(o.to, head.email);
    const subject = oneLine(`${label} ${d.number} from ${bizName}`);
    mail = { from, to, bcc, replyTo, subject, html: documentHtml(biz, head.kind === 'INVOICE' && biz.gstin ? 'Tax Invoice' : label, d, head.name, note),
      text: `${note ? `${note}\n\n` : ''}${label} ${d.number} from ${bizName}\nDate: ${showDate(d.issue_date)}\nTotal: ₹${inr(d.total_minor)}\n` };
    partyId = head.party_id as bigint;
  } else {
    const p = (await c.query(`SELECT p.id, p.direction, p.number, p.pay_date::text AS pay_date, p.mode, p.reference, p.amount_minor, p.tds_minor, p.status, q.id AS party_id, q.name, q.email FROM payments p JOIN parties q ON q.id = p.party_id WHERE p.id = $1`, [ref.paymentId ?? 0n])).rows[0];
    if (!p) throw new LedgerError('not_found', 'no such payment');
    if (p.direction !== 'IN' || p.status !== 'POSTED') throw new LedgerError('not_sendable', 'a receipt is sent for money received that is not void');
    const to = recipient(o.to, p.email);
    const body = `<p>Received from: <strong>${esc(p.name)}</strong><br>Date: ${showDate(p.pay_date)}<br>How: ${esc(p.mode)}${p.reference ? `<br>Reference: ${esc(p.reference)}` : ''}</p>${p.tds_minor > 0n ? `<p>TDS deducted: ₹${inr(p.tds_minor)}</p>` : ''}<p style="font-size:18px"><strong>Amount received: ₹${inr(p.amount_minor)}</strong></p>`;
    mail = { from, to, bcc, replyTo, subject: oneLine(`Receipt ${p.number} from ${bizName}`), html: shell(biz, `Receipt ${p.number}`, note, body),
      text: `${note ? `${note}\n\n` : ''}Receipt ${p.number} from ${bizName}\nReceived ₹${inr(p.amount_minor)} on ${showDate(p.pay_date)}.\n` };
    partyId = p.party_id as bigint;
  }
  return finish(c, orgId, { mailer: makeMailer(cfg), mail, partyId, documentId: ref.documentId, paymentId: ref.paymentId, actor });
};

export const listEmails = async (c: Db, q: { documentId?: bigint; paymentId?: bigint; limit: number }) => (await c.query(
  `SELECT id, document_id, payment_id, to_email, subject, status, error, created_by, created_at FROM email_messages
    WHERE ($1::bigint IS NULL OR document_id = $1) AND ($2::bigint IS NULL OR payment_id = $2) ORDER BY id DESC LIMIT $3`, [q.documentId ?? null, q.paymentId ?? null, q.limit])).rows;
