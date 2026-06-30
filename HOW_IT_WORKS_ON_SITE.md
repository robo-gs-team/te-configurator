# How the TE Configurator Works On-Site

A complete, plain-English reference for how the app behaves on the live storefront — from the moment a shopper lands on a racquet page through the configurator modal to the items that land in their cart — plus exactly what data is linked to the Shopify app and how.

This documents the app **as it actually works today (v1)**. Where it matters, it notes how v2 would differ (see the companion `V2_*` docs).

---

## Part 1 — The on-site experience, end to end

```
Shopper opens a racquet product page
        │
        ▼
[1] Theme renders → App Embed loads the JS bundle, sets window settings,
    hides the button until we know it belongs here
        │
        ▼
[2] Bundle boots → asks the server "is this product linked to a configurator?"
        │
        ├── NO  → button removed, native Add to Cart stays. Done.
        │
        └── YES → button revealed
                  │
                  ▼
[3] Strung/Unstrung gate: dropdown decides whether to show "Configure"
        │
        ├── "Unstrung" → Configure hidden, theme's normal buy buttons shown
        │
        └── "Strung"   → "Configure" shown in the buy box, theme's Buy now hidden
                  │
                  ▼
[4] Shopper clicks Configure → full-screen modal opens (data already loaded)
                  │
                  ▼
[5] Shopper picks string(s), gauge, color, tension (Standard or Hybrid)
                  │
                  ▼
[6] Add to Cart → racquet line + labor line built with all specs as
    "line item properties" → POST /cart/add.js → cart drawer opens
```

---

## Part 2 — Every on-site component in detail

### 2.1 The two theme pieces (both required)

The app puts itself on the storefront through a **theme app extension** with two blocks. **Both must be set up by the merchant** — this is the #1 cause of "it's not showing."

| Block | File | What it does |
|---|---|---|
| **App Embed** | `configurator-embed.liquid` | Enabled in Theme Editor → App embeds. Loads `proto-configurator.js` + `.css`, sets `window.ProtoConfiguratorSettings` (proxy URL, product id, shop), and adds the `proto-configurator-pending` CSS class. **If this is off, nothing on this page works.** |
| **Button Block** | `configurator-button.liquid` | Added to the product page template. Renders the "Choose Your Stringing" dropdown + the red **Configure** button. Ships its own inline copy of the gate script so it reacts to the dropdown even before the JS bundle finishes loading. |

If the button block is missing but the embed is on, the bundle tries to **inject an equivalent button itself** (`stringing-gate.ts` builds the same markup; `entry.tsx#injectProductPageButton` places it).

### 2.2 Boot sequence (`storefront/entry.tsx`)

On page load the bundle:
1. **Mounts** an empty React root (`#proto-configurator-root`) on `<body>` — this is where the modal will render later.
2. **Binds a global click listener** (event delegation) for anything marked `data-proto-configurator-trigger` — resilient even after the button is moved around the DOM.
3. **Initializes the gate** (`initStringingPageGate`).
4. **Runs the linkage check** (`initStorefrontUi`) — the network call that decides if the button belongs here.
5. **Checks for a share link** (`?proto_config=…`) to restore a saved configuration.

### 2.3 Does the button show? — Gate 1: Linkage

The button's visibility is controlled by a CSS-class state machine on `<html>` (`product-linkage.ts`):

| State | Class on `<html>` | Effect |
|---|---|---|
| Checking | `proto-configurator-pending` | Button `visibility:hidden` (no flash before we know) |
| Linked + Active | `proto-configurator-linked` | Button allowed to show |
| Not linked / inactive | `proto-configurator-unlinked` | Button `display:none`; native buy buttons restored |

The check itself: the bundle calls the **App Proxy** (`/apps/proto-configurator/product/{id}`), which asks the server whether any **Active** configurator is linked to this product (by product id or by collection membership). The answer flips the class. The configurator data is cached in the browser so the later Configure click is instant.

### 2.4 Does the button show? — Gate 2: Strung/Unstrung

Only relevant when the dropdown is enabled (`stringing-page-gate.ts`). A single state — `<html data-proto-stringing-state="strung|unstrung">` — derived from the dropdown drives everything:

- **"Strung"** → Configure button shown, and the theme's **Buy now / express checkout** buttons are hidden (so a strung racquet must route through the configurator).
- **"Unstrung"** → Configure hidden, theme's native buy buttons restored.

The button shows **only when both gates pass**: linked + Active **and** (dropdown disabled or set to "Strung").

### 2.5 Button placement — the DOM surgery (`theme-placement.ts`, `configure-placement.ts`, `theme-buybox.ts`)

To make the red Configure button appear exactly where the theme's Add to Cart normally sits, the bundle:
1. **Finds the theme's buy box** by trying a long list of known selectors (and a text scan for the literal label "choose your stringing").
2. **Moves the configurator wrapper** into that spot, hiding the theme's own stringing field if present.
3. **Hides the theme's Add to Cart** and slots Configure in its place when "Strung".

