/*
 * The authenticated shell: sidebar, top bar, trial banner, and the outlet.
 *
 * Also the gate. Everything under /app renders inside this, so "are you signed
 * in?" is answered once here rather than in every screen — a check repeated
 * per-page is a check that eventually gets missed on one.
 *
 * Layout (design.md §21–25): a sidebar grouped by what people do (sell, run
 * the floor, stock, customers, the business, the team), which can shrink to
 * icons on a desktop and is a drawer on a phone; a top bar with the business
 * and outlet, "Go to…" (Ctrl K), notifications and the person's menu.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import {
  ArrowLeftRight, BadgePercent, Boxes, CalendarClock, CalendarDays, ChartColumn, ChartLine, ChefHat, ChevronDown, ClipboardList, FileText, Gift,
  History, Landmark, LayoutDashboard, LayoutGrid, Lock, LogOut, Menu, MessageSquare, Package, PanelLeftClose, PanelLeftOpen,
  Plug, Receipt, ReceiptText, Search, Settings, Shield, ShieldAlert, ShoppingCart, SlidersHorizontal, Sparkles, Star, Store,
  Scissors, TrendingUp, Truck, UserRound, Users, Wallet, X, Warehouse, PackageCheck, Undo2, HandCoins, ChartBar, ShoppingBag, Tags,
  Factory, MapPinned, Target, Percent, Container, Smartphone, Ellipsis
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { Avatar, Button, EmptyState, Logo, PageLoader, useToast } from '../components/ui.jsx';
import { setPrintErrorHandler } from '../lib/printing.js';
import { ErrorBoundary } from '../components/ErrorBoundary.jsx';
import NotificationBell from '../components/NotificationBell.jsx';
import { InstallButton, OfflineStatus } from '../components/OfflineStatus.jsx';
import CommandPalette from '../components/CommandPalette.jsx';
import IncomingDeliveryAlert from '../components/IncomingDeliveryAlert.jsx';
import { PHARMACY_TYPES, RESTAURANT_TYPES, RETAIL_TYPES, WHOLESALE_TYPES } from '../lib/business.js';

/*
 * The sidebar, grouped by the job rather than listed alphabetically: that
 * grouping is what makes a long product easy for a non-technical owner.
 *
 * `types` restricts an item to certain business types (a salon has no use
 * for a kitchen screen), `roles` to certain roles, `multiOutlet` to
 * businesses with more than one outlet. Absent means "everyone". `more` keeps
 * an item out of the main list and under "More" (the daily screens stay short).
 */
/* A cloud kitchen has no dine-in seating — it cooks for delivery/takeaway only — so Tables and
   Reservations are the two RESTAURANT_TYPES screens it doesn't need, unlike Kitchen/Orders/Modifiers/
   Integrations which every restaurant-family type (including it) still does. */
const DINE_IN_TYPES = RESTAURANT_TYPES.filter((t) => t !== 'CLOUD_KITCHEN');

const SALON = ['SALON'];
const WHOLESALE = WHOLESALE_TYPES;
const PHARMACY = PHARMACY_TYPES;
const RETAIL = RETAIL_TYPES;
/* the generic stock, buying and customer screens give way to the wholesale ones for a wholesaler */
const NOT_SALON_OR_WHOLESALE = [...SALON, ...WHOLESALE];

