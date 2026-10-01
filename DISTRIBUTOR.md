# FlowXP Distributor Management

A distributor buys from **principals** (manufacturers) and sells to **retailers** through a field force and vans. This
module adds that to FlowXP's Wholesale module. It does not duplicate it: orders, pricing, credit, reservation, picking,
delivery, invoicing, receipts, returns, ledgers, notifications, RBAC and audit are the wholesale ones, extended.

For wholesale basics see [WHOLESALE.md](WHOLESALE.md).

## 1. Business type

Settings → Wholesale settings → **Wholesale + Distributor** turns the module on (`wholesale_settings.distributor_enabled`).

| Business | What is shown |
|---|---|
| Wholesale (`WHOLESALE`) | The wholesale module only. Nothing below appears. |
| Distributor (`DISTRIBUTOR`) | Wholesale plus the **Distributor** menu, dashboard and reports. |
| Wholesale + Distributor | A `WHOLESALE` business with the switch on: the same as Distributor. |

Switching it off hides the menu, the dashboard and the distributor reports; data is kept. Every `/api/distributor/*`
route answers 404 while it is off, and distributor reports are absent from the report catalogue.

Other settings: `scheme_stacking` (`BEST` applies the single best scheme per line, `ALL` stacks the stackable ones),
`visit_location` (record GPS on visits), `field_collections` (reps may take payments), `credit_manager_override`
(a manager may confirm an order over the retailer's credit limit).

## 2. What was added

**Reused unchanged:** `products`, `customers`, `suppliers`, `branches` (a warehouse is a branch), `branch_stock` and the
stock ledger, `invoices` and the billing engine, credit notes, `wholesale_*` orders / receipts / deliveries / returns,
the offline queue, audit log, notifications, plans and permissions.

**Tables (migrations 0057–0060, each reversible):**

| Table | Purpose |
|---|---|
| `dist_principals` | Manufacturer, agreement dates, margin %, terms, credit; optionally linked to a `suppliers` row |
| `brands.principal_id`, `wholesale_item_details.principal_id / principal_price_paise / pack_size` | Brand and product ownership |
| `dist_territories` | Tree: `REGION → TERRITORY → AREA`; a retailer sits in one node (`wholesale_customer_profiles.territory_id`) |
| `dist_beats`, `dist_beat_customers` | A salesperson's weekday route; a retailer is on at most one active beat per weekday |
| `wholesale_salespeople` + `employee_id`, `sales_role`, `territory_id`, `manager_id` | The sales hierarchy |
| `dist_targets` | Value or quantity target per business / salesperson / territory / brand / category / product / retailer, per week / month / quarter / financial year |
| `dist_commission_rules` | Value %, per-unit or margin %, scoped, with a minimum-achievement bonus gate |
| `dist_visits` | Visit outcome, notes, GPS, next visit; idempotent on `client_ref` |
| `dist_schemes` (+ `_customers`, `_territories`, `_applications`) | Buy X get Y, quantity discount, value discount |
| `dist_vehicles`, `dist_vehicle_stock`, `dist_vehicle_moves`, `dist_vehicle_reconciliations` | Van register, stock per product and batch, ledger, day-end counts |
| Order columns | `territory_id`, `beat_id`, `visit_id`, `source` (`OFFICE`/`FIELD`/`VAN`), `vehicle_id`, `scheme_discount_paise`, `rejected_by`, `reject_reason`; item `is_free`, `scheme_id` |

Order status gains `REJECTED`; delivery status gains `PARTIAL`.

## 3. Behaviour

**Primary sales** are purchases from principals: the existing purchase order → goods receipt flow, grouped by principal
through `products → principal`. **Secondary sales** are sales to retailers: orders (office or field) and van sales, grouped
by territory, beat, salesperson, brand and principal, always net of credit notes.

**Territory pricing.** A price list can be tied to a territory. Precedence: price agreed with the retailer → their
assigned list → a list for their area, then its parent territory, then region (nearest wins) → promotion → type tier →
product wholesale price; then quantity breaks and MOQ.

**Schemes.** Evaluated when an order is priced (preview, save, confirm and van sale all use the same function).
Eligibility is date range, customer type, named retailers and territories (a scheme for a region covers every area in
it). *Buy X get Y* adds a free line at price 0 (`is_free`), which reserves stock and is picked like any other line;
*repeat* and *max free* cap it. Discounts are kept in `scheme_discount_paise`, separate from the manual discount, so
editing an order re-evaluates cleanly. Free goods are costed (`dist_scheme_applications.cost_paise`) and, for
principal-funded schemes, show as claimable in Principal settlement. Hints ("add 3 more boxes to get 1 free") are
returned with every price preview.

**Vans.** Warehouse → van is a matched pair of stock-ledger entries, as are van → warehouse and counts, so warehouse
stock plus van stock always equals what came in minus what was sold, written off or found missing. A van sale uses the
normal invoice engine with the billing hook `stockHandledElsewhere`, so stock is never deducted twice. The day-end
count books shortages and surpluses as adjustments and can send the rest back.

**Delivery.** Delivery status `PARTIAL`: the customer took some and refused the rest. The refused lines become a sales
return (credit note, stock back or logged as damaged) in the same transaction. Failed and returned deliveries behave as
in wholesale.

**Collections.** Receipts are the wholesale ones; a receipt can carry `visit_id` / `visit_ref`. `COLLECTION_EXECUTIVE`
sees collections and the retailers who owe. Commission can be earned on sales or on collections.

**Credit.** Unchanged: the credit policy (`WARN` / `BLOCK` / `APPROVAL`) and per-retailer limit and terms apply to field
orders too; a manager's override is audited.

**Rejecting an order.** `POST /wholesale/orders/:id/reject { reason }` (pending or confirmed, nothing shipped) releases
the reservation and records who and why.

## 4. Roles and permissions

| Role | Can |
|---|---|
| `DISTRIBUTOR_ADMIN` | Everything in the module |
| `SALES_MANAGER` (wholesale) | Targets, commission, schemes, territories, order approval and rejection |
| `FIELD_SALES` | Own beat, own retailers, own orders and collections; sees only their own figures |
| `COLLECTION_EXECUTIVE` | Collections and outstanding retailers |
| `DELIVERY_MANAGER` | Fulfilment, vehicles and inventory |

New permissions: `principals`, `territories`, `schemes`, `targets`, `vehicles`, `field_sales`, `collections`. Per-user
overrides (Staff → Permissions) work as for every other permission. A field rep's login is linked to a salesperson;
every field endpoint is scoped to that salesperson, and a rep cannot read another rep's retailers, visits, orders or
van (404, not 403). Every table is scoped by `business_id`; ids from another tenant are rejected on write and invisible
on read. Targets, schemes, vehicles, territory and commission changes, order rejection and van counts are audited.

## 5. Screens

Menu → **Distributor** (only when the module is on):

- **Dashboard** (home): sales today / month against target, collections, retailers owe, principals owed, stock, van
  stock, alerts; sales trend, top salespeople / territories / brands, scheme and target tiles. A field rep sees their own.
- **Field sales** (mobile first): today's beat in route order, retailer snapshot (credit, unpaid invoices, offers),
  take order, collect payment, log visit. Works offline: see §7.
- **Principals & brands**, **Territories & beats**, **Sales team & targets** (team, targets with bulk set, commission
  statement), **Schemes** (with performance), **Vehicle stock** (load, sell, count, return).
- Wholesale screens gain: free-line badge, scheme panel and hints on orders, Reject, part delivery, principal / brand /
  pack size / principal price on the product, territory on the retailer, price-list, stock and extended product and
  retailer imports, and the distributor reports.

## 6. Reports

Registered with the wholesale report catalogue (`GET /wholesale/reports`, `/wholesale/reports/:key`), CSV export, and
only listed for distributors: primary sales, secondary sales, sales by territory / beat / brand / principal, profit and
margin (by product, brand, principal, retailer, salesperson, territory or category), vehicle stock, fast-moving and
dead stock, target vs actual, salesperson / territory / beat performance, commission, collections by salesperson and by
territory, principal purchases and sales, brand performance, scheme performance, and **principal settlement** (what you
owe a principal, less returns and claimable scheme cost).

All figures come from one fact definition (`modules/distributor/facts.js`: invoice lines net of credit notes), so the
reports, targets, commission and dashboard cannot disagree.

## 7. Offline

Field sales reuses the app's offline queue (`lib/offline.js`) — there is no second sync engine. A rep with no signal can
record a visit, take an order and collect a payment; each is stored on the phone with an `Idempotency-Key` and sent in
order when the connection returns (or every 20 s while something waits). The visit is created first; the order and the
receipt name it by `visit_ref` (a reference the phone invented), which the server resolves, so they link even though the
visit's id did not exist yet. Replays are safe: visits are unique per `client_ref`, orders and receipts by idempotency key.

## 8. API

Mounted at `/api/distributor` (all tenant scoped, `Idempotency-Key` on money and stock `POST`s):

`dashboard` · `principals`, `brands` · `territories`, `customers/assign`, `beats` · `schemes` (`eligible`, `announce`,
`performance`) · `vehicles` (`load`, `return`, `reconcile`, `sell`, `stock`) · `team` · `targets` (`bulk`) · `commission`
(`rules`) · `visits` · `field/today` · `field/customers/:id` · `import/price-list` · `import/stock`.

Orders, receipts, deliveries and returns stay under `/api/wholesale` and accept the new fields.

## 9. Bulk import

CSV, dry run first, applied in one transaction only if every row is good, errors name the spreadsheet row:
Products (adds Brand, Principal, Pack Size, Principal Price), Retailers (adds Territory, Beat), **Price list**
(SKU, unit, min qty, price or discount %, optional territory, can replace the list), **Stock** (add, or set for a stock take;
batch and expiry for tracked goods).

## 10. Demo data and tests

```bash
cd backend
npm run seed:distributor   # rebuilds the wholesale demo, then layers the distributor on it
```

Sign in `wholesale@flowxp.test` / `demo1234`. Field reps: `wholesale-field1@` and `wholesale-field2@flowxp.test`;
`wholesale-collect@` (collection executive); `wholesale-delivery@` (delivery manager). It creates five principals with
brands and products, a four-region territory tree with retailers placed, two reps with weekday beats, targets and
commission rules, five schemes (running, ending soon, ended), two vans with loads, sales, collections and a count with a
shortage, today's field visits (an order with a free line, a collection, a no-show) and a rejected order. Everything is
created through the real controllers.

```bash
npm test                      # whole backend suite
node --test test/distributor*.test.js
```

`test/distributor*.test.js` covers foundation and tenancy, sales team, schemes, vehicles (including stock conservation),
reports, imports and security (permissions, cross-tenant access, rep scoping, idempotency).
