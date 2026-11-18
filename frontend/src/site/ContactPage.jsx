/*
 * /contact — real ways to reach us, plus a form that actually sends: POST /api/contact emails the
 * message straight to the FlowXP inbox (backend/src/controllers/contact.controller.js), with the
 * sender's own address set as Reply-To so answering it goes straight back to them.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Alert, Button, Input, Section, Textarea } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';
import { FAQ } from './content.js';
import { PageHero, TextLink } from './parts.jsx';

const EMAIL = 'flowxp.manager@gmail.com';

/* The one bit of "delight" this deliberately form-free page earns: copying the address is one tap on a
   phone, rather than a long-press-to-select. Falls back to just the mailto link if the clipboard API is
   blocked (an iframe preview, an old browser) — nothing here depends on it working. */
const EmailLink = () => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(EMAIL); setCopied(true); setTimeout(() => setCopied(false), 1600); }
    catch { /* clipboard blocked: the mailto link below still works */ }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <a href={`mailto:${EMAIL}`} className="text-h3 font-semibold text-brand-600 hover:text-brand-700">{EMAIL}</a>
      <button
        type="button" onClick={copy}
        className="rounded-md border border-line-strong px-2.5 py-1 text-small font-medium text-ink-700 transition-colors duration-(--duration-fast) hover:border-ink-400"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
};

const blank = { name: '', email: '', subject: '', message: '' };
const TOPICS = ['Pricing and plans', 'A walkthrough for my team', 'Help with my account', 'Moving from my current software', 'Something else'];
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* One question at a time, like talking to a person: name, email, what it is about, then the message. Each answer is
   kept above the question so it can be tapped and changed; Enter moves on. Sends the same four fields as before. */
const STEPS = [
  { key: 'name', ask: 'First, what should we call you?', hint: 'Your name' },
  { key: 'email', ask: 'Where can we reply?', hint: 'you@yourbusiness.com' },
  { key: 'subject', ask: 'What is it about?' },
  { key: 'message', ask: 'Tell us a little more.', hint: 'Your kind of business, how many outlets, what you want to know…' }
];

const ContactForm = () => {
  const [f, setF] = useState(blank);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const cur = STEPS[step];
  const value = f[cur.key];
  const valid = cur.key === 'email' ? EMAIL_OK.test(value.trim()) : value.trim().length > 0;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));

  const send = async () => {
    setBusy(true); setError('');
    try {
      await api('/contact', { method: 'POST', body: f });
      setSent(true); setF(blank); setStep(0);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const next = (e) => {
    e?.preventDefault();
    if (!valid || busy) return;
    if (step < STEPS.length - 1) setStep(step + 1); else send();
  };
  const pickTopic = (t) => { set('subject', t); setStep(step + 1); };

  if (sent) {
    return (
      <div className="rounded-(--radius-panel) border border-line bg-surface p-8 text-center motion-safe:animate-[fade-in_280ms_ease-out]">
        <p className="text-title font-semibold text-ink-900">Thank you, we have it.</p>
        <p className="mt-2 text-body text-ink-500">Someone from the FlowXP team will reply to your email soon.</p>
        <button type="button" onClick={() => setSent(false)} className="mt-4 text-small font-medium text-brand-600 hover:text-brand-700">Send another message</button>
      </div>
    );
  }

  return (
    <div className="rounded-(--radius-panel) border border-line bg-surface p-6 sm:p-8">
      <div className="flex items-center justify-between text-small text-ink-400">
        <span>Question {step + 1} of {STEPS.length}</span>
        {step > 0 && <button type="button" onClick={() => { setError(''); setStep(step - 1); }} className="font-medium text-brand-600 hover:text-brand-700">Back</button>}
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}>
        <div className="h-full rounded-full bg-brand-600 transition-[width] duration-(--duration-normal)" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>

      {step > 0 && (
        <div className="mt-5 flex flex-wrap gap-2">
          {STEPS.slice(0, step).map((st, i) => (
            <button key={st.key} type="button" onClick={() => { setError(''); setStep(i); }} className="max-w-full truncate rounded-full border border-line-strong px-3 py-1 text-small text-ink-700 hover:border-ink-400" title="Change this answer">{f[st.key]}</button>
          ))}
        </div>
      )}

      <form key={step} onSubmit={next} className="mt-6 motion-safe:animate-[fade-in_280ms_ease-out]">
        <label htmlFor={`cf-${cur.key}`} className="block text-h3 font-semibold text-ink-900">{cur.ask}</label>
        <Alert>{error}</Alert>
        {cur.key === 'subject' ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {TOPICS.map((t) => (
              <button key={t} type="button" onClick={() => pickTopic(t)} className={`rounded-full border px-4 py-2 text-body font-medium transition-colors duration-(--duration-fast) ${f.subject === t ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-700 hover:border-ink-400'}`}>{t}</button>
            ))}
          </div>
        ) : cur.key === 'message' ? (
          <div className="mt-4">
            <Textarea id="cf-message" autoFocus rows={5} placeholder={cur.hint} value={value} onChange={(e) => set('message', e.target.value)} maxLength={4000} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) next(e); }} />
            <p className="mt-1 text-small text-ink-400">Ctrl + Enter sends it.</p>
          </div>
        ) : (
          <div className="mt-4"><Input id={`cf-${cur.key}`} autoFocus type={cur.key === 'email' ? 'email' : 'text'} autoComplete={cur.key} placeholder={cur.hint} value={value} onChange={(e) => set(cur.key, e.target.value)} maxLength={cur.key === 'name' ? 120 : 200} /></div>
        )}
        {cur.key !== 'subject' && (
          <div className="mt-5">
            <Button type="submit" size="lg" loading={busy} disabled={!valid} className="w-full sm:w-auto">{step === STEPS.length - 1 ? 'Send message' : 'Next'}</Button>
          </div>
        )}
      </form>
    </div>
  );
};

