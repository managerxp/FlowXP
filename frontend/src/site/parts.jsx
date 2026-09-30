/*
 * Pieces the marketing pages share: a real screen in a browser frame, an
 * arrow text link, tick and cross marks, labels, and the page building
 * blocks (hero, feature row, diagram boxes, closing band, cell grid).
 *
 * Screens come from public/product/: `pos.webp` is the whole app window
 * (1440×900), the `*-main.webp` files are the main area of a screen
 * (1200×750). Both are shown whole, never cropped.
 */
import { Link } from 'react-router-dom';
import { Button, Container, Eyebrow } from '../components/ui.jsx';
import Reveal from '../components/Reveal.jsx';

export const MAIN = { width: 1200, height: 750 };
export const FULL = { width: 1440, height: 900 };

export const Shot = ({ src, alt, size = MAIN, eager = false, className = '', style }) => (
  <figure style={style} className={`overflow-hidden rounded-(--radius-card) border border-line bg-surface shadow-lg ${className}`}>
    <div aria-hidden="true" className="flex h-7 items-center gap-1.5 border-b border-line bg-surface-2 px-3">
      <span className="h-2 w-2 rounded-full bg-line-strong" />
      <span className="h-2 w-2 rounded-full bg-line-strong" />
      <span className="h-2 w-2 rounded-full bg-line-strong" />
    </div>
    <img src={src} alt={alt} width={size.width} height={size.height}
         loading={eager ? 'eager' : 'lazy'} decoding="async" className="block h-auto w-full" />
  </figure>
);

export const TextLink = ({ to, href, children }) => {
  const Tag = href ? 'a' : Link;
  return (
    <Tag {...(href ? { href } : { to })} className="group inline-flex items-center text-body font-medium text-brand-600 hover:text-brand-700">
      {children}
      <span aria-hidden="true" className="ml-1 inline-block transition-transform duration-(--duration-normal) group-hover:translate-x-1">→</span>
    </Tag>
  );
};

export const Check = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-brand-500"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M3.5 8.5l3 3 6-7" /></svg>
);

export const Cross = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 h-4 w-4 shrink-0 text-ink-400"><path fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4.5 4.5l7 7m0-7l-7 7" /></svg>
);

export const H2 = ({ children }) => <h2 className="mt-3 text-h2 font-semibold text-ink-900">{children}</h2>;

/* The labels FlowXP puts on everything it works out, so an owner can tell a
   recorded fact from an estimate or a guess. Shared by Home and the AI page. */
export const KIND = {
  happened: ['What happened', 'bg-surface-3 text-ink-700'],
  fact: ['Fact', 'bg-surface-3 text-ink-700'],
  estimate: ['Estimate', 'bg-amber-500/10 text-warning'],
  check: ['Needs a look', 'bg-warning/10 text-warning'],
  prediction: ['Prediction', 'bg-warning/10 text-warning'],
  suggest: ['Suggested', 'bg-brand-50 text-brand-600']
};

