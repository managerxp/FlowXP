# FlowXP brain

> **Moving to another laptop or starting a new session: read `HANDOFF.md` first** (setup, how to run, current status, next steps). Mobile app: `MOBILE.md`, readiness report: `MOBILE_AUDIT.md`.


One file to remember the whole product: what it is, how it is built, the rules the code follows, what exists, and
what is left. Read this first in a new session. `documentation.md` has the long per-feature detail (API, schema,
edge cases); this file is the map and the memory. Keep it current: update the status tables when a feature ships.

Last updated: 2026-10-04 (see 4c) (Tables/Orders/Kitchen/Reservations/Customers/Inventory/Purchases/Suppliers/Expenses/Payments/Invoices/Products/Options/Reports redesign, tap-to-add orders, order board, QR menu and loyalty redesign, UPI QR at the till, billing↔kitchen counter sales, RBAC nav fix, delivery accept/reject + loud pop-up alert, onboarding redesign (+ Flow AI onboarding chat, "use current location"), country/state address engine, Cashfree subscription payment links, real Privacy/Terms text + required signup acceptance checkbox, real per-plan + per-business-type-per-plan feature gating (incl. QR ordering and delivery integrations) + admin Features page, admin plan/business-type override, Cloud Kitchen business type (no Tables/Reservations/QR ordering for it), business-type feature picker redesigned as a dropdown then made plan-aware, Super Admin audit + plan versioning/grandfathering + subscription history + business feature overrides, Overview dashboard MRR/revenue-by-month/pending-payments/trials-ending-soon + a real-revenue bug fix, paid add-ons catalog (fully admin-editable + business-type categorised) + per-business Cashfree add-on links, 3-plan pricing ladder, platform settings (payment gateway + messaging off .env), customer feedback & reviews (post-bill ratings, private unless happy, AI reply drafts), multi-brand (one kitchen, several virtual brands) after auditing a 40-section "Cloud Kitchen module" spec and reusing almost all of it, delivery rider/fleet management (own staff, new DELIVERY role) and aggregator settlement reconciliation (paste-a-statement import + arithmetic/value checks, no real aggregator API access needed). 47 migrations, 522 backend tests passing.

---

## 1. What FlowXP is

A multi-tenant SaaS for running a business: billing, GST, inventory, purchasing, customers, reports, AI. **Restaurants
first** (the deepest vertical), then salon, retail, wholesale and other billing businesses on the same core.
Product of ManagerXP. Standalone: its own server and Postgres, nothing shared with `managerxp-platform`.

- Repo: `D:\ManagerXp\flowxp` → GitHub `managerxp/FlowXP`, branch **`Feature`** (`main` and `develop` exist untouched).
- **Do not `git push`.** The owner pushes manually. Do not commit unless asked. (Pushed up to `354e728`; everything after
  that (the phone app / offline sales work, the phone-layout fixes and this file) is local only.)
- Owner works in small steps: says "next" and expects the next pending feature, built, tested, and documented, with a
  short plain-language wrap-up (what it does, what is not included, what they must do to go live).

## 2. Stack and how to run

| Layer | Choice |
|---|---|
| Backend | Node (ESM), Express 4, raw `pg` (no ORM), `express-async-errors`, JWT auth, bcryptjs, multer, express-rate-limit |
| DB | PostgreSQL. Forward-only JS migrations in `backend/migrations` (`0001`–`0028`), run at boot by `config/migrate.js` |
| Frontend | Vite 7, React 19, React Router 7, Tailwind 4, GSAP (marketing), qrcode. No UI kit; own components in `components/ui.jsx` |
| Ports | API **5100**, web dev **5174** (Vite proxies `/api` and `/uploads` to 5100) |
| Tests | `node --test` in `backend/` (real Postgres, one throwaway DB per test file, see `test/helpers/db.js`) |
| Deploy | One VPS, no containers: Postgres + API under PM2 (`ecosystem.config.cjs`) + nginx serving the frontend build and proxying `/api` (`deploy/nginx.conf`), GitHub Actions CI, `DEPLOY.md`. **Written, never run against a live server** |

```
cd backend && npm start          # API :5100, migrates on boot
cd backend && npm test           # ~320 tests, ~1-2 min
cd backend && npm run seed:demo  # demo restaurant data (then `npm run seed:live` adds today's open tables, kitchen tickets, bookings, reviews)
cd backend && npm run seed:salon | seed:pharmacy | seed:distributor   # the other demo businesses (salon@, pharmacy@, wholesale@ flowxp.test, password demo1234)
cd frontend && npm run dev       # web :5174
cd frontend && npx vite build    # production build (also writes dist/precache.json)
```

Demo login (seed file, local only): `demo@flowxp.test` / `demo1234`; staff `demo-manager@`, `demo-cashier@`,
`demo-cashier-indiranagar@`, `demo-cashier-koramangala@`, `demo-waiter@`, `demo-kitchen@`, `demo-inventory@`
(all `@flowxp.test`, same password). 3 outlets: MG Road, Indiranagar, Koramangala. Login is rate limited (10 / 15 min).

## 3. Architecture (the shape of the code)

```
backend/
  server.js                 app wiring: env CORS allowlist, request id + JSON access log, /health, /ready, /uploads (local driver only)
  src/config/               env.js (validation, production checks), database.js, migrate.js, schema.*.js (older schema)
  src/middleware/           auth.js (requireAuth, withBusiness, requirePermission, requireOutlet, requireGroupUser, ROLE_PERMISSIONS),
                            idempotency.js, upload.js (memory multer: product image, menu photos, logo)
  src/routes/*.routes.js    one file per domain, mounted in routes/index.js
  src/controllers/*.js      HTTP: validate, scope, shape (paise -> rupees at the edge)
  src/modules/*.js          the rules (billing, stock, loyalty, points, coupons, combos, messaging/, ai/, escpos, ...)
  src/utils/                money.js (paise), scope.js (branchFilter), dates.js (businessToday)
  scripts/                  seed-demo.js, backup.sh
  test/                     one file per feature + helpers/db.js
frontend/
  src/App.jsx               all routes (lazy pages); public routes: /order/:token (QR menu), /bill/:token
  src/app/                  signed-in app pages; AppShell.jsx = nav, outlet switcher, offline banner, install button
  src/site/                 marketing site; src/admin/ super-admin; src/auth/ login/signup
  src/lib/                  api.js, printing.js (silent print), offline*.js + pwa.js (PWA), idempotency.js, dates.js
  public/                   sw.js (service worker), manifest, icons
print-agent/                agent.js: tiny local program for silent thermal printing (no deps)
```

### Tenancy and scoping (the most important rule)
- **Business = tenant.** Every row carries `business_id`; every query filters it. Another business must always get 404.
- `withBusiness()` builds `req.tenant = { businessId, branchId, scopeBranchId, viewAll, pinned, multiOutlet, role, permissions, subscription }`.
  `X-Business-Id` and `X-Branch-Id` headers are *claims*, verified server-side (pinned users are forced to their outlet).
- **Outlet = `branches` row.** `scopeBranchId` is the outlet a read is limited to (NULL only for a group user's "All outlets" view).
  Use `branchFilter(tenant, 'col', params)` from `utils/scope.js` on **list and by-id** access. Writes use `tenant.branchId` and
  `requireOutlet` (rejects writes in the All-outlets view).
- Menu (products, categories, modifiers) is business-wide, recipes have a default plus optional per-outlet override, kitchen stations are per outlet or shared; per-outlet **price/availability** in `product_branch_settings`;
  per-outlet **stock** in `branch_stock` (`products.current_stock` = total; all writes via `modules/stock.js moveStock`).
- Roles: OWNER, ADMIN, MANAGER, CASHIER, STAFF, WAITER, KITCHEN, INVENTORY_MANAGER. Per-user permission overrides
  (`business_users.permissions`). Permissions: billing, kitchen, products, inventory, purchases, suppliers, customers, payments,
  expenses, refunds, reports, gst, export, ai, settings. `business_users.branch_id` NULL = group user, set = pinned to one outlet.

### Money and numbers
- **Integer paise everywhere** in DB and logic (`BIGINT *_paise`); convert to rupees only in controllers (`toRupees`/`toPaise`).
- Quantities `NUMERIC(14,3)`. GST computed per line in `modules/tax.js` (CGST/SGST vs IGST by outlet state vs customer state).
- Invoice numbers per business (`INV-0001`) or, when an outlet has its own prefix, per outlet (`IND-0001`), orders `ORD-`, KOT `KOT-`, credit notes `CN-`, all claimed atomically with `FOR UPDATE`.

### Idempotency
Money-moving POSTs use `Idempotency-Key` (middleware `idempotent()`; server keeps 48 h). Frontend: `useIdempotencyKey()` keeps the key
across a network failure. The offline queue reuses the same key, which is why replaying a sale can never bill twice.

### Side effects after commit
`recordAudit`, `afterBill` (messaging), `recordEvent` are **fire-and-forget after COMMIT** and swallow errors: a message or audit
problem must never fail a sale. In tests, poll (`until`) for their results.

### Stock and recipes
`modules/stock.js moveStock` is the only writer. Dishes consume ingredients by recipe (`recipe_items`, wastage %); modifiers can carry
ingredients; **combos** (`products.is_combo`, `combo_items`) bill as one line but consume their parts (`modules/combos.js`).
Ingredient stock may go negative (kitchens keep selling); tracked finished products are oversell-checked per outlet.

### Features wired through billing (`modules/billing.js createInvoiceInTransaction`)
Tax, stock, recipes/combos, loyalty visit reward (line discount), coupon, **points redemption** (invoice discount), round-off, payments,
loyalty/points ledger writes, then `afterBill` hook. Orders (`orders.controller bill`) and POS (`invoices.controller create`) both call it.

### Providers with test doubles
AI (`modules/ai/provider.js`, `setProvider`), messaging (`modules/messaging/provider.js`, `setProvider`), storage (`modules/storage.js`
local | s3 with hand-written SigV4). Real services are **untested live** (no keys on dev machine).

### Frontend conventions
- `lib/api.js` is the only fetch wrapper (adds token, business/outlet headers; `NetworkError` on no connection; 401 clears session).
- Pages are lazy in `App.jsx`; nav items in `AppShell.jsx` NAV_GROUPS (Sell, Restaurant, Stock, Customers, Business, Intelligence, Team + pinned SYSTEM_ITEMS; filtered by role, business type, multiOutlet) with lucide-react icons. The sidebar collapses to icons (localStorage flowxp.nav.collapsed) and is a drawer on phones; the top bar has business/outlet selects, "Go to…" (components/CommandPalette.jsx, Ctrl/⌘ K), notifications and a profile menu. Codes shown to people go through `humanize()` / StatusBadge labels in ui.jsx.
- Per-device prefs (silent printing, sound) in localStorage (`lib/printing.js`); business-wide settings on the server.
- Print views (`PrintPages.jsx`) use `@page` size + print CSS; silent thermal printing goes through the print agent.
- POS (`app/billing/BillingPage.jsx`): item grid + bill panel; payment is `{ method, amount: <cash handed over> | 'FULL' }` (the server caps a single payment at the bill, so the till never decides full vs part; change = handed over − saved total); split = `payments: [...]` with the last part 'REST'; Hold/Held = `/api/held-bills` (table held_bills, per outlet, deleted on resume).
- Billing ↔ orders (restaurant types): POST /invoices { send_to_kitchen: true } makes a TAKEAWAY order, its order_items and a KOT, and the bill, in ONE transaction (invoices.controller create; reuses nextNumber/insertOrderItems/sendKotCore); the order is BILLED at once, so it shows on the kitchen screen (billed orders stay there until served) but not in open orders; response carries order {order_number, kot_number} shown on the Done screen as the number to call. Refused for non-restaurant types; the offline queue never sends to the kitchen. BillingPage: "Send to the kitchen" switch (device pref posSendToKitchen, default on), an Orders button listing open orders; picking one (or /app/billing?order=ID) bills it here: lines come from the order, taps add to the order, − / + only on unsent lines, the customer is saved on the order, charging sends unsent lines to the kitchen (if the switch is on) then POST /orders/:id/bill (closes the order). test/countersale.test.js.
- Order-ready board (optional, no backend changes): OrderReadyBoard.jsx at /app/kitchen/board, linked from an "Order board" button on the Kitchen screen. Polls the same GET /kitchen/tickets as the Kitchen screen, filtered to order_type !== 'DINE_IN' (a table is served where it sits). Two columns: Preparing (any item PREPARING) and Ready to collect (no PREPARING left, some READY); tapping a ready card calls POST /kitchen/advance to SERVED, the same action as Kitchen's Ready tab. Sound toggle and full-screen reuse KitchenDisplay's pattern; a chime plays the moment an order first has nothing left preparing.
- Restaurant floor: `OrdersPage.jsx` (open-order list + OrderPanel, `?order=ID`; New takeaway is one click; stat strip: open orders, running bills, need attention (ready / not sent / open 45+ min, click to filter), oldest open; type chips + search by table/order/customer/waiter; cards with a state stripe and not-sent/cooking/ready bar; panel shows items + GST + loyalty lines above the total and says what Send to kitchen / Rush / Print ticket do), `TablesPage.jsx` (floor by zone; tap a free table = new dine-in order; stat strip: free/seats free, occupied, running bills, ready to serve, seated longest; filter chips All/Free/Occupied/Needs attention (ready, not sent, 90+ min)/Booked soon/Being cleaned + area select; tile stripe by state and a not-sent/cooking/ready bar; settings dialog edits name/area/seats, waiter, QR + print stand card, being cleaned/ready, remove (CLOSED, refused 409 while an order runs); Print QR cards prints every table; tables.controller validates name (unique per outlet, case-insensitive, among non-closed), seats 1–99, test/tables.test.js), `KitchenDisplay.jsx` (summary strip: to make / late / oldest / ready waiting; tickets with a bar filling towards the longest dish time, per-dish "n min left / over" and station tag, per-dish ready, Handed over for takeaway/delivery, ready tickets show minutes waiting; "Cook now" rollup of every dish still to make, tap to dim other tickets; 7-second Undo after any ready/served/back; /kitchen/tickets items carry ready_at/served_at). `ReservationsPage.jsx`: day switcher, bookings by hour (due/late from the clock), waitlist panel with quick add; the seat dialog picks a free table and can start the order (POST /orders with the guest's customer_id). Two columns from xl, a Bookings/Waitlist toggle below; booking cards lay out by container width (@container). A booking within NEAR_BOOKING_MIN (60) cannot take a table with a running order (availability + bookTable; edits check only when table/time moves).
- Customers (`CustomersPage.jsx`): list + panel (?c=ID, split from xl). The list loads all active customers once (GET /customers now also returns bills, first_bill_date, last_bill_date) and searches/filters/sorts client-side; the panel reads /customers/:id/invoices and /loyalty/customers/:id. "New bill" opens /app/billing?customer=ID, which BillingPage picks up once and clears.
- Inventory (`InventoryPage.jsx`): list + panel (?item=ID, split from xl). GET /inventory returns kind and unit_cost; GET /inventory/:id/history joins invoice_number / po_number / outlet name; the panel works the balance after each movement back from today's stock. Count mode posts the difference to /inventory/adjust with reason "Stock count[: note]" (the history labels it by that prefix). Writes are hidden in the all-outlets view. Reorder level is edited inline (PATCH /products/:id min_stock).
- Purchases (`PurchasesPage.jsx`): list + panel (?po=ID, split from xl); tabs To receive (DRAFT/ORDERED/PARTIAL) / To pay (RECEIVED or PARTIAL with balance) / All (latest 200). Edit/send/receive stay in `PurchaseOrderModal` (new `initialMode="receive"` for Goods arrived); returns in DebitNoteModal; Pay supplier is PayModal -> POST /purchases/:id/payments, which now refuses more than is owed and unknown methods. GET /purchases/:id returns payments and debited.
- Suppliers (`SuppliersPage.jsx`): list + panel (?s=ID, split from xl). suppliers.controller `selectFor(tenant, values)` counts payable, bought, received_orders, open_orders and last_po_date at the viewer's outlet scope (as Purchases does); purchase history is outlet-scoped too (test/suppliers.test.js). The price list is edited in place in the panel; "your cost now" is products.purchase_price (last price paid to anyone). New order navigates to /app/purchases with state.prefill { supplier_id, items: [] }.
- Expenses (`ExpensesPage.jsx`): period presets (this month vs the same days last month, last month, 30 days, this year, custom) with exact totals from GET /expenses/summary (by category, by method, plus the categories this outlet has used); the list (/expenses, capped 300) is grouped by day and opens to edit/delete. Categories stay free text (chips = used ones + defaults + New). create/update now check payment_method, a real calendar date and category length (test/expenses.test.js). Adding is disabled in the all-outlets view (POST needs an outlet).
- Payments (`PaymentsPage.jsx`): the payments table holds both directions; po_id set = paid to a supplier. GET /payments?direction=in|out (joins supplier + PO), GET /payments/summary?from&to -> { in, out } each with total/count/by_method. The form is only for a customer payment with no bill.
- UPI QR at the till (`components/UpiCollect.jsx`): when UPI is picked and businesses.upi_vpa is set (sent in /auth/me as upi_vpa), BillingPage and OrdersPage save the bill unpaid, then show a upi://pay QR for the exact balance with the bill number; "Payment received" posts /invoices/:id/payments (UPI, optional UTR), "Not paid yet" leaves it unpaid. Not a gateway: FlowXP cannot see the payment. Offline, the POS queues it as a plain UPI sale. invoices.addPayment now refuses more than is due and unknown methods (test/payments.test.js).
- Invoices: `InvoicesPage.jsx` = period presets + GET /invoices/summary (bills, billed, paid, refunded, due, owing, paid_bills, cancelled, average; cancelled never in totals) + tabs All/Still owed (?owing=true)/Paid/Cancelled; list rows carry created_at, order_type, platform, table_name, customer_phone. `InvoiceDetail.jsx` = the printable document (A4 via window.print; aside is print:hidden; seller GSTIN/address from invoice.seller when the outlet has none) + side column (money, Take payment with UPI QR, history of payments/refunds/credit notes) + More menu (credit note, refund, e-way bill, cancel).
- Products (`ProductsPage.jsx`): list + panel (?p=ID, split from xl); loads /products?status=all once and filters client-side (tabs Menu/Ingredients/Packaging/Archived for restaurants, All/Archived otherwise; category chips; sort incl. lowest margin; a no-cost filter). GET /products now adds cost_source (recipe|purchase|null), unit_cost and margin_pct for DISH rows (`withCosts` in products.controller: recipe cost at the viewer's outlet via modules/recipes.js, else purchase price; test/productcosts.test.js). Panel: photo upload, price with GST, cost/margin (warn under 30%), the outlet's recipe, combo parts, options, stock (links to Inventory), codes; Recipe/Combo/Outlet price editors unchanged in logic; archive and bring back (PATCH status ACTIVE).
- Options & add-ons (`ModifiersPage.jsx`, route /app/modifiers, nav label renamed from Modifiers): list + panel (?g=ID). GET /modifier-groups now returns products (active dishes offering the group); new PUT /modifier-groups/:id/products { product_ids } replaces a group's dishes (own DISH products only; test/modifiergroups.test.js). Panel: rule in words (`ruleOf`), options with price change and ingredient use, a till preview, dishes offered on + DishPicker, Turn off/on (is_active; inactive groups are ignored by billing via modules/menu.js loadProductGroups).
- Reports (`ReportsPage.jsx`): a report list (left rail / chips) + one period (presets; the sales report also fetches the period before for the change %). GET /reports/sales now adds by_hour (business timezone), by_channel (COUNTER or order_type + platform) and by_category, and by_payment_method counts money in only (po_id IS NULL; it used to include supplier payments). Plain bar charts (one series, brand blue, hover label, sr-only table); every table has a client-side CSV download. lib/business.js has PLATFORM_LABEL/platformName (test/salesreport.test.js).
- Orders: orders.updateItem numbers its WHERE parameters before branchFilter adds the outlet one (it used to shift them, so at an outlet +/- and cancel-a-line returned Not found; test/orderitems.test.js). OrderPanel has a tap-to-add MenuPicker (opens by itself on a new empty order; a repeat tap of a plain pending line bumps its quantity instead of adding a line).
- Loyalty at the till: describe() now returns reward_product_id, reward_quantity and min_bill; `RewardHint` (components/LoyaltyCard.jsx) offers "Add the free X" when the reward is due (billing only makes it free when it is on the bill) or says whether the bill earns a stamp; the order screen, POS and QR menu take the free item off their estimates. /loyalty/summary adds new_30d, active_30d, lapsed_60d, by_visits and reward_due / one_visit_away lists. LoyaltyPage Visit card tab = card preview + 3-step setup + member insights.
- QR menu (public/CustomerMenu.jsx) redesigned: logo (receipt_settings.logo_url) or initials, outlet/address, table chip, search, veg-only, category tiles, dish rows with FoodMark + photo + Add/stepper, visit card panel (check stamps, add the free item), bottom order bar + sheet. Migration 0031 adds products.food_type (VEG/NON_VEG/EGG); components/FoodMark.jsx draws the mark. The order and table lists carry a `summary` / `open_order` from one LATERAL join (items, estimate incl. GST, not_sent/cooking/ready); `GET /orders/:id` items carry `tax_rate` so the panel total includes GST. Coupons, points and round-off are only known once billed.
- Offline: `sw.js` (production only) + `offlineQueue.js` (pure, tested from backend tests).
- **Design system: `design.md` (repo root) is the authority.** Tokens live only in `src/index.css` (`@theme`): brand = the logo blue #0054FA (solid, never a gradient), ink = logo navy #011531, font Plus Jakarta Sans (has ₹ and tabular figures; type tokens text-caption/small/body 16px/lead/title/h3/h2/display, the last two fluid), flat white/near-white grounds, 8px controls, 12px cards, 16px panels, borders over shadows. `.glass`, `.text-gradient`, `.bg-gradient-brand` are retired aliases (flat). No 3D/particle effects (three.js removed). Motion tokens --duration-fast/normal/moderate/slow and --ease-standard/decelerate; .rise (on load), .reveal via components/Reveal.jsx (once on scroll), .lift (hover), all off under reduced motion. Tailwind v4 arbitrary vars are `rounded-(--radius-card)`, not `rounded-[--radius-card]`.
- App look shared with the website (2026-10-03): `.hero-stage` (index.css: brand-50 with a fading dot grid) is the website hero panel and the app's `DashboardHeader` (ui.jsx, same props as PageHeader), used by every dashboard (Dashboard, Wholesale, Distributor, Salon, Pharmacy). Dashboard visuals (2026-10-03): `components/charts.jsx` has dependency-free SVG charts (Sparkline, AreaChart with average line and a call-out bubble, Gauge, Donut with a worded legend, HourBars; sr-only tables; .chart-draw/.chart-fade/.chart-arc animations off under reduced motion) and `components/MetricCard.jsx` (icon tile + big figure + coloured change pill vs yesterday or a note + 7-day sparkline). Main Dashboard = TodayFigures, SalesChart (area) + TodayVsUsual (gauge: today vs the 13-day average) + Attention, then PaymentMix (donut) / BusyHours / TopProducts from GET /reports/sales?from=today&to=today (`useTodayReport`, reports permission), then Latest bills. Salon and distributor dashboards use MetricCard; the distributor's 30-day trend is an AreaChart and its monthly target a Gauge. The pharmacy dashboard also reads GET /api/dashboard (pharmacy POS bills are ordinary invoices) and reuses Dashboard.jsx's exported Kpi/Change/SalesChart/TopProducts for today's sales, the 14-day chart and best sellers (chart and best sellers only with the reports permission). Charts: bars rest in `brand-200` and the one in focus (today / hovered / the maximum) is `brand-500`, over three dashed guide lines (Dashboard SalesChart, ReportsPage Columns; wholesale/parts Bars default `brand-400`). Report panel titles are text-body semibold ink-900 (small caps labels stay for sub-sections inside detail panels). The shared `Select` carries `.select-control` (our chevron instead of the browser arrow); the header's business/outlet pickers are native selects styled by `PICKER` in AppShell. AppShell also shows "This screen is for another kind of business" (`notHere`) when a typed URL belongs to a nav entry whose types don't fit (e.g. /app/stock for a pharmacy), instead of loading a page whose API would 404. Public site: React Bits pieces live in `components/reactbits/` (BlurText on the home headline, SpotlightCard on the home bento; both trimmed and reduced-motion safe); per-page titles/descriptions/canonical/OG via `site/seo.js` `useSeo()` in SiteLayout; the closing CTA (`parts.jsx FinalCta`, `.final-cta`) overlaps the footer, which gets room through `main:has(> .final-cta:last-child) + .site-footer`.
- Domain (2026-10-03): the site is **https://flowxp.in** (www redirects to it in deploy/nginx.conf). It is written in index.html (canonical, OG, JSON-LD), site/seo.js `ORIGIN`, public/sitemap.xml, public/robots.txt and public/llms.txt (llmstxt.org format; every line must be something the product really does). A new public page goes into sitemap.xml and seo.js PAGES. Unknown public paths and unknown industry slugs render `site/NotFoundPage.jsx` inside SiteLayout (seo.js sets `robots: noindex, follow` and drops the canonical); unknown /app paths render AppNotFound in App.jsx. nginx still answers 200 for every SPA path (try_files to index.html), so the noindex tag is what keeps 404s out of search.
- Email (2026-10-03): modules/mailer.js keeps one pooled SMTP transport per settings set (pool: true, rebuilt when the admin's Email settings change) instead of a new connection and login per email (1-3s each with Gmail, once 19s), and retries transient failures (connection reset/timeout, 4xx) up to 3 attempts with 0.8s and 2.5s pauses; a send over 5s is logged as a warning, a failure as [mail] send failed. Sign-up / login / resend codes (issueEmailOtp) and password-reset codes are sent WITHOUT awaiting: the code is saved first, the screen moves on at once (signup to "Check your email" measured at 0.9s), and "Resend code" covers an email that never arrives.
- Sign-up email checks (2026-10-03): `backend/src/utils/emailCheck.js` `emailProblem()` runs in signup() after the field checks and before any account or code exists: malformed forms, a "Did you mean x@gmail.com?" for domains within edit distance 1 (or 2 for 8+ characters) of gmail/yahoo/outlook/hotmail/live/icloud/rediffmail/proton/zoho (typo domains are often registered and DO accept mail, so only the name check catches them), and an MX (then A) lookup that refuses a domain that does not exist (3s timeout; any other DNS failure lets the address through so a flaky resolver never blocks a signup; .test/.local/.example/.invalid pass outside production). 400 with code EMAIL_UNDELIVERABLE. `frontend/src/lib/emailTypos.js` repeats the typo check while typing (hint + "Use it" button). The code screen names the address ("We sent a 6-digit code to ...", "Wrong email? Go back"). "Resend code" shows errors (an expired page session used to fail silently), counts down 30s, and each resend returns a fresh challenge so the page session does not die before the new code. Mail sends now log `[mail] "subject" to x: accepted/REJECTED by the mail server in Nms`, which is how "the code never came" is answered from the server log (accepted = the provider took it; spam folder or a later bounce is outside our reach).
- Short screens (2026-10-03, laptop 640 to 780px tall): index.css has `.nav-item/.nav-group/.nav-label` (sidebar rhythm: 36px rows, 32px under 780px height, 44px for touch) and `.pos-hint/.pos-method/.pos-gap/.pos-methods` (the till's bill panel: hints hide, the six payment methods become one row). BillingPage's payment footer is capped at 66vh and scrolls inside itself with the Charge button sticky at its bottom (desktop only; phones use their own bottom bar), so Charge can never fall off-screen. Orders tiles use the compact StatCard size and cards are 109px tall. When adding to the sidebar or the till, check it at 1280x640.
- Gemini models (2026-10-03): backend/.env GEMINI_DEFAULT/REASONING_MODEL=gemini-3.5-flash, FAST=gemini-3.5-flash-lite (3.8-flash was overloaded and slow; 3.1-pro has no free-tier quota; a typo'd name was the first outage). provider.js `gemini()` tries the model asked for, then the default, then the fast one when Google says 404 (unknown name), 429 with "limit: 0" (no quota on this plan) or 503 (overloaded, after 3 tries); an ordinary 429 is just "busy". The log names the skipped model. test/geminifallback.test.js. List the models a key can use with GET https://generativelanguage.googleapis.com/v1beta/models (x-goog-api-key).
- Website chat "Ask FlowXP" (2026-10-03): `site/AskFlowXP.jsx` (corner button + panel on every SiteLayout page; conversation in sessionStorage only; own-site links open in-app; Enter sends) -> POST /api/public/assistant (`controllers/siteAssistant.controller.js`, rate limit 30 per 15 min per IP in routes/index.js) -> `modules/ai/siteAssistant.js` -> provider.js `complete()` (AI_PROVIDER=gemini, tier 'fast', max 500 tokens, no tools, no business data). Its knowledge is `frontend/public/llms.txt`, read at start-up, so editing llms.txt changes what the chat may say (restart the API). Input: message <= 600 chars, last 8 turns, alternating, starting with the visitor. 503 when no key, 429 when the provider is busy. The key is only in backend/.env (gitignored); nothing AI-related is in the frontend bundle. test/siteassistant.test.js.
- Security headers (2026-10-03): `deploy/nginx-security-headers.conf` (CSP, nosniff, frame/referrer/permissions policy, HSTS) is included in nginx.conf's server block AND in every location with its own add_header (nginx does not inherit add_header into such locations; index.html used to go out without them). CSP allows only self scripts; connect-src adds api.bigdatacloud.net (onboarding address lookup) and http://127.0.0.1:* / localhost:* (print agent); frame-src www.google.com (onboarding map); img-src https: (S3 photos). No upgrade-insecure-requests (it would break the print agent). A new third-party script, frame or API called from the browser must be added there, or it will be blocked. Seed scripts import `scripts/no-production.js` first and exit when NODE_ENV=production (ALLOW_SEED_IN_PRODUCTION=yes overrides).
- Session cookie (2026-10-03): the browser session is the cookie `flowxp_session` (middleware/auth.js setSessionCookie: httpOnly, Secure in production, SameSite=Lax, Path=/api, lifetime = the JWT's 7 days). Set when a sign-in finishes (auth.controller finishLogin), refreshed on every GET /auth/me (sliding session; also how a browser that still sends the old localStorage token is moved over, after which lib/api.js forgetLegacyToken() deletes it), moved to the new token by security.controller rotate() (2FA on/off, password change, sign out everywhere), cleared by POST /auth/logout (no auth needed, X-Requested-With or Authorization required). requireAuth reads the Authorization header first (scripts, tests, print agent, the QA token minting), else the cookie, and sets req.authVia. CSRF: a cookie-authenticated POST/PUT/PATCH/DELETE must carry `X-Requested-With: FlowXP` (lib/api.js APP_HEADER, offline.js) or gets 403. The login reply still includes `token` for API clients; the web app no longer stores it. The admin console still uses its own bearer token (flowxp.admin.token). test/sessioncookie.test.js.
- Cookies: FlowXP sets one cookie (flowxp_session, above); the rest is browser storage, listed item by item on /cookies (Legal.jsx COOKIE_POLICY). The site's CookieNotice is information only (no accept/reject) because nothing optional runs. Adding analytics, ads, another cookie or any new localStorage/sessionStorage/IndexedDB key means updating COOKIE_POLICY first, and anything not strictly necessary needs a real consent choice before it runs.
- Loading: `PageLoader` (ui.jsx) draws React Bits' LatticeLoader (`components/reactbits/LatticeLoader.*`, copied unchanged) in brand blue; `compact` for panels and dialogs. Plain "Loading…" paragraphs were replaced with `<PageLoader compact />`; the Flow AI thinking state uses LatticeLoader with its timer. Lists still prefer skeletons (ListState `skeleton`).
- Marketing screenshots are real screens in `public/product/*.webp`: the older `pos.webp` (whole window 1440x900) and `*-main.webp`, and the industry pages' set named `<industry>-<screen>.webp` (restaurant-, cloud-, wholesale-, dist-, salon-, pharmacy-; main area only, 1800x1125, phone shots 1170x2532). They are taken from the seeded demo businesses with headless Chrome (Playwright) after `seed:demo` + `seed:live`, `seed:salon`, `seed:pharmacy`, `seed:distributor`; the cloud-kitchen set is the restaurant demo switched to CLOUD_KITCHEN with brands (re-run `seed:demo` afterwards). Re-shoot them when the app UI changes. The industry pages are `site/industries/IndustryDetail.jsx` (template) + `site/industries/content/<slug>.js` (copy, screens, checklist, limits, FAQ); every claim there must name something the app really does.

## 4. Feature status

### Built (all with tests unless noted)
| Area | What exists |
|---|---|
| Core | Signup, trial + subscription state, businesses/branches, auth, super-admin, plans (`limits.outlets`, `limits.ai_queries`), onboarding |
| **Subscription payments** | Custom-priced, not self-serve (owner's call, 2026-09-28, "Option B"): there is no fixed public checkout — the super admin types a price on `/superadmin/businesses/:id` ("Payment link" panel), FlowXP creates a Cashfree hosted Payment Link (`modules/payments/cashfree.js`, plain fetch, `setProvider` test double same shape as AI/messaging) and stores it as a `subscription_orders` row (migration 0034). The owner sees "Pay ₹X now" on `/app/settings/subscription` (`business.getSubscription`'s `pending_payment`) and pays on Cashfree's own page — FlowXP never touches a card/UPI detail. `POST /api/webhooks/cashfree` verifies Cashfree's HMAC signature over the raw body (`server.js`'s `express.json` `verify` callback captures `req.rawBody` for this) and, on a `PAID` link, activates the business (`subscription_status='ACTIVE'`, `next_billing_date` +30/365 days) — idempotent by construction (the UPDATE only fires from `PENDING`, so a Cashfree retry of the same event is a no-op). `CASHFREE_APP_ID`/`CASHFREE_SECRET_KEY`/`CASHFREE_ENV` (SANDBOX default); blank keys fail link creation with a clear message rather than a broken call. Sandbox test call against real Cashfree (2026-09-28) reached the API and authenticated correctly but returned `"payment gateway product is not activated for your account"` — a Cashfree-dashboard activation/KYC step, not a code issue; re-test once that's switched on. test/subscriptionpayments.test.js (8 tests: validation, link creation, Cashfree failure leaves the row PENDING with no link, bad/missing signature refused, PAID activates once, replay is a no-op, unknown link/non-PAID status is acked and ignored, signature verification is pure-tested). |
| Billing | POS sale, GST, discounts, split/partial payment, invoices, cancel, refunds, **credit notes** (exact tax reversal), round-off, GST register (CSV), receipts |
| Restaurant floor | Tables + QR self-ordering, orders/tabs (transfer, merge, split, move items), KOT + kitchen display (stations, rush, timing, performance), modifiers, recipes + food cost, wastage |
| **Reservations** | Bookings with overlap rules + availability, seat / no-show / cancel, walk-in **waitlist** with quoted wait, floor shows upcoming booking |
| **Combos, waiters** | Combo items (stock/cost from parts, kitchen shows contents); regular waiter per table, waiter on order, hand-over, sales per waiter report |
| Inventory & buying | Stock per outlet, adjustments, transfers between outlets, suppliers, purchases, **purchase orders** (incl. drafted from forecast), demand forecast, low-stock alerts; **supplier price lists**, **back-orders** (PARTIAL orders, receive in parts), **debit notes** (returns and price corrections, credit when already paid), **stock requests between outlets** (asked outlet sends in parts) |
| Customers & loyalty | Customers, **visit card** (Nth visit free item), coupons, **points and tiers** (earn/spend/tier multipliers, ledger, credit-note reversal), mobile lookup at till |
| **Messaging** | WhatsApp (Meta Cloud templates) / SMS (Twilio): bill link, booking + waitlist messages, loyalty nudge, offers (segments), opt-out, message log; public `/bill/:token` page |
| Multi-outlet | Outlets, switcher, per-outlet stock/price/availability/staff, transfers, compare report, staff management + per-person permissions, activity log; **per-outlet invoice series** (own prefix + counter), **per-outlet kitchen stations** (routing by station name), **per-outlet recipes** (an outlet recipe replaces the default) |
| AI | Flow AI manager (tool-use over business data, quota), **menu import from a photo** with confirmation, leakage detection, profitability, forecast |
| Printing | Browser print (58/80 mm), KOT auto-print, logo on receipts, **silent thermal printing + cash drawer via print agent** (ESC/POS, fallback to browser) |
| **Phone app** | PWA: install, service worker (app shell, built files, menu reads), **offline POS sales queue** with idempotent replay, offline banner/review, phone-friendly header |
| **Security** | Sign-in history + new-device email, lockout, TOTP two-step login with recovery codes, owner policy to require it for admins, session versions (sign out everywhere), magic-byte upload checks, security headers; Security page. See SECURITY.md |
| **GST filing** | GSTR-1 JSON (B2B/B2CL/B2CS/credit notes/HSN/doc series, per GSTIN, totals equal the GST report, readiness warnings), GSTR-3B figures (outward, ITC net of debit notes), e-invoice JSON + IRN recording, e-way bill JSON + number recording; pincodes on outlets/customers |
| Ops | Storage (local/S3), production config checks, /health /ready, request ids, PM2/nginx/CI/backup script, DEPLOY.md |
| **Onboarding** | 4 steps, no re-ask of business name/type (signup already asked): where you trade (India state dropdown, country, a no-key Google Maps `output=embed` preview), logo (same upload as Business Settings — shows on receipts and the QR menu), tax, invoices. `frontend/src/lib/states.js` (36 Indian states/UTs, matches `backend/src/modules/gst/states.js`'s `STATE_CODES` keys — kept as a separate small list, not imported, since the backend module is outside the frontend's build root). Step numbers 5/6/8/10 (was 3/5/8/10); resume logic is backward compatible with a business mid-wizard from before. |
| Marketing site | `public/sitemap.xml` + `public/robots.txt` added (marketing pages only; app/admin/QR-menu/bill-link routes disallowed) — placeholder domain, swap in the real one before launch. `AuthPages.jsx` login/signup `<main>` no longer vertically centers below `lg`, which was leaving a large dead gap above and below the form on a phone. |
| Integrations | Delivery platforms (Zomato/Swiggy/ONDC/Magicpin) exist as **mocks** only. An incoming order lands `PENDING_ACCEPT` (no KOT, nothing sent to the kitchen) and needs an explicit Accept/Reject — it used to skip straight to the kitchen; migration 0032 adds the status, 0033 adds `orders.guest_name/guest_phone` (the diner's own name/phone from the platform payload, previously parsed and discarded). `GET /orders/pending-deliveries` returns every such order with full items for `IncomingDeliveryAlert.jsx`, a draggable (pointer-events drag, per-card position) fixed pop-up mounted once in AppShell (any screen, any scroll position) that rings a loud repeating alarm (`lib/printing.js ringAlarm`, distinct from the quiet Kitchen-screen `beep`) every 3.5s until every pending order is decided; also has its own dedicated view in OrdersPage.jsx when opened directly. `POST /orders/:id/accept` sends it to the kitchen (same `sendKotCore` as everything else); `POST /orders/:id/reject { reason }` cancels it, never touching the kitchen; both call the mock adapter's `pushOrderStatus`. The platform's own order number (e.g. Zomato's #6350, `orders.external_order_number`) now prints on the KOT slip and the receipt, and shows in the Orders list/detail. Billing's Orders-picker and BillingPage.loadOrder both refuse a still-pending delivery order (must be accepted first). test/deliveryorders.test.js (8 tests: PENDING_ACCEPT on arrival, dedupe, disabled/unknown/malformed webhook, pending-deliveries with items, accept→kitchen, reject→cancelled+reason, outlet isolation). |

### Pending: restaurant side (owner's list, build one by one)
1. ~~Per-outlet invoice numbering, kitchen stations, recipes~~ (built, see the table)
2. ~~Inter-outlet stock requests, supplier price lists, back-orders, debit notes~~ (built, see the table)
3. ~~GSTR filing, e-invoice, e-way bill~~ (built as prepared files + figures; nothing is sent to the government, see the table)
4. ~~Login history, two-factor login, security review~~ (built; see SECURITY.md)
5. ~~Google Reviews~~ — built as the honest, fully-buildable version (2026-09-29, see §4's Customer
   feedback & reviews entry): post-bill star rating + comment on the existing bill page, happy ratings
   routed to a Google share link, unhappy ones private with Flow AI reply drafts. Real Google
   Business Profile read/post integration still needs Google's own API approval — not attempted.
   "Google Drive" was also mentioned: backups / menu-photo import from Drive (clarify which)
6. Store-listed native app (Capacitor wrap of the PWA; needs Play $25 / Apple $99/yr accounts)

### Pending: platform and quality
- ~~Payment gateway for subscriptions~~ (built via Cashfree Payment Links, custom price per business — see the table above; blocked only on the owner activating the Payment Gateway product on Cashfree's dashboard)
- **Real delivery-platform adapters** (Zomato, Swiggy, ONDC, Magicpin) replacing mocks — needs their
  partner API approval. ~~Aggregator settlement reconciliation~~ and ~~delivery rider/fleet
  management~~ are both built without needing that approval (see §4, migration 0047) — reconciliation
  via pasted statement import, riders via the business's own staff.
- Run AI manager + menu scan with a **real `ANTHROPIC_API_KEY`**; run messaging against real WhatsApp/Twilio; try S3 against a real bucket
- **Run** the PM2/nginx setup against a real VPS once (expect small fixes — paths, the Postgres auth method); restore-test a backup
- Browser walkthrough of all new screens (most verified by API/build/tests only); end-to-end browser tests
- Redis / queues / running the background worker on more than one server (`WORKER_ENABLED=false` on extras); error tracker; WAF
- Real-time push (WebSocket/SSE) for kitchen/notifications; push notifications for the PWA; background sync when the app is closed
- Loyalty extras: points expiry, signup/birthday/referral points, tier-change messages, points on the QR menu
- Messaging extras: inbound replies (STOP), delivery receipts, retry queue, scheduling, per-outlet sender
- Printing extras: logo bitmap on thermal, per-station printers, reprint queue, printer status, Bluetooth, agent installer
- Reservations extras: online booking by customers, confirmations already sent by messaging, deposits, no-show fees
- Other: per-outlet permission overrides, AI actions/streaming/spend cap, captain approvals, tips/service charge split

### Pending: other verticals (owner: "once the restaurant is ready the rest is easy")
The core (products, invoices, customers, inventory, GST, reports, staff, outlets, loyalty, messaging, PWA) is business-type agnostic;
`business_type` and `RESTAURANT_TYPES` in `lib/business.js` gate restaurant-only screens.
- **Salon / services:** appointments and staff calendar, service catalog with durations, staff commission, packages/memberships, reminders (reuse
  reservations + messaging ideas), per-stylist sales
- **Retail:** barcode scanning, variants (size/colour), price lists, returns/exchanges, purchase-to-sale margin, weighing scale, e-commerce sync
- **Wholesale:** party ledgers, credit limits, price tiers per customer, challans/dispatch, bulk invoices, e-way bill
- **Generic billing:** quotations/proforma, recurring invoices, subscriptions
- Each vertical = a set of screens + a few tables on the same tenant/outlet/permission model. Reuse, do not fork.

## 4b. RBAC and plan limits, verified 2026-09-28

The sidebar used to show almost every screen to every role (only Loyalty/Messaging/GST/Outlets/Staff/Activity
were role-gated); a WAITER or KITCHEN login could open Business Settings, Suppliers, Purchases, Inventory,
Payments, Reports etc. and see a half-working page (server writes were correctly refused, but reads like
`GET /businesses/current`, `GET /customers` have no permission gate, so real data rendered into a Save-button
form the role could never submit). Fixed:
- `GET /auth/me` and `GET /businesses/current` now also return this person's `permissions` overrides (not
  just `role`) — previously the frontend had no way to know a per-user override at all.
- `frontend/src/lib/permissions.js`: a small mirror of `ROLE_PERMISSIONS`/`hasPermission` (keep the two in
  sync by hand if a role's permissions change — no shared source, no test cross-checks them). Exposed as
  `useAuth().can(permission)`.
- `AppShell.jsx`: every nav item now carries `permission` / `anyPermission` matching its real backend route
  requirement (Billing/Invoices/Tables/Reservations → billing, Orders/Kitchen → billing OR kitchen,
  Products/Modifiers → products, Inventory/Stock requests → inventory, Purchases → purchases, Suppliers →
  suppliers, Payments → payments, Reports/Profitability/Forecast → reports, Leakage/Integrations → settings,
  Expenses → expenses, Flow AI → ai); Settings (business identity/GSTIN/logo) is `roles: ['OWNER']` since the
  PATCH route is `requireOwner`, stricter than the 'settings' permission ADMIN otherwise holds. Customers and
  Security stay ungated on purpose (reads are open business-wide; Security's own-password/2FA is personal —
  CustomersPage does not yet hide its own Edit/Add buttons for a role without 'customers', a known gap).
  A second check (`accessible()`, permission/role only — never types/multiOutlet) runs against the CURRENT
  route on every render, so a typed or bookmarked URL for a hidden screen shows "You don't have access to
  this" instead of the page's shell with an inline error.
- `staff.controller.js update()`: the "last owner" guard checked `target.role === 'OWNER'` without
  `target.status === 'ACTIVE'`, so reassigning an already-disabled owner's role was wrongly blocked whenever
  only one owner was active — fixed. Note for future readers: self-edit is blocked unconditionally and only
  an OWNER may touch an OWNER, so the "last owner" case (activeOwners() <= 1) can only ever be reached via
  that disabled-row edge case — two ACTIVE owners always structurally means removing one leaves one, never
  zero; the explicit count check is defence in depth, not the primary guarantee.
- New `test/rbac.test.js`: hasPermission across every role, the requirePermission/requireAnyPermission/
  requireOwner/requireOutlet/requireGroupUser middleware directly, and staff invite/update/permissions rules
  (privilege escalation, self-edit, the last-owner edge case, the plan's `users` limit).
- Plan limits actually enforced today: `users` (staff.controller invite), `outlets` (outlets.controller),
  `ai_queries` (ai.controller), all read from `plans.limits` per `plan_code` and refuse with 402. The
  `plans.features` array (e.g. "Advanced reports", "Role permissions") is still a marketing bullet list
  shown on the pricing/plan page only.
- **Real feature gating, two independent axes** (owner's request, 2026-09-28): separate from the
  `features` marketing array above, which nothing reads. `modules/planFeatures.js` is the single source
  of truth for the 9 gateable keys — `loyalty`, `messaging`, `reservations`, `purchases`, `expenses`,
  `ai`, `advanced_reports`, `integrations`, `qr_ordering` — each with a label and description, plus
  `effectiveFeatureFlags(...sources)`, which ANDs any number of flag sets together (a key is off if
  *any* source says `false`; missing everywhere = on). Two real sources today:
  - **Plan** (`plans.feature_flags` JSONB, migration 0036) — "did they pay for this". Seeded from the
    plans' existing marketing copy: STARTER has none of the original 7 (not `integrations`/`qr_ordering`,
    added later — see below); GROWTH has purchases/expenses/ai but not loyalty/messaging/reservations/
    advanced_reports; BUSINESS/ENTERPRISE/TRIAL have everything.
  - **Business type** (`business_type_features` table, business_type PK, migration 0037) — "does this
    even apply to a Salon". No rows seeded; every type has everything on until an admin says otherwise.

  `middleware/auth.js`'s `requireAuth` joins both `plans` and `business_type_features` onto each
  membership; `withBusiness()` combines them via `effectiveFeatureFlags()` into `req.tenant.planFeatures`
  (the property name predates the second axis — it's the *effective* map now, not just the plan's);
  `requirePlanFeature(key)` refuses with 402 `FEATURE_NOT_IN_PLAN` when either source turned a key off,
  with one generic message (it doesn't say which axis, since either could be the real reason). Wired onto
  every route file for 7 of the 9 areas the normal way (loyalty, messaging, reservations, purchases +
  suppliers + the buying.routes.js supplier-price/debit-note lines, expenses, ai incl. the settings
  toggle, profitability/leakage/forecast under `advanced_reports`); the other two are public,
  unauthenticated paths with no `req.tenant`, so they check the business's combined flags directly:
  `integrations` in `integrations.controller.js`'s `webhook()` (an extra `businesses`/`plans` join
  alongside the existing `is_enabled` check — a platform's webhook is rejected the same way whether the
  integration itself is off or the plan/type no longer includes it) and `qr_ordering` in
  `publicOrdering.controller.js`'s `resolveTable()`/`unavailable()` (a diner sees the same "not available
  right now" as a closed table — not an error page). Multi-outlet is deliberately NOT a separate flag,
  since `limits.outlets` already gates that.

  **Admin UI**: `/superadmin/features` (`AdminFeatures.jsx`) — a "By plan" / "By business type" tab
  switcher over the same 9×N grid component, bigger higher-contrast toggle switches (check/✕ icon in the
  knob, a ring on the off state — the first pass was functionally correct but too small/low-contrast to
  read at a glance, per direct feedback). `GET /api/admin/plan-features` (the shared catalog),
  `PATCH /api/admin/plans/:code { feature_flags }` and `PATCH /api/admin/business-type-features/:type
  { feature_flags }` (both merge — a partial toggle never clobbers the other flags already set — and
  validate known keys/boolean values only), take effect immediately for anyone already signed in, no
  restart or re-login. **Admin can also assign a business's plan directly**: `PlanAndType` panel on
  `/superadmin/businesses/:id`, `PATCH /api/admin/businesses/:id/plan { plan_code, subscription_status,
  business_type }` (each optional, validated against real `plans` rows / the enum / `BUSINESS_TYPES`) —
  for comping an account, honouring a deal agreed before Cashfree, or fixing a business that signed up as
  the wrong type; separate from the Cashfree flow, which only ever moves a business to ACTIVE on a real
  payment. **Frontend**: `useAuth().hasFeature(key)` (AuthContext.jsx, reads the same effective
  `business.subscription.feature_flags`) hides the matching AppShell nav item (`feature:` on the nav
  entry) so a plan or business type without a feature never shows a door the server would then refuse.
  Verified live: a throwaway STARTER-plan business's nav correctly hid Reservations/Purchases/Suppliers/
  Loyalty/Messaging/Flow AI/Profitability/Forecast/Leakage/Expenses, and calling `/api/loyalty/program`
  directly (bypassing the UI) still got a real 402. test/planfeatures.test.js (12 tests, through the real
  `requireAuth`→`withBusiness` chain and the two public paths, not just the pure function).
  - **The business-type view is a dropdown, not a column per type** (direct feedback, 2026-09-28): a
    restaurant and a pharmacy share almost nothing here, so 14 columns side by side was mostly empty
    space and horizontal scrolling to find the one type that mattered. Now: pick one type from a
    `<Select>`, edit a plain single-column list for just that one (`FeatureList` in `AdminFeatures.jsx`,
    alongside the unchanged multi-column `FeatureGrid` still used for the 5-plan view, where columns
    stay a manageable count).
  - **`CLOUD_KITCHEN` added as a business type** (owner: "we built restaurant/cafe, cloud kitchen is
    next") — threaded through every place `BUSINESS_TYPES`/the restaurant-type family was already
    duplicated rather than left half-wired: `backend/src/utils/validate.js` (`BUSINESS_TYPES`, signup
    validation), `frontend/src/lib/business.js` (`RESTAURANT_TYPES`, so Kitchen/Orders/Tables/Modifiers/
    Integrations nav items show up), the same literal array in `dashboard.controller.js`,
    `invoices.controller.js`'s `KITCHEN_TYPES`, `modules/scans.js`'s `RESTAURANT`, `app/Dashboard.jsx`
    and `components/IncomingDeliveryAlert.jsx` (so the loud delivery pop-up — the whole point of a cloud
    kitchen — actually fires for one), the signup form's `BUSINESS_TYPES`, and `AdminBusinessDetail.jsx`/
    `AdminFeatures.jsx`'s business-type option lists. Feature flags for it start at `{}` (everything on)
    like any newly-added type — the owner builds it out feature by feature from the new dropdown, same as
    Restaurant/Café already were.
- Full restaurant smoke test (owner login): seated T1, added 2 dishes via the tap-to-add menu, sent to
  kitchen, marked ready on the Kitchen screen, confirmed Tables showed "2 ready to serve", billed it from
  Billing's new Orders-in-Billing picker (INV-2408), confirmed Loyalty and Reservations still load. All green.
  Verified live as demo-waiter and demo-kitchen: sidebar now matches each role exactly.
- **Super Admin audit (owner's request, 2026-09-29)**: the owner pasted a 38-section "build a full SaaS
  control plane" spec (industries-as-a-table, admin RBAC with 7 roles, multi-currency regional pricing,
  platform coupons/add-ons, impersonation, MRR/ARR dashboards, webhook/job observability, plan
  versioning, entitlement overrides, a subscription events ledger...). Audited what already existed
  first (this file was already accurate) rather than assuming a gap, then gave an honest recommendation:
  most of the spec describes infrastructure a pre-launch, one-founder SaaS doesn't need yet, and building
  it now would trade "get pricing live" for solving problems FlowXP doesn't have. Owner approved the
  proportionate subset — the 3 gaps below — over the full spec or a middle "billing basics" tier.
  - **Plan versioning + grandfathering** (migration 0038): `plan_versions` (one row per version,
    `effective_to IS NULL` = live) sits alongside `plans`, which keeps its existing columns and always
    mirrors the current version (so the public `/plans` pricing page and a brand-new signup need no
    changes). `businesses.plan_version_id` pins each business to the version it joined on. `updatePlan()`
    now closes the live version and opens a new one when price or `feature_flags` change (name/
    description/is_public/is_active do not — they're catalog metadata, not something a customer is
    grandfathered into); `updateBusinessPlan()`'s plan_code branch pins to the CURRENT version, same as a
    fresh signup. Every place that used to read `plans.limits`/`plans.feature_flags`/`plans.price_*`
    directly now reads through the pinned version instead (`middleware/auth.js`'s tenant construction,
    `business.controller.js getSubscription`, and the three quota checks in `staff.controller.js`/
    `outlets.controller.js`/`ai.controller.js`), COALESCEing to the live plan row as a defensive
    fallback. `GET /api/admin/plans/:code/versions` (read-only history) backs a "Price history" expander
    on each `AdminPlans.jsx` card — no new action, just visibility, since the Save button already worked
    correctly underneath. Verified live on the real dev DB: changed Growth's price, confirmed a business
    already pinned to v1 kept seeing ₹0 while `GET /plans` (a new signup's view) showed the new price,
    then reverted it.
  - **Subscription history — reuses `audit_log`, not a parallel table** (deliberately, per the spec's own
    "don't duplicate existing functionality" rule): every subscription-relevant admin action already
    wrote there (plan changes, the Cashfree webhook's activation, now also plan-version cuts and feature
    overrides). `GET /api/admin/businesses/:id/history` just filters and returns it chronologically;
    `AdminBusinessDetail.jsx`'s new History panel renders it with a small action→label map.
  - **Business-specific feature overrides** (migration 0039): `business_feature_overrides`, one row per
    (business, feature) — "Business X stays on Basic but also gets Advanced Reports until 31 Dec",
    without a one-off plan. Highest precedence in `effectiveFeatureFlags()` (now `(sources[], overrides)`
    — see `modules/planFeatures.js`): `enabled: true` forces a feature on even if plan+type say no;
    `enabled: false` forces it off even if they say yes (e.g. disabling one feature for a single abusive
    account without suspending the business). `expires_at` NULL = permanent; an expired override is
    ignored, derived on read the same way trial expiry already is — nothing scheduled. `requireAuth`
    joins it in via a `jsonb_object_agg` LATERAL subquery filtered to non-expired rows.
    `POST/GET/DELETE /api/admin/businesses/:id/overrides[/:feature]`, validated (known feature key,
    boolean, future expiry) and audited; `FeatureOverrides` panel on `AdminBusinessDetail.jsx`. Verified
    live: added a real override on a real business, confirmed it appeared, confirmed it showed up in
    History, removed it.
  - A real bug caught only by the live browser check, not the build or the test suite: `AdminPlans.jsx`
    lost its `useEffect` import in an editing pass and threw `ReferenceError: useEffect is not defined`
    at runtime (Vite's build doesn't catch this class of mistake) — fixed, and the "Price history"
    expander also needed a fix to actually refresh after a Save instead of showing a cached stale list.
  - test/subscriptionadmin.test.js (9 tests, through the real signup→login→requireAuth→withBusiness
    chain, covering grandfathering in both directions, history isolation between businesses, override
    precedence in both directions, and expiry; 4 more added for the Overview dashboard below — 13 total).
- **Overview dashboard expanded** (owner's request, 2026-09-29, the other half of the Super Admin
  audit). Found and fixed a real, pre-existing correctness bug while building this: `revenue_collected`
  summed the tenant `payments` table (a restaurant's own customers paying the restaurant) instead of
  what FlowXP itself had actually been paid — now reads `subscription_orders WHERE status = 'PAID'`.
  New: **MRR** (every `subscription_status = 'ACTIVE'` business's pinned plan-version price — see
  migration 0038 — yearly normalised to `/12`; a business still on TRIAL contributes nothing), a
  **12-month subscription-revenue chart** (`AdminDashboard.jsx`'s `MonthlyRevenue`, the exact same
  visual pattern as `ReportsPage.jsx`'s `Columns` — one brand-blue series, tallest bar labelled, a
  screen-reader table underneath — copied locally rather than shared across `app/`/`admin/` for a few
  lines of markup), a **trials-ending-soon list** (was a bare count; now names the businesses, soonest
  first, linked to their detail page) and a **payments-awaiting list** (pending Cashfree payment links,
  oldest first since those are most overdue to chase, with a true uncapped total). "Failed payments"
  from the original spec's §1 was deliberately NOT added — Cashfree's webhook only ever acted on
  `PAID`, silently ignoring every other status, so there was no real failure data to surface; the
  webhook now also handles `EXPIRED` (marks the order `EXPIRED` so a dead link stops inflating the
  pending count forever), but a genuine "declined/failed" state still doesn't exist and would need to be
  built, not just displayed. 4 new tests (MRR arithmetic across monthly+yearly in one call, the
  revenue-source fix, pending-payments' true count not being capped by its own display LIMIT, and
  trials-list filtering) — 13 total in test/subscriptionadmin.test.js.
- **Paid add-ons** (owner's request, 2026-09-29, migration 0040): "sell Reservations, Table QR, Loyalty,
  Zomato/Swiggy, Flow AI as their own priced extras." Deliberately built on what already existed rather
  than a parallel entitlement system: `addons` is a small catalog (5 rows, seeded at ₹0 — same "a wrong
  price is worse than a blank one" rule as `plans`) keyed by the SAME feature keys already in
  `modules/planFeatures.js`; `addon_orders` mirrors `subscription_orders` (migration 0034) column for
  column, same Cashfree Payment Links flow aimed at a smaller thing; and paying one sets the SAME
  `business_feature_overrides` row (migration 0039) an admin can already set by hand — a paid add-on is
  that override with a receipt behind it, never touching the business's plan or business type.
  `webhooks.controller.js`'s Cashfree handler tells an add-on order from a subscription order by a
  `flowxp-addon-` link-id prefix and routes to `activateAddon()` vs `activateSubscription()`
  accordingly; both now also handle Cashfree's `EXPIRED` status (marks the order `EXPIRED` instead of
  leaving it `PENDING` forever). **"AI-based review replies" was asked for too but deliberately left out
  of the seeded catalog** — it isn't a real feature yet (needs Google Business Profile API access, see
  the restaurant-side pending list below), and selling an add-on with nothing behind it would be worse
  than not offering it. **Admin UI**: `/superadmin/addons` (`AdminAddons.jsx`, a near-copy of
  `AdminPlans.jsx`'s price-editor pattern) sets each add-on's price; a new **Add-ons** panel on
  `AdminBusinessDetail.jsx` (`BusinessAddons`, a near-copy of the existing `PaymentLinks` panel) picks an
  add-on + billing cycle, defaults to the catalog price (admin can still type a different one for a
  negotiated deal), generates the link, and lists past add-on links for that business — surfaced in its
  History panel too (`admin.addon_link_created` / `subscription.addon_activated` added to
  `SUBSCRIPTION_ACTIONS`). 8 new tests in test/addons.test.js (catalog contents incl. proving AI-review
  is absent, price validation, catalog-price default, unknown/inactive add-on refused, a paid add-on
  turning a feature on without touching the plan, expiry, and both list/history surfacing).
- **Add-ons made fully admin-editable + categorised by business type** (owner's request, 2026-09-29,
  migration 0041): the 5-row catalog could only be price-edited before; `createAddon`/`deleteAddon`
  added (delete refuses once an add-on has ever been sold — `addon_orders` has a row — telling the admin
  to deactivate it instead, so a past sale keeps its record), and `updateAddon` can now change every
  field. `addons.business_types TEXT[]` (NULL/empty = every type, the same "missing = on" convention as
  `business_type_features`) scopes a new add-on to specific industries — "Add-ons for Restaurant" vs
  "Add-ons for Salon" — without a code change; the 5 seeded ones were backfilled to the restaurant
  family (`RESTAURANT, CAFE, CLOUD_KITCHEN, GAMING_CAFE, RACING`). A new add-on's key doesn't have to
  match one of `PLAN_FEATURE_KEYS`; if it doesn't, paying it still records an override (audit/billing
  trail) but has no functional gating effect — confirmed by reading `effectiveFeatureFlags()` rather
  than adding special-case code, since it only ever iterates the fixed key list. `frontend/src/admin/
  businessTypes.js` extracted (was duplicated in `AdminFeatures.jsx`) so both it and the new
  `AdminAddons.jsx` share one `BUSINESS_TYPE_LABEL` map. `AdminAddons.jsx` rewritten: a `BusinessTypePicker`
  (toggle chips) on every card and the new-add-on form, a "Show add-ons for [dropdown]" filter mirroring
  `AdminFeatures.jsx`'s business-type tab, and `AdminBusinessDetail.jsx`'s add-on picker now only offers
  add-ons relevant to that business's own type. 5 new tests in test/addons.test.js (12 total: create
  sanitises/rejects duplicate keys, business-type validation on create+update, delete sold-vs-never-sold,
  business-type scoping round-trip).
- **Platform settings: payment gateway + messaging config moved off .env** (owner's request, 2026-09-29):
  "if I switch to Razorpay later, or change the email/SMS/WhatsApp provider, that should be a settings
  change, not a deploy." New `platform_settings` table (migration 0042, one JSONB row per setting key) +
  `modules/platformSettings.js` (`getPlatformSetting`/`getPlatformSettingMasked`/`setPlatformSetting`,
  read fresh on every call — these are low-frequency, so a cache would cost more than it saves). Secret
  fields (Cashfree's key, SMTP password, WhatsApp/Twilio tokens) are encrypted at rest and never sent
  back to the browser (masked as `••••••••`); a save with a secret field left blank keeps the one already
  there rather than wiping it — the UI always sends `''` for a field the admin didn't retype. Encryption
  is `modules/crypto.js`, a new shared, domain-separated AES-256-GCM helper (one key derivation per
  setting key, from the existing `JWT_SECRET`) generalised out of `modules/security.js`'s 2FA-secret
  logic; `security.js`'s `encryptSecret`/`decryptSecret` now just delegate to it with the unchanged
  `'flowxp-2fa'` domain, so already-stored TOTP secrets keep decrypting exactly as before. A DB row wins
  over the matching `.env` value when present, so an install with nothing saved here behaves exactly as
  it did before this change — `modules/payments/cashfree.js` (`resolveConfig()`, also made
  `verifyWebhookSignature` async since it now needs the same lookup — `webhooks.controller.js` awaits
  it), `modules/mailer.js` (transport built per-send instead of once at import, since the config can now
  change without a restart) and `modules/messaging/provider.js` (`providerName`/`isConnected`/
  `channelsAvailable`/`deliver` all made async for the same reason — `messaging.controller.js`'s one
  call site updated) all resolve DB-first, env-fallback. New `/superadmin/settings` (`AdminSettings.jsx`):
  three cards (Payment gateway, Email, SMS & WhatsApp), each its own independent save. Only Cashfree
  actually works today — Razorpay is listed in the provider dropdown but disabled with "not wired up
  yet," since storing a key for a gateway with no adapter behind it would work silently wrong, not
  actually let the owner switch. 5 new tests in test/platformSettings.test.js (crypto domain separation
  — a secret encrypted for one setting key fails to decrypt as another — plus save/mask/merge-keeps-
  blank-secret for all three setting groups). Verified live: saved a test Cashfree App ID through the
  real admin UI, confirmed it round-tripped in the DB, cleaned it up. 479 backend tests passing overall.
- **Flow AI onboarding chat** (owner's request, 2026-09-29): a first-time owner types naturally
  ("I'm on MG Road, Bengaluru, GST registered 29ABCDE...") next to the setup wizard
  (`Onboarding.jsx`) and Flow AI drafts the wizard's own fields — it never writes anything itself,
  the owner still reviews and hits Save. `modules/ai/onboarding.js` (`converseOnboarding`): one
  forced-optional tool (`fill_onboarding_fields`, every field optional, the system prompt says
  never to invent a GSTIN/address/phone), reusing `modules/ai/provider.js`'s `complete()` — a
  wholly separate code path from `modules/ai/manager.js`'s read-only business-question loop, since
  this is field extraction, not tool-use over business data. `POST /api/ai/onboarding-chat` reuses
  the same `isConfigured`/`enabled`/`allowance` gates and `ai_usage` quota as regular chat (one
  system, one quota) but does **not** create an `ai_conversations` row — the wizard keeps its own
  short-lived history client-side for the length of setup, sent back each turn rather than
  persisted server-side. 8 tests in test/aiOnboarding.test.js (extraction via a scripted fake
  provider, the endpoint's gating, quota metering with no conversation row, bad history entries
  dropped). **Frontend chat panel built** (same session, right after): `OnboardingAssistant` in
  `Onboarding.jsx` — a collapsible "Let Flow AI fill this in for you" box, shown on every step except
  Logo (nothing there for it to fill), styled as compact chat bubbles (a smaller copy of
  `AIManagerPage.jsx`'s `Message` pattern). Checks `GET /api/ai/status` once on mount and renders
  nothing at all if the server has no AI key or the business switched it off — a dead chat box would
  be worse than no box. A reply's `fields` merge into the wizard's `form` state the same
  non-destructive way "Use current location" does (only fields that came back non-blank overwrite);
  a failed call drops the optimistic user bubble and restores the typed text so the owner can retry.
  History is a plain array kept in this component's own state, sent back as `history` on every turn —
  never persisted, matching the backend's "no conversation row" design. Verified live: with no real
  key, confirmed the box stays hidden (no error, no dead UI) and `GET /ai/status` returns
  `configured: false` cleanly; then temporarily set a dummy `ANTHROPIC_API_KEY` to prove the other
  half — the box appears, a sent message shows in the panel, and a real (expected) provider auth
  failure surfaces as "The AI service could not answer that" with the message restored for a retry,
  never a crash. Reverted the dummy key and restarted the server back to its original no-key state
  afterward.
- **Kitchen: "To make" and "Ready to serve" as one screen, not two tabs** (owner's request,
  2026-09-29): `KitchenDisplay.jsx` used to gate its whole ticket grid behind a 3-way tab switcher;
  now "To make" and "Ready to serve" render as two always-visible columns (a cook glances at one
  screen instead of tapping back and forth), and "Served" — the one stage that's a log, not
  actionable — became a collapsible "Show served" toggle, off by default. The `Ticket` component
  itself needed no changes (already took a `tab` prop describing which statuses/actions apply); the
  refactor only touches how many ticket lists render at once and how they're laid out. Verified
  live end to end: sent a real order to the kitchen, watched it appear in "To make", marked it
  ready, watched it move to "Ready to serve" — same screen throughout.
- **Onboarding: "Use current location"** (owner's request, 2026-09-29): a link next to the address
  step's map preview uses the browser's own Geolocation API (no key) plus BigDataCloud's free,
  keyless reverse-geocode-client endpoint (same "no paid API key needed" rule as the map embed
  itself) to fill address/city/state/PIN/country — never overwriting a field that already has a
  value with a blank one. If reverse geocoding fails but the coordinates were found, the map still
  centers on them and the owner is told to fill the rest by hand; permission-denied and
  unsupported-browser both get a plain-language message, never a crash.
- **Pricing trimmed to 3 plans — Starter, Growth, Enterprise** (owner's request, 2026-09-29,
  migration 0043): Business is retired, not deleted — its row stays (so `plan_versions`/`audit_log`
  history and any FK to it stay intact) but `is_active`/`is_public` are both set false, which is
  all `routes/index.js`'s public `/plans` query (`WHERE is_active AND is_public`) needed to drop it
  from the pricing ladder with no code change. Enterprise already had every feature Business had
  and a strictly bigger limits object (unlimited vs. Business's capped 5 outlets/15 users/2000 AI
  queries — `limits` keys missing entirely mean unlimited, same `== null` convention as
  `ai.controller.js`'s `allowance()`), so the one account that was on Business (the demo seed, "The
  Food Hub") was moved to Enterprise with no functional loss. New positioning copy on the 3
  remaining plans from the owner's own table; Enterprise's marketing bullets absorbed Business's
  former ones ("Multi-branch & role permissions") since "Everything in Business" would otherwise
  reference a plan name customers can no longer see. `seed-demo.js` seeds ENTERPRISE going forward.
  **Also updated on the super admin side** (a follow-up ask in the same conversation, since the
  first pass only fixed the public page): `AdminPlans.jsx` now shows only the 3 public plans by
  default, with a "Show hidden plans too" checkbox for Trial or a retired plan (kept reachable, not
  deleted, matching the "the data stays flexible, the default view is filtered" rule this session
  settled on); `AdminFeatures.jsx`'s "By plan" tab and the business-detail "Payment link" panel's
  plan picker both dropped Business as an option too.
- **Business-type feature gating made plan-aware** (owner's request, 2026-09-29, migration 0044):
  used to be one switch per business type that applied to every plan ("Reservations off for Retail"
  meant off for Retail on every plan); now it's one switch per (business type, plan) pair —
  `business_type_features` gained a `plan_code` column and its primary key became
  `(business_type, plan_code)`, with a FK to `plans(plan_code)` (any real plan, not only the 3
  public ones the admin UI exposes by default — same flexible-data/filtered-view rule as above). An
  existing plan-agnostic row (there was exactly one, `RETAIL: {reservations: true}`, a functionally
  inert leftover since `true` was already the default) got expanded across the 3 public plans by
  the migration so nothing's behaviour silently changed. `effectiveFeatureFlags()` itself needed no
  change — the (type, plan) flags are just another entry in its existing `sources[]` array,
  ANDed the same way plan flags always were; only the two SQL joins that build it
  (`middleware/auth.js`, `business.controller.js`'s `getSubscription`) gained `AND plan_code =
  b.plan_code`. Admin API: `GET /api/admin/business-type-features` now returns one row per (type,
  plan) — every `BUSINESS_TYPES` entry crossed with the 3 public plans; `PATCH
  /api/admin/business-type-features/:type/:plan`. `AdminFeatures.jsx`'s "By business type" tab
  changed from a flat single-column feature list per type to the same `FeatureGrid` the "By plan"
  tab already used, now scoped to whichever type is picked from the dropdown — reusing the existing
  component rather than building a second grid. Tests in test/planfeatures.test.js updated for the
  new (type, plan) key (the old `updateBusinessTypeFeature({ params: { type } })` calls all needed
  a `plan` param too) plus a new case proving a switch for one plan doesn't leak onto another plan
  for the same type. Verified live: toggled Reservations off for Restaurant+Starter, confirmed
  Restaurant+Growth and Restaurant+Enterprise were untouched, reverted it. 487 backend tests
  passing overall.
- **Feature-gating convention, going forward** (owner's instruction, 2026-09-29): every major new
  capability gets a key in `PLAN_FEATURE_KEYS` and a gate behind `requirePlanFeature`/
  `hasPlanFeature`. That one step gives three admin controls for free with zero extra code: per plan,
  per business type per plan, and — the part the owner specifically wanted confirmed —
  **per individual business**, which already worked generically for any key via the existing
  `business_feature_overrides` panel on a business's detail page (`setBusinessOverride` validates
  against the live `PLAN_FEATURE_KEYS` array, so a brand new key is override-able immediately, no
  extra code). Saved as a standing rule in this session's memory
  (`feedback_feature-gating-convention.md`) rather than re-explained each time. Platform-level config
  (the payment gateway, the messaging provider — `/superadmin/settings`, migration 0042) is
  deliberately NOT a feature key: that's "how FlowXP itself talks to a provider", not "does a
  business turn this on for themselves."
- **Customer feedback & reviews** (owner's request, 2026-09-29, migration 0045; `reviews` added to
  `PLAN_FEATURE_KEYS` per the convention just above) — the honest, fully-buildable half of the
  "AI-based Google reviews" idea from the restaurant-side pending list: real Google Business Profile
  integration needs Google's own API approval, which FlowXP doesn't have, so nothing here pretends
  to read or post real Google reviews. Instead: the same public bill page a customer already opens
  (`publicBill.controller.js`, `invoices.share_token` — no new link, no new message, no WhatsApp
  template change) now carries a star-rating + comment prompt. A happy rating (4-5) is asked to also
  post it on Google — a plain share link the owner pastes once in Business Settings
  (`businesses.google_review_link`), no API — while an unhappy one (1-3) stays entirely private in
  the new `customer_feedback` table, for the owner to see and act on: protects the public rating
  instead of risking a bad public review, and gives Flow AI something real to work with. One
  feedback row per invoice (`UNIQUE` on `invoice_id`; resubmitting updates it, not duplicates).
  Reviews' own gate is checked the fully-correct way (all three sources —
  `plans.feature_flags`/`business_type_features(type,plan)`/`business_feature_overrides` — combined
  via `effectiveFeatureFlags()`, joined directly in `publicBill.controller.js` since this is a public
  unauthenticated path with no `req.tenant`), not the lighter single-join shortcut `qr_ordering` used
  before this session's business-type-per-plan work existed. **Owner-side** (`/app/reviews`,
  `permission: 'settings'` like Loyalty/Messaging): list feedback (outlet-scoped via
  `branchFilter`), "Draft with Flow AI" (`modules/ai/reviewReply.js`'s `draftReviewReply()` — a
  single `complete()` call, not the tool-use loop, since there's nothing to look up for one piece of
  feedback; reuses the same `isConfigured`/`enabled`/`allowance` gates and `ai_usage` quota as the
  rest of Flow AI), and "Send reply" (a new `REVIEW_REPLY` WhatsApp template — free text wrapped in
  one variable, the same pattern `OFFER` campaigns already use for admin-composed text, so no new
  WhatsApp-template-approval workflow was invented). Flow AI also gained a **tenth** tool,
  `feedback_summary` (permission `settings`, like `loyalty_and_coupons`): average rating, the split
  by star count, and recent comments for a period — no customer names or phone numbers, same privacy
  rule every other tool follows — so "how are our reviews doing" can be answered in the regular Flow
  AI chat, not just on the Reviews page. 14 new tests in test/reviews.test.js (rating validation,
  happy/unhappy routing incl. the Google link only ever appearing for 4-5 stars, idempotent
  resubmission, cancelled-invoice and feature-off refusal isolated to one business, list scoping,
  the three AI-draft failure modes, send validation incl. no-phone and messaging-off). Verified live,
  full funnel: real invoice → public bill page → 2-star rating with a comment → private "thanks,
  noted" (no Google prompt) → appeared on `/app/reviews` → "Draft with Flow AI" showed the honest
  "not set up" message (no key in this dev environment) → typed a reply by hand → "Send reply"
  correctly refused with "no mobile number on file"; separately, a 5-star submission correctly
  showed "Post a Google review" with the real link. 501 backend tests passing overall.
- **Cloud Kitchen: no Tables or Reservations** (owner's request, 2026-09-29) — a cloud kitchen cooks
  for delivery/takeaway only, no dine-in seating, so those two are the one thing it shouldn't inherit
  from the rest of the restaurant family (Kitchen, Orders, Modifiers, Integrations, Loyalty etc. all
  still apply and are unchanged). Two independent fixes, since only one of the two had a real
  backend gate to flip:
  - **Nav**: `AppShell.jsx`'s Tables and Reservations items switched from `types: RESTAURANT_TYPES`
    to a new `DINE_IN_TYPES = RESTAURANT_TYPES.filter(t => t !== 'CLOUD_KITCHEN')` — every other
    restaurant-family type is unaffected, only Cloud Kitchen loses these two links.
  - **Reservations** already had a real per-(business type, plan) backend gate (migration 0044) —
    set `reservations: false` for `CLOUD_KITCHEN` across all 3 public plans via the existing
    `updateBusinessTypeFeature` admin function (not raw SQL), so a Cloud Kitchen business is actually
    refused the API too, not just missing the nav link.
  - **Tables** has no feature-key gate at all for ANY business type (Retail, Pharmacy etc. already
    lack it the same nav-only way) — building one now would be new gating machinery well past what
    was asked, so this stays frontend-only, consistent with how every other non-dine-in type already
    works.
  Verified live: signed up a fresh Cloud Kitchen account — confirmed Tables and Reservations are
  both absent from its nav while Kitchen/Orders/Modifiers/Integrations/Loyalty remain; signed back in
  as the existing Restaurant demo account and confirmed both are still present there (no regression).
  Both test signups cleaned up afterward. No test or schema change needed — reused the existing
  business-type-feature admin function and the existing nav `types` mechanism as-is.
- **QR ordering off for Cloud Kitchen too, and a real bug this surfaced** (owner's request,
  2026-09-29): same reasoning as Reservations — no tables to scan a code at. Set
  `qr_ordering: false` for `CLOUD_KITCHEN` across all 3 public plans via `updateBusinessTypeFeature`
  (merged, not replaced — `reservations: false` from the change above was preserved). No nav change
  needed: QR ordering has no screen of its own, it's reached only through Tables' "Print QR cards"
  button, already hidden by the Tables fix above.
  While wiring this up, found that the switch would have silently done nothing:
  `publicOrdering.controller.js`'s `resolveTable()`/`unavailable()` — the public, unauthenticated QR
  menu's own gate — predates migration 0044's business-type axis and only ever read `plans.feature_flags`
  directly, never `business_type_features` or `business_feature_overrides`. Fixed to build the full
  `effectiveFeatureFlags([plan_flags, type_flags], overrides)`, the same LATERAL-join pattern already
  used in `publicBill.controller.js` for the reviews feature. This was a real, pre-existing gap (any
  business-type-level or per-business override for `qr_ordering` or `reservations`-adjacent gating on
  this one public path was silently ignored before today), not something introduced by this change —
  caught only because this request depended on it actually working. Extended
  test/planfeatures.test.js's existing QR-ordering test with the business-type-level case (cleans up
  via a direct `DELETE` rather than "restore to true", since the merge-based admin function can't
  fully clear a key back to empty and a later test in the same file asserts a fresh pair has none).
  Verified live: created a real Cloud Kitchen business with a table QR token, confirmed `/order/:token`
  shows "This ordering link isn't available" instead of the menu; cleaned up the test business
  afterward. 501 backend tests passing overall (same count — an existing test grew, nothing new was
  added).
- **"Complete Cloud Kitchen module" spec, audited (owner's request, 2026-09-29)** — a 40-section PRD
  pasted verbatim (multi-brand, multi-kitchen, KDS, recipe/packaging inventory, an aggregator adapter
  architecture, reconciliation, delivery fleet, AI forecasting, RBAC, notifications, audit, the works),
  explicitly instructing "do not start coding, audit first." Same shape as the Super Admin mega-spec
  from earlier in this session, handled the same way: audited what already exists rather than assumed
  a gap, then gave the honest breakdown before writing anything. Confirmed already built and reusable
  as-is: KDS (just redesigned to one screen), recipes with wastage/costing, **packaging inventory and
  auto-deduction per dish** (`products.kind` already has a `PACKAGING` type alongside `DISH`/
  `INGREDIENT`, and the recipe editor has no kind restriction at all — a container or lid can already
  be added as a recipe "ingredient" with a quantity and it deducts on every sale exactly like a real
  ingredient; genuinely zero new code needed for this one), inventory, purchasing, GST, loyalty/CRM,
  multi-outlet (= multi-kitchen, no new entity needed), RBAC, notifications, audit log, AI (demand
  forecast, stock forecast, kitchen bottleneck tools already exist), and subscription/plan gating. The
  spec's "Order Channel Adapter" architecture (§17) is already exactly this shape —
  `integrations.controller.js`'s pluggable per-platform adapters (Zomato/Swiggy/ONDC/Magicpin),
  built as **mocks** since real aggregator API access needs partner approval FlowXP doesn't have (same
  class of limit as the Google Reviews API). Real aggregator integration and settlement reconciliation
  stay explicitly out of scope for the same reason; a delivery-executive/rider fleet system was
  identified as a separate, large product decision FlowXP doesn't have today (aggregators/own staff
  currently handle delivery) and wasn't built. Owner picked the proportionate option via
  AskUserQuestion — **multi-brand only** — over "+ brand-scoped reporting" or the full spec's new
  entity set.
- **Multi-brand (migration 0046)** — the one genuinely missing piece: one kitchen/outlet running
  several virtual brands. `brands` (business-wide, not per-outlet — the same "shared catalog" shape
  products/categories already use, so a brand sold from two outlets is one row) + nullable
  `products.brand_id` / `orders.brand_id`, both defaulting to NULL so a business with no brands
  defined behaves exactly as before. New `multi_brand` key in `PLAN_FEATURE_KEYS` (per the standing
  feature-gating convention — automatically controllable by plan/business-type/per-business with zero
  extra code). `brands.controller.js` mirrors `categories.controller.js`'s deliberately tiny shape
  (list/create/update, deactivate rather than delete); wired into `products.controller.js`
  (create/update/list-filter/SELECT) and `orders.controller.js` (create, new `PATCH
  /api/orders/:id/brand` to set or clear it after the fact — mirrors the existing `setWaiter`
  hand-over pattern exactly, since forcing a brand choice into the single-click "New takeaway" flow
  would slow down the fastest, most common path) and `kitchen.controller.js` (the ticket now carries
  `brand_name`, shown as a badge on the KDS card — useful at pack time). Added a tenant-ownership check
  on `brand_id` in all three write paths (a fresh column, not the pre-existing `category_id`/
  `supplier_id` pattern which skips this check — worth getting right from the start rather than
  inheriting a gap). Frontend: a "Brand" field on the product form, created inline exactly like
  Category ("nobody visits FlowXP to manage categories" — brands get the same treatment, no separate
  management page); a "Brand" picker on the order detail header next to the Waiter picker (shown for
  every order type, not just dine-in); the brand shows in the Orders list row, the order detail header,
  and the Kitchen ticket. 11 tests in test/brands.test.js (feature gating, CRUD + isolation, product
  tagging + filtering, order tagging surfacing through list/get/kitchen ticket, set/clear after
  billing is refused, cross-business brand assignment refused on both products and orders). Verified
  live end to end on the real dev DB: created a brand inline from the product form, tagged a product
  with it, opened a table order, assigned the brand via the picker (showed immediately in the Orders
  list), sent it to the kitchen, and watched "Biryani Central" appear right on the KDS ticket. Cleaned
  up all test data afterward. 511 backend tests passing overall.
- **Delivery rider/fleet management + aggregator settlement reconciliation (migration 0047, owner's
  request, 2026-09-29)** — the two pieces from the Cloud Kitchen audit above that the owner asked to
  build for real. **Riders**: reused the business's own staff/RBAC exactly like `orders.waiter_user_id`
  already reuses `users` for waiters — a new `DELIVERY` role added to `business_users` (and its CHECK
  constraint) and `ROLE_PERMISSIONS`, not a separate "delivery executive" entity. `modules/riders.js`
  mirrors `modules/waiters.js` (`eligibleRiders`/`isEligibleRider`), any active non-kitchen/non-stock
  staff at the outlet is eligible, DELIVERY-role people just sort first. Pickup/out-for-delivery/
  delivered are nullable `orders` timestamps (`picked_up_at`/`out_for_delivery_at`/`delivered_at`),
  the same pattern `order_items` already uses for `sent_at`/`ready_at`/`served_at`, not a new status
  enum layered onto the order lifecycle. `PATCH /orders/:id/rider` and `POST
  /orders/:id/delivery-status` (only for `order_type = 'DELIVERY'`, each step requires the one before
  it done and a rider assigned first, idempotent). New `delivery_fleet` plan-feature key; OrderPanel
  shows a rider picker and three step buttons on delivery orders once a rider is set. **Settlement
  reconciliation**: real Zomato/Swiggy/ONDC partner API access is the same class of limit as the
  Google Reviews API (no approval FlowXP has), so this builds the spec's own documented fallback
  (§18) — paste the settlement statement the platform already exports, and FlowXP checks it rather
  than trusting it. `modules/settlements.js` (pure) does two honest checks per line, never an invented
  commission estimate: does the platform's own arithmetic add up (gross − commission − payment/
  delivery charges − tax − other deductions vs. net settled, ₹1 rounding slack), and does the gross
  amount match what FlowXP actually billed for that order (cross-checked via `orders.invoice_id`).
  Matches lines to orders by `(business_id, platform, external_order_id)` — the same key
  `integrations.controller.js`'s webhook dedup already uses. Reuses the existing `integrations`
  feature key rather than a new one (reconciliation is part of "does this business use delivery-
  platform integrations", not a separate capability). New `SettlementsPage.jsx`: paste-a-statement
  import box (fixed column order, comma-separated, no header-mapping engine — this is FlowXP's own
  template, not an adapter for arbitrary real export formats) and a "Never settled" list — billed
  platform orders with no matching statement line at all, the single most valuable check (money that
  should have been paid and wasn't). 19 new tests (`delivery.test.js` 7, `settlements.test.js` 12);
  522 backend tests passing overall. Verified live on the real dev DB: the "Never settled" list
  correctly showed 241 genuine unpaid Zomato orders totaling ₹1,69,181.75 from existing seed data;
  imported 3 real statement lines and watched one MATCHED and two correctly flagged "Doesn't add up",
  then watched the never-settled count drop by exactly those 3 (a real bug found and fixed here: the
  never-settled list didn't refresh after an import — its effect was missing `refreshKey` as a
  dependency); assigned a rider to a real Zomato order and progressed it through Picked up → Out for
  delivery → Delivered on the live Orders screen. All test data cleaned up afterward. Delivery fleet
  (a business's own riders) and real aggregator APIs/fleet dispatch are two different things — this is
  the former only; the latter still needs partner approval FlowXP doesn't have.

## 4c. Pre-launch changes (2026-10-04)

Everything below is in the repo and covered by tests (backend 904 passing at the end of the day).

- **Features by industry.** `modules/planFeatures.js` has `INDUSTRY_OFF`: the features each business type has no use for are OFF by
  default (a salon has no kitchen, tables, reservations, QR ordering, delivery or wholesale features; a restaurant has no salon or
  wholesale ones; cloud kitchen also loses tables/reservations/QR; pharmacy/supermarket/retail keep batches; wholesale drops loyalty;
  OTHER keeps everything). `effectiveFeatureFlags(sources, overrides, businessType)`: `sources` is `[plan flags, type-row flags]`;
  an explicit `true` in the business-type row turns an industry default back on, a per-business override still beats everything,
  a plan's own `true` does NOT. Two new feature keys, `tables` and `kitchen`, gate `tables.routes.js` / `kitchen.routes.js` and the
  Tables and Kitchen nav items. The admin "By business type" grid (`listBusinessTypeFeatures`) shows the defaults merged with saved rows.
  Callers pass the business type (auth.js membership, subscription.js, publicBill/publicOrdering/salonPublic). Tests: `industryfeatures.test.js`.
- **Default option groups.** `modules/defaultOptions.js`: a new RESTAURANT/CAFE/CLOUD_KITCHEN gets Spice level (pick one), Veg extras and
  Non-veg extras at signup; migration 0070 gives the same to existing ones with no groups; a business with its own groups is untouched.
- **Admin console hardening.** Super admin session is 8h (`signToken(user, { expiresIn })`); sign-in takes an authenticator code or a
  single-use recovery code (`AdminLogin.jsx`); `/superadmin/security` (`AdminSecurity.jsx`) sets up 2FA through the account's `/api/auth/2fa`
  routes (the returned token replaces the stored one); a banner shows while 2FA is off; Suspend/Close ask for confirmation; general 300/min
  limiter on `/api/admin`; admin pages are `noindex`. In production `config/env.js` refuses a `.local/.test` SUPER_ADMIN_EMAIL or a
  SUPER_ADMIN_PASSWORD under 14 characters. Tests: `admin2fa.test.js`.
- **Login limits.** `loginLimiter` is 20 failures / 15 min per address and counts only FAILED requests (`skipSuccessfulRequests`), so staff
  sharing one router are not locked out; per-account lockout (5 wrong in 15 min, `modules/security.js`) is the real brake. Wrong password and
  unknown email give the same message, status and timing; forgot-password answers identically for known and unknown addresses.
- **Sign in with Google (existing accounts only).** `modules/oauth.js` + `controllers/oauth.controller.js`: auth-code flow with PKCE, state,
  nonce in a signed httpOnly cookie (`flowxp_oauth`, path `/api/auth`, 10 min). Matches by Google-verified email to a FlowXP account whose own
  email is verified; never creates an account; super admins refused; an account with TOTP gets its challenge in the URL fragment (`#second=`).
  Needs `GOOGLE_CLIENT_ID/SECRET` (+ `GOOGLE_REDIRECT_URI` in dev); the button only shows when `/auth/oauth/providers` says so.
  Steps in `DEPLOY.md` section 2c. Tests: `oauth.test.js`.
- **Flow AI.** `ai/grounding.js` checks money-sized figures (>= 1,000) in an answer against the tool results (rounding, "lakh", sums and
  differences allowed) and appends a "check it" note when one is unmatched; Gemini requests carry `safetySettings` (medium and above);
  the provider tries the next model when one's daily free quota is spent ("retry in Nh") as well as on limit 0 / 404 / 503.
- **Kitchen screen.** Cards are compact and content-height (`items-start` grids, two per row in To make, one in Ready); durations read
  "23h 4m"; a cancelled dish stays on its own table's ticket with a "Got it" button (hidden per device in localStorage `flowxp.kitchenGone`);
  a table with nothing left to cook shows a small notice strip, sorted last.
- **Till.** Item tiles already on the bill are highlighted (border, tint, one-shot pulse); the Bill panel is compact (hints hidden on any
  screen up to 1100px tall: `.pos-hint`, `.pos-methods` one row); UPI QR window has "Print bill with this QR" (the printed bill carries a
  QR for the exact balance). Card/Bank only record the payment: there is no card-terminal integration (needs the vendor's own API).
- **Customer QR menu.** All / Veg / Non-veg (/ Egg when the menu has egg dishes) pills; the visit card's earned stamps press in one after
  another (`.stamp-in`), the next slot pulses (`.stamp-next`).
- **Dashboard.** Sales chart uses a monotone curve (no invented dips) with today drawn dashed ("Today so far"); owners see a plan strip
  (plan, status, billing cycle, next payment, days left).
- **Website.** Home no longer shows the leakage screenshot; WhatsApp/SMS sending is marked "Coming soon" everywhere (Zomato/Swiggy feeds
  too: the adapters are mocks and Zomato's POS API needs 50 restaurants or 10,000 orders/month, per its docs); both logos scroll/go to the top.
- **Ops.** `deploy/nginx.conf` proxies `/health` and `/ready` for an uptime monitor. The Cashfree hosted page shows the brand set in the
  Cashfree dashboard (Payments > One Click Checkout > Settings > Customisation > Visual Customisation > Header: logo and name); our API
  call cannot set it.
- **Still the owner's to do before launch:** production `.env` (NODE_ENV, APP_ORIGIN https, JWT_SECRET, real super admin, Cashfree PRODUCTION
  keys), DNS + certbot, a real email provider, scheduled and off-server backups, 2FA on the super admin, a Gemini spend cap, optional Google keys.

## 4d. Retail / supermarket Phase 4: supplier bill import (2026-10-06)

Read a photographed or PDF supplier bill, match its lines to products, and feed the checked lines into Receive stock. Always reviewed:
nothing is received until the person presses Receive (the existing `POST /api/purchases`); automation levels beyond "always review" are not built.

- `modules/ai/invoiceScan.js`: one forced tool (`record_supplier_bill`): supplier, bill number/date/total, lines (description, barcode, supplier
  code, qty, rate, GST, amount, batch, expiry). `normaliseBill` cleans it (a rate worked out from amount is flagged unsure). Images and PDFs
  (`uploadBillFiles`, `looksLikeBillFile`: a PDF must start `%PDF-`); files held in memory only, one request, counted in `ai_usage`.
- `modules/invoiceMatch.js`: matching order barcode, then this supplier's code (or a code saved for no supplier), then learned wording
  (`product_aliases`), then a name guess (shared words, sizes count double, >= 0.6 preselected, >= 0.34 suggested). `matchSupplier`,
  `findDuplicateBill`.
- `controllers/invoiceImport.controller.js` + `/api/retail/invoice-import/{scan,check,learn}` (retail businesses only, `inventory`
  permission, 10 scans / 10 min / person). `scan` returns a draft with `duplicate_of` and `total_mismatch`; `learn` runs after Receive:
  alias (source SUPPLIER), supplier code (a correction moves a code to the product the person picked), a barcode only if nobody has it;
  another business's product ids write nothing.
- `POST /api/purchases` now stores `supplier_invoice_no` / `supplier_invoice_date` and refuses the same supplier's same bill number
  (409 `DUPLICATE_BILL`) unless `allow_duplicate_bill: true`.
- Frontend: `components/SupplierBillImport.jsx` (pick, reading, review: per line match chip, change/find/new product, qty/cost/GST/expiry, repeated-bill
  and total-mismatch banners) opened from `app/ReceiveStockPage.jsx` ("Read a supplier bill"); checked lines become the page's lines, and what was matched is
  sent to `/learn` after a successful Receive. Tests: `invoiceimport.test.js` (13). Not tried against a real Gemini read of a real bill yet.
- Phase 5 still to do: returns/exchanges at the till, promotions, pricing rules, a retail dashboard, performance tests.

## 4e. Retail / supermarket Phase 5: offers, returns and exchanges, retail dashboard (2026-10-06)

- **Offers** (`migrations/0071`, `modules/promotions.js`, `controllers/promotions.controller.js`, `/api/retail/promotions*`): PERCENT_OFF (optional minimum
  quantity), BUY_X_GET_Y, BUNDLE_PRICE, for one product or one category, optional dates, optional "customers only". `priceLines` is pure: per product
  the single best offer wins (never stacked), the saving is spread over that product's lines to the paisa and capped at what the line still costs.
  `createInvoiceInTransaction` applies them when `input.applyPromotions === true` (the retail till sends `apply_promotions: true`; nothing else does),
  as an extra line discount BEFORE tax, recorded on `invoice_items.promo_id/promo_discount_paise`. The till shows them via `POST /retail/promotions/preview`
  (same rules, debounced) as an "Offers" row and a chip on each line. UI: `app/OffersPage.jsx` (`/app/offers`).
- **Returns and exchanges**: `app/ReturnsPage.jsx` (`/app/returns`, `refunds` permission) finds a bill (number, name, phone) and opens the existing
  `CreditNoteModal` (GST reversed exactly, stock back). "Keep as credit" leaves the credit on the note (`credit_left` in `asCreditNote`); "Start the
  exchange sale" opens the till with `?exchange=<cn_id>`. The credit is spent as a PAYMENT (method OTHER, reference "Exchange CN-xxxx"), never as a
  discount (the return already took that revenue off the old sale), recorded in `credit_notes.credit_used_paise`; it cannot be spent twice and a smaller
  exchange leaves the rest. Server: `input.exchangeCreditNoteId` in `modules/billing.js`.
- **Retail dashboard**: `RetailPanel` in `app/Dashboard.jsx` (stock at cost and shelf value, out, low, expiring, expired: tiles link to the stock center with
  `?status=`; offers and returns today from `GET /api/retail/today`).
- **Performance** (`scripts/perf-phase5.js`, 100,000 products, p50 / p95): price a 300-line cart with 100 offers 0.6 / 1.9 ms; cart preview endpoint 6.5 / 9.2 ms;
  a 40-line bill with offers 100 / 141 ms; match 200 supplier-bill lines 294 / 305 ms; find a bill by number 2.7 / 3.3 ms. `scripts/perf-retail.js` covers the
  product lookups.
- Tests: `promotions.test.js` (11), `offers2.test.js` (10).
- **Offers, second round** (`migrations/0072`): weekdays (`days_of_week`, 0 = Sunday) and hours (`start_time`/`end_time` in the business's own clock, an end before
  the start runs overnight; `businessNow()` in `utils/dates.js`); `MIX_BUNDLE` = N units from a SET of products (`promotion_products`) for one price, made from
  the cheapest eligible units first and only on units no other offer has cut; offers also work in the restaurant family (routes allow shops and restaurants,
  the counter bill and `POST /orders/:id/bill` send `apply_promotions`, Offers is under More for restaurants); an exchange credit can be typed in by number at
  ANY outlet (`GET /credit-notes/by-number/:number`, business-scoped, returns only number and credit left).
- **Caching** (`utils/cache.js`, in-process, TTL + single-flight + drop by prefix; fine while the API is one PM2 process, otherwise each instance keeps its own
  copy for at most the TTL): active offers 60 s per business and day (cleared by every offer write; weekday and hour are checked on every call so an offer starts
  and stops on time); the retail dashboard figures (`/retail/summary`, `/retail/today`) 30 s per business and outlet. The stock center itself, bills and till
  lookups are never cached. Browser side: `lib/useSwr.js` (sessionStorage, keyed by business and outlet) shows the last answer at once then refreshes: used by the
  retail dashboard panel and the Offers list. Measured on 100,000 products: active offers 2.5 ms from the database, 0.0 kept; dashboard figures 54 ms, 0.0 kept.
- Not built: mixed-product "buy A get B free", offers that need a minimum bill value, a refund screen separate from credit notes, caching across several API instances.

## 4f. Café defaults and café page (2026-10-07)

- `modules/defaultOptions.js` now picks the set by type: RESTAURANT/CLOUD_KITCHEN keep Spice level + Veg/Non-veg extras; CAFE gets Size (Small 0, Regular +20, Large +40),
  Milk (full cream, toned, oat +40, almond +50, soy +40), Sugar (one choice each) and Add-ons (extra shot, syrup, whipped cream, drizzle; optional, up to 3).
  Signup passes the business type. `migrations/0073` swaps an existing café's three untouched restaurant defaults for the café set, only when none is used by a dish
  (a café with its own groups, or dishes using them, is untouched). Tests in `defaultoptions.test.js`.
- Website: `site/industries/content/cafe.js` is a real page at `/industries/cafe` (aliases `cafes`, `coffee-shop`, `bakery`); the restaurant page is now restaurants only;
  seo, sitemap, llms.txt and the nav icon updated. Its screenshots are the real screens of the demo café.
- Demo café: `cd backend && npm run seed:cafe` (script `scripts/seed-cafe.js`) builds "Brew & Bloom Café" (login cafe@flowxp.test / demo1234, dev DB only): café option groups with
  stock usage, 28 menu items with recipes, three stations (Coffee Bar, Cold Bar, Bakery & Kitchen), tables, a visit card, two offers (weekday happy hour, any 2 bakes for ₹180) and
  30 days of bills made through the real billing engine. Screenshots are `frontend/public/product/cafe-*.webp` (11 files; QR is a phone shot, `phone: true` in cafe.js).

## 4g. Mobile app, phase 0 (2026-10-07): backend foundations (plan in `MOBILE.md`)

- Migration `0074_mobile_sync`: `invoices.client_key` (unique per business) and `sync_log` + `sync_state` with one trigger function on products, barcodes, outlet price,
  outlet stock, categories, customers. Pruned after 30 days (`sync_state.floor_seq` records how far).
- `POST /api/invoices`: the Idempotency-Key is also kept on the invoice; a replay (even after the 48 h key table forgot it) or two at once returns the same invoice.
  `offline: true` in the body records the sale even if stock is short. Other sale routes (restaurant bill-an-order, held bills) are not covered yet.
- `GET /api/auth/me`: a Bearer caller gets a fresh `token` (sliding session); a cookie caller never does. No separate mobile login.
- `GET /api/sync/head`, `GET /api/sync/changes?since&limit` (`sync.controller.js`, permission billing, needs a chosen outlet): current rows, collapsed, paged, `409 RESYNC`.
  `products.controller.js` exports `posRowsByIds`; pos-catalog and the deltas share one row shape.
- Tests: `test/sync.test.js` (11). Not yet synced: offers; not yet built: any app code (phase 1 is the React Native till).

## 4h. Mobile app, phase 1 (2026-10-07): the online till (`mobile/`)

- Expo SDK 57 + Expo Router (routes in `src/app`), logic in `src/lib` (api, catalog, cart, sale, session, receipt, money) with `npm test` (node --test, strip-types).
  Screens: login, choose (business+outlet in one list), till, scan (modal), pay, receipt. State is a tiny `createStore` (no library); token in expo-secure-store.
- The app shows a PREVIEW total (price x qty + GST); the server's invoice is what the receipt shows (offers like "any 2 bakes" make the two differ).
- Backend fix made on the way: `pos-catalog` now sends `modifier_group_ids` (migration 0075 makes changing them a sync change). Without it the app thought café drinks had no options.
- Needs `.npmrc legacy-peer-deps=true` (an optional react-native-worklets peer conflict). `npm run e2e` makes ONE real sale in the business it points at.
- Not run on a real phone or emulator yet (none available here). Next: phase 2 (SQLite catalogue + outbox + offline sale).

## 4i. Mobile app, phase 2 (2026-10-07): offline billing

- `src/lib`: `db.ts` (Db interface: expo-sqlite on the phone, Node's SQLite in tests), `catalog.ts` (SQLite copy + delta sync), `outbox.ts` (unsent sales),
  `till.ts` (`takeSale`: online or queue; `sendEntry`), `local.ts` (per business+outlet database, app kv), `sync.ts` (badge state + auto sync), `receipt.ts` (+ pending receipt).
- Server: `invoices.create` reads `X-Offline-Sale: 1` and `X-Sale-Date` (body `offline` / `invoice_date` still work); offline sales are never refused for stock; the sale day is
  believed within 7 days (else today). Headers, not body, so a queued retry's body equals the first attempt's (the 48 h guard compares bodies).
- A refusal while ONLINE is shown to the cashier and never queued; only "could not reach the server" queues.
- Tests: `mobile/test/offline.test.ts` + `helpers.ts` (fake server with switches: down, status, hang, lostReplies), `npm run e2e:offline` makes 3 real sales in the demo business.
- Not run on a real phone. Next: phase 3 (café/restaurant counter: options, token numbers, offers preview, orders/held bills with the sale key).

## 4j. Mobile app, phase 3 (2026-10-07): the café counter

- `lib/options.ts` (pure picker rules), `lib/offers.ts` (`previewOffers`), `lib/cart.ts` (lines keyed by product + sorted option ids; `totals(cart, offers)` takes the offer off
  BEFORE GST; `saleBody` adds `modifier_ids` and `send_to_kitchen`), catalog `groups` table + `groupsFor`/`byId`, `app/options.tsx` modal, kitchen switch and offer line on the till, token on the receipt.
- Server: `invoices.create` ignores `send_to_kitchen` for an offline sale (header `X-Offline-Sale`). The queued body still equals the first attempt (it includes the kitchen flag).
- Tests: `mobile/test/counter.test.ts`, `npm run e2e:cafe` (makes 2 real sales in the demo café), backend `sync.test.js` now 15.
- Left for later: table orders / open orders, held bills, customer lookup and visit card, combos, split payments, receipt printer.

## 4k. Mobile app, phase 4 (2026-10-07): polish and release prep

- Backend: migration `0076_app_errors`, `appErrors.controller.js` (`POST /api/app-errors` public + limiter 30/15 min; `GET /api/admin/app-errors` grouped), `test/apperrors.test.js`.
- Mobile: `lib/report.ts` (pure reporter: dedupe 1/min per message, queue of 20) + `lib/crash.ts` (wiring, global handler), `lib/print.ts` (expo-print, 58/80 mm), `app/settings.tsx`,
  root `ErrorBoundary` in `_layout.tsx`, outbox `device()`/`forgetSent()`, `catalog.clear()` also clears groups. `app.json`/`eas.json`/`store/`/`STORE.md`/icons.
- `npm run release:check` = typecheck + tests + expo-doctor + android export. Tests: `mobile/test/release.test.ts` also checks the permissions, icon sizes and build profiles.
- The updates URL, EAS project id, Play key and screenshots are the owner's (see `mobile/STORE.md`). The app is still untested on a real phone: `MOBILE.md` has the checklist.

## 4l. Mobile app pages (2026-10-07)

- Routes: `app/(tabs)/{home,sell,sales,products,more}.tsx`; stack screens `customers`, `customer/[id]`, `product/[id]`, `product/new`, `stock`, `reports`, `waiting`, `settings`, `pay`, `receipt`, `options`, `scan`.
- Shared: `lib/useLoad.ts` + `cache.ts` (last answer kept per business/outlet/query), `ranges.ts`, `responsive.tsx` (`useWide` at 768, `Page` max width), `ui.tsx` (Chips, Stat, Line, Loading, Failed, SavedNote, Empty), `capture.ts` (scan a barcode for a form), `SyncBadge`, `WaitingList`.
- Catalogue additions: `categories()`, `search(text, limit, category, offset)` (uses SQLite `json_extract`).
- `expo-font` must stay installed (the icons need it; expo-doctor flags it). `app.json` orientation is `default`.
- Backend: idempotency on `POST /products` and `POST /customers`.

## 4m. Mobile: table orders and held bills (2026-10-07)

- `lib/orders.ts` (floor/order types, `tableState`, `orderTotals`, `byZone`), `lib/held.ts` (snapshot in the website till's shape, `fromSnapshot`, phone-only holds in SQLite, `holdBill`), scope now has `held`.
- Screens: `(tabs)/tables.tsx` (food businesses only; Products tab hidden for them), `order/[id].tsx`, `order/add.tsx`, `held.tsx`; `options.tsx?order=` adds to an order, `pay.tsx?order=` bills an order, `customers.tsx?pick=order-ID` sets an order's customer.
- Backend: `POST /orders/:id/items` now honors the Idempotency-Key. Tests: `mobile/test/orders.test.ts`, `npm run e2e:orders`.

## 4n. Mobile: kitchen screen (2026-10-07)

- `lib/kitchen.ts` (pure: `urgencyOf`, `sortTickets` per station, `cookNow`, `statsOf`, `alertFor`, same rules as the website's KitchenDisplay.jsx), `app/kitchen.tsx` (polls 8 s, ticks 15 s, `expo-keep-awake`, `Vibration` for alerts, undo 7 s).
- Routes used: `GET /kitchen/tickets`, `POST /kitchen/advance`, `POST /kitchen/orders/:id/rush`. A KITCHEN-role user is sent straight there from `index.tsx`.
- `mobile/test/kitchen.test.ts`, `npm run e2e:kitchen`. No backend change. Not done: audio alert, station/routing setup, performance report.

## 4o. Fixes from the first real-phone run (2026-10-07)

- "database is locked" on a real phone: the full catalogue download held one long exclusive transaction while the screen read the same file. Now the phone's database is WAL with `busy_timeout` 5 s
  (`openOnPhone`, and each `tx` sets its own), the download is written to side tables (`products_next`, `barcodes_next`) in small steps and swapped in one short transaction, and a non-network,
  non-server sync error is reported as a phone-storage problem (it used to say "FlowXP is not answering").
- `pos-catalog` and the sync deltas no longer send INGREDIENT or PACKAGING products (a menu full of Rs 0 "Almond Milk" and "Bread Slices"). `COPY_VERSION` in `catalog.ts` makes every phone with an
  older copy download once more; bump it whenever what the phone keeps changes meaning. Tests: `sync.test.js` (16), `offline.test.ts` (versioned re-download).

## 4p. Pending (2026-10-07)

See `HANDOFF.md` section 9 (waiting on the owner, not built in the mobile app, before the Play Store, launch tasks) and `MOBILE_AUDIT.md`. Nothing from the mobile work is committed yet.

## 4r. Gym module (2026-10-12): business type `GYM`

Read `GYM.md` (overview, policies, limits, API list), `GYM_DEVICES.md` (gate contract), `GYM_PLAN.md` (audit and status). Code: `backend/src/modules/gym/*` (`access.js` is the one decision engine every door uses), controllers `gym*.controller.js`, routes `gym.routes.js` (staff), `gymPublic.routes.js` (members, cookie `flowxp_member`),
`gymDevice.routes.js` (signed device requests); migrations 0087 to 0091; screens `frontend/src/app/gym/*` and `frontend/src/public/GymPortal.jsx`; seed `npm run seed:gym`; tests `backend/test/gym*.test.js`.
Rules to keep: membership state is derived (dates, freezes, the invoice) at the moment of use, never stored; payment access is the plan's rule read from the invoice; QRs carry only random tokens (hash stored); failure is closed (`SERVICE_UNAVAILABLE`); points are one ledger row per event (unique source) and the balance is the ledger;
anything that must not break a visit or a sale (rewards) runs in a savepoint (`safely`). Permissions `gym_desk`, `gym_members`, `gym_setup`, `gym_trainer`; plan features `gym_access`, `gym_self_checkin`, `gym_classes`, `gym_rewards`, `gym_devices`. `tenant.userId` now exists (used to scope a trainer's login).
Not built: online payment by members, vendor gate adapters, RFID credentials, gym screens in the phone app.
Wholesale and distribution merged at the front (2026-10-12): one signup choice (`WHOLESALE`; `DISTRIBUTOR` removed from `SIGNUP_TYPES`, still valid when stored), one website page `/industries/wholesale` (distributor.js is appended to wholesale.js; `/industries/distributor` redirects), and the distributor tools are a Super Admin switch per business (`distributor_enabled`), no longer the owner's. Back end unchanged otherwise: one module, `DISTRIBUTOR` role/type kept. Further merging (roles, type values) deliberately not done.
Marketing site: `/industries/gym` (`frontend/src/site/industries/content/gym.js`, registered in `industries/data.js`; screens `public/product/gym-*.webp` are real captures of the seeded demo gym), a Gym tab on the home page, nav icon, SEO strings, sitemap and `llms.txt`. Its "not yet" list must stay in step with the real limits above.

## 4s. Gaming lounge (2026-10-12): business type `GAMING_CAFE`

Read `GAMING.md` (design, rules, API, limits) and `GAMING_PLAN.md`. Core idea: **a station is a dining table, a session is that table's tab**; the time is written onto the tab as a SERVICE line when the timer stops, so one
GST invoice bills time + food (reuses orders/KOT/QR menu/billing). Code: `backend/src/modules/gaming/*` (`pricing.js` pure, `sessions.js`, `wallet.js`, `passes.js`, `bookings.js`, `tournaments.js`, `reports.js`, `alerts.js`),
controllers `gaming*.controller.js`, routes `gaming.routes.js`; migrations 0092 to 0094; screens `frontend/src/app/gaming/*`; seed `npm run seed:gaming`; tests `backend/test/gaming*.test.js`.
Rules to keep: time is derived from segments (never a counter); a tab with a live session cannot be billed/cancelled/moved/merged; the wallet balance is the ledger (WALLET payments debit it in billing.js, lounge only); permissions `gaming_desk`,
`gaming_setup`; role `GAMING_ATTENDANT`; plan features `gaming_stations|wallet|bookings|tournaments`. Not built: any console/PC lock, a player phone page, online booking, brackets, phone-app screens.
Website: `/industries/gaming` (`site/industries/content/gaming.js`), home tab, signup option (`GAMING_CAFE` in `SIGNUP_TYPES`).

## 4t. Auto spare parts (2026-10-12): business type `AUTO_PARTS`

Read `AUTO_PARTS.md` (rules, data, API, limits) and `AUTO_PARTS_PLAN.md` (assessment, decisions, phase status). A part is a `products` row (kind DISH) plus a 1:1 `autoparts_parts` profile; part numbers live in `autoparts_part_numbers` (normalised key, searched by the shared
`searchClause`/`findByCode`). **Stock rule:** `branch_stock` (moveStock only) is the one total; `bin_stock` holds part of it (`sum(bins) <= branch stock`, rest = unassigned); `moveStock` calls `trimBins` (modules/autoparts/binHook.js) on every decrease so no caller needs to know bins exist.
Fitment is VERIFIED / UNVERIFIED / NOT_FIT per model, never assumed, no built-in vehicle data. Receiving wraps the wholesale GRN (`modules/autoparts/grn.js`: received = accepted + damaged + rejected, put-away on receipt or a task, cancel for direct purchases). Billing for this type (billing.js, `tenant.businessType === 'AUTO_PARTS'`):
trade price list, available = on hand - held for others, own hold used up, unpaid part of a bill is credit and the limit (BLOCK) applies, `unit_factor` must be 1; invoices.controller flags offline sales that leave stock below zero; creditNotes.controller takes `return_reason` + `disposition`; retailStock.applyCount needs `stock_approve` for differences above `autoparts_settings.count_auto_units`.
Code: `backend/src/modules/autoparts/*` (common, parts, vehicles, locations, bins, binHook, grn, sales, returns, intelligence), controllers `autoparts*.controller.js`, `routes/autoparts.routes.js`; migrations 0095 to 0099; screens `frontend/src/app/autoparts/*`; seed `npm run seed:autoparts`; tests `backend/test/autoparts*.test.js`; perf `node scripts/perf-autoparts.js`.
Permissions `parts_catalog, warehouse, grn, stock_approve, stock_count, returns_process, price_change, valuation, warehouse_settings`; roles `STOREKEEPER`, `PARTS_COUNTER`; plan features `ap_catalog|racks|grn|transfers|counts|pricing|intelligence`. Not built: till vehicle picker, per-bin counts, bin-aware outlet transfers, per-part trade price screen, part numbers/bins in the offline catalogue, layer ageing, serial/warranty, phone-app screens.
Website: `/industries/auto-parts` (`site/industries/content/auto-parts.js`), home tab, signup option.

## 4u. Mobile: wholesale and distributor merged (2026-10-13)

The app treats WHOLESALE and DISTRIBUTOR as one (`isWholesale` in `mobile/src/lib/retail.ts`). The server already sends `distributor_enabled` in /auth/me (same switch as the web: Super Admin or wholesale settings); `Business.distributor_enabled` is now typed in `session.ts`. `isDistributor(b)` (DISTRIBUTOR, or wholesale with the switch on) gates the field-sales extras: "My route" and "My van" (More tab, WholesaleHome). Orders, collect, returns, warehouse, buying and transfers show for every wholesaler. Test: `mobile/test/wholesalemerge.test.ts`. Mobile node_modules are not installed on this machine, so typecheck, i18n, printer and release tests could not run here.
Hotel on the phone (2026-10-13, online only): `mobile/src/lib/hotel.ts` (types, helpers), screens `app/hotel.tsx` (Front desk: today's arrivals/departures, in the house, rooms with housekeeping state; More tab, permission `front_desk`/`housekeeping`) and `app/hotel-booking/[id].tsx` (stay, folio, check-in, advance/payment, check-out), and "Charge to a room" in `app/pay.tsx` for HOTEL (till and table bills; posts `charge_to_booking_id`, online only). Check-in needs rooms already assigned (assign on the website). Not on the phone: new bookings, walk-ins, move room, charges, banquet, staff, night audit. Tests `mobile/test/hotel.test.ts`. Restaurant: mobile contract spot-checked against the backend routes (orders, tables, kitchen, reservations, waitlist all exist); no code change.
Restaurant audit (2026-10-13): the phone had tables, orders, split/merge/move, KOT, kitchen screen, bookings, waiting list, held bills, products/prices, stock, purchasing, expenses, reports, customers, returns. Added `lib/delivery.ts` + `app/incoming.tsx` (orders waiting to be accepted: Zomato/Swiggy/ONDC/Magicpin/QR/website; accept sends to kitchen, turn down with a reason; polls every 6 s and buzzes; red banner on the Tables tab) and `app/deliveries.tsx` (open deliveries: choose rider, picked up, out, delivered; rider and steps are plan-gated by `delivery_fleet`). Tests `mobile/test/delivery.test.ts`. Still web-only for restaurants: kitchen performance, order-ready board, profitability/forecast/leakage reports, loyalty, messaging, reviews, integrations setup, settlements, outlets, stock requests, staff, activity log, recipes, options and offers management, multi-brand order choice, receiving a QR order's guest details.
Hotel phase 2 on the phone (2026-10-13): `mobile/src/lib/hotelDesk.ts` (+ `hotel.ts`), screens `app/hotel-new.tsx` (new booking and walk-in: guest search/new, dates, nights, rooms, adults/children, room type, rate plan, optional room number, server quote, advance), `app/hotel-booking/[id].tsx` now also: choose room numbers at check-in (free rooms of the type), allow a dirty room after a warning, take an advance, add and void charges, move to another room, cancel with a reason, mark no-show, check-out that handles `BALANCE_DUE` (the server adds room charges as the bill closes and names the amount). Walk-ins need a room number and are one room at a time. Backend: the hotel POST routes for bookings, walk-ins, charges, payments and check-out were missing `idempotent()` (a double tap booked twice); added in `routes/hotel.routes.js`. Live check against the running server: `node --experimental-strip-types --no-warnings mobile/scripts/hotel-live.mts` (14 steps, passes on a freshly seeded hotel; leaves its guests checked out). Still web-only for hotels: change dates, guest profiles, banquet, housekeeper assignment, night audit, staff, reports, setup (rooms, rates, blocks).
Auto parts on the phone (2026-10-13, online only): `mobile/src/lib/parts.ts` and screens `app/parts.tsx` (find by name, code, barcode or any part number), `app/parts-part/[id].tsx` (price, stock, bins with pick bin, numbers, fitment shown verified/not verified), `app/parts-vehicle.tsx` (parts for a make, model and year), `app/parts-warehouse.tsx` (look in a bin by scan or code, put away, move between bins), `app/parts-receive.tsx` (accepted/damaged/rejected, bin per line, duplicate invoice refused). More tab entries for AUTO_PARTS gated by `parts_catalog|warehouse|grn|billing`. Tests `mobile/test/parts.test.ts`; live check `node --experimental-strip-types --no-warnings mobile/scripts/parts-live.mts` (12 steps, seeded shop). Backend: migration 0100 makes wholesale GRN rows cascade (a business with receipts could not be deleted). Not on the phone: holds, trade prices/credit, returns with disposition, supplier claims, reports, adding parts, fitment edits, till vehicle picker, offline part-number search.
Gaming and gym staff screens on the phone (2026-10-13, online only): `mobile/src/lib/gaming.ts` + `app/gaming.tsx` (lounge board: stations by zone with ticking timers, start with players/offer/alarm, pause, resume, stop and bill, undo stop, cancel a mistake with a reason, frame count, "Take payment" and "Food and drink" open the station's tab order; GAMING_CAFE added to `KITCHEN_TYPES` so the Tables/Kitchen tabs work for its tabs), `lib/gym.ts` + `app/gym.tsx` (front desk: scan a pass with the camera, find a member and check in after "Is this X?", answer with reason and next step, verification confirm, recent strip with first names, desk numbers). Tests `mobile/test/gaming.test.ts`, `gym.test.ts`; live checks `mobile/scripts/gaming-live.mts` and `gym-live.mts` (seeded lounge / gym). Not on the phone: wallets, hour packs, bookings, tournaments, stations/rates setup, player profiles, gaming reports; gym members' profiles, selling or renewing memberships, classes, rewards, attendance corrections, devices, reports. A gaming session stopped within the grace time has nothing to charge and the station simply frees.
Mobile account flow and test run (2026-10-13): sign-up in the app (`app/signup.tsx` + `lib/account.ts` + `lib/EmailCode.tsx`: 7-day trial, 12 business types, terms agreed, 6-digit email code), email-code step when signing in to an unconfirmed account, forgot password in the app (`app/forgot.tsx`), in-app account deletion (`app/delete-account.tsx`, password and sign-in code; the only owner of a business is told to hand it over), privacy and terms links on sign-in, sign-up and Settings. Live check `mobile/scripts/signup-live.mts` (11 steps; makes a throwaway `@mobile-live.test` account). Expo SDK patched to 57.0.28 (expo-doctor 21/21), Android bundle exports, generated manifest checked. Policy checklist and the test recipe are at the end of `mobile/STORE.md`. No APK could be built here (no Java or Android SDK, and EAS needs the owner's Expo login): `eas.json` has a `test` profile to fill in. To test now: API on :5100, `mobile/.env.local` points at the laptop's LAN IP, `npm run phone`, scan the QR with Expo Go (push alerts only work in a real build).
Bug reports, loading, no-internet and error screens (2026-10-13): backend migration 0101 extends `app_errors` (kind CRASH/REPORT, category, description, user_id, business_id, status NEW/SEEN/FIXED/IGNORED, note); `POST /api/app-reports` (signed in; the person and business come from the session) and admin routes `GET /admin/bug-reports`, `PATCH /admin/bug-reports/:id`, `GET /admin/app-errors?status=`, `PATCH /admin/app-errors/status`, `GET /admin/bug-summary` in `controllers/appErrors.controller.js`; a crash marked FIXED that happens again returns as NEW; crashes kept 30 days, written reports 180. Admin screen `frontend/src/admin/AdminBugs.jsx` (nav "Bugs" with a badge of what is new): Reports (who, email, business, app version, phone, screen) and Crashes (grouped, times, phones, stack). Mobile: `app/report.tsx` (Report a problem: from More, Settings and the error page; waits on the phone with no signal and is sent later via `lib/bugsend.ts`), `lib/net.ts` + `lib/OfflineBar.tsx` (a bar over every screen while the server cannot be reached, rechecks every 8 s), `Failed` shows a "No internet" panel for connection errors, `lib/Splash.tsx` (logo and spinner at start, a "taking longer" hint after 8 s), the error page has the logo and a report button. Tests `backend/test/appReports.test.js`, `mobile/test/neterror.test.ts`; live check `mobile/scripts/bugs-live.mts` (11 steps, makes a dev admin `bugs-admin@flowxp.test` / `demo-admin-1234`, dev only). The mobile screens themselves were not looked at on a phone.
Super admin launch tools (2026-10-13): `controllers/adminSupport.controller.js` + routes in `admin.routes.js`: `POST /admin/businesses/:id/extend-trial {days 1-90}` (from today or the running end, status back to TRIAL), `GET/POST/DELETE /admin/businesses/:id/notes` (private support notes, migration 0102 `admin_notes`), `GET /admin/users`, `GET /admin/users/:id`, `POST /admin/users/:id/{sign-out,verify-email,reset-2fa}` (refused for platform admins, all audited), `GET /admin/audit` (activity log filters), `GET /admin/launch-checks` (payments keys/live mode, SMTP, messaging, admin 2FA, secrets, https, production mode, migrations, pending deletions, new bugs). `GET /admin/businesses` also filters `type` and `subscription_status`. Screens: `admin/AdminUsers.jsx` (People), `AdminActivity.jsx`, `LaunchChecks.jsx` on the overview, AdminBusinesses (filters, trial column, pagination, Export CSV), AdminBusinessDetail (Extend trial, Support notes). Test `backend/test/adminSupport.test.js`. Not built: announcements, coupons, mobile force-update, view-as-business.
Pre-launch mobile check (2026-10-13): `mobile/scripts/account-live.mts` runs the whole account life against a live API (sign up, resend/wrong/right email code, forgot password with wrong/right code, weak new password, old password and old session stop working, sign in with the new one). Note the API allows 5 sign-ups an hour and 20 failed logins per 15 minutes per address (restart the dev API to clear them between live runs). The older `e2e*.ts` scripts need `FLOWXP_URL/EMAIL/PASSWORD` (the demo seeds: cafe, pharmacy, salon, wholesale, distributor; field/van/distributor need `wholesale_settings.distributor_enabled`). Field/van order estimates with no signal use the shop's last server price per piece (`rememberShopPrices`/`loadKnownPrices` in `mobile/src/lib/field.ts`, kept per shop in kv `shopprices:<id>`, newest 400 products, learned whenever the order screen gets a server preview); a product never priced for that shop still uses the shelf price, so a first-ever offline order for a shop on a tier can still arrive flagged "Check".
Languages (2026-10-14): en, hi, ml, ta, bn on web + phone; see `I18N.md` (rules, storage, how to add a language, what is not done). `users.language` + `businesses.default_language` (migration 0103), `PATCH /auth/language`, web i18next in `frontend/src/i18n/*` (resources in `locales/<code>/<ns>.json`, translated: shell/sidebar, auth pages, site header/footer, language settings), phone `lang*.ts` + `i18n.more.ts` (ml/ta/bn = 105 core texts only). ml/ta/bn/hi are machine translations, not native-reviewed. Tests: `frontend/test/*.test.js`, `mobile/test/langpref.test.ts`, `backend/test/language.test.js`, `mobile/scripts/language-live.mts`.
Screen translation (2026-10-14): web screens use `useT()` / `tr('English text')` + `locales/<code>/screens.json` (see I18N.md); `frontend/scripts/i18n-extract.mjs` converts a folder of screens, `i18n-prune.mjs` cleans. Core daily screens are done in en/hi/ml/ta/bn/te/kn (~1,150 texts, machine-translated); industry screens, admin console and the phone's full dictionary are not.
Mobile node_modules are now installed: `tsc --noEmit` clean, 293 mobile tests pass, a11y scan clean.
Mobile plan: the in-scope order is done (wholesale merge, restaurant, hotel, auto parts, gaming, gym). Phone gaps are listed per industry above; the website remains the full back office.

## 5. Working rules for future sessions

- **Test every feature** in `backend/test/<feature>.test.js`; run the full `npm test` and `npx vite build` before reporting. Real DB, throwaway
  per file. Controllers are tested with fake `req/res` (`fakeRes()`), tenants built by a `makeBusiness()` helper in each test.
- **Isolation tests are mandatory**: another business gets 404; a user pinned to outlet A cannot reach outlet B by id.
- **Migrations are forward-only**; add `00NN_name.js` with a header comment. Never edit an applied one after it has shipped (edited 0024 only
  because it had not been applied anywhere). Test DBs get all migrations fresh.
- Postgres gotchas hit before: use explicit casts (`$1::varchar`, `::bigint`) when a parameter is used twice with different types (error
  42P08); avoid foreign keys that make a fire-and-forget insert lock rows a billing transaction holds (deadlock: `messages.customer_id`,
  `points_ledger.customer_id` deliberately have none); lock the customer row (`FOR UPDATE`) when two tills could spend the same balance.
- Row locks: never `FOR UPDATE` a row that other inserts reference by foreign key (a branch, a business used only for its counter is fine but a branch is not): the FK checks of concurrent inserts (audit log, orders) take a KEY SHARE lock in a different order and deadlock with it. Use `FOR NO KEY UPDATE` when only a non-key column changes (invoice numbering on `branches` hit this).
- Do not return `{error, status}` shaped objects from a function that can also return a DB row (rows have `error`/`status` columns): use `problem/code`.
- Reports: money via `toRupees`; revenue nets credit notes (`credited_paise`, `cn_refunded_paise`).
- Update `documentation.md` (a paragraph per feature in section 6/8 style) and this file when a feature ships.
- Answer the owner in plain language, not code: what it does, what is not included, what they must do to go live, then name the next item.

### Tooling quirks on this machine (Windows)
- Bash heredocs containing apostrophes/backticks often fail: write files with the Write tool or a scratchpad `.cjs` patch script, run with node.
  Scratchpad dir: `C:\Users\abdul\AppData\Local\Temp\claude\D--ManagerXp-flowxp\<session>\scratchpad`.
- Source files are LF in the working tree (git warns LF→CRLF); patch scripts normalise `\r\n` before matching.
- Restart the API: stop the process on port 5100 (PowerShell `Get-NetTCPConnection -LocalPort 5100` + `Stop-Process`), then `preview_start flowxp-api`.
  `.claude/launch.json` has `flowxp-api` (5100), `flowxp-web` (5174), `flowxp-preview` (4173, built app; CORS blocks it for login, use 5174).
- Vite dev does not register the service worker (production builds only). To test offline: `vite build` + `flowxp-preview`, stop the server, reload.
- `cache.match` needs `{ ignoreVary: true }` (vite preview sends `Vary: Origin`).
- Logging into the browser with the seed demo creds on localhost is allowed for testing; never with real credentials.
- curl `-F @/tmp/...` fails on Windows: use a cwd-relative file.

## 6. Environment variables (backend)

Required: `DATABASE_URL`, `JWT_SECRET` (≥32 chars in production). Common: `PORT`, `APP_ORIGIN` (https in production; also builds bill links),
`CORS_ORIGINS`, `SMTP_*`/`MAIL_FROM`, `SUPER_ADMIN_EMAIL/PASSWORD`, `ANTHROPIC_API_KEY`/`AI_MODEL`/`AI_MAX_TOKENS`,
`STORAGE_DRIVER` (`local`|`s3`) + `S3_ENDPOINT/REGION/BUCKET/ACCESS_KEY_ID/SECRET_ACCESS_KEY/PUBLIC_URL`,
`MESSAGING_PROVIDER` (`log`|`whatsapp_cloud`|`twilio`) + `WHATSAPP_TOKEN/PHONE_ID/TEMPLATE_LANG`, `TWILIO_SID/TOKEN/FROM/WHATSAPP_FROM`,
`MESSAGING_COUNTRY_CODE` (default 91), `WORKER_ENABLED`. Also `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` (Sign in with Google; blank hides the button). In production the boot check also rejects a `.local/.test` `SUPER_ADMIN_EMAIL` and a `SUPER_ADMIN_PASSWORD` under 14 characters. `backend/.env.example` is the one source of truth for every setting (also `CORS_ORIGINS`, `STORAGE_DRIVER`/`S3_*`, formerly only in a docker-compose-only root `.env.example` — that file is gone now that deploy is PM2, not containers).
`SMTP_*`, `MESSAGING_*`/`WHATSAPP_*`/`TWILIO_*` and `CASHFREE_*` are now just the fallback — a row in
`platform_settings` (Super Admin → Settings) overrides them without a restart; see brain.md's platform-
settings entry in section 4.

## 7. Data model map (tables by area; details in documentation.md section 6)

- Tenant: `users`, `businesses` (settings JSONB: `receipt_settings`, `messaging_settings`), `business_users`, `branches`, `plans`, `subscriptions`, `audit_log`, `analytics_events`
- Catalog: `categories`, `products` (`kind` DISH/INGREDIENT/PACKAGING, `is_combo`, `station_id`), `product_branch_settings`, `modifier_groups`/`modifiers`, `recipe_items`, `combo_items`
- Stock: `branch_stock`, `inventory_transactions` (ledger), `stock_transfers`, wastage, `kitchen_stations`
- Sales: `invoices` (+ `share_token`, points columns, credited), `invoice_items`, `payments`, `refunds`, `credit_notes`/`credit_note_items`, `customers` (`marketing_opt_out`)
- Floor: `dining_tables` (`waiter_user_id`, `qr_token`), `orders` (`waiter_user_id`), `order_items`, `kot_tickets`, `reservations`, `waitlist_entries`
- Buying: `suppliers`, `purchases`, `purchase_orders`/items, forecast tables, `leakage_*`
- Loyalty: `loyalty_programs`, `loyalty_events`, `coupons`, `coupon_redemptions`, `points_programs`, `points_tiers`, `points_ledger`
- AI: `ai_conversations`, `ai_messages`, `ai_usage`; messaging: `messages`; notifications; `idempotency_keys`, `schema_migrations`
- Platform (super-admin, not tenant-scoped): `plan_versions`, `business_type_features`, `business_feature_overrides`, `addons`/`addon_orders`, `platform_settings`

## 8. Product decisions already made (do not re-ask)

- Multi-outlet: separate stock per outlet; shared menu with per-outlet price + availability; full scope (switcher, compare, transfers, staff).
- Loyalty: owner-set free item on the Nth visit (default 7th), keyed by customer mobile, works from the QR menu; points/tiers are a second, optional scheme.
- Menu upload: read from a photo with AI, price included, **always confirmed by the user** before saving (never auto-write).
- AI manager answers only from the business's own data through tools; customer phone numbers are not sent to the AI provider.
- Messaging: transactional messages always sent; promotional ones respect opt-out; WhatsApp needs approved templates (printed in the app).
- Offline: only POS sales are queued (idempotent replay); everything else needs a connection. PWA first, native store wrap later via Capacitor.
- Printing: browser print by default; silent printing is optional via the local print agent and always falls back to the browser view.
- Legal (owner, 2026-09-28): `frontend/src/site/Legal.jsx`'s Privacy Policy and Terms of Service are now the owner's real, final text (ManagerXP Private Limited), replacing the earlier honest-draft placeholder — not engineering-authored, so treat it as content to keep in sync with whatever the owner supplies next, not to rewrite. Signup (`POST /auth/signup`) now refuses to create an account unless `accepted_terms` is true, checked server-side (not just a disabled button) so a direct API call can't skip it; `users.terms_accepted_at` (migration 0035) records when. `Signup`'s form has a required checkbox above the submit button, linking to `/terms`/`/privacy` in a new tab; the button stays disabled until it's ticked.
- Website positioning (owner, 2026-09-26): FlowXP is **AI-powered billing for every kind of business** (shops, restaurants, salons, wholesalers, services), not restaurant-only. Hero: "Billing software that tells you what to do next." AI = insights that separate what happened / what needs a look / what to do next. Reference site for layout: reefsentinel.com. /ai (AI Manager, in the top nav) describes only real AI features (forecast, reorder suggestions, leakage, profitability, read-only Flow AI chat via ai/tools.js, menu-from-photo, alerts) and never shows an invented AI answer; shared marketing pieces live in src/site/parts.jsx (Shot, PageHero, FeatureRow, CellGrid, Node/Connector, FinalCta, Tag). Each public page is its own component: Home, ProductPage (/features), IndustriesPage, AIPage, IntegrationsPage (imported as SiteIntegrations in App.jsx; the app has its own IntegrationsPage), Pricing, AboutPage, ContactPage (mailto, no form), Legal. content.js now only holds the shared FAQ. Screens that would show customer phone numbers (customers, loyalty) are not used as marketing screenshots.
- Owner's target: finish the restaurant vertical, then the mobile app, then salon/retail/wholesale/general billing on the same core.


## 4q. Offline-first pattern (2026-10-08)
`OFFLINE_FIRST.md` is the rule book: local SQLite copy + queue on the phone, server stays the authority and re-validates everything, offline sales are recorded (never refused for stock) and flagged for review. Done for the general till and pharmacy; salon, wholesale, distributor are online-only.

### i18n: industry screens (2026-10-14)
All eight industry folders (autoparts, distributor, gaming, gym, hotel, pharmacy, salon, wholesale) converted with `frontend/scripts/i18n-extract.mjs`; labels in inline `{label:'..'}` objects wrapped `T('..')` (shown by the shared `Tabs`/`Segmented`/`Chips`, which call `tr`). screens.json now 4,577 texts x 6 languages (machine translation, not native-reviewed). ~230 hand-work sites remain (`scripts/i18n-skipped.txt`). Frontend tests 25 pass, vite build OK; verified spare-parts screens in Hindi in the browser (other industries not opened).

- Tally-style A4 tax invoice: `frontend/src/app/billing/TallyInvoice.jsx` (toggle "Tally style" on the bill page; HSN/unit joined live from products in `invoices.controller.js` get; amount in words, per-HSN tax summary). Not yet: HSN copied onto invoice_items at billing time, themes/settings, bank details, mobile/thermal version.
- Tally invoice now matches the Shree Om sample: consignee/buyer blocks, delivery/dispatch grid, Rate incl. tax + per, Disc %, PAN/bank/terms from receipt_settings. Per-invoice details live in `invoices.print_extra` (migration 0104, PATCH /invoices/:id/print-details, "Edit invoice details" button). Buyer address/state/email default from the customer.
- Reports step 1 (ledger): backend `controllers/ledgerReports.controller.js` (GET /reports/transactions, /party-statement, /by-party), web tabs Day Book, All transactions, Party statement, Sales by party, Purchases by party in ReportsPage.jsx. Statement closing balance is tested equal to invoices balance_due. Next: steps 2-6 of Block 8 in the plan (P&L, GST by HSN, stock, AI tools).
- Reports step 2 (profit): `controllers/profitReports.controller.js` (GET /reports/profit/bills|items|parties, /profit-loss, /discounts) built on modules/profitability.js profitOfInvoice with no fee assumptions; web tabs Profit & Loss, Bill/Item/Party-wise profit, Discount report. Test: profitReports.test.js. Uncosted lines (no unit_cost_paise) flagged, profit then an upper bound.
- Reports step 3 (GST): `controllers/gstReports.controller.js` (GET /reports/gst/summary?by=hsn|sac&kind, /gst/rates, /gst/gstr2); tabs Sale summary by HSN, SAC report, GST rate report, GSTR-2 (purchases). HSN totals tested equal to the existing /reports/gst. GST Transaction report = the existing GST tab register. Purchase inter-state decided by supplier GSTIN state; no GSTIN = no input credit.
- Reports step 4 (stock): `controllers/stockReports.controller.js` (GET /reports/stock/summary|low|items|ledger, /category-sales); tabs Stock summary, Low stock, Item detail, Stock detail, Sales and purchases by category. Quantities from inventory_transactions; test stockReports.test.js. Not built: Batch/Serial reports (industry-specific).
- Reports step 6 (AI, part 1): `modules/ai/reportTools.js` adds 10 read-only Flow AI tools over the report controllers (profit_and_loss, profit_by_item, discount_summary, gst_summary, sales_by_hsn, stock_value, low_stock_list, item_movement, category_sales, money_in_out); no party names. Web: "Ask your reports" box at the top of ReportsPage (hidden when Flow AI is off/unconfigured/out of questions). Tests: reportTools.test.js; ai.test.js inventory-manager tool list updated. Not done: weekly summary, unusual-number alerts, party-level AI answers.
- Reports step 6 (weekly summary): `modules/weeklySummary.js` (weekRanges, inWeeklyWindow, weeklyAlert, scanWeekly) registered in modules/scans.js (Mon/Tue from 8am business time, every 180 min, deduped by week start); new notification category `weekly` (Reports permission, in-app by default). Deterministic arithmetic from the report controllers, no AI. ReportsPage menu now grouped into sections (GROUPS). Test files must import app modules AFTER setupTestDb (a static import made one test hit the dev DB; cleaned up).
- Reports step 6 (unusual-number alerts): `modules/anomalies.js` (pure detectors salesAlert/marginAlert/discountAlert/expenseAlert/belowCostAlert + findAnomalies/scanAnomalies, thresholds in LIMITS) registered in modules/scans.js (from 9am local, every 360 min, dedupe per type per day); notification category `unusual` (Reports permission, push on by default). Complements modules/leakage.js (who/what pattern, restaurants). Test: anomalies.test.js.
- Reports: expense reports `controllers/expenseReports.controller.js` (GET /reports/expense/categories|items|list); tabs Expense categories / Expense items / Expense list under "Purchases and expenses". Items group descriptions case/space-insensitively. Test: expenseReports.test.js. Dev data: 8 sample expenses were added to Sharma Auto Parts (Rent, Electricity, Salary, Tea & snacks, Transport) for checking.
- Reports: party reports `controllers/partyReports.controller.js` (GET /reports/parties/all?kind=customers|suppliers, /parties/items?party_id|product_id); tabs All parties and Party report by items (by party / by item). Anonymous counter bills (no customer) are not part of any party. Test: partyReports.test.js. Remaining from the Vyapar list: Sale/Purchase Order reports; blocked: Cashflow/Balance Sheet/Trial Balance/Bank Statement (no cash/bank accounts), TCS/TDS/27EQ (GST depth), Loan Statement (no loans).
- HSN snapshot: migration 0105 adds invoice_items.hsn_sac and credit_note_items.hsn_sac, filled by BEFORE INSERT triggers (any insert path) and backfilled; readers (invoice get, gstReports, GSTR-1/e-invoice loaders, reports.controller gst) use COALESCE(line.hsn_sac, product.hsn_sac). Changing a product HSN no longer rewrites old bills (tested in gstReports.test.js).
- Block 2 (invoice print settings): `modules/invoicePrint.js` (defaults, cleanInvoicePrint, withDefaults) stored as receipt_settings.invoice_print; invoice get returns `invoice_print`; web `app/InvoicePrintSettings.jsx` (Settings > Business, live preview via TallyInvoice `print` prop), `lib/invoicePrint.js`, TallyInvoice honours layout/paper A4|A5/text size/accent/copies (Original/Duplicate/Triplicate pages)/column+block toggles/declaration/signature/footer; InvoiceDetail layout = setting (auto = trade types), the Tally/Standard button is a per-view switch. Standard bill article does NOT follow the style settings yet; mobile/thermal untouched.
- Block 3 (share): `POST /messaging/bill-share` (modules/messaging billShare: message with bill + account balance due, public link, wa.me address; no provider needed). Web: invoice More menu "Share on WhatsApp". Mobile: lib/share.ts (shareReceiptPdf via expo-print + expo-sharing [new dependency ~57.0.23], shareBillOnWhatsApp), receipt screen buttons "Send on WhatsApp (with link)" and "Share as PDF" (Hindi added). Not done: editable message templates (WhatsApp Cloud templates are Meta-approved so wording cannot be freely edited), web PDF download (browser Save as PDF), SMS copy to self. Phone share untested on a device.
- Block 4 (accountant + party): `modules/accountantPack.js` (CSV files + hand-written ZIP via zlib.deflateRawSync/crc32; buildPack calls the report controllers), `controllers/accountantPack.controller.js` GET /reports/accountant-pack (download) and POST /reports/accountant-pack/email (needs `export` permission; remembers receipt_settings.accountant_email; mailer.sendMail now takes attachments); web "Accountant pack" dialog in ReportsPage. Payment reminder: messaging balanceShare, POST /messaging/balance-share, "Remind" on All parties rows and "Remind on WhatsApp" + "Print / PDF" on Party statement. CA read-only login = existing ACCOUNTANT staff role (not read-only: has billing/refunds). Tests must never send real mail: set config.mail.host = "" after importing config (SMTP is configured in .env).
- Block 5 (orders and deliveries for every business type, decided: wholesale version for all): wholesale.routes.js readAll/writeAll (no wholesaleOnly) for /orders /backorders /fulfilment /pick-lists /deliveries /customers /salespeople /pricing/quote and GET /products /categories /warehouses /locations (settings, purchasing, price lists, returns, reports, product writes stay wholesale-only); planFeatures SHARED_ORDER_KEYS (wholesale_orders, wholesale_fulfilment) are on for every type (admin can still switch off); menu: Sell group "Sales orders" and "Deliveries" for non-wholesale types (nav key `deliveries`); order print title QUOTATION while DRAFT/SUBMITTED, SALES ORDER once confirmed. Tests: ordersAllTypes.test.js (retail shop with plain product+customer: order > pick > pack > dispatch > challan + invoice), industryfeatures.test.js updated. Not built: other income, discount at payment, show profit on sale screen, per-type document prefixes.
- Block 7 (app settings, web part): backup `modules/backup.js` + GET /businesses/current/backup (owner only; ZIP of 16 CSVs; share_token excluded; no restore) + BackupSettings card; display prefs per device (`lib/display.js`: theme system/light/dark, date format, decimals; `DisplaySettings` card; formatCurrency honours decimals, formatDate used by Reports/Invoice/Customers/Suppliers/Expenses/Dashboard); dark tokens in index.css (screen only, `.light-sheet` keeps document sheets white, `.logo-img` chip); theme applied from main.jsx for /app and AppShell. Not done: mobile app lock (needs expo-local-authentication and a device to test), restore, other-screen date formats (~50 toLocaleDateString left), unsaved-changes warning, editable currency.
- Tally details at billing (web, AUTO_PARTS only): collapsible "Tax invoice details" section in BillingPage.jsx (fields = TallyInvoice FIELDS), sent as `print_details` on POST /invoices, cleaned by cleanPrintExtra and merged into invoices.print_extra in the same transaction (bad value refuses the sale); held bills keep it. Not yet: pre-fill last consignee/destination for a repeat customer, phone app, order-bill path.
- GST options (2026-10-15): Settings > Business > "GST options" (`app/GstOptionsSettings.jsx`, Enable/Disable per option): Charge GST, composite scheme (Bill of Supply, no tax; `invoices.bill_of_supply`), cess (`products.cess_rate`, added per line, `invoice_items.cess_paise`), TCS (added to the bill when the till ticks it), TDS (customer deducts: recorded as an OTHER payment "TDS deducted by customer"), reverse charge (flag). Stored in `businesses.gst_settings` (migration 0106, `modules/gstOptions.js`, merged on PATCH; `gst_options` returned by /auth/me). Math is in `modules/billing.js` (cess/TCS/TDS added AFTER the existing tax maths so nothing else shifted); billing screen ticks, product cess field, invoice lines, report tab "TCS, TDS & cess" (`/reports/gst/options`). Not done: reverse charge on PURCHASES, GSTR-1/3B cess columns, Form 27EQ, mobile app.
- Printers screen (2026-10-15): Settings > Business > Printers (`app/PrintersSettings.jsx`; `printers` table + `branches.print_routing`, migration 0107, `modules/printers.js`, `controllers/printers.controller.js`, routes in print.routes.js). Per outlet: named printers (NETWORK tcp://, USB/BLUETOOTH via share:// or lp:// on the till computer, BROWSER dialog) with paper width, routing for receipt / takeaway (falls back to receipt) / drawer (falls back to receipt) / kitchen default / each kitchen station. The escpos endpoints now return `target` (+ printer name) per job and use the printer's own paper width; `lib/printing.js` sends to that target through the print agent, falling back to this device's own receipt/kitchen address, then the browser print view. Test print per printer goes through THIS computer's agent. Not done: native Bluetooth/USB on the phone app (mobile still RawBT/system print), printer status, per-device agent still typed in the "Silent printing" card, not tested on a real printer.
- Translations (2026-10-15): the 90 texts of the GST options, Printers screen, billing GST ticks/dispatch section, cess product field, invoice Cess/TDS/Bill of supply lines, TCS/TDS/cess report and the Edit-invoice-details modal are now tr()/T() keys in all 7 languages (machine translations, not native-reviewed). Deliberately left in English: the Tally invoice field labels and printed words (statutory), CSV headers, TCS/TDS abbreviations.
- Phone parity step 1+2 (2026-10-15): the phone now knows the GST options: `mobile/src/lib/gst.ts` (`gstView(business)` from /auth/me `gst_enabled` + `gst_options`), `cart.ts totals(cart, offers, gst, levies)` previews cess (per-line `cess_rate`, added to catalogue shape in products.controller posShape; catalogue COPY_VERSION 6), TCS (added), TDS (held back: customer pays total - TDS), composite/no-GST (no tax), `saleBody` sends tcs/tds/reverse_charge ticks, pay screen has the three ticks (till bills only, not a table's order) and Cess/TCS/TDS rows, offline preview + pending receipt carry them, receipt text shows Cess/TCS/TDS held back/reverse-charge note/BILL OF SUPPLY, product/new has an optional Cess % when cess is on, product detail shows it. Hindi + ml/ta/bn/te/kn strings added. Tests: mobile/test/gstoptions.test.ts (359 mobile tests pass, tsc clean, android export ok). NOT done on the phone: Tally invoice and its settings, consignee/dispatch details at billing, Printers routing, reports (Day Book, P&L, GST...), AI reports, display settings, backup. Not tested on a real phone.
- Phone reports (2026-10-15): More tab > "More reports" (`app/biz-reports.tsx` list by group, `app/biz-report.tsx` viewer with period chips, pull to refresh, saved copy offline). `lib/bizReports.ts` holds 16 data-driven report definitions (Day Book, Profit & Loss, bill/item/party profit, discounts, GST by rate / HSN, TCS-TDS-cess, stock summary, low stock, sales/purchases by party, who owes you / what you owe, expenses by category) plus the party statement (opened by tapping a party row); each reads an endpoint the website already uses (/reports/...) and permissions follow reports / gst / inventory. Fixed texts go through t() inside the builders (phrases carry {n}/{amount}); REPORT_TEXTS lists them and the test checks all 6 languages. Checked against the live dev API (17 reports ok). Tests mobile/test/bizreports.test.ts (368 mobile tests pass, tsc clean, android export ok). Not on the phone: AI "Ask your reports" (Flow AI screen exists, not wired to the new tools), accountant pack, weekly summary screen, CSV/print of these reports, GSTR-1/3B, Balance Sheet / Cashflow (not on the web either). Not tried on a real phone.
- Tally invoice on the phone (2026-10-15): `mobile/src/lib/taxInvoice.ts` builds the same GST tax invoice as the website (HTML; honours the business's invoice_print settings: A4/A5, text size, accent, copies, column/block toggles, declaration, signature; consignee/buyer boxes, dispatch grid, HSN, tax lines incl. cess/TCS, amount in words, HSN tax summary, bank/PAN/terms, Bill of Supply, reverse-charge note). `share.ts`: `shareTaxInvoicePdf` (expo-print PDF -> share sheet) and `printTaxInvoice` (print screen); fetches /invoices/:id + /businesses/current. Receipt screen shows "Share tax invoice (PDF)", "Print tax invoice", "Edit invoice details" when `usesTaxInvoice` (layout setting, or auto for WHOLESALE/DISTRIBUTOR/AUTO_PARTS/ELECTRONICS). `app/invoice-details.tsx` edits the 15 per-invoice details (PATCH /invoices/:id/print-details); pay.tsx has the same fields at billing for AUTO_PARTS (saleBody `print_details`, also queued offline). Also fixed web TallyInvoice: Amount column no longer includes cess. Hindi + 5 languages for the new texts (invoice words stay English). Tests mobile/test/taxinvoice.test.ts (375 mobile tests pass, tsc clean, android export ok). Checked visually from real dev data in a browser; NOT tried on a real phone (PDF share, print screen, page size are unverified). No on-phone preview screen: the PDF/print is the preview.
- Phone display + backup (2026-10-15): Settings > Display (`lib/DisplaySettings.tsx`, state in `lib/display.ts`, kept in the phone's kv 'display'): theme (Same as the phone / Light / Dark; DEFAULT LIGHT so nothing changes until chosen), date format (auto = ISO as before, DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD), amount decimals (0/1/2). `lib/theme.ts` holds LIGHT/DARK palettes and ONE shared mutable `color` object (ui.tsx re-exports it); `ui.tsx` styles are rebuilt by `rebuildStyles()`; `app/_layout.tsx` applies the palette before drawing and re-keys the Stack on lang+theme+date+decimals (a change sends the stack back to home, like a language change). Hard-coded hexes across ~25 files were replaced by tokens (color.tint/press/wash/dangerBg/warnBg/okBg...); 11 load-time colour tables became getters. `rupees()` follows decimals on screen; `rupeesExact()` is used by receipt.ts and upiBill.ts so printed/shared amounts never round. `formatDate()` applied to ~19 screens' on-screen dates (not receipts, not data fields). app.json userInterfaceStyle is now "automatic" (needs a new native build). Settings > Backup (owner only, `lib/BackupSettings.tsx`, `lib/backup.ts`, `share.ts shareBackupZip`): downloads GET /businesses/current/backup with expo-file-system (NEW dependency, package.json) and opens the share sheet; no restore. Hindi + ml/ta/bn/te/kn strings added (langpref coverage cap raised to 90%). Tests: mobile/test/display.test.ts (383 mobile tests pass, tsc clean, android export ok; backup endpoint checked live with the phone's headers: ZIP). NOT verified: dark theme and the share sheet on a real phone (nobody has seen the dark screens); remaining one-off hard-coded colours (white on blue buttons, scrims) are intentional, but a screen with a style object built outside render could stay light.
- Business settings on the phone (2026-10-15): More > "Business settings" (owner only; `app/business-settings.tsx`, pure helpers in `lib/bizSettings.ts`). Four cards, each saved on its own with PATCH /businesses/current sending only what changed (server validates; its message is shown): Business details (name, phone, email, address, city, state with suggestions from the server's state table, PIN, GSTIN), Receipt and tax invoice details (paper width, footer, logo/GSTIN/UPI QR/loyalty/auto-cut toggles, copies, blank lines, PAN, bank, accountant email, terms), GST options (charge GST + composite/cess/TCS/TDS/reverse charge with rates; refreshes /auth/me so the till follows), Invoice print (layout, A4/A5, text size, colour, copies, 15 show toggles, declaration, signature, footer). Not on the phone: language/staff default language, UPI ID (already in Settings), round-off / invoice prefix / financial year (not on the web page either), logo upload, Printers. Tests mobile/test/bizsettings.test.ts (389 mobile tests pass, tsc clean, android export ok); live round trip against the dev API (change, server refusals GSTIN/PAN, restore). Hindi + 5 languages (73 texts reused from the web). Not tried on a real phone.
- Staff and outlets on the phone (2026-10-15): More > Staff and Outlets (owner and admin; Outlets only for restaurant/wholesale/pharmacy types like the web menu). `lib/team.ts` (pure: ROLES + help text as on the web, `rolesFor(businessType, isOwner, distributorEnabled)` mirrors the web's role filtering, canEditPerson, request bodies, permission choices, outlet form/series, topOutlet). Screens: `staff.tsx` (list), `staff-person.tsx` (add: POST /staff emails an invite; edit role/outlet/access: PUT /staff/:id), `staff-permissions.tsx` (owner only: role default / allow / deny per permission, PUT /staff/:id/permissions), `outlets.tsx` (list with closed toggle + Compare tab: 7/30/90 days from /outlets/compare), `outlet-edit.tsx` (details, invoice series, close/reopen; server refuses the main outlet, outlets with stock/open orders, plan limit). Role names and help lines stay English (as on the web); all other texts in 6 languages. The server also has BANQUET_MANAGER and HR_MANAGER roles nobody can be given from web or phone yet (shown by name only). Tests mobile/test/team.test.ts (397 mobile tests pass, tsc clean, android export ok). Live check on the dev API: staff list, disable/re-enable a person, permissions re-save, editing yourself refused, outlet edit + restore, bad GSTIN refused, main outlet cannot be closed, compare. NOT tested live: inviting a new person (sends a real e-mail), creating an outlet. Not tried on a real phone.
- Activity log and Security on the phone (2026-10-15): More > Activity log (owner/admin) and Security (everyone). `lib/security.ts` (pure: activity query/CSV request, sign-in event labels, device names, 2FA/password/PIN checks and request bodies, SECURITY_TEXTS). `app/activity.tsx`: GET /audit with filters (Today/7/30 days, person, area, outlet, search), "Show older" paging by `before`, Export CSV via `share.ts shareDownload` (generalised from the backup download; needs the export permission). `app/security.tsx`: two-step verification (setup shows the key + "Open the authenticator app" via the otpauth link, no QR on the phone; confirm with the 6-digit code; recovery codes shown once with a Share button; new codes and turn-off ask for the password; turn-off also takes a recovery code), password change, "Sign out everywhere else", your approval PIN (set/change/remove), manager approval rules (discount cap, cancel needs PIN, approvers), your recent sign-ins, the team's sign-ins + owner's "require two-step for owners/admins" switch, link to Delete my account. IMPORTANT: enable/disable 2FA, change password and sign-out-everywhere ROTATE the session token; the phone keeps the new one with `session.ts adoptToken` (the old one stops working: verified live). Tests mobile/test/security.test.ts (405 mobile tests pass, tsc clean, android export ok). Live check on the dev API with a script-generated one-time code: audit list/filter/CSV, login history, team security, approvals cap round trip, PIN set/remove, 2FA setup -> wrong code refused -> enable -> old token dead / new token works -> new recovery codes -> turn off with a recovery code -> restored. NOT tested live: changing the password (kept the test account's), "sign out everywhere" button, the owner policy switch. Not tried on a real phone (authenticator deep link, share sheet).
- AI reports on the phone (2026-10-15): the phone's Flow AI chat (`app/flow-ai.tsx`, POST /ai/chat) already had the server-side report tools (profit_and_loss, profit_by_item, discount_summary, gst_summary, sales_by_hsn, stock_value, low_stock_list, item_movement, category_sales, money_in_out), so it answers report questions. New: "Ask your reports" box (`lib/AskReports.tsx`, pure helpers `lib/askReports.ts`) at the top of Reports, More reports and each report; shown only when /ai/status says can_ask and the person has the 'ai' permission; 4 example questions + a per-report suggestion ("Explain my X report from A to B."); the answer is drawn by the shared `lib/AiAnswer.tsx` (extracted from flow-ai.tsx) with "Looked at <tools>"; "Open in Flow AI" opens that same conversation (`/flow-ai?c=<conversation_id>`). Needs internet (not queued). Tests mobile/test/askreports.test.ts (408 mobile tests pass, tsc clean, android export ok). Live check against the dev API with the real model: profit question used "Profit and loss", the Low stock explanation used "Low stock" (+ forecast), conversation reopened. Costs one AI question per ask (plan limit applies). Not tried on a real phone. Phone-side still missing from the web list: accountant pack, weekly summary screen, GSTR/GST filing, Offers/Loyalty/Messaging, industry setup screens, Printers.
- Accountant pack and weekly summary on the phone (2026-10-15): the weekly summary is a NOTIFICATION (category `weekly`, every Monday morning, `modules/weeklySummary.js`), so the phone got a Notifications screen: More > Notifications (`app/notifications.tsx`, pure `lib/inbox.ts`): list with unread only, mark read on tap, mark all read, "Show older" paging, tap opens the matching phone screen (weekly/unusual -> More reports, stock-ish -> Stock, kitchen, gaming, purchases; others just mark read), and "What to tell me about" (per topic: in app / email / on my phone, PUT /notifications/preferences with the whole list). Phone push alerts were already there (lib/push.ts). Accountant pack: More > Accountant pack and a button on More reports (export permission; `app/accountant-pack.tsx`, pure `lib/accountantPack.ts`): periods This month / Last month / This quarter / This financial year / Last financial year (FY start month from /businesses/current), Download (ZIP via `share.ts shareDownload` + share sheet) and Email to the accountant (POST /reports/accountant-pack/email; address remembered by the server and pre-filled), 400-day limit checked. Tests mobile/test/inboxpack.test.ts (415 mobile tests pass, tsc clean, android export ok). Live check on the dev API: notifications list incl. the real weekly summary, unread filter, preferences flip + restore, pack download (10 files), over-long period refused. NOT tested live: sending the accountant e-mail (this server sends real mail). Notification topic labels/descriptions are server English, translated on the phone only (the web shows them in English). Not tried on a real phone.
- GST filing on the phone (2026-10-15): More > GST filing (owner/admin with the 'gst' permission; `app/gst-filing.tsx`, pure `lib/gstFiling.ts`). Month chips (last 12, newest first starting last month), GSTIN chips when more than one, tabs GSTR-1 (4 summary tiles, the server's "Check:" warnings or "Nothing to fix", Download the file -> share sheet as GSTR1_<gstin>_<MMYYYY>.json), GSTR-3B (the website's table as rows: 3.1(a), 3.1(c), 3.2 per state, 4(A) ITC, tax to pay in cash, notes), E-invoice (B2B invoices ready / has IRN / missing what, paste-and-save an IRN, download the bulk file when some are ready), and Filing settings (B2CL limit, "must issue e-invoices"). FlowXP only prepares; the owner/accountant uploads on the GST portal. Note: filing settings and my GST options (composite/cess/TCS/TDS/reverse charge) share ONE stored object (businesses.gst_settings); the key names do not overlap and both writers merge (verified round trip). Tests mobile/test/gstfiling.test.ts (421 mobile tests pass, tsc clean, android export ok). Live check on the dev API: filings for Sep and Oct 2026, GSTR-1 file valid JSON (b2cs rows), 3B rows, e-invoice list, bad IRN refused by phone and server, settings round trip and restore. NOT done / NOT tested: recording a REAL IRN (no way to remove one afterwards), e-way bills (per invoice on the web invoice screen; not on the phone yet), any real portal upload. Not tried on a real phone.

- Phone parity: Offers (list with status, switch on/off, remove, new offer incl. mix bundle, days/times) in mobile/src/lib/offerList.ts + app/offers.tsx + offer-edit.tsx; More entry for shops/food types with products or settings permission; tested live on dev API (create/switch off/remove). Note: lib/offers.ts is the till preview and is untouched.
- Phone parity: Loyalty & coupons (mobile/src/lib/loyalty.ts, app/loyalty.tsx with Visit card / Points & tiers / Coupons tabs, app/coupon-edit.tsx); More entry for owner/admin (not wholesale); live-checked on dev API (coupon ZZPHONETEST left switched off, no delete endpoint). Fixed isDay RangeError on month 13 in offerList.ts/loyalty.ts.
- Phone parity: Messaging (mobile/src/lib/messaging.ts, app/messaging.tsx with Settings / Send an offer / Message log tabs; More entry owner/admin). Live-checked read endpoints, same-value settings PUT and campaign previews on the dev API; no campaign sent, no message resent. Customer marketing opt-out has no UI on the web either, so not added to the phone.
- Phone Printers (not yet run on a device): expo-dev-client + react-native-bluetooth-classic (RC, classic Bluetooth serial) + react-native-tcp-socket (Wi-Fi port 9100) added; lib/printerSetup.ts (pure, tested), lib/printerLink.ts (native calls), app/printers.tsx (pair/scan, Wi-Fi add, paper 58/80, receipt + kitchen-ticket jobs, test print), mode "direct" in thermal.ts/print.ts with fallback to the print screen, kitchen ticket printed after "Send to kitchen" via GET /kitchen/kots/:id/escpos. expo-doctor flags both libs as untested on the New Architecture: first EAS build is the real test. Needs `eas login` (not done here).
- Phone parity: E-way bill (lib/ewayBill.ts, app/eway-bill.tsx, button on the bill screen for owner/admin when the customer has a GSTIN; file shared as JSON via shareTextFile; number recorded). Also one-tap "Send the bill from FlowXP" on the bill screen (POST /messaging/send-bill, FlowXP messaging number) when the bill has a customer mobile. Dev data has no customer GSTIN invoice, so the ready path was not seen live.
- Phone parity: Stock counts (mobile/src/lib/stockCount.ts, app/stock-counts.tsx list + start, app/stock-count.tsx scan with the camera / search +1 / type the number / only differences / apply with optional zero-uncounted / cancel); More entry for shops with the inventory permission. Live-checked start, scan, typed number, detail and cancel on the dev API (nothing applied, stock unchanged).
- Phone parity: Options & add-ons (mobile/src/lib/menuOptions.ts, app/option-groups.tsx list, option-group.tsx detail + choose dishes, option-group-edit.tsx create/edit with price change and ingredient used); More entry for kitchen types with the products permission. lib/options.ts is still the till picker. Live-checked on the dev API (demo@flowxp.test): created a group, set dishes, turned off, cleared dishes; group ZZ phone test left switched off (no delete endpoint).
- Phone parity batch (items from the gap list): balance reminder sent from FlowXP's number (backend: BALANCE_DUE template, sendBalance in modules/messaging, POST /messaging/send-balance, test added to billShare.test.js; phone: buttons on the customer screen); quick-add product while scanning in a stock count (POST /products/quick); logo upload (expo-image-picker, LogoSetting in Business settings > Receipt); credit and debit notes (lists, detail, raise a debit note from an order that has arrived); subscription (view plan, trial, pay link; no self-serve upgrade, billing history does not exist on the web either); delivery platforms and settlements (lib/platforms.ts, app/delivery-platforms.tsx); profitability, forecast, leakage and kitchen performance (lib/insights.ts + four screens).
- NOT built, on purpose: restore from backup (the web has no restore either: the backup is a CSV ZIP only, a restore would be a new backend feature that overwrites data) and reverse charge on purchases (does not exist on the web or in the backend; GSTR-3B 3.1(d)/4(A)(3) needs an accountant-reviewed design). Industry setup screens (wholesale, distributor, hotel, gaming, gym, salon, pharmacy, parts admin): not started, about 3,500 lines of web setup pages; to be done module by module.
- Lesson: before Write-ing a new mobile/src/lib file, check the name is free (offers.ts and delivery.ts already existed and were overwritten, then restored from git).
- Phone parity: Gym plans and Gym settings (lib/gymSetup.ts, app/gym-plans.tsx, gym-plan-edit.tsx, gym-settings.tsx with Rules and Branches/QR tabs; More entries for GYM with the gym_setup right). Live-checked on the dev API (gym@flowxp.test): same-value PUTs of settings, hours and a plan, plus a throwaway plan created and taken off sale (ZZ phone test plan stays archived). Not on the phone: gym devices tab and the printable QR poster.
- Phone parity: Salon settings (lib/salonSetup.ts, app/salon-settings.tsx with six tabs: Profile and outlets, Hours and booking plus online booking, Tax and payments plus commission, Loyalty earning rates and expiry, Clients and stock, Messages: automations and campaigns). More entry for SALON owner/admin. Live-checked on the dev API (salon@flowxp.test): every tab saved back unchanged. No campaign sent.
- Phone parity: Hotel set-up (lib/hotelSetup.ts, app/hotel-setup.tsx with tabs Rooms, Rates, Out of sale, Banquet, Settings; More entry for HOTEL owners with the hotel_setup right). Live-checked on the dev API (hotel@flowxp.test): all GETs and same-value PUTs of a room type, a hall and the settings returned 200. Add/remove of rooms, seasonal rates and blocks covered by unit tests only. Not included: housekeeper assignment per room. Mobile tests 511 pass, tsc clean, android export builds.
- Phone parity: Gaming set-up (lib/gamingSetup.ts, app/gaming-setup.tsx with tabs Stations (zones, stations, out of service, retire), Rates (tiers, grace/minimum, per-frame price, peak times), Offers (offers and hour packs), Games, Settings (alert, GST, hold, no-show, wallet top-up bonus); More entry for GAMING_CAFE with the gaming_setup right). Live-checked on the dev API (gaming@flowxp.test): all GETs, same-value PUTs of a station, rate, offer and settings returned 200; a throwaway zone and game were created and removed. The wallet bonus and hour packs show for every lounge (the phone does not know the plan flag gaming_wallet). Mobile tests 517 pass, tsc clean, android export builds.
- Phone parity: Distributor admin (lib/formKit.tsx shared form pieces; lib/distributorSetup.ts + distributorSales.ts; screens dist-principals, dist-schemes, dist-areas (areas + beats), dist-team (team, targets, commission rules), dist-vans; five More entries for distributors, each behind its own right). Live-checked on the dev API (wholesale@flowxp.test): all GETs; same-value PUTs of a principal, territory, beat, van, salesperson and commission rule; every existing scheme (all three kinds) round-tripped through the phone form builders with 200; throwaway region created and removed. Left on the web: assigning products to principals, named shops and territories on a scheme, product- or shop-scoped targets and rules, ordered shops on a beat, assigning shops to areas, bulk target upload, loading and counting vans, linking a salesperson's sign-in. Mobile tests 523 pass, tsc clean, android export builds.
- Phone parity: Wholesale settings (lib/wholesaleSettings.ts, app/wholesale-settings.tsx with tabs Rules and messages (credit control, orders and pricing, stock rules, customer messages, distributor options when on) and Salespeople; More entry for wholesale with the settings right). Live-checked on the dev API (wholesale@flowxp.test): the settings form built from the server data saved back with 200 and changed nothing except that the six message switches are now stored explicitly; a salesperson saved back with 200. Not on the phone: linking a salesperson's sign-in, the salesperson's month figures. Mobile tests 527 pass, tsc clean, android export builds.
- Phone parity: Pharmacy medicines and items (lib/medicineAdmin.ts, app/medicine-admin.tsx: search, type and Active/Low stock/Archived filters, add and edit with basics, medicine details, rules (batch, expiry, serial, prescription, warranty) and price and stock, new category; More entry for PHARMACY with the products right). Batches, receiving and the till already existed on the phone. Live-checked on the dev API (pharmacy@flowxp.test): all 27 items went through the phone form builders and saved back with 200. Mobile tests 531 pass, tsc clean, android export builds.
- Phone parity: Auto-parts admin (lib/partsAdmin.ts, app/parts-manage.tsx with tabs Parts (search, add a part, details, part numbers, vehicles it fits with verify / does not fit / remove), Vehicles (add make, add model) and Racks (add one or several places, switch one off); More entry for AUTO_PARTS with the parts_catalog or warehouse right). Live-checked on the dev API (autoparts@flowxp.test): details of all 30 parts saved back with 200 through the phone builders; a throwaway part, part number and rack were created (number removed, rack switched off; the part 'ZZ phone test part' stays, there is no delete). Left on the web: vehicle variants and CSV import, copying fitment to other parts, warehouse settings and level names, price lists, claims. This closes item 8 of the phone list (gym, salon, hotel, gaming, distributor, wholesale, pharmacy, auto-parts). Mobile tests 537 pass, tsc clean, android export builds.
- Reverse charge on purchases, backend + web (in progress, restore from backup still to do): migration 0108 purchase_orders.reverse_charge; modules/gstOptions.js purchaseTotal + purchaseReverseCharge (refused, not ignored, while the GST option is off); a purchase on reverse charge owes the supplier subtotal only (total = subtotal, tax kept as the buyer's own liability) in purchases.create, purchaseOrders create/update/receive, wholesalePurchasing createPO/updatePO/direct GRN/receive; GSTR-3B gains 3.1(d) reverse_charge_inward, the credit always counts, and total_cash_with_reverse_charge. Web: toggle in the purchase form, order modal and wholesale PO editor, GSTR-3B rows. Tests: backend/test/purchaseReverseCharge.test.js (7). Not yet: phone toggle, self-invoice document, debit notes on RC purchases, restore from backup (add-missing-only, chosen by owner).
- Web: removed the language dropdown from the marketing site header and mobile menu (kept on sign-in and in the app). Dark mode: the selected category chip (bg-ink-900 text-white) had near-white text on near-white; fixed globally in index.css, scrollbars follow the theme; new Sun/Moon button in the app header (one tap light/dark, Settings > Display still has the system option).
- Auto-parts workshop (2026-10-20, asked for: job cards for bike and car servicing, and all staff details and payroll for spare parts): migration 0109 job_cards, job_card_lines (+ autoparts_settings job_prefix, job_next_no, labour_tax_rate); modules/autoparts/jobcards.js (parts held for the customer through the reservations, labour lines, fitment per part, estimate, one invoice through createInvoiceInTransaction which uses the holds up, cancel releases them, vehicle history, services due); routes /api/autoparts/jobcards/* (billing right, plan feature ap_jobcards). Staff and payroll: the hotel hr engine mounted at /api/autoparts/staff/* (feature ap_staff, hr and payroll rights; staffToday() uses the calendar day for non-hotels; workshop default departments and shifts). Web: PartsJobCards.jsx and the shared staff pages (lib/staffBase.js), nav Job cards and Staff. Phone: lib/jobCards.ts + app/job-cards.tsx + app/job-card/[id].tsx, lib/workshopStaff.ts + app/workshop-staff.tsx (People, Attendance, Payroll), More entries. Tests: backend autopartsJobcards (8), mobile jobcards + workshopstaff; 548 mobile tests pass. Web job-card texts are plain English (not yet in screens.json). Dev data left: a cancelled job JC-0001, an inactive employee 'ZZ phone test mechanic' with a draft payroll run for October 2026 in the autoparts demo shop.
- Restore from backup (2026-10-20, owner chose 'add missing records only'): backend/src/modules/restore.js (unzip with size and CRC guards, RFC4180 csv parser that undoes the backup's spreadsheet guard, per-table specs in dependency order; a record is 'already here' when it matches by what identifies it to a person: bill/credit note/purchase by number AND total, customer/supplier by name and phone, product by sku or barcode or name, payment/refund/expense by amount, date and time to the millisecond; missing ones are added with new ids and everything pointing at them is remapped; lines and a new product's stock come only with a new parent; existing records and stock are never changed; a clash or a dangling link is skipped and listed; numbering counters move past restored numbers). POST /api/businesses/current/restore (ZIP body, ?confirm=1 to apply, otherwise a preview that rolls back; owner only; plan feature backup_restore). Web: BackupSettings.jsx restore section (check, then restore). Phone: lib/restore.ts, app/restore-backup.tsx (expo-document-picker installed; api.call gained a raw file body), More > Restore from a backup (owner). Tests: backend/test/restore.test.js (9), mobile restore.test.ts; live preview on the dev API: every demo shop restores to itself with 0 added and 0 skipped; cross-shop previews skip clashing bill numbers and their lines. Not covered by a test: credit notes and refunds through restore (same generic path).

- Website: new /guide page (nine-step first-day setup + import from Tally, Vyapar, Busy, Marg, Zoho, Excel, with honest limits); auto-parts industry page rewritten plainly with job cards/staff and setup/backup modules, FAQ and limits updated; nav/footer link (7 languages), seo, sitemap, llms.txt; retail product import now recognises those tools column names (retailImport.js HEADERS, test in retailstock.test.js). Not built: old bills/ledgers import, Tally data-file reader, retail/parts customer import.

- Customer import for retail/spare-parts shops: POST /api/customers/import (dry run then apply, all-or-nothing, skips same phone / same name without phone, no opening balance since dues come from unpaid bills); Import customers button on web Customers page (CsvImportModal); screens.json x7; test in retailstock.test.js; guide and auto-parts site content updated. Phone app: not added.

- Ease of use pass (2026-10-20): web "Help me find" button on every app screen (components/GuideHelper.jsx, plain-words task search over the screens the person can open, plus a Flow AI link; English only, hidden on the till); racks: "Set up my racks" one-step setup (store name, number of racks, bins per rack -> R01.. and bins A.., via the existing locations and bulk endpoints) shown when no racks exist, simpler place labels; loyalty points tab: "How it works for your customer" live example (points per bill, value of 100 points, minimum and maximum). Not done: phone app equivalents, translations of the helper and the points example.

- Workshop completion (2026-10-21): labour and services list (migration 0110 workshop_services; one-tap labour on a job card, remember-as-service), "What we earned" workshop report (labour vs parts by day and mechanic from billed job cards; job bills are ordinary invoices so they are in /reports sales, proven by test), usual Indian makes and models by company (modules/autoparts/indiaVehicles.js, POST /autoparts/vehicles/defaults, names only, no fitment; button on Vehicles), mechanic mode (migration 0111 businesses.workshop_mode, owner switch in Settings, hides ap_jobcards and ap_staff when off; existing parts shops backfilled on), job card WhatsApp via wa.me (GET /autoparts/jobcards/:id/share?event=received|estimate|ready|bill; sent by a person, nothing leaves the server). Web only; phone not done. Website auto-parts text updated. Not verified in browser: services/earnings tabs, vehicle defaults button, WhatsApp buttons.

- Phone parity for the workshop work (2026-10-21): lib/workshopExtras.ts + test/workshopextras.test.ts (8 tests, phone 560 pass, tsc clean, android export checked). Screens: mechanic-mode (owner switch, PUT /businesses/current/workshop-mode, session Business.workshop_mode), job-services, job-earnings, customers-import (CSV via document picker, check then import), help-find (plain-words finder, in More), job card (service chips, remember as service, WhatsApp buttons via wa.me), parts-manage (usual Indian vehicles button, one-step racks card when none). More menu hides job cards, labour, earnings and staff when mechanic mode is off. CSV only on the phone (no Excel). Not verified on a device.

- Live check on the dev API and web (2026-10-21): labour service added through the Services tab and removed; workshop report endpoint answers (demo job counted); job card WhatsApp text and wa.me link for JC-0001; "Add them" on Vehicles filled the demo shop with Hero MotoCorp, Maruti Suzuki and the rest. Demo shop now has the usual Indian makes and models. Earnings tab screen and the web job card buttons not clicked through.

- Signup question (2026-10-21): web signup shows "We also service bikes or cars" for Auto spare parts (auth.json signup.alsoService x7); POST /auth/signup and createBusiness store workshop_mode from the body (default off); test in signup.test.js. The phone app has no signup screen, so nothing to add there.

- Workshop today card on the parts overview (PartsHome.jsx): vehicles in the workshop, ready to collect, jobs billed today, labour and parts today; shown only with mechanic mode on and the billing right. Checked live (zeros on the demo shop today). English only.

- Web translations (2026-10-21): the Help me find button (task list uses T() + tr), points example, whole job cards page (jobs, services, earnings, WhatsApp, new card, status names), Workshop today card and Mechanic mode card now go through tr() with 129 new keys in screens.json x7 (about half reused from the phone dictionaries, the rest written new). Help me find also matches words in the language shown. Tests 25/25, build clean; not clicked through in another language.

- Phone: floating "Help me find" button on every signed-in screen (lib/HelpButton.tsx in app/_layout.tsx; hidden on sign in, till, pay, receipt, scan, help screen via showHelpButton, tested). Phone 561 pass, tsc clean, export ok. Not seen on a device: check it does not cover the tab bar or a screen own button. Note: the phone has signup.tsx, which does not yet ask the "also service vehicles" question.

- Phone signup now asks "We also service bikes or cars" for Auto spare parts (account.ts alsoService -> workshop_mode in the signup body, only for AUTO_PARTS; translated x6; test in account.test.ts). Phone 562 pass, tsc clean, export ok. Not seen on a device.

- Security and rate limits (2026-10-21): new middleware/limits.js (API-wide safety net 4000/min per address in server.js; per-email limiter on signup and forgot-password; resend-code limiter that counts successes plus a 30 s wait per person in resendEmailOtp; per-person limiters on every import route, backup, restore, vehicle defaults and bulk racks); API sends a strict CSP via helmet; SECURITY.md updated; tests in security.test.js (limits + resend wait; the old resend test now waits). Audit finding fixed: resend-email-otp was under a failures-only limiter, so successful resends (each an email) were unlimited. In-memory counters, one API process (move to Redis for several). Full backend run before this change: 1442 tests, 1441 pass, the one failure was the resend test being changed while the run was in progress.
- Public site Install app button (components/InstallButton.jsx in the header, mobile menu and Home phone-app section; shows only when the browser offers the install, tested by simulating beforeinstallprompt; label translated x7). No Android download link: there is no APK or Play listing yet.

## 9. Sync status and what is left (2026-10-21)

**Where the code stands.** `Feature` is the working branch. Local `Feature` equals `origin/Feature` (22e8546) after the last pull. `origin/develop` holds the same files but lacks the newest merge commits. `origin/main` is still the initial commit. Nothing was pushed from this machine by Claude (rule: the owner pushes).

**What arrived from the other places that push to `origin/Feature`** (pulled and merged; read before editing those files):
- Two small commits from a Claude cloud session (claude.ai/code): `5fbef99` makes the scheme audit test wait for the unawaited audit write (backend/test/distributorschemes.test.js); `88147a7` makes the distributor seed switch the distributor mode on the way the Super Admin does (backend/scripts/seed-distributor.js).
- `f38ba82` "Download button" (owner): the workshop, vehicle, mechanic mode, translation and phone work described in sections below, committed together (61 files, about 2,700 lines).

**Built and committed (in `origin/Feature`)**: phone set-up screens (gaming, distributor admin, wholesale settings, pharmacy, auto-parts admin); reverse charge on purchases (backend, web, GSTR-3B); restore from backup (add-missing-only, backend, web, phone); marketing site: setup guide page `/guide`, spare-parts page rewrite, Tally/Vyapar/Busy/Marg/Zoho import columns; customer import (`POST /customers/import`, web and phone); workshop job cards, staff and payroll for spare-parts shops; labour services list, workshop earnings report, usual Indian bikes/scooters/cars by company (names only, no fitment), job card WhatsApp (wa.me), mechanic mode (`businesses.workshop_mode`, owner switch, signup question web and phone); easier racks (one-step set-up); "Help me find" button (web everywhere, phone on every signed-in screen); loyalty points example; Workshop today card; translations of the web parts in 7 languages.

**Built, NOT yet committed (this working folder)**: security layer and rate limits (`backend/src/middleware/limits.js`: API-wide net, per-email limits on signup and forgot-password, resend-code wait and limiter, per-person limits on imports, backup, restore and bulk set-up; strict CSP on API answers; SECURITY.md and tests); public site "Install app" button (`frontend/src/components/InstallButton.jsx`, header, phone menu, Home; shows only when the browser can install). Run `git status` to see them; the owner commits and pushes.

**Left over**
1. Android: no APK or AAB exists. Needs `eas login`, then `eas build --profile preview --platform android` (APK for testing) and later the production build (AAB). The `test` EAS profile still has `REPLACE-WITH-YOUR-TEST-SERVER`. Play listing (`mobile/STORE.md`) predates the workshop features. Play screenshots (take on a real phone), `play-service-account.json` and the Play Console account are still to do. No Android download button on the site until a build or a Play listing exists.
2. Real devices: the phone app, printing (Bluetooth, USB, WiFi), the floating help button position on small screens, and mobile dark theme were never run on hardware.
3. Server: after pulling, run `npm ci` in `backend` and `frontend`, build the frontend, apply migrations by restarting (new: 0110 labour services, 0111 mechanic mode), and `pm2 reload flowxp-api` (the process is called `flowxp-api`). Rate-limit counters are in memory: fine for one API process; use Redis for more.
4. Not done: reverse-charge switch on the phone, self-invoice document, debit-note treatment for reverse-charge purchases; restoring credit notes and refunds has no test of its own; importing old bills, ledgers or a Tally data file (items, stock and customers only; customer balances come from unpaid bills); the phone cannot read Excel (CSV only); Mechanic mode is not part of onboarding checklists; workshop earnings are not on the main dashboard (only on the parts overview card).
5. Quality passes still open: native-speaker review of the machine-written translations (about 330 new texts across 6 languages); screenshots for the two new spare-parts website sections (servicing, setup); an end-to-end browser pass on every new screen (only mechanic mode, services, vehicle defaults, WhatsApp link and the install button were checked live).
6. Audit state: before the security change the full backend suite ran 1,442 tests with 1,441 passing; the one failure was the resend test, since updated. A fresh full run on the final code is the last check before release.

- Download button (2026-10-21): frontend/src/lib/appLinks.js reads VITE_ANDROID_APP_URL (https only); Home phone-app section shows "Download for Android (APK)" (or "Get it on Google Play" for a Play link) only when it is set, otherwise no button. deploy/nginx.conf serves /downloads/flowxp.apk from /var/www/flowxp/downloads/ with the Android MIME type; DEPLOY.md has the build steps. The APK itself is NOT built: this computer has no Android SDK, no Java and no EAS login. Owner steps: eas login, eas build --profile preview --platform android, copy to the server, rebuild the site with the variable.

- Auto-parts client readiness pass (2026-10-22): vehicle entry is Company + Model typed or picked (web datalists, phone suggestion lists) with the server remembering new ones; job cards are the front of mechanic mode (web lands on /app/parts/jobs, sidebar group Workshop, phone Jobs tab, More has a Workshop group first); labour lines carry SAC 998714 on the tax invoice; the settings page no longer asks for kitchen stations in a shop (402 in the console); scripts/e2e-autoparts.mjs (58 live API checks, all pass on the dev shop); AUTO_PARTS.md has the mechanic mode and hand-over sections. Phone: tsc clean, 563 tests. Found and fixed during the walk: labour had no SAC on the invoice; the model picker listed every model of every company.

- WhatsApp Cloud API: Graph API version is now WHATSAPP_API_VERSION (default v26.0, was hard-coded v20.0); template texts no longer start or end with a variable (Meta rejects those); Meta app set up by the owner (FlowXP Business Integration, domain, privacy, terms, delete-account URL https://flowxp.in/delete-account). Not yet done: number registration (the number is in the Business app: delete it there, use another number, or coexistence), templates submitted, token in Super Admin > Settings > Messaging, job card templates sent automatically (planned Phase 1).

- WhatsApp callback (2026-10-23): GET/POST /api/webhooks/whatsapp (Meta address check with verify token; POST signed with the app secret, X-Hub-Signature-256; delivered/read/failed update messages (migration 0112 delivered_at, read_at); STOP opts the customer out of promotions). Super Admin > Settings > Messaging has the app secret and verify token (encrypted). Tests: backend/test/whatsappWebhook.test.js (5). DEPLOY.md has the order of setup. Needs deploying before Meta can verify the URL.

- WhatsApp templates (2026-10-25): gym start-of-month reminder (automation MONTH_START, template flowxp_gym_month_start, on the chosen day of the month 9am-8pm to members whose membership ends that month and who have not renewed, once per month per member); bill with a second Rate us on Google button (flowxp_bill_review, used only when the shop has a https://g.page/r/ link in Settings > Google review link; others send flowxp_bill); WHATSAPP_TEMPLATES.md generated from the code (36 templates with text, category, samples, buttons, plus a list of messages still to build per industry). Job card messages still open WhatsApp with the text ready (not yet templates).

- Bill receipt wording (2026-10-25): flowxp_payment_receipt and flowxp_payment_receipt_review have 7 body variables (name, shop, amount, invoice no, date and time, payment status, closing line), no header, footer Billing powered by FlowXP, View Invoice button and (review version) Rate Us button to the shop own g.page review link. The closing line is the shop own receipt footer if saved, else one per business type (CLOSING in messaging/templates.js, same for restaurants, cafes, stores, pharmacies and the rest); one wording for every kind of business. WHATSAPP_TEMPLATES.md regenerated.
- 2026-10-25: website now presents WhatsApp messaging as live (home, integrations, product, FAQ, SEO, llms.txt, cafe/restaurant/salon/auto-parts pages); SMS and Zomato/Swiggy stay 'coming soon'.

- FlowBook link (2026-10-29): FlowXP can send its sales to FlowBook (separate accounting product in `flowbook/`, own Node/Fastify API with its own tests). FlowXP side: `backend/src/modules/flowbook/{events,outbox}.js`, `controllers/flowbook.controller.js`, routes `/api/flowbook`, migration 0113 (`flowbook_links` with an encrypted secret, `flowbook_outbox`), plan feature key `flowbook`, a scan on the worker every 30 s that finds new invoices, credit notes and payments since the link was enabled and delivers them in order with HMAC signatures and retry (12 tries, then DEAD with a Retry action). Bills it cannot send correctly are SKIPPED with a reason, never sent wrong. Tests: `backend/test/flowbook.test.js` (10). No web/phone screen yet (API only); no backfill. See `flowbook/docs/flowxp-integration-contract.md` section 10 and `flowbook/api/README.md`.
- FlowBook web app (2026-10-29): `flowbook/web/` (React + Vite, plain CSS, responsive, bearer token in localStorage, dev proxy `/v1` to API 5200, port 5300). All screens listed in `flowbook/README.md`. Added `GET /v1/orgs/:id/profile` to the API. FlowBook has its own login (not shared with FlowXP yet). Local dev DB `flowbook_dev` via `flowbook/api/.env` (gitignored); launch entries `flowbook-api` and `flowbook-web`. Product name is the BRAND constant in `web/src/lib.js` (name still undecided: FlowLedger / FlowLekha suggested).
- FlowBook hardening + restyle (2026-10-29): migration 0005 (payments/allocations freeze triggers, invoice_prefix, documents.voided_on, WAITING event status + waiting_for, Discount given backfill). Numbers per FY: `PREFIX-YY-YY-000001` (documents.ts `nextNumber`/`fyStart`). Ageing rebuilt as-of a date. Inbox worker: `startInboxWorker`/`drainInbox` in inbox.ts, started by server.ts (kick on each event; `INBOX_WORKER=false` = inline). `flowbook/web` restyled to FlowXP tokens/font/shell with simple motion. FlowBook tests: 61 pass (new `test/hardening.test.ts`).
- FlowBook GST pack (2026-10-29): ported ideas from the MIT-licensed Free-GST-Billing-Software into FlowBook (not into FlowXP industries yet). Migration 0006 (items.unit, document_lines.unit, recurring_templates); `gstr.ts` (GSTR-1/3B draft JSON + portal checks, `GET /gst/gstr1|gstr3b?month=YYYY-MM`), `recurring.ts` (drafts on due dates, manual run), `statement.ts` (`GET /parties/:id/statement`); web: Reports > GST returns and Party statement, Recurring screen, unit pickers, amount in words, GST due dates on home. 65 FlowBook tests pass. NOT verified against the GST portal. Not ported: HSN rate table (outdated rates), e-way bill, TDS/TCS, expenses screen, print themes. FlowXP sale events carry totals only, so FlowXP sales reach GSTR-1 only if events gain per-rate/HSN lines.
- FlowBook WhatsApp (2026-10-29): migration 0007 (whatsapp_settings, whatsapp_messages, parties.whatsapp_opt_out); `api/src/whatsapp.ts` (LINK = wa.me address, CLOUD = Meta Cloud API templates, token AES-GCM with FLOWBOOK_SECRET_KEY, hourly reminder worker started in server.ts, one attempt per invoice+offset); routes `/whatsapp/settings|send|messages`; web Settings > WhatsApp, send buttons on invoice/payment, log on invoice. 69 FlowBook tests. Untested against live Meta; no delivery webhook yet. FlowBook stays separate from FlowXP's messaging module on purpose (own numbers/templates per business).
- FlowBook expenses + CSV import (2026-10-29): `api/src/expenses.ts` (journal via ledger.post, source_type 'expense', input GST feeds GSTR-3B ITC, void = reversal), `api/src/import.ts` (per-row savepoints, dryRun rolls back), routes `/expenses`, `/import/parties|items`; web Expenses screen, `csv.js`, `pages/Import.jsx`. 72 FlowBook tests. Still not built from the reference repo: receipt voucher print, TDS/TCS, e-way bill, print themes/paper sizes.
- FlowBook printing + e-way + TDS/TCS + analysis (2026-10-29): migration 0008 (org address/bank/UPI/terms/print_settings, party addresses), `profile.ts`, `eway.ts` (NIC bulk JSON, unverified), web `Print.jsx` (portal-rendered print sheet, receipt, e-way panel); migration 0009 (`payments.tds_minor/tds_section`, relaxed unallocated check, `documents.tcs_*`, system accounts TDS_RECEIVABLE 1310, TDS_PAYABLE (key on 2400), TCS_PAYABLE 2410), `rules.ts` journals, `analysis.ts` + Reports > Sales analysis. 78 FlowBook tests (new `print-eway.test.ts`, `tds-tcs.test.ts`). Deliberately NOT built from the reference repo: reverse charge, opening-balance import, stock/inventory, ITR helper, bill OCR, app lock, tax-inclusive pricing. TDS/TCS rates in `web/src/lib.js` are helpers only. Nothing verified against the GST portal, NIC e-way portal or live Meta WhatsApp. Note: one full `npm test` run flaked once (expenses-import) and passed on rerun.
- FlowBook Zoho-parity build (2026-10-29, migrations 0010-0022, 102 tests, all committed locally, not pushed; detail in `flowbook/README.md`): opening balances and reverse charge and tax-inclusive pricing; bank reconciliation; documents table now holds INVOICE, BILL, CREDIT_NOTE, QUOTE, SALES_ORDER, PURCHASE_ORDER, DEBIT_NOTE (quotes/orders convert, pre-documents never post). Email (`email.ts`, 0017-0018): sent from ONE platform mailbox set by env `FLOWBOOK_SMTP_HOST/_PORT/_SECURE/_USER/_PASS/_FROM`, never the customer's address; per business only on/off, reply-to, copy to self; HTML body, no PDF; every attempt in `email_messages`; untested against a real server and no mailbox is configured until the env is set. Stock (`stock.ts`, 0019): weighted average, append-only `stock_moves`, bills debit Inventory, invoices post a separate Dr COGS/Cr Inventory entry (`documents.stock_entry_id`), negative stock blocked, void undoes moves; no batches/serials/warehouses. Multi-currency (`fx.ts`, 0020): books in INR, docs carry currency + fx_rate + foreign totals, payments settle foreign amounts with realised gain/loss to EXCHANGE_GAIN_LOSS; unrealised revaluation `revalue()` in fx.ts (0025, reversed next day, same account); no GSTR-1 export table. Fixed assets (`assets.ts`, 0021): SLM/WDV/none, monthly depreciation, disposal gain/loss to ASSET_SALE_GAIN_LOSS; GST on asset sale (0024, output tax + GSTR-3B); IT Act block schedule + per-year book schedule (`assets-tax.ts`, 0029, reports only). Projects (`projects.ts`, 0022): projects, time entries, invoice-the-hours creates a draft INVOICE (time_entries.invoice_id freed on delete/void), `documents.project_id` and `project_expenses` tags, profit/budget summary; no timers/timesheets. Conventions: money is integer paise; non-id bigints go out as "x.xx" strings so non-money bigints must be text/int; posting only through `ledger.post()/reverse()`; migrations run on API start. Still open: ITR helper, bill OCR, app lock, product rename, CA review of GST/TDS/TCS. Push: only when the owner says so (Feature then develop).
- FlowBook gap fixes (2026-10-29): FlowXP signing secret stored sealed (`enc1:` + AES-GCM) when FLOWBOOK_SECRET_KEY is set, plain rows still read; GST40 slab (0023, seeded and backfilled); asset-sale GST (0024); FX revaluation (0025). 105 tests. Still open and needing outside verification or large work: real SMTP, GST/NIC/Meta live checks, stock batches/serials/warehouses and back-dated costing, GSTR-1 export table, foreign bank accounts, IT Act depreciation blocks, timers/timesheets.
- FlowBook stock upgrade (2026-10-29): migrations 0026-0028. `recost()` in stock.ts replays an item's moves in date order (costed flag = valued at running average; VOID/transfer-in rows mirror via reverses_move_id), updates value_minor and posts per-date Inventory/COGS correction entries (`stock_recost`); void adds `stock_void_adjust` when the cost entry differs from the moves. Warehouses table + stock_moves.warehouse_id + documents.warehouse_id, `transferStock`, per-warehouse no-negative check. Batches/serials: items.tracking NONE|BATCH|SERIAL, stock_moves batch_no/expiry_date/serial_no, `planSlices` (FEFO / oldest serial when nothing chosen), `issueDocument(..., tracking)` and issue route body `tracking`, adjust/transfer accept tracking, `/stock/batches`, `/stock/serials/:id`, `/warehouses`. 110 tests. Still open: cost per batch/warehouse, bin locations, bundles.

- FlowBook IT Act block depreciation + yearly asset schedules (2026-10-29, migration 0029, 111 tests): `assets-tax.ts` (`IT_BLOCKS` rates, `taxDepreciation`, `assetSchedule`, `setAssetTax`); fixed_assets.it_block/it_opening_wdv_minor/it_use_date; web Assets page 'Year by year'. Rates need CA confirmation; no additional depreciation or date-dependent rates. Browser check not done (API needs restart for 0029).
- FlowBook GSTR-1 export table (2026-10-29, migration 0030, 112 tests): foreign-currency invoices are IGST, go in `exp` (WPAY/WOPAY) with shipping bill fields on documents, zero-rated in 3B. No SEZ/deemed exports/CDNUR; portal-unverified.
- FlowBook foreign-currency bank accounts (2026-10-29, migration 0031, 114 tests): accounts.currency/is_bank, journal_lines.foreign_amount_minor (ledger guard), `bankacct.ts` (create, transfer, void), holding/costOfForeign in fx.ts (average cost), payments accountId/rate, revalue includes accounts, reconcile in foreign amounts. Bank page UI; only browser-checked on existing rupee data.
- FlowBook 7-day free trial + site (2026-10-29, migration 0032, 115 tests): organizations.plan/trial_ends_at, 402 `trial_ended` on writes after expiry, trial banner in the FlowBook app, manual switch to ACTIVE (no payments). SAME DAY CHANGE, owner asked for ONE login: FlowBook has no login of its own now. FlowXP `POST /api/flowbook/launch` signs a 60 s handoff (env FLOWBOOK_APP_URL + FLOWBOOK_SSO_SECRET on FlowXP, FLOWBOOK_SSO_SECRET on FlowBook API, VITE_SITE_URL on FlowBook web build), FlowBook `POST /v1/auth/flowxp` (migration 0033, `sso.ts`, 116 tests) creates/links the books and copies FlowXP's trial/plan; FlowXP login/onboarding keep `?next=`. Marketing site: nav is Product, Industries, FlowBook, AI Manager, Integrations, Pricing (Setup guide and About only in footer); `/flowbook` rewritten as a live product page with real screenshots `frontend/public/product/flowbook-*.webp` (demo shop data, reshoot with the scratchpad puppeteer script) and trial buttons go to FlowXP /signup and /login with next=/app/flowbook?open=1. TODO owner: set the three env vars above in production and decide the FlowBook production host.
