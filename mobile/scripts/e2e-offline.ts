/*
 * The offline drill, against a running FlowXP server (the app's own code, Node's SQLite standing in for the phone's):
 *   sign in -> download the catalogue -> SWITCH THE NETWORK OFF -> sell three times -> SWITCH IT ON -> the outbox sends them ->
 *   each reached the server exactly once, in order, dated today -> sending again changes nothing -> a delta sync finds nothing new.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=cafe@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:offline
 *
 * It makes three real sales in that business, so point it at a demo or test business only.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { SCHEMA as OUTBOX_SCHEMA, createOutbox } from '../src/lib/outbox.ts';
import { addProduct, emptyCart } from '../src/lib/cart.ts';
import { sendEntry, takeSale } from '../src/lib/till.ts';
import { pendingReceiptText, type Invoice } from '../src/lib/receipt.ts';
import { nodeDb } from '../test/helpers.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
let offline = false;
const flaky = (async (u: string, i: RequestInit) => { if (offline) throw new TypeError('Network request failed'); return fetch(u, i); }) as typeof fetch;
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; }, fetchImpl: flaky });
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };

const login = await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL, password: process.env.FLOWXP_PASSWORD }, { signIn: true });
session.token = login.token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; name: string; outlets: { branch_id: number }[] }[] };
const business = me.businesses[0];
session.businessId = business.business_id; session.branchId = business.outlets[0].branch_id;

const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(OUTBOX_SCHEMA);
const catalog = createCatalog(db); const outbox = createOutbox(db);

say('online: download');
const first = await catalog.sync(api);
ok(first.mode === 'full' && (await catalog.count()) > 0, `catalogue downloaded (${await catalog.count()} products)`);
const plain = (await catalog.search('', 200)).filter((p) => p.is_available && !p.modifier_group_ids.length && !p.track_inventory).slice(0, 3);
ok(plain.length === 3, 'three products that need no options');

say('NETWORK OFF: three sales');
offline = true;
const keys: string[] = [];
for (const [i, p] of plain.entries()) {
  const key = newKey(); keys.push(key);
  const taken = await takeSale({ api, outbox, cart: addProduct(emptyCart(), p, i + 1), method: i === 1 ? 'UPI' : 'CASH', key });
  ok(taken.kind === 'queued', `sale ${i + 1} (${p.name} x ${i + 1}) kept on the phone`);
}
ok((await outbox.counts()).pending === 3, 'three waiting');
const queued = (await outbox.list()).reverse();
say(pendingReceiptText(queued[0], business.name).split('\n').map((l) => `    | ${l}`).join('\n'));
ok((await outbox.flush(sendEntry(api))).stopped === 'offline', 'sending while offline stops and loses nothing');
ok((await outbox.counts()).pending === 3, 'still three waiting');

say('NETWORK ON');
offline = false;
const flushed = await outbox.flush(sendEntry(api));
ok(flushed.sent === 3 && flushed.failed === 0 && flushed.stopped === null, 'all three sent');
const sent = (await outbox.list()).reverse();
ok(new Set(sent.map((e) => e.invoice_id)).size === 3, 'three different invoices');
ok(sent.every((e, i) => i === 0 || e.invoice_id! > sent[i - 1].invoice_id!), 'made in the order they were taken');
const today = new Date().toISOString().slice(0, 10);
for (const e of sent) {
  const inv = await api.get<Invoice>(`/invoices/${e.invoice_id}`);
  ok(String(inv.invoice_date).slice(0, 10) === today || String(inv.invoice_date).slice(0, 10) === new Date(Date.now() - 86400000).toISOString().slice(0, 10), `${e.local_no} is now ${inv.invoice_number}, ${inv.payments[0]?.method} ${inv.total}`);
}
// the same sale sent again (as after a lost reply): the same invoice, not a new one
const again = await api.post<{ invoice_id: number }>('/invoices', sent[0].body, { idempotencyKey: keys[0], headers: { 'X-Offline-Sale': '1' } });
ok(again.invoice_id === sent[0].invoice_id, 'a repeat of sale 1 returns the same invoice');
ok((await outbox.flush(sendEntry(api))).sent === 0, 'nothing left to send');
const delta = await catalog.sync(api);
ok(delta.mode === 'changes', `catalogue catches up by changes (${(delta as { applied: number }).applied} applied), no second full download`);
say('\nALL GOOD');
