/*
 * Customer messaging on the phone (owner and admin): choose WhatsApp or SMS and what goes out on its own, send an offer to a group of
 * customers, and see every message sent with a retry for the ones that failed. The same as the website's Messaging page; the server does the
 * sending and the counting. Pure: types, bodies, checks and wording.
 */
import { t } from './i18n.ts';

export const canMessaging = (role: string | undefined): boolean => role === 'OWNER' || role === 'ADMIN';

export type Channel = 'OFF' | 'WHATSAPP' | 'SMS';
export const CHANNELS: { id: Channel; label: string }[] = [{ id: 'OFF', label: 'Off: send nothing' }, { id: 'WHATSAPP', label: 'WhatsApp' }, { id: 'SMS', label: 'SMS' }];
export type ToggleKey = 'bill_auto' | 'reservation_updates' | 'waitlist_updates' | 'loyalty_nudge' | 'job_updates';
export type MessagingSettings = { channel: Channel } & Record<ToggleKey, boolean>;
export type SettingsData = { settings: MessagingSettings; provider: { connected: boolean; name: string | null }; segments: Record<string, string> };
export const TOGGLES: { key: ToggleKey; label: string; hint: string }[] = [
  { key: 'bill_auto', label: 'Send the bill to customers with a mobile number', hint: 'After every sale to a customer, with a link to view the bill.' },
  { key: 'reservation_updates', label: 'Booking confirmations and cancellations', hint: 'When a reservation with a mobile number is made or cancelled.' },
  { key: 'waitlist_updates', label: 'Waitlist updates', hint: 'When someone joins the waitlist and when their table is ready.' },
  { key: 'loyalty_nudge', label: 'Loyalty reminder', hint: 'When a customer\'s next visit earns their free item (at most once a week).' },
  { key: 'job_updates', label: 'Workshop job card updates', hint: 'Vehicle received, vehicle ready, and a reminder three days before the next service (auto parts shops).' }
];
export type Template = { kind: string; name: string; body: string; promo?: boolean };

/* ── offers to customers ─────────────────────────────────────────────────── */
export type Preview = { count: number; sample?: string[]; error?: string };
export const LAPSED_DAYS = [14, 30, 60, 90];
export const MIN_OFFER = 5;
export const MAX_OFFER = 300;
/** The line under the group chooser: who will get it. */
export const previewText = (p: Preview | null): string => {
  if (!p) return t('Counting…');
  if (p.error) return p.error;
  const names = p.sample?.length ? ` (${p.sample.join(', ')}${p.count > p.sample.length ? '…' : ''})` : '';
  return (p.count === 1 ? t('1 customer will get it{names}.', { names }) : t('{n} customers will get it{names}.', { n: p.count, names }));
};
export const canSend = (text: string, p: Preview | null, busy: boolean): boolean => !busy && text.trim().length >= MIN_OFFER && Boolean(p) && !p!.error && p!.count > 0;
export const campaignBody = (segment: string, days: number, text: string): { segment: string; days: number; text: string } => ({ segment, days, text: text.trim() });
export type Progress = { sent?: number; failed?: number; skipped?: number };
export const progressText = (p: Progress): string => [t('Sent {n}', { n: p.sent || 0 }), p.failed ? t('failed {n}', { n: p.failed }) : '', p.skipped ? t('skipped {n}', { n: p.skipped }) : ''].filter(Boolean).join(' · ');

/* ── the log ─────────────────────────────────────────────────────────────── */
export type Status = 'SENT' | 'FAILED' | 'SKIPPED' | 'QUEUED';
export type Message = { message_id: number; created_at: string; customer_name: string | null; phone: string; channel: 'WHATSAPP' | 'SMS'; body: string; status: Status; error: string | null };
export const STATUS_FILTERS: { id: '' | 'failed' | 'skipped' | 'sent'; label: string }[] = [{ id: '', label: 'All messages' }, { id: 'failed', label: 'Failed' }, { id: 'skipped', label: 'Skipped' }, { id: 'sent', label: 'Sent' }];
export const statusLabel = (s: Status): string => t(({ SENT: 'Sent', FAILED: 'Failed', SKIPPED: 'Skipped', QUEUED: 'Queued' } as const)[s] ?? s);
/** Only failed or skipped messages can be tried again. */
export const canRetry = (m: Message): boolean => m.status === 'FAILED' || m.status === 'SKIPPED';
export const messagesPath = (status: string): string => `/messaging/messages${status ? `?status=${status}` : ''}`;
export const messageTitle = (m: Message): string => m.customer_name || m.phone;
export const messageSub = (m: Message, when: string): string => [when, m.phone, m.channel === 'WHATSAPP' ? 'WhatsApp' : 'SMS', m.body, m.error ?? ''].filter(Boolean).join(' · ');
export const resendText = (status: string): string => (status === 'SENT' ? t('Sent') : t('Still {status}', { status: status.toLowerCase() }));

