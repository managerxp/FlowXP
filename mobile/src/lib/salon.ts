/* The salon till: what the server offers (services, team, packages, memberships), the bill being built, and what is sent. The server prices and checks everything; these only shape. */
import { rupees, toPaise } from './money.ts';

export type SalonService = { service_id: number; name: string; category_id: number | null; price: number; tax_rate: number; duration_min: number; gender: string };
export type SalonStaff = { staff_id: number; name: string; staff_role: string | null; service_ids: number[] };
export type SalonPackage = { package_id: number; name: string; price: number; validity_days: number; tax_rate: number; items: { service_id: number; name: string; quantity: number }[] };
export type SalonPlan = { plan_id: number; name: string; description: string | null; price: number; duration_days: number; tax_rate: number };
export type SalonCatalog = {
  categories: { category_id: number; name: string }[]; services: SalonService[]; staff: SalonStaff[]; packages: SalonPackage[]; membership_plans: SalonPlan[];
  payment_methods: string[]; tax: { inclusive: boolean; gst_enabled: boolean; round_off: boolean }; loyalty: { enabled: boolean };
};
export type RetailItem = { product_id: number; name: string; price: number; tax_rate: number; stock: number | null; brand: string | null };
export type Entitlements = {
  customer: { customer_id: number; name: string };
  membership: { membership_id: number; plan_name: string; expiry_date: string; discount_pct: number; free_services: { service_id: number; name: string; remaining: number }[] } | null;
  packages: { cp_id: number; name: string; expiry_date: string; items: { service_id: number; name: string; remaining: number }[] }[];
  gift_cards: { code: string; balance: number }[];
};
export type Appointment = {
  appointment_id: number; customer_id: number | null; customer_name: string | null; customer_phone: string | null; start_at: string; end_at: string;
  status: 'BOOKED' | 'CONFIRMED' | 'CHECKED_IN' | 'IN_SERVICE' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW'; notes: string | null; invoice_id: number | null;
  services: { line_id: number; service_id: number; name: string; staff_id: number; staff_name: string; duration_min: number; price: number }[]; total: number;
};
export type AppointmentCart = { appointment_id: number; customer_id: number | null; guest_name: string | null; items: { type: 'SERVICE'; service_id: number; staff_id: number; staff_name: string; name: string; price: number; quantity: number }[] };

export type Use = { kind: 'PACKAGE'; cp_id: number; label: string } | { kind: 'MEMBERSHIP'; label: string };
export type SalonLine =
  | { key: string; type: 'SERVICE'; service_id: number; name: string; staff_id: number; staff_name: string; price: number; use?: Use }
  | { key: string; type: 'PRODUCT'; product_id: number; name: string; price: number; quantity: number }
  | { key: string; type: 'PACKAGE'; package_id: number; name: string; price: number }
  | { key: string; type: 'MEMBERSHIP'; plan_id: number; name: string; price: number }
  | { key: string; type: 'GIFT_CARD'; name: string; price: number };

let counter = 0;
const nextKey = () => `l${++counter}`;

export const addService = (lines: SalonLine[], s: SalonService, staff: SalonStaff): SalonLine[] => [...lines, { key: nextKey(), type: 'SERVICE', service_id: s.service_id, name: s.name, staff_id: staff.staff_id, staff_name: staff.name, price: s.price }];
export const addRetail = (lines: SalonLine[], p: RetailItem): SalonLine[] => {
  const have = lines.find((l) => l.type === 'PRODUCT' && l.product_id === p.product_id);
  return have ? lines.map((l) => (l === have && l.type === 'PRODUCT' ? { ...l, quantity: l.quantity + 1 } : l)) : [...lines, { key: nextKey(), type: 'PRODUCT', product_id: p.product_id, name: p.name, price: p.price, quantity: 1 }];
};
export const addPackage = (lines: SalonLine[], p: SalonPackage): SalonLine[] => [...lines, { key: nextKey(), type: 'PACKAGE', package_id: p.package_id, name: p.name, price: p.price }];
export const addPlan = (lines: SalonLine[], p: SalonPlan): SalonLine[] => (lines.some((l) => l.type === 'MEMBERSHIP' && l.plan_id === p.plan_id) ? lines : [...lines, { key: nextKey(), type: 'MEMBERSHIP', plan_id: p.plan_id, name: p.name, price: p.price }]);
export const removeLine = (lines: SalonLine[], key: string): SalonLine[] => lines.filter((l) => l.key !== key);
export const setUse = (lines: SalonLine[], key: string, use: Use | undefined): SalonLine[] => lines.map((l) => (l.key === key && l.type === 'SERVICE' ? { ...l, use } : l));
export const setRetailQty = (lines: SalonLine[], key: string, quantity: number): SalonLine[] => (quantity <= 0 ? removeLine(lines, key) : lines.map((l) => (l.key === key && l.type === 'PRODUCT' ? { ...l, quantity } : l)));

