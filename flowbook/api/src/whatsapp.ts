import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { audit } from './audit.ts';
import { withOrg } from './db.ts';
import type { Db } from './db.ts';
import { LedgerError } from './ledger.ts';
import { paiseToString } from './money.ts';

/* WhatsApp messages for invoices, payment reminders and receipts.
   LINK: nothing is sent by FlowBook; it builds the message and a click-to-chat address, and a person presses send.
   CLOUD: FlowBook sends through the business's own Meta WhatsApp Cloud API number. Meta only allows business-started
   messages from templates it has approved, so the three templates below must be created in Meta Business Manager with exactly this body text.
   Not tested against Meta's live service: it needs the business's own approved templates and number. */

export type Kind = 'INVOICE' | 'REMINDER' | 'RECEIPT';
export const TEMPLATE_BODY: Record<Kind, string> = {
  INVOICE: 'Hello {{1}}, your invoice {{2}} for ₹{{3}} is ready. Due date: {{4}}. Thank you. {{5}}',
  REMINDER: 'Hello {{1}}, a reminder that invoice {{2}} has ₹{{3}} pending, due {{4}}. If you have already paid, please ignore this message. {{5}}',
  RECEIPT: 'Hello {{1}}, we received ₹{{2}} from you on {{3}}. Thank you. {{4}}'
};

/* ---- the token is stored encrypted (AES-256-GCM) with a key from the environment, never in plain text */
const key = (): Buffer => {
  const k = Buffer.from(process.env.FLOWBOOK_SECRET_KEY ?? '', 'base64');
  if (k.length !== 32) throw new LedgerError('secret_key_missing', 'set FLOWBOOK_SECRET_KEY (32 random bytes, base64) before saving a WhatsApp token');
  return k;
};
export const seal = (text: string): string => {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64')).join('.');
};
export const unseal = (sealed: string): string => {
  const [iv, tag, body] = sealed.split('.').map((s) => Buffer.from(s, 'base64')) as [Buffer, Buffer, Buffer];
  const d = createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
};

