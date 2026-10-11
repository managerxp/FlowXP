/* node scripts/security/approvals.mjs   (development server running; demo café). Manager approval for bill cancels and a discount cap, end to end:
   the manager sets a PIN; the owner sets a cap; a cashier is held at the cap and at cancelling until a manager's PIN is entered; a manager is not held;
   wrong PINs are refused and, after five, locked. Leaves the settings and the PIN as they were; the demo invoices it makes are cancelled. */
import pool from '../../src/config/database.js';

const base = 'http://localhost:5100';
const ok = (cond, m) => { if (!cond) throw new Error(`FAILED: ${m}`); console.log(`  ok  ${m}`); };
const who = async (email) => {
  const r = await (await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'FlowXP' }, body: JSON.stringify({ email, password: 'demo1234' }) })).json();
  const me = (await (await fetch(base + '/api/auth/me', { headers: { authorization: 'Bearer ' + r.data.token } })).json()).data;
  const b = me.businesses[0];
  const headers = { authorization: 'Bearer ' + r.data.token, 'x-business-id': String(b.business_id), 'x-branch-id': String(b.outlets[0].branch_id), 'x-requested-with': 'FlowXP', 'content-type': 'application/json' };
  const call = async (method, path, body, extra = {}) => { const res = await fetch(base + '/api' + path, { method, headers: { ...headers, ...extra }, body: body ? JSON.stringify(body) : undefined }); let json = null; try { json = await res.json(); } catch { /* */ } return { status: res.status, json }; };
  return { call, b, userId: me.user.user_id };
};
const owner = await who('cafe@flowxp.test'); const manager = await who('cafe-manager@flowxp.test'); const cashier = await who('cafe-barista@flowxp.test');
const made = []; const pMade = []; let pharmacyDone; let seq = 0;
const key = () => ({ 'idempotency-key': `approvals-${Date.now()}-${seq++}` });
const was = (await owner.call('GET', '/approvals')).json.data;

