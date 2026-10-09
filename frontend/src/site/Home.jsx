/*
 * The landing page.
 *
 * Written for a business owner who has never heard of FlowXP and may not be
 * technical. The hero says what it is (billing software), who it is for (any
 * business that sells) and why it is different (it reads your numbers and
 * tells you what needs doing). Every section after it answers one question an
 * owner would ask. The pictures are real FlowXP screens captured from the demo
 * business (public/product/*.webp): `pos.webp` is the whole app window, the
 * `*-main.webp` files are the main area of a screen, shown uncropped.
 *
 * Motion (index.css): the hero rises in once on load, sections reveal once as
 * they scroll into view, cards lift slightly on hover. Nothing loops.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Container, Section } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';
import { FAQ } from './content.js';
import PricingTable from './PricingTable.jsx';
import { Boxes, ChevronDown, FileCheck2, Lightbulb, ReceiptText, Store } from 'lucide-react';
import BlurText from '../components/reactbits/BlurText.jsx';
import SpotlightCard from '../components/reactbits/SpotlightCard.jsx';
import { Check, Cross, FinalCta, FULL, H2, KIND, MAIN, PhoneShot, Shot, TextLink } from './parts.jsx';

/*
 * The "what needs your attention" panel: the kind of thing FlowXP tells an
 * owner, with figures from the demo business, each line labelled as what it
 * is (something that happened, something to check, a suggestion). It is an
 * example, and says so.
 */
const ATTENTION = [
  ['happened', 'Sales are up 16.6% on the previous 30 days.', 'From recorded bills'],
  ['check', 'One cashier\'s discounts are 2.9% of sales. Everyone else gives 0.2%.', 'See the 41 bills'],
  ['suggest', '10 items are at their reorder point. Reorder before the weekend.', 'Create purchase order']
];

const AttentionPanel = ({ className = '', style }) => (
  <aside aria-label="Example: what FlowXP tells an owner" style={style}
         className={`rounded-(--radius-card) border border-line bg-surface p-4 shadow-lg ${className}`}>
    <p className="flex items-center gap-2 text-small font-semibold text-ink-900">
      <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-500" />
      Needs your attention today
    </p>
    <ul className="mt-3 space-y-3">
      {ATTENTION.map(([kind, text, action], i) => (
        <li key={text} className="rise border-t border-line pt-3 first:border-0 first:pt-0" style={{ '--d': '700ms', '--i': i * 2 }}>
          <span className={`inline-flex rounded-full px-2 py-0.5 text-caption font-medium ${KIND[kind][1]}`}>{KIND[kind][0]}</span>
          <p className="mt-1.5 text-small leading-snug text-ink-900">{text}</p>
          {/* The action chips make the panel taller than the screenshot it
              floats over; where it overlays (sm and up) the sentence already
              says what to do, so they are left out there. */}
          <span className="mt-2 inline-flex rounded-md border border-line px-2 py-1 text-caption font-medium text-ink-700 sm:hidden">{action}</span>
        </li>
      ))}
    </ul>
    <p className="mt-3 border-t border-line pt-2 text-caption text-ink-500">Example from the FlowXP demo business</p>
  </aside>
);

/* ── 1. Hero ──────────────────────────────────────────────────────────── */

