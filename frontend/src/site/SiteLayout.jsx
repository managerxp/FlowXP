/*
 * The public site's frame: header, footer, and the outlet between them.
 *
 * A full-width bar with a hairline border, not a floating pill: the site
 * should read as a software company's site, and the header's only jobs are
 * "where am I", "where can I go" and "start". It turns solid once the page
 * scrolls so content never shows through it.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ArrowRight, ChevronDown, Coffee, CookingPot, Pill, Scissors, Store, Truck, UtensilsCrossed, Warehouse } from 'lucide-react';
import { Button, Container, Logo } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { READY } from './industries/data.js';
import { useSeo } from './seo.js';
import AskFlowXP from './AskFlowXP.jsx';
import CookieNotice from './CookieNotice.jsx';

/* Everything but Industries is a plain link; Industries opens a menu of
   the built verticals instead (see IndustriesMenu), so it is handled
   separately in both the desktop nav and the mobile panel below. */
const NAV = [
  { to: '/features', label: 'Product' },
  { to: '/ai', label: 'AI Manager' },
  { to: '/integrations', label: 'Integrations' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/about', label: 'About' }
];

/* The logo goes home, and when you are already on the home page it scrolls back to the top (a link to the page you are
   on does nothing by itself). The header's and the footer's logo are both this. */
const HomeLink = ({ className = '', children }) => {
  const { pathname } = useLocation();
  return (
    <Link to="/" aria-label="FlowXP home" className={className}
          onClick={() => { if (pathname === '/') window.scrollTo({ top: 0, behavior: 'smooth' }); }}>{children}</Link>
  );
};

const Chevron = ({ open }) => (
  <ChevronDown aria-hidden="true" strokeWidth={2} className={`h-3.5 w-3.5 transition-transform duration-(--duration-normal) ${open ? 'rotate-180' : ''}`} />
);

/* One look for every top-level item. The whole padded box is the target (40px tall, 14px either side), not just
   the word, and the current page is marked by a line under it as well as by weight. */
const itemClass = (active, open = false) =>
  `relative inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-lg px-3.5 text-[15px] font-medium transition-colors duration-(--duration-fast) ` +
  `after:absolute after:inset-x-3.5 after:bottom-1 after:h-0.5 after:rounded-full after:bg-brand-500 after:transition-opacity after:duration-(--duration-fast) ` +
  `${active ? 'text-ink-900 after:opacity-100' : 'text-ink-500 after:opacity-0 hover:bg-surface-2 hover:text-ink-900'} ${open ? 'bg-surface-2 text-ink-900' : ''}`;

const ICONS = { restaurant: UtensilsCrossed, cafe: Coffee, 'cloud-kitchen': CookingPot, wholesale: Warehouse, distributor: Truck, salon: Scissors, pharmacy: Pill };
const IconTile = ({ slug, className = '' }) => {
  const Icon = ICONS[slug] || Store;
  return <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 ${className}`}><Icon aria-hidden="true" className="h-[18px] w-[18px]" strokeWidth={1.75} /></span>;
};

/* Desktop: opens on hover (mouse only, with a short grace so a diagonal move to the panel does not close it), on
   click or Enter/Space, and closes on Escape, an outside click, focus leaving, or a route change. The panel hangs
   inside the same wrapper as the button with a padded top, so there is no dead gap to fall through. */
const IndustriesMenu = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const timer = useRef(null);
  const pinned = useRef(false);   // opened by a click: stays until Escape, an outside click or a second click
  const location = useLocation();
  const active = location.pathname.startsWith('/industries');

  const show = () => { clearTimeout(timer.current); setOpen(true); };
  const hide = (delay = 140) => { clearTimeout(timer.current); if (!pinned.current) timer.current = setTimeout(() => setOpen(false), delay); };
  const close = () => { pinned.current = false; setOpen(false); };
  const toggle = () => { clearTimeout(timer.current); if (open && pinned.current) close(); else { pinned.current = true; setOpen(true); } };
  const mouse = (fn) => (e) => { if (e.pointerType === 'mouse') fn(); };

  useEffect(() => { clearTimeout(timer.current); pinned.current = false; setOpen(false); }, [location.pathname]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return undefined;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { close(); ref.current?.querySelector('button')?.focus(); } };
    document.addEventListener('pointerdown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative"
      onPointerEnter={mouse(show)}
      onPointerLeave={mouse(() => hide())}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) { pinned.current = false; hide(0); } }}
    >
      <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="true" aria-controls="industries-panel" className={itemClass(active, open)}>
        Industries
        <Chevron open={open} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 pt-2">
          <div id="industries-panel" className="menu-panel w-[38rem] rounded-(--radius-panel) border border-line bg-surface p-2 shadow-lg">
            <ul className="grid grid-cols-2 gap-1">
              {READY.map((k) => (
                <li key={k.slug}>
                  <Link to={`/industries/${k.slug}`} className="group flex h-full gap-3 rounded-xl p-3 transition-colors duration-(--duration-fast) hover:bg-surface-2 focus-visible:bg-surface-2">
                    <IconTile slug={k.slug} />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink-900">{k.label}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-ink-500">{k.blurb}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-1 flex items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-2.5 text-sm">
              <span className="text-ink-500">Built for these trades</span>
              <Link to="/industries" className="inline-flex items-center gap-1.5 font-semibold text-brand-600 transition-colors hover:text-brand-700">All industries<ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const FOOTER_GROUPS = [
  { heading: 'Product', links: [
    { to: '/features', label: 'Features' },
    { to: '/industries', label: 'Who it is for' },
    { to: '/ai', label: 'AI Manager' },
    { to: '/integrations', label: 'Integrations' },
    { to: '/pricing', label: 'Pricing' }
  ]},
  { heading: 'Company', links: [
    { to: '/about', label: 'About ManagerXP' },
    { to: '/contact', label: 'Contact' }
  ]},
  { heading: 'Get started', links: [
    { to: '/signup', label: 'Start free trial' },
    { to: '/login', label: 'Log in' }
  ]},
  { heading: 'Legal', links: [
    { to: '/privacy', label: 'Privacy' },
    { to: '/delete-account', label: 'Delete your account' },
    { to: '/terms', label: 'Terms' },
    { to: '/cookies', label: 'Cookies' }
  ]}
];

const MenuGlyph = ({ open }) => (
  <span className="relative block h-3 w-4">
    <span className={`absolute left-0 right-0 h-[1.5px] bg-current transition-all duration-200 ${open ? 'top-1/2 -translate-y-1/2 rotate-45' : 'top-0'}`} />
    <span className={`absolute left-0 right-0 top-1/2 h-[1.5px] -translate-y-1/2 bg-current transition-opacity duration-150 ${open ? 'opacity-0' : 'opacity-100'}`} />
    <span className={`absolute left-0 right-0 h-[1.5px] bg-current transition-all duration-200 ${open ? 'top-1/2 -translate-y-1/2 -rotate-45' : 'bottom-0'}`} />
  </span>
);

const mobileItem = (active) => `flex min-h-12 items-center border-b border-line text-base font-medium ${active ? 'text-ink-900' : 'text-ink-700'}`;

const Header = () => {
  const [open, setOpen] = useState(false);
  const [industries, setIndustries] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { user } = useAuth();
  const location = useLocation();

  useEffect(() => { setOpen(false); setIndustries(false); }, [location.pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`sticky top-0 z-50 border-b transition-colors duration-200 ${scrolled || open ? 'border-line bg-page/95 backdrop-blur-sm' : 'border-transparent bg-page'}`}>
      <Container className="flex h-16 items-center justify-between gap-6">
        <HomeLink className="shrink-0"><Logo /></HomeLink>

        <nav aria-label="Main" className="hidden flex-1 items-center gap-0.5 lg:flex">
          <NavLink to="/features" className={({ isActive }) => itemClass(isActive)}>Product</NavLink>
          <IndustriesMenu />
          {NAV.slice(1).map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => itemClass(isActive)}>{item.label}</NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          {user ? (
            <Button to="/app" size="sm">Open FlowXP</Button>
          ) : (
            <>
              <Button to="/login" variant="ghost" size="sm">Log in</Button>
              <Button to="/signup" size="sm">Start free trial</Button>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="site-menu"
          aria-label={open ? 'Close menu' : 'Open menu'}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-ink-700 hover:bg-surface-2 lg:hidden"
        >
          <MenuGlyph open={open} />
        </button>
      </Container>

      {open && (
        <div id="site-menu" className="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-line bg-page lg:hidden">
          <Container className="flex flex-col py-2">
            <NavLink to="/features" className={({ isActive }) => mobileItem(isActive)}>Product</NavLink>
            <div className="border-b border-line">
              <button type="button" onClick={() => setIndustries((v) => !v)} aria-expanded={industries} aria-controls="site-menu-industries" className={`${mobileItem(location.pathname.startsWith('/industries'))} w-full justify-between border-b-0`}>
                Industries <Chevron open={industries} />
              </button>
              {industries && (
                <ul id="site-menu-industries" className="grid grid-cols-1 gap-1 pb-3 sm:grid-cols-2">
                  {READY.map((k) => (
                    <li key={k.slug}>
                      <Link to={`/industries/${k.slug}`} className="flex min-h-12 items-center gap-3 rounded-xl px-2 py-1.5 active:bg-surface-2">
                        <IconTile slug={k.slug} />
                        <span className="text-[15px] font-medium text-ink-900">{k.label}</span>
                      </Link>
                    </li>
                  ))}
                  <li className="sm:col-span-2"><Link to="/industries" className="flex min-h-12 items-center justify-between rounded-xl px-2 text-[15px] font-semibold text-brand-600">All industries<ArrowRight aria-hidden="true" className="h-4 w-4" /></Link></li>
                </ul>
              )}
            </div>
            {NAV.slice(1).map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => mobileItem(isActive)}>{item.label}</NavLink>
            ))}
            <div className="mt-3 flex gap-2 pb-3">
              {user ? (
                <Button to="/app" className="min-h-11 flex-1">Open FlowXP</Button>
              ) : (
                <>
                  <Button to="/login" variant="secondary" className="min-h-11 flex-1">Log in</Button>
                  <Button to="/signup" className="min-h-11 flex-1">Start free trial</Button>
                </>
              )}
            </div>
          </Container>
        </div>
      )}
    </header>
  );
};

const Footer = () => (
  <footer className="site-footer mx-2 rounded-t-[2rem] bg-brand-50 sm:mx-3">
    <Container className="py-14">
      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <HomeLink className="inline-block"><Logo showTagline /></HomeLink>
          <p className="mt-5 max-w-xs text-sm leading-relaxed text-ink-500">
            FlowXP is made by ManagerXP, the team behind the counters and back offices of businesses across India.
          </p>
        </div>

        {FOOTER_GROUPS.map((group) => (
          <div key={group.heading}>
            <h3 className="mb-3 text-sm font-medium text-ink-900">{group.heading}</h3>
            <ul className="space-y-2.5">
              {group.links.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="group relative inline-block text-sm text-ink-500 transition-colors duration-(--duration-fast) hover:text-ink-900">
                    {link.label}
                    <span aria-hidden="true" className="absolute -bottom-0.5 left-0 h-px w-0 bg-current transition-[width] duration-(--duration-normal) ease-(--ease-standard) group-hover:w-full" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-12 flex flex-col gap-2 border-t border-brand-100 pt-6 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} ManagerXP. All rights reserved.</p>
        <p>Made in India for Indian businesses. Prices in ₹, GST built in.</p>
      </div>
    </Container>
  </footer>
);

const SiteLayout = () => {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  useSeo();

  return (
    <div className="flex min-h-full flex-col bg-page">
      <Header />
      <main className="flex-1"><Outlet /></main>
      <Footer />
      <AskFlowXP />
      <CookieNotice />
    </div>
  );
};

export default SiteLayout;
