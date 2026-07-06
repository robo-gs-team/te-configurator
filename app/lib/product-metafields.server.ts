import prisma from "~/db.server";
import { normalizeProductId, toProductGid } from "~/lib/product-id";
import { normalizeCollectionId } from "~/lib/collection-id";
import { DEFAULT_TENSION_RANGE, parseJson, type TensionRange } from "~/lib/configurator.types";
import { getProductsInCollections } from "~/lib/shopify-collections.server";

type ShopifyAdmin = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<Response>;
};

export type { TensionRange };

// Per-racquet stringing tension, per the functional spec (§3): "Tension parameters are
// specific to each racquet and sourced from per-SKU Shopify metafields." Registered as real
// metafield definitions so merchants can fill them in directly on the Shopify product page
// using Shopify's own native metafield editor — no custom form needed in our admin.
export const TENSION_NAMESPACE = "te_stringing";
export const TENSION_KEYS = {
  min: "tension_min",
  max: "tension_max",
  recommended: "tension_recommended",
} as const;

const DEFINITIONS = [
  { key: TENSION_KEYS.min, name: "Stringing tension — min (lbs)" },
  { key: TENSION_KEYS.max, name: "Stringing tension — max (lbs)" },
  { key: TENSION_KEYS.recommended, name: "Stringing tension — recommended (lbs)" },
];

// Once the definitions exist for a shop they're permanent, so remember which shops we've
// already ensured and skip the Shopify existence-check round-trip on every subsequent
// edit-page load. Cleared on cold start (re-checks once per shop per instance — cheap).
const ensuredShops = new Set<string>();

/**
 * Idempotently register the three tension metafield definitions on PRODUCT, so they show up
 * in Shopify's native "Metafields" section on every product page with a proper number input.
 * Checks existence first; once ensured for a shop, later calls return immediately.
 */
export async function ensureTensionMetafieldDefinitions(
  admin: ShopifyAdmin,
  shopDomain?: string,
): Promise<void> {
  if (shopDomain && ensuredShops.has(shopDomain)) return;
  try {
    const existingRes = await admin.graphql(`
      #graphql
      query ProtoExistingTensionDefinitions {
        metafieldDefinitions(first: 20, namespace: "${TENSION_NAMESPACE}", ownerType: PRODUCT) {
          nodes { key }
        }
      }
    `);
    const existingJson = (await existingRes.json()) as {
      data?: { metafieldDefinitions?: { nodes?: Array<{ key: string }> } };
    };
    const existingKeys = new Set(
      (existingJson.data?.metafieldDefinitions?.nodes ?? []).map((n) => n.key),
    );

    const missing = DEFINITIONS.filter((d) => !existingKeys.has(d.key));
    if (missing.length === 0) {
      if (shopDomain) ensuredShops.add(shopDomain);
      return;
    }

    for (const def of missing) {
      await admin.graphql(
        `
        #graphql
        mutation ProtoCreateTensionDefinition($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition { id }
            userErrors { field message code }
          }
        }
      `,
        {
          variables: {
            definition: {
              name: def.name,
              namespace: TENSION_NAMESPACE,
              key: def.key,
              type: "number_integer",
              ownerType: "PRODUCT",
            },
          },
        },
      );
    }
    if (shopDomain) ensuredShops.add(shopDomain);
  } catch (err) {
    // Best-effort — a merchant can still fall back to the default tension range.
    console.error("Failed to ensure tension metafield definitions:", err);
  }
}

type TensionMetafieldsResponse = {
  data?: {
    nodes?: Array<
      | {
          legacyResourceId?: string;
          tensionMin?: { value?: string } | null;
          tensionMax?: { value?: string } | null;
          tensionRecommended?: { value?: string } | null;
        }
      | null
    >;
  };
};

/**
 * Merge a racquet's raw min/max/recommended metafield values into a usable TensionRange,
 * tolerating partial data instead of discarding the whole racquet when one field is blank.
 *
 * - All three set and sane (min < max, recommended inside it) → used as-is.
 * - Only `recommended` set → paired with the generic default min/max, widened to include
 *   `recommended` if the merchant's real value falls outside that default range.
 * - Only min/max set (sane) → used as-is, with `recommended` defaulted (clamped into them).
 * - Nothing usable set → null, so the caller falls back to the full generic default.
 */