const Hero = () => (
  <section className="relative overflow-hidden">
    {/* The stage: a soft brand panel behind the top of the hero, ending part way down the screenshot so the
        product rises out of it onto the page. */}
    <div aria-hidden="true" className="hero-stage absolute inset-x-2 bottom-[30%] top-2 rounded-[2rem] sm:inset-x-3 sm:top-3" />
    <Container className="relative pb-20 pt-16 text-center sm:pb-24 sm:pt-24">
      <BlurText as="h1" text="Billing software that tells you what to do next."
                className="mx-auto flex max-w-4xl flex-wrap justify-center text-display font-semibold text-ink-900" />
      <p className="rise mx-auto mt-6 max-w-xl text-lead text-ink-500" style={{ '--d': '450ms' }}>
        Bills, stock and GST in one place, then a daily note on what is selling and what needs you.
      </p>
      <div className="rise mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-4" style={{ '--d': '550ms' }}>
        <Button to="/signup" size="lg">Start 7-day free trial</Button>
        <TextLink href="#how-it-works">See how it works</TextLink>
      </div>

      {/* The product, at the width of the page: the first thing that proves what FlowXP is. */}
      <div className="relative mx-auto mt-14 max-w-6xl text-left sm:mt-16">
        <div className="rise rounded-(--radius-panel) bg-surface/70 p-2 shadow-lg ring-1 ring-line backdrop-blur-sm sm:p-3" style={{ '--d': '650ms' }}>
          <Shot src="/product/pos.webp" size={FULL} eager className="shadow-none"
                alt="The FlowXP billing screen with six items on a ₹1,315 bill, GST worked out, and a Charge button." />
        </div>
        <AttentionPanel
          style={{ '--d': '950ms' }}
          className="rise relative z-10 mx-auto -mt-10 w-[92%] max-w-[300px] sm:absolute sm:-bottom-12 sm:-right-4 sm:mt-0 sm:w-[280px] lg:-right-10"
        />
      </div>
    </Container>
  </section>
);

/* ── 2. Capability strip ──────────────────────────────────────────────── */

const CAPABILITIES = [
  ['Billing', 'GST bills in seconds, on any device'],
  ['Payments', 'Cash, UPI, card, credit, split'],
  ['Stock', 'Updates itself with every sale'],
  ['GST', 'Returns ready for your accountant'],
  ['Customers', 'Dues, history, loyalty'],
  ['AI insights', 'What to check and what to do next']
];

const CapabilityStrip = () => (
  <section aria-label="What FlowXP covers" className="border-b border-line bg-surface">
    <Container>
      <ul className="grid grid-cols-2 gap-x-6 sm:grid-cols-3 lg:grid-cols-6 lg:gap-x-0 lg:divide-x lg:divide-line">
        {CAPABILITIES.map(([title, body], i) => (
          <Reveal as="li" key={title} index={i} className="py-6 lg:px-5 lg:first:pl-0">
            <p className="text-small font-semibold text-ink-900">{title}</p>
            <p className="mt-1 text-small text-ink-500">{body}</p>
          </Reveal>
        ))}
      </ul>
    </Container>
  </section>
);

/* ── 3. One bill does the rest (diagram) ──────────────────────────────── */

const Node = ({ title, body, strong = false }) => (
  <div className={`rounded-(--radius-card) border px-5 py-4 ${strong ? 'border-brand-500 bg-brand-500 shadow-md' : 'border-line bg-surface'}`}>
    <p className={`text-body font-semibold ${strong ? 'text-white' : 'text-ink-900'}`}>{title}</p>
    <p className={`mt-1 text-small ${strong ? 'text-white/85' : 'text-ink-500'}`}>{body}</p>
  </div>
);

const Connector = () => (
  <div aria-hidden="true" className="flex items-center justify-center py-2 lg:px-2 lg:py-0">
    <span className="draw block h-8 w-px bg-brand-500/40 lg:h-px lg:w-10" />
  </div>
);

const OneBill = () => (
  <Section
    title="Make the bill once. FlowXP does the rest."
    lead="However you sell, the sale goes into one system. Your stock, your customer's account, your GST and your reports all move with it, so nothing is written down twice."
  >
    <Reveal as="figure">
      <div className="grid items-center lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <div className="space-y-3">
          <Node title="At the counter" body="Scan a barcode or search, and bill in seconds." />
          <Node title="On the phone" body="Take the order and send the bill as a link." />
          <Node title="At the table or by QR" body="For restaurants and cafés, orders go straight to the kitchen." />
        </div>
        <Connector />
        <Node strong title="One GST bill in FlowXP" body="The same products, prices and stock for every branch you run." />
        <Connector />
        <div className="space-y-3">
          <Node title="Stock and purchases" body="Stock goes down, low items show up, reordering is one click." />
          <Node title="Money and GST" body="Payments, customer dues and GST returns are updated." />
          <Node title="Insights" body="FlowXP spots what changed and tells you what to do." />
        </div>
      </div>
      <figcaption className="sr-only">
        Sales from the counter, the phone and the table all become one GST bill in FlowXP, which updates stock and purchases, money and GST, and the insights.
      </figcaption>
    </Reveal>
  </Section>
);

