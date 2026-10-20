/* Workshop job cards on the phone: a vehicle in for service, its spare parts (held for the customer) and labour, and one bill. The server decides stock, fitment, prices and tax;
   these only shape what a screen shows and sends. */
import { t } from './i18n.ts';
import { rupees } from './money.ts';
import { FIT_LABEL, vehicleText } from './parts.ts';

export const canJobCards = (can: (p: string) => boolean): boolean => can('billing');

export const JOB_STATUS_LABEL: Record<string, string> = { OPEN: 'Waiting', IN_PROGRESS: 'Being worked on', WAITING_PARTS: 'Waiting for parts', READY: 'Ready', BILLED: 'Billed', CANCELLED: 'Cancelled' };
export const LIVE_STATUSES = ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS', 'READY'];
export const isLive = (status: string): boolean => LIVE_STATUSES.includes(status);

export type JobRow = {
  job_id: number; job_no: string; status: string; customer_id: number | null; customer_name: string | null; customer_phone: string | null; vehicle_reg: string; vehicle_type: string; make: string | null; model: string | null;
  mechanic_name: string | null; promised_on: string | null; total_paise: number; parts: number;
};
export type JobLine = { line_id: number; kind: 'PART' | 'LABOUR'; product_id: number | null; description: string; sku: string | null; quantity: number; unit_price_paise: number; tax_rate: number; held: boolean; fitment: string | null; amount_paise: number };
export type JobFull = JobRow & {
  model_id: number | null; vehicle_year: number | null; odometer_km: number | null; complaint: string | null; mechanic_id: number | null; next_service_on: string | null; invoice_id: number | null; earlier_visits: number;
  lines: JobLine[]; estimate: { parts_paise: number; labour_paise: number; tax_paise: number; total_paise: number };
};

