/* One payslip as a printable page: earnings on the left, deductions on the right, the net pay under them, and the employer's PF and ESI as a note. */
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (p) => `Rs ${(Number(p || 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const line = (label, p) => (Number(p) ? `<tr><td>${esc(label)}</td><td class="n">${money(p)}</td></tr>` : '');

export const payslipHtml = (s, biz, month, monthLabel) => {
  const earned = Number(s.base_pay_paise) + Number(s.overtime_pay_paise) + Number(s.allowances_paise);
  const earnings = [line('Basic', s.basic_paise), line('HRA', s.hra_paise), line('Other allowances', Number(s.base_pay_paise) - Number(s.basic_paise) - Number(s.hra_paise)), line('Overtime', s.overtime_pay_paise), line('Added to pay', s.allowances_paise)].join('');
  const deductions = [line('Provident fund', s.pf_employee_paise), line('ESI', s.esi_employee_paise), line('Professional tax', s.pt_paise), line('TDS', s.tds_paise), line('Loan or advance', s.loan_recovery_paise), line('Other deduction', s.deductions_paise)].join('');
  const out = Number(s.pf_employee_paise) + Number(s.esi_employee_paise) + Number(s.pt_paise) + Number(s.tds_paise) + Number(s.loan_recovery_paise) + Number(s.deductions_paise);
  const paidDays = Number(s.days_present) + Number(s.days_paid_leave) + Number(s.days_weekly_off);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Payslip ${esc(s.name)} ${esc(month)}</title><style>
    @page { size: A4; margin: 14mm; } * { box-sizing: border-box; } body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; }
    .head { display: flex; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 10px; } h1 { font-size: 17px; margin: 0; }
    table { width: 100%; border-collapse: collapse; } td, th { padding: 4px 2px; text-align: left; } .n { text-align: right; } .facts td { width: 25%; }
    .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 10px; } .cols th { border-bottom: 1px solid #111; } .cols td { border-bottom: 1px solid #ddd; }
    .net { margin-top: 14px; border: 2px solid #111; padding: 8px; display: flex; justify-content: space-between; font-size: 15px; font-weight: 700; } .small { color: #555; font-size: 10px; margin-top: 10px; }
  </style></head><body>
    <div class="head"><div><h1>${esc(biz?.name)}</h1><div>${esc([biz?.address, biz?.phone].filter(Boolean).join(' · '))}</div></div><div style="text-align:right"><b>Payslip</b><br>${esc(monthLabel)}</div></div>
    <table class="facts"><tr><td>Name</td><td><b>${esc(s.name)}</b></td><td>Employee code</td><td>${esc(s.emp_code)}</td></tr>
      <tr><td>Designation</td><td>${esc(s.designation || '')}</td><td>Department</td><td>${esc(s.department || '')}</td></tr>
      <tr><td>Paid days</td><td>${paidDays} of ${esc(s.days_in_month)}</td><td>PAN</td><td>${esc(s.pan || '')}</td></tr>
      <tr><td>UAN</td><td>${esc(s.uan || '')}</td><td>ESI number</td><td>${esc(s.esi_number || '')}</td></tr></table>
    <div class="cols"><table><tr><th>Earnings</th><th class="n">Amount</th></tr>${earnings}<tr><td><b>Gross pay</b></td><td class="n"><b>${money(earned)}</b></td></tr></table>
      <table><tr><th>Deductions</th><th class="n">Amount</th></tr>${deductions || '<tr><td>None</td><td></td></tr>'}<tr><td><b>Total deductions</b></td><td class="n"><b>${money(out)}</b></td></tr></table></div>
    <div class="net"><span>Net pay</span><span>${money(s.net_pay_paise)}</span></div>
    ${Number(s.pf_employer_paise) || Number(s.esi_employer_paise) ? `<p class="small">Paid by the employer on top of this pay: provident fund ${money(Number(s.pf_employer_paise) + Number(s.pf_admin_paise))}${Number(s.esi_employer_paise) ? `, ESI ${money(s.esi_employer_paise)}` : ''}.</p>` : ''}
    <p class="small">This is a computer-made payslip and needs no signature.${s.note ? ` Note: ${esc(s.note)}` : ''}</p>
  </body></html>`;
};
