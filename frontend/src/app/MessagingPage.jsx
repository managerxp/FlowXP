/*
 * Customer messaging: turn WhatsApp/SMS on, send an offer, and see every message sent.
 * Bills, booking confirmations and "table ready" go out on their own once the channel is on.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Alert, Badge, Button, Card, Field, ListState, PageHeader, Select, Table, Td, Textarea, Th, Thead, Tr, useToast } from '../components/ui.jsx';

const TONE = { SENT: 'success', FAILED: 'danger', SKIPPED: 'warning', QUEUED: 'neutral' };
const when = (iso) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const TOGGLES = [
  ['bill_auto', 'Send the bill to customers with a mobile number', 'After every sale to a customer, with a link to view the bill.'],
  ['reservation_updates', 'Booking confirmations and cancellations', 'When a reservation with a mobile number is made or cancelled.'],
  ['waitlist_updates', 'Waitlist updates', 'When someone joins the waitlist and when their table is ready.'],
  ['loyalty_nudge', 'Loyalty reminder', 'When a customer\'s next visit earns their free item (at most once a week).']
];

const Settings = () => {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [templates, setTemplates] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api('/messaging/settings').then(setData).catch((e) => setError(e.message)); }, []);

  const save = async (patch) => {
    setError('');
    try { setData(await api('/messaging/settings', { method: 'PUT', body: patch })); toast.success('Saved'); }
    catch (caught) { setError(caught.message); }
  };
  if (!data) return <ListState loading={!error} error={error} />;
  const { settings, provider } = data;

  return (
    <div className="space-y-6">
      <Alert>{error}</Alert>
      {!provider.connected && (
        <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-ink-700">
          No messaging service is connected on the server yet, so messages are only recorded as <strong>skipped</strong>. Ask whoever runs the server to set it up (see DEPLOY.md: WhatsApp Cloud API or Twilio).
        </p>
      )}
      <Card className="p-5">
        <Field id="ch" label="Send messages by" hint={provider.connected ? `Connected: ${provider.name.replace('_', ' ')}` : undefined}>
          <Select id="ch" value={settings.channel} onChange={(e) => save({ channel: e.target.value })}>
            <option value="OFF">Off: send nothing</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="SMS">SMS</option>
          </Select>
        </Field>
        <div className={`mt-4 space-y-3 ${settings.channel === 'OFF' ? 'opacity-50' : ''}`}>
          {TOGGLES.map(([key, label, hint]) => (
            <label key={key} className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1" checked={settings[key]} disabled={settings.channel === 'OFF'} onChange={(e) => save({ [key]: e.target.checked })} />
              <span><span className="font-medium text-ink-900">{label}</span><span className="block text-xs text-ink-500">{hint}</span></span>
            </label>
          ))}
        </div>
      </Card>
      <p className="text-xs text-ink-500">Offers and reminders only go to customers who have not opted out. Bills and booking messages are service messages and are sent regardless.</p>

      <div>
        <button className="text-sm font-semibold text-brand-600" onClick={() => (templates ? setTemplates(null) : api('/messaging/templates').then(setTemplates).catch((e) => setError(e.message)))}>
          {templates ? 'Hide' : 'Show'} the WhatsApp templates to create in Meta
        </button>
        {templates && (
          <div className="mt-3 space-y-2">
            <p className="text-xs text-ink-500">WhatsApp only lets a business start a chat with pre-approved templates. Create each one once in Meta Business Manager (category: Utility for bills and bookings, Marketing for offers), using exactly this name and text.</p>
            {templates.map((t) => (
              <Card key={t.kind} className="p-3 text-sm"><p className="font-mono text-xs text-brand-600">{t.name} {t.promo && <Badge tone="warning">Marketing</Badge>}</p><p className="mt-1 text-ink-700">{t.body}</p></Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

const Offers = () => {
  const toast = useToast();
  const [segments, setSegments] = useState({});
  const [segment, setSegment] = useState('ALL');
  const [days, setDays] = useState(30);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [batch, setBatch] = useState(null);
  const [progress, setProgress] = useState(null);

  useEffect(() => { api('/messaging/settings').then((d) => setSegments(d.segments)).catch(() => {}); }, []);
  useEffect(() => {
    setPreview(null);
    api('/messaging/campaigns/preview', { method: 'POST', body: { segment, days: Number(days) } }).then(setPreview).catch((e) => setPreview({ error: e.message }));
  }, [segment, days]);
  useEffect(() => {
    if (!batch) return undefined;
    const tick = () => api(`/messaging/campaigns/${batch}`).then(setProgress).catch(() => {});
    tick(); const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [batch]);

  const send = async () => {
    if (!window.confirm(`Send this offer to ${preview.count} customer${preview.count === 1 ? '' : 's'}?`)) return;
    setBusy(true); setError('');
    try { const r = await api('/messaging/campaigns', { method: 'POST', body: { segment, days: Number(days), text } }); setBatch(r.batch); setText(''); toast.success(`Sending to ${r.recipients} customers`); }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-2xl space-y-4">
      <Alert>{error}</Alert>
      <Field id="seg" label="Send to">
        <Select id="seg" value={segment} onChange={(e) => setSegment(e.target.value)}>
          {Object.entries(segments).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </Select>
      </Field>
      {segment === 'LAPSED' && (
        <Field id="days" label="Not visited in the last (days)"><Select id="days" value={days} onChange={(e) => setDays(e.target.value)}>{[14, 30, 60, 90].map((d) => <option key={d} value={d}>{d}</option>)}</Select></Field>
      )}
      <p className="text-sm text-ink-600">{!preview ? 'Counting…' : preview.error ? preview.error : `${preview.count} customer${preview.count === 1 ? '' : 's'} will get it${preview.sample?.length ? ` (${preview.sample.join(', ')}${preview.count > preview.sample.length ? '…' : ''})` : ''}.`}</p>
      <Field id="offer" label="Your offer" hint={`${text.length}/300. Sent as: "Hi <name>, <your business>: <your text> Reply STOP to opt out."`}>
        <Textarea id="offer" rows={3} maxLength={300} value={text} onChange={(e) => setText(e.target.value)} placeholder="Flat 10% off on dinner this weekend. Show this message at the counter." />
      </Field>
      <Button disabled={busy || text.trim().length < 5 || !preview || preview.error || preview.count === 0} onClick={send}>{busy ? 'Sending…' : 'Send offer'}</Button>
      {progress && <p className="text-sm text-ink-600">Sent {progress.sent || 0}{progress.failed ? ` · failed ${progress.failed}` : ''}{progress.skipped ? ` · skipped ${progress.skipped}` : ''}</p>}
      <p className="text-xs text-ink-400">One offer per hour, so customers are not flooded. Customers who opted out are left out automatically.</p>
    </div>
  );
};

const Log = () => {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const load = () => api(`/messaging/messages${status ? `?status=${status}` : ''}`).then(setRows).catch((e) => setError(e.message));
  useEffect(() => { setRows(null); load(); }, [status]);   // eslint-disable-line react-hooks/exhaustive-deps

  const resend = async (m) => {
    try { const r = await api(`/messaging/messages/${m.message_id}/resend`, { method: 'POST' }); toast.success(r.status === 'SENT' ? 'Sent' : `Still ${r.status.toLowerCase()}`); load(); }
    catch (caught) { setError(caught.message); }
  };

  return (
    <div>
      <div className="mb-4 max-w-xs"><Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="">All messages</option><option value="failed">Failed</option><option value="skipped">Skipped</option><option value="sent">Sent</option>
      </Select></div>
      <Alert>{error}</Alert>
      <ListState loading={!rows && !error} empty={rows?.length === 0} emptyLabel="No messages yet." />
      {rows?.length > 0 && (
        <Table>
          <Thead><Th>When</Th><Th>To</Th><Th>Message</Th><Th>Status</Th><Th></Th></Thead>
          <tbody>
            {rows.map((m) => (
              <Tr key={m.message_id}>
                <Td className="whitespace-nowrap text-xs text-ink-500">{when(m.created_at)}</Td>
                <Td>{m.customer_name || m.phone}<span className="block text-xs text-ink-400">{m.phone} · {m.channel === 'WHATSAPP' ? 'WhatsApp' : 'SMS'}</span></Td>
                <Td className="max-w-md text-xs text-ink-700">{m.body}{m.error && <span className="block text-danger">{m.error}</span>}</Td>
                <Td><Badge tone={TONE[m.status]}>{m.status}</Badge></Td>
                <Td className="text-right">{['FAILED', 'SKIPPED'].includes(m.status) && <button onClick={() => resend(m)} className="text-xs font-semibold text-brand-600">Retry</button>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
};

const MessagingPage = () => {
  const [tab, setTab] = useState('settings');
  return (
    <div>
      <PageHeader title="Messaging" lead="Send bills, booking updates and offers to customers on WhatsApp or SMS." />
      <div className="mb-6 flex gap-2" role="tablist">
        {[['settings', 'Settings'], ['offers', 'Send an offer'], ['log', 'Message log']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                  className={`rounded-lg px-3.5 py-1.5 text-sm font-medium ${tab === id ? 'bg-brand-50 text-brand-600' : 'text-ink-600 hover:bg-surface-2'}`}>{label}</button>
        ))}
      </div>
      {tab === 'settings' ? <Settings /> : tab === 'offers' ? <Offers /> : <Log />}
    </div>
  );
};

export default MessagingPage;
