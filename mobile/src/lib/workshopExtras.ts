/* Workshop extras on the phone: mechanic mode (the owner's switch), the shop's list of labour services, what the workshop earned, telling the customer on WhatsApp,
   the usual Indian vehicles, the one-step rack set-up for a new shop, importing customers from a file, and "help me find". The server decides everything; these shape what a screen shows and sends. */
import { t } from './i18n.ts';
import { rupees } from './money.ts';

/* ── mechanic mode ──────────────────────────────────────────────────────── */
/** Mechanic mode is on unless the server says it is off (an older server that does not say yet leaves everything as it was). */
export const workshopOn = (b: { workshop_mode?: boolean } | null | undefined): boolean => b?.workshop_mode !== false;
export const canMechanicMode = (role: string | null | undefined): boolean => role === 'OWNER';

/* ── labour services ────────────────────────────────────────────────────── */
export type Service = { service_id: number; name: string; price_paise: number; tax_rate: number | null };
export const serviceLine = (s: Service): string => `${s.name} · ${rupees(s.price_paise)}`;
export const serviceSub = (s: Service): string => (s.tax_rate == null ? t('Shop GST rate') : t('GST {n}%', { n: s.tax_rate }));
export const serviceProblem = (name: string, price: string, tax: string): string => (!name.trim() ? 'Give the service a name'
  : !(price.trim() !== '' && Number.isFinite(Number(price)) && Number(price) >= 0) ? 'Enter the charge'
    : tax.trim() !== '' && !(Number.isFinite(Number(tax)) && Number(tax) >= 0 && Number(tax) <= 100) ? 'GST is a number from 0 to 100' : '');
export const serviceBody = (name: string, price: string, tax: string) => ({ name: name.trim(), price: Number(price), ...(tax.trim() !== '' ? { tax_rate: Number(tax) } : {}) });
/** One tap on a service puts it on the job card as labour. */
export const serviceLabourBody = (s: Service) => ({ kind: 'LABOUR', description: s.name, unit_price: s.price_paise / 100, ...(s.tax_rate != null ? { tax_rate: s.tax_rate } : {}) });

/* ── what the workshop earned ───────────────────────────────────────────── */
export type Earnings = {
  from: string; to: string;
  totals: { jobs: number; labour_paise: number; parts_paise: number; total_paise: number };
  days: { day: string; jobs: number; labour_paise: number; parts_paise: number; total_paise: number }[];
  mechanics: { name: string; jobs: number; labour_paise: number }[];
};
export const earningStats = (e: Earnings): [string, string][] => [[t('Jobs billed'), String(e.totals.jobs)], [t('Labour'), rupees(e.totals.labour_paise)], [t('Parts'), rupees(e.totals.parts_paise)], [t('Billed with GST'), rupees(e.totals.total_paise)]];
export const dayLine = (d: Earnings['days'][number]): string => `${t('{n} jobs', { n: d.jobs })} · ${t('Labour')} ${rupees(d.labour_paise)} · ${t('Parts')} ${rupees(d.parts_paise)}`;
export const mechanicLine = (m: Earnings['mechanics'][number]): string => `${t('{n} jobs', { n: m.jobs })} · ${t('Labour')} ${rupees(m.labour_paise)}`;
/** The first of the month the date is in, as YYYY-MM-DD. */
export const monthStart = (day: string): string => `${day.slice(0, 7)}-01`;

/* ── telling the customer on WhatsApp ───────────────────────────────────── */
export const SHARE_CHOICES: { id: string; label: string }[] = [
  { id: 'received', label: 'We have your vehicle' }, { id: 'estimate', label: 'Send the estimate' }, { id: 'ready', label: 'It is ready' }, { id: 'bill', label: 'Send the bill' }
];
/** Which messages make sense now: not an estimate with nothing on the card, not a bill before there is one. */
export const shareFor = (j: { status: string; lines: unknown[]; invoice_id: number | null; customer_phone: string | null }): { id: string; label: string }[] => {
  if (!j.customer_phone) return [];
  const live = ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS', 'READY'].includes(j.status);
  return SHARE_CHOICES.filter((c) => (c.id === 'bill' ? j.status === 'BILLED' && j.invoice_id != null : c.id === 'estimate' ? live && j.lines.length > 0 : live));
};

