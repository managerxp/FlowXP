/*
 * /industries/:slug: one trade in full, in a rhythm that does not repeat. Every module is a short heading, one sentence,
 * the few points that matter and the real screen, at a size that sits beside the text rather than over it. A module with
 * more than one screen shows one and lets the visitor switch with thumbnails; any screen can be enlarged to read it.
 * Layouts rotate (split, split flipped, text-over-screen) so no more than two modules in a row share a shape.
 * Content lives in content/<slug>.js. An unknown slug goes back to the hub; the old café address goes to the merged page.
 */
import { useEffect, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button, Container, Section } from '../../components/ui.jsx';
import Reveal from '../../components/Reveal.jsx';
import { Check, FinalCta, PageHero, PhoneShot, Shot, TextLink } from '../parts.jsx';
import { ALIASES, READY, UNDERNEATH } from './data.js';

/* Short names for the "on this page" bar. */
const NAV = {
  billing: 'Billing', floor: 'Tables & QR', orders: 'Orders', kitchen: 'Kitchen', menu: 'Menu', stock: 'Stock', buying: 'Buying', reservations: 'Reservations',
  regulars: 'Regulars', profit: 'Profit', forecast: 'Forecast', reports: 'Reports & GST', outlets: 'Outlets & team', ai: 'Flow AI', delivery: 'Delivery', brands: 'Brands',
  settlements: 'Payouts', recipes: 'Recipes', kitchens: 'Kitchens', fulfilment: 'Warehouse', customers: 'Customers', products: 'Products', inventory: 'Inventory',
  purchasing: 'Purchasing', money: 'Money', returns: 'Returns', rules: 'Rules & roles', field: 'Field sales', principals: 'Principals', territories: 'Territories', team: 'Team',
  schemes: 'Schemes', vans: 'Vans', base: 'Wholesale base', appointments: 'Appointments', clients: 'Clients', services: 'Services', memberships: 'Memberships',
  online: 'Online booking', receiving: 'Receiving', expiry: 'Expiry', dashboard: 'Dashboard'
};
const VISIBLE_POINTS = 4;

/* A screen enlarged over the page, to read the small print on it. Escape or a click outside closes it. */
const Zoom = ({ shot, onClose }) => {
  const close = useRef(null);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    close.current?.focus();
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; };
  }, [onClose]);
  return (
    <div role="dialog" aria-modal="true" aria-label="Screenshot, enlarged" className="fixed inset-0 z-[70] flex items-center justify-center bg-ink-900/80 p-4 sm:p-8" onClick={onClose}>
      <button ref={close} type="button" onClick={onClose} aria-label="Close" className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-surface text-ink-900 transition-transform duration-(--duration-fast) hover:scale-105 active:scale-95">
        <X aria-hidden="true" className="h-5 w-5" strokeWidth={2} />
      </button>
      <img src={shot.src} alt={shot.alt} onClick={(e) => e.stopPropagation()} className={`max-h-full rounded-(--radius-card) bg-surface shadow-lg ${shot.phone ? 'w-auto max-w-[22rem]' : 'max-w-[min(100%,1200px)]'}`} />
    </div>
  );
};

