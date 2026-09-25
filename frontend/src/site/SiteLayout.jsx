/*
 * The public site's frame: header, footer, and the outlet between them.
 *
 * Everything outside /app renders inside this, so the nav and footer are
 * written once. The header collapses to a disclosure on mobile rather than a
 * drawer — a drawer is a lot of machinery for seven links.
 *
 * The nav is a floating glass pill, not a full-width bar — the iOS control
 * pattern this is modelled on (tab bars, Dynamic Island, Control Centre)
 * never runs edge-to-edge; it sits inset from the screen with its own
 * rounded shape, so the page is visibly *behind* it rather than the nav
 * being one more flat stripe stacked on top of the page.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Button, Container, Logo } from '../components/ui.jsx';
import { useAuth } from '../context/AuthContext.jsx';

/* Features has no separate nav entry — that section already lives on the
   home page itself (see Home.jsx's Features grid), so a nav link to a
   standalone page duplicating it would just be a second, thinner version of
   the same content. AI gets its own entry: /ai is a dedicated positioning
   page (predict/detect/leakage/health score), not a duplicate of the home
   page's AISection teaser. */
const NAV = [
  { to: '/', label: 'Home' },
  { to: '/industries', label: 'Industries' },
  { to: '/ai', label: 'AI' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/integrations', label: 'Integrations' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' }
];

const FOOTER_GROUPS = [
  { heading: 'Product', links: [
    { to: '/features', label: 'Features' },
    { to: '/industries', label: 'Industries' },
    { to: '/ai', label: 'AI' },
    { to: '/pricing', label: 'Pricing' },
    { to: '/integrations', label: 'Integrations' }
  ]},
  { heading: 'Company', links: [
    { to: '/about', label: 'About' },
    { to: '/contact', label: 'Contact' }
  ]},
  { heading: 'Get started', links: [
    { to: '/login', label: 'Login' },
    { to: '/signup', label: 'Start free trial' }
  ]},
  { heading: 'Legal', links: [
    { to: '/privacy', label: 'Privacy' },
    { to: '/terms', label: 'Terms' }
  ]}
];

/* A three-line hamburger that morphs to an X — a couple of divs rather than
   an icon library pulled in for one glyph. */
const MenuGlyph = ({ open }) => (
  <span className="relative block h-3.5 w-4">
    <span className={`absolute left-0 right-0 h-[1.5px] rounded-full bg-current transition-all duration-200 ${open ? 'top-1/2 -translate-y-1/2 rotate-45' : 'top-0'}`} />
    <span className={`absolute left-0 right-0 top-1/2 h-[1.5px] -translate-y-1/2 rounded-full bg-current transition-opacity duration-150 ${open ? 'opacity-0' : 'opacity-100'}`} />
    <span className={`absolute left-0 right-0 h-[1.5px] rounded-full bg-current transition-all duration-200 ${open ? 'top-1/2 -translate-y-1/2 -rotate-45' : 'bottom-0'}`} />
  </span>
);

const Header = () => {
  const [open, setOpen] = useState(false);
  const { user } = useAuth();
  const location = useLocation();

  /* Close the menu on navigation. Without this the panel stays open over the
     page the user just asked for, which reads as a broken link. */
  useEffect(() => { setOpen(false); }, [location.pathname]);

  return (
    // mt matches top so the pill already sits inset from the edge before any
    // scrolling happens — sticky alone only enforces the gap once scrolled;
    // without the margin it would start flush against the very top of the page.
    <header className="sticky top-3 z-50 mt-3 px-3 sm:top-4 sm:mt-4 sm:px-5">
      <div className="glass mx-auto flex h-12 max-w-5xl items-center justify-between gap-3 rounded-full py-1.5 pl-4 pr-1.5 sm:h-14 sm:pr-2">
        <Link to="/" aria-label="FlowXP home" className="shrink-0"><Logo /></Link>

        <nav className="hidden items-center gap-0.5 lg:flex">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              // Without `end`, NavLink treats "/" as a prefix match — every
              // route starts with "/", so Home would show as active on every
              // page, not just its own.
              end={item.to === '/'}
              className={({ isActive }) =>
                `rounded-full px-3 py-1.5 text-sm transition-colors ${
                  isActive ? 'bg-surface/70 font-medium text-ink-900' : 'text-ink-500 hover:text-ink-900'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="hidden items-center gap-1.5 lg:flex">
          {user ? (
            <Button to="/app" size="sm">Go to app</Button>
          ) : (
            <>
              <Button to="/login" variant="ghost" size="sm">Login</Button>
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
          className="flex h-9 w-9 items-center justify-center rounded-full text-ink-700 hover:bg-surface/60 lg:hidden"
        >
          <MenuGlyph open={open} />
        </button>
      </div>

      {open && (
        <div id="site-menu" className="glass mx-auto mt-2 max-w-5xl rounded-2xl lg:hidden">
          <div className="flex flex-col gap-1 p-3">
            {NAV.map((item) => (
              <Link key={item.to} to={item.to} className="rounded-xl px-3 py-2.5 text-sm text-ink-700 hover:bg-surface/60">
                {item.label}
              </Link>
            ))}
            <div className="mt-2 flex gap-2 px-1 pb-1">
              {user ? (
                <Button to="/app" size="sm" className="flex-1">Go to app</Button>
              ) : (
                <>
                  <Button to="/login" variant="secondary" size="sm" className="flex-1">Login</Button>
                  <Button to="/signup" size="sm" className="flex-1">Start free trial</Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

const Footer = () => (
  <footer className="border-t border-line">
    <Container className="py-14">
      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-1">
          <Logo showTagline />
          <p className="mt-4 text-sm text-ink-400">By ManagerXP</p>
        </div>

        {FOOTER_GROUPS.map((group) => (
          <div key={group.heading}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-ink-400">
              {group.heading}
            </h3>
            <ul className="space-y-2">
              {group.links.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-sm text-ink-500 hover:text-ink-900">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-xs text-ink-400 sm:flex-row sm:items-center sm:justify-between">
        <p>© {new Date().getFullYear()} ManagerXP. All rights reserved.</p>
        <p className="uppercase tracking-[0.16em]">The smart flow for every business</p>
      </div>
    </Container>
  </footer>
);

const SiteLayout = () => {
  const { pathname } = useLocation();

  /* React Router keeps the scroll position across navigations, which lands
     you halfway down a page you have not read yet. */
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  return (
    <div className="flex min-h-full flex-col">
      <Header />
      <main className="flex-1"><Outlet /></main>
      <Footer />
    </div>
  );
};

export default SiteLayout;
