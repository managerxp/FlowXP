/* Adding and editing a medicine: what the form holds, what is checked, and what is sent to /pharmacy/products. The server has the last word. */

export type MedicineFull = {
  product_id: number; name: string; sku: string | null; barcode: string | null; unit: string | null; category_id: number | null; category: string | null;
  hsn_sac: string | null; tax_rate: number; selling_price: number; purchase_price: number | null; mrp: number | null; reorder_level: number; status: string;
  manufacturer: string | null; strength: string | null; dosage_form: string | null; salt_composition: string | null; schedule_class: string | null;
  batch_tracking: boolean; expiry_tracking: boolean; prescription_required: boolean; track_inventory: boolean; on_hand?: number;
};

export type MedicineDraft = {
  name: string; strength: string; dosage_form: string; salt_composition: string; manufacturer: string; schedule_class: string;
  price: string; mrp: string; cost: string; gst: string; unit: string; barcode: string; hsn: string; category_id: string; reorder: string;
  prescription_required: boolean; batch_tracking: boolean; expiry_tracking: boolean;
};

export const GST = ['0', '5', '12', '18'];
export const FORMS = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Ointment', 'Drops', 'Powder', 'Other'];
export const SCHEDULES: { id: string; label: string }[] = [{ id: '', label: 'Not scheduled' }, { id: 'H', label: 'Schedule H' }, { id: 'H1', label: 'Schedule H1' }, { id: 'X', label: 'Schedule X' }];

/** A new medicine starts as most are: a tablet strip with expiry, 12% GST. */
export const blank = (): MedicineDraft => ({
  name: '', strength: '', dosage_form: 'Tablet', salt_composition: '', manufacturer: '', schedule_class: '', price: '', mrp: '', cost: '', gst: '12', unit: 'strip',
  barcode: '', hsn: '', category_id: '0', reorder: '', prescription_required: false, batch_tracking: true, expiry_tracking: true
});

const str = (v: number | string | null | undefined): string => (v == null ? '' : String(v));

export const fromMedicine = (m: MedicineFull): MedicineDraft => ({
  name: m.name, strength: str(m.strength), dosage_form: str(m.dosage_form), salt_composition: str(m.salt_composition), manufacturer: str(m.manufacturer), schedule_class: str(m.schedule_class),
  price: str(m.selling_price), mrp: str(m.mrp), cost: m.purchase_price ? str(m.purchase_price) : '', gst: str(m.tax_rate), unit: str(m.unit), barcode: str(m.barcode), hsn: str(m.hsn_sac),
  category_id: m.category_id ? String(m.category_id) : '0', reorder: m.reorder_level ? str(m.reorder_level) : '',
  prescription_required: m.prescription_required, batch_tracking: m.batch_tracking, expiry_tracking: m.expiry_tracking
});

/** Expiry belongs to a batch: switching expiry on switches batches on; switching batches off switches expiry off. */
export const withTracking = (d: MedicineDraft, patch: Partial<Pick<MedicineDraft, 'batch_tracking' | 'expiry_tracking'>>): MedicineDraft => {
  const next = { ...d, ...patch };
  if (patch.expiry_tracking) next.batch_tracking = true;
  if (patch.batch_tracking === false) next.expiry_tracking = false;
  return next;
};

/** A medicine with stock cannot stop being tracked by batch or by use-by date: the batches already on the shelf would lose their dates. */
export const trackingLocked = (m: Pick<MedicineFull, 'batch_tracking' | 'expiry_tracking' | 'on_hand'> | null): boolean =>
  Boolean(m && (m.batch_tracking || m.expiry_tracking) && (m.on_hand ?? 0) > 0);

export const medicineProblem = (d: MedicineDraft): string => {
  if (d.name.trim().length < 2) return 'Give the medicine a name';
  if (d.price.trim() === '' || !(Number(d.price) >= 0)) return 'Enter the selling price';
  if (d.mrp.trim() !== '' && !(Number(d.mrp) >= 0)) return 'Enter the MRP as a number';
  if (d.mrp.trim() !== '' && Number(d.price) > Number(d.mrp)) return 'The selling price cannot be more than the MRP';
  if (d.cost.trim() !== '' && !(Number(d.cost) >= 0)) return 'Enter the cost as a number';
  if (d.reorder.trim() !== '' && !(Number(d.reorder) >= 0)) return 'Enter the reorder level as a number';
  if (!d.unit.trim()) return 'Say how it is sold (strip, bottle, piece)';
  return '';
};

/** Everything is sent, so clearing a field clears it on the server. */
export const medicineBody = (d: MedicineDraft) => ({
  name: d.name.trim(), strength: d.strength.trim() || null, dosage_form: d.dosage_form.trim() || null, salt_composition: d.salt_composition.trim() || null,
  manufacturer: d.manufacturer.trim() || null, schedule_class: d.schedule_class || null,
  selling_price: Number(d.price), mrp: d.mrp.trim() === '' ? null : Number(d.mrp), purchase_price: d.cost.trim() === '' ? 0 : Number(d.cost), tax_rate: Number(d.gst),
  unit: d.unit.trim(), barcode: d.barcode.trim() || null, hsn_sac: d.hsn.trim() || null, category_id: d.category_id === '0' ? null : Number(d.category_id),
  reorder_level: d.reorder.trim() === '' ? 0 : Number(d.reorder),
  prescription_required: d.prescription_required || ['H', 'H1', 'X'].includes(d.schedule_class), batch_tracking: d.batch_tracking, expiry_tracking: d.expiry_tracking,
  product_type: 'MEDICINE', track_inventory: true
});

/** Only what changed, so a small edit does not overwrite what someone else changed on the website. */
export const changedBody = (before: MedicineDraft, after: MedicineDraft): Record<string, unknown> => {
  const was = medicineBody(before); const now = medicineBody(after);
  return Object.fromEntries(Object.entries(now).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((was as Record<string, unknown>)[k])));
};