function mergeTensionFields(
  min: number,
  max: number,
  recommended: number,
): TensionRange | null {
  const hasMin = Number.isFinite(min);
  const hasMax = Number.isFinite(max);
  const hasRecommended = Number.isFinite(recommended);
  if (!hasMin && !hasMax && !hasRecommended) return null;

  const rangeSane = hasMin && hasMax && min < max;
  let resolvedMin = rangeSane ? min : DEFAULT_TENSION_RANGE.min;
  let resolvedMax = rangeSane ? max : DEFAULT_TENSION_RANGE.max;
  const resolvedRecommended = hasRecommended
    ? recommended
    : Math.min(resolvedMax, Math.max(resolvedMin, DEFAULT_TENSION_RANGE.recommended));

  // Never silently discard a real merchant-entered recommended value that falls outside
  // whatever min/max we ended up with — widen the range to include it instead.
  if (resolvedRecommended < resolvedMin) resolvedMin = resolvedRecommended;
  if (resolvedRecommended > resolvedMax) resolvedMax = resolvedRecommended;

  return { min: resolvedMin, max: resolvedMax, recommended: resolvedRecommended };
}

/**
 * Fetch per-racquet tension metafields for a set of product ids. A product is included in the
 * result as long as at least one of the three fields is usable — see mergeTensionFields for how
 * partial data is filled in. A racquet with none of the three set is omitted entirely so the
 * caller falls back to the full generic default.
 */
export async function getRacquetTensionMetafields(
  admin: ShopifyAdmin,
  productIds: string[],
): Promise<Record<string, TensionRange>> {
  if (productIds.length === 0) return {};

  const response = await admin.graphql(
    `
    #graphql
    query ProtoRacquetTension($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          legacyResourceId
          tensionMin: metafield(namespace: "${TENSION_NAMESPACE}", key: "${TENSION_KEYS.min}") { value }
          tensionMax: metafield(namespace: "${TENSION_NAMESPACE}", key: "${TENSION_KEYS.max}") { value }
          tensionRecommended: metafield(namespace: "${TENSION_NAMESPACE}", key: "${TENSION_KEYS.recommended}") { value }
        }
      }
    }
  `,
    { variables: { ids: productIds.map((id) => toProductGid(id)) } },
  );

  const body = (await response.json()) as TensionMetafieldsResponse;
  const result: Record<string, TensionRange> = {};

  for (const node of body.data?.nodes ?? []) {
    if (!node?.legacyResourceId) continue;
    const min = parseInt(node.tensionMin?.value ?? "", 10);
    const max = parseInt(node.tensionMax?.value ?? "", 10);
    const recommended = parseInt(node.tensionRecommended?.value ?? "", 10);
    const merged = mergeTensionFields(min, max, recommended);
    if (merged) {
      result[normalizeProductId(node.legacyResourceId)] = merged;
    }
  }

  return result;
}

/**
 * Resolve the full set of racquet product ids linked to a configurator (explicit
 * productIds union'd with every product in its racquet collectionIds), then fetch tension
 * metafields for all of them. Used at both save-time (snapshot.server.ts) and the live-
 * enrichment fallback (proxy.$.tsx) so the two paths stay consistent.
 */
export async function resolveRacquetTensionMap(
  admin: ShopifyAdmin,
  configurator: { productIds: string; collectionIds: string },
): Promise<Record<string, TensionRange>> {
  const explicitIds = parseJson<string[]>(configurator.productIds ?? "[]", []);
  const collectionIds = parseJson<string[]>(configurator.collectionIds ?? "[]", []);

  const collectionProducts =
    collectionIds.length > 0 ? await getProductsInCollections(admin, collectionIds) : [];

  const allIds = Array.from(
    new Set([...explicitIds, ...collectionProducts.map((p) => p.id)]),
  );

  return getRacquetTensionMetafields(admin, allIds);
}

// Per-racquet "recommended strings" — a Collection-reference metafield on each racquet product
// pointing at a curated collection of strings recommended for that frame. Resolved per-racquet
// (like tension) and surfaced as the default "Recommended" filter in the storefront.
const RECOMMENDED_STRINGS_NAMESPACE = "configurator";
const RECOMMENDED_STRINGS_KEY = "strings_collection";