/* ── 4. Built for your kind of business ───────────────────────────────── */

const BUSINESSES = [
  {
    key: 'retail', label: 'Shops and retail',
    title: 'For shops, supermarkets and pharmacies',
    body: 'Scan barcodes, bill fast at the counter, and always know what is on the shelf and what to reorder.',
    points: ['Barcode billing with GST on every line', 'Stock that updates with every sale and purchase', 'Low-stock alerts and purchase orders to suppliers', 'Customer credit and dues, with reminders', 'Returns and credit notes that fix stock and GST'],
    src: '/product/inventory-main.webp', alt: 'FlowXP inventory screen with stock value, items below their reorder point, wastage and a list of products.'
  },
  {
    key: 'food', label: 'Restaurants and cafés',
    title: 'For restaurants, cafés and cloud kitchens',
    body: 'Take orders at the table, by QR or at the counter. The kitchen sees them at once and the bill is always right.',
    points: ['Tables, waiters and table QR ordering', 'Kitchen screen or kitchen printer, by station', 'Recipes, so each dish uses up its ingredients', 'Split bills, service types and multiple outlets', 'Profit by dish, not just sales'],
    src: '/product/kitchen-main.webp', alt: 'FlowXP kitchen display with six open orders by table, the dishes, and minutes since each was sent.'
  },
  {
    key: 'services', label: 'Salons and services',
    title: 'For salons, clinics and service businesses',
    body: 'Bill services and products on one GST invoice, remember your regulars, and bring them back with offers.',
    points: ['Services and products on the same bill', 'Customer history and visit counts', 'Loyalty points and coupons', 'Staff logins with the right permissions', 'Appointments and staff scheduling: coming soon'],
    src: '/product/pos-main.webp', alt: 'FlowXP billing screen with items, quantities, GST and a Charge button.'
  },
  {
    key: 'wholesale', label: 'Wholesale and distribution',
    title: 'For wholesalers and distributors',
    body: 'Buy from suppliers, sell on credit, and keep track of who owes you and whom you owe.',
    points: ['Purchase orders, partial deliveries and back-orders', 'Supplier price lists and debit notes', 'Customer credit, dues and outstanding reports', 'Stock transfers between branches or godowns', 'E-way bill and e-invoice files'],
    src: '/product/profit-main.webp', alt: 'FlowXP profitability report with revenue, costs, margin and daily revenue.'
  }
];

const ForYourBusiness = () => {
  const [active, setActive] = useState(BUSINESSES[0].key);
  const b = BUSINESSES.find((x) => x.key === active);
  // The underline slides to the active tab rather than two borders swapping colour — the one place
  // on the page a literal position change earns its keep, since it IS what "switching tab" means.
  const tabRefs = useRef({});
  const [indicator, setIndicator] = useState(null);
  useEffect(() => {
    const measure = () => { const el = tabRefs.current[active]; if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth }); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [active]);

  return (
    <Section
      id="industries"
      className="border-y border-line bg-surface"
      title="Built for the business you run."
      lead="The billing, stock, GST and insights are the same for everyone. On top of that, FlowXP shows each kind of business the tools it needs."
    >
      <Reveal>
        <div role="tablist" aria-label="Kind of business" className="relative flex gap-1 overflow-x-auto border-b border-line">
          {BUSINESSES.map((x) => (
            <button
              key={x.key}
              ref={(el) => { tabRefs.current[x.key] = el; }}
              role="tab"
              type="button"
              id={`tab-${x.key}`}
              aria-selected={x.key === active}
              aria-controls="business-panel"
              onClick={() => setActive(x.key)}
              className={`shrink-0 px-4 py-3 text-body font-medium transition-colors duration-(--duration-normal) ${x.key === active ? 'text-ink-900' : 'text-ink-500 hover:text-ink-900'}`}
            >
              {x.label}
            </button>
          ))}
          {indicator && (
            <span aria-hidden="true" className="absolute bottom-0 h-0.5 bg-brand-500 transition-[left,width] duration-(--duration-normal) ease-(--ease-standard)" style={{ left: indicator.left, width: indicator.width }} />
          )}
        </div>
        <div key={b.key} id="business-panel" role="tabpanel" aria-labelledby={`tab-${b.key}`} className="fade-in grid items-center gap-10 pt-10 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <h3 className="text-h3 font-semibold text-ink-900">{b.title}</h3>
            <p className="mt-3 text-lead text-ink-500">{b.body}</p>
            <ul className="mt-6 space-y-3">
              {b.points.map((p) => <li key={p} className="flex gap-3 text-body text-ink-700"><Check />{p}</li>)}
            </ul>
          </div>
          <div className="lg:col-span-7">
            <Shot src={b.src} alt={b.alt} />
          </div>
        </div>
      </Reveal>
    </Section>
  );
};

