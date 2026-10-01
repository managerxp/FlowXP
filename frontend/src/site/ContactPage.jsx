/*
 * /contact — real ways to reach us. No form: there is no endpoint behind one
 * yet, and a form that silently goes nowhere is worse than an email address.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Section } from '../components/ui.jsx';
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

const WAYS = [
  { title: 'Questions before you sign up', body: 'Pricing, moving from your current software, or whether FlowXP fits how you work.', action: 'Email us', href: `mailto:${EMAIL}?subject=${encodeURIComponent('Question about FlowXP')}` },
  { title: 'A walkthrough for your team', body: 'For several outlets or several businesses, we will show you FlowXP on your kind of business.', action: 'Ask for a walkthrough', href: `mailto:${EMAIL}?subject=${encodeURIComponent('FlowXP walkthrough')}` },
  { title: 'Help with your account', body: 'Already using FlowXP? Write to us from the email you signed up with and tell us your business name.', action: 'Get help', href: `mailto:${EMAIL}?subject=${encodeURIComponent('FlowXP support')}` }
];

const ContactPage = () => (
  <>
    <PageHero
      eyebrow="Contact"
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
