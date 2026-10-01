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
import { Button, Container, Logo } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { READY } from './industries/data.js';

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

const Chevron = ({ open }) => (
  <svg aria-hidden="true" viewBox="0 0 12 12" className={`h-3 w-3 transition-transform duration-(--duration-fast) ${open ? 'rotate-180' : ''}`}>
    <path fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" d="M3 4.5l3 3 3-3" />
  </svg>
);

/* Desktop-only: a button that opens a panel listing every built vertical,
   plus the hub and the coming-soon page. Closes on an outside click, Escape
   or route change. */
const IndustriesMenu = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const location = useLocation();
  const active = location.pathname.startsWith('/industries');

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`flex items-center gap-1 rounded-md px-3 py-2 text-sm transition-colors ${active ? 'font-medium text-ink-900' : 'text-ink-500 hover:text-ink-900'}`}
      >
        Industries
        <Chevron open={open} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-2 w-72 rounded-(--radius-card) border border-line bg-page p-2 shadow-lg">
          <Link to="/industries" className="block rounded-md px-3 py-2 text-sm font-medium text-ink-900 hover:bg-surface-2">All industries</Link>
          <div className="my-1 border-t border-line" />
          {READY.map((k) => (
            <Link key={k.slug} to={`/industries/${k.slug}`} className="block rounded-md px-3 py-2 text-sm text-ink-700 hover:bg-surface-2">{k.label}</Link>
          ))}
          <div className="my-1 border-t border-line" />
          <Link to="/industries/coming-soon" className="block rounded-md px-3 py-2 text-sm text-ink-500 hover:bg-surface-2">Coming soon</Link>
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
    { to: '/terms', label: 'Terms' }
  ]}
];

const MenuGlyph = ({ open }) => (
  <span className="relative block h-3 w-4">
    <span className={`absolute left-0 right-0 h-[1.5px] bg-current transition-all duration-200 ${open ? 'top-1/2 -translate-y-1/2 rotate-45' : 'top-0'}`} />
    <span className={`absolute left-0 right-0 top-1/2 h-[1.5px] -translate-y-1/2 bg-current transition-opacity duration-150 ${open ? 'opacity-0' : 'opacity-100'}`} />
    <span className={`absolute left-0 right-0 h-[1.5px] bg-current transition-all duration-200 ${open ? 'top-1/2 -translate-y-1/2 -rotate-45' : 'bottom-0'}`} />
  </span>
);

const Header = () => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { user } = useAuth();
  const location = useLocation();

  useEffect(() => { setOpen(false); }, [location.pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`sticky top-0 z-50 border-b transition-colors duration-200 ${scrolled || open ? 'border-line bg-page/95 backdrop-blur-sm' : 'border-transparent bg-page'}`}>
      <Container className="flex h-16 items-center justify-between gap-6">
        <Link to="/" aria-label="FlowXP home" className="shrink-0"><Logo /></Link>

        <nav aria-label="Main" className="hidden flex-1 items-center gap-1 lg:flex">
          <NavLink to="/features" className={({ isActive }) => `rounded-md px-3 py-2 text-sm transition-colors ${isActive ? 'font-medium text-ink-900' : 'text-ink-500 hover:text-ink-900'}`}>
            Product
          </NavLink>
          <IndustriesMenu />
          {NAV.slice(1).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm transition-colors ${isActive ? 'font-medium text-ink-900' : 'text-ink-500 hover:text-ink-900'}`
              }
            >
              {item.label}
            </NavLink>
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
          className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-700 hover:bg-surface-2 lg:hidden"
        >
          <MenuGlyph open={open} />
        </button>
      </Container>

      {open && (
        <div id="site-menu" className="border-t border-line bg-page lg:hidden">
          <Container className="flex flex-col py-3">
            <Link to="/features" className="border-b border-line py-3 text-[15px] text-ink-700">Product</Link>
            <div className="border-b border-line py-3">
              <p className="text-[15px] text-ink-700">Industries</p>
              <div className="mt-2 flex flex-col gap-2 pl-3">
                <Link to="/industries" className="text-[14px] font-medium text-ink-900">All industries</Link>
                {READY.map((k) => (
                  <Link key={k.slug} to={`/industries/${k.slug}`} className="text-[14px] text-ink-500">{k.label}</Link>
                ))}
                <Link to="/industries/coming-soon" className="text-[14px] text-ink-500">Coming soon</Link>
              </div>
            </div>
            {NAV.slice(1).map((item) => (
              <Link key={item.to} to={item.to} className="border-b border-line py-3 text-[15px] text-ink-700 last:border-0">
                {item.label}
              </Link>
            ))}
            <div className="mt-3 flex gap-2 pb-2">
              {user ? (
                <Button to="/app" className="flex-1">Open FlowXP</Button>
              ) : (
                <>
                  <Button to="/login" variant="secondary" className="flex-1">Log in</Button>
                  <Button to="/signup" className="flex-1">Start free trial</Button>
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
  <footer className="border-t border-line bg-surface">
    <Container className="py-14">
      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <Logo showTagline />
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
                  <Link to={link.to} className="text-sm text-ink-500 hover:text-ink-900">{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-12 flex flex-col gap-2 border-t border-line pt-6 text-xs text-ink-500 sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} ManagerXP. All rights reserved.</p>
        <p>Made in India for Indian businesses. Prices in ₹, GST built in.</p>
      </div>
    </Container>
  </footer>
);

const SiteLayout = () => {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <div className="flex min-h-full flex-col bg-page">
      <Header />
      <main className="flex-1"><Outlet /></main>
      <Footer />
    </div>
  );
};

export default SiteLayout;
