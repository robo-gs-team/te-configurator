# Shopify App v2.0 Rebuild — Research Report (2025–2026)

**Context:** v2.0 rebuild of a custom tennis-racquet stringing configurator. v1 = embedded Remix app on Vercel + a theme app extension + an App Proxy that makes **live Shopify Admin GraphQL calls on every storefront page load**.

**TL;DR — the single biggest finding:** v1's core architecture (live Admin GraphQL per storefront page load via App Proxy) is an **anti-pattern in 2026**. Replace it with **config pre-synced into app-owned metaobjects/metafields and rendered server-side into the page via Liquid** (zero round-trip, inherits Shopify's full-page CDN cache). Plus three concrete deprecations to act on: the **Remix template** (→ React Router 7), **Shopify Scripts** (executions stop **June 30, 2026**), and **`checkout.liquid`** for thank-you/order-status (sunset **Aug 28, 2025**).

> **Sourcing caveat:** the research environment blocked direct fetches to `shopify.dev` (egress 403), so shopify.dev claims come from search-index extractions of the official pages, corroborated where possible by reachable primary sources (live npm registry data, GitHub issues). The most load-bearing facts (React Router migration, Scripts/checkout.liquid sunsets, nested cart lines, Liquid-proxy-is-uncacheable) are each independently corroborated. Re-verify exact numeric limits on the live pages before capacity planning.

---

## 1. Theme App Extensions (2025–2026)

### App blocks vs app embed blocks
- **App blocks** = inline content placed by the merchant into a section/template (or an auto-generated "Apps" section). OS 2.0 only (rely on JSON templates/sections). Can bind to **dynamic sources** (e.g., the current product) via autofill resource settings. Use for the **inline product-page configurator UI** bound to the current product.
- **App embed blocks** = floating/overlaid or document-level code, injected by Shopify **before `</head>` and `</body>` globally on every page**. Work in vintage + OS 2.0. **Cannot** bind to dynamic sources (global Liquid scope only). **Deactivated by default** after install.

### Can an app embed render UI directly without a separate theme block? — **Yes**
This is exactly their purpose: floating widgets/overlays render globally without the merchant placing anything into a template. **Caveat:** the merchant must still **activate** the embed once (Theme Settings → App embeds), which deep-linking streamlines. For a configurator that must sit *inline on the product page bound to the current product*, an **app block** is the right primitive; an app embed is for global/floating UI.

### Minimizing merchant setup
- Neither block type is "live" automatically — there is **no way to auto-place an app block** on install, and embeds ship **off by default**. So reduce setup to **one click via deep-linking**.
- Always define a **`preset`** (with a `name`) for app blocks — without it the block won't appear in the "Add block" panel.
- Use **autofill resource settings** so the product-page block auto-binds to the current product with no merchant config.

### Deep-link URL formats
Activate an **app embed**:
```
https://<shop>/admin/themes/current/editor?context=apps&template=product&activateAppId={api_key}/{handle}
```
Add an **app block** to a new Apps section:
```
https://<shop>/admin/themes/current/editor?template=product&addAppBlockId={api_key}/{handle}&target=newAppsSection
```
`api_key` = app `client_id`; `{handle}` = the block's Liquid filename without extension. Gotcha: `current` can resolve to draft vs published — verify which theme the merchant is editing.

### 2025–2026 limits & changes
- **App blocks per extension raised to 30** (changelog 2026-02-03; was 10 → 25).
- Total Liquid across the extension: **100 KB**; **25 interactive settings** per block; locale file **15 KB**; per-block JS theme-check warns ~**10 KB** compressed.
- App Bridge `shopify.app.extensions()` now covers Theme + Admin extensions (changelog 2026-01-23).
- Assets referenced via `"stylesheet"`/`"javascript"` in the schema load **only when the block is active** — the performant default; assets are CDN-served.

**Sources:** shopify.dev/docs/apps/build/online-store/theme-app-extensions{,/configuration,/ux}; shopify.dev/docs/storefronts/themes/architecture/blocks/app-blocks; shopify.dev/changelog/increasing-the-app-block-limit-to-30-for-theme-app-extensions

