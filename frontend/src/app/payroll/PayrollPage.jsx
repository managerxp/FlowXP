/*
 * Payroll (add-on): the monthly run with PF, ESI, professional tax, TDS and loan recovery on every payslip; each person's pay set-up; loans and advances; the rules
 * (PF, ESI, professional tax slabs); and the team (people, roster, attendance, leave) behind it. Money is in paise from the server.
 */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Pencil, Plus, Printer } from 'lucide-react';
import { api, formatCurrency } from '../../lib/api.js';
import { useLoad } from '../../lib/salon.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { regionsFor } from '../../lib/states.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, StatCard, Table, Td, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { Panel, Tabs, useAction } from '../salon/parts.jsx';
import Staff from '../hr/Staff.jsx';
import { payslipHtml } from './payslipHtml.js';

const rs = (p) => formatCurrency(Number(p || 0) / 100);   // every amount from the API is in paise
const paiseToRupees = (p) => (p == null || p === '' ? '' : String(Number(p) / 100));
const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
const thisMonth = () => new Date().toISOString().slice(0, 7);

const download = (filename, text) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
};

const Toggle = ({ id, label, hint, checked, onChange }) => (
  <label htmlFor={id} className="flex items-start gap-3 rounded-lg border border-line p-3">
    <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4" />
    <span><span className="block text-small font-medium text-ink-900">{label}</span>{hint && <span className="block text-caption text-ink-500">{hint}</span>}</span>
  </label>
);

/* ── the run ───────────────────────────────────────────────────────────── */

