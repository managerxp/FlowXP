/* Distributor set-up on the phone, part one: principals and their brands, territories and beats, and the vans. Pure helpers, no screens. */
import { t } from './i18n.ts';
import { rupees, toPaise } from './money.ts';

const whole = (s: string): boolean => /^\d+$/.test(s.trim());
const amount = (s: string): boolean => s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) >= 0;
const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const day = (s: string | null | undefined): string => (s ? String(s).slice(0, 10) : '');
const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));
const money = (n: number): string => rupees(toPaise(n));

/* ── principals ──────────────────────────────────────────────────────────── */
export type Principal = {
  principal_id: number; name: string; company_name: string | null; contact_person: string | null; phone: string | null; email: string | null; gstin: string | null; pan: string | null; address: string | null;
  territory_note: string | null; agreement_start: string | null; agreement_end: string | null; agreement_status: string; margin_pct: number | string; payment_terms_days: number | null; credit_limit: number | null; notes: string | null;
  status: string; brands: number; products: number; payable: number;
};
export type PrincipalForm = Record<'name' | 'company_name' | 'contact_person' | 'phone' | 'email' | 'gstin' | 'pan' | 'address' | 'territory_note' | 'agreement_start' | 'agreement_end' | 'margin_pct' | 'payment_terms_days' | 'credit_limit' | 'notes', string>;
export const emptyPrincipal = (): PrincipalForm => ({ name: '', company_name: '', contact_person: '', phone: '', email: '', gstin: '', pan: '', address: '', territory_note: '', agreement_start: '', agreement_end: '', margin_pct: '', payment_terms_days: '', credit_limit: '', notes: '' });
export const principalForm = (p: Principal): PrincipalForm => {
  const f = emptyPrincipal();
  for (const k of Object.keys(f) as (keyof PrincipalForm)[]) { const v = (p as unknown as Record<string, unknown>)[k]; f[k] = v == null ? '' : String(v); }
  f.agreement_start = day(p.agreement_start); f.agreement_end = day(p.agreement_end);
  return f;
};
export const principalProblem = (f: PrincipalForm): string => {
  if (f.name.trim().length < 2) return 'Give the principal a name';
  if (f.gstin.trim() && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(f.gstin.trim().toUpperCase())) return 'A GSTIN has 15 characters, like 36ABCDE1234F1Z5';
  if (f.pan.trim() && !/^[A-Z]{5}\d{4}[A-Z]$/.test(f.pan.trim().toUpperCase())) return 'A PAN is 10 characters like ABCDE1234F';
  if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) return 'That email does not look right';
  if ((f.agreement_start.trim() && !isDate(f.agreement_start.trim())) || (f.agreement_end.trim() && !isDate(f.agreement_end.trim()))) return 'Dates are written like 2026-11-01';
  if (f.agreement_start.trim() && f.agreement_end.trim() && f.agreement_end.trim() < f.agreement_start.trim()) return 'The agreement cannot end before it starts';
  if (f.margin_pct.trim() && (!amount(f.margin_pct) || Number(f.margin_pct) > 100)) return 'The margin is a percentage from 0 to 100';
  if (f.payment_terms_days.trim() && !whole(f.payment_terms_days)) return 'Payment terms are a whole number of days';
  if (f.credit_limit.trim() && !amount(f.credit_limit)) return 'The credit limit is an amount in rupees';
  return '';
};
export const principalBody = (f: PrincipalForm) => ({
  name: f.name.trim(), company_name: f.company_name.trim(), contact_person: f.contact_person.trim(), phone: f.phone.trim(), email: f.email.trim(), gstin: f.gstin.trim().toUpperCase(), pan: f.pan.trim().toUpperCase(), address: f.address.trim(),
  territory_note: f.territory_note.trim(), agreement_start: f.agreement_start.trim() || null, agreement_end: f.agreement_end.trim() || null, margin_pct: num(f.margin_pct) ?? 0, payment_terms_days: num(f.payment_terms_days), credit_limit: num(f.credit_limit) ?? 0, notes: f.notes.trim()
});
export const AGREEMENT_LABEL: Record<string, string> = { ACTIVE: 'In force', EXPIRING: 'Ends soon', EXPIRED: 'Ended', UPCOMING: 'Not started', NONE: 'No dates' };
export const principalSub = (p: Principal): string => [
  t(AGREEMENT_LABEL[p.agreement_status] ?? 'No dates'), p.contact_person || '', p.phone || '', t('{n} brands', { n: p.brands }), t('{n} products', { n: p.products }), p.payable > 0 ? t('You owe {value}', { value: money(p.payable) }) : ''
].filter(Boolean).join(' · ');
export const brandProblem = (name: string): string => (name.trim().length < 2 ? 'Give the brand a name' : '');

