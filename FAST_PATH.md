# Fast Path — shipping v2 value quickly

How to make this project move fast: deliver a faster, more reliable, higher-converting app in **independently shippable increments on this branch**, instead of a big-bang rebuild. Ordered by value ÷ effort. Reviews the four planning docs (`CODEBASE`, `V2_PLAN`, `V2_APP_REDESIGN`, `V2_IMPLEMENTATION_REFERENCE`) and `HOW_IT_WORKS_ON_SITE` and turns them into a sequence.

**Principle:** the cheap reliability + conversion fixes hit the live complaints *now*; the one architectural change that actually fixes "slow" comes next; the full metaobject rearchitecture is last and optional. Each item below is a standalone, deployable change — don't block any of them on v2.

---

## Track A — Quick wins (days, low risk, ship continuously)

| # | Change | Why | Effort |
|---|---|---|---|
| A0 | ✅ Done: scroll-lock, double-fetch cache, server cache, parallel Admin calls | Already on this branch | — |
| A1 | ✅ Done: Fix silent cart data-loss — removed retry that dropped labor line and reported success | Prevents unfulfillable "strung" orders that look fine | XS |
| A2 | ✅ Done: Replace shopper-facing dev error strings with real copy | Credibility; stops bounces on transient errors | XS |
| A3 | ✅ Done: Memoize `PrismaClient` in production (`db.server.ts`) | Removes a cold-start cost on every serverless boot; Supabase pooler stays as-is | XS |
| A4 | Add funnel analytics events (`button_shown → click → modal_open → string_selected → tension_set → add_to_cart`) | You currently only track `modal_open` + `add_to_cart`, so the 125→13 (10%) drop-off is undiagnosable | S |
| A5 | ✅ Done: First-class **Racquet collection** + **String collection** pickers in admin (regex gate removed; added to create flow; `stringCollectionIds` DB field + migration) | Removes the most confusing part of setup | S–M |
| A6 | ✅ Done: Removed dead "+22 more strings" link and fake `DEFAULT_STRING_CATALOG` fallback; clean empty state when no strings configured | Stops shoppers abandoning because "my string isn't here" / unfulfillable picks | S |

Track A alone makes the app noticeably more reliable and gives you the data to see *where* conversion leaks.

---

## Track B — The real speed fix (1–2 weeks)

| # | Change | Why |
|---|---|---|
| B1 | **Write-time enrichment** — resolve Shopify products on *save* (admin), store a ready-to-serve JSON snapshot in Postgres; the proxy `/product/:id` becomes a single DB read. A **daily Vercel cron job** re-syncs all snapshots automatically to keep data fresh. No webhooks needed. | This is THE fix for "slow & clunky on Vercel." Removes live Admin-API calls from every shopper page load. |
| B2 | Real **"Button status"** detection (query the published theme for the app block) to replace the fake DB-checkbox badge | The admin currently lies about whether it's live |

After B1, cold starts only ever affect the merchant admin, not shoppers.

### B1 — Staleness strategy (decided)

The snapshot can become stale if a product price or image is updated in Shopify without re-saving the configurator. Two mechanisms keep it fresh:

1. **Save-time refresh** — whenever the merchant clicks "Save changes" in the admin, the snapshot is re-built immediately. Any intentional config change is always reflected instantly.
2. **Daily Vercel cron** — a scheduled job (runs at 3 am, fits Vercel's free tier) re-fetches all Shopify product data and updates every snapshot automatically. Worst-case staleness: 24 hours.

**Why not webhooks?** `products/update` / `collections/update` webhooks would give near-real-time freshness but add meaningful complexity: signature verification, retry/idempotency logic, delivery failures to track. For a stringing shop where string prices and product images change infrequently, a daily re-sync is indistinguishable in practice and costs nothing extra to build or operate.

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

1. ✅ **Snapshot-first vs metaobjects-first** — **decided: Postgres snapshot first.** Ship the speed fix in days via a JSON blob in Postgres + daily cron re-sync. Metaobjects (C1) are the later CDN-cached upgrade — same merchant-facing behaviour, no re-migration needed.
2. ✅ **Webhook vs scheduled re-sync for staleness** — **decided: daily Vercel cron.** Skip webhook infrastructure entirely; save-on-change + daily 3 am refresh is sufficient for a stringing shop (see B1 section above).
3. **Allow `shopify.dev`** through the network policy (or paste pages) so the C-track specifics (deep-link params, metaobject TOML) can be verified up front instead of at build time.
4. **Hybrid stringing** kept or cut for the first v2 modal — affects C3 size.

## Note on the database (Supabase)

Postgres is hosted on **Supabase** (transaction pooler `:6543`, session pooler `:5432`, wired in `vercel-build.mjs`). It is *not* the performance bottleneck — the per-request Shopify Admin GraphQL calls are. A3 (Prisma client memoization) is the only DB-side quick win; after B1, shopper traffic barely touches the DB, and after C1 it doesn't touch our server at all.
