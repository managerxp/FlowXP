/*
 * Runs the app's own logic (api client, catalogue, cart, receipt) against a running FlowXP server, the way a phone would:
 * sign in, pick an outlet, download the catalogue, search, make a sale, send the SAME sale again with its key, read the receipt.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=cafe@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e
 *
 * It makes one real sale in that business, so point it at a demo or test business only.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { nodeDb } from '../test/helpers.ts';
import { addProduct, emptyCart, saleBody, totals } from '../src/lib/cart.ts';
import { receiptText, type Invoice } from '../src/lib/receipt.ts';
import { rupees } from '../src/lib/money.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const say = (m: string) => console.log(m);

const login = await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL, password: process.env.FLOWXP_PASSWORD }, { signIn: true });
if (!login.token) throw new Error('This account needs a second step (2FA or email code); use one that signs in with a password only.');
session.token = login.token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; name: string; upi_vpa: string | null; outlets: { branch_id: number; name: string }[] }[] };
const business = me.businesses[0]; const outlet = business.outlets[0];
session.businessId = business.business_id; session.branchId = outlet.branch_id;
say(`signed in: ${business.name} / ${outlet.name} `);

const db = nodeDb(); await db.exec(CATALOG_SCHEMA); const catalog = createCatalog(db);
const t0 = performance.now();
await catalog.sync(api);
say(`catalogue: ${await catalog.count()} products in ${Math.round(performance.now() - t0)} ms`);

const plain = (await catalog.search('', 500)).filter((p) => p.is_available && !p.modifier_group_ids.length && !p.track_inventory).slice(0, 2);
if (plain.length < 1) throw new Error('No product without options to sell in this business.');
say(`search "${plain[0].name.split(' ')[0]}": ${(await catalog.search(plain[0].name.split(' ')[0])).length} hits`);
let cart = emptyCart(); plain.forEach((p, i) => { cart = addProduct(cart, p, i + 1); });
const preview = totals(cart);
say(`cart preview: ${rupees(preview.totalPaise)} (${preview.itemCount} items)`);

const key = newKey();
const first = await api.post<{ invoice_id: number; invoice_number: string; total: number }>('/invoices', saleBody(cart, { method: 'CASH' }), { idempotencyKey: key });
const again = await api.post<{ invoice_id: number; invoice_number: string }>('/invoices', saleBody(cart, { method: 'CASH' }), { idempotencyKey: key });
if (again.invoice_id !== first.invoice_id) throw new Error('A retried sale made a second invoice!');
say(`sale ${first.invoice_number}: server total ${rupees(Math.round(first.total * 100))}; the retry returned the same invoice`);

const invoice = await api.get<Invoice>(`/invoices/${first.invoice_id}`);
say(`\n${receiptText(invoice, business.name)}\n`);
const drift = Math.abs(Math.round(first.total * 100) - preview.totalPaise);
say(`preview vs server: ${drift} paise apart${drift ? ' (offers or round-off)' : ''}`);
