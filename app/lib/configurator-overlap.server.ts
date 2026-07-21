import prisma from "~/db.server";
import { parseJson } from "~/lib/configurator.types";
import { getProductIdsInCollections } from "~/lib/shopify-collections.server";
import { getProductsByIds } from "~/lib/shopify-products.server";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type ConfiguratorOverlap = {
  configuratorId: string;
  configuratorName: string;
  products: { id: string; title: string }[];
};

/** Resolve a configurator's effective racquet set: explicit products + collection membership,
 *  minus its own excluded products — the same three inputs lookupConfiguratorForProduct uses to
 *  decide whether the Configure button shows on a given racquet. */
async function resolveEffectiveRacquetIds(
  admin: ShopifyAdmin,
  productIds: string[],
  collectionIds: string[],
  excludedProductIds: string[],
): Promise<Set<string>> {
  const collectionProductIds =
    collectionIds.length > 0 ? await getProductIdsInCollections(admin, collectionIds) : [];
  const excluded = new Set(excludedProductIds);
  return new Set([...productIds, ...collectionProductIds].filter((id) => !excluded.has(id)));
}

/**
 * Find every OTHER configurator in this shop whose effective racquet set (see
 * resolveEffectiveRacquetIds) shares at least one product with the one being saved — the exact
 * condition that makes lookupConfiguratorForProduct's winner arbitrary for that racquet (see
 * app/lib/configurator.server.ts). Best-effort and read-only: never blocks the save; on any
 * Shopify API error, logs and returns no warnings rather than failing the whole Save.
 *
 * Only checks RACQUET assignment (productIds/collectionIds) — string assignment can't compete
 * for the Configure button, so it isn't part of this collision.
 */
export async function detectConfiguratorOverlap(
  admin: ShopifyAdmin,
  shopId: string,
  currentConfiguratorId: string,
  current: { productIds: string[]; collectionIds: string[]; excludedProductIds: string[] },
): Promise<ConfiguratorOverlap[]> {
  try {
    if (current.productIds.length === 0 && current.collectionIds.length === 0) return [];

    const currentSet = await resolveEffectiveRacquetIds(
      admin,
      current.productIds,
      current.collectionIds,
      current.excludedProductIds,
    );
    if (currentSet.size === 0) return [];

    const others = await prisma.configurator.findMany({
      where: { shopId, id: { not: currentConfiguratorId } },
      select: {
        id: true,
        name: true,
        productIds: true,
        collectionIds: true,
      },
    });
    if (others.length === 0) return [];

    const results = await Promise.all(
      others.map(async (other) => {
        const otherProductIds = parseJson<string[]>(other.productIds, []);
        const otherCollectionIds = parseJson<string[]>(other.collectionIds, []);
        const otherExcludedRaw = (
          other as unknown as { excludedProductIds?: string }
        ).excludedProductIds;
        const otherExcludedProductIds = parseJson<string[]>(otherExcludedRaw ?? "[]", []);
        if (otherProductIds.length === 0 && otherCollectionIds.length === 0) return null;

        const otherSet = await resolveEffectiveRacquetIds(
          admin,
          otherProductIds,
          otherCollectionIds,
          otherExcludedProductIds,
        );
        const overlapIds = Array.from(currentSet).filter((id) => otherSet.has(id));
        if (overlapIds.length === 0) return null;
        return { configuratorId: other.id, configuratorName: other.name, ids: overlapIds };
      }),
    );

    const overlaps = results.filter((r): r is NonNullable<typeof r> => r !== null);
    if (overlaps.length === 0) return [];

    // One batched title lookup across every overlapping id from every configurator, so the
    // warning reads as product names instead of bare ids.
    const allIds = Array.from(new Set(overlaps.flatMap((o) => o.ids)));
    const details = await getProductsByIds(admin, allIds);
    const titleById = new Map(details.map((p) => [p.id, p.title]));

    return overlaps.map((o) => ({
      configuratorId: o.configuratorId,
      configuratorName: o.configuratorName,
      products: o.ids.map((id) => ({ id, title: titleById.get(id) ?? id })),
    }));
  } catch (err) {
    console.error("detectConfiguratorOverlap failed (non-blocking):", err);
    return [];
  }
}
