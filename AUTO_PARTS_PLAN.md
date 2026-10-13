# Auto spare parts: assessment and plan (2026-10-12)

Written before the build and kept as the record of why it is shaped this way. Status at the end of each phase is in the last section. What exists today is in `AUTO_PARTS.md`.

## Assessment: what FlowXP already had

Reused as it is: the product master (SKU, barcodes, aliases, supplier codes, MRP, trigram search: `products`, `product_barcodes`, `modules/productIdentity.js`); the stock ledger (`moveStock`, `branch_stock`,
`inventory_transactions`); `createInvoiceInTransaction` (GST, split payment, pay later, offers, discount cap, idempotency); credit notes; purchases, supplier prices, debit notes; outlet transfers; retail stock center and counts; wholesale
GRN, damaged log, transfers; label printing (`barcodeSvg`, `qrcode`); `recordAudit`, `idempotent()`, `branchFilter`, plan-feature gating, CSV helpers.

Missing: vehicle catalogue and fitment; part-number families searchable by any number; a rack hierarchy with **per-bin quantities** (only a flat location list and one default bin existed, with no quantity); bin-aware receiving,
moves and counts; GRN reject and cancel; retail reservations; garage price lists and enforced credit in the retail till; return reasons and dispositions; supplier claims; ageing, dead stock, fast and slow movers.

Risks found: `unit_factor` was not checked against a product's units in billing (stock could be under-deducted); an offline retail sale that oversold left no flag; the `CREDIT` payment method marks a bill paid, so it must not be used for
garage accounts (pay-later is used); retail billing ignored `reserved_qty`; PO receive writes the wrong batch table (not touched, not on this path); purchases are always treated as intra-state; the sales report does not net credit notes;
38 direct `moveStock` callers exist, so a bin layer cannot rely on each caller.

## Decisions

1. **New business type `AUTO_PARTS`**, in the retail family (till, stock center, offers, returns apply), with its own module `modules/autoparts/*` and routes `/api/autoparts/*`. Not forced through wholesale or distributor screens.
2. **Part profile beside the product** (`autoparts_parts`), not a second product table. Parts stay `kind = 'DISH'` (the existing constraint), shown as "Part".
3. **Part numbers in their own table** with a normalised key, searched by the shared product search, so every till and screen finds a part by OEM number.
4. **Vehicle catalogue per business, entered or imported; fitment records with a status.** No invented data, no assumed fit.
5. **Racks and bins on top of the ledger, not beside it.** `bin_stock` holds part of `branch_stock`; one hook in `moveStock` keeps the invariant for every caller. The alternative (editing 38 callers, or a second stock total) was rejected as the
   likeliest way to drift.
6. **Reuse the wholesale GRN** (purchase order or direct purchase, tax, payables, duplicate-invoice check) through a thin wrapper that adds rejected quantity, bins and put-away tasks, and cancel.
7. **Reuse retail counts and outlet transfers**; add the approval rule for count differences.
8. **Trade pricing and credit** as customer profile + price list; garage sales use pay-later; the limit is enforced in billing for this type only.
9. **Intelligence is deterministic and read-only**, with the rule shown beside every suggestion. AI never writes.
10. **Offline:** billing keeps the existing queue, plus an "offline sale left stock below zero" flag for this type; everything else is online-only and says so.
11. **Permissions server-side**, scoped by outlet; two roles (`STOREKEEPER`, `PARTS_COUNTER`); seven plan feature keys, all off for other types.

## Phases and status

| Phase | Scope | Status |
|---|---|---|
| 1 Foundation | type, wiring, roles, permissions, plan keys, search by part number | done, tested |
| 2 Catalogue | profile, numbers, vehicles, fitment, search, duplicates, import | done, tested (12 tests) |
| 3 Warehouse | locations tree, bins, put-away, moves, labels, occupancy, reconciliation, bin hook in `moveStock` | done, tested (18 tests) |
| 4 Operations | GRN with reject, put-away and cancel; holds; returns with disposition; supplier claims; count approval; adjustments and transfers via the retail screens | done, tested (receiving 9, returns 5, sales 11 tests); per-bin counts and bin-aware outlet transfers **not built** |
| 5 Sales | trade price, credit limit, holds in billing, unit guard, offline flag | done, tested; **no vehicle picker in the till**, offline catalogue lacks part numbers and bins |
| 6 Reports | overview, movers, ageing, reorder, bought together, supplier performance, valuation, occupancy, ledger, CSV | done, tested (11 tests) |
| 7 Security and testing | permissions per route, tenant isolation, concurrency, regression, perf script | done for what exists; see the test list in the final report |
| 8 Production readiness | seed shop, website page, docs, screens | done; nothing pushed |
