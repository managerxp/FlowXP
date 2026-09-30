/*
 * /industries — who FlowXP is for. Four kinds of business in detail, then the
 * other trades it suits. What is not built yet for a trade (appointments,
 * batch and expiry, size and colour, serial numbers) says "coming soon"
 * rather than being implied.
 */
import { Section } from '../components/ui.jsx';
import { CellGrid, FeatureRow, FinalCta, PageHero, Shot } from './parts.jsx';

const KINDS = [
  {
    id: 'retail', eyebrow: 'Shops and retail', title: 'For shops, supermarkets and pharmacies',
    body: 'Bill quickly at a busy counter, keep the shelf stocked, and know which products actually make you money.',
    points: ['Barcode or name search, GST on every line', 'Stock that moves with every sale and delivery', 'Low-stock alerts and purchase orders to suppliers', 'Customer credit, dues and returns with credit notes'],
    src: '/product/inventory-main.webp', alt: 'FlowXP inventory screen with stock value, low-stock items, wastage and the product list.'
  },
  {
    id: 'food', eyebrow: 'Restaurants and cafés', title: 'For restaurants, cafés, bakeries and cloud kitchens',
    body: 'Tables, QR ordering, the kitchen and the bill work as one, so orders are not lost and every item is billed.',
    points: ['Tables, waiters and guest ordering by table QR', 'Kitchen display or printer, by station', 'Recipes and food cost, wastage with reasons', 'Reservations, waitlist, combos and split bills'],
    src: '/product/kitchen-main.webp', alt: 'FlowXP kitchen display with open orders by table.'
  },
  {
    id: 'services', eyebrow: 'Salons and services', title: 'For salons, spas, clinics and service businesses',
    body: 'Bill services and products together on one GST invoice, remember every regular, and bring them back.',
    points: ['Services and products on the same bill', 'Customer history and visit counts', 'Loyalty, coupons and WhatsApp offers', 'Staff logins with the right permissions'],
    note: 'Appointments and staff scheduling are coming soon.',
    src: '/product/pos-main.webp', alt: 'FlowXP billing screen with items, quantities, GST and a Charge button.'
  },
  {
    id: 'wholesale', eyebrow: 'Wholesale and distribution', title: 'For wholesalers, distributors and stockists',
    body: 'Buy in bulk, sell on credit, and always know your stock across branches or godowns and what is owed.',
    points: ['Purchase orders, part deliveries and back-orders', 'Supplier price lists and debit notes', 'Customer credit and outstanding reports', 'E-invoice and e-way bill files for large consignments'],
    src: '/product/gst3b-main.webp', alt: 'FlowXP GST filing screen with GSTR-3B figures.'
  }
];

const ALSO = [
  { title: 'Supermarkets', body: 'Fast barcode billing and stock across counters.' },
  { title: 'Pharmacies', body: 'GST billing, stock and reorders today. Batch and expiry tracking is next.', soon: true },
  { title: 'Clothing and footwear', body: 'Billing, stock and loyalty today. Size and colour options are next.', soon: true },
  { title: 'Electronics and mobiles', body: 'Billing, stock and credit today. Serial number tracking is next.', soon: true },
  { title: 'Bakeries and sweet shops', body: 'Counter billing, recipes and daily wastage.' },
  { title: 'Cloud kitchens', body: 'Takeaway orders, the kitchen screen and food cost.' },
  { title: 'Gaming cafés and play zones', body: 'Bill time packages, snacks and memberships as items.' },
  { title: 'Groups with several outlets', body: 'One owner view; each outlet with its own stock and staff.' }
];

const IndustriesPage = () => (
  <>
    <PageHero
      eyebrow="Who it is for"
      title="One system, set up for how you sell."
      lead="Billing, payments, stock, GST and insights are the same for every business. When you sign up and choose what you do, FlowXP switches on the tools your trade needs and keeps the rest out of the way."
      points={['Choose your kind of business when you sign up', 'Run different kinds of businesses under one login', 'The same billing, stock and GST underneath']}
      visual={<Shot src="/product/kitchen-main.webp" eager alt="FlowXP kitchen display with open orders by table, the dishes and minutes since sent." />}
    />

    <Section>
      <div className="space-y-24 lg:space-y-32">
        {KINDS.map((k, i) => (
          <FeatureRow key={k.id} id={k.id} eyebrow={k.eyebrow} title={k.title} body={k.body} points={k.points} src={k.src} alt={k.alt} flip={i % 2 === 1}>
            {k.note && <p className="mt-4 text-small text-ink-500">{k.note}</p>}
          </FeatureRow>
        ))}
      </div>
    </Section>

    <Section className="border-t border-line bg-surface" eyebrow="Also used by" title="If you sell things or services, it fits."
             lead="These businesses use the same core. Where a trade needs something extra that is not built yet, we say so.">
      <CellGrid items={ALSO} />
    </Section>

    <FinalCta title="Not sure it fits your business?" lead="Tell us how you sell today. We will tell you honestly what works in FlowXP now and what is coming." />
  </>
);

export default IndustriesPage;