const WAYS = [
  { title: 'Questions before you sign up', body: 'Pricing, moving from your current software, or whether FlowXP fits how you work.', action: 'Email us', href: `mailto:${EMAIL}?subject=${encodeURIComponent('Question about FlowXP')}` },
  { title: 'A walkthrough for your team', body: 'For several outlets or several businesses, we will show you FlowXP on your kind of business.', action: 'Ask for a walkthrough', href: `mailto:${EMAIL}?subject=${encodeURIComponent('FlowXP walkthrough')}` },
  { title: 'Help with your account', body: 'Already using FlowXP? Write to us from the email you signed up with and tell us your business name.', action: 'Get help', href: `mailto:${EMAIL}?subject=${encodeURIComponent('FlowXP support')}` }
];

const ContactPage = () => (
  <>
    <PageHero
      title="Talk to a person, not a chatbot."
      lead="We would rather answer your questions before you sign up than after. Write to us and someone from the FlowXP team will reply."
      cta={false}
    >
      <EmailLink />
    </PageHero>

    <Section>
      <div className="grid gap-5 md:grid-cols-3">
        {WAYS.map((w, i) => (
          <Reveal key={w.title} index={i} className="lift flex flex-col rounded-(--radius-panel) border border-line bg-surface p-6">
            <h2 className="text-title font-semibold text-ink-900">{w.title}</h2>
            <p className="mt-2 flex-1 text-body text-ink-500">{w.body}</p>
            <div className="mt-5"><TextLink href={w.href}>{w.action}</TextLink></div>
          </Reveal>
        ))}
      </div>
    </Section>

    <Section className="border-t border-line">
      <div className="grid gap-10 lg:grid-cols-12">
        <Reveal className="lg:col-span-5">
          <h2 className="text-h2 font-semibold text-ink-900">Or write to us here.</h2>
          <p className="mt-4 max-w-md text-body text-ink-500">Goes straight to the FlowXP inbox. We reply from the same address you write to us from.</p>
        </Reveal>
        <Reveal index={1} className="lg:col-span-7"><ContactForm /></Reveal>
      </div>
    </Section>

    <Section className="border-t border-line bg-surface">
      <div className="grid gap-10 lg:grid-cols-12">
        <Reveal className="lg:col-span-4">
          <h2 className="text-h2 font-semibold text-ink-900">Quick answers</h2>
          <p className="mt-4 text-body text-ink-500">The questions we are asked most. The rest are on the <Link to="/#faq" className="font-medium text-brand-600 hover:text-brand-700">home page</Link>.</p>
        </Reveal>
        <Reveal index={1} className="divide-y divide-line border-y border-line lg:col-span-8">
          {FAQ.slice(0, 5).map((item) => (
            <details key={item.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-body font-medium text-ink-900">
                {item.q}
                <span aria-hidden="true" className="shrink-0 text-xl leading-none text-ink-400 transition-transform duration-(--duration-normal) group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-body text-ink-500">{item.a}</p>
            </details>
          ))}
        </Reveal>
      </div>
    </Section>
  </>
);

export default ContactPage;
