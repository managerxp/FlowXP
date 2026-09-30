/*
 * /ai — Flow AI, the AI Manager inside FlowXP.
 *
 * Same system as the home page (design.md): left-aligned headings, real
 * screens from the demo business, one question per section, motion from
 * index.css. Only features that exist are described: the demand forecast,
 * reorder suggestions that open draft purchase orders, the leakage check,
 * profitability, the Flow AI chat (read-only, answers through the tools in
 * backend/src/modules/ai/tools.js) and reading a menu from a photo. Nothing
 * here is an invented AI answer: where there is no real screen (the chat
 * needs an AI key on the server), the page shows the real suggested
 * questions and what the assistant can read instead of a made-up reply.
 */
import { Button, Container, Eyebrow, Section } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';
import { Check, Connector, FeatureRow, FinalCta, H2, Node, Shot, Tag, TextLink } from './parts.jsx';

/* ── 1. Hero ──────────────────────────────────────────────────────────── */

const Hero = () => (
  <section className="overflow-hidden border-b border-line">
    <Container className="grid items-center gap-12 pb-16 pt-12 sm:pb-28 sm:pt-16 lg:grid-cols-12 lg:gap-10 lg:pb-32 lg:pt-20">
      <div className="lg:col-span-5">
        <Eyebrow className="rise">Flow AI · the AI Manager inside FlowXP</Eyebrow>
        <h1 className="rise mt-4 text-display font-semibold text-ink-900" style={{ '--i': 1 }}>
          An AI manager that reads your numbers.
        </h1>
        <p className="rise mt-6 max-w-md text-lead text-ink-500" style={{ '--i': 2 }}>
          Every day, Flow AI goes through your bills, stock, purchases and expenses, and tells you in plain
          words what is coming, what looks wrong and what to do next. You decide; it never
          changes anything on its own.
        </p>
        <div className="rise mt-8 flex flex-wrap items-center gap-x-6 gap-y-4" style={{ '--i': 3 }}>
          <Button to="/signup" size="lg">Start 7-day free trial</Button>
          <TextLink href="#questions">See what it answers</TextLink>
        </div>
        <ul className="rise mt-8 space-y-2 text-small text-ink-500" style={{ '--i': 4 }}>
          {['Answers only from your own records', 'Every figure labelled: fact, estimate, prediction or suggestion', 'Customer names and phone numbers are never sent to the AI'].map((t) => (
            <li key={t} className="flex items-start gap-1.5"><Check />{t}</li>
          ))}
        </ul>
      </div>

      <div className="relative lg:col-span-7">
        <div className="rise rounded-(--radius-panel) bg-brand-50 p-3 sm:p-6" style={{ '--d': '180ms' }}>
          <Shot src="/product/forecast-main.webp" eager
                alt="FlowXP forecast: expected orders and sales for each of the next seven days, an hour-by-hour chart for Sunday, and a note on how accurate the forecast was over the last 14 days." />
        </div>
        <Shot
          src="/product/reorder-main.webp"
          alt="FlowXP reorder suggestions: one item to order now, three soon, ₹4,675 of suggested purchases grouped by supplier, each with a button to review it as an order."
          style={{ '--d': '480ms' }}
          className="rise relative z-10 mx-auto -mt-10 w-[88%] sm:absolute sm:-bottom-20 sm:-left-8 sm:mt-0 sm:w-[52%] lg:-left-4"
        />
      </div>
    </Container>
  </section>
);

/* ── 2. The four labels ───────────────────────────────────────────────── */

const LABELS = [
  ['fact', 'Taken straight from your bills, stock and payments.'],
  ['estimate', 'Worked out from what you recorded, such as profit after costs.'],
  ['prediction', 'What is likely next, with how accurate it has been for you.'],
  ['suggest', 'Something you could do. Nothing happens until you say so.']
];

const LabelStrip = () => (
  <section aria-label="How Flow AI labels what it tells you" className="border-b border-line bg-surface">
    <Container>
      <ul className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-x-0 lg:divide-x lg:divide-line">
        {LABELS.map(([kind, body], i) => (
          <Reveal as="li" key={kind} index={i} className="py-6 lg:px-5 lg:first:pl-0">
            <Tag kind={kind} />
            <p className="mt-2 text-small text-ink-500">{body}</p>
          </Reveal>
        ))}
      </ul>
    </Container>
  </section>
);

/* ── 3. From records to a decision (diagram) ──────────────────────────── */

