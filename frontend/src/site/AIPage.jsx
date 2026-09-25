/*
 * /ai — FlowXP positioned as decision intelligence, not a bigger dashboard.
 *
 * Hand-built rather than driven from content.js (like Home.jsx and
 * Pricing.jsx) because every section here is its own mockup layout, not a
 * title/lead/card-grid the shared MarketingPage template already covers.
 * Every number below (₹84,500, 82/100, "31% increase"...) is illustrative
 * product-UI copy, the same convention AISection.jsx already uses for its
 * chat bubbles — it explains what a screen looks like, not a real business's
 * results, so it stays honest under this site's own "no fabricated stats"
 * rule without needing a disclaimer on every card.
 */
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { fadeUp, staggerReveal } from '../animations/reveal.js';
import { revealOnScroll } from '../animations/scroll.js';
import { Badge, Button, Container, Section } from '../components/ui.jsx';
import { GlowCard } from '../components/BorderGlow.jsx';

/* ── Hero ─────────────────────────────────────────────────────────────── */
const HERO_TILES = [
  { label: 'Business health', value: '82', sub: '/ 100' },
  { label: 'Revenue', value: '₹8.4L', sub: '↑ 12%' },
  { label: 'Demand forecast', value: '+16%', sub: 'tomorrow' },
  { label: 'Revenue leakage', value: '₹18,450', sub: 'potential' },
  { label: 'Inventory risk', value: '4', sub: 'products low' },
  { label: 'Recommendations', value: '3', sub: 'open' }
];

const Hero = () => {
  const scope = useRef(null);
  useGSAP(() => {
    revealOnScroll(scope.current, () => {
      fadeUp(scope.current.querySelector('[data-copy]'));
      staggerReveal(scope.current.querySelectorAll('[data-tile]'), { each: 0.06 });
    });
  }, { scope });

  return (
    <div ref={scope} className="glow-brand border-b border-line">
      <Container className="py-16 sm:py-20">
        <div data-copy className="mx-auto max-w-3xl text-center">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">FlowXP AI</p>
          <h1 className="text-4xl font-extrabold tracking-tight text-ink-900 sm:text-5xl">
            Run your business by
            <br />
            <span className="text-gradient">decisions, not dashboards.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-ink-500">
            FlowXP analyzes your sales, inventory, customers, payments and operations to predict
            what's coming, explain what's happening, detect what's going wrong, and tell you what
            to do next.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button to="/signup" size="lg">Start free trial</Button>
            <Button href="#how" size="lg" variant="secondary">See how AI works</Button>
          </div>
        </div>

        <div className="glass mx-auto mt-14 grid max-w-3xl grid-cols-2 gap-3 rounded-2xl p-5 sm:grid-cols-3 sm:p-6">
          {HERO_TILES.map((tile) => (
            <div key={tile.label} data-tile className="rounded-xl bg-surface/70 p-4">
              <p className="text-xs font-medium text-ink-400">{tile.label}</p>
              <p className="mt-1.5 text-xl font-bold text-ink-900">{tile.value}</p>
              <p className="text-xs text-ink-500">{tile.sub}</p>
            </div>
          ))}
        </div>
      </Container>
    </div>
  );
};

/* ── Data → decision flow ─────────────────────────────────────────────── */
const FLOW_STEPS = [
  { title: 'Your business data', body: 'Sales, inventory, customers, payments, expenses, operations.' },
  { title: 'FlowXP intelligence', body: 'Patterns, trends, anomalies and forecasts, computed from your own records.' },
  { title: 'Business insight', body: '"Weekend demand is expected to increase 16%."' },
  { title: 'Recommended action', body: '"Increase stock for 4 high-demand products before Friday."' }
];