/** Team members who do this service first, then the rest (anyone on the team can be put on a line; the server checks they work here). */
export const staffFor = (catalog: SalonCatalog, serviceId: number): { qualified: SalonStaff[]; others: SalonStaff[] } => ({
  qualified: catalog.staff.filter((s) => s.service_ids.includes(serviceId)),
  others: catalog.staff.filter((s) => !s.service_ids.includes(serviceId))
});

/** What this client can still take free on a service: a package visit, or a membership's free service. */
export const usesFor = (e: Entitlements | null, serviceId: number, lines: SalonLine[]): Use[] => {
  if (!e) return [];
  const taken = (u: (l: SalonLine) => boolean) => lines.filter((l) => l.type === 'SERVICE' && l.service_id === serviceId && l.use && u(l)).length;
  const out: Use[] = [];
  for (const p of e.packages) {
    const left = p.items.find((i) => i.service_id === serviceId)?.remaining ?? 0;
    if (left - taken((l) => l.type === 'SERVICE' && l.use?.kind === 'PACKAGE' && l.use.cp_id === p.cp_id) > 0) out.push({ kind: 'PACKAGE', cp_id: p.cp_id, label: p.name });
  }
  const free = e.membership?.free_services.find((f) => f.service_id === serviceId)?.remaining ?? 0;
  if (e.membership && free - taken((l) => l.type === 'SERVICE' && l.use?.kind === 'MEMBERSHIP') > 0) out.push({ kind: 'MEMBERSHIP', label: e.membership.plan_name });
  return out;
};

/** About what the bill comes to before discounts and GST rules (the quote is exact). */
export const roughPaise = (lines: SalonLine[]): number =>
  lines.reduce((a, l) => a + (l.type === 'SERVICE' ? (l.use ? 0 : toPaise(l.price)) : l.type === 'PRODUCT' ? toPaise(l.price) * l.quantity : toPaise(l.price)), 0);

/** The items the server's quote and sale take. */
export const itemsBody = (lines: SalonLine[]) => lines.map((l) => {
  if (l.type === 'SERVICE') return { type: 'SERVICE', service_id: l.service_id, staff_id: l.staff_id, quantity: 1, ...(l.use ? { use: l.use.kind === 'PACKAGE' ? { kind: 'PACKAGE', cp_id: l.use.cp_id } : { kind: 'MEMBERSHIP' } } : {}) };
  if (l.type === 'PRODUCT') return { type: 'PRODUCT', product_id: l.product_id, quantity: l.quantity };
  if (l.type === 'PACKAGE') return { type: 'PACKAGE', package_id: l.package_id };
  if (l.type === 'GIFT_CARD') return { type: 'GIFT_CARD', amount: l.price };
  return { type: 'MEMBERSHIP', plan_id: l.plan_id };
});

/** Things a person can add to the bill: an offer code, loyalty points to spend, and a gift card to pay with. */
export type Extras = { offerCode?: string; redeemPoints?: number; gift?: { code: string; balance: number } };

export const quoteBody = (lines: SalonLine[], customerId: number | null, appointmentId: number | null, extras: Extras = {}) => ({
  items: itemsBody(lines), ...(customerId ? { customer_id: customerId } : {}), ...(appointmentId ? { appointment_id: appointmentId } : {}),
  ...(extras.offerCode?.trim() ? { offer_code: extras.offerCode.trim() } : {}), ...(extras.redeemPoints && extras.redeemPoints > 0 ? { redeem_points: extras.redeemPoints } : {})
});

/** How a bill is paid when a gift card covers part of it: the card takes what it has (up to the total), the chosen method takes the rest. */
/** `payNowPaise`: none = the whole bill; 0 = nothing now (the bill is left unpaid, the client's credit); else that much now and the rest is owed. A gift card and part payment do not mix: with a card the bill is paid in full. */
export const paymentsFor = (total: number, method: string, reference: string, gift?: { code: string; balance: number }, payNowPaise?: number | null) => {
  if (payNowPaise === 0) return [];
  if (payNowPaise && !gift) return [{ method, amount: payNowPaise / 100, ...(reference.trim() ? { reference_number: reference.trim() } : {}) }];
  const fromCard = gift ? Math.min(Math.round(gift.balance * 100), Math.round(total * 100)) / 100 : 0;
  const rest = Math.round((total - fromCard) * 100) / 100;
  return [
    ...(gift && fromCard > 0 ? [{ method: 'GIFT_CARD', amount: fromCard, code: gift.code }] : []),
    ...(rest > 0 ? [{ method, amount: rest, ...(reference.trim() ? { reference_number: reference.trim() } : {}) }] : [])
  ];
};

