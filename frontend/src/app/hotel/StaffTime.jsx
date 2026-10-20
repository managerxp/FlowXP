/* The two time screens of Staff: the weekly roster (who works which shift) and daily attendance (who actually turned up). */
import { useMemo, useState } from 'react';
import { useToast, Button, Input, ListState, Select } from '../../components/ui.jsx';
import { staffApi as api, useStaffLoad as useLoad } from '../../lib/staffBase.js';
import { addDays, longDate, qs, shortDay, timeText } from '../../lib/hotel.js';
import { weekStart } from '../../lib/salon.js';
import { useAction } from '../salon/parts.jsx';
import { useT, T } from '../../i18n/useT.js';

/* ── roster ────────────────────────────────────────────────────────────── */

export const Roster = () => {
  const tr = useT();
  const toast = useToast();
  const dash = useLoad('/hotel/dashboard');
  const [from, setFrom] = useState(null);
  const [dept, setDept] = useState('');
  const [edits, setEdits] = useState({});
  const [busy, run] = useAction();
  const start = from || (dash.data ? weekStart(dash.data.business_date) : null);
  const depts = useLoad('/hotel/staff/departments');
  const r = useLoad(start ? `/hotel/staff/roster${qs({ from: start, to: addDays(start, 6), dept_id: dept })}` : null);
  const days = useMemo(() => (start ? Array.from({ length: 7 }, (_, i) => addDays(start, i)) : []), [start]);
  const d = r.data;
  const entryOf = (emp, date) => d?.entries.find((e) => e.employee_id === emp && e.work_date === date);
  const leaveOn = (emp, date) => d?.leaves.find((l) => l.employee_id === emp && l.from_date <= date && l.to_date >= date);
  const valueOf = (emp, date) => { const k = `${emp}|${date}`; if (k in edits) return edits[k]; const e = entryOf(emp, date); return e ? (e.shift_id ? String(e.shift_id) : 'OFF') : ''; };
  const dirty = Object.keys(edits).length;
  const setCell = (emp, date, v) => setEdits((x) => ({ ...x, [`${emp}|${date}`]: v }));

  const save = async () => {
    const entries = Object.entries(edits).filter(([, v]) => v !== '').map(([k, v]) => { const [emp, date] = k.split('|'); return { employee_id: Number(emp), work_date: date, shift_id: v === 'OFF' ? null : Number(v) }; });
    if (!entries.length) { setEdits({}); return; }
    const out = await run(() => api('/hotel/staff/roster', { method: 'PUT', body: { entries } }), 'Roster saved');
    if (out) { setEdits({}); r.reload(); }
  };
  const fillUsual = () => {
    const next = { ...edits };
    for (const e of d.employees) for (const date of days) {
      if (valueOf(e.employee_id, date) !== '' || leaveOn(e.employee_id, date)) continue;
      const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (e.weekly_off === wd) next[`${e.employee_id}|${date}`] = 'OFF'; else if (e.default_shift_id) next[`${e.employee_id}|${date}`] = String(e.default_shift_id);
    }
    setEdits(next);
  };
  const copyNext = async () => {
    const out = await run(() => api('/hotel/staff/roster/copy-week', { method: 'POST', body: { from: start, to: addDays(start, 7) } }), 'Copied to next week');
    if (out) toast.success(tr('{{changed}} entries copied', { changed: out.changed }));
  };

  if (!d) return <ListState loading={r.loading || dash.loading} error={r.error || dash.error} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => { setEdits({}); setFrom(addDays(start, -7)); }}>{tr('Earlier week')}</Button>
        <span className="text-small font-medium text-ink-900">{tr('{{longDate}} to {{longDate2}}', { longDate: longDate(start), longDate2: longDate(addDays(start, 6)) })}</span>
        <Button variant="secondary" size="sm" onClick={() => { setEdits({}); setFrom(addDays(start, 7)); }}>{tr('Later week')}</Button>
        <Select aria-label={tr('Department')} value={dept} onChange={(e) => { setDept(e.target.value); setEdits({}); }} className="max-w-48"><option value="">{tr('All departments')}</option>{(depts.data || []).map((x) => <option key={x.dept_id} value={x.dept_id}>{x.name}</option>)}</Select>
        <div className="ml-auto flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={fillUsual}>{tr('Fill from usual shifts')}</Button><Button variant="secondary" size="sm" onClick={copyNext} loading={busy}>{tr('Copy to next week')}</Button><Button size="sm" onClick={save} disabled={!dirty} loading={busy}>{dirty ? `Save ${dirty} change${dirty === 1 ? '' : 's'}` : tr('Save')}</Button></div>
      </div>
      <ListState empty={!d.employees.length} emptyLabel={tr('Add people first, on the People tab.')} />
      {d.employees.length > 0 && (
        <div className="overflow-x-auto rounded-(--radius-card) border border-line bg-surface">
          <table className="min-w-full text-small">
            <thead><tr className="border-b border-line bg-surface-2 text-caption text-ink-500"><th className="px-3 py-2 text-left font-medium">{tr('Person')}</th>{days.map((x) => <th key={x} className="px-1 py-2 text-center font-medium">{shortDay(x)}</th>)}</tr></thead>
            <tbody>{d.employees.map((e) => (
              <tr key={e.employee_id} className="border-b border-line last:border-0">
                <td className="whitespace-nowrap px-3 py-1.5"><span className="font-medium text-ink-900">{e.name}</span><span className="block text-caption text-ink-500">{e.department || e.designation || ''}</span></td>
                {days.map((date) => {
                  const lv = leaveOn(e.employee_id, date);
                  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
                  return (
                    <td key={date} className={`px-1 py-1 ${e.weekly_off === wd ? 'bg-surface-3/50' : ''}`}>
                      {lv ? <span className="block rounded-md bg-warning/10 px-2 py-1.5 text-center text-caption text-warning">{tr('Leave')}</span> : (
                        <select aria-label={`${e.name}, ${shortDay(date)}`} value={valueOf(e.employee_id, date)} onChange={(ev) => setCell(e.employee_id, date, ev.target.value)}
                                className={`w-full min-w-24 rounded-md border px-1.5 py-1.5 text-caption ${`${e.employee_id}|${date}` in edits ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface'}`}>
                          <option value="">—</option><option value="OFF">{tr('Off')}</option>{d.shifts.map((s) => <option key={s.shift_id} value={s.shift_id}>{s.name}</option>)}
                        </select>)}
                    </td>
                  );
                })}
              </tr>))}</tbody>
          </table>
        </div>
      )}
      <p className="text-caption text-ink-500">{tr('Shaded days are the person\'s usual weekly off. “—” means nothing is planned yet.')}</p>
    </div>
  );
};

