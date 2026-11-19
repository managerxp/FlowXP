/*
 * Staff sign-ins for the console. The owner adds a person with a role (what they may open and do), changes it, turns the sign-in off, or sets a new temporary password.
 * A temporary password is shown once, here, to hand over; the console makes the person turn on two-step verification at their first sign-in.
 */
import { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi.js';
import { useAdminAuth } from './AdminAuthContext.jsx';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, PageLoader, Select, Table, Td, Th, Thead, Tr, useDialog, useToast } from '../components/ui.jsx';

const when = (d) => (d ? new Date(d).toLocaleString() : 'Never');

const AdminStaff = () => {
  const { admin } = useAdminAuth();
  const toast = useToast();
  const dialog = useDialog();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', email: '', role: 'ONBOARDING' });
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState(null);   // { name, email, password }: shown once

  const load = () => adminApi('/staff').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const roles = data?.roles.filter((r) => r.key !== 'OWNER') || [];
  const roleInfo = (key) => data?.roles.find((r) => r.key === key);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const made = await adminApi('/staff', { method: 'POST', body: form });
      setSecret({ name: made.name, email: made.email, password: made.temporary_password });
      setForm({ name: '', email: '', role: form.role });
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const change = async (u, body, done) => {
    try {
      const out = await adminApi(`/staff/${u.user_id}`, { method: 'PATCH', body });
      if (out.temporary_password) setSecret({ name: u.name, email: u.email, password: out.temporary_password });
      toast.success(done);
      await load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div>
      <PageHeader title="Staff and roles" lead="Give your team their own sign-in, limited to the work they do." />
      {error && <Alert>{error}</Alert>}

      {secret && (
        <Card className="mb-6 border-brand-500">
          <p className="text-small font-semibold text-ink-900">Sign-in for {secret.name}</p>
          <p className="mt-1 text-small text-ink-700">Send them this now. It is not shown again. At their first sign-in they will be asked to turn on two-step verification.</p>
          <dl className="mt-3 grid max-w-md grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-small">
            <dt className="text-ink-500">Sign in at</dt><dd className="font-medium text-ink-900">{window.location.origin}/superadmin/login</dd>
            <dt className="text-ink-500">Email</dt><dd className="font-medium text-ink-900">{secret.email}</dd>
            <dt className="text-ink-500">Temporary password</dt><dd className="font-mono font-semibold text-ink-900">{secret.password}</dd>
          </dl>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => { navigator.clipboard?.writeText(`Sign in at ${window.location.origin}/superadmin/login\nEmail: ${secret.email}\nTemporary password: ${secret.password}`); toast.success('Copied'); }}>Copy the details</Button>
            <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>Done</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 !p-0">
          {!data && !error ? <PageLoader /> : (
            <Table>
              <Thead><Th>Name</Th><Th>Role</Th><Th>Two-step</Th><Th>Last sign-in</Th><Th className="text-right">&nbsp;</Th></Thead>
              <tbody>
                {data?.staff.map((u) => {
                  const you = u.user_id === admin.user_id;
                  const owner = u.role === 'OWNER';
                  return (
                    <Tr key={u.user_id}>
                      <Td><p className="font-medium text-ink-900">{u.name}{you && <span className="ml-2 text-caption text-ink-500">you</span>}</p><p className="text-caption text-ink-500">{u.email}</p></Td>
                      <Td>
                        {owner || you ? <Badge tone="brand">{roleInfo(u.role)?.label || u.role}</Badge> : (
                          <Select aria-label={`Role for ${u.name}`} value={u.role} disabled={u.disabled} onChange={(e) => change(u, { role: e.target.value }, 'Role changed. They are signed out so it applies now.')}>
                            {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                          </Select>
                        )}
                        {u.disabled && <Badge tone="danger">Off</Badge>}
                      </Td>
                      <Td><Badge tone={u.two_factor ? 'success' : 'warning'}>{u.two_factor ? 'On' : 'Not yet'}</Badge></Td>
                      <Td className="text-small text-ink-500">{when(u.last_login_at)}</Td>
                      <Td className="text-right">
                        {!owner && !you && (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="secondary" onClick={async () => { if (await dialog.confirm({ title: `New temporary password for ${u.name}?`, body: 'The old password stops working and they are signed out.', confirmLabel: 'Make a new one' })) change(u, { reset_password: true }, 'New temporary password made'); }}>New password</Button>
                            <Button size="sm" variant={u.disabled ? 'secondary' : 'ghost'} onClick={async () => { if (u.disabled || (await dialog.confirm({ title: `Turn off ${u.name}'s sign-in?`, body: 'They are signed out now and cannot sign in until you turn it back on.', confirmLabel: 'Turn off', danger: true }))) change(u, { disabled: !u.disabled }, u.disabled ? 'Sign-in turned on' : 'Sign-in turned off'); }}>{u.disabled ? 'Turn on' : 'Turn off'}</Button>
                          </div>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 text-title font-semibold text-ink-900">Add a person</h2>
            <form onSubmit={add} className="space-y-3">
              <Field id="st-name" label="Name"><Input id="st-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={100} /></Field>
              <Field id="st-email" label="Email" hint="Their sign-in. It cannot be an email that already has a FlowXP account."><Input id="st-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
              <Field id="st-role" label="Role" hint={roleInfo(form.role)?.about}>
                <Select id="st-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</Select>
              </Field>
              <Button className="w-full" disabled={busy}>{busy ? 'Adding…' : 'Add and make a password'}</Button>
            </form>
          </Card>

          <Card>
            <h2 className="mb-3 text-title font-semibold text-ink-900">What each role can do</h2>
            <ul className="space-y-3 text-small">
              {data?.roles.map((r) => (
                <li key={r.key}><p className="font-semibold text-ink-900">{r.label}</p><p className="text-ink-500">{r.about}</p></li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AdminStaff;