/* ── the usual Indian vehicles ──────────────────────────────────────────── */
export const DEFAULT_VEHICLE_TYPES: { id: string; label: string }[] = [{ id: 'BIKE', label: 'Bikes' }, { id: 'SCOOTER', label: 'Scooters' }, { id: 'CAR', label: 'Cars' }, { id: 'COMMERCIAL', label: 'Commercial vehicles' }];
export const addedLine = (r: { added_makes: number; added_models: number }): string => (r.added_makes + r.added_models === 0 ? t('Nothing was missing.') : t('Added {models} models from {makes} new makes.', { models: r.added_models, makes: r.added_makes }));

/* ── a new shop's racks in one step ─────────────────────────────────────── */
export type QuickRacks = { store: string; racks: string; bins: string };
export const quickRacksProblem = (f: QuickRacks): string => (!f.store.trim() ? 'Name your store or godown'
  : !(Number.isInteger(Number(f.racks)) && Number(f.racks) >= 1 && Number(f.racks) <= 40 && Number.isInteger(Number(f.bins)) && Number(f.bins) >= 1 && Number(f.bins) <= 26) ? 'Racks from 1 to 40 and bins from 1 to 26 in each rack, as whole numbers' : '');
export const storeCode = (store: string): string => store.trim().replace(/[^A-Za-z0-9]+/g, '').slice(0, 8).toUpperCase() || 'MAIN';
export const quickRacksSummary = (f: QuickRacks): string => t('This makes {racks} racks and {total} bins. The first bin will be called {code}.', { racks: Number(f.racks), total: Number(f.racks) * Number(f.bins), code: `${storeCode(f.store)}-R01-A` });

/* ── customers from a file ──────────────────────────────────────────────── */
/** A CSV into rows keyed by its first line. Quotes and commas inside quotes are handled; Excel files are not read on the phone. */
export const parseCsv = (text: string): Record<string, string>[] => {
  const grid: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) { if (ch === '"' && src[i + 1] === '"') { cell += '"'; i += 1; } else if (ch === '"') quoted = false; else cell += ch; } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i += 1; row.push(cell); cell = ''; if (row.some((c) => c.trim() !== '')) grid.push(row); row = []; } else cell += ch;
  }
  row.push(cell); if (row.some((c) => c.trim() !== '')) grid.push(row);
  if (grid.length < 2) return [];
  const head = grid[0].map((h) => h.trim());
  return grid.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
};
export const importFileProblem = (name: string, size: number | null): string => (!/\.csv$/i.test(name) ? 'Choose a CSV file. In Excel, use Save as, CSV.' : size != null && size > 5 * 1024 * 1024 ? 'That file is too large' : '');
export type CustomerCheck = { rows: number; to_create: number; already_here: number; total_errors: number; errors: { row: number; message: string }[]; applied: boolean; created: number };
export const checkLine = (c: CustomerCheck): string => (c.total_errors > 0 ? t('{n} rows have a problem. Fix them in the file and choose it again.', { n: c.total_errors })
  : c.applied ? t('{n} customers were added.', { n: c.created }) : t('{add} to add, {skip} already here.', { add: c.to_create, skip: c.already_here }));
export const errorLines = (c: CustomerCheck): string[] => c.errors.slice(0, 8).map((e) => `${t('Row {n}', { n: e.row })}: ${e.message}`);
export const canImport = (c: CustomerCheck | null): boolean => !!c && !c.applied && c.total_errors === 0 && c.to_create > 0;

