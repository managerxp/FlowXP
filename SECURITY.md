# FlowXP security review and production checklist

Reviewed 2026-09-26; full end-to-end audit with live attack tests on 2026-10-08: see `SECURITY_AUDIT.md`. Scope: the API, the web app, uploads, sign-in. Not a penetration test; get one before taking real payments at scale.

## What is in place
- **Passwords**: bcrypt; a dummy hash is compared for unknown emails so response time does not reveal which emails exist; reset tokens are single-use and expire.
- **Sign-in protection**: 5 failures per email in 15 minutes locks that address for 15 minutes (unknown addresses too); IP rate limit on login, 2FA and password endpoints; every attempt goes in `login_events` (IP, device, outcome, new-device flag); a sign-in from a new device emails the person.
- **Two-step verification (TOTP)**: RFC 6238, works with any authenticator app; secrets encrypted at rest (AES-256-GCM); a code cannot be reused; 10 single-use hashed recovery codes; the password step returns only a 5-minute challenge, never a session; turning it off or changing recovery codes needs the password. Owners can require it for owners/admins.
- **Sessions**: JWTs pinned to HS256 and carrying a session version, so changing the password, resetting it, turning 2FA on/off or "sign out everywhere" ends every other session immediately.
- **Uploads**: images are checked by their first bytes (not the claimed type); served with `Content-Security-Policy: sandbox` and nosniff, so an uploaded HTML/script file cannot run under our address.
- **Headers**: nosniff, no framing, no referrer, same-site resource policy, HSTS in production, `Cache-Control: no-store` on the API.
- **Errors**: a disallowed origin gets 403, bad JSON 400, oversized body 413, no stack traces.
- **Tenancy**: every query is scoped by business (and outlet); tested with cross-business and cross-outlet matrices.
- **Dependencies**: `npm audit --omit=dev` is clean for backend and frontend (nodemailer upgraded to the latest major).

## Before going live (you must do these)
1. Set a long random `JWT_SECRET` (at least 32 chars). **The 2FA encryption key derives from it; changing it later locks everyone with 2FA out** (recovery codes still work only if the secret can decrypt, so rotate carefully).
2. Set `CORS_ORIGINS` to your real site only; serve over HTTPS; set `NODE_ENV=production`.
3. Run behind a reverse proxy and set the trust-proxy setting so the real client IP is recorded and rate-limited.
4. Configure SMTP so new-device alerts and password resets are delivered.
5. Turn on 2FA for your own owner account, then enable "Require two-step verification" in Security.
6. Postgres: private network, strong password, automated backups (and do a restore test).
7. Keep the print agent token and API keys out of the repo; rotate on staff changes.

## Known gaps (not done)
- No SMS/e-mail one-time-code 2FA or hardware keys (authenticator app + recovery codes only).
- Lockout is per email (an attacker can lock a known address for 15 minutes); no CAPTCHA.
- No IP allow-listing, no per-device session list (only "sign out everywhere").
- Rate-limit counters are in memory (per server); use Redis if you run several servers.
- Access tokens last for the configured lifetime with no refresh-token rotation.
- No third-party penetration test, WAF or automated dependency-update bot yet.
