/*
 * The authenticated shell: sidebar, top bar, trial banner, and the outlet.
 *
 * Also the gate. Everything under /app renders inside this, so "are you signed
 * in?" is answered once here rather than in every screen — a check repeated
 * per-page is a check that eventually gets missed on one.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { Avatar, Button, Logo, useToast } from '../components/ui.jsx';
import { setPrintErrorHandler } from '../lib/printing.js';
import { ErrorBoundary } from '../components/ErrorBoundary.jsx';
import NotificationBell from '../components/NotificationBell.jsx';
import { RESTAURANT_TYPES } from '../lib/business.js';

/*
 * The sidebar, in two groups rather than one long list. Everything in the
 * first group is something a shift worker touches constantly — open the
 * till, take an order, check the kitchen. The second group is real but
 * occasional: a supplier gets added once, a report gets pulled at month-end.
 * Flattening both into one alphabetical-ish list is what actually confuses a
 * non-technical owner, not the number of screens itself — the grouping is
 * the fix, not fewer features.
 *
 * `types` restricts an item to certain business types — the brief asks that
 * business type control which modules are shown, and a salon has no use for
 * a purchase-order screen. Absent means "everyone".
 */

const NAV_GROUPS = [
  {
    label: null, // the day-to-day group needs no heading — it's the first thing seen
    items: [
      { to: '/app',         label: 'Dashboard', end: true },
      { to: '/app/billing', label: 'Billing' },
      { to: '/app/orders',  label: 'Orders', types: RESTAURANT_TYPES },
      { to: '/app/kitchen', label: 'Kitchen', types: RESTAURANT_TYPES },
      { to: '/app/tables',  label: 'Tables', types: RESTAURANT_TYPES },
      { to: '/app/reservations', label: 'Reservations', types: RESTAURANT_TYPES }
    ]
  },
  {
    label: 'Manage',
    items: [
      { to: '/app/products',     label: 'Products' },
      { to: '/app/modifiers',    label: 'Modifiers', types: RESTAURANT_TYPES },
      { to: '/app/inventory',    label: 'Inventory' },
      { to: '/app/outlets',      label: 'Outlets', roles: ['OWNER', 'ADMIN'], types: RESTAURANT_TYPES },
      { to: '/app/staff',        label: 'Staff', roles: ['OWNER', 'ADMIN'] },
      { to: '/app/activity',     label: 'Activity log', roles: ['OWNER', 'ADMIN'] },
      { to: '/app/profitability', label: 'Profitability', types: RESTAURANT_TYPES },
      { to: '/app/leakage',      label: 'Leakage', types: RESTAURANT_TYPES },
      { to: '/app/forecast',     label: 'Forecast', types: RESTAURANT_TYPES },
      { to: '/app/purchases',    label: 'Purchases' },
      { to: '/app/customers',    label: 'Customers' },
      { to: '/app/loyalty',      label: 'Loyalty & coupons', roles: ['OWNER', 'ADMIN'] },
      { to: '/app/messaging',    label: 'Messaging', roles: ['OWNER', 'ADMIN'] },
      { to: '/app/suppliers',    label: 'Suppliers' },
      { to: '/app/payments',     label: 'Payments' },
      { to: '/app/expenses',     label: 'Expenses' },
      { to: '/app/reports',      label: 'Reports' },  // GST is a tab inside Reports, not its own page
      { to: '/app/integrations', label: 'Integrations', types: RESTAURANT_TYPES },
      { to: '/app/ai',           label: 'Flow AI' }
    ]
  }
];

/* ── Trial / expiry banner ───────────────────────────────────────────────
   Shown from the start of the trial, not only at the end: the brief asks for
   the remaining days "throughout the application", and a counter someone has
   watched tick down converts better than a wall that appears on day eight. */
const SubscriptionBanner = ({ subscription }) => {
  if (!subscription) return null;

  if (subscription.status === 'EXPIRED') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-5 py-2.5 text-sm">
        <p className="text-ink-900">
          <strong className="font-semibold">Your 7-day FlowXP trial has ended.</strong>{' '}
          Your data is safe and still readable — upgrade to start billing again.
        </p>
        <Button to="/app/settings/subscription" size="sm">Upgrade now</Button>
      </div>
    );
  }

  if (subscription.status !== 'TRIAL') return null;

  const days = subscription.trial_days_remaining;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-brand-50 px-5 py-2.5 text-sm">
      <p className="text-ink-700">
        <strong className="font-semibold text-ink-900">
          {days} {days === 1 ? 'day' : 'days'} left in your free trial
        </strong>
        {' '}· no credit card on file
      </p>
      <Button to="/app/settings/subscription" size="sm" variant="secondary">See plans</Button>
    </div>
  );
};

