# Deployment and operations

Status: plan. Hosting provider and prices are not chosen (D-13); numbers below are targets.

## 1. Environments
local (docker compose: Postgres 16, Redis, MinIO, api, worker, web) · CI (ephemeral) · staging (copy of production topology, gateway test mode, government sandbox) · production.

## 2. Production topology (launch)
Nginx (TLS, rate limit, static SPA) → api container ×2 → Postgres primary (+ standby or managed replica) · worker container ×1-2 → Redis → S3-compatible bucket. Single region, India. Containers from one image; config by environment variables; secrets from a secret store, not the image.

## 3. Release process
Trunk-based, PR checks (lint, unit, integration with real Postgres, RLS test, boundary test, migration dry-run). Migrations are forward-only, backwards-compatible with the previous release (expand then contract). Deploy: build image → run migrations as a separate step with a lock → rolling restart of api, then worker → smoke test → keep previous image for rollback. Feature flags per plan key. No deploy during a month-end window (28th to 3rd) except fixes.

## 4. Backups and recovery
Continuous WAL archiving + daily base backup, encrypted, copy in a second location. RPO 15 min, RTO 4 h at launch. Quarterly restore drill into a scratch instance followed by the reconciliation job; record the time. Object storage versioning on. Per-organization export available any time.

## 5. Monitoring and alerts
Metrics: request rate/latency/errors, DB connections/locks/replication lag, queue depth and age, job failures, outbox backlog, webhook failure rate, reconciliation differences (must be 0), disk space, certificate expiry. Alerts to on-call by phone for: any reconciliation difference, posting errors, queue age > 10 min, DB replica lag > 60 s, error rate > 2%. Logs structured with request id and organization id, no PII.

## 6. Runbooks (to write before launch)
Duplicate posting suspected; reconciliation difference; DLQ growth; gateway webhook outage; FlowXP connector backlog; failed deploy rollback; DB failover; restore from backup; leaked secret rotation; tenant data export/deletion request; locked-period correction request.

## 7. Capacity and cost notes
Unknown. Measure with a synthetic org of 1M journal lines before pricing. The heaviest queries are P&L/BS over wide date ranges: use indexes on `(organization_id, account_id, posting_date)` and a nightly balance snapshot table, with the live query as the fallback so snapshots can never be the source of truth.

## 8. Support and incident
Status page; severity levels; accounting incidents are SEV1 until proven otherwise; postmortem within 5 days; customer-visible notice if data was wrong for any period.

## 9. Compliance operations
Retention jobs; access reviews quarterly; dependency updates weekly; pen-test yearly; vendor register for GSP, gateways, AI provider, WhatsApp with their terms and data locations.

## 10. Relationship to FlowXP operations
FlowXP's pm2 + Nginx + Postgres setup (DEPLOY.md) is a reference but FlowBook uses containers and a separate database; the shared pieces are the Nginx host and the monitoring tooling if kept.
