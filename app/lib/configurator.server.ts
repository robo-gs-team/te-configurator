import prisma from "~/db.server";
import type { ConfiguratorWithRelations } from "~/lib/configurator.types";
import { parseJson } from "~/lib/configurator.types";
import { normalizeCollectionId } from "~/lib/collection-id";
import { productIdsMatch } from "~/lib/product-id";
import { getProductCollectionIds } from "~/lib/shopify-collections.server";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export const configuratorInclude = {
  steps: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      optionGroups: {
        orderBy: { sortOrder: "asc" as const },
        include: {
          options: { orderBy: { sortOrder: "asc" as const } },
        },
      },
    },
  },
  addons: { orderBy: { sortOrder: "asc" as const } },
  rules: { orderBy: { sortOrder: "asc" as const } },
};

/**
 * Read-first, for the same reason `getShopThemeSettings` below is: EVERY admin loader calls this
 * before it can do anything else, and the old unconditional upsert paid a write round-trip (plus
 * a row lock) on every page view, every navigation, every action — to insert a row that has
 * existed since the app was installed. The write also can't overlap anything: the shop id it
 * returns is the input to every query that follows, so its full latency lands on the critical
 * path of each admin request.
 *
 * Kept as an upsert on the miss path so two concurrent first-requests can't both insert.
 */
export async function ensureShop(domain: string) {
  const existing = await prisma.shop.findUnique({ where: { domain } });
  if (existing) return existing;
  return prisma.shop.upsert({
    where: { domain },
    create: { domain, name: domain },
    update: {},
  });
}

export async function getShopThemeSettings(shopId: string) {
  // Read-first: this runs inside the linkage check on EVERY PDP load, and the old
  // unconditional upsert paid a write round-trip (and row lock) per page view just to read
  // settings that change only when a merchant saves. The upsert now happens once, the first
  // time a shop has no row (kept as upsert so two concurrent first-reads can't both insert).
  const existing = await prisma.themeSetting.findUnique({ where: { shopId } });
  if (existing) return existing;
  return prisma.themeSetting.upsert({
    where: { shopId },
    create: { shopId },
    update: {},
  });
}

export async function getConfiguratorById(
  id: string,
): Promise<ConfiguratorWithRelations | null> {
  return prisma.configurator.findUnique({
    where: { id },
    include: configuratorInclude,
  });
}

/**
 * The editor's view of a configurator: everything `getConfiguratorById` returns EXCEPT the two
 * write-only blob columns.
 *
 * `enrichedSnapshot` is the full variant matrix for every string in the catalog and
 * `inventoryPolicyBackup` is a per-variant map — together the largest values in the row by orders
 * of magnitude. The editor page never renders either; it already deleted them from the payload
 * before returning, but only AFTER Postgres had serialized them, shipped them over the wire, and
 * Prisma had materialized them in the function's memory. Omitting them in the query means they
 * are never read at all.
 *
 * (Same class of mistake as the storefront's snapshot path fetching a relation tree it never
 * read — the cost is invisible in the code that discards the data, because by then it's paid.)
 */
export async function getConfiguratorForEditor(id: string) {
  return prisma.configurator.findUnique({
    where: { id },
    omit: { enrichedSnapshot: true, inventoryPolicyBackup: true },
    include: configuratorInclude,
  });
}

export type ConfiguratorProductLookup =
  | { status: "found"; configurator: ConfiguratorWithRelations }
  | { status: "inactive"; configurator: ConfiguratorWithRelations }
  | { status: "not_linked" };

type ConfiguratorCandidate = {
  id: string;
  isActive: boolean;
  productIds: string;
  collectionIds: string;
  excludedProductIds: string;
};

