/* Pharmacy product master on the phone: add and change medicines and other shelf items, their rules (batch, expiry, prescription) and prices. Pure helpers, no screens. */
import { t } from './i18n.ts';
import { rupees, toPaise } from './money.ts';

const amount = (s: string): boolean => s.trim() !== '' && Number.isFinite(Number(s)) && Number(s) >= 0;
const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));

export const canMedicineAdmin = (can: (p: string) => boolean): boolean => can('products');

export const TYPE_CHOICES: { id: string; label: string }[] = [
  { id: 'MEDICINE', label: 'Medicine' }, { id: 'DEVICE', label: 'Device' }, { id: 'CONSUMABLE', label: 'Consumable' }, { id: 'SURGICAL', label: 'Surgical' }, { id: 'WELLNESS', label: 'Wellness' },
  { id: 'PERSONAL_CARE', label: 'Personal care' }, { id: 'BABY_CARE', label: 'Baby care' }, { id: 'ORTHOPEDIC', label: 'Orthopedic' }, { id: 'DIAGNOSTIC', label: 'Diagnostic' }, { id: 'OTHER', label: 'Other' }
];

export type Item = {
  product_id: number; name: string; sku: string | null; barcode: string | null; unit: string; status: string; description: string | null; category_id: number | null; category: string | null; hsn_sac: string | null; tax_rate: number;
  purchase_price: number; selling_price: number; reorder_level: number; track_inventory: boolean; product_type: string; manufacturer: string | null; mrp: number | null; batch_tracking: boolean; expiry_tracking: boolean; serial_tracking: boolean;
  prescription_required: boolean; fefo_required: boolean; warranty_applicable: boolean; warranty_months: number | null; service_trackable: boolean; schedule_class: string | null; salt_composition: string | null; strength: string | null; dosage_form: string | null;
  on_hand?: number; available?: number; low?: boolean;
};
export type ItemForm = {
  name: string; sku: string; barcode: string; unit: string; category_id: string; description: string; hsn_sac: string; tax_rate: string; purchase_price: string; selling_price: string; reorder_level: string; status: string; track_inventory: boolean;
  product_type: string; manufacturer: string; mrp: string; batch_tracking: boolean; expiry_tracking: boolean; serial_tracking: boolean; prescription_required: boolean; fefo_required: boolean; warranty_applicable: boolean; warranty_months: string;
  service_trackable: boolean; schedule_class: string; salt_composition: string; strength: string; dosage_form: string;
};
export const emptyItem = (): ItemForm => ({
  name: '', sku: '', barcode: '', unit: 'pcs', category_id: '', description: '', hsn_sac: '', tax_rate: '12', purchase_price: '', selling_price: '', reorder_level: '', status: 'ACTIVE', track_inventory: true,
  product_type: 'MEDICINE', manufacturer: '', mrp: '', batch_tracking: true, expiry_tracking: true, serial_tracking: false, prescription_required: false, fefo_required: true, warranty_applicable: false, warranty_months: '',
  service_trackable: false, schedule_class: '', salt_composition: '', strength: '', dosage_form: ''
});
const s = (v: unknown): string => (v == null ? '' : String(v));
export const itemForm = (p: Item): ItemForm => ({
  name: p.name, sku: s(p.sku), barcode: s(p.barcode), unit: p.unit || 'pcs', category_id: s(p.category_id), description: s(p.description), hsn_sac: s(p.hsn_sac), tax_rate: s(p.tax_rate), purchase_price: s(p.purchase_price), selling_price: s(p.selling_price),
  reorder_level: s(p.reorder_level), status: p.status, track_inventory: p.track_inventory, product_type: p.product_type || 'OTHER', manufacturer: s(p.manufacturer), mrp: s(p.mrp), batch_tracking: p.batch_tracking, expiry_tracking: p.expiry_tracking,
  serial_tracking: p.serial_tracking, prescription_required: p.prescription_required, fefo_required: p.fefo_required, warranty_applicable: p.warranty_applicable, warranty_months: s(p.warranty_months), service_trackable: p.service_trackable,
  schedule_class: s(p.schedule_class), salt_composition: s(p.salt_composition), strength: s(p.strength), dosage_form: s(p.dosage_form)
});
export const itemProblem = (f: ItemForm): string => {
  if (f.name.trim().length < 2) return 'Give the item a name';
  if (!f.unit.trim()) return 'Say what it is sold by, like strip or bottle';
  if (!amount(f.tax_rate) || Number(f.tax_rate) > 100) return 'GST is a percentage from 0 to 100';
  if (!amount(f.selling_price)) return 'Enter the selling price';
  if (f.purchase_price.trim() && !amount(f.purchase_price)) return 'The buying price is an amount in rupees';
  if (f.mrp.trim() && !amount(f.mrp)) return 'The MRP is an amount in rupees';
  if (f.reorder_level.trim() && !amount(f.reorder_level)) return 'The reorder level is a number';
  if (f.warranty_applicable && (!/^\d+$/.test(f.warranty_months.trim()) || Number(f.warranty_months) < 1 || Number(f.warranty_months) > 600)) return 'The warranty is 1 to 600 months';
  return '';
};
export const itemBody = (f: ItemForm) => ({
  name: f.name.trim(), sku: f.sku.trim() || null, barcode: f.barcode.trim() || null, unit: f.unit.trim(), category_id: f.category_id ? Number(f.category_id) : null, description: f.description.trim() || null, hsn_sac: f.hsn_sac.trim() || null,
  tax_rate: Number(f.tax_rate) || 0, purchase_price: num(f.purchase_price) ?? 0, selling_price: num(f.selling_price) ?? 0, reorder_level: num(f.reorder_level) ?? 0, status: f.status, track_inventory: f.track_inventory,
  product_type: f.product_type, manufacturer: f.manufacturer.trim() || null, mrp: num(f.mrp), batch_tracking: f.batch_tracking, expiry_tracking: f.expiry_tracking, serial_tracking: f.serial_tracking, prescription_required: f.prescription_required,
  fefo_required: f.fefo_required, warranty_applicable: f.warranty_applicable, warranty_months: f.warranty_applicable ? num(f.warranty_months) : null, service_trackable: f.service_trackable,
  schedule_class: f.schedule_class.trim() || null, salt_composition: f.salt_composition.trim() || null, strength: f.strength.trim() || null, dosage_form: f.dosage_form.trim() || null
});
/** Switching expiry on needs batches too; the server does the same, so the screen shows it. */
export const withExpiry = (f: ItemForm, on: boolean): ItemForm => ({ ...f, expiry_tracking: on, batch_tracking: on || f.batch_tracking });
export const categoryProblem = (name: string): string => (name.trim().length < 2 ? 'Give the category a name' : '');

