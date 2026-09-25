# FlowXP

**The smart flow for every business.** AI-powered billing, payments, inventory, GST
and business intelligence. A product of ManagerXP.

Standalone: its own server, its own Postgres database, nothing shared with
`managerxp-platform`.

---

## Running it

```bash
# 1. Database (once)
createdb flowxp

# 2. Backend
cd backend
cp .env.example .env        # fill in DATABASE_URL and JWT_SECRET
npm install
npm start                   # http://localhost:5100 — creates the schema on boot

# 3. Frontend
cd ../frontend
npm install
npm run dev                 # http://localhost:5174
```

`npm test` in `backend/` runs the logic checks (trial expiry, permissions, GST).

With `SMTP_HOST` unset the mailer prints password-reset links to the backend
console instead of sending them — that is the intended development behaviour.

---

## What is built

**Priority 1 — done and verified end to end** (auth, multi-tenancy, business
creation, 7-day trial, onboarding, dashboard, public site — see git history for
detail).

**Priority 2 + most of Priority 3 — backend, API and frontend, done and
verified end to end.** A real POS screen, not just endpoints.

| | |
|---|---|
| Products & categories | Full catalogue: pricing, tax rate, HSN/SAC, barcode/SKU, opening stock, low-stock threshold. Services (`track_inventory: false`) skip the stock ledger entirely. |
| Customers & suppliers | Contact records with outstanding / payable balances computed live from invoices and purchase orders — never a stored number that can drift. |
| Billing (`invoices`) | The whole cart → discount → GST → payment → invoice workflow in one atomic transaction: invoice numbering, stock locking and decrement, and payment recording either all happen or none do. Supports catalogue items, ad hoc lines, partial/split payment, and cancel-with-stock-restore. |
| GST | `modules/tax.js` — one function every tax figure in the product runs through. CGST/SGST for intra-state, IGST for inter-state, zero tax when the business isn't GST-registered regardless of a product's rate. Rounding is exact: split tax always sums back to the whole. |
| Inventory | `current_stock` is a maintained cache; `inventory_transactions` is the ledger it's derived from. Sales, purchases, manual adjustments and cancellations all write through it — nothing touches the stock number directly. |
| Purchases | Purchase orders with their own numbering, GST, and supplier payable tracking; receiving stock increments the same ledger a sale decrements. |
| Expenses | Categorised, date-filterable, the one place with real delete (nothing else references an expense row). |
| Reports | Sales, purchases, expenses, outstanding, inventory valuation, top customers, and a GST summary with HSN-wise breakdown — all read-only aggregates, all date-range filterable. |
| Permissions | Reads needed *for billing* (searching products/customers) are open to the `billing` permission alone, so a CASHIER can build a cart without holding catalogue-edit rights; writes stay behind their own domain permission. GST reporting is gated separately from other reports (OWNER/ADMIN only) since MANAGER doesn't hold `gst`. |

**Frontend:** a POS screen (`app/billing/BillingPage.jsx`) — search or scan,
cart, customer lookup, bill discount, a live estimated total, split/partial
payment, then a confirmation screen with the server's real figures — plus
invoice list/detail with print-to-PDF, and full CRUD screens for products
(with inline category creation), customers, suppliers, inventory adjustments,
purchases, payments, expenses, and a seven-tab reports page with a shared date
range.

**Verified against a running stack**, not just built:
- Backend: a 32-point integration run covering the full sale-to-report
  lifecycle — GST split arithmetic, atomic stock decrement, overselling
  refused with the failed transaction leaving stock untouched,
  partial-then-full payment, invoice cancel restoring stock, purchase
  incrementing stock, cross-tenant reads refused (404) on every endpoint, and
  trial expiry blocking writes while reads stay open.
- Frontend: walked live in the browser — added a product with a new category,
  billed a real sale (10 units, 18% GST, split CGST/SGST), confirmed the
  invoice, stock, dashboard checklist and every report tab all agreed with the
  same ₹236.00.

Three real bugs found and fixed during that walkthrough, not left for later:
1. **Layout**: `Input`/`Select` hardcode `w-full`; a caller's `w-24` doesn't
   reliably win that same-property clash (Tailwind resolves it by stylesheet
   order, not by where the class sits in the string) — the billing cart row
   was rendering ~220px tall instead of one line. Fixed by sizing a wrapper
   `<div>` around the input instead of fighting the cascade, everywhere the
   pattern occurred (billing cart, purchases, reports date range).
