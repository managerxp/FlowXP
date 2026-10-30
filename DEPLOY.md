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

- **WhatsApp (Meta Cloud API):** `MESSAGING_PROVIDER=whatsapp_cloud`, `WHATSAPP_TOKEN` (a permanent system-user token) and `WHATSAPP_PHONE_ID` (and optionally `WHATSAPP_API_VERSION`, default `v26.0`: Meta retires old Graph API versions after about two years, so keep it at the version your Meta app dashboard shows). Create the seven templates listed in the app (Messaging, Settings, "Show the WhatsApp templates") in Meta Business Manager and wait for approval; until a template is approved its messages fail with Meta's reason, visible in the log.
- **SMS (Twilio):** `MESSAGING_PROVIDER=twilio`, `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`. In India, SMS also needs DLT registration of the sender and templates with your operator; Twilio's own docs cover it.
- Set `APP_ORIGIN` to the public https address: the bill link customers receive is built from it, and so is the gym's entrance QR link (`/gym/in/...`).
- Gyms: members sign in with a code sent by the messaging provider, so set one up (Super Admin > Settings > Messaging) before putting up the entrance QR. Set `ENCRYPTION_KEY`: gate-device secrets are encrypted under it. See `GYM.md`.
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

## FlowBook (accounting) inside the app

FlowBook is part of the FlowXP website: `https://flowxp.in/app/books` (screens) and `/api/books` (API), signed in with FlowXP's own session and business choice. No separate address, secret, login, process, database or nginx block. Extra step beyond the above:

```bash
# nothing to run: `npm ci` in backend/ also installs flowbook/api (postinstall). FlowBook needs Node 24 or newer (the rest of FlowXP runs on 22) and starts with the API; if it cannot, the API log says `[flowbook] could not start` with the reason.
```

- FlowBook needs **no variables of its own**: the key that seals stored tokens is derived from `ENCRYPTION_KEY` (or `JWT_SECRET`), email goes through FlowXP's mailbox (SMTP_* or Settings > Email) and WhatsApp through FlowXP's number (WHATSAPP_* or Settings > Messaging). Do not rotate `ENCRYPTION_KEY`/`JWT_SECRET` casually: stored WhatsApp tokens are sealed with the derived key.
- **Database:** FlowBook uses the existing FlowXP database and user; there is nothing to create. If that user may not create roles, FlowBook runs its requests as the user itself (row level security still applies); a superuser or role-creating user also gets a least-privilege `flowbook_app` role made automatically.
- FlowBook runs inside the FlowXP API process, its tables in the `flowbook` schema of the same database; migrations run when the API starts. `FLOWBOOK_EMBEDDED=false` switches it off. nginx's `/api/` block (with its rate limits) already covers `/api/books`.
- Sales from a business's till reach the books in process (no URL or signature). A business gets FlowBook if it signed up as FlowBook, or is paying (ACTIVE) on a plan with the `flowbook` feature; per-feature switches are in the super admin Features page.

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

## Android app: build the APK and show the download button

The website shows a "Download for Android (APK)" button only when the site is built with `VITE_ANDROID_APP_URL` set to an https link; with it empty there is no button.

1. On your computer, in `mobile/`: `npm install -g eas-cli`, then `eas login` (your Expo account), then `eas build --profile preview --platform android`. The `preview` profile makes an installable **APK** that talks to `https://flowxp.in`. The first build asks to create an Android keystore: let EAS keep it, and never lose it, because every update must be signed with the same one.
2. When the build ends, download the `.apk` from the link EAS prints (or from expo.dev, Builds).
3. On the server: `mkdir -p /var/www/flowxp/downloads`, copy the file there as `flowxp.apk` (`scp flowxp.apk root@server:/var/www/flowxp/downloads/flowxp.apk`), and `nginx -t && systemctl reload nginx` after the `location = /downloads/flowxp.apk` block from `deploy/nginx.conf` is in place.
4. Build the site with the link: `cd frontend && VITE_ANDROID_APP_URL=https://flowxp.in/downloads/flowxp.apk npm run build`. The button appears on the home page.
5. Each new version: raise `version` in `mobile/app.json` (the production profile raises `versionCode` itself), build again, replace the file on the server.

For Google Play later use `eas build --profile production --platform android` (an AAB) and `eas submit`; see `mobile/STORE.md`. Set `VITE_ANDROID_APP_URL` to the Play page then, and the button becomes "Get it on Google Play".

## WhatsApp delivery and read receipts (callback)

Meta calls back `https://YOUR-DOMAIN/api/webhooks/whatsapp` with delivery, read and failure receipts, and with customers' replies (a reply of STOP opts that customer out of promotions). Set it up in this order, because Meta checks the address the moment you save it:

1. Deploy this code and restart the API (migration 0112 adds the delivery times).
2. Super Admin, Settings, Messaging: provider `whatsapp_cloud`, the access token, the phone number ID, the **Meta app secret** (Meta app, App settings, Basic, App secret, Show) and a **verify token** (any long random text you choose). The same two can be set as `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN` in `backend/.env`.
3. In the Meta app: WhatsApp, Configuration, Webhook: Callback URL `https://YOUR-DOMAIN/api/webhooks/whatsapp`, the same verify token, then **Verify and save**, then subscribe to the **messages** field.

A callback that is not signed with the app secret is refused (401), and nothing is accepted while no secret is set.

### The bill template (payment receipt, with a View Bill and a Rate Us button)

One template, `flowxp_bill`, created once in WhatsApp Manager (Message templates, Create template), Utility, English. The exact text, samples and buttons are in `WHATSAPP_TEMPLATES.md`, section `flowxp_bill`:

- No header. The body has seven variables (the last is the closing line, which changes with the kind of business; the shop name and the amount are in bold italics, written `*_{{2}}_*`). Footer `Billing powered by FlowXP`.
- Button 1 `View Bill`: dynamic URL `https://YOUR-DOMAIN/bill/{{1}}`.
- Button 2 `Rate Us`: dynamic URL `https://YOUR-DOMAIN/r/{{1}}`. `{{1}}` is the same bill token as button 1: FlowXP sends the customer to that shop's Google review page (Settings, Business details, Google review link, a `https://g.page/r/...` link) or, when the shop has none, to the bill. A shop can change its link later without touching Meta.
- nginx needs the `/r/` location in `deploy/nginx.conf`: copy it to the server and run `nginx -t && systemctl reload nginx`.
- Optionally turn on a custom validity period; the default (10 minutes) also works.

All templates FlowXP can send (bill with and without the Google review button, gym reminders including the start-of-month one, salon, restaurant, wholesale), with the exact text, category, samples and buttons for Meta, are listed in `WHATSAPP_TEMPLATES.md` (regenerate it with `node backend/scripts/whatsapp-templates-doc.mjs` after changing a template).