export const itemSub = (p: Item): string => [
  [p.strength, p.manufacturer].filter(Boolean).join(' '), rupees(toPaise(p.selling_price)), p.track_inventory && p.available != null ? t('{n} in stock', { n: p.available }) : '',
  p.low ? t('Running low') : '', p.prescription_required ? t('Prescription needed') : '', p.status === 'ARCHIVED' ? t('Archived') : ''
].filter(Boolean).join(' · ');

export const MEDICINE_ADMIN_TEXTS: string[] = [
  'Medicine', 'Device', 'Consumable', 'Surgical', 'Wellness', 'Personal care', 'Baby care', 'Orthopedic', 'Diagnostic', 'Other',
  'Give the item a name', 'Say what it is sold by, like strip or bottle', 'GST is a percentage from 0 to 100', 'Enter the selling price', 'The buying price is an amount in rupees', 'The MRP is an amount in rupees',
  'The reorder level is a number', 'The warranty is 1 to 600 months', 'Give the category a name', '{n} in stock', 'Running low', 'Prescription needed', 'Archived',
  'Medicines and items', 'Add, change and price what you stock', 'You do not have access to medicines and items.', 'Name or composition', 'All types', 'Low stock', 'Active', 'All', 'Add an item', 'Nothing here',
  'Add what you stock and sell.', 'Nothing matches that search.', 'Basics', 'Name', 'Item code', 'Barcode', 'Sold by', 'Strip, bottle, piece', 'Category', 'None', 'New category', 'Add a category', 'HSN code', 'GST (%)', 'Description',
  'Medicine details', 'Type', 'Maker', 'Strength', '500mg, 10ml', 'Form', 'Tablet, syrup, injection', 'Schedule', 'H, H1, X', 'Salt composition',
  'Rules', 'Tracked by batch', 'Stock is received and sold against batch numbers', 'Tracked by expiry', 'Every batch needs an expiry date', 'Soonest expiry goes first', 'Selling picks the soonest-expiring batch automatically',
  'Tracked by serial number', 'One serial number per unit (devices, equipment)', 'Prescription required', 'Carries a warranty', 'Warranty (months)', 'Service history tracked',
  'Price and stock', 'MRP', 'Selling price', 'Buying price', 'Reorder level', 'Keep stock count for this item', 'Archived items are hidden from the till', 'Save', 'Cancel', 'Added', 'Category added'
];
