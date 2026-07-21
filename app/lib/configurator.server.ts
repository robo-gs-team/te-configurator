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

const configuratorInclude = {
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

export async function lookupConfiguratorForProduct(
  shopDomain: string,
  productId: string,
  admin?: ShopifyAdmin,
): Promise<ConfiguratorProductLookup> {
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) return { status: "not_linked" };

  const configurators = await prisma.configurator.findMany({
    where: { shopId: shop.id },
    include: configuratorInclude,
  });

  // A configurator never applies to a product the merchant explicitly excluded — even if that
  // product's ID or collection would otherwise match below.
  const isExcludedFor = (configurator: (typeof configurators)[number]) => {
    const excluded = parseJson<string[]>(
      (configurator as { excludedProductIds?: string }).excludedProductIds ?? "[]",
      [],
    );
    return productIdsMatch(excluded, productId);
  };

  // First pass: check explicit product IDs — no network call needed
  for (const configurator of configurators) {
    if (isExcludedFor(configurator)) continue;
    const productIds = parseJson<string[]>(configurator.productIds, []);
    if (productIdsMatch(productIds, productId)) {
      if (!configurator.isActive) return { status: "inactive", configurator };
      return { status: "found", configurator };
    }
  }

  // Second pass: check collection membership.
  // Fetch the product's collections ONCE then compare in-memory against all configurators,
  // instead of making one Shopify API call per configurator.
  const collectionConfigurators = (configurators as ConfiguratorWithRelations[]).filter(
    (c) => parseJson<string[]>(c.collectionIds, []).length > 0,
  );

  if (collectionConfigurators.length > 0 && admin) {
    const productCollectionIds = await getProductCollectionIds(admin, productId, shopDomain);
    const productCollSet = new Set(productCollectionIds.map(normalizeCollectionId));

    for (const configurator of collectionConfigurators) {
      if (isExcludedFor(configurator)) continue;
      const collectionIds = parseJson<string[]>(configurator.collectionIds, []);
      const matches = collectionIds.some((id) => productCollSet.has(normalizeCollectionId(id)));
      if (matches) {
        if (!configurator.isActive) return { status: "inactive", configurator };
        return { status: "found", configurator };
      }
    }
  }

  return { status: "not_linked" };
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

export async function getAnalyticsSummary(
  shopId: string,
  days = 30,
  options: { includeEvents?: boolean } = {},
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

  // Revenue + standard/hybrid split come from the lower-volume add_to_cart / purchase rows, whose
  // metadata carries the numeric `value` and (for carts) the `mode`.
  const valueRows = await prisma.analytics.findMany({
    where: { ...where, eventType: { in: ["add_to_cart", "purchase"] } },
    select: { eventType: true, metadata: true },
  });
  let revenueAdded = 0;
  let revenuePurchased = 0;
  const byMode: Record<string, number> = {};
  for (const row of valueRows) {
    const meta = parseJson<{ value?: number; mode?: string }>(row.metadata, {});
    const val = Number(meta.value) || 0;
    if (row.eventType === "add_to_cart") {
      revenueAdded += val;
      const mode = meta.mode ?? "unknown";
      byMode[mode] = (byMode[mode] ?? 0) + 1;
    } else if (row.eventType === "purchase") {
      revenuePurchased += val;
    }
  }

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
    funnel: { openSessions, cartSessions, purchaseSessions },
    revenue: { added: revenueAdded, purchased: revenuePurchased },
    byMode,
    byRacquet,
  };
}
