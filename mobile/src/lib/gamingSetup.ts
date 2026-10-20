/* Gaming lounge set-up on the phone: zones and stations, rates (what time costs), offers and hour packs, the games list and the lounge settings. Pure helpers, no screens. */
import { t } from './i18n.ts';
import { rupees, toPaise } from './money.ts';
import { KIND_LABEL } from './gaming.ts';

export const canGamingSetup = (can: (p: string) => boolean): boolean => can('gaming_setup');

export const KIND_CHOICES: { id: string; label: string }[] = [
  { id: 'CONSOLE', label: 'Console' }, { id: 'VR', label: 'VR' }, { id: 'POOL', label: 'Pool table' }, { id: 'SNOOKER', label: 'Snooker table' }, { id: 'TABLE_GAME', label: 'Table game' }, { id: 'OTHER', label: 'Other' }
];
export const DAY_CHOICES: { id: number; label: string }[] = [{ id: 1, label: 'Mon' }, { id: 2, label: 'Tue' }, { id: 3, label: 'Wed' }, { id: 4, label: 'Thu' }, { id: 5, label: 'Fri' }, { id: 6, label: 'Sat' }, { id: 0, label: 'Sun' }];
export const BLOCK_CHOICES: { id: string; label: string }[] = [{ id: '1', label: 'By the minute' }, { id: '15', label: 'Every 15 minutes' }, { id: '30', label: 'Every 30 minutes' }, { id: '60', label: 'Every hour' }];

