# TE Configurator v2.0 — Implementation Reference (Metaobjects, Theme Extension, Cart)

Consolidated from five parallel research deep-dives (Jun 2026), each corroborated against **real production code on GitHub** (Shopify's `subscriptions-reference-app`, `shopify-app-template-extension-only`, and live theme app extensions) since `shopify.dev` is network-blocked in this environment. Companion docs: `V2_PLAN.md`, `V2_APP_REDESIGN.md`, `V2_RESEARCH.md`.

> **Sourcing caveat:** shopify.dev returns 403 here, so doc claims come from WebSearch index snippets + verbatim GitHub code. The GitHub code is the load-bearing evidence (production apps, not prose). Items needing live-doc confirmation are collected in the **Verify-before-ship** checklist at the end.

---

## 0. Recommended architecture (the resolved design)

The research resolves a clean, limit-proof data flow:

```
CANONICAL STORE (structured, app-owned)        READ-OPTIMIZED SNAPSHOT (flat, fast)
────────────────────────────────────          ────────────────────────────────────
$app:stringing_config  (metaobject)            product.metafields.$app.config
$app:tennis_string[]   (metaobjects)             → metaobject_reference → the config
   defined via TOML, entries written              + config.catalog_json (json field)
   via metaobjectUpsert at save time               = full denormalized catalog blob

WRITE (merchant saves in our admin)            READ (shopper loads product page)
  resolve products once (admin session)          {% assign cfg = product.metafields
  → metaobjectUpsert each string                    .$app.config.value %}
  → metaobjectUpsert the config                  {{ cfg.catalog_json.value | json }}
  → write config.catalog_json (resolved blob)      → one reference hop + one json read
  → set product.metafields.$app.config on          → emitted into <script type=json>
    each racquet (reference)                       → ZERO API calls, ZERO loop limits,
                                                      CDN-cached in the page
```

**Why this shape:** metaobjects give a clean app-owned canonical model (version-controlled definitions, optional merchant editing); the denormalized `catalog_json` field sidesteps every Liquid limit (the uncertain `$app:.values` loop, the 50-item `list.metaobject_reference` render cap, the 20-handle lookup cap) by reading the whole catalog in **one** Liquid value. This is the single most important design decision from the research.

For a stringing shop with ≤50 strings you *could* loop metaobjects directly in Liquid, but the `catalog_json` snapshot is limit-proof and the simplest possible storefront Liquid — use it.

---

## Part A — Defining metaobjects (declarative TOML)

Declare app-owned definitions in `shopify.app.toml`. They deploy atomically to every install on `shopify app deploy`, are version-controlled, and become **read-only via the Admin API** (only the TOML changes them). Use the API for definitions only if you need per-merchant dynamic schemas (we don't).

```toml
# ---- Tennis string (catalog entry) ----
[metaobjects.app.tennis_string]
name = "Tennis String"
display_name_field = "name"
access.admin = "merchant_read_write"      # private | merchant_read | merchant_read_write
capabilities.publishable = true            # entries get DRAFT/ACTIVE status

[metaobjects.app.tennis_string.fields.product]
name = "Product"
type = "product_reference"

[metaobjects.app.tennis_string.fields.name]
name = "Name"
type = "single_line_text_field"
required = true

[metaobjects.app.tennis_string.fields.type]
name = "Type"
type = "single_line_text_field"
validations.choices = ["Polyester", "Multifilament", "Natural gut", "Synthetic gut"]

[metaobjects.app.tennis_string.fields.gauges]
name = "Gauges"
type = "list.single_line_text_field"       # ["16","17"]

[metaobjects.app.tennis_string.fields.colors]
name = "Colors"
type = "json"                              # [{name,hex}] — flexible, no extra metaobject

[metaobjects.app.tennis_string.fields.recommended]
name = "Recommended"
type = "boolean"

[metaobjects.app.tennis_string.fields.sort_order]
name = "Sort order"
type = "number_integer"

# ---- Stringing config (per racquet scope) ----
[metaobjects.app.stringing_config]
name = "Stringing Config"
access.admin = "merchant_read_write"
capabilities.publishable = true

[metaobjects.app.stringing_config.fields.racquet_collection]
name = "Racquet collection"
type = "collection_reference"

[metaobjects.app.stringing_config.fields.labor_variant]
name = "Labor variant"
type = "variant_reference"

[metaobjects.app.stringing_config.fields.labor_price]
name = "Labor price"
type = "money"

[metaobjects.app.stringing_config.fields.tension_min]
name = "Tension min"
type = "number_integer"
# …tension_max, tension_default, tension_rec_mains, tension_rec_crosses (same type)

[metaobjects.app.stringing_config.fields.allow_hybrid]
name = "Allow hybrid"
type = "boolean"

[metaobjects.app.stringing_config.fields.strings]
name = "Strings"
type = "list.metaobject_reference<$app:tennis_string>"   # angle-bracket = target def

[metaobjects.app.stringing_config.fields.catalog_json]
name = "Catalog snapshot"
type = "json"                              # denormalized blob for fast storefront read

# ---- Product metafield: link a racquet to its config ----
[product.metafields.app.config]
name = "Stringing config"
type = "metaobject_reference<$app:stringing_config>"
[product.metafields.app.config.access]
admin = "merchant_read_write"
```

**Field type reference (verified):** scalars `single_line_text_field`, `multi_line_text_field`, `rich_text_field`, `number_integer`, `number_decimal`, `boolean`, `money`, `json`, `date`, `date_time`, `url`, `color`, `rating`, `dimension`, `weight`. References `product_reference`, `variant_reference`, `collection_reference`, `file_reference`, `page_reference`, `article_reference`, `metaobject_reference<$app:type>`. Lists: prefix `list.`. Validations: `validations.choices`, `.min`, `.max`, `.max_precision`, `.regex`, `.allowed_domains`, `.file_type_options`, `.schema`.

**Access values:** `access.admin` ∈ `private` | `merchant_read` | `merchant_read_write` (default `merchant_read`). `access.storefront` ∈ `none` | `public_read` (default `none`). **Liquid reads app-owned data regardless of `storefront` access** — `public_read` is only needed for the Storefront API (headless), which we don't use. So leave it off.

**Limits:** 128 definitions/shop · **40 fields/definition** · 1M entries/definition · `list.metaobject_reference` holds 256 (but Liquid renders only first ~50) · **max 25 metafield+metaobject definition changes per `shopify app deploy`** (split large schema migrations).

**Immutable after create:** the type handle, and a field's `type` (to change a field type you delete + re-add, losing data). Plan the schema before first deploy.

**Migration helper:** `shopify app import-custom-data-definitions` converts existing API-made definitions into TOML.

---

## Part B — Writing entries (Admin GraphQL, at save + via webhooks)

Definitions come from TOML; **entries are written freely via the API**. Use `metaobjectUpsert` keyed by `(type, handle)` with deterministic handles so saves are idempotent.

```graphql
mutation Upsert($handle: MetaobjectHandleInput!, $metaobject: MetaobjectUpsertInput!) {
  metaobjectUpsert(handle: $handle, metaobject: $metaobject) {
    metaobject { id }
    userErrors { code field message }
  }
}
```
```jsonc
// variables — one string entry
{
  "handle": { "type": "$app:tennis_string", "handle": "string-8002" },
  "metaobject": {
    "fields": [
      { "key": "product",     "value": "gid://shopify/Product/8002" },
      { "key": "name",        "value": "Luxilon ALU Power" },
      { "key": "type",        "value": "Polyester" },
      { "key": "gauges",      "value": "[\"16\",\"17\"]" },          // list = JSON string array
      { "key": "colors",      "value": "[{\"name\":\"Silver\",\"hex\":\"#C0C0C0\"}]" },
      { "key": "recommended", "value": "true" },
      { "key": "sort_order",  "value": "0" }
    ],
    "capabilities": { "publishable": { "status": "ACTIVE" } }   // default is DRAFT — must set ACTIVE
  }
}
```

**Value encoding (every value is a string):** text → raw; boolean → `"true"`/`"false"`; numbers → stringified; date/date_time → ISO string; json → `JSON.stringify(obj)`; **single reference → GID string**; **list reference → JSON-stringified array of GID strings** (`"[\"gid://…\"]"`); money → `"{\"amount\":\"19.99\",\"currency_code\":\"USD\"}"`.

**Config entry** then references the strings: `{ "key": "strings", "value": "[\"gid://shopify/Metaobject/111\",\"gid://shopify/Metaobject/222\"]" }`, plus `catalog_json` carrying the full resolved blob.

**No bulk create.** For a 30–250 string catalog, loop `metaobjectUpsert` (10 cost points each; standard bucket 1000, refill 50/s ⇒ ~100 instant then ~5/s). Read `extensions.cost.throttleStatus.currentlyAvailable` and back off; honor 429 + `Retry-After`. For 200+ entries or full rebuilds, use `bulkOperationRunMutation` (JSONL, bypasses per-call rate limits). Multi-alias batching cuts round-trips but not cost. Full rebuild: `metaobjectBulkDelete(where:{type:"$app:tennis_string"})` (async job, ≤250 ids) then re-upsert, or diff-and-upsert to avoid storefront-visible gaps.

**Scopes:** on **Admin API 2026-04+, writing app-owned (`$app:`) metaobjects needs NO metaobject scopes.** Keep `read_products` (to resolve products) and `read_themes` (activation detection). Drop the unused `write_products`. *(Pin 2026-04+ or you must request `read/write_metaobjects`.)*

**Webhook resync** (TOML subscriptions `products/update`, `collections/update`):
- Index entry↔product/collection links in Postgres at write time → O(1) lookup of affected entries.
- Handler: `authenticate.webhook(request)`, re-resolve, `metaobjectUpdate`/`Upsert` + rewrite `catalog_json`. **Return 200 within ~5s** — offload heavy resyncs to a queue. Debounce bursts. Handle `!session` (uninstalled).

---

## Part C — Reading on the storefront (Liquid, zero round-trips)

Product page app block reads the snapshot in one shot and emits JSON for the bundle to parse synchronously:

```liquid
{% liquid
  assign cfg = product.metafields.app.config.value
%}
{% if cfg %}
  <div data-te-stringing
       data-product-id="{{ product.id }}"
       data-labor-variant="{{ cfg.labor_variant.value.id }}">
  </div>
  <script type="application/json" data-te-catalog>
    {{ cfg.catalog_json.value | json }}
  </script>
{% endif %}
```
JS: `JSON.parse(document.querySelector('[data-te-catalog]').textContent)`. Always pass Liquid→JS through `| json` (safe escaping).

**Verified syntax facts:**
- App-owned metaobject by handle: `metaobjects["$app:tennis_string"]["string-8002"]` (bracket form — `$` isn't a bare identifier char). Production-confirmed.
- App-data metafield: `{{ app.metafields.<ns>.<key> }}` / `.value`. Fully-qualified fallback `app.metafields["app--{APP_ID}"]["key"]` is real if the `$app` sugar misbehaves.
- **Reference resolution gives live data with no API call:** `entry.product.value.price`, `.featured_image`, `.variants.first.id`, `.url`. (We pre-resolve into `catalog_json` at write time, so the storefront doesn't even need this — but it's available.)
- System fields: `.system.handle`, `.system.id`, `.system.type`.

**Limits to respect (and why the snapshot avoids them):** handle lookups cap at 20 unique/page; `.values` loop caps at 50 without `{% paginate … by 250 %}`; `list.metaobject_reference` renders only first ~50 in Liquid. Reading one `catalog_json` value has **none** of these limits.

**Flagged uncertainty:** looping an `$app:`-prefixed type via `metaobjects["$app:type"].values` has one community "doesn't work" report; handle-keyed lookups are production-confirmed. The `catalog_json` approach dodges this entirely — another reason it's the default.

**2025/2026 platform notes:** public access for app-reserved metafields/metaobjects was removed Apr 1 2025 (owning-app + merchant only) — fine for us (our own Liquid reads it). API 2026-04+ also lets Shopify Functions read `$app:` metaobjects if we ever add checkout logic.

---

## Part D — App block, one-click onboarding, real activation detection

**Product-page app block** (`extensions/te-stringing/blocks/configurator.liquid`):
```liquid
<div {{ block.shopify_attributes }} data-te-stringing data-product-id="{{ product.id }}"></div>
{% schema %}
{
  "name": "Stringing Configurator",
  "target": "section",
  "enabled_on": { "templates": ["product"] },
  "stylesheet": "configurator.css",
  "javascript": "configurator.js",
  "settings": [{ "type": "product", "id": "product", "label": "Product", "autofill": true }],
  "presets": [{ "name": "Stringing Configurator" }]
}
{% endschema %}
```
- `target: "section"` = a merchant-placeable app block. **`presets` (with a `name`) is REQUIRED** or it won't appear in the Add-block panel.
- `enabled_on.templates: ["product"]` (modern form; `templates` key is deprecated).
- Auto-bind to the current product via the global `{{ product }}` object (block runs in product scope) and/or an `autofill: true` product setting. Pass `product.id` to JS via `data-` attribute (external JS can't read Liquid).
- Schema `stylesheet`/`javascript` assets load **only on pages where the block is placed**, deduped — the performant default.
- Limit: 30 app blocks per extension (2026).

**One-click "Add to storefront" deep link** (host = `{shop}.myshopify.com` from `shop.myshopifyDomain`):
```
https://{shop}.myshopify.com/admin/themes/current/editor?template=product&addAppBlockId={SHOPIFY_API_KEY}/configurator&target=newAppsSection
```
`{api_key}/{handle}` = app API key (or extension UUID) / block filename without extension. `target=newAppsSection` is the most reliable (every JSON template supports an Apps section). For an app embed instead: `…/editor?context=apps&activateAppId={api_key}/{handle}`. **The merchant must still click Save** — the deep link only stages it.

**Real activation detection** (replaces the fake `theme.buttonEnabled` badge; needs `read_themes`):
```graphql
query { themes(first: 1, roles: [MAIN]) { nodes { files(
  filenames: ["templates/product.json","config/settings_data.json"], first: 5
) { nodes { filename body {
  ... on OnlineStoreThemeFileBodyText { content }
  ... on OnlineStoreThemeFileBodyBase64 { contentBase64 }
} } } } } }
```
Strip JS-style comments, `JSON.parse`, then: **app block** → scan `templates/product.json` `sections[*].blocks[*]` for a `type` containing our app's `shopify://apps/…` URI; **app embed** → scan `config/settings_data.json` `current.blocks`. A block is active when present AND **`disabled !== true`**. Read the **MAIN (published)** theme only — never mark onboarding complete from a draft. This is exactly how production apps (`xloxi-com/Approvefy`, `theextremecoders/Filtrex`) do it.

---

## Part E — Cart (nested cart lines)

Add racquet (parent) + labor SKU + string (children) in **one** `POST /cart/add.js`:
```jsonc
{ "items": [
  { "id": <racquetVariantId>, "quantity": 1,
    "properties": { "Tension":"55 lbs","String":"Luxilon ALU Power","Gauge":"16","Color":"Silver","_configId":"cfg_a1b2c3" } },
  { "id": <laborVariantId>,  "quantity": 1, "parent_id": <racquetVariantId>,
    "properties": { "Service":"Professional Stringing","_configId":"cfg_a1b2c3" } },
  { "id": <stringVariantId>, "quantity": 1, "parent_id": <racquetVariantId>,
    "properties": { "_configId":"cfg_a1b2c3" } }
] }
```
- **`parent_id`** = parent's *variant id*, used when parent + children are added in the same request. **`parent_line_key`** = existing parent line `key`, when the parent is already in the cart. Use exactly one.
- **One level of nesting; parent relationship is immutable; removing the parent removes its children.** To swap a string when the parent already exists: remove old child (`cart/change.js` qty 0) → add new child with `parent_line_key`.
- **Line item properties:** non-`_` keys are customer-visible (cart/checkout/email); `_`-prefixed are hidden from checkout/invoices but **stored on the order, visible in admin, readable in Liquid** — ideal for `_configId`. A POST with `properties` **overwrites the whole properties object** for that line (re-send all keys on update).
- **Real SKUs for string + labor** so physical string inventory decrements and labor reports cleanly; mark the labor variant as no-shipping / inventory-untracked.
- **Fixes v1's silent data-loss:** v1 retries with only the racquet on multi-line failure and reports success (`cart.ts:98-102`). v2 must surface a real error and keep the modal open instead.
- Storefront API equivalent (headless, 2025-10+): `cartLinesAdd` with a `parent` input (`parent.merchandiseId` / `parent.lineId`) and `attributes` (not `properties`).
- **Avoid Cart Transform `expand`** here — it strips line item properties on expand (you'd have to re-emit as component attributes), and we depend on properties. Nested lines are simpler and preserve them.
- **Deprecations to stay clear of:** Shopify Scripts stop executing **Jun 30 2026**; `checkout.liquid` thank-you/order-status sunset **Aug 28 2025**. v2 uses only Ajax/Storefront cart APIs (+ Checkout UI extensions/Functions if ever needed).

---

## Scopes summary (v2 manifest)

```toml
[access_scopes]
scopes = "read_products,read_themes"   # pin Admin API 2026-04+
```
- **`read_products`** — resolve products/variants/prices/images at save + webhook time.
- **`read_themes`** — activation detection (read published theme files).
- **Dropped `write_products`** (v1 listed it; never used).
- **No `read/write_metaobjects`** needed for app-owned `$app:` data on 2026-04+ (verify version pin).

---

## Verify-before-ship checklist (consolidated uncertainties)

1. **API version pin = 2026-04+** — required for the no-metaobject-scopes behavior. Confirm, or add `read/write_metaobjects`.
2. **Exact scope strings** in `[access_scopes]` — Shopify has renamed scopes before.
3. **`onlineStore`/full `renderable` capability in TOML** — was rolling out; confirm or set via GraphQL. (We don't need it — entries aren't standalone web pages.)
4. **`metaobjects["$app:type"].values` loop** — one "doesn't work" report. We default to `catalog_json` snapshot, so not on the critical path; if we ever loop, keep the `app--{id}` fallback and test on the pinned version.
5. **`cart.js` `parent_relationship` shape** — field names beyond `parent_relationship`/`parent_key` unconfirmed. Don't depend on response internals; tag children with our own hidden props and inspect a live cart.js.
6. **Storefront `CartLineInput.parent` sub-fields** (`merchandiseId` vs `lineId` nesting) — confirm against the 2025-10 schema (only if we go headless).
7. **Deep-link `target=mainSection`/`sectionGroup:`** — doc-only, not seen in a live app; `newAppsSection` and `sectionId:` are production-verified.
8. **`current` vs explicit `{MAIN themeId}`** in deep links — can land on a draft after a theme switch; use the MAIN theme id from GraphQL if determinism matters.
9. **Field/entry limits (40 fields, 1M entries)** + **25-changes-per-deploy** — re-check on the live limits page before a big schema.
10. **Nested-line order-confirmation email double-render** — reported; test and adjust notification Liquid.

---

## Key real-world source repos (verbatim code confirmed)

- **`Shopify/shopify-app-template-extension-only`** — official metaobject TOML + product metafield reference
- **`Shopify/subscriptions-reference-app`** — `metaobjectCreate/Upsert/Update/Delete` mutations + field value encoding/decoding (`app/graphql/Metaobject*.ts`, `app/utils/metaobjects/`)
- **`bosidev/nerd-bundles-app`, `danyn/shopify-app-rr`** — rich field/reference/validation TOML examples
- **`Sudarsanamg/preorder-extension`, `khusan2006/vault`, `HydroJug/GWP2.6`** — `$app:` metaobject/metafield reads in theme-extension Liquid + JSON-into-page
- **`xloxi-com/Approvefy`, `theextremecoders/Filtrex`** — `themes(roles:[MAIN])` activation detection
- **`webcatsdeveloper/sonu-one`, `yakohere/shopify-theme-devtools`, `devwax/whirlwind-petals-eurus`** — nested cart line `parent_id`/`parent_line_key` payloads
- **`Shopify/shopify-app-template-react-router`** — extension layout + deploy