const SlipForm = ({ slip, onClose, onSaved }) => {
  const toast = useToast();
  const [busy, run] = useAction();
  const [f, setF] = useState({ allowances: paiseToRupees(slip.allowances_paise), deductions: paiseToRupees(slip.deductions_paise), note: slip.note || '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    const out = await run(() => api(`/payroll/payslips/${slip.payslip_id}`, { method: 'PUT', body: { allowances: Number(f.allowances) || 0, deductions: Number(f.deductions) || 0, note: f.note } }), 'Saved');
    if (out) onSaved(); else toast.error('Could not save');
  };
  return (
    <Modal title={`Adjust ${slip.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-small text-ink-500">Add a bonus or reimbursement, or take off something else. PF, ESI, professional tax, TDS and the loan instalment are worked out again by themselves.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ps-a" label="Added to pay (Rs)" hint="Bonus, incentive, reimbursement"><Input id="ps-a" type="number" min="0" step="0.01" value={f.allowances} onChange={set('allowances')} /></Field>
          <Field id="ps-d" label="Other deduction (Rs)" hint="Fine, damage, anything else"><Input id="ps-d" type="number" min="0" step="0.01" value={f.deductions} onChange={set('deductions')} /></Field>
        </div>
        <Field id="ps-n" label="Note"><Input id="ps-n" value={f.note} onChange={set('note')} maxLength={200} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div>
      </form>
    </Modal>
  );
};

const FILES = [['BANK', 'Bank transfer sheet'], ['PF', 'PF contribution'], ['ESI', 'ESI contribution'], ['PT', 'Professional tax'], ['REGISTER', 'Payroll register']];

const Run = ({ settings }) => {
  const dialog = useDialog();
  const toast = useToast();
  const { business } = useAuth();
  const [month, setMonth] = useState(thisMonth());
  const [slip, setSlip] = useState(null);
  const [via, setVia] = useState('BANK');
  const [busy, run] = useAction();
  const r = useLoad(`/payroll/runs/${month}`);
  const data = r.data;
  const made = Boolean(data?.status);
  const final = data?.status === 'FINAL';
  const generate = async () => { const out = await run(() => api('/payroll/runs', { method: 'POST', body: { month } }), 'Payroll made'); if (out) r.reload(); };
  const finalize = async (force = false) => {
    if (!force && !(await dialog.confirm({ title: `Finalise ${monthName(month)}?`, body: 'The payroll is locked: pay, deductions and loan instalments no longer change, and the instalments are taken off the loans.', confirmLabel: 'Finalise' }))) return;
    try { await api('/payroll/runs/finalize', { method: 'POST', body: { month, force } }); toast.success('Payroll finalised'); r.reload(); } catch (e) {
      if (e.code === 'UNMARKED_DAYS' && (await dialog.confirm({ title: 'Some days are not marked', body: `${e.message} Finalise anyway?`, confirmLabel: 'Finalise anyway', danger: true }))) finalize(true);
      else if (e.code !== 'UNMARKED_DAYS') toast.error(e.message);
    }
  };
  const paid = async () => {
    const out = await run(() => api('/payroll/runs/paid', { method: 'POST', body: { month, paid_on: new Date().toISOString().slice(0, 10), via } }), 'Paid, and recorded in your expenses as Salaries');
    if (out) r.reload();
  };
  const dues = async () => {
    if (!(await dialog.confirm({ title: 'Record the PF, ESI and tax deposit?', body: 'This puts the PF (both shares), ESI, professional tax and TDS for the month into your expenses as one entry, as paid today. Do it once you have deposited them.', confirmLabel: 'Record it' }))) return;
    const out = await run(() => api('/payroll/runs/dues', { method: 'POST', body: { month, paid_on: new Date().toISOString().slice(0, 10), via } }), 'Recorded in your expenses');
    if (out) r.reload();
  };
  const file = async (kind) => { try { const out = await api(`/payroll/runs/${month}/file/${kind}`); download(out.filename, out.csv); } catch (e) { toast.error(e.message); } };
  const print = (s) => { const w = window.open('', '_blank'); if (!w) return; w.document.write(payslipHtml(s, business, month, monthName(month))); w.document.close(); w.focus(); w.print(); };
  const t = data?.totals || {};

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44"><label htmlFor="pr-m" className="mb-1.5 block text-sm font-medium text-ink-700">Month</label><Input id="pr-m" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></div>
        {made && !final && <Button variant="secondary" onClick={generate} loading={busy}>Refresh from attendance</Button>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {made && !final && <Button size="sm" onClick={() => finalize(false)}>Finalise</Button>}
          {final && (!data.paid_on || !data.dues_paid_on) && <div className="w-36"><Select id="pr-via" aria-label="Paid by" value={via} onChange={(e) => setVia(e.target.value)}><option value="BANK">Bank transfer</option><option value="UPI">UPI</option><option value="CASH">Cash</option></Select></div>}
          {final && !data.paid_on && <Button size="sm" onClick={paid} loading={busy}>Pay the staff</Button>}
          {final && data.paid_on && <Badge tone="success">Staff paid {data.paid_on}</Badge>}
          {final && !data.dues_paid_on && Number(t.pf_employee_paise) + Number(t.esi_employee_paise) + Number(t.pt_paise) + Number(t.tds_paise) > 0 && <Button size="sm" variant="secondary" onClick={dues} loading={busy}>Record PF, ESI and tax deposit</Button>}
          {final && data.dues_paid_on && <Badge tone="success">PF, ESI and tax deposited {data.dues_paid_on}</Badge>}
        </div>
      </div>
      <ListState loading={r.loading && !data} error={r.error} />
      {data && !made && (
        <div className="rounded-(--radius-card) border border-line bg-surface p-6">
          <p className="text-small text-ink-700">There is no payroll for {monthName(month)} yet. It is made from the attendance you marked and each person&apos;s pay set-up.</p>
          <div className="mt-4"><Button onClick={generate} loading={busy}>Make the payroll</Button></div>
        </div>
      )}
      {made && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Net pay to staff" value={rs(t.net_pay_paise)} note={`${data.slips.length} people`} />
            <StatCard label="Cost to you" value={rs(t.employer_cost_paise)} note="Pay plus the employer's PF and ESI" />
            <StatCard label="PF to deposit" value={rs(Number(t.pf_employee_paise) + Number(t.pf_employer_paise) + Number(t.pf_admin_paise))} note="Both shares and charges" />
            <StatCard label="ESI, tax and TDS" value={rs(Number(t.esi_employee_paise) + Number(t.esi_employer_paise) + Number(t.pt_paise) + Number(t.tds_paise))} note="To deposit" />
          </div>
          {!final && data.unmarked_days > 0 && <Alert>{`${data.unmarked_days} day${data.unmarked_days === 1 ? '' : 's'} have no attendance marked. They are paid as present. Mark them on the Team tab, then refresh.`}</Alert>}
          <div className="overflow-x-auto">
            <Table>
              <Thead><Th>Person</Th><Th className="text-right">Paid days</Th><Th className="text-right">Gross</Th><Th className="text-right">PF</Th><Th className="text-right">ESI</Th><Th className="text-right">Prof. tax</Th><Th className="text-right">TDS</Th><Th className="text-right">Loan</Th><Th className="text-right">Other</Th><Th className="text-right">Net pay</Th><Th><span className="sr-only">Actions</span></Th></Thead>
              <tbody>
                {data.slips.map((s) => (
                  <Tr key={s.payslip_id}>
                    <Td><span className="font-medium text-ink-900">{s.name}</span><span className="block text-caption text-ink-500">{s.department || s.designation || ''}{s.days_unmarked > 0 && <Badge tone="warning">{s.days_unmarked} unmarked</Badge>}</span></Td>
                    <Td className="tabular text-right">{Number(s.days_present) + Number(s.days_paid_leave) + Number(s.days_weekly_off)}</Td>
                    <Td className="tabular text-right">{rs(s.gross_paise)}</Td>
                    <Td className="tabular text-right">{Number(s.pf_employee_paise) ? rs(s.pf_employee_paise) : '—'}</Td>
                    <Td className="tabular text-right">{Number(s.esi_employee_paise) ? rs(s.esi_employee_paise) : '—'}</Td>
                    <Td className="tabular text-right">{Number(s.pt_paise) ? rs(s.pt_paise) : '—'}</Td>
                    <Td className="tabular text-right">{Number(s.tds_paise) ? rs(s.tds_paise) : '—'}</Td>
                    <Td className="tabular text-right">{Number(s.loan_recovery_paise) ? rs(s.loan_recovery_paise) : '—'}</Td>
                    <Td className="tabular text-right">{Number(s.deductions_paise) ? rs(s.deductions_paise) : '—'}</Td>
                    <Td className="tabular text-right font-semibold text-ink-900">{rs(s.net_pay_paise)}</Td>
                    <Td className="whitespace-nowrap text-right">
                      <button type="button" aria-label={`Payslip of ${s.name}`} onClick={() => print(s)} className="mr-2 text-ink-500 hover:text-ink-900"><Printer aria-hidden="true" className="h-4 w-4" /></button>
                      {!final && <button type="button" aria-label={`Adjust ${s.name}`} onClick={() => setSlip(s)} className="text-ink-500 hover:text-ink-900"><Pencil aria-hidden="true" className="h-4 w-4" /></button>}
                    </Td>
                  </Tr>
                ))}
                <Tr className="bg-surface-2/60 font-semibold"><Td>Total</Td><Td /><Td className="tabular text-right">{rs(t.gross_paise)}</Td><Td className="tabular text-right">{rs(t.pf_employee_paise)}</Td><Td className="tabular text-right">{rs(t.esi_employee_paise)}</Td><Td className="tabular text-right">{rs(t.pt_paise)}</Td><Td className="tabular text-right">{rs(t.tds_paise)}</Td><Td className="tabular text-right">{rs(t.loan_recovery_paise)}</Td><Td /><Td className="tabular text-right">{rs(t.net_pay_paise)}</Td><Td /></Tr>
              </tbody>
            </Table>
          </div>
          <Panel title="Files" lead="Download them for the bank, the PF and ESI portals, your CA and your records.">
            <div className="flex flex-wrap gap-2">{FILES.map(([kind, label]) => <Button key={kind} variant="secondary" size="sm" onClick={() => file(kind)}><Download aria-hidden="true" className="h-4 w-4" />{label}</Button>)}</div>
          </Panel>
          <p className="text-caption text-ink-500">Paying the staff and depositing PF, ESI and tax are recorded in your expenses (Salaries, and Payroll taxes and contributions), so your profit, dashboard and cash and bank accounts follow. TDS is the monthly figure you set for each person; it is not worked out. Check the PF, ESI and professional tax rules on the Rules tab against what applies to you.</p>
        </>
      )}
      {slip && <SlipForm slip={slip} onClose={() => setSlip(null)} onSaved={() => { setSlip(null); r.reload(); }} />}
    </div>
  );
};

/* ── each person's pay set-up ──────────────────────────────────────────── */

const ProfileForm = ({ p, settings, onClose, onSaved }) => {
  const toast = useToast();
  const [busy, run] = useAction();
  const [f, setF] = useState({
    basic: paiseToRupees(p.basic_paise), hra: paiseToRupees(p.hra_paise), pf_applicable: p.pf_applicable, esi_applicable: p.esi_applicable, pt_applicable: p.pt_applicable,
    pan: p.pan || '', uan: p.uan || '', esi_number: p.esi_number || '', ifsc: p.ifsc || '', gender: p.gender || '', tds: paiseToRupees(p.tds_monthly_paise)
  });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const tick = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const gross = Number(p.salary_paise) / 100;
  const basic = f.basic === '' ? Math.round((gross * Number(settings.default_basic_pct)) / 100) : Number(f.basic);
  const submit = async (e) => {
    e.preventDefault();
    const out = await run(() => api(`/payroll/profiles/${p.employee_id}`, { method: 'PUT', body: {
      basic: f.basic === '' ? null : Number(f.basic), hra: Number(f.hra) || 0, pf_applicable: f.pf_applicable, esi_applicable: f.esi_applicable, pt_applicable: f.pt_applicable,
      pan: f.pan, uan: f.uan, esi_number: f.esi_number, ifsc: f.ifsc, gender: f.gender, tds: Number(f.tds) || 0
    } }), 'Saved');
    if (out) onSaved(); else toast.error('Could not save');
  };
  return (
    <Modal title={`Pay set-up: ${p.name}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-small text-ink-500">{p.pay_type === 'DAILY' ? 'Paid by the day.' : `Monthly pay ${rs(p.salary_paise)}. Change it in the Team tab, under People.`} The basic is what PF is worked out on; the rest of the pay is allowances.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pf-b" label="Basic (Rs a month)" hint={`Empty = ${settings.default_basic_pct}% of the pay (Rs ${basic})`}><Input id="pf-b" type="number" min="0" step="0.01" value={f.basic} onChange={set('basic')} /></Field>
          <Field id="pf-h" label="HRA (Rs a month)"><Input id="pf-h" type="number" min="0" step="0.01" value={f.hra} onChange={set('hra')} /></Field>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Toggle id="pf-pf" label="PF" hint={settings.pf_enabled ? '' : 'Switch PF on in Rules first'} checked={f.pf_applicable} onChange={tick('pf_applicable')} />
          <Toggle id="pf-esi" label="ESI" hint={settings.esi_enabled ? 'Only while pay is within the ceiling' : 'Switch ESI on in Rules first'} checked={f.esi_applicable} onChange={tick('esi_applicable')} />
          <Toggle id="pf-pt" label="Professional tax" hint={settings.pt_enabled ? '' : 'Switch it on in Rules first'} checked={f.pt_applicable} onChange={tick('pt_applicable')} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pf-pan" label="PAN"><Input id="pf-pan" value={f.pan} onChange={set('pan')} maxLength={10} className="uppercase" /></Field>
          <Field id="pf-uan" label="UAN (PF number)"><Input id="pf-uan" value={f.uan} onChange={set('uan')} maxLength={12} /></Field>
          <Field id="pf-esin" label="ESI number"><Input id="pf-esin" value={f.esi_number} onChange={set('esi_number')} maxLength={17} /></Field>
          <Field id="pf-ifsc" label="Bank IFSC" hint="With the account number, for the bank sheet"><Input id="pf-ifsc" value={f.ifsc} onChange={set('ifsc')} maxLength={11} className="uppercase" /></Field>
          <Field id="pf-g" label="Gender" hint="Some states tax men and women differently"><Select id="pf-g" value={f.gender} onChange={set('gender')}><option value="">Not set</option><option value="M">Male</option><option value="F">Female</option></Select></Field>
          <Field id="pf-tds" label="TDS each month (Rs)" hint="The figure your CA gives; taken off every month"><Input id="pf-tds" type="number" min="0" step="0.01" value={f.tds} onChange={set('tds')} /></Field>
        </div>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div>
      </form>
    </Modal>
  );
};

const People = ({ settings }) => {
  const r = useLoad('/payroll/profiles');
  const [edit, setEdit] = useState(null);
  const rows = r.data || [];
  return (
    <div className="space-y-4">
      <p className="text-small text-ink-500">Everyone on the team, with how their pay is split and which deductions apply. Add people and set their pay on the Team tab.</p>
      <ListState loading={r.loading && !r.data} error={r.error} empty={!rows.length && !r.loading} emptyLabel="No one yet. Add your people on the Team tab." />
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <Thead><Th>Person</Th><Th className="text-right">Pay</Th><Th>Deductions</Th><Th>Numbers</Th><Th className="text-right">TDS</Th><Th className="text-right">Owes</Th><Th><span className="sr-only">Edit</span></Th></Thead>
            <tbody>{rows.map((p) => (
              <Tr key={p.employee_id}>
                <Td><span className="font-medium text-ink-900">{p.name}</span><span className="block text-caption text-ink-500">{p.designation || p.emp_code}</span></Td>
                <Td className="tabular text-right">{rs(p.salary_paise)}{p.pay_type === 'DAILY' ? ' / day' : ''}</Td>
                <Td>{[p.pf_applicable && 'PF', p.esi_applicable && 'ESI', p.pt_applicable && 'Tax'].filter(Boolean).join(' · ') || '—'}</Td>
                <Td className="text-small text-ink-500">{[p.uan && `UAN ${p.uan}`, p.pan && p.pan, p.ifsc].filter(Boolean).join(' · ') || <Badge tone="warning">Not filled</Badge>}</Td>
                <Td className="tabular text-right">{Number(p.tds_monthly_paise) ? rs(p.tds_monthly_paise) : '—'}</Td>
                <Td className="tabular text-right">{Number(p.loan_outstanding_paise) ? rs(p.loan_outstanding_paise) : '—'}</Td>
                <Td className="text-right"><button type="button" aria-label={`Edit ${p.name}`} onClick={() => setEdit(p)} className="text-ink-500 hover:text-ink-900"><Pencil aria-hidden="true" className="h-4 w-4" /></button></Td>
              </Tr>))}
            </tbody>
          </Table>
        </div>
      )}
      {edit && <ProfileForm p={edit} settings={settings} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); r.reload(); }} />}
    </div>
  );
};

