/*
 * The landing page.
 *
 * Hand-built rather than driven from content.js, because it is the only page
 * with a hero, a pricing table and an FAQ. The rest of the marketing site
 * shares MarketingPage.jsx.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap, prefersReducedMotion } from '../animations/gsap.js';
import { fadeUp, staggerReveal } from '../animations/reveal.js';
import { revealOnScroll } from '../animations/scroll.js';
import { Button, Container, Section } from '../components/ui.jsx';
import { GlowCard } from '../components/BorderGlow.jsx';
import { CORE_FEATURES, DIFFERENTIATORS, FAQ } from './content.js';
import PricingTable from './PricingTable.jsx';
import { HeroMockup, DashboardShowcase } from './ProductVisuals.jsx';
import OneFlow from './OneFlow.jsx';
import AISection from './AISection.jsx';
import IndustrySelector from './IndustrySelector.jsx';
import DigitalBilling from './DigitalBilling.jsx';
import MultiBusiness from './MultiBusiness.jsx';

/*
 * three.js is the single heaviest dependency in this app (its chunk alone is
 * ~240kb gzipped) and nothing else here touches WebGL, so it is never part of
 * the main bundle — this import only resolves once the browser actually asks
 * for it, which Hero delays past the page's critical first paint (see the
 * requestIdleCallback below), not at module-evaluation time.
 */
const Antigravity = lazy(() => import('../components/Antigravity.jsx'));

/* The five words under the logo, as the logo sets them. */
const PILLARS = [
  { label: 'Billing',   color: 'bg-brand-500' },
  { label: 'Payments',  color: 'bg-cyan-500' },
  { label: 'Inventory', color: 'bg-teal-500' },
  { label: 'GST',       color: 'bg-amber-500' },
  { label: 'AI',        color: 'bg-violet-500' }
];

/*
 * The hero's load sequence, exactly as the brief lays it out: badge, then
 * headline line by line, then supporting text, then CTAs staggered, then the
 * pillars, then the dashboard mockup. (The "background fades in" step is a
 * plain CSS animation on .glow-brand::before in index.css — a pseudo-element
 * has no DOM node, so GSAP has nothing there to target; fine, since the ease
 * that matters is on the content, not the ambient wash behind it.)
 *
 * One timeline built from refs, not string selectors: a selector is searched
 * for among the scope's DESCENDANTS only, so it can never find the scope
 * root itself, and a compound one silently matching zero elements fails
 * quietly rather than with an error — exactly the bug this replaced. Refs
 * name the element directly and fail loudly (undefined) if one is ever wrong.
 */
const Hero = () => {
  const scope = useRef(null);
  const badgeRef = useRef(null);
  const lineRefs = useRef([]);
  const subRef = useRef(null);
  const ctaRefs = useRef([]);
  const noteRef = useRef(null);
  const pillarsRef = useRef(null);
  const mockupRef = useRef(null);
  const [showAntigravity, setShowAntigravity] = useState(false);

  /* Deferred past the critical entrance timeline, not gated behind scroll —
     the hero is visible the instant the page loads, so "wait until it scrolls
     into view" (the pattern used elsewhere on this page for offscreen
     content) doesn't apply here. requestIdleCallback still keeps its 894kb
     chunk from competing with the headline/CTA paint that actually matters
     for first impression; the fallback covers Safari, which has never
     implemented it. */
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const ric = window.requestIdleCallback || ((cb) => setTimeout(cb, 300));
    const cic = window.cancelIdleCallback || clearTimeout;
    const id = ric(() => setShowAntigravity(true));
    return () => cic(id);
  }, []);

  useGSAP(() => {
    if (prefersReducedMotion()) return;

    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.from(badgeRef.current, { opacity: 0, y: 12, duration: 0.5 })
      .from(lineRefs.current, { opacity: 0, yPercent: 100, duration: 0.7, stagger: 0.12 }, '-=0.25')
      .from(subRef.current, { opacity: 0, y: 16, duration: 0.6 }, '-=0.35')
      .from(ctaRefs.current, { opacity: 0, y: 12, duration: 0.5, stagger: 0.1 }, '-=0.3')
      .from(noteRef.current, { opacity: 0, duration: 0.4 }, '-=0.2')
      .from([...pillarsRef.current.children], { opacity: 0, y: 8, duration: 0.4, stagger: 0.05 }, '-=0.2')
      .from(mockupRef.current, { opacity: 0, y: 32, scale: 0.96, duration: 0.9 }, '-=0.3');
  }, { scope });

  return (
    <div ref={scope} className="glow-brand overflow-hidden">
      {/* relative + isolate here (not on the whole hero) scopes the
          background to exactly this block's own height — badge through
          pillars — so it sits behind that text without also spreading behind
          the dashboard mockup below, which is a separate sibling. */}
      <div className="relative isolate">
        {/* opacity-70: brighter than the first pass (opacity-50, flat blue)
            per feedback that it read as dull — the capsule shape + brand
            gradient below carries texture without turning into noise, so it
            can sit closer to full strength than a flat colour could. */}
        <div className="pointer-events-none absolute inset-0 -z-10 opacity-70">
          {showAntigravity && (
            <Suspense fallback={null}>
              <Antigravity
                count={120}
                magnetRadius={9}
                ringRadius={7}
                waveSpeed={0.4}
                waveAmplitude={0.8}
                particleSize={1.8}
                lerpSpeed={0.16}
                colors={['#1d7af3', '#12c6dd', '#a21cf0']}
                autoAnimate
                particleVariance={0.7}
                particleShape="capsule"
              />
            </Suspense>
          )}
        </div>

        <Container className="pt-14 pb-10 text-center sm:pt-20 sm:pb-14">
        <p ref={badgeRef} className="mb-6 inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-xs font-medium text-ink-500">
          <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
          7-day free trial · no credit card required
        </p>

        <h1 className="mx-auto max-w-4xl text-4xl font-extrabold leading-[1.08] tracking-tight text-ink-900 sm:text-6xl">
          <span className="block overflow-hidden">
            <span ref={(el) => { lineRefs.current[0] = el; }} className="block">The smart flow</span>
          </span>
          <span className="block overflow-hidden">
            <span ref={(el) => { lineRefs.current[1] = el; }} className="block">
              for <span className="text-gradient">every business</span>.
            </span>
          </span>
        </h1>

        <p ref={subRef} className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-ink-500 sm:text-lg">
          AI-powered billing, payments, inventory, GST and business intelligence —
          running in the browser you already have open.
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <span ref={(el) => { ctaRefs.current[0] = el; }}><Button to="/signup" size="lg">Start 7-day free trial</Button></span>
          <span ref={(el) => { ctaRefs.current[1] = el; }}><Button to="/features" variant="secondary" size="lg">Watch demo</Button></span>
        </div>

        <p ref={noteRef} className="mt-5 text-xs text-ink-400">No credit card required. Built by ManagerXP.</p>

        <ul ref={pillarsRef} className="mt-14 flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
          {PILLARS.map((pillar) => (
            <li key={pillar.label} className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-ink-500">
              <span className={`h-2 w-2 rounded-full ${pillar.color}`} />
              {pillar.label}
            </li>
          ))}
        </ul>
        </Container>
      </div>

      <Container className="pb-16 sm:pb-20">
        <div ref={mockupRef} className="mx-auto max-w-3xl">
          <HeroMockup />
        </div>
      </Container>
    </div>
  );
};