/* ── help me find ───────────────────────────────────────────────────────── */
export type Need = 'any' | 'parts' | 'workshop' | 'owner';
export type Task = { text: string; go: string; words: string; need: Need };
export const TASKS: Task[] = [
  { text: 'Make a bill', go: '/(tabs)/sell', words: 'bill invoice sell checkout counter till', need: 'any' },
  { text: 'Find a part', go: '/parts', words: 'part find search number barcode price stock shelf', need: 'parts' },
  { text: 'Find parts that fit a vehicle', go: '/parts-vehicle', words: 'vehicle fit fitment make model bike car', need: 'parts' },
  { text: 'Open a job card for a vehicle', go: '/job-cards', words: 'job card servicing service vehicle bike car workshop mechanic', need: 'workshop' },
  { text: 'Labour and services I charge for', go: '/job-services', words: 'labour services charge oil change alignment price list', need: 'workshop' },
  { text: 'What the workshop earned', go: '/job-earnings', words: 'earned earnings workshop labour revenue report mechanic', need: 'workshop' },
  { text: 'Staff, attendance and payroll', go: '/workshop-staff', words: 'staff employee mechanic attendance salary payroll shift', need: 'workshop' },
  { text: 'Set up my racks and bins', go: '/parts-manage', words: 'rack racks bin bins shelf godown warehouse location setup layout', need: 'parts' },
  { text: 'Put received parts on a shelf', go: '/parts-warehouse', words: 'put away shelf bin rack received waiting move', need: 'parts' },
  { text: 'Receive parts from a supplier', go: '/parts-receive', words: 'receive delivery supplier purchase goods stock in', need: 'parts' },
  { text: 'Add the usual Indian bikes and cars', go: '/parts-manage', words: 'vehicle bikes cars list india makes models add default', need: 'parts' },
  { text: 'Add or import customers', go: '/customers-import', words: 'customer client party import add file csv tally vyapar excel', need: 'any' },
  { text: 'Who owes me money', go: '/customers', words: 'owe due credit udhaar pending balance collect', need: 'any' },
  { text: 'Check what is low in stock', go: '/stock', words: 'low stock reorder finished out count', need: 'any' },
  { text: 'Download or restore a backup', go: '/restore-backup', words: 'backup restore data safe', need: 'owner' },
  { text: 'Mechanic mode', go: '/mechanic-mode', words: 'mechanic mode servicing workshop switch', need: 'owner' }
];
/** Tasks this person can do, best match first. An empty search lists the first few. */
export const findTasks = (query: string, ctx: { parts: boolean; workshop: boolean; owner: boolean }, limit = 6): Task[] => {
  const ok = (k: Need) => k === 'any' || (k === 'parts' && ctx.parts) || (k === 'workshop' && ctx.parts && ctx.workshop) || (k === 'owner' && ctx.owner && ctx.parts);
  const avail = TASKS.filter((x) => ok(x.need));
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (!tokens.length) return avail.slice(0, limit);
  return avail
    .map((x) => { const hay = `${x.text} ${x.words}`.toLowerCase().split(/[^a-z0-9]+/); return [tokens.filter((k) => hay.some((w) => w.startsWith(k))).length, x] as const; })
    .filter(([hit]) => hit > 0).sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, x]) => x);
};

/** The floating help button shows everywhere except where a person is busy: sign in and sign up, the till, paying, the receipt, scanning and the help screen itself. */
const NO_HELP = ['/', '/index', '/login', '/signup', '/welcome', '/sell', '/pay', '/receipt', '/scan', '/options', '/help-find', '/forgot-password', '/delete-account'];
export const showHelpButton = (path: string): boolean => !NO_HELP.includes(path.replace(/\/+$/, '') || '/') && !path.startsWith('/receipt');

