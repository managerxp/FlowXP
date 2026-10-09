/*
 * Account deletion requests. Someone who cannot sign in asks on the website; an owner who is the only owner of a business is held in the app and ends up here too.
 * Nothing from the public form is deleted until a person here has checked, by email, that the asker owns the address. Completing a request wipes the person's own
 * details (the business keeps its records); it refuses while they are still the only owner of a business.
 */
import { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi.js';
import { PageHeader, Card, Button, Alert, Badge, useToast, useDialog } from '../components/ui.jsx';

const when = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const Request = ({ r, onDone }) => {
  const toast = useToast();
  const dialog = useDialog();
  const [busy, setBusy] = useState(false);
  const act = async (what) => {
    const note = await dialog.prompt({
      title: what === 'complete' ? 'Delete this account?' : 'Decline this request?',
      body: what === 'complete' ? `Only after you have written to ${r.email} and they confirmed it is them.` : 'Say why, for the record.',
      label: 'Note for the record', confirmLabel: what === 'complete' ? 'Delete the account' : 'Decline', required: what === 'decline'
    });
    if (note == null) return;
    setBusy(true);
    try { await adminApi(`/deletion-requests/${r.request_id}/${what}`, { method: 'POST', body: { note } }); toast.success(what === 'complete' ? 'Done' : 'Declined'); onDone(); }
    catch (caught) { toast.error(caught.message); } finally { setBusy(false); }
  };
  const sole = (r.businesses || []).filter((b) => b.sole_owner);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-ink-900">{r.email}</p>
          <p className="text-xs text-ink-500">{when(r.created_at)} · {r.source === 'IN_APP' ? 'asked while signed in' : 'asked on the website'} · {r.has_account ? 'has an account' : 'no account with this address'}</p>
          {r.note && <p className="mt-2 text-sm text-ink-700">{r.note}</p>}
          {(r.businesses || []).length > 0 && <p className="mt-2 text-xs text-ink-500">In: {r.businesses.map((b) => `${b.name} (${b.role}${b.sole_owner ? ', the only owner' : ''})`).join('; ')}</p>}
          {sole.length > 0 && <p className="mt-1 text-xs text-warning">Cannot be deleted until {sole.map((b) => b.name).join(', ')} is closed or has another owner.</p>}
        </div>
        {r.status === 'PENDING'
          ? <div className="flex gap-2"><Button size="sm" variant="danger" loading={busy} onClick={() => act('complete')}>Delete account</Button><Button size="sm" variant="secondary" loading={busy} onClick={() => act('decline')}>Decline</Button></div>
          : <Badge tone={r.status === 'DONE' ? 'success' : 'neutral'}>{r.status === 'DONE' ? 'Done' : 'Declined'}</Badge>}
      </div>
      {r.handled_note && <p className="mt-2 text-xs text-ink-400">{r.handled_note}</p>}
    </Card>
  );
};

const AdminDeletions = () => {
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const load = () => adminApi(`/deletion-requests?status=${status}`).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { setRows(null); load(); }, [status]);
  return (
    <div>
      <PageHeader title="Account deletions" lead="People who asked to have their account deleted. Write to the address first and delete only once they have confirmed it is theirs." />
      {error && <Alert>{error}</Alert>}
      <div className="mb-4 flex gap-2">
        {['PENDING', 'DONE', 'DECLINED'].map((s) => <Button key={s} size="sm" variant={status === s ? 'primary' : 'secondary'} onClick={() => setStatus(s)}>{s === 'PENDING' ? 'Waiting' : s === 'DONE' ? 'Done' : 'Declined'}</Button>)}
      </div>
      {rows && (rows.length === 0 ? <p className="text-sm text-ink-400">Nothing here.</p> : <div className="grid gap-3">{rows.map((r) => <Request key={r.request_id} r={r} onDone={load} />)}</div>)}
    </div>
  );
};

export default AdminDeletions;