const HowItThinks = () => (
  <Section
    eyebrow="How it works"
    title="From your bills to a decision, in plain words."
    lead="Flow AI does not guess from the internet. It looks only at what your business recorded, compares it with your own normal, and hands you the result with a button to act on it."
  >
    <Reveal as="figure">
      <div className="grid items-center lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <div className="space-y-3">
          <Node title="What you record" body="Bills, payments, stock, purchases, expenses and who did what." />
          <Node title="Your own history" body="Weeks of your sales by day and hour, and what each item uses." />
        </div>
        <Connector />
        <Node strong title="Flow AI checks it" body="Trends, anything unusual against your own normal, and what the next days look like." />
        <Connector />
        <div className="space-y-3">
          <Node title="A clear note" body="“Sunday will be busy after 8pm.” “Chicken will run out before Friday.”" />
          <Node title="A button to act" body="Review a purchase order, open the bills behind a finding, or dismiss it." />
        </div>
      </div>
      <figcaption className="sr-only">
        Your recorded business data and your own history go into Flow AI, which checks trends, unusual activity and the days ahead, and gives you a plain-language note and a button to act on it.
      </figcaption>
    </Reveal>
  </Section>
);

/* ── 4. Four questions, four real screens ─────────────────────────────── */

const FEATURES = [
  {
    kind: 'prediction',
    q: 'How busy will we be?',
    body: 'Orders and sales for each of the next seven days, hour by hour, and how many of each item to prepare. It also shows how far off it was over the last two weeks, so you know how much to trust it.',
    points: ['Next 7 days, by day and by hour', 'Expected quantity of each item', 'Festivals and events you add are taken into account'],
    src: '/product/forecast-main.webp',
    alt: 'FlowXP forecast with seven days of expected orders, an hour-by-hour chart and expected portions per dish.'
  },
  {
    kind: 'suggest',
    q: 'What should I order, and from whom?',
    body: 'Based on how much of each item you actually use, FlowXP tells you what will run short before a delivery can arrive, how much to buy, and from which supplier at your latest price.',
    points: ['“Order now” and “order soon” lists', 'Grouped by supplier, with the cost', 'Opens a draft purchase order; nothing is sent until you send it'],
    src: '/product/reorder-main.webp',
    alt: 'FlowXP reorder suggestions grouped by supplier, each with quantity, cost and a Review as an order button.'
  },
  {
    kind: 'check',
    q: 'Is money leaking anywhere?',
    body: 'Cancelled bills that still show money collected, discounts far above normal, unusual refunds and wastage are flagged with the bills behind them and a suggested next step.',
    points: ['Compared with your own normal, not a fixed rule', 'Each finding shows the bills behind it', 'Investigate, mark reviewed or dismiss'],
    src: '/product/leakage-main.webp',
    alt: 'FlowXP leakage report with ₹28,290 of potential leakage split into cancellations, discounts, refunds and wastage.'
  },
  {
    kind: 'estimate',
    q: 'What am I really earning?',
    body: 'Sales are not profit. FlowXP takes off the cost of what you sold, payment fees, delivery commission, packaging and expenses, and shows what is left by day, item and branch.',
    points: ['Where each rupee of sales goes', 'Profit by item, branch and sales channel', 'Clearly marked as an estimate, not your accounts'],
    src: '/product/profit-main.webp',
    alt: 'FlowXP profitability report with net revenue, food cost, margin and where each rupee of revenue goes.'
  }
];

const Features = () => (
  <Section
    id="features"
    className="border-y border-line bg-surface"
    eyebrow="What it tells you"
    title="Four questions every owner asks. Answered from your own data."
  >
    <div className="space-y-20 lg:space-y-28">
      {FEATURES.map((f, i) => <FeatureRow key={f.q} tag={f.kind} title={f.q} body={f.body} points={f.points} src={f.src} alt={f.alt} flip={i % 2 === 1} />)}
    </div>
  </Section>
);

/* ── 5. Ask Flow AI ───────────────────────────────────────────────────── */

/* The questions the app itself suggests (AIManagerPage), and the records the
   assistant is allowed to read (the tools in backend/src/modules/ai/tools.js). */
const QUESTIONS = [
  'How did we do last week compared with the week before?',
  'Which items make us the most money, and which the least?',
  'What should I order tomorrow?',
  'What do you expect this weekend?',
  'Is there anything unusual I should look at?',
  'Is anything running slow in the kitchen?'
];
const READS = ['Sales', 'Daily trend', 'Item performance', 'Stock forecast', 'Demand forecast', 'Kitchen timing', 'Wastage', 'Expenses', 'Leakage check', 'Branch comparison', 'Loyalty and coupons'];

