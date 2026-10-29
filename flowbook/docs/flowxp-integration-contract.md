# FlowXP to FlowBook integration contract

Status: specification. Facts about FlowXP are from this repository (backend Node/Express + PostgreSQL, money in integer paise, `middleware/idempotency.js` with `Idempotency-Key`, `audit_log`, `modules/gst`, `modules/payments/cashfree.js`, webhook signature verification in `controllers/webhooks.controller.js`, `accountantPack.js`, `backup.js`). FlowBook does not read FlowXP's database. Everything crosses as signed events over HTTPS.

## 1. Source of truth

| Entity | Owner | Other side |
|---|---|---|
| Sale/bill, line items, discounts, tax split, tender types, table/job/membership context | FlowXP | FlowBook holds a read-only copy (`external_documents`) and its journal |
| Customer, supplier master | FlowXP when connected | FlowBook keeps `external_id` and may enrich; conflicts: FlowXP wins for contact data, FlowBook wins for accounting fields (credit terms, GL mapping) |
| Item master and quantities on hand | FlowXP | FlowBook keeps cost layers/valuation only |
| Ledger, chart of accounts, journals, periods, statements, bank reconciliation | FlowBook | FlowXP never writes accounting data |
| GST invoice numbering | FlowXP for POS invoices (it issues them) | FlowBook uses the number as the document number; FlowBook-originated invoices use FlowBook's series |
| Payments at the till | FlowXP | FlowBook records receipt and settlement |
| Bank statement lines, settlement matching | FlowBook | |

A standalone FlowBook organization (no FlowXP) owns everything itself.

## 2. Event envelope
```
POST {flowbook}/v1/integrations/flowxp/events
Headers: X-FlowXP-Signature: t=<unix>,v1=<hmac_sha256(secret, t + "." + body)>
         Idempotency-Key: <event_id>
Body: { "event_id": "uuid", "event_type": "sale.finalized", "schema_version": 1,
        "occurred_at": "...", "business_id": 123, "branch_id": 4,
        "sequence": 18233,          // per business, strictly increasing
        "payload": { ... } }
```
Rules: reject if timestamp skew exceeds 5 minutes; verify HMAC with constant-time compare; store `event_id` in `integration_events` with unique `(connection_id, event_id)`; answer 200 for a duplicate with the original result; process async after durable insert; return 202 on accept. FlowBook enforces per-document ordering using `(document_id, version)`: an event with a lower version than stored is ignored, a gap triggers a pull of the document from FlowXP's read API.

FlowXP side: a **transactional outbox** table written in the same DB transaction as the sale; a worker delivers with exponential backoff (1s to 6h, 12 tries), then parks in a dead-letter state visible in the Integrations Hub with a Replay button. Replays reuse the same `event_id`.

## 3. Events (v1)

| Event | When | Key payload fields |
|---|---|---|
| `sale.finalized` | bill is paid or finalized and invoice number assigned | invoice id/number/date, customer ref, lines (item ref, qty, unit price, discount, tax code, HSN/SAC, tax split CGST/SGST/IGST/cess), charges, round-off, total, place of supply, tenders[] (mode, amount, reference), unpaid amount, status |
| `sale.voided` | a finalized sale is cancelled | invoice id, reason, reversal date |
| `sale.returned` | credit note issued | credit note id/number, original invoice, lines, refund tender |
| `payment.received` | payment against a credit sale or a due | payment id, invoice allocations, mode, reference |
| `payment.refunded` | refund paid | refund id, payment id, amount, mode |
| `purchase.billed` | purchase/GRN bill confirmed | bill number/date, supplier, lines, tax, reverse-charge flag |
| `purchase.paid` | supplier payment | allocations |
| `stock.valuation` | receipt, adjustment, wastage, transfer, consumption | item ref, location, qty delta, unit cost, reason |
| `shift.closed` | till/day close | expected vs counted cash, variance, tenders totals |
| `master.changed` | customer/supplier/item created or edited | the record |

Amounts are integer paise, quantities decimal strings, dates ISO with the business time zone offset.

## 4. Posting rules (FlowBook side)
- `sale.finalized`: one journal keyed `(business, 'sale', invoice_id, 'POST')`. Tenders posted to their clearing accounts (Cash, Card Clearing, UPI Clearing, Wallet); unpaid amount to Accounts Receivable. Tax lines use the tax split in the payload (the rate FlowXP applied is the rate of record, I6). If an item is stock-tracked and FlowXP sends `stock.valuation` consumption for the same sale, COGS is posted from that event, once.
- Split payments: one clearing line per tender. Discounts: net revenue by default (or a Discount Given account, an organization setting). Round-off to the Round Off account.
- `sale.voided`/`sale.returned`: reversal journal linked to the original, never deletion. Refund by tender reverses the same clearing account.
- Gateway fees and settlements arrive later from the bank/gateway import and clear the clearing accounts (journal 18 in accounting-rules.md).
- `master.changed`: upsert `external_ref` maps; a new item without GL mapping uses the category default and raises a "needs mapping" task instead of failing.

## 5. Double-count prevention
1. Exactly one producer of accounting events per sale: FlowXP's `sale.finalized`. Payment-provider webhooks (Cashfree, Razorpay) are **not** accounting events; they only update the gateway reconciliation list and are matched to the existing tender by reference.
2. A direct-entered FlowBook invoice for a customer who also buys at the FlowXP till is a different document; no matching is attempted.
3. If an organization has both an old manual import and the live connection, a **cut-over date** is stored on the connection; events dated before it are accepted into `external_documents` for reference but are not posted.
4. Natural-key guard: unique `(organization_id, source_system, source_type, source_id, posting_kind)` on the posting register.
5. A bulk historical backfill uses the same events with `backfill: true` and is rate limited.

## 6. Offline FlowXP tills
The phone/web till can create sales offline (see OFFLINE_FIRST.md); they receive their invoice number when synced. FlowBook only receives `sale.finalized` after the server has accepted the sale, so offline sales appear in the ledger on sync, dated with the sale's own `occurred_at` (accounting date = business-local date of the sale). If that date falls in a locked period, the event parks as `NEEDS_ATTENTION` with a suggested posting date and the owner chooses; it is never silently moved.

## 7. Failures and replay
Statuses per event: RECEIVED, POSTED, IGNORED_DUPLICATE, IGNORED_STALE, FAILED_VALIDATION, NEEDS_ATTENTION (locked period, missing mapping, unknown tax code), DEAD. The Hub lists them with the payload, error and a Replay action. Replay re-evaluates with current mappings but the original posting rules version is kept in the audit log. A reconciliation job daily compares FlowXP's day totals (sales, tax, tenders per branch) to FlowBook's postings and reports differences.

## 8. Security
Per-connection secret, rotated on demand (old and new valid for 24 hours); IP allow-list optional; organization/business mapping stored server side, never taken from the payload; payload size cap 1 MB; PII minimised (phone numbers are not sent unless the organization enables party sync).

## 9. Versioning
`schema_version` per event type; FlowBook accepts N and N-1; additive changes do not bump the version. A published JSON Schema per event lives in docs/api-specification.md.

## 10. Changes needed in FlowXP (not started)
Outbox table and worker; event builders from invoices/credit notes/payments/purchases/stock; a read API for documents by id for gap repair; connection settings screen (secret, cut-over date); plan feature key for the connector (project convention: every capability gets a `PLAN_FEATURE_KEYS` entry).
