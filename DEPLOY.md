# Deploying FlowXP

One VPS, no containers: **Postgres + the API under PM2 + nginx** serving the built frontend and proxying `/api`
to the API. You need: a Linux server (a 2 GB VPS is plenty for a first restaurant group), Postgres, Node 22,
nginx, a domain with HTTPS, and (optionally) an S3-compatible bucket for photos, an SMTP account for email and
an Anthropic key for the AI features.

## 1. One VPS with PM2

```bash
# once per server
sudo apt update && sudo apt install -y postgresql nginx
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs
sudo npm install -g pm2

# the database (adjust the password)
sudo -u postgres psql -c "CREATE USER flowxp WITH PASSWORD 'change-me';"
sudo -u postgres psql -c "CREATE DATABASE flowxp OWNER flowxp;"
```

```bash
git clone <your repo> /var/www/flowxp && cd /var/www/flowxp

cd backend && npm ci --omit=dev
cp .env.example .env         # fill it in (see below) — DATABASE_URL points at the Postgres user/db above
cd ../frontend && npm ci && npm run build
cd ..

pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup                  # prints one command to run once, so PM2 survives a reboot
```

The database migrations run by themselves when the API starts (`config/migrate.js`). The API is now on
`127.0.0.1:5100`, managed by PM2; nothing is exposed to the internet yet — nginx is next.

```bash
sudo cp deploy/nginx.conf /etc/nginx/sites-available/flowxp
sudo mkdir -p /etc/nginx/snippets && sudo cp deploy/nginx-security-headers.conf /etc/nginx/snippets/flowxp-security-headers.conf   # CSP and other security headers, see the file
# it is set up for flowxp.in (www.flowxp.in redirects to it); check root → /var/www/flowxp/frontend/dist
sudo ln -s /etc/nginx/sites-available/flowxp /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**HTTPS:** certbot gets a certificate and rewrites the nginx config for you:

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d flowxp.in -d www.flowxp.in
```

### What goes in `backend/.env`

