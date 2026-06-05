import prisma from "~/db.server";
import type { ConfiguratorWithRelations } from "~/lib/configurator.types";
import { parseJson } from "~/lib/configurator.types";
import { productIdsMatch } from "~/lib/product-id";

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
): Promise<ConfiguratorProductLookup> {
  const shop = await prisma.shop.findUnique({ where: { domain: shopDomain } });
  if (!shop) return { status: "not_linked" };

  const configurators = await prisma.configurator.findMany({
    where: { shopId: shop.id },
    include: configuratorInclude,
  });

  const match = configurators.find((c) => {
    const ids = parseJson<string[]>(c.productIds, []);
    return productIdsMatch(ids, productId);
  });

  if (!match) return { status: "not_linked" };
  if (!match.isActive) return { status: "inactive", configurator: match };
  return { status: "found", configurator: match };
}

export async function getConfiguratorForProduct(
  shopDomain: string,
  productId: string,
): Promise<ConfiguratorWithRelations | null> {
  const result = await lookupConfiguratorForProduct(shopDomain, productId);
  return result.status === "found" ? result.configurator : null;
}

export async function listConfigurators(shopId: string) {
  return prisma.configurator.findMany({
    where: { shopId },
    orderBy: { updatedAt: "desc" },
    include: {
      steps: { select: { id: true } },
      addons: { select: { id: true } },
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

export async function getAnalyticsSummary(shopId: string, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const events = await prisma.analytics.findMany({
    where: { shopId, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const counts = events.reduce<Record<string, number>>((acc, event) => {
    acc[event.eventType] = (acc[event.eventType] ?? 0) + 1;
    return acc;
  }, {});

  return { events, counts, total: events.length };
}
