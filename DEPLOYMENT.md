# Proto Switcher Configurator — Deployment Guide

Private Shopify app for a single store. Not intended for App Store submission.

## Prerequisites

- Node.js 20.19+ or 22.12+
- Shopify Partners account
- A development store
- Shopify CLI (`npm install -g @shopify/cli@latest`)

## 1. Create the app in Partners Dashboard

1. Go to [Shopify Partners](https://partners.shopify.com) → Apps → Create app
2. Choose **Create app manually** (custom/private app)
3. Copy **Client ID** and **Client secret**
4. Set App URL to your tunnel URL during dev (CLI sets this automatically)

## 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
SHOPIFY_API_KEY=your_client_id
SHOPIFY_API_SECRET=your_client_secret
SCOPES=read_products,write_products,read_themes,write_themes,read_collections
SHOPIFY_APP_URL=https://your-tunnel-url.com
SHOP=your-store.myshopify.com
DATABASE_URL="postgresql://user:password@host:5432/dbname?sslmode=require"
DIRECT_URL="postgresql://user:password@host:5432/dbname?sslmode=require"
```

## 3. Install dependencies

```bash
npm install
```

## 4. Database setup

```bash
npm run db:push
npm run db:seed
```

The schema uses PostgreSQL. Use a Neon, Vercel Postgres, or Supabase database for both local dev and production.

## 5. Link app config

```bash
npm run config:link
```

Paste your Client ID when prompted.

## 6. Start development

```bash
npm run dev
```

Press `p` to open the app in Shopify Admin. Install on your development store when prompted.

In a second terminal (optional, for storefront JS hot rebuild):

```bash
npm run dev:storefront
```

## 7. Theme setup (required)

After first deploy/dev sync:

1. **Online Store → Themes → Customize**
2. **App embeds** → Enable **Proto Configurator**
3. **Product page template** → Add block **Configurator Button**
4. Save

## 8. Create a configurator

1. Open the app in Shopify Admin
2. **Configurators → Create**
3. Select the product(s) this configurator applies to
4. Add options, add-ons, and conditional rules
5. Save and test on the product page

## 9. App proxy

Configured in `shopify.app.toml`:

- Prefix: `apps`
- Subpath: `proto-configurator`
- Storefront URL: `/apps/proto-configurator/product/{productId}`

The CLI updates proxy URL on deploy. Verify in Partners → App setup → App proxy.

## 10. Deploy to Vercel

### Prerequisites

- GitHub repo connected to [Vercel](https://vercel.com)
- PostgreSQL database (Neon, Vercel Postgres, or Supabase)
- Shopify Partners app credentials

### Vercel project setup

1. **Import** the `robo-gs-team/te-configurator` repo in Vercel
2. Framework preset: **Remix** (auto-detected)
3. **Disable Vercel Authentication** under Project Settings → Deployment Protection (prevents 401 in Shopify admin iframe)
4. Set **Node.js version** to `20.x`

Build settings are configured in `vercel.json` — the `vercel-build` script runs Prisma migrations then builds the app. For Supabase, it **derives `DIRECT_URL` from `DATABASE_URL`** (same password, port 5432) so a mistyped session-pooler string does not fail the build with P1000.

### Environment variables (Vercel → Settings → Environment Variables)

| Variable | Description |
|----------|-------------|
| `SHOPIFY_API_KEY` | Client ID from Partners Dashboard |
| `SHOPIFY_API_SECRET` | Client secret |
| `SCOPES` | `read_products,write_products,read_themes,write_themes` |
| `SHOPIFY_APP_URL` | Your Vercel URL, e.g. `https://te-configurator.vercel.app` |
| `SHOP` | Store domain, e.g. `your-store.myshopify.com` |
| `DATABASE_URL` | PostgreSQL pooled connection string |
| `DIRECT_URL` | PostgreSQL direct connection string (for migrations) |

If using **Vercel Postgres**, set `DATABASE_URL` to `POSTGRES_PRISMA_URL` and `DIRECT_URL` to `POSTGRES_URL_NON_POOLING`.

#### Supabase + Vercel (important)

Vercel **cannot** connect to Supabase's `db.xxxx.supabase.co:5432` direct host during builds (P1001 error). Use the **pooler** URLs from Supabase → **Connect**:

| Variable | Supabase tab | Port | Example host |
|----------|--------------|------|--------------|
| `DATABASE_URL` | **Connection pooling → Transaction** | 6543 | `*.pooler.supabase.com` |
| `DIRECT_URL` | **Connection pooling → Session** | 5432 | `*.pooler.supabase.com` |

Do **not** paste the "Direct connection" (`db.xxxx.supabase.co`) string into Vercel env vars.

After updating env vars in Vercel, redeploy (Deployments → ⋯ → Redeploy).

### After first Vercel deploy

1. Copy your live Vercel URL
2. Update `shopify.app.production.toml` with that URL (`application_url`, `redirect_urls`, `app_proxy.url`)
3. Update the same URLs in **Partners → App setup**
4. Deploy Shopify extensions:

```bash
npm run config:use production
shopify app deploy
```

5. Reinstall the app on your store if OAuth URLs changed

### Local development with PostgreSQL

Local dev also uses PostgreSQL now. Point `.env` at a Neon/Supabase database (or a local Postgres instance) using the same `DATABASE_URL` and `DIRECT_URL` format from `.env.example`.

```bash
npm run db:migrate   # apply migrations
npm run db:seed      # optional seed data
npm run dev
```

## 11. Deploy extensions

```bash
npm run deploy
```

This pushes the theme app extension to Shopify using `shopify.app.production.toml`.

### Automatic Shopify deploy (GitHub Actions)

Pushes to `main` that change `extensions/`, `storefront/`, or Shopify config files trigger `.github/workflows/deploy-shopify.yml`.

1. Create an **App Automation Token** in the Dev Dashboard → your app → Settings.
2. Add it to GitHub → **Settings → Secrets → Actions** as `SHOPIFY_APP_AUTOMATION_TOKEN`.
3. The workflow builds storefront assets and runs `shopify app deploy --config production --allow-updates`.

Vercel still deploys the Remix app separately when you push to `main`.

## Architecture overview

```
app/                    Remix admin + API routes
  routes/               Dashboard, configurators, proxy
  lib/                  Business logic, types, conditional rules
storefront/             Customer-facing modal (React + Zustand + Framer Motion)
extensions/             Theme app extension (button + embed)
prisma/                 Database schema (PostgreSQL)
```

## Cart integration

Uses Shopify `/cart/add.js` with line item properties. Compatible with:

- AJAX cart
- Dawn cart drawer (`cart-drawer` custom element)
- Standard Online Store 2.0 themes

## Security

- App proxy requests verified via HMAC signature (production)
- Admin routes protected by Shopify OAuth session
- User inputs sanitized on API endpoints

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Button doesn't appear | Enable app embed + add button block in theme editor |
| Modal doesn't open | Check product ID is assigned to a configurator |
| Proxy 401 | Verify app proxy URL matches deployed app URL |
| Cart add fails | Ensure variant IDs are set on options |
| Vercel 401 in admin | Disable Vercel Authentication in deployment protection |
| Prisma session table missing | Ensure `vercel-build` runs and `DATABASE_URL`/`DIRECT_URL` are set |
| P1000 Authentication failed (Supabase) | Ensure `DATABASE_URL` password matches Supabase → Connect → Transaction pooler; fix or remove a wrong `DIRECT_URL` in Vercel (build derives it from `DATABASE_URL`) |
| P1001 Can't reach database (Supabase) | Use **Session pooler** for `DIRECT_URL`, not `db.xxxx.supabase.co` |
| Vercel build peer dep error | `vercel.json` uses `npm install --legacy-peer-deps` |
