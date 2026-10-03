/*
 * /contact — real ways to reach us, plus a form that actually sends: POST /api/contact emails the
 * message straight to the FlowXP inbox (backend/src/controllers/contact.controller.js), with the
 * sender's own address set as Reply-To so answering it goes straight back to them.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { Alert, Button, Field, Input, Section, Textarea } from '../components/ui.jsx';
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

const ContactForm = () => {
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/contact', { method: 'POST', body: f });
      setSent(true); setF(blank);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (sent) {
    return (
      <div className="rounded-(--radius-panel) border border-line bg-surface p-8 text-center">
        <p className="text-title font-semibold text-ink-900">Message sent.</p>
        <p className="mt-2 text-body text-ink-500">Someone from the FlowXP team will reply to your email soon.</p>
        <button type="button" onClick={() => setSent(false)} className="mt-4 text-small font-medium text-brand-600 hover:text-brand-700">Send another message</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-(--radius-panel) border border-line bg-surface p-6 sm:p-8">
      <Alert>{error}</Alert>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="cf-name" label="Your name"><Input id="cf-name" value={f.name} onChange={set('name')} required autoComplete="name" maxLength={120} /></Field>
        <Field id="cf-email" label="Your email"><Input id="cf-email" type="email" value={f.email} onChange={set('email')} required autoComplete="email" /></Field>
      </div>
      <Field id="cf-subject" label="Subject"><Input id="cf-subject" value={f.subject} onChange={set('subject')} required maxLength={150} /></Field>
      <Field id="cf-message" label="Message"><Textarea id="cf-message" rows={5} value={f.message} onChange={set('message')} required maxLength={4000} /></Field>
      <Button type="submit" size="lg" loading={busy} className="w-full sm:w-auto">Send message</Button>
    </form>
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