2. **Dates**: `pg` parses `DATE` columns to JS `Date` objects at UTC midnight;
   JSON serialization then rendered an IST invoice dated the previous evening
   as a full timestamp (`2026-09-04T18:30:00.000Z`). Fixed once, at the driver
   level (`pg.types.setTypeParser(1082, ...)` in `database.js`), so it's
   correct for every date column everywhere, not patched per-controller.
3. **Crash**: switching report tabs re-renders with the new tab selected
   before the data-clearing effect runs, so `Gst` briefly received `Sales`'s
   data shape and threw on `d.by_hsn.map`. With no error boundary, that
   unmounted the *entire app* to a blank white screen. Fixed the root cause
   (tag fetched data with the tab it belongs to; never render a mismatch) and
   added `ErrorBoundary.jsx` around `AppShell`'s `<Outlet/>` so any future
   render bug in one screen can't do that again.

## Orders, KOT and delivery integrations

Built against `FlowXP_Multi_Tenant_Complete_Architecture.pdf` as a feature
checklist, not literal tech-stack instructions — that doc recommends
Next.js/NestJS/Prisma/Redis; the actual stack (Express, raw SQL, Postgres) is
what's already working here, and rewriting the framework was never the ask.

| | |
|---|---|
| Orders (`orders`, `order_items`) | The running tab in front of billing — dine-in (tied to a table), takeaway, or delivery. One open order per table, enforced by a partial unique index, not application logic that could race. |
| Dining tables (`dining_tables`) | FREE/RESERVED/CLEANING/CLOSED. Occupancy itself is never stored — it's derived from "does this table have a non-billed, non-cancelled order", so a table can't drift out of sync with the order that actually says whether it's busy. |
| KOT (`kot_tickets`) | "Send to kitchen" snapshots only the items added since the last ticket (not the whole order again), stamps them PREPARING, and returns structured ticket data — no physical printer integration, consistent with the rest of the product's digital-first stance; the frontend renders/prints it the same way invoices already do. |
| Orders → Invoice | `modules/billing.js` — the tax/stock-locking/payment core was extracted out of `invoices.controller.js` so billing a KOT tab runs through the *exact same* transaction a direct POS sale does, not a second copy of GST math. The invoice honors the price an item was added to the order at, never a catalogue price that may have changed since. |
| Delivery integrations (Zomato, Swiggy, ONDC, Magicpin) | Provider-abstracted, the same pattern as payments/AI in this codebase: `modules/delivery/adapters/*.js`, one per platform, behind `registry.js`. **All four are mocks** — none of these platforms' real partner APIs are reachable without a registered business account and approved credentials, which don't exist. Each adapter defines `parseWebhookOrder`, `pushMenu`, `pushOrderStatus`, `verifySignature` at the exact seam a real client would occupy; swapping one in later is a rewrite of one file, not a redesign. |
| Webhook receiver | `POST /api/integrations/:platform/webhook/:token` — public, authenticated by an unguessable per-business token in the URL rather than a JWT (a delivery platform's server has no FlowXP session). Every call, successful or not, is written to `delivery_webhook_log`. |
| Simulate-order | `POST /api/integrations/:platform/simulate-order` — authenticated, lets a business owner exercise the whole pipeline (order → KOT → kitchen view) with a realistic fake payload, with no partner account needed. |

**Verified against a running stack:** opened a dine-in order, added a
catalogue item and a custom line, sent a KOT (order → PREPARING, items →
PREPARING), billed it (GST split correctly, table freed automatically),
confirmed a second order on the same table is refused with 409 while open and
allowed again once billed; connected Zomato, simulated an inbound order,
confirmed it creates a DELIVERY order with items parsed from the mock
payload; hit the real (unauthenticated) webhook path directly with a valid
and an invalid token and a malformed payload; confirmed cross-tenant reads on
every new endpoint (`/orders`, `/tables`, `/integrations`) return 404, not
403, exactly like the rest of the API; reran the full existing
invoice-lifecycle check (create/list/detail/cancel) to confirm extracting
`billing.js` out of `invoices.controller.js` didn't change its behavior.
21/21 backend unit tests pass, including new coverage for all four adapters'
payload parsing.

**Known simplification, not an oversight:** a custom (non-catalogue) line
added to an order has no `tax_rate` of its own — `order_items` doesn't carry
one — so it bills at 0% GST. A catalogue item's rate always comes from the
product and is unaffected. Add a `tax_rate` column to `order_items` if a
business needs GST on ad hoc order lines.

## What is not built

Per the architecture doc's own feature list, checked against what's actually
here — this is the honest backlog, not an oversight list:

- **Flow AI** — the doc's tenant-scoped AI orchestrator (permission-checked
  data tools → sanitized aggregates → LLM → answer, with usage logging). No
  LLM provider has been chosen; that's a real decision, not a default I
  should have picked silently.
