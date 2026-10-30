/*
 * /guide — first-time set-up in plain steps, and how to bring your items across from Tally, Vyapar, Busy, Marg, Zoho or a spreadsheet.
 * Facts here are what the app does today: the product and stock imports (retail, supermarket and spare parts shops) read CSV or Excel and
 * recognise those tools' usual column names; wholesale also imports customers and suppliers (with opening balance). Old bills, ledgers
 * and vouchers are NOT imported, and there is no direct Tally data-file reader — said plainly below.
 */
import { Section } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';
import { CellGrid, FinalCta, PageHero } from './parts.jsx';

const STEPS = [
  ['Start your free trial', 'Sign up and choose your kind of business, for example Auto spare parts, Supermarket or Wholesale. The right screens switch on. There is no card and no hardware to buy.'],
  ['Fill in your business', 'Settings → Business: your shop name, address, state and GSTIN, and the prefix for your bill numbers. The state decides CGST and SGST or IGST on every bill.'],
  ['Add your products', 'Type them in, or bring a spreadsheet: Stock center → Import. A few hundred items take a few minutes. FlowXP checks every row first and tells you which row to fix. Nothing is saved until the whole file is good.'],
  ['Put in the stock you have', 'Put the quantity in the same file as "Opening stock", or use the Stock levels import later. For a parts shop, put each part in a rack or bin afterwards, or leave it for later.'],
  ['Add customers and suppliers', 'They are added as you bill and buy. Import them from a file on the Customers screen (name, phone, GSTIN, address, credit limit). Wholesale and distributor shops can also import suppliers, with opening balances.'],
  ['Add your people', 'Give the counter, the storekeeper and the manager their own login, with only the screens they need. A workshop can also keep staff attendance and payroll here.'],
  ['Connect a printer, if you want paper', 'Bills can be shared as a link. If you want paper, any 58 or 80 mm receipt printer works through the browser.'],
  ['Make your first bill', 'Open the till, search or scan a part, take the payment, done. Make one test bill and cancel it if you like.'],
  ['Download a backup', 'Settings → Business → Backup. Keep the file safe. It can be put back later and only adds what is missing.']
];

const SOURCES = [
  { title: 'Tally', body: 'Export your stock items or Stock Summary report to Excel, then choose that file in FlowXP. Name, rate, HSN/SAC and closing balance are recognised.' },
  { title: 'Vyapar', body: 'Export your item list to Excel. Item name, item code, sale price, purchase price, tax rate, HSN, current stock quantity and minimum stock quantity are recognised.' },
  { title: 'Busy', body: 'Export the item master to Excel. Item name, print name, item code, sale and purchase price, HSN code and opening balance are recognised.' },
  { title: 'Marg', body: 'Export your product or stock list to Excel or CSV. Product name, company, MRP, rate, batch, expiry and stock are recognised.' },
  { title: 'Zoho Books and Inventory', body: 'Export your items as CSV. Item name, SKU, rate, purchase rate, HSN/SAC, tax percentage, opening stock and reorder level are recognised.' },
  { title: 'Excel or Google Sheets', body: 'Download the FlowXP sample file from the import screen and fill it in, or use your own columns. Columns FlowXP does not know are listed and ignored.' }
];

const COMES = [
  { title: 'Products', body: 'Name, part or item code, barcode, category, brand, unit, MRP, selling and purchase price, GST rate, HSN, minimum stock, other names.' },
  { title: 'Opening stock', body: 'As a column in the products file, or as a separate stock levels file. Set what is on the shelf, or add a delivery.' },
  { title: 'Customers', body: 'Name, phone, email, GSTIN, address, state, pincode and credit limit. People already here are skipped. What a customer owes is not imported. Wholesale shops can also bring suppliers and opening balances.' },
  { title: 'Safe to repeat', body: 'Add new products only, or add new and update the ones you already have. A barcode that belongs to another product is refused, never taken over.' }
];

const NOT = [
  'Old bills, vouchers, ledgers and reports are not imported. Keep your old software\'s export for your records and your accountant.',
  'A Tally data folder or backup file cannot be read directly. Export to Excel first.',
  'What your customers owe you today is not imported, because it is worked out from their unpaid bills. Make one bill per customer for the opening amount, or tell us and we will guide you.',
  'Vehicle fitment for spare parts is not in these tools. Add it in FlowXP or import a vehicle list.'
];

const Steps = () => (
  <Section title="Set up in one afternoon."
           lead="Nine small steps, in this order. You can bill after step three. The rest can wait for a quiet hour.">
    <ol className="grid gap-px overflow-hidden rounded-(--radius-panel) border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
      {STEPS.map(([title, body], i) => (
        <Reveal as="li" key={title} index={i % 3} className="bg-surface p-6">
          <p className="text-small font-semibold text-brand-600">Step {i + 1}</p>
          <p className="mt-1 text-title font-semibold text-ink-900">{title}</p>
          <p className="mt-2 text-body text-ink-500">{body}</p>
        </Reveal>
      ))}
    </ol>
  </Section>
);

const GuidePage = () => (
  <>
    <PageHero
      title="Your first day with FlowXP."
      lead="A plain guide to setting up, and to bringing your items across from Tally, Vyapar, Busy, Marg, Zoho or a spreadsheet."
      points={['No hardware to buy', 'Your file is checked before anything is saved', '7-day free trial, no card']}
    />

    <Steps />

    <Section id="import" className="border-y border-line bg-surface" title="Bring your data from Tally or another tool."
             lead="Export your items to Excel or CSV from the tool you use now. In FlowXP, choose Stock center → Import and pick the file. The usual column names are recognised, so you rarely need to rename anything.">
      <CellGrid items={SOURCES} cols="sm:grid-cols-2 lg:grid-cols-3" />
    </Section>

    <Section title="What comes across, and what does not.">
      <CellGrid items={COMES} />
      <ul className="mt-8 max-w-3xl list-disc space-y-2 pl-5 text-body text-ink-500">
        {NOT.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </Section>

    <FinalCta title="Want us to check your file first?" lead="Send us the export from your old software. We will tell you straight what will import and what will not." />
  </>
);

export default GuidePage;
