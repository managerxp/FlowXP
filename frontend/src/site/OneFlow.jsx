/*
 * "One Flow" — the section the brief asks to make the strongest on the page.
 *
 * Deliberately NOT a pinned/scrubbed section (gsap.timeline + ScrollTrigger
 * pin across seven steps is the classic way to break a page on a short
 * viewport — pin-spacing miscalculates, and the section either leaves a gap
 * or clips the next one). Instead: a normal-flow vertical timeline where a
 * connecting line fills in sync with scroll (scrubbed, not pinned) and each
 * step lights up as it crosses a fixed point on screen. Same read — "this is
 * one continuous flow, not seven separate features" — without the fragility.
 */
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap, ScrollTrigger, prefersReducedMotion } from '../animations/gsap.js';
import { Container, Section } from '../components/ui.jsx';

const STEPS = [
  { key: 'SALE',      title: 'Sale',      body: 'A customer orders. FlowXP already knows what is in stock.' },
  { key: 'BILL',      title: 'Bill',      body: 'One tap turns the order into a GST-correct invoice.' },
  { key: 'PAYMENT',   title: 'Payment',   body: 'Cash, UPI, card or split — recorded the instant it lands.' },
  { key: 'INVENTORY', title: 'Inventory', body: 'Stock decrements itself. No second entry, ever.' },
  { key: 'GST',       title: 'GST',       body: 'CGST, SGST or IGST worked out per line, every time.' },
  { key: 'REPORT',    title: 'Report',    body: 'Today’s numbers, ready before you ask for them.' },
  { key: 'AI',        title: 'AI',        body: 'Ask a plain-English question. Get an answer from your own data.' }
];

const OneFlow = () => {
  const containerRef = useRef(null);
  const lineFillRef = useRef(null);
  const stepRefs = useRef([]);

  useGSAP(() => {
    const steps = stepRefs.current.filter(Boolean);

    if (prefersReducedMotion()) {
      gsap.set(lineFillRef.current, { height: '100%' });
      steps.forEach((el) => el.classList.add('is-active'));
      return;
    }

    gsap.set(lineFillRef.current, { height: '0%' });
    gsap.to(lineFillRef.current, {
      height: '100%',
      ease: 'none',
      scrollTrigger: {
        trigger: containerRef.current,
        start: 'top 68%',
        end: 'bottom 45%',
        scrub: 0.4
      }
    });

    const triggers = steps.map((el) =>
      ScrollTrigger.create({
        trigger: el,
        start: 'top 64%',
        end: 'bottom 64%',
        toggleClass: { targets: el, className: 'is-active' }
      })
    );

    return () => triggers.forEach((t) => t.kill());
  }, { scope: containerRef });

  return (
    <Section
      className="border-y border-line"
      eyebrow="One flow"
      title="Everything is connected."
      lead="A sale is never just a sale. It is stock moving, tax being worked out, a report writing itself, and an answer Flow AI already has ready."
    >
      <Container className="max-w-2xl">
        <div ref={containerRef} className="relative">
          {/* Track + scrubbed fill. Both absolutely positioned against the
              same left offset as the step dots, so the line always runs
              exactly through their centres regardless of card height. */}
          <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-line sm:left-[19px]" aria-hidden="true">
            <div ref={lineFillRef} className="bg-gradient-brand w-full" />
          </div>

          <ol className="space-y-8">
            {STEPS.map((step, index) => (
              <li
                key={step.key}
                ref={(el) => { stepRefs.current[index] = el; }}
                className="group relative flex items-start gap-5 pl-0"
              >
                <span
                  className={
                    `relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ` +
                    `border-2 border-line bg-surface text-[11px] font-bold text-ink-400 ` +
                    `transition-colors duration-300 sm:h-10 sm:w-10 ` +
                    `group-[.is-active]:border-brand-500 group-[.is-active]:bg-brand-500 group-[.is-active]:text-white`
                  }
                >
                  {index + 1}
                </span>

                <div
                  className={
                    `flex-1 rounded-xl border border-line bg-surface p-4 transition-all duration-300 ` +
                    `group-[.is-active]:border-brand-500/40 group-[.is-active]:shadow-[0_8px_24px_-16px] group-[.is-active]:shadow-brand-500/60`
                  }
                >
                  <p
                    className={
                      `text-xs font-bold uppercase tracking-[0.14em] transition-colors duration-300 ` +
                      `text-ink-400 group-[.is-active]:text-brand-600`
                    }
                  >
                    {step.title}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-ink-500">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Container>
    </Section>
  );
};

export default OneFlow;
