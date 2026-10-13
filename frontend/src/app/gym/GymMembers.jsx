/* The member directory: find anyone by name, phone or number, filter by where their membership stands, and add, import or export members. */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Search, Upload, UserPlus } from 'lucide-react';
import { api, getBranchId, getBusinessId } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { MEMBER_STATE, dayTime, longDate, qs, useDebounced, useLoad } from '../../lib/gym.js';
import { readTable } from '../../lib/spreadsheet.js';
import { Alert, Avatar, Badge, Button, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr, useToast } from '../../components/ui.jsx';
import { Chips, Pager, useAction } from '../salon/parts.jsx';
import MemberForm from './MemberForm.jsx';

const PAGE = 25;
const STATES = [['', 'Everyone'], ['ACTIVE', 'Active'], ['EXPIRING', 'Ends soon'], ['FROZEN', 'Frozen'], ['EXPIRED', 'Ended'], ['UPCOMING', 'Starts soon'], ['NONE', 'No membership']];
const HEADERS = { name: ['name', 'full name', 'member'], phone: ['phone', 'mobile', 'phone number', 'mobile number'], email: ['email', 'e-mail'], dob: ['dob', 'date of birth', 'birthday'], gender: ['gender'], joined_on: ['joined', 'joined on', 'join date'], company: ['company'], emergency_name: ['emergency contact', 'emergency name'], emergency_phone: ['emergency phone'] };

/* Rows from a spreadsheet, with the columns named the way people name them. */
const normalise = (rows) => rows.map((r) => {
  const lower = Object.fromEntries(Object.entries(r).map(([k, v]) => [String(k).trim().toLowerCase(), v]));
  const out = {};
  for (const [field, names] of Object.entries(HEADERS)) { const hit = names.find((n) => lower[n] !== undefined && lower[n] !== ''); if (hit) out[field] = lower[hit]; }
  return out;
});

const ImportModal = ({ onClose, onDone }) => {
  const [rows, setRows] = useState(null);
  const [check, setCheck] = useState(null);
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const choose = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setError(''); setCheck(null);
    try {
      const parsed = normalise(await readTable(file));
      if (!parsed.length) { setError('The file has no members in it.'); return; }
      setRows(parsed);
      setCheck(await api('/gym/members/import', { method: 'POST', body: { rows: parsed, dry_run: true } }));
    } catch (err) { setError(err.message); }
  };
  const load = () => run(async () => { const r = await api('/gym/members/import', { method: 'POST', body: { rows, dry_run: false } }); onDone(r.imported); }, null);
  return (
    <Modal title="Import members" onClose={onClose} wide
           footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={load} loading={busy} disabled={!check?.ok}>Add {check?.checked ?? ''} members</Button></>}>
      <p className="text-small text-ink-500">Choose a CSV or Excel file with a header row. Columns it understands: name, phone, email, date of birth, gender, joined on, company, emergency contact, emergency phone.</p>
      <input type="file" accept=".csv,.xlsx" aria-label="Members file" onChange={choose} className="mt-3 block w-full text-small" />
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      {check && (check.ok
        ? <p className="mt-4 rounded-lg bg-success/10 p-3 text-small text-ink-900">All {check.checked} rows look right. Nothing is saved until you press Add.</p>
        : (
          <div className="mt-4">
            <p className="text-small font-medium text-ink-900">Fix these in the file and choose it again. Nothing was added: a file is loaded whole or not at all.</p>
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto text-small text-ink-700">{check.problems.map((p, i) => <li key={i}>Row {p.row}: {p.message}</li>)}</ul>
          </div>
        ))}
    </Modal>
  );
};

