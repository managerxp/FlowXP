# FlowXP — Documentation

The smart flow for every business. AI-powered billing, payments, inventory,
GST and business intelligence — with a dedicated restaurant/cafe operations
layer (orders, kitchen display, table QR ordering) on top. A product of
ManagerXP, standalone: its own server, its own Postgres database, nothing
shared with `managerxp-platform`.

This file documents the product as it exists in the codebase today. For the
original build log and phase-by-phase notes, see `README.md`; this file is
the current reference, not a history.

---

## 1. Tech stack

**Backend** — Node.js + Express 4, plain SQL via `pg` against PostgreSQL (no
ORM), JWT auth (`jsonwebtoken` + `bcryptjs`), `helmet` + `cors` +
`express-rate-limit`, `multer` for file uploads, `nodemailer` for email. ES
modules throughout. The schema is versioned: `backend/migrations/*.js` are applied in order at
boot and recorded in `schema_migrations` (see §6).

**Frontend** — React 19 + Vite 7, Tailwind CSS v4, React Router 7, GSAP for
scroll/entrance animation, `@react-three/fiber` + `three.js` for the one
WebGL hero effect, `qrcode` for generating QR images client-side. A plain
`fetch`-based API client — no Axios, no React Query/Redux.

**Database** — PostgreSQL. Money is stored as integer paise everywhere;
`utils/money.js` is the one conversion point between rupees (API surface)
and paise (storage).

Deliberately not the Next.js/NestJS/Prisma/Redis stack an earlier
architecture brief called for — that document was treated as a feature
checklist, not literal tech-stack instructions.

---

## 2. Running it locally

```bash
# 1. Database (once)
createdb flowxp

# 2. Backend
cd backend
cp .env.example .env        # fill in DATABASE_URL, JWT_SECRET; see §8
npm install
npm start                   # http://localhost:5100 — creates/migrates the schema on boot

# 3. Frontend
cd ../frontend
npm install
npm run dev                 # http://localhost:5174
```

`npm test` in `backend/` runs the logic checks (trial expiry, permissions,
GST arithmetic, delivery-adapter payload parsing).

With `SMTP_HOST` unset, the mailer prints password-reset links to the
backend console instead of sending them — intended for local development.

---

## 3. Architecture

### Multi-tenancy
```
user            a person who signs in
  ↓ business_users (role: OWNER/ADMIN/MANAGER/CASHIER/STAFF)
business        the tenant — owns every product, invoice, customer
  ↓
branch          an outlet of that business (tables, stock, orders, staff)
```
Every business-owned table carries `business_id NOT NULL`. A `business_id`
arriving from the client (header, body, or query string) is a **claim**,
verified against the requesting user's actual memberships in
`middleware/auth.js` before anything is read or written — never trusted
outright. A wrong or foreign business id returns 404, the same as a
nonexistent one, so guessing ids can't be used to enumerate other tenants.

### Auth & permissions
- `requireAuth` — validates the JWT, loads the user, attaches `req.auth`
  (including `isSuperAdmin`, see §6).
- `withBusiness()` — resolves and authorizes which business a request is
  about, attaches `req.tenant` (role, permissions, subscription status).
  `withBusiness({ requireActive: true })` additionally blocks writes once a
  trial has expired — reads stay open, per the "never delete a business's
  data" principle.
- `requirePermission(name)` / `requireAnyPermission(...names)` — gates a
  route on the resolved tenant's role/permission, with per-user JSONB
  overrides in `business_users.permissions` layered on top of role defaults.
- `requireOwner` — OWNER-only actions (billing, business settings).
- `requireSuperAdmin` — platform-operator gate for `/api/admin/*`, entirely
  separate from the tenant model (see §6).

### Money & tax
- `utils/money.js` — `toPaise`/`toRupees`, the only place a rupee↔paise
  conversion happens.
- `modules/tax.js` — every GST figure in the product runs through
  `computeLineTax`/`sumLines`/`isInterState`. CGST+SGST for intra-state,
  IGST for inter-state, zero tax unconditionally when the business isn't
  GST-registered, regardless of a product's own tax rate. Split tax always
  sums back to the line total exactly.
- `modules/billing.js` — `createInvoiceInTransaction` is the single
  transaction core (invoice numbering, stock lock/decrement, payment
  recording) shared by a direct POS sale **and** billing an Orders/KOT tab —
  not two copies of the same math.

### Orders / KOT model
```
orders            a running tab: DINE_IN (tied to a table), TAKEAWAY, or DELIVERY
order_items        lines on that tab, each PENDING → PREPARING → READY → SERVED
kot_tickets        a snapshot of "items added since the last ticket"
dining_tables      FREE/RESERVED/CLEANING/CLOSED; occupancy is derived from
                   "does this table have a non-billed, non-cancelled order",
                   never stored as its own flag
```
`orders.controller.js` exports its core logic
(`insertOrderItems`, `sendKotCore`, `getOrCreateOpenOrderForTable`,
`nextNumber`) so the authenticated staff-side endpoints and the
unauthenticated public QR-ordering endpoint enforce identical rules rather
than maintaining two copies. Billing an order always honors the price
captured when the item was added — never a catalogue price that may have
changed since.

---

## 4. Features

### 4.1 Core commerce
| Area | What it does |
|---|---|
| Products & categories | Full catalogue: pricing, GST rate, HSN/SAC, barcode/SKU, unit, opening stock, low-stock threshold, a customer-facing **description** and an uploaded **photo**. Services (`track_inventory: false`) skip the stock ledger entirely. Categories are created inline from the product form. |
| Customers & suppliers | Contact records with outstanding/payable balances computed live from invoices and purchase orders — never a stored number that can drift. |
| Billing (`invoices`) | Cart → discount → GST → payment → invoice, one atomic transaction. Catalogue items, ad hoc lines, partial/split payment, cancel-with-stock-restore. |
| Inventory | `current_stock` is a maintained cache; `inventory_transactions` is the ledger it's derived from — every sale, purchase, manual adjustment and cancellation writes through it. The Inventory page includes an "Add stock item" form and a searchable per-product stock ledger. |
| Purchases | Purchase orders with their own numbering, GST, and supplier payable tracking. |
| Expenses | Categorised, date-filterable. |
| Reports | Sales, purchases, expenses, outstanding, inventory valuation, top customers, and a GST summary with HSN-wise breakdown — all date-range filterable. |

### 4.2 Restaurant / cafe operations
Nav-gated to `RESTAURANT`, `CAFE`, `GAMING_CAFE`, `RACING` business types.

| Page | Route | What it does |
|---|---|---|
| Orders | `/app/orders` | Open tabs grouped by Dine-in / Takeaway / Delivery. Open a new order, search-and-add items, send to kitchen, bill → real invoice. |
| Kitchen Display | `/app/kitchen` | Live queue (polling, ~8s) grouped into tickets. Tabs for To Make & Preparing / Ready to Serve / Served. Advance a ticket's status with one click. |
| Tables | `/app/tables` | Floor grid: name, zone, seats, live occupancy (derived, not stored). Add a table. Each table has a QR code (rendered client-side via `qrcode`) linking to its public ordering page, with copy-link and download. |
| Business Details | `/app/settings/business` | Name, contact, address, GSTIN, and the UPI ID used for the QR-ordering payment prompt. |

**Customer QR ordering** — `/order/:token`, the one bare/unauthenticated page
in the app (no `SiteLayout`, no `AppShell`, no session at all). A customer
scans a table's QR code, sees the menu (grouped by category, with photos and
descriptions), builds a cart, and places an order. It lands on the table's
existing open tab if one exists (a second round doesn't collide with the
first), and its KOT is **sent automatically** — a customer has no "send to
kitchen" button, the same way an incoming delivery-platform order goes
straight to the kitchen.

On the confirmation screen, if the business has a UPI ID configured, a **UPI
payment QR** is shown for the order's amount (`upi://pay?pa=...&am=...`, a
standard deep link every UPI app already registers itself to handle). This
is *not* a payment gateway integration — it's the digital equivalent of a
UPI QR sticker on the counter. FlowXP never learns whether the payment
actually happened; there is no webhook confirming it. "Settle up with staff"
is always the fallback.