const NAV_GROUPS = [
  {
    label: null,
    items: [{ to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true }]
  },
  {
    label: 'Sell',
    items: [
      { to: '/app/billing', label: 'Billing', icon: ReceiptText, end: true, permission: 'billing', notTypes: [...SALON, ...PHARMACY] },
      { to: '/app/billing/invoices', label: 'Invoices', icon: FileText, permission: 'billing', more: true },
      { to: '/app/orders', label: 'Orders', icon: ClipboardList, types: RESTAURANT_TYPES, anyPermission: ['billing', 'kitchen'] },
      { to: '/app/payments', label: 'Payments', icon: Wallet, permission: 'payments', more: true }
    ]
  },
  {
    label: 'Wholesale',
    items: [
      { to: '/app/wholesale/orders', label: 'Sales orders', icon: ClipboardList, types: WHOLESALE, permission: 'sales_orders', feature: 'wholesale_orders' },
      { to: '/app/wholesale/fulfilment', label: 'Warehouse & delivery', icon: PackageCheck, types: WHOLESALE, permission: 'fulfilment', feature: 'wholesale_fulfilment' },
      { to: '/app/wholesale/customers', label: 'Customers', icon: UserRound, types: WHOLESALE, anyPermission: ['customers', 'sales_orders', 'payments'] },
      { to: '/app/wholesale/products', label: 'Products & pricing', icon: Tags, types: WHOLESALE, anyPermission: ['products', 'pricing', 'sales_orders', 'purchases', 'inventory'] },
      { to: '/app/wholesale/inventory', label: 'Inventory', icon: Warehouse, types: WHOLESALE, anyPermission: ['inventory', 'fulfilment', 'purchases', 'sales_orders'] },
      { to: '/app/wholesale/purchasing', label: 'Purchasing', icon: ShoppingBag, types: WHOLESALE, anyPermission: ['purchases', 'payments'] },
      { to: '/app/wholesale/suppliers', label: 'Suppliers', icon: Truck, types: WHOLESALE, anyPermission: ['suppliers', 'purchases'] },
      { to: '/app/wholesale/money', label: 'Receivables & payables', icon: HandCoins, types: WHOLESALE, anyPermission: ['payments', 'reports'] },
      { to: '/app/wholesale/returns', label: 'Returns', icon: Undo2, types: WHOLESALE, anyPermission: ['refunds', 'inventory', 'purchases'] }
    ]
  },
  {
    label: 'Distributor',
    items: [
      { to: '/app/distributor/field', label: 'Field sales', icon: Smartphone, types: WHOLESALE, distributor: true, permission: 'field_sales' },
      { to: '/app/distributor/principals', label: 'Principals & brands', icon: Factory, types: WHOLESALE, distributor: true, anyPermission: ['principals', 'products', 'purchases', 'reports'] },
      { to: '/app/distributor/territories', label: 'Territories & beats', icon: MapPinned, types: WHOLESALE, distributor: true, anyPermission: ['territories', 'field_sales', 'reports'] },
      { to: '/app/distributor/team', label: 'Sales team & targets', icon: Target, types: WHOLESALE, distributor: true, anyPermission: ['targets', 'territories', 'reports', 'field_sales'] },
      { to: '/app/distributor/schemes', label: 'Schemes', icon: Percent, types: WHOLESALE, distributor: true, anyPermission: ['schemes', 'sales_orders', 'field_sales', 'reports'] },
      { to: '/app/distributor/vehicles', label: 'Vehicle stock', icon: Container, types: WHOLESALE, distributor: true, anyPermission: ['vehicles', 'field_sales', 'reports'] }
    ]
  },
  {
    label: 'Salon',
    items: [
      { to: '/app/salon/appointments', label: 'Appointments', icon: CalendarDays, types: SALON, permission: 'appointments', feature: 'salon_appointments' },
      { to: '/app/salon/pos', label: 'Billing', icon: ReceiptText, types: SALON, permission: 'billing' },
      { to: '/app/salon/clients', label: 'Clients', icon: UserRound, types: SALON, anyPermission: ['customers', 'billing', 'appointments'] },
      { to: '/app/salon/services', label: 'Services', icon: Scissors, types: SALON, permission: 'products' },
      { to: '/app/salon/memberships', label: 'Memberships & offers', icon: BadgePercent, types: SALON, permission: 'products' },
      { to: '/app/salon/team', label: 'Team & commission', icon: Users, types: SALON, anyPermission: ['staff_commission', 'appointments'] },
      { to: '/app/salon/stock', label: 'Stock & alerts', icon: Boxes, types: SALON, anyPermission: ['inventory', 'reports'] }
    ]
  },
  {
    label: 'Pharmacy',
    items: [
      { to: '/app/pharmacy/pos', label: 'Billing', icon: ReceiptText, types: PHARMACY, permission: 'billing' },
      { to: '/app/pharmacy/products', label: 'Products', icon: Package, types: PHARMACY, anyPermission: ['products', 'inventory', 'billing', 'purchases'] },
      { to: '/app/pharmacy/inventory', label: 'Inventory', icon: Boxes, types: PHARMACY, anyPermission: ['inventory', 'purchases', 'billing'] },
      { to: '/app/pharmacy/grn', label: 'Goods receipts', icon: PackageCheck, types: PHARMACY, anyPermission: ['purchases', 'inventory'] }
    ]
  },
  {
    label: 'Restaurant',
    items: [
      { to: '/app/tables', label: 'Tables', icon: LayoutGrid, types: DINE_IN_TYPES, permission: 'billing' },
      { to: '/app/kitchen', label: 'Kitchen', icon: ChefHat, types: RESTAURANT_TYPES, anyPermission: ['billing', 'kitchen'] },
      { to: '/app/reservations', label: 'Reservations', icon: CalendarClock, types: DINE_IN_TYPES, permission: 'billing', feature: 'reservations', more: true }
    ]
  },
  {
    label: 'Stock',
    items: [
      { to: '/app/products', label: 'Products', icon: Package, permission: 'products', notTypes: [...WHOLESALE, ...PHARMACY] },
      { to: '/app/modifiers', label: 'Options & add-ons', icon: SlidersHorizontal, types: RESTAURANT_TYPES, permission: 'products', more: true },
      // a supermarket works from the Stock center (scan in, count, expiry, import); Inventory stays for single-item changes
      { to: '/app/stock', label: 'Stock center', icon: Warehouse, types: RETAIL, permission: 'inventory' },
      { to: '/app/inventory', label: 'Inventory', icon: Boxes, permission: 'inventory', notTypes: [...WHOLESALE, ...PHARMACY, ...RETAIL] },
      { to: '/app/inventory', label: 'Adjust & wastage', icon: Boxes, types: RETAIL, permission: 'inventory', more: true },
      // pharmacy's GRN is the only receiving document it has — no generic Purchase Order screen for it (see
      // pharmacy.routes.js's header note: no PO route exists anywhere in that module, by design)
      { to: '/app/purchases', label: 'Purchases', icon: ShoppingCart, permission: 'purchases', feature: 'purchases', notTypes: [...WHOLESALE, ...PHARMACY], more: true },
      { to: '/app/suppliers', label: 'Suppliers', icon: Truck, permission: 'suppliers', feature: 'purchases', notTypes: WHOLESALE, more: true },
      { to: '/app/stock-requests', label: 'Stock requests', icon: ArrowLeftRight, types: RESTAURANT_TYPES, multiOutlet: true, permission: 'inventory', more: true }
    ]
  },
  {
    label: 'Customers',
    items: [
      // every signed-in team member may look a customer up (billing/loyalty need this) — reading
      // customers has no permission gate server-side. Editing needs 'customers' and is rejected
      // there if not; CustomersPage does not yet hide its own Edit/Add buttons for a role without it.
      { to: '/app/customers', label: 'Customers', icon: UserRound, notTypes: NOT_SALON_OR_WHOLESALE },
      { to: '/app/loyalty', label: 'Loyalty & coupons', icon: Gift, roles: ['OWNER', 'ADMIN'], feature: 'loyalty', more: true },
      { to: '/app/messaging', label: 'Messaging', icon: MessageSquare, roles: ['OWNER', 'ADMIN'], feature: 'messaging', more: true },
      { to: '/app/reviews', label: 'Reviews', icon: Star, roles: ['OWNER', 'ADMIN'], permission: 'settings', feature: 'reviews', more: true }
    ]
  },
  {
    label: 'Business',
    items: [
      { to: '/app/reports', label: 'Reports', icon: ChartColumn, permission: 'reports', notTypes: NOT_SALON_OR_WHOLESALE },
      { to: '/app/wholesale/reports', label: 'Reports', icon: ChartBar, types: WHOLESALE, permission: 'reports' },
      { to: '/app/salon/reports', label: 'Reports', icon: ChartColumn, types: SALON, permission: 'reports' },
      { to: '/app/profitability', label: 'Profitability', icon: TrendingUp, types: RESTAURANT_TYPES, permission: 'reports', feature: 'advanced_reports', more: true },
      { to: '/app/forecast', label: 'Forecast', icon: ChartLine, types: RESTAURANT_TYPES, permission: 'reports', feature: 'advanced_reports', more: true },
      { to: '/app/leakage', label: 'Leakage', icon: ShieldAlert, types: RESTAURANT_TYPES, permission: 'settings', feature: 'advanced_reports', more: true },
      { to: '/app/expenses', label: 'Expenses', icon: Receipt, permission: 'expenses', feature: 'expenses', more: true },
      { to: '/app/gst', label: 'GST filing', icon: Landmark, roles: ['OWNER', 'ADMIN'], more: true },
      { to: '/app/ai', label: 'Flow AI', icon: Sparkles, permission: 'ai', feature: 'ai' }
    ]
  },
  {
    label: 'Team',
    items: [
      { to: '/app/outlets', label: 'Outlets', icon: Store, roles: ['OWNER', 'ADMIN'], types: [...RESTAURANT_TYPES, ...WHOLESALE, ...PHARMACY], more: true },
      { to: '/app/staff', label: 'Staff', icon: Users, roles: ['OWNER', 'ADMIN'] },
      { to: '/app/activity', label: 'Activity log', icon: History, roles: ['OWNER', 'ADMIN'], more: true }
    ]
  }
];

