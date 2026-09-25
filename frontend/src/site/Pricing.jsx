import { Button, Container, Section } from '../components/ui.jsx';
import { FAQ } from './content.js';
import PricingTable from './PricingTable.jsx';

const Pricing = () => (
  <>
    <div className="glow-brand border-b border-line">
      <Container className="py-14 text-center sm:py-16">
        <h1 className="text-4xl font-extrabold tracking-tight text-ink-900 sm:text-5xl">
          Pricing
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-ink-500">
          Start free for seven days. Pick a plan when FlowXP has earned it — not before.
        </p>
      </Container>
    </div>

    <Section><PricingTable /></Section>

    <Section
      className="border-t border-line"
      title="Before you sign up"
    >
      <div className="mx-auto max-w-3xl divide-y divide-line rounded-[--radius-card] border border-line bg-surface">
        {/* The four that are actually about money and commitment; the rest
            live on the home page. */}
        {FAQ.slice(0, 4).map((item) => (
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

      <div className="mt-10 text-center">
        <Button to="/signup" size="lg">Start 7-day free trial</Button>
      </div>
    </Section>
  </>
);

export default Pricing;
