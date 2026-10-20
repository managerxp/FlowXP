# Auto spare parts (business type `AUTO_PARTS`)

A parts shop for cars, bikes and scooters: a counter, a warehouse with racks and bins, and garages that buy on credit. It is a module on top of the FlowXP retail engine, not a second system. A part is a
`products` row (so billing, GST, stock, offers, returns, import and the till all work as they do for any shop) with a 1:1 parts profile beside it.
Plan and decisions: `AUTO_PARTS_PLAN.md`. Demo shop: `npm run seed:autoparts` (Sharma Auto Parts; autoparts@flowxp.test / demo1234).

## The rules the code keeps

1. **The ledger is the truth.** `branch_stock` (written only by `moveStock`) is the one stock total. Bins hold part of it: `sum(bin_stock.qty) <= branch_stock.quantity` for every part and outlet. The remainder is *unassigned*
   (received or returned, not yet shelved). `moveStock` calls `trimBins` (modules/autoparts/binHook.js) on every stock decrease, so a sale, a write-off, a transfer out, a debit note or a count shortage takes from the shelves
   (the bin asked for, then the primary bin, then the fullest; reserved quantity last) without any caller knowing bins exist. Put-away, bin moves and picks move quantity between unassigned and bins and never change the total.
   `GET /autoparts/warehouse/reconcile` proves the invariant. Increases (receipts, returns, counts) arrive unassigned.
2. **Fitment is never assumed.** `part_fitment` is VERIFIED / UNVERIFIED / NOT_FIT per vehicle model (optionally variant and years). NOT_FIT wins, copies and hand entries are UNVERIFIED, alternates come only from VERIFIED rows,
   and a part with no row is "no fitment on record". There is no built-in vehicle database; makes, models and variants are entered or imported per business.
3. **Only accepted stock is sellable.** A receipt is received = accepted + damaged + rejected. Accepted goes to stock (and a bin or a put-away task), damaged goes to the damaged log, rejected is recorded and goes back.
4. **Idempotent, concurrency-safe.** Put-away, move and receipt accept `Idempotency-Key` / `source_key` (a retry changes nothing); stock rows are locked, so two sales of the last unit, two holds of the last unit, or a sale during a bin move cannot break the invariant.
5. **Suggestions never write.** Everything in `modules/autoparts/intelligence.js` is read-only and states its rule. No AI path changes stock, price or fitment.

## Data (migrations 0095 to 0099, forward only)

| Table | Purpose |
|---|---|
| `autoparts_parts` | 1:1 profile on `products`: OEM / manufacturer number, classification, vehicle type, pack, min / max / reorder, preferred supplier, specs, size, handling |
| `autoparts_part_numbers` | every number a part is known by, with a normalised `key` (upper-case letters and digits) for dash-free search; searched by the shared `searchClause` and `findByCode` |
| `vehicle_makes / models / variants`, `part_fitment` | the shop's own vehicle list and the fitment records |
| `autoparts_settings` | per business: names of the location levels, count-approval limit, safety / review / slow / dead days |
| `warehouse_locations` | tree (up to 6 levels), code unique per outlet, QR token, `can_store`, capacity |
| `bin_stock`, `bin_moves`, `putaway_tasks` | quantity per bin (with damaged and reserved), the signed history (with `source_key`), open put-away jobs |
| `wholesale_grns / items` (reused) + `rejected_base`, `bin_location_id`, `cancelled_*` | receipts |
| `part_reservations`, `autoparts_price_lists(+items)`, `autoparts_customer_profiles` | holds, trade prices, class and credit limit |
| `part_returns`, `supplier_claims` | why a part came back and what became of it; what suppliers owe |

Role CHECK gains `STOREKEEPER` and `PARTS_COUNTER`.

## Permissions, roles, plan features

Permissions (server enforced, owners hold all): `parts_catalog`, `warehouse`, `grn`, `stock_approve`, `stock_count`, `returns_process`, `price_change`, `valuation`, `warehouse_settings`; reused: `billing`, `inventory`, `purchases`,
`reports`, `refunds`. Roles: `STOREKEEPER` (warehouse, grn, stock_count, inventory, suppliers), `PARTS_COUNTER` (billing, customers, payments). Plan features (all off for other business types): `ap_catalog`, `ap_racks`, `ap_grn`,
`ap_transfers`, `ap_counts`, `ap_pricing`, `ap_intelligence`. (`ap_transfers` and `ap_counts` are registered for per-plan gating; the transfer and count screens are the retail ones, see "Not built".)

## API (`/api/autoparts/*`, AUTO_PARTS businesses only; others get 404)

