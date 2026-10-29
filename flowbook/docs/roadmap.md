# FlowBook roadmap

Sequenced by dependency, accounting correctness, compliance risk, customer value and effort. No dates are promised: estimates are in engineer-weeks (ew) for a team of 2 backend + 1 frontend and are rough. FlowXP continues in parallel; FlowBook phase 1 should not start until the owner decides to staff it.

## Phase 0 - Research and specification (this folder) - done in draft
Open items before Phase 1 starts: owner sign-off on D-01, D-02, D-04, D-06; CA review of accounting-rules.md and the rounding rule; legal review of DPDP role; GSP vendor shortlist and price pages read; AI provider terms read. Exit: decisions D-01..D-09 Accepted. (~2 ew of review, not engineering)

## Phase 1 - Accounting foundation (~16 to 20 ew)
Auth + MFA, organizations, memberships, roles, branches, financial years/periods, chart of accounts with industry templates, journal engine with triggers and posting register, parties, items, invoices, bills, payments and allocation, credit notes, bank/cash accounts, audit log, TB/GL/P&L/BS, receivables/payables ageing, PDF + email, WhatsApp invoice send (reuse), Razorpay/Cashfree payment links, plan gating, Excel/CSV import, per-org export. Exit: the 18 journals pass, reconciliation job green on the synthetic org, accountant pilot with 3 real businesses.

## Phase 2 - Indian business accounting (~14 ew)
GST tax tables with effective dates, place of supply, registers, ITC view, reverse charge, GSTR-1/3B prepared and reconciled to the ledger, credit/debit note GST, expenses with receipts, bank import rules and matching, reconciliation sessions, purchase orders, approvals, recurring documents, reminders, scheduled reports, migration imports (Tally, Zoho CSV), GSP integration for e-invoice and e-way bill (sandbox, then pilot), GSTR-2B reconciliation. Exit: CA signs off GST outputs; e-invoice accepted by sandbox and by a pilot taxpayer.

## Phase 3 - FlowXP integration (~10 ew; starts after Phase 1 posting is stable, can overlap Phase 2)
Outbox in FlowXP, inbox in FlowBook, sale/return/payment/purchase/stock-valuation events, cut-over date, gap repair, daily totals check, Integrations Hub monitoring, branch-level accounting, per-industry account templates. Exit: 5 FlowXP businesses on live sync for 30 days with zero reconciliation differences.

## Phase 4 - Advanced financial management (~12 ew)
Budgets, fixed assets and depreciation, multi-currency and revaluation, advanced reports and custom reports, retainer invoices, sales orders and challans, customer/vendor portals, accountant multi-client workspace, inventory module depth (batch/serial/FIFO).

## Phase 5 - AI and automation (~10 ew)
Assistant with typed read tools, answer verifier, anomaly flags, receipt OCR with review queue, categorisation suggestions, cash-flow forecast, automation engine UI (conditions/actions/history), reorder suggestions. Exit: golden Q&A set 100% numerically correct; zero write paths.

## Later / maybe
Bank feeds via aggregator, Account Aggregator, direct GST filing, marketplace connectors, payroll, MCP server for FlowBook.

## Gates
Never skip: reconciliation green, RLS tests green, restore drill done, claims checked against the compliance table before any public statement.

## Prioritisation notes
Ledger correctness and the FlowXP bridge are the differentiators, so they precede UI polish. GSP work is front-loaded with vendor discovery because it has the longest lead time (contracts, certification). AI is last because it needs clean data and trust.
