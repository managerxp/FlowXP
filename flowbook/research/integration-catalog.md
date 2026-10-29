# Integration catalog (Zoho Books reality + FlowBook recommendation)

Accessed 2026-10-29. Sources: Zoho help table of contents (https://www.zoho.com/in/books/help/settings/integrations.html), API intro (https://www.zoho.com/books/api/v3/introduction/), webhooks (https://www.zoho.com/books/api/v3/webhooks/), e-invoicing (https://www.zoho.com/in/books/help/e-invoicing/), bank feeds (https://www.zoho.com/in/books/help/banking/feeds.html). "Availability" says only what the page proves. Cost = published cost or *unknown*. Provider fees for Razorpay, Cashfree, Stripe, Meta, banks and aggregators were **not** researched in this pass and are marked *unknown, verify*.

Zoho's own integrations list (from its help index) is: Bigin, Bharat Connect, Zoho People, Zoho SalesIQ, Zoho Mail, Zoho Analytics, Zoho CRM, Zoho Projects, Zoho Desk, Zoho Expense, Zoho Commerce, Zoho Billing, Zoho Notebook, Google Workspace, Microsoft 365, Slack, Zendesk, Zapier, Uber, Email, Zoho Cliq, Twilio, WhatsApp (credits-based), Zoho CRM custom modules, Payment Retention; extensions: Bitly invoice link, Snail Mail, Bird IVR, ClickSend, Clickatell, Zoho Writer templates; migration from Tally, FreshBooks, Wave, other systems, Zoho Invoice. The "1,000+ apps" figure for Zoho Flow in the brief was **not verified** here.

## Matrix

| Integration | Category | Availability | Main purpose | Data exchanged | Direction | Trigger | Auth | Cost | Limitations | FlowBook |
|---|---|---|---|---|---|---|---|---|---|---|
| Razorpay | Payments | In Zoho: native online-payment setup (page exists) | collect invoice payments | payment link or checkout, payment status, refunds | both | webhook + manual | API key pair + webhook secret | unknown, verify | India | **MVP** |
| Cashfree | Payments | not in Zoho's list | same; FlowXP already uses Cashfree for subscriptions | same | both | webhook | key + signature (FlowXP has `payments/cashfree.js`) | unknown, verify | | **MVP** (reuse) |
| Stripe, PayPal | Payments | native in Zoho | international | same | both | webhook | OAuth/keys | unknown | India onboarding limits unverified | Later |
| Paytm, ICICI eazypay, bank gateways (SBI, Axis, Kotak, Yes, StanChart, HSBC, ICICI) | Payments | native in Zoho (listed) | collect payments | payment status | inbound | callback | per bank | unknown | | Not required |
| Zoho Payments | Payments | Zoho's own | | | | | | | Zoho only | n/a |
| UPI links / QR | Payments | | collect | VPA, UTR | inbound | manual match or gateway webhook | n/a | | no public UPI feed without a PSP | **MVP** (manual match) |
| Bank feeds | Banking | Zoho: via Yodlee aggregator | auto statement lines | bank transactions | inbound | polling by aggregator | bank authorisation redirect | unknown | availability by bank unknown | **Later**; MVP = CSV/statement import |
| Statement import | Banking | native | | lines | inbound | manual | n/a | free | format variety | **MVP** |
| Account Aggregator (RBI framework) | Banking | not claimed by Zoho | consented bank data | | inbound | consent | FIU registration/partner | unknown | needs regulated route; do not assume | Evaluate, Later |
| GSP / IRP for e-invoice | Compliance | Zoho is a registered GSP (e-invoicing page) | IRN + signed QR | invoice JSON out, IRN/QR/ack back | both | on issue | GSP credentials, IRP user | unknown | needs a GSP/ASP arrangement | **Phase 2**, partner first |
| E-way bill | Compliance | native in Zoho | EWB number | invoice + transport | both | manual or on issue | GSP | unknown | | Phase 2 |
| GSTR-1/3B filing | Compliance | native in Zoho (filing pages) | return filing | return JSON, status | both | manual | GSP + OTP | unknown | | **Phase 2 exports first**, filing via partner |
| Zoho CRM, Projects, Expense, People, Desk, Analytics, Commerce, Billing | Zoho apps | native | | contacts, invoices, expenses | both | | Zoho OAuth | included | Zoho only | Not required |
| Shopify, WooCommerce, Amazon | Commerce | not in the pages read (Zoho lists Zoho Commerce, Zapier); Zoho Inventory handles them, **U** | orders, payments, refunds | | | | | | | Later (via Zapier-like or direct) |
| Zapier | Automation | native listed | connect 1000s of apps | triggers/actions | both | webhook | API key/OAuth | Zapier plan | | Later (public API first) |
| Zoho Flow, Make | Automation | Flow is Zoho's | | | | | | | | Not required |
| WhatsApp | Communication | Zoho: credits-based integration | invoice/reminder delivery | message + status | outbound | event | provider | credits | template approval | **MVP** (reuse FlowXP's Meta Cloud API module) |
| Twilio, ClickSend, Clickatell | SMS | extensions | SMS | | outbound | | key | per message | DLT registration in India | Later |
| Email | Communication | native | invoices, statements | | outbound | | SMTP/provider | | | **MVP** (FlowXP `mailer.js`) |
| Google Workspace, Microsoft 365, Slack | Productivity | native | | | | | OAuth | | | Later |
| REST API v3 | Developer | official | everything the UI does | JSON; OpenAPI doc downloadable | both | | OAuth 2.0, `Authorization: Zoho-oauthtoken`, `organization_id` on every call, 9 regional domains | included | 100/min, daily by plan | **MVP** (own API) |
| Webhooks | Developer | official | HTTP callbacks from workflow | entity payloads, custom headers, `secret` for signing, history + resend + bulk resend endpoints | outbound | workflow event | secret | included | defined through workflow rules | **MVP** |
| MCP server | Developer/AI | official page exists | lets an AI client use Books | | | | | | details not read | Phase 5 consider |
| Tally import | Migration | native | | masters, vouchers | inbound | manual | | | | **MVP** (FlowXP already has Tally/Vyapar/Busy import notes in /guide) |

## Developer-platform facts to copy as design input (S2, S3)
- A tenant is called an organization; every API call carries `organization_id`; each org has its own base currency, time zone, language, contacts and reports.
- Regional data centres: 9 domains (.com, .eu, .in, .com.au, .jp, .ca, .com.cn, .sa, .ae). **FlowBook:** India-only data residency at launch; store the region on the organization.
- Rate limits are per organization per minute plus a daily cap that scales with plan, plus a concurrency cap. Error code 429.
- Webhook management is an API: create, list, update, delete, history, resend, bulk resend. Signature secret is optional, 12 to 50 alphanumeric characters (so Zoho's is a shared-secret signature; the exact algorithm was not in the text read).

## Per-integration deliverables
For each integration listed "MVP" or "Phase 2", docs/integration-architecture.md gives purpose, credentials, auth model, data flow, mapping, webhook events, retry/reconcile strategy, security, complexity, cost note and phase. Costs stay *unknown, verify* until a vendor price page is read.
