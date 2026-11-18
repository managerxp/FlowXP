/* The printed job card on one A4 sheet. Top half: the workshop's copy (vehicle, model, odometer, what is wrong, parts and labour, no prices). Under a dashed cut line, the customer's copy
   (job number, vehicle, what was handed in, the estimate, when it is promised). The same layout as the phone's. */
import { rsPaise } from '../../lib/autoparts.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const row = (label, value) => (value == null || value === '' ? '' : `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`);

const lines = (j, prices) => (j.lines?.length
  ? `<table class="lines"><thead><tr><th>Item</th><th class="n">Qty</th>${prices ? '<th class="n">Amount</th>' : ''}</tr></thead><tbody>${j.lines.map((l) => `<tr><td>${esc(l.description)}${l.kind === 'LABOUR' ? ' <i>(labour)</i>' : ''}${l.sku ? ` <small>${esc(l.sku)}</small>` : ''}</td><td class="n">${esc(l.quantity)}</td>${prices ? `<td class="n">${esc(rsPaise(l.amount_paise))}</td>` : ''}</tr>`).join('')}</tbody></table>`
  : '<p class="none">Nothing added yet.</p>');

export const jobCardHtml = (j, biz, now = new Date()) => {
  const date = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const vehicle = [j.make, j.model].filter(Boolean).join(' ');
  const odo = j.odometer_km != null ? `${j.odometer_km} km` : '';
  const head = (title) => `<div class="head"><div><b class="biz">${esc(biz?.name)}</b><br><small>${esc([biz?.address, biz?.phone].filter(Boolean).join(' · '))}</small></div><div class="tag"><b>${title}</b><br>${esc(j.job_no)} · ${esc(date)}</div></div>`;
  const complaint = esc(j.complaint || 'As discussed at the counter');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(j.job_no)}</title><style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; } body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; margin: 0; }
    .half { height: 133mm; overflow: hidden; padding: 2mm 0; }
    .cut { border-top: 2px dashed #888; margin: 3mm 0; text-align: center; height: 0; } .cut span { position: relative; top: -9px; background: #fff; padding: 0 8px; color: #666; font-size: 10px; }
    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 4px; margin-bottom: 6px; } .biz { font-size: 16px; } .tag { text-align: right; }
    table { width: 100%; border-collapse: collapse; } .facts th { text-align: left; width: 34%; color: #555; font-weight: 600; padding: 2px 0; } .facts td { padding: 2px 0; }
    .box { border: 1px solid #999; border-radius: 4px; padding: 6px; margin: 6px 0; min-height: 30px; }
    .lines th, .lines td { border-bottom: 1px solid #ddd; padding: 3px 2px; text-align: left; } .n { text-align: right !important; width: 70px; }
    .sign { margin-top: 10px; color: #444; } .total { font-weight: 700; font-size: 14px; text-align: right; } .small, .none { color: #555; font-size: 11px; }
  </style></head><body>
    <section class="half">${head('WORKSHOP COPY')}
      <table class="facts">${row('Vehicle', vehicle)}${row('Registration', j.vehicle_reg)}${row('Variant / model number', j.variant)}${row('Year', j.vehicle_year)}${row('Odometer', odo)}${row('Customer', [j.customer_name, j.customer_phone].filter(Boolean).join(' · '))}${row('Mechanic', j.mechanic_name)}${row('Promised for', j.promised_on)}${row('Fuel', j.fuel_level)}${row('Belongings', j.belongings)}</table>
      <div class="box"><b>What is wrong / what to do</b><br>${complaint}</div>${lines(j, false)}
      <div class="sign">Mechanic's notes and sign-off: ______________________________</div>
    </section>
    <div class="cut"><span>✂ cut here</span></div>
    <section class="half">${head('CUSTOMER COPY')}
      <table class="facts">${row('Vehicle', [vehicle, j.vehicle_reg].filter(Boolean).join(' · '))}${row('Customer', j.customer_name)}${row('Handed in', date)}${row('Promised for', j.promised_on)}${row('Odometer', odo)}</table>
      <div class="box"><b>Work to be done</b><br>${complaint}</div>
      ${j.lines?.length ? `${lines(j, true)}<p class="total">Estimate (with GST): ${esc(rsPaise(j.estimate?.total_paise))}</p>` : '<p class="none">The estimate will be shared after the inspection.</p>'}
      <p class="small">Please keep this slip and show it when you collect your vehicle. The final bill may differ if more work is needed; we will tell you first.</p>
    </section></body></html>`;
};

export const printJobCard = (j, biz) => {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(jobCardHtml(j, biz));
  w.document.close(); w.focus(); w.print();
};