/**
 * For every racquet linked to the configurator, read its `configurator.strings_collection`
 * metafield (a collection reference), then resolve that collection to the list of recommended
 * string product ids. Returns racquetProductId -> [stringProductId, ...]; racquets without the
 * metafield are simply absent. Batched: one metafield read per 50 racquets, then each unique
 * recommended-collection fetched once.
 */
export async function resolveRecommendedStringsMap(
  admin: ShopifyAdmin,
  configurator: { productIds: string; collectionIds: string },
): Promise<Record<string, string[]>> {
  const explicitIds = parseJson<string[]>(configurator.productIds ?? "[]", []);
  const collectionIds = parseJson<string[]>(configurator.collectionIds ?? "[]", []);
  const collectionProducts =
    collectionIds.length > 0 ? await getProductsInCollections(admin, collectionIds) : [];
  const racquetIds = Array.from(
    new Set([...explicitIds, ...collectionProducts.map((p) => p.id)]),
  );
  if (racquetIds.length === 0) return {};

  // racquet product id -> normalized recommended-strings collection id
  const racquetToCollection: Record<string, string> = {};
  for (const batch of chunk(racquetIds, 50)) {
    const res = await admin.graphql(
      `
      #graphql
      query ProtoRecommendedStrings($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            legacyResourceId
            rec: metafield(namespace: "${RECOMMENDED_STRINGS_NAMESPACE}", key: "${RECOMMENDED_STRINGS_KEY}") { value }
          }
        }
      }
    `,
      { variables: { ids: batch.map((id) => toProductGid(id)) } },
    );
    const body = (await res.json()) as {
      data?: { nodes?: Array<{ legacyResourceId?: string; rec?: { value?: string } | null } | null> };
    };
    for (const node of body.data?.nodes ?? []) {
      const collectionRef = node?.rec?.value;
      if (node?.legacyResourceId && collectionRef) {
        racquetToCollection[normalizeProductId(node.legacyResourceId)] =
          normalizeCollectionId(collectionRef);
      }
    }
  }

  const uniqueCollections = Array.from(new Set(Object.values(racquetToCollection)));
  if (uniqueCollections.length === 0) return {};

  // Fetch each unique recommended-strings collection once.
  const collectionToProductIds: Record<string, string[]> = {};
  await Promise.all(
    uniqueCollections.map(async (cid) => {
      const products = await getProductsInCollections(admin, [cid]);
      collectionToProductIds[cid] = products.map((p) => p.id);
    }),
  );

  const result: Record<string, string[]> = {};
  for (const [racquetId, cid] of Object.entries(racquetToCollection)) {
    const ids = collectionToProductIds[cid];
    if (ids?.length) result[racquetId] = ids;
  }
  return result;
}

/**
 * Every racquet product id linked to ANY configurator in the shop (explicit productIds union'd
 * with every product in every configurator's collectionIds), deduped. Used to scope the
 * one-time legacy-tension migration to products that actually matter to this app, rather than
 * every product in the catalog.
 */
export async function getAllLinkedRacquetProductIds(
  admin: ShopifyAdmin,
  shopId: string,
): Promise<string[]> {
  const configurators = await prisma.configurator.findMany({
    where: { shopId },
    select: { productIds: true, collectionIds: true },
  });

  const explicitIds = configurators.flatMap((c) => parseJson<string[]>(c.productIds ?? "[]", []));
  const collectionIds = Array.from(
    new Set(configurators.flatMap((c) => parseJson<string[]>(c.collectionIds ?? "[]", []))),
  );

  const collectionProducts =
    collectionIds.length > 0 ? await getProductsInCollections(admin, collectionIds) : [];

  return Array.from(new Set([...explicitIds, ...collectionProducts.map((p) => p.id)]));
}

