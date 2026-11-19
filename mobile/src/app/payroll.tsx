import { useState } from 'react';
import { Text } from 'react-native';
import { currentBusiness, useSession, api } from '../lib/session.ts';
import { ApiError } from '../lib/api.ts';
import { allowed, hasFeature } from '../lib/access.ts';
import { t, fill } from '../lib/i18n.ts';
import { Msg, Panel, SetupShell, confirm, useAct, useList } from '../lib/formKit.tsx';
import { rupees } from '../lib/money.ts';
import { monthOf, shiftMonth } from '../lib/workshopStaff.ts';
import { PAID_VIA, duesOf, madePayRun, slipLine, today, type PayRun } from '../lib/payroll.ts';
import { Button, Chips, Failed, Line, Loading, SectionTitle, Soft, color } from '../lib/ui.tsx';
import { AttendanceTab, PeopleTab } from './workshop-staff.tsx';

const BASE = '/payroll/staff';

const MonthTab = () => {
  const [month, setMonth] = useState(monthOf(today()));
  const [via, setVia] = useState('BANK');
  const run = useList<PayRun>(`/payroll/runs/${month}`);
  const a = useAct();
  const r = madePayRun(run.data ?? null);
  const post = (path: string, body: object, done = 'Saved') => a.run('', async () => { await api.post(path, { month, ...body }); run.reload(); }, done);
  const askFinal = () => {
    if (!r) return;
    const go = () => { void a.run('', async () => {
      try { await api.post('/payroll/runs/finalize', { month }); } catch (e) {
        if (e instanceof ApiError && e.code === 'UNMARKED_DAYS') {
          confirm(t('Some days are not marked'), fill(t('{n} days have no attendance marked. They are paid as present. Finalise anyway?'), { n: r.unmarked_days }), 'Finalise anyway', () => { void a.run('', async () => { await api.post('/payroll/runs/finalize', { month, force: true }); run.reload(); }, 'Payroll is final'); });
          return;
        }
        throw e;
      }
      run.reload();
    }, 'Payroll is final'); };
    confirm(t('Make the payroll final?'), t('A final sheet cannot be changed.'), 'Make it final', go);
  };
  return (
    <Panel>
      <Chips items={[{ id: shiftMonth(month, -1), label: t('Earlier month') }, { id: month, label: month }, { id: shiftMonth(month, 1), label: t('Later month') }]} value={month} onChange={setMonth} />
      {run.error && !run.data ? <Failed message={run.error} onRetry={run.reload} /> : null}
      {run.data && !r ? (
        <>
          <Soft>{t('Nothing has been made for this month yet.')}</Soft>
          <Soft>{t('Make it from the attendance marked so far. You can change a payslip until the month is final.')}</Soft>
          <Msg a={a} />
          <Button title="Make the payroll sheet" busy={a.busy} onPress={() => { void post('/payroll/runs', {}); }} />
        </>
      ) : r ? (
        <>
          <SectionTitle>{`${t('Net pay to staff')}: ${rupees(Number(r.totals.net_pay_paise))}`}</SectionTitle>
          <Soft>{`${t('Cost to you')}: ${rupees(Number(r.totals.employer_cost_paise))} · ${t('To deposit: PF, ESI and tax')}: ${rupees(duesOf(r.totals))}`}</Soft>
          {r.unmarked_days > 0 ? <Text accessibilityRole="alert" style={{ color: color.warn }}>{fill(t('{n} days not marked'), { n: r.unmarked_days })}</Text> : null}
          {r.slips.map((s) => <Line key={s.payslip_id} left={s.name} right={rupees(Number(s.net_pay_paise))} sub={slipLine(s)} />)}
          <Msg a={a} />
          {r.status === 'DRAFT' ? (
            <>
              <Button title="Make it again" kind="quiet" busy={a.busy} onPress={() => { void post('/payroll/runs', {}); }} />
              <Button title="Make it final" busy={a.busy} onPress={askFinal} />
            </>
          ) : (
            <>
              <Soft>{t('Payroll is final')}</Soft>
              <Chips items={PAID_VIA.map((v) => ({ id: v.id, label: t(v.label) }))} value={via} onChange={setVia} />
              {r.paid_on ? <Soft>{fill(t('Staff paid {date}'), { date: r.paid_on })}</Soft>
                : <Button title="Pay the staff" busy={a.busy} onPress={() => { void post('/payroll/runs/paid', { paid_on: today(), via }, 'Paid, and recorded in your expenses as Salaries'); }} />}
              {r.dues_paid_on ? <Soft>{fill(t('PF, ESI and tax deposited {date}'), { date: r.dues_paid_on })}</Soft>
                : duesOf(r.totals) > 0 ? <Button title="Record PF, ESI and tax deposit" kind="quiet" busy={a.busy} onPress={() => confirm(t('Record PF, ESI and tax deposit'), t('This puts the PF (both shares), ESI, professional tax and TDS into your expenses as one entry, paid today. Do it once you have deposited them.'), 'Record PF, ESI and tax deposit', () => { void post('/payroll/runs/dues', { paid_on: today(), via }, 'Recorded in your expenses'); })} /> : null}
            </>
          )}
        </>
      ) : !run.error ? <Loading /> : null}
    </Panel>
  );
};

/* Payroll (add-on): the people, their attendance, and each month's pay, PF, ESI and tax. */
export default function PayrollScreen() {
  const me = currentBusiness(useSession());
  const hr = allowed(me, 'hr'); const pay = allowed(me, 'payroll');
  const [tab, setTab] = useState<'month' | 'people' | 'attendance'>('month');
  return (
    <SetupShell title="Payroll" sub="Salary from attendance, PF, ESI and tax" ok={pay && hasFeature(me, 'payroll')} denied="You do not have access to payroll.">
      <Chips items={[{ id: 'month', label: 'Payroll' }, { id: 'people', label: 'People' }, { id: 'attendance', label: 'Attendance' }]} value={tab} onChange={(v) => setTab(v as typeof tab)} />
      {tab === 'month' ? <MonthTab key="m" /> : tab === 'people' ? <PeopleTab key="p" edit={hr} pay={pay} base={BASE} empty="Add your people, then set their pay." /> : <AttendanceTab key="a" edit={hr} base={BASE} />}
    </SetupShell>
  );
}