const DataToDecision = () => {
  const scope = useRef(null);
  useGSAP(() => {
    revealOnScroll(scope.current, () => staggerReveal(scope.current.querySelectorAll('[data-step]'), { each: 0.1 }));
  }, { scope });

  return (
    <Section
      id="how"
      className="border-b border-line"
      eyebrow="From data to decision"
      title="Not another dashboard."
      lead="Traditional software shows you numbers. FlowXP explains what happened, why, what's likely next, and what to do about it."
    >
      <div ref={scope} className="grid gap-4 lg:grid-cols-4">
        {FLOW_STEPS.map((step, index) => (
          <div key={step.title} data-step className="relative rounded-xl border border-line bg-surface p-5">
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-brand-600">Step {index + 1}</span>
            <h3 className="mt-2 text-sm font-semibold text-ink-900">{step.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{step.body}</p>
            {index < FLOW_STEPS.length - 1 && (
              <span aria-hidden="true" className="absolute -right-2 top-1/2 hidden -translate-y-1/2 text-lg text-ink-300 lg:block">→</span>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
};

/* ── Four core promises ───────────────────────────────────────────────── */
const PROMISES = [
  { title: 'Predict', body: "What's likely to happen.", example: 'Saturday demand is expected to be 18% higher than average.' },
  { title: 'Understand', body: "What's happening, and why.", example: 'Revenue increased 9%, but estimated gross profit fell 3.2% — higher-margin products were a smaller share of sales.' },
  { title: 'Detect', body: 'Problems you might not notice.', example: 'Discounts at Location 2 increased 31% this week, mostly from 3 products.' },
  { title: 'Recommend', body: 'What to do about it.', example: 'Order 24 units of Product A before Friday.' }
];

const CorePromises = () => {
  const scope = useRef(null);
  useGSAP(() => {
    revealOnScroll(scope.current, () => staggerReveal(scope.current.querySelectorAll('[data-card]'), { each: 0.08 }));
  }, { scope });

  return (
    <Section className="border-b border-line" eyebrow="Four core promises" title="Predict. Understand. Detect. Recommend.">
      <div ref={scope} className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {PROMISES.map((item) => (
          <GlowCard key={item.title} data-card>
            <h3 className="text-base font-semibold text-ink-900">{item.title}</h3>
            <p className="mt-1.5 text-sm text-ink-500">{item.body}</p>
            <p className="mt-3 rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-ink-700">“{item.example}”</p>
          </GlowCard>
        ))}
      </div>
    </Section>
  );
};

/* ── Profitability ────────────────────────────────────────────────────── */
const Profitability = () => {
  const scope = useRef(null);
  useGSAP(() => {
    revealOnScroll(scope.current, () => fadeUp(scope.current.querySelectorAll('[data-copy]')));
  }, { scope });

  return (
    <Section className="border-b border-line">
      <Container>
        <div ref={scope} className="grid items-center gap-12 lg:grid-cols-2">
          <div data-copy>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">True profitability</p>
            <h2 className="text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">Know what you're actually making.</h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-500">
              Revenue isn't profit. FlowXP weighs product cost, discounts, tax, expenses and refunds
              against every sale, and shows the number that's left — clearly marked as an estimate
              whenever full accounting data isn't available.
            </p>
          </div>

          <div data-copy className="glass rounded-2xl p-6">
            <dl className="space-y-3 text-sm">
              {[['Revenue', '₹4,82,000'], ['Product costs', '−₹2,61,000'], ['Discounts & tax', '−₹58,000'], ['Operating expenses', '−₹94,000']].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between border-b border-line pb-3">
                  <dt className="text-ink-500">{k}</dt>
                  <dd className="font-medium text-ink-900">{v}</dd>
                </div>
              ))}
              <div className="flex items-center justify-between pt-1">
                <dt className="font-semibold text-ink-900">Estimated profit</dt>
                <dd className="text-lg font-bold text-brand-600">₹69,000</dd>
              </div>
            </dl>
            <p className="mt-4 rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-ink-700">
              “Sales are up 14%, but estimated profit is only up 2.8% — mainly from higher product cost and increased discounting.”
            </p>
          </div>
        </div>
      </Container>
    </Section>
  );
};

/* ── Revenue leakage ──────────────────────────────────────────────────── */
const LEAKAGE_ITEMS = [
  { label: 'Unusual discounts', amount: '₹7,200' },
  { label: 'Stock discrepancy', amount: '₹5,400' },
  { label: 'Refunds above normal', amount: '₹3,850' },
  { label: 'Payment mismatch', amount: '₹2,000' }
];

const Leakage = () => {
  const scope = useRef(null);
  useGSAP(() => {
    revealOnScroll(scope.current, () => fadeUp(scope.current.querySelector('[data-copy]')));
  }, { scope });

  return (
    <Section className="border-b border-line" eyebrow="Revenue leakage" title="Find the money slipping through the cracks.">
      <div ref={scope} data-copy className="mx-auto max-w-lg">
        <div className="glass rounded-2xl p-6">
          <p className="text-xs font-medium text-ink-400">Potential leakage detected</p>
          <p className="mt-1 text-3xl font-bold text-ink-900">₹18,450</p>
          <ul className="mt-5 space-y-2.5">
            {LEAKAGE_ITEMS.map((item) => (
              <li key={item.label} className="flex items-center justify-between text-sm">
                <span className="text-ink-600">{item.label}</span>
                <span className="font-medium text-ink-900">{item.amount}</span>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-xs leading-relaxed text-ink-500">
            These are flagged as <em>potential</em> and <em>unusual</em> — differences from your
            normal pattern that are worth a look, never an accusation.
          </p>
          <Badge tone="brand">Investigate</Badge>
        </div>
      </div>
    </Section>
  );
};

/* ── Action center ────────────────────────────────────────────────────── */
const ActionCenter = () => {
  const scope = useRef(null);
  useGSAP(() => {
    revealOnScroll(scope.current, () => fadeUp(scope.current.querySelector('[data-copy]')));
  }, { scope });

  return (
    <Section className="border-b border-line" eyebrow="Action center" title="Not just what happened. What to do about it.">
      <div ref={scope} data-copy className="mx-auto max-w-xl">
        <div className="rounded-xl border border-line bg-surface p-6">
          <div className="flex items-center justify-between">
            <Badge tone="warning">High priority</Badge>
            <span className="text-xs text-ink-400">Potential revenue recovery</span>
          </div>
          <p className="mt-3 text-sm text-ink-900"><strong className="font-semibold">Revenue is down 8%.</strong></p>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-ink-400">Why</dt>
              <dd className="mt-0.5 text-ink-600">Lower evening traffic and reduced sales of high-margin products.</dd>
            </div>
            <div>
              <dt className="text-xs font-bold uppercase tracking-wide text-ink-400">What to do</dt>
              <dd className="mt-0.5 text-ink-600">Promote Product A this weekend.</dd>
            </div>
          </dl>
          <div className="mt-5 flex flex-wrap gap-2">
            {['Review', 'Approve', 'Dismiss', 'View data'].map((label) => <Badge key={label}>{label}</Badge>)}
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-ink-400">
          FlowXP surfaces the recommendation — you decide whether to act on it.
        </p>
      </div>
    </Section>
  );
};

/* ── Ask FlowXP ───────────────────────────────────────────────────────── */
const Bubble = ({ role, children }) => (
  <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
    <div
      className={
        `max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed sm:max-w-[75%] ` +
        (role === 'user'
          ? 'rounded-br-sm bg-surface-3 text-ink-900'
          : 'bg-gradient-brand rounded-bl-sm text-white shadow-[0_10px_24px_-14px] shadow-brand-500/70')
      }
    >
      {children}
    </div>
  </div>
);

const AskFlowXP = () => {
  const scope = useRef(null);
  useGSAP(() => {
    revealOnScroll(scope.current, () => staggerReveal(scope.current.querySelectorAll('[data-bubble]'), { each: 0.14 }));
  }, { scope });

  return (
    <Section className="border-b border-line" eyebrow="Ask FlowXP" title="Ask your business anything.">
      <div ref={scope} className="glass mx-auto max-w-xl rounded-2xl p-5 sm:p-6">
        <div className="space-y-3">
          <div data-bubble><Bubble role="user">Why did profit drop this week?</Bubble></div>
          <div data-bubble>
            <Bubble role="ai">
              Estimated profit decreased 6.4% — mainly 4.1% higher product costs, increased
              discounting, and lower sales of high-margin products.
              <br /><br />
              Recommended: review purchasing costs for 3 products and reduce discounting on Product A.
            </Bubble>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          {['View profitability', 'View products', 'Show recommendations'].map((label) => <Badge key={label}>{label}</Badge>)}
        </div>
      </div>
    </Section>
  );
};

/* ── Business health score ────────────────────────────────────────────── */
const HEALTH_CATEGORIES = [
  { label: 'Revenue', score: 88, note: 'Trending up over the last 30 days.' },
  { label: 'Profitability', score: 76, note: 'Margin softened slightly this month.' },
  { label: 'Inventory', score: 74, note: '4 products are approaching low-stock thresholds.' },
  { label: 'Customers', score: 81, note: '14 customers have gone quiet for 60+ days.' },
  { label: 'Payments', score: 90, note: 'Collections are on schedule.' },
  { label: 'Operations', score: 85, note: 'No unusual activity detected.' }
];

const HealthScore = () => {
  const scope = useRef(null);
  useGSAP(() => {
    revealOnScroll(scope.current, () => {
      fadeUp(scope.current.querySelector('[data-copy]'));
      staggerReveal(scope.current.querySelectorAll('[data-card]'), { each: 0.06 });
    });
  }, { scope });

  return (
    <Section className="border-b border-line" eyebrow="Business health" title="One score, fully explained.">
      <div ref={scope}>
        <div data-copy className="mx-auto mb-10 flex max-w-xs flex-col items-center text-center">
          <p className="text-5xl font-extrabold text-ink-900">82<span className="text-xl font-medium text-ink-400">/100</span></p>
          <p className="mt-2 text-sm text-ink-500">Never an arbitrary number — every score below explains itself.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {HEALTH_CATEGORIES.map((cat) => (
            <div key={cat.label} data-card className="rounded-xl border border-line bg-surface p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-ink-900">{cat.label}</h3>
                <span className="text-lg font-bold text-brand-600">{cat.score}</span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-500">{cat.note}</p>
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
};

/* ── AI for every business ────────────────────────────────────────────── */
const BUSINESS_TYPES = [
  { label: 'Restaurants', example: 'Friday dinner demand is expected to increase 21%. Increase prep for the top 5 menu items.' },
  { label: 'Retail', example: 'Product A has high revenue but declining margin. Review its purchase cost.' },
  { label: 'Grocery', example: 'Milk demand is expected to increase tomorrow. Current inventory may not cover it.' },
  { label: 'Salon / spa', example: 'Saturday appointments are filling faster than usual. Consider opening one more slot.' },
  { label: 'Gaming / entertainment', example: 'Weekend utilization is expected to reach 88%. Adjust staffing for 6–10 PM.' },
  { label: 'Services', example: "Project A's estimated margin is below your normal target." },
  { label: 'Wholesale', example: "Customer A's outstanding balance has increased for three billing cycles." }
];

const EveryBusiness = () => {
  const scope = useRef(null);
  useGSAP(() => {
    revealOnScroll(scope.current, () => staggerReveal(scope.current.querySelectorAll('[data-card]'), { each: 0.06 }));
  }, { scope });

  return (
    <Section
      className="border-b border-line"
      eyebrow="Not restaurant-specific"
      title="The same intelligence, your business's language."
      lead="FlowXP reads whichever context you signed up as — menu and food cost for a restaurant, SKUs and margin for retail, appointments and no-shows for a salon."
    >
      <div ref={scope} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {BUSINESS_TYPES.map((type) => (
          <div key={type.label} data-card className="rounded-xl border border-line bg-surface p-5">
            <h3 className="text-sm font-semibold text-ink-900">{type.label}</h3>
            <p className="mt-2 text-xs leading-relaxed text-ink-500">“{type.example}”</p>
          </div>
        ))}
      </div>
    </Section>
  );
};

/* ── Trust ─────────────────────────────────────────────────────────────── */
const TRUST_TERMS = [
  { label: 'Fact', body: 'Directly observed business data.' },
  { label: 'Estimate', body: 'Calculated from available data — labelled as an estimate, never a guaranteed figure.' },
  { label: 'Prediction', body: 'A forecast from historical patterns, shown with a confidence level.' },
  { label: 'Recommendation', body: 'An AI-generated suggestion. You decide whether to act on it.' }
];

const Trust = () => {
  const scope = useRef(null);
  useGSAP(() => {
    revealOnScroll(scope.current, () => staggerReveal(scope.current.querySelectorAll('[data-card]'), { each: 0.08 }));
  }, { scope });

  return (
    <Section eyebrow="AI you can trust" title="It never overpromises.">
      <div ref={scope} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {TRUST_TERMS.map((term) => (
          <div key={term.label} data-card className="rounded-xl border border-line bg-surface p-5">
            <h3 className="text-sm font-semibold text-ink-900">{term.label}</h3>
            <p className="mt-2 text-xs leading-relaxed text-ink-500">{term.body}</p>
          </div>
        ))}
      </div>
      <p className="mx-auto mt-8 max-w-2xl text-center text-sm text-ink-500">
        FlowXP AI helps you make better decisions and spot what deserves your attention — it doesn't
        guarantee profit, prevent every loss, or run your business for you.
      </p>
    </Section>
  );
};

/* ── Final CTA ─────────────────────────────────────────────────────────── */
const FinalCta = () => {
  const scope = useRef(null);
  useGSAP(() => {
    revealOnScroll(scope.current, () => fadeUp(scope.current.querySelector('[data-copy]'), { distance: 20 }));
  }, { scope });

  return (
    <Section className="border-t border-line">
      <Container>
        <div ref={scope}>
          <div data-copy className="bg-gradient-brand rounded-[--radius-card] px-8 py-12 text-center">
            <h2 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
              Your business shouldn't just generate data.
              <br />
              It should generate decisions.
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-white/85">
              Start your 7-day FlowXP trial and see what your business data can tell you.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Button to="/signup" variant="secondary" size="lg">Start free trial</Button>
              <Button to="/" size="lg" className="!bg-white/10 text-white hover:!bg-white/20">Explore FlowXP</Button>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
};

const AIPage = () => (
  <>
    <Hero />
    <DataToDecision />
    <CorePromises />
    <Profitability />
    <Leakage />
    <ActionCenter />
    <AskFlowXP />
    <HealthScore />
    <EveryBusiness />
    <Trust />
    <FinalCta />
  </>
);

export default AIPage;