/** Digits only, country code added to a 10-digit Indian number. Null when it cannot be a mobile number. */
export const toE164 = (phone: string | null | undefined): string | null => {
  let d = String(phone ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
};

const inr = (paise: bigint): string => Number(paiseToString(paise)).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const showDate = (iso: string): string => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fill = (body: string, params: string[]): string => body.replace(/\{\{(\d)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? '');

type Settings = { mode: 'OFF' | 'LINK' | 'CLOUD'; phone_number_id: string | null; token_enc: string | null; language: string; auto_reminders: boolean; reminder_offsets: number[]; template_invoice: string; template_reminder: string; template_receipt: string };
const DEFAULTS: Settings = { mode: 'LINK', phone_number_id: null, token_enc: null, language: 'en', auto_reminders: false, reminder_offsets: [-3, 0, 7, 15], template_invoice: 'flowbook_invoice', template_reminder: 'flowbook_payment_reminder', template_receipt: 'flowbook_payment_received' };
const loadSettings = async (c: Db): Promise<Settings> => ((await c.query(`SELECT * FROM whatsapp_settings`)).rows[0] as Settings | undefined) ?? DEFAULTS;

export type SettingsIn = { mode?: Settings['mode']; phoneNumberId?: string; token?: string; language?: string; autoReminders?: boolean; reminderOffsets?: number[]; templateInvoice?: string; templateReminder?: string; templateReceipt?: string };

/** What the screen may see: everything but the token. */
export const getSettings = async (c: Db) => {
  const s = await loadSettings(c);
  return { mode: s.mode, phoneNumberId: s.phone_number_id, hasToken: Boolean(s.token_enc), language: s.language, autoReminders: s.auto_reminders, reminderOffsets: s.reminder_offsets,
    templateInvoice: s.template_invoice, templateReminder: s.template_reminder, templateReceipt: s.template_receipt, templateBodies: TEMPLATE_BODY };
};

export const saveSettings = async (c: Db, orgId: bigint, i: SettingsIn, actor: string): Promise<void> => {
  const cur = await loadSettings(c);
  const next = {
    mode: i.mode ?? cur.mode, phone: i.phoneNumberId?.trim() || cur.phone_number_id, token: i.token ? seal(i.token.trim()) : cur.token_enc, language: i.language ?? cur.language,
    auto: i.autoReminders ?? cur.auto_reminders, offsets: i.reminderOffsets ?? cur.reminder_offsets,
    tInvoice: i.templateInvoice ?? cur.template_invoice, tReminder: i.templateReminder ?? cur.template_reminder, tReceipt: i.templateReceipt ?? cur.template_receipt
  };
  if (next.mode === 'CLOUD' && (!next.phone || !next.token)) throw new LedgerError('whatsapp_incomplete', 'sending from FlowBook needs the Meta phone number ID and access token');
  if (next.auto && next.mode !== 'CLOUD') throw new LedgerError('whatsapp_auto_needs_cloud', 'automatic reminders need sending from FlowBook (CLOUD mode); in LINK mode a person presses send');
  await c.query(
    `INSERT INTO whatsapp_settings (organization_id, mode, phone_number_id, token_enc, language, auto_reminders, reminder_offsets, template_invoice, template_reminder, template_receipt, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (organization_id) DO UPDATE SET mode = $2, phone_number_id = $3, token_enc = $4, language = $5, auto_reminders = $6, reminder_offsets = $7, template_invoice = $8, template_reminder = $9, template_receipt = $10, updated_at = now()`,
    [orgId, next.mode, next.phone, next.token, next.language, next.auto, next.offsets, next.tInvoice, next.tReminder, next.tReceipt]);
  await audit(c, orgId, { actor, action: 'whatsapp.settings_saved', entityType: 'whatsapp_settings', entityId: orgId, detail: { mode: next.mode, autoReminders: next.auto, tokenChanged: Boolean(i.token) } });
};

/* ---- sending: one function the rest calls, swapped in tests */
export type Outgoing = { phoneNumberId: string; token: string; to: string; template: string; language: string; params: string[] };
export type Sender = (m: Outgoing) => Promise<{ ref: string }>;
export class SendError extends Error {}
const cloudSender: Sender = async (m) => {
  const version = process.env.WHATSAPP_API_VERSION ?? 'v21.0';
  let res: Response;
  try {
    res = await fetch(`https://graph.facebook.com/${version}/${m.phoneNumberId}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${m.token}` }, signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ messaging_product: 'whatsapp', to: m.to, type: 'template', template: { name: m.template, language: { code: m.language }, components: [{ type: 'body', parameters: m.params.map((text) => ({ type: 'text', text })) }] } })
    });
  } catch { throw new SendError('Could not reach WhatsApp'); }
  const data = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  if (!res.ok) throw new SendError(data.error?.message ?? `WhatsApp refused the message (${res.status})`);
  return { ref: data.messages?.[0]?.id ?? '' };
};
let sender: Sender = cloudSender;
export const setSender = (s: Sender | null): void => { sender = s ?? cloudSender; };

type Built = { kind: Kind; partyId: bigint; documentId: bigint | null; paymentId: bigint | null; phone: string | null; optOut: boolean; params: string[]; text: string; templateKey: 'template_invoice' | 'template_reminder' | 'template_receipt' };