/* ── 5. The AI part: insights and decisions ───────────────────────────── */

const DECISIONS = [
  {
    kind: 'happened', q: 'How did we do?',
    body: 'Sales, profit and payments compared with last week and last month, per branch, in words anyone can read.',
    eg: '“Sales are up 16.6% on the previous 30 days.”'
  },
  {
    kind: 'check', q: 'What should I look at?',
    body: 'Unusual discounts, cancelled bills and refunds are flagged with the bills behind them, so you can check before money walks out.',
    eg: '“30 cancelled bills still show money collected.”'
  },
  {
    kind: 'suggest', q: 'What should I do next?',
    body: 'What to reorder and how much, which items earn you the most, and which ones cost more than they bring in.',
    eg: '“10 items are at their reorder point. Order before the weekend.”'
  }
];

const Insights = () => (
  <Section id="ai">
    <div className="grid gap-12 lg:grid-cols-12">
      <Reveal className="lg:col-span-5">
        <H2>It does not just record your business. It helps you run it.</H2>
        <p className="mt-4 text-lead text-ink-500">
          Most billing software stops at the bill. FlowXP keeps reading your sales, stock and expenses,
          and tells you what changed, what looks wrong and what to do about it. You can also ask it a
          question in plain English, like “what should I order tomorrow?”
        </p>
        <p className="mt-4 text-small text-ink-500">
          Every answer comes from your own records and says whether it is a fact, an estimate or a suggestion.
        </p>
        <div className="mt-8"><TextLink to="/ai">How the AI Manager works</TextLink></div>
      </Reveal>
      <div className="lg:col-span-7">
        <ul className="grid gap-4">
          {DECISIONS.map((d, i) => (
            <Reveal as="li" key={d.q} index={i} className="lift rounded-(--radius-card) border border-line bg-surface p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`inline-flex rounded-full px-2.5 py-0.5 text-caption font-medium ${KIND[d.kind][1]}`}>{KIND[d.kind][0]}</span>
                <h3 className="text-title font-semibold text-ink-900">{d.q}</h3>
              </div>
              <p className="mt-2 text-body text-ink-500">{d.body}</p>
              <p className="mt-3 text-body font-medium text-ink-900">{d.eg}</p>
            </Reveal>
          ))}
        </ul>
      </div>
    </div>
  </Section>
);

/* ── Outlets: the whole business on one screen, shown large ─────────────── */

const OUTLET_FACTS = [
  ['One login', 'Switch between outlets, or look at all of them together.'],
  ['Compared side by side', 'Revenue, orders, food cost and margin for each outlet.'],
  ['Each outlet its own', 'Stock, prices, invoice series and staff, kept per outlet.']
];

