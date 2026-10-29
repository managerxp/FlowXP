/*
 * /flowbook: ManagerXP's accounting product. The screens are real FlowBook (a demo shop's books), and the page says
 * plainly what works and what is not built, so nothing here claims a filing or a bank connection that does not exist.
 * The trial buttons go to the FlowBook app (VITE_FLOWBOOK_APP_URL); where that is not set they fall back to Contact.
 */
import { Button, Section } from '../components/ui.jsx';
import { Check, CellGrid, Connector, Cross, FeatureRow, FinalCta, Node, PageHero, Shot } from './parts.jsx';

const APP = import.meta.env.VITE_FLOWBOOK_APP_URL;
const trial = APP ? { href: `${APP}/signup` } : { to: '/contact' };
const login = APP ? { href: `${APP}/login` } : { to: '/contact' };
const FULL = { width: 1440, height: 900 };

const Flow = () => (
  <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
    <div className="space-y-3">
      <Node title="Bills and returns" body="From the FlowXP till" />
      <Node title="Payments" body="Cash, UPI, card, bank" />
      <Node title="Purchases" body="Supplier bills and stock" />
    </div>
    <Connector />
    <Node strong title="FlowBook" body="One ledger, posted once" />
    <Connector />
    <div className="space-y-3">
      <Node title="Statements" body="Profit and loss, balance sheet" />
      <Node title="GST" body="GSTR-1 and 3B figures" />
      <Node title="Your accountant" body="Exports and a full trail" />
    </div>
  </div>
);

const Steps = () => (
  <div className="grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
    <Node title="1. Sign up" body="Email and password. No card." />
    <Connector />
    <Node title="2. Set up your business" body="Pick a template; accounts are made for you." />
    <Connector />
    <Node strong title="3. Use it for 7 days" body="Everything works. Read-only after, never deleted." />
  </div>
);

const WORKS = [
  { title: 'Double-entry ledger', body: 'Every figure leads back to the bill, payment or journal behind it. Mistakes are reversed visibly, never edited away.' },
  { title: 'Invoices, bills and quotes', body: 'GST invoices with the right tax split, returns, credit and debit notes, and payments matched to what they settle.' },
  { title: 'Stock', body: 'Average cost, warehouses with transfers, batches with expiry and serial numbers.' },
  { title: 'Bank and reconciliation', body: 'Rupee and foreign-currency accounts, transfers, and statement matching.' },
  { title: 'Foreign currency', body: 'Dollar invoices and receipts, exchange gain or loss, and revaluation at period end.' },
  { title: 'Fixed assets', body: 'Depreciation from the books, and the Income Tax Act block schedule for your return.' },
  { title: 'GST returns prepared', body: 'GSTR-1 (including exports) and GSTR-3B figures that match the ledger, as JSON for your accountant.' },
  { title: 'Controls', body: 'Lock a closed month, roles for your team, and a record of who changed what.' }
];

const NOT_YET = [
  { title: 'Direct GST filing and e-invoicing', body: 'Returns are prepared, not filed. The file format has not been checked on the GST portal yet.', soon: true },
  { title: 'Live bank feeds', body: 'Import a statement and match it. Direct bank connections are not built.', soon: true },
  { title: 'Online payment for the plan', body: 'After the trial, contact us to continue. Self-serve payment is not built yet.', soon: true }
];

