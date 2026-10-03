/*
 * Routes.
 *
 * The whole product's URL map on one screen, which is where you want to be
 * able to answer "is this page behind a login?". Everything under /app is
 * inside AppShell, which is the gate.
 */
import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { useAuth } from './context/AuthContext.jsx';
import { AdminAuthProvider } from './admin/AdminAuthContext.jsx';
import SiteLayout from './site/SiteLayout.jsx';
import Home from './site/Home.jsx';
import ProductPage from './site/ProductPage.jsx';
import IndustriesPage from './site/IndustriesPage.jsx';
import IndustryDetail from './site/industries/IndustryDetail.jsx';
import ComingSoonPage from './site/industries/ComingSoon.jsx';
import SiteIntegrations from './site/IntegrationsPage.jsx';
import AboutPage from './site/AboutPage.jsx';
import ContactPage from './site/ContactPage.jsx';
import AIPage from './site/AIPage.jsx';
import Pricing from './site/Pricing.jsx';
import NotFoundPage from './site/NotFoundPage.jsx';
import { ForgotPassword, Login, Signup } from './auth/AuthPages.jsx';
import { Button, EmptyState, PageLoader } from './components/ui.jsx';

/* The legal pages are long text almost nobody opens on their first visit;
   keeping them out of the entry bundle keeps the landing page fast. */
const Privacy = lazy(() => import('./site/Legal.jsx').then((m) => ({ default: m.Privacy })));
const Terms = lazy(() => import('./site/Legal.jsx').then((m) => ({ default: m.Terms })));
const CookiePolicy = lazy(() => import('./site/Legal.jsx').then((m) => ({ default: m.Cookies })));

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
const RetailStockPage = lazy(() => import('./app/RetailStockPage.jsx'));
const ReceiveStockPage = lazy(() => import('./app/ReceiveStockPage.jsx'));
const StockCountPage = lazy(() => import('./app/StockCountPage.jsx'));
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

/* The wholesale module (WHOLESALE and DISTRIBUTOR). Its screens live in app/wholesale/ and load only for those businesses. */
const WholesaleDashboard = lazy(() => import('./app/wholesale/WholesaleDashboard.jsx'));
const WholesaleOrders = lazy(() => import('./app/wholesale/WholesaleOrders.jsx'));
const WholesaleOrderEditor = lazy(() => import('./app/wholesale/OrderEditor.jsx'));
const WholesaleOrderDetail = lazy(() => import('./app/wholesale/OrderDetail.jsx'));
const WholesaleFulfilment = lazy(() => import('./app/wholesale/WholesaleFulfilment.jsx'));
const WholesaleCustomers = lazy(() => import('./app/wholesale/WholesaleCustomers.jsx'));
const WholesaleCustomerProfile = lazy(() => import('./app/wholesale/CustomerProfile.jsx'));
const WholesaleSuppliers = lazy(() => import('./app/wholesale/WholesaleSuppliers.jsx'));
const WholesaleSupplierProfile = lazy(() => import('./app/wholesale/SupplierProfile.jsx'));
const WholesaleProducts = lazy(() => import('./app/wholesale/WholesaleProducts.jsx'));
const WholesaleInventory = lazy(() => import('./app/wholesale/WholesaleInventory.jsx'));
const WholesalePurchasing = lazy(() => import('./app/wholesale/WholesalePurchasing.jsx'));
const WholesalePurchaseEditor = lazy(() => import('./app/wholesale/PurchaseEditor.jsx'));
const WholesalePurchaseDetail = lazy(() => import('./app/wholesale/PurchaseDetail.jsx'));
const WholesaleMoney = lazy(() => import('./app/wholesale/WholesaleMoney.jsx'));
const WholesaleReturns = lazy(() => import('./app/wholesale/WholesaleReturns.jsx'));
const WholesaleReports = lazy(() => import('./app/wholesale/WholesaleReports.jsx'));
const WholesaleSettings = lazy(() => import('./app/wholesale/WholesaleSettings.jsx'));
const WholesaleLabels = lazy(() => import('./app/wholesale/LabelsPrint.jsx'));
/* The distributor layer (principals, territories and beats, sales team, schemes, vans, field sales). */
const DistributorDashboard = lazy(() => import('./app/distributor/DistributorDashboard.jsx'));
const DistributorPrincipals = lazy(() => import('./app/distributor/Principals.jsx'));
const DistributorTerritories = lazy(() => import('./app/distributor/Territories.jsx'));
const DistributorTeam = lazy(() => import('./app/distributor/SalesTeam.jsx'));
const DistributorSchemes = lazy(() => import('./app/distributor/Schemes.jsx'));
const DistributorVehicles = lazy(() => import('./app/distributor/Vehicles.jsx'));
const DistributorVehicleDetail = lazy(() => import('./app/distributor/VehicleDetail.jsx'));
const DistributorField = lazy(() => import('./app/distributor/FieldSales.jsx'));
const WholesaleOrderPrint = lazy(() => import('./app/wholesale/WholesalePrint.jsx').then((m) => ({ default: m.OrderPrint })));
const WholesaleChallanPrint = lazy(() => import('./app/wholesale/WholesalePrint.jsx').then((m) => ({ default: m.ChallanPrint })));
const WholesalePickPrint = lazy(() => import('./app/wholesale/WholesalePrint.jsx').then((m) => ({ default: m.PickPrint })));

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

