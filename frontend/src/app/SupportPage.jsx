/*
 * Help and support: raise a ticket, read FlowXP's answer, write back. One page, three views: the list, a new ticket, one conversation.
 * The conversation only ever shows this person's own tickets (the server checks it).
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Alert, Badge, Button, Card, Field, Input, PageHeader, Select, Textarea, useToast, PageLoader } from '../components/ui.jsx';

const CATEGORIES = [
  ['QUESTION', 'A question about using FlowXP'], ['BILLING', 'Billing, plan or invoice'], ['WHATSAPP', 'WhatsApp messages or credit'],
  ['SETUP', 'Help setting up'], ['BUG', 'Something is not working'], ['OTHER', 'Something else']
];
const STATUS = { OPEN: ['Waiting for us', 'warning'], ANSWERED: ['We replied', 'success'], CLOSED: ['Closed', 'neutral'] };
const when = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

const NewTicket = ({ onCreated, onCancel }) => {
  const toast = useToast();
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('QUESTION');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const send = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try { const r = await api('/support/tickets', { method: 'POST', body: { subject, category, body } }); toast.success('Sent. We will reply here.'); onCreated(r.ticket_id); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <Card className="p-5">
      <h2 className="font-semibold text-ink-900">Ask for help</h2>
      <form onSubmit={send} className="mt-3 space-y-3">
        <Alert>{error}</Alert>
        <Field id="t-cat" label="What is it about?"><Select id="t-cat" value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field id="t-sub" label="Title"><Input id="t-sub" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={160} placeholder="A few words" required /></Field>
        <Field id="t-body" label="Tell us what happened" hint="What you were doing, and what you expected."><Textarea id="t-body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} required /></Field>
        <div className="flex gap-2"><Button type="submit" loading={busy}>Send</Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div>
      </form>
    </Card>
  );
};

const Conversation = ({ id, onBack }) => {
  const toast = useToast();
  const [t, setT] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = () => api(`/support/tickets/${id}`).then(setT).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const reply = async (e) => {
    e.preventDefault(); setError(''); setBusy(true);
    try { await api(`/support/tickets/${id}/reply`, { method: 'POST', body: { body: text } }); setText(''); await load(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const close = async () => { try { await api(`/support/tickets/${id}/close`, { method: 'POST' }); toast.success('Closed'); await load(); } catch (err) { setError(err.message); } };
  if (!t) return error ? <Alert>{error}</Alert> : <PageLoader compact />;
  const [label, tone] = STATUS[t.status] || STATUS.OPEN;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={onBack}>← All my tickets</Button>
        <Badge tone={tone}>{label}</Badge>
        <span className="flex-1" />
        {t.status !== 'CLOSED' && <Button variant="ghost" onClick={close}>It is solved, close it</Button>}
      </div>
      <h2 className="text-lg font-semibold text-ink-900">{t.subject}</h2>
      <Alert>{error}</Alert>
      <ul className="space-y-3">
        {t.messages.map((m) => (
          <li key={m.message_id} className={`max-w-[85%] rounded-xl p-3 text-sm ${m.sender === 'ADMIN' ? 'bg-brand-50 text-ink-900' : 'ml-auto border border-line bg-white text-ink-800'}`}>
            <p className="mb-1 text-xs text-ink-500">{m.sender === 'ADMIN' ? 'FlowXP support' : 'You'} · {when(m.created_at)}</p>
            <p className="whitespace-pre-wrap">{m.body}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={reply} className="space-y-2">
        <Field id="t-reply" label={t.status === 'CLOSED' ? 'Write again to reopen this' : 'Your reply'}><Textarea id="t-reply" rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} /></Field>
        <Button type="submit" loading={busy} disabled={!text.trim()}>Send</Button>
      </form>
    </div>
  );
};

const SupportPage = () => {
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState(params.get('open') ? { name: 'one', id: Number(params.get('open')) } : { name: 'list' });
  const load = () => api('/support/tickets').then(setRows).catch((e) => setError(e.message));
  useEffect(() => { load(); }, [view.name]);   // eslint-disable-line react-hooks/exhaustive-deps
  const back = () => { setParams({}); setView({ name: 'list' }); };

  return (
    <div>
      <PageHeader title="Help and support" lead="Ask us anything. We answer here, and tell you on your phone when we do." action={view.name === 'list' ? <Button onClick={() => setView({ name: 'new' })}>New ticket</Button> : null} />
      {view.name === 'new' && <NewTicket onCreated={(id) => setView({ name: 'one', id })} onCancel={back} />}
      {view.name === 'one' && <Conversation id={view.id} onBack={back} />}
      {view.name === 'list' && (
        <>
          <Alert>{error}</Alert>
          {!rows && !error && <PageLoader compact />}
          {rows?.length === 0 && <Card className="p-5 text-sm text-ink-600">You have not asked us anything yet. Tap <b>New ticket</b> and we will help.</Card>}
          <ul className="space-y-2">
            {(rows || []).map((r) => {
              const [label, tone] = STATUS[r.status] || STATUS.OPEN;
              return (
                <li key={r.ticket_id}>
                  <button type="button" onClick={() => setView({ name: 'one', id: r.ticket_id })} className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-white p-4 text-left hover:border-ink-400">
                    <span><span className="font-medium text-ink-900">{r.subject}</span><span className="block text-xs text-ink-500">{when(r.last_message_at)}</span></span>
                    <span className="flex items-center gap-2">{r.unread_client && <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-semibold text-white">New answer</span>}<Badge tone={tone}>{label}</Badge></span>
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

export default SupportPage;
