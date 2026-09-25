/*
 * Flow AI: ask about the business in plain English. Answers are worked out from
 * the business's own records by the server (read-only, limited to what this
 * person can already open); this page is the conversation and nothing more.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Badge, Button, Card, PageHeader } from '../components/ui.jsx';

/* A small, safe renderer for the plain formatting the assistant uses (bullets, numbers, **bold**). No HTML is ever injected. */
const inline = (text) => text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part));

const RichText = ({ text }) => {
  const blocks = []; let list = null;
  const flush = () => { if (list) { blocks.push(list); list = null; } };
  text.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-•*]\s+(.*)/); const numbered = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (bullet || numbered) {
      const kind = bullet ? 'ul' : 'ol';
      if (!list || list.kind !== kind) { flush(); list = { kind, items: [], key: i }; }
      list.items.push((bullet || numbered)[1]);
    } else { flush(); if (line.trim()) blocks.push({ kind: 'p', text: line.replace(/^#+\s*/, ''), key: i }); }
  });
  flush();
  return (
    <div className="space-y-2 text-sm leading-relaxed text-ink-800">
      {blocks.map((b) => b.kind === 'p'
        ? <p key={b.key}>{inline(b.text)}</p>
        : b.kind === 'ul'
          ? <ul key={b.key} className="list-disc space-y-1 pl-5">{b.items.map((t, i) => <li key={i}>{inline(t)}</li>)}</ul>
          : <ol key={b.key} className="list-decimal space-y-1 pl-5">{b.items.map((t, i) => <li key={i}>{inline(t)}</li>)}</ol>)}
    </div>
  );
};

const Message = ({ m }) => (
  <div className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
    <div className={`max-w-[92%] rounded-2xl px-4 py-3 sm:max-w-[80%] ${m.role === 'user' ? 'bg-brand-500 text-white' : 'glass'}`}>
      {m.role === 'user' ? <p className="whitespace-pre-wrap text-sm">{m.content}</p> : <RichText text={m.content} />}
      {m.role === 'assistant' && m.tools?.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2 text-xs text-ink-400">
          Looked at {m.tools.map((t) => <Badge key={t.name} tone="neutral">{t.label}</Badge>)}
        </p>
      )}
    </div>
  </div>
);