/* Pinned to the bottom of the sidebar. */
const SYSTEM_ITEMS = [
  { to: '/app/integrations', label: 'Integrations', icon: Plug, types: RESTAURANT_TYPES, permission: 'settings', more: true },
  { to: '/app/settlements', label: 'Settlements', icon: ArrowLeftRight, types: RESTAURANT_TYPES, permission: 'settings', feature: 'integrations', more: true },
  // personal account security (password, 2FA, sessions) — every role manages their own
  { to: '/app/security', label: 'Security', icon: Shield, more: true },
  // the business's own identity/GSTIN/logo can only be SAVED by the owner (see business.routes.js),
  // so showing it to anyone else is a form they can look at but never use
  { to: '/app/wholesale/settings', label: 'Wholesale settings', icon: SlidersHorizontal, types: WHOLESALE, permission: 'settings' },
  { to: '/app/salon/settings', label: 'Salon settings', icon: SlidersHorizontal, types: SALON, permission: 'settings' },
  { to: '/app/settings', label: 'Settings', icon: Settings, roles: ['OWNER'] }
];

const COLLAPSE_KEY = 'flowxp.nav.collapsed';
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; } };

/* One sidebar link. Collapsed, it shows only the icon and names itself in a tooltip. */
const NavItem = ({ item, collapsed, onNavigate }) => {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        `group relative flex h-9 items-center gap-3 rounded-lg px-2.5 text-small transition-colors duration-(--duration-fast) pointer-coarse:h-11 ${
          isActive ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-700 hover:bg-surface-2 hover:text-ink-900'
        } ${collapsed ? 'lg:justify-center lg:px-0' : ''}`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-brand-500" />}
          <Icon aria-hidden="true" className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-brand-600' : 'text-ink-400 group-hover:text-ink-700'}`} />
          <span className={collapsed ? 'lg:sr-only' : ''}>{item.label}</span>
        </>
      )}
    </NavLink>
  );
};