/** The sale: the same body plus the payment of the whole bill (the quote's total, in rupees). */
export const saleBody = (lines: SalonLine[], customerId: number | null, appointmentId: number | null, total: number, method: string, reference: string, extras: Extras = {}, payNowPaise?: number | null) => ({
  ...quoteBody(lines, customerId, appointmentId, extras),
  payments: paymentsFor(total, method, reference, extras.gift, payNowPaise)
});

/** A gift card sold at the till: its value goes to the client on the bill (or to nobody yet), and is paid for like anything else. */
export const addGiftCard = (lines: SalonLine[], amount: number): SalonLine[] => [...lines, { key: nextKey(), type: 'GIFT_CARD', name: `Gift card ${amount}`, price: amount }];

/** What stops a bill going to the server, said before the trip. A package or membership needs a client; a service needs a team member. */
export const salonProblem = (lines: SalonLine[], customerId: number | null): string => {
  if (!lines.length) return 'Add at least one item to the bill';
  if (!customerId && lines.some((l) => l.type === 'PACKAGE' || l.type === 'MEMBERSHIP' || (l.type === 'SERVICE' && l.use))) return 'Choose the client first: a package or membership belongs to a client';
  return '';
};

/** A booking as the cart for the till (the client and the services with who is doing them). */
export const linesFromAppointment = (c: AppointmentCart, catalog: SalonCatalog): SalonLine[] =>
  c.items.map((i) => ({ key: nextKey(), type: 'SERVICE' as const, service_id: i.service_id, name: i.name, staff_id: i.staff_id, staff_name: i.staff_name, price: catalog.services.find((s) => s.service_id === i.service_id)?.price ?? i.price }));

export const APPOINTMENT_LABEL: Record<Appointment['status'], string> = { BOOKED: 'Booked', CONFIRMED: 'Confirmed', CHECKED_IN: 'Arrived', IN_SERVICE: 'In service', COMPLETED: 'Done', CANCELLED: 'Cancelled', NO_SHOW: 'Did not come' };
/** The next step a front desk takes, and what else is allowed. */
export const NEXT: Partial<Record<Appointment['status'], { to: Appointment['status']; label: string }>> = {
  BOOKED: { to: 'CHECKED_IN', label: 'They arrived' }, CONFIRMED: { to: 'CHECKED_IN', label: 'They arrived' }, CHECKED_IN: { to: 'IN_SERVICE', label: 'Start the service' }
};
export const canBill = (a: Appointment): boolean => ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'].includes(a.status);
export const canCancel = (a: Appointment): boolean => ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'].includes(a.status);
export const canNoShow = (a: Appointment, now: Date = new Date()): boolean => ['BOOKED', 'CONFIRMED'].includes(a.status) && new Date(a.start_at).getTime() <= now.getTime();

/* ── booking ── */

export type Slot = { time: string; staff: { staff_id: number; name: string }[] };
export type Availability = { date: string; duration_min: number; slots: Slot[] };

const dayText = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** The next days a booking can be made, as 2026-10-09 with a label a person reads: Today, Tomorrow, then Fri 11 Oct. */
export const dayChoices = (now: Date = new Date(), count = 7): { id: string; label: string }[] =>
  Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    return { id: dayText(d), label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) };
  });

/** A day and a slot ("2026-10-09", "14:30") as the moment it starts, in this phone's own time (the salon's, in practice). */
export const slotStart = (date: string, time: string): string => {
  const [y, m, d] = date.split('-').map(Number); const [h, min] = time.split(':').map(Number);
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString();
};

export const totalMinutes = (catalog: SalonCatalog, serviceIds: number[]): number => serviceIds.reduce((a, id) => a + (catalog.services.find((s) => s.service_id === id)?.duration_min ?? 0), 0);

/** What a booking sends: the client (known, or a name and phone), when, the services (all with one team member when one is chosen) and a note. */
export const bookBody = (a: { customerId: number | null; guestName: string; guestPhone: string; startIso: string; serviceIds: number[]; staffId: number | null; notes: string }) => ({
  ...(a.customerId ? { customer_id: a.customerId } : { guest_name: a.guestName.trim(), ...(a.guestPhone.trim() ? { guest_phone: a.guestPhone.trim() } : {}) }),
  start_at: a.startIso, source: 'PHONE',
  services: a.serviceIds.map((id) => ({ service_id: id, ...(a.staffId ? { staff_id: a.staffId } : {}) })),
  ...(a.notes.trim() ? { notes: a.notes.trim() } : {})
});

export const bookProblem = (customerId: number | null, guestName: string, serviceIds: number[], time: string | null): string => {
  if (!customerId && !guestName.trim()) return 'Choose the client, or type a name';
  if (!serviceIds.length) return 'Choose at least one service';
  if (!time) return 'Choose a time';
  return '';
};

