# flowbook-api

Phase 1, milestones 1 to 3: the accounting engine, its HTTP API with sign-in, organizations and roles, and the documents (parties, items, invoices, bills, credit notes, payments) that post themselves.

- `migrations/0003_documents.sql`: tax rates (dated), parties, items, documents and lines, payments and allocations. An issued document's money is frozen by a trigger.
- `src/documents.ts`: drafts, issue (numbers and posts through `rules.ts` in one transaction), void (reverses the journal), credit-note application, payments with idempotency and allocation, ageing. `src/masters.ts`, `gst.ts` (GSTIN check), `routes.ts` (HTTP).
- `reports.ts` `documentIssues()` checks that document balances match the receivable and payable accounts party by party; the `/reports/reconcile` route runs it with `reconcile()`.

- `migrations/0001_core.sql`: organizations, financial years and periods, chart of accounts, journals, posting register, audit log. Balance, immutability, append-only audit and row level security are enforced by the database.
- `src/ledger.ts`: `post()` (the only writer of journals; idempotent, period-checked, gapless numbering) and `reverse()`.
- `src/rules.ts`: posting rules v1 (sale, credit note, customer payment and refund, supplier bill, supplier payment).
- `src/reports.ts`: trial balance, profit and loss, balance sheet, party balances, `reconcile()` self-check.
- `src/app.ts`: the Fastify API (`/v1`): auth, organizations, members, accounts, journals, periods, reports, audit. `src/server.ts` starts it; `src/auth.ts` (Argon2id, sessions), `permissions.ts` (roles), `provision.ts`.
- `src/money.ts`, `coa.ts`, `periods.ts`, `audit.ts`, `db.ts`.

Needs Node 24 (runs TypeScript directly) and a local PostgreSQL. Tests create and drop their own database; set `FLOWBOOK_ADMIN_URL` or `DATABASE_URL` if the default `postgres://postgres:postgres@localhost:5432/postgres` is not right.

```bash
DATABASE_URL=postgres://... npm start   # applies migrations, listens on PORT (default 5200)
npm install
npm test
npm run typecheck
```