/* ── loans and advances ────────────────────────────────────────────────── */

const LoanForm = ({ people, onClose, onSaved }) => {
  const toast = useToast();
  const [busy, run] = useAction();
  const [f, setF] = useState({ employee_id: '', kind: 'ADVANCE', amount: '', emi: '', taken_on: new Date().toISOString().slice(0, 10), note: '', method: 'CASH' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    const out = await run(() => api('/payroll/loans', { method: 'POST', body: { employee_id: Number(f.employee_id), kind: f.kind, amount: Number(f.amount), emi: Number(f.emi), taken_on: f.taken_on, note: f.note, method: f.method } }), 'Saved');
    if (out) onSaved(); else toast.error('Could not save');
  };
  return (
    <Modal title="Give an advance or loan" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field id="ln-e" label="Person"><Select id="ln-e" value={f.employee_id} onChange={set('employee_id')} required><option value="">Choose</option>{people.map((p) => <option key={p.employee_id} value={p.employee_id}>{p.name}</option>)}</Select></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ln-k" label="Kind"><Select id="ln-k" value={f.kind} onChange={set('kind')}><option value="ADVANCE">Salary advance</option><option value="LOAN">Loan</option></Select></Field>
          <Field id="ln-d" label="Given on"><Input id="ln-d" type="date" value={f.taken_on} onChange={set('taken_on')} required /></Field>
          <Field id="ln-a" label="Amount (Rs)"><Input id="ln-a" type="number" min="1" step="0.01" value={f.amount} onChange={set('amount')} required /></Field>
          <Field id="ln-m" label="Taken off each month (Rs)" hint="The last instalment is whatever is left"><Input id="ln-m" type="number" min="1" step="0.01" value={f.emi} onChange={set('emi')} required /></Field>
        </div>
        <Field id="ln-pm" label="Given by" hint="Recorded in your expenses as Staff advances"><Select id="ln-pm" value={f.method} onChange={set('method')}><option value="CASH">Cash</option><option value="UPI">UPI</option><option value="BANK_TRANSFER">Bank transfer</option></Select></Field>
        <Field id="ln-n" label="Note"><Input id="ln-n" value={f.note} onChange={set('note')} maxLength={200} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={busy}>Save</Button></div>
      </form>
    </Modal>
  );
};

const Loans = () => {
  const toast = useToast();
  const dialog = useDialog();
  const r = useLoad('/payroll/loans');
  const people = useLoad('/payroll/profiles');
  const [adding, setAdding] = useState(false);
  const rows = r.data || [];
  const close = async (l) => {
    if (!(await dialog.confirm({ title: `Close ${l.name}'s ${l.kind === 'LOAN' ? 'loan' : 'advance'}?`, body: 'No more instalments are taken off. What is left unpaid is not recovered.', confirmLabel: 'Close it', danger: true }))) return;
    try { await api(`/payroll/loans/${l.loan_id}/close`, { method: 'POST' }); r.reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-small text-ink-500">Advances and loans come off the salary in instalments, shown on the payslip, until they are paid.</p><Button onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" />Give an advance or loan</Button></div>
      <ListState loading={r.loading && !r.data} error={r.error} empty={!rows.length && !r.loading} emptyLabel="No advances or loans." />
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <Table>
            <Thead><Th>Person</Th><Th>Given</Th><Th className="text-right">Amount</Th><Th className="text-right">Each month</Th><Th className="text-right">Left</Th><Th>Status</Th><Th><span className="sr-only">Close</span></Th></Thead>
            <tbody>{rows.map((l) => (
              <Tr key={l.loan_id}>
                <Td><span className="font-medium text-ink-900">{l.name}</span><span className="block text-caption text-ink-500">{l.kind === 'LOAN' ? 'Loan' : 'Advance'}{l.note ? ` · ${l.note}` : ''}</span></Td>
                <Td>{l.taken_on}</Td><Td className="tabular text-right">{rs(l.principal_paise)}</Td><Td className="tabular text-right">{rs(l.emi_paise)}</Td><Td className="tabular text-right">{rs(l.outstanding_paise)}</Td>
                <Td><Badge tone={l.status === 'ACTIVE' ? 'warning' : 'neutral'}>{l.status === 'ACTIVE' ? 'Running' : 'Closed'}</Badge></Td>
                <Td className="text-right">{l.status === 'ACTIVE' && <Button size="sm" variant="secondary" onClick={() => close(l)}>Close</Button>}</Td>
              </Tr>))}
            </tbody>
          </Table>
        </div>
      )}
      {adding && <LoanForm people={people.data || []} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); r.reload(); }} />}
    </div>
  );
};

