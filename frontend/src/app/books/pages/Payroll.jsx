/* Payroll for any business: the people you pay a salary, then a run for each month that posts to the books, pays the staff and deposits PF, ESI, professional tax and TDS. */
import { useState } from 'react';
import { useLoad } from '../api.js';
import { inr, today } from '../lib.js';
import { useSession } from '../session.jsx';
import { Async, Badge, Btn, Card, Empty, Err, Field, Money, Note, Page, Table, useAction } from '../ui.jsx';

const MODES = { BANK: 'Bank', CASH: 'Cash', UPI: 'UPI', CARD: 'Card' };
const blank = () => ({ id: '', name: '', designation: '', monthlyPay: '', basic: '', pf: false, esi: false, pt: '', tds: '' });
const rupees = (minor) => (minor == null ? '' : String(Number(minor) / 100));
const thisMonth = () => today().slice(0, 7);

const People = ({ load, o, org }) => {
  const [f, setF] = useState(null);
  const a = useAction();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const edit = (p) => setF({ id: p.id, name: p.name, designation: p.designation || '', monthlyPay: rupees(p.monthly_pay_minor), basic: rupees(p.basic_minor), pf: p.pf, esi: p.esi, pt: rupees(p.pt_minor), tds: rupees(p.tds_minor), active: p.active });
  const save = (e) => {
    e.preventDefault();
    const body = { name: f.name, monthlyPay: f.monthlyPay, pf: f.pf, esi: f.esi, pt: f.pt || '0', tds: f.tds || '0', active: f.active !== false, ...(f.designation && { designation: f.designation }), ...(f.basic && { basic: f.basic }) };
    a.run(async () => { await o(`/payroll/employees${f.id ? `/${f.id}` : ''}`, { method: f.id ? 'PUT' : 'POST', body }); setF(null); await load.reload(); }, 'Saved.');
  };
  return (
    <Card title="People on a salary" actions={<Btn onClick={() => { a.setError(''); setF(blank()); }}>Add a person</Btn>}>
      <Note>{a.done}</Note>
      {f && (
        <form className="form" onSubmit={save}><Err>{a.error}</Err>
          <Field label="Name"><input value={f.name} onChange={set('name')} required maxLength={120} /></Field>
          <Field label="Job" hint="Optional"><input value={f.designation} onChange={set('designation')} maxLength={80} /></Field>
          <Field label="Monthly pay (₹)"><input inputMode="decimal" value={f.monthlyPay} onChange={set('monthlyPay')} required /></Field>
          <Field label="Basic (₹)" hint="Leave empty to take half of the pay. PF is worked out on this."><input inputMode="decimal" value={f.basic} onChange={set('basic')} /></Field>
          <Field label="Professional tax a month (₹)" hint="From your state's slab"><input inputMode="decimal" value={f.pt} onChange={set('pt')} /></Field>
          <Field label="TDS a month (₹)" hint="The figure your CA gives you"><input inputMode="decimal" value={f.tds} onChange={set('tds')} /></Field>
          <p className="check"><input id="pf" type="checkbox" checked={f.pf} onChange={set('pf')} /><label htmlFor="pf">Provident fund (PF)</label></p>
          <p className="check"><input id="esi" type="checkbox" checked={f.esi} onChange={set('esi')} /><label htmlFor="esi">ESI (pay up to ₹21,000)</label></p>
          {f.id && <p className="check"><input id="act" type="checkbox" checked={f.active !== false} onChange={set('active')} /><label htmlFor="act">Still working here</label></p>}
          <div className="wide actions"><Btn kind="primary" busy={a.busy}>Save</Btn><Btn type="button" onClick={() => setF(null)}>Cancel</Btn></div>
        </form>
      )}
      <Async load={load}>{(rows) => (
        <Table head={['Name', 'Job', '>Monthly pay', 'PF', 'ESI', '']} empty={!rows.length && <Empty>Nobody yet. Add the people you pay a salary to.</Empty>}>
          {rows.map((p) => (
            <tr key={p.id}><td>{p.name}{!p.active && <> <Badge status="VOID" /></>}</td><td>{p.designation}</td><td className="r"><Money v={p.monthly_pay_minor} /></td><td>{p.pf ? 'Yes' : ''}</td><td>{p.esi ? 'Yes' : ''}</td>
              <td className="r"><Btn className="btn small" onClick={() => edit(p)}>Edit</Btn></td></tr>
          ))}
        </Table>
      )}</Async>
    </Card>
  );
};