const build = async (c: Db, orgId: bigint, kind: Kind, ref: { documentId?: bigint; paymentId?: bigint }): Promise<Built> => {
  const business = (await c.query(`SELECT name FROM organizations WHERE id = $1`, [orgId])).rows[0]?.name as string;
  const gone = (what: string) => new LedgerError('not_found', `no such ${what}`);
  if (kind === 'RECEIPT') {
    const p = (await c.query(`SELECT p.id, p.party_id, p.pay_date::text AS d, p.amount_minor, p.status, p.direction, q.name, q.phone, q.whatsapp_opt_out FROM payments p JOIN parties q ON q.id = p.party_id WHERE p.id = $1`, [ref.paymentId ?? 0n])).rows[0];
    if (!p) throw gone('payment');
    if (p.status !== 'POSTED' || p.direction !== 'IN') throw new LedgerError('not_sendable', 'a receipt can only be sent for a payment received');
    const params = [p.name as string, inr(p.amount_minor as bigint), showDate(p.d as string), business];
    return { kind, partyId: p.party_id as bigint, documentId: null, paymentId: p.id as bigint, phone: p.phone as string | null, optOut: p.whatsapp_opt_out as boolean, params, text: fill(TEMPLATE_BODY.RECEIPT, params), templateKey: 'template_receipt' };
  }
  const d = (await c.query(`SELECT d.id, d.party_id, d.number, d.kind, d.status, d.due_date::text AS due, d.total_minor, d.balance_minor, q.name, q.phone, q.whatsapp_opt_out FROM documents d JOIN parties q ON q.id = d.party_id WHERE d.id = $1`, [ref.documentId ?? 0n])).rows[0];
  if (!d) throw gone('document');
  if (d.kind !== 'INVOICE' || d.status !== 'ISSUED') throw new LedgerError('not_sendable', 'only an issued invoice can be sent');
  if (kind === 'REMINDER' && (d.balance_minor as bigint) <= 0n) throw new LedgerError('not_sendable', 'this invoice is already settled');
  const due = d.due ? showDate(d.due as string) : 'on receipt';
  const params = kind === 'INVOICE' ? [d.name, d.number, inr(d.total_minor as bigint), due, business] : [d.name, d.number, inr(d.balance_minor as bigint), due, business];
  return { kind, partyId: d.party_id as bigint, documentId: d.id as bigint, paymentId: null, phone: d.phone as string | null, optOut: d.whatsapp_opt_out as boolean, params: params as string[], text: fill(TEMPLATE_BODY[kind], params as string[]), templateKey: kind === 'INVOICE' ? 'template_invoice' : 'template_reminder' };
};

const record = (c: Db, orgId: bigint, b: Built, r: { status: 'SENT' | 'FAILED' | 'SKIPPED' | 'OPENED'; error?: string; ref?: string; to?: string | null; auto?: boolean; offset?: number | null; actor: string }) =>
  c.query(
    `INSERT INTO whatsapp_messages (organization_id, party_id, document_id, payment_id, kind, offset_days, auto, to_phone, status, error, provider_ref, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT DO NOTHING`,
    [orgId, b.partyId, b.documentId, b.paymentId, b.kind, r.offset ?? null, r.auto ?? false, r.to ?? null, r.status, r.error ?? null, r.ref ?? null, r.actor]);

export type SendResult = { mode: 'LINK' | 'CLOUD'; status: 'SENT' | 'FAILED' | 'SKIPPED' | 'OPENED'; text: string; url?: string; error?: string };

