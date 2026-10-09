# FlowXP mobile: the offline-first pattern (the note every business type follows)

Written 2026-10-08. Read this before adding offline use to any business type in the app.

## The idea in one paragraph
The phone keeps a **small local SQLite database** (a copy, not the truth). The **server and its PostgreSQL stay the authority**. At the counter the app works from the local copy and a **queue of things to send**; when the internet is there, the queue is sent to the same backend the website uses, and the copy is refreshed. Nothing is decided on the phone that the server does not re-check.

```
 counter  ->  local copy (products, customers, ...)   <- delta sync from server (GET /sync/head, /sync/changes)
   |
   +-> sale/change with no internet -> QUEUE (outbox, actions) -> sent later, same Idempotency-Key -> server validates -> invoice
```

Is this a good approach? **Yes**, for a counter that must never stop selling and that has patchy internet. It is the right shape here because the server already owns numbering, tax, offers, stock and audit. The cost is that **the phone's copy can be stale**, so the server must check every queued thing again and a person must be able to see what it was unsure about. Everything below exists for those two reasons.

## The five pieces (all in `mobile/src/lib/`)
| Piece | File | What it does |
|---|---|---|
| Local database | `db.ts`, `local.ts`, `migrate.ts` | One SQLite file per business+outlet. One connection, one operation at a time. Numbered upgrades (`PRAGMA user_version`); only ever add. |
| Catalogue copy | `catalog.ts` | Products, barcodes, option groups, customers. Full download once, then deltas from the server's `sync_log`. `COPY_VERSION` forces a re-download when what is kept changes. |
| Sales queue | `outbox.ts`, `till.ts` | A sale made with no signal is kept with its Idempotency-Key and sent later, oldest first, once. Each entry remembers **where it goes** (`path`: `/invoices`, `/pharmacy/pos/invoices`, ...). |
| Changes queue | `actions.ts` | Offline price and stock changes, sent after the sales. |
| Sync driver | `sync.ts` | Sends bills, then changes, then refreshes the copy. Polls fast (20 s) while something is waiting, slow (2 min) otherwise. |

## The rules (never break these)
1. **A sale is never lost and never made twice.** Every queued sale carries an `Idempotency-Key`; the server also keeps it on the invoice (`invoices.client_key`) so a replay days later (after the 48-hour guard has forgotten) returns the same bill.
2. **The body of a retry is byte-identical to the first try.** The server's duplicate guard compares bodies. Offline-ness and the sale date travel in **headers** (`X-Offline-Sale: 1`, `X-Sale-Date`), never the body.
3. **Only "could not reach the server" queues.** A refusal (bad coupon, archived product, missing prescription check) is shown to the person, not queued behind their back.
4. **The server refuses nothing for stock when the goods are already handed over.** It records the sale, lets stock go negative, and **flags it for review**. A person decides; nothing is dropped.
5. **Refused when it arrives = parked with the reason**, never blocking the sales behind it, never deleted on its own.
6. **Dates:** an offline sale is dated the day it was taken if that is within the last 7 days (and not later than tomorrow); otherwise the phone clock is not believed and it is dated today.
7. **Totals shown offline are "about".** The server prices the bill when it arrives. The phone also sends the total it showed (`expected_total`) so the server can flag a price that changed.
8. **Plain words on screen, Hindi for every text.** (Enforced by tests.)

