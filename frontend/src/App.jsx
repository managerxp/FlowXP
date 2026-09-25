/*
 * Routes.
 *
 * The whole product's URL map on one screen, which is where you want to be
 * able to answer "is this page behind a login?". Everything under /app is
 * inside AppShell, which is the gate.
 */
import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { AdminAuthProvider } from './admin/AdminAuthContext.jsx';
import SiteLayout from './site/SiteLayout.jsx';
import Home from './site/Home.jsx';
import MarketingPage from './site/MarketingPage.jsx';
import AIPage from './site/AIPage.jsx';
import Pricing from './site/Pricing.jsx';
import { Privacy, Terms } from './site/Legal.jsx';
import { ForgotPassword, Login, ResetPassword, Signup } from './auth/AuthPages.jsx';
import ComingSoon from './app/ComingSoon.jsx';

/* The super admin console — a separate concern from the product, so it stays
   out of every bundle except its own until someone actually visits it. */
const AdminLogin = lazy(() => import('./admin/AdminLogin.jsx'));
const AdminShell = lazy(() => import('./admin/AdminShell.jsx'));
const AdminDashboard = lazy(() => import('./admin/AdminDashboard.jsx'));
const AdminBusinesses = lazy(() => import('./admin/AdminBusinesses.jsx'));
const AdminBusinessDetail = lazy(() => import('./admin/AdminBusinessDetail.jsx'));
const AdminPlans = lazy(() => import('./admin/AdminPlans.jsx'));

/* One AdminAuthProvider instance shared by the login screen and the shell —
   two separate providers would each hold their own state, so signing in on
   the login route would be invisible to the shell it navigates to next. */
const AdminRoot = () => (
  <AdminAuthProvider>
    <Suspense fallback={<p className="p-8 text-sm text-ink-400">Loading…</p>}>
      <Outlet />
    </Suspense>
  </AdminAuthProvider>
);

/*
 * The app is split out of the marketing bundle. A visitor reading the pricing
 * page should not download the dashboard, and the landing page is the one that
 * has to be fast.
 */
const AppShell = lazy(() => import('./app/AppShell.jsx'));
const Dashboard = lazy(() => import('./app/Dashboard.jsx'));
const Onboarding = lazy(() => import('./app/Onboarding.jsx'));
const Subscription = lazy(() => import('./app/Subscription.jsx'));
const BusinessSettings = lazy(() => import('./app/BusinessSettings.jsx'));
const ProductsPage = lazy(() => import('./app/ProductsPage.jsx'));
const ModifiersPage = lazy(() => import('./app/ModifiersPage.jsx'));
const ProfitabilityPage = lazy(() => import('./app/ProfitabilityPage.jsx'));
const LeakagePage = lazy(() => import('./app/LeakagePage.jsx'));
const ForecastPage = lazy(() => import('./app/ForecastPage.jsx'));
const NotificationsPage = lazy(() => import('./app/NotificationsPage.jsx'));
const CustomersPage = lazy(() => import('./app/CustomersPage.jsx'));
const SuppliersPage = lazy(() => import('./app/SuppliersPage.jsx'));
const InventoryPage = lazy(() => import('./app/InventoryPage.jsx'));
const ExpensesPage = lazy(() => import('./app/ExpensesPage.jsx'));
const PurchasesPage = lazy(() => import('./app/PurchasesPage.jsx'));
const PaymentsPage = lazy(() => import('./app/PaymentsPage.jsx'));
const ReportsPage = lazy(() => import('./app/ReportsPage.jsx'));
const BillingPage = lazy(() => import('./app/billing/BillingPage.jsx'));
const InvoicesPage = lazy(() => import('./app/billing/InvoicesPage.jsx'));
const InvoiceDetail = lazy(() => import('./app/billing/InvoiceDetail.jsx'));
const CreditNotesPage = lazy(() => import('./app/billing/CreditNotesPage.jsx'));
const CreditNotePrint = lazy(() => import('./app/PrintPages.jsx').then((m) => ({ default: m.CreditNotePage })));
const OrdersPage = lazy(() => import('./app/OrdersPage.jsx'));
const KitchenDisplay = lazy(() => import('./app/KitchenDisplay.jsx'));
const KitchenPerformancePage = lazy(() => import('./app/KitchenPerformancePage.jsx'));
const TablesPage = lazy(() => import('./app/TablesPage.jsx'));
const IntegrationsPage = lazy(() => import('./app/IntegrationsPage.jsx'));
const OutletsPage = lazy(() => import('./app/OutletsPage.jsx'));
const ReservationsPage = lazy(() => import('./app/ReservationsPage.jsx'));
const LoyaltyPage = lazy(() => import('./app/LoyaltyPage.jsx'));
const AIManagerPage = lazy(() => import('./app/AIManagerPage.jsx'));
const ActivityPage = lazy(() => import('./app/ActivityPage.jsx'));
const ReceiptPage = lazy(() => import('./app/PrintPages.jsx').then((m) => ({ default: m.ReceiptPage })));
const KotPage = lazy(() => import('./app/PrintPages.jsx').then((m) => ({ default: m.KotPage })));
const StaffPage = lazy(() => import('./app/StaffPage.jsx'));

/* The page a customer's own phone opens after scanning a table's QR code —
   no login, no nav, not inside SiteLayout or AppShell at all. See
   public/CustomerMenu.jsx's header comment. */
const CustomerMenu = lazy(() => import('./public/CustomerMenu.jsx'));

