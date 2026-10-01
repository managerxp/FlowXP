/*
 * /industries — the hub. Seven built verticals, each with its own page
 * (see industries/data.js and industries/IndustryDetail.jsx), the trades
 * the core product already serves well, and a named list of what is not
 * built yet at /industries/coming-soon.
 */
import { Link } from 'react-router-dom';
import { Section } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';
import { CellGrid, FinalCta, PageHero, Shot, TextLink } from './parts.jsx';
import { CORE, READY } from './industries/data.js';

const IndustryCard = ({ slug, label, blurb }, i) => (
  <Reveal as="div" index={i % 4}>
    <Link to={`/industries/${slug}`} className="lift group block h-full rounded-(--radius-card) border border-line bg-surface p-6">
      <p className="text-title font-semibold text-ink-900">{label}</p>
      <p className="mt-1.5 text-body text-ink-500">{blurb}</p>
      <span aria-hidden="true" className="mt-4 inline-flex items-center text-small font-medium text-brand-600">
        See what is built
        <span className="ml-1 inline-block transition-transform duration-(--duration-normal) group-hover:translate-x-1">→</span>
      </span>
    </Link>
  </Reveal>
);

const IndustriesPage = () => (
  <>
    <PageHero
      eyebrow="Who it is for"
      title="One system, set up for how you sell."
      lead="Billing, payments, stock, GST and insights are the same for every business. When you sign up and choose what you do, FlowXP switches on the tools your trade needs and keeps the rest out of the way."
      points={['Choose your kind of business when you sign up', 'Run different kinds of businesses under one login', 'The same billing, stock and GST underneath']}
      visual={<Shot src="/product/kitchen-main.webp" eager alt="FlowXP kitchen display with open orders by table, the dishes and minutes since sent." />}
    />

    <Section eyebrow="Built for your trade" title="Eight kinds of business, built in detail." lead="Each has its own screens, tuned for how that trade actually runs.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {READY.map((k, i) => <IndustryCard key={k.slug} slug={k.slug} label={k.label} blurb={k.blurb} i={i} />)}
      </div>
    </Section>

    <Section className="border-t border-line bg-surface" eyebrow="Also used by" title="If you sell things or services, it fits." lead="These run on the same core billing, stock and GST, with nothing extra needed.">
      <CellGrid items={CORE} />
      <Reveal className="mt-6">
        <TextLink to="/industries/coming-soon">See what is not built yet</TextLink>
      </Reveal>
    </Section>

    <FinalCta title="Not sure it fits your business?" lead="Tell us how you sell today. We will tell you honestly what works in FlowXP now and what is coming." />
  </>
);

export default IndustriesPage;
