/*
 * Flow AI, as a conversation rather than a feature list — the brief is
 * explicit that this should read as a business intelligence tool, not a
 * generic chatbot demo. Each exchange reveals as its own step scrolls into
 * view, so reading down the page mirrors actually asking the questions.
 */
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { fadeUp } from '../animations/reveal.js';
import { revealOnScroll } from '../animations/scroll.js';
import { Container, Section } from '../components/ui.jsx';

const EXCHANGES = [
  { q: 'How much did I sell today?', a: 'Today’s sales are ₹48,250, up 12.4% from yesterday.' },
  { q: 'What should I reorder?', a: '12 products are below your minimum stock level.' },
  { q: 'Who owes me money?', a: 'You have ₹18,450 in outstanding customer payments.' }
];

const Bubble = ({ children, role, forwardRef }) => (
  <div ref={forwardRef} className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'}`}>
    <div
      className={
        `max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed sm:max-w-[70%] ` +
        (role === 'user'
          ? 'rounded-br-sm bg-surface-3 text-ink-900'
          : 'bg-gradient-brand rounded-bl-sm text-white shadow-[0_10px_24px_-14px] shadow-brand-500/70')
      }
    >
      {children}
    </div>
  </div>
);

const AISection = () => {
  const scope = useRef(null);
  const bubbleRefs = useRef([]);

  useGSAP(() => {
    const nodes = bubbleRefs.current.filter(Boolean);
    // `stagger` is fadeUp's real per-target delay (passed straight through to
    // gsap.from); an earlier `each: 0.12` alongside it wasn't a real gsap
    // property at all and just warned "Invalid property each" on every load.
    revealOnScroll(scope.current, () => fadeUp(nodes, { stagger: 0.16 }));
  }, { scope });

  return (
    <Section id="ai" className="border-y border-line">
      <Container>
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-brand-600">Flow AI</p>
            <h2 className="text-3xl font-bold leading-tight tracking-tight text-ink-900 sm:text-4xl">
              Your business.
              <br />
              <span className="text-gradient">Understood.</span>
            </h2>
            <p className="mt-5 max-w-md text-base leading-relaxed text-ink-500">
              Ask in plain English. Every answer is computed from your own sales, stock and
              payment records first — Flow AI only writes the sentence, it never invents
              the number.
            </p>
            <ul className="mt-7 space-y-2.5 text-sm text-ink-700">
              {['Never sees another business’s data', 'Composes prose from numbers already computed by the database', 'Says plainly when it does not know, rather than guessing'].map((line) => (
                <li key={line} className="flex gap-2.5">
                  <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div ref={scope} className="glass rounded-2xl p-5 sm:p-6">
            <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-400">
              <span className="text-gradient text-sm">✦</span> Flow AI
            </div>
            <div className="space-y-3">
              {EXCHANGES.map((ex, i) => (
                <div key={ex.q} className="space-y-3">
                  <Bubble role="user" forwardRef={(el) => { bubbleRefs.current[i * 2] = el; }}>
                    {ex.q}
                  </Bubble>
                  <Bubble role="ai" forwardRef={(el) => { bubbleRefs.current[i * 2 + 1] = el; }}>
                    {ex.a}
                  </Bubble>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
};

export default AISection;
