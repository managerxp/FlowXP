/* Register a member, or change one. Used from the member list and the member's own page. */
import { useState } from 'react';
import { api } from '../../lib/api.js';
import { Alert, Button, Field, Input, Modal, Select, Textarea } from '../../components/ui.jsx';
import { Toggle, useAction } from '../salon/parts.jsx';

const EMPTY = { name: '', phone: '', email: '', dob: '', gender: '', emergency_name: '', emergency_phone: '', company: '', health_notes: '', consent_data: false, consent_marketing: false };

export default function MemberForm({ member, headId = null, headName = null, canHealth, onClose, onSaved }) {
  const editing = Boolean(member);
  const [f, setF] = useState(editing ? { ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, member[k] ?? EMPTY[k]])), dob: String(member.dob || '').slice(0, 10), consent_data: Boolean(member.consent_data_at) } : EMPTY);
  const [error, setError] = useState('');
  const [dup, setDup] = useState(null);
  const [busy, run] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = (confirmDuplicate = false) => run(async () => {
    setError(''); setDup(null);
    const body = { ...f, ...(headId ? { head_member_id: headId } : {}), ...(confirmDuplicate ? { confirm_duplicate: true } : {}) };
    if (!canHealth) delete body.health_notes;
    try {
      const saved = await api(editing ? `/gym/members/${member.member_id}` : '/gym/members', { method: editing ? 'PUT' : 'POST', body });
      onSaved(saved);
    } catch (e) {
      if (e.code === 'DUPLICATE_MEMBER') setDup(e.data?.members || []);
      else setError(e.message);
    }
  }, null);

  return (
    <Modal title={editing ? `Edit ${member.name}` : headId ? `Add a family member of ${headName}` : 'New member'} onClose={onClose} wide
           footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save(false)} loading={busy} disabled={!f.name.trim() || (!headId && !f.phone.trim())}>{editing ? 'Save' : 'Register member'}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="m-name" label="Full name"><Input id="m-name" value={f.name} onChange={set('name')} autoFocus autoComplete="off" /></Field>
        <Field id="m-phone" label="Phone" hint={headId ? 'Optional for a family member: they share the phone of the person who pays.' : 'Members sign in to their pass with this number.'}>
          <Input id="m-phone" inputMode="tel" value={f.phone} onChange={set('phone')} autoComplete="off" />
        </Field>
        <Field id="m-email" label="Email (optional)"><Input id="m-email" type="email" value={f.email} onChange={set('email')} autoComplete="off" /></Field>
        <Field id="m-dob" label="Date of birth (optional)"><Input id="m-dob" type="date" value={f.dob} onChange={set('dob')} /></Field>
        <Field id="m-gender" label="Gender (optional)">
          <Select id="m-gender" value={f.gender} onChange={set('gender')}><option value="">Not said</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="OTHER">Other</option></Select>
        </Field>
        <Field id="m-company" label="Company (optional)" hint="For corporate memberships."><Input id="m-company" value={f.company} onChange={set('company')} /></Field>
        <Field id="m-ename" label="Emergency contact"><Input id="m-ename" value={f.emergency_name} onChange={set('emergency_name')} /></Field>
        <Field id="m-ephone" label="Emergency phone"><Input id="m-ephone" inputMode="tel" value={f.emergency_phone} onChange={set('emergency_phone')} /></Field>
      </div>
      {canHealth && (
        <div className="mt-4">
          <Field id="m-health" label="Health notes" hint="Private. Only trainers and managers can see this: it is never shown at the front desk."><Textarea id="m-health" rows={3} value={f.health_notes} onChange={set('health_notes')} /></Field>
        </div>
      )}
      <div className="mt-4 space-y-3 rounded-(--radius-card) bg-surface-2 p-4">
        <Toggle id="m-consent" checked={f.consent_data} onChange={(v) => setF((x) => ({ ...x, consent_data: v }))} label="The member agrees to the gym keeping their details" hint="Name, contact, visits and payments, to run their membership." />
        <Toggle id="m-marketing" checked={f.consent_marketing} onChange={(v) => setF((x) => ({ ...x, consent_marketing: v }))} label="They may be sent offers and reminders to come back" hint="Receipts, expiry notices and sign-in codes are always sent." />
      </div>
      {dup && (
        <div className="mt-4 rounded-(--radius-card) border border-warning/40 bg-warning/10 p-4 text-small">
          <p className="font-medium text-ink-900">A member already has this phone number:</p>
          <ul className="mt-1 list-disc pl-5 text-ink-700">{dup.map((d) => <li key={d.member_id}>{d.name} ({d.member_code})</li>)}</ul>
          <p className="mt-2 text-ink-700">If this is a different person (a husband and wife on one phone), register them anyway.</p>
          <Button className="mt-3" size="sm" variant="secondary" onClick={() => save(true)} loading={busy}>It is a different person: register</Button>
        </div>
      )}
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
    </Modal>
  );
}
