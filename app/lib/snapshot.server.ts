import prisma from "~/db.server";
import { enrichConfiguratorWithShopifyData } from "~/lib/enrich-configurator.server";
import { getConfiguratorById, getShopThemeSettings } from "~/lib/configurator.server";
import { invalidateProxyCache } from "~/lib/proxy-cache.server";
import {
  resolveRacquetTensionMap,
  resolveRecommendedStringsMap,
} from "~/lib/product-metafields.server";
import { resolveStringUnitsSold } from "~/lib/product-sales.server";
import {
  DEFAULT_TENSION_RANGE,
  parseJson,
  serializeConfiguratorPayload,
} from "~/lib/configurator.types";
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
  // Per-racquet recommended string product ids (from each racquet's strings_collection /
  // hybrid_strings_collection metafields); the proxy picks the entry for the viewed racquet and
  // passes it to the storefront's default "Recommended" filter (standard vs hybrid mode). Absent
  // racquets simply have no recommended set.
  recommendedStringsByRacquet: Record<string, string[]>;
  recommendedHybridStringsByRacquet: Record<string, string[]>;
  // Store-wide units sold per string product over the last 60 days (from resolveStringUnitsSold),
  // used by the storefront to sort strings best-seller-first. Identical for every racquet, so the
  // proxy injects it verbatim. Refreshed by the nightly cron (NOT on every save) — see the
  // refreshSales gate in buildAndStoreSnapshot. May be absent on snapshots written before this
  // field existed; readers default to {}.
  stringUnitsSoldByProductId: Record<string, number>;
};

/** Product ids of the strings this configurator shows (option groups whose name matches "string"),
 *  mirroring the storefront's own /string/i group selection so the units-sold keys line up with
 *  the productIds resolveStringCatalog looks up. */
function collectStringProductIds(configurator: ConfiguratorWithRelations): string[] {
  const ids = new Set<string>();
  for (const step of configurator.steps) {
    for (const group of step.optionGroups) {
      if (!/string/i.test(group.name)) continue;
      for (const option of group.options) {
        if (option.productId) ids.add(option.productId);
      }
    }
  }
  return Array.from(ids);
}

/** Reuse the previous snapshot's best-seller tally so a merchant save doesn't scan 60 days of
 *  orders — sales only need to refresh on the daily cron. Empty when there's no prior snapshot. */
function carryForwardUnitsSold(
  configurator: ConfiguratorWithRelations,
): Record<string, number> {
  const snap = (configurator as ConfiguratorWithRelations & {
    enrichedSnapshot?: string | null;
  }).enrichedSnapshot;
  if (!snap) return {};
  const prev = parseJson<Partial<StoredSnapshot>>(snap, {});
  return prev.stringUnitsSoldByProductId ?? {};
}

export type SnapshotBuildOptions = {
  /** Re-scan Shopify orders for the best-seller tally instead of carrying the previous one
   *  forward. Off for ordinary saves; on for the nightly cron and the explicit rebuild buttons. */
  refreshSales?: boolean;
  /** Page cap for that scan (50 orders per page, newest first). Omit for the full window — only
   *  the cron should, since a full walk is far longer than any merchant request may last. */
  salesMaxPages?: number;
};

/**
 * Page cap for a merchant-triggered rebuild: 30 pages ≈ the 1,500 most recent orders in the
 * window. Enough to rank strings by real sales immediately, and bounded so the request finishes;
 * the nightly cron replaces it with the full-window tally.
 */
export const INTERACTIVE_SALES_MAX_PAGES = 30;

export async function buildAndStoreSnapshot(
  admin: ShopifyAdmin,
  configurator: ConfiguratorWithRelations,
  shopId: string,
  opts?: SnapshotBuildOptions,
): Promise<void> {
  const [enriched, theme, racquetTensionByProductId, recommended] = await Promise.all([
    enrichConfiguratorWithShopifyData(admin, configurator),
    getShopThemeSettings(shopId),
    resolveRacquetTensionMap(admin, configurator),
    resolveRecommendedStringsMap(admin, configurator),
  ]);

  // Best-seller data is NOT refreshed on an ordinary merchant save — those carry the previous
  // tally forward so saving stays fast and never scans 60 days of orders. It IS refreshed when a
  // caller explicitly asks: the nightly cron (full window), and the merchant's explicit "Rebuild
  // storefront data now" / "Rebuild snapshot" buttons (capped, see salesMaxPages).
  const stringUnitsSoldByProductId = opts?.refreshSales
    ? await resolveStringUnitsSold(admin, collectStringProductIds(enriched), new Date(), {
        maxPages: opts.salesMaxPages,
      })
    : carryForwardUnitsSold(configurator);

  const payload: StoredSnapshot = {
    configurator: serializeConfiguratorPayload(enriched, theme, DEFAULT_TENSION_RANGE),
    racquetTensionByProductId,
    recommendedStringsByRacquet: recommended.standard,
    recommendedHybridStringsByRacquet: recommended.hybrid,
    stringUnitsSoldByProductId,
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
  opts?: SnapshotBuildOptions,
): Promise<void> {
  try {
    const configurator = await getConfiguratorById(configuratorId);
    if (configurator) {
      await buildAndStoreSnapshot(admin, configurator, shopId, opts);
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
  opts?: SnapshotBuildOptions,
): Promise<void> {
  try {
    const configurators = await prisma.configurator.findMany({
      where: { shopId },
      select: { id: true },
    });
    if (opts?.refreshSales) {
      // SEQUENTIAL when sales are being refreshed: each rebuild walks the orders API, and firing
      // those walks concurrently would multiply the request rate against Shopify's cost limiter
      // for no gain — the work is I/O against the same endpoint either way.
      for (const { id } of configurators) {
        await refreshConfiguratorSnapshot(admin, id, shopId, shopDomain, opts);
      }
      return;
    }
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