/** Legacy per-racquet tension fields from a prior system, already populated across the catalog. */
const LEGACY_TENSION_NAMESPACE = "racquet";
const LEGACY_TENSION_KEYS = {
  min: "string_tension_min",
  max: "string_tension_max",
  recommended: "string_tension_recommended",
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type TensionMigrationResult = {
  total: number;
  updated: number;
  skippedAlreadySet: number;
  skippedNoLegacyData: number;
};

type LegacyMigrationNode = {
  legacyResourceId?: string;
  legacyMin?: { value?: string } | null;
  legacyMax?: { value?: string } | null;
  legacyRecommended?: { value?: string } | null;
  currentMin?: { value?: string } | null;
  currentMax?: { value?: string } | null;
  currentRecommended?: { value?: string } | null;
};

/**
 * One-time migration: copy each racquet's legacy `racquet.string_tension_min/max/recommended`
 * values (from a prior system) into our own `te_stringing.tension_min/max/recommended` fields.
 *
 * Skips any racquet that already has at least one te_stringing tension value set — this never
 * overwrites a value a merchant (or this tool, on a prior run) already put in the canonical
 * fields, it only fills in ones that are still blank. Also skips racquets with no legacy data
 * to copy. Safe to re-run.
 */
export async function migrateLegacyRacquetTension(
  admin: ShopifyAdmin,
  productIds: string[],
): Promise<TensionMigrationResult> {
  const result: TensionMigrationResult = {
    total: productIds.length,
    updated: 0,
    skippedAlreadySet: 0,
    skippedNoLegacyData: 0,
  };
  if (productIds.length === 0) return result;

  const writes: Array<{ ownerId: string; namespace: string; key: string; type: string; value: string }> = [];

  for (const batch of chunk(productIds, 50)) {
    const response = await admin.graphql(
      `
      #graphql
      query ProtoLegacyTensionMigrationRead($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            legacyResourceId
            legacyMin: metafield(namespace: "${LEGACY_TENSION_NAMESPACE}", key: "${LEGACY_TENSION_KEYS.min}") { value }
            legacyMax: metafield(namespace: "${LEGACY_TENSION_NAMESPACE}", key: "${LEGACY_TENSION_KEYS.max}") { value }
            legacyRecommended: metafield(namespace: "${LEGACY_TENSION_NAMESPACE}", key: "${LEGACY_TENSION_KEYS.recommended}") { value }
            currentMin: metafield(namespace: "${TENSION_NAMESPACE}", key: "${TENSION_KEYS.min}") { value }
            currentMax: metafield(namespace: "${TENSION_NAMESPACE}", key: "${TENSION_KEYS.max}") { value }
            currentRecommended: metafield(namespace: "${TENSION_NAMESPACE}", key: "${TENSION_KEYS.recommended}") { value }
          }
        }
      }
    `,
      { variables: { ids: batch.map((id) => toProductGid(id)) } },
    );

    const body = (await response.json()) as { data?: { nodes?: Array<LegacyMigrationNode | null> } };

    for (const node of body.data?.nodes ?? []) {
      if (!node?.legacyResourceId) continue;

      const alreadySet = Boolean(
        node.currentMin?.value || node.currentMax?.value || node.currentRecommended?.value,
      );
      if (alreadySet) {
        result.skippedAlreadySet++;
        continue;
      }

      const min = node.legacyMin?.value;
      const max = node.legacyMax?.value;
      const recommended = node.legacyRecommended?.value;
      if (!min && !max && !recommended) {
        result.skippedNoLegacyData++;
        continue;
      }

      const productGid = toProductGid(node.legacyResourceId);
      if (min) writes.push({ ownerId: productGid, namespace: TENSION_NAMESPACE, key: TENSION_KEYS.min, type: "number_integer", value: min });
      if (max) writes.push({ ownerId: productGid, namespace: TENSION_NAMESPACE, key: TENSION_KEYS.max, type: "number_integer", value: max });
      if (recommended) writes.push({ ownerId: productGid, namespace: TENSION_NAMESPACE, key: TENSION_KEYS.recommended, type: "number_integer", value: recommended });
      result.updated++;
    }
  }

  for (const batch of chunk(writes, 25)) {
    await admin.graphql(
      `
      #graphql
      mutation ProtoLegacyTensionMigrationWrite($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          userErrors { field message code }
        }
      }
    `,
      { variables: { metafields: batch } },
    );
  }

  return result;
}
