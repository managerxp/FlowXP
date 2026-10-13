/*
 * Bugs from the mobile app. Two lists:
 *   Reports  what a signed-in person typed under "Report a problem", with their name, email, business, phone and the screen they were on, so support can write back.
 *   Crashes  errors the app caught by itself, grouped by message with how many times and on how many phones. No person or business is attached to a crash.
 * Each has a status (New, Seen, Fixed, Ignored) and a note. A crash that happens again after it was marked Fixed comes back as New.
 */
import { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi.js';
import { PageHeader, Card, Button, Alert, Badge, useToast, useDialog } from '../components/ui.jsx';

const when = (iso) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const STATUS = { NEW: ['New', 'danger'], SEEN: ['Seen', 'warning'], FIXED: ['Fixed', 'success'], IGNORED: ['Ignored', 'neutral'] };
const CATEGORY = { BROKE: 'Something broke', WRONG: 'A wrong figure', SLOW: 'Too slow', IDEA: 'An idea', OTHER: 'Something else' };
const TYPES = { RESTAURANT: 'Restaurant', CAFE: 'Café', CLOUD_KITCHEN: 'Cloud kitchen', HOTEL: 'Hotel', RETAIL: 'Retail', SUPERMARKET: 'Supermarket', PHARMACY: 'Pharmacy', SALON: 'Salon', GYM: 'Gym', GAMING_CAFE: 'Gaming lounge', AUTO_PARTS: 'Auto parts', WHOLESALE: 'Wholesale', DISTRIBUTOR: 'Distributor' };

const StatusButtons = ({ status, busy, onSet }) => (
  <div className="flex flex-wrap gap-2">
    {Object.entries(STATUS).filter(([k]) => k !== status).map(([k, [label]]) => <Button key={k} size="sm" variant={k === 'FIXED' ? 'primary' : 'secondary'} loading={busy} onClick={() => onSet(k)}>{k === 'NEW' ? 'Reopen' : `Mark ${label.toLowerCase()}`}</Button>)}
  </div>
);

const useSetStatus = (path, body, onDone) => {
  const toast = useToast();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  return [busy, async (status) => {
    let note;
    if (status === 'FIXED' || status === 'IGNORED') {
      note = await dialog.prompt({ title: status === 'FIXED' ? 'Mark as fixed' : 'Ignore this', body: 'A short note for the record (for example, the version that fixes it).', label: 'Note', confirmLabel: 'Save', required: false });
      if (note == null) return;
    }
    setBusy(true);
    try { await adminApi(path, { method: 'PATCH', body: { ...body, status, ...(note ? { note } : {}) } }); toast.success('Saved'); onDone(); }
    catch (caught) { toast.error(caught.message); } finally { setBusy(false); }
  }];
};

const Report = ({ r, onDone }) => {
  const [busy, set] = useSetStatus(`/bug-reports/${r.report_id}`, {}, onDone);
  const [label, tone] = STATUS[r.status] || STATUS.NEW;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-xs text-ink-500"><Badge tone={tone}>{label}</Badge><Badge>{CATEGORY[r.category] || 'Something else'}</Badge><span>{when(r.created_at)}</span></p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-ink-900 [overflow-wrap:anywhere]">{r.description}</p>
          <p className="mt-2 text-xs text-ink-700">
            <strong className="font-semibold">{r.user_name || 'Unknown person'}</strong>
            {r.user_email ? <> · <a className="text-brand-600 hover:underline" href={`mailto:${r.user_email}?subject=${encodeURIComponent('Your FlowXP problem report')}`}>{r.user_email}</a></> : null}
            {r.user_phone ? ` · ${r.user_phone}` : ''}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">{r.business_name ? `${r.business_name} (${TYPES[r.business_type] || r.business_type})` : 'No business'} · app {r.version || '?'} · {r.platform || '?'} {r.os_version || ''}{r.screen ? ` · on ${r.screen}` : ''}{r.device ? ` · phone ${r.device}` : ''}</p>
          {r.note && <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-700">Note{r.handled_by ? ` from ${r.handled_by}` : ''}: {r.note}</p>}
        </div>
        <StatusButtons status={r.status} busy={busy} onSet={set} />
      </div>
    </Card>
  );
};

const Crash = ({ c, onDone }) => {
  const [busy, set] = useSetStatus('/app-errors/status', { message: c.message }, onDone);
  const [open, setOpen] = useState(false);
  const [label, tone] = STATUS[c.status] || STATUS.NEW;
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-xs text-ink-500"><Badge tone={tone}>{label}</Badge>{c.fatal && <Badge tone="danger">Crashed the app</Badge>}<span>last {when(c.last_seen)}</span></p>
          <p className="mt-2 text-sm font-medium text-ink-900 [overflow-wrap:anywhere]">{c.message}</p>
          <p className="mt-1 text-xs text-ink-500">{c.times} time{c.times === 1 ? '' : 's'} on {c.devices} phone{c.devices === 1 ? '' : 's'} · first {when(c.first_seen)} · app {c.version || '?'} · {c.platform || '?'}{c.screen ? ` · on ${c.screen}` : ''}</p>
          {c.note && <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-700">Note: {c.note}</p>}
          {c.stack && <button type="button" className="mt-2 text-xs font-medium text-brand-600 hover:underline" onClick={() => setOpen((v) => !v)}>{open ? 'Hide the technical details' : 'Show the technical details'}</button>}
          {open && <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-ink-900 p-3 text-[11px] leading-snug text-white">{c.stack}</pre>}
        </div>
        <StatusButtons status={c.status} busy={busy} onSet={set} />
      </div>
    </Card>
  );
};

const AdminBugs = () => {
  const [tab, setTab] = useState('reports');
  const [status, setStatus] = useState('NEW');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const path = tab === 'reports' ? '/bug-reports' : '/app-errors';
  const load = () => {
    adminApi(`${path}?limit=100${status ? `&status=${status}` : ''}`).then((r) => { setRows(r); setError(''); }).catch((e) => setError(e.message));
    adminApi('/bug-summary').then(setSummary).catch(() => {});
  };
  useEffect(() => { setRows(null); load(); }, [tab, status]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader title="Bugs from the app" lead="What people report from the mobile app, and the errors the app catches by itself. Reports show who sent them so you can write back." />
      {error && <Alert>{error}</Alert>}
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" variant={tab === 'reports' ? 'primary' : 'secondary'} onClick={() => setTab('reports')}>Reports{summary?.new_reports ? ` (${summary.new_reports} new)` : ''}</Button>
        <Button size="sm" variant={tab === 'crashes' ? 'primary' : 'secondary'} onClick={() => setTab('crashes')}>Crashes{summary?.new_crashes ? ` (${summary.new_crashes} new)` : ''}</Button>
      </div>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Status">
        {[['', 'All'], ...Object.entries(STATUS).map(([k, [l]]) => [k, l])].map(([k, l]) => <Button key={k || 'all'} size="sm" variant={status === k ? 'primary' : 'ghost'} onClick={() => setStatus(k)}>{l}</Button>)}
      </div>
      {rows && (rows.length === 0
        ? <p className="text-sm text-ink-400">{status === 'NEW' ? 'Nothing new. ' : 'Nothing here. '}{tab === 'reports' ? 'Reports appear when someone taps Report a problem in the app.' : 'Crashes appear when the app catches an error.'}</p>
        : <div className="grid gap-3">{tab === 'reports' ? rows.map((r) => <Report key={r.report_id} r={r} onDone={load} />) : rows.map((c) => <Crash key={c.message} c={c} onDone={load} />)}</div>)}
    </div>
  );
};

export default AdminBugs;