const WhatIsFlowXP = () => {
  const scope = useRef(null);

  useGSAP(() => {
    revealOnScroll(scope.current, () => {
      fadeUp(scope.current.querySelector('[data-copy]'));
      staggerReveal(scope.current.querySelectorAll('[data-step]'), { each: 0.1, x: -12, y: 0 });
    });
  }, { scope });

  return (
    <Section className="border-y border-line">
      <Container>
        <div ref={scope} className="grid items-center gap-12 lg:grid-cols-2">
          <div data-copy>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
              What is FlowXP
            </p>
            <h2 className="text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
              One place for the whole counter.
            </h2>
            <p className="mt-5 text-base leading-relaxed text-ink-500">
              Most shops run on three or four things that do not talk to each other — a
              billing machine, a stock notebook, a WhatsApp thread with the accountant,
              and a spreadsheet nobody trusts.
            </p>
            <p className="mt-4 text-base leading-relaxed text-ink-500">
              FlowXP is the one system underneath all of it. You bill from it, so the stock
              moves, the GST is worked out, the customer's balance updates and the day's
              report writes itself. Ask it a question and it answers from the same records.
            </p>
            <div className="mt-8">
              <Button to="/signup">Start free trial</Button>
            </div>
          </div>

          <ol className="space-y-3">
            {[
              ['Sign up', 'Name, email, password, business. About forty seconds.'],
              ['Add a product', 'Or a handful. You can add the rest as you go.'],
              ['Take a payment', 'Cash, UPI, card or split. The invoice writes itself.'],
              ['Send it', 'WhatsApp, email or a link. A printer is optional.'],
              ['See where you stand', 'Sales, stock and outstanding, from the first bill.']
            ].map(([title, body], index) => (
              <li key={title} data-step>
                <GlowCard className="flex items-start gap-4">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-600">
                    {index + 1}
                  </span>
                  <span>
                    <span className="block font-semibold text-ink-900">{title}</span>
                    <span className="mt-1 block text-sm text-ink-500">{body}</span>
                  </span>
                </GlowCard>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </Section>
  );
};

const Features = () => {
  const scope = useRef(null);
  useGSAP(() => {
    revealOnScroll(scope.current, () => staggerReveal(scope.current.querySelectorAll('[data-card]'), { each: 0.08 }));
  }, { scope });

  return (
    <Section
      id="features"
      eyebrow="Core features"
      title="Everything the day needs"
      lead="Billing to GST to the report you look at on the way home — one product, one set of numbers."
    >
      <div ref={scope} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {CORE_FEATURES.map((feature) => (
          <GlowCard key={feature.title} data-card>
            <h3 className="text-base font-semibold text-ink-900">{feature.title}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-ink-500">{feature.body}</p>
          </GlowCard>
        ))}
      </div>
    </Section>
  );
};

const ShowcaseSection = () => {
  const scope = useRef(null);
  return (
    <Section
      className="border-y border-line"
      eyebrow="See it in action"
      title="This is the actual product."
      lead="Not a mockup made to look impressive — the same dashboard, the same numbers, that a business sees the morning after their first sale."
    >
      <div ref={scope} className="mx-auto max-w-4xl">
        <DashboardShowcase />
      </div>
    </Section>
  );
};

const IndustriesSection = () => (
  <Section
    className="border-y border-line"
    eyebrow="Industries"
    title="Built for the business you actually run"
    lead="FlowXP shows a pharmacy different modules from a gaming café, rather than the same screen with buttons nobody presses. Try one."
  >
    <IndustrySelector />
  </Section>
);

const Differentiators = () => {
  const scope = useRef(null);
  useGSAP(() => {
    revealOnScroll(scope.current, () => staggerReveal(scope.current.querySelectorAll('[data-card]'), { each: 0.1 }));
  }, { scope });

  return (
    <Section eyebrow="Why FlowXP" title="Digital-first, and yours">
      <div ref={scope} className="grid gap-5 lg:grid-cols-3">
        {DIFFERENTIATORS.map((item) => (
          <GlowCard key={item.title} data-card>
            <h3 className="text-base font-semibold text-ink-900">{item.title}</h3>
            <p className="mt-2.5 text-sm leading-relaxed text-ink-500">{item.body}</p>
          </GlowCard>
        ))}
      </div>
    </Section>
  );
};

const Ecosystem = () => {
  const scope = useRef(null);
  useGSAP(() => {
    revealOnScroll(scope.current, () => fadeUp(scope.current.querySelector('[data-copy]')));
  }, { scope });

  return (
    <Section className="border-y border-line">
      <Container>
        <div ref={scope}>
          <GlowCard data-copy outerClassName="mx-auto max-w-3xl" className="text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
              The ManagerXP ecosystem
            </p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-ink-900 sm:text-3xl">
              FlowXP is a product of ManagerXP
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-ink-500">
              ManagerXP already runs the counters, floors and back offices of businesses
              across India. FlowXP takes the billing, stock and reporting engine from that
              work and makes it available to any business, on any device, without the setup.
            </p>
          </GlowCard>
        </div>
      </Container>
    </Section>
  );
};

const Faq = () => {
  const scope = useRef(null);
  useGSAP(() => {
    revealOnScroll(scope.current, () => fadeUp(scope.current));
  }, { scope });

  return (
    <Section id="faq" eyebrow="FAQ" title="Questions worth asking first">
      <div ref={scope} className="mx-auto max-w-3xl divide-y divide-line rounded-[--radius-card] border border-line bg-surface">
        {FAQ.map((item) => (
          /* <details> rather than a state-driven accordion: it is keyboard
             accessible, findable by browser search, and needs no JavaScript. */
          <details key={item.q} className="group px-6 py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-ink-900">
              {item.q}
              <span className="shrink-0 text-lg leading-none text-ink-400 transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="mt-3 text-sm leading-relaxed text-ink-500">{item.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
};

const FinalCta = () => {
  const scope = useRef(null);
  useGSAP(() => {
    revealOnScroll(scope.current, () => fadeUp(scope.current.querySelector('[data-copy]'), { distance: 20 }));
  }, { scope });

  return (
    <Section>
      <Container>
        <div ref={scope}>
          <div data-copy className="bg-gradient-brand rounded-[--radius-card] px-8 py-12 text-center sm:px-14">
            <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Start billing this afternoon.
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-sm leading-relaxed text-white/85">
              Seven days free, on the laptop or phone you already own. No card, no install,
              no sales call.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Button to="/signup" variant="secondary" size="lg">Start 7-day free trial</Button>
              <Button to="/contact" variant="ghost" size="lg" className="text-white hover:bg-white/10 hover:text-white">
                Talk to us
              </Button>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
};

const PricingSection = () => {
  const scope = useRef(null);
  useGSAP(() => {
    revealOnScroll(scope.current, () => staggerReveal(scope.current.querySelectorAll('[data-price-card]'), { each: 0.08 }));
  }, { scope });

  return (
    <Section id="pricing" eyebrow="Pricing" title="Simple plans, no surprises"
             lead="Start on the free trial. Move to a paid plan when FlowXP has earned it.">
      <div ref={scope}><PricingTable /></div>
    </Section>
  );
};

const Home = () => (
  <>
    <Hero />
    <WhatIsFlowXP />
    <OneFlow />
    <Features />
    <ShowcaseSection />
    <IndustriesSection />
    <AISection />
    <DigitalBilling />
    <MultiBusiness />
    <Differentiators />
    <Ecosystem />
    <PricingSection />
    <Faq />
    <FinalCta />
  </>
);

export default Home;
