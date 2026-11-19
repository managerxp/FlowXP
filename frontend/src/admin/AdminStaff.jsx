/*
 * Staff sign-ins for the console. The owner adds a person with a role (what they may open and do), changes it, turns the sign-in off, or signs them out.
 * Staff have no password: the first time on a computer a code is emailed to them, then they set a PIN there and sign in with their email or phone number and the PIN.
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
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'ONBOARDING' });
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(null);   // { name, email }: who was just added

  const load = () => adminApi('/staff').then(setData).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const roles = data?.roles.filter((r) => r.key !== 'OWNER') || [];
  const roleInfo = (key) => data?.roles.find((r) => r.key === key);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const made = await adminApi('/staff', { method: 'POST', body: { ...form, phone: form.phone || undefined } });
      setAdded({ name: made.name, email: made.email, phone: made.phone });
      setForm({ name: '', email: '', phone: '', role: form.role });
      await load();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const change = async (u, body, done) => {
    try {
      await adminApi(`/staff/${u.user_id}`, { method: 'PATCH', body });
      toast.success(done);
      await load();
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div>
      <PageHeader title="Staff and roles" lead="Give your team their own sign-in, limited to the work they do." />
      {error && <Alert>{error}</Alert>}

      {added && (
        <Card className="mb-6 border-brand-500">
          <p className="text-small font-semibold text-ink-900">{added.name} can sign in</p>
          <p className="mt-1 text-small text-ink-700">We emailed {added.email} where to sign in. The first time they choose "Email me a code"; after that they set a PIN on their computer and sign in with their {added.phone ? 'phone number or email' : 'email'} and the PIN. There is no password.</p>
          <div className="mt-3"><Button size="sm" variant="ghost" onClick={() => setAdded(null)}>Done</Button></div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 !p-0">
          {!data && !error ? <PageLoader /> : (
            <Table>
              <Thead><Th>Name</Th><Th>Role</Th><Th>Sign-in</Th><Th>Last sign-in</Th><Th className="text-right">&nbsp;</Th></Thead>
              <tbody>
                {data?.staff.map((u) => {
                  const you = u.user_id === admin.user_id;
                  const owner = u.role === 'OWNER';
                  return (
                    <Tr key={u.user_id}>
                      <Td><p className="font-medium text-ink-900">{u.name}{you && <span className="ml-2 text-caption text-ink-500">you</span>}</p><p className="text-caption text-ink-500">{u.email}{u.phone ? ` · ${u.phone}` : ''}</p></Td>
                      <Td>
                        {owner || you ? <Badge tone="brand">{roleInfo(u.role)?.label || u.role}</Badge> : (
                          <Select aria-label={`Role for ${u.name}`} value={u.role} disabled={u.disabled} onChange={(e) => change(u, { role: e.target.value }, 'Role changed. They are signed out so it applies now.')}>
                            {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                          </Select>
                        )}
                        {u.disabled && <Badge tone="danger">Off</Badge>}
                      </Td>
                      <Td className="text-small text-ink-500">{owner ? 'Password and app' : 'Code and PIN'}</Td>
                      <Td className="text-small text-ink-500">{when(u.last_login_at)}</Td>
                      <Td className="text-right">
                        {!owner && !you && (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="secondary" onClick={async () => { if (await dialog.confirm({ title: `Sign ${u.name} out?`, body: 'They are signed out everywhere and their PIN stops working. Next time they need a code emailed to them.', confirmLabel: 'Sign out' })) change(u, { sign_out: true }, 'Signed out. Their PIN is cleared.'); }}>Sign out</Button>
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
              <Field id="st-email" label="Email" hint="The code is emailed here. It cannot be an email that already has a FlowXP account."><Input id="st-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></Field>
              <Field id="st-phone" label="Mobile (optional)" hint="So they can sign in with the number instead of the email."><Input id="st-phone" type="tel" inputMode="numeric" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
              <Field id="st-role" label="Role" hint={roleInfo(form.role)?.about}>
                <Select id="st-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</Select>
              </Field>
              <Button className="w-full" disabled={busy}>{busy ? 'Adding…' : 'Add'}</Button>
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
