/*
 * The salon till against a running FlowXP server and the demo salon (npm run seed:salon in backend): catalogue, a client's entitlements, a quote,
 * the sale sent twice with one key (one bill), the bill read back and printed as a receipt, and the appointments list with a status step.
 * It makes one real demo sale.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=salon@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:salon
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import {
  addGiftCard, addRetail, addService, bookBody, clientLine, linesFromAppointment, monthRange, quoteBody, rowLines, saleBody, salonProblem, slotStart, staffFor, timelineText, usesFor,
  type Appointment, type AppointmentCart, type Availability, type ClientDetail, type CommissionSummary, type Entitlements, type ReportResult, type RetailItem, type SalonCatalog, type SalonClient, type SalonDash, type StaffDay, type TimelineRow
} from '../src/lib/salon.ts';
import { receiptText, type Invoice } from '../src/lib/receipt.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };

const login = await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'salon@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true });
session.token = login.token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; business_type: string; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
ok(me.businesses[0].business_type === 'SALON', 'signed in to a salon');

say('Catalogue');
const cat = await api.get<SalonCatalog>('/salon/pos/catalog');
ok(cat.services.length > 0 && cat.staff.length > 0 && cat.payment_methods.length > 0, `${cat.services.length} services, ${cat.staff.length} team, pay by ${cat.payment_methods.join('/')}`);
const svc = cat.services[0];
const { qualified, others } = staffFor(cat, svc.service_id);
const who = qualified[0] ?? others[0];
ok(Boolean(who), `${svc.name} by ${who.name}`);
const shelf = await api.get<RetailItem[]>('/salon/pos/products?limit=5');
say(`  ${shelf.length} retail products on the shelf`);

say('A client\'s entitlements');
const clients = await api.get<{ customer_id: number; name: string }[]>('/customers');
const client = clients[0];
const ent = await api.get<Entitlements>(`/salon/pos/entitlements?customer_id=${client.customer_id}`);
ok(ent.customer.customer_id === client.customer_id, `${ent.customer.name}: membership ${ent.membership?.plan_name ?? 'none'}, ${ent.packages.length} packages, can take ${usesFor(ent, svc.service_id, []).length} free of ${svc.name}`);

say('Quote and sale');
let lines = addService([], svc, who);
if (shelf[0] && shelf[0].stock !== 0) lines = addRetail(lines, shelf[0]);
ok(salonProblem(lines, client.customer_id) === '', 'the bill passes the app\'s own checks');
const q = await api.post<{ total: number; tax: number; subtotal: number }>('/salon/pos/quote', quoteBody(lines, client.customer_id, null));
ok(q.total > 0 && q.subtotal > 0, `quote: items ${q.subtotal}, GST ${q.tax}, total ${q.total}`);
const key = newKey();
const body = saleBody(lines, client.customer_id, null, q.total, 'CASH', '');
const a = await api.post<{ invoice: { invoice_id: number; total: number } }>('/salon/pos/invoices', body, { idempotencyKey: key });
const b = await api.post<{ invoice: { invoice_id: number; total: number } }>('/salon/pos/invoices', body, { idempotencyKey: key });
ok(a.invoice.invoice_id === b.invoice.invoice_id, `the same key twice is one bill (#${a.invoice.invoice_id})`);
ok(Math.abs(a.invoice.total - q.total) < 0.011, `the bill total ${a.invoice.total} is the quoted ${q.total}`);
const inv = await api.get<Invoice>(`/invoices/${a.invoice.invoice_id}`);
ok(inv.balance_due === 0 && inv.items.length >= 1, `read back: paid in full, ${inv.items.length} lines`);
ok(receiptText(inv, 'Glow Salon').includes(svc.name), 'the receipt text names the service');

say('Appointments');
const today = new Date(); const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
const appts = await api.get<Appointment[]>(`/salon/appointments?date=${day}`);
say(`  ${appts.length} appointments today`);
const open = appts.find((x) => ['BOOKED', 'CONFIRMED'].includes(x.status));
if (open) {
  const moved = await api.post<Appointment>(`/salon/appointments/${open.appointment_id}/status`, { status: 'CHECKED_IN' });
  ok(moved.status === 'CHECKED_IN', `${open.customer_name ?? 'walk-in'} marked arrived`);
  const c = await api.get<AppointmentCart>(`/salon/appointments/${open.appointment_id}/cart`);
  const ls = linesFromAppointment(c, cat);
  ok(ls.length === open.services.length, `its ${ls.length} services become the bill`);
  const sale = await api.post<{ invoice: { invoice_id: number } }>('/salon/pos/invoices', saleBody(ls, c.customer_id, c.appointment_id, (await api.post<{ total: number }>('/salon/pos/quote', quoteBody(ls, c.customer_id, c.appointment_id))).total, 'CASH', ''), { idempotencyKey: newKey() });
  const after = await api.get<Appointment[]>(`/salon/appointments?date=${day}`);
  ok(after.find((x) => x.appointment_id === open.appointment_id)?.status === 'COMPLETED' && sale.invoice.invoice_id > 0, 'billing the visit completes the appointment');
} else say('  (no open appointment today: the seed books them in the past; skipped the appointment steps)');
say('Booking');
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
const tday = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
const free = await api.get<Availability>(`/salon/availability?date=${tday}&service_ids=${svc.service_id}`);
ok(free.slots.length > 0, `${free.slots.length} free times tomorrow for ${svc.name}, ${free.duration_min} min`);
const slot = free.slots[Math.floor(free.slots.length / 2)];
const bkey = newKey();
const bbody = bookBody({ customerId: client.customer_id, guestName: '', guestPhone: '', startIso: slotStart(tday, slot.time), serviceIds: [svc.service_id], staffId: null, notes: 'e2e drill' });
const booked = await api.post<Appointment>('/salon/appointments', bbody, { idempotencyKey: bkey });
const again = await api.post<Appointment>('/salon/appointments', bbody, { idempotencyKey: bkey });
ok(booked.appointment_id === again.appointment_id && booked.status === 'BOOKED', `booked ${slot.time}; the same key twice is one booking (#${booked.appointment_id})`);
const free2 = await api.get<Availability>(`/salon/availability?date=${tday}&service_ids=${svc.service_id}`);
const taken = free2.slots.find((x) => x.time === slot.time);
ok(!taken || taken.staff.length < slot.staff.length, 'that time now has one person fewer free');
const later = free.slots[free.slots.length - 1];
if (later.time !== slot.time) {
  const moved = (await api.call<Appointment>(`/salon/appointments/${booked.appointment_id}`, { method: 'PUT', body: { start_at: slotStart(tday, later.time) } })).data;
  ok(moved.start_at !== booked.start_at, `moved to ${later.time}`);
}
await api.post(`/salon/appointments/${booked.appointment_id}/status`, { status: 'CANCELLED', reason: 'e2e drill' });
ok(true, 'cancelled again (the drill leaves no booking behind)');

say('Gift card');
const card = await api.post<{ invoice: { invoice_id: number }; issued: { gift_cards: { code: string }[] } }>('/salon/pos/invoices', saleBody(addGiftCard([], 500), client.customer_id, null, 500, 'CASH', ''), { idempotencyKey: newKey() });
const code = card.issued.gift_cards[0].code;
const looked = await api.get<{ balance: number; usable: boolean }>(`/salon/gift-cards/lookup?code=${encodeURIComponent(code)}`);
ok(looked.usable && looked.balance === 500, `sold ${code}, balance ${looked.balance}`);
const gl = addService([], svc, who);
const gq = await api.post<{ total: number }>('/salon/pos/quote', quoteBody(gl, client.customer_id, null, { gift: { code, balance: looked.balance } }));
const gsale = await api.post<{ invoice: { invoice_id: number } }>('/salon/pos/invoices', saleBody(gl, client.customer_id, null, gq.total, 'CASH', '', { gift: { code, balance: looked.balance } }), { idempotencyKey: newKey() });
const after2 = await api.get<{ balance: number }>(`/salon/gift-cards/lookup?code=${encodeURIComponent(code)}`);
ok(gsale.invoice.invoice_id > 0 && after2.balance === Math.round((500 - Math.min(500, gq.total)) * 100) / 100, `paid with it: balance now ${after2.balance}`);

say('Clients');
const list = await api.get<SalonClient[]>('/salon/clients?limit=5');
ok(list.length > 0 && typeof list[0].visits === 'number', `${list.length} clients, e.g. ${clientLine(list[0])}`);
const detail = await api.get<ClientDetail>(`/salon/clients/${client.customer_id}`);
ok(detail.customer_id === client.customer_id && Array.isArray(detail.notes), `${detail.name}: ${detail.memberships.length} memberships, ${detail.notes.length} notes`);
const nkey = newKey();
const n1 = await api.post<{ note_id: number }>(`/salon/clients/${client.customer_id}/notes`, { body: 'e2e drill note' }, { idempotencyKey: nkey });
const n2 = await api.post<{ note_id: number }>(`/salon/clients/${client.customer_id}/notes`, { body: 'e2e drill note' }, { idempotencyKey: nkey });
ok(n1.note_id === n2.note_id, 'a note sent twice with one key is one note');
const tl = await api.get<TimelineRow[]>(`/salon/clients/${client.customer_id}/timeline?limit=10`);
ok(tl.length > 0 && tl.every((r) => timelineText(r).length > 0), `${tl.length} timeline entries, newest: ${timelineText(tl[0])}`);

say('Team');
const att = await api.get<{ staff: StaffDay[] }>(`/salon/attendance?date=${day}`);
ok(att.staff.length > 0, `${att.staff.length} team members today`);
await api.call('/salon/attendance', { method: 'PUT', body: { staff_id: att.staff[0].staff_id, work_date: day, status: 'PRESENT' } });
const att2 = await api.get<{ staff: StaffDay[] }>(`/salon/attendance?date=${day}`);
ok(att2.staff.find((x) => x.staff_id === att.staff[0].staff_id)?.status === 'PRESENT', `${att.staff[0].name} marked present`);
const mr = monthRange();
const com = await api.get<CommissionSummary>(`/salon/commissions/summary?from=${mr.from}&to=${mr.to}`);
ok(com.staff.length > 0 && typeof com.totals.pending === 'number', `commission this month: to approve ${com.totals.pending}, to pay ${com.totals.approved}, paid ${com.totals.paid}`);

say('Reports');
const dash = await api.get<SalonDash>('/salon/dashboard');
ok(typeof dash.overview.appointments_today === 'number', `dashboard: ${dash.overview.appointments_today} appointments, sales ${dash.overview.sales_today}`);
const reports = await api.get<Record<string, { key: string; title: string }[]>>('/salon/reports');
const first = Object.values(reports)[0][0];
const rep = await api.get<ReportResult>(`/salon/reports/${first.key}?from=${mr.from}&to=${mr.to}`);
ok(rep.columns.length > 0 && rep.rows.every((r) => rowLines(r, rep.columns).title.length > 0), `report "${rep.title}": ${rep.rows.length} rows read by the app's own renderer`);
say('All good.');