try {
  console.log('What each person is told');
  ok(cashier.b.approval.needed === true && manager.b.approval.needed === false && owner.b.approval.needed === false, 'the cashier needs approval; the manager and owner do not');

  console.log('The manager sets a PIN; the owner sets the rules');
  ok((await manager.call('PUT', '/auth/approval-pin', { password: 'wrong', pin: '4821' })).status === 403, 'a PIN needs the account password');
  ok((await manager.call('PUT', '/auth/approval-pin', { password: 'demo1234', pin: '12' })).status === 400, 'a PIN is 4 to 8 digits');
  ok((await cashier.call('PUT', '/auth/approval-pin', { password: 'demo1234', pin: '4821' })).status === 403, 'a cashier cannot set an approval PIN');
  ok((await manager.call('PUT', '/auth/approval-pin', { password: 'demo1234', pin: '4821' })).json.data.has_pin === true, 'the manager sets 4821');
  ok((await cashier.call('PUT', '/approvals', { discount_cap_pct: 50 })).status === 403, 'a cashier cannot change the rules');
  ok((await owner.call('PUT', '/approvals', { discount_cap_pct: 150 })).status === 400, 'a limit above 100% is refused');
  const set = await owner.call('PUT', '/approvals', { discount_cap_pct: 15, cancel_needs_approval: true });
  ok(set.json.data.discount_cap_pct === 15, 'the owner sets the limit to 15%');
  ok((await owner.call('GET', '/approvals')).json.data.approvers.some((a) => a.name && a.has_pin), 'the owner can see who can approve');

  const products = (await cashier.call('GET', '/products?limit=60')).json.data;
  const item = products.find((p) => p.selling_price >= 100 && !(p.modifier_group_ids?.length) && (p.kind ?? 'DISH') !== 'INGREDIENT');
  const sale = (extra, who2 = cashier) => who2.call('POST', '/invoices', { items: [{ product_id: item.product_id, quantity: 1, ...(extra.line ? { discount: extra.line } : {}) }], ...(extra.bill ? { discount: extra.bill } : {}), payment: { method: 'CASH', amount: 'FULL' }, ...(extra.approval ? { approval: extra.approval } : {}) }, key());
  const keep = (r) => { if (r.json?.data?.invoice_id) made.push(r.json.data.invoice_id); return r; };

  console.log('Discounts: the cap');
  ok(keep(await sale({ line: item.selling_price * 0.10 })).status === 201, 'a cashier gives 10% on a line: fine, under the 15% limit');
  const over = await sale({ line: item.selling_price * 0.30 });
  ok(over.status === 403 && over.json.code === 'APPROVAL_REQUIRED' && over.json.data.cap_pct === 15 && over.json.data.discount_pct === 30, `30% on a line is held: "${over.json.message}"`);
  const overBill = await sale({ bill: item.selling_price * 0.40 });
  ok(overBill.status === 403 && overBill.json.code === 'APPROVAL_REQUIRED', 'a 40% discount on the whole bill is held too');
  const split = await sale({ line: item.selling_price * 0.10, bill: item.selling_price * 0.10 });
  ok(split.status === 403, 'two 10% discounts together (20%) are held: they cannot be split to get under the limit');
  const wrong = await sale({ line: item.selling_price * 0.30, approval: { pin: '0000' } });
  ok(wrong.status === 403 && wrong.json.code === 'APPROVAL_WRONG', 'a wrong PIN is refused');
  const approved = keep(await sale({ line: item.selling_price * 0.30, approval: { pin: '4821' } }));
  ok(approved.status === 201, 'with the manager\'s PIN the 30% discount goes through');
  ok(keep(await sale({ line: item.selling_price * 0.30 }, manager)).status === 201, 'the manager gives 30% alone, no PIN asked');
  ok(keep(await sale({ line: item.selling_price * 0.30 }, owner)).status === 201, 'the owner too');
  const audit = (await pool.query(`SELECT metadata FROM audit_log WHERE action = 'approval.granted' AND business_id = $1 ORDER BY audit_id DESC LIMIT 1`, [cashier.b.business_id])).rows[0];
  ok(audit?.metadata?.kind === 'DISCOUNT' && audit.metadata.approver, `the approval is on record: ${audit?.metadata?.approver} allowed a ${audit?.metadata?.discount_pct}% discount`);

  const cheap = await cashier.call('POST', '/invoices', { items: [{ product_id: item.product_id, quantity: 1, unit_price: item.selling_price * 0.4 }], payment: { method: 'CASH', amount: 'FULL' } }, key());
  ok(cheap.status === 403 && cheap.json.code === 'APPROVAL_REQUIRED' && cheap.json.data.discount_pct === 60, 'typing in a lower price is held like a discount (60% off the catalogue price): it is not a way round the limit');
  const dearer = keep(await cashier.call('POST', '/invoices', { items: [{ product_id: item.product_id, quantity: 1, unit_price: item.selling_price * 0.95 }], payment: { method: 'CASH', amount: 'FULL' } }, key()));
  ok(dearer.status === 201, 'a small price change (5% below) is under the limit');

  console.log('Cancelling a bill');
  const target = keep(await sale({})).json.data.invoice_id;
  ok((await cashier.call('POST', `/invoices/${target}/cancel`, {}, key())).status === 400, 'a cashier must say why');
  const noPin = await cashier.call('POST', `/invoices/${target}/cancel`, { reason: 'wrong item' }, key());
  ok(noPin.status === 403 && noPin.json.code === 'APPROVAL_REQUIRED', 'a cashier cannot cancel it alone');
  ok((await cashier.call('POST', `/invoices/${target}/cancel`, { reason: 'wrong item', approval: { pin: '1111' } }, key())).json.code === 'APPROVAL_WRONG', 'a wrong PIN does not cancel it');
  ok((await cashier.call('GET', `/invoices/${target}`)).json.data.status === 'ISSUED', 'the bill is still there');
  const done = await cashier.call('POST', `/invoices/${target}/cancel`, { reason: 'wrong item', approval: { pin: '4821' } }, key());
  ok(done.status === 200, 'with the manager\'s PIN it is cancelled');
  const logged = (await pool.query(`SELECT metadata FROM audit_log WHERE action = 'invoice.cancelled' AND resource_id = $1 ORDER BY audit_id DESC LIMIT 1`, [String(target)])).rows[0];
  ok(logged?.metadata?.reason === 'wrong item', 'the reason is on record');
  const mine = keep(await sale({}, manager)).json.data.invoice_id;
  ok((await manager.call('POST', `/invoices/${mine}/cancel`, {}, key())).status === 200, 'a manager cancels without a PIN or a reason');
  await owner.call('PUT', '/approvals', { cancel_needs_approval: false });
  const free = keep(await sale({})).json.data.invoice_id;
  ok((await cashier.call('POST', `/invoices/${free}/cancel`, {}, key())).status === 200, 'with the cancel rule switched off a cashier can cancel alone');
  await owner.call('PUT', '/approvals', { cancel_needs_approval: true });

  console.log('Guessing the PIN');
  await pool.query(`DELETE FROM approval_attempts WHERE user_id = $1`, [cashier.userId]);
  let last;
  for (let i = 0; i < 5; i++) last = await sale({ line: item.selling_price * 0.30, approval: { pin: String(1000 + i) } });
  ok(last.json.code === 'APPROVAL_WRONG', 'five wrong PINs are each refused');
  const locked = await sale({ line: item.selling_price * 0.30, approval: { pin: '4821' } });
  ok(locked.status === 429 && locked.json.code === 'APPROVAL_LOCKED', `then even the right PIN is refused for a while: "${locked.json.message}"`);
  ok(keep(await sale({ line: item.selling_price * 0.05 })).status === 201, 'billing without a big discount is not affected by the lock');

  console.log('The pharmacy till');
  const pOwner = await who('pharmacy@flowxp.test'); const pharmacist = await who('pharmacy-pharmacist@flowxp.test');
  const pWas = (await pOwner.call('GET', '/approvals')).json.data;
  pharmacyDone = async () => { await pOwner.call('PUT', '/approvals', { discount_cap_pct: pWas.discount_cap_pct }); await pOwner.call('DELETE', '/auth/approval-pin', { password: 'demo1234' }); await pool.query(`DELETE FROM approval_attempts WHERE business_id = $1`, [pOwner.b.business_id]); for (const id of pMade) await pOwner.call('POST', `/invoices/${id}/cancel`, {}, key()).catch(() => {}); };
  ok(pharmacist.b.approval.needed === true && pOwner.b.approval.needed === false, 'the pharmacist needs approval; the pharmacy owner does not');
  await pOwner.call('PUT', '/auth/approval-pin', { password: 'demo1234', pin: '7391' });
  await pOwner.call('PUT', '/approvals', { discount_cap_pct: 10 });
  const meds = (await pharmacist.call('GET', '/pharmacy/products?limit=60')).json.data.filter((m) => (m.available ?? m.on_hand ?? 0) >= 3 && m.selling_price >= 20);
  const med = meds.find((m) => !m.prescription_required) ?? meds[0];
  const rx = (extra) => pharmacist.call('POST', '/pharmacy/pos/invoices', { items: [{ product_id: med.product_id, quantity: 1, ...(extra.line ? { discount: extra.line } : {}), ...(extra.price ? { unit_price: extra.price } : {}) }], ...(extra.bill ? { discount: extra.bill } : {}), payments: [{ method: 'CASH', amount: 'FULL' }], prescription_checked: true, ...(extra.approval ? { approval: extra.approval } : {}) }, key());
  const pKeep = (r) => { const id = r.json?.data?.invoice?.invoice_id ?? r.json?.data?.invoice_id; if (id) pMade.push(id); return r; };
  ok(pKeep(await rx({ line: med.selling_price * 0.05 })).status === 201, 'a pharmacist gives 5% (limit 10%): fine');
  const pOver = await rx({ line: med.selling_price * 0.30 });
  ok(pOver.status === 403 && pOver.json.code === 'APPROVAL_REQUIRED', `30% is held at the pharmacy till: "${pOver.json.message}"`);
  ok((await rx({ price: med.selling_price * 0.5 })).status === 403, 'a lower typed-in price is held there too');
  ok((await rx({ bill: med.selling_price * 0.5 })).status === 403, 'and a bill discount');
  ok((await rx({ line: med.selling_price * 2 })).status === 400, 'a discount larger than the item is refused outright');
  ok(pKeep(await rx({ line: med.selling_price * 0.30, approval: { pin: '7391' } })).status === 201, 'with the pharmacy manager\'s PIN it goes through');
  ok((await rx({ line: med.selling_price * 0.30, approval: { pin: '4821' } })).json.code === 'APPROVAL_WRONG', 'a PIN from another business does not work here');
} finally {
  if (typeof pharmacyDone === 'function') await pharmacyDone();
  for (const id of made) await manager.call('POST', `/invoices/${id}/cancel`, {}, key()).catch(() => {});
  await owner.call('PUT', '/approvals', { discount_cap_pct: was.discount_cap_pct, cancel_needs_approval: was.cancel_needs_approval });
  await manager.call('DELETE', '/auth/approval-pin', { password: 'demo1234' });
  await pool.query(`DELETE FROM approval_attempts WHERE business_id = $1`, [cashier.b.business_id]);
  console.log('settings put back (limit ' + was.discount_cap_pct + '%, cancel approval ' + was.cancel_needs_approval + '), the PIN removed, the lock cleared');
  await pool.end();
}
console.log('All good.');
