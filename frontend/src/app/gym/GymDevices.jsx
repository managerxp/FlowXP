/*
 * Gate and reader devices. A device calls FlowXP with a signed request and gets back "open" or "do not open"; this screen registers each one, shows whether it is
 * alive, rotates its secret, switches it off, and lists what did not add up (a gate that never confirmed it opened, someone a device let in who should not have been).
 * The secret is shown once, here, and never again. The contract a vendor's integrator needs is GYM_DEVICES.md.
 */
import { useState } from 'react';
import { Plus, RefreshCw, TriangleAlert } from 'lucide-react';
import { api } from '../../lib/api.js';
import { dayTime, useLoad } from '../../lib/gym.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, Select, useDialog, useToast } from '../../components/ui.jsx';
import { Panel, useAction } from '../salon/parts.jsx';
import { useT } from '../../i18n/useT.js';

const KIND = { QR_READER: 'QR reader', RFID_READER: 'RFID / NFC reader', TURNSTILE: 'Turnstile', CONTROLLER: 'Access controller' };

const SecretDialog = ({ secret, onClose }) => {
  const tr = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Modal title={tr('Save this secret now')} onClose={onClose} footer={<Button onClick={onClose}>{tr('I have saved it')}</Button>}>
      <Alert>{tr('This is the only time the secret is shown. FlowXP keeps it encrypted and cannot show it again. If it is lost, rotate it.')}</Alert>
      <dl className="mt-4 space-y-3 text-small">
        <div><dt className="text-ink-500">{tr('Device key')}</dt><dd className="mt-0.5 break-all rounded-lg bg-surface-2 p-2 font-mono">{secret.key_id}</dd></div>
        <div><dt className="text-ink-500">{tr('Secret')}</dt><dd className="mt-0.5 break-all rounded-lg bg-surface-2 p-2 font-mono">{secret.secret}</dd></div>
      </dl>
      <Button className="mt-3" size="sm" variant="secondary" onClick={() => { navigator.clipboard?.writeText(`${secret.key_id}\n${secret.secret}`); setCopied(true); }}>{copied ? tr('Copied') : tr('Copy both')}</Button>
      {secret.old_secret_valid_until && <p className="mt-3 text-caption text-ink-500">{tr('The old secret keeps working until {{dayTime}}, so you can update the device without a gap.', { dayTime: dayTime(secret.old_secret_valid_until) })}</p>}
    </Modal>
  );
};

const DeviceForm = ({ branches, kinds, onClose, onSaved }) => {
  const tr = useT();
  const [f, setF] = useState({ name: '', kind: 'QR_READER', branch_id: branches[0]?.branch_id ?? '', offline_policy: 'NONE' });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal title={tr('Register a device')} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button loading={busy} disabled={!f.name.trim()} onClick={() => run(async () => { setError(''); try { onSaved(await api('/gym/devices', { method: 'POST', body: { name: f.name, kind: f.kind, branch_id: Number(f.branch_id), offline_policy: f.offline_policy } })); } catch (e) { setError(e.message); } }, null)}>{tr('Register')}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="dv-name" label={tr('Name')}><Input id="dv-name" value={f.name} onChange={set('name')} autoFocus placeholder={tr('Front door reader')} /></Field>
        <Field id="dv-kind" label={tr('What it is')}><Select id="dv-kind" value={f.kind} onChange={set('kind')}>{kinds.map((k) => <option key={k} value={k}>{KIND[k] || k}</option>)}</Select></Field>
        <Field id="dv-branch" label={tr('Branch')}><Select id="dv-branch" value={f.branch_id} onChange={set('branch_id')}>{branches.map((b) => <option key={b.branch_id} value={b.branch_id}>{b.name}</option>)}</Select></Field>
        <Field id="dv-off" label={tr('If it cannot reach FlowXP')} hint={f.offline_policy === 'NONE' ? tr('The gate stays shut. The safest choice.') : 'It may open on its own and report afterwards; FlowXP checks each report and flags anyone who should not have been let in.'}>
          <Select id="dv-off" value={f.offline_policy} onChange={set('offline_policy')}><option value="NONE">{tr('Keep the gate shut')}</option><option value="REPORT_ONLY">{tr('Open by itself, report later')}</option></Select>
        </Field>
      </div>
      <p className="mt-3 text-caption text-ink-500">The device talks to FlowXP with a signed request. Only a device built to the FlowXP gym device contract can be connected; there is no adapter for any particular vendor's hardware yet.</p>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Modal>
  );
};

