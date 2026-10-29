# FlowBook (ManagerXP): research and specification

Status: Phase 0 specification written 2026-10-29. Phase 1 milestone 1 (the accounting engine, in `api/`) is built and tested; nothing else is. Facts about Zoho Books are from its official pages read on that date; everything marked *verify* or *unknown* was not confirmed. Tax and privacy items need a CA and a lawyer before they are coded or marketed.

Research: research/zoho-books-feature-matrix.md, competitor-comparison.md, integration-catalog.md, indian-gst-compliance.md
Docs: product-requirements, accounting-rules, integration-architecture, flowxp-integration-contract, system-architecture, database-schema, security-and-privacy, testing-strategy, design, roadmap, implementation-backlog, architecture-decisions, api-specification, deployment-and-operations (all in docs/)

Decisions waiting for the owner: architecture-decisions.md D-01, D-02, D-04, D-06, D-10, D-11, D-12, D-13.

## Web app (flowbook/web)
React + Vite, plain CSS, works from phone width up. `cd flowbook/web && npm install && npm run dev` (port 5300; it proxies `/v1` to the API on 5200, so start the API too). In production serve `dist/` and `/v1` from one host. The product name is one constant (`src/lib.js` BRAND) plus `index.html`.
Screens: sign in and sign up, set up a business, home (what is owed, profit, books check), sales invoices, purchase bills and credit notes (draft, issue, void, apply, print), payments with matching, customers, vendors, items, chart of accounts, journals (manual entry, reverse), reports (profit and loss, balance sheet, trial balance, who owes you / you owe, checks), settings (business details, GST rates, closing periods, team, FlowXP link with one-time secret and event replay, activity log). Not yet: sharing the FlowXP login, PDF download (Print uses the browser), bank statements, GST returns.
