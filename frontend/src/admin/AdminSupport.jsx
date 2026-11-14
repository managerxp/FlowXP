/*
 * Support inbox: every ticket a client raised from the app. Waiting-for-us first; open one to read the conversation and answer.
 * The client is told on their phone and in their notifications when an answer is written.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../lib/adminApi.js';
import { PageHeader, Card, Field, Input, Select, Button, Alert, Badge, Textarea, useToast } from '../components/ui.jsx';

const STATUS = { OPEN: ['Waiting for us', 'danger'], ANSWERED: ['Answered', 'success'], CLOSED: ['Closed', 'neutral'] };
const CATEGORY = { BILLING: 'Billing', WHATSAPP: 'WhatsApp', SETUP: 'Setup', BUG: 'Not working', QUESTION: 'Question', OTHER: 'Other' };
const when = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const One = ({ id, onBack, onChanged }) => {
  const toast = useToast();
  const [t, setT] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => adminApi(`/support/tickets/${id}`).then(setT).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    setBusy(true); setError('');
    try { await adminApi(`/support/tickets/${id}/reply`, { method: 'POST', body: { body: text } }); setText(''); toast.success('Sent to the client'); await load(); onChanged(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  const setStatus = async (status) => { try { await adminApi(`/support/tickets/${id}`, { method: 'PATCH', body: { status } }); await load(); onChanged(); } catch (e) { setError(e.message); } };
  if (!t) return error ? <Alert>{error}</Alert> : null;
  const [label, tone] = STATUS[t.status] || STATUS.OPEN;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={onBack}>← Back</Button>
        <Badge tone={tone}>{label}</Badge>
        <Badge>{CATEGORY[t.category] || t.category}</Badge>
        <span className="flex-1" />
        {t.status === 'CLOSED' ? <Button variant="ghost" onClick={() => setStatus('OPEN')}>Reopen</Button> : <Button variant="ghost" onClick={() => setStatus('CLOSED')}>Close</Button>}
      </div>
      <div>
        <h2 className="text-lg font-semibold text-ink-900">{t.subject}</h2>
        <p className="text-sm text-ink-500">
          {t.business_id ? <Link to={`/superadmin/businesses/${t.business_id}`} className="font-medium text-brand-600 hover:underline">{t.business_name}</Link> : 'No business'} · {t.user_name} · {t.user_email}{t.user_phone ? ` · ${t.user_phone}` : ''}
        </p>
      </div>
      <Alert>{error}</Alert>
      <ul className="space-y-3">
        {t.messages.map((m) => (
          <li key={m.message_id} className={`max-w-[85%] rounded-xl p-3 text-sm ${m.sender === 'ADMIN' ? 'ml-auto bg-brand-50' : 'border border-line bg-white'}`}>
            <p className="mb-1 text-xs text-ink-500">{m.sender === 'ADMIN' ? `You (${m.from_name || 'FlowXP'})` : m.from_name || 'Client'} · {when(m.created_at)}</p>
            <p className="whitespace-pre-wrap text-ink-900">{m.body}</p>
          </li>
        ))}
      </ul>
      <Card className="p-4">
        <Field id="s-reply" label="Your answer"><Textarea id="s-reply" rows={4} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} /></Field>
        <div className="mt-2"><Button onClick={send} loading={busy} disabled={!text.trim()}>Send answer</Button></div>
      </Card>
    </div>
  );
};

const AdminSupport = () => {
  const [rows, setRows] = useState(null);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const load = () => {
    const p = new URLSearchParams(); if (status) p.set('status', status); if (search) p.set('search', search);
    adminApi(`/support/tickets?${p}`).then((r) => { setRows(r); setError(''); }).catch((e) => setError(e.message));
  };
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [status, search]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div>
      <PageHeader title="Support" lead="Tickets your clients raised from the app. Answer here; they are told on their phone." />
      {open ? <One id={open} onBack={() => setOpen(null)} onChanged={load} /> : (
        <>
          <div className="mb-4 flex flex-wrap gap-3">
            <div className="w-full max-w-xs"><Input placeholder="Search title, business or person" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
            <div className="w-44"><Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">All tickets</option><option value="OPEN">Waiting for us</option><option value="ANSWERED">Answered</option><option value="CLOSED">Closed</option></Select></div>
          </div>
          <Alert>{error}</Alert>
          {rows?.length === 0 && <Card className="p-5 text-sm text-ink-600">No tickets.</Card>}
          <ul className="space-y-2">
            {(rows || []).map((r) => {
              const [label, tone] = STATUS[r.status] || STATUS.OPEN;
              return (
                <li key={r.ticket_id}>
                  <button type="button" onClick={() => setOpen(r.ticket_id)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-white p-4 text-left hover:border-ink-400">
                    <span>
                      <span className="font-medium text-ink-900">{r.unread_admin && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-danger align-middle" aria-label="Unread" />}{r.subject}</span>
                      <span className="block text-xs text-ink-500">{r.business_name || 'No business'} · {r.user_name} · {CATEGORY[r.category] || r.category} · {when(r.last_message_at)}</span>
                    </span>
                    <Badge tone={tone}>{label}</Badge>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
};

export default AdminSupport;