/* ── attendance ────────────────────────────────────────────────────────── */

const STATUSES = [['', 'Not marked'], ['PRESENT', T('Present')], ['ABSENT', T('Absent')], ['HALF_DAY', T('Half day')], ['LEAVE', T('Paid leave')], ['UNPAID_LEAVE', T('Unpaid leave')], ['WEEKLY_OFF', T('Weekly off')], ['HOLIDAY', T('Holiday')]];
const TONE = { PRESENT: 'text-success', ABSENT: 'text-danger', HALF_DAY: 'text-warning', LEAVE: 'text-brand-600', UNPAID_LEAVE: 'text-ink-700', WEEKLY_OFF: 'text-ink-500', HOLIDAY: 'text-ink-500' };

export const Attendance = () => {
  const tr = useT();
  const dash = useLoad('/hotel/dashboard');
  const [date, setDate] = useState('');
  const [edits, setEdits] = useState({});
  const [busy, run] = useAction();
  const day = date || dash.data?.business_date;
  const r = useLoad(day ? `/hotel/staff/attendance${qs({ date: day })}` : null);
  const rows = r.data?.rows || [];
  const get = (row) => ({ status: row.status || '', overtime: row.overtime_minutes ? String(row.overtime_minutes / 60) : '', ...(edits[row.employee_id] || {}) });
  const set = (id, patch) => setEdits((x) => ({ ...x, [id]: { ...(x[id] || {}), ...patch } }));
  const dirty = Object.keys(edits).length;

  const markAllPresent = () => setEdits((x) => {
    const next = { ...x };
    for (const row of rows) { const cur = { status: row.status || '', ...(x[row.employee_id] || {}) }; if (!cur.status && !row.weekly_off_today && !row.leave_kind) next[row.employee_id] = { ...(x[row.employee_id] || {}), status: 'PRESENT' }; }
    return next;
  });
  const save = async () => {
    const entries = Object.entries(edits).map(([id, v]) => ({ employee_id: Number(id), status: v.status || null, overtime_minutes: v.overtime ? Math.round(Number(v.overtime) * 60) : 0, note: v.note || undefined }));
    const out = await run(() => api('/hotel/staff/attendance', { method: 'PUT', body: { date: day, entries } }), 'Attendance saved');
    if (out) { setEdits({}); r.reload(); }
  };

  if (!day || (!r.data && r.loading)) return <ListState loading />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44"><label htmlFor="at-d" className="mb-1.5 block text-sm font-medium text-ink-700">{tr('Day')}</label><Input id="at-d" type="date" value={day} onChange={(e) => { setEdits({}); setDate(e.target.value); }} /></div>
        <div className="ml-auto flex gap-2"><Button variant="secondary" size="sm" onClick={markAllPresent}>{tr('Mark everyone present')}</Button><Button size="sm" onClick={save} disabled={!dirty} loading={busy}>{dirty ? `Save ${dirty}` : tr('Save')}</Button></div>
      </div>
      <ListState error={r.error} empty={r.data && !rows.length} emptyLabel={tr('Nobody is on the books for this day.')} />
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-(--radius-card) border border-line bg-surface">
          <table className="min-w-full text-small">
            <thead><tr className="border-b border-line bg-surface-2 text-caption text-ink-500"><th className="px-3 py-2 text-left font-medium">{tr('Person')}</th><th className="px-3 py-2 text-left font-medium">{tr('Rostered')}</th><th className="px-3 py-2 text-left font-medium">{tr('Status')}</th><th className="px-3 py-2 text-left font-medium">{tr('Overtime (hours)')}</th></tr></thead>
            <tbody>{rows.map((row) => {
              const v = get(row);
              const hint = row.leave_kind ? 'On approved leave' : row.weekly_off_today ? 'Weekly off' : row.rostered_off ? 'Off on the roster' : null;
              return (
                <tr key={row.employee_id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2"><span className="font-medium text-ink-900">{row.name}</span><span className="block text-caption text-ink-500">{row.department || row.designation || ''}</span></td>
                  <td className="px-3 py-2 text-ink-500">{row.rostered_shift ? `${row.rostered_shift}, ${timeText(row.shift_start)} to ${timeText(row.shift_end)}` : hint || '—'}</td>
                  <td className="px-3 py-2"><select aria-label={tr('{{row_name}}: status', { row_name: row.name })} value={v.status} onChange={(e) => set(row.employee_id, { status: e.target.value })} className={`rounded-md border px-2 py-1.5 ${row.employee_id in edits ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface'} ${TONE[v.status] || ''}`}>{STATUSES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></td>
                  <td className="px-3 py-2"><input aria-label={tr('{{row_name}}: overtime hours', { row_name: row.name })} type="number" min="0" step="0.5" value={v.overtime} onChange={(e) => set(row.employee_id, { overtime: e.target.value })} className="w-20 rounded-md border border-line bg-surface px-2 py-1.5" /></td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <p className="text-caption text-ink-500">{tr('A day left “Not marked” is paid as present in payroll, and flagged so it can be settled first. A person\'s usual weekly off needs no mark.')}</p>
    </div>
  );
};