const Ask = () => (
  <Section id="questions" className="scroll-mt-16">
    <div className="grid gap-12 lg:grid-cols-12">
      <Reveal className="lg:col-span-5">
        <Eyebrow>Ask Flow AI</Eyebrow>
        <H2>Ask your business a question. In plain English.</H2>
        <p className="mt-4 text-lead text-ink-500">
          Type a question the way you would ask your manager. Flow AI looks up the answer in your
          records and replies with the numbers, where they came from, and what you might do.
        </p>
        <ul className="mt-6 space-y-3 text-body text-ink-700">
          <li className="flex gap-3"><Check />It can only read. It cannot change a price, a bill or your stock.</li>
          <li className="flex gap-3"><Check />Staff see answers only about what their role allows.</li>
          <li className="flex gap-3"><Check />Summarised figures go to the AI service; customer names and phone numbers never do.</li>
        </ul>
      </Reveal>
      <div className="lg:col-span-7">
        <Reveal className="rounded-(--radius-panel) border border-line bg-surface p-5 shadow-md sm:p-7">
          <p className="text-small font-semibold text-ink-900">Try asking</p>
          <ul className="mt-4 flex flex-wrap gap-2">
            {QUESTIONS.map((q) => (
              <li key={q} className="rounded-full border border-line-strong bg-surface px-3.5 py-2 text-small text-ink-700 transition-colors duration-(--duration-normal) hover:border-brand-500 hover:text-brand-600">
                {q}
              </li>
            ))}
          </ul>
          <div className="mt-6 border-t border-line pt-5">
            <p className="text-small font-semibold text-ink-900">What it looks at to answer</p>
            <ul className="mt-3 flex flex-wrap gap-1.5">
              {READS.map((r) => <li key={r} className="rounded-md bg-surface-2 px-2.5 py-1 text-caption font-medium text-ink-700">{r}</li>)}
            </ul>
          </div>
        </Reveal>
      </div>
    </div>
  </Section>
);

/* ── 6. Less typing ───────────────────────────────────────────────────── */

const Extras = () => (
  <Section className="border-y border-line bg-surface" eyebrow="Less typing" title="AI that saves you setup time too.">
    <div className="grid gap-5 md:grid-cols-2">
      <Reveal className="lift rounded-(--radius-panel) border border-line bg-surface p-6 sm:p-8">
        <Tag kind="suggest" />
        <h3 className="mt-3 text-title font-semibold text-ink-900">Your menu or price list, from a photo.</h3>
        <p className="mt-2 text-body text-ink-500">
          Take a photo of a printed menu or rate card. FlowXP reads the items, prices and sections and
          fills them in for you to check. Nothing is saved until you confirm it.
        </p>
      </Reveal>
      <Reveal index={1} className="lift rounded-(--radius-panel) border border-line bg-surface p-6 sm:p-8">
        <Tag kind="check" />
        <h3 className="mt-3 text-title font-semibold text-ink-900">Alerts before things go wrong.</h3>
        <p className="mt-2 text-body text-ink-500">
          Items about to run out, purchase orders that are late, kitchen orders running behind, and
          leakage findings arrive as notifications to the right person, at the right branch.
        </p>
      </Reveal>
    </div>
  </Section>
);

/* ── 7. For every kind of business ────────────────────────────────────── */

const EVERY = [
  ['Shops and retail', 'Which products sell fastest, which earn the least, and what to reorder before the shelf is empty.'],
  ['Restaurants and cafés', 'How busy each hour will be, how much of each dish to prepare, food cost and kitchen timing.'],
  ['Salons and services', 'Which services and offers bring customers back, and how coupons and loyalty are doing.'],
  ['Wholesale and distribution', 'Stock across branches or godowns, what to reorder and when, and which items earn the least.']
];

const EveryBusiness = () => (
  <Section eyebrow="Every business" title="The same manager, in your business's language.">
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {EVERY.map(([title, body], i) => (
        <Reveal key={title} index={i} className="lift rounded-(--radius-card) border border-line bg-surface p-5">
          <h3 className="text-body font-semibold text-ink-900">{title}</h3>
          <p className="mt-2 text-small text-ink-500">{body}</p>
        </Reveal>
      ))}
    </div>
  </Section>
);

/* ── 8. Honest by design ──────────────────────────────────────────────── */

const HONEST = [
  ['It shows its working.', 'Each finding comes with the bills, items or days behind it, so you can check it yourself.'],
  ['It tells you how sure it is.', 'Forecasts show a range and how accurate they have been for your business.'],
  ['You make the call.', 'Suggestions open a draft or a list to review. Nothing is ordered, changed or sent on its own.'],
  ['It does not promise miracles.', 'Flow AI helps you notice things sooner. It does not guarantee profit or catch every loss.']
];

const Honest = () => (
  <Section className="border-t border-line bg-surface" eyebrow="Honest by design" title="AI you can check.">
    <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
      {HONEST.map(([title, body], i) => (
        <Reveal key={title} index={i} className="border-t-2 border-ink-900 pt-5">
          <h3 className="text-body font-semibold text-ink-900">{title}</h3>
          <p className="mt-2 text-body text-ink-500">{body}</p>
        </Reveal>
      ))}
    </div>
  </Section>
);

/* ── 9. Final call ────────────────────────────────────────────────────── */

const Closing = () => (
  <FinalCta
    title="Your bills already know what to do next. Let FlowXP tell you."
    lead="Start billing today. The forecasts and suggestions get sharper with every week of your own sales."
    secondary={{ to: '/', label: 'See all of FlowXP' }}
  />
);

const AIPage = () => (
  <>
    <Hero />
    <LabelStrip />
    <HowItThinks />
    <Features />
    <Ask />
    <Extras />
    <EveryBusiness />
    <Honest />
    <Closing />
  </>
);

export default AIPage;