const short = (n: number): string => rupees(toPaise(n)).replace(/\.00$/, '');
const whole = (s: string): boolean => /^\d+$/.test(s.trim());
const amount = (s: string): boolean => s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) >= 0;
const isTime = (s: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(s.trim());
const kindName = (k: string): string => t(KIND_LABEL[k] ?? k);

/* ── stations and zones ──────────────────────────────────────────────────── */
export type Zone = { zone_id: number; name: string; stations: number };
export type GStation = { station_id: number; name: string; kind: string; label: string | null; max_players: number; zone_id: number | null; zone_name: string | null; status: string; status_note: string | null };
export type StationForm = { name: string; kind: string; label: string; max_players: string; zone_id: string };
export const emptyStation = (zoneId?: number): StationForm => ({ name: '', kind: 'CONSOLE', label: '', max_players: '4', zone_id: zoneId ? String(zoneId) : '' });
export const stationForm = (s: GStation): StationForm => ({ name: s.name, kind: s.kind, label: s.label ?? '', max_players: String(s.max_players), zone_id: s.zone_id ? String(s.zone_id) : '' });
export const stationProblem = (f: StationForm): string => (!f.name.trim() ? 'Give the station a name' : !whole(f.max_players) || Number(f.max_players) < 1 || Number(f.max_players) > 20 ? 'Most players is a whole number from 1 to 20' : '');
export const stationBody = (f: StationForm) => ({ name: f.name.trim(), kind: f.kind, label: f.label.trim() || null, max_players: Number(f.max_players), zone_id: f.zone_id ? Number(f.zone_id) : null });
export const stationSub = (s: GStation): string => [kindName(s.kind) + (s.label ? ` · ${s.label}` : ''), s.zone_name || t('No zone'), t('up to {n}', { n: s.max_players }), s.status_note || ''].filter(Boolean).join(' · ');
export const zoneProblem = (name: string): string => (name.trim() ? '' : 'Give the zone a name');

/* ── rates ───────────────────────────────────────────────────────────────── */
export type Tier = { players: number; hour: number };
export type Band = { name: string; days: number[]; from: string; to: string; multiplier_pct: number };
export type Rate = {
  rate_id: number; name: string; kind: string | null; zone_id: number | null; station_id: number | null; bill_time: boolean; tiers: Tier[]; bands: Band[]; extra_player_hour: number | null;
  block_minutes: number; grace_minutes: number; min_minutes: number; unit_label: string | null; unit_price: number;
};
export type RateForm = {
  name: string; scope: string; bill_time: boolean; tiers: { players: string; hour: string }[]; extra: string; block: string; grace: string; min: string; unitLabel: string; unitPrice: string;
  bands: { name: string; days: number[]; from: string; to: string; pct: string }[];
};
export const scopeOf = (r: Pick<Rate, 'kind' | 'zone_id' | 'station_id'>): string => (r.station_id ? `station:${r.station_id}` : r.zone_id ? `zone:${r.zone_id}` : r.kind ? `kind:${r.kind}` : 'all');
export const emptyRate = (): RateForm => ({ name: '', scope: 'kind:CONSOLE', bill_time: true, tiers: [{ players: '1', hour: '' }], extra: '', block: '1', grace: '0', min: '0', unitLabel: '', unitPrice: '', bands: [] });
export const newBand = () => ({ name: 'Evening', days: [0, 1, 2, 3, 4, 5, 6], from: '18:00', to: '23:00', pct: '120' });
export const rateForm = (r: Rate): RateForm => ({
  name: r.name, scope: scopeOf(r), bill_time: r.bill_time, tiers: r.tiers.map((x) => ({ players: String(x.players), hour: String(x.hour) })), extra: r.extra_player_hour == null ? '' : String(r.extra_player_hour),
  block: String(r.block_minutes), grace: String(r.grace_minutes), min: String(r.min_minutes), unitLabel: r.unit_label ?? '', unitPrice: r.unit_price ? String(r.unit_price) : '',
  bands: r.bands.map((b) => ({ name: b.name, days: b.days, from: b.from, to: b.to, pct: String(b.multiplier_pct ?? 100) }))
});
const filledTiers = (f: RateForm) => f.tiers.filter((x) => x.hour.trim() !== '');
export const rateProblem = (f: RateForm): string => {
  if (!f.name.trim()) return 'Give the rate a name';
  if (f.bill_time) {
    const tiers = filledTiers(f);
    if (!tiers.length) return 'Add at least one price: the players and the price an hour';
    if (tiers.length > 12) return 'Up to 12 prices by number of players';
    if (tiers.some((x) => !whole(x.players) || Number(x.players) < 1 || !amount(x.hour))) return 'Players are whole numbers and prices are amounts in rupees';
    if (new Set(tiers.map((x) => Number(x.players))).size !== tiers.length) return 'The same number of players is listed twice';
    if (f.extra.trim() && !amount(f.extra)) return 'Players are whole numbers and prices are amounts in rupees';
    if (![f.block, f.grace, f.min].every(whole) || Number(f.block) < 1 || Number(f.block) > 240 || Number(f.grace) > 60 || Number(f.min) > 600) return 'Billed, grace and minimum are whole numbers of minutes';
  }
  if (f.unitPrice.trim() && !amount(f.unitPrice)) return 'The price each is an amount in rupees';
  if (!f.bill_time && !(Number(f.unitPrice) > 0)) return 'A table charged only per frame needs a price per frame';
  if (f.bill_time && f.bands.length > 8) return 'Up to 8 peak times';
  if (f.bill_time) for (const b of f.bands) {
    if (!b.days.length) return 'A peak time needs its days';
    if (!isTime(b.from) || !isTime(b.to)) return 'Times are written like 18:00';
    if (!whole(b.pct) || Number(b.pct) < 10 || Number(b.pct) > 1000) return 'A peak time price is between 10% and 1000% of the normal price';
  }
  return '';
};
export const rateBody = (f: RateForm) => {
  const [kind, id] = f.scope.split(':');
  return {
    name: f.name.trim(), kind: kind === 'kind' ? id : null, zone_id: kind === 'zone' ? Number(id) : null, station_id: kind === 'station' ? Number(id) : null, bill_time: f.bill_time,
    tiers: f.bill_time ? filledTiers(f).map((x) => ({ players: Number(x.players), hour: Number(x.hour) })) : [], extra_player_hour: f.extra.trim() === '' ? null : Number(f.extra),
    block_minutes: Number(f.block), grace_minutes: Number(f.grace), min_minutes: Number(f.min), unit_label: f.unitLabel.trim() || null, unit_price: f.unitPrice.trim() === '' ? 0 : Number(f.unitPrice),
    bands: f.bill_time ? f.bands.map((b) => ({ name: b.name.trim() || 'Peak', days: b.days, from: b.from.trim(), to: b.to.trim(), multiplier_pct: Number(b.pct) })) : []
  };
};
export const scopeName = (r: Rate, zones: Zone[], stations: GStation[]): string =>
  r.station_id ? stations.find((s) => s.station_id === r.station_id)?.name ?? t('One station') : r.zone_id ? t('Zone {name}', { name: zones.find((z) => z.zone_id === r.zone_id)?.name ?? '' }) : r.kind ? kindName(r.kind) : t('Every station');
export const rateSummary = (r: Rate): string => {
  const parts: string[] = [];
  if (r.bill_time) parts.push(r.tiers.map((x) => t('{n} players {value} an hour', { n: x.players, value: short(x.hour) })).join(' · '));
  if (r.unit_price > 0) parts.push(t('{value} for each {unit}', { value: short(r.unit_price), unit: r.unit_label || t('frame') }));
  if (r.bill_time && r.block_minutes > 1) parts.push(t('billed every {n} min', { n: r.block_minutes }));
  if (r.bill_time && r.min_minutes) parts.push(t('minimum {n} min', { n: r.min_minutes }));
  if (r.bands.length) parts.push(t('{n} peak times', { n: r.bands.length }));
  return parts.filter(Boolean).join(' · ') || t('No price set');
};

/* ── offers and hour packs ───────────────────────────────────────────────── */
export type Offer = { bundle_id: number; name: string; minutes: number; price: number; players: number; kinds: string[] | null; valid_days: number | null };
export type OfferForm = { name: string; hours: string; price: string; players: string; kinds: string[]; valid: string };
export const emptyOffer = (pack: boolean): OfferForm => ({ name: '', hours: pack ? '10' : '3', price: '', players: '1', kinds: [], valid: pack ? '90' : '' });
export const offerForm = (o: Offer): OfferForm => ({ name: o.name, hours: String(o.minutes / 60), price: String(o.price), players: String(o.players), kinds: o.kinds ?? [], valid: o.valid_days ? String(o.valid_days) : '' });
export const offerProblem = (f: OfferForm, pack: boolean): string => {
  if (!f.name.trim()) return 'Give the offer a name';
  if (!(Number(f.hours) > 0) || Number(f.hours) > 100) return 'Hours must be more than zero';
  if (!amount(f.price)) return 'Enter the price (before GST)';
  if (!pack && (!whole(f.players) || Number(f.players) < 1 || Number(f.players) > 20)) return 'Players covered is a whole number from 1 to 20';
  if (pack && f.valid.trim() && (!whole(f.valid) || Number(f.valid) < 1)) return 'Good for is a whole number of days';
  return '';
};
export const offerBody = (f: OfferForm, pack: boolean) => ({
  name: f.name.trim(), kind: pack ? 'PACK' : 'SESSION', minutes: Math.round(Number(f.hours) * 60), price: Number(f.price), players: pack ? 1 : Number(f.players), kinds: f.kinds, valid_days: pack && f.valid.trim() ? Number(f.valid) : null
});
const hoursText = (minutes: number): string => (minutes % 60 === 0 ? t('{n} hours', { n: minutes / 60 }) : t('{n} min', { n: minutes }));
export const offerSub = (o: Offer, pack: boolean): string => [
  t('{time} for {value}', { time: hoursText(o.minutes), value: short(o.price) }),
  pack ? (o.valid_days ? t('good for {n} days', { n: o.valid_days }) : t('no expiry')) : t('{n} players covered', { n: o.players }),
  o.kinds?.length ? o.kinds.map(kindName).join(', ') : ''
].filter(Boolean).join(' · ');

/* ── settings ────────────────────────────────────────────────────────────── */
export type GSettings = { alert_minutes: number; hold_minutes: number; noshow_minutes: number; gst_rate: number; topup_bonus: { min: number; bonus: number }[] };
export type GSettingsForm = { alert: string; hold: string; noshow: string; gst: string; bonus: { min: string; bonus: string }[] };
export const gsettingsForm = (s: GSettings): GSettingsForm => ({ alert: String(s.alert_minutes), hold: String(s.hold_minutes), noshow: String(s.noshow_minutes), gst: String(s.gst_rate), bonus: (s.topup_bonus ?? []).map((r) => ({ min: String(r.min), bonus: String(r.bonus) })) });
export const gsettingsProblem = (f: GSettingsForm, withBonus: boolean): string => {
  if (!whole(f.alert) || Number(f.alert) < 1 || Number(f.alert) > 60) return 'The warning is 1 to 60 minutes';
  if (![f.hold, f.noshow].every(whole) || Number(f.hold) > 240 || Number(f.noshow) > 240) return 'Hold and no-show times are 0 to 240 minutes';
  if (!amount(f.gst) || Number(f.gst) > 40) return 'GST is a percentage from 0 to 40';
  if (withBonus) {
    if (f.bonus.length > 8) return 'Up to 8 bonuses';
    if (f.bonus.some((r) => !(Number(r.min) >= 1) || !(Number(r.bonus) > 0))) return 'Each bonus needs a top-up of at least ₹1 and an extra amount above zero';
    if (new Set(f.bonus.map((r) => Number(r.min))).size !== f.bonus.length) return 'Two bonuses start at the same top-up';
  }
  return '';
};
export const gsettingsBody = (f: GSettingsForm, withBonus: boolean) => ({
  alert_minutes: Number(f.alert), hold_minutes: Number(f.hold), noshow_minutes: Number(f.noshow), gst_rate: Number(f.gst),
  ...(withBonus ? { topup_bonus: f.bonus.map((r) => ({ min: Number(r.min), bonus: Number(r.bonus) })) } : {})
});

export const GAMING_SETUP_TEXTS: string[] = [
  'Zones', 'Stations', 'Rates', 'Offers', 'Hour packs', 'Games', 'Settings', 'Save', 'Remove', 'Cancel', 'Name', 'Kind', 'Zone', 'Players', 'Per hour', 'Days', 'From', 'To', 'Hours', 'Add', 'Added', 'Removed', 'Retired', 'Switched off', 'Back', 'Saved',
  'The groups on the board: Console lounge, Private rooms, Pool and snooker', '{n} stations', 'Zone name', 'Remove {name}?', 'Move or retire its stations first.', 'New zone', 'Add a zone', 'Zone added',
  'Each one has its own table, so food and drink for it sit on the same bill as its time', 'Add a station', 'Add your first PS5, room or table.', 'Out of service', 'Back in service', 'Taken out of service',
  'What the staff call it: PS5-1, Room A, Pool 2', 'What it is (optional)', 'PS5, Xbox Series X, 8-ball', 'Most players', 'What is wrong? (shown on the board)', 'Retire', 'Retire {name}?', 'Its history stays.',
  'What time costs. A station with no rate cannot start a session.', 'New rate', 'Add one for your consoles, for example 1 player ₹100 an hour, 2 players ₹150.', 'Sessions already running keep the rate they started with. A change applies to the next session.',
  'PS5 hourly, Pool by the frame', 'Applies to', "A station's own rate beats its zone's, which beats its kind's", 'Charge for the time on the clock', 'Off for a table charged only per frame or game',
  'Price per hour, by number of players', 'Another price', 'Each extra player past the last row', "Blank: the last row's price", 'Three players pay the next row up (a row for 4 covers 3 and 4).',
  'Billed', 'Time over a block is rounded up', 'Grace (minutes)', 'Not billed if within this much over', 'Minimum (minutes)', 'The least ever billed',
  'Per frame or game (pool, snooker, table games)', 'What you count', 'Price each', 'Added to the time', 'Required when the clock is not charged', 'Peak and happy-hour times', 'Like 18:00', 'Like 23:00',
  'Price is (%)', 'of the normal price', 'Add a peak time', '120% is a fifth more than normal; 80% is a fifth off (a happy hour).', 'Save rate', 'Switch off', 'Switch off {name}?', 'Sessions already running keep it.',
  'Prepaid hours sold to a player and played from the board: 10 hours for ₹800', 'Fixed time at a set price, started from the board: 3 hours for ₹250', 'New pack', 'New offer', 'Packs are optional.', 'Offers are optional. Without one, every session is paid by the time used.',
  '3 hours, Weekend special', 'Price (before GST)', 'Good for (days)', 'Blank: never expires', 'Players covered', 'For which stations', 'None ticked: any',
  'A pack is prepaid hours the player spends over several visits. Minutes beyond what is left are charged at the rate of the station.', 'An offer is time sold as a block at one price. Stopping early refunds nothing; time over is charged at the rate of the station.',
  'A short list to pick from when you start a session, so you can see what is played most', 'New game', 'FIFA 26, Tekken 8, GTA V', 'Give the game a name', 'No games yet',
  'Warn when this much time is left (minutes)', 'The tile turns amber and staff get a notification', 'GST on gaming time (%)', 'Usually 18%. Food and drink use their own rates.', 'Hold a booked station for (minutes)', 'Before a booking, the station shows as booked',
  'Mark a no-show after (minutes)', 'Wallet top-up bonus', 'When they pay at least', 'They get extra', 'Add a bonus', 'Pay ₹500, get ₹50 extra. A top-up earns the highest bonus it reaches.', 'Save settings',
  'Gaming set-up', 'Stations, rates, offers and the lounge rules', 'You do not have access to gaming set-up.',
  'Console', 'VR', 'Pool table', 'Snooker table', 'Table game', 'Other', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
  'By the minute', 'Every 15 minutes', 'Every 30 minutes', 'Every hour',
  'No zone', 'up to {n}', 'Zone {name}', 'One station', 'Every station', 'frame', 'No price set',
  '{n} players {value} an hour', '{value} for each {unit}', 'billed every {n} min', 'minimum {n} min', '{n} peak times',
  '{n} hours', '{n} min', '{time} for {value}', 'good for {n} days', 'no expiry', '{n} players covered',
  'Give the station a name', 'Most players is a whole number from 1 to 20', 'Give the zone a name', 'Give the rate a name',
  'Add at least one price: the players and the price an hour', 'Up to 12 prices by number of players', 'Players are whole numbers and prices are amounts in rupees', 'The same number of players is listed twice',
  'Billed, grace and minimum are whole numbers of minutes', 'The price each is an amount in rupees', 'A table charged only per frame needs a price per frame', 'Up to 8 peak times', 'A peak time needs its days',
  'Times are written like 18:00', 'A peak time price is between 10% and 1000% of the normal price',
  'Give the offer a name', 'Hours must be more than zero', 'Enter the price (before GST)', 'Players covered is a whole number from 1 to 20', 'Good for is a whole number of days',
  'The warning is 1 to 60 minutes', 'Hold and no-show times are 0 to 240 minutes', 'GST is a percentage from 0 to 40', 'Up to 8 bonuses', 'Each bonus needs a top-up of at least ₹1 and an extra amount above zero', 'Two bonuses start at the same top-up'
];
