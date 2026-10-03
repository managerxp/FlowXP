/*
 * /integrations — what FlowXP connects to today, and what is coming. Delivery
 * platforms exist only as mock adapters in the code, so they are listed as
 * coming soon; payment is recorded, not collected through a gateway.
 */
import { Section } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';
import { CellGrid, FinalCta, Node, PageHero } from './parts.jsx';

/* The hero's picture: FlowXP in the middle, what it talks to around it. */
const Hub = () => (
  <div className="grid items-center gap-3 p-2 sm:grid-cols-[1fr_auto_1fr] sm:p-4">
    <div className="space-y-3">
      <Node title="Receipt printer" body="58 / 80 mm" />
      <Node title="Barcode scanner" body="USB or Bluetooth" />
      <Node title="Cash drawer" body="Opens on cash bills" />
    </div>
    <div className="py-2 sm:px-2"><Node strong title="FlowXP" body="Your bills, stock and GST" /></div>
    <div className="space-y-3">
      <Node title="WhatsApp and SMS" body="Bills, offers, bookings" />
      <Node title="GST portal" body="GSTR-1, e-invoice, e-way" />
      <Node title="Your accountant" body="CSV exports" />
    </div>
  </div>
);

const HARDWARE = [
  { title: 'Receipt printers', body: 'Any 58 or 80 mm printer through the browser. Kitchen tickets can print on their own.' },
  { title: 'Silent printing', body: 'With the small FlowXP print agent, bills print without the print dialog.' },
  { title: 'Cash drawer', body: 'Opens automatically when a cash bill prints through the agent.' },
  { title: 'Barcode scanners', body: 'Any scanner that types into a box. No driver, no setup.' }
];

const CONNECTED = [
  { title: 'WhatsApp', body: 'Bill links, booking confirmations and offers through the WhatsApp Business platform, the channel most of your customers already read.', big: true },
  { title: 'SMS', body: 'The same messages by text, for customers not on WhatsApp.' },
  { title: 'Email', body: 'Purchase orders to suppliers, password resets and sign-in alerts.' },
  { title: 'GST portal', body: 'GSTR-1 JSON to upload, e-invoice and e-way bill files, IRN recorded back.' },
  { title: 'CSV export', body: 'Reports and the GST register for your accountant or spreadsheet.' },
  { title: 'Phone and tablet', body: 'Install FlowXP from the browser; billing keeps working offline.' },
  { title: 'Payments', body: 'Record cash, UPI, card, bank transfer and credit on every bill.' },
  { title: 'Photo menu import', body: 'Read items and prices from a photo of your menu or rate card.' }
];

const COMING = [
  { title: 'Zomato and Swiggy', body: 'Online orders arrive straight into the kitchen and the day\'s bills, no re-typing.', soon: true, big: true },
  { title: 'ONDC and Magicpin', body: 'More order channels on the same screen.', soon: true },
  { title: 'Payment links and QR', body: 'Collect UPI and card payments inside FlowXP.', soon: true }
];

const STEPS = [
  ['Install the print agent', 'A small program on the counter computer. It only talks to FlowXP.'],
  ['Pick your printer', 'Choose the printer, the paper width, and whether the cash drawer should open.'],
  ['Bill as usual', 'Bills and kitchen tickets print straight away. If the agent is off, the normal print window opens instead.']
];

const PrintSteps = () => (
  <Section className="border-y border-line bg-surface"  title="Paper when you want it, never required."
           lead="Most businesses send the bill on WhatsApp. If you want paper, any receipt printer works through the browser, and the print agent makes it instant.">
    <ol className="grid gap-px overflow-hidden rounded-(--radius-panel) border border-line bg-line sm:grid-cols-3">
      {STEPS.map(([title, body], i) => (
        <Reveal as="li" key={title} index={i} className="bg-surface p-6">
          <p className="text-title font-semibold text-ink-900">{title}</p>
          <p className="mt-2 text-body text-ink-500">{body}</p>
        </Reveal>
      ))}
    </ol>
  </Section>
);

const IntegrationsPage = () => (
  <>
    <PageHero
      title="Works with what is already on your counter."
      lead="FlowXP works on its own from the first day. Add a printer, a scanner, WhatsApp or your accountant's files when you want them. None of them are needed to start billing."
      points={['No special hardware to buy', 'Nothing breaks if a device is unplugged', 'Your data can always be exported']}
      visual={<Hub />}
    />

    <Section  title="Printers, scanners and cash drawers.">
      <CellGrid items={HARDWARE} />
    </Section>

    <PrintSteps />

    <Section  title="Messages, GST and your accountant.">
      <CellGrid items={CONNECTED} />
    </Section>

    <Section className="border-t border-line bg-surface"  title="Online orders and payment collection."
             lead="These are being built. They will appear here, and in your account, when they are ready to use.">
      <CellGrid items={COMING} />
    </Section>

    <FinalCta title="Using something we have not listed?" lead="Tell us what your counter runs on. If FlowXP does not connect to it yet, we will tell you straight." />
  </>
);

export default IntegrationsPage;
