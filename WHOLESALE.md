# FlowXP Wholesale & Distribution Module

A native module for businesses of type `WHOLESALE` and `DISTRIBUTOR`. It is part of FlowXP — same login, tenants,
warehouses (branches), plans, billing engine, stock ledger, credit/debit notes, messaging and audit log — not a
separate app. For any other business type `/api/wholesale/*` answers 404 and the screens do not load. Nothing in the
restaurant, retail or salon flows changed behaviour.

## 1. Architecture

**Reuse first.** A wholesaler reuses what FlowXP already has and adds `wholesale_*` tables only where there is no
generic home.

| Wholesale concept | Stored in |
|---|---|
| Products, categories | `products`, `categories` (+ `wholesale_item_details`, `wholesale_product_units`) |
| Warehouses | `branches` (+ `wholesale_warehouses`, `wholesale_locations` for bins) |
| Customers, suppliers | `customers`, `suppliers` (+ `wholesale_customer_profiles`, `wholesale_supplier_profiles`) |
| Stock on hand | `branch_stock`, `inventory_transactions` (the shared stock ledger) |
| Reservation | `branch_stock.reserved_qty` (+ per-line `reserved_base`) |
| Batches, expiry, serials | `wholesale_batches`, `wholesale_batch_moves`, `wholesale_serials` |
| Sales invoices | `invoices` / `invoice_items`, created by `createInvoiceInTransaction` (+ `wholesale_invoice_meta`) |
| Customer payments | `payments` rows with a `receipt_id`; `wholesale_receipts` + `wholesale_receipt_allocations` |
| Returns | `credit_notes` / `debit_notes` issue functions (+ `wholesale_returns`, `wholesale_return_items`) |
| Purchase orders | `purchase_orders` (+ `wholesale_grns`, `wholesale_grn_items`) |
| Notifications, messaging | existing notification centre and message templates (`WS_*`) |
| Permissions, plans | existing RBAC (`middleware/auth.js`) and plan features |
| Audit | existing `audit_log` |

**Money** is integer paise in the database and rupees in the API. **Stock** is always in base units; a selling or
buying unit (piece, pack, case, carton, pallet…) carries a conversion factor, so a carton order of 2 against a base
unit of 24 reserves 48.

**One definition of "what is owed".** `modules/wholesale/ledger.js` builds the customer and supplier ledgers and the
ageing; every screen, report, credit check and notification reads from it, so the numbers cannot disagree.

**Pricing precedence** (`modules/wholesale/pricing.js`), first match wins: customer-specific price → the customer's
price list → active promotion → customer-type tier price → product wholesale price; then quantity breaks, MOQ and
the customer's standing discount. `POST /pricing/quote` runs the real pipeline, so the screen and the saved order
cannot differ.

**Order lifecycle.**

```
DRAFT → PENDING (over the approval limit) → CONFIRMED → [pick list] → PACKED → DISPATCHED/DELIVERED
                                              │                                │
                                  reserves stock; the part that      invoice + challan raised in the
                                  cannot be covered becomes a        same transaction; stock leaves
                                  back-order, filled by later GRNs   the warehouse
```

Confirming checks credit (`OFF`, `WARN`, `BLOCK` in settings; an override needs `sales_cancel` and a reason).
Dispatch ships what was actually picked; a short pick returns the rest to the order as a back-order. Expired batch
stock is never available. Damaged goods are tracked in `wholesale_damaged_log` and never count as sellable.

**Atomic flows.** Credit/debit note handlers were split into functions callable inside the caller's transaction, so a
sales return (stock back, credit note, ledger) or a receipt with allocation either completes entirely or rolls back.
`allocateArrivals` uses `SKIP LOCKED` so concurrent receipts cannot deadlock.

## 2. Database

Migrations `backend/migrations/0052`–`0056` are forward-only in production but each has a working `down()`
(verified: all five reverse to zero wholesale tables and re-apply cleanly).

| Migration | Adds |
|---|---|
| `0052_wholesale_foundation` | settings, warehouses, bins, units, price lists, customer prices, customer/supplier profiles, salespeople, counters |
| `0053_wholesale_orders_fulfilment` | sales orders and lines, pick lists, packages, deliveries/challans, invoice meta |
| `0054_wholesale_buying_money` | GRNs, batches and moves, serials, transfers, receipts and allocations, returns, ledger adjustments |
| `0055_wholesale_damaged_stock` | damaged-stock log |
| `0056_wholesale_purchase_units` | unit-aware purchase order lines |

Every table carries `business_id`; every query filters on it. There are no hard-coded tenant IDs or credentials.

## 3. Roles and plan features

| Role | Permissions |
|---|---|
| `OWNER` | everything |
| `MANAGER` | the existing manager set (billing, catalogue, stock, purchases, customers, suppliers, reports) including the wholesale order, cancel, fulfilment, pricing and purchase-approval permissions |
| `SALES_MANAGER` | orders, cancel/close, pricing, customers, receipts, refunds, reports, export |
| `SALES_EXECUTIVE` | orders and customers — **only their own customers and orders** |
| `WAREHOUSE_MANAGER` | inventory, purchases, fulfilment, suppliers |
| `WAREHOUSE_STAFF` | fulfilment (pick, pack) |
| `PURCHASE_MANAGER` | purchases, approvals, suppliers, inventory, supplier payments, reports |
| `ACCOUNTANT` | billing, payments, refunds, expenses, GST, reports, export |
| `DELIVERY` | their own deliveries only |

