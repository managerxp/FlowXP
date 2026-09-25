/*
 * Staff: who works here, in what role, at which outlet. Adding someone emails
 * them a link to set their own password; nobody ever types another person's
 * password. Owners and admins always cover every outlet; floor roles belong
 * to exactly one.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr, useToast } from '../components/ui.jsx';

const ROLES = {
  OWNER: 'Owner', ADMIN: 'Admin', MANAGER: 'Manager', CASHIER: 'Cashier', WAITER: 'Waiter',
  KITCHEN: 'Kitchen', INVENTORY_MANAGER: 'Stock manager', STAFF: 'Staff'
};
const GROUP_ROLES = ['OWNER', 'ADMIN'];
const FLOOR_ROLES = ['CASHIER', 'WAITER', 'KITCHEN', 'STAFF'];
const ROLE_HELP = {
  OWNER: 'Everything, including billing and staff.', ADMIN: 'Runs the business day to day; can’t manage owners.',
  MANAGER: 'Reports, stock, buying and refunds.', CASHIER: 'Bills sales and takes payments.', WAITER: 'Takes and bills orders.',
  KITCHEN: 'Sees and advances kitchen tickets only.', INVENTORY_MANAGER: 'Stock, purchasing and suppliers.', STAFF: 'Billing only.'
};

/* What this person may do: the role's default, with an allow or deny for anything the owner wants different. */
const PermissionsModal = ({ person, onClose, onSaved }) => {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [choice, setChoice] = useState({});           // key -> 'default' | 'allow' | 'deny'
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api(`/staff/${person.user_id}/permissions`).then((d) => {
      setRows(d.permissions);
      setChoice(Object.fromEntries(d.permissions.map((p) => [p.key, p.override === null ? 'default' : p.override ? 'allow' : 'deny'])));
    }).catch((e) => setError(e.message));
  }, [person.user_id]);

  const effective = (p) => (choice[p.key] === 'allow' ? true : choice[p.key] === 'deny' ? false : p.role_default);

  const save = async () => {
    setBusy(true); setError('');
    try {
      const permissions = Object.fromEntries(rows.map((p) => [p.key, choice[p.key] === 'allow' ? true : choice[p.key] === 'deny' ? false : null]));
      await api(`/staff/${person.user_id}/permissions`, { method: 'PUT', body: { permissions } });
      toast.success('Permissions saved. They apply from the next thing this person does.');
      onSaved();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`Permissions — ${person.name}`} onClose={onClose} wide>
      <p className="mb-4 text-sm text-ink-500">{person.name} is a <strong>{ROLES[person.role]}</strong>. Each row starts from what that role allows; change one only when this person should differ.</p>
      <Alert>{error}</Alert>
      {!rows ? <p className="text-sm text-ink-400">Loading…</p> : (
        <div className="space-y-2">
          {rows.map((p) => (
            <div key={p.key} className="grid items-center gap-3 rounded-lg border border-line p-3 sm:grid-cols-[1fr_auto]">
              <div>
                <p className="text-sm font-semibold text-ink-900">{p.label} {effective(p) ? <Badge tone="success">Can</Badge> : <Badge tone="neutral">Can’t</Badge>}{choice[p.key] !== 'default' && <span className="ml-2 text-xs font-semibold text-brand-600">changed</span>}</p>
                <p className="text-xs text-ink-500">{p.description}</p>
              </div>
              <div className="flex overflow-hidden rounded-lg border border-line-strong text-xs font-semibold" role="group" aria-label={p.label}>
                {[['default', `Role default (${p.role_default ? 'can' : 'can’t'})`], ['allow', 'Allow'], ['deny', 'Deny']].map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={choice[p.key] === value} onClick={() => setChoice((c) => ({ ...c, [p.key]: value }))}
                          className={`px-2.5 py-1.5 ${choice[p.key] === value ? (value === 'deny' ? 'bg-danger text-white' : value === 'allow' ? 'bg-success text-white' : 'bg-ink-900 text-white') : 'bg-surface text-ink-600 hover:bg-surface-2'}`}>{label}</button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex justify-end gap-2 pt-3">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save permissions'}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
};

const PersonForm = ({ person, roles, outlets, onSaved, onClose }) => {
  const toast = useToast();
  const [form, setForm] = useState({ name: '', email: '', role: 'CASHIER', branch_id: '', status: 'ACTIVE', ...(person ? { role: person.role, branch_id: person.branch_id ?? '', status: person.status } : {}) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const groupRole = GROUP_ROLES.includes(form.role);
  const needsOutlet = FLOOR_ROLES.includes(form.role);

  const submit = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const outlet = groupRole ? undefined : (form.branch_id === '' ? '' : Number(form.branch_id));
      if (person) await api(`/staff/${person.user_id}`, { method: 'PUT', body: { role: form.role, status: form.status, branch_id: outlet ?? '' } });
      else {
        const result = await api('/staff', { method: 'POST', body: { name: form.name, email: form.email, role: form.role, branch_id: outlet } });
        toast.success(result.invited ? `Sent ${form.email} a link to set their password` : `${form.email} now has access`);
      }
      onSaved();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={person ? `Edit ${person.name}` : 'Add a person'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        {!person && (
          <>
            <Field id="s-name" label="Name"><Input id="s-name" value={form.name} onChange={set('name')} required autoFocus /></Field>
            <Field id="s-email" label="Email" hint="They get a link to set their own password."><Input id="s-email" type="email" value={form.email} onChange={set('email')} required /></Field>
          </>
        )}
        <Field id="s-role" label="Role" hint={ROLE_HELP[form.role]}>
          <Select id="s-role" value={form.role} onChange={set('role')}>
            {roles.map((r) => <option key={r} value={r}>{ROLES[r]}</option>)}
          </Select>
        </Field>
        {groupRole ? (
          <p className="rounded-lg bg-surface-2 p-3 text-sm text-ink-600">{ROLES[form.role]}s can see every outlet.</p>
        ) : (
          outlets.length > 1 && (
            <Field id="s-outlet" label="Outlet" hint={needsOutlet ? 'They can only see and work in this outlet.' : 'Leave on “Every outlet” for a group-level manager.'}>
              <Select id="s-outlet" value={form.branch_id} onChange={set('branch_id')} required={needsOutlet}>
                {!needsOutlet && <option value="">Every outlet</option>}
                {needsOutlet && <option value="" disabled>Choose an outlet…</option>}
                {outlets.map((o) => <option key={o.branch_id} value={o.branch_id}>{o.name}</option>)}
              </Select>
            </Field>
          )
        )}
        {person && (
          <Field id="s-status" label="Access">
            <Select id="s-status" value={form.status} onChange={set('status')}>
              <option value="ACTIVE">Active</option>
              <option value="DISABLED">Disabled — can’t sign in to this business</option>
            </Select>
          </Field>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : person ? 'Save changes' : 'Add person'}</Button>
        </div>
      </form>
    </Modal>
  );
};

const StaffPage = () => {
  const { business, outlets } = useAuth();
  const [people, setPeople] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);   // {} = new, person = edit
  const [permsFor, setPermsFor] = useState(null);

  const isOwner = business?.role === 'OWNER';
  // An admin can't hand out or change the top roles.
  const roles = Object.keys(ROLES).filter((r) => isOwner || !GROUP_ROLES.includes(r));

  const load = () => api('/staff').then(setPeople).catch((e) => setError(e.status === 403 ? 'Managing staff is for owners and admins.' : e.message));
  useEffect(() => { load(); }, []);

  return (
    <div>
      <PageHeader title="Staff" lead="Who can sign in, what they can do, and where." action={<Button onClick={() => setEditing({})}>Add person</Button>} />
      <Alert>{error}</Alert>
      <ListState loading={!people && !error} empty={people?.length === 0} emptyLabel="No one yet." />
      {people?.length > 0 && (
        <Table>
          <Thead><Th>Name</Th><Th>Role</Th><Th>Outlet</Th><Th>Access</Th><Th></Th></Thead>
          <tbody>
            {people.map((p) => (
              <Tr key={p.user_id}>
                <Td><span className="font-medium">{p.name}</span> {p.is_you && <Badge tone="brand">You</Badge>}<br /><span className="text-xs text-ink-400">{p.email}</span></Td>
                <Td>{ROLES[p.role] || p.role}</Td>
                <Td className="text-ink-500">{p.branch_name || 'Every outlet'}</Td>
                <Td>{p.status === 'ACTIVE' ? <Badge tone="success">Active</Badge> : <Badge tone="neutral">{p.status === 'DISABLED' ? 'Disabled' : 'Invited'}</Badge>}</Td>
                <Td className="space-x-3 text-right">
                  {isOwner && !p.is_you && p.role !== 'OWNER' && <button onClick={() => setPermsFor(p)} className="text-xs font-semibold text-brand-600">Permissions{p.custom_permissions > 0 && <span className="ml-1 rounded-full bg-brand-50 px-1.5 text-[10px]">{p.custom_permissions}</span>}</button>}
                  {!p.is_you && (isOwner || !GROUP_ROLES.includes(p.role)) && <button onClick={() => setEditing(p)} className="text-xs font-semibold text-brand-600">Edit</button>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {permsFor && <PermissionsModal person={permsFor} onClose={() => setPermsFor(null)} onSaved={() => { setPermsFor(null); load(); }} />}
      {editing && <PersonForm person={editing.user_id ? editing : null} roles={roles} outlets={outlets} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
};

export default StaffPage;
