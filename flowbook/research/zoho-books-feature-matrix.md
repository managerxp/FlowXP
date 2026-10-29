# Zoho Books feature matrix (research for FlowBook)

Accessed 2026-10-29. Status: **V** = verified on an official Zoho page read in this pass; **T** = listed in Zoho's own help table of contents only (existence confirmed, behaviour not read); **U** = not researched or unknown. Nothing here describes Zoho's internal infrastructure; none is publicly documented in the pages read.

Sources (all official, Zoho):
- S1 Pricing, India: https://www.zoho.com/in/books/pricing/
- S2 API introduction (v3): https://www.zoho.com/books/api/v3/introduction/
- S3 API webhooks: https://www.zoho.com/books/api/v3/webhooks/
- S4 Help table of contents (read via the Integrations page): https://www.zoho.com/in/books/help/settings/integrations.html
- S5 e-Invoicing overview: https://www.zoho.com/in/books/help/e-invoicing/
- S6 Bank feeds: https://www.zoho.com/in/books/help/banking/feeds.html
- S7 GST help index: https://www.zoho.com/in/books/help/gst/

## Plans and limits (S1, India, prices exclude tax)

| Plan | Per org per month, billed yearly (monthly billing in brackets) | Positioning on the page |
|---|---|---|
| Free | 0 | 1 user + 1 accountant; invoices, quotes, bills, expenses, journals; receipt autoscan; online payments; reminders; customer portal; credits and refunds; bank reconciliation; sales/purchase orders; inventory; GST reports and filing; P&L, balance sheet, 50+ reports; Invoice Management System |
| Standard | 749 (899) | transactions, accounts, reports |
| Professional | 1,499 (1,799) | projects, inventory, purchases |
| Premium | 2,999 (3,599) | customisation and automation |
| Elite | 4,999 (5,999) | advanced accounting with full inventory |
| Ultimate | 7,999 (9,599) | business intelligence |

Add-ons (S1): extra user 150/user/month; employees 60 (from Premium); location 600/month (includes 1 GSTIN and 10K invoices); document autoscans 419 per 50/month; SMS 75/credit (min 5); orders + shipping labels 360/month; expense claim 149/user/month; BillPay 2,999/month. Add-ons are not supported on Free except autoscans.

API quotas by plan (S2): 100 requests/min/org; per day Free 1,000, Standard 2,000, Professional 5,000, Premium/Elite/Ultimate 10,000. Concurrent calls: Free 5, paid 10 (soft). HTTP 429 with codes 44, 45, 1070.

**FlowBook implication:** the Free plan is the pricing anchor in India. FlowBook cannot charge for basic invoicing, GST reports and a P&L. Charge for: multiple GSTINs/locations, e-invoicing and e-way bill volume, inventory depth, automation, AI, and the FlowXP bridge.

## Feature categories

Legend for the last column: how a FlowBook build should treat it.

### A. Sales and invoicing
| Feature | Status | Notes | FlowBook |
|---|---|---|---|
| Invoices, bill of supply | T (S4) | tax invoice and bill of supply are separate help pages | MVP |
| Quotes (formerly Estimates), convert to sales order or invoice, progress invoice | T | | MVP (quote to invoice), later (progress) |
| Sales orders, convert to invoice or purchase order | T | | Phase 2 |
| Delivery challans | T | | Phase 2 (FlowXP wholesale already has challans) |
| Retainer invoices | T | advance billing | Phase 4 |
| Recurring invoices | T | create, send, receive payment, workflow | Phase 2 |
| Credit notes: apply to invoices, refund | T | | MVP |
| Payments received, payment links | T | | MVP |
| Online payments | V (S4 list) | Zoho Payments, Razorpay, Paytm, ICICI eazypay, PayPal, Verifone, Stripe, and bank gateways: ICICI, SBI, Yes, Kotak, Standard Chartered, Axis, HSBC | Razorpay + Cashfree first |
| Customer portal with MFA | T | | Phase 4 |
| Transaction approval: simple, multi-level, custom | T | | Phase 2 |
| Customer credit limit, customer hierarchy | T | | Phase 2 |
| PDF templates, custom fields, validation rules, record locking, custom buttons, custom modules, web tabs, blueprints | T | customisation layer | Phase 4+ only for custom fields and locking |

### B. Purchases
Purchase orders, bills, bills of entry (imports), payments made, vendor advances, vendor credits, cheques, TDS liabilities and challans, vendor portal, BillPay add-on (vendor onboarding, approvals, PO matching, bill reconciliation, batch payments): all **T** (S4). Expense claims and mileage expenses: **T**. **FlowBook:** bills, vendor credits, payments made, vendor advances in MVP; PO and PO matching in Phase 2; BillPay-style batch payments are out of scope until a bank partner exists.

### C. Accounting
Chart of accounts and sub accounts, manual journals, journal templates, reverse journals, recurring journals, journal credits, netting, 13th-month adjustment journals, base currency adjustment, budgets, bulk update, transaction locking, fixed assets, accountant manage-clients: all **T** (S4). **FlowBook:** all of these are in the accounting engine spec (docs/accounting-rules.md). Netting, 13th-month and journal credits are Phase 4.

### D. GST and compliance
| Feature | Status | Notes |
|---|---|---|
| GSTR-1 filing, GSTR-3B filing, GSTR-2 and 2B reconciliation, GSTR-9, CMP-08, Input Service Distributor, Invoice Management System, DRC-01B and 01C, GST filing approval | T (S4) | filing pages exist for all of these; the depth of each was not read |
| e-Invoicing | V (S5) | Zoho states it is a registered GST Suvidha Provider (GSP) and pushes invoices to the IRP, which returns the IRN and QR code; supports cancel, bulk push, sandbox, e-Way Bill details on the invoice |
| e-Way bills | T | generate from Books, multiple vehicles, gold |
| TDS and TCS | T | income TDS, GST TDS, TDS rates update for Income Tax Act 2025 |

Important distinction for FlowBook: e-invoicing and filing are **integration-assisted** through a GSP/GSTN-authorised route, not a thing an application can do by itself. See research/indian-gst-compliance.md.

### E. Banking
Bank feeds through Yodlee (S6: "banks supported by Yodlee"; reconnect flow redirects to the bank site to authorise), bank statement import, match and categorise, transaction rules, deposits, reconciliation: **V/T**. Whether Indian feeds are as broad as the US ones: **U**.

### F. Inventory
Items, inventory adjustments, price lists, HSN/SAC on items, item reports, inventory valuation reports, locations (with GSTIN and invoice limits as an add-on), "Zoho Inventory add-ons": **T**. Serial/batch, FIFO/average, composite items, transfer orders: **U** (not read; Zoho Inventory is a separate product).

### G. Other
Projects and timesheets (with internal and customer approval), Chrome timesheet extension, budgets, branches, documents, tasks, workflow rules (field updates, email alerts, webhooks, custom functions, schedules, logs), reporting tags, import/export and full backup, API usage page, "Signals", web forms, AI features, **Zoho Books MCP server** (set-up page exists), contextual chat: **T**.

### H. Reporting
Reports sections (S4): business overview, sales, inventory, inventory valuation, payables, receivables, direct taxes, payments received, activity report, custom reports, scheduled reports; "50+ reports" on the Free plan (S1). Report scheduling and export limits exist (FAQ titles on S1; the numbers were not read, **U**).

## What the pages did not tell us
Zoho's internal architecture, database, hosting, ledger engine, how posting is made idempotent, how it rounds, or how its AI works. Do not claim any of that in marketing or design.
