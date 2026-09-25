# Deploying FlowXP

Two ways: **one server with Docker** (simplest), or **a managed platform** (Render, Railway, Fly) running the
same containers. Either way you need: a Postgres database, the API, the web app, a domain with HTTPS, and
(optionally) an S3-compatible bucket for photos, an SMTP account for email and an Anthropic key for the AI features.

## 1. One server with Docker

Any Linux server with Docker (a 2 GB VPS is plenty for a first restaurant group).

```bash
git clone <your repo> flowxp && cd flowxp
cp .env.example .env        # fill it in (see below)
docker compose up -d --build
```

The database migrations run by themselves when the API starts. The app is then on port 80 of the server.

**HTTPS:** put a TLS terminator in front of port 80. The least effort is Caddy, which gets certificates for you:

```
app.example.com {
  reverse_proxy localhost:80
}
```

Set `WEB_PORT=8080` in `.env` if Caddy needs port 80, and point Caddy at `localhost:8080`.

### What goes in `.env`

| Setting | What it is |
|---|---|
| `DB_PASSWORD` | any long random string |
| `JWT_SECRET` | 32+ random characters (the API refuses to start in production with less) |
| `APP_ORIGIN` | your public address, `https://app.example.com` (must be https in production) |
| `CORS_ORIGINS` | other sites allowed to call the API, e.g. a separate marketing site (optional) |
| `SMTP_*`, `MAIL_FROM` | outbound email: password links, staff invites, supplier orders. Blank = logged only |
| `ANTHROPIC_API_KEY` | switches on Flow AI and reading menus from photos. Blank = both stay off |
| `STORAGE_DRIVER` | `local` (photos on the server's disk volume) or `s3` (see below) |
| `SUPER_ADMIN_EMAIL/PASSWORD` | the platform operator account (optional) |

## 2. Photos: local disk or a bucket

With `STORAGE_DRIVER=local`, photos are kept in the `uploads` Docker volume. That is fine on one server **that you
back up**. It is not fine on a platform where the disk is thrown away on every deploy.

For anything else use a bucket. Any S3-compatible service works (AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO):

```
STORAGE_DRIVER=s3
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com     # or https://s3.ap-south-1.amazonaws.com, etc.
S3_REGION=auto                                             # or ap-south-1 for AWS
S3_BUCKET=flowxp-files
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_PUBLIC_URL=https://files.example.com                    # where browsers read photos from
```

The bucket must allow public reads of its objects (or sit behind a CDN that does); the API only needs permission to
write and delete. Photos already stored on disk keep working after you switch; new uploads go to the bucket.

## 2b. Messaging (WhatsApp / SMS)

Off until you set a provider. With `MESSAGING_PROVIDER=log` (the default) nothing is sent and the Message log shows every message as *skipped*.

- **WhatsApp (Meta Cloud API):** `MESSAGING_PROVIDER=whatsapp_cloud`, `WHATSAPP_TOKEN` (a permanent system-user token) and `WHATSAPP_PHONE_ID`. Create the seven templates listed in the app (Messaging, Settings, "Show the WhatsApp templates") in Meta Business Manager and wait for approval; until a template is approved its messages fail with Meta's reason, visible in the log.
- **SMS (Twilio):** `MESSAGING_PROVIDER=twilio`, `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`. In India, SMS also needs DLT registration of the sender and templates with your operator; Twilio's own docs cover it.
- Set `APP_ORIGIN` to the public https address: the bill link customers receive is built from it.
- Each business then turns a channel on under Messaging. Test with one bill to your own number first.

## 3. Backups (do this before real customers)

```bash
docker compose exec api sh -c 'DATABASE_URL=$DATABASE_URL ./scripts/backup.sh /app/backups 14'
```

To run it daily, add to the server's crontab (`crontab -e`):

```
0 3 * * *  cd /path/to/flowxp && docker compose exec -T api ./scripts/backup.sh /app/backups 14
```

Then **copy the backup files off the server** (a backup on the same disk is not a backup): `rclone`, `scp`, or
your provider's snapshots. Restore into an empty database with:

```bash
gunzip -c flowxp-2026-09-25T0300.sql.gz | docker compose exec -T db psql -U flowxp flowxp
```

Try a restore once, on a spare server, before you need it.

## 4. Health checks and logs

- `GET /health` answers if the process is up. `GET /ready` answers only if the database does; point a load balancer
  or uptime monitor (UptimeRobot, Better Stack) at `/ready`.
- The API logs one JSON line per failed request (or every request in production) with a request id. The same id is
  in the `X-Request-Id` response header, so a customer can quote it. `docker compose logs -f api`.
- The API exits on an unexpected crash and Docker restarts it.

## 5. Updating

```bash
git pull && docker compose up -d --build
```

New migrations apply on start. They only ever move forward, so take a backup first when the release notes mention a
new migration.

## 6. On a managed platform (Render, Railway, Fly)

Create a Postgres database, then two services from the two Dockerfiles:

- **API** from `backend/` : set the env vars above, plus `DATABASE_URL` from the database. Health check path `/ready`.
  Use `STORAGE_DRIVER=s3` (the disk is not permanent).
- **Web** from `frontend/`: the nginx config proxies `/api` to a host called `api`, so on a platform edit
  `frontend/nginx.conf` to point `proxy_pass` at your API service's internal address, or serve the built `dist/` from a
  static host and set the API address there.

## What is not covered here

Scaling beyond one API server (the background worker would then run once per server; set `WORKER_ENABLED=false` on
all but one), a Redis queue, a WAF, and the payment gateway for subscriptions.

## Checked so far

The S3 request signing is verified against AWS's published examples and against a local stand-in bucket; the
production settings check, health endpoints and backup script are in place. The Dockerfiles, compose file and CI
workflow have **not been run** (no Docker on the machine they were written on), so expect to fix small things on
the first `docker compose up`.
