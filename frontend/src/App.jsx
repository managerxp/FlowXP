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
import ProductPage from './site/ProductPage.jsx';
import IndustriesPage from './site/IndustriesPage.jsx';
import SiteIntegrations from './site/IntegrationsPage.jsx';
import AboutPage from './site/AboutPage.jsx';
import ContactPage from './site/ContactPage.jsx';
import AIPage from './site/AIPage.jsx';
import Pricing from './site/Pricing.jsx';
import { ForgotPassword, Login, ResetPassword, Signup } from './auth/AuthPages.jsx';
import { PageLoader } from './components/ui.jsx';

/* The legal pages are long text almost nobody opens on their first visit;
   keeping them out of the entry bundle keeps the landing page fast. */
const Privacy = lazy(() => import('./site/Legal.jsx').then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import('./site/Legal.jsx').then((m) => ({ default: m.Terms })));

/* The super admin console — a separate concern from the product, so it stays
   out of every bundle except its own until someone actually visits it. */
const AdminLogin = lazy(() => import('./admin/AdminLogin.jsx'));
const AdminShell = lazy(() => import('./admin/AdminShell.jsx'));
const AdminDashboard = lazy(() => import('./admin/AdminDashboard.jsx'));
const AdminBusinesses = lazy(() => import('./admin/AdminBusinesses.jsx'));
const AdminBusinessDetail = lazy(() => import('./admin/AdminBusinessDetail.jsx'));
const AdminPlans = lazy(() => import('./admin/AdminPlans.jsx'));
const AdminFeatures = lazy(() => import('./admin/AdminFeatures.jsx'));
const AdminAddons = lazy(() => import('./admin/AdminAddons.jsx'));
const AdminSettings = lazy(() => import('./admin/AdminSettings.jsx'));

/* One AdminAuthProvider instance shared by the login screen and the shell —
   two separate providers would each hold their own state, so signing in on
   the login route would be invisible to the shell it navigates to next. */
const AdminRoot = () => (
  <AdminAuthProvider>
    <Suspense fallback={<PageLoader />}>
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
const OrderReadyBoard = lazy(() => import('./app/OrderReadyBoard.jsx'));
const TablesPage = lazy(() => import('./app/TablesPage.jsx'));
const IntegrationsPage = lazy(() => import('./app/IntegrationsPage.jsx'));
const SettlementsPage = lazy(() => import('./app/SettlementsPage.jsx'));
const OutletsPage = lazy(() => import('./app/OutletsPage.jsx'));
const ReservationsPage = lazy(() => import('./app/ReservationsPage.jsx'));
const DebitNotesPage = lazy(() => import('./app/DebitNotesPage.jsx'));
const GstPage = lazy(() => import('./app/GstPage.jsx'));
const SecurityPage = lazy(() => import('./app/SecurityPage.jsx'));
const StockRequestsPage = lazy(() => import('./app/StockRequestsPage.jsx'));
const LoyaltyPage = lazy(() => import('./app/LoyaltyPage.jsx'));
const AIManagerPage = lazy(() => import('./app/AIManagerPage.jsx'));
const ActivityPage = lazy(() => import('./app/ActivityPage.jsx'));
const ReceiptPage = lazy(() => import('./app/PrintPages.jsx').then((m) => ({ default: m.ReceiptPage })));
const KotPage = lazy(() => import('./app/PrintPages.jsx').then((m) => ({ default: m.KotPage })));
const StaffPage = lazy(() => import('./app/StaffPage.jsx'));

/* The salon module (business type SALON). Its screens live in app/salon/ and load only for a salon. */
const SalonDashboard = lazy(() => import('./app/salon/SalonDashboard.jsx'));
const SalonPos = lazy(() => import('./app/salon/SalonPos.jsx'));
const SalonAppointments = lazy(() => import('./app/salon/SalonAppointments.jsx'));
const SalonClients = lazy(() => import('./app/salon/SalonClients.jsx'));
const SalonServices = lazy(() => import('./app/salon/SalonServices.jsx'));
const SalonMemberships = lazy(() => import('./app/salon/SalonMemberships.jsx'));
const SalonTeam = lazy(() => import('./app/salon/SalonTeam.jsx'));
const SalonStock = lazy(() => import('./app/salon/SalonStock.jsx'));
const SalonReports = lazy(() => import('./app/salon/SalonReports.jsx'));
const SalonSettings = lazy(() => import('./app/salon/SalonSettings.jsx'));

/* The page a customer's own phone opens after scanning a table's QR code —
   no login, no nav, not inside SiteLayout or AppShell at all. See
   public/CustomerMenu.jsx's header comment. */
const CustomerMenu = lazy(() => import('./public/CustomerMenu.jsx'));
const SalonBooking = lazy(() => import('./public/SalonBooking.jsx'));
const BillPage = lazy(() => import('./public/BillPage.jsx'));
const MessagingPage = lazy(() => import('./app/MessagingPage.jsx'));
const ReviewsPage = lazy(() => import('./app/ReviewsPage.jsx'));

/*
 * The gate for signed-in pages that render outside AppShell.
 *
 * AppShell does this check itself for everything inside it; onboarding is the
 * one authenticated screen that deliberately sits outside the shell, and it
 * needs the same guard rather than a copy of it.
 */
const RequireAuth = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
};

