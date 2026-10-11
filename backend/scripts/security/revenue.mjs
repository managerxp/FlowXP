/* node scripts/security/revenue.mjs  (development server running). Who is sent the day's takings and the plan price. */
const base = 'http://localhost:5100';
const as = async (email) => {
  const r = await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email, password: 'demo1234' }) })).json();
  const me = (await (await fetch(base + '/api/auth/me', { headers: { authorization: 'Bearer ' + r.data.token } })).json()).data;
  const b = me.businesses[0];
  const h = { authorization: 'Bearer ' + r.data.token, 'x-business-id': String(b.business_id), 'x-branch-id': String(b.outlets[0].branch_id), 'x-requested-with': 'FlowXP' };
  return (path) => fetch(base + '/api' + path, { headers: h }).then((x) => x.json());
};
let bad = 0;
for (const [email, shouldSee, owns] of [['cafe@flowxp.test', true, true], ['cafe-manager@flowxp.test', true, true], ['cafe-barista@flowxp.test', true, false], ['demo-waiter@flowxp.test', false, false], ['demo-kitchen@flowxp.test', false, false]]) {
  const get = await as(email);
  const d = (await get('/dashboard')).data; const sub = (await get('/businesses/current/subscription')).data;
  const sees = d?.metrics != null && 'today_sales' in d.metrics; const price = sub?.plan?.price_monthly_paise != null || sub?.pending_payment != null;
  const leak = JSON.stringify(d || {}).includes('today_sales') !== sees;
  const good = sees === shouldSee && (owns || !price) && !leak;
  console.log(`${good ? '  ok ' : ' FAIL'}  ${email}: takings ${sees ? 'shown' : 'hidden'}, plan price ${sub?.plan?.price_monthly_paise != null ? 'shown' : 'hidden'}`);
  if (!good) bad++;
}
process.exit(bad ? 1 : 0);