### 4.3 Delivery integrations
`/app/integrations` — Zomato, Swiggy, ONDC, Magicpin. Connect (store
credentials), enable/disable, sync menu, and send a test order. A connected
order — real or simulated — becomes a normal `order` with its KOT already
sent, so it shows up on Orders/Kitchen Display exactly like a dine-in order.

**All four adapters are mocks** (`modules/delivery/adapters/*.js`):
`verifySignature()` always returns `true`. None of these platforms' real
partner APIs are reachable without a registered business account and
approved credentials. Each adapter defines the real seam a production
client would occupy (`parseWebhookOrder`, `pushMenu`, `pushOrderStatus`,
`verifySignature`) behind `modules/delivery/registry.js`, so wiring in a
real one later is a rewrite of one file, not a redesign.

The inbound webhook (`POST /api/integrations/:platform/webhook/:token`) is
public, authenticated by an unguessable per-business-per-platform token in
the URL rather than a session — a delivery platform's server has no FlowXP
login. Every call, successful or not, is logged to `delivery_webhook_log`.

### 4.4 Platform administration (super admin)
A super admin is a `users` row with `is_super_admin = true` — not a separate
login system, but explicitly **rejected** by the regular customer-facing
`/api/auth/login` (it would otherwise sign in fine and then show an empty,
confusing "no businesses" state). Seeded from `SUPER_ADMIN_EMAIL` /
`SUPER_ADMIN_PASSWORD` at every boot (only the flag is re-applied on repeat
boots — an existing password is never overwritten).

| Page | Route |
|---|---|
| Login | `/superadmin/login` |
| Overview | `/superadmin` — platform-wide stats: businesses by status/subscription, users, invoices, revenue collected |
| Businesses | `/superadmin/businesses` — search/filter every tenant, view detail (owner, members, branches, revenue), suspend/reactivate/close |
| Plans | `/superadmin/plans` — edit pricing on the public plan ladder (every plan seeds at ₹0 until set here) |