export const Tag = ({ kind, className = '' }) => (
  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-caption font-medium ${KIND[kind][1]} ${className}`}>{KIND[kind][0]}</span>
);

/* ── Page building blocks ─────────────────────────────────────────────── */

/*
 * The top of every marketing page: eyebrow, headline, lead, actions and an
 * optional list of reassurances on the left; a real screen (or any visual)
 * on the right. Rises in once on load.
 */
export const PageHero = ({ eyebrow, title, lead, children, points, visual, cta = true }) => (
  <section className="overflow-hidden border-b border-line">
    <Container className={`grid items-center gap-12 pb-16 pt-12 sm:pt-16 lg:gap-10 lg:pt-20 ${visual ? 'lg:grid-cols-12 lg:pb-24' : 'lg:pb-20'}`}>
      <div className={visual ? 'lg:col-span-5' : 'max-w-3xl'}>
        {eyebrow && <Eyebrow className="rise">{eyebrow}</Eyebrow>}
        <h1 className="rise mt-4 text-display font-semibold text-ink-900" style={{ '--i': 1 }}>{title}</h1>
        {lead && <p className="rise mt-6 max-w-xl text-lead text-ink-500" style={{ '--i': 2 }}>{lead}</p>}
        {(cta || children) && (
          <div className="rise mt-8 flex flex-wrap items-center gap-x-6 gap-y-4" style={{ '--i': 3 }}>
            {children ?? <Button to="/signup" size="lg">Start 7-day free trial</Button>}
          </div>
        )}
        {points && (
          <ul className="rise mt-8 space-y-2 text-small text-ink-500" style={{ '--i': 4 }}>
            {points.map((t) => <li key={t} className="flex items-start gap-1.5"><Check />{t}</li>)}
          </ul>
        )}
      </div>
      {visual && (
        <div className="rise relative lg:col-span-7" style={{ '--d': '180ms' }}>
          <div className="rounded-(--radius-panel) bg-brand-50 p-3 sm:p-6">{visual}</div>
        </div>
      )}
    </Container>
  </section>
);

/* Text on one side, a real screen (or `aside`) on the other; `flip` swaps
   them so a run of rows zig-zags. */
export const FeatureRow = ({ id, tag, eyebrow, title, body, points, src, alt, aside, flip = false, children }) => (
  <div id={id} className="grid scroll-mt-24 items-center gap-10 lg:grid-cols-12 lg:gap-14">
    <Reveal className={`lg:col-span-5 ${flip ? 'lg:order-2' : ''}`}>
      {tag && <Tag kind={tag} />}
      {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
      <h3 className="mt-3 text-h3 font-semibold text-ink-900">{title}</h3>
      {body && <p className="mt-3 text-lead text-ink-500">{body}</p>}
      {points && (
        <ul className="mt-5 space-y-2.5">
          {points.map((p) => <li key={p} className="flex gap-3 text-body text-ink-700"><Check />{p}</li>)}
        </ul>
      )}
      {children}
    </Reveal>
    <Reveal index={1} className={`lg:col-span-7 ${flip ? 'lg:order-1' : ''}`}>
      {aside ?? <Shot src={src} alt={alt} />}
    </Reveal>
  </div>
);

/* Boxes and lines for the small "this goes into that" diagrams. */
export const Node = ({ title, body, strong = false }) => (
  <div className={`rounded-(--radius-card) border px-5 py-4 ${strong ? 'border-brand-500 bg-brand-500 shadow-md' : 'border-line bg-surface'}`}>
    <p className={`text-body font-semibold ${strong ? 'text-white' : 'text-ink-900'}`}>{title}</p>
    {body && <p className={`mt-1 text-small ${strong ? 'text-white/85' : 'text-ink-500'}`}>{body}</p>}
  </div>
);

export const Connector = () => (
  <div aria-hidden="true" className="flex items-center justify-center py-2 lg:px-2 lg:py-0">
    <span className="draw block h-8 w-px bg-brand-500/40 lg:h-px lg:w-10" />
  </div>
);

/* The dark closing band every page ends on. */
export const FinalCta = ({ title, lead, secondary = { to: '/contact', label: 'Talk to us' } }) => (
  <section className="bg-ink-900">
    <Container>
      <Reveal className="grid items-center gap-8 py-16 sm:py-20 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <h2 className="text-h2 font-semibold text-white">{title}</h2>
          {lead && <p className="mt-4 max-w-xl text-lead text-white/70">{lead}</p>}
        </div>
        <div className="flex flex-wrap gap-3 lg:col-span-4 lg:justify-end">
          <Button to="/signup" size="lg">Start free trial</Button>
          {secondary && <Button to={secondary.to} size="lg" variant="ghost" className="text-white hover:bg-white/10 hover:text-white">{secondary.label}</Button>}
        </div>
      </Reveal>
    </Container>
  </section>
);

/* A bordered grid of small titled cells (hardware lists, "also included"). */
export const CellGrid = ({ items, cols = 'sm:grid-cols-2 lg:grid-cols-4' }) => (
  <ul className={`grid gap-px overflow-hidden rounded-(--radius-panel) border border-line bg-line ${cols}`}>
    {items.map(({ title, body, soon }, i) => (
      <Reveal as="li" key={title} index={i % 4} className="bg-surface p-5 transition-colors duration-(--duration-normal) hover:bg-brand-50">
        <p className="flex flex-wrap items-center gap-2 text-body font-semibold text-ink-900">
          {title}
          {soon && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-medium text-ink-500">Coming soon</span>}
        </p>
        {body && <p className="mt-1 text-small text-ink-500">{body}</p>}
      </Reveal>
    ))}
  </ul>
);
