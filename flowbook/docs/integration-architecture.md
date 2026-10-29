# Integration architecture and the Integrations Hub

Research basis: research/integration-catalog.md. Costs are unknown until each vendor's price page is read; none is guessed here.

## 1. Hub screens
Available integrations; connected accounts; connection status and health; scopes granted; last sync; sync history; failed records with retry and replay; field mapping; transformation rules; duplicate rules; conflict policy; disconnect and revoke; API keys; webhook subscriptions and delivery log.

## 2. Shared integration framework
- `integration_connections` (provider, encrypted config, status, cutover date) and `integration_events` inbox (unique event id) and `webhook_deliveries` outbox.
- Every provider adapter implements `connect`, `verifyWebhook`, `normalize(event)`, `backfill(range)`, `health()`.
- Retries: 1 s doubling to 6 h, 12 attempts, then DEAD with alert. All handlers idempotent by provider event id.
- Secrets in a secret store or envelope-encrypted columns (key from env/KMS); never in logs; never in source control.
- Rate limiting per connection; circuit breaker after repeated 5xx from a provider.

## 3. Per-integration specification

### 3.1 FlowXP (MVP)
Purpose: automatic books from the POS. Credentials: connection secret created in FlowBook and pasted into FlowXP settings. Auth: HMAC per event. Data flow and mapping: docs/flowxp-integration-contract.md. Webhook events: section 3 there. Retry/reconcile: outbox, inbox, daily totals comparison. Security: secret rotation, skew window. Complexity: high (both sides). Cost: none. Phase: 3 (after core ledger).

### 3.2 Razorpay and Cashfree payment links (MVP)
Purpose: collect invoice payments and reconcile settlements. Credentials: key id + secret (Razorpay), app id + secret (Cashfree), webhook secret. Docs: vendor docs (not read in this pass; read before building). Flow: create a payment link for an invoice → customer pays → `payment.captured` webhook → match by link/reference → post clearing journal → later settlement import clears fees. Events to handle: payment captured/failed, refund processed, settlement. Retry: provider retries; our dedupe by provider event id; nightly pull of the last 3 days to catch missed webhooks. Security: verify signature on the raw body, never trust amount from the client. Complexity: medium (FlowXP's `payments/cashfree.js` is a reference). Cost: gateway fees, *unknown, verify*. Phase: 1 for payment links, 2 for settlement reconciliation.

### 3.3 WhatsApp Business Platform (MVP)
Purpose: invoices, statements, reminders. Reuse the Meta Cloud API module built for FlowXP (templates `flowxp_bill` etc.; FlowBook needs its own approved templates such as `flowbook_invoice`, `flowbook_statement`, `flowbook_due_reminder`). Auth: system user token in env/secret store; webhook verify token. Status webhooks (sent, delivered, read, failed) update `message_log`. Opt-out honoured. Cost: Meta per-message pricing (published by Meta; FlowXP notes list approximate India utility rates, unverified). Phase: 1 for invoice send, 2 for reminders.

### 3.4 Email (MVP)
SMTP or transactional provider, DKIM/SPF per sending domain, bounce webhooks. Phase 1.

### 3.5 Bank statement import (MVP) and bank feeds (later)
CSV/Excel with column mapping templates per bank, OFX/MT940 if available, PDF parsing explicitly out of scope. Duplicate detection by fingerprint hash of date+amount+description+running balance. Bank feeds via an aggregator or the RBI Account Aggregator framework only after a partner is chosen; Zoho uses Yodlee (their help page). Complexity: import low, feeds high. Cost unknown.

### 3.6 GSP for e-invoice, e-way bill and GST filing (Phase 2)
Purpose: IRN/QR, e-way bill, return upload. Credentials: GSP client id/secret per FlowBook plus the taxpayer's GST portal username and OTP authorisation per GSTIN (stored encrypted, short-lived tokens). Flow: invoice ISSUED → schema 1.1 JSON built by `tax` module → GSP → IRP → IRN, ack number, signed QR stored on the invoice → PDF shows QR; cancel path within the allowed window. Retries: IRP duplicate-IRN response must be treated as success by fetching the existing IRN. Test on the government sandbox first (Zoho also offers a sandbox mode per its help list). Complexity: high. Cost unknown. Marketing claim only after sandbox and a production pilot pass.

### 3.7 Public API, OAuth and webhooks (MVP)
REST `/v1`, OpenAPI document, OAuth 2.0 authorization code for third-party apps with scopes like `invoices.read`, `invoices.write`; personal API keys for own use; every call scoped to one organization (as Zoho requires `organization_id`, FlowBook derives it from the token and also accepts `X-Organization-Id` for accountants with several). Webhooks: subscription API, HMAC signature `X-FlowBook-Signature`, delivery history, resend and bulk resend (the same features Zoho documents). Rate limits: per-organization per-minute plus per-plan daily cap, 429 with `Retry-After`. Sandbox: a separate region with fake data and no government calls. Versioning: URL major version, additive-only within a version, 12-month deprecation notice.

### 3.8 Commerce (Shopify, WooCommerce, others) (Later)
Order paid → invoice and payment; refunds → credit note; payout files → settlement reconciliation. Only after FlowXP integration is proven. Prefer a generic "import orders" API that Zapier/Make can drive over building each connector.

### 3.9 Spreadsheets and migration (MVP for Excel/CSV, Phase 2 for tools)
Import masters, opening balances, vouchers from Tally (XML export), Zoho Books (CSV export), Vyapar/Busy (Excel). Dry run, all-or-nothing apply, mapping saved. FlowXP already has this pattern for customers (`/api/customers/import`).

### 3.10 Business intelligence and Google Sheets (Later)
Read-only reporting API and scheduled CSV to storage.

## 4. Data conflicts and duplicates
Policy per entity: source-of-truth wins field-level; duplicates detected by (GSTIN) then (normalised phone) then (normalised name); merge is manual with an audit entry; the Hub lists suspected duplicates.
