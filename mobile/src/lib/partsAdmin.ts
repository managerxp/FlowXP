/* Spare parts admin on the phone: add a part, its details, its part numbers and the vehicles it fits, the makes and models list, and the racks and bins layout. Pure helpers, no screens. */
import { t } from './i18n.ts';
import { rupees, toPaise } from './money.ts';
import { FIT_LABEL, vehicleText, yearsText, type FitRow } from './parts.ts';

const amount = (s: string): boolean => s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) >= 0;
const whole = (s: string): boolean => /^\d+$/.test(s.trim());
const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));

export const canPartsAdmin = (can: (p: string) => boolean, ...keys: string[]): boolean => keys.some((k) => can(k));

export const CLASS_CHOICES: { id: string; label: string }[] = [{ id: 'OEM', label: 'OEM (genuine)' }, { id: 'AFTERMARKET', label: 'Aftermarket' }, { id: 'REFURBISHED', label: 'Refurbished' }, { id: 'USED', label: 'Used' }];
export const VEHICLE_TYPE_CHOICES: { id: string; label: string }[] = [{ id: 'CAR', label: 'Car' }, { id: 'BIKE', label: 'Bike' }, { id: 'SCOOTER', label: 'Scooter' }, { id: 'TRUCK', label: 'Truck' }, { id: 'BUS', label: 'Bus' }, { id: 'COMMERCIAL', label: 'Commercial' }, { id: 'OTHER', label: 'Other' }];
export const NUMBER_KIND_CHOICES: { id: string; label: string }[] = [{ id: 'OEM', label: 'OEM number' }, { id: 'MFR', label: 'Manufacturer number' }, { id: 'ALTERNATE', label: 'Alternate number' }, { id: 'SUPPLIER', label: 'Supplier code' }, { id: 'REPLACES', label: 'Replaces (old number)' }];
const label = (list: { id: string; label: string }[], id: string | null | undefined): string => t(list.find((x) => x.id === id)?.label ?? id ?? '');

/* ── add a part ──────────────────────────────────────────────────────────── */
export type NewPart = { name: string; sku: string; barcode: string; hsn_sac: string; oem_part_no: string; mfr_part_no: string; classification: string; vehicle_type: string; selling_price: string; purchase_price: string; mrp: string; tax_rate: string; reorder_level: string; opening_stock: string };
export const emptyPart = (): NewPart => ({ name: '', sku: '', barcode: '', hsn_sac: '', oem_part_no: '', mfr_part_no: '', classification: 'AFTERMARKET', vehicle_type: 'CAR', selling_price: '', purchase_price: '', mrp: '', tax_rate: '18', reorder_level: '', opening_stock: '' });
export const newPartProblem = (f: NewPart): string => {
  if (f.name.trim().length < 2) return 'Give the part a name';
  if (!amount(f.selling_price)) return 'Enter the selling price';
  if (f.purchase_price.trim() && !amount(f.purchase_price)) return 'The buying price is an amount in rupees';
  if (f.mrp.trim() && !amount(f.mrp)) return 'The MRP is an amount in rupees';
  if (f.mrp.trim() && Number(f.selling_price) > Number(f.mrp)) return 'The selling price cannot be above the MRP';
  if (!amount(f.tax_rate) || Number(f.tax_rate) > 100) return 'GST is a percentage from 0 to 100';
  if (f.reorder_level.trim() && !amount(f.reorder_level)) return 'The reorder level is a number';
  if (f.opening_stock.trim() && !amount(f.opening_stock)) return 'The opening stock is a number';
  return '';
};
/** Blank fields are left out so the server's own defaults apply (a code is made when the SKU is blank). */
export const newPartBody = (f: NewPart): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) if (v.trim() !== '') out[k] = v.trim();
  if (out.opening_stock !== undefined) { out.current_stock = Number(out.opening_stock); delete out.opening_stock; }
  for (const k of ['selling_price', 'purchase_price', 'mrp', 'tax_rate', 'reorder_level']) if (out[k] !== undefined) out[k] = Number(out[k]);
  return out;
};