/* ── territories and beats ───────────────────────────────────────────────── */
export type Territory = { territory_id: number; name: string; code: string | null; level: 'REGION' | 'TERRITORY' | 'AREA'; parent_id: number | null; status: string; customers: number; beats: number; salespeople: number };
export const LEVEL_LABEL: Record<string, string> = { REGION: 'Region', TERRITORY: 'Territory', AREA: 'Area' };
export const CHILD_LEVEL: Record<string, 'TERRITORY' | 'AREA' | undefined> = { REGION: 'TERRITORY', TERRITORY: 'AREA' };
/** The tree flattened for a list: each place with how deep it sits. */
export const flattenTerritories = (list: Territory[]): { place: Territory; depth: number }[] => {
  const out: { place: Territory; depth: number }[] = [];
  const walk = (parent: number | null, depth: number) => { for (const p of list.filter((x) => x.parent_id === parent).sort((a, b) => a.name.localeCompare(b.name))) { out.push({ place: p, depth }); walk(p.territory_id, depth + 1); } };
  walk(null, 0);
  return out;
};
export const placePath = (list: Territory[], id: number): string => {
  const names: string[] = []; let cur = list.find((x) => x.territory_id === id);
  while (cur) { names.unshift(cur.name); const parent: number | null = cur.parent_id; cur = parent ? list.find((x) => x.territory_id === parent) : undefined; }
  return names.join(' › ');
};
export const placeProblem = (name: string): string => (name.trim().length < 2 ? 'Give the place a name' : '');
export const placeBody = (name: string, code: string, level?: string, parentId?: number | null) => ({ name: name.trim(), code: code.trim() || null, ...(level ? { level, parent_id: parentId ?? null } : {}) });
export const placeSub = (p: Territory): string => [t(LEVEL_LABEL[p.level]), t('{n} shops', { n: p.customers }), p.beats ? t('{n} beats', { n: p.beats }) : '', p.status === 'INACTIVE' ? t('Inactive') : ''].filter(Boolean).join(' · ');

export type Beat = { beat_id: number; name: string; weekday: number | null; weekday_name: string | null; territory_id: number | null; territory: string | null; salesperson_id: number | null; salesperson: string | null; customers: number; status: string };
export type BeatForm = { name: string; weekday: string; territory_id: string; salesperson_id: string; status: string };
export const WEEKDAY_CHOICES: { id: string; label: string }[] = [{ id: '', label: 'Any day' }, { id: '1', label: 'Monday' }, { id: '2', label: 'Tuesday' }, { id: '3', label: 'Wednesday' }, { id: '4', label: 'Thursday' }, { id: '5', label: 'Friday' }, { id: '6', label: 'Saturday' }, { id: '0', label: 'Sunday' }];
export const emptyBeat = (): BeatForm => ({ name: '', weekday: '', territory_id: '', salesperson_id: '', status: 'ACTIVE' });
export const beatForm = (b: Beat): BeatForm => ({ name: b.name, weekday: b.weekday == null ? '' : String(b.weekday), territory_id: b.territory_id ? String(b.territory_id) : '', salesperson_id: b.salesperson_id ? String(b.salesperson_id) : '', status: b.status });
export const beatProblem = (f: BeatForm): string => (f.name.trim().length < 2 ? 'Give the beat a name' : '');
export const beatBody = (f: BeatForm, editing: boolean) => ({
  name: f.name.trim(), weekday: f.weekday === '' ? null : Number(f.weekday), territory_id: f.territory_id ? Number(f.territory_id) : null, salesperson_id: f.salesperson_id ? Number(f.salesperson_id) : null, ...(editing ? { status: f.status } : {})
});
export const beatSub = (b: Beat): string => [b.weekday_name ? t(b.weekday_name) : t('Any day'), b.territory || '', b.salesperson || t('Unassigned'), t('{n} shops', { n: b.customers })].filter(Boolean).join(' · ');