/* ── clients, team, money ── */

export type SalonClient = {
  customer_id: number; name: string; phone: string | null; visits: number; last_visit: string | null; total_spent?: number; outstanding?: number; points: number; membership: string | null; labels: string[]; allergies: string | null;
};
export type ClientDetail = SalonClient & {
  email: string | null; favorite_staff_name: string | null; preferences: string | null;
  memberships: { membership_id: number; plan_name: string; expiry_date: string; active: boolean }[];
  packages: { cp_id: number; name: string; expiry_date: string; active: boolean; items: { name: string; remaining: number; total: number }[] | null }[];
  gift_cards: { code: string; balance: number; status: string; expires_on: string | null }[];
  loyalty: { available: number; tier: string | null; expiring_soon: number } | null;
  notes: { note_id: number; body: string; created_at: string; author: string | null }[];
};
export type TimelineRow = { at: string; type: 'appointment' | 'invoice' | 'payment' | 'points' | 'membership' | 'package' | 'note'; summary: string | null; detail: string | null; amount: number | null };
export type Segment = { key: string; label: string; count: number };
export type Attendance = 'PRESENT' | 'ABSENT' | 'LEAVE' | 'HALF_DAY';
export type StaffDay = { staff_id: number; name: string; staff_role: string | null; status: Attendance | null };
export type CommissionRow = { staff_id: number; name: string; lines: number; revenue: number; pending: number; approved: number; paid: number; total: number };
export type CommissionSummary = { from: string; to: string; staff: CommissionRow[]; totals: { pending: number; approved: number; paid: number } };

export const ATTENDANCE_LABEL: Record<Attendance, string> = { PRESENT: 'Present', ABSENT: 'Absent', LEAVE: 'On leave', HALF_DAY: 'Half day' };

/** "Visits 12 · last 3 Oct" style line for a client row. */
export const clientLine = (c: SalonClient): string => [c.phone, `${c.visits} visit${c.visits === 1 ? '' : 's'}`, c.last_visit ? `last ${String(c.last_visit).slice(0, 10)}` : null].filter(Boolean).join(' · ');

/** What a timeline entry says in a few words. */
export const timelineText = (r: TimelineRow): string => {
  switch (r.type) {
    case 'appointment': return `Appointment${r.detail ? ` (${r.detail.toLowerCase().replace('_', ' ')})` : ''}: ${r.summary ?? ''}`;
    case 'invoice': return `Bill ${r.summary ?? ''}`;
    case 'payment': return `Payment${r.detail ? ` by ${r.detail.toLowerCase().replace('_', ' ')}` : ''}`;
    case 'points': return `Points ${r.detail ? r.detail.toLowerCase() : ''}${r.summary ? `: ${r.summary}` : ''}`.trim();
    case 'membership': return `Membership ${r.summary ?? ''}`;
    case 'package': return `Package ${r.summary ?? ''}`;
    default: return `Note: ${r.summary ?? ''}`;
  }
};

/** Who is on commission, the first and last day of this month as the server wants them. */
export const monthRange = (now: Date = new Date()): { from: string; to: string } => {
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: f(new Date(now.getFullYear(), now.getMonth(), 1)), to: f(now) };
};

export type SalonDash = {
  overview: { sales_today: number | null; collections_today: number | null; invoices_today: number; appointments_today: number; appointments_completed: number; appointments_upcoming: number; appointments_no_show: number; new_customers: number; returning_customers: number; outstanding: number | null; outstanding_bills: number; low_stock: number; active_staff: number; staff_total: number };
  revenue?: { weekly: number; monthly: number; month_by_type: { services: number; products: number; packages: number; memberships: number } };
};
export type ReportColumn = { key: string; label: string; type: 'text' | 'number' | 'money' | 'date' };
export type ReportResult = { key: string; title: string; from: string; to: string; columns: ReportColumn[]; rows: Record<string, unknown>[]; totals?: Record<string, number>; note?: string };

/** A report cell as text: money in rupees, numbers as they are, empty as a dash. */
export const cellText = (value: unknown, type: ReportColumn['type']): string => {
  if (value == null || value === '') return '-';
  if (type === 'money') return rupees(toPaise(Number(value)));
  return String(value);
};

/** One report row as a title (its first column) and "Label: value" lines for the rest. */
export const rowLines = (r: Record<string, unknown>, columns: ReportColumn[]): { title: string; lines: string[] } => ({
  title: cellText(r[columns[0]?.key], columns[0]?.type ?? 'text'),
  lines: columns.slice(1).map((c) => `${c.label}: ${cellText(r[c.key], c.type)}`)
});

/** Who is free at a slot. */
export const freeAt = (slots: Slot[], time: string | null): { staff_id: number; name: string }[] => slots.find((s) => s.time === time)?.staff ?? [];
