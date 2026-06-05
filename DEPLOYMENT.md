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
SCOPES=read_products,write_products,read_themes,write_themes
SHOPIFY_APP_URL=https://your-tunnel-url.com
SHOP=your-store.myshopify.com
DATABASE_URL="file:./dev.sqlite"
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

For production with PostgreSQL, change `provider` in `prisma/schema.prisma` to `postgresql` and set `DATABASE_URL`.

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
3. Enter product ID(s) from Shopify Admin product URL
4. Add options, add-ons, and conditional rules
5. Save and test on the product page

## 9. App proxy

Configured in `shopify.app.toml`:

- Prefix: `apps`
- Subpath: `proto-configurator`
- Storefront URL: `/apps/proto-configurator/product/{productId}`

The CLI updates proxy URL on deploy. Verify in Partners → App setup → App proxy.

## 10. Production build

```bash
npm run build
npm run setup
npm run start
```

Deploy to your host (Fly.io, Railway, Render, VPS). Set all env vars including:

- `SHOPIFY_APP_URL` = production HTTPS URL
- `DATABASE_URL` = PostgreSQL connection string

## 11. Deploy extensions

```bash
npm run deploy
```

This pushes the theme app extension to Shopify.

## Architecture overview

```
app/                    Remix admin + API routes
  routes/               Dashboard, configurators, proxy
  lib/                  Business logic, types, conditional rules
storefront/             Customer-facing modal (React + Zustand + Framer Motion)
extensions/             Theme app extension (button + embed)
prisma/                 Database schema (SQLite dev / Postgres prod)
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