export default function GymDevices({ settings }) {
  const tr = useT();
  const toast = useToast();
  const dialog = useDialog();
  const list = useLoad('/gym/devices');
  const problems = useLoad('/gym/devices/problems');
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState(null);
  const devices = list.data?.devices || [];
  const reload = () => { list.reload(); problems.reload(); };
  const call = async (id, what, body, ok) => { try { const out = await api(`/gym/devices/${id}/${what}`, { method: 'POST', body }); if (ok) toast.success(ok); reload(); return out; } catch (e) { toast.error(e.message); return null; } };
  const rotate = async (d) => {
    const hard = await dialog.confirm({ title: `Rotate ${d.name}'s secret?`, body: tr('A new secret is made. The old one keeps working for 24 hours so the device can be updated. Choose "End it now" if the old secret may have leaked.'), confirmLabel: tr('Keep the old one for a day'), cancelLabel: tr('End it now') });
    const out = await call(d.device_id, 'rotate-secret', { immediate: !hard });
    if (out) setSecret(out);
  };
  const p = problems.data;
  return (
    <div className="space-y-5">
      <Panel title={tr('Devices')} lead={tr('Readers and gates that ask FlowXP whether to open.')} action={<Button size="sm" onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Register a device')}</Button>}>
        <ListState loading={list.loading && !list.data} error={list.error} empty={!list.loading && !devices.length} emptyLabel={tr('No devices yet.')} emptyBody="You do not need one: the front desk and members' phones work without any hardware." />
        <ul className="divide-y divide-line">
          {devices.map((d) => (
            <li key={d.device_id} className="flex flex-wrap items-center gap-3 py-3 text-small">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${d.status !== 'ACTIVE' ? 'bg-ink-300' : d.online ? 'bg-success' : 'bg-warning'}`} aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="font-medium text-ink-900">{d.name}</span><span className="block text-caption text-ink-500">{KIND[d.kind]} · {(settings?.branches || []).find((b) => b.branch_id === d.branch_id)?.name} · {d.status !== 'ACTIVE' ? tr('switched off') : d.online ? 'online' : d.last_seen_at ? `last heard ${dayTime(d.last_seen_at)}` : tr('never connected')}{d.offline_policy === 'REPORT_ONLY' ? tr('· may open offline') : ''}</span></span>
              {d.health?.firmware && <Badge>v{d.health.firmware}</Badge>}
              <Button size="sm" variant="secondary" onClick={() => rotate(d)}><RefreshCw aria-hidden="true" className="h-4 w-4" />{tr('Rotate secret')}</Button>
              {d.status === 'ACTIVE' ? <Button size="sm" variant="ghost" onClick={() => call(d.device_id, 'disable', {}, 'Switched off')}>{tr('Switch off')}</Button> : <Button size="sm" variant="ghost" onClick={() => call(d.device_id, 'enable', {}, 'Switched on')}>{tr('Switch on')}</Button>}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title={tr('Things to look at')} lead={tr('From the last two weeks')}>
        <ListState loading={problems.loading && !p} error={problems.error} />
        {p && !p.gate_not_confirmed.length && !p.admitted_in_error.length && <p className="text-small text-ink-500">{tr('Everything adds up.')}</p>}
        {p?.admitted_in_error.length > 0 && (
          <div className="mb-4">
            <h3 className="flex items-center gap-1.5 text-small font-semibold text-danger"><TriangleAlert aria-hidden="true" className="h-4 w-4" />{tr('Let in by a device, but should not have been')}</h3>
            <ul className="mt-1 divide-y divide-line text-small">{p.admitted_in_error.map((x) => <li key={x.event_id} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{x.member_name || 'Unknown card'} <span className="text-caption text-ink-500">{x.member_code}</span></span><span className="text-ink-500">{x.device} · {dayTime(x.occurred_at)} · {x.reason_code.toLowerCase().replace(/_/g, ' ')}</span></li>)}</ul>
          </div>
        )}
        {p?.gate_not_confirmed.length > 0 && (
          <div>
            <h3 className="text-small font-semibold text-ink-900">{tr('A gate that did not confirm it opened')}</h3>
            <ul className="mt-1 divide-y divide-line text-small">{p.gate_not_confirmed.map((x) => <li key={x.command_id} className="flex flex-wrap justify-between gap-2 py-1.5"><span>{x.member_name || 'Unknown'} <span className="text-caption text-ink-500">{x.member_code}</span></span><span className="text-ink-500">{x.device} · {dayTime(x.issued_at)} · {x.status === 'TIMED_OUT' ? tr('no answer') : x.status.toLowerCase().replace('_', ' ')}</span></li>)}</ul>
          </div>
        )}
      </Panel>
      {adding && <DeviceForm branches={settings?.branches || []} kinds={list.data?.kinds || ['QR_READER', 'RFID_READER', 'TURNSTILE', 'CONTROLLER']} onClose={() => setAdding(false)} onSaved={(out) => { setAdding(false); setSecret({ key_id: out.key_id, secret: out.secret }); reload(); }} />}
      {secret && <SecretDialog secret={secret} onClose={() => setSecret(null)} />}
    </div>
  );
}
