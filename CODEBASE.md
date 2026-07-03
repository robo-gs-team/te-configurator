# TE Configurator — Codebase Reference

Private Shopify app powering the racquet stringing configurator on the Tennis Express storefront. Merchants set up string options in the admin; shoppers pick strings, gauge, color, and tension on the product page and add to cart.

---

## Architecture in one sentence

An **embedded Shopify admin app** (Remix, hosted on Vercel) paired with a **theme extension** that injects a React modal into the storefront and calls back to the app via the **Shopify App Proxy**.

---

## 5 Shopify integration surfaces

| Surface | What it does |
|---|---|
| **Embedded admin app** | Remix + Polaris UI at `/app/*` — merchants create/edit configurators |
| **Theme extension block: `configurator-embed`** | App embed (global) — sets `window.ProtoConfiguratorSettings`, defers-loads JS/CSS bundle |
| **Theme extension block: `configurator-button`** | Per-template block — renders stringing dropdown (Strung/Unstrung) + Configure button |
| **App Proxy `/apps/proto-configurator/`** | Signed endpoint called by storefront JS — serves configurator JSON, analytics, share links |
| **Cart: `/cart/add.js`** | Standard Shopify endpoint — adds racquet + labor line items with encoded line item properties |

Webhooks: `app/uninstalled` (clears sessions), `app/scopes_update` (updates stored scopes).

---

## Project layout

```
app/
  routes/
    app._index.tsx          Dashboard (stats, recent configurators, setup checklist)
    app.configurators.$id   Edit a configurator — steps, option groups, addons, rules
    app.settings.tsx        Theme settings (button label/color, modal accent, CSS)
    app.analytics.tsx       Event counts from the Analytics table
    proxy.$.tsx             App proxy — serves storefront API (product, share, analytics, save)
    webhooks.*.tsx          Shopify webhook handlers
  lib/
    configurator.server.ts  DB read/write for configurators; lookupConfiguratorForProduct
    configurator.types.ts   Shared types + serializeConfiguratorPayload
    enrich-configurator.server.ts  Fetches live product images/prices from Shopify Admin API
    shopify-collections.server.ts  GraphQL helpers — collection products, product collections
    shopify-products.server.ts     GraphQL helpers — product images, variant IDs, prices
    proxy-cache.server.ts   In-memory server-side cache (5 min TTL, keyed shopDomain:productId)
    conditional-logic.ts    Evaluate ConditionalRules against current selections
  components/               Polaris admin UI components (pickers, forms)
  shopify.server.ts         Shopify SDK init — auth, session storage, API version
  db.server.ts              Prisma client singleton

storefront/
  entry.tsx                 Boot script — mounts React root, fetches proxy, handles click delegation
  components/
    ConfiguratorModal.tsx   Fullscreen modal — hosts StringingConfigurator or generic step flow
    StringingConfigurator.tsx  Standard/Hybrid string picker — catalog, gauge, color, tension slider
    Steps.tsx               Generic VariantStep and AddonsStep
    LivePreview.tsx         Layer-based image composition preview
  store/
    configurator-store.ts   Zustand store — all modal state (open/close, selections, cart)
  lib/
    cart.ts                 addToShopifyCart — builds line items, POSTs /cart/add.js
    stringing-cart.ts       Encodes string specs as Shopify line item properties
    string-catalog.ts       resolveStringCatalog — uses Shopify string products or hardcoded fallback
    stringing-gate.ts       Creates the Strung/Unstrung gate DOM wrapper
    stringing-page-gate.ts  applyStringingPageGate — shows/hides Configure button on dropdown change
    theme-placement.ts      Relocates the Configure button into the theme's buy-box
    configure-placement.ts  Manages the actions slot, inline vs hidden states
    theme-buybox.ts         Hides/shows Buy Now / accelerated checkout when Strung is selected
    product-linkage.ts      Adds pending/linked/unlinked CSS classes to html element
    product-id.ts           normalizeProductId — strips gid:// prefixes
    image-preloader.ts      Preloads product images when modal is about to open

extensions/proto-configurator/
  blocks/
    configurator-embed.liquid   Global app embed (loads bundle, sets window settings)
    configurator-button.liquid  Theme block (dropdown + button, inline gate script)
  assets/
    proto-configurator.js   Built IIFE bundle (311 KB, 99 KB gzip)
    proto-configurator.css  Built styles (26 KB, 6 KB gzip)

prisma/schema.prisma        Full DB schema
scripts/
  copy-storefront-assets.mjs  Copies built JS/CSS into extension assets after build
  vercel-build.mjs            Sets DIRECT_URL, runs prisma migrate deploy, then build
```

