/* Payroll on the phone: the Payroll add-on's month (/api/payroll/runs). The server works out the pay, PF, ESI, professional tax, TDS and loan instalments; the phone shows the month,
   and does the three things that move it on: make it, make it final, pay the staff, and note the PF, ESI and tax deposit. The people and attendance reuse the staff screens. */
import { t } from './i18n.ts';
import { rupees } from './money.ts';

export type PaySlip = {
  payslip_id: number; employee_id: number; name: string; designation: string | null; department: string | null;
  gross_paise: number; net_pay_paise: number; days_unmarked: number
};
export type PayTotals = {
  net_pay_paise: number; employer_cost_paise: number; pf_employee_paise: number; pf_employer_paise: number; pf_admin_paise: number;
  esi_employee_paise: number; esi_employer_paise: number; pt_paise: number; tds_paise: number
};
/** The server answers a month with no payroll yet as { status: null, slips: [] }, not as nothing. */
export type PayRun = { month: string; status: 'DRAFT' | 'FINAL' | null; slips: PaySlip[]; totals?: PayTotals; unmarked_days: number; paid_on?: string | null; dues_paid_on?: string | null } | null;
export type MadePayRun = NonNullable<PayRun> & { status: 'DRAFT' | 'FINAL'; totals: PayTotals };

export const madePayRun = (r: PayRun): MadePayRun | null => (r && r.status && r.totals ? (r as MadePayRun) : null);

/** PF (both shares and the charges), ESI (both shares), professional tax and TDS: what is deposited for the month. */
export const duesOf = (t: PayTotals): number => Number(t.pf_employee_paise) + Number(t.pf_employer_paise) + Number(t.pf_admin_paise) + Number(t.esi_employee_paise) + Number(t.esi_employer_paise) + Number(t.pt_paise) + Number(t.tds_paise);

export const PAID_VIA: { id: string; label: string }[] = [{ id: 'BANK', label: 'Bank transfer' }, { id: 'UPI', label: 'UPI' }, { id: 'CASH', label: 'Cash' }];

export const slipLine = (s: PaySlip): string => [
  t('Gross {value}', { value: rupees(Number(s.gross_paise)) }),
  Number(s.gross_paise) > Number(s.net_pay_paise) ? t('-{value} taken off', { value: rupees(Number(s.gross_paise) - Number(s.net_pay_paise)) }) : '',
  s.days_unmarked ? t('{n} days not marked', { n: s.days_unmarked }) : ''
].filter(Boolean).join(' · ');

export const today = (): string => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* Texts new to this screen; each is in all six languages (test/payroll.test.ts). The rest are the staff screen's, already translated. */
export const PAYROLL_TEXTS: string[] = [
  'You do not have access to payroll.', 'Add your people, then set their pay.', 'Net pay to staff', 'Cost to you', 'To deposit: PF, ESI and tax',
  'Pay the staff', 'Staff paid {date}', 'PF, ESI and tax deposited {date}', 'Record PF, ESI and tax deposit',
  'This puts the PF (both shares), ESI, professional tax and TDS into your expenses as one entry, paid today. Do it once you have deposited them.',
  'Paid, and recorded in your expenses as Salaries', 'Recorded in your expenses', 'Some days are not marked', '{n} days have no attendance marked. They are paid as present. Finalise anyway?', 'Finalise anyway',
  'Gross {value}', 'Salary from attendance, PF, ESI and tax', 'Payroll', 'Bank transfer', '-{value} taken off', '{n} days not marked'
];
