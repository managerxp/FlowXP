# FlowXP Salon Management Module

A native module for businesses of type `SALON`. It is part of FlowXP — same login, tenants, outlets, plans,
billing engine, stock ledger, loyalty, messaging and audit log — not a separate app. Nothing in the restaurant
or retail flows changed behaviour; the salon screens and API only exist for a salon (`/api/salon/*` answers 404
for any other business type).

## 1. Architecture

**Reuse first.** A salon reuses what FlowXP already has and adds `salon_*` tables only where no generic home exists.

| Salon concept | Stored in |
|---|---|
| Services | `products` with new `kind = 'SERVICE'` (+ `salon_item_details` for duration, gender, commission, points flags) |
| Retail products, consumables | `products` (`DISH` / `INGREDIENT`), `branch_stock`, `inventory_transactions` |
| Service consumables (recipe) | `recipe_items` (new `is_variable` column) |
| Clients | `customers` (+ `salon_customer_profiles`, `salon_customer_notes`) — shared across outlets |
| Bills, payments | `invoices`, `invoice_items`, `payments` (+ `salon_invoice_lines` for who did what) |
| Loyalty points | existing points programme/ledger (+ expiry, per-kind earning rules) |
| Purchases, suppliers, expenses | existing purchase orders / expenses (batch + expiry on receipt; commission payouts booked as expenses) |
| Permissions, roles, plans | existing RBAC, `feature_flags`, add-ons, business-type features |
| Audit | existing `audit_log` (before/after in `metadata`) |
| Reminders | existing messaging providers and job worker |

**The salon till wraps the shared billing engine** (`modules/salon/pos.js` → `createInvoiceInTransaction`). Three
backward-compatible hooks were added to the core: per-line actual consumption, tax-inclusive pricing and a points
function. Package/membership/gift-card issuing, commission, offers and appointment completion happen in the same
transaction, so a failure anywhere rolls the whole sale back. A quote (`/pos/quote`) runs the real pipeline and
rolls back, so the screen and the sale can never disagree.

**Money** is integer paise in the database and rupees in the API, as everywhere in FlowXP. **Time**: a salon's day is
its own (`businesses.timezone`); all scheduling goes through `modules/salon/schedule.js`. Double-booking is prevented
with a per-person advisory lock inside the booking transaction.

Backend: `backend/src/modules/salon/*` (logic), `backend/src/controllers/salon*.controller.js`,
`backend/src/routes/salon.routes.js`. Frontend: `frontend/src/app/salon/*`, `frontend/src/lib/salon.js`.

## 2. Database changes (migrations 0048–0050, each with `down()`)

- **0048 foundation** — widens checks (roles `RECEPTIONIST`, `STYLIST`, `ACCOUNTANT`; product kind `SERVICE`; payment
  methods `WALLET`, `GIFT_CARD`; points kind `EXPIRE`); adds `points_programs.expiry_days`, `categories.item_scope`,
  `recipe_items.is_variable`; creates `salon_settings`, `salon_branch_settings`, `salon_item_details`, `salon_staff`,
  `salon_staff_services`, `salon_attendance`, `salon_customer_profiles`, `salon_customer_notes`, `salon_appointments`,
  `salon_appointment_services`, `salon_invoice_lines`.
- **0049 memberships/packages** — `salon_membership_plans`, `salon_customer_memberships`, `salon_membership_usage`,
  `salon_packages`, `salon_package_items`, `salon_customer_packages`, `salon_customer_package_items`,
  `salon_package_usage`, `salon_gift_cards`, `salon_gift_card_txns`, `salon_offers`, `salon_offer_redemptions`.
- **0050 commission/loyalty/stock** — `salon_commission_payouts`, `salon_commissions`, `expenses.staff_id`,
  `salon_loyalty_rules`, `salon_stock_batches`, `salon_automations`, `salon_automation_log`, view `salon_customer_stats`,
  indexes for 10k+ clients.

Design notes: a member keeps the terms they bought (snapshot); usage rows are voided, never deleted, when a bill is
cancelled; commission is an append-only ledger (a payout already made is offset by a negative row, never rewritten);
stock batches record *when it expires* while the ledger stays the single truth for *how much*.

## 3. API (all under `/api/salon`, all tenant-scoped, validated, audited; money-moving POSTs accept `Idempotency-Key`)

settings · categories · services (+ consumables) · products · staff · attendance · appointments (+ schedule,
availability, status) · clients (list/segments/lookup/profile/notes/timeline) · pos (catalog, products, entitlements,
quote, invoices) · membership-plans · memberships · packages · client-packages · gift-cards · offers · loyalty ·
commissions (+ approve, pay, payouts) · stock (in, batches) · alerts · dashboard · reports (22) · automations · campaigns.
Lists are paged in the database (`limit`/`offset`, `meta.total`).