/* The person's menu in the top bar: who is signed in, and the ways out. */
const ProfileMenu = ({ user, role, onSignOut }) => {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const item = 'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-small';
  return (
    <div className="relative" ref={box}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu"
              className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-1.5 hover:bg-surface-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11 md:pr-2">
        <Avatar name={user.name} size="sm" />
        <span className="hidden max-w-32 truncate text-small font-medium text-ink-900 md:inline">{user.name}</span>
        <ChevronDown aria-hidden="true" className="hidden h-4 w-4 text-ink-400 md:block" />
        <span className="sr-only md:hidden">Your account</span>
      </button>
      {open && (
        <div role="menu" className="fade-in absolute right-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-(--radius-card) border border-line bg-surface shadow-lg">
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-small font-semibold text-ink-900">{user.name}</p>
            <p className="truncate text-caption text-ink-500">{user.email}</p>
            {role && <p className="mt-1 text-caption capitalize text-ink-500">{String(role).toLowerCase().replace('_', ' ')}</p>}
          </div>
          <div className="p-1.5">
            <Link role="menuitem" to="/app/security" onClick={() => setOpen(false)} className={`${item} text-ink-700 hover:bg-surface-2`}>
              <Shield aria-hidden="true" className="h-4 w-4 text-ink-400" />Security
            </Link>
            <Link role="menuitem" to="/app/settings" onClick={() => setOpen(false)} className={`${item} text-ink-700 hover:bg-surface-2`}>
              <Settings aria-hidden="true" className="h-4 w-4 text-ink-400" />Settings
            </Link>
            <button role="menuitem" type="button" onClick={onSignOut} className={`${item} text-danger hover:bg-danger/5`}>
              <LogOut aria-hidden="true" className="h-4 w-4" />Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Trial / expiry banner ───────────────────────────────────────────────
   Shown from the start of the trial, not only at the end: a counter someone
   has watched tick down converts better than a wall that appears on day eight. */
const SubscriptionBanner = ({ subscription }) => {
  if (!subscription) return null;

  if (subscription.status === 'EXPIRED') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-5 py-2 text-small">
        <p className="text-ink-900">
          <strong className="font-semibold">Your 7-day FlowXP trial has ended.</strong>{' '}
          Your data is safe and still readable. Upgrade to start billing again.
        </p>
        <Button to="/app/settings/subscription" size="sm">Upgrade now</Button>
      </div>
    );
  }

  if (subscription.status !== 'TRIAL') return null;

  const days = subscription.trial_days_remaining;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-100 bg-brand-50 px-5 py-2 text-small">
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
  const { user, business, businesses, businessId, switchBusiness, signOut, loading, outlets, outletId, canViewAll, switchOutlet, can, hasFeature } = useAuth();
  const location = useLocation();
  const toast = useToast();
  useEffect(() => { setPrintErrorHandler((message) => toast.error(message)); return () => setPrintErrorHandler(null); }, [toast]);
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [moreOpen, setMoreOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const toggleCollapsed = () => setCollapsed((v) => {
    try { localStorage.setItem(COLLAPSE_KEY, v ? '0' : '1'); } catch { /* private mode: it just will not be remembered */ }
    return !v;
  });

  /* Ctrl K / ⌘ K opens "Go to…" from anywhere; Escape closes the phone drawer. */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true); }
      if (e.key === 'Escape') setNavOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { setNavOpen(false); }, [location.pathname]);
  // keep the current page's link visible in a long sidebar (a page under "More" opens that list below the fold)
  useEffect(() => { document.querySelector('aside [aria-current="page"]')?.scrollIntoView({ block: 'nearest' }); }, [location.pathname, navOpen]);

  /* Wait for /auth/me before deciding. Without this, a page refresh bounces a
     signed-in user to /login for the half-second the request takes. */
  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center bg-page">
        <PageLoader label="Loading FlowXP…" />
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

  const allowed = (item) => (!item.types || item.types.includes(business.business_type))
    && (!item.distributor || business.distributor_enabled)
    && (!item.notTypes || !item.notTypes.includes(business.business_type))
    && (!item.roles || item.roles.includes(business.role))
    && (!item.multiOutlet || outlets.length > 1)
    && (!item.permission || can(item.permission))
    && (!item.anyPermission || item.anyPermission.some(can))
    && (!item.feature || hasFeature(item.feature));
  // Access, not fit: a mismatched business type or outlet count means a page doesn't
  // apply here, not that this person may not open it, so only role/permission/plan block it.
  const accessible = (item) => (!item.roles || item.roles.includes(business.role))
    && (!item.permission || can(item.permission))
    && (!item.anyPermission || item.anyPermission.some(can))
    && (!item.feature || hasFeature(item.feature));
  const groups = NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter(allowed) })).filter((group) => group.items.length > 0);
  const systemItems = SYSTEM_ITEMS.filter(allowed);
  /* The sidebar shows the daily screens; the rest sit under "More" (still one click away, and always in Ctrl K). */
  const mainGroups = groups.map((g) => ({ ...g, items: g.items.filter((i) => !i.more) })).filter((g) => g.items.length > 0);
  const moreItems = [...groups.flatMap((g) => g.items.filter((i) => i.more)), ...systemItems.filter((i) => i.more)];
  const pinnedItems = systemItems.filter((i) => !i.more);
  const onMorePage = moreItems.some((i) => location.pathname === i.to || location.pathname.startsWith(`${i.to}/`));
  const showMore = moreOpen || onMorePage;

  /* The sidebar hides a link this role can't use, but a typed or bookmarked URL still
     reaches the route — this is the same policy, checked again for whichever nav entry
     owns that path (its own path, or the closest ancestor: /app/kitchen/board is covered
     by /app/kitchen), so a page nobody hid can't be walked into directly either. */
  const allItems = [...NAV_GROUPS.flatMap((g) => g.items), ...SYSTEM_ITEMS];
  const owner = allItems
    .filter((i) => location.pathname === i.to || location.pathname.startsWith(`${i.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0];
  const blocked = owner && !accessible(owner);
  const paletteItems = [
    ...groups.flatMap((g) => g.items.map((i) => ({ ...i, group: g.label || 'Overview' }))),
    ...systemItems.map((i) => ({ ...i, group: 'System' }))
  ];
  const closeNav = () => setNavOpen(false);

  return (
    <div className="flex min-h-full flex-col bg-page">
      <IncomingDeliveryAlert />
      <div className="print:hidden"><SubscriptionBanner subscription={business.subscription} /></div>
      <OfflineStatus />

      <div className="flex flex-1">
        {/* Phone: a drawer over the page with a backdrop. Desktop: a sticky
            column that can shrink to icons. print:hidden so printing a bill
            prints the bill, not the app around it. */}
        {navOpen && <div className="fixed inset-0 z-40 bg-ink-900/30 lg:hidden print:hidden" onClick={closeNav} aria-hidden="true" />}
        <aside
          aria-label="Main navigation"
          className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-line bg-surface transition-transform duration-(--duration-moderate) ease-(--ease-standard) lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:translate-x-0 lg:transition-[width] ${navOpen ? 'translate-x-0' : '-translate-x-full'} ${collapsed ? 'lg:w-16' : 'lg:w-60'} print:hidden`}
        >
          <div className={`flex h-14 shrink-0 items-center justify-between border-b border-line px-4 ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}>
            <Link to="/app" aria-label="FlowXP dashboard" className={collapsed ? 'lg:hidden' : ''}><Logo /></Link>
            <button type="button" onClick={closeNav} aria-label="Close menu" className="rounded-lg p-1.5 text-ink-500 hover:bg-surface-2 pointer-coarse:p-3 lg:hidden">
              <X className="h-5 w-5" />
            </button>
            <button type="button" onClick={toggleCollapsed} aria-label={collapsed ? 'Expand the menu' : 'Collapse the menu'} title={collapsed ? 'Expand the menu' : 'Collapse the menu'}
                    className="hidden rounded-lg p-1.5 text-ink-400 hover:bg-surface-2 hover:text-ink-700 lg:block">
              {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto px-2.5 py-3">
            {mainGroups.map((group) => (
              <div key={group.label || 'overview'} className={group.label ? 'mt-4' : ''}>
                {group.label && (
                  <p className={`mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-400 ${collapsed ? 'lg:sr-only' : ''}`}>{group.label}</p>
                )}
                <div className="space-y-0.5">
                  {group.items.map((item) => <NavItem key={item.to} item={item} collapsed={collapsed} onNavigate={closeNav} />)}
                </div>
              </div>
            ))}
            {moreItems.length > 0 && (
              <div className="mt-4">
                <button type="button" onClick={() => { if (!onMorePage) setMoreOpen((v) => !v); }} aria-expanded={showMore} aria-controls="nav-more"
                        title={collapsed ? 'More' : undefined}
                        className={`flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-small text-ink-700 transition-colors duration-(--duration-fast) hover:bg-surface-2 hover:text-ink-900 pointer-coarse:h-11 ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}>
                  <Ellipsis aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-ink-400" />
                  <span className={`flex-1 text-left ${collapsed ? 'lg:sr-only' : ''}`}>More</span>
                  {!collapsed && <ChevronDown aria-hidden="true" className={`h-4 w-4 text-ink-400 transition-transform duration-(--duration-fast) ${showMore ? 'rotate-180' : ''}`} />}
                </button>
                {showMore && (
                  <div id="nav-more" className="fade-in mt-0.5 space-y-0.5">
                    {moreItems.map((item) => <NavItem key={item.to} item={item} collapsed={collapsed} onNavigate={closeNav} />)}
                  </div>
                )}
              </div>
            )}
            {/* A soft edge where the list runs under the pinned items, so a
                half-visible group label reads as "more below", not as a
                clipped layout. Sticky: once scrolled to the end it sits in
                the padding under the last link and covers nothing. */}
            <div aria-hidden="true" className="pointer-events-none sticky -bottom-3 -mx-2.5 -mb-3 h-8 bg-linear-to-t from-surface to-transparent" />
          </nav>

          <div className="shrink-0 space-y-0.5 border-t border-line px-2.5 py-3">
            {pinnedItems.map((item) => <NavItem key={item.to} item={item} collapsed={collapsed} onNavigate={closeNav} />)}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex min-h-14 items-center gap-2 border-b border-line bg-surface/95 px-3 pt-[env(safe-area-inset-top)] backdrop-blur-sm sm:gap-3 sm:px-5 print:hidden">
            <button type="button" onClick={() => setNavOpen(true)} aria-label="Open menu" aria-expanded={navOpen}
                    className="rounded-lg p-2 text-ink-700 hover:bg-surface-2 pointer-coarse:p-3 lg:hidden">
              <Menu className="h-5 w-5" />
            </button>

            {/* Business and outlet: native selects, keyboard-friendly and native on a phone. */}
            {businesses.length > 1 ? (
              <label className="min-w-0">
                <span className="sr-only">Business</span>
                <select value={businessId ?? ''} onChange={(e) => switchBusiness(Number(e.target.value))}
                        className="h-9 max-w-52 truncate rounded-lg border border-line-strong bg-surface px-3 text-small font-semibold text-ink-900 pointer-coarse:h-11">
                  {businesses.map((b) => <option key={b.business_id} value={b.business_id}>{b.name}</option>)}
                </select>
              </label>
            ) : (
              <p className="hidden truncate text-small font-semibold text-ink-900 sm:block">{business.name}</p>
            )}

            {outlets.length > 1 && (
              canViewAll ? (
                <label className="min-w-0">
                  <span className="sr-only">Outlet</span>
                  <select value={outletId ?? ''} onChange={(e) => switchOutlet(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                          className="h-9 max-w-44 truncate rounded-lg border border-line-strong bg-surface px-3 text-small font-medium text-ink-700 pointer-coarse:h-11">
                    {outlets.map((o) => <option key={o.branch_id} value={o.branch_id}>{o.name}</option>)}
                    <option value="all">All outlets</option>
                  </select>
                </label>
              ) : (
                <span className="truncate rounded-lg bg-surface-2 px-3 py-1.5 text-small font-medium text-ink-700">{outlets[0]?.name}</span>
              )
            )}

            <button type="button" onClick={() => setPaletteOpen(true)}
                    className="ml-auto flex h-9 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-small text-ink-500 hover:border-line-strong pointer-coarse:h-11 md:ml-4 md:w-64 lg:w-80">
              <Search aria-hidden="true" className="h-4 w-4" />
              <span className="hidden md:inline">Go to…</span>
              <kbd className="ml-auto hidden rounded border border-line bg-surface px-1.5 text-[11px] text-ink-500 md:block">Ctrl K</kbd>
              <span className="sr-only md:hidden">Go to a screen</span>
            </button>

            <div className="flex shrink-0 items-center gap-1 sm:gap-1.5 md:ml-auto">
              <InstallButton />
              <NotificationBell />
              <ProfileMenu user={user} role={business.role} onSignOut={signOut} />
            </div>
          </header>

          {/* key remounts the boundary on navigation, so a crash on one screen
              does not follow you to the next. */}
          <main className="flex-1 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 lg:p-8">
            {blocked ? (
              <EmptyState
                icon={Lock}
                className="mx-auto mt-10 max-w-md"
                title="You don't have access to this"
                body="Ask an owner or admin if you need it."
                action={<Button to="/app" variant="secondary" size="sm">Back to Dashboard</Button>}
              />
            ) : (
              <ErrorBoundary key={`${location.pathname}:${outletId ?? ''}`}><Outlet /></ErrorBoundary>
            )}
          </main>
        </div>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />
    </div>
  );
};

export default AppShell;
