/*
 * /industries — the hub. The built industries, each with its own page
 * (see industries/data.js and industries/IndustryDetail.jsx), and the trades
 * the core product already serves well.
 */
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Section } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';
import { CellGrid, FinalCta, PageHero, Shot } from './parts.jsx';
import { CORE, READY } from './industries/data.js';

/* Spans on a 12-column grid: 7/5, 5/7, 6/6, so no row is three equal cards. */
const SPANS = ['lg:col-span-7', 'lg:col-span-5', 'lg:col-span-5', 'lg:col-span-7', 'lg:col-span-6', 'lg:col-span-6'];

const IndustryCard = ({ slug, label, blurb, hero, i }) => (
  <Reveal as="div" index={i % 2} className={SPANS[i % SPANS.length]}>
    <Link to={`/industries/${slug}`} className="lift group flex h-full flex-col overflow-hidden rounded-(--radius-card) border border-line bg-surface">
      <div className="overflow-hidden border-b border-line bg-brand-50">
        <img src={hero.src} alt="" width={1200} height={750} loading="lazy" decoding="async" className="block aspect-[16/9] w-full object-cover object-top transition-transform duration-(--duration-moderate) ease-(--ease-standard) group-hover:scale-[1.02]" />
      </div>
      <div className="flex flex-1 flex-col p-6">
        <p className="text-title font-semibold text-ink-900">{label}</p>
        <p className="mt-1.5 text-body text-ink-500">{blurb}</p>
        <span aria-hidden="true" className="mt-4 inline-flex items-center pt-1 text-small font-medium text-brand-600">
          See every feature, with screens
          <ArrowRight strokeWidth={2} className="ml-1.5 h-4 w-4 transition-transform duration-(--duration-normal) group-hover:translate-x-1" />
        </span>
      </div>
    </Link>
  </Reveal>
);

const IndustriesPage = () => (
  <>
    <PageHero
      title="One system, set up for how you sell."
      lead="Choose your trade when you sign up, and FlowXP switches on the tools it needs."
      points={['Choose your kind of business when you sign up', 'Run different kinds of businesses under one login', 'The same billing, stock and GST underneath']}
      visual={<Shot src="/product/kitchen-main.webp" eager alt="FlowXP kitchen display with open orders by table, the dishes and minutes since sent." />}
    />

    <Section title="Seven kinds of business, built in detail." lead="Each has its own screens, tuned for how that trade actually runs. Open one to see every feature, with the real screens.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-12">
        {READY.map((k, i) => <IndustryCard key={k.slug} slug={k.slug} label={k.label} blurb={k.blurb} hero={k.hero} i={i} />)}
      </div>
    </Section>

    <Section className="border-t border-line bg-surface" title="If you sell things or services, it fits." lead="These run on the same core billing, stock and GST, with nothing extra needed.">
      <CellGrid items={CORE} />
    </Section>

    <FinalCta title="Not sure it fits your business?" lead="Tell us how you sell today. We will tell you honestly what works in FlowXP now and what is coming." />
  </>
);

export default IndustriesPage;
