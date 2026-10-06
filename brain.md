# FlowXP brain

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
- Tests: `promotions.test.js` (11). Not built: offers by day of week or time, mixed-product bundles, offers in the restaurant till, a refund screen
  separate from credit notes, an exchange across outlets.

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
