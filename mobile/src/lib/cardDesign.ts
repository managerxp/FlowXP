/* The look of a loyalty card on the phone: colours, icon, heading and message. Saved with PUT /loyalty/programmes/:id { card } (the server checks every value again).
   Mirrors the web designer (frontend LoyaltyCardFace / LoyaltyProgrammes), so a card looks the same on both. */
import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

type Glyph = ComponentProps<typeof MaterialCommunityIcons>['name'];
export type CardLook = { bg: string; fg: string; accent: string; icon: string; title: string; message: string };
export type Programme = { programme_id: number; name: string; kind: string; redeem_points: number; card: Partial<CardLook> | null };

export const DEFAULT_LOOK: CardLook = { bg: '#0f766e', fg: '#ffffff', accent: '#fbbf24', icon: 'star', title: '', message: '' };
export const THEMES: [string, string, string][] = [['#0f766e', '#ffffff', '#fbbf24'], ['#1e3a8a', '#ffffff', '#fbbf24'], ['#7c2d12', '#ffffff', '#fdba74'], ['#831843', '#ffffff', '#f9a8d4'], ['#111827', '#ffffff', '#34d399'], ['#fef3c7', '#78350f', '#b45309']];
export const ACCENTS = ['#fbbf24', '#34d399', '#f9a8d4', '#fdba74', '#60a5fa', '#ffffff'];

/** key -> drawing and name. The keys are the ones the server accepts (backend CARD_ICONS). */
export const ICONS: Record<string, { glyph: Glyph; name: string }> = {
  star: { glyph: 'star', name: 'Star' }, coffee: { glyph: 'coffee', name: 'Coffee mug' }, heart: { glyph: 'heart', name: 'Heart' }, gift: { glyph: 'gift', name: 'Gift' },
  scissors: { glyph: 'content-cut', name: 'Scissors' }, utensils: { glyph: 'silverware-fork-knife', name: 'Food' }, car: { glyph: 'car', name: 'Car' }, dumbbell: { glyph: 'dumbbell', name: 'Dumbbell' },
  crown: { glyph: 'crown', name: 'Caesar crown' }, sparkles: { glyph: 'shimmer', name: 'Sparkles' }, smile: { glyph: 'emoticon-happy-outline', name: 'Smile' }, cake: { glyph: 'cake-variant', name: 'Cake' },
  pizza: { glyph: 'pizza', name: 'Pizza' }, shirt: { glyph: 'tshirt-crew', name: 'Shirt' }, wrench: { glyph: 'wrench', name: 'Spanner' }, bike: { glyph: 'bike', name: 'Bike' }
};
const SUGGESTED: Record<string, string[]> = {
  SALON: ['scissors', 'crown', 'coffee', 'sparkles', 'smile'],
  RESTAURANT: ['utensils', 'coffee', 'pizza', 'cake', 'star'], CAFE: ['coffee', 'cake', 'utensils', 'heart', 'star'], CLOUD_KITCHEN: ['utensils', 'pizza', 'cake', 'star', 'gift'],
  GYM: ['dumbbell', 'heart', 'star', 'smile', 'gift'], AUTO_PARTS: ['wrench', 'car', 'bike', 'star', 'gift'], MECHANIC: ['wrench', 'car', 'bike', 'star', 'gift'],
  CLOTHING: ['shirt', 'sparkles', 'gift', 'heart', 'star']
};
/** Five icons that suit the business (barber and salon: scissors, Caesar crown, coffee mug, sparkles, smile), plus the one already chosen. */
export const suggestedIcons = (type: string | undefined, current?: string): string[] => [...new Set([...(SUGGESTED[type ?? ''] ?? ['star', 'heart', 'gift', 'coffee', 'sparkles']), ...(current && current in ICONS ? [current] : [])])];

export const isHex = (v: string): boolean => /^#[0-9a-fA-F]{6}$/.test(v.trim());
/** Text colour that stays readable on a colour the owner picked: dark on light, white on dark. */
export const readableOn = (hex: string): string => { const n = parseInt(hex.slice(1), 16); return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160 ? '#111827' : '#ffffff'; };

export const lookOf = (p: Pick<Programme, 'card'>): CardLook => ({ ...DEFAULT_LOOK, ...(p.card ?? {}), icon: p.card?.icon && p.card.icon in ICONS ? p.card.icon : 'star' });
/** What is sent: only a colour that is really a colour (the server also checks). */
export const cardBody = (l: CardLook): { card: CardLook } => ({ card: { ...l, bg: isHex(l.bg) ? l.bg.trim().toLowerCase() : DEFAULT_LOOK.bg, fg: isHex(l.fg) ? l.fg.trim().toLowerCase() : DEFAULT_LOOK.fg, accent: isHex(l.accent) ? l.accent.trim().toLowerCase() : DEFAULT_LOOK.accent, title: l.title.trim().slice(0, 40), message: l.message.trim().slice(0, 140) } });

export const canDesign = (role: string | undefined): boolean => role === 'OWNER' || role === 'ADMIN';

export const DESIGN_TEXTS = [
  'Design loyalty cards', 'Change how your cards look', 'Loyalty card', 'Card design', 'You do not have access to the card designer.', 'No cards yet. Make one on the web under Loyalty & coupons.',
  'Colours', 'Pick your own colour', 'Colour (like #0f766e)', 'Stamp colour', 'Icon', 'More icons', 'Fewer icons', 'Heading on the card', 'Message inside the card', 'Leave empty to use the card name.',
  'Save the look', 'Saved', 'Could not save. Check the connection and try again.', 'Use a colour like #0f766e.', '{n} of {total} stamps', 'points',
  'Star', 'Coffee mug', 'Heart', 'Gift', 'Scissors', 'Food', 'Car', 'Dumbbell', 'Caesar crown', 'Sparkles', 'Smile', 'Cake', 'Pizza', 'Shirt', 'Spanner', 'Bike'
];