/** Every text the screens above show, so each one is looked up in the six languages. */
export const EXTRAS_TEXTS: string[] = [
  // mechanic mode
  'Mechanic mode', 'Turn this on if you also service bikes or cars. Turn it off if you only sell parts. You can change it any time, and nothing is deleted.', 'This shop also does servicing',
  'On: Job cards, labour and services, what the workshop earned, and staff, attendance and payroll appear in the menu.', 'Racks, parts, vehicles, receiving, trade accounts and reports stay either way.', 'Only the owner can change mechanic mode.',
  'Mechanic mode is on', 'Mechanic mode is off',
  // services
  'Labour and services', 'What you charge for work. On a job card each one is a single tap. Adding a name that is already here changes its charge.', 'Service', 'Charge', 'GST % (optional)', 'Blank: the shop\'s labour rate',
  'Add a service', 'No services yet. Add the work you do most, with its charge.', 'Shop GST rate', 'GST {n}%', 'Give the service a name', 'Enter the charge', 'GST is a number from 0 to 100',
  'Remove {name}?', 'Or type a charge', 'Remember this as a service, so next time it is one tap', 'Services', 'Tap a service to add it',
  // earnings
  'What we earned', 'Labour and parts on the bills made from job cards. These bills are also in your sales.', 'From', 'To', 'Jobs billed', 'Labour', 'Parts', 'Billed with GST', '{n} jobs', 'Day by day', 'By mechanic', 'Show',
  'No job card was billed in these dates.', 'Not assigned',
  // whatsapp
  'Tell the customer on WhatsApp', 'We have your vehicle', 'Send the estimate', 'It is ready', 'Send the bill', 'This customer has no mobile number.', 'WhatsApp opens with the message ready. You press send.',
  // vehicles
  'Add the usual Indian bikes and cars', 'Starts your list with the common makes and models sold in India. It adds only names. No part is marked as fitting any vehicle. Adding it again adds only what is missing.', 'Bikes', 'Scooters', 'Cars', 'Commercial vehicles', 'Add them', 'Nothing was missing.', 'Added {models} models from {makes} new makes.',
  // racks
  'Set up my racks in one step', 'Tell us how many racks and bins you have. We name them for you (R01, R02 ... and bins A, B, C ...). You can change it later.', 'Name of your store or godown', 'How many racks', 'Bins in each rack', 'A bin is one small place on a rack where a part sits.',
  'Create racks and bins', 'This makes {racks} racks and {total} bins. The first bin will be called {code}.', 'Name your store or godown', 'Racks from 1 to 40 and bins from 1 to 26 in each rack, as whole numbers', 'Today', 'This month', '{n} rows', 'Main store',
  // customers
  'Import customers', 'Bring your customers from Tally, Vyapar, Busy or Excel. Save the file as CSV first. People already here (same phone, or same name when there is no phone) are skipped. What a customer owes is worked out from their unpaid bills, so it is not imported.',
  'Choose the customer file', 'Check the file', 'Import the customers', 'Choose a CSV file. In Excel, use Save as, CSV.', 'That file is too large', 'That file has no rows. The first line must be the column names.',
  '{n} rows have a problem. Fix them in the file and choose it again.', '{n} customers were added.', '{add} to add, {skip} already here.', 'Row {n}',
  // signup
  'We also service bikes or cars (turns on job cards, labour and staff)',
  // help me find
  'Help me find', 'What do you want to do?', 'For example: add racks, job card, import', 'No screen found for that. Try another word.',
  'Make a bill', 'Find a part', 'Find parts that fit a vehicle', 'Open a job card for a vehicle', 'Labour and services I charge for', 'What the workshop earned', 'Staff, attendance and payroll', 'Set up my racks and bins',
  'Put received parts on a shelf', 'Receive parts from a supplier', 'Add or import customers', 'Who owes me money', 'Check what is low in stock', 'Download or restore a backup',
  // menu entries
  'Tell me where things are: say what you want to do', 'A CSV file of customers: names, phones, credit limits', 'What you charge for work: oil change, alignment', 'Labour and parts earned, by day and mechanic', 'Show job cards, labour and staff, or hide them for a parts-only shop'
];
