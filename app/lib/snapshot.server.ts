import prisma from "~/db.server";
import { enrichConfiguratorWithShopifyData } from "~/lib/enrich-configurator.server";
import { getConfiguratorById, getShopThemeSettings } from "~/lib/configurator.server";
import { invalidateProxyCache } from "~/lib/proxy-cache.server";
import { serializeConfiguratorPayload } from "~/lib/configurator.types";
import type { ConfiguratorWithRelations } from "~/lib/configurator.types";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export async function buildAndStoreSnapshot(
  admin: ShopifyAdmin,
  configurator: ConfiguratorWithRelations,
  shopId: string,
): Promise<void> {
  const [enriched, theme] = await Promise.all([
    enrichConfiguratorWithShopifyData(admin, configurator),
    getShopThemeSettings(shopId),
  ]);

  const payload = { configurator: serializeConfiguratorPayload(enriched, theme) };

  await prisma.configurator.update({
    where: { id: configurator.id },
    data: {
      enrichedSnapshot: JSON.stringify(payload),
      snapshotUpdatedAt: new Date(),
    } as Parameters<typeof prisma.configurator.update>[0]["data"],
  });
}

/**
 * Best-effort snapshot rebuild for a single configurator, plus a proxy-cache bust.
 *
 * Call this after ANY admin mutation that changes what shoppers should see (name/collections,
 * option groups, addons, rules, steps, options). Never throws — the daily cron is the backstop,
 * so a transient Shopify Admin API error must not fail the merchant's save. Errors are logged.
 */
export async function refreshConfiguratorSnapshot(
  admin: ShopifyAdmin,
  configuratorId: string,
  shopId: string,
  shopDomain: string,
): Promise<void> {
  try {
    const configurator = await getConfiguratorById(configuratorId);
    if (configurator) {
      await buildAndStoreSnapshot(admin, configurator, shopId);
    }
    invalidateProxyCache(shopDomain);
  } catch (err) {
    console.error(`Snapshot refresh failed for configurator ${configuratorId}:`, err);
  }
}

/**
 * Rebuild snapshots for every configurator in a shop. Used when a shop-wide input changes —
 * e.g. theme settings, which are baked into each snapshot via serializeConfiguratorPayload.
 * Best-effort and sequential; a stringing shop has only a handful of configurators.
 */
export async function refreshShopSnapshots(
  admin: ShopifyAdmin,
  shopId: string,
  shopDomain: string,
): Promise<void> {
  try {
    const configurators = await prisma.configurator.findMany({
      where: { shopId },
      select: { id: true },
    });
    for (const { id } of configurators) {
      await refreshConfiguratorSnapshot(admin, id, shopId, shopDomain);
    }
  } catch (err) {
    console.error(`Shop snapshot refresh failed for shop ${shopId}:`, err);
  }
}