const Outlets = () => (
  <Section className="border-t border-line">
    <div className="grid gap-x-12 gap-y-8 lg:grid-cols-12">
      <Reveal className="lg:col-span-5">
        <H2>Every outlet, on one screen.</H2>
        <p className="mt-4 text-lead text-ink-500">Open one branch or all of them, and see which one is earning and which one needs you.</p>
      </Reveal>
      <dl className="grid gap-6 sm:grid-cols-3 lg:col-span-7 lg:pt-2">
        {OUTLET_FACTS.map(([term, text], i) => (
          <Reveal key={term} index={i} className="border-t border-line pt-4">
            <dt className="text-body font-semibold text-ink-900">{term}</dt>
            <dd className="mt-1.5 text-small text-ink-500">{text}</dd>
          </Reveal>
        ))}
      </dl>
    </div>
    <Reveal className="mt-12 rounded-(--radius-panel) bg-brand-50 p-3 sm:p-6 lg:p-8">
      <Shot src="/product/restaurant-outlets.webp"
            alt="FlowXP outlets compared side by side on revenue, orders, food cost, contribution and estimated net, from the demo business." />
    </Reveal>
  </Section>
);

/* ── 6. How it works ──────────────────────────────────────────────────── */

const STEPS = [
  ['Set up', 'Add your business, GST number and products. Import a list or add them as you go.'],
  ['Bill', 'Scan or search, take cash, UPI or card, and print or share the GST bill as a link.'],
  ['Stock moves', 'Every sale and purchase updates stock. Low items show up before they run out.'],
  ['GST is ready', 'At month end, download the GSTR-1 file and GSTR-3B figures for your accountant.'],
  ['Decide', 'Each day, FlowXP shows what changed and what needs doing. You make the call.']
];

const STEP_ICONS = [Store, ReceiptText, Boxes, FileCheck2, Lightbulb];

