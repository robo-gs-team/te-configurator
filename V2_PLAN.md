# TE Configurator v2.0 — Plan

Synthesis of four deep-dive audits (storefront/conversion, backend/data-model, admin/setup, Shopify 2026 research). Companion docs: `CODEBASE.md` (how v1 works), `V2_RESEARCH.md` (Shopify best-practice sources).

---

## The one big idea

**v1 resolves data at read time; v2 resolves it at write time and serves it from Shopify's own CDN.**

Every audit landed on the same root cause from a different angle:

- **Backend:** every storefront page load fires ~5–6 Postgres queries + 3–10 live Shopify Admin GraphQL calls behind a per-instance cache that dies on every Vercel cold start.
- **Research:** "live Admin GraphQL per storefront page load via App Proxy" is a **2026 anti-pattern** — 3+ network hops, HMAC per request, Admin API is cost-throttled and not buyer-facing, and **App Proxy Liquid responses are forced uncacheable**.
- **Storefront:** 311 KB of React + Framer Motion loads on every product page just to render an empty portal and run fragile DOM surgery.
- **Admin:** the "Button status" badge doesn't detect anything real — it reflects a vestigial DB checkbox.

The fix is structural, not incremental: **pre-sync config into app-owned Metaobjects, render it into the product page via Liquid (zero round-trips, full-page CDN cache), and ship a tiny storefront bundle that only boots when the shopper engages.**

---

## Target architecture

```
v1 (read-time resolution)                    v2 (write-time resolution)
─────────────────────────                    ──────────────────────────
Merchant saves → Postgres (IDs only)         Merchant saves → app resolves products
                                               once → writes Metaobjects ($app namespace)
                                               + Postgres (analytics/shares only)
                                                        │
Shopper loads page                           Shopper loads page
  → theme block                                → app block renders catalog JSON from
  → defer 311KB bundle                            metaobjects via Liquid (CDN-cached, 0 hops)
  → bundle fetches App Proxy                   → <script type="application/json"> in page
  → Vercel cold start                          → tiny gate script (~5KB) shows the CTA
  → 5-6 DB + 3-10 Admin GraphQL                → NO network call to our server
  → return JSON                                
                                             Shopper clicks Configure
Shopper clicks Configure                       → import-on-interaction: lazy-load modal
  → modal (already in bundle)                  → reads catalog already in the page
                                             
Add to cart                                  Add to cart
  → /cart/add.js (2 flat lines)                → /cart/add.js nested cart lines
                                                  (racquet parent + labor/string children)

App Proxy in v2: ONLY analytics beacons + share-link save/restore (infrequent, JSON, cacheable)
```

**What this deletes from the hot path:** `enrich-configurator.server.ts`, `proxy-cache.server.ts`, the collection-cache Map, `unauthenticated.admin()` on reads, the deep `configuratorInclude` join, and the whole `theme-placement / configure-placement / theme-buybox` DOM-surgery layer.

---

## Data model — purpose-built for stringing

v1 is a generic `Configurator → Step → OptionGroup → Option (+ Addon + ConditionalRule)` engine. The app only ever does tennis stringing — the real shape is already hardcoded in `storefront/lib/string-catalog.ts` (gauges, colors, tension 46–55, string types). The generic hierarchy is ~3–4× more surface than the domain needs, and the genuinely needed concept (hybrid mains/crosses) is faked.

**v2 config lives in Shopify Metaobjects (`$app` namespace, declared via TOML):**

```
$app:stringing_config            (one per racquet collection/scope)
  racquet_collection  → collection reference
  labor_variant       → variant reference
  labor_price         → money
  tension_min/max/default
  tension_rec_mains/crosses
  allow_hybrid        → boolean
  strings             → list.metaobject_reference → $app:tennis_string

$app:tennis_string               (the catalog, pre-resolved at save time)
  product             → product reference   (resolves live price/image/variant via Storefront API/Liquid)
  name, type          ("Polyester" | "Multifilament" | "Natural gut" | "Synthetic gut")
  gauges              → list ["16","17"]     (first-class, not JSON metadata)
  colors              → list (name + hex)
  recommended         → boolean
  sort_order
```

