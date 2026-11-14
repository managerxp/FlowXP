/*
 * The super admin shell — sidebar, top bar, outlet. A trimmed mirror of
 * app/AppShell.jsx: same "guard once here, not per-page" reasoning, far
 * fewer nav items since there's no business context to switch between.
 */
import { useEffect, useState } from 'react';
import { adminApi } from '../lib/adminApi.js';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAdminAuth } from './AdminAuthContext.jsx';
import { Button, Logo, PageLoader } from '../components/ui.jsx';

/* Grouped by the job they do, so the owner finds a page by what they are doing: looking after clients, billing them, or running the platform. */
const GROUPS = [
  { title: null, items: [{ to: '/superadmin', label: 'Overview', end: true }] },
  { title: 'Clients', items: [
    { to: '/superadmin/businesses', label: 'Clients' },
    { to: '/superadmin/users', label: 'People' },
    { to: '/superadmin/support', label: 'Support', badge: 'tickets' },
    { to: '/superadmin/messages', label: 'WhatsApp usage' },
    { to: '/superadmin/deletions', label: 'Deletions' }
  ] },
  { title: 'Billing', items: [
    { to: '/superadmin/invoices', label: 'Invoices' },
    { to: '/superadmin/quotations', label: 'Quotations' },
    { to: '/superadmin/plans', label: 'Plans' },
    { to: '/superadmin/features', label: 'Features' },
    { to: '/superadmin/addons', label: 'Add-ons' }
  ] },
  { title: 'Platform', items: [
    { to: '/superadmin/bugs', label: 'Bugs', badge: true },
    { to: '/superadmin/activity', label: 'Activity' },
    { to: '/superadmin/settings', label: 'Settings' },
    { to: '/superadmin/security', label: 'Security' }
  ] }
];

const AdminShell = () => {
  const { admin, loading, signOut } = useAdminAuth();
  const location = useLocation();
  const [tickets, setTickets] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [location.pathname]);
  const [fresh, setFresh] = useState(0);   // new bug reports and new crashes, for the badge
  useEffect(() => {
    if (!admin) return undefined;
    const load = () => adminApi('/bug-summary').then((s) => { setFresh((s?.new_reports || 0) + (s?.new_crashes || 0)); setTickets(s?.open_tickets || 0); }).catch(() => {});
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [admin, location.pathname]);
  useEffect(() => { const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex, nofollow'; document.head.appendChild(m); return () => m.remove(); }, []);

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <PageLoader compact />
      </div>
    );
  }

  // A console that requires two-step verification shows nothing but the page that sets it up until it is on.
  if (admin && admin.two_factor_required && admin.totp_enabled === false && location.pathname !== '/superadmin/security') {
    return <Navigate to="/superadmin/security" replace />;
  }

  if (!admin) {
    return <Navigate to="/superadmin/login" replace state={{ from: location.pathname }} />;
  }

  const linkClass = ({ isActive }) =>
    `block rounded-lg px-3 py-2 text-sm transition-colors ${
      isActive ? 'bg-brand-50 font-semibold text-brand-600' : 'text-ink-700 hover:bg-surface-2'
    }`;

  const count = (item) => (item.badge === 'tickets' ? tickets : item.badge ? fresh : 0);
  const menu = GROUPS.map((g) => (
    <div key={g.title || 'top'} className={g.title ? 'mt-4' : ''}>
      {g.title && <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-400">{g.title}</p>}
      <div className="space-y-0.5">
        {g.items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
            {item.label}{count(item) > 0 ? <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-semibold text-white">{count(item)}</span> : null}
          </NavLink>
        ))}
      </div>
    </div>
  ));

  return (
    <div className="flex min-h-full">
      <aside className="hidden print:hidden w-60 shrink-0 border-r border-line bg-surface lg:block">
        <div className="flex h-14 items-center px-5"><Logo /></div>
        <p className="px-5 pb-2 text-xs font-semibold uppercase tracking-[0.16em] text-ink-400">
          Platform admin
        </p>
        <nav className="px-3 pb-6" aria-label="Admin">{menu}</nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-line bg-surface px-5 print:hidden">
          <button type="button" className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-900 lg:hidden" aria-expanded={menuOpen} aria-controls="admin-menu" onClick={() => setMenuOpen((o) => !o)}>
            {menuOpen ? 'Close' : 'Menu'}{!menuOpen && tickets + fresh > 0 ? <span className="ml-2 inline-flex min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] text-white">{tickets + fresh}</span> : null}
          </button>
          <div className="flex items-center gap-2 lg:ml-auto">
            <span className="hidden text-sm text-ink-500 sm:inline">{admin.email}</span>
            <Button onClick={signOut} variant="ghost" size="sm">Sign out</Button>
          </div>
        </header>

        {menuOpen && <nav id="admin-menu" aria-label="Admin" className="border-b border-line bg-surface px-3 pb-4 pt-1 lg:hidden print:hidden">{menu}</nav>}

        {admin.totp_enabled === false && location.pathname !== '/superadmin/security' && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b border-warning/40 bg-warning/10 px-5 py-2 text-sm text-ink-900">
            <span><strong className="font-semibold">Two-step verification is off.</strong> This console can change every business and plan: protect it with an authenticator app.</span>
            <Link to="/superadmin/security" className="font-semibold text-brand-600 hover:underline">Turn it on</Link>
          </div>
        )}

        <main className="flex-1 bg-surface-2 p-5 sm:p-8 print:bg-white print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminShell;
