/*
 * /features — everything FlowXP does, one area per row, each answering the
 * question an owner has about it, with the real screen next to it.
 *
 * Only built features are listed (brain.md §4). Where a screen would show
 * customers' phone numbers (customers, loyalty), a plain list stands in for
 * the screenshot rather than publishing numbers that could be someone's.
 */
import { Section } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';
import { CellGrid, Check, FeatureRow, FinalCta, FULL, PageHero, Shot, Tag, TextLink } from './parts.jsx';

const AREAS = [
  ['billing', 'Billing'], ['stock', 'Stock and buying'], ['gst', 'GST'], ['customers', 'Customers'],
  ['reports', 'Reports'], ['team', 'Team'], ['restaurants', 'Restaurants'], ['ai', 'AI']
];

/* A sticky row of links to each area, so a long page is easy to move around. */
const JumpBar = () => (
  <nav aria-label="On this page" className="sticky top-16 z-40 border-b border-line bg-page/95 backdrop-blur-sm">
    <div className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-5 py-2 sm:px-8">
      {AREAS.map(([id, label]) => (
        <a key={id} href={`#${id}`} className="shrink-0 rounded-md px-3 py-1.5 text-small font-medium text-ink-500 transition-colors duration-(--duration-normal) hover:bg-surface-2 hover:text-ink-900">
          {label}
        </a>
      ))}
    </div>
  </nav>
);

/* Stand-in for a screen whose real version shows customers' phone numbers. */
const ListPanel = ({ title, groups }) => (
  <div className="rounded-(--radius-panel) border border-line bg-surface p-6 shadow-md sm:p-8">
    <p className="text-small font-semibold text-ink-900">{title}</p>
    <div className="mt-5 grid gap-6 sm:grid-cols-2">
      {groups.map(([heading, items]) => (
        <div key={heading}>
          <p className="text-caption font-semibold uppercase tracking-[0.12em] text-brand-600">{heading}</p>
          <ul className="mt-3 space-y-2">
            {items.map((i) => <li key={i} className="flex gap-2.5 text-small text-ink-700"><Check />{i}</li>)}
          </ul>
        </div>
      ))}
    </div>
  </div>
);

const ALSO = [
  { title: 'Several businesses, one login', body: 'Switch between them from the same account; each keeps its own stock, staff and invoice numbers.', big: true },
  { title: 'Branches and outlets', body: 'Own stock, staff and invoice series, one owner view.' },
  { title: 'Works offline', body: 'Bills are saved on the device and sent when the internet is back.' },
  { title: 'Phone app', body: 'Install FlowXP on Android or iPhone from the browser.' },
  { title: 'Thermal printing', body: '58 and 80 mm receipts and kitchen tickets, silent if you like.' },
  { title: 'Cash drawer', body: 'Opens when a cash bill prints.' },
  { title: 'Export', body: 'Reports and the GST register download as CSV.' },
  { title: 'Menu from a photo', body: 'Read items and prices from a photo; you confirm.' }
];