/** Send (CLOUD) or prepare (LINK) one message, and record what happened. Nothing is sent to a party who has opted out or has no usable number. */
export const sendMessage = async (pool: pg.Pool, orgId: bigint, kind: Kind, ref: { documentId?: bigint; paymentId?: bigint }, opts: { actor: string; auto?: boolean; offset?: number }): Promise<SendResult> => {
  const prep = await withOrg(pool, orgId, async (c) => ({ s: await loadSettings(c), b: await build(c, orgId, kind, ref) }));
  const { s, b } = prep;
  if (s.mode === 'OFF') throw new LedgerError('whatsapp_off', 'WhatsApp is switched off in Settings');
  const to = toE164(b.phone);
  const log = (r: Omit<Parameters<typeof record>[3], 'actor'>) => withOrg(pool, orgId, (c) => record(c, orgId, b, { ...r, to, auto: opts.auto, offset: opts.offset, actor: opts.actor }));
  if (b.optOut) { await log({ status: 'SKIPPED', error: 'The party has opted out of WhatsApp messages' }); return { mode: s.mode as 'LINK' | 'CLOUD', status: 'SKIPPED', text: b.text, error: 'The party has opted out of WhatsApp messages' }; }
  if (!to) { await log({ status: 'SKIPPED', error: 'No usable mobile number on the party' }); return { mode: s.mode as 'LINK' | 'CLOUD', status: 'SKIPPED', text: b.text, error: 'No usable mobile number on the party' }; }
  if (s.mode === 'LINK') {
    await log({ status: 'OPENED' });
    return { mode: 'LINK', status: 'OPENED', text: b.text, url: `https://wa.me/${to}?text=${encodeURIComponent(b.text)}` };
  }
  try {
    const out = await sender({ phoneNumberId: s.phone_number_id as string, token: unseal(s.token_enc as string), to, template: s[b.templateKey], language: s.language, params: b.params });
    await log({ status: 'SENT', ref: out.ref });
    return { mode: 'CLOUD', status: 'SENT', text: b.text };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await log({ status: 'FAILED', error });
    return { mode: 'CLOUD', status: 'FAILED', text: b.text, error };
  }
};

export const listMessages = async (c: Db, q: { documentId?: bigint; limit: number }) => (await c.query(
  `SELECT m.id, m.kind, m.offset_days, m.auto, m.to_phone, m.status, m.error, m.document_id, m.payment_id, m.created_at, p.name AS party_name
     FROM whatsapp_messages m JOIN parties p ON p.id = m.party_id WHERE ($1::bigint IS NULL OR m.document_id = $1) ORDER BY m.id DESC LIMIT $2`, [q.documentId ?? null, q.limit])).rows;

/** Automatic reminders: for each business that has them on, every issued invoice with money pending whose due date plus an offset is today
    (or in the last two days, in case the server was off). Each invoice and offset is tried once. */
export const runReminders = async (pool: pg.Pool, today: string): Promise<{ sent: number; failed: number; skipped: number }> => {
  const tally = { sent: 0, failed: 0, skipped: 0 };
  const orgs = (await pool.query(`SELECT organization_id FROM whatsapp_settings WHERE mode = 'CLOUD' AND auto_reminders AND token_enc IS NOT NULL AND phone_number_id IS NOT NULL`)).rows as { organization_id: bigint }[];
  for (const { organization_id: orgId } of orgs) {
    const due = await withOrg(pool, orgId, async (c) => (await c.query(
      `SELECT d.id, o AS offset FROM documents d, whatsapp_settings s, unnest(s.reminder_offsets) AS o
        WHERE d.kind = 'INVOICE' AND d.status = 'ISSUED' AND d.balance_minor > 0 AND d.due_date IS NOT NULL
          AND d.due_date + o BETWEEN $1::date - 2 AND $1::date
          AND NOT EXISTS (SELECT 1 FROM whatsapp_messages m WHERE m.document_id = d.id AND m.offset_days = o AND m.auto)
        ORDER BY d.id, o`, [today])).rows as { id: bigint; offset: number }[]);
    for (const r of due) {
      try {
        const out = await sendMessage(pool, orgId, 'REMINDER', { documentId: r.id }, { actor: 'reminder worker', auto: true, offset: r.offset });
        tally[out.status === 'SENT' ? 'sent' : out.status === 'FAILED' ? 'failed' : 'skipped'] += 1;
      } catch (e) { console.error('[flowbook] reminder:', (e as Error).message); }
    }
  }
  return tally;
};

export const startReminderWorker = (pool: pg.Pool, everyMs = 3_600_000) => {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await runReminders(pool, new Date().toLocaleDateString('en-CA')); } catch (e) { console.error('[flowbook] reminder worker:', (e as Error).message); } finally { running = false; }
  };
  const timer = setInterval(run, everyMs); timer.unref();
  setTimeout(run, 30_000).unref();
  return { stop: () => clearInterval(timer) };
};