---

## Data model

```
Shop
  └── Configurator           (productIds[], collectionIds[], laborVariantId, basePrice, isActive)
        ├── ConfiguratorStep  (stepType, sortOrder)
        │     └── OptionGroup (collectionIds[], productIds[], displayType)
        │           └── Option (label, value, imageUrl, variantId, priceAdjust, colorHex)
        ├── Addon             (name, price, variantId, productIds[], collectionIds[], maxQuantity)
        ├── ConditionalRule   (condition → action, e.g. hide option / adjust price)
        └── ThemeSetting      (button label/color, modal accent, custom CSS)

Analytics                     (shopId, eventType, productId, sessionId, metadata, createdAt)
SavedConfiguration            (shareId, configuratorId, productId, selections, addons, expiresAt)
Session                       (Shopify OAuth sessions via PrismaSessionStorage)
```

Key design: `collectionIds` and `productIds` on `Configurator`, `OptionGroup`, and `Addon` are stored as JSON strings. They are references to Shopify objects, not resolved data — product images, prices, and variant IDs are fetched live from Shopify Admin API at read time (see Performance below).

---

## Full request flow — shopper on a product page

```
1. Shopify serves product page Liquid
   → configurator-embed block sets window.ProtoConfiguratorSettings
     { appProxyUrl, productId, shopDomain }
   → defers load of proto-configurator.js

2. proto-configurator.js boots (DOMContentLoaded)
   → initStorefrontUi():
       fetch /apps/proto-configurator/product/:id?shop=...
       → Shopify App Proxy validates request → hits Vercel function
       → proxy.$.tsx:
           check server-side in-memory cache (proxy-cache.server.ts)
           on MISS:
             unauthenticated.admin(shopDomain)          ← Shopify OAuth token DB read
             lookupConfiguratorForProduct()             ← DB: shop + all configurators
               getProductCollectionIds()                ← Shopify Admin GraphQL #1
             enrichConfiguratorWithShopifyData()        ← Shopify Admin GraphQL #2-N
               getProductsWithImages()                  ← batch product images/prices
               getProductsInCollections() × groups      ← collection products (parallel)
             ensureShop() + getShopThemeSettings()      ← 2 more DB queries
           serialize + cache + return JSON
       → cache result in configuratorCache (browser module-level, per productId)
       → show/hide Configure button based on linkage status

3. Shopper selects "Strung" in dropdown
   → applyStringingPageGate() shows [data-proto-configurator-actions]
   → Configure button becomes visible

4. Shopper clicks Configure
   → check configuratorCache → HIT (instant, no network call)
   → useConfiguratorStore.open(productId, configurator)
   → modal renders (React portal into document.body)
   → body pinned with position:fixed to prevent background scroll

5. Shopper picks string, gauge, color, tension

6. Shopper clicks Add to Cart
   → addToShopifyCart() builds two /cart/add.js line items:
       { id: racquetVariantId, quantity: 1, properties: {
           _string, _gauge, _color, _tension,
           _configurator_id, _parent_configurator: true } }
       { id: laborVariantId, quantity: 1, properties: {
           _parent_line, _string, _tension } }
   → dispatches cart:refresh event
   → modal closes
```

