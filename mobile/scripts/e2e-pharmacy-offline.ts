/*
 * The pharmacy offline drill, against a running FlowXP server and the demo pharmacy (the app's own code, Node's SQLite standing in for the phone):
 *   download the medicines (with their details) -> NETWORK OFF -> find medicines on the phone -> sell, including more than the shelf holds ->
 *   NETWORK ON -> the outbox sends to the PHARMACY till -> each sale reached the server exactly once, dated the day it was taken, the oversell
 *   is flagged on the bill for review, a prescription medicine only sells after the check -> sending again changes nothing.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=pharmacy@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:pharmacy:offline
 *
 * It makes real sales in the demo pharmacy.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { SCHEMA as OUTBOX_SCHEMA, createOutbox } from '../src/lib/outbox.ts';
import { sendEntry } from '../src/lib/till.ts';
import { addMedicine, estimate, fromProduct, pharmacyProblem, previewOf, saleBody, rxNote } from '../src/lib/pharmacy.ts';
import { nodeDb } from '../test/helpers.ts';
import type { Invoice } from '../src/lib/receipt.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
let offline = false;
const flaky = (async (u: string, i: RequestInit) => { if (offline) throw new TypeError('Network request failed'); return fetch(u, i); }) as typeof fetch;
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; }, fetchImpl: flaky });
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };
const day = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

const login = await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'pharmacy@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true });
session.token = login.token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; business_type: string; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
ok(me.businesses[0].business_type === 'PHARMACY', 'signed in to a pharmacy');

const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(OUTBOX_SCHEMA);
const catalog = createCatalog(db); const outbox = createOutbox(db);

say('online: download the medicines');
await catalog.sync(api);
const all = await catalog.search('', 300);
const withDetails = all.filter((p) => p.pharmacy);
const rxMed = withDetails.find((p) => p.pharmacy!.prescription_required && (p.current_stock ?? 0) > 2);
const plainMed = withDetails.find((p) => !p.pharmacy!.prescription_required && p.track_inventory && (p.current_stock ?? 0) > 5);
ok(all.length > 0 && withDetails.length === all.length, `${all.length} medicines on the phone, every one with its details`);
ok(rxMed && plainMed, `a prescription medicine (${rxMed?.name}) and a plain one (${plainMed?.name})`);
const saltWord = (rxMed!.pharmacy!.salt_composition || rxMed!.name).split(/\s+/)[0];

say('NETWORK OFF');
offline = true;
ok((await catalog.search(saltWord, 10)).length > 0, `found by "${saltWord}" with no signal`);
const rxLines = addMedicine([], fromProduct(rxMed!), 1);
ok(pharmacyProblem(rxLines, false) !== '' && pharmacyProblem(rxLines, true) === '', 'the prescription check is asked for offline');
const shelf = plainMed!.current_stock ?? 0;
const sold = Math.floor(shelf) + 3;   // more than the phone thinks is on the shelf
const lines = addMedicine([], fromProduct(plainMed!), sold);
const key1 = newKey();
const body1 = saleBody(lines, null, 'CASH', '', '', { expectedTotal: estimate(lines).totalPaise / 100 });
const e1 = (await outbox.add({ id: key1, body: body1, preview: previewOf(lines, 'CASH'), path: '/pharmacy/pos/invoices' }))!;
const key2 = newKey();
const body2 = saleBody(rxLines, null, 'CASH', '', rxNote(rxLines, 'Dr Rao', 'Meena'), { rxChecked: true, expectedTotal: estimate(rxLines).totalPaise / 100 });
await outbox.add({ id: key2, body: body2, preview: previewOf(rxLines, 'CASH'), path: '/pharmacy/pos/invoices' });
ok((await outbox.counts()).pending === 2, `two sales kept on the phone (${e1.local_no}), one of ${sold} where the shelf holds ${shelf}`);
ok((await outbox.flush(sendEntry(api))).stopped === 'offline', 'sending while offline stops and loses nothing');

say('NETWORK ON');
offline = false;
const flushed = await outbox.flush(sendEntry(api));
ok(flushed.sent === 2 && flushed.failed === 0, 'both sent to the pharmacy till');
const sent = await outbox.get(key1);
ok(sent!.state === 'sent' && sent!.invoice_id, `sale 1 became ${sent!.invoice_number}`);
ok(/Check: .*more sold/.test(sent!.error || ''), `the server flagged it for review: "${sent!.error}"`);
const inv = await api.get<Invoice & { notes?: string; invoice_date: string }>(`/invoices/${sent!.invoice_id}`);
ok(String(inv.invoice_date).slice(0, 10) === day && /Taken offline/.test(inv.notes || ''), 'dated today and marked "Taken offline" on the bill itself');
const again = await outbox.flush(sendEntry(api));
ok(again.sent === 0, 'sending again changes nothing');
const direct = await api.post<{ invoice: { invoice_id: number } }>('/pharmacy/pos/invoices', body1, { idempotencyKey: key1, headers: { 'X-Offline-Sale': '1', 'X-Sale-Date': day } });
ok(direct.invoice.invoice_id === sent!.invoice_id, 'a replay with the same key returns the same bill');

say('A prescription medicine without the check is refused by the server');
let refused = '';
try { await api.post('/pharmacy/pos/invoices', saleBody(rxLines, null, 'CASH', '', ''), { idempotencyKey: newKey() }); } catch (e) { refused = (e as Error).message; }
ok(/prescription/i.test(refused), `refused: "${refused}"`);

say('A delta sync after the sales brings the phone up to date');
const after = await catalog.sync(api);
ok(after.mode === 'changes', `the phone catches up with ${after.mode === 'changes' ? after.applied : 0} changes (stock hints)`);
say('All good.');