const HowItWorks = () => (
  <Section id="how-it-works" className="scroll-mt-16 border-y border-line bg-surface">
    <div className="grid gap-12 lg:grid-cols-12">
      <Reveal className="lg:sticky lg:top-28 lg:col-span-5 lg:self-start">
        <H2>Start billing today. Get smarter every day after.</H2>
        <p className="mt-4 max-w-md text-lead text-ink-500">Nothing to install and no machine to buy. Most businesses make their first bill within an hour.</p>
        <div className="mt-8"><Button to="/signup">Start free trial</Button></div>
      </Reveal>
      <ol className="lg:col-span-6 lg:col-start-7">
        {STEPS.map(([title, body], i) => {
          const Icon = STEP_ICONS[i];
          return (
            <Reveal as="li" key={title} index={i} className="relative flex gap-5 pb-12 last:pb-0">
              {i < STEPS.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-5 top-12 w-px -translate-x-1/2 bg-line-strong" />}
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white shadow-sm">
                <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
              </span>
              <div className="pt-1.5">
                <h3 className="text-title font-semibold text-ink-900">{title}</h3>
                <p className="mt-1.5 max-w-md text-body text-ink-500">{body}</p>
              </div>
            </Reveal>
          );
        })}
      </ol>
    </div>
  </Section>
);

/* ── 7. Real screens ──────────────────────────────────────────────────── */

/* Tiles on a 12-column grid: a tall brand tile (5 columns, two rows), then 7, and 4 + 3 beside it. Each tile is a
   real screen, cropped to its top-left corner where the point is; SpotlightCard adds a soft light under the pointer. */
const TileImg = ({ src, alt, zoom = 100, className = '' }) => (
  <div className={`overflow-hidden rounded-tl-lg border-l border-t border-line bg-surface shadow-md ${className}`}>
    {/* `zoom` widens the picture past its tile so the corner that shows is large enough to read. */}
    <img src={src} alt={alt} width={MAIN.width} height={MAIN.height} loading="lazy" decoding="async"
         style={{ width: `${zoom}%` }} className="block h-auto max-w-none" />
  </div>
);

const Bento = () => (
  <Section id="features" title="Simple enough for the counter. Detailed enough for the owner."
           lead="Real FlowXP screens, from the demo business.">
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-12">
      <Reveal className="md:row-span-2 lg:col-span-5">
        <SpotlightCard spotlightColor="rgba(255, 255, 255, 0.28)" className="flex h-full flex-col rounded-(--radius-panel) bg-brand-500 px-7 pt-8 text-white">
          <h3 className="text-h3 font-semibold">Guests order from the table.</h3>
          <p className="mt-2 max-w-sm text-body text-white/80">They scan the QR on the table, pick from the menu, and the order reaches the kitchen.</p>
          <div className="mt-8 flex flex-1 items-end justify-center">
            <div className="w-full max-w-[17rem] translate-y-8">
              <PhoneShot src="/product/restaurant-qr.webp" className="max-w-none" alt="The FlowXP guest menu on a phone, opened from a table QR code." />
            </div>
          </div>
        </SpotlightCard>
      </Reveal>
      <Reveal index={1} className="lg:col-span-7">
        <SpotlightCard spotlightColor="rgba(0, 84, 250, 0.14)" className="flex h-full flex-col rounded-(--radius-panel) bg-brand-50 pl-7 pt-8">
          <h3 className="pr-7 text-h3 font-semibold text-ink-900">Ask your business a question.</h3>
          <p className="mt-2 max-w-md pr-7 text-body text-ink-500">Flow AI answers from your own bills and stock, and says when a figure is an estimate.</p>
          <TileImg src="/product/restaurant-ai.webp" alt="Flow AI answering a question about the demo restaurant's sales." zoom={125} className="mt-6 h-56 sm:h-64" />
        </SpotlightCard>
      </Reveal>
      <Reveal index={2} className="lg:col-span-4">
        <SpotlightCard spotlightColor="rgba(0, 84, 250, 0.10)" className="flex h-full flex-col rounded-(--radius-panel) border border-line bg-surface pl-7 pt-8">
          <h3 className="pr-7 text-title font-semibold text-ink-900">Know what you really earn.</h3>
          <p className="mt-1.5 pr-7 text-small text-ink-500">Sales minus cost, fees and expenses, per product and branch.</p>
          <TileImg src="/product/profit-main.webp" alt="FlowXP profitability report with net revenue, cost share and margin." zoom={190} className="mt-6 h-44" />
        </SpotlightCard>
      </Reveal>
      <Reveal index={3} className="lg:col-span-3">
        <SpotlightCard spotlightColor="rgba(255, 255, 255, 0.16)" className="flex h-full flex-col rounded-(--radius-panel) bg-ink-900 pl-7 pt-8 text-white">
          <h3 className="pr-7 text-title font-semibold">Never run short.</h3>
          <p className="mt-1.5 pr-7 text-small text-white/70">Low stock shows up before the weekend rush.</p>
          <TileImg src="/product/reorder-main.webp" alt="FlowXP reorder list with items at their reorder point." zoom={230} className="mt-6 h-44" />
        </SpotlightCard>
      </Reveal>
    </div>
  </Section>
);

/* ── 8. Before and after ──────────────────────────────────────────────── */

const BEFORE = [
  'A billing machine that knows nothing about stock',
  'Stock counted in a notebook, usually after it has run out',
  'Bills re-typed into a spreadsheet for the accountant',
  'Guessing which products actually make money',
  'Discounts and cancellations nobody checks'
];
const AFTER = [
  'One bill updates stock, customer dues and GST together',
  'Low-stock alerts and purchase orders from the same screen',
  'GST returns prepared from the bills you already made',
  'Profit per product, per branch and per day',
  'Unusual discounts, cancellations and refunds flagged for you'
];

const BeforeAfter = () => (
  <Section className="border-y border-line bg-surface"  title="Less paperwork. Fewer surprises at month end.">
    <div className="grid gap-5 md:grid-cols-2">
      <Reveal className="rounded-(--radius-panel) border border-line bg-page p-6 sm:p-8">
        <h3 className="text-body font-semibold text-ink-500">Without FlowXP</h3>
        <ul className="mt-5 space-y-3.5">
          {BEFORE.map((t) => <li key={t} className="flex gap-3 text-body text-ink-500"><Cross />{t}</li>)}
        </ul>
      </Reveal>
      <Reveal index={1} className="rounded-(--radius-panel) border border-brand-100 bg-brand-50 p-6 sm:p-8">
        <h3 className="text-body font-semibold text-ink-900">With FlowXP</h3>
        <ul className="mt-5 space-y-3.5">
          {AFTER.map((t) => <li key={t} className="flex gap-3 text-body text-ink-900"><Check />{t}</li>)}
        </ul>
      </Reveal>
    </div>
  </Section>
);

/* ── 9. Works with ────────────────────────────────────────────────────── */

/* The two FlowXP leans on hardest get the wider cells — not an arbitrary
   pattern, the two that most change how someone sells (orders arriving from
   an app, bills going out over chat) earn the room. Everything else is the
   same size: a bento grid is a hierarchy, not decoration, so only genuinely
   bigger ideas get a bigger cell. */
const WORKS_WITH = [
  { title: 'Zomato and Swiggy', body: 'Online orders arrive straight into the kitchen and the day\'s bills, no re-typing.', soon: true, big: true },
  { title: 'WhatsApp and SMS', body: 'Bills, payment reminders and offers go out the way your customers already read you.', soon: true, big: true },
  { title: 'UPI, cards and cash', body: 'Split one bill across several payments.' },
  { title: 'GST portal', body: 'GSTR-1, e-invoice and e-way bill files, ready to upload.' },
  { title: 'Works offline', body: 'Keep billing when the internet drops.' },
  { title: 'Receipt printers', body: '58 and 80 mm thermal printers.' },
  { title: 'Barcode scanners', body: 'Any USB or Bluetooth scanner.' },
  { title: 'Phone app', body: 'Install from the browser today. Android app in testing.' }
];

const WorksWith = () => {
  const featured = WORKS_WITH.filter((w) => w.big);
  const rest = WORKS_WITH.filter((w) => !w.big);
  return (
    <Section
      title="Fits the counter you already have."
      lead="Use the laptop, tablet or phone you own. Add a printer, scanner or cash drawer when you want one."
    >
      {/* The two featured cells are their own row, not columns mixed into the grid below — two different
          span widths inside one CSS grid leaves an uneven, gap-ridden last row the moment the item count
          doesn't divide evenly; a separate row sidesteps that arithmetic entirely. */}
      <div className="grid gap-3 sm:grid-cols-2">
        {featured.map(({ title, body, soon }, i) => (
          <Reveal as="div" key={title} index={i} className="lift rounded-(--radius-card) border border-brand-100 bg-brand-50 p-6">
            <p className="flex flex-wrap items-center gap-2 text-title font-semibold text-ink-900">
              {title}
              {soon && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-ink-500">Coming soon</span>}
            </p>
            <p className="mt-1.5 text-body text-ink-500">{body}</p>
          </Reveal>
        ))}
      </div>
      <ul className="mt-3 grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {rest.map(({ title, body }, i) => (
          <Reveal as="li" key={title} index={i % 4} className="lift rounded-(--radius-card) border border-line bg-surface p-5">
            <p className="text-body font-semibold text-ink-900">{title}</p>
            <p className="mt-1 text-small text-ink-500">{body}</p>
          </Reveal>
        ))}
      </ul>
    </Section>
  );
};

