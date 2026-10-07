/*
 * The café counter drill, against a running FlowXP server with the demo café (npm run seed:cafe in backend):
 * sync the catalogue and option groups -> build a latte with chosen options -> offers preview -> sell it to the kitchen (a token comes back)
 * -> read the invoice back to see the options and the price -> network off, sell another (billed only, no ticket) -> network on, it is sent.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=cafe@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:cafe
 *
 * It makes two real sales in that business, so point it at a demo or test business only.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { SCHEMA as CATALOG_SCHEMA, createCatalog } from '../src/lib/catalog.ts';
import { SCHEMA as OUTBOX_SCHEMA, createOutbox } from '../src/lib/outbox.ts';
import { addProduct, emptyCart, lineName, totals } from '../src/lib/cart.ts';
import { initialChoice, missing, picked, toggle } from '../src/lib/options.ts';
import { previewOffers } from '../src/lib/offers.ts';
import { sendEntry, takeSale } from '../src/lib/till.ts';
import { receiptText, type Invoice } from '../src/lib/receipt.ts';
import { rupees } from '../src/lib/money.ts';
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
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; name: string; business_type: string; outlets: { branch_id: number }[] }[] };
const business = me.businesses[0];
session.businessId = business.business_id; session.branchId = business.outlets[0].branch_id;
ok(business.business_type === 'CAFE', `${business.name} is a café`);

const db = nodeDb(); await db.exec(CATALOG_SCHEMA); await db.exec(OUTBOX_SCHEMA);
const catalog = createCatalog(db); const outbox = createOutbox(db);
await catalog.sync(api);
const latte = (await catalog.search('latte')).find((p) => p.modifier_group_ids.length);
if (!latte) throw new Error('No latte with options in this business');
const groups = await catalog.groupsFor(latte);
ok(groups.length >= 3, `${latte.name} offers ${groups.map((g) => g.name).join(', ')} (read from the phone's copy)`);

let chosen = initialChoice(groups);
ok(!missing(groups, chosen), 'required choices start filled in');
const size = groups.find((g) => /size/i.test(g.name))!; const milk = groups.find((g) => /milk/i.test(g.name))!; const extras = groups.find((g) => !g.is_variant)!;
chosen = toggle(size, chosen, size.modifiers.find((m) => /large/i.test(m.name))!.modifier_id);
chosen = toggle(milk, chosen, milk.modifiers.find((m) => /oat/i.test(m.name))!.modifier_id);
chosen = toggle(extras, chosen, extras.modifiers.find((m) => /shot/i.test(m.name))!.modifier_id);
const options = picked(groups, chosen);
let cart = addProduct(emptyCart(), latte, 1, options);
const preview = totals(cart);
say(`  ..  ${lineName(cart.lines[0])}: preview ${rupees(preview.totalPaise)}`);

// two bakes, for the "any 2 bakes" offer
const bakes = (await catalog.search('', 200)).filter((p) => p.category_name === 'Bakes' && !p.modifier_group_ids.length).slice(0, 2);
for (const b of bakes) cart = addProduct(cart, b);
const offers = await previewOffers(api, cart);
say(`  ..  offers: ${offers.savingPaise ? `-${rupees(offers.savingPaise)} (${offers.names.join(', ')})` : 'none running now'}`);
const shown = totals(cart, offers.byKey);

say('online: sell to the kitchen');
const taken = await takeSale({ api, outbox, cart, method: 'CASH', key: newKey(), kitchen: true });
ok(taken.kind === 'billed' && taken.token, `billed, token ${taken.kind === 'billed' ? taken.token : ''}`);
if (taken.kind !== 'billed') throw new Error('not billed');
const inv = await api.get<Invoice>(`/invoices/${taken.invoiceId}`);
say(receiptText(inv, business.name).split('\n').map((l) => `    | ${l}`).join('\n'));
ok(inv.order_number === taken.token, 'the receipt carries the token');
const lat = inv.items.find((i) => /latte/i.test(i.description))!;
ok(/Oat/.test(JSON.stringify(inv.items)), 'the chosen options are on the invoice line');
ok(Math.round(lat.unit_price * 100) === latte.selling_price * 100 + options.deltaPaise, `latte billed at ${rupees(Math.round(lat.unit_price * 100))} = base + options`);
const drift = Math.abs(Math.round(inv.total * 100) - shown.totalPaise);
ok(drift <= 100, `the preview with offers (${rupees(shown.totalPaise)}) is within a rupee of the server's total (${rupees(Math.round(inv.total * 100))})`);

say('NETWORK OFF: another latte');
offline = true;
const second = await takeSale({ api, outbox, cart: addProduct(emptyCart(), latte, 1, options), method: 'UPI', key: newKey(), kitchen: true });
ok(second.kind === 'queued', 'kept on the phone');
offline = false;
const flushed = await outbox.flush(sendEntry(api));
ok(flushed.sent === 1, 'sent when the signal is back');
const sent = (await outbox.list())[0];
const inv2 = await api.get<Invoice>(`/invoices/${sent.invoice_id}`);
ok(!inv2.order_number, 'billed only: no kitchen ticket for a sale taken offline');
say('\nALL GOOD');
