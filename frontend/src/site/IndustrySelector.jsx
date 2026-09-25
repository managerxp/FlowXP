/*
 * The interactive industry selector.
 *
 * A <button> tab list plus one content panel, crossfaded with GSAP on
 * change — never a page reload or a route change, since switching industries
 * is exploring one page's content, not navigating to a different one.
 */
import { useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap, prefersReducedMotion } from '../animations/gsap.js';
import { revealOnScroll } from '../animations/scroll.js';
import { staggerReveal } from '../animations/reveal.js';
import { INDUSTRY_MODULES } from './content.js';
import { GlowCard } from '../components/BorderGlow.jsx';

const IndustrySelector = () => {
  const [active, setActive] = useState(0);
  const panelRef = useRef(null);
  const wrapRef = useRef(null);

  useGSAP(() => {
    revealOnScroll(wrapRef.current, () =>
      staggerReveal(wrapRef.current.querySelectorAll('[data-reveal]'), { each: 0.08 })
    );
  }, { scope: wrapRef });

  const select = (index) => {
    if (index === active) return;

    if (prefersReducedMotion()) {
      setActive(index);
      return;
    }

    /* Fade the current panel out, swap the data underneath while it's
       invisible, fade the new one in — a crossfade without ever animating
       two different DOM trees against each other. */
    gsap.to(panelRef.current, {
      opacity: 0, y: 8, duration: 0.18, ease: 'power2.in',
      onComplete: () => {
        setActive(index);
        gsap.fromTo(panelRef.current, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.32, ease: 'power2.out' });
      }
    });
  };

  const current = INDUSTRY_MODULES[active];

  return (
    <div ref={wrapRef}>
      <div data-reveal className="mb-8 flex flex-wrap justify-center gap-2" role="tablist" aria-label="Choose an industry">
        {INDUSTRY_MODULES.map((industry, index) => (
          <button
            key={industry.name}
            role="tab"
            aria-selected={index === active}
            onClick={() => select(index)}
            className={
              `rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                index === active
                  ? 'bg-ink-900 text-white'
                  : 'border border-line bg-surface text-ink-500 hover:border-line-strong hover:text-ink-900'
              }`
            }
          >
            {industry.name}
          </button>
        ))}
      </div>

      {/* ref lives on this inner div, not GlowCard itself — the click-driven
          crossfade below (gsap.to(panelRef.current, ...)) needs a real DOM
          node, and GlowCard is a plain function component with no ref
          forwarding of its own. data-reveal stays reachable on GlowCard's own
          root via its {...rest} passthrough (a plain attribute, not a ref),
          so the scroll-triggered entrance animation still finds it fine. */}
      <GlowCard data-reveal outerClassName="mx-auto max-w-2xl" className="text-center" padding="p-8">
        <div ref={panelRef}>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">{current.name}</p>
          <p className="mt-3 text-sm text-ink-500">What FlowXP puts in front of you first:</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2.5">
            {current.modules.map((module) => (
              <span
                key={module}
                className="rounded-full border border-line bg-surface-2 px-3.5 py-1.5 text-sm font-medium text-ink-900"
              >
                {module}
              </span>
            ))}
          </div>
        </div>
      </GlowCard>
    </div>
  );
};

export default IndustrySelector;