const AppShell = () => {
  const { user, business, businesses, businessId, switchBusiness, signOut, loading, outlets, outletId, canViewAll, switchOutlet } = useAuth();
  const location = useLocation();
  const toast = useToast();
  useEffect(() => { setPrintErrorHandler((message) => toast.error(message)); return () => setPrintErrorHandler(null); }, [toast]);
  const [navOpen, setNavOpen] = useState(false);

  /* Wait for /auth/me before deciding. Without this, a page refresh bounces a
     signed-in user to /login for the half-second the request takes. */
  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <p className="text-sm text-ink-400">Loading FlowXP…</p>
      </div>
    );
  }

  if (!user) {
    // Remember where they were headed, so signing in returns them there.
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  /* Signed in with no business at all — only reachable if every business was
     deleted. Sending them to the wizard is the only useful thing to do. */
  if (!business) return <Navigate to="/app/onboarding" replace />;

  const groups = NAV_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => (!item.types || item.types.includes(business.business_type)) && (!item.roles || item.roles.includes(business.role))) }))
    .filter((group) => group.items.length > 0);

  const linkClass = ({ isActive }) =>
    `block rounded-lg px-3 py-2 text-sm transition-colors ${
      isActive ? 'bg-brand-50 font-semibold text-brand-600' : 'text-ink-700 hover:bg-surface-2'
    }`;

  return (
    <div className="flex min-h-full flex-col">
      <div className="print:hidden"><SubscriptionBanner subscription={business.subscription} /></div>

      <div className="flex flex-1">
        {/* Sidebar. Hidden below lg and revealed by the Menu button, rather
            than a slide-over — same markup, one breakpoint, no animation to
            maintain. print:hidden so printing an invoice prints the invoice,
            not the whole app chrome around it. */}
        <aside
          className={`${navOpen ? 'block' : 'hidden'} w-full shrink-0 border-r border-line bg-surface/60 backdrop-blur-xl lg:block lg:w-60 print:hidden`}
        >
          <div className="flex h-14 items-center px-5">
            <Link to="/app" aria-label="FlowXP"><Logo /></Link>
          </div>

          <nav className="px-3 pb-6">
            {groups.map((group, index) => (
              <div key={group.label || 'primary'} className={index > 0 ? 'mt-5 border-t border-line pt-4' : ''}>
                {group.label && (
                  <p className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wide text-ink-400">{group.label}</p>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setNavOpen(false)}
                      className={linkClass}
                    >
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>

          <div className="mt-auto border-t border-line px-3 py-4">
            <NavLink to="/app/settings" className={linkClass} onClick={() => setNavOpen(false)}>
              Settings
            </NavLink>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-14 items-center justify-between gap-3 border-b border-line bg-surface/70 px-5 backdrop-blur-xl print:hidden">
            <button
              type="button"
              onClick={() => setNavOpen((v) => !v)}
              aria-expanded={navOpen}
              className="rounded-lg border border-line-strong px-3 py-1.5 text-sm text-ink-700 lg:hidden"
            >
              Menu
            </button>

            {/* Business selector. A <select> rather than a custom dropdown —
                it is keyboard accessible and native on a phone for free. */}
            {businesses.length > 1 ? (
              <label className="min-w-0">
                <span className="sr-only">Business</span>
                <select
                  value={businessId ?? ''}
                  onChange={(e) => switchBusiness(Number(e.target.value))}
                  className="max-w-52 truncate rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink-900"
                >
                  {businesses.map((b) => (
                    <option key={b.business_id} value={b.business_id}>{b.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="truncate text-sm font-semibold text-ink-900">{business.name}</p>
            )}

            {/* Outlet switcher: group users pick an outlet (or all of them); someone pinned to one just sees theirs. */}
            {outlets.length > 1 && (
              canViewAll ? (
                <label className="min-w-0">
                  <span className="sr-only">Outlet</span>
                  <select
                    value={outletId ?? ''}
                    onChange={(e) => switchOutlet(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                    className="max-w-52 truncate rounded-lg border border-brand-500/40 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-600"
                  >
                    {outlets.map((o) => <option key={o.branch_id} value={o.branch_id}>{o.name}</option>)}
                    <option value="all">All outlets</option>
                  </select>
                </label>
              ) : (
                <span className="truncate rounded-lg bg-surface-2 px-3 py-1.5 text-sm font-medium text-ink-700">{outlets[0]?.name}</span>
              )
            )}

            <div className="flex items-center gap-2.5">
              <NotificationBell />
              <Avatar name={user.name} size="sm" />
              <span className="hidden text-sm text-ink-500 sm:inline">{user.name}</span>
              <Button onClick={signOut} variant="ghost" size="sm">Sign out</Button>
            </div>
          </header>

          {/* key={pathname} remounts the boundary on navigation, so leaving a
              broken page and coming back to a different one starts clean
              rather than showing yesterday's crash for an unrelated screen. */}
          <main className="flex-1 bg-surface-2 p-5 sm:p-8">
            <ErrorBoundary key={`${location.pathname}:${outletId ?? ''}`}><Outlet /></ErrorBoundary>
          </main>
        </div>
      </div>
    </div>
  );
};

export default AppShell;
