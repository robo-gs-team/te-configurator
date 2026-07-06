import prisma from "~/db.server";
import { enrichConfiguratorWithShopifyData } from "~/lib/enrich-configurator.server";
import { getConfiguratorById, getShopThemeSettings } from "~/lib/configurator.server";
import { invalidateProxyCache } from "~/lib/proxy-cache.server";
import {
  resolveRacquetTensionMap,
  resolveRecommendedStringsMap,
} from "~/lib/product-metafields.server";
import { DEFAULT_TENSION_RANGE, serializeConfiguratorPayload } from "~/lib/configurator.types";
import type { ConfiguratorWithRelations, TensionRange } from "~/lib/configurator.types";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

// Stored shape of enrichedSnapshot. racquetTensionByProductId covers every racquet product
// linked to the configurator (spec §3: tension is per-SKU) — the proxy picks out the entry
// for whichever specific racquet is being viewed at serve time. The nested `configurator`
// object's own tensionRange field is a placeholder overwritten per-request.
export type StoredSnapshot = {
  configurator: ReturnType<typeof serializeConfiguratorPayload>;
  racquetTensionByProductId: Record<string, TensionRange>;
  // Per-racquet recommended string product ids (from each racquet's strings_collection metafield);
  // the proxy picks the entry for the viewed racquet and passes it to the storefront's default
  // "Recommended" filter. Absent racquets simply have no recommended set.
  recommendedStringsByRacquet: Record<string, string[]>;
};

export async function buildAndStoreSnapshot(
  admin: ShopifyAdmin,
  configurator: ConfiguratorWithRelations,
  shopId: string,
): Promise<void> {
  const [enriched, theme, racquetTensionByProductId, recommendedStringsByRacquet] =
    await Promise.all([
      enrichConfiguratorWithShopifyData(admin, configurator),
      getShopThemeSettings(shopId),
      resolveRacquetTensionMap(admin, configurator),
      resolveRecommendedStringsMap(admin, configurator),
    ]);

  const payload: StoredSnapshot = {
    configurator: serializeConfiguratorPayload(enriched, theme, DEFAULT_TENSION_RANGE),
    racquetTensionByProductId,
    recommendedStringsByRacquet,
  };

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
    // Rebuild all configurators concurrently — each refresh is already best-effort (never
    // throws), so one shop typically has only a handful and this stays well within limits.
    await Promise.all(
      configurators.map(({ id }) =>
        refreshConfiguratorSnapshot(admin, id, shopId, shopDomain),
      ),
    );
  } catch (err) {
    console.error(`Shop snapshot refresh failed for shop ${shopId}:`, err);
  }
}
