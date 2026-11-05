# FlowBook roadmap

Sequenced by dependency, accounting correctness, compliance risk, customer value and effort. No dates are promised: estimates are in engineer-weeks (ew) for a team of 2 backend + 1 frontend and are rough. FlowXP continues in parallel; FlowBook phase 1 should not start until the owner decides to staff it.

**Status (checked 2026-11-05 against the code, `README.md` and `brain.md`):** the plan below was written before building. Each phase now carries a status note. Work ran ahead of the order below, so some Phase 3 to 5 items exist while Phase 2 live integration does not. Nothing here has been checked against the live GST portal, a GSP, the IRP, NIC or Meta.

## Phase 0 - Research and specification (this folder) - done in draft
Open items before Phase 1 starts: owner sign-off on D-01, D-02, D-04, D-06; CA review of accounting-rules.md and the rounding rule; legal review of DPDP role; GSP vendor shortlist and price pages read; AI provider terms read. Exit: decisions D-01..D-09 Accepted. (~2 ew of review, not engineering)

## Phase 1 - Accounting foundation (~16 to 20 ew)
Auth + MFA, organizations, memberships, roles, branches, financial years/periods, chart of accounts with industry templates, journal engine with triggers and posting register, parties, items, invoices, bills, payments and allocation, credit notes, bank/cash accounts, audit log, TB/GL/P&L/BS, receivables/payables ageing, PDF + email, WhatsApp invoice send (reuse), Razorpay/Cashfree payment links, plan gating, Excel/CSV import, per-org export. Exit: the 18 journals pass, reconciliation job green on the synthetic org, accountant pilot with 3 real businesses.

**Status: built, with two items left out on purpose.** Engine, parties, items, invoices, bills, payments and allocation, credit and debit notes, bank/cash, audit log, TB/GL/P&L/BS, ageing, PDF and email, WhatsApp send, plan gating, CSV import and per-org export are done, plus cash flow, PDF download and a UPI QR on documents. Not built: MFA (the FlowXP login already has it) and Razorpay/Cashfree payment links (need merchant keys). The accountant pilot with 3 real businesses has not happened.

## Phase 2 - Indian business accounting (~14 ew)
GST tax tables with effective dates, place of supply, registers, ITC view, reverse charge, GSTR-1/3B prepared and reconciled to the ledger, credit/debit note GST, expenses with receipts, bank import rules and matching, reconciliation sessions, purchase orders, approvals, recurring documents, reminders, scheduled reports, migration imports (Tally, Zoho CSV), GSP integration for e-invoice and e-way bill (sandbox, then pilot), GSTR-2B reconciliation. Exit: CA signs off GST outputs; e-invoice accepted by sandbox and by a pilot taxpayer.

**Status: mostly built; everything that needs an outside account is not.** Built: GST tax tables, place of supply, reverse charge, ITC and blocked credit (17(5)), GSTR-1 (B2B, B2CL, B2CS, CDNR, CDNUR, exports, HSN, documents issued) and GSTR-3B (including table 3.2) drafts that match the ledger, compensation cess (percentage), SEZ and deemed-export sales, late fee and interest calculator, e-invoice and e-way bill files, expenses, bank import and matching, purchase orders, recurring documents, WhatsApp reminders, CSV import. Not built: live GSP/IRP/NIC calls (files are downloaded, not sent), GSTR-2B reconciliation, approvals, scheduled reports, Tally and Zoho imports, specific (per-piece) cess, purchases from an SEZ, composition/UIN rows in 3.2, 24% interest on wrongly taken credit, quarterly (QRMP) due dates. The exit test (CA sign-off, sandbox acceptance) is still open.

## Phase 3 - FlowXP integration (~10 ew; starts after Phase 1 posting is stable, can overlap Phase 2)
Outbox in FlowXP, inbox in FlowBook, sale/return/payment/purchase/stock-valuation events, cut-over date, gap repair, daily totals check, Integrations Hub monitoring, branch-level accounting, per-industry account templates. Exit: 5 FlowXP businesses on live sync for 30 days with zero reconciliation differences.

**Status: started.** FlowXP sends sales to FlowBook (outbox in `backend/src/modules/flowbook`, inbox in `api/src/inbox.ts`). Events carry totals only, so tax lines such as cess are not carried across. The 30-day live-sync exit with 5 businesses has not been run.

## Phase 4 - Advanced financial management (~12 ew)
Budgets, fixed assets and depreciation, multi-currency and revaluation, advanced reports and custom reports, retainer invoices, sales orders and challans, customer/vendor portals, accountant multi-client workspace, inventory module depth (batch/serial/FIFO).

**Status: partly built.** Done: fixed assets and depreciation, multi-currency (documents and foreign bank accounts), quotes and sales orders, projects and work orders, stock with weighted-average cost. Not built: budgets, retainer invoices, customer/vendor portals, accountant multi-client workspace, batch/serial/FIFO depth.

## Phase 5 - AI and automation (~10 ew)
Assistant with typed read tools, answer verifier, anomaly flags, receipt OCR with review queue, categorisation suggestions, cash-flow forecast, automation engine UI (conditions/actions/history), reorder suggestions. Exit: golden Q&A set 100% numerically correct; zero write paths.

**Status: first part only.** A read-only assistant exists (`api/src/assistant.ts`). Not built: receipt OCR, anomaly flags, cash-flow forecast, automation engine UI, reorder suggestions. The golden Q&A exit set has not been written.

## Later / maybe
Bank feeds via aggregator, Account Aggregator, direct GST filing, marketplace connectors, payroll, MCP server for FlowBook.

## Gates
Never skip: reconciliation green, RLS tests green, restore drill done, claims checked against the compliance table before any public statement.

## Prioritisation notes
Ledger correctness and the FlowXP bridge are the differentiators, so they precede UI polish. GSP work is front-loaded with vendor discovery because it has the longest lead time (contracts, certification). AI is last because it needs clean data and trust.
