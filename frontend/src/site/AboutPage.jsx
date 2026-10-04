/*
 * /about — who makes FlowXP and what we hold ourselves to. No invented
 * customer counts or awards: the page is about intent and how we work.
 */
import { Button, Section } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';
import { FinalCta, H2, PageHero } from './parts.jsx';

/* The one promise that also shows up on the Pricing page ("Your data", in every plan) gets the lead spot here
   too — the same claim made twice, not two slightly different ones, is what makes it trustworthy. */
const LEAD_BELIEF = ['Your data is yours.', 'It is kept apart from every other business, you can export it whenever you like, and it stays readable if you stop paying. That holds on every plan, not as something you pay more for.'];
const BELIEFS = [
  ['The first bill should be fast.', 'Sign up to a real GST bill in minutes, on a laptop or phone you already own. Everything else can wait until you need it.'],
  ['Numbers must be honest.', 'A report that quietly rounds, or an assistant that invents a figure, is worse than none. Estimates are labelled as estimates, predictions show how accurate they have been.'],
  ['Software should get out of the way.', 'Plain words, big buttons, and only the tools your kind of business needs. If a cashier needs training, we have made it too hard.']
];

const HOW = [
  ['Built with businesses, not for a slide deck', 'Every screen starts from a real counter: a busy lunch hour, a month-end GST return, a stock count at closing time.'],
  ['Careful with money', 'Amounts are stored to the paisa, every bill and change is recorded, and cancelled bills are never quietly deleted.'],
  ['Secure by default', 'Two-step login and sign-in history for every account, and an activity log that records who changed what.']
];

const AboutPage = () => (
  <>
    <PageHero
      title="We build software for the counter."
      lead="FlowXP is made by ManagerXP. We spend our days with the counters, kitchens, shops and back offices of Indian businesses, and FlowXP is what we wish every one of them had: one simple place to bill, keep stock, file GST and understand the business."
      cta={false}
    />

    <Section  title="Four promises we build around.">
      <Reveal className="border-t-2 border-ink-900 pt-5">
        <h3 className="text-h3 font-semibold text-ink-900">{LEAD_BELIEF[0]}</h3>
        <p className="mt-2 max-w-2xl text-lead text-ink-500">{LEAD_BELIEF[1]}</p>
      </Reveal>
      <div className="mt-10 grid gap-x-10 gap-y-10 sm:grid-cols-3">
        {BELIEFS.map(([title, body], i) => (
          <Reveal key={title} index={i} className="border-t-2 border-ink-900 pt-5">
            <h3 className="text-title font-semibold text-ink-900">{title}</h3>
            <p className="mt-2 text-body text-ink-500">{body}</p>
          </Reveal>
        ))}
      </div>
    </Section>

    <Section className="border-y border-line bg-surface">
      <div className="grid gap-12 lg:grid-cols-12">
        <Reveal className="lg:col-span-5">
          <H2>Small team. Real businesses. No shortcuts with your money.</H2>
          <div className="mt-8"><Button to="/contact" variant="secondary">Talk to the team</Button></div>
        </Reveal>
        <ul className="space-y-4 lg:col-span-7">
          {HOW.map(([title, body], i) => (
            <Reveal as="li" key={title} index={i} className="lift rounded-(--radius-card) border border-line bg-surface p-5 sm:p-6">
              <h3 className="text-body font-semibold text-ink-900">{title}</h3>
              <p className="mt-1.5 text-body text-ink-500">{body}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </Section>

    <FinalCta title="See if FlowXP fits your business." lead="Seven days free, no card. Or write to us and we will walk you through it." />
  </>
);

export default AboutPage;
