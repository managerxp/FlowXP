/*
 * /flowbook — ManagerXP's accounting product. It is in development, so this page says what it will do and how it
 * relates to FlowXP, and claims nothing about GST filing, e-invoicing or bank feeds until those are built and checked.
 */
import { Section } from '../components/ui.jsx';
import { CellGrid, FinalCta, Node, PageHero } from './parts.jsx';

const Flow = () => (
  <div className="grid items-center gap-3 p-2 sm:grid-cols-[1fr_auto_1fr] sm:p-4">
    <div className="space-y-3">
      <Node title="Bills and returns" body="From the FlowXP till" />
      <Node title="Payments" body="Cash, UPI, card, credit" />
      <Node title="Purchases" body="Supplier bills and stock" />
    </div>
    <div className="py-2 sm:px-2"><Node strong title="FlowBook" body="Ledger, tax and statements" /></div>
    <div className="space-y-3">
      <Node title="Profit and loss" body="By day, month, branch" />
      <Node title="Balance sheet" body="Ties back to every bill" />
      <Node title="GST registers" body="Ready for your accountant" />
    </div>
  </div>
);

const WILL = [
  { title: 'A real ledger', body: 'Double-entry books where every figure leads back to the bill, payment or journal behind it.' },
  { title: 'Fed by FlowXP', body: 'Sales, returns, payments and purchases arrive on their own, once. Nothing is typed twice and nothing is counted twice.' },
  { title: 'Statements', body: 'Trial balance, profit and loss, balance sheet and cash flow, with comparisons between periods.' },
  { title: 'Receivables and payables', body: 'Who owes you and whom you owe, with ageing and statements you can send on WhatsApp.' },
  { title: 'GST registers and returns prepared', body: 'Sales and purchase registers and return figures that match the ledger, for your accountant to file.' },
  { title: 'Bank statements', body: 'Import a statement, match lines to bills and payments, and see what is left.' },
  { title: 'Controls', body: 'Lock a closed month, see who changed what, and correct mistakes with a visible reversal instead of a silent edit.' },
  { title: 'Questions in plain words', body: 'Ask why profit fell this month. Answers come from your own books and show where the figure comes from.' }
];

const NOT_YET = [
  { title: 'Direct GST filing and e-invoicing', body: 'Planned through an approved partner. We will say so here only once it works end to end.', soon: true },
  { title: 'Live bank feeds', body: 'Statement import comes first. Direct bank connections depend on partners.', soon: true },
  { title: 'Payroll filings', body: 'Not part of the first versions.', soon: true }
];

const FlowBookPage = () => (
  <>
    <PageHero
      eyebrow="In development"
      title="FlowBook: accounting that follows your billing."
      lead="FlowBook turns what you already do in FlowXP into proper books. It is being built now, with accountants, and it will also work for businesses that do not use FlowXP."
      points={['No double entry', 'Every figure traceable', 'Made with accountants']}
      visual={<Flow />}
      cta={false}
    />

    <Section title="What FlowBook will do.">
      <CellGrid items={WILL} />
    </Section>

    <Section className="border-t border-line bg-surface" title="What comes later, said plainly."
             lead="We list what is not built so you never have to guess.">
      <CellGrid items={NOT_YET} cols="sm:grid-cols-3" />
    </Section>

    <FinalCta title="Want to be among the first?" lead="Tell us about your business and your accountant. We will contact you when FlowBook is ready to try." />
  </>
);

export default FlowBookPage;
