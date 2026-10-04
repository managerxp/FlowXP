/*
 * "Ask FlowXP": the chat on every public page. A button in the corner opens a small panel where a visitor asks
 * about FlowXP in their own words (any language) and gets a short answer with a link to the right page.
 *
 * The answer comes from our own backend (POST /api/public/assistant, modules/ai/siteAssistant.js), which calls
 * Gemini with the key kept on the server; nothing secret is in this file or the bundle. The conversation lives
 * in sessionStorage only, so it survives moving between pages and is gone when the tab closes; nothing is saved
 * on the server.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUp, RotateCcw, Sparkles, X } from 'lucide-react';
import { api } from '../lib/api.js';
import LatticeLoader from '../components/reactbits/LatticeLoader.jsx';

const KEY = 'flowxp.ask';
const MAX = 600;
const SUGGESTIONS = [
  'Will it work for my pharmacy?',
  'Do I need a printer or billing machine?',
  'How does the free trial work?',
  'Can I run more than one branch?'
];
const GREETING = 'Hi! Ask me anything about FlowXP: what it does for your kind of business, GST, pricing plans or getting started.';

const load = () => {
  try { const v = JSON.parse(sessionStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};
const save = (messages) => { try { sessionStorage.setItem(KEY, JSON.stringify(messages.slice(-30))); } catch { /* private mode */ } };