## What the server must do for a business type to be offline-capable (the checklist)
- [ ] Its sale endpoint honours `Idempotency-Key` **and** stores it on the invoice (`client_key`).
- [ ] It reads `X-Offline-Sale` / `X-Sale-Date`: relaxed stock rules, believed date, never refuses for stock.
- [ ] It **re-validates everything the phone could not know**: batch status and expiry, prescription, price, stock; and returns `review: [...]` (written on the bill's notes and in the audit log too).
- [ ] The details the phone needs offline travel in the catalogue copy (`/sync/*`), with a trigger so changing them counts as a change to the product (see migrations 0074, 0075, 0077), and `COPY_VERSION` is bumped.
- [ ] Tests: refusal rules still hold offline where they must (prescription), replay is exact, wrong clock is not believed, price change is flagged.
- [ ] A drill against a real server (`mobile/scripts/e2e-*-offline.ts`): network off, sell, network on, sent once, flagged, replay safe.

## Status per business type (2026-10-08)
| Business | Local copy | Offline sales | Offline changes | Notes |
|---|---|---|---|---|
| Restaurant, cafe, cloud kitchen, retail, supermarket, services, electronics, clothing, other | yes | yes (`/invoices`) | price, stock | table orders and kitchen need internet |
| **Pharmacy** | **yes (with medicine details)** | **yes (`/pharmacy/pos/invoices`)** | via the general screens | **see below** |
| Salon | no | **no** (needs live staff, memberships, packages, gift cards) | no | online only for now |
| Wholesale, distributor | yes (with wholesale prices, minimum order, carton sizes) | **field reps: yes** (visit, order, payment queued in order, sent once each) | via the general screens | the office's own order and collection screens stay online. Orders arrive PENDING; credit and stock are decided when the office confirms. Needs: catalogue for field role (`sales_orders`), durable keys on orders and receipts (0078) |

## Pharmacy: what is validated, and when
**On the phone, before the bill (works offline):** the medicine list is the phone's own copy, searchable by name, salt, maker or barcode. A medicine that needs a prescription cannot be billed until "I have checked the prescription" is ticked; doctor and patient names go into the bill's note. Quantity above the (stale) shelf hint is warned.

**On the server, when the sale arrives (online or replayed) -- `modules/pharmacy/pos.js`:**
| Check | Online | Arriving from the offline queue |
|---|---|---|
| Prescription medicine without `prescription_checked: true` | refused (400 `PRESCRIPTION_NOT_CHECKED`) | refused, parked with the reason |
| Not enough stock / batches | refused (409) | **recorded**, stock goes negative, flagged: "N more sold than the batches held" |
| Earliest-expiry (FEFO) batch, skipping held-back, recalled, blocked and expired batches | picked by the server | picked by the server at arrival |
| Price changed since the phone last synced | n/a | flagged: "the phone showed X, the server priced it at Y" |
| Sale date | today | the day it was taken (within 7 days) else today |
| Same Idempotency-Key again | same bill | same bill, even after 48 hours |
| Audit | `pharmacy.sale_completed` | same, with `offline: true` and the `review` list |

The bill's notes read `Taken offline. Check: ...` so the owner sees it on the website too. On the phone the sent entry keeps the same "Check: ..." text under Bills, Waiting to send.

**Deliberately not offline for pharmacy:** choosing a specific batch (the server picks at arrival), receiving a delivery (GRN), holding back or recalling a batch, adding or editing a medicine. They need live stock and are online-only.

**A held-back or recalled batch and an offline sale:** a medicine sold from a batch that was recalled while the phone was offline is already in the customer's hands. The server cannot undo that; it sells from a still-good batch and the recall is visible on the batch screen. If that matters to you, raise the sync frequency or add a "recall notice" push later.

## How to add the next business type
1. Copy the pharmacy pattern: add `path` in the outbox entry, a `sendEntry` that reads the till's own response shape, a till component that tries online first (timeout 8 s) then queues.
2. Put the server checklist above in a backend test file named `<type>Offline.test.js` (see `backend/test/pharmacyOffline.test.js`).
3. Add `scripts/e2e-<type>-offline.ts` and a `npm run e2e:<type>:offline`.
4. Update the table above and `MOBILE.md`.

## Related
- `MOBILE.md` (plan and status), `MOBILE_AUDIT.md` (risks; item 5 is the offline-header abuse decision), `HANDOFF.md` (how to continue on another laptop).
- Code: `backend/src/modules/pharmacy/pos.js`, `backend/src/controllers/pharmacyPos.controller.js`, `backend/migrations/0077_sync_pharmacy_details.js`; `mobile/src/lib/PharmacyTill.tsx`, `mobile/src/lib/pharmacy.ts`.

## Field sales (distributor) -- what is validated, and when
| Check | When the order arrives from the offline queue |
|---|---|
| Visit | named by the phone's own `visit_ref`; the visit is sent first, an order for a visit the server has not seen is refused and parked |
| Same key again | the same order or receipt, even after 48 hours (key kept on the document) |
| Price | the server prices with the shop's own price list and offers; a price HIGHER than the phone showed is written on the order ("Check: the phone showed X, the server priced it at Y"); lower is not flagged |
| Credit and stock | decided when the office confirms the order (it arrives PENDING), as for any order |
| Minimum order, archived product | refused when it arrives, parked with the reason, never dropped |
| Who | a field rep may only work shops on their beats (the server's rule, unchanged) |

## Van sales (distributor) and the office's view
| Check | When the van sale arrives from the offline queue |
|---|---|
| Same key again | the same bill (the key is kept on the order and the invoice) |
| Van stock | takes what the van holds, never negative; "N more sold than the van held" is flagged (online: refused) |
| Credit limit | recorded and flagged "over their credit limit" (online: refused unless a manager overrides) |
| Total the shop was shown | a difference either way is flagged, because money may already have been taken |
| Date | the day it was made (within 7 days), else today |
| Visit | named by `visit_ref`; sent first |

**The office sees it on the web app:** every bill and wholesale order made offline carries `offline` and, when there is something to look at, `review` (the "Check: ..." text). Invoices page: "Needs a look (N)" tab and a "Taken offline · check" label per row; the bill page shows a notice that is never printed on the customer's copy; Sales orders page: "Needs a look" stage. API: `GET /invoices?review=true`, `GET /invoices/summary` (`offline`, `to_check`), `GET /wholesale/orders?review=1`. Any new offline business type reuses `offlineInfo()` and writes its notes as "Taken offline. Check: ...".
