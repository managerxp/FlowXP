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

**Delivery riders.** A new `DELIVERY` role on the business's own staff
(`business_users.role`, RBAC permission `billing`) rather than a separate
entity — `modules/riders.js` mirrors `modules/waiters.js`
(`eligibleRiders`/`isEligibleRider`): any active staff member at the outlet
who isn't KITCHEN/INVENTORY_MANAGER is eligible, DELIVERY-role people sort
first. `orders.rider_user_id` plus nullable `picked_up_at` /
`out_for_delivery_at` / `delivered_at` timestamps (same shape as
`order_items.sent_at`/`ready_at`/`served_at`). `PATCH /api/orders/:id/rider`
assigns/clears a rider on a `DELIVERY`-type order; `POST
/api/orders/:id/delivery-status { status }` advances it one step
(`PICKED_UP` → `OUT_FOR_DELIVERY` → `DELIVERED`), refusing a step whose
predecessor isn't done yet or if no rider is assigned; idempotent (re-posting
the current step doesn't move its timestamp). Gated by the `delivery_fleet`
plan feature. OrderPanel shows a rider picker and the three step buttons on
delivery orders.

**Settlement reconciliation** (`/app/settlements`, gated by the existing
`integrations` feature). Real Zomato/Swiggy/ONDC/Magicpin partner APIs need
approval FlowXP doesn't have, so this is the practical fallback: paste the
settlement statement the platform already exports (fixed column order —
order id, date, gross, commission, payment charges, delivery charges, tax,
other deductions, net settled — comma-separated, no header row). `POST
/api/settlements/import` matches each line to a FlowXP order by
`(business_id, platform, external_order_id)` — the same key the webhook
dedup uses — and `modules/settlements.js` (pure functions) checks two things
per line, never an estimated commission rate: does the platform's own
arithmetic add up (gross − every deduction vs. net settled, ₹1 rounding
slack → `ARITHMETIC_ERROR` if not) and does the gross amount match what
FlowXP actually billed for that order via `orders.invoice_id` (→
`VALUE_MISMATCH` if not); no matching order at all is `ORDER_NOT_FOUND`.
`GET /api/settlements?platform=` lists imported lines with their computed
status; `GET /api/settlements/missing?platform=` is the single most useful
check — billed orders on that platform with **no** settlement line at all,
i.e. money that should have been paid and wasn't.

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
| Overview | `/superadmin` — businesses by status/subscription, users, invoices, MRR, revenue collected, a 12-month revenue chart, trials ending soon and payment links awaiting payment (both as lists, not just counts) |
| Businesses | `/superadmin/businesses` — search/filter every tenant, view detail (owner, members, branches, revenue), suspend/reactivate/close |
| Plans | `/superadmin/plans` — edit pricing on the 3-plan public ladder (Starter/Growth/Enterprise; every plan seeds at ₹0 until set here); a "Show hidden plans too" checkbox reaches Trial or a retired plan (kept, never deleted) |
| Payment link | On a business's own detail page — sets a custom price + billing cycle and generates a Cashfree hosted payment link for that one business |
| Plan & business type | On a business's own detail page — assigns its plan, subscription status and business type directly (a comped account, a deal agreed before Cashfree, or fixing a wrong signup) |
| Features | `/superadmin/features` — a "By plan" / "By business type" tab switcher: the plan view is a 3-column grid (Starter/Growth/Enterprise); the business-type view is a dropdown (pick one type) over the *same* 3-column grid, scoped to that type — so "Reservations off for Retail" can mean off just for Retail-on-Starter, not every plan; toggling a switch turns that feature on/off immediately for everyone it applies to |
| Feature overrides | On a business's own detail page — force one feature on or off for just that business, independent of its plan or business type, with an optional reason and expiry |
| History | On a business's own detail page — the subscription-relevant slice of `audit_log` for this one business, chronologically |
| Add-ons | `/superadmin/addons` — priced extras, fully editable (name, description, prices, which business types it applies to) and creatable, not just the 5 seeded ones; a dropdown filters the list to one business type; generating a link for one business happens from that business's own detail page |
| Settings | `/superadmin/settings` — payment gateway (Cashfree's own App ID/Secret/environment) and email/SMS/WhatsApp provider config, editable without a code deploy; secrets shown masked, never sent back to the browser |

**Plan versioning and grandfathering (migrations 0038/0039, 2026-09-29 — from a Super Admin
control-plane audit; see brain.md for the full audit and what was deliberately deferred).**
`plan_versions` sits alongside `plans`: one row per version, `effective_to IS NULL` marks the live one.
`plans` keeps its existing columns and always mirrors the current version, so the public `/plans` pricing
page and a brand-new signup need no changes. Every business is pinned to the version it joined on
(`businesses.plan_version_id`); editing a plan's price or `feature_flags` in `AdminPlans.jsx` (unchanged
UI) now closes the live version and opens a new one under the hood rather than mutating history, so a
business already pinned to the old one is never silently re-priced or re-entitled. Every place that used
to read `plans.limits`/`plans.feature_flags`/`plans.price_*` directly — `middleware/auth.js`'s tenant
construction, `business.controller.js`'s `getSubscription`, and the quota checks in `staff.controller.js`/
`outlets.controller.js`/`ai.controller.js` — now reads through the business's pinned version instead,
falling back to the live plan row if one is somehow unpinned. `GET /api/admin/plans/:code/versions`
backs a read-only "Price history" expander per plan card.

**Pricing trimmed to 3 plans — Starter, Growth, Enterprise (migration 0043, 2026-09-29).** Business is
retired, not deleted: its row stays (so history and any FK to it stay intact) but `is_active`/`is_public`
are both false, which is all the public `/plans` query needed to drop it from the ladder. Enterprise
already had every feature Business had and strictly bigger limits, so the account that was on Business
(the demo seed) moved to Enterprise with nothing lost. `AdminPlans.jsx` shows the 3 public plans by
default with a "Show hidden plans too" checkbox for Trial or a retired plan.

**Subscription history reuses `audit_log`** rather than a new parallel events table — every
subscription-relevant admin action (plan changes, plan-version cuts, feature overrides, payment links,
status changes, the Cashfree webhook's activation) already wrote there.
`GET /api/admin/businesses/:id/history` filters it to one business, chronologically.

**Business-specific feature overrides** (`business_feature_overrides`, one row per business+feature):
the highest-precedence layer in `modules/planFeatures.js`'s `effectiveFeatureFlags(sources, overrides)`
— `enabled: true` forces a feature on even if the plan and business type both say no; `enabled: false`
forces it off even if they both say yes. `expires_at` NULL = permanent; an expired override is ignored,
derived on read the same way trial expiry already is. `POST`/`GET`/`DELETE
/api/admin/businesses/:id/overrides[/:feature]`, validated and audited.

**Paid add-ons (migration 0040, 2026-09-29).** A small catalog (`addons`, 5 rows: Reservations, Table QR,
Loyalty, Zomato/Swiggy integration, Flow AI — the same feature keys as above) each with its own price,
seeded at ₹0. Generating a link for one business (`POST /api/admin/businesses/:id/addon-link`) works
exactly like the main subscription payment link — a Cashfree hosted checkout, defaulting to the
catalog price but overridable for a negotiated deal — except `addon_orders` (mirrors
`subscription_orders`) tracks it, and paying it sets a `business_feature_overrides` row instead of
touching the business's plan: a paid add-on is that override with a receipt behind it. The Cashfree
webhook tells an add-on order from a subscription order by a `flowxp-addon-` link-id prefix. "AI-based
review replies" is deliberately not in the catalog — it isn't a real feature yet and selling one with
nothing behind it would be dishonest. `GET /api/admin/addons`, `POST /api/admin/addons` (create),
`PATCH /api/admin/addons/:key` (any field, same validation pattern as plans), `DELETE
/api/admin/addons/:key` (refused once it's ever been sold — deactivate instead, so a past order keeps
its record), `GET /api/admin/businesses/:id/addon-links`. `addons.business_types TEXT[]` (migration
0041, NULL/empty = every type) scopes an add-on to specific industries — the same "missing = on"
convention as `business_type_features` — so a Salon isn't shown "Table QR ordering."

**Platform settings — payment gateway and messaging config off `.env`** (migration 0042, 2026-09-29).
`/superadmin/settings`: Cashfree's App ID/Secret/environment, SMTP host/port/user/password/from, and the
SMS/WhatsApp provider (log/WhatsApp Cloud/Twilio) + its credentials are now saved in a `platform_settings`
table instead of only `.env` — a row there wins over the matching env var, with no restart needed, so
rotating a key or switching providers is a form, not a deploy. Secrets are encrypted at rest
(`modules/crypto.js`, domain-separated AES-256-GCM) and a GET always masks them (`••••••••`); saving with
a secret field left blank keeps the one already stored. Only Cashfree is actually wired up — Razorpay
shows in the provider dropdown as "not wired up yet" rather than pretending to work with no adapter
behind it. `GET/PUT /api/admin/settings/payment-gateway|email|messaging`.

**Real feature gating on two independent axes (migrations 0036/0037, 2026-09-28).** Separate from
`plans.features` (the marketing bullet list above, still cosmetic). `backend/src/modules/planFeatures.js`
is the catalog of 9 keys — `loyalty`, `messaging`, `reservations`, `purchases`, `expenses`, `ai`,
`advanced_reports`, `integrations`, `qr_ordering` — each with a label and description, and
`effectiveFeatureFlags(...sources)`, which combines any number of flag maps: a key is off if *any* source
explicitly says `false`; missing everywhere = on, so nothing configured here behaves any differently than
before. Two sources feed it: `plans.feature_flags` (did they pay for this — seeded to match what
Starter/Growth already advertised: Starter has none of the original 7, Growth has purchases/expenses/ai
but not loyalty/messaging/reservations/advanced_reports, Business/Enterprise/Trial have everything) and
`business_type_features` (does this even apply to a Salon, on this plan — one row per (business type,
plan) pair since migration 0044/2026-09-29, none seeded, so every (type, plan) has everything on until an
admin says otherwise; before that migration it was one row per type applying to every plan).

`requireAuth` joins both `plans` and `business_type_features` (on business type *and* the business's
current plan code) onto each membership; `withBusiness()`
combines them into `req.tenant.planFeatures` (the effective map, both axes — the property name predates
the business-type axis); `requirePlanFeature(key)` refuses with `402 FEATURE_NOT_IN_PLAN` when either
source turned a key off, checked server-side so it holds even if someone calls the API directly. Wired
onto the loyalty/messaging/reservations/purchases+suppliers/expenses/ai/profitability+leakage+forecast
routes the normal way; `integrations` and `qr_ordering` protect public, unauthenticated paths that have no
`req.tenant` (a delivery platform's webhook, a customer's QR menu), so those two check the business's
combined flags directly at the point the table/integration row is resolved. Multi-outlet has no separate
flag — `limits.outlets` already gates that. The frontend mirrors this only to keep the sidebar honest:
`useAuth().hasFeature(key)` hides the matching nav item, never the only guard.

Admin endpoints: `GET /api/admin/plan-features` (the shared catalog), `PATCH /api/admin/plans/:code
{ feature_flags }` and `PATCH /api/admin/business-type-features/:type/:plan { feature_flags }` (both
merge — a partial toggle never clobbers the other flags already set, and only known keys with boolean values are
accepted), and `PATCH /api/admin/businesses/:id/plan { plan_code, subscription_status, business_type }`
(each optional; validated against real `plans` rows / the subscription-status enum / `BUSINESS_TYPES`) to
assign a business's plan directly, separate from the Cashfree flow (which only ever moves a business to
ACTIVE on a real payment).

