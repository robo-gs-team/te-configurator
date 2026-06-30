# Fast Path — shipping v2 value quickly

How to make this project move fast: deliver a faster, more reliable, higher-converting app in **independently shippable increments on this branch**, instead of a big-bang rebuild. Ordered by value ÷ effort. Reviews the four planning docs (`CODEBASE`, `V2_PLAN`, `V2_APP_REDESIGN`, `V2_IMPLEMENTATION_REFERENCE`) and `HOW_IT_WORKS_ON_SITE` and turns them into a sequence.

**Principle:** the cheap reliability + conversion fixes hit the live complaints *now*; the one architectural change that actually fixes "slow" comes next; the full metaobject rearchitecture is last and optional. Each item below is a standalone, deployable change — don't block any of them on v2.

---

## Track A — Quick wins (days, low risk, ship continuously)

| # | Change | Why | Effort |
|---|---|---|---|
| A0 | ✅ Done: scroll-lock, double-fetch cache, server cache, parallel Admin calls | Already on this branch | — |
| A1 | Fix silent cart data-loss (`cart.ts:100-101`) — never report success when the labor line was dropped | Prevents unfulfillable "strung" orders that look fine | XS |
| A2 | Replace shopper-facing dev error strings ("keep npm run dev running") with soft, real copy | Credibility; stops bounces on transient errors | XS |
| A3 | Memoize `PrismaClient` in production (`db.server.ts`) | Removes a cold-start cost on every serverless boot; Supabase pooler stays as-is | XS |
| A4 | Add funnel analytics events (`button_shown → click → modal_open → string_selected → tension_set → add_to_cart`) | You currently only track `modal_open` + `add_to_cart`, so the 125→13 (10%) drop-off is undiagnosable | S |
| A5 | First-class collection selection in admin: explicit **Racquet collection** + **String collection** pickers (drop the name-regex gating; add to the create flow) | You asked for this; removes the most confusing part of setup | S–M |
| A6 | Remove the dead "+22 more strings" link and the fake fallback catalog | Stops shoppers abandoning because "my string isn't here" / unfulfillable picks | S |

Track A alone makes the app noticeably more reliable and gives you the data to see *where* conversion leaks.

---

## Track B — The real speed fix (1–2 weeks)

| # | Change | Why |
|---|---|---|
| B1 | **Write-time enrichment** — resolve Shopify products on *save* (admin) + on `products/update`/`collections/update` webhooks, store a ready-to-serve snapshot; the proxy `/product/:id` becomes a single DB read | This is THE fix for "slow & clunky on Vercel." Removes the live Admin-API calls from every page load. Can use a Postgres snapshot first — no metaobjects required yet |
| B2 | Real **"Button status"** detection (query the published theme for the app block) to replace the fake DB-checkbox badge | The admin currently lies about whether it's live |

After B1, cold starts only ever affect the merchant admin, not shoppers.

---

## Track C — v2 architecture (weeks, the full rearchitecture)

| # | Change | Why |
|---|---|---|
| C1 | Move config into **Shopify metaobjects + metafields**, render via **Liquid** (storefront bypasses our server entirely) | Per `V2_IMPLEMENTATION_REFERENCE.md` — fastest possible, CDN-cached, no API calls. Supersedes the B1 snapshot |
| C2 | **Single app block** + one-click **deep-link** onboarding (drop the two-block setup + `trigger_option` trap) | Removes the setup friction that causes "Button: Disabled" |
| C3 | **Storefront modal rebuild** for conversion: sticky CTA, real catalog only, **nested cart lines** (racquet + labor + string), real mobile layout, drop Framer Motion | Targets the 10% → cart rate; removes the fragile DOM-surgery layer |
| C4 | **React Router 7** migration | The Remix template is in security-only maintenance |

---

## How to actually go faster (delivery mechanics)

- **Run tracks in parallel.** Track A items and the storefront half of C3 are frontend; B1/B2/C1 are backend. They're independent — two workstreams at once.
- **Ship each Track A item as its own deploy.** Don't wait for v2; bank the reliability/conversion wins immediately.
- **The docs now de-risk the rewrite.** Current behavior is captured (`HOW_IT_WORKS_ON_SITE.md` + per-function comments), so C3 can replace the gate/placement layer confidently.
- **Sequence B1 → C1.** Do write-time enrichment into Postgres first (fast to build), then later swap the store to metaobjects without changing the merchant-facing behavior. Avoids betting everything on the metaobject migration up front.

## Open decisions that unblock speed

1. **Snapshot-first vs metaobjects-first** for B1/C1 — recommend Postgres snapshot first (ship the speed fix in days), metaobjects as a later swap.
2. **Allow `shopify.dev`** through the network policy (or paste pages) so the C-track specifics (deep-link params, metaobject TOML) can be verified up front instead of at build time.
3. **Hybrid stringing** kept or cut for the first v2 modal — affects C3 size.

## Note on the database (Supabase)

Postgres is hosted on **Supabase** (transaction pooler `:6543`, session pooler `:5432`, wired in `vercel-build.mjs`). It is *not* the performance bottleneck — the per-request Shopify Admin GraphQL calls are. A3 (Prisma client memoization) is the only DB-side quick win; after B1, shopper traffic barely touches the DB, and after C1 it doesn't touch our server at all.
