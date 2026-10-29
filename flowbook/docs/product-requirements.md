# FlowBook product requirements

Owner: ManagerXP Private Limited. Status: draft for owner review. Research basis: research/*.md (accessed 2026-10-29).

## 1. Vision, mission, positioning
**Vision:** every small Indian business has books that are always correct, because they are written by the same system that takes the sale.
**Mission:** turn transactions, stock, payments and tax into reliable financial statements without double entry.
**Positioning line:** "An intelligent accounting and financial management platform that connects business transactions, inventory, payments and financial insights in one place."
**Not a goal in version 1:** payroll statutory filings, multi-country tax, ERP, bank-feed breadth, direct government filing.

## 2. Operating models
1. **Standalone:** a business keeps its books in FlowBook with its own invoices, bills and bank imports.
2. **Integrated:** a FlowXP business connects FlowBook; sales, returns, payments, purchases and stock valuation flow in as events (flowxp-integration-contract.md). The owner or accountant never re-keys.

## 3. Personas
| Persona | Needs | Success |
|---|---|---|
| Owner-operator (cafe, shop, gym, workshop) | knows profit, who owes, GST due, without learning accounting | opens dashboard daily; zero month-end surprises |
| Accountant / CA with 20 to 100 clients | multi-org access, trial balance, adjustments, GST working papers, Tally/Excel export | closes a client's month in under 30 minutes |
| Finance/ops manager in a multi-branch group | branch P&L, approvals, budgets | reads branch results by day 3 |
| Auditor (read-only) | ledger, audit trail, documents | exports an audit file without asking the client |
| Integrator/developer | API, webhooks, sandbox | first call in 15 minutes |

## 4. Value proposition and differentiators
- Books fed automatically from the POS the business already uses (FlowXP), with a contract that prevents double counting.
- Industry chart-of-accounts templates and reports.
- Messaging-native collections (WhatsApp statements and reminders; FlowXP's messaging module is live).
- AI that explains numbers from the ledger and never invents any.
- Honest compliance: "prepared for filing" until a partner route is verified.

## 5. Functional requirements (MoSCoW)

Note: "first paid release" means the end of roadmap Phase 2 (GST registers and returns preparation are Phase 2). Phase 1 alone is a pilot with accountants, not a paid launch.
M = Must for the first paid release, S = Should (phase 2), C = Could (phase 4+), W = Won't now. IDs match implementation-backlog.md epics.

| Area | Requirement | Pri |
|---|---|---|
| Org | Register, login, MFA option, organizations with strict isolation, invite users, roles (owner, admin, accountant, sales, purchases, viewer, auditor), branches, financial year, base currency INR, industry template of accounts, opening balances, onboarding checklist | M |
| Accounting | Double-entry engine, manual journals with attachments, reverse journals, trial balance, general ledger, P&L, balance sheet, cash flow (indirect), period lock, year close, audit log | M |
| Accounting | Recurring journals, accruals/prepayments schedule, fixed assets and depreciation, budgets, base-currency adjustment | S/C |
| Sales | Customers, items/services, quotes, invoices (GST), credit notes, payments received with allocation, advances, customer statements, PDF, email and WhatsApp delivery, payment links | M |
| Sales | Sales orders, delivery challans, recurring invoices, approvals, retainer invoices, customer portal | S/C |
| Purchases | Vendors, bills, vendor credits, payments made, advances, expenses with receipt attachment, recurring expenses | M |
| Purchases | Purchase orders, goods receipt, three-way match, approvals, expense claims | S |
| GST | Tax codes with effective dates, place of supply, HSN/SAC, sales and purchase registers, ITC view, reverse charge, GSTR-1 and 3B preparation (exports and reconciliation), credit/debit note adjustments | M |
| GST | e-invoice IRN and QR, e-way bill via a GSP partner; GSTR-2B reconciliation | S |
| GST | Direct filing, GSTR-9, ISD, CMP-08 | C |
| Banking | Bank and cash accounts, CSV/Excel/statement import, categorisation rules, matching to invoices/bills, transfers, fees and interest, unmatched queue, reconciliation report | M |
| Banking | Bank feeds through an aggregator | C |
| Inventory | Optional module: items, SKU/barcode, units, locations, adjustments, transfers, weighted-average valuation, COGS, reorder level, valuation report | S |
| Inventory | Batch/serial, FIFO, composite items | C |
| Reports | Statements, GL, account transactions, receivables/payables ageing, sales/purchase by party and item, GST reports, expense reports, comparative periods, drill-down, CSV/Excel/PDF export, scheduled delivery | M |
| Integrations | FlowXP connector, Razorpay and Cashfree payment links with webhooks, WhatsApp and email delivery, Excel/CSV import, Tally/Zoho/Vyapar migration import, REST API + webhooks + API keys, Integrations Hub | M (FlowXP, payments, API); S (migration tools) |
| AI | Grounded Q&A over the ledger, explanations of variances, anomaly flags, receipt OCR with review, categorisation suggestions, cash-flow forecast labelled as forecast | S (Q&A) / C (OCR, forecast) |
| Automation | Due and overdue reminders, recurring documents, scheduled reports, low-stock and budget alerts, approval notifications | S |
| Platform | Subscription plans with feature gating (reuse FlowXP's plan-feature convention), usage records, data export, account deletion | M |

## 6. Non-functional requirements
- Correctness first: invariants I1 to I10 (accounting-rules.md) are release blockers.
- Performance: dashboard under 2 s for 100k journal lines; invoice save under 500 ms p95; report on 1M lines under 10 s with caching.
- Availability target 99.5% at launch, RPO 15 min, RTO 4 h (deployment-and-operations.md).
- Accessibility WCAG 2.2 AA for core flows. Languages: English at launch; Hindi and the existing six FlowXP languages in phase 2 (FlowXP has an i18n pipeline).
- Offline: web is online-only; the FlowXP phone keeps its offline sales and syncs events.
- Data residency: India.

## 7. Monetisation (proposal, not decided)
Free: view-only ledger for connected FlowXP businesses (one GSTIN, statements, GST registers); this matches what customers already get. Paid per organization per month: Starter (full books, one GSTIN, bank import), Business (multi-branch, approvals, inventory, automation, e-invoice credits), Practice (accountant multi-client). Usage-metered: e-invoice/e-way bill calls, WhatsApp messages (pass-through plus margin), AI questions. Zoho's published India Standard price is ₹749 per org per month billed annually; anchor Starter below it only after costing the GSP and hosting. Decision D-10.

## 8. Success metrics
Activation: first journal-posting document within 24 h of signup; integrated businesses: first synced sale within 1 h of connect. Quality: reconciliation job difference count = 0 per day; duplicate-post incidents = 0. Retention: 90-day active orgs; accountant-invited orgs. Revenue: paid orgs, ARPA, usage revenue. Support: tickets per 100 orgs. Compliance: percentage of e-invoice calls accepted by the IRP.

## 9. Risks
Accounting errors destroy trust (mitigate: invariants, reconciliation jobs, accountant review before launch). Compliance claims ahead of reality (mitigate: claims table in research/indian-gst-compliance.md). Third-party dependency on GSP and aggregators. Scope explosion (mitigate: phase gates in roadmap). Team capacity: FlowXP is still being built; FlowBook phase 1 competes for the same people.