const FlowBookPage = () => (
  <>
    <PageHero
      eyebrow="FlowBook"
      title="Accounting that follows your billing."
      lead="Real books for an Indian business: invoices, GST, stock, bank and statements. Works with FlowXP, or on its own."
      points={['7-day free trial', 'No card needed', 'Every figure traceable']}
      split="6-6"
      visual={<Shot src="/product/flowbook-home.webp" alt="FlowBook home: sales, money in and out, and what needs attention" size={FULL} eager />}
    >
      <Button {...trial} size="lg">Start 7-day free trial</Button>
      <Button {...login} size="lg" variant="secondary">Log in</Button>
    </PageHero>

    <Section title="FlowXP writes it, FlowBook keeps it."
             lead="Sales, returns, payments and purchases arrive from FlowXP once. Nothing is typed twice and nothing is counted twice.">
      <Flow />
    </Section>

    <Section className="border-t border-line bg-surface" title="See it working."
             lead="These are real screens from a demo shop's books.">
      <div className="space-y-20">
        <FeatureRow eyebrow="Sales and GST" title="Invoices that carry the tax."
                    body="Issue GST invoices, take payments against them, and see who still owes you."
                    points={['Right CGST, SGST or IGST by state', 'Payments matched to invoices', 'Quotes that become invoices']}
                    aside={<Shot src="/product/flowbook-invoice.webp" alt="A GST tax invoice in FlowBook" size={FULL} />} />
        <FeatureRow flip eyebrow="Bank" title="Rupee and dollar accounts."
                    body="Keep a foreign-currency account at its rupee value, move money between accounts, and reconcile against the statement."
                    points={['Gain or loss worked out for you', 'Transfers between accounts', 'Reconcile in the account’s own currency']}
                    aside={<Shot src="/product/flowbook-bank.webp" alt="FlowBook bank accounts, including a dollar account" size={FULL} />} />
        <FeatureRow eyebrow="Stock" title="Know what you hold, and where."
                    body="Average cost, several warehouses, and batches with expiry that sell first-expiry-first-out."
                    points={['Quantity per warehouse', 'Batch and serial numbers', 'Never sells what you do not have']}
                    aside={<Shot src="/product/flowbook-stock.webp" alt="FlowBook stock levels by item and warehouse" size={FULL} />} />
        <FeatureRow flip eyebrow="Fixed assets" title="Depreciation, books and tax."
                    body="Book depreciation year by year, and the Income Tax Act block schedule for your return."
                    points={['Half rate for assets used under 180 days', 'Gain or loss when a block ends', 'Have your CA confirm the block rates']}
                    aside={<Shot src="/product/flowbook-assets.webp" alt="FlowBook fixed assets with the income tax block schedule" size={FULL} />} />
        <FeatureRow eyebrow="Reports and GST" title="Statements and returns, from one ledger."
                    body="Profit and loss, balance sheet, trial balance, and GSTR-1 and 3B figures that match."
                    points={['Exports with shipping bill details', 'Warnings for what is missing', 'Download for your accountant']}
                    aside={<Shot src="/product/flowbook-gst.webp" alt="FlowBook GST returns prepared from the books" size={FULL} />} />
      </div>
    </Section>

    <Section title="What works today." lead="Built and tested. Have your accountant look it over before you rely on it for filing.">
      <CellGrid items={WORKS} />
    </Section>

    <Section className="border-t border-line bg-surface" title="What is not built, said plainly." lead="We list it so you never have to guess.">
      <CellGrid items={NOT_YET} cols="sm:grid-cols-3" />
    </Section>

    <Section title="Start in a minute." lead="The trial is the whole product for seven days. After that your books stay readable; to keep adding entries, contact us.">
      <Steps />
      <div className="mt-10 grid items-center gap-8 lg:grid-cols-12">
        <ul className="space-y-2.5 lg:col-span-5">
          <li className="flex gap-3 text-body text-ink-700"><Check />Sign up takes an email and a password</li>
          <li className="flex gap-3 text-body text-ink-700"><Check />You choose your business type and start date</li>
          <li className="flex gap-3 text-body text-ink-700"><Cross />No payment details asked</li>
        </ul>
        <div className="lg:col-span-7"><Shot src="/product/flowbook-trial.webp" alt="The FlowBook sign-up screen" size={FULL} /></div>
      </div>
    </Section>

    <FinalCta title="Try FlowBook for 7 days." lead="Free, no card. Your books stay yours." primary={trial} />
  </>
);

export default FlowBookPage;
