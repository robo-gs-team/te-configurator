# TE Configurator — Private Embedded App Redesign (v2.0)

Scope: the **native, private, single-merchant Shopify app** that TE uses to control the on-site configurator (the "TE Configurator" entry in the Shopify admin sidebar). This is the merchant control surface — not the storefront modal (see `V2_PLAN.md` §Conversion) and not the data layer (see `V2_PLAN.md` §Data model), though it drives both.

The app's **one job:** let TE decide which racquets are stringable and what strings/tensions/pricing/labor are offered, then get that live and verifiably working on the storefront — fast, and without silently breaking.

---

## 1. What stays the same

- **Private + single-merchant.** Stays `AppDistribution.SingleMerchant`, installed only on the TE store. No App Store, no public listing, no Built-for-Shopify review. (If TE ever wanted to resell it, that's a separate distribution change — flagged in Open Decisions.)
- **Embedded** in the Shopify admin (App Bridge, renders in the admin iframe).
- **App Proxy stays** — but demoted to infrequent JSON only (analytics beacons, share-link save/restore). It leaves the storefront hot path entirely.

## 2. App-level Shopify structure changes

| Area | v1 | v2 |
|---|---|---|
| **Framework** | Remix template (security-only maintenance) | **React Router 7** (`@shopify/shopify-app-react-router`) — mechanical migration |
| **Scopes** | `read_products, write_products, read_themes, write_themes` | Drop **`write_products`** (unused — no product writes anywhere in the codebase). Add metaobject scopes for the config store. Keep `read_products`; keep theme read for activation detection. *(Exact metaobject scope names to verify on shopify.dev — blocked here.)* |
| **Theme extension** | **Two** blocks (app embed + button block), ~120 lines of duplicated CSS, inert button if embed off | **One app block** with `preset` + autofill bound to the current product. Single source of CSS. Optional embed only for genuinely global needs |
| **Webhooks** | `app/uninstalled`, `app/scopes_update` | Add **`products/update`** + **`collections/update`** → re-sync the affected metaobjects (write-time freshness). Keep the two existing |
| **Config storage** | Postgres: generic Configurator→Step→OptionGroup→Option tree | **Shopify Metaobjects** (`$app` namespace) for catalog/config; Postgres only for Session, Analytics, SavedConfiguration |
| **PrismaClient** | Never memoized in production (`db.server.ts:7-11`) — new client per cold container | Memoize on `globalThis` in prod + pooled connection |

## 3. New admin information architecture

v1's editor is a generic product-configurator builder (steps, option groups, `displayType`, a conditional-rules engine asking merchants to paste DB IDs "from browser dev tools"). It's ~3–4× the surface the domain needs, and the one thing stringing actually needs — hybrid mains/crosses — is faked. v2 replaces it with a **stringing-native control panel**.

### Screens

**1. Home / Status**
- A **real** activation status (see §5), replacing the fake "Button status" badge that today just reflects a DB checkbox (`app._index.tsx:86`).
- The conversion funnel at a glance: button shown → clicked → modal opened → string selected → tension set → added to cart, with drop-off rates (today only `modal_open` + `add_to_cart` are even tracked).
- A **stateful setup checklist** that detects real signals (config exists, racquets linked > 0, app block placed, button seen on storefront) — green/red derived from reality, not a static 3-line list.

**2. Stringing setup (replaces the configurator editor)**
A single opinionated form, not a tree builder:
- **Stringable racquets** — pick the racquet collection(s). One picker.
- **String catalog** — pick the string collection (or curate a list); each string shows resolved image/price/variant + editable gauges, colors, "Recommended" flag, sort order. This is the metaobject catalog, edited in plain terms.
- **Tension** — min / max / default / recommended (mains, crosses). Real range, data-driven (v1 hardcodes 46–55).
- **Hybrid** — a first-class on/off, with mains/crosses defaults. Not faked through option groups.
- **Labor** — labor variant + price (keep v1's labor-product concept; it's the one good domain primitive).
- **Active** — defaults **on** at create (v1 ships configurators inactive, so merchants wire everything and see nothing).
- **One save model.** v1 mixes a page-form POST with independent fetcher submits on the same screen — merchants can't tell what's saved. v2: one consistent save (or autosave). Save triggers write-time metaobject sync.

**3. Appearance** — button label/style, modal accent, trust-strip copy. (Keep, trimmed.)

**4. Analytics** — the funnel with conversion rates, per racquet/string, not a raw 500-row table.

### Deleted from the admin
The Conditional Rules card, free-text step types, generic option-group/`displayType` vocabulary, the name-regex source-picker gating (`/string|gauge|tension/i`), and the auto-seeded Color/Black/White swatches that are wrong for stringing.

## 4. Onboarding / go-live redesign

v1 requires the merchant to, by hand: enable the app embed, *separately* add the button block, match `trigger_option` text exactly (rename a dropdown option → button silently never appears), then remember to toggle Active and Save. Multiple silent-failure traps, no feedback loop except loading the live page.

v2 collapses go-live to **one click from the Home screen**:
- A **"Add to storefront" deep link** that opens the theme editor with the app block added to the product template (and activates the app), instead of a prose checklist. *(Exact deep-link URL params to verify on shopify.dev.)*
- App block uses **autofill** to bind to the current product automatically — no per-product config, no `trigger_option` text-match trap (removed entirely).
- The checklist then **confirms** each step from real signals and links to "Preview on storefront."

## 5. Real activation detection (fixes "Button status: Disabled")

The headline admin bug: the badge reads `theme.buttonEnabled` from the app's **own** Postgres row, written only when the merchant ticks a settings checkbox. It detects neither the embed, nor the block, nor whether the storefront script loads. A fully-wired store can show "Disabled"; an empty store can show "Enabled."

v2 detects activation for real, two complementary signals:
1. **Theme query** — read the product template via the theme asset/GraphQL API to check the app block is present. *(Mechanism to confirm on shopify.dev.)*
2. **Storefront heartbeat** — the app block emits a lightweight `button_shown` beacon; Home shows "last seen on storefront 2m ago." This also closes the analytics funnel's top of funnel.

## 6. How the app controls the storefront (the config push)

```
Merchant edits stringing setup  →  Save
   → app resolves products once (images, variants, prices) using the
     admin session already authenticated for the save
   → writes $app metaobjects (stringing_config + tennis_string catalog)
   → product page renders that catalog into the page via Liquid (CDN-cached, 0 hops)

products/update or collections/update webhook
   → re-resolve just the affected metaobjects (keeps catalog fresh without
     touching the storefront read path)
```

The admin app becomes a **publisher** of metaobjects, not a live API the storefront queries on every view. That is the whole speed win, expressed at the app level.

## 7. Confidence / what needs shopify.dev (blocked here)

**Designed confidently now** (grounded in the codebase audit + reachable sources + Shopify domain knowledge): app structure, distribution, admin IA, onboarding flow, activation-detection approach, the publisher/webhook model, scope trimming.

**Verify at implementation time** (shopify.dev is 403-blocked in this environment — lift the network policy, paste the pages, or I verify as I build; each fails loudly if wrong):
- Exact deep-link URL params (`addAppBlockId`, `activateAppId`, `target`, `context`)
- Metaobject TOML declaration syntax + capability/access flags in `$app`
- Exact metaobject scope names for the manifest
- App-block `preset` + autofill schema
- Theme-query mechanism for block-presence detection

## 8. Open decisions

1. **Distribution:** keep private/single-merchant (recommended) **vs** restructure toward a public/Built-for-Shopify app (much larger scope — review, billing, multi-tenant). Your clarification says private, so default = keep private.
2. **Config store:** Metaobjects (recommended — enables the CDN/Liquid speed win) **vs** keep Postgres + write-time snapshot (keeps the Polaris editor, less migration).
3. **Framework migration timing:** React Router 7 now (clean slate before admin rebuild) **vs** after the admin/storefront work ships.
4. **Network policy:** allow `shopify.dev` so I can verify the §7 specifics up front, or proceed verify-as-we-build.
