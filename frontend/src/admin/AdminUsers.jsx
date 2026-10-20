/*
 * Support tools for a person's account: find them, see their businesses and recent sign-ins, then sign them out,
 * mark their email verified, or reset two-step verification when they lost the phone. Platform admins are not listed as actionable.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../lib/adminApi.js';
import { PageHeader, Input, Table, Thead, Th, Td, Tr, ListState, SkeletonRows, Badge, Button, Card, useToast, useDialog } from '../components/ui.jsx';

const when = (d) => (d ? new Date(d).toLocaleString() : '—');

const Detail = ({ id, onChanged }) => {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const dialog = useDialog();
  const load = () => adminApi(`/users/${id}`).then(setD).catch((e) => toast.error(e.message));
  useEffect(() => { setD(null); load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Card className="p-4 text-sm text-ink-500">Loading…</Card>;
  const { user, memberships, logins } = d;

  const run = async (path, ask, done) => {
    if (ask && !(await dialog.confirm({ ...ask, danger: true }))) return;
    setBusy(true);
    try { await adminApi(`/users/${id}/${path}`, { method: 'POST' }); toast.success(done); await load(); onChanged(); }
    catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };

  return (
    <Card className="p-4">
      <p className="text-base font-semibold text-ink-900">{user.name}</p>
      <p className="text-sm text-ink-500">{user.email}{user.phone ? ` · ${user.phone}` : ''}</p>
      <p className="mt-1 flex flex-wrap gap-2 text-xs">
        <Badge tone={user.email_verified ? 'success' : 'warning'}>{user.email_verified ? 'Email verified' : 'Email not verified'}</Badge>
        <Badge tone={user.totp_enabled ? 'success' : 'neutral'}>{user.totp_enabled ? 'Two-step on' : 'Two-step off'}</Badge>
        {user.is_super_admin && <Badge tone="brand">Platform admin</Badge>}
      </p>
      {!user.is_super_admin && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => run('sign-out', { title: 'Sign this person out everywhere?', body: 'Every phone and browser they are signed in on stops working. They can sign in again with their password.', confirmLabel: 'Sign out' }, 'Signed out everywhere')}>Sign out everywhere</Button>
          {!user.email_verified && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run('verify-email', null, 'Email marked verified')}>Mark email verified</Button>}
          {user.totp_enabled && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run('reset-2fa', { title: 'Reset two-step verification?', body: 'Only do this after you are sure it is really them (for example, they lost their phone). Their authenticator and recovery codes are removed and they are signed out.', confirmLabel: 'Reset' }, 'Two-step reset')}>Reset two-step</Button>}
        </div>
      )}
      <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-ink-400">Businesses</h3>
      {memberships.length === 0 ? <p className="text-sm text-ink-500">None</p> : (
        <ul className="mt-1 space-y-1 text-sm">
          {memberships.map((m) => (
            <li key={m.business_id}><Link className="text-brand-600 hover:underline" to={`/superadmin/businesses/${m.business_id}`}>{m.name}</Link> <span className="text-xs text-ink-500">{m.role} · {m.status}</span></li>
          ))}
        </ul>
      )}
      <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-ink-400">Recent sign-ins</h3>
      {logins.length === 0 ? <p className="text-sm text-ink-500">None recorded</p> : (
        <ul className="mt-1 space-y-1 text-xs text-ink-700">
          {logins.map((l, i) => <li key={i}>{when(l.created_at)} · <strong className={l.outcome === 'SUCCESS' ? 'text-success' : 'text-danger'}>{l.outcome}</strong> · {l.ip || '—'}{l.new_device ? ' · new device' : ''}</li>)}
        </ul>
      )}
    </Card>
  );
};

const AdminUsers = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);

  const load = () => {
    const q = new URLSearchParams({ page: String(page) });
    if (search) q.set('search', search);
    adminApi(`/users?${q}`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [search, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(1); }, [search]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div>
      <PageHeader title="People" lead="Find an account and fix a sign-in problem." />
      <div className="mb-4 max-w-xs"><Input placeholder="Search by name, email or phone" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
      <ListState loading={!data && !error} error={error} empty={data?.users.length === 0} emptyLabel="Nobody matches." skeleton={<SkeletonRows rows={6} columns={5} />} />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div>
          {data?.users.length > 0 && (
            <Table>
              <Thead><Th>Person</Th><Th>Businesses</Th><Th>Last sign-in</Th><Th>Joined</Th></Thead>
              <tbody>
                {data.users.map((u) => (
                  <Tr key={u.user_id} onClick={() => setOpen(u.user_id)} className="cursor-pointer">
                    <Td><button type="button" className="text-left font-semibold text-brand-600 hover:underline" onClick={() => setOpen(u.user_id)}>{u.name}</button><p className="text-xs text-ink-400">{u.email}</p></Td>
                    <Td>{u.businesses}</Td>
                    <Td>{when(u.last_login_at)}</Td>
                    <Td>{new Date(u.created_at).toLocaleDateString()}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          {data && pages > 1 && (
            <div className="mt-3 flex items-center gap-3 text-sm">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
              <span>Page {page} of {pages} · {data.total} people</span>
              <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </div>
        {open && <Detail id={open} onChanged={load} />}
      </div>
    </div>
  );
};

export default AdminUsers;
