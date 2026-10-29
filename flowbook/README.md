# FlowBook (ManagerXP): research and specification

Status: Phase 0 specification written 2026-10-29. Phase 1 milestone 1 (the accounting engine, in `api/`) is built and tested; nothing else is. Facts about Zoho Books are from its official pages read on that date; everything marked *verify* or *unknown* was not confirmed. Tax and privacy items need a CA and a lawyer before they are coded or marketed.

Research: research/zoho-books-feature-matrix.md, competitor-comparison.md, integration-catalog.md, indian-gst-compliance.md
Docs: product-requirements, accounting-rules, integration-architecture, flowxp-integration-contract, system-architecture, database-schema, security-and-privacy, testing-strategy, design, roadmap, implementation-backlog, architecture-decisions, api-specification, deployment-and-operations (all in docs/)

Decisions waiting for the owner: architecture-decisions.md D-01, D-02, D-04, D-06, D-10, D-11, D-12, D-13.

## Web app (flowbook/web)
React + Vite, plain CSS, works from phone width up. `cd flowbook/web && npm install && npm run dev` (port 5300; it proxies `/v1` to the API on 5200, so start the API too). In production serve `dist/` and `/v1` from one host. The product name is one constant (`src/lib.js` BRAND) plus `index.html`.
Screens: sign in and sign up, set up a business, home (what is owed, profit, books check), sales invoices, purchase bills and credit notes (draft, issue, void, apply, print), payments with matching, customers, vendors, items, chart of accounts, journals (manual entry, reverse), reports (profit and loss, balance sheet, trial balance, who owes you / you owe, checks), settings (business details, GST rates, closing periods, team, FlowXP link with one-time secret and event replay, activity log). Not yet: sharing the FlowXP login, PDF download (Print uses the browser), bank statements, GST returns.

### Look and feel
The web app uses FlowXP's design system (`design.md`): same tokens (ink navy, logo blue, flat white grounds), Plus Jakarta Sans, 8/12/16 radii, borders over shadows, the same sidebar-plus-sticky-header shell, light and dark by the system setting. Motion is the FlowXP set: a short fade-and-rise on each page, staggered stat tiles, a lift on button hover, panels that settle in; all off under reduced motion.

### Hardening (2026-10-29)
Invoice, bill, credit note and payment numbers restart each financial year (`INV-26-27-000001`, 16 characters, within the GST limit); the invoice prefix is set per organization (Settings, up to three characters) and each prefix is its own series. Ageing is worked out for the date chosen. Posted payments and their allocations are frozen by database triggers (void instead). FlowXP events are stored and answered at once and posted by a background worker (`INBOX_WORKER=false` to post inside the request instead); a cancellation that arrives before its sale waits and runs by itself when the sale posts. Organizations made before the Discount given account existed got it from migration 0005.

### GST returns, recurring documents and statements (2026-10-29)
Added after reading the MIT-licensed [Free-GST-Billing-Software](https://github.com/IamRamgarhia/Free-GST-Billing-Software) (copyright its authors; the GSTR-1 and GSTR-3B file layout, the portal checks and the number rules follow it, re-written for FlowBook's paise and ledger model).
- **GSTR-1 and GSTR-3B drafts** (`api/src/gstr.ts`, Reports, GST returns): worked out from issued invoices, credit notes and bills of a month. GSTR-1 has B2B, B2CL (above 1 lakh from 1 Aug 2024), B2CS, CDNR, the HSN summary and documents issued. A list of what the portal is known to reject comes with it (invalid GSTIN, number over 16 characters, rate not on the portal list, missing or short HSN, missing unit), and the download is blocked until the blocking ones are fixed. **Not verified against the GST portal.** Not built: credit notes to unregistered buyers (CDNUR), exports, SEZ, reverse charge, cess, GSTR-3B table 3.2, interest and late fee, filing.
- **Units (UQC)** on items and lines (migration 0006); the HSN table needs them.
- **Recurring invoices and bills** (`api/src/recurring.ts`, migration 0006, Recurring screen): a template makes a DRAFT on each due date (catches up missed periods, at most 12 per run, stops at its end date). A person still issues it. It runs when someone presses "Make due drafts now"; there is no timer yet.
- **Party statement** (`api/src/statement.ts`, Reports, Party statement): documents and payments with a running balance.
- **Amount in words** under every document total, and a **GST due dates** card on the home screen (monthly filers only).
- Left out on purpose: the reference's HSN-to-rate table. Its rates predate or only partly follow the September 2025 rate change, so it would suggest wrong rates. Seeded tax codes are still GST0/5/12/18/28; add a 40% code (and retire 12/28 for new dates) in Settings once the owner's CA confirms the rates in use.