/* ── a part's details ────────────────────────────────────────────────────── */
export type PartFull = {
  product_id: number; name: string; sku: string | null; has_profile: boolean; classification: string | null; vehicle_type: string | null; oem_part_no: string | null; mfr_part_no: string | null; subcategory: string | null; pack_qty: number | null;
  reorder_level: number | null; max_stock: number | null; wholesale_price: number | null; handling: string | null; selling_price_paise: number; mrp_paise: number | null; stock?: number;
  numbers: { pn_id: number; number: string; kind: string }[]; fitment: FitRow[];
};
export type ProfileForm = { classification: string; vehicle_type: string; oem_part_no: string; mfr_part_no: string; subcategory: string; pack_qty: string; reorder_level: string; max_stock: string; wholesale_price: string; handling: string };
const s = (v: unknown): string => (v == null ? '' : String(v));
export const profileForm = (p: PartFull): ProfileForm => ({
  classification: p.classification ?? 'AFTERMARKET', vehicle_type: p.vehicle_type ?? 'CAR', oem_part_no: s(p.oem_part_no), mfr_part_no: s(p.mfr_part_no), subcategory: s(p.subcategory), pack_qty: s(p.pack_qty),
  reorder_level: s(p.reorder_level), max_stock: s(p.max_stock), wholesale_price: s(p.wholesale_price), handling: s(p.handling)
});
export const profileProblem = (f: ProfileForm, mrp: number | null): string => {
  if (f.pack_qty.trim() && !(Number(f.pack_qty) > 0)) return 'A pack holds more than zero';
  if ((f.reorder_level.trim() && !amount(f.reorder_level)) || (f.max_stock.trim() && !amount(f.max_stock))) return 'Reorder level and most to keep are numbers';
  if (f.reorder_level.trim() && f.max_stock.trim() && Number(f.max_stock) < Number(f.reorder_level)) return 'The most to keep cannot be below the reorder level';
  if (f.wholesale_price.trim() && !amount(f.wholesale_price)) return 'The trade price is an amount in rupees';
  if (f.wholesale_price.trim() && mrp != null && Number(f.wholesale_price) > mrp) return 'The trade price cannot be above the MRP';
  return '';
};
export const profileBody = (f: ProfileForm) => ({
  classification: f.classification, vehicle_type: f.vehicle_type, oem_part_no: f.oem_part_no.trim(), mfr_part_no: f.mfr_part_no.trim(), subcategory: f.subcategory.trim(), ...(f.pack_qty.trim() ? { pack_qty: Number(f.pack_qty) } : {}),
  reorder_level: num(f.reorder_level), max_stock: num(f.max_stock), wholesale_price: num(f.wholesale_price), handling: f.handling.trim()
});
export const partLine = (p: { sku: string | null; oem_part_no: string | null; classification: string | null; selling_price_paise: number; stock?: number }): string => [
  p.sku || '', p.oem_part_no ? `OEM ${p.oem_part_no}` : '', p.classification ? label(CLASS_CHOICES, p.classification) : t('No part details'), rupees(p.selling_price_paise), p.stock != null ? t('{n} in stock', { n: Math.round(p.stock * 1000) / 1000 }) : ''
].filter(Boolean).join(' · ');

export const numberProblem = (n: string): string => (n.replace(/[^A-Za-z0-9]/g, '') ? '' : 'A part number has letters or digits in it');
export const numberLine = (n: { number: string; kind: string }): string => `${n.number} · ${label(NUMBER_KIND_CHOICES, n.kind)}`;

export const fitLine = (f: FitRow): string => `${vehicleText(f)} · ${yearsText(f) === 'any year' ? t('any year') : yearsText(f)} · ${t(FIT_LABEL[f.status] ?? f.status)}`;
export const fitProblem = (modelId: string, from: string, to: string): string => {
  if (!modelId) return 'Choose a model';
  for (const y of [from, to]) if (y.trim() && !(/^\d{4}$/.test(y.trim()) && Number(y) >= 1900 && Number(y) <= 2100)) return 'Years are four digits, like 2019';
  if (from.trim() && to.trim() && Number(to) < Number(from)) return 'The last year is before the first year';
  return '';
};
export const fitBody = (modelId: string, from: string, to: string) => ({ model_id: Number(modelId), year_from: from.trim() ? Number(from) : null, year_to: to.trim() ? Number(to) : null });

/* ── makes and models ────────────────────────────────────────────────────── */
export type VMake = { make_id: number; name: string; vehicle_type: string; models: { model_id: number; name: string; variants: unknown[]; parts: number }[] };
export const makeProblem = (name: string): string => (name.trim() ? '' : 'Give the make a name');
export const modelProblem = (makeId: string, name: string): string => (!makeId ? 'Choose the make' : name.trim() ? '' : 'Give the model a name');
export const makeLine = (m: VMake): string => `${label(VEHICLE_TYPE_CHOICES, m.vehicle_type)} · ${t('{n} models', { n: m.models.length })}`;
export const modelLine = (m: VMake['models'][number]): string => `${t('{n} variants', { n: m.variants.length })} · ${t('{n} parts on record', { n: m.parts })}`;

