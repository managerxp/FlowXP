/*
 * Notifications on the phone: the list a person sees on the website's Notifications page (the weekly summary every Monday morning, low stock,
 * unusual numbers and the rest), what to be told about (in the app, by email, on the phone) per kind of notification, and where tapping one goes.
 * The server decides who gets what and which topics a role is offered; the phone only reads, marks read and saves the person's choices.
 * Pure: how to read the answers and what to send.
 */
export type Notice = { notification_id: number; category: string; severity: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null };
export type NoticePage = { unread: number; items: Notice[] };
export type Preference = { category: string; label: string; description: string; in_app: boolean; email: boolean; push: boolean };
export const PAGE = 30;

/** The query for one page: unread only, and the id of the oldest one shown for the next older page. */
export const noticesQuery = (unreadOnly: boolean, before?: number | null): string => `limit=${PAGE}${unreadOnly ? '&unread=true' : ''}${before ? `&before=${before}` : ''}`;
/** Is there probably an older page? (A full page means there may be more.) */
export const hasMore = (items: Notice[]): boolean => items.length >= PAGE;

/** "5 min ago", "3 h ago", "2 days ago", or the date: how long ago it arrived. */
export const timeAgo = (iso: string, now: number = Date.now()): string => {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 24 * 60) return `${Math.round(m / 60)} h ago`;
  if (m < 7 * 24 * 60) { const d = Math.round(m / (24 * 60)); return d === 1 ? 'yesterday' : `${d} days ago`; }
  return iso.slice(0, 10);
};

/**
 * Where tapping a notification goes on the phone: the website sends a web address (/app/reports); the phone maps the ones it has a screen for and
 * leaves the rest (it still marks them read). A weekly summary opens the reports.
 */
export const phoneRoute = (n: Pick<Notice, 'link' | 'category'>): string | null => {
  const link = (n.link ?? '').split('?')[0];
  if (n.category === 'weekly' || link === '/app/reports') return '/biz-reports';
  if (link.startsWith('/app/stock') || link === '/app/inventory' || link === '/app/salon/stock' || link === '/app/wholesale/inventory' || link.startsWith('/app/forecast')) return '/stock';
  if (link === '/app/kitchen') return '/kitchen';
  if (link === '/app/gaming') return '/gaming';
  if (link === '/app/purchases') return '/purchasing';
  return null;
};

/** The preferences with one box changed: this is what is sent back (the server takes the whole list). */
export const withChange = (prefs: Preference[], category: string, field: 'in_app' | 'email' | 'push', value: boolean): Preference[] =>
  prefs.map((p) => (p.category === category ? { ...p, [field]: value } : p));

/** Every fixed text on the screen, so the language tests can check each is translated. */
export const INBOX_TEXTS: string[] = [
  'Notifications', 'What needs your attention, so you don\'t have to go looking.', 'Mark all read', 'Unread only', 'Nothing unread.', 'No notifications yet.', 'Show older', 'What to tell me about', 'In app', 'By email', 'On my phone', 'Saved',
  'There are no notification settings for your role.', 'Email goes to the address you sign in with. Phone alerts go to the FlowXP app on the phones you are signed in on. Notifications are never sent to customers.', 'just now', '{n} min ago', '{n} h ago', 'yesterday', '{n} days ago',
  'Could not load.', 'Could not save. Check the connection and try again.', 'Back',
  // the topics the server offers (backend modules/notifications.js CATEGORIES)
  'Stock & purchasing', 'Items about to run out, and what to order.', 'Revenue leakage', 'Unusual discounts, cancellations, refunds and wastage.', 'Kitchen delays', 'An order that is taking much longer than it should.', 'Daily summary', 'How the day went, each evening.', 'Weekly summary', 'How last week went, every Monday morning.', 'Unusual numbers', 'A sudden drop or spike in sales, margin, discounts or expenses, or items sold below cost.', 'Integrations', 'A delivery platform order that could not be received.', 'Account', 'Your trial and subscription.', 'New orders', 'A guest or a delivery app has sent an order that needs accepting or cooking.', 'Order ready', 'A dish for your table is ready to take out.', 'Gaming timers', 'A station is nearly out of time, or its time is over.', 'New bookings', 'A client has booked online.'
];