/* Links in a reply: our own pages open in the site (no reload); anything else in a new tab. */
const LINK = /(https?:\/\/[^\s)]+)/g;
const Linked = ({ text, onNavigate }) => text.split(LINK).map((part, i) => {
  if (!LINK.test(part)) return <span key={i}>{part}</span>;
  LINK.lastIndex = 0;
  const clean = part.replace(/[.,;:!?]+$/, '');
  const tail = part.slice(clean.length);
  let url;
  try { url = new URL(clean); } catch { return <span key={i}>{part}</span>; }
  const own = /(^|\.)flowxp\.in$/.test(url.hostname) || url.origin === window.location.origin;
  const cls = 'font-medium text-brand-600 underline decoration-brand-200 underline-offset-2 hover:text-brand-700';
  return (
    <span key={i}>
      {own
        ? <Link to={`${url.pathname}${url.search}${url.hash}`} onClick={onNavigate} className={cls}>{url.pathname === '/' ? 'flowxp.in' : url.pathname.replace(/^\//, '')}</Link>
        : <a href={clean} target="_blank" rel="noopener noreferrer" className={cls}>{url.hostname}</a>}
      {tail}
    </span>
  );
});

const AskFlowXP = () => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(load);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const input = useRef(null);
  const end = useRef(null);
  const launcher = useRef(null);

  useEffect(() => { save(messages); }, [messages]);
  useEffect(() => { if (open) { input.current?.focus(); end.current?.scrollIntoView({ block: 'end' }); } }, [open]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages, busy, error]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setOpen(false); launcher.current?.focus(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const send = async (raw) => {
    const message = String(raw ?? text).trim().slice(0, MAX);
    if (!message || busy) return;
    const history = messages.map(({ role, text: t }) => ({ role, text: t }));
    setMessages((m) => [...m, { role: 'user', text: message }]);
    setText('');
    setError(null);
    setBusy(true);
    try {
      const data = await api('/public/assistant', { method: 'POST', body: { message, history } });
      setMessages((m) => [...m, { role: 'assistant', text: data.reply }]);
    } catch (caught) {
      setError({ message: caught.message || 'Could not answer that.', retry: message });
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  const retry = () => {
    if (!error) return;
    setMessages((m) => (m.length && m[m.length - 1].role === 'user' ? m.slice(0, -1) : m));
    send(error.retry);
  };
  const reset = () => { setMessages([]); setError(null); setText(''); input.current?.focus(); };
  const closeOnPhone = () => { if (window.matchMedia('(max-width: 639px)').matches) setOpen(false); };

  return (
    <>
      {open && (
        <section role="dialog" aria-modal="false" aria-label="Ask FlowXP"
                 className="ask-panel fixed inset-x-2 bottom-2 top-20 z-[60] flex flex-col overflow-hidden rounded-(--radius-panel) border border-line bg-surface shadow-lg sm:inset-x-auto sm:bottom-24 sm:right-6 sm:top-auto sm:h-[min(36rem,calc(100dvh-8rem))] sm:w-[23rem]">
          <header className="relative flex items-center gap-3 bg-brand-500 px-4 py-3.5 text-white">
            <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15"><Sparkles className="h-[18px] w-[18px]" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-body font-semibold leading-tight">Ask FlowXP</h2>
              <p className="text-caption text-white/75">Answers about FlowXP, in your language</p>
            </div>
            {messages.length > 0 && (
              <button type="button" onClick={reset} aria-label="Start a new chat" title="New chat" className="flex h-9 w-9 items-center justify-center rounded-lg text-white/85 hover:bg-white/10 hover:text-white">
                <RotateCcw aria-hidden="true" className="h-4 w-4" />
              </button>
            )}
            <button type="button" onClick={() => { setOpen(false); launcher.current?.focus(); }} aria-label="Close the chat" className="flex h-9 w-9 items-center justify-center rounded-lg text-white/85 hover:bg-white/10 hover:text-white">
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto bg-surface-2/60 px-4 py-4" aria-live="polite">
            <p className="max-w-[88%] rounded-2xl rounded-bl-md border border-line bg-surface px-3.5 py-2.5 text-small text-ink-900">{GREETING}</p>
            {messages.length === 0 && (
              <ul className="flex flex-wrap gap-2 pt-1" aria-label="Questions to try">
                {SUGGESTIONS.map((q) => (
                  <li key={q}>
                    <button type="button" onClick={() => send(q)} className="rounded-full border border-brand-100 bg-surface px-3 py-1.5 text-small text-brand-700 transition-colors duration-(--duration-fast) hover:border-brand-500 hover:bg-brand-50 active:scale-[0.98]">
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {messages.map((m, i) => (m.role === 'user'
              ? <p key={i} className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-brand-500 px-3.5 py-2.5 text-small text-white [overflow-wrap:anywhere]">{m.text}</p>
              : <p key={i} className="fade-in w-fit max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-md border border-line bg-surface px-3.5 py-2.5 text-small text-ink-900 [overflow-wrap:anywhere]"><Linked text={m.text} onNavigate={closeOnPhone} /></p>))}
            {busy && (
              <div className="w-fit rounded-2xl rounded-bl-md border border-line bg-surface px-3.5 py-2.5 text-ink-500">
                <LatticeLoader label="Thinking" color="var(--color-brand-500)" pattern="ripple" cellSize={4} gap={2} fontSize={13} showTimer={false} />
              </div>
            )}
            {error && (
              <div role="alert" className="w-fit max-w-[90%] rounded-2xl rounded-bl-md border border-danger/20 bg-danger/5 px-3.5 py-2.5 text-small text-ink-900">
                {error.message}{' '}
                <button type="button" onClick={retry} className="font-medium text-brand-600 underline underline-offset-2 hover:text-brand-700">Try again</button>
              </div>
            )}
            <div ref={end} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); send(); }} className="border-t border-line bg-surface p-3">
            <div className="flex items-end gap-2 rounded-(--radius-card) border border-line-strong bg-surface px-3 py-2 focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-500/15">
              <label htmlFor="ask-flowxp" className="sr-only">Your question</label>
              <textarea id="ask-flowxp" ref={input} rows={1} value={text} maxLength={MAX} placeholder="Ask about FlowXP…"
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                        className="max-h-28 min-h-6 flex-1 resize-none bg-transparent py-1 text-small text-ink-900 placeholder:text-ink-400 focus:outline-none [field-sizing:content]" />
              <button type="submit" disabled={busy || !text.trim()} aria-label="Send"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-500 text-white transition-[background-color,transform] duration-(--duration-fast) hover:bg-brand-600 active:scale-95 disabled:bg-surface-3 disabled:text-ink-400">
                <ArrowUp aria-hidden="true" className="h-4 w-4" strokeWidth={2.5} />
              </button>
            </div>
            <p className="mt-2 text-center text-[11px] text-ink-400">AI answers can be wrong. For anything important, <Link to="/contact" onClick={closeOnPhone} className="underline hover:text-ink-700">talk to us</Link>.</p>
          </form>
        </section>
      )}

      <button ref={launcher} type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label={open ? 'Close Ask FlowXP' : 'Ask FlowXP a question'}
              className={`fixed bottom-4 right-4 z-[60] flex h-12 items-center gap-2 rounded-full bg-brand-500 pl-3.5 pr-4 text-small font-semibold text-white shadow-lg transition-[background-color,transform] duration-(--duration-fast) hover:-translate-y-0.5 hover:bg-brand-600 active:scale-95 sm:bottom-6 sm:right-6 ${open ? 'max-sm:hidden' : ''}`}>
        {open ? <X aria-hidden="true" className="h-5 w-5" /> : <Sparkles aria-hidden="true" className="h-5 w-5" />}
        <span>{open ? 'Close' : 'Ask FlowXP'}</span>
      </button>
    </>
  );
};

export default AskFlowXP;
