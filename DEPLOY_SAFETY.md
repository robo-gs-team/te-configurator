# Deploy Safety — how to ship without touching the live storefront

This app is a custom Shopify merchant-admin app **plus** a theme app extension (the
storefront button + modal). The two ship through **different pipelines** with different
blast radius. This doc is the operating procedure for shipping changes without affecting
any live theme until you explicitly approve it.

---

## What happens when you push to `main`

Two **independent** deploys fire:

| Pipeline | Trigger | What it touches | Storefront impact |
|---|---|---|---|
| **Vercel** | every push to `main` | Merchant admin (Remix) + App Proxy + DB migrations | **None.** Admin/back end only. |
| **`.github/workflows/deploy-shopify.yml`** | push to `main` changing `extensions/**`, `storefront/**`, `shopify.app*.toml`, the storefront build files | Runs `shopify app deploy --config production` → publishes a new **active version** of the theme app extension | **Only on themes that already have the embed/block enabled** (see below). |

`shopify app deploy` **never adds anything to a theme.** It only makes the new code the
active version of the extension. Whether anything renders on the storefront is decided
entirely at the theme level.

---

## Why the storefront is opt-in (Shopify's built-in protection)

The extension cannot appear on a storefront on its own. A merchant must take action **per
theme**:

- **App embed** (`configurator-embed.liquid`, `target: body`) — **disabled by default in
  every theme.** Nothing loads until someone toggles it on in **Theme Editor → App embeds**.
- **Configure button** (`configurator-button.liquid`, `target: section`) — must be
  **manually added** to a section/template via the theme editor.

A theme with neither enabled serves **zero** configurator code, no matter what version is
deployed.

---

## ⚠️ The one dependency that makes push-to-`main` safe

Because `deploy-shopify.yml` auto-deploys on `main` (we chose not to gate it), storefront
safety rests on a single fact:

> **The live (published) theme must NOT have the app embed enabled or the Configure block
> placed.**

If the live theme already has the embed on, the next push to `main` that touches
`storefront/**` or `extensions/**` **will go live there immediately, with no approval.**

**Before every merge to `main`:** open **Theme Editor → App embeds on the live theme** and
confirm *Proto Configurator* is **off**, and that no Configure block is placed on the
product template. Do all enabling on a duplicate theme (next section).

---

## Safe rollout procedure (test without risking the live theme)

1. **Merge code to `main`.** This publishes the new extension version to the app and
   deploys the admin. Live theme is untouched **as long as the embed is off there.**
2. **Duplicate the live theme.** Online Store → Themes → ⋯ → *Duplicate*. Work on the copy
   (stays unpublished).
3. **Enable on the duplicate only:** Theme Editor (on the duplicate) → App embeds → turn on
   *Proto Configurator*; add the **Configure** block to the product template.
4. **Configure + preview.** Set up the configurator in the merchant admin, then use the
   duplicate theme's **Preview** to test the full flow (button → modal → add to cart) on
   real product pages. Nothing here is visible to shoppers.
5. **Approve → publish.** Only when it's signed off, **Publish** the duplicate theme (or add
   the block to the live theme). This is the single deliberate action that makes it live.

**Rollback:** publish the previous theme again (Themes keeps the prior version), or toggle
the embed off. Reverting code is a separate concern handled by a normal `main` revert +
redeploy.

---

## Tightening further (not done yet — see options)

If you later want merging to `main` to be storefront-safe **regardless** of the live
theme's embed state, gate the extension deploy. Options, strongest first:

- **Manual-only:** drop the `push: main` trigger from `deploy-shopify.yml`; deploy via
  *Run workflow* only.
- **Approval gate:** keep the trigger but require a reviewer via a GitHub Environment.
- **Staging app:** point CI at a separate dev Shopify app (different `client_id`); deploy
  production by hand.

Until one of these is in place, the **embed-off-on-live-theme** rule above is what keeps the
storefront safe.