export default function GymMembers() {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState('');
  const q = useDebounced(text, 300);
  const state = params.get('state') || '';
  const status = params.get('status') || '';
  const sort = params.get('sort') || 'name';
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(params.get('new') === '1');
  const [importing, setImporting] = useState(false);
  const list = useLoad(`/gym/members${qs({ q: q.trim(), state, status, sort, limit: PAGE, offset })}`, { paged: true });
  const rows = list.data || [];
  const set = (k, v) => { setOffset(0); const next = new URLSearchParams(params); if (v) next.set(k, v); else next.delete(k); setParams(next, { replace: true }); };
  useEffect(() => { if (params.get('new') === '1') { const n = new URLSearchParams(params); n.delete('new'); setParams(n, { replace: true }); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const download = async () => {
    try {
      const res = await fetch('/api/gym/members/export', { headers: { 'X-Requested-With': 'FlowXP', ...(getBusinessId() ? { 'X-Business-Id': getBusinessId() } : {}), ...(getBranchId() ? { 'X-Branch-Id': getBranchId() } : {}) }, credentials: 'same-origin' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || 'Could not make the file');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a'); a.href = url; a.download = 'members.csv'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      <PageHeader title="Members" lead="Everyone who has joined, and where their membership stands."
        action={<>
          {can('export') && <Button variant="secondary" onClick={download}><Download aria-hidden="true" className="h-4 w-4" />Export</Button>}
          {can('gym_setup') && <Button variant="secondary" onClick={() => setImporting(true)}><Upload aria-hidden="true" className="h-4 w-4" />Import</Button>}
          {(can('gym_members') || can('gym_setup')) && <Button onClick={() => setAdding(true)}><UserPlus aria-hidden="true" className="h-4 w-4" />New member</Button>}
        </>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Chips label="Membership" options={STATES.map(([value, label]) => ({ value, label }))} value={state} onChange={(v) => set('state', v)} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-60 flex-1 sm:max-w-sm">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-ink-400" />
          <Input aria-label="Search members" placeholder="Name, phone, email or member number" value={text} onChange={(e) => { setText(e.target.value); setOffset(0); }} className="pl-9" />
        </div>
        <span className="block w-52"><Select aria-label="Show" value={status} onChange={(e) => set('status', e.target.value)}><option value="">Current members</option><option value="SUSPENDED">On hold</option><option value="INACTIVE">Inactive</option><option value="ARCHIVED">Archived</option></Select></span>
        <span className="block w-52"><Select aria-label="Sort by" value={sort} onChange={(e) => set('sort', e.target.value)}><option value="name">Name</option><option value="joined">Newest first</option><option value="expiry">Ends soonest</option><option value="last_visit">Visited most recently</option><option value="code">Member number</option></Select></span>
      </div>
      <ListState loading={list.loading && !rows.length} error={list.error} empty={!list.loading && !rows.length} emptyLabel={q || state ? 'No member matches.' : 'No members yet.'}
                 emptyBody={!q && !state ? 'Register the first member, or import a list.' : undefined} />
      {rows.length > 0 && (
        <Table>
          <Thead><Th>Member</Th><Th>Phone</Th><Th>Plan</Th><Th>Ends</Th><Th>Last visit</Th><Th>Status</Th></Thead>
          <tbody>
            {rows.map((m) => (
              <Tr key={m.member_id} onClick={() => navigate(`/app/gym/members/${m.member_id}`)}>
                <Td><span className="flex items-center gap-3"><Avatar name={m.name} /><span className="min-w-0"><Link to={`/app/gym/members/${m.member_id}`} className="font-medium text-brand-600 hover:underline">{m.name}</Link><span className="block text-caption text-ink-500">{m.member_code}{m.head_member_id ? ' · family' : ''}</span></span></span></Td>
                <Td className="tabular">{m.phone || '–'}</Td>
                <Td>{m.plan_name || '–'}</Td>
                <Td className="whitespace-nowrap">{m.expires_on ? longDate(m.expires_on) : '–'}</Td>
                <Td className="whitespace-nowrap text-ink-500">{m.last_visit ? dayTime(m.last_visit) : 'Never'}</Td>
                <Td>{m.status === 'ACTIVE' ? <Badge tone={MEMBER_STATE[m.state]?.tone}>{MEMBER_STATE[m.state]?.label}</Badge> : <Badge tone="warning">{m.status === 'SUSPENDED' ? 'On hold' : m.status.toLowerCase()}</Badge>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pager meta={list.meta} onPage={setOffset} />
      {adding && <MemberForm canHealth={can('gym_trainer') || can('gym_setup')} onClose={() => setAdding(false)} onSaved={(m) => { setAdding(false); toast.success(`${m.name} is registered as ${m.member_code}`); navigate(`/app/gym/members/${m.member_id}`); }} />}
      {importing && <ImportModal onClose={() => setImporting(false)} onDone={(n) => { setImporting(false); toast.success(`${n} members added`); list.reload(); }} />}
    </div>
  );
}