| Setting | What it is |
|---|---|
| `DATABASE_URL` | `postgres://flowxp:<password>@localhost:5432/flowxp`, matching the user/db you created above |
| `JWT_SECRET` | 32+ random characters (the API refuses to start in production with less) — `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ENCRYPTION_KEY` | recommended: a second secret, 32+ random characters, for stored 2FA secrets and payment/email/messaging keys, so changing `JWT_SECRET` later does not lock 2FA users out. After setting it run `node scripts/reencrypt-secrets.mjs` once. Keep it backed up: losing it makes those secrets unreadable |
| `PUSH_ENABLED`, `EXPO_ACCESS_TOKEN` | phone alerts go through Expo's push service. On by default; `EXPO_ACCESS_TOKEN` only if you switch on enhanced push security in Expo. The Firebase steps are in `mobile/STORE.md` |
| `APP_ORIGIN` | your public address, `https://flowxp.in` (must be https in production) |
| `CORS_ORIGINS` | other sites allowed to call the API, e.g. a separate marketing site (optional) |
| `SMTP_*`, `MAIL_FROM` | outbound email: password links, staff invites, supplier orders. Blank = logged only |
| `ANTHROPIC_API_KEY` | switches on Flow AI and reading menus from photos. Blank = both stay off |
| `STORAGE_DRIVER` | `local` (photos on the server's own disk) or `s3` (see below) |
| `SUPER_ADMIN_EMAIL/PASSWORD` | the platform operator account (optional) |

See `backend/.env.example` for the full list with comments — that file is the source of truth.

## 2. Photos: local disk or a bucket

With `STORAGE_DRIVER=local`, photos are kept under `backend/uploads` on the server's own disk. That is fine on
one server **that you back up**, and is exactly what the `uploads/` entry in `.gitignore` expects. It stops being
fine the moment you run more than one API instance (PM2 cluster mode) or move to a new server, since the disk
isn't shared between them.

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

## 2c. Sign in with Google (optional)

A second way to sign in for people who already have a FlowXP account. It never creates an account: someone whose Google
address has no FlowXP account is sent to the free-trial form.

1. Google Cloud Console, a project of your own: **APIs & Services > OAuth consent screen** (External, app name FlowXP,
   your support email, the `flowxp.in` domain), then **Credentials > Create credentials > OAuth client ID > Web application**.
2. **Authorised redirect URI**: `https://flowxp.in/api/auth/google/callback` (exactly `APP_ORIGIN` + `/api/auth/google/callback`).
3. Put the client ID and secret in `backend/.env` as `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, restart the API.
   The "Continue with Google" button appears on the sign-in page by itself; with either blank it is hidden.
4. Publish the consent screen (from "Testing" to "In production") so people outside your test list can use it.

Rules the code enforces: the Google address must be verified by Google, must match an existing FlowXP account whose own
email is verified, and a super admin cannot use it (the platform console has its own sign-in). An account with an
authenticator app still has to enter its code. Every Google sign-in appears in the account's sign-in history as `GOOGLE`.

## 3. Backups (do this before real customers)

```bash
cd /var/www/flowxp/backend && DATABASE_URL=$(grep ^DATABASE_URL .env | cut -d= -f2-) ./scripts/backup.sh /var/backups/flowxp 14
```

To run it daily, add to the server's crontab (`crontab -e`):

```
0 3 * * *  cd /var/www/flowxp/backend && DATABASE_URL=$(grep ^DATABASE_URL .env | cut -d= -f2-) ./scripts/backup.sh /var/backups/flowxp 14
```

Then **copy the backup files off the server** (a backup on the same disk is not a backup): `rclone`, `scp`, or
your provider's snapshots. Restore into an empty database with:

```bash
gunzip -c flowxp-2026-09-25T0300.sql.gz | psql "$DATABASE_URL"
```

Try a restore once, on a spare server, before you need it.

## 4. Health checks and logs

- `GET /health` answers if the process is up. `GET /ready` answers only if the database does; point a load balancer
  or uptime monitor (UptimeRobot, Better Stack) at `/ready`.
- The API logs one JSON line per failed request (or every request in production) with a request id. The same id is
  in the `X-Request-Id` response header, so a customer can quote it. `pm2 logs flowxp-api`.
- PM2 restarts the process on an unexpected crash (`process.exit(1)` in server.js's own handlers); `pm2 status`
  shows restart counts, `max_memory_restart` in `ecosystem.config.cjs` guards against a leak eating the VPS.

## 5. Updating

```bash
cd /var/www/flowxp && git pull
cd backend && npm ci --omit=dev
cd ../frontend && npm ci && npm run build
cd .. && pm2 reload flowxp-api     # zero-downtime: finishes in-flight requests first (server.js's SIGTERM handler)
```

New migrations apply on start. They only ever move forward, so take a backup first when the release notes mention a
new migration. nginx serves the new `frontend/dist` immediately — no reload needed for a frontend-only change.

## What is not covered here

Running the API as more than one PM2 instance (the background worker would then run once per instance; set
`WORKER_ENABLED=false` on all but one — and switch `STORAGE_DRIVER` to `s3`, since local disk isn't shared), a
Redis queue, a WAF, and the payment gateway for subscriptions.

## Checked so far

The S3 request signing is verified against AWS's published examples and against a local stand-in bucket; the
production settings check, health endpoints and backup script are in place. The PM2 ecosystem file and nginx
config have **not been run against a live VPS** (no server available where this was written), so expect to fix
small things — paths, the Postgres user's auth method — on the first deploy.


## Before the first real launch: a checklist

- Everything is committed and pushed (nothing from the latest work is yet), and `npm test` in `backend/` passes on the server's copy.
- `.env` has `JWT_SECRET`, `ENCRYPTION_KEY`, an https `APP_ORIGIN`, real `SMTP_*`, and the super-admin account; `NODE_ENV=production` (the demo seeds refuse to run there).
- `sudo nginx -t` passes with `deploy/nginx.conf` (it adds per-address rate limits that were not tested on a real nginx) and a certificate is installed.
- A Postgres backup runs (`backend/scripts/backup.sh`) and one restore has been tried.
- The privacy policy mentions Flow AI, location for field sales, phone alerts and account deletion (`mobile/PLAY_PRIVACY.md`), and `https://flowxp.in/delete-account` is live.
- Sign in as each kind of business on the live server once, make a bill, and cancel it.