/* ── one tap: the bill to the customer from FlowXP's own number ─────────── */
export type BillSent = { status: 'SENT' | 'FAILED' | 'SKIPPED' | 'QUEUED'; error?: string | null };
/** What to tell the person after the server has tried to send a bill (WhatsApp or SMS, whichever the business chose in Messaging). */
export const billSentText = (m: BillSent): string =>
  m.status === 'SENT' ? t('Bill sent to the customer') : m.status === 'SKIPPED' ? t('Not sent: no messaging service is connected yet') : m.status === 'QUEUED' ? t('Bill is on its way to the customer') : t('Could not send: {error}', { error: m.error || t('try again') });
/** What to tell the person after the server has tried to send a payment reminder. */
export const reminderSentText = (m: BillSent): string =>
  m.status === 'SENT' ? t('Reminder sent to the customer') : m.status === 'SKIPPED' ? t('Not sent: no messaging service is connected yet') : m.status === 'QUEUED' ? t('Reminder is on its way to the customer') : t('Could not send: {error}', { error: m.error || t('try again') });
/** A reminder makes sense only for a customer who owes money and has a mobile number. */
export const canRemind = (phone: string | null | undefined, owes: number): boolean => owes > 0 && canSendBill(phone);
/** The customer's mobile, when the bill has one: only then is there somebody to send it to with one tap. */
export const canSendBill = (customerPhone: string | null | undefined): boolean => Boolean(customerPhone && customerPhone.replace(/\D/g, '').length >= 10);

/** Every fixed text on the Messaging screens, so the language tests can check each is translated. */
export const MESSAGING_TEXTS: string[] = [
  'WhatsApp or SMS: bills, bookings, offers', 'Send the bill from FlowXP', 'Bill sent to the customer', 'Send a reminder from FlowXP', 'Remind on WhatsApp', 'Reminder sent to the customer', 'Reminder is on its way to the customer', 'Not sent: no messaging service is connected yet', 'Bill is on its way to the customer', 'Could not send: {error}', 'try again',
  'Messaging', 'Send bills, booking updates and offers to customers on WhatsApp or SMS.', 'Settings', 'Send an offer', 'Message log', 'Messaging is for owners and admins.', 'Could not load.', 'Could not save. Check the connection and try again.', 'Back', 'Saved',
  'Send messages by', 'Off: send nothing', 'WhatsApp', 'SMS', 'Connected: {name}', 'No messaging service is connected on the server yet, so messages are only recorded as skipped. Ask whoever runs the server to set it up.',
  'Send the bill to customers with a mobile number', 'After every sale to a customer, with a link to view the bill.', 'Booking confirmations and cancellations', 'When a reservation with a mobile number is made or cancelled.', 'Waitlist updates', 'When someone joins the waitlist and when their table is ready.',
  'Loyalty reminder', 'When a customer\'s next visit earns their free item (at most once a week).', 'Offers and reminders only go to customers who have not opted out. Bills and booking messages are service messages and are sent regardless.',
  'Show the WhatsApp templates to create in Meta', 'Hide the WhatsApp templates', 'WhatsApp only lets a business start a chat with pre-approved templates. Create each one once in Meta Business Manager (category: Utility for bills and bookings, Marketing for offers), using exactly this name and text.', 'Marketing',
  'Send to', 'Every customer with a mobile number', 'Customers who have not visited in a while', 'Customers one visit from a free reward', 'Not visited in the last (days)', 'Counting…', '1 customer will get it{names}.', '{n} customers will get it{names}.',
  'Your offer', '{n}/300. Sent as: "Hi <name>, <your business>: <your text> Reply STOP to opt out."', 'Flat 10% off on dinner this weekend. Show this message at the counter.', 'Sending…', 'Sent {n}', 'failed {n}', 'skipped {n}',
  'One offer per hour, so customers are not flooded. Customers who opted out are left out automatically.', 'Send offer', 'Send to {n} customer?', 'Send to {n} customers?', 'Messages go out straight away and cannot be recalled.', 'Cancel',
  'All messages', 'Failed', 'Skipped', 'Sent', 'Queued', 'Retry', 'Still {status}', 'No messages yet.'
];
