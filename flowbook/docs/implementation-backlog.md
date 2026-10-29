# Implementation backlog

Complexity: S (≤3 days), M (≤2 weeks), L (≤4 weeks), XL (more; split). Priority P0 launch-blocking, P1 important, P2 later. "T:" lists required tests. IDs are stable.

## Epic A - Platform and identity (Phase 1)
| ID | Feature | Description | Depends | Acceptance | Tests | Pri | Cx |
|---|---|---|---|---|---|---|---|
| FB-001 | Repo and CI | monorepo (api, worker, web), lint rules incl. no-float-money and module boundaries, CI with Postgres+Redis | - | CI green on empty app | boundary lint test | P0 | M |
| FB-002 | Auth | register, login, Argon2id, sessions, password reset, rate limits | 001 | login works; brute force throttled | unit, integration | P0 | M |
| FB-003 | MFA | TOTP enroll/verify/recovery codes | 002 | enforced for owner when on | integration | P1 | S |
| FB-004 | Organizations + memberships | create org, switch org, invite, roles, branch scope | 002 | RLS blocks cross-org | tenant isolation suite | P0 | L |
| FB-005 | RLS framework | per-request `app.org_id`, policy generator, composite FK convention | 004 | every table has policy (CI check) | "every table has RLS" test | P0 | M |
| FB-006 | Audit log | append-only, hash chain, request id | 004 | tamper detection test | integration | P0 | M |
| FB-007 | Plans and feature keys | plan table, entitlements, usage records (reuse FlowXP convention) | 004 | gated route returns 402/403 | integration | P1 | M |

## Epic B - Accounting engine (Phase 1)
| FB-010 | Chart of accounts + templates | system accounts, industry templates (cafe, retail, gym, workshop, general) | 004 | org starts with a valid COA | seed test | P0 | M |
| FB-011 | Financial years and periods | creation, overlap exclusion, lock states | 004 | overlap rejected; lock enforced | integration | P0 | S |
| FB-012 | Journal tables + triggers | migration from database-schema.md; balance and immutability triggers | 010 | unbalanced rejected at commit; posted immutable | property test | P0 | M |
| FB-013 | `ledger.post()` | single writer, posting register, idempotency, reversal, replacement | 012 | 18 journals from accounting-rules pass | golden journals | P0 | L |
| FB-014 | Manual journals | UI + API, attachments, reverse journal | 013 | audit entry per action | e2e | P0 | M |
| FB-015 | Statements | TB, GL, account transactions, P&L, BS, cash flow | 013 | TB zero; BS balances | reconciliation suite | P0 | L |
| FB-016 | Period close | soft/hard lock, year-end closing journal, override permission | 011,013 | locked period refuses | integration | P0 | M |
| FB-017 | Reconciliation job | sub-ledger vs control accounts, alerts | 015 | zero diffs on synthetic org | job test | P0 | M |

## Epic C - Sales and purchases (Phase 1)
| FB-020 | Parties | customers/vendors, GSTIN validation (format + checksum), import | 004 | duplicate rules | unit | P0 | M |
| FB-021 | Items | goods/services, HSN/SAC, units | 004 | | unit | P0 | S |
| FB-022 | Invoices | draft/issue/void, numbering per series gapless, PDF | 013,020,021 | status table obeyed | state machine tests | P0 | L |
| FB-023 | Payments + allocation | receive/make, partial, advance, void | 022 | no over-allocation under 100 parallel | concurrency test | P0 | L |
| FB-024 | Credit notes/refunds | | 022 | AR + tax correct | golden journals | P0 | M |
| FB-025 | Bills and vendor credits | | 013,020 | | golden journals | P0 | L |
| FB-026 | Expenses | with receipt attach | 025 | | e2e | P1 | M |
| FB-027 | Delivery | email, WhatsApp invoice/statement, share link | 022 | status webhooks logged | integration | P0 | M |
| FB-028 | Payment links | Razorpay, Cashfree, webhooks, dedupe | 023 | duplicate webhook posts once | webhook suite | P0 | L |
| FB-029 | Statements and ageing | customer/vendor | 022 | sums equal AR/AP | reconciliation | P0 | M |

## Epic D - Banking
| FB-030 | Bank accounts + import | CSV/Excel mappings, fingerprint dedupe | 013 | re-import adds 0 rows | integration | P0 | M |
| FB-031 | Matching + rules | match invoices/bills, partial, fees, transfers | 030,023 | | e2e | P1 | L |
| FB-032 | Reconciliation sessions + report | | 031 | difference zero to close | integration | P1 | M |

## Epic E - GST and compliance (Phase 2)
| FB-040 | Tax tables with effective dates | versioned, no hard-coded rates | 012 | old invoices unaffected | rate-change test | P0 | M |
| FB-041 | Place of supply + tax split | | 040 | intra/inter/export cases | unit | P0 | M |
| FB-042 | Registers + ITC view | sales/purchase | 041 | totals equal ledger | reconciliation | P0 | M |
| FB-043 | GSTR-1 / 3B prepared | export + reconciliation to ledger | 042 | CA signs sample | golden files | P0 | L |
| FB-044 | Reverse charge, credit/debit notes in GST | | 041 | | golden journals | P1 | M |
| FB-045 | GSP integration (e-invoice, e-way) | sandbox first | 022,040 | IRN stored; cancel works | sandbox e2e | P1 | XL |
| FB-046 | GSTR-2B reconciliation | | 042 | | unit | P2 | L |
| FB-047 | Compliance claims table in UI/website | only what is verified | - | | review | P0 | S |

## Epic F - FlowXP integration (Phase 3)
| FB-050 | Outbox in FlowXP | table + worker + settings | - | event emitted in sale transaction | FlowXP tests | P0 | L |
| FB-051 | Inbox + signature + dedupe | | 013 | duplicate = one posting | webhook suite | P0 | L |
| FB-052 | Sale/return/payment posting | contract section 4 | 051 | matches journals | golden | P0 | L |
| FB-053 | Purchase + stock valuation | | 052 | inventory = valuation | reconciliation | P1 | L |
| FB-054 | Cut-over, backfill, gap repair | | 052 | | integration | P0 | M |
| FB-055 | Hub monitoring | status, replay, dead letter | 051 | | e2e | P0 | M |
| FB-056 | Daily totals check | FlowXP vs FlowBook | 052 | alert on diff | job test | P0 | M |

## Epic G - Reporting, automation, AI (Phases 2 to 5)
| FB-060 | Dashboard | metrics with drill-down | 015 | each tile links to report | e2e | P0 | M |
| FB-061 | Export + scheduled reports | CSV/Excel/PDF | 015 | | integration | P1 | M |
| FB-062 | Automation engine | conditions/actions/history | 027 | retry, log | integration | P1 | L |
| FB-063 | Budgets and fixed assets | | 013 | | golden | P2 | L |
| FB-064 | Multi-currency | | 013 | gain/loss journal | golden | P2 | L |
| FB-065 | AI tools + verifier | read-only | 015 | numbers verified | golden Q&A | P2 | L |
| FB-066 | Receipt OCR + review | | 026 | low confidence = review | unit | P2 | L |
| FB-067 | Public API + OAuth + webhooks + sandbox | | 004 | OpenAPI served | contract tests | P1 | XL |

## Epic H - Operations
| FB-070 | Backups + PITR + restore drill | | 001 | restore verified | drill | P0 | M |
| FB-071 | Monitoring + alerts | | 001 | | runbook test | P0 | M |
| FB-072 | Data export and deletion | | 004 | | integration | P1 | M |