/* The screens of one module. Desktop screens: one main view with thumbnails to switch; phone screens stand beside it. */
const Visual = ({ shots }) => {
  const desk = shots.filter((s) => !s.phone);
  const phones = shots.filter((s) => s.phone);
  const [i, setI] = useState(0);
  const [zoom, setZoom] = useState(null);
  const main = desk[i];
  return (
    <div className="rounded-(--radius-panel) bg-brand-50 p-3 sm:p-5">
      <div className={`flex items-start gap-4 ${phones.length ? 'sm:gap-5' : ''}`}>
        {main && (
          <div className="min-w-0 flex-1">
            <div className="group relative">
              <Shot src={main.src} alt={main.alt} />
              <button type="button" onClick={() => setZoom(main)} aria-label="Enlarge this screenshot" className="absolute inset-0 cursor-zoom-in rounded-(--radius-card) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500" />
            </div>
            {desk.length > 1 && (
              <ul className="mt-3 flex gap-2" aria-label="Other screens">
                {desk.map((s, n) => (
                  <li key={s.src} className="w-16 sm:w-20">
                    <button type="button" onClick={() => setI(n)} aria-label={`Show screen ${n + 1} of ${desk.length}`} aria-current={n === i ? 'true' : undefined}
                            className={`block w-full overflow-hidden rounded-md border bg-surface transition-[opacity,box-shadow] duration-(--duration-fast) ${n === i ? 'border-brand-500 ring-2 ring-brand-500/25' : 'border-line opacity-70 hover:opacity-100'}`}>
                      <img src={s.src} alt="" width={1200} height={750} loading="lazy" decoding="async" className="block h-auto w-full" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {phones.length > 0 && (
          <div className={`flex gap-3 ${main ? 'w-24 shrink-0 flex-col sm:w-28' : 'mx-auto min-w-0 justify-center'}`}>
            {phones.map((s) => (
              <button key={s.src} type="button" onClick={() => setZoom(s)} aria-label="Enlarge this phone screenshot" className={`block cursor-zoom-in ${main ? '' : 'min-w-0 flex-1 max-w-[11rem]'}`}>
                <PhoneShot src={s.src} alt={s.alt} className={main ? '' : 'max-w-full'} />
              </button>
            ))}
          </div>
        )}
      </div>
      {zoom && <Zoom shot={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
};

const Points = ({ points }) => {
  const shown = points.slice(0, VISIBLE_POINTS);
  const rest = points.slice(VISIBLE_POINTS);
  return (
    <>
      <ul className="space-y-2.5">
        {shown.map((pt) => <li key={pt} className="flex gap-3 text-body text-ink-700"><Check />{pt}</li>)}
      </ul>
      {rest.length > 0 && (
        <details className="group mt-3">
          <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 text-small font-medium text-brand-600 hover:text-brand-700 [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show {rest.length} more</span>
            <span className="hidden group-open:inline">Show fewer</span>
            <ChevronDown aria-hidden="true" strokeWidth={2} className="h-4 w-4 transition-transform duration-(--duration-normal) group-open:rotate-180" />
          </summary>
          <ul className="mt-1 space-y-2.5">
            {rest.map((pt) => <li key={pt} className="flex gap-3 text-body text-ink-700"><Check />{pt}</li>)}
          </ul>
        </details>
      )}
    </>
  );
};

/* Three shapes, rotated by position: text left, text right, and text above a screen set to one side. */
const Module = ({ m, index }) => {
  const shape = index % 3; // 0 split, 1 split flipped, 2 text over screen
  const text = (
    <>
      <h3 className="text-h3 font-semibold text-ink-900">{m.title}</h3>
      <p className="mt-3 max-w-prose text-lead text-ink-500">{m.body}</p>
    </>
  );
  if (shape === 2) {
    return (
      <div id={m.id} className="scroll-mt-32">
        <Reveal className="grid gap-x-12 gap-y-6 lg:grid-cols-12">
          <div className="lg:col-span-5">{text}</div>
          <div className="lg:col-span-6 lg:col-start-7"><Points points={m.points} /></div>
        </Reveal>
        <Reveal index={1} className="mt-8 lg:ml-auto lg:w-8/12">
          <Visual shots={m.shots} />
        </Reveal>
      </div>
    );
  }
  return (
    <div id={m.id} className="grid scroll-mt-32 items-start gap-8 lg:grid-cols-12 lg:gap-12">
      <Reveal className={`lg:col-span-5 ${shape === 1 ? 'lg:order-2' : ''}`}>
        {text}
        <div className="mt-5"><Points points={m.points} /></div>
      </Reveal>
      <Reveal index={1} className={`lg:col-span-7 ${shape === 1 ? 'lg:order-1' : ''}`}>
        <Visual shots={m.shots} />
      </Reveal>
    </div>
  );
};

/* Stays under the site header while the page scrolls; marks the section being read. */
const JumpBar = ({ modules }) => {
  const [active, setActive] = useState(modules[0].id);
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return undefined;
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) seen.set(e.target.id, e.isIntersecting);
      const first = modules.find((m) => seen.get(m.id));
      if (first) setActive(first.id);
    }, { rootMargin: '-130px 0px -55% 0px' });
    modules.forEach((m) => { const el = document.getElementById(m.id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, [modules]);
  const list = useRef(null);
  const [edge, setEdge] = useState({ left: false, right: false });
  useEffect(() => {
    const el = list.current;
    if (!el) return undefined;
    const update = () => setEdge({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => { el.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [modules]);
  // keep the chip being read in view
  useEffect(() => {
    const el = list.current;
    const chipEl = el?.querySelector('[aria-current="true"]');
    if (!el || !chipEl) return;
    const r = chipEl.getBoundingClientRect(); const b = el.getBoundingClientRect();
    if (r.left < b.left || r.right > b.right) el.scrollTo({ left: el.scrollLeft + r.left - b.left - 40, behavior: 'smooth' });
  }, [active]);
  const move = (dir) => list.current?.scrollBy({ left: dir * Math.max(240, list.current.clientWidth * 0.6), behavior: 'smooth' });
  const arrow = 'absolute top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface text-ink-700 shadow-sm transition-colors duration-(--duration-fast) hover:bg-surface-2 hover:text-ink-900 active:scale-95';
  const chip = 'inline-flex min-h-9 items-center rounded-lg px-3 text-small font-medium transition-colors duration-(--duration-fast)';
  return (
    <nav aria-label="On this page" className="sticky top-16 z-40 border-b border-line bg-page/95 backdrop-blur-sm">
      <Container className="relative">
        {edge.left && <button type="button" onClick={() => move(-1)} aria-label="Scroll sections left" className={`${arrow} left-0`}><ChevronLeft aria-hidden="true" strokeWidth={2} className="h-4 w-4" /></button>}
        {edge.right && <button type="button" onClick={() => move(1)} aria-label="Scroll sections right" className={`${arrow} right-0`}><ChevronRight aria-hidden="true" strokeWidth={2} className="h-4 w-4" /></button>}
        <ul ref={list} className="-mx-2 flex gap-1 overflow-x-auto py-2 [scrollbar-width:none]">
          {modules.map((m) => (
            <li key={m.id} className="shrink-0">
              <a href={`#${m.id}`} aria-current={active === m.id ? 'true' : undefined} className={`${chip} ${active === m.id ? 'bg-brand-50 text-brand-700' : 'text-ink-500 hover:bg-surface-2 hover:text-ink-900'}`}>
                {NAV[m.id] || m.title}
              </a>
            </li>
          ))}
          <li className="shrink-0"><a href="#included" className={`${chip} text-ink-500 hover:bg-surface-2 hover:text-ink-900`}>Everything included</a></li>
          <li className="shrink-0"><a href="#faq" className={`${chip} text-ink-500 hover:bg-surface-2 hover:text-ink-900`}>Questions</a></li>
        </ul>
      </Container>
    </nav>
  );
};

const Included = ({ groups }) => (
  <Section id="included" className="border-t border-line bg-surface" title="Everything included" lead="The full list, so nothing is a surprise after you sign up.">
    <div className="grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
      {groups.map((g, i) => (
        <Reveal key={g.group} index={i % 4}>
          <h3 className="text-body font-semibold text-ink-900">{g.group}</h3>
          <ul className="mt-3 space-y-2">
            {g.items.map((it) => <li key={it} className="flex gap-2.5 text-small text-ink-700"><Check />{it}</li>)}
          </ul>
        </Reveal>
      ))}
    </div>
  </Section>
);

const Underneath = () => (
  <Section title="Underneath, the same for every business" lead="Whichever trade you choose, these come with it.">
    <dl className="grid gap-x-12 gap-y-8 sm:grid-cols-2">
      {UNDERNEATH.map(([term, text], i) => (
        <Reveal key={term} index={i % 2}>
          <dt className="text-body font-semibold text-ink-900">{term}</dt>
          <dd className="mt-1.5 text-body text-ink-500">{text}</dd>
        </Reveal>
      ))}
    </dl>
  </Section>
);

const NotYet = ({ items, trade }) => (
  <Section className="border-t border-line bg-surface" title="What is not built yet" lead={`Said plainly, so you are not guessing about ${trade}.`}>
    <ul className="grid max-w-3xl gap-4">
      {items.map((t) => (
        <Reveal as="li" key={t} className="flex gap-3 text-body text-ink-700">
          <span aria-hidden="true" className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ink-400" />{t}
        </Reveal>
      ))}
    </ul>
  </Section>
);

const Faq = ({ items }) => (
  <Section id="faq" title="Questions owners ask">
    <div className="max-w-3xl divide-y divide-line border-y border-line">
      {items.map(([q, a]) => (
        <details key={q} className="group py-1">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 text-body font-semibold text-ink-900 [&::-webkit-details-marker]:hidden">
            {q}
            <ChevronDown aria-hidden="true" strokeWidth={2} className="h-4 w-4 shrink-0 text-ink-500 transition-transform duration-(--duration-normal) group-open:rotate-180" />
          </summary>
          <p className="pb-5 pr-8 text-body text-ink-500">{a}</p>
        </details>
      ))}
    </div>
  </Section>
);

const IndustryDetail = () => {
  const { slug } = useParams();
  if (ALIASES[slug]) return <Navigate to={`/industries/${ALIASES[slug]}`} replace />;
  const industry = READY.find((i) => i.slug === slug);
  if (!industry) return <Navigate to="/industries" replace />;

  return (
    <>
      <PageHero
        title={industry.title}
        lead={industry.lede}
        points={industry.heroPoints}
        split="6-6"
        visual={<Shot src={industry.hero.src} eager alt={industry.hero.alt} />}
      >
        <>
          <Button to="/signup" size="lg">Start 7-day free trial</Button>
          <TextLink href="#included">See everything included</TextLink>
        </>
      </PageHero>

      <JumpBar modules={industry.modules} />

      <Section className="pt-10 sm:pt-14">
        <div className="space-y-16 lg:space-y-24">
          {industry.modules.map((m, i) => <Module key={m.id} m={m} index={i} />)}
        </div>
      </Section>

      <Included groups={industry.included} />
      <Underneath />
      <NotYet items={industry.notYet} trade={industry.label.toLowerCase()} />
      <Faq items={industry.faq} />

      <FinalCta title={`Set up FlowXP for ${industry.label.toLowerCase()}.`} lead="Seven days free, no card. Choose this kind of business when you sign up and these tools switch on." />
    </>
  );
};

export default IndustryDetail;
