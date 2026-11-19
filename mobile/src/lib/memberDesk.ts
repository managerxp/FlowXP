/* Member desk on the phone: the till's loyalty screen (/api/loyalty/*). The server does every rule; the phone works out what was typed or scanned, keeps one
   request key per action until it succeeds (a retry is then the same request and never counts twice), and words the result. */
import { rupees } from './money.ts';

export type Card = { bg: string; fg: string; accent: string; icon?: string; title?: string; message?: string };
export type Found = { membership_id: number; customer_name: string; programme_name: string; balance: number };
export type Reward = { reward_id: number; name: string; points_cost: number; value_paise: string; affordable: boolean; points_short: number };
export type Entry = { entry_id: number; kind: string; points: number; note: string | null; created_at: string };
export type Member = {
  membership_id: number; membership_no: string; customer_name: string; customer_phone: string | null; status: string; programme_name: string; kind: string;
  card: Card; redeem_points: number; min_redeem_points: number; min_txn_paise: string; balance: number; ledger: Entry[]
};
export type Programme = { programme_id: number; name: string; is_active: boolean };

/** A card link, a membership number, or a mobile number: whichever was typed or scanned becomes the lookup query. */
export const lookupQuery = (raw: string): string => {
  const x = String(raw || '').trim();
  const link = x.match(/\/card\/([0-9a-f]{20,100})\/?(?:[?#].*)?$/i);
  if (link) return `token=${link[1]}`;
  if (/^M\d{8}$/i.test(x)) return `no=${x.toUpperCase()}`;
  if (/^[0-9a-f]{40,100}$/i.test(x)) return `token=${x}`;
  return `phone=${x.replace(/\D/g, '')}`;
};

/** A stamp or visit card counts one per bill; its amount only matters when the card has a smallest bill. */
export const perBill = (kind: string): boolean => kind === 'STAMPS' || kind === 'VISITS';
export const needsAmount = (m: Pick<Member, 'kind' | 'min_txn_paise'>): boolean => !perBill(m.kind) || Number(m.min_txn_paise) > 0;

export const newKey = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;

/** What the cashier is told after giving a reward: the value to take off the bill, when it has one. */
export const valueLine = (valuePaise: string | number): string => (Number(valuePaise) > 0 ? rupees(Number(valuePaise)) : '');

export const HEX = /^#[0-9a-f]{6}$/i;
/** A card colour that is safe to paint: anything that is not a plain #rrggbb falls back. */
export const paint = (c: Partial<Card> | undefined): Card => ({
  bg: c?.bg && HEX.test(c.bg) ? c.bg : '#0f766e', fg: c?.fg && HEX.test(c.fg) ? c.fg : '#ffffff', accent: c?.accent && HEX.test(c.accent) ? c.accent : '#fbbf24', title: c?.title, message: c?.message
});

export const MEMBER_TEXTS = [
  'You do not have access to the member desk.', 'Member desk', 'Find a member, stamp their card, give a reward', 'Find a member, add a stamp or points, or give a reward.', 'Mobile number, member number or scan', 'Find', 'Scan a card',
  'Point the camera at the card QR', 'Allow the camera', 'Close camera', 'Stamp', 'Add points', 'Bill amount',
  'Added. Balance {b}', 'This bill is too small to earn anything', 'Rewards', 'Give', 'Use points', 'Recent', 'No rewards on this card yet.', '{n} more needed',
  '{name} given. Balance {b}', 'Take {value} off the bill. Balance {b}', 'Switched off', 'Not a member yet. Join them now', 'Customer name', 'Mobile number', 'Join',
  'They agreed to receive offers', 'No offers', 'There is no loyalty card yet. The owner can make one under Loyalty & coupons.', 'No membership found.', 'Nothing yet.',
  'Bills made with the customer\'s mobile number add automatically. Use this for a bill made without it.', 'Stamps', 'Points'
];
