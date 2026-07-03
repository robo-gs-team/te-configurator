import { toProductGid } from "~/lib/product-id";
import { normalizeProductId } from "~/lib/product-id";
import { parseJson, type TensionRange } from "~/lib/configurator.types";
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
 * Fetch per-racquet tension metafields for a set of product ids. A product is only included
 * in the result if all three fields are set and form a sane range (min < max, recommended
 * inside it) — otherwise it's omitted so callers fall back to a sane default.
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
    if (
      Number.isFinite(min) &&
      Number.isFinite(max) &&
      Number.isFinite(recommended) &&
      min < max &&
      recommended >= min &&
      recommended <= max
    ) {
      result[normalizeProductId(node.legacyResourceId)] = { min, max, recommended };
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