---

## 2. Storefront Data Delivery — fastest & most reliable

**Ranking for a theme app extension getting config data:**

| Need | Best option | Round-trips | Cacheable |
|---|---|---|---|
| Config / catalog / pricing (mostly static) | **Liquid metafields/metaobjects** (`app` object / `$app:`) | **0** | Yes (full-page CDN) |
| Live catalog/inventory/cart fetched by JS | **Storefront API + public token** | 1 (scales for buyers) | per your fetch |
| Dynamic, server-logic/secret data | **App Proxy returning JSON**, cached | 2+ hops | JSON only |
| **Live Admin GraphQL per page load via App Proxy** | **AVOID (v1's approach)** | 3+ hops | No |

### Why v1's approach is an anti-pattern (FLAG)
- **3+ serialized hops**: browser → Shopify → your server → Admin GraphQL → back. Shopify's own perf team warns against proxy-in-the-middle architectures.
- **HMAC verification** on every proxied request (per-request CPU + hard dependency on your server being up = single point of failure injected into every page render).
- **Admin GraphQL is cost-throttled (leaky bucket ~50–100 pts/s)** and not designed for buyer-facing fan-out → throttling/429s under traffic.
- **Not CDN-cacheable** (see below).

### Critical: App Proxy **Liquid** responses are forced uncacheable
When a proxy response is `Content-Type: application/liquid`, Shopify returns `Cache-Control: max-age=0, private, must-revalidate` — so "App Proxy + caching" does **not** save you for the Liquid case. Only **non-Liquid (JSON/static)** proxy responses honor your own `Cache-Control` (e.g., `public, max-age=…`). Cookies and many custom headers are stripped both ways.

### Recommended replacement
Sync the needed data from Admin GraphQL **ahead of time** (on install / webhooks / cron) into **app-owned metafields/metaobjects**, then **render it into the page via Liquid** (emit JSON into a `<script type="application/json">` tag for your JS to parse synchronously). Latency ≈ 0; reliability = the page itself; caching = free full-page cache. Use the **Storefront API from the browser** only for genuinely live data (real-time inventory), which sends load per-buyer-IP and has **no fixed RPM limit** since the July 2023 change.

**Sources:** performance.shopify.com/blogs/blog/you-probably-dont-need-a-web-performance-proxy; github.com/Shopify/shopify_app/issues/379 (the forced no-cache header); shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies; shopify.dev/changelog/remove-rate-limits-on-the-storefront-api; shopify.dev/docs/api/usage/limits

---

## 3. Metaobjects / Metafields as the config store (vs Postgres)

**Yes — this is a supported, recommended pattern for this app's config**, and it's the linchpin of fixing the performance problem (it's what you render via Liquid in §2).

### Mapping your config
- **"Stringable" flag** → a boolean **`$app` metafield on the product** (or a `list.metaobject_reference`).
- **String catalog** → an **`$app:tennis_string` metaobject definition**, one entry per string.
- **Pricing rules** → an `$app:pricing_rule` metaobject, or a JSON app-data metafield (≤64 KB). If pricing is enforced at checkout, expose it to a **Shopify Function** (Functions can read app-owned metafields/metaobjects).

### Pros vs Postgres
- No backend infra in the storefront read path; data co-located in the shop and **CDN-cached via Liquid**.
- Readable by Liquid, Storefront API, **and** Functions — one source of truth for storefront + checkout/discount logic.
- Declarative via TOML in the `$app` namespace → definitions deploy with the app.

### Cons / keep Postgres when
- **Not for secrets/credentials** (use env/secret manager) — Shopify says private app data generally belongs in a secure app DB.
- No rich relational queries; admin query complexity is budgeted.
- Keep Postgres if you need relational queries, >1M rows/type, audit history, or order/job operational state.

### Reading metaobjects in Liquid (theme app extension)
- Single entry: `{{ metaobjects.tennis_string.babolat_rpm }}` (`metaobjects.<type>.<handle>`).
- Field value: `{{ metaobject.gauge.value }}` (use `.value`).
- System fields under `.system`: `{{ metaobject.system.handle }}`.
- From a product reference list:
  ```liquid
  {% for s in product.metafields.custom.strings.value %}
    {{ s.name.value }}
  {% endfor %}
  ```
- **Reserved `$app:` prefix works in theme app extension Liquid** (don't hardcode `app--{app_id}`) — `metaobjects.$app:custom['handle']`, and app-data metafields via `{{ app.metafields.<ns>.<key> }}`.

### Limits & gotchas (re-verify before capacity planning)
- **128 metaobject definitions/app/shop**, **40 fields/definition**, up to **1,000,000 entries/definition**.
- Rendering lists: `metaobject_definition.values` loops **max 50 without pagination**; wrap in `{% paginate %}` for 1–250/page up to the 25,000th item. Handle-by-handle lookups cap at **20 handles/page** (no pagination).
- **A `list.metaobject_reference` is capped at the first 50 referenced metaobjects in Liquid** — relevant if a "stringable" product references a long list.
- `access.storefront = "public_read"` is needed for **headless/Storefront API** reads; **Liquid themes read regardless**. App-owned metafield definitions default to `LEGACY_LIQUID_ONLY` (render in Liquid, but set storefront access explicitly if you also need Storefront API).
- `$app`-reserved definitions are declared **only via TOML** (not API), so only your app mutates them; merchant admin is read-only unless set `MERCHANT_READ_WRITE`.

**Sources:** shopify.dev/docs/apps/build/metaobjects/{data-modeling-with-metafields-and-metaobjects,metaobject-limits,use-metaobject-capabilities}; shopify.dev/docs/apps/build/custom-data/{ownership,declarative-custom-data-definitions}; shopify.dev/docs/api/liquid/objects/{metaobject,metaobjects,metaobject_system}; shopify.dev/docs/api/liquid/tags/paginate; community.shopify.dev (50-ref cap thread)

---

## 4. Cart & Checkout — adding the configured product

### Two modern patterns for "racquet + stringing labor + chosen string"

**Pattern A — Nested cart lines (RECOMMENDED here).** Purpose-built for a main product + attached service/add-on (warranties, protection plans, **service fees**). Add the racquet as **parent**, then stringing-labor and the chosen-string product as nested **children** in one `/cart/add.js` call using `parent_id` (same request) or `parent_line_key` (existing line). One level of nesting only. Available in Cart Ajax API, and since 2025-10 in Storefront API (`cartLinesAdd`) and Checkout UI extensions. Keeps three real line items (good for inventory of the physical string + a labor SKU), groups them, and **avoids the Cart-Transform property-stripping bug**. Carry config as line item properties: visible `Tension`, `String`; hidden `_configId`.

**Pattern B — Cart Transform `expand` (true bundle).** Sell one configurable "Custom Strung Racquet" line, then a **Cart Transform function** expands it into priced components (racquet + string + labor) carrying a `LineItemGroup` relationship into the order. Per-component fixed pricing since API 2024-01. **Critical gotcha:** incoming **line item properties are dropped on expand** — re-emit string/tension as **custom attributes on the expanded components**. More engineering (a Function + ideally a checkout UI extension). You **cannot** nest add-ons under a bundle parent, so A and B are mutually exclusive for the same grouping.

**Recommendation:** For a stringing shop wanting clean fulfillment of a physical string + a labor SKU attached to the racquet, **Pattern A (nested cart lines)** is simpler, lower-maintenance, and equally modern.

### Cart Ajax API specifics
`POST /cart/add.js` with `items[].properties`. Underscore-prefixed keys (`_configId`) are hidden from checkout but **visible on the admin Order page** and in Liquid `line_item.properties`. Gotcha: a POST with `properties` overwrites the whole properties object for the line.

### Deprecations to act on (FLAG)
- **Shopify Scripts**: no create/edit after **April 15, 2026**; existing Scripts **stop executing June 30, 2026** → use Shopify Functions.
- **`checkout.liquid`** for thank-you/order-status pages **sunset Aug 28, 2025** → Checkout UI extensions. (Info/Shipping/Payment steps sunset Aug 13, 2024.)
- Checkout UI extensions on info/shipping/payment steps are **Plus-only**; thank-you/order-status are broadly available. As of 2025-10 they're **web-component-based** (upgrade guide to 2026-01).

**Sources:** shopify.dev/docs/apps/build/product-merchandising/nested-cart-lines{,/create-nested-cart-lines,/tutorial}; shopify.dev/changelog/new-support-for-nested-cart-lines; shopify.dev/docs/api/ajax/reference/cart; shopify.dev/docs/api/functions/latest/cart-transform; community.shopify.dev/t/line-item-properties-missing-following-cart-transform-expand-operation/303; changelog.shopify.com/posts/shopify-scripts-deprecation; shopify.dev/docs/storefronts/themes/architecture/layouts/checkout-liquid

---

## 5. Performance & Hosting

### React Router 7 — the Remix template IS superseded (FLAG, confirmed via live npm)
- Use **`@shopify/shopify-app-react-router`** (GA, latest **1.2.0** pub 2026-03-11), template **`Shopify/shopify-app-template-react-router`**. Scaffold with `shopify app init` (now defaults to React Router) or `--template=…/shopify-app-template-react-router`.
- `@shopify/shopify-app-remix` (latest 4.2.0) is **not hard-deprecated** but its README says: *"If you are building a new Shopify app you should use React Router and not Remix."* Support is **security-only maintenance**.
- The RR template also moves to **Polaris web components**.
- **Migrating v1:** APIs are largely unchanged (RR is a fork of the Remix package) — the upgrade is mostly mechanical (Remix→React Router 7 imports/config), following the official "Upgrading from Remix" wiki.

### Cold starts
- **Vercel Fluid compute** (default for new projects since Apr 23, 2025): in-function concurrency, **scale-to-one** (a warm instance stays up), bytecode caching. Mitigates but is still a serverless model.
- Standard fixes: trim bundle/deps, **pin region near the DB**, cron pre-warm, **DB connection pooling** (PgBouncer/Prisma Accelerate/Neon/Supabase pooler).
- Alternative: an **always-on container** (Fly/Railway/Render) eliminates cold starts — matters because the embedded admin iframe load latency is user-visible.

### Hosting (2026)
- **Fly.io** — 30+ regions, containers, websockets/persistent connections, colocated Postgres, always-on machines (~61 ms warm RTT in one benchmark). Best for multi-region low latency / persistent connections.
- **Vercel + Fluid** — best DX for React Router; no first-party websockets; pair with a pooled DB, region-pinned.
- **Railway / Render** — simple always-on containers, fewer regions; Render free tier spins down (use paid always-on for embedded).
- **Recommendation:** for *this* app (config in metaobjects, mostly request/response admin, no websockets), **Vercel + Fluid + pooled DB region-pinned** is fine; choose **Fly.io** if you want always-on/multi-region or grow into websockets. Either way: **co-locate app + DB, pool connections, avoid scale-to-zero** on the embedded surface. Note: most storefront read traffic now bypasses your server entirely (it's in Liquid/metaobjects), which dramatically relaxes hosting requirements vs v1.

### Storefront perf (App Store gate)
- **Must not drop storefront Lighthouse score by >10 points** (also a Built for Shopify requirement).
- Targets: app entry **<10 KB JS / <50 KB CSS** per page; minified JS bundle ≤16 KB.
- **Import-on-interaction** (defer the configurator bundle until the user engages it); use `defer` (not render-blocking); lazy-load offscreen assets; avoid CLS; monitor via the Web Performance Dashboard + Core Web Vitals.

**Sources:** npmjs.com/package/@shopify/shopify-app-react-router (+registry metadata); github.com/Shopify/shopify-app-template-react-router/wiki/Upgrading-from-Remix; remix.run/blog/merging-remix-and-react-router; vercel.com/blog/scale-to-one-how-fluid-solves-cold-starts; vercel.com/docs/fluid-compute; shopify.dev/docs/apps/build/performance/{general-best-practices,storefront}; shopify.dev/docs/apps/launch/built-for-shopify/requirements

---

## 6. Product Configurator UX (conversion)

### Flow & structure
- **Progressive disclosure**, short stepped flow: **racquet → string → tension → summary**, with a progress indicator. Progressive interfaces complete ~30–50% faster than full-exposure forms; multi-step beats one long single-page form for complex configs (one brand: +38% submission rate after de-cluttering).
- **Sensible defaults + "Recommended/Popular" labels** to fight choice overload. Classic benchmark: ~6 options → 30% purchase vs 24 options → 3%. Show **~4–6 main options per decision**; push advanced choices behind expanders. Critical for a large string catalog.

### Price & preview
- **Persistent live preview + running price** that updates per selection, with an **itemized breakdown** (racquet + string + labor) before add-to-cart. Hidden/surprise costs are the #1 abandonment driver (48% of abandons; ~14% abandon when total cost isn't visible up front; aggregate cart abandonment ~70%).
- Keep option-change feedback **<100 ms** (Doherty threshold); announce price/validation changes via **ARIA live regions**.

### Mobile & trust
- **Sticky add-to-cart/summary bar** on mobile (thumbnail, name, price, selectors, qty, Add to Cart) — cited ~19% add-to-cart lift / ~41% less scroll-back abandonment / +18% AOV case study.
- **Editable summary/review step** before commit; state customization/return policy clearly (custom items often final sale).

### Accessibility (real legal risk)
- Variant/option selectors and modals are the **top failure points** (inaccessible selectors in 78% of audited cases; keyboard traps in modals 64%). Ensure full keyboard operability, visible focus, no keyboard traps, labeled controls, ARIA live updates. 4,605 US ADA web suits in 2024; EU Accessibility Act enforceable since Jun 28, 2025.

### Performance = conversion
- Good Core Web Vitals correlate with ~2× conversion; LCP 2s vs 4–5s ~40–50% higher conversion; ~+8% retail conversion per 0.1s faster. 2025 "good": LCP ≤2.5s, INP ≤200ms, CLS ≤0.1. **Lazy-load the configurator, reserve layout space (avoid CLS), defer non-essential JS** — directly reinforces §5.

**Sources:** baymard.com/learn/checkout-flow-ux-optimization; baymard.com/lists/cart-abandonment-rate; nngroup.com (progressive disclosure / wizards / defaults / response times); gokickflip.com/blog/how-to-improve-conversion-rate-by-avoiding-choice-overload; vervaunt.com/ecommerce-product-builders-…; deloitte.com (Milliseconds Make Millions); shopify.dev/docs/storefronts/themes/best-practices/performance

---

## What to change from v1 (action list)
1. **Kill live Admin GraphQL per page load.** Pre-sync config to **app-owned metaobjects/metafields**; render via **Liquid** (zero round-trip, CDN-cached). [§2, §3]
2. **Reframe data flow:** App Proxy only for genuinely dynamic JSON (cached) or server secrets; Storefront API from the browser for live data. Remember **Liquid proxy responses are uncacheable**. [§2]
3. **Migrate Remix → React Router 7** (`@shopify/shopify-app-react-router`). [§5]
4. **Confirm checkout stack:** no Shopify Scripts (EOL Jun 30 2026), no `checkout.liquid` thank-you/order-status (sunset Aug 28 2025) → Functions + Checkout UI extensions. [§4]
5. **Cart:** prefer **nested cart lines** for racquet + labor + string. [§4]
6. **Onboarding:** product-page **app block** with preset + autofill + a one-click **deep link**. [§1]
7. **Hosting:** storefront load now bypasses your server, so Vercel+Fluid+pooled DB suffices; Fly.io if you want always-on/multi-region. [§5]
8. **UX:** stepped flow, smart defaults, live itemized price, mobile sticky bar, accessible selectors, lazy-loaded/deferred configurator. [§6]
