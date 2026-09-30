/*
 * /pricing — the plans (read from the API by PricingTable), what every plan
 * includes, and the money questions people ask before they sign up.
 */
import { Section } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';
import { FAQ } from './content.js';
import PricingTable from './PricingTable.jsx';
import { CellGrid, FinalCta, PageHero } from './parts.jsx';

const EVERY_PLAN = [
  { title: 'GST billing', body: 'CGST, SGST and IGST on every line, credit notes and round-off.' },
  { title: 'Stock', body: 'Updates with every sale and purchase, with low-stock alerts.' },
  { title: 'Customers', body: 'History, credit and dues, found by mobile number.' },
  { title: 'Reports', body: 'Sales, stock, GST and payments for any dates.' },
  { title: 'Works offline', body: 'Keep billing when the internet drops.' },
  { title: 'Phone app', body: 'Install from the browser on Android or iPhone.' },
  { title: 'Security', body: 'Two-step login, sign-in history and new-device alerts.' },
  { title: 'Your data', body: 'Exportable any time, and kept if you stop paying.' }
];

const Pricing = () => (
  <>
    <PageHero
      eyebrow="Pricing"
      title="Start free. Pay when it has earned it."
      lead="Every plan begins with the same seven-day free trial, with every feature switched on. No card, no sales call, no setup fee."
      points={['7 days free on every plan', 'No credit card needed to start', 'Your data stays if you stop paying']}
    />

    <Section>
      <Reveal><PricingTable /></Reveal>
    </Section>

    <Section className="border-y border-line bg-surface" eyebrow="In every plan" title="The basics are never an extra.">
      <CellGrid items={EVERY_PLAN} />
    </Section>

    <Section>
      <div className="grid gap-10 lg:grid-cols-12">
        <Reveal className="lg:col-span-4">
          <h2 className="text-h2 font-semibold text-ink-900">Before you sign up</h2>
          <p className="mt-4 text-body text-ink-500">The questions about money and commitment people ask us most.</p>
        </Reveal>
        <Reveal index={1} className="divide-y divide-line border-y border-line lg:col-span-8">
          {FAQ.slice(0, 4).map((item) => (
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

    <FinalCta title="Try every feature free for seven days." lead="Pick a plan at the end of the trial, or not. Nothing you create is deleted." />
  </>
);

export default Pricing;