/* ── 9b. The Android app ──────────────────────────────────────────────── */

/* Only what the app does today. It is in testing, not on the Play Store, so the section says so
   and offers no download button. */
const APP_POINTS = [
  ['Bills are never lost.', 'With no signal, bills wait on the phone and go out once when the internet is back. A bill is never made twice.'],
  ['Tables and the kitchen.', 'Open a table, send the order, and the cook sees it on a large kitchen screen and taps each dish when it is done.'],
  ['Customers and stock on the phone.', 'Find a customer, change a price or count stock with no signal. The change is sent later, in order.'],
  ['English and Hindi.', 'Short plain words, big buttons, and a tour for someone who has never used billing software.']
];

const PhoneApp = () => (
  <Section id="app" className="border-t border-line">
    <div className="grid gap-x-12 gap-y-10 lg:grid-cols-12">
      <Reveal className="lg:col-span-5">
        <p className="inline-flex rounded-full bg-surface-3 px-2.5 py-0.5 text-caption font-medium text-ink-500">Android app: in testing</p>
        <H2>The counter in your pocket, even with no signal.</H2>
        <p className="mt-4 text-lead text-ink-500">
          The FlowXP app is built for the phone or tablet at the counter. Today it works in any mobile browser;
          the Android app is being tested with real shops and is not on the Play Store yet.
        </p>
        <div className="mt-8"><TextLink to="/contact">Ask to join the test</TextLink></div>
      </Reveal>
      <ul className="grid gap-6 sm:grid-cols-2 lg:col-span-7 lg:pt-2">
        {APP_POINTS.map(([title, body], i) => (
          <Reveal as="li" key={title} index={i} className="border-t border-line pt-4">
            <h3 className="text-body font-semibold text-ink-900">{title}</h3>
            <p className="mt-1.5 text-small text-ink-500">{body}</p>
          </Reveal>
        ))}
      </ul>
    </div>
  </Section>
);