const AIManagerPage = () => {
  const { business, activeOutlet, outletId } = useAuth();
  const [status, setStatus] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);
  const isOwner = business?.role === 'OWNER';

  const loadStatus = () => api('/ai/status').then(setStatus).catch((e) => setError(e.status === 403 ? 'Flow AI is for owners, admins and managers.' : e.message));
  const loadConversations = () => api('/ai/conversations').then(setConversations).catch(() => {});
  useEffect(() => { loadStatus(); loadConversations(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy]);

  const open = async (id) => {
    setError('');
    try { const c = await api(`/ai/conversations/${id}`); setConversationId(id); setMessages(c.messages); }
    catch (caught) { setError(caught.message); }
  };
  const fresh = () => { setConversationId(null); setMessages([]); setError(''); };

  const send = async (question, path = '/ai/chat') => {
    setError(''); setBusy(true);
    const isBriefing = path === '/ai/briefing';
    if (!isBriefing) setMessages((ms) => [...ms, { role: 'user', content: question }]);
    else { setConversationId(null); setMessages([{ role: 'user', content: 'Give me my briefing' }]); }
    try {
      const result = await api(path, { method: 'POST', body: isBriefing ? undefined : { message: question, conversation_id: conversationId || undefined } });
      setConversationId(result.conversation_id);
      setMessages((ms) => [...ms, { role: 'assistant', content: result.answer, tools: result.tools_used }]);
      loadStatus(); loadConversations();
    } catch (caught) { setError(caught.message); if (!isBriefing) setMessages((ms) => ms.slice(0, -1)); if (!isBriefing) setText(question); }
    finally { setBusy(false); }
  };

  const submit = (e) => {
    e.preventDefault();
    const q = text.trim();
    if (!q || busy || !status?.can_ask) return;
    setText(''); send(q);
  };

  const toggle = async () => {
    try { await api('/ai/settings', { method: 'PUT', body: { enabled: !status.enabled } }); loadStatus(); }
    catch (caught) { setError(caught.message); }
  };

  if (!status) return <div><PageHeader title="Flow AI" />{error ? <Alert>{error}</Alert> : <p className="py-10 text-center text-sm text-ink-400">Loading…</p>}</div>;

  const scope = outletId === 'all' ? 'all outlets' : activeOutlet?.name;
  return (
    <div>
      <PageHeader
        title="Flow AI"
        lead={`Ask about ${scope ? scope : 'your business'} in plain English. Answers come from your own records${status.remaining != null ? ` · ${status.remaining} of ${status.limit} questions left this month` : ''}.`}
        action={<div className="flex gap-2">
          <Button variant="secondary" onClick={() => send('', '/ai/briefing')} disabled={busy || !status.can_ask}>Daily briefing</Button>
          <Button variant="ghost" onClick={fresh}>New chat</Button>
        </div>}
      />

      {!status.configured && (
        <Card className="mb-6"><p className="text-sm font-semibold text-ink-900">Flow AI isn’t set up on this server yet.</p>
          <p className="mt-1 text-sm text-ink-500">Whoever runs FlowXP needs to add an AI key (<code>ANTHROPIC_API_KEY</code> in the backend settings). Until then nothing is sent anywhere and the rest of the app works as usual.</p></Card>
      )}
      {status.configured && !status.enabled && (
        <Card className="mb-6 flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-ink-700">Flow AI is switched off for this business, so nothing is sent to the AI service.</p>
          {isOwner && <Button size="sm" onClick={toggle}>Turn on</Button>}</Card>
      )}
      {status.remaining === 0 && <div className="mb-4"><Alert>You have used all {status.limit} AI questions on your plan this month. They reset next month.</Alert></div>}

      <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
        <aside className="order-2 lg:order-1">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">Earlier</p>
          {conversations.length === 0 ? <p className="text-sm text-ink-400">Nothing yet.</p> : (
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li key={c.conversation_id}>
                  <button onClick={() => open(c.conversation_id)} className={`block w-full truncate rounded-lg px-3 py-2 text-left text-sm ${c.conversation_id === conversationId ? 'bg-brand-50 font-semibold text-brand-600' : 'text-ink-700 hover:bg-surface-2'}`}>{c.title}</button>
                </li>
              ))}
            </ul>
          )}
          {isOwner && status.configured && status.enabled && (
            <button onClick={toggle} className="mt-6 text-xs font-semibold text-ink-400 hover:text-danger">Turn Flow AI off for this business</button>
          )}
        </aside>

        <section className="order-1 flex min-h-[26rem] flex-col lg:order-2">
          <div className="flex-1 space-y-4">
            {messages.length === 0 && !busy && (
              <div className="rounded-[--radius-card] border border-dashed border-line-strong p-6">
                <p className="text-sm font-semibold text-ink-900">Try asking</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {status.suggestions.map((s) => (
                    <button key={s} onClick={() => status.can_ask && send(s)} disabled={!status.can_ask || busy}
                            className="rounded-full border border-line-strong bg-surface px-3.5 py-1.5 text-left text-sm text-ink-700 hover:border-brand-500 hover:text-brand-600 disabled:opacity-50">{s}</button>
                  ))}
                </div>
                <p className="mt-4 text-xs text-ink-400">Flow AI only reads your figures and can’t change anything. Forecasts and profit numbers are estimates. Summarised figures are sent to the AI service; customer names and phone numbers never are.</p>
              </div>
            )}
            {messages.map((m, i) => <Message key={i} m={m} />)}
            {busy && <div className="flex justify-start"><div className="glass rounded-2xl px-4 py-3 text-sm text-ink-500">Looking at your numbers…</div></div>}
            <div ref={endRef} />
          </div>

          <div className="mt-4"><Alert>{error}</Alert></div>
          <form onSubmit={submit} className="sticky bottom-0 mt-3 flex gap-2 bg-surface-2 pb-2 pt-1">
            <textarea
              rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={1000}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) submit(e); }}
              placeholder={status.can_ask ? 'Ask anything about sales, stock, staff or the kitchen…' : 'Flow AI isn’t available right now'}
              disabled={!status.can_ask}
              className="min-w-0 flex-1 resize-none rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none disabled:opacity-60"
            />
            <Button type="submit" disabled={busy || !text.trim() || !status.can_ask}>Send</Button>
          </form>
        </section>
      </div>
    </div>
  );
};

export default AIManagerPage;