/**
 * Phase 1 of the product→configurator match: the lightweight assignment-column scan, shared by
 * both the full lookup (below) and the linkage-only check (checkProductLinkage). Runs on every
 * storefront PDP request, so it must not drag any configurator's full
 * steps→optionGroups→options/addons/rules tree out of the DB just to compare a few ID lists —
 * only the winner (if any) needs its full tree, fetched by the caller that actually needs it.
 *
 * Matching order: explicit product IDs first (no network call), then collection membership
 * (one Shopify API call total, compared in-memory against every candidate) — exclusions checked
 * first in both passes, so an explicitly-excluded product never matches via either path.
 *
 * TIE-BREAKING IS DELIBERATE, NOT INCIDENTAL. When more than one configurator matches the same
 * product (e.g. the product sits in two collections, each assigned to a different configurator),
 * the winner used to be whichever row the DB happened to return first — unordered, so it could
 * differ between requests and between serverless instances. On a store where a half-built test
 * configurator overlapped the production one, that made the storefront a coin flip: the real
 * configurator (with a prebuilt snapshot) sometimes won, and sometimes the snapshot-less test
 * one did — whose full-catalog fetch then crawled through live Shopify enrichment or failed
 * outright. Shoppers saw "Configure opens sometimes".
 *
 * Candidates are therefore ranked before either pass runs:
 *   1. active before inactive — an inactive row must never shadow a live one;
 *   2. snapshot-backed before snapshot-less — a configurator that has never built a snapshot
 *      has never been finished/saved; it should not beat a production-ready one;
 *   3. oldest first — stable, predictable, and favors the long-standing configurator over a
 *      newly-created experiment when everything else ties.
 * @returns The winning candidate row, or undefined if none matched.
 */
async function findMatchingConfigurator(
  shopId: string,
  productId: string,
  shopDomain: string,
  admin?: ShopifyAdmin,
): Promise<ConfiguratorCandidate | undefined> {
  const unranked = await prisma.configurator.findMany({
    where: { shopId },
    // createdAt is the deterministic base order (rule 3); snapshotUpdatedAt is selected only as
    // a has-a-snapshot signal for rule 2 — never the snapshot text itself, which can be ~300KB.
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      isActive: true,
      productIds: true,
      collectionIds: true,
      excludedProductIds: true,
      snapshotUpdatedAt: true,
    },
  });
  // Array.prototype.sort is stable, so equal-rank rows keep the createdAt order from the query.
  const rank = (c: { isActive: boolean; snapshotUpdatedAt: Date | null }) =>
    (c.isActive ? 0 : 2) + (c.snapshotUpdatedAt ? 0 : 1);
  const candidates = [...unranked].sort((a, b) => rank(a) - rank(b));

  const isExcludedFor = (candidate: ConfiguratorCandidate) =>
    productIdsMatch(parseJson<string[]>(candidate.excludedProductIds ?? "[]", []), productId);

  for (const candidate of candidates) {
    if (isExcludedFor(candidate)) continue;
    if (productIdsMatch(parseJson<string[]>(candidate.productIds, []), productId)) {
      return candidate;
    }
  }

  const collectionCandidates = candidates.filter(
    (c) => parseJson<string[]>(c.collectionIds, []).length > 0,
  );
  if (collectionCandidates.length > 0 && admin) {
    const productCollectionIds = await getProductCollectionIds(admin, productId, shopDomain);
    const productCollSet = new Set(productCollectionIds.map(normalizeCollectionId));
    for (const candidate of collectionCandidates) {
      if (isExcludedFor(candidate)) continue;
      const collectionIds = parseJson<string[]>(candidate.collectionIds, []);
      if (collectionIds.some((id) => productCollSet.has(normalizeCollectionId(id)))) {
        return candidate;
      }
    }
  }

  return undefined;
}

/**
 * Same match as lookupConfiguratorForProduct, but WITHOUT the relation tree.
 *
 * The snapshot path — which serves virtually every storefront request — reads only `id`, `name`
 * and `enrichedSnapshot`, then renders from the snapshot's own parsed copy of the catalog. It
 * still went through the full lookup, so every cache miss dragged the entire
 * steps -> optionGroups -> options tree out of Postgres (each option carrying its own `metadata`
 * JSON blob), had Prisma materialise all of it, and discarded the lot. Measured live: 7.4s on a
 * miss versus ~0.2s on a hit, on a request whose payload is 32KB gzipped.
 *
 * Only live enrichment genuinely needs those relations, so it keeps using the full lookup below.
 */