**Postgres keeps only:** `Session` (Shopify requires it), `Analytics` (funnel events), `SavedConfiguration` (share links). Everything else is deleted.

> Trade-off to confirm: Metaobjects mean rebuilding the merchant editor against Admin GraphQL metaobject APIs instead of plain Prisma rows. If we'd rather keep the Polaris editor + Prisma, the fallback is **write-time snapshot**: same principle (resolve on save, store a ready-to-serve JSON blob in Postgres), but served via a cached JSON App Proxy instead of Liquid. Metaobjects are faster (0 hops, CDN) and cleaner; the snapshot is less migration. See "Decisions for you" below.

---

## Conversion fixes (the 10% → cart problem)

The storefront audit found concrete revenue leaks, not just polish:

| # | Problem | Fix |
|---|---|---|
| 1 | **"+22 more strings" is a dead link** (`StringingConfigurator.tsx:164`) advertising inventory that can't be reached — in 4 places | Real search/filter over the full catalog, or delete the copy |
| 2 | **Hardcoded fake catalog** silently overrides merchant strings when the option group name doesn't regex-match `/string/i`; fake strings have **no variantId** → shoppers can "buy" unfulfillable items | Drive catalog only from configured metaobjects with real variant IDs; delete `DEFAULT_STRING_CATALOG` |
| 3 | **Native buy button is hidden/moved** by DOM surgery; on any theme re-render the shopper can be left with **no buy button at all** | Stop hiding the theme's buttons. Stringing becomes an additive in-context upsell, not a replacement |
| 4 | **CTA buried** — Add to Cart lives inside a side panel; no sticky footer in stringing mode; on mobile it's far below the fold | Sticky bottom bar (running total + CTA) in all modes — cited ~19% ATC lift |
| 5 | **Dev-facing errors** shown to shoppers ("Keep npm run dev running", "Select products in the app admin") | Shopper-safe copy; fail soft to the native buy box; drop 15s timeout |
| 6 | **Silent cart data-loss** (`cart.ts:98-102`): if the multi-line POST fails it retries with only the racquet, drops the labor line, **reports success** | Nested cart lines; never report success on partial failure |
| 7 | **Mobile is the desktop grid collapsed** (`proto-desk-*`); 3px invisible tension slider; abandoned "legacy mobile" CSS | Purpose-built mobile layout + touch-friendly tension control |
| 8 | **Share loses stringing state** on restore; hybrid mode triple-entry-point + brittle name-based defaults | Fix or cut share; simplify hybrid to one catalog with Mains/Crosses tabs |

Plus research-backed UX: stepped flow (racquet → string → tension → summary), 4–6 options visible with "Recommended" labels (choice-overload: 6 options→30% vs 24→3%), live itemized price, accessible selectors (ADA/EAA legal risk), lazy-load to protect Core Web Vitals (good CWV ≈ 2× conversion).

---

## Setup / admin fixes

| Problem | Fix |
|---|---|
| **"Button status: Disabled" is fake** — reads `theme.buttonEnabled` from our own DB, set only by a settings checkbox; detects neither the embed nor the block | Real detection: theme asset/GraphQL query and/or a storefront `button_shown` heartbeat ("last seen on storefront 2m ago") |
| **Two manual theme-editor steps** (app embed + button block) with ~120 lines of duplicated CSS; button is inert without the embed | One **app block** with `preset` + autofill bound to the current product, plus a dashboard **one-click deep-link** that adds the block and activates the app |
| **`trigger_option` exact-text-match trap** — rename a dropdown option and the button silently never appears | Remove the text-match gate entirely |
| **New configurators default to inactive**; auto-seeded Color/Black/White swatches (wrong for stringing); two competing save models on one page | Default Active; stringing-native editor; one consistent save |
| **Conditional Rules card** asks merchants to hand-enter DB IDs "from browser dev tools" | Delete it |
| **Analytics blind to the funnel** — only `modal_open` + `add_to_cart` tracked | Instrument `button_shown → button_click → modal_open → string_selected → tension_selected → add_to_cart`, keyed by session/product, shown as conversion rates |