export const vehicleOf = (j: Pick<JobRow, 'vehicle_reg' | 'make' | 'model'>): string => [j.vehicle_reg, [j.make, j.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ');
export const jobSub = (j: JobRow): string => [t(JOB_STATUS_LABEL[j.status] ?? j.status), j.customer_name || '', j.mechanic_name || '', rupees(j.total_paise)].filter(Boolean).join(' · ');

/* ── a new card ──────────────────────────────────────────────────────────── */
export type NewJobForm = { customer_id: number | null; customer_name: string; vehicle_reg: string; vehicle_type: string; model_id: string; odometer_km: string; complaint: string; mechanic_id: string; promised_on: string };
export const emptyJob = (): NewJobForm => ({ customer_id: null, customer_name: '', vehicle_reg: '', vehicle_type: 'CAR', model_id: '', odometer_km: '', complaint: '', mechanic_id: '', promised_on: '' });
const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const newJobProblem = (f: NewJobForm): string => {
  if (!f.customer_id) return 'Choose the customer first';
  if (!/^[A-Za-z0-9][A-Za-z0-9 -]{2,19}$/.test(f.vehicle_reg.trim())) return 'A registration number is letters and digits, like KA01AB1234';
  if (f.odometer_km.trim() && !/^\d+$/.test(f.odometer_km.trim())) return 'The odometer is a whole number of kilometres';
  if (f.promised_on.trim() && !isDate(f.promised_on.trim())) return 'Dates are written like 2026-11-01';
  return '';
};
export const newJobBody = (f: NewJobForm) => ({
  customer_id: f.customer_id, vehicle_reg: f.vehicle_reg.trim().toUpperCase(), vehicle_type: f.vehicle_type, ...(f.model_id ? { model_id: Number(f.model_id) } : {}), ...(f.odometer_km.trim() ? { odometer_km: Number(f.odometer_km) } : {}),
  ...(f.complaint.trim() ? { complaint: f.complaint.trim() } : {}), ...(f.mechanic_id ? { mechanic_id: Number(f.mechanic_id) } : {}), ...(f.promised_on.trim() ? { promised_on: f.promised_on.trim() } : {})
});
export const customerProblem = (name: string, phone: string): string => (name.trim().length < 2 ? 'Give the customer a name' : phone.trim() && !/^[\d +-]{7,15}$/.test(phone.trim()) ? 'That phone number does not look right' : '');

/* ── the lines ───────────────────────────────────────────────────────────── */
export const labourProblem = (description: string, price: string): string => (!description.trim() ? 'Say what was done' : !(price.trim() !== '' && Number.isFinite(Number(price)) && Number(price) >= 0) ? 'Enter the labour charge' : '');
export const labourBody = (description: string, price: string) => ({ kind: 'LABOUR', description: description.trim(), unit_price: Number(price) });
export const quantityProblem = (q: string): string => (Number.isFinite(Number(q)) && Number(q) > 0 ? '' : 'Quantity is a number above zero');
export const lineText = (l: JobLine): string => (l.quantity === 1 ? `${l.description} · ${rupees(l.amount_paise)}` : `${l.description} · ${l.quantity} × ${rupees(l.unit_price_paise)} = ${rupees(l.amount_paise)}`);
export const lineSub = (l: JobLine): string => (l.kind === 'LABOUR' ? t('Labour') : [l.sku || '', l.held ? t('Held for this customer') : t('Not held'), l.fitment && l.fitment !== 'NO_VEHICLE' ? t(FIT_LABEL[l.fitment] ?? l.fitment) : ''].filter(Boolean).join(' · '));
/** A part marked as not fitting this vehicle: shown as a warning, never hidden. */
export const misfits = (lines: JobLine[]): string[] => lines.filter((l) => l.fitment === 'NOT_FIT').map((l) => l.description);
export const estimateLines = (e: JobFull['estimate']): [string, string][] => [[t('Parts'), rupees(e.parts_paise)], [t('Labour'), rupees(e.labour_paise)], [t('GST'), rupees(e.tax_paise)], [t('Estimate'), rupees(e.total_paise)]];

/* ── moving a card along ─────────────────────────────────────────────────── */
export const NEXT_STEPS: { status: string; label: string }[] = [{ status: 'IN_PROGRESS', label: 'Start work' }, { status: 'WAITING_PARTS', label: 'Waiting for parts' }, { status: 'READY', label: 'Mark ready' }];
export const stepsFor = (status: string) => NEXT_STEPS.filter((s) => s.status !== status);
export const canBill = (j: Pick<JobFull, 'status' | 'lines'>): boolean => isLive(j.status) && j.lines.length > 0;
export const PAY_METHODS: { id: string; label: string }[] = [{ id: 'CASH', label: 'Cash' }, { id: 'UPI', label: 'UPI' }, { id: 'CARD', label: 'Card' }, { id: 'BANK_TRANSFER', label: 'Bank transfer' }, { id: 'CREDIT', label: 'Pay later' }];
export const billProblem = (method: string, amount: string): string => (method !== 'CREDIT' && amount.trim() !== '' && !(Number.isFinite(Number(amount)) && Number(amount) > 0) ? 'The amount paid is above zero' : '');
/** Blank amount = the whole bill; "Pay later" sends no payment, so the bill is credit. */
export const billBody = (method: string, amount: string) => (method === 'CREDIT' ? {} : { payment: { amount: amount.trim() === '' ? 'FULL' : Number(amount), method } });

export const dueLine = (d: { vehicle_reg: string; make: string | null; model: string | null; next_service_on: string; overdue: boolean; customer_name: string | null }): string =>
  `${[d.vehicle_reg, vehicleText({ make: d.make ?? '', model: d.model ?? '', variant: null }).trim()].filter(Boolean).join(' · ')} · ${d.customer_name ?? ''} · ${d.overdue ? t('overdue since {date}', { date: d.next_service_on }) : t('due {date}', { date: d.next_service_on })}`;

export const JOB_TEXTS: string[] = [
  'Waiting', 'Being worked on', 'Waiting for parts', 'Ready', 'Billed', 'Cancelled', 'Choose the customer first', 'A registration number is letters and digits, like KA01AB1234', 'The odometer is a whole number of kilometres', 'Dates are written like 2026-11-01',
  'Give the customer a name', 'That phone number does not look right', 'Say what was done', 'Enter the labour charge', 'Quantity is a number above zero', 'Labour', 'Held for this customer', 'Not held', 'Parts', 'GST', 'Estimate',
  'Start work', 'Waiting for parts', 'Mark ready', 'Cash', 'UPI', 'Card', 'Bank transfer', 'Pay later', 'The amount paid is above zero', 'overdue since {date}', 'due {date}',
  'KA01AB1234', 'Job cards', 'Vehicles in for service: the parts fitted, the labour and one bill', 'You do not have access to job cards.', 'In the workshop', 'Billed', 'All', 'Job number, registration or customer', 'New job card', 'No job cards here.', 'Open a card when a vehicle comes in.',
  'Customer', 'Customer name or phone', 'New customer', 'Name', 'Phone', 'Add the customer', 'Change', 'Registration number', 'Vehicle', 'Car', 'Bike', 'Scooter', 'Truck', 'Bus', 'Commercial', 'Other', 'Make and model', 'Not in the list',
  'Odometer (km)', 'What is wrong, or what to do', 'Brake noise, full service', 'Mechanic', 'Not assigned', 'Promised for', 'Open the card', 'Cancel', 'Back',
  'Job card', 'earlier visits', 'Services due', 'No service is due in the next 30 days.', 'Vehicles whose last job said when the next service is due. Call them.',
  'Warning: this part is recorded as not fitting the vehicle', 'Nothing on the card yet.', 'Remove {name}?', 'Remove', 'Quantity', 'Save', 'Add a part', 'Add a part: name, code or part number', '{n} in stock',
  'Not enough in stock', 'Add it to the card anyway, without holding it?', 'Add anyway', 'Add labour', 'What was done', 'Charge', 'Add', 'Cancel this job?', 'Every part held for it goes back on the shelf.', 'Cancel the job',
  'Customer pays', 'Amount', 'Blank: the whole bill', 'Make the bill', 'Open the bill', 'Bill made'
];
