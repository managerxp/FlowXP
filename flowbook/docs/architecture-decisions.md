# Architecture decisions (ADR log)

Format: context, options, decision, risk. "Proposed" means the owner has not signed off.

## D-01 Separate product, shared patterns (Proposed)
FlowBook is its own deployable (own repo or `flowbook/` workspace, own database), not a module of the FlowXP backend. Reason: different tenancy model (accountant sees many orgs), different correctness bar, independent release cadence, and a failure in the ledger must not take down billing. Risk: duplicated plumbing; mitigate by copying FlowXP's proven patterns (idempotency middleware, audit log, webhook signature check, plan feature keys) rather than importing code.

## D-02 Stack: accept TypeScript and PostgreSQL; change two things (Proposed)
The brief proposed Next.js, NestJS, Prisma/Drizzle, Redis, BullMQ, S3, Docker, Caddy/Nginx.
- **Accept:** TypeScript end to end; PostgreSQL; Redis + BullMQ for jobs (replaces nothing FlowXP uses today, FlowXP runs `jobs.js` in-process; a ledger needs durable queues); S3-compatible storage; Docker; Nginx (the team already runs it).
- **Backend framework:** NestJS accepted for modular boundaries and DI, but modules map to accounting domains, with no microservices.
- **Change 1, data access:** use **Kysely or plain SQL migrations with a thin typed layer** for the ledger and reporting paths, Drizzle acceptable elsewhere. Prisma is not recommended for the posting engine: money columns, deferred constraint triggers, `SELECT ... FOR UPDATE`, advisory locks and report SQL are first-class here and ORMs get in the way. FlowXP already writes raw SQL with `pg` and its team is fluent.
- **Change 2, frontend:** Next.js is accepted only for the marketing site and the app shell if SSR is wanted; the app itself is a client-rendered React SPA like FlowXP's Vite app unless a real SEO/SSR need appears. A logged-in accounting UI gains little from SSR. Alternative: reuse FlowXP's Vite + React + Tailwind setup and component habits for speed. Recommendation: Vite SPA for the app, Next.js not required in phase 1.
- Motion library optional, not a dependency of phase 1.

## D-03 Modular monolith (Accepted by the brief)
Modules: identity, organizations, accounts/ledger, sales, purchases, tax, banking, inventory, reporting, integrations, notifications, billing/plans, ai. A module owns its tables and exposes a TypeScript interface; no cross-module table writes except through the ledger's `post()`. Enforced by lint rules and a dependency test.

## D-04 Money as integer minor units (Proposed)
BIGINT paise for all amounts; per-currency scale table; rates NUMERIC(18,8); quantities NUMERIC(18,6); JavaScript uses `bigint`/a decimal library, never `number` for money. FlowXP already stores paise.

## D-05 One posting function, derived documents (Proposed)
Business documents (invoice, bill, payment) are sources. A `post(source)` function builds a journal from the document inside one DB transaction, using posting rules versioned by id. The journal never changes; the document may be corrected only by void/replace which posts reversals.

## D-06 Tenancy: shared schema with organization_id plus Postgres Row Level Security (Proposed)
Every tenant table has `organization_id NOT NULL`, composite FKs include it, RLS policies use `current_setting('app.org_id')` set per request; the app role cannot bypass RLS. Alternative: schema per tenant (rejected: migration cost at scale) or database per tenant (kept as an enterprise option).

## D-07 Rounding rule (Proposed)
Per-line tax rounded half away from zero to paise, summed; optional invoice round-off to the nearest rupee into the Round Off account. Needs CA confirmation (research/indian-gst-compliance.md section 4).

## D-08 Inventory valuation (Proposed)
Weighted average first; FIFO later. FlowXP owns quantities when connected.

## D-09 Event integration with FlowXP (Proposed)
Signed HTTPS events with transactional outbox on the FlowXP side and an idempotent inbox on the FlowBook side. Alternatives: shared database (rejected: coupling), polling a read API only (kept for gap repair), message broker (not needed at this scale).

## D-10 Pricing (Open; costs partly read, see research/integration-catalog.md)
See product-requirements section 7. Needs GSP cost, WhatsApp cost, hosting cost per org and a decision on the free tier.

## D-11 GST filing route (Open)
Options: (a) export-only; (b) reseller of a GSP's e-invoice/e-way/filing APIs; (c) become a GSP/ASP. Recommendation: (a) at launch, (b) in phase 2 after reading the chosen vendor's terms and price; (c) not before there is revenue to justify certification.

## D-12 AI provider (Open)
Not selected. Requirements: no training on customer data, India or contractual data-processing terms, tool use, cost per question. Candidates to evaluate: Anthropic API (the Claude models), others. Only the tenant's aggregated, tool-fetched results go to the model; the model never writes to the ledger (see system-architecture section 8).

## D-13 Hosting (Open)
Start on a VPS pair or managed Postgres in an Indian region like FlowXP; move to managed services when the first paid accountants join. Compare cost and RPO at that time.

## D-14 Auth (Proposed)
Own auth with Argon2id, TOTP MFA, session cookies for web and short-lived JWT plus refresh for API/phone; SSO for FlowXP users via OAuth 2.0 authorization-code flow so a FlowXP owner is not asked to register twice.

## D-15 Fastify, not NestJS, for the HTTP layer (Accepted 2026-10-29, supersedes the framework line in D-02)
Node 24 runs TypeScript directly (type stripping), which keeps the engine free of a build step. NestJS relies on decorators and parameter properties, which type stripping does not support, so it would bring back a compiler. Fastify is plain functions, validates request bodies with JSON Schema, and is tested with `app.inject` without a network. Module boundaries (D-03) are kept by folders and the import rules, not by a DI container. Revisit if the team wants NestJS conventions badly enough to accept a build step.

## D-16 Sessions, not JWTs, for sign-in (Accepted 2026-10-29)
A session is a random 32-byte token whose SHA-256 is stored; it can be revoked at once and expires after 30 days. It travels as an HttpOnly SameSite=Lax cookie for the web app (changes also need an allowed Origin: CSRF) or as a Bearer token for API clients. Passwords use Argon2id from Node's own crypto. MFA, password reset and e-mail verification are not built yet. Replaces the JWT plus refresh idea in D-14.
