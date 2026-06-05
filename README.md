# Proto Switcher Configurator

Private Shopify app for building premium product configurators on a single store.

## Features

- **Theme App Extension** — App block (customize button) + app embed (modal loader)
- **Fullscreen configurator modal** — Framer Motion animations, glassmorphism, mobile swipe
- **5-step flow** — Variants → Preview → Add-ons → Summary → Add to Cart
- **Live preview engine** — Layer-based image swapping with preloading
- **Conditional logic** — Show/hide options, price adjustments
- **Admin dashboard** — Create configurators, manage options, theme settings, analytics
- **Cart integration** — Shopify `/cart/add.js` with line item properties
- **Share configurations** — Save & restore via URL

## Tech stack

- Shopify Remix template
- React + Vite + Polaris + TailwindCSS
- Zustand + Framer Motion (storefront)
- Prisma + SQLite (dev) / PostgreSQL (prod)

## Quick start

```bash
npm install
cp .env.example .env   # Add your Shopify API credentials
npm run db:push
npm run db:seed
npm run config:link    # Link to Partners app
npm run dev            # Start dev server + tunnel
```

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for full setup, theme configuration, and production deployment.

## Project structure

```
app/
  routes/           Admin pages + app proxy API
  lib/              Configurator logic, types, conditional rules
  components/       Admin UI components
storefront/         Customer modal (built to theme extension)
extensions/
  proto-configurator/
    blocks/         Liquid app block + embed
    assets/         Built JS/CSS bundle
prisma/             Database schema + seed
```

## Theme setup

1. Enable **Proto Configurator** app embed in Theme Editor
2. Add **Configurator Button** block to product pages
3. Assign product IDs to a configurator in the admin app

## Environment variables

| Variable | Description |
|----------|-------------|
| `SHOPIFY_API_KEY` | App client ID |
| `SHOPIFY_API_SECRET` | App client secret |
| `SCOPES` | OAuth scopes |
| `SHOPIFY_APP_URL` | Public app URL |
| `SHOP` | Fixed shop domain (private app) |
| `DATABASE_URL` | SQLite or PostgreSQL connection |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Shopify dev server |
| `npm run build` | Build admin + storefront |
| `npm run deploy` | Deploy app + extensions |
| `npm run db:seed` | Seed demo configurator |
| `npm run build:storefront` | Rebuild theme extension assets |