/* Screens still to come (none right now: every app page has a real screen). */
const PENDING = [];

/*
 * The gate for signed-in pages that render outside AppShell.
 *
 * AppShell does this check itself for everything inside it; onboarding is the
 * one authenticated screen that deliberately sits outside the shell, and it
 * needs the same guard rather than a copy of it.
 */
const RequireAuth = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <p className="p-8 text-sm text-ink-400">Loading…</p>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
};

const App = () => (
  <Routes>
    {/* Public */}
    <Route element={<SiteLayout />}>
      <Route index element={<Home />} />
      <Route path="features" element={<MarketingPage page="features" />} />
      <Route path="industries" element={<MarketingPage page="industries" />} />
      <Route path="ai" element={<AIPage />} />
      <Route path="integrations" element={<MarketingPage page="integrations" />} />
      <Route path="about" element={<MarketingPage page="about" />} />
      <Route path="contact" element={<MarketingPage page="contact" />} />
      <Route path="pricing" element={<Pricing />} />
      <Route path="privacy" element={<Privacy />} />
      <Route path="terms" element={<Terms />} />
    </Route>

    {/* Auth — outside SiteLayout: a signup form does not need a nav bar
        offering seven ways to leave it. */}
    <Route path="login" element={<Login />} />
    <Route path="signup" element={<Signup />} />
    <Route path="forgot-password" element={<ForgotPassword />} />
    <Route path="reset-password" element={<ResetPassword />} />

    {/* The product */}
    <Route
      path="app"
      element={
        <Suspense fallback={<p className="p-8 text-sm text-ink-400">Loading FlowXP…</p>}>
          <AppShell />
        </Suspense>
      }
    >
      <Route index element={<Dashboard />} />
      <Route path="settings/subscription" element={<Subscription />} />
      <Route path="settings/business" element={<BusinessSettings />} />
      <Route path="settings" element={<Navigate to="/app/settings/business" replace />} />

      <Route path="billing" element={<BillingPage />} />
      <Route path="billing/invoices" element={<InvoicesPage />} />
      <Route path="billing/invoices/:id" element={<InvoiceDetail />} />
      <Route path="billing/credit-notes" element={<CreditNotesPage />} />
      <Route path="print/credit-note/:id" element={<CreditNotePrint />} />
      <Route path="products" element={<ProductsPage />} />
      <Route path="modifiers" element={<ModifiersPage />} />
      <Route path="profitability" element={<ProfitabilityPage />} />
      <Route path="leakage" element={<LeakagePage />} />
      <Route path="forecast" element={<ForecastPage />} />
      <Route path="notifications" element={<NotificationsPage />} />
      <Route path="customers" element={<CustomersPage />} />
      <Route path="suppliers" element={<SuppliersPage />} />
      <Route path="inventory" element={<InventoryPage />} />
      <Route path="purchases" element={<PurchasesPage />} />
      <Route path="expenses" element={<ExpensesPage />} />
      <Route path="payments" element={<PaymentsPage />} />
      <Route path="reports" element={<ReportsPage />} />
      <Route path="orders" element={<OrdersPage />} />
      <Route path="kitchen" element={<KitchenDisplay />} />
      <Route path="kitchen/performance" element={<KitchenPerformancePage />} />
      <Route path="tables" element={<TablesPage />} />
      <Route path="reservations" element={<ReservationsPage />} />
      <Route path="integrations" element={<IntegrationsPage />} />
      <Route path="outlets" element={<OutletsPage />} />
      <Route path="loyalty" element={<LoyaltyPage />} />
      <Route path="ai" element={<AIManagerPage />} />
      <Route path="print/receipt/:id" element={<ReceiptPage />} />
      <Route path="print/kot/:id" element={<KotPage />} />
      <Route path="staff" element={<StaffPage />} />
      <Route path="activity" element={<ActivityPage />} />

      {PENDING.map(([path, title, priority, body]) => (
        <Route key={path} path={path} element={<ComingSoon title={title} priority={priority} body={body} />} />
      ))}
    </Route>

    {/* A customer's own phone — no login, no nav, no SiteLayout/AppShell
        chrome at all. The first bare page in this app; see
        public/CustomerMenu.jsx. */}
    <Route
      path="order/:token"
      element={
        <Suspense fallback={<p className="p-8 text-sm text-ink-400">Loading menu…</p>}>
          <CustomerMenu />
        </Suspense>
      }
    />

    {/* Onboarding sits outside AppShell — a wizard with the full sidebar
        beside it invites people to wander off mid-setup — so it carries its
        own guard and its own page frame. */}
    <Route
      path="app/onboarding"
      element={
        <RequireAuth>
          <Suspense fallback={<p className="p-8 text-sm text-ink-400">Loading…</p>}>
            <div className="min-h-full bg-surface-2 px-5 py-12 sm:py-16">
              <Onboarding />
            </div>
          </Suspense>
        </RequireAuth>
      }
    />

    {/* Platform administration — its own login, its own shell, no relation
        to the business auth above. See AdminRoot's comment for why both
        routes share one provider. */}
    <Route element={<AdminRoot />}>
      <Route path="superadmin/login" element={<AdminLogin />} />
      <Route path="superadmin" element={<AdminShell />}>
        <Route index element={<AdminDashboard />} />
        <Route path="businesses" element={<AdminBusinesses />} />
        <Route path="businesses/:id" element={<AdminBusinessDetail />} />
        <Route path="plans" element={<AdminPlans />} />
      </Route>
    </Route>

    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

export default App;