/* The pharmacy module (business type PHARMACY). Its screens live in app/pharmacy/ and load only for a pharmacy. */
const PharmacyDashboard = lazy(() => import('./app/pharmacy/PharmacyDashboard.jsx'));
const PharmacyPos = lazy(() => import('./app/pharmacy/PharmacyPos.jsx'));
const PharmacyProducts = lazy(() => import('./app/pharmacy/PharmacyProducts.jsx'));
const PharmacyInventory = lazy(() => import('./app/pharmacy/PharmacyInventory.jsx'));
const PharmacyGrn = lazy(() => import('./app/pharmacy/PharmacyGrn.jsx'));

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
  if (business?.business_type === 'SALON') return <SalonDashboard />;
  if (business?.business_type === 'PHARMACY') return <PharmacyDashboard />;
  if (['WHOLESALE', 'DISTRIBUTOR'].includes(business?.business_type)) return business?.distributor_enabled ? <DistributorDashboard /> : <WholesaleDashboard />;
  return <Dashboard />;
};

/* A mistyped or retired address inside the app: say so, inside the shell, with the way back. */
const AppNotFound = () => (
  <EmptyState icon={Compass} className="mx-auto mt-10 max-w-md" title="This page isn't here"
              body="The link may be old or mistyped. Everything you can open is in the sidebar, or press Ctrl K to search."
              action={<Button to="/app" variant="secondary" size="sm">Back to Dashboard</Button>} />
);