> **This is the fragile, "clunky" part.** It guesses at arbitrary theme markup, hides native buttons, and remembers original positions in memory. There is no `MutationObserver`, so if the theme re-renders the buy box (e.g. on a variant change), the placement can desync — producing a misplaced button, no button, or both buttons. (These six files are now fully commented; v2's plan is to replace this whole layer with a single Liquid block that doesn't move anything.)

### 2.6 Clicking Configure → the modal (`ConfiguratorModal.tsx`)

When the shopper clicks Configure:
1. The cached configurator data opens the modal instantly (no network wait).
2. The modal renders as a **React portal on `<body>`** at the top of the stacking order (`z-index` max), with a blurred backdrop.
3. The background page is **scroll-locked** (pinned with `position:fixed` so iOS Safari can't scroll behind it).
4. A `modal_open` analytics event is sent.

The modal shows one of two UIs:
- **Stringing UI** (`StringingConfigurator.tsx`) when the configurator has a labor variant — the tennis-specific flow.
- **Generic UI** (`Steps.tsx`) otherwise — variant + add-on steps.

### 2.7 The stringing UI (`StringingConfigurator.tsx`)

Two modes, toggled at the top:
- **Standard** — pick one string for the whole racquet, then gauge, color, and a tension slider.
- **Hybrid** — pick separate **Mains** and **Crosses** strings, each with their own gauge/color/tension (for advanced players).

A live **order summary** (racquet + string(s) + labor = total) and the **Add to Cart** button sit alongside. The string catalog comes from the merchant's configured string products; if none resolve, it falls back to a hardcoded default list (a known v1 weakness — see `V2_PLAN.md`).

### 2.8 Add to Cart → building the cart (`cart.ts` + `stringing-cart.ts`)

This is the payoff. `addToShopifyCart` builds an array of line items and POSTs them to Shopify's standard `/cart/add.js`:

1. **Resolve the racquet variant id** — from the page's variant picker, the `?variant=` URL param, or the product JSON (`getProductVariantFromPage`).
2. **Racquet line** — the selected racquet variant, carrying **all the string specs as line-item properties** (see Part 3 for the exact keys).
3. **Labor line** (stringing only) — the configured labor/service variant as a *separate* line, tagged `_line_type: labor` and `_parent_configurator`.
4. **Add-on lines** — any selected add-ons, tagged `_parent_configurator`.
5. **POST** all items in one request. On success it fires `cart:refresh` + `proto:cart-added` events and opens the theme's `cart-drawer`.

> **Known bug (documented for v2):** if the multi-line POST fails, v1 retries with **only the racquet line** (`cart.ts:100-101`) and still reports success — silently dropping the labor line while telling the shopper it worked. v2 must surface a real error instead.

### 2.9 Analytics & share

- **Analytics:** the bundle POSTs events to `/apps/proto-configurator/analytics`. Only two events are actually sent: `modal_open` and `add_to_cart` (a gap for diagnosing the conversion funnel).
- **Share:** the generic flow can POST the current selections to `/apps/proto-configurator/save`, get back a share URL (`?proto_config=…`), and copy it to the clipboard. (Share doesn't fully round-trip stringing selections in v1.)

---

## Part 3 — Data linked to the Shopify app

This is deliverable #2: **what data is linked to the private Shopify app, and how.** There are three distinct data channels. Note up front:

> **v1 uses NO Shopify metafields or metaobjects.** Despite the question framing, the current app does not store anything in Shopify metafields/metaobjects. It uses (a) **line-item properties** at cart time, (b) its **own Postgres database**, and (c) the **App Proxy**. "Metafields" only appear in the v2 *proposal*. The distinction matters — see Part 4.

### 3.1 Line-item properties (the data attached to the order in Shopify)

When a configured racquet is added to cart, the shopper's choices ride along as **line-item properties** — key/value pairs Shopify stores on the cart line and the resulting order. This is the only configurator data that ends up *inside Shopify*. Properties whose key starts with `_` are hidden from the customer at checkout but still saved on the order and visible to staff in the admin.

**Racquet line — Standard mode** (`stringing-cart.ts#buildStringingProperties`):

| Property key | Example value | Hidden? |
|---|---|---|
| `_configurator_id` | `clx123…` (the configurator's DB id) | yes |
| `_configurator_name` | `Pro Stringing` | yes |
| `Stringing mode` | `Standard` | no |
| `Setup` | `Luxilon ALU Power · 16g · Silver · 55 lbs` | no |
| `String upgrade` | `+$18.00` | no |
| `String` | `Luxilon ALU Power` | no |
| `Gauge` | `16g` | no |
| `Color` | `Silver` | no |
| `Tension` | `55 lbs` | no |
| `Labor` | `$25.00` (only if labor price > 0) | no |

**Racquet line — Hybrid mode** adds, instead of the single set: `Mains`, `Crosses`, `Mains upgrade`, `Crosses upgrade`, and `Mains String/Gauge/Color/Tension` + `Crosses String/Gauge/Color/Tension`.

**Labor line:** `_parent_configurator` (the configurator id) + `_line_type: labor`.
**Add-on lines:** `_parent_configurator`.

These keys are the contract your fulfillment/stringing team reads off the order to know exactly how to string the racquet.

### 3.2 The App Proxy (the live link between storefront and app)

The storefront talks to the app through a **Shopify App Proxy** at `/apps/proto-configurator/…`, which Shopify forwards to the app server. Endpoints:

| Method / path | Purpose |
|---|---|
| `GET /product/{id}` | "Is this product linked to an Active configurator?" → returns the configurator JSON |
| `GET /share/{shareId}` | Restore a saved configuration from a share link |
| `POST /analytics` | Record an event (`modal_open`, `add_to_cart`) |
| `POST /save` | Save the current configuration, return a share URL |

The proxy is registered against the app in `shopify.app.toml` (subpath `proto-configurator`).

### 3.3 The app's own Postgres database (where config actually lives)

Everything the merchant configures is stored in the app's **Postgres database** via Prisma — **not** in Shopify. Tables:

| Table | Holds |
|---|---|
| `Shop` | One row per installed store |
| `Configurator` | A configurator: linked product ids, collection ids, labor variant, base price, Active flag |
| `ConfiguratorStep` → `OptionGroup` → `Option` | The (generic) option hierarchy |
| `Addon` | Add-on products |
| `ConditionalRule` | Show/hide / price rules |
| `ThemeSetting` | Button + modal styling per shop |
| `Analytics` | Tracked events |
| `SavedConfiguration` | Share-link snapshots |
| `Session` | Shopify OAuth tokens (the app's auth) |

The product ids / collection ids stored here are **references**; the app fetches the real product images/prices/variants from Shopify's Admin API at request time (the cause of v1's slowness — see `V2_PLAN.md`).

### 3.4 OAuth scopes (the app's permissions on the store)

Declared in `shopify.app.toml`: `read_products, write_products, read_themes, write_themes`. In practice the code only reads products and themes — `write_products` is unused (v2 drops it).

---

## Part 4 — The "metafields" question, answered directly

Because the request specifically asked about *metafields linked to the Shopify private app*, here is the precise situation:

**Today (v1):** the app uses **no Shopify metafields and no metaobjects**. There are no metafield definitions declared, no metafields written, none read. Three things are easy to confuse:

| Mechanism | Used in v1? | What it is |
|---|---|---|
| **Line-item properties** | ✅ Yes | Key/value pairs attached to a *cart line / order* (Part 3.1). This is what carries the string specs. |
| **Metafields** | ❌ No | Structured custom data attached to a *product/variant/shop/etc.*, stored in Shopify. Not used. |
| **Metaobjects** | ❌ No | Standalone structured records in Shopify (e.g. a "string catalog" entry). Not used. |

**v2 proposal:** move the configurator's data **into Shopify metaobjects + metafields** so it lives next to products, renders into the page via Liquid (fast, CDN-cached), and removes the live Admin-API calls. The full, implementation-grade spec — definitions, field types, how they're written at save time, how they're read in Liquid — is in **`V2_IMPLEMENTATION_REFERENCE.md`**. In that design:
- `$app:tennis_string` metaobjects hold the string catalog.
- `$app:stringing_config` metaobject holds tension/labor/hybrid settings.
- A `product.metafields.$app.config` metafield links each racquet to its config.

So: if someone says "the app's metafields," in v1 the honest answer is **there aren't any** — the data lives in line-item properties (on orders) and the app's own Postgres DB. Metafields/metaobjects are the planned v2 home for that data.

---

## File map (for the behaviors above)

| Behavior | File(s) |
|---|---|
| Boot, linkage check, click handling, fallback button | `storefront/entry.tsx` |
| Button show/hide state machine | `storefront/lib/product-linkage.ts` |
| Strung/Unstrung gate | `storefront/lib/stringing-page-gate.ts` |
| Button placement / DOM surgery | `storefront/lib/theme-placement.ts`, `configure-placement.ts`, `theme-buybox.ts` |
| Fallback gate markup | `storefront/lib/stringing-gate.ts` |
| Modal shell, scroll-lock | `storefront/components/ConfiguratorModal.tsx` |
| Stringing UI (standard/hybrid) | `storefront/components/StringingConfigurator.tsx` |
| Add to Cart, variant resolution, cart events | `storefront/lib/cart.ts` |
| String specs → line-item properties | `storefront/lib/stringing-cart.ts` |
| Theme blocks (embed + button) | `extensions/proto-configurator/blocks/*.liquid` |
| Server proxy endpoints | `app/routes/proxy.$.tsx` |
| Config storage / linkage lookup | `app/lib/configurator.server.ts`, `prisma/schema.prisma` |
