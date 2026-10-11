/* node scripts/security/approvals2.mjs   (development server running). The two approval paths approvals.mjs does not reach:
   a café table's bill (POST /orders/:id/bill) and the salon till's bill discount. Leaves settings and PINs as found; demo bills are cancelled. */
import pool from '../../src/config/database.js';

const base = 'http://localhost:5100';
const ok = (cond, m) => { if (!cond) throw new Error(`FAILED: ${m}`); console.log(`  ok  ${m}`); };
const who = async (email) => {
  const r = await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email, password: 'demo1234' }) })).json();
  const me = (await (await fetch(base + '/api/auth/me', { headers: { authorization: 'Bearer ' + r.data.token } })).json()).data;
  const b = me.businesses[0];
  const headers = { authorization: 'Bearer ' + r.data.token, 'x-business-id': String(b.business_id), 'x-branch-id': String(b.outlets[0].branch_id), 'x-requested-with': 'FlowXP', 'content-type': 'application/json' };
  const call = async (method, path, body, extra = {}) => { const res = await fetch(base + '/api' + path, { method, headers: { ...headers, ...extra }, body: body ? JSON.stringify(body) : undefined }); let json = null; try { json = await res.json(); } catch { /* */ } return { status: res.status, json }; };
  return { call, b };
};
let seq = 0; const key = () => ({ 'idempotency-key': `approvals2-${Date.now()}-${seq++}` });
const undo = [];

try {
  console.log('A table bill (café)');
  const owner = await who('cafe@flowxp.test'); const manager = await who('cafe-manager@flowxp.test'); const cashier = await who('cafe-barista@flowxp.test');
  const was = (await owner.call('GET', '/approvals')).json.data;
  undo.push(async () => { await owner.call('PUT', '/approvals', { discount_cap_pct: was.discount_cap_pct }); await manager.call('DELETE', '/auth/approval-pin', { password: 'demo1234' }); });
  await manager.call('PUT', '/auth/approval-pin', { password: 'demo1234', pin: '4821' });
  await owner.call('PUT', '/approvals', { discount_cap_pct: 15 });
  const item = (await cashier.call('GET', '/products?limit=60')).json.data.find((p) => p.selling_price >= 100 && !(p.modifier_group_ids?.length) && (p.kind ?? 'DISH') !== 'INGREDIENT');
  const tab = async () => {
    const o = await cashier.call('POST', '/orders', { order_type: 'TAKEAWAY' }, key());
    const id = o.json.data.order_id ?? o.json.data.order?.order_id;
    const a = await cashier.call('POST', `/orders/${id}/items`, { items: [{ product_id: item.product_id, quantity: 1 }] }, key());
    ok(a.status < 300, `a takeaway tab with one item (${a.status})`);
    return id;
  };
  const pay = { payment: { method: 'CASH', amount: 'FULL' } };
  let id = await tab();
  const held = await cashier.call('POST', `/orders/${id}/bill`, { ...pay, discount: item.selling_price * 0.4 }, key());
  ok(held.status === 403 && held.json.code === 'APPROVAL_REQUIRED' && held.json.data.cap_pct === 15, `a 40% bill discount on a tab is held: "${held.json?.message}"`);
  ok((await cashier.call('POST', `/orders/${id}/bill`, { ...pay, discount: item.selling_price * 0.4, approval: { pin: '0000' } }, key())).json.code === 'APPROVAL_WRONG', 'a wrong PIN is refused');
  const billed = await cashier.call('POST', `/orders/${id}/bill`, { ...pay, discount: item.selling_price * 0.4, approval: { pin: '4821' } }, key());
  ok(billed.status < 300, `with the manager's PIN the tab is billed (${billed.status})`);
  undo.push(async () => { const inv = billed.json?.data?.invoice_id ?? billed.json?.data?.invoice?.invoice_id; if (inv) await manager.call('POST', `/invoices/${inv}/cancel`, {}, key()); });
  id = await tab();
  const small = await cashier.call('POST', `/orders/${id}/bill`, { ...pay, discount: item.selling_price * 0.05 }, key());
  ok(small.status < 300, 'a 5% discount is under the limit');
  undo.push(async () => { const inv = small.json?.data?.invoice_id ?? small.json?.data?.invoice?.invoice_id; if (inv) await manager.call('POST', `/invoices/${inv}/cancel`, {}, key()); });

  console.log('The salon till');
  const sOwner = await who('salon@flowxp.test'); const desk = await who('salon-reception@flowxp.test');
  const sWas = (await sOwner.call('GET', '/approvals')).json.data;
  undo.push(async () => { await sOwner.call('PUT', '/approvals', { discount_cap_pct: sWas.discount_cap_pct }); await sOwner.call('DELETE', '/auth/approval-pin', { password: 'demo1234' }); await pool.query(`DELETE FROM approval_attempts WHERE business_id = $1`, [sOwner.b.business_id]); });
  ok(desk.b.approval.needed === true, 'reception needs approval');
  await sOwner.call('PUT', '/auth/approval-pin', { password: 'demo1234', pin: '5566' });
  await sOwner.call('PUT', '/approvals', { discount_cap_pct: 10 });
  const cat = (await desk.call('GET', '/salon/pos/catalog')).json.data;
  const svc = cat.services.find((s) => s.price >= 200);
  const sale = (extra) => desk.call('POST', '/salon/pos/invoices', { items: [{ type: 'SERVICE', service_id: svc.service_id, staff_id: cat.staff[0].staff_id }], payments: [{ method: 'CASH', amount: 'FULL' }], ...extra }, key());
  const quote = await desk.call('POST', '/salon/pos/quote', { items: [{ type: 'SERVICE', service_id: svc.service_id, staff_id: cat.staff[0].staff_id }], discount: svc.price * 0.5 });
  ok(quote.status === 200, 'a quote with a big discount is never held (it only shows the price)');
  const sHeld = await sale({ discount: svc.price * 0.5 });
  ok(sHeld.status === 403 && sHeld.json.code === 'APPROVAL_REQUIRED', `a 50% bill discount is held at the salon till: "${sHeld.json?.message}"`);
  ok((await sale({ discount: svc.price * 0.5, approval: { pin: '1111' } })).json.code === 'APPROVAL_WRONG', 'a wrong PIN is refused');
  const sOk = await sale({ discount: svc.price * 0.5, approval: { pin: '5566' } });
  ok(sOk.status === 201, `with the salon owner's PIN it goes through (${sOk.status})`);
  undo.push(async () => { const inv = sOk.json?.data?.invoice?.invoice_id ?? sOk.json?.data?.invoice_id; if (inv) await sOwner.call('POST', `/invoices/${inv}/cancel`, {}, key()); });
  const sSmall = await sale({ discount: svc.price * 0.05 });
  ok(sSmall.status === 201, 'a 5% discount is under the limit');
  undo.push(async () => { const inv = sSmall.json?.data?.invoice?.invoice_id ?? sSmall.json?.data?.invoice_id; if (inv) await sOwner.call('POST', `/invoices/${inv}/cancel`, {}, key()); });
} finally {
  for (const f of undo.reverse()) await f().catch(() => {});
  await pool.query(`DELETE FROM approval_attempts WHERE created_at > now() - interval '1 hour'`);
  await pool.end();
}
console.log('All good.');
