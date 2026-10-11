/* node scripts/security/cost.mjs  — who sees the purchase price on the product list (development server running). */
const base = 'http://localhost:5100';
const as = async (email) => {
  const r = await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email, password: 'demo1234' }) })).json();
  const me = (await (await fetch(base + '/api/auth/me', { headers: { authorization: 'Bearer ' + r.data.token } })).json()).data;
  const b = me.businesses[0];
  const h = { authorization: 'Bearer ' + r.data.token, 'x-business-id': String(b.business_id), 'x-branch-id': String(b.outlets[0].branch_id), 'x-requested-with': 'FlowXP' };
  return (path) => fetch(base + '/api' + path, { headers: h }).then((x) => x.json());
};
let bad = 0;
for (const [email, shouldSee] of [['cafe@flowxp.test', true], ['cafe-manager@flowxp.test', true], ['cafe-barista@flowxp.test', false], ['demo-waiter@flowxp.test', false], ['demo-kitchen@flowxp.test', false]]) {
  const get = await as(email);
  const list = (await get('/products?limit=30')).data || [];
  const one = (await get('/products/' + list[0]?.product_id)).data || {};
  const sees = list.some((p) => 'purchase_price' in p) || 'purchase_price' in one;
  console.log(`${sees === shouldSee ? '  ok ' : ' FAIL'}  ${email}: ${list.length} products, ${sees ? 'cost shown' : 'no cost'}`);
  if (sees !== shouldSee) bad++;
}
process.exit(bad ? 1 : 0);
