# Security and privacy

Status: requirements. Indian-law items are from secondary sources and must be verified (research/indian-gst-compliance.md section 5).

## 1. Controls
| Area | Requirement |
|---|---|
| Tenant isolation | `organization_id` on every tenant row, composite FKs, Postgres RLS with `app.org_id` set by middleware from the session (never from the request body), app DB role without BYPASSRLS; a test iterates every route as org A against org B ids and expects 404 |
| Authentication | Argon2id, rate-limited login, TOTP MFA (mandatory for owners and accountants once enabled for an org), session cookie HttpOnly + Secure + SameSite, short JWT + rotating refresh for API/phone, device list with revoke |
| Authorisation | role permissions + branch scope; sensitive actions (void, period override, export all, API key create) need specific permissions; accountant access is per organization and revocable by the owner |
| Encryption | TLS 1.2+; disk and backup encryption; envelope-encrypted columns for bank details, GST portal tokens, integration secrets; keys outside the database |
| Secrets | environment or secret manager only; no secrets in repo, logs, error messages; rotate on staff change; pre-commit secret scan |
| Audit | append-only, hash-chained; financial data read logs for exports and sensitive reports; AI actions flagged |
| API | schema validation on every input, idempotency keys on writes, per-org and per-IP rate limits, pagination caps, CORS allow-list, request id |
| Webhooks | HMAC over raw body with timestamp; constant-time compare; replay window 5 minutes; secrets per connection |
| Uploads | type and size limits, antivirus scan, stored under random keys, served via signed URLs |
| Backup/recovery | encrypted daily full + continuous WAL; restore drill quarterly; per-org export (CSV + JSON) available to the owner |
| Vulnerability mgmt | dependency audit in CI, weekly update PRs, SAST, annual external pen-test before taking real money flows |
| Logging | no PII or tokens in logs; 90-day retention for app logs |

## 2. Privacy and DPDP
- Roles: for a business's customers' data FlowBook is most likely a **processor** for the business (the fiduciary); for the business owner's own account data FlowBook is the fiduciary. Confirm with counsel; reflect in terms and a data-processing addendum.
- Notice and consent for personal data FlowBook collects directly (owners, staff). Purpose limitation; collect only needed fields.
- Rights: access, correction, erasure, grievance contact. Erasure vs tax retention: keep ledger and documents for the statutory period, remove or anonymise personal fields beyond that need, and tell the user which data is retained and why.
- Breach: documented response (triage, notify the Data Protection Board and affected users within the periods the Rules set, *verify*), 24-hour internal escalation.
- Children's data: not collected.
- Cross-border: India hosting at launch; AI provider processing is cross-border unless contracted otherwise, so it requires a disclosure and a switch to turn AI off per organization.
- Commencement of most duties is reported as about 18 months after the Nov 2025 notification; build to the standard now.

## 3. AI-specific privacy
Send only the tool results needed for the question; strip phone numbers and emails unless asked for; no training on customer data (contractual requirement for the provider); store prompts and answers for audit with the same retention as the audit log; organization admin can disable AI.

## 4. Data export and deletion
Export: full organization archive (CSV per table + attachments zip + audit log) on request, generated asynchronously. Deletion: owner-initiated with a 30-day grace period; ledger data is deleted after statutory retention unless the owner has exported and asked for earlier deletion and counsel agrees (record the decision). FlowXP's `accountDeletion.js` is the pattern.

## 5. Open items
Policy documents (privacy policy, terms, DPA) need a lawyer; the exact breach deadlines; whether SOC 2 / ISO 27001 is wanted for accountant firms (cost and timeline unknown).