`CLOUD_KITCHEN` was added as a business type (2026-09-28, restaurant/café were already built and equal;
cloud kitchen is the next one), threaded through every place the restaurant-type family already existed
rather than left half-wired: signup validation, `lib/business.js`'s `RESTAURANT_TYPES` (so
Kitchen/Orders/Tables/Modifiers/Integrations nav items show), the incoming-delivery pop-up's eligibility
check, the dashboard's onboarding copy, and the admin business-type pickers. It starts with every feature
on, same as any newly added type, ready to be configured one feature at a time from the new dropdown.

Own token storage (`flowxp.admin.token`, separate from the business
session's `flowxp.token`) so an admin session and a business-owner session
can coexist in the same browser.

**Subscription payments (Cashfree, custom price per business).** There is
deliberately no fixed self-serve checkout: a super admin sets a price for one
business (`POST /api/admin/businesses/:id/payment-link`), and FlowXP asks
Cashfree for a hosted Payment Link (`backend/src/modules/payments/cashfree.js`)
and records it as a `subscription_orders` row (`PENDING`). The business owner
sees "Pay ₹X now" on `/app/settings/subscription` and pays on Cashfree's own
page — FlowXP never sees a card or UPI number. `POST /api/webhooks/cashfree`
verifies Cashfree's signature (HMAC-SHA256 over the exact raw request bytes,
which `server.js` captures via `express.json`'s `verify` callback) and, on a
`PAID` link, flips the business to `ACTIVE` and sets its next billing date.
The activation UPDATE only matches a row still `PENDING`, so a duplicate
webhook delivery (Cashfree retries anything but a 2xx) is naturally a no-op.
`CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` / `CASHFREE_ENV` in `.env`; blank
keys make link creation fail with a plain message instead of a broken call.

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

**Privacy Policy and Terms of Service (`site/Legal.jsx`, 2026-09-28).** The
owner's real, final legal text (ManagerXP Private Limited) — not
engineering-authored, and not to be rewritten here; only re-pasted whole when
the owner supplies a new version. Content is plain multi-line strings per
section (`"- item"` renders as a bullet list, `"**text**"` as a bold
sub-heading) rendered by one small parser, rather than ~95 hand-built JSX
blocks for the two documents' sections. Signup enforces acceptance: `POST
/auth/signup` requires `accepted_terms: true` in the body (400 without it,
checked server-side so a direct API call can't skip the frontend's checkbox)
and stores `users.terms_accepted_at` (migration 0035) as evidence. The signup
form's checkbox (linking to `/terms`/`/privacy` in a new tab) keeps the submit
button disabled until it's ticked.

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
| `/orders` | tenant | open a tab, add items, send KOT, update status, cancel, bill, rider assign + delivery status |
| `/tables` | tenant | dining table CRUD (each gets a `qr_token` on creation) |
| `/integrations` | tenant + public webhook | delivery platform connect/sync/simulate + the public webhook route |
| `/settlements` | tenant | aggregator statement import + reconciliation, "never settled" list |
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

**Kitchen stations, routing and timing (migration 0014).** `kitchen_stations` (Tandoor, Curry, Cold…); each dish has a `station_id` and `prep_minutes` (a business-wide default, `kitchen_default_prep_minutes`, covers dishes with none). When a line is ordered, its station and expected minutes are copied onto `order_items`, so re-routing a dish never moves tickets already in the kitchen. Lines now carry `sent_at` (set when the KOT is sent — or when a delivery order arrives), `ready_at`, `served_at` and `cancelled_at`, stamped by every path that changes status; `kot_tickets.priority` (NORMAL/RUSH) is chosen when sending, or set later with `POST /api/kitchen/orders/:id/rush`. *Live:* `GET /api/kitchen/tickets` returns every ticket grouped per order, with each line's minutes elapsed against its expected time (ok / warning at 75% / late), station chips with making/late counts, rush tickets first, lines cancelled in the last 15 minutes shown struck through ("don't make"), and an order billed before its food is out stays on screen for up to 6 hours. `POST /api/kitchen/advance` moves lines making → ready → served (or back), the only writer of those timestamps besides the order screen. *Setup:* `/api/kitchen/stations` and `GET/PUT /api/kitchen/routing` (bulk dish → station + minutes, plus the default), gated on the catalogue permission; the Kitchen screen has a Stations dialog. *Performance:* `GET /api/kitchen/performance` (permission `reports`) gives average, p90 and on-time % overall, by station, by dish (with change against the previous equal period) and by hour sent; preparation time is sent → ready. The Kitchen display filters by station and tab, timers tick locally between 8-second polls; the KITCHEN role can operate it but not change setup. A new `kitchen` notification category alerts owners/managers once per order that is 5+ minutes past its expected time (checked every 5 minutes). Not built: per-station KOT printing, sound alarms, and a per-device dark theme. **"To make" and "Ready
to serve" render as one screen, not two tabs** (2026-09-29) — a cook sees both at a glance instead of
switching between them; "Served" (a log, not something to act on) became a collapsible toggle, off by
default.

**Multi-outlet (migration 0015).** A business is the organisation; each *outlet* is a `branches` row with its own tables, stock, orders, invoices, payments, expenses, purchases and staff. Customers, suppliers, the menu, modifiers, recipes and kitchen stations are shared. A business with one outlet behaves exactly as before. *Who sees what:* `business_users.branch_id` NULL = a **group user** (owners and admins always; managers and stock managers may be) who can see every outlet; a value = **pinned** to that outlet (cashiers, waiters and kitchen always). `X-Branch-Id` is a claim, like `X-Business-Id`: `withBusiness()` checks it against the business's active outlets and sets `tenant.branchId` (where new records go — always a real outlet, defaulting to the main one), `tenant.scopeBranchId` (what reads are limited to; null = all, group users only), `viewAll`, `pinned`. A pinned user gets their outlet whatever they send; a foreign or unknown outlet is a 404. `requireOutlet` refuses writes in the "All outlets" view; `requireGroupUser` keeps group-wide pages (leakage, comparison, cost assumptions) away from pinned users. Every list and by-id read/write on orders, tabs, kitchen, invoices, payments, expenses, purchases, inventory, tables, reports, dashboard, profitability, forecast filters with `utils/scope.js branchFilter`, so another outlet's record is "not found" (a test walks the whole matrix). Operations on an existing record (bill an order, cancel an invoice, pay a bill) act on that record's own outlet, not the outlet being viewed. Orders from delivery-platform webhooks go to the main outlet; a customer's QR order goes to its table's outlet.
*Stock:* `branch_stock(branch_id, product_id, quantity)` is authoritative; `products.current_stock` stays as the business total. Every stock change goes through `modules/stock.js moveStock()` (billing, ingredient consumption, cancel, adjust, wastage, purchases, opening stock, transfers) so the two never drift — a test asserts Σ outlet stock = total after a mix of all of them. Oversell is checked against the selling outlet's stock; cancelling returns stock to the outlet that sold it. *Transfers:* `POST /api/inventory/transfer` (two `TRANSFER` ledger rows, refuses more than the sender holds; a pinned user may only send from their own outlet), `GET /api/inventory/transfers`. *Price and availability:* `product_branch_settings` (`price_paise` NULL = shared price, `is_available`), resolved in one place (`modules/menu.js outletSettingsFor`) by billing, order lines and the QR menu; `GET/PUT /api/products/:id/outlets`. Product lists return the outlet's price/stock/availability plus `shared_price` (what the edit form saves). *Outlets:* `GET/POST /api/outlets`, `PUT /api/outlets/:id` (name, code, city, state, GSTIN; close/reopen — not the main outlet, not with open orders or stock; plan limit `limits.outlets`: trial 3, starter/growth 1, business 5). An outlet's state drives GST place of supply for its sales. `GET /api/outlets/compare` runs the profitability engine per outlet (orders, net revenue, average order, food cost %, contribution, discount %, refunds, wastage, expenses, estimated net); rows add up to the business total. *Staff:* `GET/POST /api/staff`, `PUT /api/staff/:userId` (permission `settings`): adding a new email creates the user with an unknown password and emails a 3-day set-password link; only an owner adds or changes owners/admins; nobody edits themselves; the last owner can't be removed; owners/admins always cover every outlet and floor roles are always pinned; the plan's `users` limit is enforced. *Alerts:* outlet events (stock, late kitchen tickets) go to group users plus that outlet's people, are deduped per outlet and titled with its name; business-wide ones (summary, leakage, account) go to group users only. The stock scan and forecast run per outlet. UI: an outlet switcher in the top bar (with "All outlets" for group users; pages remount and reload on switch), Outlets (list + Compare), Staff, "Outlet prices" on Products, "Transfer stock" on Inventory. Demo seed: three outlets (MG Road, Indiranagar, Koramangala), pinned cashiers, per-outlet stock/tables/purchases/wastage, Indiranagar +10% on Chicken Biryani. Not built: per-outlet invoice numbering, kitchen stations or recipes, inter-outlet purchase orders, per-outlet delivery-platform integrations and leakage findings, per-outlet currency or timezone.

**Loyalty and coupons (migration 0016).** *Visit card:* the owner sets "visit number N earns a free item" (`loyalty_programs`: N from 2 to 50, the reward dish, how many free, and an optional minimum bill for a visit to count) at `/app/loyalty`. A customer is a mobile number (`modules/loyalty.js normalisePhone`: last ten digits, so "+91 98765-43210" and "098765 43210" are the same person). Progress is never a stored counter: `loyalty_events` holds one VISIT or REDEEM per customer per day (a partial unique index), voided when its invoice is cancelled, and `progressFor` derives the card from them. N−1 stamps make the Nth visit the free one; when that visit's bill contains the reward item, billing (`createInvoiceInTransaction`) takes it off as a line discount (up to the reward quantity, once per bill, tax computed on the reduced value), records a REDEEM and the card starts again; a bill without the item just stamps and the reward stays due. Several bills the same day are one visit, and a same-day stamp becomes the reward visit if the item turns up on a later bill. Cancelling the reward bill gives the reward back; cancelling a stamp bill removes the stamp. The customer row is locked while billing, so two tills can't hand out one reward twice. Business-wide: a visit at any outlet counts. *Where it shows:* the till (`MobileLookup`: type a mobile, find the customer or add them with a name, see their card; also shown when a customer is picked by name; `GET /api/loyalty/lookup?phone=`, `GET /api/loyalty/customers/:id`), the order screen (attach a customer to a tab with `PATCH /api/orders/:id/customer`), the invoice, and the customer's QR menu: the menu returns the program (`loyalty`), `POST /api/public/menu/:token/loyalty { phone }` shows a number's card (stamps only, no name; rate-limited harder than the menu), and placing an order with a mobile finds or creates the customer and links the order, so billing that table stamps their card automatically. Owner results: `GET /api/loyalty/summary` (members, visits and rewards given, value of rewards, most frequent customers with card status). *Coupons:* `coupons` (code unique per business ignoring case; PERCENT or FLAT; minimum bill; a cap for percent coupons; start and end dates; total uses; uses per customer, which needs the customer's mobile) and `coupon_redemptions`. `modules/coupons.js validateCoupon` is the one rule check used by both `POST /api/coupons/check` (a cashier's preview) and billing (which locks the coupon row, so its last use can't be taken twice); the discount comes off the bill after any hand-given discount and is added to the invoice's discount, with `coupon_code`, `coupon_discount_paise` and `loyalty_discount_paise` recorded so an invoice shows what its discount was made of. Cancelling an invoice frees the coupon use. Coupons and rewards are excluded from the revenue-leakage discount checks (they are policy, not a person's discretion; a test proves a hand-given discount of the same size is still noticed). Settings and coupons need the `settings` permission and a group-level user; the till endpoints need `billing`. Not built: points or spend-based earning, tiers, birthday rewards, SMS/WhatsApp messages to customers, per-outlet coupons, coupon codes on the QR menu, stacking rules between several coupons.

**Flow AI, the manager's assistant (migration 0017).** `/app/ai`: ask about the business in plain English ("how did we do last week?", "what should I order tomorrow?", "is anything running slow in the kitchen?") or press *Daily briefing*. The provider is Anthropic's Messages API, called with plain `fetch` from `modules/ai/provider.js` (model `AI_MODEL`, default `claude-sonnet-5`; key `ANTHROPIC_API_KEY`). With no key the page says it isn't set up and nothing is sent anywhere; the rest of the app is unaffected. The provider file is the only place that knows about Anthropic (`setProvider` swaps it, which is how the tests run without a network). *How it works:* `modules/ai/manager.js` runs a tool-use loop (at most six rounds): the model asks for a tool, the server runs it and returns the result, until it answers. It has no direct database access. `modules/ai/tools.js` defines twelve **read-only** tools that reuse the app's own engines: sales summary (with the previous equal period), daily trend, menu performance (best/worst by quantity, revenue, contribution or margin), stock forecast, demand forecast, kitchen timing, wastage, expenses, leakage findings, outlet comparison, loyalty and coupon counts, and customer feedback (average rating, split by star count, recent comments — see the Customer feedback & reviews paragraph below). *Safety:* a tool is offered to the model, and run, only if the asker's role holds the same permission as the matching screen (per-user overrides included; checked when listing and again when executing); group-wide tools (leakage, comparison, loyalty) are refused to someone pinned to one outlet; outlet-aware tools follow the outlet being viewed; only aggregates in rupees leave the server, never customer names or phone numbers (staff names appear only in leakage findings, as on that screen); a tool result is capped at 12,000 characters; the system prompt tells the model to state only tool-provided numbers, mark forecasts and costs as estimates, word staff findings as "worth a look", refuse to change anything or discuss other topics, and treat text inside results (dish names, notes) as data never as instructions. *Control and cost:* each answered question is one row in `ai_usage` (with token counts) and counts against the plan's monthly `limits.ai_queries` (trial 50, starter 100, growth 500, business 2,000; blank = unlimited) — a failed provider call costs nothing; there is a per-person rate limit on top; an owner can switch the feature off for the business (`businesses.ai_enabled`, `PUT /api/ai/settings`), after which nothing is sent. Every question and answer is stored (`ai_conversations`, `ai_messages`, with the tools used), private to the person who asked, and audited as `ai.asked`. Endpoints: `GET /api/ai/status`, `POST /api/ai/chat`, `POST /api/ai/briefing`, `GET /api/ai/conversations[/:id]` (permission `ai`: owner, admin, manager). *Not verified here:* the live call to Anthropic (no key was available; the request follows the documented Messages API with tool use, and the loop is tested against a scripted provider). Not built: streaming answers, charts in replies, actions (creating purchase orders, changing prices), a proactive daily push, a per-business monthly spend cap in money, and other providers.

**Customer feedback & reviews (migration 0045, 2026-09-29).** The honest, fully-buildable half of
"AI-based Google reviews" — real Google Business Profile read/post access needs Google's own API
approval, which isn't attempted here. Instead, the same public bill page a customer already opens
(`invoices.share_token`, no new link or message) carries a star rating + optional comment. 4-5 stars
is asked to also post it on Google — a plain share link the owner pastes once in Business Settings
(`businesses.google_review_link`) — while 1-3 stars stays private in `customer_feedback` for the
owner to see and act on; one row per invoice, resubmitting updates it. Gated by the `reviews` plan
feature (on by default, like everything else). `/app/reviews` (permission `settings`): the feedback
list, "Draft with Flow AI" (`modules/ai/reviewReply.js`, one `complete()` call — not the tool-use
loop, since there's nothing to look up for a single piece of feedback — same AI quota as the rest of
Flow AI), and "Send reply" (a new `REVIEW_REPLY` WhatsApp template, free text in one variable, same
pattern the `OFFER` campaign template already uses). Endpoints: `GET /api/reviews`, `POST
/api/reviews/:id/draft-reply`, `POST /api/reviews/:id/reply`; public: `POST
/api/public/bill/:token/feedback`. Not built: real Google review reading/posting (needs API
approval), a weekly auto-summary push (ask Flow AI's `feedback_summary` tool instead, on demand).

**Business setup wizard** (`/app/onboarding`, `Onboarding.jsx`): four skippable screens (where you
trade, logo, tax and money, invoice numbering) that save as they go, so closing the tab loses nothing.
*Flow AI onboarding chat* (2026-09-29): a collapsible "Let Flow AI fill this in for you" chat box on
every step but Logo lets the owner type naturally and have the fields filled in for them —
`modules/ai/onboarding.js`'s `converseOnboarding()` (one forced-optional tool,
`fill_onboarding_fields`; the system prompt says never to invent a value not actually said), `POST
/api/ai/onboarding-chat`, gated by the same `isConfigured`/`enabled`/plan-quota rules as the main
assistant but not stored as a conversation (the wizard keeps its own short-lived history client-side).
The box itself checks `/api/ai/status` first and renders nothing if there's no key or it's switched off
for the business. It only drafts into the form; the owner still reviews and saves. *Use current
location* (2026-09-29): a link next to the map preview uses the browser's Geolocation API plus
BigDataCloud's free, keyless reverse-geocode-client endpoint (no paid API key, same rule the map embed
itself follows) to fill address/city/state/PIN/country; a field that already has a value is never
overwritten with a blank one, and a failed lookup still centers the map on the found coordinates.

**Purchase orders from the forecast (migration 0018).** A purchase order now has a lifecycle: DRAFT → ORDERED (sent to the supplier) → RECEIVED, or CANCELLED. Recording a purchase directly (`POST /api/purchases`) still receives it on the spot, exactly as before. *Nothing moves stock or money until an order is received.* `POST /api/purchases/orders` creates a draft; `PUT /api/purchases/:id` edits an open one (supplier, lines, expected date, note); `POST /api/purchases/:id/send` needs a supplier, marks it ordered, sets the expected date from the slowest item's lead time if the owner didn't, and returns the message to send: it is emailed to the supplier if they have an email (the mailer logs it in development), and a WhatsApp link is built from their phone (`https://wa.me/91…?text=`), plus text to copy; `POST /api/purchases/:id/receive` takes what actually arrived and what was charged per line (`received_quantity`, `unit_cost`; a line not mentioned is taken as delivered in full, zero everywhere is refused): stock goes in at the order's own outlet whichever outlet the buyer is viewing (`moveStock`, a PURCHASE ledger row, the product's cost follows the price paid), the totals and GST are recomputed from what was received, an optional payment is recorded, short deliveries are reported back and kept on the line; `POST /api/purchases/:id/cancel` for open orders. Paying an order before it is received is refused (the receipt sets the amount due). Receipts lock products in id order, the same order billing uses, so a delivery and a sale can't deadlock. *From the forecast:* `POST /api/purchases/orders/from-forecast` (needs a real outlet, idempotent-keyed) runs the outlet's stock forecast and creates one DRAFT per supplier for everything it says to buy, at the latest price paid; anything already on an open order at that outlet counts towards the need, so pressing it twice doesn't order twice, and cancelling a draft frees the need again. Every order records its `source` (MANUAL or FORECAST) and is outlet-scoped like the rest of purchasing. A scan (with the stock alerts, per outlet) notifies once per day per order that an ORDERED purchase is past its expected date. UI: Purchases has Open orders (draft/ordered with expected date, overdue and forecast badges) and History; an order opens in a dialog to edit, Send to supplier (message, Copy, WhatsApp), Receive (quantities and prices, paid now) or Cancel; the Stock forecast has "Create draft orders for all" and per-supplier "Review as an order". Not built: back-orders for short deliveries (a short line is final), partial receipts across several deliveries, supplier price lists, and attaching the supplier's invoice.

**Printing and kitchen alerts (migration 0019).** Receipts and kitchen order tickets print from the browser, so any printer works: an 80 mm or 58 mm thermal receipt printer set up as an ordinary printer, a normal printer, or "Save as PDF"; there is no printer driver or hardware integration in FlowXP. `/app/print/receipt/:invoiceId` and `/app/print/kot/:kotId` are ordinary pages with print CSS (`@page` sets the roll width; the app's own menu and header are hidden), opened in a new tab with `?auto=1` so they print themselves once loaded. *Receipt:* business and outlet name, address and phone (an outlet's own GSTIN when it has one), bill number, date and time, table, who served, the guest, items with quantities, subtotal, CGST/SGST/IGST, discount, coupon and loyalty reward lines, total, payments, refunds, the balance due with a UPI QR for it (when the business has a UPI ID), the guest's loyalty-card line, and a footer; a cancelled bill is stamped CANCELLED. `GET /api/invoices/:id` now returns what it needs (outlet block, cashier, table, order number, loyalty message). *Kitchen slip:* `GET /api/kitchen/kots/:id` lays a ticket out **one slip per station** (in station order, unrouted items last, cancelled lines left off), so the tandoor gets only its own items; each slip shows RUSH, the KOT number and time, the table in large type, item quantities large, modifiers and kitchen notes boxed, and the order note. A picker prints all slips or one station's. *Settings:* business-wide receipt settings (`businesses.receipt_settings`: paper width 58/80 mm, footer, show GSTIN, show UPI QR, show loyalty line) are validated key by key, merged so saving one option never resets the others, and edited in Business settings (owner). Per-device preferences (kept in that browser, so the counter and the kitchen can differ): print the receipt automatically after billing, print the KOT automatically when an order is sent, and the kitchen sound. *Where it appears:* Print receipt on the invoice and on the sale-complete screen; a Print KOT checkbox beside Send to kitchen and Reprint buttons for each ticket on the order; *Kitchen display:* a sound toggle, with one beep for a new order and a different one when an item goes past its time (browsers only allow audio after a click, so turning the bell on enables it). Not built: silent printing without the browser's print dialog (needs the browser's kiosk-printing mode or a small local print service), cash-drawer kick, auto-printing of tickets that arrive from a customer's QR order or a delivery platform (the kitchen screen beeps for them instead), and logos on receipts.

