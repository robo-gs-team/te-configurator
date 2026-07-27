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

export async function ensureShop(domain: string) {
  return prisma.shop.upsert({
    where: { domain },
    create: { domain, name: domain },
    update: {},
  });
}

export async function getShopThemeSettings(shopId: string) {
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
 * @returns The winning candidate row, or undefined if none matched.
 */
async function findMatchingConfigurator(
  shopId: string,
  productId: string,
  shopDomain: string,
  admin?: ShopifyAdmin,
): Promise<ConfiguratorCandidate | undefined> {
  const candidates = await prisma.configurator.findMany({
    where: { shopId },
    select: {
      id: true,
      isActive: true,
      productIds: true,
      collectionIds: true,
      excludedProductIds: true,
    },
  });

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

  const winner = await findMatchingConfigurator(shop.id, productId, shopDomain, admin);
  if (!winner) return { linked: false, code: "not_linked" };
  if (!winner.isActive) return { linked: false, code: "inactive" };

  // Shop-wide kill switch (Theme Settings → "Enable customize button globally") overrides any
  // individual configurator's active state — same semantics as the full endpoint's
  // `configurator.theme.buttonEnabled === false` check.
  const theme = await getShopThemeSettings(shop.id);
  if (theme.buttonEnabled === false) return { linked: false, code: "button_disabled" };

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

  // Counts via a groupBy aggregate — accurate over the whole window (the old code counted
  // in JS over a 500-row cap, which was both wasteful and wrong for busy shops).
  const grouped = await prisma.analytics.groupBy({
    by: ["eventType"],
    where,
    _count: { _all: true },
  });
  const counts: Record<string, number> = {};
  let total = 0;
  for (const g of grouped) {
    counts[g.eventType] = g._count._all;
    total += g._count._all;
  }

  // Unique sessions per funnel stage (sessionId is a real column, stamped by the storefront on
  // every event). Distinct-count per stage → open → add-to-cart → purchase conversion.
  const uniqueSessions = async (eventType: string) => {
    const rows = await prisma.analytics.findMany({
      where: { ...where, eventType, NOT: { sessionId: null } },
      distinct: ["sessionId"],
      select: { sessionId: true },
    });
    return rows.length;
  };
  const [openSessions, cartSessions, purchaseSessions] = await Promise.all([
    uniqueSessions("modal_open"),
    uniqueSessions("add_to_cart"),
    uniqueSessions("purchase"),
  ]);

  // Revenue / AOV / incremental / mode / device / daily-trend all derive from one plain findMany
  // over the four relevant event types, aggregated in JS. (An earlier version computed these via
  // $queryRaw for efficiency; that raw SQL turned out to be unreliable against the real database
  // and was silently swallowed by its own defensive try/catch, so these sections quietly showed
  // nothing real. Plain Prisma calls are the same proven approach the rest of this function
  // already uses — slower on paper, but correct, and this table's volume is nowhere near where
  // that would matter.)
  const aggRows = await prisma.analytics.findMany({
    where: {
      ...where,
      eventType: { in: ["modal_open", "add_to_cart", "purchase", "order_other"] },
    },
    select: { eventType: true, productId: true, metadata: true, createdAt: true },
  });

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

  // Top racquets by add-to-cart (productId is a column).
  const racquetGroups = await prisma.analytics.groupBy({
    by: ["productId", "eventType"],
    where: {
      ...where,
      eventType: { in: ["modal_open", "add_to_cart", "purchase"] },
      NOT: { productId: null },
    },
    _count: { _all: true },
  });
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

  // Only the analytics table needs actual rows (and only shows 50). The dashboard uses the
  // aggregates above, so it skips this query entirely.
  const events = options.includeEvents
    ? await prisma.analytics.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];

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