export async function lookupConfiguratorSnapshotForProduct(
  shopDomain: string,
  productId: string,
  admin?: ShopifyAdmin,
): Promise<
  | {
      status: "found" | "inactive";
      configurator: { id: string; name: string; enrichedSnapshot: string | null };
    }
  | { status: "not_linked" }
> {
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) return { status: "not_linked" };

  const winner = await findMatchingConfigurator(shop.id, productId, shopDomain, admin);
  if (!winner) return { status: "not_linked" };

  const configurator = await prisma.configurator.findUnique({
    where: { id: winner.id },
    select: { id: true, name: true, enrichedSnapshot: true },
  });
  if (!configurator) return { status: "not_linked" };

  return { status: winner.isActive ? "found" : "inactive", configurator };
}

export async function lookupConfiguratorForProduct(
  shopDomain: string,
  productId: string,
  admin?: ShopifyAdmin,
): Promise<ConfiguratorProductLookup> {
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) return { status: "not_linked" };

  const winner = await findMatchingConfigurator(shop.id, productId, shopDomain, admin);
  if (!winner) return { status: "not_linked" };

  // Phase 2 — load the full relation tree for the winner alone.
  const configurator = await prisma.configurator.findUnique({
    where: { id: winner.id },
    include: configuratorInclude,
  });
  if (!configurator) return { status: "not_linked" };

  return winner.isActive
    ? { status: "found", configurator }
    : { status: "inactive", configurator };
}

export type ProductLinkageStatus = {
  linked: boolean;
  code?: "not_linked" | "inactive" | "button_disabled";
};

/**
 * Answer ONLY "does this product have a working, enabled configurator?" — no relation tree, no
 * enrichment, no snapshot parsing. This is the split-phase fetch's linkage check: on every PDP
 * page load, the storefront used to fetch the ENTIRE configurator payload (full string catalog,
 * every variant, prices — potentially hundreds of KB) just to decide whether to show a button.
 * That decision only ever needed a boolean. This function costs one lightweight candidate scan
 * (phase 1 above — no relation-tree fetch at all) plus a cheap single-row theme-settings read;
 * the full catalog is fetched separately, only once the shopper shows intent (hover/click) — see
 * proxy.$.tsx's `product/:id/link` route and storefront/entry.tsx's split fetch.
 *
 * `winner.isActive` already comes out of the phase-1 candidate scan, so unlike
 * lookupConfiguratorForProduct there is no phase-2 DB call at all for the "not linked"/"inactive"
 * outcomes — only a linked+active+enabled result required a second (still tiny) query.
 */
export async function checkProductLinkage(
  shopDomain: string,
  productId: string,
  admin?: ShopifyAdmin,
): Promise<ProductLinkageStatus> {
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) return { linked: false, code: "not_linked" };

  // Start the theme-settings read NOW, overlapping the candidate scan (which may include a
  // Shopify collections call) instead of paying the two in series on every PDP load. The .catch
  // is mandatory: on a not-linked early return the promise is abandoned, and an unhandled
  // rejection would crash the serverless invocation. A failed read fails OPEN (button shows) —
  // consistent with the storefront's gate, which also shows when it can't determine state.
  const themePromise = getShopThemeSettings(shop.id).catch(() => null);

  const winner = await findMatchingConfigurator(shop.id, productId, shopDomain, admin);
  if (!winner) return { linked: false, code: "not_linked" };
  if (!winner.isActive) return { linked: false, code: "inactive" };

  // Shop-wide kill switch (Theme Settings → "Enable customize button globally") overrides any
  // individual configurator's active state — same semantics as the full endpoint's
  // `configurator.theme.buttonEnabled === false` check.
  const theme = await themePromise;
  if (theme?.buttonEnabled === false) return { linked: false, code: "button_disabled" };

  return { linked: true };
}

export async function getConfiguratorForProduct(
  shopDomain: string,
  productId: string,
): Promise<ConfiguratorWithRelations | null> {
  const result = await lookupConfiguratorForProduct(shopDomain, productId);
  return result.status === "found" ? result.configurator : null;
}