Catalogue: `GET/POST /parts`, `GET /parts/lookup?q=`, `GET /parts/duplicates`, `GET /parts/:id`, `PUT /parts/:id/profile`, `POST|DELETE /parts/:id/numbers`, fitment `POST /parts/:id/fitment`, `PUT|DELETE /fitment/:id`, `POST /parts/:id/fitment/copy`,
`GET /parts/:id/fitment/check`, `GET /parts/:id/alternates`; vehicles `GET /vehicles`, `GET /vehicles/parts?model_id=`, makes / models / variants create and update, `POST /vehicles/import` (check, then `commit: true`).
Warehouse: `GET /locations` (tree with roll-ups), `GET /locations/scan?code=` (typed code or `FXB:` token), `POST /locations`, `POST /locations/bulk`, `GET|PUT /locations/:id`, `POST /warehouse/put-away`, `POST /warehouse/move`,
`PUT /parts/:id/primary-bin`, `GET /parts/:id/locations`, `GET /parts/:id/pick?qty=`, `GET /warehouse/unassigned|tasks|reconcile`, `GET|PUT /warehouse/settings`.
Receiving: `GET /grns`, `GET /grns/:id`, `POST /grns` (items: `received, damaged, rejected, unit_cost, bin_id`), `POST /grns/:id/cancel`.
Selling: `GET|POST /reservations`, `POST /reservations/:id/release`, price lists, `GET|PUT /customers/:id/terms`, `GET /customers/:id/credit-check?amount=`. Billing (`POST /api/invoices`) for this type: unit price from the customer's price list,
available = on hand minus held for others, a customer's own hold is used up, a bill left unpaid is credit and the limit applies (BLOCK refuses with code `CREDIT_LIMIT`), `unit_factor` other than 1 is refused, an offline sale that leaves a part below zero is
flagged "Taken offline. Check: ...". Returns: `POST /api/invoices/:id/credit-notes` with `return_reason` (WRONG_PART, DEFECTIVE, NOT_REQUIRED, TRANSIT_DAMAGE, FITMENT, WARRANTY, OTHER), `disposition` (RESTOCK, DAMAGED, SUPPLIER, SCRAP) and optional `bin_id`;
`GET /returns`, `GET|POST /claims`, `POST /claims/:id/resolve`. Stock counts are the retail counts (`/api/retail/counts`); for this type a count with differences above the shop's limit needs `stock_approve` to apply.
Reports: `GET /overview`, `/reports/movers|ageing|reorder|suppliers|valuation|occupancy` (`?format=csv`), `GET /parts/:id/together`, `GET /parts/:id/ledger`.

## Screens (`frontend/src/app/autoparts/*`, nav group "Spare parts")

Overview, Parts (search, add, part detail with numbers / vehicles / where it is / movements), Vehicles (find parts for a vehicle, makes and models, import), Racks and bins (layout, put away, move stock, settings, labels at `/app/parts/labels?ids=`),
Receive parts, Trade and accounts (holds, price lists, garage accounts, supplier claims, returns), Parts reports.

## Tests

`backend/test/autoparts{Catalog,Warehouse,Receiving,Sales,Returns,Reports}.test.js` (real Postgres per file). Performance: `node scripts/perf-autoparts.js 10000,100000`.

## Workshop: job cards, staff and payroll (migration 0109; plan features `ap_jobcards`, `ap_staff`)

A vehicle in for service gets a **job card** (`job_cards`, `job_card_lines`; `modules/autoparts/jobcards.js`, `/api/autoparts/jobcards`). It names the customer, the vehicle (registration, make and model from the shop's own list, odometer), the complaint, the
mechanic (an `hr_employees` row) and a promised date, and moves OPEN > IN_PROGRESS > WAITING_PARTS > READY > BILLED (or CANCELLED). **Parts** put on a card are *held* for its customer (the existing reservations), so the counter cannot sell them; a part
the shop lacks can be quoted with `allow_short`, unheld. Each part line shows its fitment for the card's vehicle (VERIFIED, UNVERIFIED, NOT_FIT, UNKNOWN); a NOT_FIT part is flagged, never hidden. **Labour** is a typed line with the shop's labour GST rate
(`autoparts_settings.labour_tax_rate`, 18). A price below the list price needs `price_change`. **Billing** (`POST /jobcards/:id/bill`) makes one ordinary invoice through `createInvoiceInTransaction` for the same customer, so billing uses the holds up and takes the
stock, GST, payments, credit limits and returns work as at the counter; a card never moves stock itself, and cancelling releases every hold. `GET /jobcards?reg=` is a vehicle's history, `GET /jobcards/due` the services whose next date is near (the ones to phone).

**Staff and payroll** reuse the hotel engine (`controllers/hotelStaff.controller.js`, `modules/hotel/staff.js`, tables `hr_*`) mounted at `/api/autoparts/staff/*` (no housekeeping routes). A mechanic is an employee; `hr` covers records, roster, attendance and leave, `payroll` covers pay
(a person with only `hr` never sees a salary). The screens start on the real calendar day (a hotel's date moves with its night audit) and a new workshop starts with Workshop, Parts counter, Stores, Accounts and Management departments and Day / Late shifts. The sheet is a payroll SHEET:
salary, days worked, overtime, allowances and deductions; it does not work out PF, ESI, professional tax or TDS. Web: Job cards and Staff under "Spare parts" (`/app/parts/jobs`, `/app/parts/staff`, the staff pages shared with the hotel through `lib/staffBase.js`). Phone: More > Job cards, More > Staff.
Tests: `backend/test/autopartsJobcards.test.js`.

## Not built (said plainly)

- Job cards: no printed job card or estimate document, no photos of the vehicle, no customer approval step, no mechanic time tracking or labour commission, no checklist templates per service type, no warranty on a job.
- Reminders for a due service are a list to phone, not an automatic message.

- No vehicle or fitment database; no VIN lookup. (Job cards and labour now exist: see "Workshop" below.)
- The billing till has no vehicle picker: it searches by name, SKU, barcode and any part number (OEM numbers included). "Find parts for a vehicle" is its own screen.
- Per-bin stock counts, and inter-outlet transfers with a bin chosen at both ends: the retail count and outlet transfer move the stock (and shelves are trimmed automatically); the receiving outlet puts the stock away.
- Per-part trade prices have an API (`PUT /price-lists/:id/items/:pid`) but no screen yet.
- Ageing is by last receipt, not by layer. No serial or warranty tracking per unit. Fast / slow / dead is by sales only.
- Offline: billing works offline as before; racks, receiving, counts and fitment need a connection. The offline catalogue does not carry part numbers or bins yet, so an OEM-number search offline finds nothing.
- Phone app screens, hardware scanner / printer testing, e-commerce sync.