const ProductPage = () => (
  <>
    <PageHero
      eyebrow="The product"
      title="Everything you need to sell, stock and file GST."
      lead="Billing, payments, stock, purchases, GST, customers, reports and your team, in one place that your staff can learn in an afternoon. The pictures on this page are the real screens."
      points={['Nothing to install: it runs in the browser', 'Works on the laptop, tablet or phone you have', 'Every change is recorded with who made it']}
      visual={<Shot src="/product/pos.webp" size={FULL} eager alt="The FlowXP billing screen with six items on a ₹1,315 bill, GST worked out and a Charge button." />}
    />
    <JumpBar />

    <Section>
      <div className="space-y-24 lg:space-y-32">
        <FeatureRow
          id="billing" eyebrow="Billing and payments" title="Take the money. Give a proper GST bill."
          body="Scan a barcode or search, change quantities, add a discount or coupon, and take cash, UPI, card or credit, or several at once. CGST, SGST or IGST is worked out on every line."
          points={['Print on a 58 or 80 mm printer, or send the bill as a WhatsApp or SMS link', 'Part payments and customer credit, settled later', 'Returns through numbered credit notes that reverse the GST exactly', 'Round-off to the rupee if you want it']}
          src="/product/pos-main.webp" alt="FlowXP billing screen with six items, quantities, line discounts, subtotal, GST, total and a Charge button."
        />
        <FeatureRow
          flip eyebrow="Invoices" title="Every bill you have ever made, easy to find."
          body="Search by bill number or customer, see what is paid and what is due, open any bill to reprint, cancel or issue a credit note."
          points={['Paid, part paid and unpaid at a glance', 'A separate invoice series for each outlet if you need one', 'GST register as CSV for your accountant']}
          src="/product/invoices-main.webp" alt="FlowXP invoices list with bill numbers, dates, customers, totals and paid and issued status."
        />
        <FeatureRow
          id="stock" eyebrow="Stock and buying" title="Know what you have. Order before you run out."
          body="Stock goes down with every sale and up with every delivery, at each branch. FlowXP shows what is low, what was wasted and what it is all worth."
          points={['Purchase orders, deliveries in parts, back-orders and supplier price lists', 'Debit notes for returns and price corrections', 'Move stock between branches, or let a branch ask for it', 'Recipes, so selling one item uses up its ingredients']}
          src="/product/inventory-main.webp" alt="FlowXP inventory with stock value, ten items below their reorder point, wastage for the last 30 days and the product list."
        />
        <FeatureRow
          id="gst" flip eyebrow="GST" title="Your GST returns, prepared from the bills you already made."
          body="At month end, download the GSTR-1 file and see the GSTR-3B figures, worked out from your sales, credit notes and purchases. You or your accountant upload them on the GST portal."
          points={['GSTR-1 JSON for each GSTIN, with HSN summary and document series', 'GSTR-3B: outward supplies, input tax credit and tax to pay', 'E-invoice and e-way bill files, and a place to record the IRN and e-way number', 'Warnings for what needs fixing before you file']}
          src="/product/gst3b-main.webp" alt="FlowXP GST filing screen showing GSTR-3B figures: taxable value, IGST, CGST and SGST, input tax credit and tax to pay."
        />
        <FeatureRow
          id="customers" eyebrow="Customers" title="Remember your regulars. Bring them back."
          body="Every bill can be tied to a customer by mobile number, so you see what they buy, what they owe and how often they come. Then reward them."
          aside={<ListPanel title="Customers, loyalty and messages" groups={[
            ['Customers', ['Purchase history and what is outstanding', 'Credit sales and part payments', 'Found at the till by mobile number']],
            ['Loyalty', ['A free item on the Nth visit', 'Points and tiers, earned and spent at the till', 'Coupons and offer codes']],
            ['Messages', ['Bill links on WhatsApp or SMS', 'Offers to chosen groups of customers', 'Customers can opt out; it is respected']],
            ['Good to know', ['Works across all your outlets', 'Returns take points back automatically']]
          ]} />}
        />
        <FeatureRow
          id="reports" flip eyebrow="Reports" title="See what you really earn, not just what you sold."
          body="Sales, profit after costs, expenses, stock, GST and payments, for any dates, by day, item, branch and staff member."
          points={['Profit after cost of goods, fees, commission and expenses', 'Branch against branch, and sales per staff member', 'Unusual discounts, cancellations and refunds flagged for you']}
          src="/product/profit-main.webp" alt="FlowXP profitability report with net revenue, food cost, margin, contribution and daily revenue."
        />
        <FeatureRow
          id="team" eyebrow="Team and control" title="Everyone sees what they need. You see everything."
          body="Give each person a role and the outlets they work at. Every change to money, stock, prices or the team is recorded with who did it and when."
          points={['Owner, manager, cashier, waiter, kitchen and stock roles, adjustable per person', 'Activity log you can search and export', 'Two-step login, sign-in history and sign out everywhere']}
          src="/product/activity-main.webp" alt="FlowXP activity log listing who did what, when and at which outlet."
        />
        <FeatureRow
          id="restaurants" flip eyebrow="For restaurants and cafés" title="The floor, the kitchen and the bill, connected."
          body="Switched on for restaurants, cafés and cloud kitchens. Orders go from the table or the QR menu to the right kitchen station, and the bill is always right."
          points={['Tables, waiters and guest ordering by table QR', 'Kitchen display or printed tickets, by station, with timers', 'Reservations and a walk-in waitlist', 'Combos, add-ons and spice levels, split and merged bills']}
          src="/product/kitchen-main.webp" alt="FlowXP kitchen display with six open orders by table, their dishes and minutes since sent."
        />
      </div>
    </Section>

    <Section id="ai" className="scroll-mt-24 border-y border-line bg-surface">
      <Reveal className="grid items-center gap-8 rounded-(--radius-panel) border border-brand-100 bg-brand-50 p-8 sm:p-10 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <div className="flex flex-wrap gap-2"><Tag kind="prediction" /><Tag kind="check" /><Tag kind="suggest" /></div>
          <h2 className="mt-4 text-h2 font-semibold text-ink-900">And an AI manager that reads all of it.</h2>
          <p className="mt-3 max-w-2xl text-lead text-ink-500">
            Flow AI forecasts how busy you will be, tells you what to reorder, flags money that may be leaking,
            and answers questions about your business in plain English.
          </p>
        </div>
        <div className="lg:col-span-4 lg:text-right"><TextLink to="/ai">How the AI Manager works</TextLink></div>
      </Reveal>
    </Section>

    <Section eyebrow="Also included" title="The small things that make a big difference.">
      <CellGrid items={ALSO} />
    </Section>

    <FinalCta title="See it on your own products." lead="Add a few products, make a test bill and look at the report. Seven days free, no card." />
  </>
);

export default ProductPage;