Own token storage (`flowxp.admin.token`, separate from the business
session's `flowxp.token`) so an admin session and a business-owner session
can coexist in the same browser.

### 4.5 Public marketing site
`/`, `/features`, `/industries`, `/ai`, `/integrations`, `/about`,
`/contact`, `/pricing`, `/privacy`, `/terms` — all inside `SiteLayout`
(floating glass nav: Home, Industries, Pricing, Integrations, About,
Contact — Features/AI have no separate nav entry since that content already
lives on the home page). Notable frontend pieces:
- `components/Antigravity.jsx` — a WebGL particle-ring hero effect (lazy
  loaded, ~240kb gzipped — the heaviest single dependency in the app),
  tracking the real cursor via a `window`-level listener (the hero wraps it
  in `pointer-events-none`, so it can't use r3f's own pointer system).
- `components/BorderGlow.jsx` — a cursor-reactive glow-border effect (`GlowCard`)
  used on every card across the home page, themed to the brand's blue/cyan/violet.

---

## 5. API reference (by domain)

All routes are mounted under `/api`. Full detail lives in
`backend/src/routes/*.routes.js`; this is the map.

| Prefix | Auth | Covers |
|---|---|---|
| `/auth` | mixed | signup, login, logout, forgot/reset password, `me` |
| `/businesses` | session | create additional business, current business read/update, subscription |
| `/dashboard` | tenant | the home-screen checklist + today's numbers |
| `/categories`, `/products` | tenant | catalogue CRUD, barcode lookup, `POST /products/:id/image` (multipart upload) |
| `/customers`, `/suppliers` | tenant | contact CRUD with live balances |
| `/invoices` | tenant | create, list, detail, payments, cancel |
| `/payments` | tenant | standalone payment recording |
| `/inventory` | tenant | levels, valuation, manual adjustment, per-product history |
| `/purchases` | tenant | purchase orders |
| `/expenses` | tenant | expense CRUD |
| `/reports` | tenant | sales/purchases/expenses/outstanding/inventory/top-customers/GST |
| `/orders` | tenant | open a tab, add items, send KOT, update status, cancel, bill |
| `/tables` | tenant | dining table CRUD (each gets a `qr_token` on creation) |
| `/integrations` | tenant + public webhook | delivery platform connect/sync/simulate + the public webhook route |
| `/public/menu/:token` | **none** | customer QR menu read + order placement |
| `/admin` | super admin | platform stats, business management, plan pricing |
| `/plans` | public | the public pricing page reads this |

---

## 6. Database schema (table map)

Created by `migrations/0001_baseline.js` (which calls the three files below;
its DDL is idempotent, so it is a no-op on a database that already has these
tables) plus `0002_idempotency.js`:

- **`config/database.js`** — the tenancy foundation: `users` (incl.
  `is_super_admin`), `businesses` (incl. `upi_vpa`), `branches`,
  `business_users`, `password_resets`, `plans`, `audit_log`,
  `analytics_events`.
- **`config/schema.commerce.js`** — `categories`, `suppliers`, `products`
  (incl. `description`, `image_url`), `customers`, `invoices`,
  `invoice_items`, `payments`, `inventory_transactions`,
  `purchase_orders`, `purchase_order_items`, `expenses`.
- **`config/schema.orders.js`** — `dining_tables` (incl. `qr_token`),
  `orders`, `kot_tickets`, `order_items`, `delivery_integrations`,
  `delivery_webhook_log`.

**Migrations.** `config/migrate.js` is a small forward-only runner: files in
`backend/migrations/` run in filename order, each in its own transaction, under
a Postgres advisory lock, and are recorded in `schema_migrations`. Never edit
an applied migration; add the next numbered file. `0002` adds
`idempotency_keys` and a unique index on `orders (business_id, platform,
external_order_id)`.

**Idempotency.** Money-moving POSTs (invoices, invoice/purchase payments,
standalone payments, purchases, stock adjust, order create/bill, public QR
order) accept an `Idempotency-Key` header (`middleware/idempotency.js`). A
repeat with the same key returns the stored response (`Idempotent-Replay:
true`); the same key with a different body is 422; a 5xx frees the key.
Without the header a request runs as before. The frontend sends one key per
submission via `lib/idempotency.js`. Delivery webhooks dedupe on the
platform's external order id instead.

**Restaurant core (migrations 0003–0008).**
- *Roles:* WAITER, KITCHEN (advances ticket status only), INVENTORY_MANAGER, plus a `refunds` permission on ADMIN/MANAGER.
- *Product kinds:* `products.kind` = DISH / INGREDIENT / PACKAGING. Ingredients are ordinary tracked products, so purchases, adjustments and the ledger work for them unchanged. A purchase sets the product's cost to the latest price paid.
- *Modifiers and variants:* `modifier_groups` → `modifiers`, attached to dishes via `product_modifier_groups`. A variant (Half/Full) is a group with exactly one required choice. Order and invoice lines store a JSONB snapshot of what was chosen and its price. Rules live in `modules/menu.js` and are shared by staff orders, POS billing and the customer QR menu.
- *Recipes:* `recipe_items` (per-portion quantity + wastage %). Billing consumes ingredient stock (ingredients may go negative) and snapshots cost of goods in `invoice_items.unit_cost_paise`. Cancelling reverses every SALE ledger row of the invoice, so dishes and ingredients restore exactly. Maths in `modules/recipes.js`.
- *Wastage:* ledger movement type WASTAGE with a reason code; `POST/GET /api/inventory/wastage`. *Refunds:* `refunds` table, `POST /api/invoices/:id/refund` (never exceeds paid − refunded; cancelling never refunds).
- *Endpoints:* `/api/modifier-groups` (GET, POST, PUT /:id), `PUT /api/products/:id/modifier-groups`, `GET/PUT /api/products/:id/recipe`, `GET /api/products?kind=`.
- *Demo data:* `npm run seed:demo` builds "FlowXP Demo Restaurant" (owner `demo@flowxp.test` / `demo1234`) with a 23-item menu, recipes, modifiers, suppliers, 40 customers and 60 days of trading through the real billing engine, with planted patterns (chicken price creep, one cashier's discounts, rising tomato wastage) for the intelligence phases to find. Re-running replaces it.

**Profitability (migration 0009).** `GET /api/profitability?from=&to=` (permission `reports`) returns net revenue (ex-tax, after discounts and refunds), food cost from the per-line COGS snapshot, payment fees, platform commission, packaging, contribution, and period costs (expenses, wastage) down to an *estimated* net, with the previous equal-length period for comparison, plus breakdowns by channel, day and menu item. Rates come from `cost_settings` (`GET/PUT /api/profitability/settings`, permission `settings` to write); every default is 0 so nothing is deducted that the owner never configured. Order-level costs and discounts are allocated to items in proportion to revenue. Maths in `modules/profitability.js` (pure `profitOfInvoice`, unit-tested); computed on read. UI: Profitability in the Manage nav. The demo seed sets illustrative fee/commission rates and splits sales across counter, takeaway and the four delivery platforms.

**Revenue leakage (migration 0010).** `GET /api/leakage?from=&to=` (permission `settings`, so OWNER/ADMIN only — a report about how the team handles discounts shouldn't be readable by the team) compares the business with its own normal and returns findings with severity, confidence, current vs expected value, a potential amount, evidence rows and a suggested next step. Detectors (`modules/leakage.js`, pure and unit-tested): discount outliers per person vs everyone else, invoices cancelled after payment with no refund, a person's bills being cancelled at several times the team's rate, refunds vs the previous period, per-item wastage rises, manual stock reductions, items billed at zero. Wording is deliberately neutral ("unusual", "worth a look") and a test asserts no accusatory words. `POST /api/leakage/reviews` marks a finding REVIEWED or DISMISSED (a dismissal quiets it for 14 days, then it can return); only that decision is stored (`leakage_reviews`), findings are computed on read. Thresholds are constants in the module. Not covered yet: price overrides (no reliable baseline while prices change), voided kitchen items (no "who cancelled" on order lines), payment mismatches.

**Demand forecasting and predictive stock (migration 0011).** `GET /api/forecast` (permission `reports`) returns the next 7 days of orders and revenue (each as a prediction with a typical range and a confidence level), and for a chosen day the hourly pattern, expected portions per dish and per category. `GET /api/forecast/inventory` projects usage per tracked item and returns days of cover, safety stock, a reorder point, an ORDER_NOW / ORDER_SOON / OK status, a recommended purchase quantity and its cost, grouped by supplier. Method (`modules/forecast.js`, pure and unit-tested): a weighted average of the same weekday over the last 8 weeks, scaled by a weekday-normalised recent trend (clamped 0.9–1.15); reorder point = expected use during the supplier's delivery time + safety stock at a 95% service level. Item usage comes from the stock ledger (sales, cancellations, wastage), so recipes and modifiers are already reflected. Every response carries the method and a backtest of the same method on the last 14 days (mean absolute % error and bias). Days with no sales are treated as closed; fewer than three comparable weekdays gives no prediction rather than a guess. `demand_events` (`POST/DELETE /api/forecast/events`) let the owner declare a festival, match night or closure with an expected % change, which multiplies that day's forecast. `products.lead_time_days` (default 1) is edited on the product. UI: Forecast in the Manage nav; "Review as a purchase" opens the Purchases form pre-filled, and nothing is ordered until it is saved. Not built: weather/holiday feeds (events are manual), persisting forecasts to track accuracy over time, per-item promotions.

**Business-timezone dates.** Invoices are now dated in the business's timezone (`businesses.timezone`), and every default date range ("last 30 days", "today") ends on the business's today (`utils/dates.js`), not the server's or the browser's UTC date. Before this, between midnight and 5:30 a.m. in India a report's range ended a day early and silently dropped the newest invoices. The frontend builds dates from local components (`lib/dates.js`). Purchase, payment and expense dates still default to the database's `CURRENT_DATE`.

**Notifications and background jobs (migration 0012).** `notifications` holds one row per recipient (so read state is personal) with a `dedupe_key` that turns a repeating condition into one notification per period. `modules/notifications.js` `notify()` decides who hears by the same permissions that gate the underlying page — stock alerts go to anyone with `inventory`, leakage only to `settings` (owner/admin), the evening summary to `reports`, integration failures and trial alerts to `settings` — then applies each person's preferences (`notification_preferences`: in-app defaults on, email defaults off and is opt-in per category). Email is never sent inside a request: it is queued as a job. `jobs` is a small durable Postgres queue (`modules/jobs.js`): workers claim with `FOR UPDATE SKIP LOCKED`, a failed job retries after 1, 4, 9, 16 minutes and is marked FAILED after five attempts with the last error kept, and jobs left RUNNING by a dead process are recovered. The worker is a 30-second loop started with the API (`WORKER_ENABLED=false` disables it; stops on shutdown). `modules/scans.js` runs the recurring checks per business, claiming each slot atomically in `scan_state` so two processes never both run one: predicted stock-outs every 3 h (`buildInventoryForecast`), open leakage findings every 6 h (once a week per finding), the trial clock every 6 h, and an evening summary after 9:30 pm local (once a day). A failed delivery-platform webhook notifies once an hour per platform. Each scan is a pure payload mapper plus a small loader, unit-tested. API: `GET /api/notifications`, `/count`, `POST /:id/read`, `/read-all`, `GET/PUT /preferences` — every query is scoped to the signed-in user, and preferences only offer categories the role can open. UI: a bell with an unread count in the top bar, and Notifications (list + preferences). Read notifications older than 60 days and finished jobs older than 14 days are purged. Not built: push/SMS/WhatsApp delivery, per-item snooze, alert thresholds set by the owner, and a separate worker process or Redis (the queue module is the one seam to swap).

**Split bill, table transfer and merge (migration 0013).** *Split bill:* `POST /api/orders/:id/bill` now accepts `items: [{ order_item_id, quantity? }]` to bill just those items (a quantity below the line's splits the line, so two portions of one dish can be paid by two guests) and `payment: { method, amount: 'FULL' }` to collect exactly what the bill comes to. Each call makes its own invoice through the same billing engine (its own GST, stock, cost snapshot); the tab stays open for the next guest and closes when its last item is billed. Billing without `items` bills whatever is left. A billed line (`order_items.invoice_id`) can't be billed twice, edited or cancelled, and its kitchen status is untouched. Cancelling the rest of a part-billed tab closes it as billed. `invoices.order_id` now links an invoice to its order (an order can have several), and profitability's channel attribution uses it. *Equal split of one bill:* the Record payment form has "Split between N" — one payment per person against the same invoice, the last settling the exact balance. *Transfer:* `POST /api/orders/:id/transfer { table_id }` moves a dine-in tab to a free table. *Merge:* `POST /api/orders/:id/merge { from_order_id }` folds another dine-in tab into this one (items and kitchen tickets follow; the other becomes MERGED and its table frees). *Split order:* `POST /api/orders/:id/split { items, table_id | to_order_id }` moves chosen items (or part of a line) to another table, joining its running tab if it has one. All are tenant-scoped, locked in id order, audited (`order.transferred/merged/split`), idempotent-keyed, and only touch open tabs. UI: Split…, Move table and Merge… on the order screen. Not built: reassigning a whole tab to another waiter, splitting a single invoice into several after the fact, and combined KOT reprints after a merge.

**Kitchen stations, routing and timing (migration 0014).** `kitchen_stations` (Tandoor, Curry, Cold…); each dish has a `station_id` and `prep_minutes` (a business-wide default, `kitchen_default_prep_minutes`, covers dishes with none). When a line is ordered, its station and expected minutes are copied onto `order_items`, so re-routing a dish never moves tickets already in the kitchen. Lines now carry `sent_at` (set when the KOT is sent — or when a delivery order arrives), `ready_at`, `served_at` and `cancelled_at`, stamped by every path that changes status; `kot_tickets.priority` (NORMAL/RUSH) is chosen when sending, or set later with `POST /api/kitchen/orders/:id/rush`. *Live:* `GET /api/kitchen/tickets` returns every ticket grouped per order, with each line's minutes elapsed against its expected time (ok / warning at 75% / late), station chips with making/late counts, rush tickets first, lines cancelled in the last 15 minutes shown struck through ("don't make"), and an order billed before its food is out stays on screen for up to 6 hours. `POST /api/kitchen/advance` moves lines making → ready → served (or back), the only writer of those timestamps besides the order screen. *Setup:* `/api/kitchen/stations` and `GET/PUT /api/kitchen/routing` (bulk dish → station + minutes, plus the default), gated on the catalogue permission; the Kitchen screen has a Stations dialog. *Performance:* `GET /api/kitchen/performance` (permission `reports`) gives average, p90 and on-time % overall, by station, by dish (with change against the previous equal period) and by hour sent; preparation time is sent → ready. The Kitchen display filters by station and tab, timers tick locally between 8-second polls; the KITCHEN role can operate it but not change setup. A new `kitchen` notification category alerts owners/managers once per order that is 5+ minutes past its expected time (checked every 5 minutes). Not built: per-station KOT printing, sound alarms, and a per-device dark theme.

**Multi-outlet (migration 0015).** A business is the organisation; each *outlet* is a `branches` row with its own tables, stock, orders, invoices, payments, expenses, purchases and staff. Customers, suppliers, the menu, modifiers, recipes and kitchen stations are shared. A business with one outlet behaves exactly as before. *Who sees what:* `business_users.branch_id` NULL = a **group user** (owners and admins always; managers and stock managers may be) who can see every outlet; a value = **pinned** to that outlet (cashiers, waiters and kitchen always). `X-Branch-Id` is a claim, like `X-Business-Id`: `withBusiness()` checks it against the business's active outlets and sets `tenant.branchId` (where new records go — always a real outlet, defaulting to the main one), `tenant.scopeBranchId` (what reads are limited to; null = all, group users only), `viewAll`, `pinned`. A pinned user gets their outlet whatever they send; a foreign or unknown outlet is a 404. `requireOutlet` refuses writes in the "All outlets" view; `requireGroupUser` keeps group-wide pages (leakage, comparison, cost assumptions) away from pinned users. Every list and by-id read/write on orders, tabs, kitchen, invoices, payments, expenses, purchases, inventory, tables, reports, dashboard, profitability, forecast filters with `utils/scope.js branchFilter`, so another outlet's record is "not found" (a test walks the whole matrix). Operations on an existing record (bill an order, cancel an invoice, pay a bill) act on that record's own outlet, not the outlet being viewed. Orders from delivery-platform webhooks go to the main outlet; a customer's QR order goes to its table's outlet.
*Stock:* `branch_stock(branch_id, product_id, quantity)` is authoritative; `products.current_stock` stays as the business total. Every stock change goes through `modules/stock.js moveStock()` (billing, ingredient consumption, cancel, adjust, wastage, purchases, opening stock, transfers) so the two never drift — a test asserts Σ outlet stock = total after a mix of all of them. Oversell is checked against the selling outlet's stock; cancelling returns stock to the outlet that sold it. *Transfers:* `POST /api/inventory/transfer` (two `TRANSFER` ledger rows, refuses more than the sender holds; a pinned user may only send from their own outlet), `GET /api/inventory/transfers`. *Price and availability:* `product_branch_settings` (`price_paise` NULL = shared price, `is_available`), resolved in one place (`modules/menu.js outletSettingsFor`) by billing, order lines and the QR menu; `GET/PUT /api/products/:id/outlets`. Product lists return the outlet's price/stock/availability plus `shared_price` (what the edit form saves). *Outlets:* `GET/POST /api/outlets`, `PUT /api/outlets/:id` (name, code, city, state, GSTIN; close/reopen — not the main outlet, not with open orders or stock; plan limit `limits.outlets`: trial 3, starter/growth 1, business 5). An outlet's state drives GST place of supply for its sales. `GET /api/outlets/compare` runs the profitability engine per outlet (orders, net revenue, average order, food cost %, contribution, discount %, refunds, wastage, expenses, estimated net); rows add up to the business total. *Staff:* `GET/POST /api/staff`, `PUT /api/staff/:userId` (permission `settings`): adding a new email creates the user with an unknown password and emails a 3-day set-password link; only an owner adds or changes owners/admins; nobody edits themselves; the last owner can't be removed; owners/admins always cover every outlet and floor roles are always pinned; the plan's `users` limit is enforced. *Alerts:* outlet events (stock, late kitchen tickets) go to group users plus that outlet's people, are deduped per outlet and titled with its name; business-wide ones (summary, leakage, account) go to group users only. The stock scan and forecast run per outlet. UI: an outlet switcher in the top bar (with "All outlets" for group users; pages remount and reload on switch), Outlets (list + Compare), Staff, "Outlet prices" on Products, "Transfer stock" on Inventory. Demo seed: three outlets (MG Road, Indiranagar, Koramangala), pinned cashiers, per-outlet stock/tables/purchases/wastage, Indiranagar +10% on Chicken Biryani. Not built: per-outlet invoice numbering, kitchen stations or recipes, inter-outlet purchase orders, per-outlet delivery-platform integrations and leakage findings, per-outlet currency or timezone.

**Loyalty and coupons (migration 0016).** *Visit card:* the owner sets "visit number N earns a free item" (`loyalty_programs`: N from 2 to 50, the reward dish, how many free, and an optional minimum bill for a visit to count) at `/app/loyalty`. A customer is a mobile number (`modules/loyalty.js normalisePhone`: last ten digits, so "+91 98765-43210" and "098765 43210" are the same person). Progress is never a stored counter: `loyalty_events` holds one VISIT or REDEEM per customer per day (a partial unique index), voided when its invoice is cancelled, and `progressFor` derives the card from them. N−1 stamps make the Nth visit the free one; when that visit's bill contains the reward item, billing (`createInvoiceInTransaction`) takes it off as a line discount (up to the reward quantity, once per bill, tax computed on the reduced value), records a REDEEM and the card starts again; a bill without the item just stamps and the reward stays due. Several bills the same day are one visit, and a same-day stamp becomes the reward visit if the item turns up on a later bill. Cancelling the reward bill gives the reward back; cancelling a stamp bill removes the stamp. The customer row is locked while billing, so two tills can't hand out one reward twice. Business-wide: a visit at any outlet counts. *Where it shows:* the till (`MobileLookup`: type a mobile, find the customer or add them with a name, see their card; also shown when a customer is picked by name; `GET /api/loyalty/lookup?phone=`, `GET /api/loyalty/customers/:id`), the order screen (attach a customer to a tab with `PATCH /api/orders/:id/customer`), the invoice, and the customer's QR menu: the menu returns the program (`loyalty`), `POST /api/public/menu/:token/loyalty { phone }` shows a number's card (stamps only, no name; rate-limited harder than the menu), and placing an order with a mobile finds or creates the customer and links the order, so billing that table stamps their card automatically. Owner results: `GET /api/loyalty/summary` (members, visits and rewards given, value of rewards, most frequent customers with card status). *Coupons:* `coupons` (code unique per business ignoring case; PERCENT or FLAT; minimum bill; a cap for percent coupons; start and end dates; total uses; uses per customer, which needs the customer's mobile) and `coupon_redemptions`. `modules/coupons.js validateCoupon` is the one rule check used by both `POST /api/coupons/check` (a cashier's preview) and billing (which locks the coupon row, so its last use can't be taken twice); the discount comes off the bill after any hand-given discount and is added to the invoice's discount, with `coupon_code`, `coupon_discount_paise` and `loyalty_discount_paise` recorded so an invoice shows what its discount was made of. Cancelling an invoice frees the coupon use. Coupons and rewards are excluded from the revenue-leakage discount checks (they are policy, not a person's discretion; a test proves a hand-given discount of the same size is still noticed). Settings and coupons need the `settings` permission and a group-level user; the till endpoints need `billing`. Not built: points or spend-based earning, tiers, birthday rewards, SMS/WhatsApp messages to customers, per-outlet coupons, coupon codes on the QR menu, stacking rules between several coupons.

**Flow AI, the manager's assistant (migration 0017).** `/app/ai`: ask about the business in plain English ("how did we do last week?", "what should I order tomorrow?", "is anything running slow in the kitchen?") or press *Daily briefing*. The provider is Anthropic's Messages API, called with plain `fetch` from `modules/ai/provider.js` (model `AI_MODEL`, default `claude-sonnet-5`; key `ANTHROPIC_API_KEY`). With no key the page says it isn't set up and nothing is sent anywhere; the rest of the app is unaffected. The provider file is the only place that knows about Anthropic (`setProvider` swaps it, which is how the tests run without a network). *How it works:* `modules/ai/manager.js` runs a tool-use loop (at most six rounds): the model asks for a tool, the server runs it and returns the result, until it answers. It has no direct database access. `modules/ai/tools.js` defines eleven **read-only** tools that reuse the app's own engines: sales summary (with the previous equal period), daily trend, menu performance (best/worst by quantity, revenue, contribution or margin), stock forecast, demand forecast, kitchen timing, wastage, expenses, leakage findings, outlet comparison, loyalty and coupon counts. *Safety:* a tool is offered to the model, and run, only if the asker's role holds the same permission as the matching screen (per-user overrides included; checked when listing and again when executing); group-wide tools (leakage, comparison, loyalty) are refused to someone pinned to one outlet; outlet-aware tools follow the outlet being viewed; only aggregates in rupees leave the server, never customer names or phone numbers (staff names appear only in leakage findings, as on that screen); a tool result is capped at 12,000 characters; the system prompt tells the model to state only tool-provided numbers, mark forecasts and costs as estimates, word staff findings as "worth a look", refuse to change anything or discuss other topics, and treat text inside results (dish names, notes) as data never as instructions. *Control and cost:* each answered question is one row in `ai_usage` (with token counts) and counts against the plan's monthly `limits.ai_queries` (trial 50, starter 100, growth 500, business 2,000; blank = unlimited) — a failed provider call costs nothing; there is a per-person rate limit on top; an owner can switch the feature off for the business (`businesses.ai_enabled`, `PUT /api/ai/settings`), after which nothing is sent. Every question and answer is stored (`ai_conversations`, `ai_messages`, with the tools used), private to the person who asked, and audited as `ai.asked`. Endpoints: `GET /api/ai/status`, `POST /api/ai/chat`, `POST /api/ai/briefing`, `GET /api/ai/conversations[/:id]` (permission `ai`: owner, admin, manager). *Not verified here:* the live call to Anthropic (no key was available; the request follows the documented Messages API with tool use, and the loop is tested against a scripted provider). Not built: streaming answers, charts in replies, actions (creating purchase orders, changing prices), a proactive daily push, a per-business monthly spend cap in money, and other providers.

**Purchase orders from the forecast (migration 0018).** A purchase order now has a lifecycle: DRAFT → ORDERED (sent to the supplier) → RECEIVED, or CANCELLED. Recording a purchase directly (`POST /api/purchases`) still receives it on the spot, exactly as before. *Nothing moves stock or money until an order is received.* `POST /api/purchases/orders` creates a draft; `PUT /api/purchases/:id` edits an open one (supplier, lines, expected date, note); `POST /api/purchases/:id/send` needs a supplier, marks it ordered, sets the expected date from the slowest item's lead time if the owner didn't, and returns the message to send: it is emailed to the supplier if they have an email (the mailer logs it in development), and a WhatsApp link is built from their phone (`https://wa.me/91…?text=`), plus text to copy; `POST /api/purchases/:id/receive` takes what actually arrived and what was charged per line (`received_quantity`, `unit_cost`; a line not mentioned is taken as delivered in full, zero everywhere is refused): stock goes in at the order's own outlet whichever outlet the buyer is viewing (`moveStock`, a PURCHASE ledger row, the product's cost follows the price paid), the totals and GST are recomputed from what was received, an optional payment is recorded, short deliveries are reported back and kept on the line; `POST /api/purchases/:id/cancel` for open orders. Paying an order before it is received is refused (the receipt sets the amount due). Receipts lock products in id order, the same order billing uses, so a delivery and a sale can't deadlock. *From the forecast:* `POST /api/purchases/orders/from-forecast` (needs a real outlet, idempotent-keyed) runs the outlet's stock forecast and creates one DRAFT per supplier for everything it says to buy, at the latest price paid; anything already on an open order at that outlet counts towards the need, so pressing it twice doesn't order twice, and cancelling a draft frees the need again. Every order records its `source` (MANUAL or FORECAST) and is outlet-scoped like the rest of purchasing. A scan (with the stock alerts, per outlet) notifies once per day per order that an ORDERED purchase is past its expected date. UI: Purchases has Open orders (draft/ordered with expected date, overdue and forecast badges) and History; an order opens in a dialog to edit, Send to supplier (message, Copy, WhatsApp), Receive (quantities and prices, paid now) or Cancel; the Stock forecast has "Create draft orders for all" and per-supplier "Review as an order". Not built: back-orders for short deliveries (a short line is final), partial receipts across several deliveries, supplier price lists, and attaching the supplier's invoice.

**Printing and kitchen alerts (migration 0019).** Receipts and kitchen order tickets print from the browser, so any printer works: an 80 mm or 58 mm thermal receipt printer set up as an ordinary printer, a normal printer, or "Save as PDF"; there is no printer driver or hardware integration in FlowXP. `/app/print/receipt/:invoiceId` and `/app/print/kot/:kotId` are ordinary pages with print CSS (`@page` sets the roll width; the app's own menu and header are hidden), opened in a new tab with `?auto=1` so they print themselves once loaded. *Receipt:* business and outlet name, address and phone (an outlet's own GSTIN when it has one), bill number, date and time, table, who served, the guest, items with quantities, subtotal, CGST/SGST/IGST, discount, coupon and loyalty reward lines, total, payments, refunds, the balance due with a UPI QR for it (when the business has a UPI ID), the guest's loyalty-card line, and a footer; a cancelled bill is stamped CANCELLED. `GET /api/invoices/:id` now returns what it needs (outlet block, cashier, table, order number, loyalty message). *Kitchen slip:* `GET /api/kitchen/kots/:id` lays a ticket out **one slip per station** (in station order, unrouted items last, cancelled lines left off), so the tandoor gets only its own items; each slip shows RUSH, the KOT number and time, the table in large type, item quantities large, modifiers and kitchen notes boxed, and the order note. A picker prints all slips or one station's. *Settings:* business-wide receipt settings (`businesses.receipt_settings`: paper width 58/80 mm, footer, show GSTIN, show UPI QR, show loyalty line) are validated key by key, merged so saving one option never resets the others, and edited in Business settings (owner). Per-device preferences (kept in that browser, so the counter and the kitchen can differ): print the receipt automatically after billing, print the KOT automatically when an order is sent, and the kitchen sound. *Where it appears:* Print receipt on the invoice and on the sale-complete screen; a Print KOT checkbox beside Send to kitchen and Reprint buttons for each ticket on the order; *Kitchen display:* a sound toggle, with one beep for a new order and a different one when an item goes past its time (browsers only allow audio after a click, so turning the bell on enables it). Not built: silent printing without the browser's print dialog (needs the browser's kiosk-printing mode or a small local print service), cash-drawer kick, auto-printing of tickets that arrive from a customer's QR order or a delivery platform (the kitchen screen beeps for them instead), and logos on receipts.

**Activity log and per-person permissions (migration 0020).** *Activity log:* `/app/activity` (`GET /api/audit`, permission `settings`, so owners and admins) shows who did what, where and when as plain sentences ("Cancelled Invoice INV-0042", "Received purchase order PO-0007 worth ₹500 (short: Chicken)", "Changed the permissions of Ravi (refunds: allowed)"), built by `modules/auditText.js` from the existing `audit_log` rows; the readable names of the invoice, order, purchase order, product, customer, coupon or person involved are looked up in one business-scoped query per kind, and an action with no template still shows, humanised. Rows are grouped into seven areas for filtering (sales, stock, menu, money, customers, team, oversight). Filters: person, area, outlet, date range (default the last week, at most a year) and free-text search over the action and its details; paged with a cursor on `audit_id`, so nothing repeats while new rows arrive. Every row is the business's own; a user pinned to one outlet sees only that outlet (`audit_log.branch_id` is now recorded from the outlet the person was working in; business-level actions like settings and staff have none and belong to group users). `?format=csv` exports up to 5,000 rows and needs the `export` permission; cells that start with = + - @ are defused so a name can't run as a spreadsheet formula. Audit writes remain fire-and-forget by design. *Per-person permissions:* a role gives a default set; the owner can allow or deny any of 15 permissions for one person (`GET/PUT /api/staff/:userId/permissions`, owner only: a manager who could edit permissions could grant themselves anything; not your own; owners always have everything). Each permission has a plain-language name and description (`modules/permissions.js`). Overrides are stored in `business_users.permissions` as { permission: true | false }; a value equal to the role's default is dropped, so nothing stale is kept, and changing someone's role clears their overrides. They take effect on the person's next request (memberships are read per request) and each change is audited as `staff.permissions_updated` with what changed. UI: a Permissions dialog on the Staff page (per row: Role default / Allow / Deny, with the effective result and a count of customised people). Not built: login and failed-login history, per-outlet permission overrides, time-limited grants, the sidebar hiding items a person's overrides don't allow (the API enforces them; the menu still follows the role), and audit-log retention or archiving.

**Menu import from a photo (no migration).** Products, then *Import menu from photo* (also a banner on an empty menu and the setup checklist's first step for restaurants): take a photo of each menu page with the camera (`capture="environment"` on phones) or choose existing pictures (up to 5). The browser shrinks each to 1,800 px JPEG before upload. `POST /api/menu-import/scan` (permission `products`; multipart field `images`; JPEG/PNG/WebP, 8 MB each, held in memory and never stored) sends the photos to the AI service (`modules/ai/menuScan.js`), which must answer by calling one tool, `record_menu`, so the reply is structured data rather than prose: name, price in rupees (null when unreadable), section heading as category, description, veg marker, and "unsure". Sizes with separate prices become separate items ("Chicken Biryani (Half)"). The result is only a **draft**: `normaliseItems` trims names, parses prices (₹ and "/-" tolerated), rejects impossible ones, drops repeats across pages and caps at 300; each item is flagged when a dish of that name is already on the menu (ignoring case and spacing) with its current price. The prompt tells the model to transcribe, not invent, and that text on the menu is content, never instructions. A scan counts as one AI request against the plan's monthly allowance (a failed one costs nothing), respects the business's AI on/off switch, is rate-limited per person, and needs the AI key (without one the screen says so and manual entry still works). *Review:* an editable table (name, price, category with suggestions, include tick), amber rows for items the model was unsure of, red for a missing price, "Already on your menu at ₹220" badges, a GST % for the batch (5% suggested when GST is on), a choice for duplicates (leave them, or update their price), an "Add a missing item" row and the model's own notes. *Confirm:* `POST /api/menu-import/confirm` (idempotent-keyed) validates every row first (a bad row rejects the whole batch and names it, so nothing is half-saved), then in one transaction finds-or-creates categories (case-insensitive) and creates dishes (kind DISH, not stock-tracked, the chosen GST) or, for existing names, skips or updates the price; the same dish twice in one batch is added once; another business's menu is never consulted or touched. It is audited as `menu.imported` with the counts. Not built: reading item photos or logos, importing from a PDF, CSV or a delivery platform's menu, per-item GST rates, and matching a scanned item to an existing one that is spelled differently.

**Credit notes, round-off and the GST register (migration 0021).** *Credit notes:* the formal document that reduces an issued invoice, for returns, wrong items and corrections; a refund on its own only moves money, a credit note changes revenue and GST. `POST /api/invoices/:id/credit-notes { items: [{ item_id, quantity }], reason, restock?, refund?: { method } }` (permission `refunds`, idempotent-keyed) in one transaction: takes the chosen quantities off the chosen lines and reverses the GST on them exactly (the final piece of a line takes the exact remainder, so a line credited in several notes never drifts by a paisa; CGST/SGST or IGST follow how the invoice was taxed); takes the note's share of any invoice-level discount or coupon off the amount (the note that completes the invoice takes the exact remainder); numbers it (`CN-0001`, per business); and *settles* it: first against what the customer still owes on the invoice, then, only if asked, as money paid back (a normal refund row linked to the note, capped at what was paid), and anything left simply stays a credit on the record. Optionally returns stock-tracked items to the invoice's own outlet (`moveStock` and a RETURN ledger row; dishes made to order are never restocked). Rules: a reason is required; only ISSUED invoices; nothing can be credited beyond what was sold (`only 3 left to credit`); a line can't appear twice; an invoice with credit notes can't be cancelled (credit the rest instead); other outlets and businesses get 404. `GET /api/invoices/:id/credit-notes/options` shows what is left to credit per line; `GET /api/credit-notes[/:id]` lists and prints. UI: **Issue credit note** on the invoice (choose quantities, reason, refund or not, restock), a Credit notes list from Invoices, credit notes and Round off shown on the invoice, and a printable credit note (`/app/print/credit-note/:id`) with the reversed CGST/SGST/IGST and a signature line. *Effect on the books:* the GST report and HSN table are **net of credit notes issued in the period** (with the count and tax reversed shown); profitability reduces revenue by the credit note once, even when the note also refunded cash (`invoices.credited_paise`, and `cn_refunded_paise` so the refund isn't counted twice); credit-note refunds are excluded from the leakage refund signal (they are formal, numbered and audited: `credit_note.issued`). *Round-off:* a business switch (Business settings, Billing) rounds each new bill to the nearest rupee; the difference is stored on the invoice (`round_off_paise`), shown as "Round off" on the invoice and receipt, never taxed, and "paid in full" pays the rounded total. *GST register:* `GET /api/reports/gst/register?from=&to=[&format=csv]` (permission `gst`) gives one row per document per tax rate (invoices, and credit notes as negative rows) with the customer's GSTIN where there is one (B2B) or none (B2C), the state, taxable value, CGST/SGST/IGST and total, plus a TOTAL line that equals the GST report for the same dates (CSV cells starting with = + @ are defused). It is the working register a GSTR-1 is prepared from; it is not itself the filing (no GSTR JSON, e-invoicing or e-way bills). Not built: credit notes for purchases (debit notes to suppliers), round-off shown in profit, credit notes on invoices from before this update that used a bill-level discount are shared out proportionally like any other.

**Deployment readiness and cloud photo storage (no migration).** `DEPLOY.md` is the step-by-step guide. *Photo storage:* `modules/storage.js` puts uploaded files on this server's disk (`STORAGE_DRIVER=local`) or in any S3-compatible bucket (`s3`: AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO), so photos survive redeploys and moving servers. The rest of the app only calls `putFile`/`removeFile` and stores the URL it gets back; old `/uploads/...` URLs keep working after a switch. S3 requests are signed with AWS Signature V4 written with `node:crypto` (no SDK); the signer is verified against AWS's own published GET and PUT examples, and both drivers against a local stand-in bucket. Files are namespaced by business (`products/<business>/<product>-<time>.<ext>`), a replaced photo is deleted (best effort), a failed save returns a clear error and leaves the product's current photo alone, and deleting never leaves the uploads folder. Settings: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`. *Production hardening:* in production the API refuses to start with a JWT secret under 32 characters, an `APP_ORIGIN` that is not https, or incomplete S3 settings, and says which; allowed browser origins come from `APP_ORIGIN` plus `CORS_ORIGINS` (no hard-coded domain); `GET /health` (process up) and `GET /ready` (database answers, for load balancers) are separate; every request gets an id returned as `X-Request-Id` and one JSON log line (no bodies, tokens or query strings); an unhandled crash is logged and the process exits so the platform restarts it clean; uploads are served from disk only when the driver is local. *Packaging:* `backend/Dockerfile` and `frontend/Dockerfile` (nginx serving the build and proxying `/api`), `docker-compose.yml` (Postgres, API, web, named volumes, health checks), a root `.env.example`, a GitHub Actions workflow (backend tests against Postgres, frontend build) and `backend/scripts/backup.sh` (compressed `pg_dump`, keeps the newest N, with restore instructions). **Not run:** the Dockerfiles, compose file and CI workflow were written without Docker available, so the first `docker compose up` may need small fixes. Not built: horizontal scaling (the worker runs once per API server; `WORKER_ENABLED=false` on all but one), Redis, off-server backup upload, an error tracker, and the payment gateway.

---

## 7. Environment variables (backend `.env`)

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string — the server refuses to start without it |
| `JWT_SECRET` | yes | signs every session token — same refusal-to-start reasoning |
| `PORT` | no (5100) | API port |
| `NODE_ENV` | no | `production` enables `trust proxy` and TLS-relaxed Postgres SSL |
| `APP_ORIGIN` | no | CORS allowlist + link base for emails |
| `TRIAL_DAYS` | no (7) | free trial length |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | no | seeds the platform-operator account; blank skips seeding one |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | no | outbound email; unset means the mailer logs instead of sending |

Frontend has no `.env` of its own — `vite.config.js` proxies `/api` and
`/uploads` to the backend in development, and the same relative paths work
in production behind one domain.

---

**Reservations and the waitlist (migration 0022).** *Reservations* (per outlet): `POST /api/reservations { guest_name, party_size, reserved_at, duration_min?=90, phone?, table_id?, notes? }` (permission `billing`, needs a real outlet). A table can carry only one live (BOOKED/SEATED) reservation at a time: slots are `reserved_at .. + duration`, overlap is refused with 409 (back-to-back is fine), a party larger than the table's seats is refused, and closed tables and other outlets' or businesses' tables are 404. `GET /api/reservations?date=` lists a day (in the business timezone); `GET /api/reservations/availability?reserved_at&party_size&duration_min` lists the tables that fit and are free for a slot; `PATCH /:id` edits or moves a booking while it is still BOOKED (a booking never clashes with itself); `POST /:id/status` moves BOOKED to CANCELLED or NO_SHOW and SEATED to COMPLETED (both free the table for other bookings); `POST /:id/seat { table_id? }` marks the guests arrived and refuses a table with a running order or another party's booking. A mobile number links the booking to the customer (so their loyalty card is one tap away). Seating does not create an order: the floor opens one on the table as usual, so occupancy stays derived from orders. The Tables screen shows a booking due within the hour on the table. *Waitlist* (walk-ins): `POST /api/waitlist` adds a party in arrival order with a quoted wait (the host's number, or 10 minutes per party already waiting: a plain estimate, not learned from turn times); `POST /:id/notify` marks them called, `/:id/seat { table_id, force? }` seats them (a table booked in the next hour needs `force`), `/:id/leave` removes them; `GET /api/waitlist` shows the queue with minutes waited. All of it is scoped to the active outlet (a pinned user can't reach another outlet's bookings by id) and audited. UI: **Reservations** page (day view with booked count and expected guests, book/edit with the free tables offered for that slot, seat, no-show, cancel; Waitlist tab refreshing every 30 seconds). Not built: online booking by customers, SMS/WhatsApp confirmations and reminders (arrive with the messaging feature), deposits, and no-show fees.

**Combos and waiters (migration 0023).** *Combos:* a combo is an ordinary menu item (its own price, tax rate and kitchen station) made of other items. `PUT /api/products/:id/combo { components: [{ product_id, quantity }] }` (permission `products`) makes an item a combo of two to twenty distinct, active items of the same business; `GET` shows the parts with the separate value and the customer's saving; `DELETE` turns it back into a plain item. A combo cannot contain a combo, cannot contain itself, and an item that is inside a combo cannot itself become one. It bills as **one line** at the combo's price and tax rate, but selling it uses up its parts: a stocked part (a bottled drink) comes off its own stock and a dish part consumes its recipe, so stock, ingredient use and the recorded unit cost (`unit_cost_paise`, which profitability reads) all come from the parts (`modules/combos.js`, one place, used by billing). It is refused when a part is archived or switched off at that outlet (on orders and bills alike) or a stocked part has run out at the outlet (`Not enough Coke for Meal Combo`). The kitchen display, the ticket and the printed KOT list what is inside (`1 × Burger, 1 × Fries`). Combo prices are per outlet like any item (Outlet prices). *Waiters:* a table can have a regular waiter (`PATCH /api/tables/:id { waiter_user_id }`; the choice is limited to active team members who work the floor, i.e. not kitchen or stock-only roles, and belong to that outlet or to none; `GET /api/tables/waiters` lists them). An order records who serves it: the one picked at `POST /api/orders { waiter_user_id }`, otherwise the table's regular waiter, otherwise the waiter who opened it; customer QR orders take the table's waiter; `PATCH /api/orders/:id/waiter` hands an open order to someone else; `GET /api/orders?waiter=me` (or a user id) filters. `GET /api/reports/waiters?from&to` (permission `reports`, outlet-scoped) reports billed orders, bills, average bill, discounts and sales (net of credit notes) per waiter, with orders no one served under "Not assigned". UI: Combo editor on Products (live "bought separately" and saving), waiter picker and "my tables" filter on Tables, waiter on the order card and a Waiter picker inside the order, combo contents on Kitchen and KOT, Waiters tab in Reports. Not built: tips and service-charge splits per waiter, captain-level approvals (discounts or voids needing a captain), combos with choices (pick one of three sides), and demo history carrying waiters (old orders show as Not assigned).

**Customer messaging: WhatsApp and SMS (migration 0024).** *Setup:* the server picks a provider with `MESSAGING_PROVIDER`: `log` (default; nothing leaves the server and every message is recorded as SKIPPED, honestly), `whatsapp_cloud` (Meta WhatsApp Cloud API: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`) or `twilio` (SMS, and WhatsApp when `TWILIO_WHATSAPP_FROM` is set); production start refuses half-filled settings. Each business then chooses its channel (Off / WhatsApp / SMS) and which automatic messages to send (`PUT /api/messaging/settings`, permission `settings`). *What is sent* (`modules/messaging`): the **bill** after a sale to a customer with a mobile number (a link to a public page `/bill/<token>`, the token being 128 random bits stored on the invoice and reused, showing that one bill only, with a UPI pay-now link while money is owed); a **booking confirmation and cancellation**; **waitlist** joined and **table ready**; a **loyalty reminder** when a customer's next visit earns the free item (at most once a week); and **offers** (campaigns). `POST /api/messaging/send-bill` sends a bill by hand to the customer or a number typed at the till. *Templates:* WhatsApp lets a business start a conversation only with approved templates, so each kind has a fixed template name and variable order; `GET /api/messaging/templates` prints the exact text to create once in Meta Business Manager (`flowxp_bill`, `flowxp_booking`, `flowxp_booking_cancelled`, `flowxp_waitlist_added`, `flowxp_table_ready`, `flowxp_loyalty_next`, `flowxp_offer`); SMS and the log use the same wording as plain text. *Rules:* offers and reminders are promotional and skip customers with `marketing_opt_out` (`POST /api/customers/:id/marketing`), and every one ends with "Reply STOP" (the reply is not read automatically yet: the owner sets the flag); bills and booking messages are service messages and are sent regardless. A campaign (`POST /api/messaging/campaigns { segment: ALL | LAPSED | NEAR_REWARD, days?, text }`, preview first) goes to active customers with a valid mobile, is capped at 1000 recipients and one per hour per business, refuses links unless confirmed, and reports progress (`GET /api/messaging/campaigns/:batch`). Every message is stored (`messages`: outcome, provider id, error) and shown in the **Message log**; a FAILED or SKIPPED one can be retried. A message problem never fails a sale or booking (the hooks run after the transaction and swallow errors); the `messages` table deliberately has no foreign key to customers, because one would let a message written right after a bill deadlock with the billing transaction. Numbers without a country code are treated as Indian (`MESSAGING_COUNTRY_CODE`, default 91). UI: **Messaging** page (settings and the Meta templates, send an offer with a live audience count, message log with retry), **Send bill** on the invoice, and the public bill page. Not built: reading inbound replies (STOP, questions), delivery and read receipts from the provider, retry queue for messages that fail (retry is manual), per-outlet sender numbers, scheduling, images and PDFs.

## 8. Known limitations / what's next

A working gap analysis against Petpooja (a widely-used Indian restaurant
POS), checked against the actual code, not assumed:

**Would block real restaurant use:**
- **No split bill** — one order → one invoice → one payment. No splitting
  by item, by amount, or by person.
- **No table merge/transfer** — tables are add/rename/status only; no way
  to combine two tables' orders or move a running order to another table.
- **No coupon codes or discount-approval trail** — discount is a free-form
  amount; nothing requires a reason or manager approval.

**Real gaps, workable around today:**
- **No product variants/modifiers** — every product is one flat price; no
  size options or paid add-ons. `order_items.kitchen_notes` is free text,
  never billed on.
- **Inventory deducts finished goods, not recipes** — selling a dish
  decrements *that product's* stock, not a bill of ingredients (rice,
  potato, oil). Fine for retail; a restaurant with real ingredient-level
  stock tracking will outgrow this.
- **No combos/meal deals.**
- **Delivery adapters are mocks** — `verifySignature()` always passes; not
  safe against a forged order in production.

**Deferred, lower priority (Petpooja sells these as separate add-ons too):**
- Points-based loyalty and CRM messaging (a visit-card loyalty and coupons are built), waiter/captain assignment + captain-wise reports,
  kitchen-station routing (bar vs. kitchen printer), a much larger report
  library, offline mode (receipt and kitchen-slip printing are built, from the browser).

**Carried over from the original build (still true):**
- **Flow AI** — built on Anthropic's API (see the Flow AI paragraph in §6);
  it needs `ANTHROPIC_API_KEY` to work and the live call is untested until
  one is set. The provider choice is easy to revisit: only
  `modules/ai/provider.js` knows about it.
- **Subscription payments** — no payment gateway wired up; the Upgrade
  button stays disabled. Plan prices are all ₹0 ("Pricing on request")
  until set in the `plans` table.
- **Multi-outlet** — built (see the multi-outlet paragraph in §6). What it
  doesn't cover yet is listed at the end of that paragraph.
- **GST credit notes** — built for sales (see the credit notes paragraph in §6); debit notes to suppliers and GSTR filing/e-invoicing are not.
- **Per-user permission editing** — built (see the activity log and permissions paragraph in §6).
- **Object storage for uploads** — built (S3-compatible bucket via `STORAGE_DRIVER=s3`; see the deployment paragraph in §6 and `DEPLOY.md`).
- **PWA / service worker**, **Redis/queues** for async jobs — not built.
- **Notifications** (in-app/email alerts for low stock, payment received,
  etc.) — not built.

Two things are deliberately inert rather than fake, not oversights:
- **Plan prices at ₹0** until confirmed and set via `UPDATE`, not a deploy.
- **The Upgrade button is disabled** — a button that looks live and does
  nothing is worse than one that says so.

`/privacy` and `/terms` describe what the product actually does with data
but carry a visible "not yet legally reviewed" banner.

---

## 9. Project layout

```
backend/
  server.js                       app, CORS allowlist, /uploads static mount, graceful shutdown
  src/config/database.js          tenancy schema (users/businesses/branches/plans/audit)
  src/config/schema.commerce.js   products/customers/invoices/payments/inventory/purchases/expenses
  src/config/schema.orders.js     orders/order_items/kot_tickets/dining_tables/delivery_integrations
  src/config/seedSuperAdmin.js    seeds the platform-operator account from env at boot
  src/config/env.js               validated config; refuses to start without JWT_SECRET/DATABASE_URL
  src/middleware/auth.js          sessions, tenant isolation, roles, super-admin gate
  src/middleware/upload.js        product-photo multipart upload (local disk)
  src/modules/subscription.js     trial maths
  src/modules/tax.js              GST — every tax figure runs through this
  src/modules/billing.js          the invoice transaction core, shared by POS sale and Orders→bill
  src/modules/delivery/           registry.js + one mock adapter per platform
  src/utils/money.js              rupees ↔ paise, the one conversion point
  src/controllers/                one per domain, incl. admin.controller.js, publicOrdering.controller.js
  src/routes/index.js             mounts every domain router
  test/                           logic checks (trial, permissions, GST) + delivery adapter tests

frontend/
  src/index.css                   brand tokens — every colour in the product
  src/lib/api.js                  the business-session API client (JWT + X-Business-Id)
  src/lib/adminApi.js             the separate super-admin API client
  src/context/AuthContext.jsx     business-session auth state
  src/admin/                      super admin console (own auth context, shell, pages)
  src/components/ui.jsx           every shared primitive (Button, Table, Modal, Badge...)
  src/components/Antigravity.jsx  WebGL hero particle effect
  src/components/BorderGlow.jsx   cursor-reactive card glow (GlowCard)
  src/site/                       public marketing site
  src/auth/                       signup, login, forgot, reset
  src/app/                        the authenticated product: shell, dashboard, onboarding,
                                   billing, products, customers, suppliers, inventory, purchases,
                                   expenses, payments, reports, orders, kitchen, tables, integrations,
                                   business settings
  src/public/CustomerMenu.jsx     the bare, unauthenticated QR-ordering page
```

---

## 10. Design system

Blue / cyan / violet on white, taken from the FlowXP mark. The logo lives
at `frontend/public/logo.png`; every reference to it falls back to a text
wordmark if the file is ever missing.

### Tokens (`frontend/src/index.css`, one `@theme` block)
Grounds (`surface`/`surface-2`/`surface-3`), borders (`line`/`line-strong`),
text (`ink-900` → `ink-400`, strongest first), brand blue
(`brand-400..700`, `brand-50`), accents (`cyan`, `violet`, `teal`, `amber`),
semantic (`success`/`warning`/`danger`), one font (`--font-sans`), one
corner radius (`--radius-card`), and a shadow scale (`--shadow-sm`,
`--shadow-md`, `--shadow-glow` — the last is the brand-tinted lift under
the primary button). `--gradient-brand` (blue → cyan → violet) is declared
once and used by both `.text-gradient` and `.bg-gradient-brand`, so the two
can't drift apart. A hex code or shadow value written inline in a component
is how a design system stops being one — every one of these lives here,
nowhere else.

### Primitives (`frontend/src/components/ui.jsx`)
`Logo`, `Button` (primary/secondary/ghost × sm/md/lg, renders as `<Link>`/
`<a>`/`<button>` depending on what it's given), `Container`, `Section`,
`Card`, `Field`, `Input`, `Select`, `Textarea`, `Alert` (a persistent error
someone needs to read and act on — see Toast for the opposite case),
`Badge`/`StatusBadge`, `Avatar` (initials, colour hashed from the name so
the same person always gets the same one), `Tooltip` (pure CSS, hover/
focus, no positioning library), `Table`/`Thead`/`Th`/`Td`/`Tr`, `DataTable`
(a `Table` wrapper adding an optional built-in search box — additive, not a
replacement for pages that already hand-roll their own table logic),
`Skeleton`/`SkeletonRows`/`SkeletonCards`, `ListState` (loading/error/empty,
one place so "no results" never renders as a blank table), `Modal`,
`PageHeader`, `ToastProvider`/`useToast` (ephemeral success/error feedback,
mounted once in `main.jsx`; `.glass` styled to match the rest of the site
rather than a to a generic dark snackbar).

**Deliberately not built yet** (no real consumer exists today — see the
reasoning that produced this list, not just the absence): a **Drawer**
(`Modal` covers every current "form over content" need); a **Breadcrumb**
(the app's nesting is shallow enough that a plain "← Back to X" link
already handles the one or two places it comes up); a **Command palette**
(meaningfully complex to build well, and the nav is currently small enough
— roughly 15 items in two groups — that it isn't solving a real problem
yet). Build these once something in the product actually needs one, not
ahead of that.