/* ── 10. Built so nothing gets lost ───────────────────────────────────── */

const TRUST = [
  ['Bills are never quietly deleted.', 'A cancelled bill or a return leaves a numbered credit note and a reason.'],
  ['Every change has a name on it.', 'Prices, discounts, stock changes and refunds are recorded with who did it and when.'],
  ['Each branch sees its own data.', 'Staff see only what their role allows. Owners can turn on two-step login.'],
  ['Your data stays yours.', 'Kept separate from every other business, and still readable if you stop paying.']
];

const Trust = () => (
  <Section className="border-y border-line bg-surface"  title="Built so nothing gets lost.">
    <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
      {TRUST.map(([title, body], i) => (
        <Reveal key={title} index={i} className="border-t-2 border-ink-900 pt-5">
          <h3 className="text-body font-semibold text-ink-900">{title}</h3>
          <p className="mt-2 text-body text-ink-500">{body}</p>
        </Reveal>
      ))}
    </div>
  </Section>
);

/* ── 11. Pricing, FAQ, final call ─────────────────────────────────────── */

const PricingSection = () => (
  <Section id="pricing" center  title="Simple plans. Start free."
           lead="Every plan starts with the same 7-day free trial. Move to a paid plan when FlowXP has earned it.">
    <Reveal><PricingTable /></Reveal>
  </Section>
);

const Faq = () => (
  <Section id="faq" className="border-t border-line">
    <div className="grid gap-10 lg:grid-cols-12">
      <Reveal className="lg:col-span-4">
        <H2>Questions owners ask first</H2>
        <p className="mt-4 text-body text-ink-500">
          Something else? <Link to="/contact" className="font-medium text-brand-600 hover:text-brand-700">Talk to us</Link>.
        </p>
      </Reveal>
      <Reveal index={1} className="space-y-3 lg:col-span-8">
        {FAQ.map((item) => (
          <details key={item.q} className="group rounded-(--radius-card) border border-line bg-surface px-5 shadow-sm transition-shadow duration-(--duration-fast) open:shadow-md">
            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 text-body font-medium text-ink-900 [&::-webkit-details-marker]:hidden">
              {item.q}
              <ChevronDown aria-hidden="true" strokeWidth={2} className="h-4 w-4 shrink-0 text-ink-500 transition-transform duration-(--duration-normal) group-open:rotate-180" />
            </summary>
            <p className="pb-5 pr-6 text-body text-ink-500">{item.a}</p>
          </details>
        ))}
      </Reveal>
    </div>
  </Section>
);

const Home = () => (
  <>
    <Hero />
    <CapabilityStrip />
    <OneBill />
    <ForYourBusiness />
    <Insights />
    <Outlets />
    <HowItWorks />
    <Bento />
    <BeforeAfter />
    <WorksWith />
    <PhoneApp />
    <Trust />
    <PricingSection />
    <Faq />
    <FinalCta title="Make your first bill on FlowXP today." lead="Add your products, print a test bill and see your first report. Seven days free, no card, no sales call." />
  </>
);

export default Home;
