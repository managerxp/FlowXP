# Testing strategy and acceptance criteria

Pyramid: unit (pure money, tax, posting rules) → integration (real PostgreSQL with RLS, triggers, queues) → end-to-end (browser) → security → accounting reconciliation. Use a real Postgres in CI, never a mock, because the constraints are the product.

## 1. Test areas, fixtures, acceptance

| Module | Must test | Fixture | Acceptance |
|---|---|---|---|
| Money | integer paise add/sub/split; no float anywhere (lint rule bans `number` in money types); allocation of ₹100 over 3 lines sums exactly | table of 200 edge cases | 100% pass; property test: sum of parts equals whole |
| Rounding | tax per line half-away-from-zero, round-off line, 0.5 paise cases | `rounding.csv` | matches the CA-approved table |
| GST calculation | intra vs inter state, exempt, nil, zero-rated, cess, reverse charge, rate change on effective date mid-month | seeded tax tables with two versions | each invoice picks the rule by issue date; old invoices unchanged after a new version is loaded |
| Posting | each of the 18 journals in accounting-rules.md | one org per template | debits = credits; account balances as listed; replay gives same entry |
| Balance invariant | random generator creates balanced and unbalanced entries; commit-time trigger | 10k generated | every unbalanced is rejected, no partial rows |
| Immutability | UPDATE/DELETE of posted row as app role | | always errors; reversal path works |
| Idempotency | same `Idempotency-Key` 20 concurrent times; same webhook event twice | | exactly one entry, same response |
| Invoice numbering | gapless per series per FY under concurrency (advisory lock or sequence table) | 50 parallel creates | no duplicates; gaps only from rolled-back drafts and documented |
| Payment allocation | partial, over-payment to advance, multi-invoice, void a payment, refund | | invoice balance and AR control equal sub-ledger |
| Credit notes/refunds | against paid and unpaid invoices, GST reversal | | AR, tax and sales net correctly |
| Period closing | post into locked period, override with permission and reason | | refused/allowed/audited |
| Reports | TB nets to 0; BS balances; P&L equals income minus expense; subledgers equal control; ageing sums equal AR | a 12-month synthetic org with 5k docs | zero differences; drill-down totals equal the cell |
| Inventory | receipt, sale, return, adjustment, transfer, average cost, negative stock case | | inventory account equals valuation report |
| Multi-tenant | every route with org A token and org B ids; RLS with missing `app.org_id`; composite FK cross-link attempt | two orgs | 404/403, never data; query without setting returns zero rows |
| Webhooks | duplicate, out-of-order (version), bad signature, old timestamp, huge body | recorded FlowXP events | right status each time; no double post |
| Retry | worker killed mid-job; DB failover | chaos script | no lost or duplicate postings |
| Offline sync (FlowXP) | sale created offline, synced days later; locked period | | NEEDS_ATTENTION path, no silent move |
| Concurrency | 100 parallel payments on one invoice; two users editing | | no over-allocation; optimistic version conflict message |
| Migration/import | Tally XML, Zoho CSV, Excel with bad rows | sample exports | dry run lists errors; apply is all-or-nothing |
| Permissions | each role × each action matrix | generated from `role_permissions` | matrix test is the spec |
| API validation | bad types, huge numbers, negative qty, XSS in memo | fuzz set | 400 with field errors; output encoded |
| Backup/restore | restore to a new instance, run reconciliation | monthly drill | zero differences, time recorded against RTO |
| AI | questions with known answers; prompt injection in a customer name; asks for something outside the user's permission | golden Q&A set | numbers equal ledger queries; refusals correct; no write tool reachable |

## 2. Accounting reconciliation job as a test
The nightly job runs in CI against the synthetic org: (a) TB = 0, (b) AR/AP/Inventory/Bank/GST control accounts equal sub-ledger sums, (c) sum of invoice totals = sales + tax accounts, (d) FlowXP day totals equal FlowBook postings. Any difference fails the build.

## 3. Definition of done for a module
Unit and integration tests written first for money-moving paths; RLS test for every new table; migration up and down tested on a copy; docs updated; `audit_log` entry exists for every state change; accessibility check for new screens.

## 4. Environments
CI (ephemeral Postgres + Redis), staging with government sandbox credentials and gateway test mode, production. Test data is synthetic; no real GSTINs or bank data outside production.