**Activity log and per-person permissions (migration 0020).** *Activity log:* `/app/activity` (`GET /api/audit`, permission `settings`, so owners and admins) shows who did what, where and when as plain sentences ("Cancelled Invoice INV-0042", "Received purchase order PO-0007 worth ₹500 (short: Chicken)", "Changed the permissions of Ravi (refunds: allowed)"), built by `modules/auditText.js` from the existing `audit_log` rows; the readable names of the invoice, order, purchase order, product, customer, coupon or person involved are looked up in one business-scoped query per kind, and an action with no template still shows, humanised. Rows are grouped into seven areas for filtering (sales, stock, menu, money, customers, team, oversight). Filters: person, area, outlet, date range (default the last week, at most a year) and free-text search over the action and its details; paged with a cursor on `audit_id`, so nothing repeats while new rows arrive. Every row is the business's own; a user pinned to one outlet sees only that outlet (`audit_log.branch_id` is now recorded from the outlet the person was working in; business-level actions like settings and staff have none and belong to group users). `?format=csv` exports up to 5,000 rows and needs the `export` permission; cells that start with = + - @ are defused so a name can't run as a spreadsheet formula. Audit writes remain fire-and-forget by design. *Per-person permissions:* a role gives a default set; the owner can allow or deny any of 15 permissions for one person (`GET/PUT /api/staff/:userId/permissions`, owner only: a manager who could edit permissions could grant themselves anything; not your own; owners always have everything). Each permission has a plain-language name and description (`modules/permissions.js`). Overrides are stored in `business_users.permissions` as { permission: true | false }; a value equal to the role's default is dropped, so nothing stale is kept, and changing someone's role clears their overrides. They take effect on the person's next request (memberships are read per request) and each change is audited as `staff.permissions_updated` with what changed. UI: a Permissions dialog on the Staff page (per row: Role default / Allow / Deny, with the effective result and a count of customised people). Not built: login and failed-login history, per-outlet permission overrides, time-limited grants, the sidebar hiding items a person's overrides don't allow (the API enforces them; the menu still follows the role), and audit-log retention or archiving.