const App = () => (
  <Routes>
    {/* Public */}
    <Route element={<SiteLayout />}>
      <Route index element={<Home />} />
      <Route path="features" element={<ProductPage />} />
      <Route path="industries" element={<IndustriesPage />} />
      <Route path="industries/coming-soon" element={<ComingSoonPage />} />
      <Route path="industries/:slug" element={<IndustryDetail />} />
      <Route path="ai" element={<AIPage />} />
      <Route path="integrations" element={<SiteIntegrations />} />
      <Route path="about" element={<AboutPage />} />
      <Route path="contact" element={<ContactPage />} />
      <Route path="pricing" element={<Pricing />} />
      <Route path="privacy" element={<Suspense fallback={<PageLoader />}><Privacy /></Suspense>} />
      <Route path="terms" element={<Suspense fallback={<PageLoader />}><Terms /></Suspense>} />
      <Route path="cookies" element={<Suspense fallback={<PageLoader />}><CookiePolicy /></Suspense>} />
      {/* Anything the site does not have: a real "not found" page (noindex, see site/seo.js), not a redirect home. */}
      <Route path="*" element={<NotFoundPage />} />
    </Route>

    {/* Auth — outside SiteLayout: a signup form does not need a nav bar
        offering seven ways to leave it. */}
    <Route path="login" element={<Login />} />
    <Route path="signup" element={<Signup />} />
    {/* reset-password is no longer a route: the code is entered on /forgot-password itself now, not via an
        emailed link to a separate page — see AuthPages.jsx's header comment on ForgotPassword. */}
    <Route path="forgot-password" element={<ForgotPassword />} />

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
      <Route path="stock" element={<RetailStockPage />} />
      <Route path="stock/receive" element={<ReceiveStockPage />} />
      <Route path="stock/counts/:id" element={<StockCountPage />} />
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

      <Route path="wholesale/orders" element={<WholesaleOrders />} />
      <Route path="wholesale/orders/new" element={<WholesaleOrderEditor />} />
      <Route path="wholesale/orders/:id" element={<WholesaleOrderDetail />} />
      <Route path="wholesale/orders/:id/edit" element={<WholesaleOrderEditor />} />
      <Route path="wholesale/orders/:id/print" element={<WholesaleOrderPrint />} />
      <Route path="wholesale/fulfilment" element={<WholesaleFulfilment />} />
      <Route path="wholesale/deliveries/:id/print" element={<WholesaleChallanPrint />} />
      <Route path="wholesale/pick-lists/:id/print" element={<WholesalePickPrint />} />
      <Route path="wholesale/customers" element={<WholesaleCustomers />} />
      <Route path="wholesale/customers/:id" element={<WholesaleCustomerProfile />} />
      <Route path="wholesale/suppliers" element={<WholesaleSuppliers />} />
      <Route path="wholesale/suppliers/:id" element={<WholesaleSupplierProfile />} />
      <Route path="wholesale/products" element={<WholesaleProducts />} />
      <Route path="wholesale/labels" element={<WholesaleLabels />} />
      <Route path="wholesale/inventory" element={<WholesaleInventory />} />
      <Route path="wholesale/purchasing" element={<WholesalePurchasing />} />
      <Route path="wholesale/purchasing/new" element={<WholesalePurchaseEditor />} />
      <Route path="wholesale/purchasing/:id" element={<WholesalePurchaseDetail />} />
      <Route path="wholesale/purchasing/:id/edit" element={<WholesalePurchaseEditor />} />
      <Route path="wholesale/money" element={<WholesaleMoney />} />
      <Route path="wholesale/returns" element={<WholesaleReturns />} />
      <Route path="wholesale/reports" element={<WholesaleReports />} />
      <Route path="wholesale/settings" element={<WholesaleSettings />} />
      <Route path="distributor/principals" element={<DistributorPrincipals />} />
      <Route path="distributor/territories" element={<DistributorTerritories />} />
      <Route path="distributor/team" element={<DistributorTeam />} />
      <Route path="distributor/schemes" element={<DistributorSchemes />} />
      <Route path="distributor/vehicles" element={<DistributorVehicles />} />
      <Route path="distributor/vehicles/:id" element={<DistributorVehicleDetail />} />
      <Route path="distributor/field" element={<DistributorField />} />

      <Route path="salon/pos" element={<SalonPos />} />
      <Route path="salon/appointments" element={<SalonAppointments />} />
      <Route path="salon/clients" element={<SalonClients />} />
      <Route path="salon/services" element={<SalonServices />} />
      <Route path="salon/memberships" element={<SalonMemberships />} />
      <Route path="salon/team" element={<SalonTeam />} />
      <Route path="salon/stock" element={<SalonStock />} />
      <Route path="salon/reports" element={<SalonReports />} />
      <Route path="salon/settings" element={<SalonSettings />} />

      <Route path="pharmacy/pos" element={<PharmacyPos />} />
      <Route path="pharmacy/products" element={<PharmacyProducts />} />
      <Route path="pharmacy/inventory" element={<PharmacyInventory />} />
      <Route path="pharmacy/grn" element={<PharmacyGrn />} />

      <Route path="activity" element={<ActivityPage />} />
      <Route path="*" element={<AppNotFound />} />

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

  </Routes>
);

export default App;
