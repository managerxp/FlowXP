/*
 * The public site's frame: header, footer, and the outlet between them.
 *
 * A full-width bar with a hairline border, not a floating pill: the site
 * should read as a software company's site, and the header's only jobs are
 * "where am I", "where can I go" and "start". It turns solid once the page
 * scrolls so content never shows through it.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Button, Container, Logo } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

const NAV = [
  { to: '/features', label: 'Product' },
  { to: '/industries', label: 'Industries' },
  { to: '/ai', label: 'AI Manager' },
  { to: '/integrations', label: 'Integrations' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/about', label: 'About' }
];

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
          {NAV.map((item) => (
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
            {NAV.map((item) => (
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