**Menu import from a photo (no migration).** Products, then *Import menu from photo* (also a banner on an empty menu and the setup checklist's first step for restaurants): take a photo of each menu page with the camera (`capture="environment"` on phones) or choose existing pictures (up to 5). The browser shrinks each to 1,800 px JPEG before upload. `POST /api/menu-import/scan` (permission `products`; multipart field `images`; JPEG/PNG/WebP, 8 MB each, held in memory and never stored) sends the photos to the AI service (`modules/ai/menuScan.js`), which must answer by calling one tool, `record_menu`, so the reply is structured data rather than prose: name, price in rupees (null when unreadable), section heading as category, description, veg marker, and "unsure". Sizes with separate prices become separate items ("Chicken Biryani (Half)"). The result is only a **draft**: `normaliseItems` trims names, parses prices (₹ and "/-" tolerated), rejects impossible ones, drops repeats across pages and caps at 300; each item is flagged when a dish of that name is already on the menu (ignoring case and spacing) with its current price. The prompt tells the model to transcribe, not invent, and that text on the menu is content, never instructions. A scan counts as one AI request against the plan's monthly allowance (a failed one costs nothing), respects the business's AI on/off switch, is rate-limited per person, and needs the AI key (without one the screen says so and manual entry still works). *Review:* an editable table (name, price, category with suggestions, include tick), amber rows for items the model was unsure of, red for a missing price, "Already on your menu at ₹220" badges, a GST % for the batch (5% suggested when GST is on), a choice for duplicates (leave them, or update their price), an "Add a missing item" row and the model's own notes. *Confirm:* `POST /api/menu-import/confirm` (idempotent-keyed) validates every row first (a bad row rejects the whole batch and names it, so nothing is half-saved), then in one transaction finds-or-creates categories (case-insensitive) and creates dishes (kind DISH, not stock-tracked, the chosen GST) or, for existing names, skips or updates the price; the same dish twice in one batch is added once; another business's menu is never consulted or touched. It is audited as `menu.imported` with the counts. Not built: reading item photos or logos, importing from a PDF, CSV or a delivery platform's menu, per-item GST rates, and matching a scanned item to an existing one that is spelled differently.

**Credit notes, round-off and the GST register (migration 0021).** *Credit notes:* the formal document that reduces an issued invoice, for returns, wrong items and corrections; a refund on its own only moves money, a credit note changes revenue and GST. `POST /api/invoices/:id/credit-notes { items: [{ item_id, quantity }], reason, restock?, refund?: { method } }` (permission `refunds`, idempotent-keyed) in one transaction: takes the chosen quantities off the chosen lines and reverses the GST on them exactly (the final piece of a line takes the exact remainder, so a line credited in several notes never drifts by a paisa; CGST/SGST or IGST follow how the invoice was taxed); takes the note's share of any invoice-level discount or coupon off the amount (the note that completes the invoice takes the exact remainder); numbers it (`CN-0001`, per business); and *settles* it: first against what the customer still owes on the invoice, then, only if asked, as money paid back (a normal refund row linked to the note, capped at what was paid), and anything left simply stays a credit on the record. Optionally returns stock-tracked items to the invoice's own outlet (`moveStock` and a RETURN ledger row; dishes made to order are never restocked). Rules: a reason is required; only ISSUED invoices; nothing can be credited beyond what was sold (`only 3 left to credit`); a line can't appear twice; an invoice with credit notes can't be cancelled (credit the rest instead); other outlets and businesses get 404. `GET /api/invoices/:id/credit-notes/options` shows what is left to credit per line; `GET /api/credit-notes[/:id]` lists and prints. UI: **Issue credit note** on the invoice (choose quantities, reason, refund or not, restock), a Credit notes list from Invoices, credit notes and Round off shown on the invoice, and a printable credit note (`/app/print/credit-note/:id`) with the reversed CGST/SGST/IGST and a signature line. *Effect on the books:* the GST report and HSN table are **net of credit notes issued in the period** (with the count and tax reversed shown); profitability reduces revenue by the credit note once, even when the note also refunded cash (`invoices.credited_paise`, and `cn_refunded_paise` so the refund isn't counted twice); credit-note refunds are excluded from the leakage refund signal (they are formal, numbered and audited: `credit_note.issued`). *Round-off:* a business switch (Business settings, Billing) rounds each new bill to the nearest rupee; the difference is stored on the invoice (`round_off_paise`), shown as "Round off" on the invoice and receipt, never taxed, and "paid in full" pays the rounded total. *GST register:* `GET /api/reports/gst/register?from=&to=[&format=csv]` (permission `gst`) gives one row per document per tax rate (invoices, and credit notes as negative rows) with the customer's GSTIN where there is one (B2B) or none (B2C), the state, taxable value, CGST/SGST/IGST and total, plus a TOTAL line that equals the GST report for the same dates (CSV cells starting with = + @ are defused). It is the working register a GSTR-1 is prepared from; it is not itself the filing (no GSTR JSON, e-invoicing or e-way bills). Not built: credit notes for purchases (debit notes to suppliers), round-off shown in profit, credit notes on invoices from before this update that used a bill-level discount are shared out proportionally like any other.

**Deployment readiness and cloud photo storage (no migration).** `DEPLOY.md` is the step-by-step guide. *Photo storage:* `modules/storage.js` puts uploaded files on this server's disk (`STORAGE_DRIVER=local`) or in any S3-compatible bucket (`s3`: AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO), so photos survive redeploys and moving servers. The rest of the app only calls `putFile`/`removeFile` and stores the URL it gets back; old `/uploads/...` URLs keep working after a switch. S3 requests are signed with AWS Signature V4 written with `node:crypto` (no SDK); the signer is verified against AWS's own published GET and PUT examples, and both drivers against a local stand-in bucket. Files are namespaced by business (`products/<business>/<product>-<time>.<ext>`), a replaced photo is deleted (best effort), a failed save returns a clear error and leaves the product's current photo alone, and deleting never leaves the uploads folder. Settings: `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`. *Production hardening:* in production the API refuses to start with a JWT secret under 32 characters, an `APP_ORIGIN` that is not https, or incomplete S3 settings, and says which; allowed browser origins come from `APP_ORIGIN` plus `CORS_ORIGINS` (no hard-coded domain); `GET /health` (process up) and `GET /ready` (database answers, for load balancers) are separate; every request gets an id returned as `X-Request-Id` and one JSON log line (no bodies, tokens or query strings); an unhandled crash is logged and the process exits so the platform restarts it clean; uploads are served from disk only when the driver is local. *Packaging:* `backend/Dockerfile` and `frontend/Dockerfile` (nginx serving the build and proxying `/api`), `docker-compose.yml` (Postgres, API, web, named volumes, health checks), a root `.env.example`, a GitHub Actions workflow (backend tests against Postgres, frontend build) and `backend/scripts/backup.sh` (compressed `pg_dump`, keeps the newest N, with restore instructions). **Not run:** the Dockerfiles, compose file and CI workflow were written without Docker available, so the first `docker compose up` may need small fixes. Not built: horizontal scaling (the worker runs once per API server; `WORKER_ENABLED=false` on all but one), Redis, off-server backup upload, an error tracker.

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
| `CASHFREE_APP_ID` / `CASHFREE_SECRET_KEY` | no | Cashfree Payment Links (subscription payments); unset means link creation fails with a clear message |
| `CASHFREE_ENV` | no (`SANDBOX`) | `SANDBOX` or `PRODUCTION` — which Cashfree API host to call |

The SMTP, messaging (`MESSAGING_PROVIDER`/`WHATSAPP_*`/`TWILIO_*`) and Cashfree variables above are only
the fallback: `/superadmin/settings` saves the same config to a `platform_settings` DB row, which wins
over the `.env` value with no restart — see section 4's "Platform settings" entry.

Frontend has no `.env` of its own — `vite.config.js` proxies `/api` and
`/uploads` to the backend in development, and the same relative paths work
in production behind one domain.

---

**Reservations and the waitlist (migration 0022).** *Reservations* (per outlet): `POST /api/reservations { guest_name, party_size, reserved_at, duration_min?=90, phone?, table_id?, notes? }` (permission `billing`, needs a real outlet). A table can carry only one live (BOOKED/SEATED) reservation at a time: slots are `reserved_at .. + duration`, overlap is refused with 409 (back-to-back is fine), a party larger than the table's seats is refused, and closed tables and other outlets' or businesses' tables are 404. `GET /api/reservations?date=` lists a day (in the business timezone); `GET /api/reservations/availability?reserved_at&party_size&duration_min` lists the tables that fit and are free for a slot; `PATCH /:id` edits or moves a booking while it is still BOOKED (a booking never clashes with itself); `POST /:id/status` moves BOOKED to CANCELLED or NO_SHOW and SEATED to COMPLETED (both free the table for other bookings); `POST /:id/seat { table_id? }` marks the guests arrived and refuses a table with a running order or another party's booking. A mobile number links the booking to the customer (so their loyalty card is one tap away). Seating does not create an order: the floor opens one on the table as usual, so occupancy stays derived from orders. The Tables screen shows a booking due within the hour on the table. *Waitlist* (walk-ins): `POST /api/waitlist` adds a party in arrival order with a quoted wait (the host's number, or 10 minutes per party already waiting: a plain estimate, not learned from turn times); `POST /:id/notify` marks them called, `/:id/seat { table_id, force? }` seats them (a table booked in the next hour needs `force`), `/:id/leave` removes them; `GET /api/waitlist` shows the queue with minutes waited. All of it is scoped to the active outlet (a pinned user can't reach another outlet's bookings by id) and audited. UI: **Reservations** page (day view with booked count and expected guests, book/edit with the free tables offered for that slot, seat, no-show, cancel; Waitlist tab refreshing every 30 seconds). Not built: online booking by customers, SMS/WhatsApp confirmations and reminders (arrive with the messaging feature), deposits, and no-show fees.

**Cloud Kitchen has no Tables or Reservations (2026-09-29).** It cooks for delivery/takeaway only, so
those two nav items are hidden for it specifically (`AppShell.jsx`'s `DINE_IN_TYPES`, everything in
`RESTAURANT_TYPES` except `CLOUD_KITCHEN`); Kitchen, Orders, Modifiers and Integrations are unchanged.
Reservations also has a real backend refusal for it (`business_type_features`, `reservations: false`
for `CLOUD_KITCHEN` on every plan) since that feature already had a per-business-type gate; Tables has
no such gate for any business type, so it's nav-only, the same as every other non-dine-in type.
**QR ordering is off for it too** (same `reservations: false`-style switch, `qr_ordering: false` for
`CLOUD_KITCHEN`) — no separate nav item needed since it's only ever reached through Tables' "Print QR
cards" button, already hidden. Fixing this surfaced a real, pre-existing gap: the public QR menu's own
gate (`publicOrdering.controller.js`) predated the business-type axis (migration 0044) and only ever
checked `plans.feature_flags` directly, so a business-type-level (or per-business override) switch for
`qr_ordering` was silently ignored there. Fixed to build the full `effectiveFeatureFlags()` the same
way `publicBill.controller.js` already did for reviews — plan flags, business-type flags for that
plan, and per-business overrides, all three.

**Multi-brand (migration 0046, 2026-09-29).** One kitchen running several virtual brands ("Brand A —
Biryani", "Brand B — Burgers") — the one genuinely new piece from a 40-section "Cloud Kitchen module"
spec audited the same day; almost everything else in it (KDS, recipes, **packaging-as-a-recipe-
ingredient** — a `PACKAGING`-kind product can already be a recipe "ingredient" with a quantity, no new
code needed, it deducts on every sale like a real ingredient — inventory, purchasing, the delivery-
integration mock adapters, GST, loyalty, RBAC, AI, reports) already existed and needed no change. Real
aggregator API integration and settlement reconciliation are out of scope — they need partner API
access FlowXP doesn't have. `brands` (business-wide, like categories — a brand sold from two outlets is
one row, not two) + nullable `products.brand_id` / `orders.brand_id`; a business with no brands defined
behaves exactly as before. Gated by the new `multi_brand` plan feature (on by default). `GET/POST
/api/brands`, `PATCH /api/brands/:id` (deactivate, not delete); `PATCH /api/orders/:id/brand` sets or
clears an order's brand after the fact, mirroring the existing waiter hand-over endpoint. UI: a "Brand"
field on the product form, created inline exactly like Category (no separate management page); a
"Brand" picker on the order detail header (every order type, not just dine-in); the brand name shows on
the Orders list, the order header, and the Kitchen ticket.

**Combos and waiters (migration 0023).** *Combos:* a combo is an ordinary menu item (its own price, tax rate and kitchen station) made of other items. `PUT /api/products/:id/combo { components: [{ product_id, quantity }] }` (permission `products`) makes an item a combo of two to twenty distinct, active items of the same business; `GET` shows the parts with the separate value and the customer's saving; `DELETE` turns it back into a plain item. A combo cannot contain a combo, cannot contain itself, and an item that is inside a combo cannot itself become one. It bills as **one line** at the combo's price and tax rate, but selling it uses up its parts: a stocked part (a bottled drink) comes off its own stock and a dish part consumes its recipe, so stock, ingredient use and the recorded unit cost (`unit_cost_paise`, which profitability reads) all come from the parts (`modules/combos.js`, one place, used by billing). It is refused when a part is archived or switched off at that outlet (on orders and bills alike) or a stocked part has run out at the outlet (`Not enough Coke for Meal Combo`). The kitchen display, the ticket and the printed KOT list what is inside (`1 × Burger, 1 × Fries`). Combo prices are per outlet like any item (Outlet prices). *Waiters:* a table can have a regular waiter (`PATCH /api/tables/:id { waiter_user_id }`; the choice is limited to active team members who work the floor, i.e. not kitchen or stock-only roles, and belong to that outlet or to none; `GET /api/tables/waiters` lists them). An order records who serves it: the one picked at `POST /api/orders { waiter_user_id }`, otherwise the table's regular waiter, otherwise the waiter who opened it; customer QR orders take the table's waiter; `PATCH /api/orders/:id/waiter` hands an open order to someone else; `GET /api/orders?waiter=me` (or a user id) filters. `GET /api/reports/waiters?from&to` (permission `reports`, outlet-scoped) reports billed orders, bills, average bill, discounts and sales (net of credit notes) per waiter, with orders no one served under "Not assigned". UI: Combo editor on Products (live "bought separately" and saving), waiter picker and "my tables" filter on Tables, waiter on the order card and a Waiter picker inside the order, combo contents on Kitchen and KOT, Waiters tab in Reports. Not built: tips and service-charge splits per waiter, captain-level approvals (discounts or voids needing a captain), combos with choices (pick one of three sides), and demo history carrying waiters (old orders show as Not assigned).

**Customer messaging: WhatsApp and SMS (migration 0024).** *Setup:* the server picks a provider with `MESSAGING_PROVIDER`: `log` (default; nothing leaves the server and every message is recorded as SKIPPED, honestly), `whatsapp_cloud` (Meta WhatsApp Cloud API: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`) or `twilio` (SMS, and WhatsApp when `TWILIO_WHATSAPP_FROM` is set); production start refuses half-filled settings. Each business then chooses its channel (Off / WhatsApp / SMS) and which automatic messages to send (`PUT /api/messaging/settings`, permission `settings`). *What is sent* (`modules/messaging`): the **bill** after a sale to a customer with a mobile number (a link to a public page `/bill/<token>`, the token being 128 random bits stored on the invoice and reused, showing that one bill only, with a UPI pay-now link while money is owed); a **booking confirmation and cancellation**; **waitlist** joined and **table ready**; a **loyalty reminder** when a customer's next visit earns the free item (at most once a week); and **offers** (campaigns). `POST /api/messaging/send-bill` sends a bill by hand to the customer or a number typed at the till. *Templates:* WhatsApp lets a business start a conversation only with approved templates, so each kind has a fixed template name and variable order; `GET /api/messaging/templates` prints the exact text to create once in Meta Business Manager (`flowxp_bill`, `flowxp_booking`, `flowxp_booking_cancelled`, `flowxp_waitlist_added`, `flowxp_table_ready`, `flowxp_loyalty_next`, `flowxp_offer`); SMS and the log use the same wording as plain text. *Rules:* offers and reminders are promotional and skip customers with `marketing_opt_out` (`POST /api/customers/:id/marketing`), and every one ends with "Reply STOP" (the reply is not read automatically yet: the owner sets the flag); bills and booking messages are service messages and are sent regardless. A campaign (`POST /api/messaging/campaigns { segment: ALL | LAPSED | NEAR_REWARD, days?, text }`, preview first) goes to active customers with a valid mobile, is capped at 1000 recipients and one per hour per business, refuses links unless confirmed, and reports progress (`GET /api/messaging/campaigns/:batch`). Every message is stored (`messages`: outcome, provider id, error) and shown in the **Message log**; a FAILED or SKIPPED one can be retried. A message problem never fails a sale or booking (the hooks run after the transaction and swallow errors); the `messages` table deliberately has no foreign key to customers, because one would let a message written right after a bill deadlock with the billing transaction. Numbers without a country code are treated as Indian (`MESSAGING_COUNTRY_CODE`, default 91). UI: **Messaging** page (settings and the Meta templates, send an offer with a live audience count, message log with retry), **Send bill** on the invoice, and the public bill page. Not built: reading inbound replies (STOP, questions), delivery and read receipts from the provider, retry queue for messages that fail (retry is manual), per-outlet sender numbers, scheduling, images and PDFs.

**Loyalty points and tiers (migration 0025).** Runs alongside the visit card (either, both or neither can be on). *Earning:* every bill to a known customer earns `earn_per_100` points per Rs 100 actually paid for (after discounts, coupons, points spent and round-off), times the customer's tier multiplier, rounded down. *Spending:* a customer's points are a discount on a later bill (`redeem_points` on `POST /api/invoices` and `POST /api/orders/:id/bill`); each point is worth `point_value`, at least `min_redeem_points` must be used, no more than the balance, and no more than `max_redeem_pct` of what is left to pay (the error says the most allowed). Points are an invoice-level discount, treated for tax like a coupon. *Tiers:* up to six named tiers, each with a lifetime-points threshold and an earning multiplier (the first must start at 0); a customer's tier is the highest reached by points they have **earned** (a manual gift does not count, spending never demotes; credit-note reversals reduce it). *The ledger* (`points_ledger`) is the truth: EARN, REDEEM, ADJUST and REVERSAL rows, balance = sum of live rows. Cancelling a bill voids its rows (spent points come back, earned ones go); a credit note takes back the matching share of the points that bill earned (`REVERSAL`, never below a zero balance). Billing locks the customer's row so two tills can't spend the same points at once (tested). `PUT /api/loyalty/points-program` (permission `settings`, group user) sets the scheme and tiers; `GET /api/loyalty/customers/:id/points` gives balance, tier, next tier and recent history; the till lookups (`/loyalty/lookup`, `/loyalty/customers/:id`) now return `points` too; `POST /api/loyalty/customers/:id/points/adjust { points, note }` gives or takes points with a mandatory reason (balance can't go negative); `GET /api/loyalty/points-summary` shows customers holding points, points outstanding and their rupee liability, 30-day earned/spent and the top holders. Invoices carry `points_earned`, `points_redeemed` and `points_discount`; the POS and the order bill show the customer's points with a "use max" button, the receipt and invoice show points used. UI: **Points & tiers** tab on Loyalty. Not built: points that expire, points for signup/birthday/referrals, points on the customer QR menu, telling customers their balance by message, and per-outlet schemes (points are business-wide, like the visit card).

**Silent printing, cash drawer and receipt logo (no migration).** *Logo:* `POST /api/businesses/current/logo` (owner; PNG/JPEG/WebP up to 2 MB, stored through the same storage layer as product photos, replacing and deleting the old file) and `DELETE`; the URL lives in `receipt_settings.logo_url` with a `show_logo` switch, and prints (in greyscale) at the top of browser receipts. *Silent printing:* browsers cannot print without a dialog or open a drawer, so a small **print agent** (`print-agent/agent.js`, no dependencies, Node 18+) runs on the till computer, listens on `127.0.0.1` only, requires a bearer token, and honours an allowed-origins list (including Chrome's private-network preflight). It forwards raw ESC/POS bytes to `tcp://host:9100` network printers, `share://PC/Name` (Windows shared USB printers), `lp://Name` (CUPS) or `file:///dev/...`; names are validated and nothing is run through a shell. The server builds the bytes (`modules/escpos.js`) from exactly the data the screen shows: `GET /api/invoices/:id/escpos?cols=&drawer=1` (a receipt: shop, lines, tax, discounts, points, payments, balance with the printer's own UPI QR, loyalty line, footer, cut), `GET /api/kitchen/kots/:id/escpos` (one job per station, with combos, options and notes), `GET /api/print/test` and `GET /api/print/drawer`. Width follows the paper setting (58 mm = 32 columns, 80 mm = 48); text is plain ASCII (accents stripped, the rupee sign written `Rs`) because printer code pages differ; double-width lines are laid out in half the columns so they don't wrap. A logo is not sent to thermal printers (that needs bitmap conversion): they print the business name large. *Cash drawer:* the standard ESC p pulse, appended to the receipt job when a cash payment is taken (or on its own for a cash payment recorded later on an invoice). *In the app* (Business settings, per browser, since the counter and the kitchen differ): printing mode (browser dialog or silent), agent address and token, receipt printer and optional kitchen printer targets, "open the drawer on cash", and **Print a test page / Test the cash drawer** buttons. Receipts and kitchen tickets (automatic or by button) go through the agent when it is set up and **fall back to the browser print view with a visible error if it fails**, so a receipt is never lost to a cable. Setup steps, printer target examples and troubleshooting are in `print-agent/README.md`. Not built: logo bitmaps on thermal paper, per-station printer targets (all kitchen slips go to one printer; the API already returns them per station), reprint queues, printer paper/status feedback, Bluetooth printers, and a packaged installer for the agent.

**The phone app and offline sales (no migration).** FlowXP is a Progressive Web App: it installs on a phone, tablet or computer from the browser and opens full screen like an app, with no app-store step. *Install:* the manifest (`public/manifest.webmanifest`: name, standalone display, real square icons made from the logo, a maskable icon, shortcuts to New sale / Orders / Kitchen) and an **Install app** button in the header (Chrome/Android/desktop show the real prompt; on an iPhone it shows the Safari "Add to Home Screen" steps). Installing needs the site on **https** (or localhost). *The service worker* (`public/sw.js`, registered only in production builds): the app shell is fetched network-first and falls back to the last copy so the app opens with no connection; every built file of the release is kept on install (`precache.json`, written by the build; the landing page's heavy 3D chunk is left out) and old releases' files are dropped when a new worker takes over; photos and icons are cache-first; a short list of API reads (menu products, categories, options, tables, the business, the signed-in user, outlets, the loyalty program) is network-first with a 4-second timeout and falls back to the last answer, kept **per business and outlet**; live data (orders, kitchen, stock, reports, anything public) is never served stale and writes are never touched. Signing out or a dead session wipes the cached API answers. nginx serves `sw.js` and the manifest uncached so updates reach phones. *Offline sales* (`lib/offlineQueue.js`, `lib/offline.js`): when a POS sale cannot reach the server it is kept on the device (localStorage, up to 100) with the outlet it was rung up at and the **same Idempotency-Key**, the till shows "Saved on this device", and the sale is sent again when the browser comes back online, every 20 seconds while anything waits, and on app start; in order, one at a time. Nothing is decided offline: the server numbers the invoice and checks stock, coupons and points when the sale arrives, and because of the key a sale that had in fact reached the server before the connection dropped returns the same invoice instead of billing twice. A no-connection, server error (5xx/429) or signed-out answer pauses the run and keeps everything; a definite refusal (out of stock, expired coupon) parks that sale as **Refused** with the server's reason while the rest carry on. A banner shows "You're offline" and the count waiting, with **Review** (try again, discard, sync now). Network failures now say "You're offline, or the server can't be reached" instead of a generic error. *Phone layout:* the header fits a phone (business name hidden, sign-out moved into the menu), the notification list no longer runs off the screen, and screens respect the iPhone notch and home bar. *Not offline:* orders/tables/kitchen, payments on existing invoices, refunds, customer lookup, reports (they need live data; they show the offline message), and receipts for an offline sale (it has no invoice number until it syncs). Not built: a store-listed native app (the same code can be wrapped with Capacitor when you want Play Store / App Store listings), push notifications, and background sync while the app is closed (sales sync when it is next opened).

**Per-outlet invoice numbers, kitchen stations and recipes (migration 0026).** *Invoice series:* an outlet can have its own prefix and counter (`PUT /api/outlets/:id { invoice_prefix, invoice_next_number }`, so `IND-0001`, `MGR-0001`); an outlet without one keeps using the business series, so nothing changes for single-outlet businesses. The number is claimed under a lock on the outlet's own row, so bills at one outlet never share or skip a number even at the same instant, and a table bill uses the series of the outlet the order belongs to. Guards: prefixes are letters/digits/dashes up to 12, unique within a business (another business may reuse one), never the business-wide prefix, and a new prefix starts **after the highest number already issued under it** (a start lower than that is refused, so a number can never repeat); clearing the prefix returns the outlet to the business series. Credit notes stay on one business-wide series. *Kitchen stations:* a station belongs to one outlet (`outlet_only: true`, from an outlet view) or to all outlets; the same name can exist at several outlets but not twice at one. A dish is routed to a station **by name**: at an outlet it goes to that station if it applies there, else to the outlet's own station of the same name, else to the general kitchen, so a shared menu routed to "Grill" is cooked at whichever outlet's Grill the order belongs to (`modules/stations.js`, also used by QR orders). The kitchen screen and the station list show only the stations of the outlet being viewed (all of them in the All-outlets view, tagged with their outlet); someone at one outlet cannot change another outlet's station. *Recipes:* a dish has a default recipe and an outlet may have its own that **replaces** it completely (`PUT /api/products/:id/recipe { branch_id, ingredients }`, `GET ...?branch_id=`, `DELETE ...?branch_id=` to go back to the default); billing consumes ingredients by the recipe of the outlet where the sale happens (and combos' component recipes likewise), so stock and cost follow the outlet's own portions; editing the default never touches an outlet's own recipe; someone pinned to one outlet can only edit their own outlet's recipe. UI: invoice prefix and next number in the outlet form (with the series shown in the list), an "only for this outlet" option when adding a station, and a "Recipe for" outlet picker in the recipe editor. Not built: per-outlet prep times or routing overrides that differ from the name rule, per-outlet ingredient prices (prices stay business-wide), a per-outlet credit-note series, and copying one outlet's stations or recipes to another in one step.

**Buying, completed: supplier price lists, back-orders, debit notes and stock requests (migration 0027).** *Supplier price lists* (`supplier_prices`; `GET/PUT /api/suppliers/:id/prices`, `DELETE .../:productId`, `GET /api/products/:id/supplier-prices` ranks suppliers cheapest first): what each supplier charges, with a minimum order and lead time. A purchase-order line with no price takes the supplier's listed price, else the product's last purchase price (an explicit price always wins), and when a delivery is received above the list the response carries `price_alerts` (item, listed, charged, extra per unit) and the screen suggests a debit note. *Back-orders:* an order can be received in several deliveries. `POST /api/purchases/:id/receive { items?, payment?, backorder? }` now means "this delivery": a line not mentioned is taken as delivered in full (whatever is still owed); with `backorder: true` and something still owed the order becomes **PARTIAL** (part received) and `back_order` lists what is owed, otherwise it closes as before and anything short is written off (`short_delivered`). Each delivery adds to stock and is valued at its own price (line value accumulates), the order total is what has arrived so far, and payments can be made against a part-received order; a PARTIAL order can't be edited or cancelled (it says why) but can be received again, or closed with `POST /api/purchases/:id/close-short`; `GET /api/purchases/backorders` lists them with what is owed; overdue alerts and the forecast's "already on order" both count the outstanding quantity. *Debit notes* (`debit_notes`, `debit_note_items`, `DN-0001`, per business): `POST /api/purchases/:id/debit-notes { kind: RETURN | PRICE, reason, items: [{ item_id, quantity, unit_cost? }] }` (permission `purchases`, idempotent-keyed) on an order that has arrived. **RETURN** sends goods back at the price paid (no more than was received minus what already went back; the outlet's stock is reduced with a `PURCHASE_RETURN` ledger row and refused, with nothing changed, when the stock is no longer there); **PRICE** corrects an overcharge (units affected, and the extra per unit, at most the price paid). Tax is reversed at each line's own rate. It lowers what you owe: first the unpaid balance on that order, and anything beyond it (already paid) is recorded as a **credit from the supplier** (`credit_paise`); `purchase_orders.debited_paise` makes purchase reports and supplier totals net of debit notes. `GET /api/purchases/:id/debit-notes/options` shows what can still be returned per line; `GET /api/debit-notes[/:id]` lists and shows notes. A debit note is final (raise another to correct). *Stock requests between outlets* (`transfer_requests`): `POST /api/transfer-requests { from_branch_id, items, notes? }` is made by the outlet being worked in and asks another to send stock; the asked outlet sends it with `POST /:id/fulfil { items: [{ item_id, quantity }] }`, in full or in parts, through the ordinary stock transfer (now one shared module, `modules/transfers.js`, also used by direct transfers; all-or-nothing per send, refusing more than was asked or than the outlet holds), or turns it down with a reason (`/reject`, only before anything is sent); the asking outlet can call off what has not been sent (`/cancel`: CANCELLED, or CLOSED if part was sent). Both outlets see a request, a third outlet does not, a person pinned to an outlet can only act for their own side, and the asked outlet is notified. Statuses: PENDING, PARTIAL, FULFILLED, REJECTED, CANCELLED, CLOSED. UI: **Price list** on each supplier, list-price hint and auto-fill on purchase-order lines, a receive screen that defaults to what is still owed with a "the rest is still coming" option, a still-owed panel with **Receive the rest** and **Close as short**, **Return goods / price correction** on any arrived order, a Debit notes page, and a **Stock requests** page (asked of this outlet / asked by this outlet, send in full or part, turn down, call off), shown only to businesses with more than one outlet. Not built: stock in transit (a transfer moves stock at once, there is no shipped-but-not-received state), a refund-received record for a supplier credit (the credit is shown on the note and reduces nothing else), an input-tax-credit report net of debit notes, debit-note printing, and central purchasing on behalf of several outlets in one order.

**GST filing: GSTR-1, GSTR-3B, e-invoice and e-way bill (migration 0028).** FlowXP prepares the returns and files; a person (or their accountant) uploads them on the government portals and records what the portal returns. Nothing is sent to any government system. Everything is in `modules/gst/` (`states.js`, `returns.js`, `documents.js`) with the loading in `gst.controller.js`; the endpoints are for a person who can see the whole business (`gst` permission and a group-level user) and take `period=YYYY-MM` and `gstin` (default: the business's; each GSTIN files its own return, so an outlet with its own GSTIN is filed separately, and the screen lists every GSTIN that billed in the month). *GSTR-1* (`GET /api/gst/gstr1`, `&download=1` for the file `GSTR1_<gstin>_<MMYYYY>.json`): B2B by customer GSTIN (place of supply from the GSTIN's state code), B2CL (inter-state sales to people without a GSTIN above a limit, by state; the limit is a setting, default Rs 2,50,000, to be confirmed with your accountant), B2CS (everything else, aggregated by intra/inter-state, state and rate, **net of credit notes on those sales**), credit notes to registered buyers (`cdnr`, referring to the original invoice) and to large unregistered sales (`cdnur`), the HSN summary (per code, rate and unit, net of returns) and the document-issue summary (per series: first and last number, how many, how many cancelled, with a warning when a number is missing). It is worked out per line, in paise, the way billing split each tax, so **the totals equal the GST report for the same dates** (tested), and the FY-to-date and previous-FY turnover come from FlowXP's own data. It reports what needs fixing instead of guessing: an invalid customer GSTIN (filed as B2C), an inter-state sale whose customer state is missing, lines with no HSN/SAC, invoices with a bill-level discount, coupon or points (taxable values are before it, as in the GST report), missing document numbers, and other GSTINs to file. *GSTR-3B* (`/api/gst/gstr3b`): 3.1(a) outward taxable supplies net of credit notes, 3.1(c) nil/exempt, 3.2 inter-state to unregistered by state, 4(A) input tax credit from received purchases net of debit notes (only suppliers with a GSTIN; taken as bought inside your state, CGST + SGST, since a purchase order doesn't yet record the supplier's state), and the tax left to pay in cash, with notes. *E-invoice* (`/api/gst/einvoice`, `/gst/invoices/:id/einvoice`): the IRP schema-1.1 JSON for sales to customers with a valid GSTIN, each with a list of what is missing (your GSTIN, address and pincode; the customer's address, pincode and state; an HSN on every product), a bulk file of the ready ones, and `POST /gst/invoices/:id/irn` to record the IRN the portal returns (64 hex characters, unique), after which the invoice shows it and drops out of the next bulk file. E-invoicing applies only above a turnover limit; a setting says whether it applies to you. *E-way bill* (`POST /api/gst/eway-bill { invoice_id, transport }`): the bulk-upload JSON for goods above Rs 50,000 (warns below), refusing services (SAC 99…), and asking for the mode, distance and vehicle number or transporter ID; `POST /gst/invoices/:id/eway-bill` records the 12-digit number. Pincodes were added to outlets and customers (the business uses its postal code). UI: **GST filing** page (month and GSTIN pickers; GSTR-1 summary, warnings and download; GSTR-3B table; e-invoice list with IRN entry and bulk download; filing settings), an **E-way bill** button on invoices to GST customers, and IRN / e-way numbers shown on the invoice. Not built: sending anything to the portals or the IRP directly (that needs a GST Suvidha Provider account and credentials), GSTR-2B reconciliation, inter-state purchases as IGST credit, exports and SEZ supplies, reverse charge, nil-rated/exempt in the HSN and B2CS split by supply type, debit notes to customers, GSTR-9, and the newer split HSN table format (the classic single table is produced; check the portal's current format before uploading). Also fixed in this change: numbering an outlet's invoices locked its row with `FOR UPDATE`, which could deadlock with the foreign-key checks of concurrent inserts (audit log, orders); it now uses `FOR NO KEY UPDATE`.

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
- **Subscription payments** — built via Cashfree Payment Links, custom
  price per business rather than a fixed self-serve checkout (see §4.4 and
  the payment-link paragraph). The public `plans` ladder still seeds at ₹0
  ("Pricing on request") and is marketing copy only; it doesn't drive what
  a business is actually charged. Blocked on Cashfree's own Payment Gateway
  product being activated for the account (a dashboard/KYC step, checked
  2026-09-28 in sandbox — the integration itself authenticates and reaches
  the API correctly). Its keys, and the email/SMS/WhatsApp provider's, are
  now editable from `/superadmin/settings` instead of `.env`-only (2026-09-29,
  see §4's "Platform settings" entry) — Razorpay is listed there as a future
  option but has no adapter built yet.
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


**Security: sign-in history, two-step login and review (migration 0029).** Every sign-in attempt is recorded (when, outcome, IP, device, whether the device is new); a new device triggers an email to the person. Five failed attempts on one email in 15 minutes lock it for 15 minutes (unknown emails behave the same, so nothing is revealed). *Two-step verification:* `GET /api/auth/2fa`, `POST /auth/2fa/setup` (secret + otpauth URL for a QR), `/enable { code }` (returns 10 recovery codes once, shown only then), `/disable { password, code | recovery_code }`, `/recovery-codes { password }`. With it on, `POST /auth/login` returns `{ requires_2fa, challenge }` and `POST /auth/login/2fa { challenge, code | recovery_code }` finishes the sign-in; codes are RFC 6238 (any authenticator app), accepted with one step of clock drift and never twice; secrets are stored encrypted. *Sessions:* tokens carry a version, so `POST /auth/change-password`, a reset, turning 2FA on/off and `POST /auth/sign-out-everywhere` end all other sessions at once (each returns a fresh token). `GET /auth/login-history` is the person's own; `GET /security/team` (settings permission) shows the team's sign-ins, who has 2FA and failure counts, and `PUT /security/policy { require_2fa_admins }` (owner) makes two-step verification mandatory for owners and admins, who are then sent to the Security page until they set it up. UI: **Security** page (2FA setup with QR and recovery codes, password, sign out everywhere, history, team view) and a code step on the login screen. *Review fixes:* uploads are checked by their first bytes and served sandboxed; security headers; no-store on the API; CORS/JSON/size errors are clean 403/400/413; nodemailer upgraded. See SECURITY.md for the review and the go-live checklist. Not built: SMS codes or hardware keys, per-device session list, CAPTCHA, refresh-token rotation.


**Dashboard (redesign).** `GET /api/dashboard` now also returns, in `metrics`, `today` (the business's own date, as reports use; it was the server date before), `yesterday_sales`, `yesterday_invoice_count` and `open_orders`, and a `sales` block for people with the `reports` permission (`null` otherwise): `trend` (the last 14 days, every day present, empty days as zero), `top_products` (this week by revenue, top 5) and `recent_invoices` (latest 6 with customer and payment status). All follow the outlet being viewed. The screen shows today against yesterday, the 14-day chart (one series, with a hidden table for screen readers), a "needs your attention" list (low stock, money to collect, open orders) and best sellers and latest bills; a new business sees its setup checklist first. Tests: `test/dashboard.test.js`.


**Billing screen (redesign).** A split POS: on the left, search or scan (Enter adds an exact barcode or SKU match first, else the top match; "/" focuses search, Escape clears), category buttons and a grid of item tiles (tap to add; dishes with required choices open the modifier picker; each tile shows how many are already on the bill, stock left or "Options"); on the right, the current bill with the customer (walk-in by default, mobile lookup or name search, loyalty card and points), lines with − / + steppers and an optional line discount, a folded "Discount, coupon or note" section, the total, payment-method buttons (Cash, UPI, Card, Bank, Other, Pay later) and one Charge button (Ctrl/⌘ + Enter). **A bill is now paid in full by the chosen method by default** (the request sends payment.amount = 'FULL', so the server records exactly the final total, rounding included); typing a smaller amount makes it a part payment, cash received above the total shows the change to give back, and "Pay later" saves it unpaid (with a nudge to add a customer). Before, a bill charged without typing an amount was saved unpaid. The CREDIT payment method is no longer offered at the till (Pay later covers it); it remains valid in the API and on invoices. On phones the items come first and a sticky bar keeps the total and "Review and charge" in reach. The confirmation shows the invoice number, total, change due and payment status, with New sale focused so Enter starts the next bill. Offline sales, idempotency, auto-print and the cash drawer work as before.


**Split payments and bills on hold (migration 0030).** *Split:* `POST /api/invoices` (and billing an order) now also takes `payments: [{ method, amount, reference_number? }]`, up to 6 parts, where one part may be `'REST'` (whatever the others leave, worked out by the server to the paisa after tax rounding, round-off and loyalty rewards). Every other part needs an amount above zero; parts that add up to more than the bill are refused (nothing is billed); parts that add up to less leave the bill part-paid. Each part is its own row in `payments`, and the created invoice returns `payments_taken`. The single `payment` field works exactly as before. At the till: "Split between payment methods" under the payment buttons, one row per method, the last left blank for the rest; the confirmation lists the parts. *Hold:* `GET /api/held-bills`, `POST /api/held-bills { label?, bill, estimate? }`, `DELETE /api/held-bills/:id` (billing permission; per outlet, writes need a concrete outlet). A held bill is the till's draft (lines with modifiers and discounts, custom lines, customer, coupon code, bill discount, note); nothing is charged, no stock moves and no invoice number is taken. At most 50 per outlet. Resuming deletes it (so two tills cannot both resume it) and puts it back on the till; prices, stock, coupons and points are worked out again when it is charged. At the till: Hold (with an optional name such as "Table 4"), and Held (n) to resume or discard; resuming while another bill is open offers to hold that one first. Tests: `test/splitheld.test.js`.

**Tables, Orders and Kitchen screens.** *Orders* is one screen: open orders on the left (oldest first, filter by Dine-in / Takeaway / Delivery, each card shows the table or type, how long it has been open, what the kitchen is doing and the amount so far including GST), the chosen order on the right (add items by name or code, what is not yet sent and what is in the kitchen, send to the kitchen with Rush and Print ticket, customer, coupon and points, then pick how it is paid and Bill). Across the top it shows how many orders are open, the total of their running bills, how many need attention (food ready to take out, items not sent to the kitchen, or open 45 minutes or more; tap it to see only those) and the oldest open order. Orders can be found by table, order number, customer or waiter. Each order card has a coloured strip (red when open too long, green when food is ready, amber when items are not sent) and a bar of not sent / cooking / ready. On the order, the bill shows the items, GST and any free loyalty item above the total, and the kitchen box explains what Rush and Print ticket do. *New takeaway* starts an order in one click; *New dine-in* asks for a table. *Tables* shows the floor by zone: a free table starts a dine-in order when tapped, an occupied one shows its time, items, amount and whether dishes are ready, a table booked soon is marked. Across the top: free tables and free seats, occupied tables, the total of running bills, dishes ready to serve and the table seated longest (red from 90 minutes, a hint to offer the bill). Filters show only free, occupied, booked-soon or being-cleaned tables, or those that *need attention* (food ready, items not sent to the kitchen, or seated 90+ minutes), and an area picker narrows the floor. Each busy table shows its running bill, how long it has been open, its waiter and a bar of not sent / cooking / ready. A table's settings change its name, area and seats (two tables at one outlet cannot share a name), its regular waiter, print its QR stand card, mark it being cleaned or ready again, and remove it (not while it has a running order; a removed table's QR stops working). *Print QR cards* prints stand cards for every table at once. *Kitchen* shows one ticket per order with a large timer (hours past 60 minutes), On time / Nearly due / Late, each dish can be marked ready on its own or the whole ticket at once, and a takeaway or delivery order is marked *Handed over* from the Ready tab. Across the top the kitchen sees how many tickets are to make, how many are late, how old the oldest is, and how many are ready but not yet taken out (with the longest wait). Each ticket has a bar that fills towards its due time; each dish says how many minutes are left or how far over it is, and which station cooks it. *Cook now* adds up every dish still to make across tickets (7 Butter Naan in 3 tickets); tapping one fades the other tickets. A ready ticket shows how long it has been waiting ("Getting cold" from 5 minutes). Anything marked ready, served or sent back can be undone for a few seconds. Cash handed over is sent as it is: the server records at most the bill (the rest is change), and the change shown is worked out from the saved total, so tax, round-off or offers never make it wrong.

**Reservations screen.** One screen for the day: switch days with the arrows (or pick a date), bookings are grouped by hour with the time, guest, party size, table and notes, and each one says when it is due ("Due in 10 min", "Due now") or late ("20 min late", with a No-show button). Seat opens a picker of free tables (too-small tables, ones being cleaned and ones booked soon are marked) and, unless unticked, starts the table's order and opens it; a seated booking has Open order and They've left. Finished, cancelled and no-show bookings sit in a folded list. The walk-in waitlist is beside it (a toggle on phones): add a name, party and optional mobile in one line, see how long each party has waited against what they were told, mark Table ready (they are messaged too when messaging is set up), Seat or Left. A new booking shows which tables are free for that time and party as buttons. A table with guests on it right now is not offered, and cannot be saved, for a booking that starts within the hour (it is fine for later); editing a booking only runs that check when its table or time changes, so fixing a note never fails on it.

**Customers screen.** The list shows every customer with their mobile, number of bills, when they were last billed, what they have spent and what they owe. Search by name, mobile, email or GSTIN; filter to Owes you, 5+ bills, New in 30 days (first bill in the last 30 days) or Not back in 60 days; sort by last bill, spent, owed or name; the header shows the total owed and by how many. Picking a customer opens their page: call or email links, spent (and since when), number of bills and the average, last bill, what they owe against their credit limit, their unpaid bills (with a warning when over the limit; open a bill to record a payment), their visit card and points (when loyalty is on), every bill with its status, and their GST details. New bill opens the billing screen with the customer already on it. The add/edit form is grouped into contact, GST details (only needed for business customers) and credit; the credit limit is a warning only. All figures are summed from issued bills; cancelled bills are shown struck through and not counted.

**Inventory screen.** Four figures at the top: stock value (at what you paid), items running low, items out, and wastage in the last 30 days (tap it for the breakdown by reason and by item). The list shows each item with a bar against its warning level and Low / Out labels; search, filter by type (ingredients, packaging, sold items) and sort lowest-first, by name or by value. Picking an item shows how much there is, what it is worth and its cost per unit, its warning level (changeable in place), a nudge to record a purchase or check the stock forecast when it is low, and three actions: *Count or correct* (type what you counted and FlowXP works out the correction and its value, or add/remove with a reason), *Log wastage* (with the value shown before saving) and *Transfer* to another outlet. Below is every movement in plain words (sold, used in sales, bought, stock count, correction, wasted and why, returned, sent or received), with the bill or purchase number (bills open on tap) and how much was left after it. In the all-outlets view the screen is read-only and each movement names its outlet.

**Purchases screen.** Three tabs: *To receive* (drafts, orders sent to suppliers and part-received ones), *To pay* (goods received but not fully paid for) and *All*; search by order number or supplier and filter by supplier. The header shows how many orders are on their way, how many are late and how much is owed to suppliers. Each row names the supplier, where the order stands (Draft, Ordered, n days late, Part received, Unpaid, Part paid, Paid) and when it is expected or came. Picking an order shows its progress (drafted, ordered, received, paid, with dates), what was ordered and what actually came (short lines marked), the money (before GST, GST, total, returned or credited, paid, still owed) and every payment, with the next step for its status: *Review and send* a draft, *Goods arrived* for an order (opens straight on receiving), *Rest arrived* or *Rest isn't coming* for a part delivery, *Pay supplier* when money is owed (amount, cash/UPI/bank/card/other, reference; more than is owed is refused), and *Return or price correction*. *Record a purchase* is for goods already here: stock goes up at once, with GST per line, the total, and what was paid now and how.

**Suppliers screen.** The list shows each supplier with their mobile, how many orders came from them and when the last one did, how many are on the way, what you have bought from them and what you owe; filter to You owe or On the way, sort by owed, bought, last order or name, and search by name, mobile or GSTIN. The header shows the total owed and to how many. A supplier's page has call, WhatsApp and email links, New order (opens a purchase order with them already chosen) and Edit details; four figures (you owe, bought from them, last delivery, orders on the way); the orders still to pay (open one to record a payment); their price list, added to and edited in place, with the minimum order, days to deliver and how the agreed price compares with what the item costs you now; and every order with its status. Money and orders are counted at the outlet you are viewing (All outlets for the business total), the same as on Purchases.

**Expenses screen.** Pick a period (this month, last month, the last 30 days, this year, or your own dates). The total for it is exact and is compared with the matching period before: this month so far against the same days of last month, last month against the month before, and so on. *Where it went* shows each category with its share and a bar, and how it moved against that earlier period; tap one to see only those expenses; the way they were paid is summed underneath. The list is grouped by day with a total for each day; tap an expense to correct it or delete it. Adding one asks for the amount first, then what it was for (your own categories first, the usual ones after, or + New to type another), how it was paid, the date and an optional note; *Save & add another* keeps the date and payment method for entering a pile of bills. Expenses are per outlet, so adding needs an outlet picked at the top. Profitability takes these off for its estimated net.

**Payments screen.** Money taken from customers and money paid to suppliers are shown apart (before, a supplier payment looked like money coming in). Pick a period (today, yesterday, the last 7 days, this month, or your own dates) and see what was taken from customers, what was paid to suppliers, and in minus out; tap either side to list it. *How customers paid* (or how suppliers were paid) shows each method with its total and count; tap one to list only those. The list is grouped by day, newest first, with who, the bill or purchase order (tap to open it), the reference, the method and the time; search by name, number or reference. *Payment with no bill* records an advance or an old balance from a customer; it does not settle any bill.

**UPI QR at the till.** With a UPI ID in Business settings, picking UPI on the billing screen (or on an order) changes the button to *Show UPI QR*: the bill is saved, then a QR for exactly what it came to (with the bill number) appears for the customer to scan with any UPI app. This is not a payment gateway, so FlowXP cannot see the payment: the cashier checks the customer's phone shows it paid and taps *Payment received* (the 12-digit UTR can be noted), which records it against the bill. *Not paid yet* keeps the bill unpaid, to be paid later or another way. A part amount typed first gets a QR for that amount. Without a UPI ID the screen says where to add one. Offline, the sale is queued as an ordinary UPI sale. A bill can no longer be paid more than it is owed.

**Invoices screen.** Pick a period (today, yesterday, the last 7 days, this month, all time, or your own dates) and see what was billed (and the average bill), what has been paid so far (and refunded), what is still owed and on how many bills, and how many were cancelled (never counted in the totals). Tabs show all bills, only those still owed, paid ones or cancelled ones; search by bill number, customer or mobile. The list is grouped by day, with the customer, where the sale came from (counter, table, takeaway or a delivery platform), the time, the total and what is due. *A bill* opens as the document itself: the business (with its GSTIN, address and phone), bill number, date and time, who it was billed to, the table and who served, every item with its rate and GST, the tax split, discounts, round-off, total and what is paid. Beside it: where the money stands with *Take payment* (any method, an equal split between people, or a UPI QR for the amount), and the history of payments, refunds and credit notes. *Receipt* prints the till slip, *A4 / PDF* prints only the bill (choose Save as PDF to keep a file), *Send* messages it to the customer, and *More* holds credit notes, refunds, e-way bills and cancelling.

**Products screen.** For restaurants it is *Menu and products*, with tabs for the menu, ingredients, packaging and archived items (other businesses see all products and archived). Filter by category, search by name, SKU or barcode, and sort by name, price or lowest margin. Each menu item shows its price and its margin: what one costs you comes from its recipe (the outlet's own recipe where it has one) or, for something bought and sold as it is, from what you pay. A note lists items whose cost is not known yet, and margins under 30% are marked. Picking an item shows its photo (tap to add or change it), price with GST, what it costs and what is left of each sale, what one portion uses, the parts of a combo, its options, stock (linked to Inventory), GST and codes, and buttons to edit the details, the recipe, the combo or the price at each outlet. Archiving takes an item off billing and the QR menu without losing its history; archived items can be brought back. The add/edit form is grouped into what it is, price and GST (showing the price with GST), options and stock.

**Options & add-ons screen** (was Modifiers). Each group says in plain words how customers choose (Pick exactly one, Optional up to 2, Pick at least 1…), lists its options, and shows on how many dishes it is offered; a group on no dish is flagged. Picking a group shows every option with its price change and any ingredient it uses up (extra cheese uses 30 g of cheese, so stock stays right), a preview of how it looks at the till, and the dishes that offer it. *Choose dishes* sets them all in one go, by category, with a search (the same links a dish's own edit form uses). *Turn off* stops the till offering the group and bills asking for it without deleting anything; *Turn on* brings it back on the same dishes. The form asks how customers choose (one of these, or any of these with at least / at most), shows the resulting rule as you type, and lists options with price change, ingredient and quantity.

**Reports screen.** Pick a report on the left (on a phone, along the top) and a period (today, yesterday, the last 7 or 30 days, this month, last month, or your own dates). *Sales*: sales, bills, average bill and GST collected, each compared with the period just before; a day-by-day chart; the busiest hours; where sales came from (counter, dine-in, takeaway, and each delivery platform); sales by category; how customers paid (money taken from customers only; before, payments made to suppliers were counted here too); and the ten best sellers. *Waiters* (restaurants), *Top customers*, *Who owes you* (with how long the oldest unpaid bill has waited), *Purchases* by supplier, *Expenses* by category, *Stock* (value and what is running low) and *GST* (taxable value, CGST, SGST, IGST and total, net of credit notes, by HSN/SAC with items missing a code flagged, and the GST register for GSTR-1). Every table has a CSV button for your accountant. Names link through to the customer, supplier, product or stock item.

**Adding items to an order by tapping.** On an order, *Menu* opens the whole menu as big buttons by category (it opens by itself on a new empty takeaway or table). Each tap adds one; tapping the same dish again adds to the same line instead of a new one; a dish with options asks for them first. Typing a name or scanning still works. Changing a quantity with + and − now works at every outlet (it used to fail with an error when the business has outlets).

**Loyalty that actually gives the reward.** The free item only comes off a bill when it is on it, so when a customer's reward is due the order screen and the billing screen show *Add the free Gulab Jamun*; once it is on, they confirm it comes off, and the total already shows it free. Otherwise they say whether the bill earns a stamp (bills under the minimum do not). The *Visit card* tab shows the card as customers see it, sets it up in three steps (what is free, on which visit, which bills count) with an on/off switch and what the reward costs you, and shows members: how many, new and returning in 30 days, free items given, who has not been back in 60 days, how often members come (once, 2–3, 4–6, 7+ times), and who has a free item due or is one visit away, with a call link.

**The QR menu customers see.** The restaurant's logo (the receipt logo) or initials, name, outlet and address, and the table at the top; a search and a *Veg only* switch; categories as picture tiles; each dish with its veg / non-veg / egg mark, price, description, photo and an *Add* button that turns into − 1 +; collapsible category sections; an order bar at the bottom and an order sheet with name and mobile. The visit card is on the menu: a customer types their mobile number to see their stamps, adds their free item in one tap when it is due, and the same number goes on the order so the visit counts when the bill is paid. Veg / non-veg / egg is set per dish on Products.

**Billing and orders, connected (restaurants and cafés).** *Counter sales go to the kitchen:* on the Billing screen a *Send to the kitchen* switch (on by default, remembered on each device) sends every counter sale to the kitchen screen the moment it is charged, the café way: the customer orders and pays first, and the bill screen shows a big order number (for example ORD-0052) to tell the customer and call out when it is ready. The bill, the order and the kitchen ticket are saved together, so there is never a bill without its ticket or a ticket without its bill. Turn the switch off for drinks or packed items served straight from the counter. If the till is offline, the sale is kept on the device as before but is not sent to the kitchen; tell the kitchen yourself. If *Print ticket* is on for the device, the kitchen slip prints too. *Open orders in Billing:* an *Orders* button lists the outlet's open orders (tables, takeaways, QR orders); picking one brings it into Billing. Its items show with where the kitchen is with them, items tapped are added to that same order, and charging sends anything not yet sent to the kitchen and then bills and closes that order, so it can never be billed twice. The Orders screen can still bill it the same way. Not built: a customer-facing "order ready" board, daily token numbers that restart at 1 (the order number is used), and line discounts on an open order (a bill discount works).

**Order board (optional).** A screen for a TV or tablet near pickup, for restaurants and cafés that call customers by their order number. Open it from the *Order board* button on the Kitchen screen (`/app/kitchen/board`). It shows two columns: *Preparing* and *Ready to collect*, each with the order number in large type; an order moves itself from one to the other the moment the kitchen marks it ready, with a chime if sound is on. Tapping a ready order marks it collected, the same as the Kitchen screen's Ready tab, so the same screen can run the pickup counter as well as just be watched. Only takeaway, delivery and counter orders appear here — a table order is served where it sits. Nothing here needs turning on: it changes nothing about how orders or the kitchen work, it is only another way to look at them.

**Staff only see what their role can do.** The menu on the left used to show every screen to every team member — a waiter or kitchen login could open Business Settings, Suppliers, Purchases and more, even though saving anything there was always refused. Now the menu itself matches each role: a waiter sees Billing, Orders, Tables, Kitchen, Reservations and Customers; kitchen staff see Orders and Kitchen; a cashier adds Payments; only an owner or admin see Products, Inventory, Purchases, Suppliers, Reports, Settings and Staff. Typing or bookmarking a hidden screen's address now shows "You don't have access to this" instead of a half-working page. This follows each person's role, and any individual permission an owner has switched on or off for them under Staff. Plans limit three things today: how many people can be added, how many outlets a business can have, and how many questions Flow AI answers a month — each one refuses politely and says what plan would allow more. Nothing on the plan page switches a whole feature like Loyalty or Reports on or off by itself.

**Setting up a new business.** The wizard no longer asks for your business name and type a second time — signup already asked, and re-asking read as the form not listening. It now has four short steps: *where you trade* (address, city, a proper dropdown for state — all 36 Indian states and union territories, or a country picker with a plain text field for other countries — and a live Google Maps preview that updates as you type, no account or API key needed); *how you look* (your logo — the same one that shows on receipts and at the top of the QR menu customers scan at the table); *tax and money*; *invoices*. Every step is still skippable and saves as you go.

**Accepting or rejecting a Zomato/Swiggy order.** A delivery-platform order no longer goes straight to the kitchen — it used to, with no way to say no. Now it waits, and a loud pop-up rings, every few seconds, no matter which screen you're on (Billing, Kitchen, anywhere), until someone decides. It shows exactly what was ordered — every dish, quantity and any note ("please pack cutlery separately") — along with the diner's name and phone, so a missing ingredient or a kitchen that's closing can be judged right there. The pop-up can be dragged out of the way by its red header if it's covering something. **Accept** sends it to the kitchen, exactly like pressing "Send to kitchen" on any other order, with the platform's own order number now printed on the kitchen slip and the receipt (so it can be matched back to the Zomato/Swiggy app). **Reject** asks why and cancels it — the kitchen never sees it, and nothing is charged. The sound can be muted per device (a button at the top of the pop-up), and this applies to Zomato, Swiggy, ONDC and Magicpin alike, since they all share the same arrival path. It's still a mock: no live Zomato/Swiggy partnership exists, so orders only arrive through the "Send test order" button on Integrations, not from a real restaurant account.
