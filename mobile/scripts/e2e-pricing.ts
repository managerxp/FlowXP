/*
 * Price lists against a running FlowXP server and the demo wholesaler, with the app's own code, as the owner: make a list, add a fixed price and a
 * percentage, give the list to a shop, see that shop's price change (and another shop's not), switch the list off, remove a price.
 *
 *   FLOWXP_URL=http://localhost:5100 FLOWXP_EMAIL=wholesale@flowxp.test FLOWXP_PASSWORD=demo1234 npm run e2e:pricing
 *
 * It makes a real price list (named with the time): use a demo business.
 */
import { createApi, newKey, type Session } from '../src/lib/api.ts';
import { listSummary, newListBody, ruleBody, ruleProblem, ruleText, type PriceList, type PriceRule, type RuleDraft } from '../src/lib/pricing.ts';
import type { WProduct } from '../src/lib/wholesale.ts';

const url = process.env.FLOWXP_URL || 'http://localhost:5100';
const session: Session = { token: null, businessId: null, branchId: null };
const api = createApi({ baseUrl: url, getSession: () => session, onToken: (t) => { session.token = t; } });
const say = (m: string) => console.log(m);
const ok = (cond: unknown, m: string) => { if (!cond) throw new Error(`FAILED: ${m}`); say(`  ok  ${m}`); };
session.token = (await api.post<{ token: string }>('/auth/login', { email: process.env.FLOWXP_EMAIL || 'wholesale@flowxp.test', password: process.env.FLOWXP_PASSWORD || 'demo1234' }, { signIn: true })).token;
const me = await api.refreshSession() as unknown as { businesses: { business_id: number; outlets: { branch_id: number }[] }[] };
session.businessId = me.businesses[0].business_id; session.branchId = me.businesses[0].outlets[0].branch_id;
const money = (n: number) => `₹${n}`;
const put = (path: string, body: unknown) => api.call(path, { method: 'PUT', body });
const priceFor = async (customerId: number, productId: number, quantity = 1) => (await api.post<{ price: number; source: string }[]>('/wholesale/pricing/quote', { customer_id: customerId, lines: [{ product_id: productId, quantity }] }))[0];

say('Make a list');
const name = `Drill ${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;
const list = await api.post<PriceList>('/wholesale/price-lists', newListBody(name, 'STANDARD'), { idempotencyKey: newKey() });
ok(list.list_id && list.name === name, `"${list.name}" is made: ${listSummary({ ...list, items: 0, customers: 0 })}`);

say('Add prices');
const products = await api.get<WProduct[]>('/wholesale/products/lookup?q=a');
const p = products.find((x) => x.wholesale_price >= 10 && x.track_inventory)!;
const q = products.find((x) => x.product_id !== p.product_id && x.wholesale_price >= 10)!;
ok(p && q, `using ${p.name} (${money(p.wholesale_price)}) and ${q.name} (${money(q.wholesale_price)})`);
const fixed = Math.round(p.wholesale_price * 0.8 * 100) / 100;
const d1: RuleDraft = { product_id: p.product_id, name: p.name, unit_name: null, min_qty: '1', mode: 'price', value: String(fixed) };
const d2: RuleDraft = { product_id: q.product_id, name: q.name, unit_name: null, min_qty: '1', mode: 'percent', value: '10' };
ok(ruleProblem(d1) === '' && ruleProblem(d2) === '', 'the app accepts both prices');
await put(`/wholesale/price-lists/${list.list_id}/items`, ruleBody(d1));
await put(`/wholesale/price-lists/${list.list_id}/items`, ruleBody(d2));
await put(`/wholesale/price-lists/${list.list_id}/items`, ruleBody({ ...d1, value: String(fixed) }));
const rules = await api.get<PriceRule[]>(`/wholesale/price-lists/${list.list_id}/items?limit=300`);
ok(rules.length === 2, `two prices on the list (the same item again changed it, did not add): ${rules.map((r) => `${r.product} ${ruleText(r, money)}`).join('; ')}`);

say('Give it to a shop');
const customers = await api.get<{ customer_id: number; name: string; price_list_id?: number | null }[]>('/wholesale/customers?limit=10');
const [shop, other] = customers;
await put(`/wholesale/customers/${shop.customer_id}`, { price_list_id: list.list_id });
const before = await priceFor(other.customer_id, p.product_id);
const mine = await priceFor(shop.customer_id, p.product_id);
ok(Math.abs(mine.price - fixed) < 0.01, `${shop.name} now pays ${money(mine.price)} for ${p.name} (was ${money(p.wholesale_price)})`);
ok(Math.abs(before.price - fixed) > 0.001 || other.price_list_id === list.list_id, `${other.name} is not on the list and pays ${money(before.price)}`);
const off = await priceFor(shop.customer_id, q.product_id);
ok(off.price < q.wholesale_price, `10% off ${q.name}: ${money(off.price)}`);
ok((await api.get<PriceList[]>('/wholesale/price-lists')).find((l) => l.list_id === list.list_id)?.customers === 1, 'the list shows one customer');

say('Switch off and remove');
await put(`/wholesale/price-lists/${list.list_id}`, { is_active: false });
const offPrice = await priceFor(shop.customer_id, p.product_id);
ok(Math.abs(offPrice.price - fixed) > 0.001, `switched off: ${shop.name} pays ${money(offPrice.price)} again`);
await put(`/wholesale/price-lists/${list.list_id}`, { is_active: true });
await api.call(`/wholesale/price-lists/${list.list_id}/items/${rules.find((r) => r.discount_pct != null)!.item_id}`, { method: 'DELETE' });
ok((await api.get<PriceRule[]>(`/wholesale/price-lists/${list.list_id}/items`)).length === 1, 'one price removed');
await put(`/wholesale/customers/${shop.customer_id}`, { price_list_id: null });
ok(!(await api.get<{ price_list_id?: number | null }>(`/wholesale/customers/${shop.customer_id}`)).price_list_id, `${shop.name} is off the list again`);
await put(`/wholesale/price-lists/${list.list_id}`, { is_active: false });
say('All good.');