/* The front page of the app is the salon's own dashboard for a salon, the general one otherwise. */
const HomeRoute = () => {
  const { business } = useAuth();
  return business?.business_type === 'SALON' ? <SalonDashboard /> : <Dashboard />;
};

const App = () => (
  <Routes>
    {/* Public */}
    <Route element={<SiteLayout />}>
      <Route index element={<Home />} />
      <Route path="features" element={<ProductPage />} />
      <Route path="industries" element={<IndustriesPage />} />
      <Route path="ai" element={<AIPage />} />
      <Route path="integrations" element={<SiteIntegrations />} />
      <Route path="about" element={<AboutPage />} />
      <Route path="contact" element={<ContactPage />} />
      <Route path="pricing" element={<Pricing />} />
      <Route path="privacy" element={<Suspense fallback={<PageLoader />}><Privacy /></Suspense>} />
      <Route path="terms" element={<Suspense fallback={<PageLoader />}><Terms /></Suspense>} />
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
        <Suspense fallback={<PageLoader label="Loading FlowXP…" />}>
          <AppShell />
        </Suspense>
      }
    >
      <Route index element={<HomeRoute />} />
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
      <Route path="kitchen/board" element={<OrderReadyBoard />} />
      <Route path="tables" element={<TablesPage />} />
      <Route path="reservations" element={<ReservationsPage />} />
      <Route path="debit-notes" element={<DebitNotesPage />} />
      <Route path="gst" element={<GstPage />} />
      <Route path="security" element={<SecurityPage />} />
      <Route path="stock-requests" element={<StockRequestsPage />} />
      <Route path="integrations" element={<IntegrationsPage />} />
      <Route path="settlements" element={<SettlementsPage />} />
      <Route path="outlets" element={<OutletsPage />} />
      <Route path="loyalty" element={<LoyaltyPage />} />
      <Route path="messaging" element={<MessagingPage />} />
      <Route path="reviews" element={<ReviewsPage />} />
      <Route path="ai" element={<AIManagerPage />} />
      <Route path="print/receipt/:id" element={<ReceiptPage />} />
      <Route path="print/kot/:id" element={<KotPage />} />
      <Route path="staff" element={<StaffPage />} />

      <Route path="salon/pos" element={<SalonPos />} />
      <Route path="salon/appointments" element={<SalonAppointments />} />
      <Route path="salon/clients" element={<SalonClients />} />
      <Route path="salon/services" element={<SalonServices />} />
      <Route path="salon/memberships" element={<SalonMemberships />} />
      <Route path="salon/team" element={<SalonTeam />} />
      <Route path="salon/stock" element={<SalonStock />} />
      <Route path="salon/reports" element={<SalonReports />} />
      <Route path="salon/settings" element={<SalonSettings />} />
      <Route path="activity" element={<ActivityPage />} />

    </Route>

    {/* A customer's own phone — no login, no nav, no SiteLayout/AppShell
        chrome at all. The first bare page in this app; see
        public/CustomerMenu.jsx. */}
    <Route path="book/:slug" element={<Suspense fallback={<PageLoader />}><SalonBooking /></Suspense>} />
    <Route path="bill/:token" element={<Suspense fallback={<PageLoader />}><BillPage /></Suspense>} />
    <Route
      path="order/:token"
      element={
        <Suspense fallback={<PageLoader label="Loading menu…" />}>
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
          <Suspense fallback={<PageLoader />}>
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
        <Route path="features" element={<AdminFeatures />} />
        <Route path="addons" element={<AdminAddons />} />
        <Route path="settings" element={<AdminSettings />} />
      </Route>
    </Route>

    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

export default App;
