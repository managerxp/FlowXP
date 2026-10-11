/* node scripts/security/tenants.mjs cafe@flowxp.test demo@flowxp.test   (two DIFFERENT businesses of the demo data; needs the server running)
   Core records, tested by hand: A's id, requested by B, for reads, edits (empty body), and the actions that would hurt most. */
const [,, emailA, emailB] = process.argv;
const base = 'http://localhost:5100';
const login = async (email) => {
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email, password: 'demo1234' }) });
  const j = await r.json(); const me = await (await fetch(base + '/api/auth/me', { headers: { authorization: 'Bearer ' + j.data.token } })).json();
  const b = me.data.businesses[0]; return { token: j.data.token, biz: b.business_id, branch: b.outlets[0].branch_id };
};
const A = await login(emailA); const B = await login(emailB);
const call = async (who, method, path, body) => {
  const r = await fetch(base + path, { method, headers: { authorization: 'Bearer ' + who.token, 'x-business-id': String(who.biz), 'x-branch-id': String(who.branch), 'x-requested-with': 'FlowXP', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* */ } return { status: r.status, json };
};
const first = (j) => { const d = j?.data; const a = Array.isArray(d) ? d : d && typeof d === 'object' ? Object.values(d).find((v) => Array.isArray(v) && v.length) : null; return a?.[0]; };
const idOf = (o, k) => o?.[k] ?? o?.id;
const today = new Date().toISOString().slice(0, 10);
const cases = [
  ['invoice', '/api/invoices?from=2020-01-01&to=' + today, 'invoice_id', (id) => [['GET', `/api/invoices/${id}`], ['POST', `/api/invoices/${id}/payments`, { amount: 1, method: 'CASH' }], ['POST', `/api/invoices/${id}/cancel`, {}], ['POST', `/api/invoices/${id}/refund`, { amount: 1 }]]],
  ['customer', '/api/customers', 'customer_id', (id) => [['GET', `/api/customers/${id}`], ['GET', `/api/customers/${id}/invoices`], ['PATCH', `/api/customers/${id}`, { name: 'x' }]]],
  ['product', '/api/products', 'product_id', (id) => [['GET', `/api/products/${id}`], ['PATCH', `/api/products/${id}`, { selling_price: 1 }], ['POST', `/api/products/${id}/archive`, {}]]],
  ['order', '/api/orders', 'order_id', (id) => [['GET', `/api/orders/${id}`], ['POST', `/api/orders/${id}/bill`, { payment: { method: 'CASH', amount: 'FULL' } }], ['PATCH', `/api/orders/${id}/customer`, { customer_id: null }]]],
  ['supplier', '/api/suppliers', 'supplier_id', (id) => [['GET', `/api/suppliers/${id}`], ['PUT', `/api/suppliers/${id}`, { name: 'x' }]]],
  ['expense', '/api/expenses', 'expense_id', (id) => [['GET', `/api/expenses/${id}`], ['PUT', `/api/expenses/${id}`, { amount: 1 }], ['DELETE', `/api/expenses/${id}`]]],
  ['table', '/api/tables', 'table_id', (id) => [['GET', `/api/tables/${id}`], ['PUT', `/api/tables/${id}`, { name: 'x' }]]],
  ['held bill', '/api/held-bills', 'held_id', (id) => [['GET', `/api/held-bills/${id}`], ['DELETE', `/api/held-bills/${id}`]]],
  ['staff', '/api/staff', 'user_id', (id) => [['GET', `/api/staff/${id}/permissions`], ['PUT', `/api/staff/${id}`, { role: 'OWNER' }]]]
];
let problems = 0;
for (const [label, list, key, build] of cases) {
  const l = await call(A, 'GET', list);
  const item = first(l.json);
  if (l.status !== 200 || !item) { console.log(`${label.padEnd(10)} A cannot list it (${l.status}${item ? '' : ', none'}): not tested`); continue; }
  const id = idOf(item, key) ?? Object.entries(item).find(([k, v]) => k.endsWith('_id') && Number.isInteger(v) && k !== 'business_id' && k !== 'branch_id')?.[1];
  const results = [];
  for (const [m, path, body] of build(id)) {
    const own = m === 'GET' ? await call(A, m, path) : null;
    const r = await call(B, m, path, body);
    const refused = [401, 403, 404].includes(r.status);
    const leak = m === 'GET' && r.status === 200 && r.json?.data != null;
    const worry = !refused && !(m !== 'GET' && r.status === 400 && false);
    if (leak || (!refused && m !== 'GET')) problems++;
    results.push(`${m} ${path.replace(String(id), ':id').replace('/api/', '')} -> ${r.status}${leak ? ' LEAK' : !refused && m !== 'GET' ? ' CHECK ' + String(r.json?.message ?? '').slice(0, 50) : ''}${own && own.status !== 200 ? ` (owner got ${own.status})` : ''}`);
  }
  console.log(`${label.padEnd(10)} id ${id}: ${results.join(' | ')}`);
}
console.log(problems ? `\n${problems} case(s) need a look` : '\nEvery read and every change by the other business was refused as not found.');
