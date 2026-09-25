/*
 * The digital-first billing section. A compact invoice mock next to the
 * delivery methods it can go out through — printing is shown as one option
 * among four, never positioned as the default.
 */
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { fadeUp, staggerReveal } from '../animations/reveal.js';
import { revealOnScroll } from '../animations/scroll.js';
import { Container, Section } from '../components/ui.jsx';

const SHARE_METHODS = [
  { label: 'WhatsApp', hint: 'Sent the instant you tap paid' },
  { label: 'Email', hint: 'With a PDF attached' },
  { label: 'QR code', hint: 'Customer scans, invoice opens' },
  { label: 'PDF', hint: 'Downloaded straight from the invoice' }
];

const INVOICE_ITEMS = [
  { name: 'Filter Coffee ×2', amount: '₹80' },
  { name: 'Masala Dosa ×1', amount: '₹90' }
];

const InvoiceMock = ({ scopeRef }) => (
  <div ref={scopeRef} className="glass mx-auto max-w-sm rounded-2xl p-6">
    <div className="flex items-start justify-between border-b border-line pb-4">
      <div>
        <p className="text-sm font-bold text-ink-900">Corner Café</p>
        <p className="text-xs text-ink-400">INV-1042 · Today</p>
      </div>
      <span className="rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-bold uppercase text-success">Paid</span>
    </div>

    <div className="border-b border-line py-4">
      <p className="text-xs text-ink-400">Billed to</p>
      <p className="text-sm font-medium text-ink-900">Priya Sharma</p>
    </div>

    <ul className="divide-y divide-line py-2">
      {INVOICE_ITEMS.map((item) => (
        <li key={item.name} className="flex justify-between py-2 text-sm">
          <span className="text-ink-700">{item.name}</span>
          <span className="font-medium text-ink-900">{item.amount}</span>
        </li>
      ))}
    </ul>

    <div className="space-y-1 border-t border-line pt-3 text-sm">
      <div className="flex justify-between text-ink-500"><span>Subtotal</span><span>₹170</span></div>
      <div className="flex justify-between text-ink-500"><span>GST (5%)</span><span>₹8.50</span></div>
      <div className="flex justify-between text-base font-bold text-ink-900"><span>Total</span><span>₹178.50</span></div>
    </div>
  </div>
);

const DigitalBilling = () => {
  const scope = useRef(null);
  const invoiceRef = useRef(null);
  const chipsWrapRef = useRef(null);

  useGSAP(() => {
    revealOnScroll(scope.current, () => {
      fadeUp(invoiceRef.current, { x: -16, y: 0 });
      staggerReveal(chipsWrapRef.current.querySelectorAll('[data-chip]'), { each: 0.09, delay: 0.15 });
    });
  }, { scope });

  return (
    <Section className="border-y border-line">
      <Container>
        <div ref={scope} className="grid items-center gap-14 lg:grid-cols-2">
          <InvoiceMock scopeRef={invoiceRef} />

          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">Digital-first billing</p>
            <h2 className="text-3xl font-bold leading-tight tracking-tight text-ink-900 sm:text-4xl">
              Your invoice. <span className="text-gradient">Anywhere.</span>
            </h2>
            <p className="mt-5 max-w-md text-base leading-relaxed text-ink-500">
              A printer is something you can add later, not something you need first. Every
              invoice FlowXP raises is GST-correct and ready to send the moment payment lands.
            </p>

            <div ref={chipsWrapRef} className="mt-8 grid grid-cols-2 gap-3">
              {SHARE_METHODS.map((method) => (
                <div key={method.label} data-chip className="rounded-xl border border-line bg-surface p-4">
                  <p className="text-sm font-bold text-ink-900">{method.label}</p>
                  <p className="mt-1 text-xs text-ink-500">{method.hint}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
};

export default DigitalBilling;
