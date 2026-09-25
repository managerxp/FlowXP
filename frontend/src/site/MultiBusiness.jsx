/*
 * Multi-business and multi-branch, combined into one section.
 *
 * The brief asks for these as two sections with near-identical structure — a
 * headline, a switcher, a list of what it switches between. Two sections that
 * say the same thing twice ("FlowXP handles more than one of X") read as
 * padding; one section demonstrating the business switcher with the branch
 * switcher nested beneath it (exactly how it works in the real app — pick a
 * business, then a branch within it) makes the relationship between the two
 * concepts obvious instead of asserting each in isolation.
 */
import { useRef, useState } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap, prefersReducedMotion } from '../animations/gsap.js';
import { revealOnScroll } from '../animations/scroll.js';
import { staggerReveal } from '../animations/reveal.js';
import { Container, Section } from '../components/ui.jsx';

const BUSINESSES = [
  { name: 'ABC Café', branches: ['All branches', 'Hyderabad', 'Banjara Hills', 'Madhapur'] },
  { name: 'ABC Gaming Arena', branches: ['All branches', 'Gachibowli'] },
  { name: 'ABC Racing', branches: ['All branches', 'Hyderabad'] },
  { name: 'ABC Retail', branches: ['All branches', 'Banjara Hills', 'Madhapur', 'Gachibowli'] }
];

const MultiBusiness = () => {
  const [businessIndex, setBusinessIndex] = useState(0);
  const [branchIndex, setBranchIndex] = useState(0);
  const panelRef = useRef(null);
  const scope = useRef(null);

  useGSAP(() => {
    revealOnScroll(scope.current, () =>
      staggerReveal(scope.current.querySelectorAll('[data-reveal]'), { each: 0.08 })
    );
  }, { scope });

  const pickBusiness = (index) => {
    if (index === businessIndex) return;
    setBranchIndex(0);
    if (prefersReducedMotion()) { setBusinessIndex(index); return; }
    gsap.to(panelRef.current, {
      opacity: 0, duration: 0.15,
      onComplete: () => {
        setBusinessIndex(index);
        gsap.fromTo(panelRef.current, { opacity: 0 }, { opacity: 1, duration: 0.3 });
      }
    });
  };

  const business = BUSINESSES[businessIndex];

  return (
    <Section className="border-y border-line">
      <div ref={scope}>
        <Container>
          <div className="mx-auto max-w-xl text-center">
            <p data-reveal className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">
              Multi-business · multi-branch
            </p>
            <h2 data-reveal className="text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">
              One account.
              <br />
              <span className="text-gradient">Every business.</span>
            </h2>
            <p data-reveal className="mt-4 text-base leading-relaxed text-ink-500">
              Run a café, a gaming arena and a retail counter from the same login. Switch
              business, then switch branch within it — the data never mixes between either.
            </p>
          </div>

          <div data-reveal className="glass mx-auto mt-10 max-w-2xl rounded-2xl p-6 sm:p-8">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Business</p>
            <div className="flex flex-wrap gap-2">
              {BUSINESSES.map((b, index) => (
                <button
                  key={b.name}
                  onClick={() => pickBusiness(index)}
                  aria-pressed={index === businessIndex}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
                    index === businessIndex ? 'bg-ink-900 text-white' : 'border border-line text-ink-500 hover:text-ink-900'
                  }`}
                >
                  {b.name}
                </button>
              ))}
            </div>

            <div ref={panelRef} className="mt-6 border-t border-line pt-6">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">
                Branch — {business.name}
              </p>
              <div className="flex flex-wrap gap-2">
                {business.branches.map((branch, index) => (
                  <button
                    key={branch}
                    onClick={() => setBranchIndex(index)}
                    aria-pressed={index === branchIndex}
                    className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                      index === branchIndex
                        ? 'bg-brand-50 text-brand-600 ring-1 ring-inset ring-brand-500/30'
                        : 'text-ink-500 hover:text-ink-900'
                    }`}
                  >
                    {branch}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Container>
      </div>
    </Section>
  );
};

export default MultiBusiness;