- **Subscription payment provider** — trial→paid activation needs a real
  gateway (Razorpay is the natural default for an Indian SaaS, but that's a
  business/compliance decision, not mine to make). The Upgrade button stays
  disabled until one is chosen.
- **Notifications** (`notifications` table, in-app/email alerts for low
  stock, payment received, etc.) — in the doc's schema, not built.
- **Proper multi-branch** — `branch_id` columns already exist everywhere per
  the tenancy model, but there is no branch CRUD UI/API and no branch
  switcher; every business today effectively operates as one branch.
- **GST credit/debit notes** — the doc lists these explicitly; only the
  invoice/tax-summary side is built.
- **Advanced per-user permission editing UI** — `business_users.permissions`
  (the per-user override column) exists and is enforced by `hasPermission()`,
  but there's no screen to edit it; today it can only be set directly in the
  database.
- **PWA service worker**, **object storage for uploads** (product images,
  invoice PDF caching — everything is generated on demand right now),
  **Redis/queues** (the doc's async PDF/WhatsApp/email jobs — those channels
  don't send anything yet regardless of a queue).

Scope deliberately left out of the billing engine itself, noted inline in
`invoices.controller.js` / `purchases.controller.js`:
- An invoice-level discount is subtracted flat from the taxed total rather than
  re-computing GST on a discounted taxable value.
- Suppliers don't carry a `state` field yet, so purchases are always treated as
  intra-state (CGST+SGST). Add the column when a business needs IGST on a
  purchase.
- Cancelling an invoice restores stock but does not auto-refund a payment
  already collected — that's a human refund decision, not a silent reversal.

Two things are deliberately inert rather than fake:

- **Plan prices are all zero** and render as "Pricing on request". The brief says
  not to hardcode prices before they are confirmed; they live in the `plans`
  table, so setting them is an `UPDATE`, not a deploy.
- **The Upgrade button is disabled.** No payment provider is wired up yet, and a
  button that looks live and does nothing is worse than one that says so.

`/privacy` and `/terms` describe what the product actually does with data but
carry a visible "not yet legally reviewed" banner. They need a lawyer before
launch.

---

## Layout

```
backend/
  server.js                    app, CORS allowlist, graceful shutdown
  src/config/database.js       tenancy schema (users/businesses/branches/plans), idempotent on boot
  src/config/schema.commerce.js  products/customers/invoices/payments/inventory/purchases/expenses schema
  src/config/schema.orders.js  orders/order_items/kot_tickets/dining_tables/delivery_integrations schema
  src/config/env.js            validated config; refuses to start without JWT_SECRET
  src/middleware/auth.js       sessions, tenant isolation, roles  ← most security-sensitive
  src/modules/subscription.js  trial maths
  src/modules/tax.js           GST — every tax figure in the product runs through this
  src/modules/billing.js       the invoice transaction core, shared by direct POS sales and Orders→bill
  src/modules/delivery/        registry.js + one adapter per platform (all four are mocks — see README)
  src/utils/money.js           rupees ↔ paise, the one conversion point
  src/controllers/             auth, business, dashboard, orders, tables, integrations, + one per commerce domain
  src/routes/index.js          mounts auth/business/dashboard + one router file per domain
  test/logic.test.js           trial expiry, permissions, GST arithmetic (21 checks total, see delivery.test.js too)
  test/delivery.test.js        every delivery adapter's payload parsing

frontend/
  src/index.css                brand tokens — every colour in the product
  src/lib/api.js               the only thing that talks to the API
  src/context/AuthContext.jsx
  src/components/ui.jsx        every shared primitive (Button, Table, Modal, Badge...)
  src/components/ErrorBoundary.jsx  catches a render crash before it blanks the whole app
  src/site/                    public site (content.js drives most pages)
  src/auth/                    signup, login, forgot, reset
  src/app/                     shell, dashboard, onboarding, subscription
  src/app/ProductsPage.jsx, CustomersPage.jsx, SuppliersPage.jsx,
    InventoryPage.jsx, PurchasesPage.jsx, ExpensesPage.jsx,
    PaymentsPage.jsx, ReportsPage.jsx
  src/app/billing/              BillingPage.jsx (POS), InvoicesPage.jsx, InvoiceDetail.jsx
```

## Branding

Blue / cyan / violet on white, taken from the FlowXP mark. The tokens live in
one `@theme` block in `frontend/src/index.css`.

Drop the official logo at `frontend/public/logo.png` — the header, footer, auth
pages, favicon and PWA icon all point at it already, and fall back to the
wordmark until it is there.