---

## Tech stack decisions (2026)

- **Migrate Remix → React Router 7** (`@shopify/shopify-app-react-router`, GA). The Remix template is superseded and in security-only maintenance. Migration is mostly mechanical.
- **Cart: nested cart lines** (racquet parent + labor/string children in one `/cart/add.js`). Cleaner than Cart Transform `expand`, and avoids the known bug where expand strips line-item properties.
- **Checkout deprecations to stay clear of:** Shopify Scripts stop executing **June 30, 2026**; `checkout.liquid` thank-you/order-status sunset **Aug 28, 2025**. Use Functions + Checkout UI extensions if checkout logic is ever needed (likely not for v2).
- **Hosting:** because storefront reads now bypass our server entirely, requirements relax. **Vercel + Fluid compute + pooled region-pinned DB** is sufficient. (Also fix `db.server.ts` — it never memoizes PrismaClient in production.)
- **Storefront bundle:** drop Framer Motion (CSS transitions already power the stringing UI), import-on-interaction for the modal, target <10 KB entry. App Store gate: must not drop storefront Lighthouse >10 points.

---

## Phased roadmap

**Phase 0 — Stabilize v1 (done / in progress).** Scroll lock + double-fetch already fixed and pushed on this branch. Optionally: fix the silent cart fallback and the dev-facing error strings now, since they're live revenue/credibility leaks.

**Phase 1 — Data layer pivot (highest leverage).**
Define `$app` metaobjects via TOML. Move enrichment from the proxy to the admin save action + product/collection webhooks. Render catalog JSON into the product page via Liquid. Proxy read path becomes obsolete. *This alone removes the cold-start/slowness problem.*

**Phase 2 — Storefront rebuild.**
New app block (single step, autofill, no button-hiding). Tiny gate script + import-on-interaction modal. Drop Framer Motion. Sticky CTA, real mobile layout, real catalog only, nested cart lines, shopper-safe errors. Fix tension range to be data-driven.

**Phase 3 — Admin rebuild.**
Stringing-native editor (string/hybrid/tension/labor — no generic steps/rules). Real activation detection + one-click deep-link onboarding. Funnel analytics with conversion rates. Default Active.

**Phase 4 — Platform.**
React Router 7 migration. PrismaClient prod memoization + pooling. Confirm Lighthouse budget.

Phases 1 and 2 deliver the speed and the conversion wins. 3 and 4 are hardening and maintainability.

---

## Keep / rebuild / delete

**Keep:** click-delegation pattern, iOS body-scroll-lock technique, cart line-item-property data shape, resource-picker admin components, the trust-strip copy, the `/save` + `/analytics` proxy endpoints.

**Rebuild:** the storefront modal (lazy, sticky CTA, real mobile), the admin editor (stringing-native), activation detection, onboarding, analytics funnel, data layer (metaobjects + write-time resolution).

**Delete:** `enrich-configurator.server.ts`, `proxy-cache.server.ts`, `theme-placement.ts`, `configure-placement.ts`, `theme-buybox.ts`, `DEFAULT_STRING_CATALOG`, the ConditionalRule engine, the generic Step/OptionGroup/Option tables, Framer Motion, the duplicated block CSS, the second (fallback) button-injection path.

---

## Decisions for you

1. **Config store:** Metaobjects + Liquid (fastest, cleaner, more migration) **vs** Postgres write-time snapshot + cached JSON proxy (keeps Polaris editor, less migration). *Recommendation: Metaobjects.*
2. **Scope:** full v2 rebuild on a fresh branch **vs** evolve this branch phase-by-phase. *Recommendation: evolve — Phase 1 then 2 are independently shippable and de-risk the rebuild.*
3. **Hybrid stringing:** keep it (with simplified UI) **vs** cut it for v2.0 and add back later. Affects modal and data-model complexity.
4. **React Router migration:** now (clean slate) **vs** after Phases 1–2 (don't block conversion wins on a framework move). *Recommendation: after.*