Per-user overrides in Staff still win in both directions. Plan features gate whole areas:
`wholesale_orders`, `wholesale_fulfilment`, `wholesale_pricing`, `wholesale_batches`.

## 4. API

All under `/api/wholesale`, JSON, bearer token, `x-business-id`/`x-branch-id` headers. Mutating calls are
idempotent where marked (send `Idempotency-Key`). Lists are paginated (`limit`, `offset`) and return
`{ data, meta }`. 124 routes; the groups:

| Area | Routes |
|---|---|
| Dashboard, settings | `GET /dashboard`, `GET/PUT /settings` |
| Products and pricing | `/products` (+ `/lookup`, `/bulk`, `/bulk-price`), `/categories`, `/price-lists` (+ items), `/customers/:id/prices`, `POST /pricing/quote` |
| Customers | `/customers` (+ archive/restore, `/ledger`, `/ageing`, `/invoices`, `/credit`, `PUT /credit-limit`) |
| Sales orders | `/orders` (+ preview, submit, confirm, reserve, cancel, close), `/backorders` |
| Fulfilment | `/fulfilment/summary`, `/orders/:id/pick-lists`, `/pick-lists` (+ start, pick, pack, dispatch, cancel), `/deliveries` (+ challan, status) |
| Inventory | `/warehouses`, `/locations`, `/inventory` (+ alerts, movements, damaged, batches, expiry, product), `/inventory/adjust`, `/inventory/write-off-damaged`, `/transfers` (+ dispatch, receive, cancel) |
| Purchasing | `/purchase-orders` (+ due-in, approve, send, cancel, close-short, payments), `/grns` |
| Money | `/receipts` (+ allocate, reverse), `/refunds`, `/ledger-adjustments`, `/suppliers/:id/ledger` |
| Returns | `/returns`, `POST /returns/sales`, `POST /returns/purchase`, `GET /invoices/:id/returnable` |
| Parties | `/suppliers`, `/salespeople` (+ performance) |
| Reports | `GET /reports`, `GET /reports/:key` — sales (summary, customer, product, category, salesperson, warehouse, order book), purchases (summary, supplier, product, GRN register), stock (valuation, low stock, expiry, slow moving, movement, damaged), money (receivables and payables ageing, customer and supplier outstanding, collections), profit by customer, returns. JSON or CSV. |
| Imports | `POST /import/{products,customers,suppliers}` (validate-then-commit, row-level errors) |

## 5. Screens

`frontend/src/app/wholesale/`, under **Wholesale** in the navigation: Dashboard, Sales orders (list, editor, detail,
print), Warehouse & delivery (to pick, pick lists, deliveries, challan and pick-sheet print), Customers (profile with
ledger, ageing, prices, credit), Products & pricing (units, tiers, price lists, labels with barcodes), Inventory
(stock, batches, expiry, movements, damaged, transfers), Purchasing (orders, due-in, GRNs), Suppliers, Receivables &
payables, Returns, Reports, Wholesale settings. Built on the shared design system; works at 390 px.

## 6. Notifications

Background checks (`modules/wholesale/scans.js`) raise deduplicated notifications for overdue invoices, supplier
payments falling due, low stock and expiring batches; templates `WS_ORDER_CONFIRMED`, `WS_DISPATCHED`,
`WS_PAYMENT_REMINDER` etc. go through the existing messaging providers. Which events notify, and where, is set in
Wholesale settings.

## 7. Demo data

```bash
cd backend
npm run seed:wholesale
```

Builds **Sunrise Distributors** through the real controllers (no direct inserts of business documents, except
back-dating timestamps so ageing and trends have a shape): 2 warehouses with bins, 3 salespeople, 5 suppliers, 20
products with units and batches, 3 price lists, 18 customers, 45 days of orders (confirm → pick → pack → dispatch →
deliver), receipts, a bounced cheque, an advance, returns, and a live floor today (out for delivery, a failed
delivery, packed, being picked, to pick, back-ordered, pending approval, draft). Re-running replaces the demo
business. Sign in with `wholesale@flowxp.test` / `demo1234`; the other staff accounts are
`wholesale-sales@`, `-exec@`, `-warehouse@`, `-picker@`, `-purchase@`, `-accounts@`, `-driver@` (same password).

## 8. Tests

`backend/test/wholesale*.test.js` — 47 tests across catalogue and pricing, orders and reservation, fulfilment,
receipts/returns/purchasing, reports, and security (role and tenant isolation, plan gating, read-only roles,
executive and driver scoping). Each file builds its own temporary database.

```bash
cd backend && npm test
```

Two tests outside this module fail on the base branch as well (GSTR-1 totals; subscription admin history) and are
unrelated to wholesale.

## 9. Known limits and next steps

- Reservation is per warehouse; an order cannot be split across warehouses automatically (use a transfer).
- Serial numbers are recorded at pick time; there is no serial-level return matching yet.
- E-way bills and e-invoices are not generated automatically at dispatch; use the existing GST screens on the invoice.
- No customer self-service portal or EDI; orders are entered by staff or salespeople.
- Route planning and van load optimisation are not included; delivery assignment is manual.
- Next: auto-split across warehouses, landed-cost allocation on GRNs, scheme/promotion stacking rules, scheduled
  statement emails.