const Month = ({ people, o, org }) => {
  const [month, setMonth] = useState(thisMonth());
  const [typed, setTyped] = useState({});
  const [via, setVia] = useState('BANK');
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const a = useAction();
  const load = useLoad(() => o(`/payroll/runs/${month}`), [org.id, month]);
  const run = load.data;
  const posted = run?.status === 'POSTED';
  const set = (id, k) => (e) => setTyped({ ...typed, [id]: { ...typed[id], [k]: e.target.value } });
  const step = (path, body, done) => a.run(async () => { await o(`/payroll/runs/${month}${path}`, { method: 'POST', body }); await load.reload(); }, done);
  const make = () => step('', { lines: Object.entries(typed).map(([employeeId, v]) => ({ employeeId, ...(v.daysAway !== undefined && v.daysAway !== '' && { daysAway: Number(v.daysAway) }), ...(v.bonus !== undefined && v.bonus !== '' && { bonus: v.bonus }) })) }, 'Worked out. Check the figures, then post it.');
  const sum = (k) => (run?.lines || []).reduce((s, l) => s + Number(l[k]), 0);
  const dues = sum('pf_employee_minor') + sum('pf_employer_minor') + sum('pf_admin_minor') + sum('esi_employee_minor') + sum('esi_employer_minor') + sum('pt_minor') + sum('tds_minor');
  const pay = { date: today(), paidWith: via };

  return (
    <Card title="Month's payroll">
      <div className="form"><Field label="Month"><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field></div>
      <Note>{a.done}</Note><Err>{a.error}</Err>
      <Async load={load}>{() => (
        <>
          {!run?.lines.length ? <Empty>{people.some((p) => p.active) ? 'Not worked out yet for this month.' : 'Add the people you pay first.'}</Empty> : (
            <Table head={['Name', '>Days away', '>Bonus (₹)', '>Pay', '>PF', '>ESI', '>Tax', '>To pay']}>
              {run.lines.map((l) => (
                <tr key={l.employee_id}><td>{l.name}</td>
                  <td className="r">{posted ? Number(l.days_away) : <input style={{ width: '4.5rem' }} inputMode="decimal" aria-label={`Days away for ${l.name}`} value={typed[l.employee_id]?.daysAway ?? l.days_away} onChange={set(l.employee_id, 'daysAway')} />}</td>
                  <td className="r">{posted ? <Money v={l.bonus_minor} /> : <input style={{ width: '6rem' }} inputMode="decimal" aria-label={`Bonus for ${l.name}`} value={typed[l.employee_id]?.bonus ?? rupees(l.bonus_minor)} onChange={set(l.employee_id, 'bonus')} />}</td>
                  <td className="r"><Money v={l.gross_minor} /></td><td className="r"><Money v={String(Number(l.pf_employee_minor))} /></td><td className="r"><Money v={String(Number(l.esi_employee_minor))} /></td>
                  <td className="r"><Money v={String(Number(l.pt_minor) + Number(l.tds_minor))} /></td><td className="r"><strong><Money v={l.net_minor} /></strong></td></tr>
              ))}
            </Table>
          )}
          {!!run?.lines.length && <p className="muted">PF, ESI, professional tax and TDS the business pays in all: ₹{inr(String(dues))}. Employer shares are added to the cost, not taken from pay.</p>}
          {voiding && (
            <div className="confirm"><p>This takes the month back out of the books: the salary, the payment and the deposit.</p>
              <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <p className="actions"><Btn kind="danger" busy={a.busy} disabled={!reason} onClick={() => step('/void', { date: today(), reason }, 'Taken back.').then(() => { setVoiding(false); setReason(''); })}>Take it back</Btn><Btn onClick={() => setVoiding(false)}>Keep it</Btn></p></div>
          )}
          <div className="actions">
            {!posted && <Btn busy={a.busy} onClick={make}>{run?.lines.length ? 'Work out again' : 'Work out the month'}</Btn>}
            {!posted && !!run?.lines.length && <Btn kind="primary" busy={a.busy} onClick={() => step('/post', undefined, 'Posted to your books.')}>Post to the books</Btn>}
            {posted && (!run.paid_entry_id || !run.dues_entry_id) && <Field label="Paid with"><select value={via} onChange={(e) => setVia(e.target.value)}>{Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
            {posted && !run.paid_entry_id && <Btn kind="primary" busy={a.busy} onClick={() => step('/pay', pay, 'Staff marked as paid.')}>Pay the staff</Btn>}
            {posted && run.paid_entry_id && <Badge status="PAID">Staff paid</Badge>}
            {posted && !run.dues_entry_id && dues > 0 && <Btn busy={a.busy} onClick={() => step('/dues', pay, 'PF, ESI and tax marked as deposited.')}>Deposit PF, ESI and tax</Btn>}
            {posted && <Btn className="btn danger" onClick={() => setVoiding(true)}>Take back</Btn>}
          </div>
        </>
      )}</Async>
    </Card>
  );
};

export default () => {
  const { o, org } = useSession();
  const people = useLoad(() => o('/payroll/employees'), [org.id]);
  return (
    <Page title="Payroll" lead="Pay your staff each month. Days away come off the pay; PF, ESI, professional tax and TDS are worked out and kept in your books until you deposit them.">
      <People load={people} o={o} org={org} />
      <Month people={people.data || []} o={o} org={org} />
    </Page>
  );
};
