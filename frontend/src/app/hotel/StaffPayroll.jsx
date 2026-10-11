/*
 * The monthly payroll sheet: worked out from attendance, adjusted by hand (allowances, deductions) while it is a draft, then finalised. This is a payroll SHEET, not statutory
 * payroll: PF, ESI, professional tax and TDS are not worked out here.
 */
import { useState } from 'react';
import { Download, Pencil, Printer } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api.js';
import { useLoad } from '../../lib/hotel.js';
import { saveCsv } from '../../lib/salon.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, StatCard, Table, Td, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { useAction } from '../salon/parts.jsx';

const rs = (p) => formatCurrency((p || 0) / 100);
const monthName = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const SlipForm = ({ slip, onClose, onSaved }) => {
  const [busy, run] = useAction();
  const [error, setError] = useState('');
  const [f, setF] = useState({ allowances: Number(slip.allowances_paise) / 100 || '', deductions: Number(slip.deductions_paise) / 100 || '', note: slip.note || '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const net = Number(slip.base_pay_paise) / 100 + Number(slip.overtime_pay_paise) / 100 + (Number(f.allowances) || 0) - (Number(f.deductions) || 0);
  const submit = async (e) => {
    e.preventDefault(); setError('');
    const out = await run(() => api(`/hotel/staff/payslips/${slip.payslip_id}`, { method: 'PUT', body: { allowances: Number(f.allowances) || 0, deductions: Number(f.deductions) || 0, note: f.note } }).catch((c) => { setError(c.message); throw c; }), 'Saved');
    if (out) onSaved();
  };
  return (
    <Modal title={`Pay for ${slip.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4"><Alert>{error}</Alert>
        <dl className="space-y-1 text-small"><div className="flex justify-between"><dt className="text-ink-500">Pay for the days worked</dt><dd className="tabular">{rs(slip.base_pay_paise)}</dd></div><div className="flex justify-between"><dt className="text-ink-500">Overtime</dt><dd className="tabular">{rs(slip.overtime_pay_paise)}</dd></div></dl>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ps-a" label="Allowances and bonus"><Input id="ps-a" type="number" min="0" step="any" value={f.allowances} onChange={set('allowances')} autoFocus /></Field>
          <Field id="ps-d" label="Deductions" hint="Advance, fine, loan"><Input id="ps-d" type="number" min="0" step="any" value={f.deductions} onChange={set('deductions')} /></Field>
        </div>
        <Field id="ps-n" label="Note"><Input id="ps-n" value={f.note} onChange={set('note')} placeholder="Festival bonus, salary advance…" /></Field>
        <p className="text-small text-ink-500">To pay: <span className="tabular font-semibold text-ink-900">{formatCurrency(net)}</span></p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div>
      </form>
    </Modal>
  );
};

export default function Payroll() {
  const dialog = useDialog();
  const toast = useToast();
  const dash = useLoad('/hotel/dashboard');
  const [month, setMonth] = useState('');
  const [factor, setFactor] = useState('1.5');
  const [slip, setSlip] = useState(null);
  const [busy, run] = useAction();
  const m = month || (dash.data ? dash.data.business_date.slice(0, 7) : null);
  const r = useLoad(m ? `/hotel/staff/payroll/${m}` : null);
  const run0 = r.data;
  if (!m || !run0) return <ListState loading={r.loading || dash.loading} error={r.error || dash.error} />;
  const made = Boolean(run0.status);
  const final = run0.status === 'FINAL';
  const generate = async () => { const out = await run(() => api('/hotel/staff/payroll', { method: 'POST', body: { month: m, overtime_factor: Number(factor) || 1.5 } }), 'Payroll sheet made'); if (out) r.reload(); };
  const finalize = async () => {
    if (!(await dialog.confirm({ title: `Finalise ${monthName(m)}?`, body: 'The sheet is locked. Allowances, deductions and attendance for the month can no longer change the pay.', confirmLabel: 'Finalise' }))) return;
    try { await api('/hotel/staff/payroll/finalize', { method: 'POST', body: { month: m } }); toast.success('Payroll finalised'); r.reload(); } catch (e) {
      if (e.code === 'UNMARKED_DAYS' && (await dialog.confirm({ title: 'Some days are not marked', body: `${e.message} Finalise anyway?`, confirmLabel: 'Finalise anyway', danger: true }))) {
        try { await api('/hotel/staff/payroll/finalize', { method: 'POST', body: { month: m, force: true } }); toast.success('Payroll finalised'); r.reload(); } catch (e2) { toast.error(e2.message); }
      } else if (e.code !== 'UNMARKED_DAYS') toast.error(e.message);
    }
  };
  const csvRows = (run0.slips || []).map((s) => ({ code: s.emp_code, name: s.name, department: s.department || '', days_present: Number(s.days_present), paid_leave: Number(s.days_paid_leave), weekly_off: s.days_weekly_off, unpaid: Number(s.days_unpaid), unmarked: s.days_unmarked, overtime_hours: (s.overtime_minutes / 60).toFixed(1), base: s.base_pay, overtime: s.overtime_pay, allowances: s.allowances, deductions: s.deductions, net: s.net_pay, bank_account: s.bank_account || '' }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44"><label htmlFor="pr-m" className="mb-1.5 block text-sm font-medium text-ink-700">Month</label><Input id="pr-m" type="month" value={m} onChange={(e) => setMonth(e.target.value)} /></div>
        {!final && made && <Button variant="secondary" onClick={generate} loading={busy}>Refresh from attendance</Button>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {made && <Button variant="secondary" size="sm" onClick={() => saveCsv(`payroll-${m}.csv`, [{ key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'department', label: 'Department' }, { key: 'days_present', label: 'Days present' }, { key: 'paid_leave', label: 'Paid leave' }, { key: 'weekly_off', label: 'Weekly off' }, { key: 'unpaid', label: 'Unpaid days' }, { key: 'unmarked', label: 'Unmarked days' }, { key: 'overtime_hours', label: 'Overtime hours' }, { key: 'base', label: 'Pay' }, { key: 'overtime', label: 'Overtime pay' }, { key: 'allowances', label: 'Allowances' }, { key: 'deductions', label: 'Deductions' }, { key: 'net', label: 'Net pay' }, { key: 'bank_account', label: 'Bank account' }], csvRows)}><Download aria-hidden="true" className="h-4 w-4" />Download CSV</Button>}
          {made && <Button variant="secondary" size="sm" onClick={() => window.print()}><Printer aria-hidden="true" className="h-4 w-4" />Print</Button>}
          {made && !final && <Button size="sm" onClick={finalize}>Finalise</Button>}
        </div>
      </div>

      {!made ? (
        <div className="rounded-(--radius-card) border border-line bg-surface p-6">
          <p className="text-small text-ink-700">There is no payroll sheet for {monthName(m)} yet. Make it from the attendance you have marked.</p>
          <div className="mt-4 flex flex-wrap items-end gap-3"><div className="w-44"><Field id="pr-f" label="Overtime pays" hint="Times the hourly rate"><Input id="pr-f" type="number" min="1" max="5" step="0.25" value={factor} onChange={(e) => setFactor(e.target.value)} /></Field></div><Button onClick={generate} loading={busy}>Make the payroll sheet</Button></div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><StatCard label="To pay" value={rs(run0.total_paise)} note={`${run0.slips.length} people`} /><StatCard label="Status" value={final ? 'Final' : 'Draft'} note={final ? 'Locked' : 'Can still change'} /><StatCard label="Overtime paid at" value={`${Number(run0.overtime_factor)}×`} /><StatCard label="Days not marked" value={run0.unmarked_days} tone={run0.unmarked_days ? 'text-warning' : undefined} note={run0.unmarked_days ? 'Paid as present' : 'All marked'} /></div>
          {!final && dash.data && m >= dash.data.business_date.slice(0, 7) && <p className="text-small text-ink-500">This month is not over, so the sheet shows what has been earned up to yesterday. Refresh it as the days go by.</p>}
          {run0.unmarked_days > 0 && !final && <Alert>{`${run0.unmarked_days} day${run0.unmarked_days === 1 ? '' : 's'} have no attendance marked. They are paid as present. Mark them on the Attendance tab, then refresh.`}</Alert>}
          <div className="overflow-x-auto">
            <Table>
              <Thead><Th>Person</Th><Th className="text-right">Present</Th><Th className="text-right">Leave</Th><Th className="text-right">Off</Th><Th className="text-right">Unpaid</Th><Th className="text-right">Overtime</Th><Th className="text-right">Pay</Th><Th className="text-right">Extras</Th><Th className="text-right">Net</Th><Th></Th></Thead>
              <tbody>{run0.slips.map((s) => (
                <Tr key={s.payslip_id}>
                  <Td><span className="font-medium text-ink-900">{s.name}</span><span className="block text-caption text-ink-500">{s.department || s.designation || ''}{s.days_unmarked > 0 && <Badge tone="warning">{s.days_unmarked} unmarked</Badge>}</span></Td>
                  <Td className="tabular text-right">{Number(s.days_present)}</Td><Td className="tabular text-right">{Number(s.days_paid_leave)}</Td><Td className="tabular text-right">{s.days_weekly_off}</Td><Td className="tabular text-right">{Number(s.days_unpaid)}</Td>
                  <Td className="tabular text-right">{s.overtime_minutes ? `${(s.overtime_minutes / 60).toFixed(1)} h` : '—'}</Td>
                  <Td className="tabular text-right">{rs(Number(s.base_pay_paise) + Number(s.overtime_pay_paise))}</Td>
                  <Td className="tabular text-right text-ink-500">{Number(s.allowances_paise) || Number(s.deductions_paise) ? `${Number(s.allowances_paise) ? `+${rs(s.allowances_paise)}` : ''} ${Number(s.deductions_paise) ? `−${rs(s.deductions_paise)}` : ''}` : '—'}</Td>
                  <Td className="tabular text-right font-semibold text-ink-900">{rs(s.net_pay_paise)}</Td>
                  <Td className="text-right">{!final && <button type="button" aria-label={`Adjust ${s.name}`} onClick={() => setSlip(s)} className="text-ink-500 hover:text-ink-900"><Pencil aria-hidden="true" className="inline h-4 w-4" /></button>}</Td>
                </Tr>))}
                <Tr className="bg-surface-2/60 font-semibold"><Td>Total</Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td><Td></Td><Td className="tabular text-right">{rs(run0.total_paise)}</Td><Td></Td></Tr>
              </tbody>
            </Table>
          </div>
          <p className="text-caption text-ink-500">This is a payroll sheet: pay for the days worked, overtime, and what you add or take off. PF, ESI, professional tax and TDS are not worked out here.</p>
        </>
      )}
      {slip && <SlipForm slip={slip} onClose={() => setSlip(null)} onSaved={() => { setSlip(null); r.reload(); }} />}
    </div>
  );
}
