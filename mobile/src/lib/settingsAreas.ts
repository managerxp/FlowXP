/* Settings is a short list of areas, each opening on its own page, instead of one long scroll of everything. Pure data and rules, so the grouping can be tested. */
import type { Ionicons } from '@expo/vector-icons';

export type AreaId = 'printing' | 'payments' | 'alerts' | 'display' | 'lock' | 'data' | 'phone' | 'account';
type Icon = React.ComponentProps<typeof Ionicons>['name'];

export type SettingsEntry = { left: string; sub: string; icon: Icon; go: string; owner?: boolean };
export type SettingsGroup = { title: string; items: SettingsEntry[] };

const area = (id: AreaId) => `/settings-area?area=${id}`;

/** The groups, in the order the owner thinks of them: the business first, then this phone, then the account. `owner` entries are for the owner only. */
export const SETTINGS_GROUPS: SettingsGroup[] = [
  { title: 'Your business', items: [
    { left: 'Business details and receipt', sub: 'Name, address, the bill layout, document numbers', icon: 'business-outline', go: '/business-settings', owner: true },
    { left: 'GST settings', sub: 'Charge GST, GSTIN and the options that go with it', icon: 'document-text-outline', go: '/business-settings?open=gst', owner: true },
    { left: 'Printers and Bluetooth', sub: 'Connect a thermal printer, paper size, what each prints', icon: 'print-outline', go: area('printing') },
    { left: 'UPI and payments', sub: 'The QR customers pay on', icon: 'qr-code-outline', go: area('payments') }
  ] },
  { title: 'This phone', items: [
    { left: 'Language and display', sub: 'Language, theme, text size, date and number style', icon: 'color-palette-outline', go: area('display') },
    { left: 'Alerts', sub: 'New orders, dishes ready, stock running out', icon: 'notifications-outline', go: area('alerts') },
    { left: 'Security and lock', sub: 'App lock, password, two-step sign-in', icon: 'shield-checkmark-outline', go: area('lock') },
    { left: 'Backup and data', sub: 'Backups, send waiting bills, refresh products', icon: 'cloud-upload-outline', go: area('data') },
    { left: 'About this phone', sub: 'Phone code, version, report a problem', icon: 'phone-portrait-outline', go: area('phone') }
  ] },
  { title: 'Account', items: [
    { left: 'Subscription', sub: 'Your plan and trial', icon: 'card-outline', go: '/subscription', owner: true },
    { left: 'Account', sub: 'Sign out, delete my account, privacy and terms', icon: 'person-circle-outline', go: area('account') }
  ] }
];

/** What is shown to this role: owner-only entries are hidden from everyone else, and a group with nothing left disappears. */
export const settingsFor = (role: string | null | undefined): SettingsGroup[] =>
  SETTINGS_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !i.owner || role === 'OWNER') })).filter((g) => g.items.length);

export const AREA_TITLE: Record<AreaId, string> = {
  printing: 'Printers and Bluetooth', payments: 'UPI and payments', alerts: 'Alerts', display: 'Language and display',
  lock: 'Security and lock', data: 'Backup and data', phone: 'About this phone', account: 'Account'
};

export const isArea = (v: unknown): v is AreaId => typeof v === 'string' && v in AREA_TITLE;
