/* The printed job card, on one A4 sheet. The top half is the workshop's copy: everything the mechanics need (vehicle, model, odometer, what is wrong, the parts and labour).
   The bottom half, under a dashed "cut here" line, is the customer's copy: job number, vehicle, what was handed in, the estimate and when it is promised. No React, so it can be tested. */
import { rupees } from './money.ts';
import type { JobFull } from './jobCards.ts';

export type JobPrintBusiness = { name: string; address?: string | null; phone?: string | null };

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const row = (label: string, value: unknown) => (value == null || value === '' ? '' : `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`);
const vehicleName = (j: JobFull) => [j.make, j.model].filter(Boolean).join(' ');

const lines = (j: JobFull, withPrices: boolean) => (j.lines.length
  ? `<table class="lines"><thead><tr><th>Item</th><th class="n">Qty</th>${withPrices ? '<th class="n">Amount</th>' : ''}</tr></thead><tbody>${j.lines.map((l) =>
    `<tr><td>${esc(l.description)}${l.kind === 'LABOUR' ? ' <i>(labour)</i>' : ''}${l.sku ? ` <small>${esc(l.sku)}</small>` : ''}</td><td class="n">${esc(l.quantity)}</td>${withPrices ? `<td class="n">${esc(rupees(l.amount_paise))}</td>` : ''}</tr>`).join('')}</tbody></table>`
  : '<p class="none">Nothing added yet.</p>');

/** The whole A4 page as HTML, ready for the phone's print or share sheet. */
export const jobCardHtml = (j: JobFull, biz: JobPrintBusiness, now: Date = new Date()): string => {
  const date = now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const head = (title: string) => `<div class="head"><div><b class="biz">${esc(biz.name)}</b><br><small>${esc([biz.address, biz.phone].filter(Boolean).join(' · '))}</small></div><div class="tag"><b>${esc(title)}</b><br>${esc(j.job_no)} · ${esc(date)}</div></div>`;
  const workshop = `
    <section class="half">
      ${head('WORKSHOP COPY')}
      <table class="facts">
        ${row('Vehicle', vehicleName(j))}${row('Registration', j.vehicle_reg)}${row('Variant / model number', (j as { variant?: string | null }).variant)}${row('Year', j.vehicle_year)}${row('Odometer', j.odometer_km != null ? `${j.odometer_km} km` : '')}
        ${row('Customer', [j.customer_name, j.customer_phone].filter(Boolean).join(' · '))}${row('Mechanic', j.mechanic_name)}${row('Promised for', j.promised_on)}${row('Fuel', j.fuel_level)}${row('Belongings', j.belongings)}
      </table>
      <div class="box"><b>What is wrong / what to do</b><br>${esc(j.complaint || 'As discussed at the counter')}</div>
      ${lines(j, false)}
      <div class="sign">Mechanic's notes and sign-off: ______________________________</div>
    </section>`;
  const customer = `
    <section class="half">
      ${head('CUSTOMER COPY')}
      <table class="facts">
        ${row('Vehicle', [vehicleName(j), j.vehicle_reg].filter(Boolean).join(' · '))}${row('Customer', j.customer_name)}${row('Handed in', date)}${row('Promised for', j.promised_on)}${row('Odometer', j.odometer_km != null ? `${j.odometer_km} km` : '')}
      </table>
      <div class="box"><b>Work to be done</b><br>${esc(j.complaint || 'As discussed at the counter')}</div>
      ${j.lines.length ? lines(j, true) : ''}
      ${j.lines.length ? `<p class="total">Estimate (with GST): ${esc(rupees(j.estimate.total_paise))}</p>` : '<p class="none">The estimate will be shared after the inspection.</p>'}
      <p class="small">Please keep this slip and show it when you collect your vehicle. The final bill may differ if more work is needed; we will tell you first.</p>
    </section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 10mm; }
    * { box-sizing: border-box; } body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; margin: 0; }
    .half { height: 133mm; overflow: hidden; padding: 2mm 0; }
    .cut { border-top: 2px dashed #888; margin: 3mm 0; text-align: center; height: 0; } .cut span { position: relative; top: -9px; background: #fff; padding: 0 8px; color: #666; font-size: 10px; }
    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 4px; margin-bottom: 6px; } .biz { font-size: 16px; } .tag { text-align: right; }
    table { width: 100%; border-collapse: collapse; } .facts th { text-align: left; width: 34%; color: #555; font-weight: 600; padding: 2px 0; } .facts td { padding: 2px 0; }
    .box { border: 1px solid #999; border-radius: 4px; padding: 6px; margin: 6px 0; min-height: 30px; }
    .lines th, .lines td { border-bottom: 1px solid #ddd; padding: 3px 2px; text-align: left; } .n { text-align: right !important; width: 70px; }
    .sign { margin-top: 10px; color: #444; } .total { font-weight: 700; font-size: 14px; text-align: right; } .small, .none { color: #555; font-size: 11px; }
  </style></head><body>${workshop}<div class="cut"><span>✂ cut here</span></div>${customer}</body></html>`;
};
