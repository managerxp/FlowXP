/*
 * Hotel set-up on the phone (people with the hotel set-up right): room types and rooms, rate plans and seasonal rates, rooms taken out of sale, the
 * banquet halls and menu packages, and the property's settings (check-in and check-out times, GST slab for the room tariff, booking number prefix).
 * The same as the website's Hotel set-up page; the server checks everything again. Each outlet is one property. (lib/hotel.ts is the front desk.)
 * Pure: types, forms, checks, bodies and wording.
 */
import { t } from './i18n.ts';
import { rupees, toPaise } from './money.ts';

const money = (n: number): string => rupees(toPaise(n));
export const canHotelSetup = (can: (perm: string) => boolean): boolean => can('hotel_setup');
const whole = (v: string): boolean => /^\d+$/.test(v.trim());
const num = (v: string): boolean => v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
const isDay = (v: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
const isTime = (v: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
export const list = (v: string): string[] => v.split(',').map((a) => a.trim()).filter(Boolean);

export const MEAL_PLANS: [string, string][] = [['EP', 'Room only'], ['CP', 'With breakfast'], ['MAP', 'Breakfast and one meal'], ['AP', 'All meals']];
export const DIETS: [string, string][] = [['VEG', 'Vegetarian'], ['NON_VEG', 'Non-vegetarian'], ['JAIN', 'Jain'], ['MIXED', 'Veg and non-veg']];

/* ── room types and rooms ────────────────────────────────────────────────── */
export type RoomType = { room_type_id: number; name: string; code: string; description: string | null; base_rate: number; extra_adult: number; extra_child: number; base_adults: number; max_adults: number; max_children: number; amenities: string[]; room_count: number };
export type Room = { room_id: number; room_no: string; floor: string | null; room_type_id: number; room_type: string; is_active: boolean };
export type TypeForm = { name: string; code: string; base_rate: string; extra_adult: string; extra_child: string; base_adults: string; max_adults: string; max_children: string; amenities: string; description: string };
export const emptyType = (): TypeForm => ({ name: '', code: '', base_rate: '', extra_adult: '', extra_child: '', base_adults: '2', max_adults: '2', max_children: '1', amenities: '', description: '' });
export const typeForm = (x: RoomType): TypeForm => ({ name: x.name, code: x.code, base_rate: String(x.base_rate), extra_adult: x.extra_adult ? String(x.extra_adult) : '', extra_child: x.extra_child ? String(x.extra_child) : '', base_adults: String(x.base_adults), max_adults: String(x.max_adults), max_children: String(x.max_children), amenities: x.amenities.join(', '), description: x.description ?? '' });
export const typeProblem = (f: TypeForm): string => {
  if (!f.name.trim()) return 'Give the room type a name';
  if (!num(f.base_rate)) return 'Enter the rack rate for a night (before GST)';
  for (const v of [f.extra_adult, f.extra_child]) if (v.trim() !== '' && !num(v)) return 'Extra charges are amounts in rupees';
  if (!whole(f.base_adults) || Number(f.base_adults) < 1 || !whole(f.max_adults) || Number(f.max_adults) < 1 || !whole(f.max_children)) return 'People are whole numbers (at least 1 adult)';
  if (Number(f.max_adults) < Number(f.base_adults)) return 'Most adults cannot be fewer than the adults the rate includes';
  return '';
};
export const typeBody = (f: TypeForm): Record<string, unknown> => ({
  name: f.name.trim(), code: f.code.trim() || f.name.trim().slice(0, 4), base_rate: Number(f.base_rate), extra_adult: Number(f.extra_adult) || 0, extra_child: Number(f.extra_child) || 0, base_adults: Number(f.base_adults), max_adults: Number(f.max_adults), max_children: Number(f.max_children),
  amenities: list(f.amenities), description: f.description.trim()
});
export const typeSub = (x: RoomType): string => [t('Rack rate {value}', { value: money(x.base_rate) }), x.extra_adult ? t('extra adult {value}', { value: money(x.extra_adult) }) : '', t('{base} included · up to {adults} adults, {children} children', { base: x.base_adults, adults: x.max_adults, children: x.max_children }), t('{n} rooms', { n: x.room_count })].filter(Boolean).join(' · ');
export const roomSub = (r: Room): string => [r.room_type, r.floor ? t('floor {n}', { n: r.floor }) : '', r.is_active ? '' : t('Retired')].filter(Boolean).join(' · ');

export type BulkForm = { room_type_id: string; from: string; to: string; floor: string; prefix: string };
export const emptyBulk = (typeId: number | undefined): BulkForm => ({ room_type_id: typeId ? String(typeId) : '', from: '', to: '', floor: '', prefix: '' });
export const bulkProblem = (f: BulkForm): string => {
  if (!f.room_type_id) return 'Choose the room type';
  if (!whole(f.from) || !whole(f.to)) return 'First and last number are whole numbers';
  if (Number(f.to) < Number(f.from)) return 'The last number cannot be before the first';
  if (Number(f.to) - Number(f.from) + 1 > 200) return 'Add up to 200 rooms at a time';
  return '';
};
export const bulkBody = (f: BulkForm): Record<string, unknown> => ({ room_type_id: Number(f.room_type_id), from: Number(f.from), to: Number(f.to), floor: f.floor.trim() || undefined, prefix: f.prefix.trim() || undefined });
export const bulkCount = (f: BulkForm): number => Number(f.to) - Number(f.from) + 1;
export const bulkText = (added: number, wanted: number): string => (added === 1 ? t('1 room added') : t('{n} rooms added', { n: added })) + (added < wanted ? ` ${t('(the rest already existed)')}` : '');
export type RoomForm = { room_no: string; floor: string; room_type_id: string };
export const roomProblem = (f: RoomForm): string => (!f.room_no.trim() ? 'Give the room a number' : !f.room_type_id ? 'Choose the room type' : '');
export const roomBody = (f: RoomForm, isActive?: boolean): Record<string, unknown> => ({ room_no: f.room_no.trim(), floor: f.floor.trim() || undefined, room_type_id: Number(f.room_type_id), ...(isActive === undefined ? {} : { is_active: isActive }) });

/* ── rate plans and seasonal rates ───────────────────────────────────────── */
export type RatePlan = { rate_plan_id: number; name: string; code: string; meal_plan: string; meal_plan_name: string; is_default: boolean; rates: Record<string, number | null> };
export type Season = { override_id: number; name: string | null; room_type_id: number; room_type: string; rate_plan_id: number | null; rate_plan: string | null; from_date: string; to_date: string; days_of_week: number[] | null; rate: number };
export type PlanForm = { name: string; code: string; meal_plan: string; is_default: boolean; rates: Record<string, string> };
export const emptyPlan = (): PlanForm => ({ name: '', code: '', meal_plan: 'EP', is_default: false, rates: {} });
export const planForm = (p: RatePlan): PlanForm => ({ name: p.name, code: p.code, meal_plan: p.meal_plan, is_default: p.is_default, rates: Object.fromEntries(Object.entries(p.rates).map(([k, v]) => [k, v == null ? '' : String(v)])) });
export const planProblem = (f: PlanForm): string => {
  if (!f.name.trim()) return 'Give the plan a name';
  for (const v of Object.values(f.rates)) if (v.trim() !== '' && !num(v)) return 'Rates are amounts in rupees';
  return '';
};
/** Every room type is sent: a blank rate means "use the room type's rack rate". */
export const planBody = (f: PlanForm, types: RoomType[]): Record<string, unknown> => ({
  name: f.name.trim(), code: f.code.trim() || f.name.trim().slice(0, 4), meal_plan: f.meal_plan, is_default: f.is_default,
  rates: Object.fromEntries(types.map((x) => [x.room_type_id, f.rates[x.room_type_id] == null || f.rates[x.room_type_id].trim() === '' ? null : Number(f.rates[x.room_type_id])]))
});
export const planSub = (p: RatePlan, types: RoomType[]): string => `${t(p.meal_plan_name)} · ${types.map((x) => `${x.name} ${money(p.rates[x.room_type_id] ?? x.base_rate)}`).join(' · ')}`;
export type SeasonForm = { room_type_id: string; rate_plan_id: string; name: string; from_date: string; to_date: string; rate: string; weekends: boolean };
export const emptySeason = (typeId: number | undefined): SeasonForm => ({ room_type_id: typeId ? String(typeId) : '', rate_plan_id: '', name: '', from_date: '', to_date: '', rate: '', weekends: false });
export const seasonProblem = (f: SeasonForm): string => {
  if (!f.room_type_id) return 'Choose the room type';
  if (!isDay(f.from_date) || !isDay(f.to_date)) return 'Dates are written like 2026-11-01';
  if (f.to_date < f.from_date) return 'The last date cannot be before the first';
  if (!num(f.rate) || Number(f.rate) === 0) return 'Enter the rate for a night (before GST)';
  return '';
};
export const seasonBody = (f: SeasonForm): Record<string, unknown> => ({ room_type_id: Number(f.room_type_id), rate_plan_id: f.rate_plan_id ? Number(f.rate_plan_id) : undefined, name: f.name.trim() || undefined, from_date: f.from_date, to_date: f.to_date, rate: Number(f.rate), days_of_week: f.weekends ? [5, 6] : undefined });
export const seasonLine = (o: Season): string => [o.room_type, o.rate_plan ?? t('Every plan'), `${o.from_date.slice(0, 10)} → ${o.to_date.slice(0, 10)}`, o.days_of_week?.length ? t('(Fri and Sat)') : ''].filter(Boolean).join(' · ');

/* ── rooms out of sale ───────────────────────────────────────────────────── */
export type Block = { block_id: number; room_id: number; room_no: string; from_date: string; to_date: string; reason: string | null };
export type BlockForm = { room_id: string; from_date: string; to_date: string; reason: string };
export const emptyBlock = (roomId: number | undefined): BlockForm => ({ room_id: roomId ? String(roomId) : '', from_date: '', to_date: '', reason: '' });
export const blockProblem = (f: BlockForm): string => (!f.room_id ? 'Choose the room' : !isDay(f.from_date) || !isDay(f.to_date) ? 'Dates are written like 2026-11-01' : f.to_date <= f.from_date ? 'The room must be back on sale after the first night' : '');
export const blockBody = (f: BlockForm): Record<string, unknown> => ({ room_id: Number(f.room_id), from_date: f.from_date, to_date: f.to_date, reason: f.reason.trim() || undefined });
export const blockLine = (b: Block): string => [t('from {date}', { date: b.from_date.slice(0, 10) }), t('until {date}', { date: b.to_date.slice(0, 10) }), b.reason ?? ''].filter(Boolean).join(' · ');

/* ── banquet ─────────────────────────────────────────────────────────────── */
export type Hall = { hall_id: number; name: string; capacity_seated: number; capacity_floating: number; rent: number; amenities: string[] };
export type HallForm = { name: string; capacity_seated: string; capacity_floating: string; rent: string; amenities: string };
export const emptyHall = (): HallForm => ({ name: '', capacity_seated: '', capacity_floating: '', rent: '', amenities: '' });
export const hallForm = (h: Hall): HallForm => ({ name: h.name, capacity_seated: h.capacity_seated ? String(h.capacity_seated) : '', capacity_floating: h.capacity_floating ? String(h.capacity_floating) : '', rent: h.rent ? String(h.rent) : '', amenities: h.amenities.join(', ') });
export const hallProblem = (f: HallForm): string => (!f.name.trim() ? 'Give the hall a name' : [f.capacity_seated, f.capacity_floating].some((v) => v.trim() !== '' && !whole(v)) ? 'Capacity is a whole number of people' : f.rent.trim() !== '' && !num(f.rent) ? 'Rent is an amount in rupees' : '');
export const hallBody = (f: HallForm): Record<string, unknown> => ({ name: f.name.trim(), capacity_seated: Number(f.capacity_seated) || 0, capacity_floating: Number(f.capacity_floating) || 0, rent: Number(f.rent) || 0, amenities: list(f.amenities) });
export const hallSub = (h: Hall): string => [h.capacity_seated ? t('{n} seated', { n: h.capacity_seated }) : '', h.capacity_floating ? t('{n} standing', { n: h.capacity_floating }) : '', t('rent {value}', { value: money(h.rent) }), h.amenities.join(', ')].filter(Boolean).join(' · ');
export type Package = { package_id: number; name: string; diet: string; per_plate: number; min_guests: number; tax_rate: number | string; menu: string | null };
export type PackageForm = { name: string; diet: string; per_plate: string; min_guests: string; tax_rate: string; menu: string };
export const emptyPackage = (): PackageForm => ({ name: '', diet: 'VEG', per_plate: '', min_guests: '', tax_rate: '18', menu: '' });
export const packageForm = (p: Package): PackageForm => ({ name: p.name, diet: p.diet, per_plate: String(p.per_plate), min_guests: p.min_guests ? String(p.min_guests) : '', tax_rate: String(Number(p.tax_rate)), menu: p.menu ?? '' });
export const packageProblem = (f: PackageForm): string => (!f.name.trim() ? 'Give the package a name' : !num(f.per_plate) ? 'Enter the price a plate (before GST)' : f.min_guests.trim() !== '' && !whole(f.min_guests) ? 'Fewest guests is a whole number' : !(num(f.tax_rate) && Number(f.tax_rate) <= 100) ? 'GST is a percentage from 0 to 100' : '');
export const packageBody = (f: PackageForm): Record<string, unknown> => ({ name: f.name.trim(), diet: f.diet, per_plate: Number(f.per_plate), min_guests: Number(f.min_guests) || 0, tax_rate: Number(f.tax_rate), menu: f.menu.trim() || undefined });
export const dietName = (c: string): string => t(DIETS.find(([k]) => k === c)?.[1] ?? c);
export const packageSub = (p: Package): string => [dietName(p.diet), t('{value} a plate', { value: money(p.per_plate) }), p.min_guests ? t('from {n} guests', { n: p.min_guests }) : '', `${Number(p.tax_rate)}% GST`, p.menu ? (p.menu.length > 70 ? `${p.menu.slice(0, 70)}…` : p.menu) : ''].filter(Boolean).join(' · ');

/* ── settings ────────────────────────────────────────────────────────────── */
export type HotelSettings = { check_in_time: string; check_out_time: string; tax_threshold: number; tax_low_pct: string | number; tax_high_pct: string | number; allow_overbooking: boolean; res_prefix: string; business_date: string; audits: number };
export type SettingsForm = { check_in_time: string; check_out_time: string; tax_threshold: string; tax_low_pct: string; tax_high_pct: string; allow_overbooking: boolean; res_prefix: string; business_date: string };
export const settingsForm = (s: HotelSettings): SettingsForm => ({ check_in_time: String(s.check_in_time).slice(0, 5), check_out_time: String(s.check_out_time).slice(0, 5), tax_threshold: String(s.tax_threshold), tax_low_pct: String(Number(s.tax_low_pct)), tax_high_pct: String(Number(s.tax_high_pct)), allow_overbooking: s.allow_overbooking, res_prefix: s.res_prefix, business_date: String(s.business_date).slice(0, 10) });
export const settingsProblem = (f: SettingsForm, audits: number): string => {
  if (!isTime(f.check_in_time) || !isTime(f.check_out_time)) return 'Times are written like 12:00';
  if (!/^[A-Za-z0-9]{1,8}$/.test(f.res_prefix.trim())) return 'The booking prefix is 1 to 8 letters or digits';
  if (!num(f.tax_threshold)) return 'The limit a night is an amount in rupees';
  for (const v of [f.tax_low_pct, f.tax_high_pct]) if (!num(v) || Number(v) > 100) return 'GST is a percentage from 0 to 100';
  if (audits === 0 && !isDay(f.business_date)) return 'The date is written like 2026-11-01';
  return '';
};
/** The hotel's date is only sent before the first night audit: after that only night audit moves it. */
export const settingsBody = (f: SettingsForm, audits: number): Record<string, unknown> => ({
  check_in_time: f.check_in_time, check_out_time: f.check_out_time, tax_threshold: Number(f.tax_threshold), tax_low_pct: Number(f.tax_low_pct), tax_high_pct: Number(f.tax_high_pct), allow_overbooking: f.allow_overbooking, res_prefix: f.res_prefix.trim().toUpperCase(),
  ...(audits === 0 ? { business_date: f.business_date } : {})
});

export const HOTEL_SETUP_TEXTS: string[] = [
  'Deluxe, Sea view, Dormitory…', 'Grand Ballroom, Sea Lawn…',
  'Hotel set-up', 'Your rooms, rates and rules. Set these once, then the front desk takes it from there.', 'Rooms', 'Rates', 'Out of sale', 'Banquet', 'Settings', 'You do not have access to hotel set-up.', 'Could not load.', 'Could not save. Check the connection and try again.', 'Back', 'Cancel', 'Save', 'Saved', 'Removed', 'Remove',
  'Room types', 'Each type has its own rack rate and how many people it takes.', 'Add a type', 'Add your first room type, such as Deluxe or Standard.', 'Name', 'Short code', 'Shown on the calendar', 'Rack rate a night', 'Before GST', 'Adults the rate includes', 'Most adults', 'Most children', 'Each extra adult, a night', 'Each child, a night',
  'What is in the room', 'Separate with commas', 'Air conditioning, TV, sea view, breakfast', 'Description', 'Rack rate {value}', 'extra adult {value}', '{base} included · up to {adults} adults, {children} children', '{n} rooms', 'Remove {name}?', 'It disappears from new bookings. Past bookings keep it.',
  'Give the room type a name', 'Enter the rack rate for a night (before GST)', 'Extra charges are amounts in rupees', 'People are whole numbers (at least 1 adult)', 'Most adults cannot be fewer than the adults the rate includes',
  'The rooms you can sell.', 'Add many', 'Add a room', 'No rooms yet. Add many at once, for example 101 to 110.', 'floor {n}', 'Retired', 'Retire', 'Restore', 'Room type', 'First number', 'Last number', 'Floor', 'Prefix', 'Like A', 'Add the rooms', 'Room number', 'Type',
  'Choose the room type', 'First and last number are whole numbers', 'The last number cannot be before the first', 'Add up to 200 rooms at a time', '1 room added', '{n} rooms added', '(the rest already existed)', 'Give the room a number',
  'Rate plans', 'A plan is a way of selling the same room, such as room only or with breakfast. Leave a rate empty to use the room type\'s rack rate.', 'Add a plan', 'Add a room type first. A “Room only” plan is made for you.', 'Default', 'Meals included', 'Room only', 'With breakfast', 'Breakfast and one meal', 'All meals',
  'Rate a night for each room type (before GST)', 'Rack rate', 'Use this plan when none is chosen', 'Give the plan a name', 'Rates are amounts in rupees',
  'Seasonal rates', 'A different rate for a stretch of dates, such as the peak season, a festival or weekends. The newest one wins where they overlap.', 'Add a seasonal rate', 'No seasonal rates. Every night uses the plan or rack rate.', 'Seasonal rate', 'Peak season, Diwali, New Year…', 'Plan', 'Every plan', 'From', 'To (including)', 'Rate a night', 'Friday and Saturday nights only', '(Fri and Sat)',
  'Remove this seasonal rate?', 'Bookings already made keep the rate they were given.', 'Dates are written like 2026-11-01', 'The last date cannot be before the first', 'Enter the rate for a night (before GST)', 'Add',
  'Rooms out of sale', 'Take a room off the calendar for repairs, painting or owner use. For a room that is out of order right now, use the front desk.', 'Take a room out of sale', 'No rooms are out of sale.', 'Room', 'First night', 'Open for booking again on', 'Why', 'Repainting, plumbing, owner\'s guests…', 'Take out of sale', 'Put back on sale', 'Put room {room} back on sale?', 'Back on sale', 'Room taken out of sale',
  'from {date}', 'until {date}', 'Choose the room', 'The room must be back on sale after the first night',
  'Banquet halls', 'Each hall has its capacity and the rent for one function.', 'Add a hall', 'No banquet halls yet.', 'Seated', 'Standing', 'Rent a function', 'What the hall has', 'Stage, air conditioning, projector, parking', '{n} seated', '{n} standing', 'rent {value}', 'Give the hall a name', 'Capacity is a whole number of people', 'Rent is an amount in rupees',
  'It cannot be removed while events are booked in it.', 'Menu packages', 'A package is a menu with a price a plate. Pick one when you plan a function and the food is charged for the guaranteed guests.', 'Add a package', 'No packages yet.', 'Diet', 'Vegetarian', 'Non-vegetarian', 'Jain', 'Veg and non-veg', 'Price a plate', 'Fewest guests charged', 'GST %', 'Menu',
  'Welcome drink, two starters, three mains, rice, breads, dessert', '{value} a plate', 'from {n} guests', 'Events already booked keep their price.', 'Give the package a name', 'Enter the price a plate (before GST)', 'Fewest guests is a whole number', 'GST is a percentage from 0 to 100',
  'Check-in and check-out', 'Check-in from', 'Check-out by', 'Booking number prefix', 'The hotel\'s date today', 'You can set this until you run the first night audit. After that only night audit moves it.', 'Only night audit moves this now.', 'GST on room tariff',
  'Room tariff is taxed by the rate charged for the night. Check the rates and the limit with your accountant; the law has changed more than once.', 'Limit a night', 'Up to this, the lower rate applies', 'GST up to the limit (%)', 'GST above the limit (%)', 'Bookings', 'Allow more bookings than rooms', 'Off is safer: the system refuses a booking when no room of that type is free.', 'Save settings',
  'Times are written like 12:00', 'The booking prefix is 1 to 8 letters or digits', 'The limit a night is an amount in rupees', 'The date is written like 2026-11-01', 'Rooms, rates, banquet and the property\'s rules'
];