/* ── vans ────────────────────────────────────────────────────────────────── */
export type Vehicle = { vehicle_id: number; vehicle_no: string; branch_id: number; warehouse: string; driver_name: string | null; driver_user_id: number | null; salesperson_id: number | null; salesperson: string | null; route: string | null; capacity_kg: number | null; notes: string | null; status: string; items: number; stock_value: number };
export type VehicleForm = { vehicle_no: string; branch_id: string; driver_name: string; salesperson_id: string; route: string; capacity_kg: string; status: string };
export const emptyVehicle = (branchId?: number): VehicleForm => ({ vehicle_no: '', branch_id: branchId ? String(branchId) : '', driver_name: '', salesperson_id: '', route: '', capacity_kg: '', status: 'ACTIVE' });
export const vehicleForm = (v: Vehicle): VehicleForm => ({ vehicle_no: v.vehicle_no, branch_id: String(v.branch_id), driver_name: v.driver_name ?? '', salesperson_id: v.salesperson_id ? String(v.salesperson_id) : '', route: v.route ?? '', capacity_kg: v.capacity_kg == null ? '' : String(v.capacity_kg), status: v.status });
export const vehicleProblem = (f: VehicleForm): string => (f.vehicle_no.trim().length < 4 ? 'Enter the vehicle number, like TS09UB1234' : f.capacity_kg.trim() && !amount(f.capacity_kg) ? 'The capacity is a number of kilograms' : '');
export const vehicleBody = (f: VehicleForm, editing: boolean) => ({
  vehicle_no: f.vehicle_no.trim().toUpperCase(), branch_id: f.branch_id ? Number(f.branch_id) : undefined, driver_name: f.driver_name.trim() || null, salesperson_id: f.salesperson_id ? Number(f.salesperson_id) : null, route: f.route.trim() || null,
  capacity_kg: num(f.capacity_kg), ...(editing ? { status: f.status } : {})
});
export const vehicleSub = (v: Vehicle): string => [v.driver_name || '', v.salesperson || '', v.warehouse, v.items ? t('{n} items on board, worth {value}', { n: v.items, value: money(v.stock_value) }) : t('Empty'), v.status === 'INACTIVE' ? t('Inactive') : ''].filter(Boolean).join(' · ');

export const DIST_SETUP_TEXTS: string[] = [
  'Principals', 'The manufacturers you distribute, their agreements and brands', 'You do not have access to principals.', 'Active', 'All', 'Add a principal', 'Add the manufacturers or brands you distribute.', 'No supplier account is linked yet.', 'Brands',
  'Products are grouped under the brands each principal owns', 'New brand name', 'Add a brand', 'Brand added', 'Edit', 'Close', 'Save', 'Cancel', 'Principal or brand name', 'Company name', 'As on their invoices', 'Contact person', 'Phone', 'Email', 'GSTIN', 'PAN',
  'Territory they appointed you for', 'Address', 'Agreement starts', 'Like 2026-11-01', 'Agreement ends', 'Like 2027-10-31', 'Margin or commission (%)', 'What the agreement lets you earn', 'Payment terms (days)', 'Credit limit they give you', 'Notes',
  'Areas and routes', 'Where your shops are, and the routes your salespeople walk', 'You do not have access to areas and routes.', 'Areas', 'Beats', 'Region, then territory, then area. Shop counts include everything inside.', 'Add a region',
  'Start with a region, say Hyderabad, then add territories and areas inside it.', 'Add {what}', 'Rename', 'Delete', 'Delete {name}?', 'Only an empty one can be deleted. Otherwise mark it inactive.', 'Deleted', 'Name', 'Short code', 'Optional, for your own reference',
  "A beat is a salesperson's route on one day: the shops to visit, in order.", 'Every day', 'New beat', 'No beats yet.', 'Beat name', 'Monday, Ameerpet', 'Day of the week', 'Area it covers', 'Salesperson', 'No area',
  'The shops on a beat, and their order, are set on the web. A beat you edit here keeps its shops.',
  'Vans', 'The vans that carry stock to your shops', 'You do not have access to vans.', 'Add a van', 'Add the vans that carry stock to your shops.', 'Vehicle number', 'Loads from', 'Driver', 'Salesperson on this van', 'Nobody', 'Capacity (kg)', 'Route',
  'Ameerpet, SR Nagar, Kukatpally', 'TS09UB1234', 'Loading a van and counting it at the end of the day is done on the web.',
  'Give the principal a name', 'A GSTIN has 15 characters, like 36ABCDE1234F1Z5', 'A PAN is 10 characters like ABCDE1234F', 'That email does not look right', 'Dates are written like 2026-11-01', 'The agreement cannot end before it starts',
  'The margin is a percentage from 0 to 100', 'Payment terms are a whole number of days', 'The credit limit is an amount in rupees', 'Give the brand a name', 'Give the place a name', 'Give the beat a name',
  'Enter the vehicle number, like TS09UB1234', 'The capacity is a number of kilograms',
  'In force', 'Ends soon', 'Ended', 'Not started', 'No dates', '{n} brands', '{n} products', 'You owe {value}', 'Region', 'Territory', 'Area', '{n} shops', '{n} beats', 'Inactive', 'Unassigned',
  'Any day', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', '{n} items on board, worth {value}', 'Empty'
];
