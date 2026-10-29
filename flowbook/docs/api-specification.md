# FlowBook API specification (draft v1)

Base: `https://api.flowbook.example/v1` (domain not decided). OpenAPI 3.1 will be generated from the NestJS code and published; this file fixes the conventions. Design is informed by what Zoho publishes for its API (organization scoping, regional domains, per-plan quotas, webhook management) without copying it.

## 1. Conventions
- JSON, UTF-8. Amounts are integers in minor units (paise) plus `currency`; quantities and rates are decimal strings. Dates ISO 8601; business dates `YYYY-MM-DD`.
- Auth: `Authorization: Bearer <token>`. Tokens are OAuth 2.0 access tokens (authorization code + PKCE, 1 h) or personal API keys (`fbk_...`, hashed at rest, scoped, revocable). Refresh tokens rotate.
- Organization: derived from the token; accountants with several organizations send `X-Organization-Id`; the server checks membership.
- Idempotency: `Idempotency-Key` required on POST/PUT that create or change money; same key + same body returns the first response; same key + different body returns 422. Keys kept 24 h.
- Pagination: cursor (`?limit=50&cursor=...`), max 200. Filtering by `updated_since`.
- Errors: `{ "error": { "code": "period_locked", "message": "...", "field": null, "request_id": "..." } }` with HTTP 400/401/403/404/409/422/429/5xx. 409 for version conflicts (`If-Match: <version>`).
- Rate limits: per organization per minute and per day by plan; headers `X-RateLimit-Remaining`, `Retry-After` on 429.
- Versioning: major in URL; additive changes allowed; deprecation notice 12 months.

## 2. Scopes
`org.read`, `accounts.read/write`, `journals.read/write`, `invoices.read/write`, `bills.read/write`, `payments.read/write`, `parties.read/write`, `items.read/write`, `banking.read/write`, `reports.read`, `tax.read`, `webhooks.manage`, `integrations.manage`, `admin`.

## 3. Resources (main endpoints)
| Resource | Endpoints |
|---|---|
| Organization | GET /org; PATCH /org; GET /org/branches; POST /org/branches |
| Accounts | GET/POST /accounts; GET/PATCH /accounts/{id} |
| Journals | GET/POST /journals; GET /journals/{id}; POST /journals/{id}/post; POST /journals/{id}/reverse |
| Parties | GET/POST /parties; GET/PATCH /parties/{id}; GET /parties/{id}/statement |
| Items | GET/POST /items; GET/PATCH /items/{id} |
| Invoices | GET/POST /invoices; GET/PATCH /invoices/{id}; POST /invoices/{id}/issue; POST /invoices/{id}/void; POST /invoices/{id}/send; GET /invoices/{id}/pdf |
| Credit notes | GET/POST /credit-notes; POST /credit-notes/{id}/issue; POST /credit-notes/{id}/apply |
| Bills | GET/POST /bills; POST /bills/{id}/post; POST /bills/{id}/void |
| Payments | GET/POST /payments; POST /payments/{id}/allocations; POST /payments/{id}/void |
| Banking | GET/POST /bank-accounts; POST /bank-accounts/{id}/imports; GET /bank-transactions; POST /bank-transactions/{id}/match; POST /reconciliations |
| Tax | GET /tax-codes; GET /tax/registers/sales; GET /tax/registers/purchases; GET /tax/gstr1?period=; GET /tax/gstr3b?period= |
| Reports | GET /reports/trial-balance, /profit-and-loss, /balance-sheet, /cash-flow, /ledger, /ageing/receivables, /ageing/payables ; params `from`, `to`, `branch_id`, `compare` |
| Webhooks | GET/POST /webhooks; PATCH/DELETE /webhooks/{id}; GET /webhooks/{id}/deliveries; POST /webhooks/deliveries/{id}/resend; POST /webhooks/deliveries/bulk-resend |
| Integrations | GET /integrations; POST /integrations/{provider}/connect; POST /integrations/flowxp/events (inbound, signed) |

## 4. Document state transitions in the API
`POST /invoices/{id}/issue` is the only call that posts to the ledger. It returns the invoice with `journal_entry_id`. `PATCH` on an issued invoice is allowed only for non-financial fields (memo, attachments); financial changes use void + new invoice. `409 period_locked` if the date falls in a locked period without permission.

## 5. Webhook payload
```
POST <subscriber url>
X-FlowBook-Event: invoice.issued
X-FlowBook-Delivery: <uuid>
X-FlowBook-Signature: t=<unix>,v1=<hmac_sha256(secret, t + "." + body)>
{ "id":"evt_...", "type":"invoice.issued", "created":"...", "organization_id":"...", "data":{ ... } }
```
Event types: invoice.issued/voided/paid, payment.received/voided, bill.posted, journal.posted, bank_transaction.imported, period.locked, integration.failed. Retries 1 s doubling to 6 h, 12 attempts; 2xx stops; the log shows each attempt; replay from history.

## 6. Sandbox
Separate base URL and data region; fake GSP and gateway adapters; `X-Sandbox-Clock` header to move time for testing recurring and ageing.

## 7. Open points
OAuth app registration flow and review; API pricing; SDKs (generate from OpenAPI, publish only if there is demand).