## 4. Screens (`/app/salon/*`)

Dashboard (the `/app` home for a salon) · Appointments (day by person, week, list) · Billing (POS) · Clients ·
Services (+ retail products, consumables) · Memberships & offers (plans, members, packages, gift cards, offers) ·
Team & commission (team, attendance, commission, payouts) · Stock & alerts · Reports · Salon settings
(profile, hours & booking, tax & payments, loyalty, clients & stock, messages). Reusable pieces:
`ClientPicker`, `parts.jsx` (Tabs, Segmented, Chips, Panel, NumberField, Toggle, Pager), `useLoad`, CSV export.
POS shortcuts: `/` search · `F2` client · `F9` / `Ctrl+Enter` take payment.

## 5. Permissions

New roles: **Receptionist** (billing, customers, payments, appointments), **Stylist** (own appointments only — no
money), **Accountant** (billing records, payments, expenses, GST, reports, refunds). **Owner / Manager / Inventory
Manager** use the existing roles. New permissions: `appointments`, `staff_commission` (Owner, Admin, Manager).
Per-person overrides work as before. A stylist linked to a team member (Team → Sign-in account) sees only their own
appointments and never sees prices, takings or commission. Enforced in `salon.routes.js`; covered by
`test/salonsecurity.test.js` (route × role matrix).

## 6. Subscription integration

Six plan features, each its own switch in **Super admin → Features** (per plan and per business type) and
overridable per business: `salon_appointments`, `salon_memberships`, `salon_packages`, `salon_gift_cards`,
`salon_commission`, `salon_automation`; existing `loyalty`, `messaging` and `advanced_reports` also apply. Missing =
on, so existing plans keep working; turn any off to gate it (API answers 402, screens hide). Reports marked advanced
(retention, lifetime value, consumption, profit, staff performance) follow `advanced_reports`.

## 7. Migration instructions

Migrations run automatically at server start (`npm run migrate` to run them alone). No data changes to existing
tables beyond widening checks and adding nullable columns. To roll back: `down()` of 0050, 0049, 0048 in that order
(drops the `salon_*` tables; does not delete salon products, which are ordinary `products` rows).
Create a salon by choosing **Salon** at signup; salon settings are created with defaults on first use.

## 8. Environment variables

None new. Reminders use the existing messaging configuration (Messaging screen / provider keys); with messaging off
nothing is sent and nothing fails.

## 9. Testing

`cd backend && npm test`. Salon suites (116 tests): `salonbilling` (GST both ways, split/partial payment, gift cards,
packages, memberships, offers, commission, consumption, plan gating), `salonloyalty`, `salonappointments` (incl. two
people booking the last slot at the same instant), `salonstock` (batches, expiry, alerts, purchase receipt),
`salonmanage` (membership lifecycle, commission payout, CRM/segments, staff/attendance, catalogue, reports,
automation, 12,000-client paging), `salonsecurity`. The UI was exercised in a real browser against a seeded salon
(every screen, the main create/edit flows, 390 px wide phone layout). Known date-boundary failures that exist on the
untouched codebase between 00:00 and 05:30 IST (payments, salesreport) are not caused by this module.

## 10. Known limitations

- Receipts and invoices print through the browser (Print / Save as PDF); no server-side PDF file is generated.
- WhatsApp/SMS delivery depends on the configured messaging provider; nothing is sent when messaging is off.
- Offline: a bill taken without a connection is queued and sent later (idempotent). The catalogue is not cached
  offline, so the till must have been opened online first; appointments need a connection.
- Package and membership sales have no HSN/SAC line detail beyond the SAC code set on the plan.
- A membership's free-service allowance is per term, not per month.
- Points redemption eligibility is checked on list-price amounts of eligible lines (services/products).
- Payments created by the billing engine carry the database's date (UTC); salon reports use the salon's local day
  from `created_at`, but the general Payments screen still shows the database date (pre-existing behaviour).
- No online booking page for clients yet (the `ONLINE`/`APP` sources and availability API are ready for it).

## 11. Recommended next steps

1. Public online booking page using `/availability` (+ OTP) and a reminder confirm-by-reply.
2. Server-side PDF invoices and WhatsApp document sharing.
3. Membership instalments / auto-renew and per-month free-service allowances.
4. Product-level batch picking at the till for expiry-sensitive retail.
5. Feed `salon_customer_stats` and the ledgers into the AI manager (churn, rebooking, stock forecast) — the data is
   already normalised for it; no AI is faked in this module.
6. Franchise royalty reporting on top of the outlet `ownership` flag.