/* ── racks and bins ──────────────────────────────────────────────────────── */
export type Place = { location_id: number; parent_id: number | null; level: number; code: string; name: string | null; can_store: boolean; is_active: boolean; capacity_units: number | null; qty?: number };
export const sortPlaces = (list: Place[]): Place[] => [...list].sort((a, b) => a.code.localeCompare(b.code));
export type PlaceForm = { parent: string; bulk: boolean; segment: string; name: string; prefix: string; count: string; letters: boolean; can_store: boolean; capacity: string };
export const emptyPlace = (parent = '', level = 1): PlaceForm => ({ parent, bulk: false, segment: '', name: '', prefix: '', count: '4', letters: false, can_store: level >= 4, capacity: '' });
export const placeProblem = (f: PlaceForm): string => {
  if (f.bulk) {
    if (!whole(f.count) || Number(f.count) < 1 || Number(f.count) > 200) return 'How many is 1 to 200';
    if (f.letters && Number(f.count) > 26) return 'Letters run A to Z: up to 26 at a time';
  } else if (!/^[A-Za-z0-9._]+$/.test(f.segment.trim())) return 'A location name is letters, digits, dots and underscores, such as R12 or B07';
  if (f.capacity.trim() && !amount(f.capacity)) return 'The most it should hold is a number';
  return '';
};
export const placeBody = (f: PlaceForm) => {
  const base = { ...(f.parent ? { parent_id: Number(f.parent) } : {}), ...(f.can_store ? { loc_type: 'BIN' } : {}), can_store: f.can_store, ...(f.capacity.trim() ? { capacity_units: Number(f.capacity) } : {}) };
  return f.bulk ? { ...base, count: Number(f.count), prefix: f.prefix.trim(), letters: f.letters } : { ...base, segment: f.segment.trim(), ...(f.name.trim() ? { name: f.name.trim() } : {}) };
};
export const placeLine = (p: Place): string => [p.name && p.name !== p.code ? p.name : '', p.can_store ? t('Holds stock') : t('Groups other places'), p.can_store && p.qty != null ? t('{n} in stock', { n: p.qty }) : '', p.is_active ? '' : t('Switched off')].filter(Boolean).join(' · ');

export const PARTS_ADMIN_TEXTS: string[] = [
  'OEM (genuine)', 'Aftermarket', 'Refurbished', 'Used', 'Car', 'Bike', 'Scooter', 'Truck', 'Bus', 'Commercial', 'Other', 'OEM number', 'Manufacturer number', 'Alternate number', 'Supplier code', 'Replaces (old number)',
  'Give the part a name', 'Enter the selling price', 'The buying price is an amount in rupees', 'The MRP is an amount in rupees', 'The selling price cannot be above the MRP', 'GST is a percentage from 0 to 100', 'The reorder level is a number',
  'The opening stock is a number', 'A pack holds more than zero', 'Reorder level and most to keep are numbers', 'The most to keep cannot be below the reorder level', 'The trade price is an amount in rupees', 'The trade price cannot be above the MRP',
  'A part number has letters or digits in it', 'Choose a model', 'Years are four digits, like 2019', 'The last year is before the first year', 'Give the make a name', 'Choose the make', 'Give the model a name',
  'How many is 1 to 200', 'Letters run A to Z: up to 26 at a time', 'A location name is letters, digits, dots and underscores, such as R12 or B07', 'The most it should hold is a number',
  'No part details', '{n} in stock', '{n} models', '{n} variants', '{n} parts on record', 'Holds stock', 'Groups other places', 'Switched off', 'any year',
  'Manage parts', 'Add parts, their numbers and vehicles, the makes and models, and the racks', 'You do not have access to manage parts.', 'Parts', 'Vehicles', 'Racks', 'Name, code or part number', 'Add a part',
  'Front brake pad set, Swift 1.2', 'Item code', 'Left blank, one is made for you', 'Barcode', 'HSN code', 'OEM part number', 'Manufacturer part number', 'Type of part', 'For', 'Selling price', 'Buying price', 'MRP', 'GST (%)', 'Reorder level',
  'Opening stock', 'Counted into the outlet you are in', 'Save', 'Cancel', 'Part added', 'Part details', 'Subcategory', 'Pack holds', 'Most to keep', 'Trade price', 'Handling', 'Save details', 'Add the part details',
  'Part numbers', 'Every number this part is known by. Typing any of them, with or without dashes, finds the part.', 'No part numbers yet.', 'Add a number', 'Kind', 'Add', 'Remove', 'Removed', 'Number added',
  'Vehicles it fits', 'Only what is recorded here counts. A part with no record is never assumed to fit.', 'No vehicles recorded for this part.', 'Add a vehicle', 'Model', 'From year', 'To year', 'Add as not verified', 'Added as not verified',
  'Verify', 'Does not fit', 'Close', 'Makes and models', 'Add a make', 'Make', 'Maruti Suzuki', 'Add a model', 'Swift', 'New model', 'Make added', 'Model added', 'No vehicles yet. Add a make first.',
  'Racks and bins', 'Add a place', 'Inside', 'Top level', 'Add several at once', 'R01, R02, R03 ... or A, B, C ...', 'Starts with', 'How many', 'Use letters', 'Code', 'Short, like R12 or B07. The full code is built from the places above it.',
  'Name (optional)', 'Stock is kept here', 'Bins and shelves hold stock. Warehouses, zones, aisles and racks only group other places.', 'Most units it should hold (optional)', 'Switch off', 'Place added', 'Switched off',
  'No places yet.'
];
