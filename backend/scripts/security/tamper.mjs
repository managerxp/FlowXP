/* node scripts/security/tamper.mjs   (makes and cancels a few demo invoices: tries to change what a bill is worth with discounts, prices, tax rates and quantities) */
const base = 'http://localhost:5100';
const login = await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email: 'cafe@flowxp.test', password: 'demo1234' }) })).json();
const token = login.data.token;
const me = (await (await fetch(base + '/api/auth/me', { headers: { authorization: 'Bearer ' + token } })).json()).data.businesses[0];
const H = { authorization: 'Bearer ' + token, 'x-business-id': String(me.business_id), 'x-branch-id': String(me.outlets[0].branch_id), 'x-requested-with': 'FlowXP', 'content-type': 'application/json' };
const products = (await (await fetch(base + '/api/products?limit=50', { headers: H })).json()).data;
const real = products.find((p) => p.selling_price >= 50 && !(p.modifier_group_ids?.length) && (p.kind ?? 'DISH') !== 'INGREDIENT');
const made = [];
const post = async (name, body) => {
  const r = await fetch(base + '/api/invoices', { method: 'POST', headers: { ...H, 'idempotency-key': 'audit-' + Math.random().toString(36).slice(2) }, body: JSON.stringify(body) });
  const j = await r.json();
  const inv = j.data;
  if (inv?.invoice_id) made.push(inv.invoice_id);
  console.log(`${name.padEnd(54)} -> ${r.status}${inv?.invoice_id ? ` invoice total ₹${inv.total} (discount ₹${inv.discount})` : ' ' + (j.message ?? '')}`);
};
const pay = { method: 'CASH', amount: 'FULL' };
await post('baseline: one real item', { items: [{ product_id: real.product_id, quantity: 1 }], payment: pay });
await post('custom line with a NEGATIVE price (-500)', { items: [{ product_id: real.product_id, quantity: 1 }, { description: 'adjustment', unit_price: -500, quantity: 1 }], payment: pay });
await post('negative quantity (-2)', { items: [{ product_id: real.product_id, quantity: -2 }], payment: pay });
await post('discount bigger than the line (₹100000)', { items: [{ product_id: real.product_id, quantity: 1, discount: 100000 }], payment: pay });
await post('negative discount (-100): raises the price', { items: [{ product_id: real.product_id, quantity: 1, discount: -100 }], payment: pay });
await post('100% discount on a real item', { items: [{ product_id: real.product_id, quantity: 1, discount: real.selling_price }], payment: pay });
await post('huge quantity (1e12)', { items: [{ product_id: real.product_id, quantity: 1e12 }], payment: pay });
await post('negative tax rate on a custom line', { items: [{ description: 'x', unit_price: 100, quantity: 1, tax_rate: -50 }], payment: pay });
await post('whole-bill discount larger than the bill', { items: [{ product_id: real.product_id, quantity: 1 }], discount: 100000, payment: pay });
for (const id of made) { const r = await fetch(base + `/api/invoices/${id}/cancel`, { method: 'POST', headers: { ...H, 'idempotency-key': 'audit-c-' + id }, body: '{}' }); }
console.log(`(cancelled ${made.length} test invoices)`);
