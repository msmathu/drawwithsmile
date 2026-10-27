# Free-tier deployment ($0)

> Free tiers change. The limits below were checked on **2026-10-23** against the providers' own pages. Re-check them before relying on them, and **do not add a payment method unless you intend to pay**. On Render, an account without one is suspended when it exceeds the free allowance, instead of being billed.

## Providers and their free-tier limits

| Part | Provider | Key free limits (checked 2026-10-23) |
| --- | --- | --- |
| Web client (static PWA) | **Cloudflare Pages** | 500 builds/month, 1 concurrent build (20 min timeout), 20,000 files, 25 MiB per file. Bandwidth limit not stated. SPA fallback automatic. `_headers` supported. |
| Game server | **Render Free web service** | Sleeps after **15 min** without traffic; wake-up ≈ **1 min**. **750 instance-hours/month** per workspace. Bandwidth and build minutes come from a monthly allowance. **Ephemeral filesystem**. **Single instance only**. May be restarted at any time. WebSockets supported (active socket messages keep it awake). |
| Database | **Supabase Free** | **500 MB** DB, 5 GB egress. **Paused after 1 week of inactivity** (unpause in the dashboard). 2 active free projects. **No automatic backups**. |
| Source control | GitHub free | Public or private repositories. |

What this means for players:

- The first visitor after an idle period waits about a minute while Render wakes up; the app shows "Connecting…". Do not use "keep-alive" pinging to dodge sleep. It uses up the 750 hours and may break the provider's terms.
- A Render restart or redeploy ends games in progress. Players are returned to the home page.
- One service running continuously uses about 730 hours a month, which is close to the 750-hour cap. A second always-on free service in the same workspace would exhaust it.
- No backups: export important data yourself (see *Backups* below).

**Alternatives if a provider stops fitting:** Koyeb or Fly.io can host the server (check their current free offers; some now require a card). Neon is a free serverless Postgres; use its pooled connection string. Netlify, GitHub Pages or Vercel can host the static client; on GitHub Pages, add a `404.html` copy of `index.html` for SPA routing. You can also run everything from your own computer in single-origin mode behind a free Cloudflare Tunnel (see TESTING.md).

## Easiest: one Render service (game + website) — recommended to start

`render.yaml` is set up so **one free Render web service** builds everything, runs the game server and serves the website from the same address. That gives you one link to share and no cross-site settings. The server allows its own Render address automatically (`RENDER_EXTERNAL_URL`).

1. (Optional, recommended) Do step 1 below to create a free Supabase database and copy its Session pooler URI.
2. Render → **New → Blueprint** → connect GitHub → pick this repository → **Apply**. When asked, paste the URI into `DATABASE_URL` (or leave it empty to play without saved scores/bans).
3. Wait for the first build (about 5–10 minutes), then open `https://<service-name>.onrender.com` and share it.

Steps 2 and 3 below describe the alternative split setup (Render for the server + Cloudflare Pages for the website). It loads the page faster while the free server is waking up, but needs more configuration.

## 1. Supabase (database)

1. Sign up at supabase.com → **New project** (Free plan). Pick a region close to your Render region and save the database password.
2. Project → **Connect** → choose **Session pooler**. Copy the URI. It looks like
   `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`.
   - Use the **session pooler (port 5432)**. The direct connection is IPv6-only on the free plan, and Render may not reach it. Transaction mode (6543) is meant for serverless.
3. Nothing else is needed: the server runs migrations and seeds the words on first start. You can also run them from your machine:
   `DATABASE_URL="<uri>" npm run db:seed`.
4. Optional, stricter TLS: download the Supabase CA certificate (Project Settings → Database → SSL). Set `DATABASE_SSL=verify` and `DATABASE_CA_CERT` to the PEM content (`\n` escapes are accepted). The default `require` encrypts the connection but does not verify the certificate.

## 2. Render (game server)

1. Push this repository to GitHub.
2. Render → **New → Blueprint** → select the repo. It reads `render.yaml`: free plan, build `npm ci && npm run build:server`, start `npm start`, health check `/api/health`, `NODE_ENV=production`, `TRUST_PROXY=1`, and a generated `SESSION_SECRET`.
3. Fill in the prompted variables:
   - `DATABASE_URL`: the Supabase session-pooler URI.
   - `CLIENT_ORIGINS`: your Pages URL, e.g. `https://drawwithsmile.pages.dev`. Add any custom domain, plus `https://localhost,capacitor://localhost` if you build the native apps.
4. Deploy. Check `https://<service>.onrender.com/api/health`. It should show `"database":"postgres"` and the word count.
   - If it shows `"database":"unavailable"`, the game still works but nothing is saved. Check the URL, password and that the Supabase project isn't paused.

## 3. Cloudflare Pages (web client / PWA)

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git** → select the repo.
2. Build settings:
   - Framework preset: *None*
   - Build command: `npm ci && npm run build:client`
   - Build output directory: `client/drawwithsmile-web/dist/drawwithsmile-web/browser`
   - Environment variables: `DWS_API_URL=https://<service>.onrender.com` and `NODE_VERSION=22`
3. Deploy. The build bakes the API URL into the app and writes a `_headers` file. That file sets the CSP (allowing connections to the API URL), security headers and cache rules for the service worker.
4. Make sure the Pages URL is in Render's `CLIENT_ORIGINS`, otherwise the browser's connection is refused.

HTTPS and WSS are automatic: Pages and Render both serve HTTPS, so the client connects with `wss://`.

## 4. Optional: Android / iOS apps with Capacitor

A free toolchain is available. Building for iOS requires a Mac with Xcode, and publishing costs money: about $25 one-off for Google Play and $99/year for Apple. The **PWA needs neither**: players can install it from the browser.

```bash
cd client/drawwithsmile-web
npm i -D @capacitor/cli @capacitor/core @capacitor/android @capacitor/ios
DWS_API_URL=https://<service>.onrender.com npm run build
npx cap add android        # needs Android Studio to build/run
npx cap add ios            # macOS + Xcode only
npx cap sync
npx cap open android
```

Add `https://localhost` (Android) and `capacitor://localhost` (iOS) to `CLIENT_ORIGINS`. *Not verified:* no native build was produced in the development environment.

## Backups (Supabase Free has none)

Run periodically from your machine (needs the free `pg_dump` client tools):

```bash
pg_dump "<session-pooler-uri>" --no-owner --format=custom -f drawwithsmile-$(date +%F).dump
```

Rooms and drawings are never stored, so a backup only needs the results, stats, reports and words.

## Production checklist

- [ ] `SESSION_SECRET` set (32+ random chars). The server refuses to start in production without it.
- [ ] `CLIENT_ORIGINS` lists exactly your client origins.
- [ ] `TRUST_PROXY=1` on Render, so per-IP limits use the real client IP.
- [ ] `/api/health` shows `database: postgres`.
- [ ] Two devices on different networks can play a full game (see TESTING.md).