/* ── the rules ─────────────────────────────────────────────────────────── */

const Rules = ({ settings, reload }) => {
  const toast = useToast();
  const [busy, run] = useAction();
  const [f, setF] = useState(() => ({
    pf_enabled: settings.pf_enabled, pf_cap_on_ceiling: settings.pf_cap_on_ceiling, pf_ceiling: paiseToRupees(settings.pf_ceiling_paise), esi_enabled: settings.esi_enabled, esi_ceiling: paiseToRupees(settings.esi_ceiling_paise),
    pt_enabled: settings.pt_enabled, pt_state: settings.pt_state || '', default_basic_pct: String(settings.default_basic_pct), overtime_factor: String(settings.overtime_factor),
    establishment_pf_code: settings.establishment_pf_code || '', establishment_esi_code: settings.establishment_esi_code || ''
  }));
  const [slabs, setSlabs] = useState(() => settings.slabs.map((s) => ({ from: paiseToRupees(s.from_paise), to: paiseToRupees(s.to_paise), tax: paiseToRupees(s.tax_paise), february: paiseToRupees(s.february_paise) })));
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const tick = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const setSlab = (i, k) => (e) => setSlabs((all) => all.map((s, j) => (j === i ? { ...s, [k]: e.target.value } : s)));
  const states = regionsFor('India');
  const body = () => ({
    pf_enabled: f.pf_enabled, pf_cap_on_ceiling: f.pf_cap_on_ceiling, pf_ceiling: Number(f.pf_ceiling) || 15000, esi_enabled: f.esi_enabled, esi_ceiling: Number(f.esi_ceiling) || 21000, pt_enabled: f.pt_enabled,
    pt_state: f.pt_state, default_basic_pct: Number(f.default_basic_pct) || 50, overtime_factor: Number(f.overtime_factor) || 1.5, establishment_pf_code: f.establishment_pf_code, establishment_esi_code: f.establishment_esi_code
  });
  const save = async (extra = {}) => {
    const out = await run(() => api('/payroll/settings', { method: 'PUT', body: { ...body(), ...extra } }), 'Saved');
    if (out) { if (extra.preset) setSlabs(out.slabs.map((s) => ({ from: paiseToRupees(s.from_paise), to: paiseToRupees(s.to_paise), tax: paiseToRupees(s.tax_paise), february: paiseToRupees(s.february_paise) }))); reload(); }
  };
  const preset = async () => { try { await api('/payroll/settings', { method: 'PUT', body: { ...body(), preset: true } }).then((out) => { setSlabs(out.slabs.map((s) => ({ from: paiseToRupees(s.from_paise), to: paiseToRupees(s.to_paise), tax: paiseToRupees(s.tax_paise), february: paiseToRupees(s.february_paise) }))); toast.success('The usual slabs are filled in. Check them against the state notification.'); reload(); }); } catch (e) { toast.error(e.message); } };
  const saveSlabs = () => save({ slabs: slabs.map((s) => ({ from: Number(s.from) || 0, to: s.to === '' ? null : Number(s.to), tax: Number(s.tax) || 0, february: s.february === '' ? null : Number(s.february) })) });
  return (
    <div className="space-y-5">
      <Panel title="What to work out" lead="Switch on what applies to you, then tick it for each person on the People tab.">
        <div className="grid gap-3 sm:grid-cols-3">
          <Toggle id="ru-pf" label="Provident fund (PF)" hint="12% of the basic from the person, 12% from you" checked={f.pf_enabled} onChange={tick('pf_enabled')} />
          <Toggle id="ru-esi" label="ESI" hint="For pay within the ceiling: 0.75% and 3.25%" checked={f.esi_enabled} onChange={tick('esi_enabled')} />
          <Toggle id="ru-pt" label="Professional tax" hint="By the slabs below" checked={f.pt_enabled} onChange={tick('pt_enabled')} />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field id="ru-pfc" label="PF wage ceiling (Rs)"><Input id="ru-pfc" type="number" min="0" value={f.pf_ceiling} onChange={set('pf_ceiling')} /></Field>
          <Field id="ru-esic" label="ESI pay ceiling (Rs)"><Input id="ru-esic" type="number" min="0" value={f.esi_ceiling} onChange={set('esi_ceiling')} /></Field>
          <Field id="ru-bp" label="Basic is this % of pay" hint="When a person's basic is not set"><Input id="ru-bp" type="number" min="0" max="100" value={f.default_basic_pct} onChange={set('default_basic_pct')} /></Field>
          <Field id="ru-ot" label="Overtime pays" hint="Times the hourly rate"><Input id="ru-ot" type="number" min="1" max="4" step="0.25" value={f.overtime_factor} onChange={set('overtime_factor')} /></Field>
        </div>
        <div className="mt-3"><Toggle id="ru-cap" label="Work PF only on wages up to the ceiling" hint="Untick to work it on the whole basic" checked={f.pf_cap_on_ceiling} onChange={tick('pf_cap_on_ceiling')} /></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field id="ru-pfn" label="Your PF establishment code"><Input id="ru-pfn" value={f.establishment_pf_code} onChange={set('establishment_pf_code')} maxLength={30} /></Field>
          <Field id="ru-esn" label="Your ESI code"><Input id="ru-esn" value={f.establishment_esi_code} onChange={set('establishment_esi_code')} maxLength={30} /></Field>
        </div>
        <div className="mt-4 flex justify-end"><Button onClick={() => save()} loading={busy}>Save</Button></div>
      </Panel>
      <Panel title="Professional tax slabs" lead="Pick your state and fill in its usual slabs, then change any row. The tax is taken by the month's gross pay; February can differ.">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-64"><Field id="ru-st" label="State"><Select id="ru-st" value={f.pt_state} onChange={set('pt_state')}><option value="">Choose a state</option>{states.map((s) => <option key={s.shortCode} value={s.name}>{s.name}</option>)}</Select></Field></div>
          <Button variant="secondary" onClick={preset} disabled={!f.pt_state}>Fill in the usual slabs</Button>
        </div>
        <div className="mt-4 space-y-2">
          {slabs.map((s, i) => (
            <div key={i} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
              <Field id={`sl-f${i}`} label={i ? '' : 'Pay from (Rs)'}><Input id={`sl-f${i}`} type="number" min="0" value={s.from} onChange={setSlab(i, 'from')} /></Field>
              <Field id={`sl-t${i}`} label={i ? '' : 'Up to (Rs)'}><Input id={`sl-t${i}`} type="number" min="0" placeholder="No limit" value={s.to} onChange={setSlab(i, 'to')} /></Field>
              <Field id={`sl-x${i}`} label={i ? '' : 'Tax a month (Rs)'}><Input id={`sl-x${i}`} type="number" min="0" value={s.tax} onChange={setSlab(i, 'tax')} /></Field>
              <Field id={`sl-b${i}`} label={i ? '' : 'February (Rs)'}><Input id={`sl-b${i}`} type="number" min="0" placeholder="Same" value={s.february} onChange={setSlab(i, 'february')} /></Field>
              <Button variant="secondary" size="sm" onClick={() => setSlabs((all) => all.filter((_, j) => j !== i))}>Remove</Button>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2"><Button variant="secondary" onClick={() => setSlabs((all) => [...all, { from: '', to: '', tax: '', february: '' }])}><Plus aria-hidden="true" className="h-4 w-4" />Add a slab</Button><Button onClick={saveSlabs} loading={busy}>Save the slabs</Button></div>
      </Panel>
    </div>
  );
};

/* ── the page ──────────────────────────────────────────────────────────── */

export default function PayrollPage() {
  const [params, setParams] = useSearchParams();
  const settings = useLoad('/payroll/settings');
  const tabs = [{ key: 'run', label: 'Payroll' }, { key: 'people', label: 'People' }, { key: 'loans', label: 'Advances and loans' }, { key: 'rules', label: 'Rules' }, { key: 'team', label: 'Team' }];
  const tab = tabs.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'run';
  return (
    <div>
      <PageHeader title="Payroll" lead="Pay your team on time: the salary for each month from attendance, with PF, ESI, professional tax, TDS and loan instalments, payslips, and the files for the bank and the PF and ESI portals." />
      <Tabs tabs={tabs} value={tab} onChange={(k) => setParams(k === 'run' ? {} : { tab: k })} />
      {tab === 'team' ? <Staff noPayTab /> : (
        <>
          <ListState loading={settings.loading && !settings.data} error={settings.error} />
          {settings.data && tab === 'run' && <Run settings={settings.data} />}
          {settings.data && tab === 'people' && <People settings={settings.data} />}
          {settings.data && tab === 'loans' && <Loans />}
          {settings.data && tab === 'rules' && <Rules settings={settings.data} reload={settings.reload} />}
        </>
      )}
    </div>
  );
}