export async function listConfigurators(shopId: string) {
  // The UI only needs the step/addon counts, not the rows — use _count so we don't pull
  // (and serialize to the browser) every step/addon id for every configurator.
  return prisma.configurator.findMany({
    where: { shopId },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { steps: true, addons: true } },
    },
  });
}

export async function trackAnalyticsEvent(data: {
  shopId: string;
  configuratorId?: string;
  eventType: string;
  productId?: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}) {
  return prisma.analytics.create({
    data: {
      shopId: data.shopId,
      configuratorId: data.configuratorId,
      eventType: data.eventType,
      productId: data.productId,
      sessionId: data.sessionId,
      metadata: JSON.stringify(data.metadata ?? {}),
    },
  });
}

export async function saveConfiguration(data: {
  configuratorId: string;
  productId: string;
  selections: Record<string, string>;
  addons: Record<string, number>;
  totalPrice: number;
}) {
  return prisma.savedConfiguration.create({
    data: {
      configuratorId: data.configuratorId,
      productId: data.productId,
      selections: JSON.stringify(data.selections),
      addons: JSON.stringify(data.addons),
      totalPrice: data.totalPrice,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
}

export async function getSavedConfiguration(shareId: string) {
  return prisma.savedConfiguration.findUnique({ where: { shareId } });
}

export type AnalyticsSummary = Awaited<ReturnType<typeof computeAnalyticsSummary>> & {
  error: boolean;
};

function emptyAnalyticsSummary(): AnalyticsSummary {
  return {
    events: [],
    counts: {},
    total: 0,
    funnel: {
      openSessions: 0,
      cartSessions: 0,
      purchaseSessions: 0,
      configOrders: 0,
      otherOrders: 0,
      storeOrders: 0,
    },
    revenue: {
      added: 0,
      purchased: 0,
      incrementalTotal: 0,
      incrementalPerOrder: 0,
      configAOV: 0,
      storeAOV: 0,
      aovLiftPct: 0,
      revenuePerOpen: 0,
    },
    byMode: {},
    byDevice: [],
    byRacquet: [],
    trend: [],
    error: true,
  };
}

/**
 * Several aggregate DB queries — the Dashboard awaits this via `defer()`/`<Await>` with no
 * `errorElement`, so an uncaught rejection here doesn't just blank this one card, it throws
 * during render and takes down the ENTIRE admin page (surfaced as the generic "Something went
 * wrong" boundary). A transient DB hiccup (connection blip, statement timeout) must degrade to an
 * empty-but-renderable summary instead — same resilience posture as detectAppEmbedStatus.
 */
export type AnalyticsCounts = {
  counts: Record<string, number>;
  total: number;
  error: boolean;
};

/**
 * Event counts only — ONE aggregate query.
 *
 * The Dashboard card renders exactly three things: modal opens, add-to-carts, and the ratio
 * between them. All three come from `counts`. It was calling `getAnalyticsSummary`, which also
 * computes unique-session funnels, revenue/AOV, per-device and per-mode splits, a daily trend and
 * a top-15 racquet table — five queries, four of whose results were discarded on arrival, one of
 * them a findMany over every event in the window.
 *
 * The full summary still exists for the Analytics page, which actually renders all of it.
 */
export async function getAnalyticsCounts(shopId: string, days = 30): Promise<AnalyticsCounts> {
  try {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const grouped = await prisma.analytics.groupBy({
      by: ["eventType"],
      where: { shopId, createdAt: { gte: since } },
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    let total = 0;
    for (const g of grouped) {
      counts[g.eventType] = g._count._all;
      total += g._count._all;
    }
    return { counts, total, error: false };
  } catch (err) {
    // Same resilience posture as getAnalyticsSummary: the Dashboard awaits this through <Await>,
    // so a rejection would take down the whole page rather than just this card.
    console.error("getAnalyticsCounts: query failed:", err);
    return { counts: {}, total: 0, error: true };
  }
}

export async function getAnalyticsSummary(
  shopId: string,
  days = 30,
  options: { includeEvents?: boolean } = {},
): Promise<AnalyticsSummary> {
  try {
    const result = await computeAnalyticsSummary(shopId, days, options);
    return { ...result, error: false };
  } catch (err) {
    console.error("getAnalyticsSummary: query failed:", err);
    return emptyAnalyticsSummary();
  }
}

async function computeAnalyticsSummary(
  shopId: string,
  days: number,
  options: { includeEvents?: boolean },
) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const where = { shopId, createdAt: { gte: since } };

  // ALL FIVE queries issue together. None of them feeds another — every one reads the same table
  // over the same window and is reduced independently in JS below — but they used to be five
  // sequential `await`s, so the page waited for the SUM of five round trips when it only ever
  // needed the slowest. That is the whole latency of the Analytics page and the dashboard's
  // deferred card, paid four times over for nothing.
  const [grouped, sessionGroups, aggRows, racquetGroups, events] = await Promise.all([
    // Counts via a groupBy aggregate — accurate over the whole window (the old code counted
    // in JS over a 500-row cap, which was both wasteful and wrong for busy shops).
    prisma.analytics.groupBy({
      by: ["eventType"],
      where,
      _count: { _all: true },
    }),

    // Unique sessions per funnel stage (sessionId is a real column, stamped by the storefront on
    // every event). Distinct-count per stage → open → add-to-cart → purchase conversion.
    //
    // ONE groupBy, not three findMany+distinct. Prisma's `distinct` on findMany is applied by the
    // query engine in memory, NOT as SQL DISTINCT — so the old shape fetched every matching row's
    // sessionId across the whole window and deduplicated in JS, three times over. On a shop that
    // has been live for a while, `modal_open` alone is one row per configurator open, so this was
    // the query that degraded fastest as the table filled up. `groupBy` compiles to a real SQL
    // GROUP BY: Postgres does the deduplication against the index and returns one row per distinct
    // pair instead of one per event.
    prisma.analytics.groupBy({
      by: ["eventType", "sessionId"],
      where: {
        ...where,
        eventType: { in: ["modal_open", "add_to_cart", "purchase"] },
        NOT: { sessionId: null },
      },
    }),

    // Revenue / AOV / incremental / mode / device / daily-trend all derive from one plain findMany
    // over the four relevant event types, aggregated in JS. (An earlier version computed these via
    // $queryRaw for efficiency; that raw SQL turned out to be unreliable against the real database
    // and was silently swallowed by its own defensive try/catch, so these sections quietly showed
    // nothing real. Plain Prisma calls are the same proven approach the rest of this function
    // already uses — slower on paper, but correct, and this table's volume is nowhere near where
    // that would matter.)
    prisma.analytics.findMany({
      where: {
        ...where,
        eventType: { in: ["modal_open", "add_to_cart", "purchase", "order_other"] },
      },
      select: { eventType: true, productId: true, metadata: true, createdAt: true },
    }),

    // Top racquets by add-to-cart (productId is a column).
    prisma.analytics.groupBy({
      by: ["productId", "eventType"],
      where: {
        ...where,
        eventType: { in: ["modal_open", "add_to_cart", "purchase"] },
        NOT: { productId: null },
      },
      _count: { _all: true },
    }),

    // Only the analytics table needs actual rows (and only shows 50). The dashboard uses the
    // aggregates above, so it skips this query entirely.
    options.includeEvents
      ? prisma.analytics.findMany({
          where,
          orderBy: { createdAt: "desc" },
          take: 50,
        })
      : // Typed empty, not a bare `[]`. An untyped literal infers `never[]`, which widens the
        // field to `never[] | Analytics[]` — and once that crosses `defer()` the serializer turns
        // the `never` arm into `null`, so every consumer has to null-check rows that can never be
        // null. Naming the element type keeps the field a plain `Analytics[]` on both sides.
        Promise.resolve<Awaited<ReturnType<typeof prisma.analytics.findMany>>>([]),
  ]);

  const counts: Record<string, number> = {};
  let total = 0;
  for (const g of grouped) {
    counts[g.eventType] = g._count._all;
    total += g._count._all;
  }

  let openSessions = 0;
  let cartSessions = 0;
  let purchaseSessions = 0;
  for (const g of sessionGroups) {
    if (g.eventType === "modal_open") openSessions++;
    else if (g.eventType === "add_to_cart") cartSessions++;
    else if (g.eventType === "purchase") purchaseSessions++;
  }

  let cartValue = 0;
  let purchValue = 0;
  let purchIncremental = 0;
  let purchOrders = 0;
  let otherValue = 0;
  let otherOrders = 0;
  const byMode: Record<string, number> = {};
  const byDeviceMap = new Map<string, { device: string; opens: number; addToCarts: number; purchases: number }>();
  const trendMap = new Map<string, { day: string; opens: number; addToCarts: number; purchases: number }>();

  for (const row of aggRows) {
    const meta = parseJson<{ value?: number; incremental?: number; mode?: string; device?: string }>(
      row.metadata,
      {},
    );
    const day = row.createdAt.toISOString().slice(0, 10);
    const trendEntry = trendMap.get(day) ?? { day, opens: 0, addToCarts: 0, purchases: 0 };
    const device = meta.device ?? "unknown";
    const deviceEntry =
      byDeviceMap.get(device) ?? { device, opens: 0, addToCarts: 0, purchases: 0 };

    if (row.eventType === "modal_open") {
      trendEntry.opens++;
      deviceEntry.opens++;
    } else if (row.eventType === "add_to_cart") {
      cartValue += Number(meta.value) || 0;
      byMode[meta.mode ?? "unknown"] = (byMode[meta.mode ?? "unknown"] ?? 0) + 1;
      trendEntry.addToCarts++;
      deviceEntry.addToCarts++;
    } else if (row.eventType === "purchase") {
      purchValue += Number(meta.value) || 0;
      purchIncremental += Number(meta.incremental) || 0;
      purchOrders++;
      trendEntry.purchases++;
      deviceEntry.purchases++;
    } else if (row.eventType === "order_other") {
      otherValue += Number(meta.value) || 0;
      otherOrders++;
    }

    trendMap.set(day, trendEntry);
    if (row.eventType === "modal_open" || row.eventType === "add_to_cart" || row.eventType === "purchase") {
      byDeviceMap.set(device, deviceEntry);
    }
  }

  const configOrders = purchOrders;
  const storeOrders = configOrders + otherOrders;
  const configAOV = configOrders > 0 ? purchValue / configOrders : 0;
  const storeRevenue = purchValue + otherValue;
  const storeAOV = storeOrders > 0 ? storeRevenue / storeOrders : 0;

  const revenue = {
    added: cartValue,
    purchased: purchValue,
    incrementalTotal: purchIncremental,
    incrementalPerOrder: configOrders > 0 ? purchIncremental / configOrders : 0,
    configAOV,
    storeAOV,
    aovLiftPct: storeAOV > 0 ? ((configAOV - storeAOV) / storeAOV) * 100 : 0,
    revenuePerOpen: openSessions > 0 ? purchValue / openSessions : 0,
  };
  const byDevice = Array.from(byDeviceMap.values());
  const trend = Array.from(trendMap.values()).sort((a, b) => a.day.localeCompare(b.day));

  const byRacquetMap = new Map<
    string,
    { productId: string; opens: number; addToCarts: number; purchases: number }
  >();
  for (const g of racquetGroups) {
    if (!g.productId) continue;
    const entry =
      byRacquetMap.get(g.productId) ??
      { productId: g.productId, opens: 0, addToCarts: 0, purchases: 0 };
    if (g.eventType === "modal_open") entry.opens = g._count._all;
    else if (g.eventType === "add_to_cart") entry.addToCarts = g._count._all;
    else if (g.eventType === "purchase") entry.purchases = g._count._all;
    byRacquetMap.set(g.productId, entry);
  }
  const byRacquet = Array.from(byRacquetMap.values())
    .sort((a, b) => b.addToCarts - a.addToCarts)
    .slice(0, 15);

  return {
    events,
    counts,
    total,
    funnel: {
      openSessions,
      cartSessions,
      purchaseSessions,
      configOrders,
      otherOrders,
      storeOrders,
    },
    revenue,
    byMode,
    byDevice,
    byRacquet,
    trend,
  };
}