---

## Performance characteristics

### What's fast
- **Button click → modal open**: instant (browser module-level cache, set on page load)
- **Warm server hits**: near-instant (server-side in-memory cache, 5 min TTL)
- **CDN/browser**: `Cache-Control: public, max-age=300, stale-while-revalidate=60`

### What's slow
- **Cold Vercel function start**: 500–2000 ms (Node.js + Prisma + Shopify SDK init)
- **Cache MISS (first request per product per instance)**: 4–7 Shopify Admin GraphQL calls + 4–6 DB queries, all in the critical path
- **Root cause**: Product images, prices, and variant IDs are resolved live from Shopify Admin API on every cache miss, rather than being stored in the DB at save time

### The core architectural issue
`enrich-configurator.server.ts` translates collection/product ID references into real product data at **read time** (per request). It should do this at **write time** (when the merchant saves). Moving enrichment to the admin save action would:
- Delete `enrich-configurator.server.ts` from the read path entirely
- Remove the need for `unauthenticated.admin()` in the proxy
- Remove the server-side cache (no longer needed)
- Make the proxy a single DB query

---

## Theme extension setup (merchant-facing, manual)

The merchant must do **two separate steps** in the Shopify Theme Editor:

1. **Enable the app embed** — `Online Store → Themes → Customize → App embeds → Proto Configurator` (toggle on). This loads the JS bundle globally.
2. **Add the theme block** — navigate to the product page template, add the "Configurator Button" block. This renders the dropdown + button.

If either step is missed, the Configure button won't appear. The "Button status: Disabled" indicator in the dashboard reflects whether the embed is active.

---

## Admin app routes

| Route | Purpose |
|---|---|
| `/app` | Dashboard: configurator count, 30-day analytics, setup checklist |
| `/app/configurators` | List all configurators |
| `/app/configurators/new` | Create configurator — set name, link products/collections, labor SKU |
| `/app/configurators/:id` | Edit — manage steps, option groups, options, addons, conditional rules |
| `/app/settings` | Theme settings — button style, modal colors, custom CSS |
| `/app/analytics` | Event table — modal opens, add to carts, shares |

---

## App Proxy API (`/apps/proto-configurator/...`)

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/product/:id` | App Proxy sig or `?shop=` | Configurator JSON for a product |
| `GET` | `/share/:shareId` | App Proxy sig or `?shop=` | Restore a saved configuration |
| `POST` | `/analytics` | App Proxy sig or `?shop=` | Track an event |
| `POST` | `/save` | App Proxy sig or `?shop=` | Save a configuration, get share URL |

---

## Build & deploy

```bash
npm run build:storefront   # Vite → IIFE bundle → copied to extension assets
npm run build              # storefront + Remix admin build
npm run deploy             # shopify app deploy (pushes extension to Shopify)
```

Vercel auto-deploys on push. `scripts/vercel-build.mjs` derives `DIRECT_URL` from `DATABASE_URL` (Supabase pooler compatibility) then runs `prisma migrate deploy` before the Remix build.

---

## Known issues & v2.0 considerations

| Issue | Root cause | v2.0 fix |
|---|---|---|
| Slow on first load / cold start | Shopify Admin API calls at read time | Move enrichment to write time; proxy becomes a DB read |
| Complex setup (two theme editor steps) | Two separate blocks required | Merge into one, or auto-inject without a theme block |
| Generic data model for a specific use case | Built as a general configurator; only used for stringing | Purpose-built schema: `StringingConfig { racquetCollections, strings[], laborVariant }` |
| 10% modal → cart conversion | UX / trust / friction in the modal | Redesign storefront modal for v2 |
| `write_products` scope unused | Listed in scopes but no product write calls in codebase | Remove to reduce OAuth permission surface |
| `PrismaSessionStorage` adds DB reads to every proxy request | Session validation on each App Proxy call | Use lightweight HMAC-only validation for the read-only proxy route |
